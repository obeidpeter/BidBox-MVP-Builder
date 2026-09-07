import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNull,
  like,
  lte,
  or,
  sql,
} from "drizzle-orm";
import {
  auditEvents,
  db,
  organisationMemberships,
  organisations,
  projects,
  roleGrants,
  users,
  vaultItems,
  withTenantDatabase,
  workTasks,
} from "@workspace/db";
import { writeAuditTx } from "../audit";
import { parseInstantViaString } from "../dbClock";
import { lockStagedUploadObject } from "../stagedUploadLock";
import { enqueueStorageDeletionIntentTx } from "../storageLifecycle/repository";
import {
  ORGANISATION_ROLES,
  hasPermission,
  isOrganisationRole,
  isOrganisationType,
  isRoleAllowedForOrganisation,
  type OrganisationRole,
  type OrganisationType,
  type Permission,
} from "../permissions";
import {
  EVIDENCE_RENEWAL_AUDIT_SCHEMA,
  EVIDENCE_RENEWAL_BOUNDS,
  EVIDENCE_RENEWAL_MANAGE_PERMISSION,
  EVIDENCE_RENEWAL_NAMESPACE,
  EVIDENCE_RENEWAL_READ_PERMISSION,
  EVIDENCE_RENEWAL_VERIFY_PERMISSION,
  EvidenceRenewalProjectAccessError,
  EvidenceRenewalUnavailableError,
  type EvidenceRenewalAuthorityList,
  type EvidenceRenewalCreateDraft,
  type EvidenceRenewalMutationOutcome,
  type EvidenceRenewalPlan,
  type EvidenceRenewalRepository,
  type EvidenceRenewalReviewDraft,
  type EvidenceRenewalScope,
  type EvidenceRenewalSnapshot,
  type EvidenceRenewalStageDraft,
} from "./contracts";
import {
  EVIDENCE_RENEWAL_AUTHORITY_NOTE,
  ZERO_SHA256,
  canonicalEvidenceRenewalJson,
  createEvidenceRenewalEventReceipt,
  deterministicEvidenceRenewalUuid,
  evidenceRenewalSha256,
  parseEvidenceRenewalEvent,
  reduceEvidenceRenewalLedger,
  serializeEvidenceRenewalEvent,
  type EvidenceRenewalCreationPayload,
  type EvidenceRenewalReviewPayload,
  type EvidenceRenewalStagePayload,
  type PersistedEvidenceRenewalEvent,
  type ReducedEvidenceRenewalPlan,
} from "./service";
import { promoteEvidenceRenewalWithStorageLifecycle } from "./approvalLifecycle";

import {
  SHA256_HEX_PATTERN as SHA256_PATTERN,
  UUID_PATTERN,
} from "../identifierPatterns";
const AUDIT_EVENT_PREFIX = "evidence_renewal." as const;
const AUDIT_OBJECT_TYPE = "evidence_renewal_plan" as const;
const MAX_AUDIT_RECEIPT_CODE_UNITS = 1_024;
const MAX_AUDIT_RECEIPT_BYTES = 2_048;

type RenewalTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

interface CurrentPerson {
  userId: string;
  name: string;
  membershipId: string;
  roles: readonly OrganisationRole[];
}

interface ProjectBoundary {
  clientId: string;
  status: string;
}

interface CanonicalDocument {
  documentId: string;
  documentVersionId: string;
  documentVersionNumber: number;
  sha256: string;
  objectPath: string;
}

interface AuditReceiptEnvelope {
  schema: typeof EVIDENCE_RENEWAL_AUDIT_SCHEMA;
  eventId: string;
  planId: string;
  aggregateVersion: number;
  kind: PersistedEvidenceRenewalEvent["kind"];
  receiptSha256: string;
}

