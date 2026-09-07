import { randomUUID } from "node:crypto";
import {
  auditEvents,
  capabilityItems,
  capabilityEvidenceLinks,
  conflictRecords,
  currentTenantDatabaseOrganisation,
  db,
  deletionCertificates,
  documents,
  documentVersions,
  documentVersionSnapshots,
  entitlementUsage,
  exportDeliveries,
  invoiceLines,
  invoices,
  legalHolds,
  notificationAttempts,
  notificationEvents,
  organisationMemberships,
  organisations,
  orders,
  packages,
  packageVersions,
  packageSignoffs,
  payments,
  projects,
  reports,
  retentionActions,
  retentionActionStorageEvents,
  retentionRequests,
  renewalMonitors,
  roleGrants,
  ruleEvaluations,
  ruleOverrides,
  uploadSessions,
  users,
  vaultItems,
  vaultItemVersions,
  workTasks,
} from "@workspace/db";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  like,
  lte,
  or,
  sql,
} from "drizzle-orm";
import type { LocalUser } from "../accessContext";
import { writeAuditTx } from "../audit";
import { sha256Hex } from "../canonicalDigest";
import {
  ClaimsDeskRepositoryUnavailableError,
  ClaimsDeskProjectAccessError,
} from "../claimsDesk/contracts";
import { PostgresClaimsDeskRepository } from "../claimsDesk/repository";
import { RETAINER_TASK_PREFIX } from "../commercialRetainer/contracts";
import { parseInstantPreserving } from "../dbClock";
import { UUID_PATTERN } from "../identifierPatterns";
import {
  hasPermission,
  isOrganisationRole,
  isOrganisationType,
  isRoleAllowedForOrganisation,
  type OrganisationRole,
} from "../permissions";
import { lockProjectReviewerAuthorityBoundary } from "../projectReviewerAuthority";
import { lockStagedUploadObject } from "../stagedUploadLock";
import {
  clientUploadDocumentPath,
  clientUploadObjectPath,
  clientUploadQuarantinePath,
  parseStorageDeletionIntent,
} from "../storageLifecycle/contracts";
import { enqueueStorageDeletionIntentTx } from "../storageLifecycle/repository";
import {
  RETENTION_COMPLETION_BOUNDS,
  RetentionCompletionError,
  type DeletionCertificateView,
  type RetainedCategoryView,
  type RetentionActionStatus,
  type RetentionActionView,
  type RetentionCompletionBlocker,
  type RetentionCompletionMutationCommand,
  type RetentionCompletionPermissions,
  type RetentionCompletionRepository,
  type RetentionCompletionScope,
  type RetentionCompletionSnapshot,
  type RetentionRequestStatus,
  type RetentionRequestView,
  type RetentionStorageBindingView,
} from "./contracts";
import {
  RETENTION_CERTIFICATE_MANIFEST_SCHEMA,
  RETENTION_RECONCILIATION_MANIFEST_SCHEMA,
  RETENTION_SOURCE_MANIFEST_SCHEMA,
  RetentionManifestError,
  digestSortedIdentities,
  parseRetentionCertificateManifest,
  parseRetentionProjectPurgeReceipt,
  parseRetentionReconciliationManifest,
  parseRetentionSourceManifest,
  retentionManifestSha256,
  serializeRetentionManifest,
  type RetentionManifestCategory,
  type RetentionManifestStorageObject,
  type RetentionReconciliationManifestEvent,
  type RetentionSourceManifest,
} from "./manifests";
import {
  decideRetentionReconciliationProgress,
  decideStorageTerminalEvidence,
  hasMutableCompletionProtocol,
  permissionsForSnapshot,
} from "./policy";

type RetentionTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type RetentionDatabase = typeof db | RetentionTx;
type RequestRow = typeof retentionRequests.$inferSelect;
type ActionRow = typeof retentionActions.$inferSelect;
type BindingRow = typeof retentionActionStorageEvents.$inferSelect;
type CertificateRow = typeof deletionCertificates.$inferSelect;

const CATEGORY_IDENTITY_LIMIT = 10_000;
const SOURCE_TOTAL_IDENTITY_LIMIT = 100_000;
const claimsDesk = new PostgresClaimsDeskRepository();

interface CurrentAuthority {
  actor: LocalUser;
  actorName: string;
  roles: readonly OrganisationRole[];
}

interface Inventory {
  categories: RetentionManifestCategory[];
  storageObjects: Array<
    RetentionManifestStorageObject & { objectPath: string }
  >;
  retainedCategories: RetainedCategoryView[];
  legalHoldIds: string[];
  orderIds: string[];
  entitlementUsageIds: string[];
  documentVersionSnapshotIds: string[];
  blockers: RetentionCompletionBlocker[];
}

interface BindingEvidence {
  binding: BindingRow;
  event: typeof notificationEvents.$inferSelect;
  latestAttempt: typeof notificationAttempts.$inferSelect | null;
}

function assertTenant(scope: RetentionCompletionScope): void {
  if (
    !UUID_PATTERN.test(scope.organisationId) ||
    currentTenantDatabaseOrganisation() !== scope.organisationId
  ) {
    throw new RetentionCompletionError(
      "not_found_or_not_authorized",
      "Retention completion authority is unavailable.",
    );
  }
}

function instant(value: Date | null): string | null {
  if (value === null) return null;
  if (!Number.isFinite(value.valueOf())) {
    throw new RetentionCompletionError(
      "persistence_unavailable",
      "Retention evidence contains an invalid timestamp.",
    );
  }
  return value.toISOString();
}

async function databaseTime(database: RetentionDatabase): Promise<Date> {
  const result = await database.execute(
    sql`SELECT pg_catalog.transaction_timestamp() AS "now"`,
  );
  const now = parseInstantPreserving(result.rows[0]?.now);
  if (!now) {
    throw new RetentionCompletionError(
      "persistence_unavailable",
      "The authoritative database clock is unavailable.",
    );
  }
  return now;
}

async function assertCurrentAuthority(
  database: RetentionDatabase,
  scope: RetentionCompletionScope,
  now: Date,
  lock: boolean,
): Promise<CurrentAuthority> {
  if (lock) {
    await lockProjectReviewerAuthorityBoundary(
      database as RetentionTx,
      scope.organisationId,
      scope.actorUserId,
    );
  }
  const rows = await database
    .select({
      actor: users,
      membershipId: organisationMemberships.id,
      organisationType: organisations.type,
    })
    .from(organisationMemberships)
    .innerJoin(users, eq(users.id, organisationMemberships.userId))
    .innerJoin(
      organisations,
      eq(organisations.id, organisationMemberships.organisationId),
    )
    .where(
      and(
        eq(organisationMemberships.id, scope.actorMembershipId),
        eq(organisationMemberships.organisationId, scope.organisationId),
        eq(organisationMemberships.userId, scope.actorUserId),
        eq(organisationMemberships.status, "active"),
        isNull(organisationMemberships.delegatedByMembershipId),
        or(
          isNull(organisationMemberships.accessStartsAt),
          lte(organisationMemberships.accessStartsAt, now),
        ),
        or(
          isNull(organisationMemberships.accessExpiresAt),
          gt(organisationMemberships.accessExpiresAt, now),
        ),
        eq(users.status, "active"),
        eq(organisations.status, "active"),
      ),
    )
    .limit(2);
  const row = rows.length === 1 ? rows[0] : undefined;
  const actorName = row?.actor.name?.trim();
  if (
    !row ||
    !actorName ||
    actorName !== row.actor.name ||
    actorName.length > 256 ||
    !isOrganisationType(row.organisationType)
  ) {
    throw new RetentionCompletionError(
      "not_found_or_not_authorized",
      "Current direct named retention authority is required.",
    );
  }
  const grants = await database
    .select({ role: roleGrants.role })
    .from(roleGrants)
    .where(
      and(
        eq(roleGrants.membershipId, row.membershipId),
        isNull(roleGrants.revokedAt),
        or(isNull(roleGrants.startsAt), lte(roleGrants.startsAt, now)),
        or(isNull(roleGrants.expiresAt), gt(roleGrants.expiresAt, now)),
      ),
    )
    .limit(101);
  if (grants.length > 100) {
    throw new RetentionCompletionError(
      "not_found_or_not_authorized",
      "Current direct retention authority could not be verified.",
    );
  }
  const organisationType = row.organisationType;
  if (!isOrganisationType(organisationType)) {
    throw new RetentionCompletionError(
      "not_found_or_not_authorized",
      "Current direct retention authority is required.",
    );
  }
  const roles = [...new Set(grants.map(({ role }) => role))].filter(
    (role): role is OrganisationRole =>
      isOrganisationRole(role) &&
      isRoleAllowedForOrganisation(role, organisationType),
  );
  if (!hasPermission(roles, "retention:manage")) {
    throw new RetentionCompletionError(
      "not_found_or_not_authorized",
      "Current direct retention authority is required.",
    );
  }
  return { actor: row.actor, actorName, roles };
}

const RETENTION_DETACH_DEADLOCK_ATTEMPTS = 3;

function postgresErrorCode(error: unknown): string | null {
  let candidate: unknown = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof candidate !== "object" || candidate === null) return null;
    if ("code" in candidate && typeof candidate.code === "string") {
      return candidate.code;
    }
    candidate = "cause" in candidate ? candidate.cause : null;
  }
  return null;
}

/**
 * Source-row release guards take their project lock from a row trigger, while
 * the owner-held purge intentionally freezes the project before its children.
 * PostgreSQL can therefore choose the purge as a deadlock victim when a
 * pre-existing source write overlaps detach. A deadlock aborts the complete
 * transaction, so a small fresh-transaction retry is safe and remains bound
 * to the same idempotency/CAS command.
 */
async function withPersistenceBoundary<T>(
  operation: () => Promise<T>,
  options: { readonly retryDeadlock?: boolean } = {},
): Promise<T> {
  const attempts = options.retryDeadlock
    ? RETENTION_DETACH_DEADLOCK_ATTEMPTS
    : 1;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (postgresErrorCode(error) === "40P01" && attempt < attempts) {
        continue;
      }
      if (error instanceof RetentionCompletionError) throw error;
      if (
        error instanceof ClaimsDeskRepositoryUnavailableError ||
        error instanceof ClaimsDeskProjectAccessError ||
        error instanceof RetentionManifestError
      ) {
        throw new RetentionCompletionError(
          "persistence_unavailable",
          "Retention completion evidence could not be verified.",
        );
      }
      throw new RetentionCompletionError(
        "persistence_unavailable",
        "Retention completion persistence is unavailable.",
      );
    }
  }
  throw new RetentionCompletionError(
    "persistence_unavailable",
    "Retention completion persistence is unavailable.",
  );
}

function withDetachPersistenceBoundary<T>(
  operation: () => Promise<T>,
): Promise<T> {
  return withPersistenceBoundary(operation, { retryDeadlock: true });
}

function requestView(row: RequestRow): RetentionRequestView {
  if (
    !row.organisationId ||
    !["pending", "reconciling", "completed", "blocked"].includes(row.status) ||
    ![0, 1].includes(row.completionProtocolVersion)
  ) {
    throw new RetentionCompletionError(
      "persistence_unavailable",
      "Retention request evidence is corrupt.",
    );
  }
  return {
    id: row.id,
    projectId: row.projectId,
    subjectProjectId: row.subjectProjectId,
    requestedByUserId: row.requestedBy,
    requestedByName: row.requestedByName,
    reason: row.reason,
    dueAt: instant(row.dueAt)!,
    completedAt: instant(row.completedAt),
    status: row.status as RetentionRequestStatus,
    completionProtocolVersion: row.completionProtocolVersion as 0 | 1,
    version: row.version,
    createdAt: instant(row.createdAt)!,
    updatedAt: instant(row.updatedAt)!,
  };
}

function assertMutableCompletionProtocol(
  request: RequestRow,
  action?: ActionRow,
): void {
  const mutable = action
    ? hasMutableCompletionProtocol({
        requestProtocolVersion: request.completionProtocolVersion,
        actionProtocolVersion: action.completionProtocolVersion,
      })
    : hasMutableCompletionProtocol({
        requestProtocolVersion: request.completionProtocolVersion,
      });
  if (!mutable) {
    throw new RetentionCompletionError(
      "state_conflict",
      "Legacy retention evidence is read-only and cannot enter the completion workflow.",
    );
  }
}

function actionView(row: ActionRow): RetentionActionView {
  if (
    !row.retentionRequestId ||
    !row.subjectProjectId ||
    !["pending", "detached", "reconciled", "certified", "blocked"].includes(
      row.status,
    )
  ) {
    throw new RetentionCompletionError(
      "persistence_unavailable",
      "Retention action evidence is corrupt.",
    );
  }
  if (
    Boolean(row.sourceManifest) !== Boolean(row.sourceManifestSha256) ||
    Boolean(row.purgeReceipt) !== Boolean(row.purgeReceiptSha256) ||
    Boolean(row.purgeReceipt) !== Boolean(row.purgedAt) ||
    Boolean(row.reconciliationManifest) !==
      Boolean(row.reconciliationManifestSha256)
  ) {
    throw new RetentionCompletionError(
      "persistence_unavailable",
      "Retention action evidence is incomplete.",
    );
  }
  const sourceManifest =
    row.sourceManifest && row.sourceManifestSha256
      ? parseRetentionSourceManifest(
          row.sourceManifest,
          row.sourceManifestSha256,
        )
      : null;
  const purgeReceipt =
    row.purgeReceipt && row.purgeReceiptSha256
      ? parseRetentionProjectPurgeReceipt(
          row.purgeReceipt,
          row.purgeReceiptSha256,
        )
      : null;
  const reconciliationManifest =
    row.reconciliationManifest && row.reconciliationManifestSha256
      ? parseRetentionReconciliationManifest(
          row.reconciliationManifest,
          row.reconciliationManifestSha256,
        )
      : null;
  if (
    sourceManifest &&
    (sourceManifest.organisationId !== row.organisationId ||
      sourceManifest.retentionRequestId !== row.retentionRequestId ||
      sourceManifest.retentionActionId !== row.id ||
      sourceManifest.subjectProjectId !== row.subjectProjectId)
  ) {
    throw new RetentionCompletionError(
      "persistence_unavailable",
      "Retention source manifest identity is invalid.",
    );
  }
  if (
    purgeReceipt &&
    (purgeReceipt.organisationId !== row.organisationId ||
      purgeReceipt.retentionRequestId !== row.retentionRequestId ||
      purgeReceipt.retentionActionId !== row.id ||
      purgeReceipt.subjectProjectId !== row.subjectProjectId ||
      purgeReceipt.sourceManifestSha256 !== row.sourceManifestSha256 ||
      purgeReceipt.purgedAt !== instant(row.purgedAt))
  ) {
    throw new RetentionCompletionError(
      "persistence_unavailable",
      "Retention purge receipt identity is invalid.",
    );
  }
  if (
    reconciliationManifest &&
    (reconciliationManifest.organisationId !== row.organisationId ||
      reconciliationManifest.retentionRequestId !== row.retentionRequestId ||
      reconciliationManifest.retentionActionId !== row.id ||
      reconciliationManifest.subjectProjectId !== row.subjectProjectId ||
      reconciliationManifest.sourceManifestSha256 !==
        row.sourceManifestSha256 ||
      reconciliationManifest.purgeReceiptSha256 !== row.purgeReceiptSha256 ||
      reconciliationManifest.purgedAt !== instant(row.purgedAt))
  ) {
    throw new RetentionCompletionError(
      "persistence_unavailable",
      "Retention reconciliation manifest identity is invalid.",
    );
  }
  return {
    id: row.id,
    retentionRequestId: row.retentionRequestId,
    subjectProjectId: row.subjectProjectId,
    status: row.status as RetentionActionStatus,
    version: row.version,
    sourceManifest,
    sourceManifestSha256: row.sourceManifestSha256,
    purgeReceipt,
    purgeReceiptSha256: row.purgeReceiptSha256,
    purgedAt: instant(row.purgedAt),
    reconciliationManifest,
    reconciliationManifestSha256: row.reconciliationManifestSha256,
    preparedByUserId: row.preparedByUserId,
    preparedByName: row.preparedByName,
    preparedAt: instant(row.preparedAt),
    checkedByUserId: row.checkedByUserId,
    checkedByName: row.checkedByName,
    checkedAt: instant(row.checkedAt),
    createdAt: instant(row.createdAt)!,
    updatedAt: instant(row.updatedAt)!,
  };
}

