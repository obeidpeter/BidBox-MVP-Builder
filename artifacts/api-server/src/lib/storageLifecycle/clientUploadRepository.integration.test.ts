import "../../test-env";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import {
  auditEvents,
  clients,
  db,
  documents,
  documentVersions,
  notificationEvents,
  organisationMemberships,
  organisations,
  projects,
  roleGrants,
  uploadSessions,
  users,
  withTenantDatabase,
  workTasks,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import type { AccessContext } from "../accessContext";
import type { ClientEvidenceRequestRecord } from "../clientActionPortal/contracts";
import {
  parsePersistedClientActionEnvelope,
  persistedClientActionTitle,
  serializePersistedClientActionEnvelope,
} from "../clientActionPortal/drizzleRepository";
import { permissionsForRoles } from "../permissions";
import {
  DrizzleGovernedClientUploadRepository,
  clientUploadLeaseId,
  type ClientUploadInspector,
  type ClientUploadObjectStore,
} from "./clientUploadRepository";
import {
  GovernedClientUploadError,
  type GovernedClientUploadScope,
} from "./clientUpload";
import {
  STORAGE_LIFECYCLE_BOUNDS,
  clientUploadDocumentPath,
  clientUploadObjectPath,
  clientUploadQuarantinePath,
  createClientUploadLeaseEnvelope,
  parseStorageDeletionIntent,
  serializeClientUploadLeaseEnvelope,
} from "./contracts";
import { sweepExpiredClientUploadLeases } from "./repository";

const MAIN_VERSION_ID = "00000000-0000-4000-8000-000000009001";
const COLLISION_VERSION_ID = "00000000-0000-4000-8000-000000009002";
const MAIN_KEY = "client-upload-integration-main-0001";
const EXPIRY_KEY = "client-upload-integration-expiry-0003";
const MAIN_BYTES = Buffer.from("%PDF-1.4\n% governed main fixture\n%%EOF\n");
const ROLLBACK_BYTES = Buffer.from(
  "%PDF-1.4\n% governed rollback fixture\n%%EOF\n",
);
const EXPIRY_BYTES = Buffer.from(
  "%PDF-1.4\n% governed expiry fixture\n%%EOF\n",
);

let organisationId: string;
let clientId: string;
let projectId: string;
let recipientMembershipId: string;
let recipientRoleGrantId: string;
let recipientUser: typeof users.$inferSelect;
let creatorUserId: string;
let collisionDocumentId: string;
let mainTarget: UploadTarget;
let rollbackTarget: UploadTarget;
let expiryTarget: UploadTarget;
let concurrentTarget: UploadTarget;
let ambiguousTarget: UploadTarget;
let authorityTarget: UploadTarget;
let secondOrganisationId: string;
let secondClientId: string;
let secondProjectId: string;
let secondTenantLeaseId: string;

interface UploadTarget {
  recordId: string;
  slotId: string;
  intentId: string;
  version: number;
  filename: string;
  bytes: Buffer;
  sha256: string;
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function evidenceRequest(target: UploadTarget): ClientEvidenceRequestRecord {
  const stamp = "2026-08-13T10:00:00.000Z";
  return {
    id: target.recordId,
    kind: "evidence_request",
    organisationId,
    projectId,
    version: target.version,
    createdByUserId: creatorUserId,
    createdAt: stamp,
    updatedByUserId: recipientUser.id,
    updatedAt: stamp,
    purpose: "tender_evidence",
    purposeStatement:
      "Provide the named evidence through the governed client upload lease.",
    recipientUserId: recipientUser.id,
    dueAt: null,
    status: "in_progress",
    requestAcknowledgement: {
      statement: "I acknowledge this evidence request.",
      acknowledgedByUserId: recipientUser.id,
      acknowledgedAt: stamp,
    },
    slots: [
      {
        id: target.slotId,
        label: "Named evidence file",
        required: true,
        acceptedContentTypes: ["application/pdf"],
        attempts: [
          {
            id: randomUUID(),
            intent: {
              id: target.intentId,
              filename: target.filename,
              contentType: "application/pdf",
              sizeBytes: target.bytes.length,
              declaredSha256: target.sha256,
              recordedByUserId: recipientUser.id,
              recordedAt: stamp,
            },
            document: null,
            review: null,
            correctionAcknowledgement: null,
          },
        ],
      },
    ],
    completionReceiptSha256: null,
    externalMessageSentByValo: false,
  };
}

function target(filename: string, bytes: Buffer): UploadTarget {
  return {
    recordId: randomUUID(),
    slotId: randomUUID(),
    intentId: randomUUID(),
    version: 3,
    filename,
    bytes,
    sha256: sha256(bytes),
  };
}

function scope(): GovernedClientUploadScope {
  const accessContext: AccessContext = {
    organisationId,
    membershipId: recipientMembershipId,
    membershipOrganisationId: organisationId,
    source: "membership",
    roles: ["contributor"],
    permissions: permissionsForRoles(["contributor"]),
    breakGlassSessionId: null,
    partnerRelationshipId: null,
    partnerCoSigningRequired: false,
  };
  return {
    organisationId,
    projectId,
    actor: recipientUser,
    accessContext,
  };
}

const cleanInspector: ClientUploadInspector = async (input) => ({
  disposition: "ready",
  detectedFormat: "pdf",
  sha256: sha256(Buffer.from(input.bytes)),
  findings: [],
  mayProcess: true,
  malware: {
    state: "clean",
    provider: "client-upload-integration-scanner",
    engineVersion: "1.0.0",
    evidence: "deterministic clean fixture",
  },
  archiveReason: null,
});

function fixtureObjectStore(
  bytes: Buffer,
  options: { deleteFailure?: Error } = {},
) {
  const signed: Array<{
    organisationId: string | undefined;
    objectId: string | undefined;
    ttl: number | undefined;
    notAfter: Date | undefined;
  }> = [];
  const promoted: string[] = [];
  const deleted: string[] = [];
  let downloads = 0;
  const objectStore: ClientUploadObjectStore = {
    async getObjectEntityUploadURL(
      requestedOrganisationId,
      objectId,
      ttl,
      notAfter,
    ) {
      signed.push({
        organisationId: requestedOrganisationId,
        objectId,
        ttl,
        notAfter,
      });
      return `https://storage.integration.invalid/${objectId}`;
    },
    async downloadObjectEntityForIntake() {
      downloads += 1;
      return {
        bytes: Buffer.from(bytes),
        contentType: "application/pdf",
        metadataSizeBytes: bytes.length,
      };
    },
    async promoteStagedUploadToDocument(_path, documentId) {
      const finalPath = clientUploadDocumentPath(organisationId, documentId);
      promoted.push(finalPath);
      return finalPath;
    },
    async quarantineObjectEntity(_path, _bytes, _contentType, quarantineId) {
      return `/objects/tenants/${organisationId}/quarantine/${quarantineId}`;
    },
    async deleteObjectEntity(path) {
      deleted.push(path);
      if (options.deleteFailure) throw options.deleteFailure;
      return true;
    },
  };
  return {
    objectStore,
    metrics: {
      signed,
      promoted,
      deleted,
      downloads: () => downloads,
    },
  };
}

function command(targetRecord: UploadTarget, idempotencyKey: string) {
  return {
    recordId: targetRecord.recordId,
    slotId: targetRecord.slotId,
    intentId: targetRecord.intentId,
    expectedRecordVersion: targetRecord.version,
    idempotencyKey,
  };
}

before(async () => {
  const stamp = randomUUID();
  const [creator, recipient] = await db
    .insert(users)
    .values([
      {
        clerkUserId: `client-upload-creator-${stamp}`,
        email: `creator-${stamp}@client-upload.integration`,
        name: "Client Upload Requester",
        role: "none",
        status: "active",
      },
      {
        clerkUserId: `client-upload-recipient-${stamp}`,
        email: `recipient-${stamp}@client-upload.integration`,
        name: "Named Client Recipient",
        role: "none",
        status: "active",
      },
    ])
    .returning();
  assert.ok(creator && recipient);
  creatorUserId = creator.id;
  recipientUser = recipient;
  const [organisation] = await db
    .insert(organisations)
    .values({
      name: `Client upload integration ${stamp}`,
      slug: `client-upload-integration-${stamp}`,
      type: "client",
      status: "active",
      createdBy: creator.id,
    })
    .returning();
  assert.ok(organisation);
  organisationId = organisation.id;
  const [membership] = await db
    .insert(organisationMemberships)
    .values({
      organisationId,
      userId: recipient.id,
      status: "active",
    })
    .returning();
  assert.ok(membership);
  recipientMembershipId = membership.id;
  const [roleGrant] = await db
    .insert(roleGrants)
    .values({
      membershipId: membership.id,
      role: "contributor",
    })
    .returning();
  assert.ok(roleGrant);
  recipientRoleGrantId = roleGrant.id;

  mainTarget = target("main-evidence.pdf", MAIN_BYTES);
  rollbackTarget = target("rollback-evidence.pdf", ROLLBACK_BYTES);
  expiryTarget = target("expiry-evidence.pdf", EXPIRY_BYTES);
  concurrentTarget = target("concurrent-evidence.pdf", MAIN_BYTES);
  ambiguousTarget = target("ambiguous-cleanup.pdf", ROLLBACK_BYTES);
  authorityTarget = target("revoked-authority.pdf", MAIN_BYTES);
  collisionDocumentId = randomUUID();

  await withTenantDatabase(organisationId, async () => {
    const [client] = await db
      .insert(clients)
      .values({
        organisationId,
        name: "Governed upload integration client",
        ndaStatus: "signed",
      })
      .returning();
    assert.ok(client);
    clientId = client.id;
    const [project] = await db
      .insert(projects)
      .values({
        organisationId,
        clientId,
        tenderTitle: "Governed client evidence upload",
        status: "extraction",
        conflictStatus: "clear",
      })
      .returning();
    assert.ok(project);
    projectId = project.id;
    for (const targetRecord of [
      mainTarget,
      rollbackTarget,
      expiryTarget,
      concurrentTarget,
      ambiguousTarget,
      authorityTarget,
    ]) {
      const record = evidenceRequest(targetRecord);
      await db.insert(workTasks).values({
        id: record.id,
        organisationId,
        projectId,
        title: persistedClientActionTitle(record),
        description: serializePersistedClientActionEnvelope(record),
        priority: "normal",
        status: record.status,
        version: record.version,
      });
    }
    await db.insert(documents).values({
      id: collisionDocumentId,
      organisationId,
      projectId,
      type: "other",
      filename: "collision-seed.pdf",
      objectPath: `/objects/tenants/${organisationId}/documents/${collisionDocumentId}`,
      contentType: "application/pdf",
      size: 1,
      sha256: "f".repeat(64),
      redactionStatus: "excluded",
      extractionStatus: "skipped",
    });
    await db.insert(documentVersions).values({
      id: COLLISION_VERSION_ID,
      organisationId,
      documentId: collisionDocumentId,
      versionNumber: 1,
      objectPath: `/objects/tenants/${organisationId}/documents/${collisionDocumentId}`,
      sha256: "f".repeat(64),
      detectedMime: "application/pdf",
      detectedFormat: "pdf",
      sizeBytes: 1,
      malwareStatus: "clean",
      quarantineStatus: "cleared",
      integrityManifest: "client-upload-integration-collision",
    });
  });

  const [secondOrganisation] = await db
    .insert(organisations)
    .values({
      name: `Client upload RLS peer ${stamp}`,
      slug: `client-upload-rls-peer-${stamp}`,
      type: "client",
      status: "active",
    })
    .returning();
  assert.ok(secondOrganisation);
  secondOrganisationId = secondOrganisation.id;
  secondTenantLeaseId = randomUUID();
  await withTenantDatabase(secondOrganisationId, async () => {
    const [peerClient] = await db
      .insert(clients)
      .values({
        organisationId: secondOrganisationId,
        name: "Governed upload RLS peer client",
        ndaStatus: "signed",
      })
      .returning();
    assert.ok(peerClient);
    secondClientId = peerClient.id;
    const [peerProject] = await db
      .insert(projects)
      .values({
        organisationId: secondOrganisationId,
        clientId: secondClientId,
        tenderTitle: "Governed upload RLS peer pursuit",
        status: "extraction",
        conflictStatus: "clear",
      })
      .returning();
    assert.ok(peerProject);
    secondProjectId = peerProject.id;
    await db.insert(uploadSessions).values({
      id: secondTenantLeaseId,
      organisationId: secondOrganisationId,
      projectId: secondProjectId,
      filename: "peer.pdf",
      expectedBytes: 1,
      receivedBytes: 0,
      expectedSha256: "e".repeat(64),
      idempotencyKey: "peer-tenant-opaque-fixture",
      status: "open",
      expiresAt: new Date("2099-01-01T00:00:00.000Z"),
    });
  });
});

after(async () => {
  await withTenantDatabase(organisationId, async () => {
    await db.execute(
      sql`SELECT set_config('valo.audit_test_cleanup', 'approved', true)`,
    );
    await db
      .delete(auditEvents)
      .where(eq(auditEvents.organisationId, organisationId));
    await db
      .delete(notificationEvents)
      .where(eq(notificationEvents.organisationId, organisationId));
    await db.delete(projects).where(eq(projects.id, projectId));
    await db.delete(clients).where(eq(clients.id, clientId));
  });
  await db.delete(organisations).where(eq(organisations.id, organisationId));
  await withTenantDatabase(secondOrganisationId, async () => {
    await db.delete(projects).where(eq(projects.id, secondProjectId));
    await db.delete(clients).where(eq(clients.id, secondClientId));
  });
  await db
    .delete(organisations)
    .where(eq(organisations.id, secondOrganisationId));
  await db.delete(users).where(eq(users.id, recipientUser.id));
  await db.delete(users).where(eq(users.id, creatorUserId));
});

test("PostgreSQL lease finalization is atomic, replay-safe, rollback-safe and sweep-owned on expiry", async () => {
  const mainFixture = fixtureObjectStore(MAIN_BYTES);
  const mainRepository = new DrizzleGovernedClientUploadRepository({
    objectStore: mainFixture.objectStore,
    inspect: cleanInspector,
    documentVersionId: () => MAIN_VERSION_ID,
  });
  const mainLease = await withTenantDatabase(organisationId, () =>
    mainRepository.issueLease(scope(), command(mainTarget, MAIN_KEY)),
  );
  assert.equal(
    mainLease.lateRewriteClosure,
    "bounded-cushion-and-post-expiry-reconcile",
  );
  assert.equal(mainFixture.metrics.signed[0]?.ttl, 840);
  assert.equal(
    new Date(mainLease.expiresAt).valueOf() -
      (mainFixture.metrics.signed[0]?.notAfter?.valueOf() ?? 0),
    60_000,
  );

  const finalized = await withTenantDatabase(organisationId, () =>
    mainRepository.finalize(scope(), {
      ...command(mainTarget, MAIN_KEY),
      leaseId: mainLease.leaseId,
    }),
  );
  const replay = await withTenantDatabase(organisationId, () =>
    mainRepository.finalize(scope(), {
      ...command(mainTarget, MAIN_KEY),
      leaseId: mainLease.leaseId,
    }),
  );
  assert.equal(finalized.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(replay.receiptSha256, finalized.receiptSha256);
  assert.equal(mainFixture.metrics.downloads(), 1);
  assert.deepEqual(mainFixture.metrics.promoted, [
    clientUploadDocumentPath(organisationId, mainLease.leaseId),
  ]);

  await withTenantDatabase(organisationId, async () => {
    const [document] = await db
      .select()
      .from(documents)
      .where(eq(documents.id, mainLease.leaseId));
    const [version] = await db
      .select()
      .from(documentVersions)
      .where(eq(documentVersions.documentId, mainLease.leaseId));
    const [session] = await db
      .select()
      .from(uploadSessions)
      .where(eq(uploadSessions.id, mainLease.leaseId));
    const [task] = await db
      .select()
      .from(workTasks)
      .where(eq(workTasks.id, mainTarget.recordId));
    assert.ok(document && version && session && task);
    const record = parsePersistedClientActionEnvelope(
      task.description,
      {
        organisationId,
        projectId,
        actorUserId: recipientUser.id,
      },
      task.id,
      task.version,
    ) as ClientEvidenceRequestRecord;
    assert.equal(
      document.objectPath,
      clientUploadDocumentPath(organisationId, mainLease.leaseId),
    );
    assert.equal(document.extractionStatus, "skipped");
    assert.equal(version.id, MAIN_VERSION_ID);
    assert.equal(version.sha256, mainTarget.sha256);
    assert.equal(session.status, "completed");
    assert.equal(session.receivedBytes, MAIN_BYTES.length);
    assert.equal(record.version, mainTarget.version + 1);
    assert.equal(
      record.slots[0]?.attempts[0]?.document?.documentId,
      mainLease.leaseId,
    );
    const finalAudits = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organisationId, organisationId),
          eq(auditEvents.eventType, "client_action.upload_finalized"),
          eq(auditEvents.objectId, mainLease.leaseId),
        ),
      );
    assert.equal(finalAudits.length, 1);
    assert.equal(
      JSON.parse(finalAudits[0]!.details ?? "{}").receiptSha256,
      finalized.receiptSha256,
    );
  });

  const rollbackFixture = fixtureObjectStore(ROLLBACK_BYTES);
  const rollbackRepository = new DrizzleGovernedClientUploadRepository({
    objectStore: rollbackFixture.objectStore,
    inspect: cleanInspector,
    documentVersionId: () => COLLISION_VERSION_ID,
  });
  const rollbackKey = "client-upload-integration-rollback-0002";
  const rollbackLease = await withTenantDatabase(organisationId, () =>
    rollbackRepository.issueLease(
      scope(),
      command(rollbackTarget, rollbackKey),
    ),
  );
  await assert.rejects(
    () =>
      withTenantDatabase(organisationId, () =>
        rollbackRepository.finalize(scope(), {
          ...command(rollbackTarget, rollbackKey),
          leaseId: rollbackLease.leaseId,
        }),
      ),
    (error: unknown) =>
      error instanceof GovernedClientUploadError && error.code === "conflict",
  );
  assert.deepEqual(rollbackFixture.metrics.deleted, [
    clientUploadDocumentPath(organisationId, rollbackLease.leaseId),
  ]);
  await withTenantDatabase(organisationId, async () => {
    const rollbackDocuments = await db
      .select()
      .from(documents)
      .where(eq(documents.id, rollbackLease.leaseId));
    const [rollbackSession] = await db
      .select()
      .from(uploadSessions)
      .where(eq(uploadSessions.id, rollbackLease.leaseId));
    const [rollbackTask] = await db
      .select()
      .from(workTasks)
      .where(eq(workTasks.id, rollbackTarget.recordId));
    assert.equal(rollbackDocuments.length, 0);
    assert.equal(rollbackSession?.status, "open");
    assert.equal(rollbackTask?.version, rollbackTarget.version);
  });

  const expiryFixture = fixtureObjectStore(EXPIRY_BYTES);
  const expiryRepository = new DrizzleGovernedClientUploadRepository({
    objectStore: expiryFixture.objectStore,
    inspect: cleanInspector,
  });
  const expiryLease = await withTenantDatabase(organisationId, () =>
    expiryRepository.issueLease(scope(), command(expiryTarget, EXPIRY_KEY)),
  );
  await withTenantDatabase(organisationId, () =>
    db
      .update(uploadSessions)
      .set({ expiresAt: new Date("2000-01-01T00:00:00.000Z") })
      .where(eq(uploadSessions.id, expiryLease.leaseId)),
  );
  await assert.rejects(
    () =>
      withTenantDatabase(organisationId, () =>
        expiryRepository.finalize(scope(), {
          ...command(expiryTarget, EXPIRY_KEY),
          leaseId: expiryLease.leaseId,
        }),
      ),
    (error: unknown) =>
      error instanceof GovernedClientUploadError && error.code === "expired",
  );
  await withTenantDatabase(organisationId, async () => {
    const [expiredSession] = await db
      .select()
      .from(uploadSessions)
      .where(eq(uploadSessions.id, expiryLease.leaseId));
    const partialCleanupIntents = await db
      .select()
      .from(notificationEvents)
      .where(
        and(
          eq(notificationEvents.organisationId, organisationId),
          eq(notificationEvents.channel, "internal_storage"),
          eq(notificationEvents.template, "valo.storage-deletion-intent/v1"),
        ),
      );
    assert.equal(expiredSession?.status, "open");
    assert.equal(partialCleanupIntents.length, 0);
  });
  assert.equal(expiryFixture.metrics.downloads(), 0);
});

