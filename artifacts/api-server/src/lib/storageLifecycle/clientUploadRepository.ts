import { createHash, randomUUID } from "node:crypto";
import {
  clients,
  currentTenantDatabaseOrganisation,
  db,
  documents,
  documentVersions,
  projects,
  uploadSessions,
  workTasks,
} from "@workspace/db";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { writeAuditTx } from "../audit";
import { lockCanonicalEvidenceDigest } from "../canonicalEvidence";
import { parseInstantViaString } from "../dbClock";
import {
  parsePersistedClientActionEnvelope,
  persistedClientActionTitle,
  serializePersistedClientActionEnvelope,
} from "../clientActionPortal/drizzleRepository";
import { deriveClientEvidenceRequestStatus } from "../clientActionPortal/service";
import type {
  ClientActionScope,
  ClientEvidenceAttempt,
  ClientEvidenceRequestRecord,
  ClientEvidenceSlot,
} from "../clientActionPortal/contracts";
import { initialExtractionState } from "../documentExtractionPolicy";
import { inspectDocumentIntake } from "../documentIntakeSecurity";
import { resolveCurrentDirectAuthority } from "../directMembershipAuthority";
import { getMaxUploadBytes } from "../intakeLimits";
import {
  ObjectNotFoundError,
  ObjectPromotionCleanupError,
  ObjectQuarantinePartialMoveError,
  ObjectStorageService,
  ObjectTooLargeError,
  type ObjectEntityIntake,
} from "../objectStorage";
import { productionFeatureIssues } from "../productionReadiness";
import { isProjectContentImmutable } from "../reportPolicy";
import { lockStagedUploadObject } from "../stagedUploadLock";
import { storagePathReferenceKinds } from "../storageReferences";
import { canonicalMimeForDetectedFormat } from "../uploadInspection";
import {
  CLIENT_UPLOAD_LEASE_SCHEMA,
  STORAGE_LIFECYCLE_BOUNDS,
  StorageLifecycleContractError,
  clientUploadDocumentPath,
  clientUploadObjectPath,
  createClientUploadLeaseEnvelope,
  parseClientUploadLeaseEnvelope,
  serializeClientUploadLeaseEnvelope,
  storageLifecycleSha256,
  type ClientUploadLeaseEnvelope,
} from "./contracts";
import {
  GovernedClientUploadError,
  type ClientUploadFinalizationReceipt,
  type ClientUploadLeaseGrant,
  type FinalizeClientUploadCommand,
  type GovernedClientUploadRepository,
  type GovernedClientUploadScope,
  type IssueClientUploadLeaseCommand,
} from "./clientUpload";

import {
  SHA256_HEX_PATTERN as SHA256,
  UUID_PATTERN as UUID,
} from "../identifierPatterns";
const ACCEPTED_CLIENT_UPLOAD_MIME = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/zip",
  "application/x-zip-compressed",
  "image/png",
  "image/jpeg",
]);
const NDA_ALLOWED = new Set(["signed", "not_required"]);

type UploadSessionRow = typeof uploadSessions.$inferSelect;

export interface ClientUploadObjectStore {
  getObjectEntityUploadURL(
    organisationId?: string,
    requestedObjectId?: string,
    ttlSec?: number,
    notAfter?: Date,
  ): Promise<string>;
  downloadObjectEntityForIntake(
    objectPath: string,
    maxBytes: number,
  ): Promise<ObjectEntityIntake>;
  promoteStagedUploadToDocument(
    objectPath: string,
    documentId: string,
    inspectedBytes: Buffer,
    contentType: string | null,
  ): Promise<string>;
  quarantineObjectEntity(
    objectPath: string,
    inspectedBytes: Buffer,
    contentType: string | null,
    requestedQuarantineId?: string,
  ): Promise<string>;
  deleteObjectEntity(objectPath: string): Promise<boolean>;
}

export interface ClientUploadInspector {
  (
    input: Parameters<typeof inspectDocumentIntake>[0],
  ): ReturnType<typeof inspectDocumentIntake>;
}

export interface DrizzleClientUploadRepositoryOptions {
  objectStore?: ClientUploadObjectStore;
  inspect?: ClientUploadInspector;
  documentVersionId?: () => string;
}

interface ActiveUploadTarget {
  record: ClientEvidenceRequestRecord;
  slot: ClientEvidenceSlot;
  attempt: ClientEvidenceAttempt;
}

function fail(
  code: ConstructorParameters<typeof GovernedClientUploadError>[0],
  message: string,
  details?: Readonly<Record<string, unknown>>,
): never {
  throw new GovernedClientUploadError(code, message, details);
}

