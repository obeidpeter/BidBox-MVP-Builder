import { and, asc, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
import {
  auditEvents,
  currentTenantDatabaseOrganisation,
  db,
  organisationMemberships,
  roleGrants,
  tenders,
  users,
} from "@workspace/db";
import type { LocalUser } from "../accessContext";
import { writeAuditTx } from "../audit";
import { parseInstantPreserving } from "../dbClock";
import { ORGANISATION_ROLES, hasPermission } from "../permissions";
import {
  OPPORTUNITY_SOURCE_NETWORK_BOUNDS,
  OpportunitySourceNetworkError,
  type NormalizedOpportunitySourceInput,
  type OpportunitySourceCandidate,
  type OpportunitySourceDecision,
  type OpportunitySourceRepository,
  type OpportunitySourceScope,
} from "./contracts";
import { normalizeOpportunitySourceInput } from "./service";

const OBJECT_TYPE = "opportunity_source.candidate" as const;
const CREATED_EVENT = "opportunity_source.candidate_recorded" as const;
const DECIDED_EVENT = "opportunity_source.candidate_decided" as const;
const EVENT_SCHEMA = "valo.opportunity-source-network/v1" as const;
import { UUID_V1_5_PATTERN as UUID } from "../identifierPatterns";
const CONTROL = /[\u0000-\u001f\u007f]/u;
const SOURCE_READ_ROLES = ORGANISATION_ROLES.filter((role) =>
  hasPermission([role], "organisation:read"),
);
const SOURCE_MANAGE_ROLES = ORGANISATION_ROLES.filter((role) =>
  hasPermission([role], "project:create"),
);
const CANDIDATE_KEYS = [
  "sourceKind",
  "sourceSystem",
  "sourceAuthority",
  "sourceLocator",
  "sourceLicenceReference",
  "externalReference",
  "title",
  "procuringEntity",
  "jurisdiction",
  "fundingSource",
  "procurementCategory",
  "publishedAt",
  "submissionDeadline",
  "observedAt",
  "sourceContentSha256",
  "provenance",
  "sourceLocatorSha256",
  "receiptSha256",
  "dedupeKey",
] as const;

type RepositoryTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

interface StoredCreatedEvent {
  schema: typeof EVENT_SCHEMA;
  kind: "candidate_recorded";
  candidate: NormalizedOpportunitySourceInput;
  recordedByUserId: string;
  recordedByName: string;
}

interface StoredDecisionEvent {
  schema: typeof EVENT_SCHEMA;
  kind: "candidate_decided";
  expectedVersion: 1;
  decision: "accept" | "reject";
  reason: string;
  reviewedByUserId: string;
  reviewedByName: string;
  reviewedAt: string;
  tenderId: string | null;
}

import { isPlainRecord as isPlain } from "../typeGuards";

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

function validHumanName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value === value.trim() &&
    value.length >= 1 &&
    value.length <= OPPORTUNITY_SOURCE_NETWORK_BOUNDS.maxTitleCodeUnits &&
    !CONTROL.test(value)
  );
}

function invalidPersisted(message: string): never {
  throw new OpportunitySourceNetworkError("persisted_state_invalid", message);
}

function assertScope(scope: OpportunitySourceScope): void {
  if (
    !UUID.test(scope.organisationId) ||
    !UUID.test(scope.actorUserId) ||
    !validHumanName(scope.actorName) ||
    currentTenantDatabaseOrganisation() !== scope.organisationId
  ) {
    throw new OpportunitySourceNetworkError(
      "scope_denied",
      "A matching tenant transaction and named actor are required.",
    );
  }
}