function certificateView(row: CertificateRow): DeletionCertificateView {
  if (!row.certificateManifest || !row.certificateManifestSha256) {
    throw new RetentionCompletionError(
      "persistence_unavailable",
      "Deletion certificate evidence is incomplete.",
    );
  }
  const manifest = parseRetentionCertificateManifest(
    row.certificateManifest,
    row.certificateManifestSha256,
  );
  if (
    row.method !== "durable_two_phase_detach_reconcile_certify" ||
    manifest.organisationId !== row.organisationId ||
    manifest.retentionActionId !== row.retentionActionId ||
    manifest.sourceManifestSha256 !== row.scopeManifestHash ||
    manifest.checkedByUserId !== row.signedByUserId ||
    manifest.checkedByName !== row.signedByName ||
    manifest.checkedAt !== instant(row.completedAt)
  ) {
    throw new RetentionCompletionError(
      "persistence_unavailable",
      "Deletion certificate method is invalid.",
    );
  }
  return {
    id: row.id,
    retentionActionId: row.retentionActionId,
    certificateNumber: row.certificateNumber,
    scopeManifestHash: row.scopeManifestHash,
    certificateManifest: manifest,
    certificateManifestSha256: row.certificateManifestSha256,
    method: row.method,
    completedAt: instant(row.completedAt)!,
    signedByUserId: row.signedByUserId,
    signedByName: row.signedByName,
    signatureEvidence: row.signatureEvidence,
    createdAt: instant(row.createdAt)!,
  };
}

function bindingView(evidence: BindingEvidence): RetentionStorageBindingView {
  if (
    ![
      "queued",
      "retry_wait",
      "completed",
      "cancelled",
      "dead_letter",
      "resolved",
    ].includes(evidence.event.status)
  ) {
    throw new RetentionCompletionError(
      "persistence_unavailable",
      "A bound storage event has an invalid state.",
    );
  }
  return {
    id: evidence.binding.id,
    kind: "project_retention",
    status: evidence.event.status as RetentionStorageBindingView["status"],
    terminalDisposition: evidence.binding
      .terminalDisposition as RetentionStorageBindingView["terminalDisposition"],
  };
}

async function loadBindingEvidence(
  database: RetentionDatabase,
  organisationId: string,
  actionId: string,
  lock: boolean,
): Promise<BindingEvidence[]> {
  if (lock) {
    await database.execute(sql`
        SELECT id FROM public.retention_action_storage_events
        WHERE organisation_id = ${organisationId}::uuid
          AND retention_action_id = ${actionId}::uuid
        ORDER BY storage_event_id
        FOR UPDATE
        LIMIT ${RETENTION_COMPLETION_BOUNDS.storageObjects + 1}
      `);
  }
  const bindings = await database
    .select()
    .from(retentionActionStorageEvents)
    .where(
      and(
        eq(retentionActionStorageEvents.organisationId, organisationId),
        eq(retentionActionStorageEvents.retentionActionId, actionId),
      ),
    )
    .orderBy(asc(retentionActionStorageEvents.storageEventId))
    .limit(RETENTION_COMPLETION_BOUNDS.storageObjects + 1);
  if (bindings.length > RETENTION_COMPLETION_BOUNDS.storageObjects) {
    throw new RetentionCompletionError(
      "capacity_exceeded",
      "Retention storage evidence exceeds the supported bound.",
    );
  }
  if (bindings.length === 0) return [];
  const eventIds = bindings.map(({ storageEventId }) => storageEventId);
  const events = await database
    .select()
    .from(notificationEvents)
    .where(
      and(
        eq(notificationEvents.organisationId, organisationId),
        inArray(notificationEvents.id, eventIds),
      ),
    )
    .limit(eventIds.length + 1);
  const attempts = await database
    .select()
    .from(notificationAttempts)
    .where(
      and(
        eq(notificationAttempts.organisationId, organisationId),
        inArray(notificationAttempts.notificationEventId, eventIds),
      ),
    )
    .orderBy(
      asc(notificationAttempts.notificationEventId),
      desc(notificationAttempts.attemptNumber),
    )
    .limit(eventIds.length * 6 + 1);
  if (
    events.length !== eventIds.length ||
    attempts.length > eventIds.length * 6
  ) {
    throw new RetentionCompletionError(
      "persistence_unavailable",
      "Bound storage evidence could not be verified.",
    );
  }
  const eventById = new Map(events.map((event) => [event.id, event]));
  const latestByEvent = new Map<
    string,
    typeof notificationAttempts.$inferSelect
  >();
  for (const attempt of attempts) {
    if (!latestByEvent.has(attempt.notificationEventId)) {
      latestByEvent.set(attempt.notificationEventId, attempt);
    }
  }
  return bindings.map((binding) => {
    const event = eventById.get(binding.storageEventId);
    if (!event) {
      throw new RetentionCompletionError(
        "persistence_unavailable",
        "Bound storage event is missing.",
      );
    }
    return {
      binding,
      event,
      latestAttempt: latestByEvent.get(binding.storageEventId) ?? null,
    };
  });
}

function retainedCategoriesFromSource(
  action: ActionRow | null,
): RetainedCategoryView[] {
  if (!action?.sourceManifest || !action.sourceManifestSha256) return [];
  const source = parseRetentionSourceManifest(
    action.sourceManifest,
    action.sourceManifestSha256,
  );
  return source.retainedCategories.map((category) => ({
    category: category.category as RetainedCategoryView["category"],
    reason: category.reason,
    count: category.count,
  }));
}

async function verifyOwnerPurgeProof(
  database: RetentionDatabase,
  action: ActionRow,
  request: RequestRow,
) {
  if (
    action.completionProtocolVersion !== 1 ||
    request.completionProtocolVersion !== 1 ||
    !action.sourceManifestSha256 ||
    !action.purgeReceipt ||
    !action.purgeReceiptSha256 ||
    !action.purgedAt ||
    action.version < 3 ||
    request.projectId !== null
  ) {
    throw new RetentionCompletionError(
      "persistence_unavailable",
      "Retention completion is missing its owner-held relational purge proof.",
    );
  }
  const receipt = parseRetentionProjectPurgeReceipt(
    action.purgeReceipt,
    action.purgeReceiptSha256,
  );
  if (
    receipt.organisationId !== action.organisationId ||
    receipt.retentionRequestId !== request.id ||
    receipt.retentionActionId !== action.id ||
    receipt.subjectProjectId !== request.subjectProjectId ||
    receipt.sourceManifestSha256 !== action.sourceManifestSha256 ||
    receipt.purgedAt !== instant(action.purgedAt)
  ) {
    throw new RetentionCompletionError(
      "persistence_unavailable",
      "The owner-held relational purge receipt has invalid provenance.",
    );
  }
  const liveSubjects = await database
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.organisationId, request.organisationId!),
        eq(projects.id, request.subjectProjectId),
      ),
    )
    .limit(1);
  if (liveSubjects.length > 0) {
    throw new RetentionCompletionError(
      "persistence_unavailable",
      "Retention completion cannot be exposed while its live project still exists.",
    );
  }
  return receipt;
}

async function buildSnapshot(
  database: RetentionDatabase,
  request: RequestRow,
  actorUserId: string,
  now: Date,
  dynamicBlockers: readonly RetentionCompletionBlocker[] = [],
): Promise<RetentionCompletionSnapshot> {
  const actions = await database
    .select()
    .from(retentionActions)
    .where(
      and(
        eq(retentionActions.organisationId, request.organisationId!),
        eq(retentionActions.retentionRequestId, request.id),
        eq(retentionActions.completionProtocolVersion, 1),
      ),
    )
    .orderBy(desc(retentionActions.createdAt), desc(retentionActions.id))
    .limit(2);
  if (actions.length > 1) {
    throw new RetentionCompletionError(
      "persistence_unavailable",
      "Retention request has ambiguous action evidence.",
    );
  }
  const action = actions[0] ?? null;
  if (
    action &&
    (action.retentionRequestId !== request.id ||
      action.subjectProjectId !== request.subjectProjectId ||
      action.organisationId !== request.organisationId)
  ) {
    throw new RetentionCompletionError(
      "persistence_unavailable",
      "Retention action identity does not match its request.",
    );
  }
  if (action?.completionProtocolVersion === 1 && action.status !== "pending") {
    await verifyOwnerPurgeProof(database, action, request);
  }
  const evidence = action
    ? await loadBindingEvidence(
        database,
        request.organisationId!,
        action.id,
        false,
      )
    : [];
  for (const item of evidence) {
    const envelope = item.event.payload
      ? parseStorageDeletionIntent(item.event.payload)
      : null;
    if (
      !action ||
      !envelope ||
      envelope.organisationId !== request.organisationId ||
      envelope.projectId !== request.subjectProjectId ||
      envelope.aggregateType !== "project_retention" ||
      envelope.aggregateId !== action.id ||
      envelope.reason !== "retention_completion" ||
      envelope.requestSha256 !== item.binding.requestSha256 ||
      sha256Hex(envelope.objectPath) !== item.binding.objectPathSha256
    ) {
      throw new RetentionCompletionError(
        "persistence_unavailable",
        "Bound storage evidence failed identity verification.",
      );
    }
  }
  const certificates = action
    ? await database
        .select()
        .from(deletionCertificates)
        .where(
          and(
            eq(deletionCertificates.organisationId, request.organisationId!),
            eq(deletionCertificates.retentionActionId, action.id),
          ),
        )
        .limit(2)
    : [];
  if (certificates.length > 1) {
    throw new RetentionCompletionError(
      "persistence_unavailable",
      "Retention action has ambiguous certificate evidence.",
    );
  }
  const blockers = [...dynamicBlockers];
  const evidenceDecisions = evidence.map((item) => ({
    item,
    decision: decideStorageTerminalEvidence({
      eventStatus: item.event.status,
      eventVersion: item.event.version,
      terminalAt: item.event.storageTerminalAt,
      latestAttemptStatus: item.latestAttempt?.status ?? null,
      latestAttemptResponseCode: item.latestAttempt?.responseCode ?? null,
    }),
  }));
  const deadLetters = evidenceDecisions.filter(
    ({ decision }) => decision.outcome === "dead_letter",
  ).length;
  const reconciled = evidence.filter(
    ({ binding }) =>
      binding.terminalDisposition === "deleted" ||
      binding.terminalDisposition === "already_absent",
  ).length;
  const untrusted = evidenceDecisions.filter(
    ({ item, decision }) =>
      item.binding.terminalDisposition === "cancelled_referenced" ||
      item.binding.terminalDisposition === "accepted_unresolved" ||
      (!item.binding.terminalDisposition && decision.outcome === "untrusted"),
  ).length;
  const pending = evidenceDecisions.filter(
    ({ item, decision }) =>
      !item.binding.terminalDisposition &&
      decision.outcome !== "dead_letter" &&
      decision.outcome !== "untrusted",
  ).length;
  if (action?.status === "detached" && pending > 0) {
    blockers.push({
      code: "storage_reconciliation_pending",
      message: "Bound storage deletion evidence is not yet terminal.",
      count: pending,
    });
  }
  if (deadLetters > 0) {
    blockers.push({
      code: "storage_dead_letter",
      message: "A bound storage deletion intent is in dead-letter state.",
      count: deadLetters,
    });
  }
  if (untrusted > 0) {
    blockers.push({
      code: "storage_terminal_untrusted",
      message:
        "A bound terminal storage outcome is not trustworthy deletion evidence.",
      count: untrusted,
    });
  }
  if (
    action?.status === "reconciled" &&
    action.preparedByUserId === actorUserId
  ) {
    blockers.push({
      code: "maker_checker_conflict",
      message:
        "Certification requires a currently authorised checker distinct from the preparer.",
    });
  }
  const uniqueBlockers = [
    ...new Map(
      blockers.map((blocker) => [
        `${blocker.code}\0${blocker.message}`,
        blocker,
      ]),
    ).values(),
  ];
  const certificate = certificates[0] ? certificateView(certificates[0]) : null;
  if (certificate && action) {
    const manifest = parseRetentionCertificateManifest(
      certificates[0]!.certificateManifest!,
      certificates[0]!.certificateManifestSha256!,
    );
    if (
      manifest.retentionRequestId !== request.id ||
      manifest.retentionActionId !== action.id ||
      manifest.subjectProjectId !== request.subjectProjectId ||
      manifest.sourceManifestSha256 !== action.sourceManifestSha256 ||
      manifest.purgeReceiptSha256 !== action.purgeReceiptSha256 ||
      manifest.purgedAt !== instant(action.purgedAt) ||
      manifest.reconciliationManifestSha256 !==
        action.reconciliationManifestSha256 ||
      manifest.preparedByUserId !== action.preparedByUserId ||
      manifest.preparedByName !== action.preparedByName ||
      manifest.preparedAt !== instant(action.preparedAt) ||
      manifest.checkedByUserId !== action.checkedByUserId ||
      manifest.checkedByName !== action.checkedByName ||
      manifest.checkedAt !== instant(action.checkedAt)
    ) {
      throw new RetentionCompletionError(
        "persistence_unavailable",
        "Deletion certificate is not bound to the complete retention evidence chain.",
      );
    }
  }
  return {
    request: requestView(request),
    action: action ? actionView(action) : null,
    blockers: uniqueBlockers,
    objectReconciliation: {
      expected: evidence.length,
      detached: action && action.status !== "pending" ? evidence.length : 0,
      reconciled,
      pending,
      deadLetters,
    },
    objectBindings: evidence.map(bindingView),
    retainedCategories: retainedCategoriesFromSource(action),
    certificate,
    permissions: permissionsForSnapshot({
      authorised: true,
      completionProtocolVersion: request.completionProtocolVersion,
      requestStatus: request.status,
      actionStatus: action ? (action.status as RetentionActionStatus) : null,
      actorUserId,
      preparedByUserId: action?.preparedByUserId ?? null,
    }),
    generatedAt: now.toISOString(),
  };
}