test("an exact idempotency key cannot be rebound to another request-slot payload", async () => {
  const fixture = fixtureObjectStore(ROLLBACK_BYTES);
  const repository = new DrizzleGovernedClientUploadRepository({
    objectStore: fixture.objectStore,
    inspect: cleanInspector,
  });
  await assert.rejects(
    () =>
      withTenantDatabase(organisationId, () =>
        repository.issueLease(scope(), command(rollbackTarget, MAIN_KEY)),
      ),
    (error: unknown) =>
      error instanceof GovernedClientUploadError && error.code === "conflict",
  );
  assert.equal(fixture.metrics.signed.length, 0);
  assert.equal(fixture.metrics.downloads(), 0);
});

test("concurrent different keys for one current slot intent converge to one open lease", async () => {
  const fixture = fixtureObjectStore(MAIN_BYTES);
  const repository = new DrizzleGovernedClientUploadRepository({
    objectStore: fixture.objectStore,
    inspect: cleanInspector,
  });
  const keys = [
    "client-upload-integration-concurrent-a-0004",
    "client-upload-integration-concurrent-b-0005",
  ] as const;
  const outcomes = await Promise.allSettled(
    keys.map((key) =>
      withTenantDatabase(organisationId, () =>
        repository.issueLease(scope(), command(concurrentTarget, key)),
      ),
    ),
  );
  assert.equal(
    outcomes.filter((outcome) => outcome.status === "fulfilled").length,
    1,
  );
  const rejected = outcomes.find(
    (outcome): outcome is PromiseRejectedResult =>
      outcome.status === "rejected",
  );
  assert.ok(
    rejected?.reason instanceof GovernedClientUploadError &&
      rejected.reason.code === "conflict",
  );
  // The durable envelope hashes the raw idempotency material. Prove the exact
  // request-slot target by parsing the closed, non-secret identity fields.
  const exactRows = await withTenantDatabase(organisationId, async () => {
    const rows = await db
      .select()
      .from(uploadSessions)
      .where(eq(uploadSessions.status, "open"));
    return rows.filter((row) => {
      try {
        const parsed = JSON.parse(row.idempotencyKey) as {
          intentId?: unknown;
        };
        return parsed.intentId === concurrentTarget.intentId;
      } catch {
        return false;
      }
    });
  });
  assert.equal(exactRows.length, 1);
  assert.equal(fixture.metrics.signed.length, 1);
});