function auditUser(person: CurrentPerson) {
  return {
    id: person.userId,
    name: person.name,
    email: "",
    role: "none" as const,
    status: "active" as const,
    clerkUserId: "",
    version: 1,
    lastLoginAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

function assertUuid(value: string, label: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw new EvidenceRenewalUnavailableError(`Invalid ${label}`);
  }
}

function assertScope(scope: EvidenceRenewalScope): void {
  assertUuid(scope.organisationId, "organisation scope");
  assertUuid(scope.projectId, "project scope");
  assertUuid(scope.actorUserId, "actor scope");
  assertUuid(scope.actorMembershipId, "membership scope");
}

function today(now: Date): string {
  if (!Number.isFinite(now.valueOf())) {
    throw new EvidenceRenewalUnavailableError("Invalid workflow clock");
  }
  return now.toISOString().slice(0, 10);
}

async function authoritativeDatabaseNow(tx: RenewalTx): Promise<Date> {
  const result = await tx.execute(
    sql`SELECT pg_catalog.clock_timestamp() AS now`,
  );
  const now = parseInstantViaString(result.rows[0]?.now);
  if (result.rows.length !== 1 || now === null) {
    throw new EvidenceRenewalUnavailableError(
      "Authoritative renewal clock is unavailable",
    );
  }
  return now;
}

async function configureTransactionBounds(tx: RenewalTx): Promise<void> {
  await tx.execute(sql`SET LOCAL lock_timeout = '3s'`);
}

function validName(value: string | null): value is string {
  return Boolean(
    value &&
    value === value.trim() &&
    value.length <= 512 &&
    !/[\u0000-\u001f\u007f\ud800-\udfff]/u.test(value),
  );
}

function validTitle(value: string): boolean {
  return (
    value.length >= 1 &&
    value.length <= 1_024 &&
    !/[\u0000-\u001f\u007f\ud800-\udfff]/u.test(value)
  );
}

async function lockMembershipAuthority(
  tx: RenewalTx,
  organisationId: string,
): Promise<void> {
  await tx.execute(sql`
    SELECT pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        ${`bidbox.membership-administration:${organisationId}`},
        0
      )
    )
  `);
}

async function lockRenewalProject(
  tx: RenewalTx,
  scope: Pick<EvidenceRenewalScope, "organisationId" | "projectId">,
): Promise<void> {
  await tx.execute(sql`
    SELECT pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        ${`${scope.organisationId}:${scope.projectId}:evidence-renewal`},
        0
      )
    )
  `);
}

async function queryCurrentPeople(
  tx: RenewalTx,
  organisationId: string,
  userIds: readonly string[],
  now: Date,
): Promise<Map<string, CurrentPerson>> {
  const uniqueIds = [...new Set(userIds)];
  if (
    uniqueIds.length !== userIds.length ||
    uniqueIds.some((id) => !UUID_PATTERN.test(id))
  ) {
    throw new EvidenceRenewalUnavailableError(
      "Renewal authority identity is invalid",
    );
  }
  if (uniqueIds.length === 0) return new Map();
  const membershipRows = await tx
    .select({
      userId: users.id,
      name: users.name,
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
        eq(organisationMemberships.organisationId, organisationId),
        inArray(organisationMemberships.userId, uniqueIds),
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
    .limit(uniqueIds.length + 1);
  if (
    membershipRows.length > uniqueIds.length ||
    membershipRows.some(
      ({ name, organisationType }) =>
        !validName(name) || !isOrganisationType(organisationType),
    )
  ) {
    throw new EvidenceRenewalUnavailableError(
      "Renewal authority membership is ambiguous",
    );
  }
  if (membershipRows.length === 0) return new Map();
  const grantRows = await tx
    .select({ membershipId: roleGrants.membershipId, role: roleGrants.role })
    .from(roleGrants)
    .where(
      and(
        inArray(
          roleGrants.membershipId,
          membershipRows.map(({ membershipId }) => membershipId),
        ),
        isNull(roleGrants.revokedAt),
        or(isNull(roleGrants.startsAt), lte(roleGrants.startsAt, now)),
        or(isNull(roleGrants.expiresAt), gt(roleGrants.expiresAt, now)),
      ),
    )
    .limit(membershipRows.length * ORGANISATION_ROLES.length + 1);
  if (grantRows.length > membershipRows.length * ORGANISATION_ROLES.length) {
    throw new EvidenceRenewalUnavailableError(
      "Renewal authority grants exceed their closed bound",
    );
  }
  const grantsByMembership = new Map<string, OrganisationRole[]>();
  for (const row of grantRows) {
    if (!isOrganisationRole(row.role)) continue;
    const roles = grantsByMembership.get(row.membershipId) ?? [];
    if (roles.includes(row.role)) {
      throw new EvidenceRenewalUnavailableError(
        "Renewal authority grants are duplicated",
      );
    }
    roles.push(row.role);
    grantsByMembership.set(row.membershipId, roles);
  }
  return new Map(
    membershipRows.flatMap((row) => {
      const roles = (grantsByMembership.get(row.membershipId) ?? []).filter(
        (role) =>
          isRoleAllowedForOrganisation(
            role,
            row.organisationType as OrganisationType,
          ),
      );
      return roles.length > 0
        ? [
            [
              row.userId,
              {
                userId: row.userId,
                name: row.name!,
                membershipId: row.membershipId,
                roles,
              },
            ] as const,
          ]
        : [];
    }),
  );
}

function hasCurrentPermission(
  person: CurrentPerson | undefined,
  permission: Permission,
): person is CurrentPerson {
  return Boolean(person && hasPermission(person.roles, permission));
}

async function requireCurrentPeople(
  tx: RenewalTx,
  scope: EvidenceRenewalScope,
  now: Date,
  assignments: {
    ownerUserId: string;
    verifierUserId: string;
    actorPermission: Permission;
  },
): Promise<{
  actor: CurrentPerson;
  owner: CurrentPerson;
  verifier: CurrentPerson;
}> {
  const people = await queryCurrentPeople(
    tx,
    scope.organisationId,
    [
      ...new Set([
        scope.actorUserId,
        assignments.ownerUserId,
        assignments.verifierUserId,
      ]),
    ],
    now,
  );
  const actor = people.get(scope.actorUserId);
  const owner = people.get(assignments.ownerUserId);
  const verifier = people.get(assignments.verifierUserId);
  if (
    !hasCurrentPermission(actor, assignments.actorPermission) ||
    actor.membershipId !== scope.actorMembershipId ||
    !hasCurrentPermission(owner, EVIDENCE_RENEWAL_MANAGE_PERMISSION) ||
    !hasCurrentPermission(verifier, EVIDENCE_RENEWAL_VERIFY_PERMISSION) ||
    owner.userId === verifier.userId
  ) {
    throw new EvidenceRenewalUnavailableError(
      "Current direct renewal authority could not be verified",
    );
  }
  return { actor, owner, verifier };
}

async function assertProject(
  tx: RenewalTx,
  scope: Pick<EvidenceRenewalScope, "organisationId" | "projectId">,
): Promise<ProjectBoundary> {
  const rows = await tx
    .select({ clientId: projects.clientId, status: projects.status })
    .from(projects)
    .where(
      and(
        eq(projects.id, scope.projectId),
        eq(projects.organisationId, scope.organisationId),
      ),
    )
    .limit(2);
  const project = rows[0];
  if (rows.length !== 1 || !project) {
    throw new EvidenceRenewalProjectAccessError("not_found");
  }
  if (project.status === "archived") {
    throw new EvidenceRenewalProjectAccessError("archived");
  }
  return project;
}

async function validateAffectedPursuits(
  tx: RenewalTx,
  scope: Pick<EvidenceRenewalScope, "organisationId" | "projectId">,
  clientId: string,
  affectedProjectIds: readonly string[],
): Promise<boolean> {
  if (
    !affectedProjectIds.includes(scope.projectId) ||
    affectedProjectIds.length > EVIDENCE_RENEWAL_BOUNDS.affectedPursuits
  ) {
    return false;
  }
  const rows = await tx
    .select({
      id: projects.id,
      clientId: projects.clientId,
      status: projects.status,
    })
    .from(projects)
    .where(
      and(
        eq(projects.organisationId, scope.organisationId),
        inArray(projects.id, [...affectedProjectIds]),
      ),
    )
    .orderBy(asc(projects.id))
    .limit(EVIDENCE_RENEWAL_BOUNDS.affectedPursuits + 1)
    .for("share");
  return (
    rows.length === affectedProjectIds.length &&
    rows.every((row) => row.clientId === clientId && row.status !== "archived")
  );
}

async function readVaultItem(
  tx: RenewalTx,
  scope: Pick<EvidenceRenewalScope, "organisationId">,
  clientId: string,
  vaultItemId: string,
  lock = false,
) {
  let query = tx
    .select()
    .from(vaultItems)
    .where(
      and(
        eq(vaultItems.id, vaultItemId),
        eq(vaultItems.organisationId, scope.organisationId),
        eq(vaultItems.clientId, clientId),
      ),
    )
    .limit(2);
  const rows = lock ? await query.for("update") : await query;
  return rows.length === 1 ? rows[0]! : null;
}

async function currentCanonicalDocument(
  tx: RenewalTx,
  scope: Pick<EvidenceRenewalScope, "organisationId" | "projectId">,
  documentId: string,
  sha256: string,
): Promise<CanonicalDocument | null> {
  const result = await tx.execute(sql`
    SELECT
      document.id::text AS "documentId",
      current_version.id::text AS "documentVersionId",
      current_version.version_number AS "documentVersionNumber",
      current_version.sha256 AS sha256,
      current_version.object_path AS "objectPath"
    FROM documents AS document
    JOIN document_versions AS current_version
      ON current_version.document_id = document.id
     AND current_version.organisation_id = document.organisation_id
    WHERE document.id = ${documentId}::uuid
      AND document.organisation_id = ${scope.organisationId}::uuid
      AND document.project_id = ${scope.projectId}::uuid
      AND document.sha256 = ${sha256}
      AND current_version.sha256 = ${sha256}
      AND current_version.malware_status = 'clean'
      AND current_version.quarantine_status = 'cleared'
      AND coalesce(document.extraction_status, 'pending') <> 'quarantined'
      AND NOT EXISTS (
        SELECT 1
        FROM document_versions AS later_version
        WHERE later_version.organisation_id = current_version.organisation_id
          AND later_version.document_id = current_version.document_id
          AND later_version.version_number > current_version.version_number
      )
    LIMIT 2
  `);
  if (result.rows.length !== 1) return null;
  const raw = result.rows[0] as Record<string, unknown>;
  const candidate: CanonicalDocument = {
    documentId: String(raw.documentId ?? ""),
    documentVersionId: String(raw.documentVersionId ?? ""),
    documentVersionNumber: Number(raw.documentVersionNumber),
    sha256: String(raw.sha256 ?? ""),
    objectPath: String(raw.objectPath ?? ""),
  };
  return UUID_PATTERN.test(candidate.documentId) &&
    UUID_PATTERN.test(candidate.documentVersionId) &&
    Number.isSafeInteger(candidate.documentVersionNumber) &&
    candidate.documentVersionNumber >= 1 &&
    SHA256_PATTERN.test(candidate.sha256) &&
    candidate.objectPath.length >= 1 &&
    candidate.objectPath.length <= 2_048
    ? candidate
    : null;
}

function auditReceipt(
  event: PersistedEvidenceRenewalEvent,
): AuditReceiptEnvelope {
  return {
    schema: EVIDENCE_RENEWAL_AUDIT_SCHEMA,
    eventId: event.eventId,
    planId: event.planId,
    aggregateVersion: event.aggregateVersion,
    kind: event.kind,
    receiptSha256: event.receiptSha256,
  };
}

function parseAuditReceipt(value: string | null): AuditReceiptEnvelope {
  let raw: unknown;
  try {
    raw = value ? JSON.parse(value) : null;
  } catch {
    throw new EvidenceRenewalUnavailableError(
      "Renewal audit receipt is malformed",
    );
  }
  if (
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw) ||
    Object.keys(raw).length !== 6
  ) {
    throw new EvidenceRenewalUnavailableError(
      "Renewal audit receipt failed its closed schema",
    );
  }
  const receipt = raw as unknown as AuditReceiptEnvelope;
  if (
    receipt.schema !== EVIDENCE_RENEWAL_AUDIT_SCHEMA ||
    !UUID_PATTERN.test(receipt.eventId) ||
    !UUID_PATTERN.test(receipt.planId) ||
    !Number.isSafeInteger(receipt.aggregateVersion) ||
    receipt.aggregateVersion < 1 ||
    !["plan_created", "replacement_staged", "replacement_reviewed"].includes(
      receipt.kind,
    ) ||
    !SHA256_PATTERN.test(receipt.receiptSha256)
  ) {
    throw new EvidenceRenewalUnavailableError(
      "Renewal audit receipt is invalid",
    );
  }
  return receipt;
}

async function loadEvents(
  tx: RenewalTx,
  scope: Pick<EvidenceRenewalScope, "organisationId" | "projectId">,
): Promise<PersistedEvidenceRenewalEvent[]> {
  const metadata = await tx
    .select({
      id: workTasks.id,
      title: workTasks.title,
      ownerMembershipId: workTasks.ownerMembershipId,
      dueAt: workTasks.dueAt,
      priority: workTasks.priority,
      status: workTasks.status,
      version: workTasks.version,
      codeUnits: sql<number>`pg_catalog.char_length(${workTasks.description})`,
      bytes: sql<number>`pg_catalog.octet_length(${workTasks.description})`,
    })
    .from(workTasks)
    .where(
      and(
        eq(workTasks.organisationId, scope.organisationId),
        eq(workTasks.projectId, scope.projectId),
        like(workTasks.title, `${EVIDENCE_RENEWAL_NAMESPACE}%`),
      ),
    )
    .orderBy(asc(workTasks.createdAt), asc(workTasks.id))
    .limit(EVIDENCE_RENEWAL_BOUNDS.eventsPerProject + 1);
  if (metadata.length > EVIDENCE_RENEWAL_BOUNDS.eventsPerProject) {
    throw new EvidenceRenewalUnavailableError(
      "Renewal event capacity has been exceeded",
    );
  }
  let totalBytes = 0;
  for (const row of metadata) {
    if (
      !Number.isSafeInteger(row.codeUnits) ||
      !Number.isSafeInteger(row.bytes) ||
      row.codeUnits < 1 ||
      row.bytes < 1 ||
      row.codeUnits > EVIDENCE_RENEWAL_BOUNDS.envelopeCodeUnits ||
      row.bytes > EVIDENCE_RENEWAL_BOUNDS.envelopeBytes
    ) {
      throw new EvidenceRenewalUnavailableError(
        "Renewal event failed bounded materialisation",
      );
    }
    totalBytes += row.bytes;
    if (totalBytes > EVIDENCE_RENEWAL_BOUNDS.snapshotBytes) {
      throw new EvidenceRenewalUnavailableError(
        "Renewal snapshot exceeds its byte bound",
      );
    }
  }
  const rows = metadata.length
    ? await tx
        .select({ id: workTasks.id, description: workTasks.description })
        .from(workTasks)
        .where(
          and(
            eq(workTasks.organisationId, scope.organisationId),
            eq(workTasks.projectId, scope.projectId),
            inArray(
              workTasks.id,
              metadata.map(({ id }) => id),
            ),
          ),
        )
        .orderBy(asc(workTasks.createdAt), asc(workTasks.id))
    : [];
  if (rows.length !== metadata.length) {
    throw new EvidenceRenewalUnavailableError(
      "Renewal history changed during materialisation",
    );
  }
  const events = rows.map(({ id, description }) =>
    parseEvidenceRenewalEvent(description, id, scope),
  );
  const metadataById = new Map(metadata.map((row) => [row.id, row]));
  for (const event of events) {
    const row = metadataById.get(event.eventId);
    const expectedOwnerMembershipId =
      event.kind === "plan_created" && event.creation
        ? event.creation.ownerMembershipId
        : event.actorMembershipId;
    const expectedDueAt =
      event.kind === "plan_created" && event.creation
        ? event.creation.reminderDueAt
        : null;
    if (
      !row ||
      row.title !==
        `${EVIDENCE_RENEWAL_NAMESPACE}${event.kind}] ${event.planId}` ||
      row.ownerMembershipId !== expectedOwnerMembershipId ||
      (row.dueAt?.toISOString() ?? null) !== expectedDueAt ||
      row.priority !== "high" ||
      row.status !== "recorded" ||
      row.version !== 1
    ) {
      throw new EvidenceRenewalUnavailableError(
        "Renewal reminder metadata diverges from its immutable receipt",
      );
    }
  }

  const auditRows = await tx
    .select({
      eventType: auditEvents.eventType,
      objectId: auditEvents.objectId,
      details: auditEvents.details,
      codeUnits: sql<number>`pg_catalog.char_length(${auditEvents.details})`,
      bytes: sql<number>`pg_catalog.octet_length(${auditEvents.details})`,
    })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.organisationId, scope.organisationId),
        eq(auditEvents.projectId, scope.projectId),
        eq(auditEvents.objectType, AUDIT_OBJECT_TYPE),
        like(auditEvents.eventType, `${AUDIT_EVENT_PREFIX}%`),
      ),
    )
    .orderBy(asc(auditEvents.seq))
    .limit(EVIDENCE_RENEWAL_BOUNDS.eventsPerProject + 1);
  if (auditRows.length !== events.length) {
    throw new EvidenceRenewalUnavailableError(
      "Renewal ledger and immutable audit receipts diverge",
    );
  }
  const receiptByEventId = new Map<string, AuditReceiptEnvelope>();
  for (const row of auditRows) {
    if (
      !Number.isSafeInteger(row.codeUnits) ||
      !Number.isSafeInteger(row.bytes) ||
      row.codeUnits < 1 ||
      row.codeUnits > MAX_AUDIT_RECEIPT_CODE_UNITS ||
      row.bytes < 1 ||
      row.bytes > MAX_AUDIT_RECEIPT_BYTES
    ) {
      throw new EvidenceRenewalUnavailableError(
        "Renewal audit receipt exceeds its content-minimised bound",
      );
    }
    const receipt = parseAuditReceipt(row.details);
    if (
      row.objectId !== receipt.planId ||
      row.eventType !== `${AUDIT_EVENT_PREFIX}${receipt.kind}` ||
      receiptByEventId.has(receipt.eventId)
    ) {
      throw new EvidenceRenewalUnavailableError(
        "Renewal audit receipt identity is inconsistent",
      );
    }
    receiptByEventId.set(receipt.eventId, receipt);
  }
  for (const event of events) {
    const receipt = receiptByEventId.get(event.eventId);
    if (
      !receipt ||
      receipt.planId !== event.planId ||
      receipt.aggregateVersion !== event.aggregateVersion ||
      receipt.kind !== event.kind ||
      receipt.receiptSha256 !== event.receiptSha256
    ) {
      throw new EvidenceRenewalUnavailableError(
        "Renewal event lacks its exact immutable audit receipt",
      );
    }
  }
  return events;
}