function addCategory(
  target: RetentionManifestCategory[],
  category: string,
  ids: readonly string[],
): void {
  if (ids.length === 0) return;
  if (ids.length > CATEGORY_IDENTITY_LIMIT) {
    throw new RetentionCompletionError(
      "capacity_exceeded",
      `Retention category ${category} exceeds the supported bound.`,
    );
  }
  target.push({
    category,
    count: ids.length,
    identitiesSha256: digestSortedIdentities(ids),
  });
}

async function inspectInventory(
  tx: RetentionDatabase,
  scope: RetentionCompletionScope,
  retentionRequestId: string,
  project: typeof projects.$inferSelect,
  now: Date,
): Promise<Inventory> {
  const blockers: RetentionCompletionBlocker[] = [];
  const legal = await tx
    .select({ id: legalHolds.id, status: legalHolds.status })
    .from(legalHolds)
    .where(
      and(
        eq(legalHolds.organisationId, scope.organisationId),
        eq(legalHolds.projectId, project.id),
      ),
    )
    .orderBy(asc(legalHolds.id))
    .limit(CATEGORY_IDENTITY_LIMIT + 1);
  const activeLegal = legal.filter(({ status }) => status !== "released");
  if (legal.length > CATEGORY_IDENTITY_LIMIT) {
    blockers.push({
      code: "capacity_exceeded",
      message: "Legal-hold inventory exceeds the supported manifest bound.",
    });
  }
  if (activeLegal.length > 0) {
    blockers.push({
      code: "active_legal_hold",
      message: "An active legal hold prevents retention completion.",
      count: activeLegal.length,
    });
  }

  const financialOrders = await tx
    .select({ id: orders.id, status: orders.status })
    .from(orders)
    .where(
      and(
        eq(orders.organisationId, scope.organisationId),
        eq(orders.projectId, project.id),
      ),
    )
    .orderBy(asc(orders.id))
    .limit(CATEGORY_IDENTITY_LIMIT + 1);
  const orderIds = financialOrders.map(({ id }) => id);
  const orderInventoryExceeded =
    financialOrders.length > CATEGORY_IDENTITY_LIMIT;
  const invoiceRows =
    orderIds.length === 0 || orderInventoryExceeded
      ? []
      : await tx
          .select({
            orderId: invoiceLines.orderId,
            invoiceId: invoices.id,
            invoiceStatus: invoices.status,
          })
          .from(invoiceLines)
          .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
          .where(
            and(
              eq(invoices.organisationId, scope.organisationId),
              inArray(invoiceLines.orderId, orderIds),
            ),
          )
          .orderBy(asc(invoiceLines.orderId), asc(invoices.id))
          .limit(CATEGORY_IDENTITY_LIMIT + 1);
  const invoiceIds = [
    ...new Set(invoiceRows.map(({ invoiceId }) => invoiceId)),
  ];
  const invoiceInventoryExceeded =
    invoiceRows.length > CATEGORY_IDENTITY_LIMIT ||
    invoiceIds.length > CATEGORY_IDENTITY_LIMIT;
  const paymentRows =
    invoiceIds.length === 0 || invoiceInventoryExceeded
      ? []
      : await tx
          .select({
            id: payments.id,
            invoiceId: payments.invoiceId,
            status: payments.status,
            reconciliationStatus: payments.reconciliationStatus,
          })
          .from(payments)
          .where(
            and(
              eq(payments.organisationId, scope.organisationId),
              inArray(payments.invoiceId, invoiceIds),
            ),
          )
          .orderBy(asc(payments.id))
          .limit(CATEGORY_IDENTITY_LIMIT + 1);
  if (
    orderInventoryExceeded ||
    invoiceInventoryExceeded ||
    paymentRows.length > CATEGORY_IDENTITY_LIMIT
  ) {
    blockers.push({
      code: "capacity_exceeded",
      message: "Financial inventory exceeds the supported manifest bound.",
    });
  }
  const financiallyOpen = financialOrders.some((order) => {
    const relatedInvoices = invoiceRows.filter(
      (invoice) => invoice.orderId === order.id,
    );
    return (
      order.status !== "paid_manual" ||
      relatedInvoices.length === 0 ||
      relatedInvoices.some((invoice) => {
        const relatedPayments = paymentRows.filter(
          (payment) => payment.invoiceId === invoice.invoiceId,
        );
        return (
          invoice.invoiceStatus !== "paid_manual" ||
          relatedPayments.length === 0 ||
          relatedPayments.some(
            (payment) =>
              payment.status !== "settled" ||
              payment.reconciliationStatus !== "verified_manual",
          )
        );
      })
    );
  });
  if (financiallyOpen) {
    blockers.push({
      code: "financial_reconciliation_open",
      message: "Financial and accounting evidence is not fully reconciled.",
      count: financialOrders.length,
    });
  }

  const retainerRows = await tx
    .select({ id: workTasks.id, status: workTasks.status })
    .from(workTasks)
    .where(
      and(
        eq(workTasks.organisationId, scope.organisationId),
        eq(workTasks.projectId, project.id),
        like(workTasks.title, `${RETAINER_TASK_PREFIX}%`),
      ),
    )
    .orderBy(asc(workTasks.id))
    .limit(CATEGORY_IDENTITY_LIMIT + 1);
  const openRetainer = retainerRows.filter(
    ({ status }) => status !== "completed" && status !== "cancelled",
  );
  if (retainerRows.length > CATEGORY_IDENTITY_LIMIT) {
    blockers.push({
      code: "capacity_exceeded",
      message: "Retainer inventory exceeds the supported manifest bound.",
    });
  }
  if (openRetainer.length > 0) {
    blockers.push({
      code: "retainer_work_open",
      message: "Commercial retainer work remains open.",
      count: openRetainer.length,
    });
  }

  const claims = await claimsDesk.readSnapshot(
    {
      organisationId: scope.organisationId,
      projectId: project.id,
      actorUserId: scope.actorUserId,
      actorMembershipId: scope.actorMembershipId,
    },
    now,
  );
  const openClaims = claims.records.filter(
    ({ status }) => status !== "closed" && status !== "withdrawn",
  );
  if (openClaims.length > 0) {
    blockers.push({
      code: "claims_desk_open",
      message: "Claims Desk records remain open or await governed closure.",
      count: openClaims.length,
    });
  }

  const immutableSnapshots = await tx
    .select({ id: documentVersionSnapshots.id })
    .from(documentVersionSnapshots)
    .innerJoin(
      documentVersions,
      eq(documentVersions.id, documentVersionSnapshots.documentVersionId),
    )
    .innerJoin(documents, eq(documents.id, documentVersions.documentId))
    .where(
      and(
        eq(documentVersionSnapshots.organisationId, scope.organisationId),
        eq(documents.projectId, project.id),
      ),
    )
    .orderBy(asc(documentVersionSnapshots.id))
    .limit(CATEGORY_IDENTITY_LIMIT + 1);
  const entitlementRows = await tx
    .select({ id: entitlementUsage.id })
    .from(entitlementUsage)
    .where(
      and(
        eq(entitlementUsage.organisationId, scope.organisationId),
        eq(entitlementUsage.projectId, project.id),
      ),
    )
    .orderBy(asc(entitlementUsage.id))
    .limit(CATEGORY_IDENTITY_LIMIT + 1);

  const vaultLineageRows = await tx
    .select({ id: vaultItemVersions.id })
    .from(vaultItemVersions)
    .innerJoin(
      documentVersions,
      eq(documentVersions.id, vaultItemVersions.documentVersionId),
    )
    .innerJoin(documents, eq(documents.id, documentVersions.documentId))
    .where(
      and(
        eq(vaultItemVersions.organisationId, scope.organisationId),
        eq(documentVersions.organisationId, scope.organisationId),
        eq(documents.organisationId, scope.organisationId),
        eq(documents.projectId, project.id),
      ),
    )
    .orderBy(asc(vaultItemVersions.id))
    .limit(CATEGORY_IDENTITY_LIMIT + 1);
  const capabilityLineageRows = await tx
    .select({ id: capabilityEvidenceLinks.id })
    .from(capabilityEvidenceLinks)
    .innerJoin(
      documentVersions,
      eq(documentVersions.id, capabilityEvidenceLinks.documentVersionId),
    )
    .innerJoin(documents, eq(documents.id, documentVersions.documentId))
    .where(
      and(
        eq(capabilityEvidenceLinks.organisationId, scope.organisationId),
        eq(documentVersions.organisationId, scope.organisationId),
        eq(documents.organisationId, scope.organisationId),
        eq(documents.projectId, project.id),
      ),
    )
    .orderBy(asc(capabilityEvidenceLinks.id))
    .limit(CATEGORY_IDENTITY_LIMIT + 1);
  const packageSignoffRows = await tx
    .select({ id: packageSignoffs.id })
    .from(packageSignoffs)
    .innerJoin(
      packageVersions,
      eq(packageVersions.id, packageSignoffs.packageVersionId),
    )
    .innerJoin(packages, eq(packages.id, packageVersions.packageId))
    .where(
      and(
        eq(packageSignoffs.organisationId, scope.organisationId),
        eq(packageVersions.organisationId, scope.organisationId),
        eq(packages.organisationId, scope.organisationId),
        eq(packages.projectId, project.id),
      ),
    )
    .orderBy(asc(packageSignoffs.id))
    .limit(CATEGORY_IDENTITY_LIMIT + 1);
  const exportDeliveryRows = await tx
    .select({ id: exportDeliveries.id })
    .from(exportDeliveries)
    .innerJoin(
      packageVersions,
      eq(packageVersions.id, exportDeliveries.packageVersionId),
    )
    .innerJoin(packages, eq(packages.id, packageVersions.packageId))
    .where(
      and(
        eq(exportDeliveries.organisationId, scope.organisationId),
        eq(packageVersions.organisationId, scope.organisationId),
        eq(packages.organisationId, scope.organisationId),
        eq(packages.projectId, project.id),
      ),
    )
    .orderBy(asc(exportDeliveries.id))
    .limit(CATEGORY_IDENTITY_LIMIT + 1);
  const ruleOverrideRows = await tx
    .select({ id: ruleOverrides.id })
    .from(ruleOverrides)
    .innerJoin(
      ruleEvaluations,
      eq(ruleEvaluations.id, ruleOverrides.ruleEvaluationId),
    )
    .where(
      and(
        eq(ruleOverrides.organisationId, scope.organisationId),
        eq(ruleEvaluations.organisationId, scope.organisationId),
        eq(ruleEvaluations.projectId, project.id),
      ),
    )
    .orderBy(asc(ruleOverrides.id))
    .limit(CATEGORY_IDENTITY_LIMIT + 1);
  const externalConflictLineageRows = await tx
    .select({ id: conflictRecords.id })
    .from(conflictRecords)
    .where(
      and(
        eq(conflictRecords.organisationId, scope.organisationId),
        eq(conflictRecords.matchedProjectId, project.id),
        sql`${conflictRecords.projectId} IS DISTINCT FROM ${project.id}::uuid`,
      ),
    )
    .orderBy(asc(conflictRecords.id))
    .limit(CATEGORY_IDENTITY_LIMIT + 1);
  const otherRetentionRequestRows = await tx
    .select({ id: retentionRequests.id })
    .from(retentionRequests)
    .where(
      and(
        eq(retentionRequests.organisationId, scope.organisationId),
        eq(retentionRequests.projectId, project.id),
        sql`${retentionRequests.id} <> ${retentionRequestId}::uuid`,
      ),
    )
    .orderBy(asc(retentionRequests.id))
    .limit(CATEGORY_IDENTITY_LIMIT + 1);
  const externalCapabilityDocumentRows = await tx
    .select({ id: capabilityItems.id })
    .from(capabilityItems)
    .innerJoin(documents, eq(documents.id, capabilityItems.evidenceDocId))
    .where(
      and(
        eq(capabilityItems.organisationId, scope.organisationId),
        eq(documents.organisationId, scope.organisationId),
        eq(documents.projectId, project.id),
      ),
    )
    .orderBy(asc(capabilityItems.id))
    .limit(CATEGORY_IDENTITY_LIMIT + 1);
  const externalRenewalNotificationRows = await tx
    .select({ id: renewalMonitors.id })
    .from(renewalMonitors)
    .innerJoin(
      notificationEvents,
      eq(notificationEvents.id, renewalMonitors.lastNotificationEventId),
    )
    .where(
      and(
        eq(renewalMonitors.organisationId, scope.organisationId),
        eq(notificationEvents.organisationId, scope.organisationId),
        eq(notificationEvents.projectId, project.id),
      ),
    )
    .orderBy(asc(renewalMonitors.id))
    .limit(CATEGORY_IDENTITY_LIMIT + 1);
  const externalVaultSourceRows = await tx
    .select({ id: vaultItems.id })
    .from(vaultItems)
    .innerJoin(documents, eq(documents.id, vaultItems.sourceDocumentId))
    .where(
      and(
        eq(vaultItems.organisationId, scope.organisationId),
        eq(documents.organisationId, scope.organisationId),
        eq(documents.projectId, project.id),
      ),
    )
    .orderBy(asc(vaultItems.id))
    .limit(CATEGORY_IDENTITY_LIMIT + 1);
  const projectBoundRetentionEventRows = await tx
    .select({ id: retentionActionStorageEvents.id })
    .from(retentionActionStorageEvents)
    .innerJoin(
      notificationEvents,
      eq(notificationEvents.id, retentionActionStorageEvents.storageEventId),
    )
    .where(
      and(
        eq(retentionActionStorageEvents.organisationId, scope.organisationId),
        eq(notificationEvents.organisationId, scope.organisationId),
        eq(notificationEvents.projectId, project.id),
      ),
    )
    .orderBy(asc(retentionActionStorageEvents.id))
    .limit(CATEGORY_IDENTITY_LIMIT + 1);
  const externalProjectLineageRows = (
    await tx.execute<{ id: string }>(sql`
      SELECT category || ':' || id AS id
      FROM (
        SELECT 'requirement_source_document'::text AS category,
               external_requirement.id::text AS id
        FROM public.requirements AS external_requirement
        INNER JOIN public.documents AS document
          ON document.id = external_requirement.source_doc_id
        WHERE external_requirement.organisation_id = ${scope.organisationId}::uuid
          AND document.organisation_id = ${scope.organisationId}::uuid
          AND document.project_id = ${project.id}::uuid
          AND external_requirement.project_id IS DISTINCT FROM ${project.id}::uuid
        UNION ALL
        SELECT 'evidence_document', external_evidence.id::text
        FROM public.evidence_items AS external_evidence
        INNER JOIN public.documents AS document
          ON document.id = external_evidence.document_id
        WHERE external_evidence.organisation_id = ${scope.organisationId}::uuid
          AND document.organisation_id = ${scope.organisationId}::uuid
          AND document.project_id = ${project.id}::uuid
          AND external_evidence.project_id IS DISTINCT FROM ${project.id}::uuid
        UNION ALL
        SELECT 'evidence_requirement', external_evidence.id::text
        FROM public.evidence_items AS external_evidence
        INNER JOIN public.requirements AS requirement
          ON requirement.id = external_evidence.requirement_id
        WHERE external_evidence.organisation_id = ${scope.organisationId}::uuid
          AND requirement.organisation_id = ${scope.organisationId}::uuid
          AND requirement.project_id = ${project.id}::uuid
          AND external_evidence.project_id IS DISTINCT FROM ${project.id}::uuid
        UNION ALL
        SELECT 'boq_check_document', external_check.id::text
        FROM public.boq_checks AS external_check
        INNER JOIN public.documents AS document
          ON document.id = external_check.source_doc_id
        WHERE external_check.organisation_id = ${scope.organisationId}::uuid
          AND document.organisation_id = ${scope.organisationId}::uuid
          AND document.project_id = ${project.id}::uuid
          AND external_check.project_id IS DISTINCT FROM ${project.id}::uuid
        UNION ALL
        SELECT 'defect_requirement', external_defect.id::text
        FROM public.defects AS external_defect
        INNER JOIN public.requirements AS requirement
          ON requirement.id = external_defect.requirement_id
        WHERE external_defect.organisation_id = ${scope.organisationId}::uuid
          AND requirement.organisation_id = ${scope.organisationId}::uuid
          AND requirement.project_id = ${project.id}::uuid
          AND external_defect.project_id IS DISTINCT FROM ${project.id}::uuid
        UNION ALL
        SELECT 'defect_decision', external_decision.id::text
        FROM public.defect_decisions AS external_decision
        INNER JOIN public.defects AS defect
          ON defect.id = external_decision.defect_id
        WHERE external_decision.organisation_id = ${scope.organisationId}::uuid
          AND defect.organisation_id = ${scope.organisationId}::uuid
          AND defect.project_id = ${project.id}::uuid
          AND external_decision.project_id IS DISTINCT FROM ${project.id}::uuid
        UNION ALL
        SELECT 'addendum_document_version', external_assessment.id::text
        FROM public.addendum_impact_assessments AS external_assessment
        INNER JOIN public.document_versions AS version
          ON version.id = external_assessment.baseline_document_version_id
          OR version.id = external_assessment.revision_document_version_id
        INNER JOIN public.documents AS document
          ON document.id = version.document_id
        WHERE external_assessment.organisation_id = ${scope.organisationId}::uuid
          AND version.organisation_id = ${scope.organisationId}::uuid
          AND document.organisation_id = ${scope.organisationId}::uuid
          AND document.project_id = ${project.id}::uuid
          AND external_assessment.project_id IS DISTINCT FROM ${project.id}::uuid
        UNION ALL
        SELECT 'boq_run_document_version', external_run.id::text
        FROM public.boq_runs AS external_run
        INNER JOIN public.document_versions AS version
          ON version.id = external_run.document_version_id
        INNER JOIN public.documents AS document
          ON document.id = version.document_id
        WHERE external_run.organisation_id = ${scope.organisationId}::uuid
          AND version.organisation_id = ${scope.organisationId}::uuid
          AND document.organisation_id = ${scope.organisationId}::uuid
          AND document.project_id = ${project.id}::uuid
          AND external_run.project_id IS DISTINCT FROM ${project.id}::uuid
        UNION ALL
        SELECT 'context_artifact_document_version', external_artifact.id::text
        FROM public.tender_context_artifacts AS external_artifact
        INNER JOIN public.document_versions AS version
          ON version.id = external_artifact.document_version_id
        INNER JOIN public.documents AS document
          ON document.id = version.document_id
        WHERE external_artifact.organisation_id = ${scope.organisationId}::uuid
          AND version.organisation_id = ${scope.organisationId}::uuid
          AND document.organisation_id = ${scope.organisationId}::uuid
          AND document.project_id = ${project.id}::uuid
          AND external_artifact.project_id IS DISTINCT FROM ${project.id}::uuid
        UNION ALL
        SELECT 'context_artifact_context', external_artifact.id::text
        FROM public.tender_context_artifacts AS external_artifact
        INNER JOIN public.tender_context_versions AS context
          ON context.id = external_artifact.tender_context_version_id
        WHERE external_artifact.organisation_id = ${scope.organisationId}::uuid
          AND context.organisation_id = ${scope.organisationId}::uuid
          AND context.project_id = ${project.id}::uuid
          AND external_artifact.project_id IS DISTINCT FROM ${project.id}::uuid
        UNION ALL
        SELECT 'context_primary_document_version', external_context.id::text
        FROM public.tender_context_versions AS external_context
        INNER JOIN public.document_versions AS version
          ON version.id = external_context.primary_document_version_id
        INNER JOIN public.documents AS document
          ON document.id = version.document_id
        WHERE external_context.organisation_id = ${scope.organisationId}::uuid
          AND version.organisation_id = ${scope.organisationId}::uuid
          AND document.organisation_id = ${scope.organisationId}::uuid
          AND document.project_id = ${project.id}::uuid
          AND external_context.project_id IS DISTINCT FROM ${project.id}::uuid
        UNION ALL
        SELECT 'context_successor', external_context.id::text
        FROM public.tender_context_versions AS external_context
        INNER JOIN public.tender_context_versions AS subject_context
          ON subject_context.id = external_context.supersedes_context_version_id
        WHERE external_context.organisation_id = ${scope.organisationId}::uuid
          AND subject_context.organisation_id = ${scope.organisationId}::uuid
          AND subject_context.project_id = ${project.id}::uuid
          AND external_context.project_id IS DISTINCT FROM ${project.id}::uuid
        UNION ALL
        SELECT 'draft_processing_run', external_version.id::text
        FROM public.draft_versions AS external_version
        INNER JOIN public.drafts AS external_draft
          ON external_draft.id = external_version.draft_id
        INNER JOIN public.processing_runs AS run
          ON run.id = external_version.model_run_id
        INNER JOIN public.processing_jobs AS job
          ON job.id = run.job_id
        WHERE external_version.organisation_id = ${scope.organisationId}::uuid
          AND external_draft.organisation_id = ${scope.organisationId}::uuid
          AND run.organisation_id = ${scope.organisationId}::uuid
          AND job.organisation_id = ${scope.organisationId}::uuid
          AND job.project_id = ${project.id}::uuid
          AND external_draft.project_id IS DISTINCT FROM ${project.id}::uuid
        UNION ALL
        SELECT 'processing_job_document_version', external_job.id::text
        FROM public.processing_jobs AS external_job
        INNER JOIN public.document_versions AS version
          ON version.id = external_job.document_version_id
        INNER JOIN public.documents AS document
          ON document.id = version.document_id
        WHERE external_job.organisation_id = ${scope.organisationId}::uuid
          AND version.organisation_id = ${scope.organisationId}::uuid
          AND document.organisation_id = ${scope.organisationId}::uuid
          AND document.project_id = ${project.id}::uuid
          AND external_job.project_id IS DISTINCT FROM ${project.id}::uuid
        UNION ALL
        SELECT 'work_task_requirement', external_task.id::text
        FROM public.work_tasks AS external_task
        INNER JOIN public.requirements AS requirement
          ON requirement.id = external_task.requirement_id
        WHERE external_task.organisation_id = ${scope.organisationId}::uuid
          AND requirement.organisation_id = ${scope.organisationId}::uuid
          AND requirement.project_id = ${project.id}::uuid
          AND external_task.project_id IS DISTINCT FROM ${project.id}::uuid
        UNION ALL
        SELECT 'context_requirement', external_binding.id::text
        FROM public.tender_context_requirements AS external_binding
        INNER JOIN public.requirements AS requirement
          ON requirement.id = external_binding.requirement_id
        INNER JOIN public.requirement_citations AS citation
          ON citation.id = external_binding.requirement_citation_id
        INNER JOIN public.requirements AS citation_requirement
          ON citation_requirement.id = citation.requirement_id
        WHERE external_binding.organisation_id = ${scope.organisationId}::uuid
          AND requirement.organisation_id = ${scope.organisationId}::uuid
          AND citation.organisation_id = ${scope.organisationId}::uuid
          AND citation_requirement.organisation_id = ${scope.organisationId}::uuid
          AND (
            requirement.project_id = ${project.id}::uuid
            OR citation_requirement.project_id = ${project.id}::uuid
          )
          AND external_binding.project_id IS DISTINCT FROM ${project.id}::uuid
        UNION ALL
        SELECT 'context_requirement_context', external_binding.id::text
        FROM public.tender_context_requirements AS external_binding
        INNER JOIN public.tender_context_versions AS context
          ON context.id = external_binding.tender_context_version_id
        WHERE external_binding.organisation_id = ${scope.organisationId}::uuid
          AND context.organisation_id = ${scope.organisationId}::uuid
          AND context.project_id = ${project.id}::uuid
          AND external_binding.project_id IS DISTINCT FROM ${project.id}::uuid
        UNION ALL
        SELECT 'eligibility_context', external_passport.id::text
        FROM public.tender_eligibility_passports AS external_passport
        INNER JOIN public.tender_context_versions AS context
          ON context.id = external_passport.tender_context_version_id
        WHERE external_passport.organisation_id = ${scope.organisationId}::uuid
          AND context.organisation_id = ${scope.organisationId}::uuid
          AND context.project_id = ${project.id}::uuid
          AND external_passport.project_id IS DISTINCT FROM ${project.id}::uuid
        UNION ALL
        SELECT 'requirement_citation_document_version', external_citation.id::text
        FROM public.requirement_citations AS external_citation
        INNER JOIN public.requirements AS external_requirement
          ON external_requirement.id = external_citation.requirement_id
        INNER JOIN public.document_versions AS version
          ON version.id = external_citation.document_version_id
        INNER JOIN public.documents AS document
          ON document.id = version.document_id
        WHERE external_citation.organisation_id = ${scope.organisationId}::uuid
          AND external_requirement.organisation_id = ${scope.organisationId}::uuid
          AND version.organisation_id = ${scope.organisationId}::uuid
          AND document.organisation_id = ${scope.organisationId}::uuid
          AND document.project_id = ${project.id}::uuid
          AND external_requirement.project_id IS DISTINCT FROM ${project.id}::uuid
        UNION ALL
        SELECT 'claim_document_version', external_link.id::text
        FROM public.claim_evidence_links AS external_link
        INNER JOIN public.document_versions AS version
          ON version.id = external_link.document_version_id
        INNER JOIN public.documents AS document
          ON document.id = version.document_id
        INNER JOIN public.draft_claims AS claim
          ON claim.id = external_link.draft_claim_id
        INNER JOIN public.draft_versions AS draft_version
          ON draft_version.id = claim.draft_version_id
        INNER JOIN public.drafts AS draft
          ON draft.id = draft_version.draft_id
        WHERE external_link.organisation_id = ${scope.organisationId}::uuid
          AND version.organisation_id = ${scope.organisationId}::uuid
          AND document.organisation_id = ${scope.organisationId}::uuid
          AND claim.organisation_id = ${scope.organisationId}::uuid
          AND draft_version.organisation_id = ${scope.organisationId}::uuid
          AND draft.organisation_id = ${scope.organisationId}::uuid
          AND document.project_id = ${project.id}::uuid
          AND draft.project_id IS DISTINCT FROM ${project.id}::uuid
      ) AS external_lineage(category, id)
      ORDER BY category, id
      LIMIT ${CATEGORY_IDENTITY_LIMIT + 1}
    `)
  ).rows;
  const governedLineage = [
    {
      label: "Vault document lineage",
      rows: vaultLineageRows,
    },
    {
      label: "Capability evidence lineage",
      rows: capabilityLineageRows,
    },
    {
      label: "Package sign-off evidence",
      rows: packageSignoffRows,
    },
    {
      label: "Export delivery evidence",
      rows: exportDeliveryRows,
    },
    {
      label: "Approved jurisdiction-rule override evidence",
      rows: ruleOverrideRows,
    },
    {
      label: "External conflict decision lineage",
      rows: externalConflictLineageRows,
    },
    {
      label: "Another retention request's live project locator",
      rows: otherRetentionRequestRows,
    },
    {
      label: "External capability document lineage",
      rows: externalCapabilityDocumentRows,
    },
    {
      label: "External renewal notification lineage",
      rows: externalRenewalNotificationRows,
    },
    {
      label: "External vault source-document lineage",
      rows: externalVaultSourceRows,
    },
    {
      label: "Project-bound retention storage event lineage",
      rows: projectBoundRetentionEventRows,
    },
    {
      label: "External project evidence lineage",
      rows: externalProjectLineageRows,
    },
  ] as const;
  for (const lineage of governedLineage) {
    if (lineage.rows.length > CATEGORY_IDENTITY_LIMIT) {
      blockers.push({
        code: "capacity_exceeded",
        message: `${lineage.label} exceeds the supported preflight bound.`,
      });
    } else if (lineage.rows.length > 0) {
      blockers.push({
        code: "governed_evidence_retained",
        message: `${lineage.label} independently retains project content and requires a separately governed archive or release workflow.`,
        count: lineage.rows.length,
      });
    }
  }
  if (
    immutableSnapshots.length > CATEGORY_IDENTITY_LIMIT ||
    entitlementRows.length > CATEGORY_IDENTITY_LIMIT
  ) {
    blockers.push({
      code: "capacity_exceeded",
      message:
        "Governed project evidence exceeds the supported manifest bound.",
    });
  }

  const documentRows = await tx
    .select({ id: documents.id, objectPath: documents.objectPath })
    .from(documents)
    .where(
      and(
        eq(documents.organisationId, scope.organisationId),
        eq(documents.projectId, project.id),
      ),
    )
    .orderBy(asc(documents.id))
    .limit(RETENTION_COMPLETION_BOUNDS.storageObjects + 1);
  const versionRows = await tx
    .select({
      id: documentVersions.id,
      objectPath: documentVersions.objectPath,
    })
    .from(documentVersions)
    .innerJoin(documents, eq(documents.id, documentVersions.documentId))
    .where(
      and(
        eq(documentVersions.organisationId, scope.organisationId),
        eq(documents.projectId, project.id),
      ),
    )
    .orderBy(asc(documentVersions.id))
    .limit(RETENTION_COMPLETION_BOUNDS.storageObjects + 1);
  const reportRows = await tx
    .select({
      id: reports.id,
      docxPath: reports.docxPath,
      pdfPath: reports.pdfPath,
    })
    .from(reports)
    .where(
      and(
        eq(reports.organisationId, scope.organisationId),
        eq(reports.projectId, project.id),
      ),
    )
    .orderBy(asc(reports.id))
    .limit(RETENTION_COMPLETION_BOUNDS.storageObjects + 1);
  const packageRows = await tx
    .select({ id: packages.id })
    .from(packages)
    .where(
      and(
        eq(packages.organisationId, scope.organisationId),
        eq(packages.projectId, project.id),
      ),
    )
    .orderBy(asc(packages.id))
    .limit(CATEGORY_IDENTITY_LIMIT + 1);
  const packageVersionRows = await tx
    .select({
      id: packageVersions.id,
      docxPath: packageVersions.docxObjectPath,
      pdfPath: packageVersions.pdfObjectPath,
      zipPath: packageVersions.zipObjectPath,
    })
    .from(packageVersions)
    .innerJoin(packages, eq(packages.id, packageVersions.packageId))
    .where(
      and(
        eq(packageVersions.organisationId, scope.organisationId),
        eq(packages.projectId, project.id),
      ),
    )
    .orderBy(asc(packageVersions.id))
    .limit(RETENTION_COMPLETION_BOUNDS.storageObjects + 1);
  const uploadRows = await tx
    .select({ id: uploadSessions.id })
    .from(uploadSessions)
    .where(
      and(
        eq(uploadSessions.organisationId, scope.organisationId),
        eq(uploadSessions.projectId, project.id),
      ),
    )
    .orderBy(asc(uploadSessions.id))
    .limit(RETENTION_COMPLETION_BOUNDS.storageObjects + 1);
  if (
    [
      documentRows,
      versionRows,
      reportRows,
      packageVersionRows,
      uploadRows,
    ].some(
      (rows) => rows.length > RETENTION_COMPLETION_BOUNDS.storageObjects,
    ) ||
    packageRows.length > CATEGORY_IDENTITY_LIMIT
  ) {
    blockers.push({
      code: "capacity_exceeded",
      message: "Retention source inventory exceeds the supported bound.",
    });
  }

  const byPath = new Map<
    string,
    RetentionManifestStorageObject["sourceKind"]
  >();
  const addPath = (
    objectPath: string | null,
    kind: RetentionManifestStorageObject["sourceKind"],
  ) => {
    if (!objectPath) return;
    if (!objectPath.startsWith(`/objects/tenants/${scope.organisationId}/`)) {
      blockers.push({
        code: "source_manifest_changed",
        message:
          "A project storage path is not in the governed tenant namespace.",
      });
      return;
    }
    if (!byPath.has(objectPath)) byPath.set(objectPath, kind);
  };
  for (const row of documentRows) addPath(row.objectPath, "document");
  for (const row of versionRows) addPath(row.objectPath, "document_version");
  for (const row of reportRows) {
    addPath(row.docxPath, "report");
    addPath(row.pdfPath, "report");
  }
  for (const row of packageVersionRows) {
    addPath(row.docxPath, "package_version");
    addPath(row.pdfPath, "package_version");
    addPath(row.zipPath, "package_version");
  }
  for (const row of uploadRows) {
    addPath(
      clientUploadObjectPath(scope.organisationId, row.id),
      "upload_session",
    );
    addPath(
      clientUploadDocumentPath(scope.organisationId, row.id),
      "upload_session",
    );
    addPath(
      clientUploadQuarantinePath(scope.organisationId, row.id),
      "upload_session",
    );
  }
  if (byPath.size > RETENTION_COMPLETION_BOUNDS.storageObjects) {
    blockers.push({
      code: "capacity_exceeded",
      message:
        "Retention storage object inventory exceeds the supported bound.",
      count: byPath.size,
    });
  }

  const pathInventoryExceeded =
    byPath.size > RETENTION_COMPLETION_BOUNDS.storageObjects;
  const paths = [...byPath.keys()].sort();
  const vaultReferences =
    paths.length === 0 || pathInventoryExceeded
      ? []
      : await tx
          .select({ id: vaultItems.id, objectPath: vaultItems.objectPath })
          .from(vaultItems)
          .where(
            and(
              eq(vaultItems.organisationId, scope.organisationId),
              inArray(vaultItems.objectPath, paths),
            ),
          )
          .orderBy(asc(vaultItems.id))
          .limit(RETENTION_COMPLETION_BOUNDS.storageObjects + 1);
  const retainedPaths = new Set(
    vaultReferences
      .map(({ objectPath }) => objectPath)
      .filter((path): path is string => Boolean(path)),
  );
  if (vaultReferences.length > RETENTION_COMPLETION_BOUNDS.storageObjects) {
    blockers.push({
      code: "capacity_exceeded",
      message:
        "Vault reference inventory exceeds the supported manifest bound.",
    });
  }
  const storageObjects = paths
    .filter((path) => !retainedPaths.has(path))
    .map((objectPath) => ({
      objectPath,
      objectPathSha256: sha256Hex(objectPath),
      sourceKind: byPath.get(objectPath)!,
    }));

  const relational = await tx.execute<{ category: string; id: string }>(sql`
    SELECT category, id FROM (
      SELECT 'projects'::text AS category, id::text FROM public.projects WHERE id = ${project.id}::uuid
      UNION ALL SELECT 'documents', id::text FROM public.documents WHERE organisation_id = ${scope.organisationId}::uuid AND project_id = ${project.id}::uuid
      UNION ALL SELECT 'requirements', id::text FROM public.requirements WHERE organisation_id = ${scope.organisationId}::uuid AND project_id = ${project.id}::uuid
      UNION ALL SELECT 'requirement_citations', citation.id::text FROM public.requirement_citations AS citation INNER JOIN public.requirements AS requirement ON requirement.id = citation.requirement_id WHERE citation.organisation_id = ${scope.organisationId}::uuid AND requirement.organisation_id = ${scope.organisationId}::uuid AND requirement.project_id = ${project.id}::uuid
      UNION ALL SELECT 'evidence_items', id::text FROM public.evidence_items WHERE organisation_id = ${scope.organisationId}::uuid AND project_id = ${project.id}::uuid
      UNION ALL SELECT 'defects', id::text FROM public.defects WHERE organisation_id = ${scope.organisationId}::uuid AND project_id = ${project.id}::uuid
      UNION ALL SELECT 'conflict_records', id::text FROM public.conflict_records WHERE organisation_id = ${scope.organisationId}::uuid AND project_id = ${project.id}::uuid
      UNION ALL SELECT 'boq_checks', id::text FROM public.boq_checks WHERE organisation_id = ${scope.organisationId}::uuid AND project_id = ${project.id}::uuid
      UNION ALL SELECT 'reports', id::text FROM public.reports WHERE organisation_id = ${scope.organisationId}::uuid AND project_id = ${project.id}::uuid
      UNION ALL SELECT 'llm_runs', id::text FROM public.llm_runs WHERE organisation_id = ${scope.organisationId}::uuid AND project_id = ${project.id}::uuid
      UNION ALL SELECT 'engagement_tender_lots', project_id::text || ':' || tender_lot_id::text FROM public.engagement_tender_lots WHERE organisation_id = ${scope.organisationId}::uuid AND project_id = ${project.id}::uuid
      UNION ALL SELECT 'upload_sessions', id::text FROM public.upload_sessions WHERE organisation_id = ${scope.organisationId}::uuid AND project_id = ${project.id}::uuid
      UNION ALL SELECT 'processing_jobs', id::text FROM public.processing_jobs WHERE organisation_id = ${scope.organisationId}::uuid AND project_id = ${project.id}::uuid
      UNION ALL SELECT 'processing_runs', run.id::text FROM public.processing_runs AS run INNER JOIN public.processing_jobs AS job ON job.id = run.job_id WHERE run.organisation_id = ${scope.organisationId}::uuid AND job.organisation_id = ${scope.organisationId}::uuid AND job.project_id = ${project.id}::uuid
      UNION ALL SELECT 'work_tasks', id::text FROM public.work_tasks WHERE organisation_id = ${scope.organisationId}::uuid AND project_id = ${project.id}::uuid
      UNION ALL SELECT 'comments', id::text FROM public.comments WHERE organisation_id = ${scope.organisationId}::uuid AND project_id = ${project.id}::uuid
      UNION ALL SELECT 'notification_events', id::text FROM public.notification_events WHERE organisation_id = ${scope.organisationId}::uuid AND project_id = ${project.id}::uuid
      UNION ALL SELECT 'notification_attempts', attempt.id::text FROM public.notification_attempts AS attempt INNER JOIN public.notification_events AS event ON event.id = attempt.notification_event_id WHERE attempt.organisation_id = ${scope.organisationId}::uuid AND event.organisation_id = ${scope.organisationId}::uuid AND event.project_id = ${project.id}::uuid
      UNION ALL SELECT 'reviews', id::text FROM public.reviews WHERE organisation_id = ${scope.organisationId}::uuid AND project_id = ${project.id}::uuid
      UNION ALL SELECT 'approvals', id::text FROM public.approvals WHERE organisation_id = ${scope.organisationId}::uuid AND project_id = ${project.id}::uuid
      UNION ALL SELECT 'defect_decisions', id::text FROM public.defect_decisions WHERE organisation_id = ${scope.organisationId}::uuid AND project_id = ${project.id}::uuid
      UNION ALL SELECT 'vault_usage', id::text FROM public.vault_usage WHERE organisation_id = ${scope.organisationId}::uuid AND project_id = ${project.id}::uuid
      UNION ALL SELECT 'capability_usage', id::text FROM public.capability_usage WHERE organisation_id = ${scope.organisationId}::uuid AND project_id = ${project.id}::uuid
      UNION ALL SELECT 'boq_runs', id::text FROM public.boq_runs WHERE organisation_id = ${scope.organisationId}::uuid AND project_id = ${project.id}::uuid
      UNION ALL SELECT 'boq_exceptions', exception.id::text FROM public.boq_exceptions AS exception INNER JOIN public.boq_runs AS run ON run.id = exception.boq_run_id WHERE exception.organisation_id = ${scope.organisationId}::uuid AND run.organisation_id = ${scope.organisationId}::uuid AND run.project_id = ${project.id}::uuid
      UNION ALL SELECT 'drafts', id::text FROM public.drafts WHERE organisation_id = ${scope.organisationId}::uuid AND project_id = ${project.id}::uuid
      UNION ALL SELECT 'draft_versions', version.id::text FROM public.draft_versions AS version INNER JOIN public.drafts AS draft ON draft.id = version.draft_id WHERE version.organisation_id = ${scope.organisationId}::uuid AND draft.organisation_id = ${scope.organisationId}::uuid AND draft.project_id = ${project.id}::uuid
      UNION ALL SELECT 'draft_claims', claim.id::text FROM public.draft_claims AS claim INNER JOIN public.draft_versions AS version ON version.id = claim.draft_version_id INNER JOIN public.drafts AS draft ON draft.id = version.draft_id WHERE claim.organisation_id = ${scope.organisationId}::uuid AND version.organisation_id = ${scope.organisationId}::uuid AND draft.organisation_id = ${scope.organisationId}::uuid AND draft.project_id = ${project.id}::uuid
      UNION ALL SELECT 'claim_evidence_links', link.id::text FROM public.claim_evidence_links AS link INNER JOIN public.draft_claims AS claim ON claim.id = link.draft_claim_id INNER JOIN public.draft_versions AS version ON version.id = claim.draft_version_id INNER JOIN public.drafts AS draft ON draft.id = version.draft_id WHERE link.organisation_id = ${scope.organisationId}::uuid AND claim.organisation_id = ${scope.organisationId}::uuid AND version.organisation_id = ${scope.organisationId}::uuid AND draft.organisation_id = ${scope.organisationId}::uuid AND draft.project_id = ${project.id}::uuid
      UNION ALL SELECT 'red_team_runs', id::text FROM public.red_team_runs WHERE organisation_id = ${scope.organisationId}::uuid AND project_id = ${project.id}::uuid
      UNION ALL SELECT 'red_team_findings', finding.id::text FROM public.red_team_findings AS finding INNER JOIN public.red_team_runs AS run ON run.id = finding.red_team_run_id WHERE finding.organisation_id = ${scope.organisationId}::uuid AND run.organisation_id = ${scope.organisationId}::uuid AND run.project_id = ${project.id}::uuid
      UNION ALL SELECT 'packages', id::text FROM public.packages WHERE organisation_id = ${scope.organisationId}::uuid AND project_id = ${project.id}::uuid
      UNION ALL SELECT 'tender_context_versions', id::text FROM public.tender_context_versions WHERE organisation_id = ${scope.organisationId}::uuid AND project_id = ${project.id}::uuid
      UNION ALL SELECT 'tender_context_requirements', id::text FROM public.tender_context_requirements WHERE organisation_id = ${scope.organisationId}::uuid AND project_id = ${project.id}::uuid
      UNION ALL SELECT 'tender_context_artifacts', id::text FROM public.tender_context_artifacts WHERE organisation_id = ${scope.organisationId}::uuid AND project_id = ${project.id}::uuid
      UNION ALL SELECT 'tender_eligibility_passports', id::text FROM public.tender_eligibility_passports WHERE organisation_id = ${scope.organisationId}::uuid AND project_id = ${project.id}::uuid
      UNION ALL SELECT 'addendum_impact_assessments', id::text FROM public.addendum_impact_assessments WHERE organisation_id = ${scope.organisationId}::uuid AND project_id = ${project.id}::uuid
      UNION ALL SELECT 'addendum_impact_items', item.id::text FROM public.addendum_impact_items AS item INNER JOIN public.addendum_impact_assessments AS assessment ON assessment.id = item.assessment_id WHERE item.organisation_id = ${scope.organisationId}::uuid AND assessment.organisation_id = ${scope.organisationId}::uuid AND assessment.project_id = ${project.id}::uuid
      UNION ALL SELECT 'rule_evaluations', id::text FROM public.rule_evaluations WHERE organisation_id = ${scope.organisationId}::uuid AND project_id = ${project.id}::uuid
      UNION ALL SELECT 'outcomes', id::text FROM public.outcomes WHERE organisation_id = ${scope.organisationId}::uuid AND project_id = ${project.id}::uuid
      UNION ALL SELECT 'document_versions', version.id::text FROM public.document_versions AS version INNER JOIN public.documents AS document ON document.id = version.document_id WHERE version.organisation_id = ${scope.organisationId}::uuid AND document.project_id = ${project.id}::uuid
      UNION ALL SELECT 'package_versions', version.id::text FROM public.package_versions AS version INNER JOIN public.packages AS package ON package.id = version.package_id WHERE version.organisation_id = ${scope.organisationId}::uuid AND package.project_id = ${project.id}::uuid
      UNION ALL SELECT 'package_manifest_items', item.id::text FROM public.package_manifest_items AS item INNER JOIN public.package_versions AS version ON version.id = item.package_version_id INNER JOIN public.packages AS package ON package.id = version.package_id WHERE item.organisation_id = ${scope.organisationId}::uuid AND version.organisation_id = ${scope.organisationId}::uuid AND package.organisation_id = ${scope.organisationId}::uuid AND package.project_id = ${project.id}::uuid
    ) AS inventory
    ORDER BY category, id
    LIMIT ${SOURCE_TOTAL_IDENTITY_LIMIT + 1}
  `);
  if (relational.rows.length > SOURCE_TOTAL_IDENTITY_LIMIT) {
    blockers.push({
      code: "capacity_exceeded",
      message:
        "Retention relational source inventory exceeds the supported bound.",
    });
  }
  const byCategory = new Map<string, string[]>();
  for (const row of relational.rows) {
    const ids = byCategory.get(row.category) ?? [];
    ids.push(row.id);
    byCategory.set(row.category, ids);
  }
  const categories: RetentionManifestCategory[] = [];
  for (const category of [...byCategory.keys()].sort()) {
    addCategory(categories, category, byCategory.get(category)!);
  }
  addCategory(
    categories,
    "legal_holds",
    legal.map(({ id }) => id),
  );
  addCategory(categories, "orders", orderIds);
  addCategory(categories, "invoices", invoiceIds);
  addCategory(
    categories,
    "payments",
    paymentRows.map(({ id }) => id),
  );
  addCategory(
    categories,
    "entitlement_usage",
    entitlementRows.map(({ id }) => id),
  );
  addCategory(
    categories,
    "vault_items",
    vaultReferences.map(({ id }) => id),
  );
  addCategory(
    categories,
    "document_version_snapshots",
    immutableSnapshots.map(({ id }) => id),
  );
  addCategory(
    categories,
    "claims_desk_records",
    claims.records.map(({ id }) => id),
  );

  const auditIdentityRows = await tx
    .select({
      id: auditEvents.id,
      seq: auditEvents.seq,
      hash: auditEvents.hash,
    })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.organisationId, scope.organisationId),
        eq(auditEvents.projectId, project.id),
      ),
    )
    .orderBy(asc(auditEvents.seq), asc(auditEvents.id))
    .limit(CATEGORY_IDENTITY_LIMIT + 1);
  addCategory(
    categories,
    "audit_events",
    auditIdentityRows.map(({ id, seq, hash }) => `${id}:${seq}:${hash}`),
  );

  const accountingIds = [
    ...orderIds,
    ...invoiceIds,
    ...paymentRows.map(({ id }) => id),
  ];
  const auditCountRows = await tx
    .select({
      count: sql<number>`pg_catalog.least(pg_catalog.count(*), 1000001)::integer`,
    })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.organisationId, scope.organisationId),
        eq(auditEvents.projectId, project.id),
      ),
    );
  const auditCount = auditCountRows[0]?.count;
  if (!Number.isSafeInteger(auditCount) || Number(auditCount) < 0) {
    throw new RetentionCompletionError(
      "persistence_unavailable",
      "Audit retention count is unavailable.",
    );
  }
  const retainedCategoryCandidates: RetainedCategoryView[] = [
    {
      category: "audit_evidence",
      reason:
        "tamper-evident project history remains in the tenant audit chain",
      count: Number(auditCount),
    },
    {
      category: "financial_accounting",
      reason:
        "settled orders, invoices and payments are retained accounting records",
      count: accountingIds.length,
    },
    {
      category: "legal_hold_evidence",
      reason:
        "released legal-hold evidence is retained independently of project content",
      count: legal.length,
    },
    {
      category: "retention_control",
      reason:
        "the request, action, storage bindings and certificate remain immutable control evidence",
      count: 2 + storageObjects.length,
    },
    {
      category: "vault_reference",
      reason:
        "tenant vault objects remain while referenced by the governed vault",
      count: vaultReferences.length,
    },
  ];
  const retainedCategories = retainedCategoryCandidates.filter(
    ({ count }) => count > 0,
  );
  retainedCategories.sort((left, right) =>
    left.category < right.category
      ? -1
      : left.category > right.category
        ? 1
        : 0,
  );
  categories.sort((left, right) =>
    left.category < right.category
      ? -1
      : left.category > right.category
        ? 1
        : 0,
  );
  return {
    categories,
    storageObjects,
    retainedCategories,
    legalHoldIds: legal.map(({ id }) => id),
    orderIds,
    entitlementUsageIds: entitlementRows.map(({ id }) => id),
    documentVersionSnapshotIds: immutableSnapshots.map(({ id }) => id),
    blockers,
  };
}