test("ambiguous promoted-copy cleanup persists cleanup_unconfirmed without partial registration", async () => {
  const fixture = fixtureObjectStore(ROLLBACK_BYTES, {
    deleteFailure: new Error("object absence could not be confirmed"),
  });
  const repository = new DrizzleGovernedClientUploadRepository({
    objectStore: fixture.objectStore,
    inspect: cleanInspector,
    documentVersionId: () => COLLISION_VERSION_ID,
  });
  const key = "client-upload-integration-ambiguous-cleanup-0006";
  const lease = await withTenantDatabase(organisationId, () =>
    repository.issueLease(scope(), command(ambiguousTarget, key)),
  );
  const captured = await withTenantDatabase(organisationId, async () => {
    try {
      await repository.finalize(scope(), {
        ...command(ambiguousTarget, key),
        leaseId: lease.leaseId,
      });
      return null;
    } catch (error) {
      // The HTTP adapter treats governed 4xx outcomes as intentional terminal
      // evidence and commits the ambient tenant transaction.
      return error;
    }
  });
  assert.ok(
    captured instanceof GovernedClientUploadError &&
      captured.code === "cleanup_unconfirmed",
  );
  await withTenantDatabase(organisationId, async () => {
    const [session] = await db
      .select()
      .from(uploadSessions)
      .where(eq(uploadSessions.id, lease.leaseId));
    const registered = await db
      .select()
      .from(documents)
      .where(eq(documents.id, lease.leaseId));
    const denied = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organisationId, organisationId),
          eq(auditEvents.eventType, "client_action.upload_intake_denied"),
          eq(auditEvents.objectId, lease.leaseId),
        ),
      );
    assert.equal(session?.status, "cleanup_unconfirmed");
    assert.equal(registered.length, 0);
    assert.equal(denied.length, 1);
  });
  assert.deepEqual(fixture.metrics.deleted, [
    clientUploadDocumentPath(organisationId, lease.leaseId),
  ]);
});