async function requireCurrentActor(
  tx: RepositoryTx,
  scope: OpportunitySourceScope,
  manage: boolean,
  now: Date,
): Promise<LocalUser> {
  const memberships = await tx
    .select({ membershipId: organisationMemberships.id, actor: users })
    .from(organisationMemberships)
    .innerJoin(users, eq(organisationMemberships.userId, users.id))
    .where(
      and(
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
  const membership = memberships[0];
  if (
    memberships.length !== 1 ||
    !membership ||
    membership.actor.name !== scope.actorName ||
    !validHumanName(membership.actor.name)
  ) {
    throw new OpportunitySourceNetworkError(
      "scope_denied",
      "Current source authority could not be verified.",
    );
  }
  const roles = manage ? SOURCE_MANAGE_ROLES : SOURCE_READ_ROLES;
  const grants = await tx
    .select({ id: roleGrants.id })
    .from(roleGrants)
    .where(
      and(
        eq(roleGrants.membershipId, membership.membershipId),
        inArray(roleGrants.role, roles),
        isNull(roleGrants.revokedAt),
        or(isNull(roleGrants.startsAt), lte(roleGrants.startsAt, now)),
        or(isNull(roleGrants.expiresAt), gt(roleGrants.expiresAt, now)),
      ),
    )
    .limit(roles.length + 1);
  if (grants.length < 1 || grants.length > roles.length) {
    throw new OpportunitySourceNetworkError(
      "scope_denied",
      "Current source authority could not be verified.",
    );
  }
  return membership.actor as LocalUser;
}

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
  const result = await tx.execute<{ now: unknown }>(
    sql`SELECT pg_catalog.clock_timestamp() AS "now"`,
  );
  const now = parseInstantPreserving(result.rows[0]?.now);
  if (now === null) {
    throw new OpportunitySourceNetworkError(
      "source_unavailable",
      "Current database time could not be verified.",
    );
  }
  return now;
}

function parseCreated(
  objectId: string | null,
  organisationId: string,
  raw: string,
): OpportunitySourceCandidate {
  if (!objectId || !UUID.test(objectId)) {
    invalidPersisted("A source receipt has an invalid identity.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    invalidPersisted("A source receipt is not valid JSON.");
  }
  if (
    !isPlain(parsed) ||
    !exactKeys(parsed, [
      "schema",
      "kind",
      "candidate",
      "recordedByUserId",
      "recordedByName",
    ]) ||
    parsed.schema !== EVENT_SCHEMA ||
    parsed.kind !== "candidate_recorded" ||
    !isPlain(parsed.candidate) ||
    !exactKeys(parsed.candidate, CANDIDATE_KEYS) ||
    (parsed.candidate.provenance !== "operator_recorded" &&
      parsed.candidate.provenance !== "adapter_verified") ||
    !UUID.test(String(parsed.recordedByUserId)) ||
    !validHumanName(parsed.recordedByName)
  ) {
    invalidPersisted("A source receipt failed its closed schema.");
  }
  const stored = parsed as unknown as StoredCreatedEvent;
  let normalized: NormalizedOpportunitySourceInput;
  try {
    normalized = normalizeOpportunitySourceInput(
      stored.candidate,
      stored.candidate.provenance,
    );
  } catch {
    invalidPersisted("A source receipt failed canonical validation.");
  }
  if (
    normalized.receiptSha256 !== stored.candidate.receiptSha256 ||
    normalized.dedupeKey !== stored.candidate.dedupeKey ||
    normalized.sourceLocatorSha256 !== stored.candidate.sourceLocatorSha256
  ) {
    invalidPersisted("A source receipt digest does not match its content.");
  }
  return {
    ...normalized,
    id: objectId,
    organisationId,
    status: "pending_review",
    version: 1,
    recordedByUserId: stored.recordedByUserId,
    recordedByName: stored.recordedByName,
    reviewedByUserId: null,
    reviewedByName: null,
    reviewedAt: null,
    decisionReason: null,
    tenderId: null,
  };
}

function applyDecision(
  candidate: OpportunitySourceCandidate,
  raw: string,
): OpportunitySourceCandidate {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    invalidPersisted("A source decision is not valid JSON.");
  }
  const reviewedAt =
    isPlain(parsed) && typeof parsed.reviewedAt === "string"
      ? new Date(parsed.reviewedAt)
      : null;
  if (
    !isPlain(parsed) ||
    !exactKeys(parsed, [
      "schema",
      "kind",
      "expectedVersion",
      "decision",
      "reason",
      "reviewedByUserId",
      "reviewedByName",
      "reviewedAt",
      "tenderId",
    ]) ||
    parsed.schema !== EVENT_SCHEMA ||
    parsed.kind !== "candidate_decided" ||
    parsed.expectedVersion !== 1 ||
    (parsed.decision !== "accept" && parsed.decision !== "reject") ||
    typeof parsed.reason !== "string" ||
    parsed.reason !== parsed.reason.trim() ||
    parsed.reason.length < 1 ||
    parsed.reason.length >
      OPPORTUNITY_SOURCE_NETWORK_BOUNDS.maxSummaryCodeUnits ||
    CONTROL.test(parsed.reason) ||
    !UUID.test(String(parsed.reviewedByUserId)) ||
    !validHumanName(parsed.reviewedByName) ||
    !reviewedAt ||
    !Number.isFinite(reviewedAt.getTime()) ||
    reviewedAt.toISOString() !== parsed.reviewedAt ||
    (parsed.decision === "accept"
      ? !UUID.test(String(parsed.tenderId))
      : parsed.tenderId !== null)
  ) {
    invalidPersisted("A source decision failed its closed schema.");
  }
  const decision = parsed as unknown as StoredDecisionEvent;
  return {
    ...candidate,
    status: decision.decision === "accept" ? "accepted" : "rejected",
    version: 2,
    reviewedByUserId: decision.reviewedByUserId,
    reviewedByName: decision.reviewedByName,
    reviewedAt: decision.reviewedAt,
    decisionReason: decision.reason,
    tenderId: decision.tenderId,
  };
}

async function loadCandidates(
  tx: RepositoryTx,
  organisationId: string,
): Promise<OpportunitySourceCandidate[]> {
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
        eq(auditEvents.objectType, OBJECT_TYPE),
        inArray(auditEvents.eventType, [CREATED_EVENT, DECIDED_EVENT]),
      ),
    )
    .orderBy(asc(auditEvents.seq))
    .limit(OPPORTUNITY_SOURCE_NETWORK_BOUNDS.eventsPerOrganisation + 1);
  if (
    metadata.length > OPPORTUNITY_SOURCE_NETWORK_BOUNDS.eventsPerOrganisation
  ) {
    throw new OpportunitySourceNetworkError(
      "capacity_exceeded",
      "The source event set exceeds its safe bound.",
    );
  }
  let totalBytes = 0;
  for (const row of metadata) {
    if (
      !Number.isSafeInteger(row.codeUnits) ||
      !Number.isSafeInteger(row.bytes) ||
      row.codeUnits < 1 ||
      row.codeUnits > OPPORTUNITY_SOURCE_NETWORK_BOUNDS.maxEventCodeUnits ||
      row.bytes < 1 ||
      row.bytes > OPPORTUNITY_SOURCE_NETWORK_BOUNDS.maxEventBytes
    ) {
      invalidPersisted("A source event exceeds its materialisation bound.");
    }
    totalBytes += row.bytes;
    if (totalBytes > OPPORTUNITY_SOURCE_NETWORK_BOUNDS.maxEventSetBytes) {
      throw new OpportunitySourceNetworkError(
        "capacity_exceeded",
        "The source event set exceeds its byte bound.",
      );
    }
  }
  if (metadata.length === 0) return [];
  const rows = await tx
    .select({
      id: auditEvents.id,
      eventType: auditEvents.eventType,
      objectId: auditEvents.objectId,
      details: auditEvents.details,
      seq: auditEvents.seq,
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
    throw new OpportunitySourceNetworkError(
      "conflict",
      "The source event set changed while it was read.",
    );
  }
  const candidates = new Map<string, OpportunitySourceCandidate>();
  for (const row of rows) {
    if (!row.details || !row.objectId) {
      invalidPersisted("A source event is incomplete.");
    }
    if (row.eventType === CREATED_EVENT) {
      if (candidates.has(row.objectId)) {
        invalidPersisted("A candidate has more than one source receipt.");
      }
      candidates.set(
        row.objectId,
        parseCreated(row.objectId, organisationId, row.details),
      );
      continue;
    }
    const candidate = candidates.get(row.objectId);
    if (!candidate || candidate.status !== "pending_review") {
      invalidPersisted("A source decision has no unique pending receipt.");
    }
    candidates.set(row.objectId, applyDecision(candidate, row.details));
  }
  if (
    candidates.size >
    OPPORTUNITY_SOURCE_NETWORK_BOUNDS.candidatesPerOrganisation
  ) {
    throw new OpportunitySourceNetworkError(
      "capacity_exceeded",
      "The source candidate set exceeds its safe bound.",
    );
  }
  return [...candidates.values()].sort((left, right) =>
    left.observedAt.localeCompare(right.observedAt),
  );
}