function ensureNoBlockers(
  blockers: readonly RetentionCompletionBlocker[],
): void {
  if (blockers.length > 0) {
    throw new RetentionCompletionError(
      blockers.some(({ code }) => code === "capacity_exceeded")
        ? "capacity_exceeded"
        : "state_conflict",
      blockers[0]!.message,
    );
  }
}

async function lockRequest(
  tx: RetentionTx,
  scope: RetentionCompletionScope,
  requestId: string,
): Promise<RequestRow> {
  const locator = await tx
    .select({ subjectProjectId: retentionRequests.subjectProjectId })
    .from(retentionRequests)
    .where(
      and(
        eq(retentionRequests.id, requestId),
        eq(retentionRequests.organisationId, scope.organisationId),
      ),
    )
    .limit(2);
  if (locator.length !== 1) {
    throw new RetentionCompletionError(
      "not_found_or_not_authorized",
      "Retention request was not found.",
    );
  }
  await tx.execute(
    sql`SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(${locator[0]!.subjectProjectId}, 0))`,
  );
  await tx.execute(sql`
    SELECT id FROM public.retention_requests
    WHERE id = ${requestId}::uuid
      AND organisation_id = ${scope.organisationId}::uuid
    FOR UPDATE
  `);
  const requests = await tx
    .select()
    .from(retentionRequests)
    .where(
      and(
        eq(retentionRequests.id, requestId),
        eq(retentionRequests.organisationId, scope.organisationId),
      ),
    )
    .limit(2);
  if (requests.length !== 1) {
    throw new RetentionCompletionError(
      "not_found_or_not_authorized",
      "Retention request was not found.",
    );
  }
  const request = requests[0]!;
  if (request.subjectProjectId !== locator[0]!.subjectProjectId) {
    throw new RetentionCompletionError(
      "stale_version",
      "Retention subject changed while acquiring its lock.",
    );
  }
  return request;
}

