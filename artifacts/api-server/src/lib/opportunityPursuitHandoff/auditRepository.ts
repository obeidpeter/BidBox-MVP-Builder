import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
import {
  auditEvents,
  clients,
  currentTenantDatabaseOrganisation,
  db,
  engagementTenderLots,
  organisationMemberships,
  projects,
  roleGrants,
  tenderLots,
  tenders,
  users,
} from "@workspace/db";
import type { LocalUser } from "../../middlewares/auth";
import { writeAuditTx } from "../audit";
import { parseInstantPreserving } from "../dbClock";
import {
  loadOpportunitySourceCandidateTx,
  lockOpportunitySourceNetwork,
  type OpportunitySourceCandidate,
} from "../opportunitySourceNetwork";
import { ORGANISATION_ROLES, hasPermission } from "../permissions";
import {
  OPPORTUNITY_PURSUIT_HANDOFF_AUTHORITY,
  OPPORTUNITY_PURSUIT_HANDOFF_BOUNDS,
  OPPORTUNITY_PURSUIT_HANDOFF_SCHEMA,
  OpportunityPursuitHandoffError,
  type AcceptedOpportunitySourceCandidate,
  type NormalizedOpportunityPursuitHandoffDraft,
  type OpportunityPursuitConflictMatch,
  type OpportunityPursuitHandoffPreparation,
  type OpportunityPursuitHandoffReceipt,
  type OpportunityPursuitHandoffRepository,
  type OpportunityPursuitHandoffResult,
  type OpportunityPursuitHandoffScope,
  type OpportunityPursuitLotChoice,
  type OpportunityPursuitReviewerChoice,
} from "./contracts";
import { hashOpportunityPursuitHandoff } from "./service";

const EVENT_TYPE = "opportunity_source.pursuit_handoff_confirmed" as const;
const OBJECT_TYPE = "opportunity_source.pursuit_handoff" as const;
import {
  SHA256_HEX_PATTERN as SHA256,
  UUID_PATTERN as UUID,
} from "../identifierPatterns";
const CONTROL = /[\u0000-\u001f\u007f]/u;
const ACTIVE_CONFLICT_STATUSES = [
  "intake",
  "extraction",
  "review",
  "defects",
  "reporting",
  "signed_off",
] as const;
const HANDOFF_ROLES = ORGANISATION_ROLES.filter((role) =>
  hasPermission([role], "project:create"),
);
const REVIEWER_ROLES = ORGANISATION_ROLES.filter((role) =>
  hasPermission([role], "draft:review"),
);
const RECEIPT_KEYS = [
  "schema",
  "organisationId",
  "candidateId",
  "projectId",
  "clientId",
  "clientVersion",
  "tenderId",
  "tenderLotId",
  "tenderLotVersion",
  "confirmedLotReference",
  "reviewerUserId",
  "sourceReceiptSha256",
  "sourceLocatorSha256",
  "confirmedBuyer",
  "confirmedReference",
  "confirmedSubmissionDeadline",
  "confirmationNote",
  "confirmedByUserId",
  "confirmedByName",
  "confirmedAt",
  "conflictBoundarySha256",
  "conflictStatus",
  "matchedProjectId",
  "projectStatus",
  "idempotencyKeySha256",
  "requestSha256",
  "receiptSha256",
] as const;

type RepositoryTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function validName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value === value.trim() &&
    value.length >= 1 &&
    value.length <= OPPORTUNITY_PURSUIT_HANDOFF_BOUNDS.maxTextCodeUnits &&
    !CONTROL.test(value)
  );
}

export function canonicalOpportunityPursuitConflictValue(
  value: string | null | undefined,
): string | null {
  if (value == null) return null;
  const normalized = value.normalize("NFC").trim().replace(/\s+/gu, " ");
  return normalized.length === 0 ? null : normalized;
}

function exactIso(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

import { isPlainRecord as plain } from "../typeGuards";

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const expected = new Set(keys);
  return (
    Object.keys(value).length === expected.size &&
    Object.keys(value).every((key) => expected.has(key))
  );
}

function invalidPersisted(message: string): never {
  throw new OpportunityPursuitHandoffError("persisted_state_invalid", message);
}

function receiptCore(
  receipt: OpportunityPursuitHandoffReceipt,
): Omit<OpportunityPursuitHandoffReceipt, "receiptSha256"> {
  const { receiptSha256: _digest, ...core } = receipt;
  return core;
}