function deterministicLeaseId(
  organisationId: string,
  idempotencyKeySha256: string,
): string {
  const bytes = createHash("sha256")
    .update(
      `${CLIENT_UPLOAD_LEASE_SCHEMA}\0${organisationId}\0${idempotencyKeySha256}`,
      "utf8",
    )
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const clientUploadLeaseId = deterministicLeaseId;

function databaseInstant(result: {
  rows: Array<Record<string, unknown>>;
}): Date {
  const now = parseInstantViaString(result.rows[0]?.now);
  if (now === null) {
    fail("unavailable", "Database time is unavailable.");
  }
  return now;
}

function clientActionScope(
  scope: GovernedClientUploadScope,
): ClientActionScope {
  return {
    organisationId: scope.organisationId,
    projectId: scope.projectId,
    actorUserId: scope.actor.id,
  };
}

function assertRepositoryScope(scope: GovernedClientUploadScope): void {
  if (
    !UUID.test(scope.organisationId) ||
    !UUID.test(scope.projectId) ||
    !UUID.test(scope.actor.id) ||
    currentTenantDatabaseOrganisation() !== scope.organisationId ||
    scope.accessContext.organisationId !== scope.organisationId ||
    scope.accessContext.membershipOrganisationId !== scope.organisationId ||
    scope.accessContext.source !== "membership" ||
    !scope.accessContext.membershipId
  ) {
    fail("scope_denied", "Client upload scope denied.");
  }
}

async function lockAuthorityAndProject(
  scope: GovernedClientUploadScope,
): Promise<Date> {
  assertRepositoryScope(scope);
  // Project -> membership is the repository-wide advisory-lock order. The
  // normal route middleware already holds this project lock, so this call is
  // reentrant there and also keeps any future direct caller safe.
  await db.execute(
    sql`SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(${scope.projectId}, 0))`,
  );
  // Re-derive current permissions from durable grants under the shared
  // membership-administration lock before taking narrower upload locks.
  const authority = await resolveCurrentDirectAuthority(
    scope.accessContext,
    scope.actor.id,
  );
  if (
    !authority ||
    authority.organisationId !== scope.organisationId ||
    !authority.permissions.has("document:upload")
  ) {
    fail("scope_denied", "Current direct document-upload authority denied.");
  }
  await db.execute(sql`
    SELECT pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        ${`${scope.organisationId}:${scope.projectId}:client-actions`},
        0
      )
    )
  `);
  const projectRows = await db
    .select({
      id: projects.id,
      clientId: projects.clientId,
      conflictStatus: projects.conflictStatus,
      status: projects.status,
    })
    .from(projects)
    .where(
      and(
        eq(projects.id, scope.projectId),
        eq(projects.organisationId, scope.organisationId),
      ),
    )
    .limit(2)
    .for("update");
  if (projectRows.length !== 1) {
    fail("not_found", "The pursuit was not found.");
  }
  const project = projectRows[0]!;
  if (isProjectContentImmutable(project.status)) {
    fail(
      "conflict",
      "Released pursuit content is immutable; use the governed reopen workflow.",
    );
  }
  const clientRows = await db
    .select({ ndaStatus: clients.ndaStatus })
    .from(clients)
    .where(
      and(
        eq(clients.id, project.clientId),
        eq(clients.organisationId, scope.organisationId),
      ),
    )
    .limit(2)
    .for("share");
  if (clientRows.length !== 1 || !NDA_ALLOWED.has(clientRows[0]!.ndaStatus)) {
    fail(
      "conflict",
      "Client NDA clearance is required before governed upload intake.",
    );
  }
  if (
    project.conflictStatus === "blocked" ||
    project.conflictStatus === "declined"
  ) {
    fail(
      "conflict",
      "Conflict clearance is required before governed upload intake.",
    );
  }
  return databaseInstant(
    await db.execute(sql`SELECT pg_catalog.clock_timestamp() AS now`),
  );
}

async function loadTargetForWrite(
  scope: GovernedClientUploadScope,
  command: IssueClientUploadLeaseCommand,
): Promise<ActiveUploadTarget> {
  const rows = await db
    .select({
      id: workTasks.id,
      description: workTasks.description,
      version: workTasks.version,
    })
    .from(workTasks)
    .where(
      and(
        eq(workTasks.id, command.recordId),
        eq(workTasks.organisationId, scope.organisationId),
        eq(workTasks.projectId, scope.projectId),
      ),
    )
    .limit(2)
    .for("update");
  if (rows.length !== 1) {
    fail("not_found", "The client evidence request was not found.");
  }
  let record;
  try {
    record = parsePersistedClientActionEnvelope(
      rows[0]!.description,
      clientActionScope(scope),
      rows[0]!.id,
      rows[0]!.version,
    );
  } catch {
    fail("conflict", "The client evidence request is not safely readable.");
  }
  if (record.kind !== "evidence_request") {
    fail("not_found", "The client evidence request was not found.");
  }
  if (
    record.recipientUserId !== scope.actor.id ||
    record.requestAcknowledgement?.acknowledgedByUserId !== scope.actor.id
  ) {
    fail("scope_denied", "Only the named current recipient may upload.");
  }
  const slot = record.slots.find(
    (candidate) => candidate.id === command.slotId,
  );
  const attempts =
    slot?.attempts.filter(
      (candidate) => candidate.intent.id === command.intentId,
    ) ?? [];
  const attempt = attempts[0];
  if (!slot || attempts.length !== 1 || !attempt) {
    fail("conflict", "The request-slot intent is missing or ambiguous.");
  }
  if (attempt.intent.recordedByUserId !== scope.actor.id) {
    fail("conflict", "The upload intent actor binding is invalid.");
  }
  if (
    !ACCEPTED_CLIENT_UPLOAD_MIME.has(attempt.intent.contentType) ||
    (slot.acceptedContentTypes.length > 0 &&
      !slot.acceptedContentTypes.includes(attempt.intent.contentType)) ||
    attempt.intent.sizeBytes >
      STORAGE_LIFECYCLE_BOUNDS.uploadLeaseMaximumBytes ||
    !SHA256.test(attempt.intent.declaredSha256) ||
    attempt.intent.filename.includes("/") ||
    attempt.intent.filename.includes("\\") ||
    /[\u0000-\u001f\u007f\ud800-\udfff]/u.test(attempt.intent.filename)
  ) {
    fail("conflict", "The upload intent is outside governed intake policy.");
  }
  return { record, slot, attempt };
}

function assertActiveTarget(
  target: ActiveUploadTarget,
  command: IssueClientUploadLeaseCommand,
): void {
  if (
    target.slot.attempts.at(-1)?.id !== target.attempt.id ||
    target.attempt.document !== null ||
    target.attempt.review !== null
  ) {
    fail("conflict", "A latest unfinalized upload intent is required.");
  }
  if (target.record.version !== command.expectedRecordVersion) {
    fail("stale_version", "The client evidence request changed; reload it.");
  }
  if (target.record.status !== "in_progress") {
    fail("conflict", "The client request slot is not active for upload.");
  }
  if (target.attempt.intent.sizeBytes > getMaxUploadBytes()) {
    fail("conflict", "The upload intent exceeds current intake policy.");
  }
}

function parseLease(row: UploadSessionRow): ClientUploadLeaseEnvelope {
  try {
    const envelope = parseClientUploadLeaseEnvelope(row.idempotencyKey);
    if (
      deterministicLeaseId(
        row.organisationId,
        envelope.idempotencyKeySha256,
      ) !== row.id
    ) {
      fail("conflict", "The persisted upload lease identity is invalid.");
    }
    return envelope;
  } catch (error) {
    if (
      error instanceof StorageLifecycleContractError ||
      error instanceof GovernedClientUploadError
    ) {
      fail("conflict", "The persisted upload lease is not safely readable.");
    }
    throw error;
  }
}

function assertLeaseMatches(
  row: UploadSessionRow,
  scope: GovernedClientUploadScope,
  envelope: ClientUploadLeaseEnvelope,
  expected: ClientUploadLeaseEnvelope,
  target: ActiveUploadTarget,
): void {
  if (
    serializeClientUploadLeaseEnvelope(envelope) !==
      serializeClientUploadLeaseEnvelope(expected) ||
    row.organisationId !== scope.organisationId ||
    row.projectId !== scope.projectId ||
    row.filename !== target.attempt.intent.filename ||
    row.expectedBytes !== target.attempt.intent.sizeBytes ||
    row.expectedSha256 !== target.attempt.intent.declaredSha256
  ) {
    fail(
      "conflict",
      "The idempotency key is already bound to different upload material.",
    );
  }
}

function leaseGrant(input: {
  row: UploadSessionRow;
  envelope: ClientUploadLeaseEnvelope;
  target: ActiveUploadTarget;
  objectPath: string;
  uploadUrl: string;
  replayed: boolean;
}): ClientUploadLeaseGrant {
  return {
    leaseId: input.row.id,
    recordId: input.envelope.recordId,
    slotId: input.envelope.slotId,
    intentId: input.envelope.intentId,
    recordVersion: input.envelope.recordVersion,
    objectPath: input.objectPath,
    uploadUrl: input.uploadUrl,
    filename: input.target.attempt.intent.filename,
    contentType: input.envelope.contentType,
    sizeBytes: input.target.attempt.intent.sizeBytes,
    declaredSha256: input.target.attempt.intent.declaredSha256,
    expiresAt: input.row.expiresAt.toISOString(),
    replayed: input.replayed,
    lateRewriteClosure: STORAGE_LIFECYCLE_BOUNDS.lateRewriteClosure,
    rawFileAcceptedByApi: false,
    externalMessageSentByValo: false,
  };
}

function versionIntegrityManifest(input: {
  organisationId: string;
  documentId: string;
  objectPath: string;
  sha256: string;
  sizeBytes: number;
  detectedFormat: string;
  detectedMime: string;
  scannerProvider: string;
  scannerEngineVersion: string;
  scannerEvidence: string | null;
}): string {
  return JSON.stringify({
    schema: "valo.document-version-integrity/v1",
    versionNumber: 1,
    organisationId: input.organisationId,
    documentId: input.documentId,
    objectPath: input.objectPath,
    sha256: input.sha256,
    sizeBytes: input.sizeBytes,
    detectedFormat: input.detectedFormat,
    detectedMime: input.detectedMime,
    malwareStatus: "clean",
    quarantineStatus: "cleared",
    scanner: {
      provider: input.scannerProvider,
      engineVersion: input.scannerEngineVersion,
      evidenceSha256: input.scannerEvidence
        ? createHash("sha256")
            .update(input.scannerEvidence, "utf8")
            .digest("hex")
        : null,
    },
  });
}

function receipt(input: {
  row: UploadSessionRow;
  envelope: ClientUploadLeaseEnvelope;
  documentVersionId: string;
  filename: string;
  sha256: string;
  sizeBytes: number;
  detectedMime: string;
  replayed: boolean;
}): ClientUploadFinalizationReceipt {
  const material = {
    schema: "valo.client-action-upload-finalization/v1",
    leaseId: input.row.id,
    recordId: input.envelope.recordId,
    slotId: input.envelope.slotId,
    intentId: input.envelope.intentId,
    recordVersion: input.envelope.recordVersion + 1,
    documentId: input.row.id,
    documentVersionId: input.documentVersionId,
    filename: input.filename,
    sha256: input.sha256,
    sizeBytes: input.sizeBytes,
    detectedMime: input.detectedMime,
    extractionStarted: false,
    rawFileAcceptedByApi: false,
    externalMessageSentByValo: false,
  } as const;
  return {
    ...material,
    receiptSha256: storageLifecycleSha256(material),
    replayed: input.replayed,
  };
}

export class DrizzleGovernedClientUploadRepository implements GovernedClientUploadRepository {
  readonly #objectStore: ClientUploadObjectStore;
  readonly #inspect: ClientUploadInspector;
  readonly #documentVersionId: () => string;

  constructor(options: DrizzleClientUploadRepositoryOptions = {}) {
    this.#objectStore = options.objectStore ?? new ObjectStorageService();
    this.#inspect = options.inspect ?? inspectDocumentIntake;
    this.#documentVersionId = options.documentVersionId ?? randomUUID;
  }

  async issueLease(
    scope: GovernedClientUploadScope,
    command: IssueClientUploadLeaseCommand,
  ): Promise<ClientUploadLeaseGrant> {
    const now = await lockAuthorityAndProject(scope);
    const target = await loadTargetForWrite(scope, command);
    assertActiveTarget(target, command);
    const envelope = createClientUploadLeaseEnvelope({
      idempotencyKey: command.idempotencyKey,
      actorUserId: scope.actor.id,
      recordId: command.recordId,
      recordVersion: command.expectedRecordVersion,
      slotId: command.slotId,
      intentId: command.intentId,
      contentType: target.attempt.intent.contentType,
    });
    const leaseId = deterministicLeaseId(
      scope.organisationId,
      envelope.idempotencyKeySha256,
    );
    const objectPath = clientUploadObjectPath(scope.organisationId, leaseId);
    await lockStagedUploadObject(objectPath);
    const references = await storagePathReferenceKinds(objectPath, {
      excludeUploadSessionId: leaseId,
    });
    if (references.length > 0) {
      fail("conflict", "The deterministic upload path is already referenced.");
    }

    const existingRows = await db
      .select()
      .from(uploadSessions)
      .where(
        and(
          eq(uploadSessions.id, leaseId),
          eq(uploadSessions.organisationId, scope.organisationId),
        ),
      )
      .limit(2)
      .for("update");
    if (existingRows.length > 1) {
      fail("conflict", "The upload lease identity is ambiguous.");
    }
    const existing = existingRows[0];
    if (existing) {
      const storedEnvelope = parseLease(existing);
      assertLeaseMatches(existing, scope, storedEnvelope, envelope, target);
      if (existing.status !== "open") {
        fail("conflict", "The upload lease is no longer open.");
      }
      if (existing.expiresAt.valueOf() <= now.valueOf()) {
        fail("expired", "The upload lease expired; request a new lease.");
      }
      const signedNotAfter = new Date(
        existing.expiresAt.valueOf() -
          STORAGE_LIFECYCLE_BOUNDS.uploadSignedUrlLeaseCushionSeconds * 1_000,
      );
      const ttl = Math.min(
        STORAGE_LIFECYCLE_BOUNDS.uploadSignedUrlMaximumSeconds,
        Math.floor((signedNotAfter.valueOf() - now.valueOf()) / 1_000),
      );
      if (ttl < 1) {
        fail(
          "conflict",
          "The signed upload window is closed; finalize uploaded material before the lease expires.",
        );
      }
      const uploadUrl = await this.#objectStore.getObjectEntityUploadURL(
        scope.organisationId,
        leaseId,
        ttl,
        signedNotAfter,
      );
      return leaseGrant({
        row: existing,
        envelope,
        target,
        objectPath,
        uploadUrl,
        replayed: true,
      });
    }

    const activeRows = await db
      .select()
      .from(uploadSessions)
      .where(
        and(
          eq(uploadSessions.organisationId, scope.organisationId),
          eq(uploadSessions.projectId, scope.projectId),
          eq(uploadSessions.status, "open"),
          gt(uploadSessions.expiresAt, now),
        ),
      )
      .orderBy(asc(uploadSessions.expiresAt), asc(uploadSessions.id))
      .limit(STORAGE_LIFECYCLE_BOUNDS.activeUploadLeasesPerProject + 1);
    if (
      activeRows.length >= STORAGE_LIFECYCLE_BOUNDS.activeUploadLeasesPerProject
    ) {
      fail("capacity_exceeded", "The active upload-lease bound was reached.");
    }
    if (
      activeRows.some((row) => {
        const active = parseLease(row);
        return (
          active.recordId === command.recordId &&
          active.slotId === command.slotId &&
          active.intentId === command.intentId
        );
      })
    ) {
      fail(
        "conflict",
        "This request-slot intent already has a current upload lease.",
      );
    }

    const expiresAt = new Date(
      now.valueOf() + STORAGE_LIFECYCLE_BOUNDS.uploadLeaseMinutes * 60_000,
    );
    const inserted = await db
      .insert(uploadSessions)
      .values({
        id: leaseId,
        organisationId: scope.organisationId,
        projectId: scope.projectId,
        filename: target.attempt.intent.filename,
        expectedBytes: target.attempt.intent.sizeBytes,
        receivedBytes: 0,
        expectedSha256: target.attempt.intent.declaredSha256,
        idempotencyKey: serializeClientUploadLeaseEnvelope(envelope),
        status: "open",
        expiresAt,
        version: 1,
      })
      .onConflictDoNothing({ target: uploadSessions.id })
      .returning();
    if (inserted.length !== 1) {
      fail("conflict", "The upload lease changed while it was issued.");
    }
    const uploadUrl = await this.#objectStore.getObjectEntityUploadURL(
      scope.organisationId,
      leaseId,
      STORAGE_LIFECYCLE_BOUNDS.uploadSignedUrlMaximumSeconds,
      new Date(
        expiresAt.valueOf() -
          STORAGE_LIFECYCLE_BOUNDS.uploadSignedUrlLeaseCushionSeconds * 1_000,
      ),
    );
    await db.transaction((tx) =>
      writeAuditTx(tx, {
        user: scope.actor,
        organisationId: scope.organisationId,
        projectId: scope.projectId,
        eventType: "client_action.upload_lease_issued",
        objectType: "upload_session",
        objectId: leaseId,
        details: JSON.stringify({
          schema: CLIENT_UPLOAD_LEASE_SCHEMA,
          recordId: command.recordId,
          slotId: command.slotId,
          intentId: command.intentId,
          recordVersion: command.expectedRecordVersion,
          expiresAt: expiresAt.toISOString(),
          signedUrlMaximumSeconds:
            STORAGE_LIFECYCLE_BOUNDS.uploadSignedUrlMaximumSeconds,
          signedUrlLeaseCushionSeconds:
            STORAGE_LIFECYCLE_BOUNDS.uploadSignedUrlLeaseCushionSeconds,
          lateRewriteClosure: STORAGE_LIFECYCLE_BOUNDS.lateRewriteClosure,
          rawFileAcceptedByApi: false,
          externalMessageSentByValo: false,
        }),
      }),
    );
    return leaseGrant({
      row: inserted[0]!,
      envelope,
      target,
      objectPath,
      uploadUrl,
      replayed: false,
    });
  }

  async finalize(
    scope: GovernedClientUploadScope,
    command: FinalizeClientUploadCommand,
  ): Promise<ClientUploadFinalizationReceipt> {
    const now = await lockAuthorityAndProject(scope);
    const target = await loadTargetForWrite(scope, command);
    const expectedEnvelope = createClientUploadLeaseEnvelope({
      idempotencyKey: command.idempotencyKey,
      actorUserId: scope.actor.id,
      recordId: command.recordId,
      recordVersion: command.expectedRecordVersion,
      slotId: command.slotId,
      intentId: command.intentId,
      contentType: target.attempt.intent.contentType,
    });
    const expectedLeaseId = deterministicLeaseId(
      scope.organisationId,
      expectedEnvelope.idempotencyKeySha256,
    );
    if (expectedLeaseId !== command.leaseId) {
      fail("conflict", "The idempotency key does not identify this lease.");
    }
    const objectPath = clientUploadObjectPath(
      scope.organisationId,
      expectedLeaseId,
    );
    await lockStagedUploadObject(objectPath);
    const leaseRows = await db
      .select()
      .from(uploadSessions)
      .where(
        and(
          eq(uploadSessions.id, command.leaseId),
          eq(uploadSessions.organisationId, scope.organisationId),
          eq(uploadSessions.projectId, scope.projectId),
        ),
      )
      .limit(2)
      .for("update");
    if (leaseRows.length !== 1) {
      fail("not_found", "The governed upload lease was not found.");
    }
    const session = leaseRows[0]!;
    const envelope = parseLease(session);
    const completedReplay =
      session.status === "completed" ||
      session.status === "completed_cleanup_queued";
    if (
      envelope.idempotencyKeySha256 !== expectedEnvelope.idempotencyKeySha256 ||
      envelope.actorUserId !== scope.actor.id ||
      envelope.recordId !== command.recordId ||
      envelope.recordVersion !== command.expectedRecordVersion ||
      envelope.slotId !== command.slotId ||
      envelope.intentId !== command.intentId
    ) {
      fail("conflict", "The upload lease binding does not match this command.");
    }
    assertLeaseMatches(session, scope, envelope, expectedEnvelope, target);

    if (completedReplay) {
      return this.#completedReplay(scope, session, envelope, target);
    }
    assertActiveTarget(target, command);
    if (session.status !== "open") {
      fail("conflict", "The upload lease is no longer open.", {
        leaseStatus: session.status,
      });
    }
    if (session.expiresAt.valueOf() <= now.valueOf()) {
      fail("expired", "The upload lease expired before finalization.");
    }
    if (session.receivedBytes !== 0) {
      fail("conflict", "The open upload lease has an invalid byte state.");
    }
    const references = await storagePathReferenceKinds(objectPath, {
      excludeUploadSessionId: session.id,
    });
    if (references.length > 0) {
      fail("conflict", "The staged upload path is already referenced.", {
        references,
      });
    }

    let intake: ObjectEntityIntake;
    try {
      intake = await this.#objectStore.downloadObjectEntityForIntake(
        objectPath,
        Math.min(
          STORAGE_LIFECYCLE_BOUNDS.uploadLeaseMaximumBytes,
          getMaxUploadBytes(),
        ),
      );
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        await this.#recordFailedIntake(scope, session, now, {
          status: "rejected",
          reason: "staged_object_missing",
          receivedBytes: 0,
          cleanupConfirmed: true,
        });
        fail("intake_rejected", "The staged upload is missing.");
      }
      if (error instanceof ObjectTooLargeError) {
        await this.#disposeAndReject(
          scope,
          session,
          objectPath,
          now,
          null,
          "size_limit_exceeded",
          error.observedBytes,
        );
      }
      throw error;
    }
    const measuredSha256 = createHash("sha256")
      .update(intake.bytes)
      .digest("hex");
    const exactMetadata =
      intake.bytes.length === session.expectedBytes &&
      intake.metadataSizeBytes === session.expectedBytes &&
      measuredSha256 === session.expectedSha256 &&
      intake.contentType === envelope.contentType;
    if (!exactMetadata) {
      await this.#disposeAndReject(
        scope,
        session,
        objectPath,
        now,
        intake,
        "lease_material_mismatch",
        intake.bytes.length,
      );
    }

    await lockCanonicalEvidenceDigest(scope.organisationId, measuredSha256);
    const knownTenantHashes = (
      await db
        .select({ sha256: documents.sha256 })
        .from(documents)
        .where(
          and(
            eq(documents.organisationId, scope.organisationId),
            eq(documents.sha256, measuredSha256),
          ),
        )
        .limit(1)
    )
      .map(({ sha256 }) => sha256)
      .filter((value): value is string => Boolean(value));
    const inspection = await this.#inspect({
      tenantId: scope.organisationId,
      filename: session.filename,
      declaredMime: envelope.contentType,
      bytes: intake.bytes,
      idempotencyKey: envelope.idempotencyKeySha256,
      knownTenantHashes,
    });
    const providerIssues =
      process.env.NODE_ENV === "production"
        ? productionFeatureIssues("document_intake")
        : [];
    const detectedMime = canonicalMimeForDetectedFormat(
      inspection.detectedFormat,
    );
    if (
      !inspection.mayProcess ||
      inspection.disposition !== "ready" ||
      providerIssues.length > 0 ||
      inspection.malware.state !== "clean" ||
      !inspection.malware.provider ||
      !inspection.malware.engineVersion ||
      !detectedMime
    ) {
      await this.#disposeAndReject(
        scope,
        session,
        objectPath,
        now,
        intake,
        providerIssues.length > 0
          ? "secure_intake_provider_unavailable"
          : `secure_intake_${inspection.disposition}`,
        intake.bytes.length,
        inspection.disposition === "quarantined" || providerIssues.length > 0,
        inspection.findings.map(({ code }) => code),
      );
    }

    // The rejection branch above is async, so TypeScript does not retain its
    // null narrowing even though #disposeAndReject never returns.
    const governedDetectedMime = detectedMime;
    const scannerProvider = inspection.malware.provider;
    const scannerEngineVersion = inspection.malware.engineVersion;
    if (!governedDetectedMime || !scannerProvider || !scannerEngineVersion) {
      fail("unavailable", "Secure intake metadata is incomplete.");
    }

    const documentVersionId = this.#documentVersionId();
    if (!UUID.test(documentVersionId)) {
      fail("unavailable", "Document version identity generation failed.");
    }
    const finalPath = clientUploadDocumentPath(
      scope.organisationId,
      session.id,
    );
    let promotedPath: string | null = null;
    try {
      promotedPath = await this.#objectStore.promoteStagedUploadToDocument(
        objectPath,
        session.id,
        intake.bytes,
        governedDetectedMime,
      );
      if (promotedPath !== finalPath) {
        throw new Error("Storage promotion returned an unexpected path");
      }
      const result = await db.transaction(async (tx) => {
        const [document] = await tx
          .insert(documents)
          .values({
            id: session.id,
            organisationId: scope.organisationId,
            projectId: scope.projectId,
            type: "other",
            filename: session.filename,
            objectPath: finalPath,
            contentType: envelope.contentType,
            size: intake.bytes.length,
            sha256: measuredSha256,
            source: "client_action_upload",
            dateReceived: now.toISOString(),
            redactionStatus: "excluded",
            uploadedBy: scope.actor.id,
            ...initialExtractionState("excluded"),
          })
          .returning({ id: documents.id });
        if (!document) throw new Error("Document registration failed");
        const [version] = await tx
          .insert(documentVersions)
          .values({
            id: documentVersionId,
            organisationId: scope.organisationId,
            documentId: session.id,
            versionNumber: 1,
            objectPath: finalPath,
            sha256: measuredSha256,
            detectedMime: governedDetectedMime,
            detectedFormat: inspection.detectedFormat,
            sizeBytes: intake.bytes.length,
            malwareStatus: "clean",
            quarantineStatus: "cleared",
            integrityManifest: versionIntegrityManifest({
              organisationId: scope.organisationId,
              documentId: session.id,
              objectPath: finalPath,
              sha256: measuredSha256,
              sizeBytes: intake.bytes.length,
              detectedFormat: inspection.detectedFormat,
              detectedMime: governedDetectedMime,
              scannerProvider,
              scannerEngineVersion,
              scannerEvidence: inspection.malware.evidence,
            }),
            uploadedBy: scope.actor.id,
          })
          .returning({ id: documentVersions.id });
        if (!version) throw new Error("Document version registration failed");

        const stamp = now.toISOString();
        const attempts = target.slot.attempts.map((attempt) =>
          attempt.id === target.attempt.id
            ? {
                ...attempt,
                document: {
                  documentId: session.id,
                  sha256: measuredSha256,
                  attachedByUserId: scope.actor.id,
                  attachedAt: stamp,
                },
              }
            : attempt,
        );
        const slots = target.record.slots.map((slot) =>
          slot.id === target.slot.id ? { ...slot, attempts } : slot,
        );
        const nextRecord: ClientEvidenceRequestRecord = {
          ...target.record,
          version: target.record.version + 1,
          updatedByUserId: scope.actor.id,
          updatedAt: stamp,
          slots,
          status: deriveClientEvidenceRequestStatus(slots),
        };
        const updatedRecord = await tx
          .update(workTasks)
          .set({
            title: persistedClientActionTitle(nextRecord),
            description: serializePersistedClientActionEnvelope(nextRecord),
            status: nextRecord.status,
            version: nextRecord.version,
            updatedAt: now,
          })
          .where(
            and(
              eq(workTasks.id, target.record.id),
              eq(workTasks.organisationId, scope.organisationId),
              eq(workTasks.projectId, scope.projectId),
              eq(workTasks.version, target.record.version),
            ),
          )
          .returning({ id: workTasks.id });
        if (updatedRecord.length !== 1) {
          throw new Error("Client action compare-and-set failed");
        }
        const updatedLease = await tx
          .update(uploadSessions)
          .set({
            status: "completed",
            receivedBytes: intake.bytes.length,
            version: session.version + 1,
            updatedAt: now,
          })
          .where(
            and(
              eq(uploadSessions.id, session.id),
              eq(uploadSessions.organisationId, scope.organisationId),
              eq(uploadSessions.status, "open"),
              eq(uploadSessions.version, session.version),
            ),
          )
          .returning({ id: uploadSessions.id });
        if (updatedLease.length !== 1) {
          throw new Error("Upload lease compare-and-set failed");
        }
        const finalReceipt = receipt({
          row: session,
          envelope,
          documentVersionId: version.id,
          filename: session.filename,
          sha256: measuredSha256,
          sizeBytes: intake.bytes.length,
          detectedMime: governedDetectedMime,
          replayed: false,
        });
        await writeAuditTx(tx, {
          user: scope.actor,
          organisationId: scope.organisationId,
          projectId: scope.projectId,
          eventType: "client_action.upload_finalized",
          objectType: "document",
          objectId: session.id,
          details: JSON.stringify({
            schema: "valo.client-action-upload-finalization/v1",
            leaseId: session.id,
            recordId: envelope.recordId,
            slotId: envelope.slotId,
            intentId: envelope.intentId,
            recordVersion: envelope.recordVersion + 1,
            sha256: measuredSha256,
            sizeBytes: intake.bytes.length,
            detectedMime: governedDetectedMime,
            receiptSha256: finalReceipt.receiptSha256,
            extractionStarted: false,
            rawFileAcceptedByApi: false,
            externalMessageSentByValo: false,
          }),
        });
        return finalReceipt;
      });
      return result;
    } catch (error) {
      const cleanupPath =
        error instanceof ObjectPromotionCleanupError
          ? error.destinationPath
          : promotedPath;
      if (cleanupPath) {
        try {
          await this.#objectStore.deleteObjectEntity(cleanupPath);
        } catch (cleanupError) {
          await this.#recordFailedIntake(scope, session, now, {
            status: "cleanup_unconfirmed",
            reason: "promoted_copy_cleanup_unconfirmed",
            receivedBytes: intake.bytes.length,
            cleanupConfirmed: false,
          });
          fail(
            "cleanup_unconfirmed",
            "Document registration failed and promoted-copy cleanup is unconfirmed.",
          );
        }
      }
      if (error instanceof GovernedClientUploadError) throw error;
      fail(
        "conflict",
        "Secure document finalization failed without registering a document.",
      );
    }
  }

  async #recordFailedIntake(
    scope: GovernedClientUploadScope,
    session: UploadSessionRow,
    now: Date,
    input: {
      status: string;
      reason: string;
      receivedBytes: number;
      cleanupConfirmed: boolean;
      findings?: readonly string[];
      quarantinedPath?: string | null;
    },
  ): Promise<void> {
    await db.transaction(async (tx) => {
      const updated = await tx
        .update(uploadSessions)
        .set({
          status: input.status,
          receivedBytes: input.receivedBytes,
          version: session.version + 1,
          updatedAt: now,
        })
        .where(
          and(
            eq(uploadSessions.id, session.id),
            eq(uploadSessions.organisationId, scope.organisationId),
            eq(uploadSessions.status, "open"),
            eq(uploadSessions.version, session.version),
          ),
        )
        .returning({ id: uploadSessions.id });
      if (updated.length !== 1) {
        fail("stale_version", "The upload lease changed during disposition.");
      }
      await writeAuditTx(tx, {
        user: scope.actor,
        organisationId: scope.organisationId,
        projectId: scope.projectId,
        eventType: "client_action.upload_intake_denied",
        objectType: "upload_session",
        objectId: session.id,
        details: JSON.stringify({
          leaseId: session.id,
          reason: input.reason,
          receivedBytes: input.receivedBytes,
          cleanupConfirmed: input.cleanupConfirmed,
          findings: input.findings ?? [],
          quarantinedPath: input.quarantinedPath ?? null,
          documentCreated: false,
          rawFileAcceptedByApi: false,
          externalMessageSentByValo: false,
        }),
      });
    });
  }

  async #disposeAndReject(
    scope: GovernedClientUploadScope,
    session: UploadSessionRow,
    objectPath: string,
    now: Date,
    intake: ObjectEntityIntake | null,
    reason: string,
    receivedBytes: number,
    quarantine = false,
    findings: readonly string[] = [],
  ): Promise<never> {
    try {
      let quarantinedPath: string | null = null;
      if (quarantine && intake) {
        quarantinedPath = await this.#objectStore.quarantineObjectEntity(
          objectPath,
          intake.bytes,
          intake.contentType,
          session.id,
        );
      } else {
        await this.#objectStore.deleteObjectEntity(objectPath);
      }
      await this.#recordFailedIntake(scope, session, now, {
        status: quarantine ? "quarantined" : "rejected",
        reason,
        receivedBytes,
        cleanupConfirmed: true,
        findings,
        quarantinedPath,
      });
      fail(
        "intake_rejected",
        quarantine
          ? "The upload did not pass secure intake and was quarantined."
          : "The upload did not match its governed lease and was rejected.",
        { findings, cleanupConfirmed: true },
      );
    } catch (error) {
      if (error instanceof GovernedClientUploadError) throw error;
      const partial =
        error instanceof ObjectQuarantinePartialMoveError
          ? {
              quarantinedPath: error.quarantineCopyConfirmed
                ? error.quarantinePath
                : null,
              possibleQuarantinedPath: error.quarantineCopyConfirmed
                ? null
                : error.quarantinePath,
              quarantineCopyConfirmed: error.quarantineCopyConfirmed,
            }
          : {};
      await this.#recordFailedIntake(scope, session, now, {
        status: "cleanup_unconfirmed",
        reason: `${reason}_cleanup_unconfirmed`,
        receivedBytes,
        cleanupConfirmed: false,
        findings,
        quarantinedPath:
          error instanceof ObjectQuarantinePartialMoveError &&
          error.quarantineCopyConfirmed
            ? error.quarantinePath
            : null,
      });
      fail(
        "cleanup_unconfirmed",
        "The upload was rejected, but its storage disposition is unconfirmed.",
        { findings, cleanupConfirmed: false, ...partial },
      );
    }
  }

  async #completedReplay(
    scope: GovernedClientUploadScope,
    session: UploadSessionRow,
    envelope: ClientUploadLeaseEnvelope,
    target: ActiveUploadTarget,
  ): Promise<ClientUploadFinalizationReceipt> {
    const attachedAttempt = target.slot.attempts.find(
      (attempt) => attempt.intent.id === envelope.intentId,
    );
    const rows = await db
      .select({
        documentId: documents.id,
        filename: documents.filename,
        sha256: documents.sha256,
        sizeBytes: documents.size,
        contentType: documents.contentType,
        objectPath: documents.objectPath,
        versionId: documentVersions.id,
        detectedMime: documentVersions.detectedMime,
        versionSha256: documentVersions.sha256,
        versionSizeBytes: documentVersions.sizeBytes,
        versionObjectPath: documentVersions.objectPath,
      })
      .from(documents)
      .innerJoin(
        documentVersions,
        and(
          eq(documentVersions.documentId, documents.id),
          eq(documentVersions.versionNumber, 1),
        ),
      )
      .where(
        and(
          eq(documents.id, session.id),
          eq(documents.organisationId, scope.organisationId),
          eq(documents.projectId, scope.projectId),
        ),
      )
      .limit(2);
    const row = rows[0];
    const expectedPath = clientUploadDocumentPath(
      scope.organisationId,
      session.id,
    );
    if (
      rows.length !== 1 ||
      !row ||
      !row.sha256 ||
      row.sizeBytes === null ||
      row.documentId !== session.id ||
      row.sha256 !== session.expectedSha256 ||
      row.versionSha256 !== row.sha256 ||
      row.versionSizeBytes !== row.sizeBytes ||
      row.objectPath !== expectedPath ||
      row.versionObjectPath !== expectedPath ||
      row.contentType !== envelope.contentType ||
      attachedAttempt?.document?.documentId !== session.id ||
      attachedAttempt.document.sha256 !== row.sha256 ||
      session.receivedBytes !== row.sizeBytes
    ) {
      fail("conflict", "The completed upload receipt failed integrity checks.");
    }
    return receipt({
      row: session,
      envelope,
      documentVersionId: row.versionId,
      filename: row.filename,
      sha256: row.sha256,
      sizeBytes: row.sizeBytes,
      detectedMime: row.detectedMime,
      replayed: true,
    });
  }
}