async function lockLiveProject(
  tx: RetentionTx,
  scope: RetentionCompletionScope,
  request: RequestRow,
): Promise<typeof projects.$inferSelect> {
  await tx.execute(sql`
    SELECT id FROM public.projects
    WHERE id = ${request.subjectProjectId}::uuid
      AND organisation_id = ${scope.organisationId}::uuid
    FOR UPDATE
  `);
  const projectRows = await tx
    .select()
    .from(projects)
    .where(
      and(
        eq(projects.id, request.subjectProjectId),
        eq(projects.organisationId, scope.organisationId),
      ),
    )
    .limit(2);
  if (projectRows.length !== 1) {
    throw new RetentionCompletionError(
      "state_conflict",
      "The retention subject project is no longer available for detach.",
    );
  }
  return projectRows[0]!;
}

async function lockActionAndRequest(
  tx: RetentionTx,
  scope: RetentionCompletionScope,
  actionId: string,
): Promise<{ action: ActionRow; request: RequestRow }> {
  const locator = await tx
    .select({ subjectProjectId: retentionActions.subjectProjectId })
    .from(retentionActions)
    .where(
      and(
        eq(retentionActions.id, actionId),
        eq(retentionActions.organisationId, scope.organisationId),
      ),
    )
    .limit(2);
  if (locator.length !== 1 || !locator[0]!.subjectProjectId) {
    throw new RetentionCompletionError(
      "not_found_or_not_authorized",
      "Retention action was not found.",
    );
  }
  await tx.execute(
    sql`SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(${locator[0]!.subjectProjectId}, 0))`,
  );
  await tx.execute(sql`
    SELECT id FROM public.retention_actions
    WHERE id = ${actionId}::uuid
      AND organisation_id = ${scope.organisationId}::uuid
    FOR UPDATE
  `);
  const actions = await tx
    .select()
    .from(retentionActions)
    .where(
      and(
        eq(retentionActions.id, actionId),
        eq(retentionActions.organisationId, scope.organisationId),
      ),
    )
    .limit(2);
  if (actions.length !== 1) {
    throw new RetentionCompletionError(
      "not_found_or_not_authorized",
      "Retention action was not found.",
    );
  }
  const action = actions[0]!;
  if (action.subjectProjectId !== locator[0]!.subjectProjectId) {
    throw new RetentionCompletionError(
      "stale_version",
      "Retention subject changed while acquiring its lock.",
    );
  }
  await tx.execute(sql`
    SELECT id FROM public.retention_requests
    WHERE id = ${action.retentionRequestId!}::uuid
      AND organisation_id = ${scope.organisationId}::uuid
    FOR UPDATE
  `);
  const requests = await tx
    .select()
    .from(retentionRequests)
    .where(
      and(
        eq(retentionRequests.id, action.retentionRequestId!),
        eq(retentionRequests.organisationId, scope.organisationId),
      ),
    )
    .limit(2);
  if (requests.length !== 1) {
    throw new RetentionCompletionError(
      "persistence_unavailable",
      "Retention action request evidence is unavailable.",
    );
  }
  return { action, request: requests[0]! };
}