async function appendEvent(
  tx: RenewalTx,
  scope: EvidenceRenewalScope,
  event: PersistedEvidenceRenewalEvent,
  actor: CurrentPerson,
  taskOwner: CurrentPerson,
  dueAt: Date | null,
): Promise<boolean> {
  const inserted = await tx
    .insert(workTasks)
    .values({
      id: event.eventId,
      organisationId: scope.organisationId,
      projectId: scope.projectId,
      title: `${EVIDENCE_RENEWAL_NAMESPACE}${event.kind}] ${event.planId}`,
      description: serializeEvidenceRenewalEvent(event),
      ownerMembershipId: taskOwner.membershipId,
      dueAt,
      priority: "high",
      status: "recorded",
      version: 1,
    })
    .onConflictDoNothing({ target: workTasks.id })
    .returning({ id: workTasks.id });
  if (inserted.length !== 1) return false;
  await writeAuditTx(tx, {
    user: auditUser(actor),
    organisationId: scope.organisationId,
    projectId: scope.projectId,
    eventType: `${AUDIT_EVENT_PREFIX}${event.kind}`,
    objectType: AUDIT_OBJECT_TYPE,
    objectId: event.planId,
    details: canonicalEvidenceRenewalJson(auditReceipt(event)),
  });
  return true;
}