function parseReceipt(raw: string): OpportunityPursuitHandoffReceipt {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    invalidPersisted("A pursuit handoff receipt is not valid JSON.");
  }
  if (
    !plain(parsed) ||
    !exactKeys(parsed, RECEIPT_KEYS) ||
    parsed.schema !== OPPORTUNITY_PURSUIT_HANDOFF_SCHEMA ||
    !UUID.test(String(parsed.organisationId)) ||
    !UUID.test(String(parsed.candidateId)) ||
    !UUID.test(String(parsed.projectId)) ||
    !UUID.test(String(parsed.clientId)) ||
    !Number.isSafeInteger(parsed.clientVersion) ||
    Number(parsed.clientVersion) < 1 ||
    !UUID.test(String(parsed.tenderId)) ||
    (parsed.tenderLotId !== null && !UUID.test(String(parsed.tenderLotId))) ||
    (parsed.tenderLotVersion !== null &&
      (!Number.isSafeInteger(parsed.tenderLotVersion) ||
        Number(parsed.tenderLotVersion) < 1)) ||
    (parsed.confirmedLotReference !== null &&
      !validName(parsed.confirmedLotReference)) ||
    (parsed.tenderLotId === null
      ? parsed.tenderLotVersion !== null ||
        parsed.confirmedLotReference !== null
      : parsed.tenderLotVersion === null ||
        parsed.confirmedLotReference === null) ||
    !UUID.test(String(parsed.reviewerUserId)) ||
    !SHA256.test(String(parsed.sourceReceiptSha256)) ||
    !SHA256.test(String(parsed.sourceLocatorSha256)) ||
    !validName(parsed.confirmedBuyer) ||
    !validName(parsed.confirmedReference) ||
    (parsed.confirmedSubmissionDeadline !== null &&
      !exactIso(parsed.confirmedSubmissionDeadline)) ||
    typeof parsed.confirmationNote !== "string" ||
    parsed.confirmationNote !== parsed.confirmationNote.trim() ||
    parsed.confirmationNote.length < 1 ||
    parsed.confirmationNote.length >
      OPPORTUNITY_PURSUIT_HANDOFF_BOUNDS.maxNoteCodeUnits ||
    CONTROL.test(parsed.confirmationNote) ||
    !UUID.test(String(parsed.confirmedByUserId)) ||
    !validName(parsed.confirmedByName) ||
    !exactIso(parsed.confirmedAt) ||
    !SHA256.test(String(parsed.conflictBoundarySha256)) ||
    parsed.conflictStatus !== "clear" ||
    parsed.matchedProjectId !== null ||
    parsed.projectStatus !== "intake" ||
    !SHA256.test(String(parsed.idempotencyKeySha256)) ||
    !SHA256.test(String(parsed.requestSha256)) ||
    !SHA256.test(String(parsed.receiptSha256))
  ) {
    invalidPersisted("A pursuit handoff receipt failed its closed schema.");
  }
  const receipt = parsed as unknown as OpportunityPursuitHandoffReceipt;
  if (
    hashOpportunityPursuitHandoff(receiptCore(receipt)) !==
    receipt.receiptSha256
  ) {
    invalidPersisted(
      "A pursuit handoff receipt digest does not match its content.",
    );
  }
  return receipt;
}

function assertScope(scope: OpportunityPursuitHandoffScope): void {
  if (
    !UUID.test(scope.organisationId) ||
    !UUID.test(scope.actorUserId) ||
    !UUID.test(scope.actorMembershipId) ||
    !validName(scope.actorName) ||
    currentTenantDatabaseOrganisation() !== scope.organisationId
  ) {
    throw new OpportunityPursuitHandoffError(
      "scope_denied",
      "A matching tenant transaction and direct named membership are required.",
    );
  }
}

async function requireCurrentActor(
  tx: RepositoryTx,
  scope: OpportunityPursuitHandoffScope,
  now: Date,
): Promise<LocalUser> {
  const memberships = await tx
    .select({ membership: organisationMemberships, actor: users })
    .from(organisationMemberships)
    .innerJoin(users, eq(organisationMemberships.userId, users.id))
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
      ),
    )
    .limit(2);
  const current = memberships[0];
  if (
    memberships.length !== 1 ||
    !current ||
    current.actor.name !== scope.actorName ||
    !validName(current.actor.name)
  ) {
    throw new OpportunityPursuitHandoffError(
      "scope_denied",
      "Current direct handoff authority could not be verified.",
    );
  }
  const grants = await tx
    .select({ id: roleGrants.id })
    .from(roleGrants)
    .where(
      and(
        eq(roleGrants.membershipId, scope.actorMembershipId),
        inArray(roleGrants.role, HANDOFF_ROLES),
        isNull(roleGrants.revokedAt),
        or(isNull(roleGrants.startsAt), lte(roleGrants.startsAt, now)),
        or(isNull(roleGrants.expiresAt), gt(roleGrants.expiresAt, now)),
      ),
    )
    .limit(HANDOFF_ROLES.length + 1);
  if (grants.length < 1 || grants.length > HANDOFF_ROLES.length) {
    throw new OpportunityPursuitHandoffError(
      "scope_denied",
      "Current direct handoff authority could not be verified.",
    );
  }
  return current.actor as LocalUser;
}