function exactReplay(
  manifest: {
    idempotencyKeySha256: string;
    attestationSha256: string;
  },
  command: RetentionCompletionMutationCommand,
): boolean {
  if (manifest.idempotencyKeySha256 !== command.idempotencyKeySha256) {
    return false;
  }
  if (manifest.attestationSha256 !== command.attestationSha256) {
    throw new RetentionCompletionError(
      "idempotency_conflict",
      "The idempotency key is already bound to different retention controls.",
    );
  }
  return true;
}

export class DrizzleRetentionCompletionRepository implements RetentionCompletionRepository {
  async databaseNow(scope: RetentionCompletionScope): Promise<Date> {
    return withPersistenceBoundary(async () => {
      assertTenant(scope);
      const now = await databaseTime(db);
      await assertCurrentAuthority(db, scope, now, false);
      return now;
    });
  }

  async list(
    scope: RetentionCompletionScope,
    _permissions: RetentionCompletionPermissions,
  ): Promise<readonly RetentionRequestView[]> {
    return withPersistenceBoundary(async () => {
      assertTenant(scope);
      const now = await databaseTime(db);
      await assertCurrentAuthority(db, scope, now, false);
      const rows = await db
        .select()
        .from(retentionRequests)
        .where(eq(retentionRequests.organisationId, scope.organisationId))
        .orderBy(desc(retentionRequests.createdAt), desc(retentionRequests.id))
        .limit(RETENTION_COMPLETION_BOUNDS.listRows);
      return rows.map(requestView);
    });
  }

  async read(
    scope: RetentionCompletionScope,
    requestId: string,
    _permissions: RetentionCompletionPermissions,
  ): Promise<RetentionCompletionSnapshot> {
    return withPersistenceBoundary(async () => {
      assertTenant(scope);
      const now = await databaseTime(db);
      await assertCurrentAuthority(db, scope, now, false);
      const rows = await db
        .select()
        .from(retentionRequests)
        .where(
          and(
            eq(retentionRequests.id, requestId),
            eq(retentionRequests.organisationId, scope.organisationId),
          ),
        )
        .limit(2);
      if (rows.length !== 1) {
        throw new RetentionCompletionError(
          "not_found_or_not_authorized",
          "Retention request was not found.",
        );
      }
      const request = rows[0]!;
      const blockers: RetentionCompletionBlocker[] = [];
      if (request.status === "pending") {
        if (request.dueAt > now) {
          blockers.push({
            code: "request_not_due",
            message: "The retention request is not yet due.",
          });
        }
        const projectRows = await db
          .select()
          .from(projects)
          .where(
            and(
              eq(projects.id, request.subjectProjectId),
              eq(projects.organisationId, scope.organisationId),
            ),
          )
          .limit(2);
        if (projectRows.length !== 1) {
          blockers.push({
            code: "request_state_conflict",
            message: "The live retention subject is unavailable.",
          });
        } else {
          if (
            projectRows[0]!.status !== "signed_off" &&
            projectRows[0]!.status !== "exported"
          ) {
            blockers.push({
              code: "project_not_concluded",
              message:
                "Only signed-off or exported projects can complete retention.",
            });
          }
          const inventory = await inspectInventory(
            db,
            scope,
            request.id,
            projectRows[0]!,
            now,
          );
          blockers.push(...inventory.blockers);
        }
      }
      return buildSnapshot(db, request, scope.actorUserId, now, blockers);
    });
  }