async function materialisePlans(
  tx: RenewalTx,
  scope: Pick<EvidenceRenewalScope, "organisationId" | "projectId">,
  reduced: readonly ReducedEvidenceRenewalPlan[],
  now: Date,
): Promise<EvidenceRenewalPlan[]> {
  if (reduced.length === 0) return [];
  const vaultIds = [...new Set(reduced.map((plan) => plan.vaultItemId))];
  const userIds = [
    ...new Set(
      reduced.flatMap((plan) => [plan.ownerUserId, plan.verifierUserId]),
    ),
  ];
  const pursuitIds = [
    ...new Set(
      reduced.flatMap((plan) =>
        plan.affectedPursuits.map(({ projectId }) => projectId),
      ),
    ),
  ];
  const [vaultRows, userRows, pursuitRows, currentPeople] = await Promise.all([
    tx
      .select({
        id: vaultItems.id,
        clientId: vaultItems.clientId,
        artefactType: vaultItems.artefactType,
      })
      .from(vaultItems)
      .where(
        and(
          eq(vaultItems.organisationId, scope.organisationId),
          inArray(vaultItems.id, vaultIds),
        ),
      )
      .limit(vaultIds.length + 1),
    tx
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(inArray(users.id, userIds))
      .limit(userIds.length + 1),
    tx
      .select({
        id: projects.id,
        clientId: projects.clientId,
        status: projects.status,
        title: projects.tenderTitle,
      })
      .from(projects)
      .where(
        and(
          eq(projects.organisationId, scope.organisationId),
          inArray(projects.id, pursuitIds),
        ),
      )
      .limit(pursuitIds.length + 1),
    queryCurrentPeople(tx, scope.organisationId, userIds, now),
  ]);
  const primaryPursuit = pursuitRows.find(({ id }) => id === scope.projectId);
  if (
    vaultRows.length !== vaultIds.length ||
    userRows.length !== userIds.length ||
    pursuitRows.length !== pursuitIds.length ||
    !primaryPursuit ||
    primaryPursuit.status === "archived" ||
    pursuitRows.some(
      ({ clientId, status }) =>
        clientId !== primaryPursuit.clientId || status === "archived",
    ) ||
    vaultRows.some(({ clientId }) => clientId !== primaryPursuit.clientId) ||
    userRows.some(({ name }) => !validName(name)) ||
    pursuitRows.some(({ title }) => !validTitle(title))
  ) {
    throw new EvidenceRenewalUnavailableError(
      "Renewal assignment or affected-pursuit projection is unavailable",
    );
  }
  const vaultById = new Map(vaultRows.map((row) => [row.id, row]));
  const userById = new Map(userRows.map((row) => [row.id, row.name!]));
  const pursuitById = new Map(pursuitRows.map((row) => [row.id, row.title]));
  return reduced.map((plan) => {
    const vault = vaultById.get(plan.vaultItemId);
    const ownerName = userById.get(plan.ownerUserId);
    const verifierName = userById.get(plan.verifierUserId);
    if (!vault || !ownerName || !verifierName) {
      throw new EvidenceRenewalUnavailableError(
        "Renewal plan projection is incomplete",
      );
    }
    return {
      id: plan.id,
      organisationId: plan.organisationId,
      projectId: plan.projectId,
      vaultItemId: plan.vaultItemId,
      artefactType: vault.artefactType,
      owner: {
        userId: plan.ownerUserId,
        name: ownerName,
        current: hasCurrentPermission(
          currentPeople.get(plan.ownerUserId),
          EVIDENCE_RENEWAL_MANAGE_PERMISSION,
        ),
      },
      verifier: {
        userId: plan.verifierUserId,
        name: verifierName,
        current: hasCurrentPermission(
          currentPeople.get(plan.verifierUserId),
          EVIDENCE_RENEWAL_VERIFY_PERMISSION,
        ),
      },
      internalReminder: {
        channel: "bidbox_evidence_renewal_register",
        assignedOwnerUserId: plan.ownerUserId,
        dueAt: plan.reminderDueAt,
        status:
          plan.status === "promoted" || plan.status === "rejected"
            ? "resolved"
            : "open",
        recordedReceiptSha256: plan.receipts[0]!.sha256,
        resolvedReceiptSha256:
          plan.status === "promoted" || plan.status === "rejected"
            ? plan.latestReceiptSha256
            : null,
        externalDeliveryReceipt: null,
      },
      targetDate: plan.targetDate,
      affectedPursuits: plan.affectedPursuits.map((affected) => {
        const title = pursuitById.get(affected.projectId);
        if (!title) {
          throw new EvidenceRenewalUnavailableError(
            "An affected pursuit is no longer materialisable",
          );
        }
        return { ...affected, title };
      }),
      status: plan.status,
      version: plan.version,
      stagedReplacement: plan.stagedReplacement,
      reviewReasonCode: plan.reviewReasonCode,
      createdByUserId: plan.createdByUserId,
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt,
      latestReceiptSha256: plan.latestReceiptSha256,
      promotionReceiptSha256: plan.promotionReceiptSha256,
      receipts: plan.receipts,
      externalMessageSent: false,
    };
  });
}