function acceptedCandidate(
  candidate: OpportunitySourceCandidate,
  scope: OpportunityPursuitHandoffScope,
): AcceptedOpportunitySourceCandidate {
  if (
    candidate.organisationId !== scope.organisationId ||
    candidate.status !== "accepted" ||
    !candidate.tenderId ||
    !candidate.reviewedByUserId ||
    !candidate.reviewedByName ||
    !candidate.reviewedAt
  ) {
    throw new OpportunityPursuitHandoffError(
      "conflict",
      "The source must have an accepted named-human decision before handoff.",
    );
  }
  return candidate as AcceptedOpportunitySourceCandidate;
}

async function loadReceipts(
  tx: RepositoryTx,
  organisationId: string,
): Promise<OpportunityPursuitHandoffReceipt[]> {
  const metadata = await tx
    .select({
      id: auditEvents.id,
      codeUnits: sql<number>`pg_catalog.char_length(${auditEvents.details})`,
      bytes: sql<number>`pg_catalog.octet_length(${auditEvents.details})`,
    })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.organisationId, organisationId),
        eq(auditEvents.eventType, EVENT_TYPE),
        eq(auditEvents.objectType, OBJECT_TYPE),
        isNotNull(auditEvents.details),
      ),
    )
    .orderBy(asc(auditEvents.seq))
    .limit(OPPORTUNITY_PURSUIT_HANDOFF_BOUNDS.receipts + 1);
  if (metadata.length > OPPORTUNITY_PURSUIT_HANDOFF_BOUNDS.receipts) {
    throw new OpportunityPursuitHandoffError(
      "capacity_exceeded",
      "The pursuit handoff receipt set exceeds its safe bound.",
    );
  }
  let totalBytes = 0;
  for (const item of metadata) {
    if (
      !Number.isSafeInteger(item.codeUnits) ||
      !Number.isSafeInteger(item.bytes) ||
      item.codeUnits < 1 ||
      item.codeUnits > OPPORTUNITY_PURSUIT_HANDOFF_BOUNDS.maxEventCodeUnits ||
      item.bytes < 1 ||
      item.bytes > OPPORTUNITY_PURSUIT_HANDOFF_BOUNDS.maxEventBytes
    ) {
      invalidPersisted(
        "A pursuit handoff receipt exceeds its materialisation bound.",
      );
    }
    totalBytes += item.bytes;
    if (totalBytes > OPPORTUNITY_PURSUIT_HANDOFF_BOUNDS.maxEventSetBytes) {
      throw new OpportunityPursuitHandoffError(
        "capacity_exceeded",
        "The pursuit handoff receipt set exceeds its byte bound.",
      );
    }
  }
  if (metadata.length === 0) return [];
  const rows = await tx
    .select({
      id: auditEvents.id,
      objectId: auditEvents.objectId,
      projectId: auditEvents.projectId,
      details: auditEvents.details,
    })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.organisationId, organisationId),
        inArray(
          auditEvents.id,
          metadata.map(({ id }) => id),
        ),
      ),
    )
    .orderBy(asc(auditEvents.seq));
  if (rows.length !== metadata.length) {
    throw new OpportunityPursuitHandoffError(
      "conflict",
      "The handoff receipt set changed while it was read.",
    );
  }
  const receipts = rows.map(({ details, objectId, projectId }) => {
    if (!details) invalidPersisted("A pursuit handoff receipt is incomplete.");
    const receipt = parseReceipt(details);
    if (objectId !== receipt.projectId || projectId !== receipt.projectId) {
      invalidPersisted(
        "A pursuit handoff receipt is bound to the wrong project.",
      );
    }
    return receipt;
  });
  const candidates = new Set<string>();
  const projectsSeen = new Set<string>();
  const keys = new Set<string>();
  for (const receipt of receipts) {
    if (
      receipt.organisationId !== organisationId ||
      candidates.has(receipt.candidateId) ||
      projectsSeen.has(receipt.projectId) ||
      keys.has(receipt.idempotencyKeySha256)
    ) {
      invalidPersisted(
        "Pursuit handoff receipts violate uniqueness invariants.",
      );
    }
    candidates.add(receipt.candidateId);
    projectsSeen.add(receipt.projectId);
    keys.add(receipt.idempotencyKeySha256);
  }
  return receipts;
}