  async detach(
    scope: RetentionCompletionScope,
    requestId: string,
    command: RetentionCompletionMutationCommand,
    _permissions: RetentionCompletionPermissions,
  ): Promise<RetentionCompletionSnapshot> {
    return withDetachPersistenceBoundary(async () => {
      assertTenant(scope);
      return db.transaction(async (tx) => {
        const now = await databaseTime(tx);
        const authority = await assertCurrentAuthority(tx, scope, now, true);
        const request = await lockRequest(tx, scope, requestId);
        assertMutableCompletionProtocol(request);
        const existingActions = await tx
          .select()
          .from(retentionActions)
          .where(
            and(
              eq(retentionActions.organisationId, scope.organisationId),
              eq(retentionActions.retentionRequestId, request.id),
            ),
          )
          .orderBy(desc(retentionActions.createdAt))
          .limit(2);
        if (existingActions.length > 1) {
          throw new RetentionCompletionError(
            "persistence_unavailable",
            "Retention request has ambiguous action evidence.",
          );
        }
        const existing = existingActions[0];
        if (existing?.sourceManifest && existing.sourceManifestSha256) {
          const source = parseRetentionSourceManifest(
            existing.sourceManifest,
            existing.sourceManifestSha256,
          );
          if (exactReplay(source, command)) {
            return buildSnapshot(tx, request, scope.actorUserId, now);
          }
        }
        if (request.version !== command.expectedVersion) {
          throw new RetentionCompletionError(
            "stale_version",
            "The retention request changed; refresh before completing it.",
          );
        }
        if (request.status !== "pending" || existing) {
          throw new RetentionCompletionError(
            "state_conflict",
            "The retention request is not eligible for detach.",
          );
        }
        const project = await lockLiveProject(tx, scope, request);
        const simpleBlockers: RetentionCompletionBlocker[] = [];
        if (request.dueAt > now) {
          simpleBlockers.push({
            code: "request_not_due",
            message: "The retention request is not yet due.",
          });
        }
        if (request.projectId !== project.id) {
          simpleBlockers.push({
            code: "request_state_conflict",
            message: "The retention request no longer binds the live project.",
          });
        }
        if (project.status !== "signed_off" && project.status !== "exported") {
          simpleBlockers.push({
            code: "project_not_concluded",
            message:
              "Only signed-off or exported projects can complete retention.",
          });
        }
        ensureNoBlockers(simpleBlockers);
        const inventory = await inspectInventory(
          tx,
          scope,
          request.id,
          project,
          now,
        );
        ensureNoBlockers(inventory.blockers);
        const actionId = randomUUID();
        await tx.insert(retentionActions).values({
          id: actionId,
          organisationId: scope.organisationId,
          retentionRequestId: request.id,
          objectType: "project",
          objectId: project.id,
          action: "delete",
          subjectProjectId: project.id,
          status: "pending",
          completionProtocolVersion: 1,
          version: 1,
          createdAt: now,
          updatedAt: now,
        });

        const bindingRows: Array<{
          eventId: string;
          requestSha256: string;
          objectPathSha256: string;
          boundEventVersion: number;
        }> = [];
        for (const object of inventory.storageObjects) {
          await lockStagedUploadObject(object.objectPath);
        }
        for (const object of inventory.storageObjects) {
          const queued = await enqueueStorageDeletionIntentTx(tx, {
            organisationId: scope.organisationId,
            projectId: project.id,
            objectPath: object.objectPath,
            aggregateType: "project_retention",
            aggregateId: actionId,
            reason: "retention_completion",
            requestedAt: now,
            actor: authority.actor,
            auditProjectId: null,
          });
          bindingRows.push({
            eventId: queued.id,
            requestSha256: queued.envelope.requestSha256,
            objectPathSha256: object.objectPathSha256,
            boundEventVersion: queued.version,
          });
        }
        if (bindingRows.length > 0) {
          await tx.insert(retentionActionStorageEvents).values(
            bindingRows.map((binding) => ({
              id: randomUUID(),
              organisationId: scope.organisationId,
              retentionActionId: actionId,
              storageEventId: binding.eventId,
              requestSha256: binding.requestSha256,
              objectPathSha256: binding.objectPathSha256,
              boundEventVersion: binding.boundEventVersion,
              version: 1,
              createdAt: now,
              updatedAt: now,
            })),
          );
        }
        const projectStatus =
          project.status === "signed_off" ? "signed_off" : "exported";
        const manifestStorageObjects = inventory.storageObjects
          .map(({ objectPathSha256, sourceKind }) => ({
            objectPathSha256,
            sourceKind,
          }))
          .sort((left, right) => {
            const leftKey = `${left.objectPathSha256}\0${left.sourceKind}`;
            const rightKey = `${right.objectPathSha256}\0${right.sourceKind}`;
            return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
          });
        const sourceManifest: RetentionSourceManifest = {
          schema: RETENTION_SOURCE_MANIFEST_SCHEMA,
          organisationId: scope.organisationId,
          retentionRequestId: request.id,
          retentionActionId: actionId,
          subjectProjectId: project.id,
          requestVersion: request.version,
          projectVersion: project.version,
          projectStatus,
          capturedAt: now.toISOString(),
          idempotencyKeySha256: command.idempotencyKeySha256,
          attestationSha256: command.attestationSha256,
          categories: inventory.categories,
          storageObjects: manifestStorageObjects,
          retainedCategories: inventory.retainedCategories,
        };
        const sourceSerialized = serializeRetentionManifest(sourceManifest);
        const sourceSha256 = retentionManifestSha256(sourceManifest);
        const evidence = serializeRetentionManifest({
          schema: "valo.retention-completion-control-evidence/v1",
          actionId,
          sourceManifestSha256: sourceSha256,
          idempotencyKeySha256: command.idempotencyKeySha256,
          attestationSha256: command.attestationSha256,
        });
        const actionUpdated = await tx
          .update(retentionActions)
          .set({
            status: "detached",
            evidence,
            sourceManifest: sourceSerialized,
            sourceManifestSha256: sourceSha256,
            executedByUserId: authority.actor.id,
            executedByName: authority.actorName,
            executedAt: now,
            version: 2,
            updatedAt: now,
          })
          .where(
            and(
              eq(retentionActions.id, actionId),
              eq(retentionActions.organisationId, scope.organisationId),
              eq(retentionActions.status, "pending"),
              eq(retentionActions.version, 1),
            ),
          )
          .returning({ id: retentionActions.id });
        if (actionUpdated.length !== 1) {
          throw new RetentionCompletionError(
            "stale_version",
            "Retention action changed during detach.",
          );
        }
        const requestUpdated = await tx
          .update(retentionRequests)
          .set({
            status: "reconciling",
            version: request.version + 1,
            updatedAt: now,
          })
          .where(
            and(
              eq(retentionRequests.id, request.id),
              eq(retentionRequests.organisationId, scope.organisationId),
              eq(retentionRequests.status, "pending"),
              eq(retentionRequests.version, request.version),
            ),
          )
          .returning();
        if (requestUpdated.length !== 1) {
          throw new RetentionCompletionError(
            "stale_version",
            "Retention request changed during detach.",
          );
        }
        const purge = await tx.execute<{
          deletedProjectRows: number;
          deletedDocumentVersionSnapshotRows: number;
          detachedLegalHoldRows: number;
          detachedOrderRows: number;
          detachedEntitlementUsageRows: number;
          purgeReceiptSha256: string;
          postPurgeActionVersion: number;
        }>(sql`
          SELECT
            deleted_project_rows::integer AS "deletedProjectRows",
            deleted_document_version_snapshot_rows::integer AS "deletedDocumentVersionSnapshotRows",
            detached_legal_hold_rows::integer AS "detachedLegalHoldRows",
            detached_order_rows::integer AS "detachedOrderRows",
            detached_entitlement_usage_rows::integer AS "detachedEntitlementUsageRows",
            purge_receipt_sha256 AS "purgeReceiptSha256",
            post_purge_action_version::integer AS "postPurgeActionVersion"
          FROM valo_security.purge_retention_project(
            ${scope.organisationId}::uuid,
            ${request.id}::uuid,
            ${actionId}::uuid,
            ${project.id}::uuid,
            ${sourceSha256},
            2
          )
        `);
        const receipt = purge.rows[0];
        if (
          purge.rows.length !== 1 ||
          receipt?.deletedProjectRows !== 1 ||
          receipt.deletedDocumentVersionSnapshotRows !==
            inventory.documentVersionSnapshotIds.length ||
          receipt.detachedLegalHoldRows !== inventory.legalHoldIds.length ||
          receipt.detachedOrderRows !== inventory.orderIds.length ||
          receipt.detachedEntitlementUsageRows !==
            inventory.entitlementUsageIds.length ||
          !/^[0-9a-f]{64}$/u.test(receipt.purgeReceiptSha256) ||
          receipt.postPurgeActionVersion !== 3
        ) {
          throw new RetentionCompletionError(
            "persistence_unavailable",
            "The governed relational purge receipt did not match the source manifest.",
          );
        }
        const detachedRequests = await tx
          .select()
          .from(retentionRequests)
          .where(
            and(
              eq(retentionRequests.id, request.id),
              eq(retentionRequests.organisationId, scope.organisationId),
            ),
          )
          .limit(2);
        const detachedRequest = detachedRequests[0];
        if (
          detachedRequests.length !== 1 ||
          !detachedRequest ||
          detachedRequest.projectId !== null ||
          detachedRequest.subjectProjectId !== project.id ||
          detachedRequest.status !== "reconciling" ||
          detachedRequest.version !== request.version + 1
        ) {
          throw new RetentionCompletionError(
            "persistence_unavailable",
            "The retention request was not durably detached from its live project locator.",
          );
        }
        const detachedActions = await tx
          .select()
          .from(retentionActions)
          .where(
            and(
              eq(retentionActions.id, actionId),
              eq(retentionActions.organisationId, scope.organisationId),
            ),
          )
          .limit(2);
        const detachedAction = detachedActions[0];
        if (
          detachedActions.length !== 1 ||
          !detachedAction ||
          detachedAction.status !== "detached" ||
          detachedAction.version !== receipt.postPurgeActionVersion ||
          detachedAction.sourceManifestSha256 !== sourceSha256 ||
          detachedAction.purgeReceiptSha256 !== receipt.purgeReceiptSha256
        ) {
          throw new RetentionCompletionError(
            "persistence_unavailable",
            "The owner-held relational purge stamp was not persisted exactly.",
          );
        }
        const purgeProof = await verifyOwnerPurgeProof(
          tx,
          detachedAction,
          detachedRequest,
        );
        if (
          purgeProof.deletedProjectRows !== receipt.deletedProjectRows ||
          purgeProof.deletedDocumentVersionSnapshotRows !==
            receipt.deletedDocumentVersionSnapshotRows ||
          purgeProof.detachedLegalHoldRows !== receipt.detachedLegalHoldRows ||
          purgeProof.detachedOrderRows !== receipt.detachedOrderRows ||
          purgeProof.detachedEntitlementUsageRows !==
            receipt.detachedEntitlementUsageRows
        ) {
          throw new RetentionCompletionError(
            "persistence_unavailable",
            "The owner-held relational purge receipt counts are inconsistent.",
          );
        }
        await writeAuditTx(tx, {
          user: authority.actor,
          organisationId: scope.organisationId,
          projectId: project.id,
          eventType: "retention.detached",
          objectType: "retention_action",
          objectId: actionId,
          details: serializeRetentionManifest({
            schema: "valo.retention-completion-audit-receipt/v1",
            subjectProjectId: project.id,
            sourceManifestSha256: sourceSha256,
            purgeReceiptSha256: receipt.purgeReceiptSha256,
            storageEventCount: bindingRows.length,
            occurredAt: now.toISOString(),
          }),
          createdAt: now,
        });
        return buildSnapshot(tx, detachedRequest, scope.actorUserId, now);
      });
    });
  }