function idempotencyDigest(scope: EvidenceRenewalScope, key: string): string {
  return evidenceRenewalSha256({
    schema: "valo.evidence-renewal-idempotency/v1",
    organisationId: scope.organisationId,
    projectId: scope.projectId,
    key,
  });
}

function eventBase(
  scope: EvidenceRenewalScope,
  input: {
    eventId: string;
    planId: string;
    aggregateVersion: number;
    kind: PersistedEvidenceRenewalEvent["kind"];
    now: Date;
    idempotencyKeySha256: string;
    requestSha256: string;
    previousReceiptSha256: string;
    creation: EvidenceRenewalCreationPayload | null;
    stage: EvidenceRenewalStagePayload | null;
    review: EvidenceRenewalReviewPayload | null;
  },
): Omit<PersistedEvidenceRenewalEvent, "receiptSha256"> {
  return {
    schema: "valo.evidence-renewal-ledger/v1",
    eventId: input.eventId,
    planId: input.planId,
    aggregateVersion: input.aggregateVersion,
    kind: input.kind,
    organisationId: scope.organisationId,
    projectId: scope.projectId,
    occurredAt: input.now.toISOString(),
    actorUserId: scope.actorUserId,
    actorMembershipId: scope.actorMembershipId,
    idempotencyKeySha256: input.idempotencyKeySha256,
    requestSha256: input.requestSha256,
    previousReceiptSha256: input.previousReceiptSha256,
    creation: input.creation,
    stage: input.stage,
    review: input.review,
  };
}

function completeEvent(
  base: Omit<PersistedEvidenceRenewalEvent, "receiptSha256">,
): PersistedEvidenceRenewalEvent {
  return { ...base, receiptSha256: createEvidenceRenewalEventReceipt(base) };
}

async function onePlan(
  tx: RenewalTx,
  scope: EvidenceRenewalScope,
  events: readonly PersistedEvidenceRenewalEvent[],
  planId: string,
  now: Date,
): Promise<EvidenceRenewalPlan> {
  const reduced = reduceEvidenceRenewalLedger(events).filter(
    (plan) => plan.id === planId,
  );
  const [plan] = await materialisePlans(tx, scope, reduced, now);
  if (!plan) throw new EvidenceRenewalUnavailableError();
  return plan;
}

function findReplay(
  events: readonly PersistedEvidenceRenewalEvent[],
  idempotencyKeySha256: string,
): PersistedEvidenceRenewalEvent | undefined {
  return events.find(
    (event) => event.idempotencyKeySha256 === idempotencyKeySha256,
  );
}