async function loadReviewers(
  tx: RepositoryTx,
  scope: OpportunityPursuitHandoffScope,
  now: Date,
): Promise<OpportunityPursuitReviewerChoice[]> {
  const memberships = await tx
    .select({
      membershipId: organisationMemberships.id,
      userId: users.id,
      name: users.name,
    })
    .from(organisationMemberships)
    .innerJoin(users, eq(organisationMemberships.userId, users.id))
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
        isNotNull(users.name),
      ),
    )
    .orderBy(asc(users.id))
    .limit(OPPORTUNITY_PURSUIT_HANDOFF_BOUNDS.choices + 1);
  if (memberships.length > OPPORTUNITY_PURSUIT_HANDOFF_BOUNDS.choices) {
    throw new OpportunityPursuitHandoffError(
      "capacity_exceeded",
      "The named reviewer directory exceeds its safe bound.",
    );
  }
  if (memberships.length === 0) return [];
  const grants = await tx
    .select({ membershipId: roleGrants.membershipId })
    .from(roleGrants)
    .where(
      and(
        inArray(
          roleGrants.membershipId,
          memberships.map(({ membershipId }) => membershipId),
        ),
        inArray(roleGrants.role, REVIEWER_ROLES),
        isNull(roleGrants.revokedAt),
        or(isNull(roleGrants.startsAt), lte(roleGrants.startsAt, now)),
        or(isNull(roleGrants.expiresAt), gt(roleGrants.expiresAt, now)),
      ),
    )
    .limit(memberships.length * REVIEWER_ROLES.length + 1);
  const eligible = new Set(grants.map(({ membershipId }) => membershipId));
  return memberships
    .filter(
      ({ membershipId, userId, name }) =>
        eligible.has(membershipId) &&
        userId !== scope.actorUserId &&
        validName(name),
    )
    .map(({ userId, name }) => ({ userId, name: name! }))
    .sort(
      (left, right) =>
        left.name.localeCompare(right.name) ||
        left.userId.localeCompare(right.userId),
    );
}

async function loadTender(
  tx: RepositoryTx,
  scope: OpportunityPursuitHandoffScope,
  candidate: AcceptedOpportunitySourceCandidate,
) {
  const rows = await tx
    .select()
    .from(tenders)
    .where(
      and(
        eq(tenders.id, candidate.tenderId),
        eq(tenders.organisationId, scope.organisationId),
      ),
    )
    .limit(2);
  const tender = rows[0];
  if (rows.length !== 1 || !tender) {
    throw new OpportunityPursuitHandoffError(
      "not_found",
      "Accepted tender not found.",
    );
  }
  const canonicalReference = canonicalOpportunityPursuitConflictValue(
    tender.reference,
  );
  if (
    !canonicalReference ||
    canonicalReference !== candidate.externalReference ||
    tender.title !== candidate.title ||
    tender.procuringEntity !== candidate.procuringEntity ||
    (tender.submissionDeadline?.toISOString() ?? null) !==
      candidate.submissionDeadline
  ) {
    throw new OpportunityPursuitHandoffError(
      "conflict",
      "The accepted tender changed after source review.",
    );
  }
  return { ...tender, reference: canonicalReference };
}

async function loadLots(
  tx: RepositoryTx,
  scope: OpportunityPursuitHandoffScope,
  tenderId: string,
): Promise<OpportunityPursuitLotChoice[]> {
  const rows = await tx
    .select()
    .from(tenderLots)
    .where(
      and(
        eq(tenderLots.organisationId, scope.organisationId),
        eq(tenderLots.tenderId, tenderId),
        eq(tenderLots.status, "active"),
      ),
    )
    .orderBy(asc(tenderLots.lotReference), asc(tenderLots.id))
    .limit(OPPORTUNITY_PURSUIT_HANDOFF_BOUNDS.choices + 1);
  if (rows.length > OPPORTUNITY_PURSUIT_HANDOFF_BOUNDS.choices) {
    throw new OpportunityPursuitHandoffError(
      "capacity_exceeded",
      "The accepted lot directory exceeds its safe bound.",
    );
  }
  const references = new Set<string>();
  return rows.map((lot) => {
    const reference = canonicalOpportunityPursuitConflictValue(
      lot.lotReference,
    );
    if (!reference || !validName(reference) || references.has(reference)) {
      invalidPersisted(
        "The accepted lot directory has an invalid or duplicate canonical reference.",
      );
    }
    references.add(reference);
    return {
      id: lot.id,
      reference,
      title: lot.title,
      submissionDeadline: lot.submissionDeadline?.toISOString() ?? null,
      version: lot.version,
    };
  });
}