export async function lockOpportunitySourceNetwork(
  tx: RepositoryTx,
  organisationId: string,
): Promise<void> {
  await tx.execute(sql`
    select pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(${`${organisationId}:opportunity-source-network`}, 0)
    )
  `);
}

/**
 * Loads one candidate through the caller's already-scoped tenant transaction.
 * Callers that need a write-stable snapshot must acquire
 * `lockOpportunitySourceNetwork` first.
 */
export async function loadOpportunitySourceCandidateTx(
  tx: RepositoryTx,
  organisationId: string,
  candidateId: string,
): Promise<OpportunitySourceCandidate | null> {
  if (!UUID.test(candidateId)) return null;
  return (
    (await loadCandidates(tx, organisationId)).find(
      ({ id }) => id === candidateId,
    ) ?? null
  );
}

export class AuditOpportunitySourceRepository implements OpportunitySourceRepository {
  async list(
    scope: OpportunitySourceScope,
  ): Promise<OpportunitySourceCandidate[]> {
    assertScope(scope);
    return db.transaction(
      async (tx) => {
        await lockMembershipAdministrationBoundary(tx, scope.organisationId);
        await lockOpportunitySourceNetwork(tx, scope.organisationId);
        const now = await currentDatabaseTime(tx);
        await requireCurrentActor(tx, scope, false, now);
        return loadCandidates(tx, scope.organisationId);
      },
      { isolationLevel: "read committed" },
    );
  }