export class PostgresEvidenceRenewalRepository implements EvidenceRenewalRepository {
  async readSnapshot(
    scope: EvidenceRenewalScope,
    _requestedNow: Date,
  ): Promise<EvidenceRenewalSnapshot> {
    assertScope(scope);
    return withTenantDatabase(scope.organisationId, () =>
      db.transaction(async (tx) => {
        await configureTransactionBounds(tx);
        await lockMembershipAuthority(tx, scope.organisationId);
        const now = await authoritativeDatabaseNow(tx);
        await assertProject(tx, scope);
        const people = await queryCurrentPeople(
          tx,
          scope.organisationId,
          [scope.actorUserId],
          now,
        );
        const actor = people.get(scope.actorUserId);
        if (
          !hasCurrentPermission(actor, EVIDENCE_RENEWAL_READ_PERMISSION) ||
          actor.membershipId !== scope.actorMembershipId
        ) {
          throw new EvidenceRenewalUnavailableError(
            "Current direct renewal read authority is unavailable",
          );
        }
        const items = await materialisePlans(
          tx,
          scope,
          reduceEvidenceRenewalLedger(await loadEvents(tx, scope)),
          now,
        );
        return {
          organisationId: scope.organisationId,
          projectId: scope.projectId,
          generatedAt: now.toISOString(),
          items,
          limit: EVIDENCE_RENEWAL_BOUNDS.plansPerProject,
          truncated: false,
          externalMessagingConnected: false,
          authorityNote: EVIDENCE_RENEWAL_AUTHORITY_NOTE,
        };
      }),
    );
  }

  async listAuthorities(
    scope: EvidenceRenewalScope,
    _requestedNow: Date,
  ): Promise<EvidenceRenewalAuthorityList> {
    assertScope(scope);
    return withTenantDatabase(scope.organisationId, () =>
      db.transaction(async (tx) => {
        await configureTransactionBounds(tx);
        await lockMembershipAuthority(tx, scope.organisationId);
        const now = await authoritativeDatabaseNow(tx);
        await assertProject(tx, scope);
        const membershipRows = await tx
          .select({ userId: organisationMemberships.userId })
          .from(organisationMemberships)
          .innerJoin(users, eq(users.id, organisationMemberships.userId))
          .where(
            and(
              eq(organisationMemberships.organisationId, scope.organisationId),
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
            ),
          )
          .orderBy(asc(organisationMemberships.userId))
          .limit(EVIDENCE_RENEWAL_BOUNDS.authorities + 1);
        if (membershipRows.length > EVIDENCE_RENEWAL_BOUNDS.authorities) {
          throw new EvidenceRenewalUnavailableError(
            "Renewal authority list exceeds its reviewed bound",
          );
        }
        const people = await queryCurrentPeople(
          tx,
          scope.organisationId,
          membershipRows.map(({ userId }) => userId),
          now,
        );
        const actor = people.get(scope.actorUserId);
        if (
          !hasCurrentPermission(actor, EVIDENCE_RENEWAL_READ_PERMISSION) ||
          actor.membershipId !== scope.actorMembershipId
        ) {
          throw new EvidenceRenewalUnavailableError(
            "Current direct renewal read authority is unavailable",
          );
        }
        const all = [...people.values()].sort(
          (left, right) =>
            left.name.localeCompare(right.name) ||
            left.userId.localeCompare(right.userId),
        );
        return {
          organisationId: scope.organisationId,
          owners: all
            .filter((person) =>
              hasPermission(person.roles, EVIDENCE_RENEWAL_MANAGE_PERMISSION),
            )
            .map(({ userId, name }) => ({ userId, name })),
          verifiers: all
            .filter((person) =>
              hasPermission(person.roles, EVIDENCE_RENEWAL_VERIFY_PERMISSION),
            )
            .map(({ userId, name }) => ({ userId, name })),
          limit: EVIDENCE_RENEWAL_BOUNDS.authorities,
          truncated: false,
        };
      }),
    );
  }

  async createPlan(
    scope: EvidenceRenewalScope,
    draft: EvidenceRenewalCreateDraft,
    _requestedNow: Date,
  ): Promise<EvidenceRenewalMutationOutcome> {
    assertScope(scope);
    return withTenantDatabase(scope.organisationId, () =>
      db.transaction(async (tx) => {
        await configureTransactionBounds(tx);
        await lockMembershipAuthority(tx, scope.organisationId);
        await lockRenewalProject(tx, scope);
        const now = await authoritativeDatabaseNow(tx);
        const boundary = await assertProject(tx, scope);
        const { actor, owner, verifier } = await requireCurrentPeople(
          tx,
          scope,
          now,
          {
            ownerUserId: draft.ownerUserId,
            verifierUserId: draft.verifierUserId,
            actorPermission: EVIDENCE_RENEWAL_MANAGE_PERMISSION,
          },
        );
        const events = await loadEvents(tx, scope);
        const reduced = reduceEvidenceRenewalLedger(events);
        const keySha256 = idempotencyDigest(scope, draft.idempotencyKey);
        const creation: EvidenceRenewalCreationPayload = {
          vaultItemId: draft.vaultItemId,
          ownerUserId: owner.userId,
          ownerMembershipId: owner.membershipId,
          verifierUserId: verifier.userId,
          targetDate: draft.targetDate,
          reminderDueAt: `${draft.targetDate}T16:00:00.000Z`,
          affectedPursuits: draft.affectedPursuits,
        };
        const requestSha256 = evidenceRenewalSha256({
          kind: "plan_created",
          organisationId: scope.organisationId,
          projectId: scope.projectId,
          actorUserId: scope.actorUserId,
          creation,
        });
        const replay = findReplay(events, keySha256);
        if (replay) {
          if (
            replay.kind !== "plan_created" ||
            replay.requestSha256 !== requestSha256
          ) {
            return { outcome: "idempotency_conflict" };
          }
          return {
            outcome: "created",
            plan: await onePlan(tx, scope, events, replay.planId, now),
            replayed: true,
          };
        }
        if (
          events.length >= EVIDENCE_RENEWAL_BOUNDS.eventsPerProject ||
          reduced.length >= EVIDENCE_RENEWAL_BOUNDS.plansPerProject
        ) {
          return { outcome: "capacity_exceeded" };
        }
        if (
          reduced.some(
            (plan) =>
              plan.vaultItemId === draft.vaultItemId &&
              (plan.status === "planned" ||
                plan.status === "replacement_staged"),
          )
        ) {
          return { outcome: "state_conflict" };
        }
        if (draft.targetDate < today(now)) {
          return { outcome: "state_conflict" };
        }
        if (
          !(await validateAffectedPursuits(
            tx,
            scope,
            boundary.clientId,
            draft.affectedPursuits.map(({ projectId }) => projectId),
          ))
        ) {
          return { outcome: "evidence_conflict" };
        }
        if (
          !(await readVaultItem(
            tx,
            scope,
            boundary.clientId,
            draft.vaultItemId,
          ))
        ) {
          return { outcome: "vault_conflict" };
        }
        const planId = deterministicEvidenceRenewalUuid(
          `evidence-renewal-plan:${scope.organisationId}:${scope.projectId}:${keySha256}`,
        );
        const eventId = deterministicEvidenceRenewalUuid(
          `evidence-renewal-event:plan-created:${scope.organisationId}:${scope.projectId}:${keySha256}`,
        );
        const base = eventBase(scope, {
          eventId,
          planId,
          aggregateVersion: 1,
          kind: "plan_created",
          now,
          idempotencyKeySha256: keySha256,
          requestSha256,
          previousReceiptSha256: ZERO_SHA256,
          creation,
          stage: null,
          review: null,
        });
        const event = completeEvent(base);
        if (
          !(await appendEvent(
            tx,
            scope,
            event,
            actor,
            owner,
            new Date(creation.reminderDueAt),
          ))
        ) {
          return { outcome: "idempotency_conflict" };
        }
        return {
          outcome: "created",
          plan: await onePlan(tx, scope, [...events, event], planId, now),
          replayed: false,
        };
      }),
    );
  }