async function loadConflictBoundary(
  tx: RepositoryTx,
  organisationId: string,
  tenderReference: string,
): Promise<{
  sha256: string;
  matches: OpportunityPursuitConflictMatch[];
}> {
  const rows = await tx
    .select({
      projectId: projects.id,
      lot: projects.lot,
      status: projects.status,
      version: projects.version,
    })
    .from(projects)
    .where(
      and(
        eq(projects.organisationId, organisationId),
        sql`pg_catalog.regexp_replace(normalize(pg_catalog.btrim(${projects.tenderRef}), NFC), '[[:space:]]+', ' ', 'g') = ${tenderReference}`,
        inArray(projects.status, ACTIVE_CONFLICT_STATUSES),
      ),
    )
    .orderBy(asc(projects.id))
    .limit(OPPORTUNITY_PURSUIT_HANDOFF_BOUNDS.conflicts + 1);
  if (rows.length > OPPORTUNITY_PURSUIT_HANDOFF_BOUNDS.conflicts) {
    throw new OpportunityPursuitHandoffError(
      "capacity_exceeded",
      "The same-tender conflict boundary exceeds its safe bound.",
    );
  }
  const matches = rows.map((row) => ({
    projectId: row.projectId,
    lot: canonicalOpportunityPursuitConflictValue(row.lot),
    status: row.status,
    version: row.version,
  }));
  return {
    matches,
    sha256: hashOpportunityPursuitHandoff({
      organisationId,
      tenderReference,
      matches,
    }),
  };
}

/**
 * Every writer that can create or change a same-tender pursuit must acquire
 * this transaction lock before reading the conflict boundary. The handoff
 * router does so directly; legacy project writers should call this helper too.
 */
export async function lockOpportunityPursuitConflictBoundary(
  tx: Pick<typeof db, "execute">,
  organisationId: string,
  tenderReference: string,
): Promise<void> {
  const canonicalReference =
    canonicalOpportunityPursuitConflictValue(tenderReference);
  if (!canonicalReference) {
    throw new OpportunityPursuitHandoffError(
      "invalid_request",
      "A canonical tender reference is required for conflict locking.",
    );
  }
  await tx.execute(sql`SET LOCAL lock_timeout = '3s'`);
  await tx.execute(sql`
    SELECT pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        ${`${organisationId}:pursuit-conflict:${canonicalReference}`},
        0
      )
    )
  `);
}

/** Shares the exact lock namespace used by organisation membership writers. */
async function lockMembershipAdministrationBoundary(
  tx: RepositoryTx,
  organisationId: string,
): Promise<void> {
  await tx.execute(sql`SET LOCAL lock_timeout = '3s'`);
  await tx.execute(sql`
    SELECT pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        ${`bidbox.membership-administration:${organisationId}`},
        0
      )
    )
  `);
  await tx.execute(sql`
    SELECT id FROM public.organisation_memberships
    WHERE organisation_id = ${organisationId}::uuid
    ORDER BY id FOR UPDATE
  `);
  await tx.execute(sql`
    SELECT grant_row.id
    FROM public.role_grants AS grant_row
    INNER JOIN public.organisation_memberships AS membership_row
      ON membership_row.id = grant_row.membership_id
    WHERE membership_row.organisation_id = ${organisationId}::uuid
    ORDER BY grant_row.id
  `);
}

async function currentDatabaseTime(tx: RepositoryTx): Promise<Date> {
  const rows = await tx.execute<{ now: unknown }>(
    sql`SELECT pg_catalog.clock_timestamp() AS "now"`,
  );
  const parsed = parseInstantPreserving(rows.rows[0]?.now);
  if (parsed === null) {
    throw new OpportunityPursuitHandoffError(
      "source_unavailable",
      "Current database time could not be verified.",
    );
  }
  return parsed;
}