test("expired finalize racing the sweeper converges to one atomic three-path cleanup", async () => {
  const envelope = createClientUploadLeaseEnvelope({
    idempotencyKey: EXPIRY_KEY,
    actorUserId: recipientUser.id,
    recordId: expiryTarget.recordId,
    recordVersion: expiryTarget.version,
    slotId: expiryTarget.slotId,
    intentId: expiryTarget.intentId,
    contentType: "application/pdf",
  });
  const leaseId = clientUploadLeaseId(
    organisationId,
    envelope.idempotencyKeySha256,
  );
  const fixture = fixtureObjectStore(EXPIRY_BYTES);
  const repository = new DrizzleGovernedClientUploadRepository({
    objectStore: fixture.objectStore,
    inspect: cleanInspector,
  });
  const [finalizeOutcome, sweepOutcome] = await Promise.allSettled([
    withTenantDatabase(organisationId, () =>
      repository.finalize(scope(), {
        ...command(expiryTarget, EXPIRY_KEY),
        leaseId,
      }),
    ),
    withTenantDatabase(organisationId, () =>
      sweepExpiredClientUploadLeases(organisationId, 25),
    ),
  ]);
  assert.equal(finalizeOutcome.status, "rejected");
  if (finalizeOutcome.status === "rejected") {
    assert.ok(finalizeOutcome.reason instanceof GovernedClientUploadError);
    assert.ok(
      finalizeOutcome.reason.code === "expired" ||
        finalizeOutcome.reason.code === "conflict",
    );
  }
  assert.equal(sweepOutcome.status, "fulfilled");
  if (sweepOutcome.status === "fulfilled") {
    assert.equal(sweepOutcome.value.considered, 1);
    assert.equal(sweepOutcome.value.expired, 1);
  }
  await withTenantDatabase(organisationId, async () => {
    const [session] = await db
      .select()
      .from(uploadSessions)
      .where(eq(uploadSessions.id, leaseId));
    const rows = await db
      .select()
      .from(notificationEvents)
      .where(
        and(
          eq(notificationEvents.organisationId, organisationId),
          eq(notificationEvents.channel, "internal_storage"),
          eq(notificationEvents.template, "valo.storage-deletion-intent/v1"),
        ),
      );
    const paths = rows
      .map((row) => parseStorageDeletionIntent(row.payload ?? ""))
      .filter((intent) => intent.aggregateId === leaseId)
      .map((intent) => intent.objectPath)
      .sort();
    assert.equal(session?.status, "expired");
    assert.deepEqual(
      paths,
      [
        clientUploadDocumentPath(organisationId, leaseId),
        clientUploadQuarantinePath(organisationId, leaseId),
        clientUploadObjectPath(organisationId, leaseId),
      ].sort(),
    );
  });
  assert.equal(fixture.metrics.downloads(), 0);
});