  async stageReplacement(
    scope: EvidenceRenewalScope,
    planId: string,
    expectedVersion: number,
    draft: EvidenceRenewalStageDraft,
    _requestedNow: Date,
  ): Promise<EvidenceRenewalMutationOutcome> {
    assertScope(scope);
    assertUuid(planId, "renewal plan");
    return withTenantDatabase(scope.organisationId, () =>
      db.transaction(async (tx) => {
        await configureTransactionBounds(tx);
        await lockMembershipAuthority(tx, scope.organisationId);
        await lockRenewalProject(tx, scope);
        const now = await authoritativeDatabaseNow(tx);
        const boundary = await assertProject(tx, scope);
        const events = await loadEvents(tx, scope);
        const reduced = reduceEvidenceRenewalLedger(events);
        const current = reduced.find((plan) => plan.id === planId);
        if (!current) return { outcome: "not_found" };
        const { actor } = await requireCurrentPeople(tx, scope, now, {
          ownerUserId: current.ownerUserId,
          verifierUserId: current.verifierUserId,
          actorPermission: EVIDENCE_RENEWAL_MANAGE_PERMISSION,
        });
        if (scope.actorUserId !== current.ownerUserId) {
          return { outcome: "authority_conflict" };
        }
        if (
          !(await validateAffectedPursuits(
            tx,
            scope,
            boundary.clientId,
            current.affectedPursuits.map(({ projectId }) => projectId),
          ))
        ) {
          return { outcome: "evidence_conflict" };
        }
        const keySha256 = idempotencyDigest(scope, draft.idempotencyKey);
        const requestSha256 = evidenceRenewalSha256({
          kind: "replacement_staged",
          organisationId: scope.organisationId,
          projectId: scope.projectId,
          actorUserId: scope.actorUserId,
          planId,
          expectedVersion,
          draft: {
            documentId: draft.documentId,
            sha256: draft.sha256,
            issueDate: draft.issueDate,
            expiryDate: draft.expiryDate,
          },
        });
        const replay = findReplay(events, keySha256);
        if (replay) {
          if (
            replay.kind !== "replacement_staged" ||
            replay.planId !== planId ||
            replay.requestSha256 !== requestSha256
          ) {
            return { outcome: "idempotency_conflict" };
          }
          return {
            outcome: "updated",
            plan: await onePlan(tx, scope, events, planId, now),
            replayed: true,
          };
        }
        if (current.version !== expectedVersion) {
          return { outcome: "version_conflict" };
        }
        if (current.status !== "planned") return { outcome: "state_conflict" };
        if (events.length >= EVIDENCE_RENEWAL_BOUNDS.eventsPerProject) {
          return { outcome: "capacity_exceeded" };
        }
        const todayValue = today(now);
        if (draft.issueDate > todayValue || draft.expiryDate <= todayValue) {
          return { outcome: "evidence_conflict" };
        }
        const vault = await readVaultItem(
          tx,
          scope,
          boundary.clientId,
          current.vaultItemId,
          true,
        );
        if (!vault) return { outcome: "vault_conflict" };
        const canonical = await currentCanonicalDocument(
          tx,
          scope,
          draft.documentId,
          draft.sha256,
        );
        if (!canonical) return { outcome: "evidence_conflict" };
        const stage: EvidenceRenewalStagePayload = {
          documentId: canonical.documentId,
          documentVersionId: canonical.documentVersionId,
          documentVersionNumber: canonical.documentVersionNumber,
          sha256: canonical.sha256,
          issueDate: draft.issueDate,
          expiryDate: draft.expiryDate,
          expectedVaultItemVersion: vault.version,
        };
        const eventId = deterministicEvidenceRenewalUuid(
          `evidence-renewal-event:replacement-staged:${scope.organisationId}:${scope.projectId}:${keySha256}`,
        );
        const event = completeEvent(
          eventBase(scope, {
            eventId,
            planId,
            aggregateVersion: expectedVersion + 1,
            kind: "replacement_staged",
            now,
            idempotencyKeySha256: keySha256,
            requestSha256,
            previousReceiptSha256: current.latestReceiptSha256,
            creation: null,
            stage,
            review: null,
          }),
        );
        if (!(await appendEvent(tx, scope, event, actor, actor, null))) {
          return { outcome: "idempotency_conflict" };
        }
        return {
          outcome: "updated",
          plan: await onePlan(tx, scope, [...events, event], planId, now),
          replayed: false,
        };
      }),
    );
  }