async function lockAuthorityAndTargets(
  tx: RepositoryTx,
  scope: OpportunityPursuitHandoffScope,
  draft: NormalizedOpportunityPursuitHandoffDraft,
  tenderId: string,
): Promise<void> {
  await tx.execute(sql`SET LOCAL lock_timeout = '3s'`);
  await tx.execute(sql`
    SELECT id FROM public.users
    WHERE id IN (${scope.actorUserId}::uuid, ${draft.reviewerUserId}::uuid)
    ORDER BY id FOR SHARE
  `);
  await tx.execute(sql`
    SELECT id FROM public.organisation_memberships
    WHERE organisation_id = ${scope.organisationId}::uuid
      AND (id = ${scope.actorMembershipId}::uuid
        OR user_id = ${draft.reviewerUserId}::uuid)
    ORDER BY id FOR SHARE
  `);
  await tx.execute(sql`
    SELECT grant_row.id
    FROM public.role_grants AS grant_row
    INNER JOIN public.organisation_memberships AS membership_row
      ON membership_row.id = grant_row.membership_id
    WHERE membership_row.organisation_id = ${scope.organisationId}::uuid
      AND (membership_row.id = ${scope.actorMembershipId}::uuid
        OR membership_row.user_id = ${draft.reviewerUserId}::uuid)
    ORDER BY grant_row.id
  `);
  await tx.execute(sql`
    SELECT id FROM public.clients
    WHERE organisation_id = ${scope.organisationId}::uuid
      AND id = ${draft.clientId}::uuid
    FOR SHARE
  `);
  await tx.execute(sql`
    SELECT id FROM public.tenders
    WHERE organisation_id = ${scope.organisationId}::uuid
      AND id = ${tenderId}::uuid
    FOR SHARE
  `);
  if (draft.tenderLotId) {
    await tx.execute(sql`
      SELECT id FROM public.tender_lots
      WHERE organisation_id = ${scope.organisationId}::uuid
        AND id = ${draft.tenderLotId}::uuid
      FOR SHARE
    `);
  }
}