test("five signer-live source states sweep to exact terminal status and path matrix", async () => {
  const sourceStatuses = [
    "open",
    "completed",
    "rejected",
    "quarantined",
    "cleanup_unconfirmed",
  ] as const;
  const leases = new Map<
    (typeof sourceStatuses)[number],
    { id: string; envelope: string }
  >();
  for (const [index, status] of sourceStatuses.entries()) {
    const key = `client-upload-integration-sweep-${status}-${String(index).padStart(4, "0")}`;
    const envelope = createClientUploadLeaseEnvelope({
      idempotencyKey: key,
      actorUserId: recipientUser.id,
      recordId: randomUUID(),
      recordVersion: 1,
      slotId: randomUUID(),
      intentId: randomUUID(),
      contentType: "application/pdf",
    });
    leases.set(status, {
      id: clientUploadLeaseId(organisationId, envelope.idempotencyKeySha256),
      envelope: serializeClientUploadLeaseEnvelope(envelope),
    });
  }
  await withTenantDatabase(organisationId, async () => {
    for (const [status, lease] of leases) {
      await db.insert(uploadSessions).values({
        id: lease.id,
        organisationId,
        projectId,
        filename: `${status}.pdf`,
        expectedBytes: 1,
        receivedBytes: status === "completed" ? 1 : 0,
        expectedSha256: "d".repeat(64),
        idempotencyKey: lease.envelope,
        status,
        expiresAt: new Date("2000-01-01T00:00:00.000Z"),
      });
    }
    const result = await sweepExpiredClientUploadLeases(organisationId, 25);
    assert.equal(result.considered, sourceStatuses.length);
    assert.deepEqual(
      {
        expired: result.expired,
        completed: result.completedCleanupQueued,
        rejected: result.rejectedCleanupQueued,
        quarantined: result.quarantinedCleanupQueued,
        unconfirmed: result.cleanupUnconfirmedPostExpiryQueued,
      },
      {
        expired: 1,
        completed: 1,
        rejected: 1,
        quarantined: 1,
        unconfirmed: 1,
      },
    );
  });

  const nextStatus = {
    open: "expired",
    completed: "completed_cleanup_queued",
    rejected: "rejected_cleanup_queued",
    quarantined: "quarantined_cleanup_queued",
    cleanup_unconfirmed: "cleanup_unconfirmed_post_expiry_queued",
  } as const;
  await withTenantDatabase(organisationId, async () => {
    const rows = await db
      .select()
      .from(notificationEvents)
      .where(
        and(
          eq(notificationEvents.organisationId, organisationId),
          eq(notificationEvents.channel, "internal_storage"),
          eq(notificationEvents.template, "valo.storage-deletion-intent/v1"),
        ),
      );
    const intents = rows.map((row) =>
      parseStorageDeletionIntent(row.payload ?? ""),
    );
    for (const [status, lease] of leases) {
      const [session] = await db
        .select()
        .from(uploadSessions)
        .where(eq(uploadSessions.id, lease.id));
      assert.equal(session?.status, nextStatus[status]);
      const actualPaths = intents
        .filter((intent) => intent.aggregateId === lease.id)
        .map((intent) => intent.objectPath)
        .sort();
      const expectedPaths = [clientUploadObjectPath(organisationId, lease.id)];
      if (status !== "completed") {
        expectedPaths.push(clientUploadDocumentPath(organisationId, lease.id));
      }
      if (
        status === "open" ||
        status === "quarantined" ||
        status === "cleanup_unconfirmed"
      ) {
        expectedPaths.push(
          clientUploadQuarantinePath(organisationId, lease.id),
        );
      }
      assert.deepEqual(actualPaths, expectedPaths.sort());
      const receipts = await db
        .select()
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.organisationId, organisationId),
            eq(
              auditEvents.eventType,
              "client_action.upload_post_expiry_cleanup_queued",
            ),
            eq(auditEvents.objectId, lease.id),
          ),
        );
      assert.equal(receipts.length, 1);
      const details = JSON.parse(receipts[0]!.details ?? "{}") as {
        sourceStatus?: unknown;
        nextStatus?: unknown;
      };
      assert.equal(details.sourceStatus, status);
      assert.equal(details.nextStatus, nextStatus[status]);
    }
  });
  assert.equal(STORAGE_LIFECYCLE_BOUNDS.uploadPostExpiryGraceSeconds, 300);
});