  async get(
    scope: OpportunitySourceScope,
    candidateId: string,
  ): Promise<OpportunitySourceCandidate | null> {
    if (!UUID.test(candidateId)) return null;
    return (
      (await this.list(scope)).find(({ id }) => id === candidateId) ?? null
    );
  }

  async create(
    scope: OpportunitySourceScope,
    input: NormalizedOpportunitySourceInput,
  ): Promise<OpportunitySourceCandidate> {
    assertScope(scope);
    return db.transaction(
      async (tx) => {
        await lockMembershipAdministrationBoundary(tx, scope.organisationId);
        await lockOpportunitySourceNetwork(tx, scope.organisationId);
        const now = await currentDatabaseTime(tx);
        const actor = await requireCurrentActor(tx, scope, true, now);
        const current = await loadCandidates(tx, scope.organisationId);
        const duplicate = current.find(
          ({ dedupeKey }) => dedupeKey === input.dedupeKey,
        );
        if (duplicate) {
          if (duplicate.receiptSha256 === input.receiptSha256) return duplicate;
          throw new OpportunitySourceNetworkError(
            "conflict",
            "The source reference already exists with different metadata.",
          );
        }
        if (
          current.length >=
          OPPORTUNITY_SOURCE_NETWORK_BOUNDS.candidatesPerOrganisation
        ) {
          throw new OpportunitySourceNetworkError(
            "capacity_exceeded",
            "The source inbox has reached its safe bound.",
          );
        }
        const id = crypto.randomUUID();
        const event: StoredCreatedEvent = {
          schema: EVENT_SCHEMA,
          kind: "candidate_recorded",
          candidate: input,
          recordedByUserId: scope.actorUserId,
          recordedByName: scope.actorName,
        };
        await writeAuditTx(tx, {
          user: actor,
          organisationId: scope.organisationId,
          eventType: CREATED_EVENT,
          objectType: OBJECT_TYPE,
          objectId: id,
          details: JSON.stringify(event),
        });
        return parseCreated(id, scope.organisationId, JSON.stringify(event));
      },
      { isolationLevel: "read committed" },
    );
  }