export class AuditOpportunityPursuitHandoffRepository implements OpportunityPursuitHandoffRepository {
  async #loadCandidate(
    tx: RepositoryTx,
    scope: OpportunityPursuitHandoffScope,
    candidateId: string,
  ): Promise<AcceptedOpportunitySourceCandidate> {
    const candidate = await loadOpportunitySourceCandidateTx(
      tx,
      scope.organisationId,
      candidateId,
    );
    if (!candidate) {
      throw new OpportunityPursuitHandoffError(
        "not_found",
        "Accepted source not found.",
      );
    }
    return acceptedCandidate(candidate, scope);
  }

  async prepare(
    scope: OpportunityPursuitHandoffScope,
    candidateId: string,
  ): Promise<OpportunityPursuitHandoffPreparation> {
    assertScope(scope);
    return db.transaction(
      async (tx) => {
        await lockMembershipAdministrationBoundary(tx, scope.organisationId);
        await lockOpportunitySourceNetwork(tx, scope.organisationId);
        const now = await currentDatabaseTime(tx);
        await requireCurrentActor(tx, scope, now);
        const candidate = await this.#loadCandidate(tx, scope, candidateId);
        const receipts = await loadReceipts(tx, scope.organisationId);
        const existing = receipts.find(
          (receipt) => receipt.candidateId === candidateId,
        );
        if (existing) {
          return {
            state: "completed" as const,
            receipt: existing,
            authority: OPPORTUNITY_PURSUIT_HANDOFF_AUTHORITY,
          };
        }
        const tender = await loadTender(tx, scope, candidate);
        const clientsRows = await tx
          .select({
            id: clients.id,
            name: clients.name,
            version: clients.version,
          })
          .from(clients)
          .where(eq(clients.organisationId, scope.organisationId))
          .orderBy(asc(clients.name), asc(clients.id))
          .limit(OPPORTUNITY_PURSUIT_HANDOFF_BOUNDS.choices + 1);
        if (clientsRows.length > OPPORTUNITY_PURSUIT_HANDOFF_BOUNDS.choices) {
          throw new OpportunityPursuitHandoffError(
            "capacity_exceeded",
            "The client choice set exceeds its safe bound.",
          );
        }
        const [reviewers, lots, conflictBoundary] = await Promise.all([
          loadReviewers(tx, scope, now),
          loadLots(tx, scope, tender.id),
          loadConflictBoundary(tx, scope.organisationId, tender.reference),
        ]);
        return {
          state: "ready" as const,
          source: {
            candidateId: candidate.id,
            candidateVersion: candidate.version,
            sourceReceiptSha256: candidate.receiptSha256,
            sourceLocator: candidate.sourceLocator,
            sourceLocatorSha256: candidate.sourceLocatorSha256,
            tenderId: tender.id,
            tenderVersion: tender.version,
            title: tender.title,
            buyer: tender.procuringEntity,
            reference: tender.reference,
            submissionDeadline:
              tender.submissionDeadline?.toISOString() ?? null,
            recordedByName: candidate.recordedByName,
            confirmedByName: candidate.reviewedByName,
          },
          clients: clientsRows,
          reviewers,
          lots,
          conflictBoundary: {
            ...conflictBoundary,
            limit: OPPORTUNITY_PURSUIT_HANDOFF_BOUNDS.conflicts as 100,
            truncated: false as const,
          },
          authority: OPPORTUNITY_PURSUIT_HANDOFF_AUTHORITY,
        };
      },
      { isolationLevel: "read committed" },
    );
  }

  async confirm(
    scope: OpportunityPursuitHandoffScope,
    candidateId: string,
    draft: NormalizedOpportunityPursuitHandoffDraft,
  ): Promise<OpportunityPursuitHandoffResult> {
    assertScope(scope);
    return db.transaction(
      async (tx) => {
        await lockMembershipAdministrationBoundary(tx, scope.organisationId);
        await lockOpportunitySourceNetwork(tx, scope.organisationId);
        let authorityTime = await currentDatabaseTime(tx);
        const actor = await requireCurrentActor(tx, scope, authorityTime);
        const candidate = await this.#loadCandidate(tx, scope, candidateId);
        await lockOpportunityPursuitConflictBoundary(
          tx,
          scope.organisationId,
          candidate.externalReference,
        );
        await lockAuthorityAndTargets(tx, scope, draft, candidate.tenderId);
        authorityTime = await currentDatabaseTime(tx);
        await requireCurrentActor(tx, scope, authorityTime);

        const receipts = await loadReceipts(tx, scope.organisationId);
        const keyReceipt = receipts.find(
          (receipt) =>
            receipt.idempotencyKeySha256 === draft.idempotencyKeySha256,
        );
        if (keyReceipt) {
          if (
            keyReceipt.candidateId !== candidateId ||
            keyReceipt.requestSha256 !== draft.requestSha256 ||
            keyReceipt.confirmedByUserId !== scope.actorUserId
          ) {
            throw new OpportunityPursuitHandoffError(
              "conflict",
              "The idempotency key is bound to another handoff request.",
            );
          }
          return {
            outcome: "replayed",
            receipt: keyReceipt,
            authority: OPPORTUNITY_PURSUIT_HANDOFF_AUTHORITY,
          };
        }
        if (receipts.some((receipt) => receipt.candidateId === candidateId)) {
          throw new OpportunityPursuitHandoffError(
            "conflict",
            "This accepted source already has a pursuit handoff receipt.",
          );
        }
        if (receipts.length >= OPPORTUNITY_PURSUIT_HANDOFF_BOUNDS.receipts) {
          throw new OpportunityPursuitHandoffError(
            "capacity_exceeded",
            "The pursuit handoff register has reached its safe bound.",
          );
        }
        if (
          candidate.version !== draft.expectedCandidateVersion ||
          candidate.receiptSha256 !== draft.expectedSourceReceiptSha256 ||
          candidate.procuringEntity !== draft.confirmedBuyer ||
          candidate.externalReference !== draft.confirmedReference
        ) {
          throw new OpportunityPursuitHandoffError(
            "conflict",
            "The accepted source changed or does not match the human confirmation.",
          );
        }
        if (draft.reviewerUserId === scope.actorUserId) {
          throw new OpportunityPursuitHandoffError(
            "scope_denied",
            "The handoff maker and named pursuit reviewer must be different people.",
          );
        }

        const tender = await loadTender(tx, scope, candidate);
        if (tender.version !== draft.expectedTenderVersion) {
          throw new OpportunityPursuitHandoffError(
            "conflict",
            "The accepted tender changed; reopen the source and reload the handoff.",
          );
        }
        const clientRows = await tx
          .select({ id: clients.id, version: clients.version })
          .from(clients)
          .where(
            and(
              eq(clients.id, draft.clientId),
              eq(clients.organisationId, scope.organisationId),
            ),
          )
          .limit(2);
        if (clientRows.length !== 1 || !clientRows[0]) {
          throw new OpportunityPursuitHandoffError(
            "not_found",
            "Client not found.",
          );
        }
        if (clientRows[0].version !== draft.expectedClientVersion) {
          throw new OpportunityPursuitHandoffError(
            "conflict",
            "The selected client changed; reload the handoff before confirming.",
          );
        }
        const reviewers = await loadReviewers(tx, scope, authorityTime);
        if (!reviewers.some(({ userId }) => userId === draft.reviewerUserId)) {
          throw new OpportunityPursuitHandoffError(
            "scope_denied",
            "The named pursuit reviewer is not currently eligible.",
          );
        }
        const lots = await loadLots(tx, scope, tender.id);
        const lot = draft.tenderLotId
          ? lots.find(({ id }) => id === draft.tenderLotId)
          : null;
        if (draft.tenderLotId && !lot) {
          throw new OpportunityPursuitHandoffError(
            "not_found",
            "Selected tender lot not found.",
          );
        }
        if (
          lot &&
          (lot.version !== draft.expectedTenderLotVersion ||
            lot.reference !== draft.confirmedLotReference)
        ) {
          throw new OpportunityPursuitHandoffError(
            "conflict",
            "The selected tender lot changed; reload the handoff and confirm it again.",
          );
        }
        const effectiveDeadline =
          lot?.submissionDeadline ??
          tender.submissionDeadline?.toISOString() ??
          null;
        if (draft.confirmedSubmissionDeadline !== effectiveDeadline) {
          throw new OpportunityPursuitHandoffError(
            "conflict",
            "The confirmed deadline does not match the selected tender or lot.",
          );
        }
        const boundary = await loadConflictBoundary(
          tx,
          scope.organisationId,
          tender.reference,
        );
        if (boundary.sha256 !== draft.expectedConflictBoundarySha256) {
          throw new OpportunityPursuitHandoffError(
            "conflict",
            "The same-tender conflict boundary changed; reload before confirming.",
          );
        }
        const selectedLotReference = lot?.reference ?? null;
        const matched = boundary.matches.find(
          (item) => (item.lot ?? "") === (selectedLotReference ?? ""),
        );
        if (matched) {
          throw new OpportunityPursuitHandoffError(
            "conflict",
            "A current pursuit already occupies this tender and lot; resolve the conflict before handoff.",
          );
        }
        const [project] = await tx
          .insert(projects)
          .values({
            organisationId: scope.organisationId,
            clientId: draft.clientId,
            tenderTitle: tender.title,
            issuingEntity: tender.procuringEntity,
            tenderRef: tender.reference,
            lot: selectedLotReference,
            deadline: effectiveDeadline,
            status: "intake",
            reviewerId: draft.reviewerUserId,
            paymentStatus: "pending",
            conflictStatus: "clear",
            conflictDecision: null,
            conflictRationale: null,
          })
          .returning({ id: projects.id });
        if (!project)
          invalidPersisted("The draft pursuit identity is missing.");
        if (lot) {
          await tx.insert(engagementTenderLots).values({
            organisationId: scope.organisationId,
            projectId: project.id,
            tenderId: tender.id,
            tenderLotId: lot.id,
          });
        }
        const confirmedAt = new Date().toISOString();
        const core: Omit<OpportunityPursuitHandoffReceipt, "receiptSha256"> = {
          schema: OPPORTUNITY_PURSUIT_HANDOFF_SCHEMA,
          organisationId: scope.organisationId,
          candidateId,
          projectId: project.id,
          clientId: draft.clientId,
          clientVersion: clientRows[0].version,
          tenderId: tender.id,
          tenderLotId: lot?.id ?? null,
          tenderLotVersion: lot?.version ?? null,
          confirmedLotReference: lot?.reference ?? null,
          reviewerUserId: draft.reviewerUserId,
          sourceReceiptSha256: candidate.receiptSha256,
          sourceLocatorSha256: candidate.sourceLocatorSha256,
          confirmedBuyer: draft.confirmedBuyer,
          confirmedReference: draft.confirmedReference,
          confirmedSubmissionDeadline: draft.confirmedSubmissionDeadline,
          confirmationNote: draft.confirmationNote,
          confirmedByUserId: scope.actorUserId,
          confirmedByName: scope.actorName,
          confirmedAt,
          conflictBoundarySha256: boundary.sha256,
          conflictStatus: "clear",
          matchedProjectId: null,
          projectStatus: "intake",
          idempotencyKeySha256: draft.idempotencyKeySha256,
          requestSha256: draft.requestSha256,
        };
        const receipt: OpportunityPursuitHandoffReceipt = {
          ...core,
          receiptSha256: hashOpportunityPursuitHandoff(core),
        };
        await writeAuditTx(tx, {
          user: actor,
          organisationId: scope.organisationId,
          projectId: project.id,
          eventType: EVENT_TYPE,
          objectType: OBJECT_TYPE,
          objectId: project.id,
          details: JSON.stringify(receipt),
        });
        return {
          outcome: "created",
          receipt,
          authority: OPPORTUNITY_PURSUIT_HANDOFF_AUTHORITY,
        };
      },
      { isolationLevel: "read committed" },
    );
  }
}