test("tenant-scoped PostgreSQL access cannot observe a peer upload session", async () => {
  const roleName = `bidbox_upload_rls_probe_${randomUUID().replaceAll("-", "")}`;
  assert.match(roleName, /^[a-z][a-z0-9_]{0,62}$/u);
  const roleIdentifier = `"${roleName}"`;

  await db.execute(
    sql.raw(
      `CREATE ROLE ${roleIdentifier} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`,
    ),
  );
  try {
    await db.execute(
      sql.raw(`GRANT USAGE ON SCHEMA public TO ${roleIdentifier}`),
    );
    await db.execute(
      sql.raw(
        `GRANT SELECT ON TABLE public.upload_sessions TO ${roleIdentifier}`,
      ),
    );
    const selectAsRlsRole = (tenantId: string) =>
      withTenantDatabase(tenantId, async () => {
        await db.execute(sql.raw(`SET LOCAL ROLE ${roleIdentifier}`));
        await db.execute(sql`SET LOCAL row_security = on`);
        return db
          .select()
          .from(uploadSessions)
          .where(eq(uploadSessions.id, secondTenantLeaseId));
      });

    const hidden = await selectAsRlsRole(organisationId);
    const visible = await selectAsRlsRole(secondOrganisationId);
    assert.equal(hidden.length, 0);
    assert.equal(visible.length, 1);
    assert.equal(visible[0]?.organisationId, secondOrganisationId);
  } finally {
    await db.execute(sql.raw(`DROP OWNED BY ${roleIdentifier}`));
    await db.execute(sql.raw(`DROP ROLE ${roleIdentifier}`));
  }
});

test("current authority revocation after issuance denies finalization before storage", async () => {
  const fixture = fixtureObjectStore(MAIN_BYTES);
  const repository = new DrizzleGovernedClientUploadRepository({
    objectStore: fixture.objectStore,
    inspect: cleanInspector,
  });
  const key = "client-upload-integration-revoked-authority-0007";
  const lease = await withTenantDatabase(organisationId, () =>
    repository.issueLease(scope(), command(authorityTarget, key)),
  );
  await db
    .update(roleGrants)
    .set({
      revokedAt: new Date(),
      revocationReason: "client upload integration authority-race proof",
    })
    .where(eq(roleGrants.id, recipientRoleGrantId));
  await assert.rejects(
    () =>
      withTenantDatabase(organisationId, () =>
        repository.finalize(scope(), {
          ...command(authorityTarget, key),
          leaseId: lease.leaseId,
        }),
      ),
    (error: unknown) =>
      error instanceof GovernedClientUploadError &&
      error.code === "scope_denied",
  );
  assert.equal(fixture.metrics.downloads(), 0);
  assert.equal(fixture.metrics.promoted.length, 0);
});