  async decide(
    scope: OpportunitySourceScope,
    candidateId: string,
    decision: OpportunitySourceDecision,
  ): Promise<OpportunitySourceCandidate> {
    assertScope(scope);
    if (!UUID.test(candidateId)) {
      throw new OpportunitySourceNetworkError(
        "not_found",
        "Candidate not found.",
      );
    }
    return db.transaction(
      async (tx) => {
        await lockMembershipAdministrationBoundary(tx, scope.organisationId);
        await lockOpportunitySourceNetwork(tx, scope.organisationId);
        const now = await currentDatabaseTime(tx);
        const actor = await requireCurrentActor(tx, scope, true, now);
        const current = (await loadCandidates(tx, scope.organisationId)).find(
          ({ id }) => id === candidateId,
        );
        if (!current) {
          throw new OpportunitySourceNetworkError(
            "not_found",
            "Candidate not found.",
          );
        }
        if (
          current.status !== "pending_review" ||
          current.version !== decision.expectedVersion
        ) {
          throw new OpportunitySourceNetworkError(
            "conflict",
            "The candidate changed before the decision was recorded.",
          );
        }
        let tenderId: string | null = null;
        if (decision.decision === "accept") {
          const inserted = await tx
            .insert(tenders)
            .values({
              organisationId: scope.organisationId,
              reference: current.externalReference,
              title: current.title,
              procuringEntity: current.procuringEntity,
              jurisdiction: current.jurisdiction,
              fundingSource: current.fundingSource,
              procurementCategory: current.procurementCategory,
              sourceType: current.sourceKind,
              sourceLicenceReference: current.sourceLicenceReference,
              submissionDeadline: current.submissionDeadline
                ? new Date(current.submissionDeadline)
                : null,
              status: "identified",
            })
            .onConflictDoNothing({
              target: [tenders.organisationId, tenders.reference],
            })
            .returning({ id: tenders.id });
          if (inserted.length !== 1) {
            throw new OpportunitySourceNetworkError(
              "conflict",
              "A tender with this source reference already exists.",
            );
          }
          tenderId = inserted[0]?.id ?? null;
          if (!tenderId)
            invalidPersisted("The accepted tender identity is missing.");
        }
        const reviewedAt = new Date().toISOString();
        const event: StoredDecisionEvent = {
          schema: EVENT_SCHEMA,
          kind: "candidate_decided",
          expectedVersion: 1,
          decision: decision.decision,
          reason: decision.reason,
          reviewedByUserId: scope.actorUserId,
          reviewedByName: scope.actorName,
          reviewedAt,
          tenderId,
        };
        await writeAuditTx(tx, {
          user: actor,
          organisationId: scope.organisationId,
          eventType: DECIDED_EVENT,
          objectType: OBJECT_TYPE,
          objectId: candidateId,
          details: JSON.stringify(event),
        });
        return applyDecision(current, JSON.stringify(event));
      },
      { isolationLevel: "read committed" },
    );
  }
}