  async reconcile(
    scope: RetentionCompletionScope,
    actionId: string,
    command: RetentionCompletionMutationCommand,
    _permissions: RetentionCompletionPermissions,
  ): Promise<RetentionCompletionSnapshot> {
    return withPersistenceBoundary(async () => {
      assertTenant(scope);
      return db.transaction(async (tx) => {
        const now = await databaseTime(tx);
        const authority = await assertCurrentAuthority(tx, scope, now, true);
        const { action, request } = await lockActionAndRequest(
          tx,
          scope,
          actionId,
        );
        assertMutableCompletionProtocol(request, action);
        if (
          action.reconciliationManifest &&
          action.reconciliationManifestSha256
        ) {
          const persisted = parseRetentionReconciliationManifest(
            action.reconciliationManifest,
            action.reconciliationManifestSha256,
          );
          if (exactReplay(persisted, command)) {
            return buildSnapshot(tx, request, scope.actorUserId, now);
          }
        }
        if (action.version !== command.expectedVersion) {
          throw new RetentionCompletionError(
            "stale_version",
            "The retention action changed; refresh before reconciling it.",
          );
        }
        if (
          action.status !== "detached" ||
          action.version !== 3 ||
          !action.sourceManifest ||
          !action.sourceManifestSha256
        ) {
          throw new RetentionCompletionError(
            "state_conflict",
            "The retention action is not detached and eligible for reconciliation.",
          );
        }
        const purgeProof = await verifyOwnerPurgeProof(tx, action, request);
        const source = parseRetentionSourceManifest(
          action.sourceManifest,
          action.sourceManifestSha256,
        );
        const evidence = await loadBindingEvidence(
          tx,
          scope.organisationId,
          action.id,
          true,
        );
        const expectedHashes = source.storageObjects
          .map(({ objectPathSha256 }) => objectPathSha256)
          .sort();
        const actualHashes = evidence
          .map(({ binding }) => binding.objectPathSha256)
          .sort();
        if (
          expectedHashes.length !== actualHashes.length ||
          expectedHashes.some((hash, index) => hash !== actualHashes[index])
        ) {
          throw new RetentionCompletionError(
            "state_conflict",
            "The storage binding set no longer matches the immutable source manifest.",
          );
        }
        const terminalEvents: RetentionReconciliationManifestEvent[] = [];
        let pending = 0;
        let deadLetters = 0;
        let untrusted = 0;
        for (const item of evidence) {
          const envelope = item.event.payload
            ? parseStorageDeletionIntent(item.event.payload)
            : null;
          if (
            !envelope ||
            envelope.organisationId !== scope.organisationId ||
            envelope.projectId !== action.subjectProjectId ||
            envelope.aggregateType !== "project_retention" ||
            envelope.aggregateId !== action.id ||
            envelope.reason !== "retention_completion" ||
            envelope.requestSha256 !== item.binding.requestSha256 ||
            sha256Hex(envelope.objectPath) !== item.binding.objectPathSha256 ||
            item.event.version < item.binding.boundEventVersion
          ) {
            throw new RetentionCompletionError(
              "persistence_unavailable",
              "A bound storage deletion intent failed identity verification.",
            );
          }
          if (item.binding.terminalDisposition) {
            if (
              item.binding.terminalDisposition === "deleted" ||
              item.binding.terminalDisposition === "already_absent"
            ) {
              terminalEvents.push({
                storageEventId: item.binding.storageEventId,
                requestSha256: item.binding.requestSha256,
                objectPathSha256: item.binding.objectPathSha256,
                boundEventVersion: item.binding.boundEventVersion,
                terminalDisposition: item.binding.terminalDisposition,
                terminalEventVersion: item.binding.terminalEventVersion!,
                terminalAt: instant(item.binding.terminalAt)!,
              });
            } else {
              untrusted += 1;
            }
            continue;
          }
          const decision = decideStorageTerminalEvidence({
            eventStatus: item.event.status,
            eventVersion: item.event.version,
            terminalAt: item.event.storageTerminalAt,
            latestAttemptStatus: item.latestAttempt?.status ?? null,
            latestAttemptResponseCode: item.latestAttempt?.responseCode ?? null,
          });
          if (decision.outcome === "pending") {
            pending += 1;
            continue;
          }
          if (decision.outcome === "dead_letter") {
            deadLetters += 1;
            continue;
          }
          if (decision.outcome === "untrusted") {
            untrusted += 1;
            if (
              item.event.status === "cancelled" &&
              item.latestAttempt?.status === "cancelled_referenced"
            ) {
              const updated = await tx
                .update(retentionActionStorageEvents)
                .set({
                  terminalDisposition: "cancelled_referenced",
                  terminalEventVersion: item.event.version,
                  terminalAt: item.event.storageTerminalAt,
                  version: item.binding.version + 1,
                  updatedAt: now,
                })
                .where(
                  and(
                    eq(retentionActionStorageEvents.id, item.binding.id),
                    eq(
                      retentionActionStorageEvents.version,
                      item.binding.version,
                    ),
                  ),
                )
                .returning({ id: retentionActionStorageEvents.id });
              if (updated.length !== 1) {
                throw new RetentionCompletionError(
                  "stale_version",
                  "Storage reconciliation evidence changed concurrently.",
                );
              }
            } else if (item.event.status === "resolved") {
              const updated = await tx
                .update(retentionActionStorageEvents)
                .set({
                  terminalDisposition: "accepted_unresolved",
                  terminalEventVersion: item.event.version,
                  terminalAt: item.event.storageTerminalAt,
                  version: item.binding.version + 1,
                  updatedAt: now,
                })
                .where(
                  and(
                    eq(retentionActionStorageEvents.id, item.binding.id),
                    eq(
                      retentionActionStorageEvents.version,
                      item.binding.version,
                    ),
                  ),
                )
                .returning({ id: retentionActionStorageEvents.id });
              if (updated.length !== 1) {
                throw new RetentionCompletionError(
                  "stale_version",
                  "Storage reconciliation evidence changed concurrently.",
                );
              }
            }
            continue;
          }
          const updated = await tx
            .update(retentionActionStorageEvents)
            .set({
              terminalDisposition: decision.disposition,
              terminalEventVersion: decision.terminalEventVersion,
              terminalAt: decision.terminalAt,
              version: item.binding.version + 1,
              updatedAt: now,
            })
            .where(
              and(
                eq(retentionActionStorageEvents.id, item.binding.id),
                eq(retentionActionStorageEvents.version, item.binding.version),
              ),
            )
            .returning({ id: retentionActionStorageEvents.id });
          if (updated.length !== 1) {
            throw new RetentionCompletionError(
              "stale_version",
              "Storage reconciliation evidence changed concurrently.",
            );
          }
          terminalEvents.push({
            storageEventId: item.binding.storageEventId,
            requestSha256: item.binding.requestSha256,
            objectPathSha256: item.binding.objectPathSha256,
            boundEventVersion: item.binding.boundEventVersion,
            terminalDisposition: decision.disposition,
            terminalEventVersion: decision.terminalEventVersion,
            terminalAt: decision.terminalAt.toISOString(),
          });
        }
        const progress = decideRetentionReconciliationProgress({
          pending,
          deadLetters,
          untrusted,
        });
        if (progress === "block_untrusted_terminal_evidence") {
          const blockedActions = await tx
            .update(retentionActions)
            .set({
              status: "blocked",
              version: action.version + 1,
              updatedAt: now,
            })
            .where(
              and(
                eq(retentionActions.id, action.id),
                eq(retentionActions.version, action.version),
                eq(retentionActions.status, "detached"),
              ),
            )
            .returning({ id: retentionActions.id });
          const blockedRequests = await tx
            .update(retentionRequests)
            .set({
              status: "blocked",
              version: request.version + 1,
              updatedAt: now,
            })
            .where(
              and(
                eq(retentionRequests.id, request.id),
                eq(retentionRequests.version, request.version),
              ),
            )
            .returning();
          if (blockedActions.length !== 1 || blockedRequests.length !== 1) {
            throw new RetentionCompletionError(
              "stale_version",
              "Retention evidence changed while recording a blocked outcome.",
            );
          }
          await writeAuditTx(tx, {
            user: authority.actor,
            organisationId: scope.organisationId,
            projectId: action.subjectProjectId,
            eventType: "retention.reconciliation_blocked",
            objectType: "retention_action",
            objectId: action.id,
            details: serializeRetentionManifest({
              schema: "valo.retention-completion-blocked-receipt/v1",
              deadLetters,
              untrusted,
              occurredAt: now.toISOString(),
            }),
            createdAt: now,
          });
          return buildSnapshot(
            tx,
            blockedRequests[0]!,
            scope.actorUserId,
            now,
            [
              {
                code: "storage_terminal_untrusted",
                message:
                  "A bound terminal storage outcome is not trustworthy deletion evidence.",
                count: untrusted,
              },
            ],
          );
        }
        if (progress === "wait_for_terminal_evidence") {
          return buildSnapshot(tx, request, scope.actorUserId, now);
        }
        terminalEvents.sort((left, right) =>
          left.storageEventId < right.storageEventId
            ? -1
            : left.storageEventId > right.storageEventId
              ? 1
              : 0,
        );
        const reconciliationManifest = {
          schema: RETENTION_RECONCILIATION_MANIFEST_SCHEMA,
          organisationId: scope.organisationId,
          retentionRequestId: request.id,
          retentionActionId: action.id,
          subjectProjectId: action.subjectProjectId!,
          sourceManifestSha256: action.sourceManifestSha256,
          purgeReceiptSha256: action.purgeReceiptSha256!,
          purgedAt: purgeProof.purgedAt,
          reconciledAt: now.toISOString(),
          idempotencyKeySha256: command.idempotencyKeySha256,
          attestationSha256: command.attestationSha256,
          events: terminalEvents,
        } as const;
        const serialized = serializeRetentionManifest(reconciliationManifest);
        const digest = retentionManifestSha256(reconciliationManifest);
        const updated = await tx
          .update(retentionActions)
          .set({
            status: "reconciled",
            reconciliationManifest: serialized,
            reconciliationManifestSha256: digest,
            preparedByUserId: authority.actor.id,
            preparedByName: authority.actorName,
            preparedAt: now,
            version: action.version + 1,
            updatedAt: now,
          })
          .where(
            and(
              eq(retentionActions.id, action.id),
              eq(retentionActions.status, "detached"),
              eq(retentionActions.version, action.version),
            ),
          )
          .returning({
            id: retentionActions.id,
            version: retentionActions.version,
          });
        if (updated.length !== 1 || updated[0]!.version !== 4) {
          throw new RetentionCompletionError(
            "stale_version",
            "Retention action changed during reconciliation.",
          );
        }
        await writeAuditTx(tx, {
          user: authority.actor,
          organisationId: scope.organisationId,
          projectId: action.subjectProjectId,
          eventType: "retention.reconciled",
          objectType: "retention_action",
          objectId: action.id,
          details: serializeRetentionManifest({
            schema: "valo.retention-completion-audit-receipt/v1",
            reconciliationManifestSha256: digest,
            terminalStorageEventCount: terminalEvents.length,
            occurredAt: now.toISOString(),
          }),
          createdAt: now,
        });
        return buildSnapshot(tx, request, scope.actorUserId, now);
      });
    });
  }

  async certify(
    scope: RetentionCompletionScope,
    actionId: string,
    command: RetentionCompletionMutationCommand,
    _permissions: RetentionCompletionPermissions,
  ): Promise<RetentionCompletionSnapshot> {
    return withPersistenceBoundary(async () => {
      assertTenant(scope);
      return db.transaction(async (tx) => {
        const now = await databaseTime(tx);
        const authority = await assertCurrentAuthority(tx, scope, now, true);
        const { action, request } = await lockActionAndRequest(
          tx,
          scope,
          actionId,
        );
        assertMutableCompletionProtocol(request, action);
        const existingCertificates = await tx
          .select()
          .from(deletionCertificates)
          .where(
            and(
              eq(deletionCertificates.organisationId, scope.organisationId),
              eq(deletionCertificates.retentionActionId, action.id),
            ),
          )
          .limit(2);
        if (existingCertificates.length > 1) {
          throw new RetentionCompletionError(
            "persistence_unavailable",
            "Retention action has ambiguous certificate evidence.",
          );
        }
        const existingCertificate = existingCertificates[0];
        if (
          existingCertificate?.certificateManifest &&
          existingCertificate.certificateManifestSha256
        ) {
          const manifest = parseRetentionCertificateManifest(
            existingCertificate.certificateManifest,
            existingCertificate.certificateManifestSha256,
          );
          if (exactReplay(manifest, command)) {
            return buildSnapshot(tx, request, scope.actorUserId, now);
          }
        }
        if (action.version !== command.expectedVersion) {
          throw new RetentionCompletionError(
            "stale_version",
            "The retention action changed; refresh before certifying it.",
          );
        }
        if (
          action.status !== "reconciled" ||
          action.version !== 4 ||
          !action.sourceManifest ||
          !action.sourceManifestSha256 ||
          !action.reconciliationManifest ||
          !action.reconciliationManifestSha256 ||
          !action.preparedByUserId ||
          !action.preparedByName ||
          !action.preparedAt
        ) {
          throw new RetentionCompletionError(
            "state_conflict",
            "The retention action is not reconciled and eligible for certification.",
          );
        }
        const purgeProof = await verifyOwnerPurgeProof(tx, action, request);
        if (action.preparedByUserId === authority.actor.id) {
          throw new RetentionCompletionError(
            "maker_checker_conflict",
            "The retention checker must be different from the preparer.",
          );
        }
        parseRetentionSourceManifest(
          action.sourceManifest,
          action.sourceManifestSha256,
        );
        const reconciliation = parseRetentionReconciliationManifest(
          action.reconciliationManifest,
          action.reconciliationManifestSha256,
        );
        if (
          reconciliation.sourceManifestSha256 !== action.sourceManifestSha256 ||
          reconciliation.purgeReceiptSha256 !== action.purgeReceiptSha256 ||
          reconciliation.purgedAt !== purgeProof.purgedAt ||
          reconciliation.events.some(
            ({ terminalDisposition }) =>
              terminalDisposition !== "deleted" &&
              terminalDisposition !== "already_absent",
          )
        ) {
          throw new RetentionCompletionError(
            "state_conflict",
            "Reconciliation evidence is not certificate-eligible.",
          );
        }
        const bindingEvidence = await loadBindingEvidence(
          tx,
          scope.organisationId,
          action.id,
          true,
        );
        if (
          bindingEvidence.length !== reconciliation.events.length ||
          bindingEvidence.some(
            ({ binding }) =>
              binding.terminalDisposition !== "deleted" &&
              binding.terminalDisposition !== "already_absent",
          )
        ) {
          throw new RetentionCompletionError(
            "state_conflict",
            "Exact trustworthy terminal storage evidence is required.",
          );
        }
        const certificateManifest = {
          schema: RETENTION_CERTIFICATE_MANIFEST_SCHEMA,
          organisationId: scope.organisationId,
          retentionRequestId: request.id,
          retentionActionId: action.id,
          subjectProjectId: action.subjectProjectId!,
          sourceManifestSha256: action.sourceManifestSha256,
          purgeReceiptSha256: action.purgeReceiptSha256!,
          purgedAt: purgeProof.purgedAt,
          reconciliationManifestSha256: action.reconciliationManifestSha256,
          preparedByUserId: action.preparedByUserId,
          preparedByName: action.preparedByName,
          preparedAt: action.preparedAt.toISOString(),
          checkedByUserId: authority.actor.id,
          checkedByName: authority.actorName,
          checkedAt: now.toISOString(),
          idempotencyKeySha256: command.idempotencyKeySha256,
          attestationSha256: command.attestationSha256,
          method: "durable_two_phase_detach_reconcile_certify",
        } as const;
        const certificateSerialized =
          serializeRetentionManifest(certificateManifest);
        const certificateSha256 = retentionManifestSha256(certificateManifest);
        const updated = await tx
          .update(retentionActions)
          .set({
            status: "certified",
            checkedByUserId: authority.actor.id,
            checkedByName: authority.actorName,
            checkedAt: now,
            version: action.version + 1,
            updatedAt: now,
          })
          .where(
            and(
              eq(retentionActions.id, action.id),
              eq(retentionActions.status, "reconciled"),
              eq(retentionActions.version, action.version),
            ),
          )
          .returning({
            id: retentionActions.id,
            version: retentionActions.version,
          });
        if (updated.length !== 1 || updated[0]!.version !== 5) {
          throw new RetentionCompletionError(
            "stale_version",
            "Retention action changed during certification.",
          );
        }
        const certificateNumber = `VALO-DEL-${action.id}`;
        const certificateId = randomUUID();
        await tx.insert(deletionCertificates).values({
          id: certificateId,
          organisationId: scope.organisationId,
          retentionActionId: action.id,
          certificateNumber,
          scopeManifestHash: action.sourceManifestSha256,
          certificateManifest: certificateSerialized,
          certificateManifestSha256: certificateSha256,
          method: "durable_two_phase_detach_reconcile_certify",
          completedAt: now,
          exceptions: null,
          signedByUserId: authority.actor.id,
          signedByName: authority.actorName,
          signatureEvidence: certificateSha256,
          createdAt: now,
        });
        const requestUpdated = await tx
          .update(retentionRequests)
          .set({
            status: "completed",
            completedAt: now,
            certificateText: certificateNumber,
            version: request.version + 1,
            updatedAt: now,
          })
          .where(
            and(
              eq(retentionRequests.id, request.id),
              eq(retentionRequests.organisationId, scope.organisationId),
              eq(retentionRequests.status, "reconciling"),
              eq(retentionRequests.version, request.version),
            ),
          )
          .returning();
        if (requestUpdated.length !== 1) {
          throw new RetentionCompletionError(
            "stale_version",
            "Retention request changed during certification.",
          );
        }
        await writeAuditTx(tx, {
          user: authority.actor,
          organisationId: scope.organisationId,
          projectId: action.subjectProjectId,
          eventType: "retention.certified",
          objectType: "deletion_certificate",
          objectId: certificateId,
          details: serializeRetentionManifest({
            schema: "valo.retention-completion-certificate-receipt/v1",
            certificateNumber,
            certificateManifestSha256: certificateSha256,
            occurredAt: now.toISOString(),
          }),
          createdAt: now,
        });
        return buildSnapshot(tx, requestUpdated[0]!, scope.actorUserId, now);
      });
    });
  }
}