  async reviewReplacement(
    scope: EvidenceRenewalScope,
    planId: string,
    expectedVersion: number,
    draft: EvidenceRenewalReviewDraft,
    _requestedNow: Date,
  ): Promise<EvidenceRenewalMutationOutcome> {
    assertScope(scope);
    assertUuid(planId, "renewal plan");
    return withTenantDatabase(scope.organisationId, () =>
      db.transaction(async (tx) => {
        await configureTransactionBounds(tx);
        await lockMembershipAuthority(tx, scope.organisationId);
        await lockRenewalProject(tx, scope);
        const now = await authoritativeDatabaseNow(tx);
        const boundary = await assertProject(tx, scope);
        const events = await loadEvents(tx, scope);
        const reduced = reduceEvidenceRenewalLedger(events);
        const current = reduced.find((plan) => plan.id === planId);
        if (!current) return { outcome: "not_found" };
        const { actor } = await requireCurrentPeople(tx, scope, now, {
          ownerUserId: current.ownerUserId,
          verifierUserId: current.verifierUserId,
          actorPermission: EVIDENCE_RENEWAL_VERIFY_PERMISSION,
        });
        if (scope.actorUserId !== current.verifierUserId) {
          return { outcome: "authority_conflict" };
        }
        if (
          current.ownerUserId === current.verifierUserId ||
          current.stagedReplacement?.stagedByUserId === scope.actorUserId
        ) {
          return { outcome: "maker_checker_conflict" };
        }
        if (
          !(await validateAffectedPursuits(
            tx,
            scope,
            boundary.clientId,
            current.affectedPursuits.map(({ projectId }) => projectId),
          ))
        ) {
          return { outcome: "evidence_conflict" };
        }
        const keySha256 = idempotencyDigest(scope, draft.idempotencyKey);
        const review: EvidenceRenewalReviewPayload = {
          decision: draft.decision,
          reasonCode: draft.reasonCode,
        };
        const requestSha256 = evidenceRenewalSha256({
          kind: "replacement_reviewed",
          organisationId: scope.organisationId,
          projectId: scope.projectId,
          actorUserId: scope.actorUserId,
          planId,
          expectedVersion,
          review,
        });
        const replay = findReplay(events, keySha256);
        if (replay) {
          if (
            replay.kind !== "replacement_reviewed" ||
            replay.planId !== planId ||
            replay.requestSha256 !== requestSha256
          ) {
            return { outcome: "idempotency_conflict" };
          }
          return {
            outcome: "updated",
            plan: await onePlan(tx, scope, events, planId, now),
            replayed: true,
          };
        }
        if (current.version !== expectedVersion) {
          return { outcome: "version_conflict" };
        }
        if (
          current.status !== "replacement_staged" ||
          !current.stagedReplacement
        ) {
          return { outcome: "state_conflict" };
        }
        if (events.length >= EVIDENCE_RENEWAL_BOUNDS.eventsPerProject) {
          return { outcome: "capacity_exceeded" };
        }
        const staged = current.stagedReplacement;
        if (draft.decision === "approve") {
          if (staged.expiryDate <= today(now)) {
            return { outcome: "evidence_conflict" };
          }
          const promotion = await promoteEvidenceRenewalWithStorageLifecycle(
            {
              expectedVaultItemVersion: staged.expectedVaultItemVersion,
              documentId: staged.documentId,
              documentVersionId: staged.documentVersionId,
              documentVersionNumber: staged.documentVersionNumber,
              sha256: staged.sha256,
            },
            {
              readVaultCandidate: () =>
                readVaultItem(
                  tx,
                  scope,
                  boundary.clientId,
                  current.vaultItemId,
                ),
              readCanonicalCandidate: () =>
                currentCanonicalDocument(
                  tx,
                  scope,
                  staged.documentId,
                  staged.sha256,
                ),
              lockObjectPath: lockStagedUploadObject,
              readVaultForUpdate: () =>
                readVaultItem(
                  tx,
                  scope,
                  boundary.clientId,
                  current.vaultItemId,
                  true,
                ),
              readFreshCanonical: () =>
                currentCanonicalDocument(
                  tx,
                  scope,
                  staged.documentId,
                  staged.sha256,
                ),
              promote: async (vault, canonical) => {
                const promoted = await tx
                  .update(vaultItems)
                  .set({
                    sourceDocumentId: canonical.documentId,
                    objectPath: canonical.objectPath,
                    sha256: canonical.sha256,
                    issueDate: staged.issueDate,
                    expiryDate: staged.expiryDate,
                    status: "active",
                    version: sql`${vaultItems.version} + 1`,
                    updatedAt: now,
                  })
                  .where(
                    and(
                      eq(vaultItems.id, current.vaultItemId),
                      eq(vaultItems.organisationId, scope.organisationId),
                      eq(vaultItems.clientId, boundary.clientId),
                      eq(vaultItems.version, vault.version),
                      vault.objectPath === null
                        ? isNull(vaultItems.objectPath)
                        : eq(vaultItems.objectPath, vault.objectPath),
                      vault.sourceDocumentId === null
                        ? isNull(vaultItems.sourceDocumentId)
                        : eq(
                            vaultItems.sourceDocumentId,
                            vault.sourceDocumentId,
                          ),
                    ),
                  )
                  .returning({ id: vaultItems.id });
                if (promoted.length !== 1) {
                  throw new EvidenceRenewalUnavailableError(
                    "Canonical vault projection CAS failed",
                  );
                }
              },
              enqueueSupersededObject: async (objectPath) => {
                await enqueueStorageDeletionIntentTx(tx, {
                  organisationId: scope.organisationId,
                  // Vault artefacts can be shared by several pursuits, so the
                  // durable queue must not cascade with this one project.
                  projectId: null,
                  objectPath,
                  aggregateType: "vault_item",
                  aggregateId: current.vaultItemId,
                  reason: "reference_replaced",
                  requestedAt: now,
                  actor: auditUser(actor),
                });
              },
            },
          );
          if (promotion === "vault_conflict") {
            return { outcome: "vault_conflict" };
          }
          if (promotion === "evidence_conflict") {
            return { outcome: "evidence_conflict" };
          }
        }
        const eventId = deterministicEvidenceRenewalUuid(
          `evidence-renewal-event:replacement-reviewed:${scope.organisationId}:${scope.projectId}:${keySha256}`,
        );
        const event = completeEvent(
          eventBase(scope, {
            eventId,
            planId,
            aggregateVersion: expectedVersion + 1,
            kind: "replacement_reviewed",
            now,
            idempotencyKeySha256: keySha256,
            requestSha256,
            previousReceiptSha256: current.latestReceiptSha256,
            creation: null,
            stage: null,
            review,
          }),
        );
        if (!(await appendEvent(tx, scope, event, actor, actor, null))) {
          throw new EvidenceRenewalUnavailableError(
            "Renewal review receipt could not be appended",
          );
        }
        return {
          outcome: "updated",
          plan: await onePlan(tx, scope, [...events, event], planId, now),
          replayed: false,
        };
      }),
    );
  }
}

export const postgresEvidenceRenewalRepository =
  new PostgresEvidenceRenewalRepository();
