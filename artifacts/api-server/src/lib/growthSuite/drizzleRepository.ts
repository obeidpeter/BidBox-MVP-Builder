import { randomUUID } from "node:crypto";
import { and, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
import {
  db,
  organisationMemberships,
  organisations,
  roleGrants,
  users,
  withTenantDatabase,
} from "@workspace/db";
import type { LocalUser } from "../accessContext";
import { writeAuditTx } from "../audit";
import {
  GROWTH_SUITE_BOUNDS,
  GrowthSuiteRepositoryUnavailableError,
  type CreateQuoteDraft,
  type GrowthSuiteMutationResult,
  type GrowthSuiteRepository,
  type GrowthSuiteScope,
  type LeadConversionProposal,
  type LeadContactHandoff,
  type LeadContactHandoffPurpose,
  type LeadInboxItem,
  type LeadInboxMutation,
  type LeadInboxStatus,
  type LeadStatusDecision,
  type QuoteProposal,
} from "./contracts";

import {
  SHA256_HEX_PATTERN as SHA256_PATTERN,
  UUID_PATTERN,
} from "../identifierPatterns";
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;
const EVENT_SCHEMA = "valo.growth-suite.lead-event/v1" as const;
const LEAD_OBJECT_TYPE = "growth_suite_lead" as const;
const MAX_EVENTS_PER_LEAD = 1_000;
const MAX_EVENT_DETAILS_BYTES = 8_192;
const LEAD_OPERATOR_ROLES = [
  "valo_operations_administrator",
  "valo_analyst",
] as const;

const EVENT_TYPES = {
  assign: "growth_suite.lead.assigned",
  set_sla: "growth_suite.lead.sla_set",
  set_status: "growth_suite.lead.status_set",
  propose_conversion: "growth_suite.lead.conversion_proposed",
  contact_accessed: "growth_suite.lead.contact_accessed",
} as const;

type LeadEventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];
type QueueDeliveryStatus = "stored" | "follow_up_started" | "closed";

export type GrowthSuiteQueueRow = {
  requestId: string;
  organisationLabel: string;
  tenderCategory: string;
  bidStage: string;
  tenderDeadline: string | Date | null;
  deliveryStatus: string;
  receivedAt: string | Date;
};

export type GrowthSuiteLeadEventRow = {
  objectId: string;
  eventType: string;
  details: string;
  seq: number | string;
  createdAt: string | Date;
};

export interface GrowthSuiteLeadEventSummary {
  objectId: string;
  eventCount: number;
  latest: readonly GrowthSuiteLeadEventRow[];
}

export type GrowthSuiteContactHandoffRow = {
  requestId: string;
  contactName: string;
  preferredContactMethod: string;
  contactValue: string;
};

export interface GrowthSuiteDurableTransaction {
  requireHumanActor(scope: GrowthSuiteScope): Promise<boolean>;
  isAssignableHuman(scope: GrowthSuiteScope, userId: string): Promise<boolean>;
  lockLead(scope: GrowthSuiteScope, leadId: string): Promise<void>;
  listQueue(limit: number): Promise<readonly GrowthSuiteQueueRow[]>;
  loadLeadEvents(
    scope: GrowthSuiteScope,
    leadIds: readonly string[],
  ): Promise<readonly GrowthSuiteLeadEventSummary[]>;
  transitionQueueStatus(
    leadId: string,
    expectedStatus: QueueDeliveryStatus,
    nextStatus: Exclude<QueueDeliveryStatus, "stored">,
  ): Promise<boolean>;
  getContactHandoff(
    leadId: string,
  ): Promise<GrowthSuiteContactHandoffRow | null>;
  appendLeadEvent(
    scope: GrowthSuiteScope,
    leadId: string,
    eventType: LeadEventType,
    details: string,
  ): Promise<void>;
}

export interface GrowthSuiteDurableDriver {
  transaction<T>(
    organisationId: string,
    callback: (transaction: GrowthSuiteDurableTransaction) => Promise<T>,
  ): Promise<T>;
}

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function unavailable(cause?: unknown): GrowthSuiteRepositoryUnavailableError {
  const error = new GrowthSuiteRepositoryUnavailableError();
  if (cause !== undefined) {
    Object.defineProperty(error, "cause", {
      configurable: true,
      enumerable: false,
      value: cause,
    });
  }
  return error;
}

function integer(value: number | string | null | undefined): number | null {
  const parsed = typeof value === "string" ? Number(value) : value;
  return Number.isSafeInteger(parsed) && (parsed as number) >= 0
    ? (parsed as number)
    : null;
}

function isoInstant(value: string | Date): string | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function isoDate(value: string | Date | null): string | null {
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year!, month! - 1, day));
  return parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month! - 1 &&
    parsed.getUTCDate() === day
    ? value
    : null;
}

function boundedText(
  value: unknown,
  maximumCodeUnits: number,
  maximumBytes = GROWTH_SUITE_BOUNDS.maxSummaryBytes,
): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximumCodeUnits &&
    Buffer.byteLength(value, "utf8") <= maximumBytes &&
    !CONTROL_CHARACTER.test(value) &&
    value.normalize("NFC").trim().replace(/\s+/gu, " ") === value
  );
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

import { isPlainRecord as plainRecord } from "../typeGuards";

function eventDetails(value: Record<string, unknown>): string {
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, "utf8") > MAX_EVENT_DETAILS_BYTES) {
    throw unavailable();
  }
  return serialized;
}

function eventValues(): LeadEventType[] {
  return Object.values(EVENT_TYPES);
}

class DrizzleGrowthSuiteTransaction implements GrowthSuiteDurableTransaction {
  readonly #transaction: DatabaseTransaction;
  #actor: LocalUser | null = null;

  constructor(transaction: DatabaseTransaction) {
    this.#transaction = transaction;
  }

  async requireHumanActor(scope: GrowthSuiteScope): Promise<boolean> {
    const now = new Date();
    const rows = await this.#transaction
      .select({ membershipId: organisationMemberships.id, user: users })
      .from(organisationMemberships)
      .innerJoin(users, eq(organisationMemberships.userId, users.id))
      .innerJoin(
        organisations,
        eq(organisationMemberships.organisationId, organisations.id),
      )
      .where(
        and(
          eq(organisations.id, scope.organisationId),
          eq(organisations.type, "valo"),
          eq(organisations.status, "active"),
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
          eq(users.id, scope.actorUserId),
          eq(users.status, "active"),
        ),
      )
      .limit(2);
    if (rows.length !== 1) return false;
    const grants = await this.#transaction
      .select({ role: roleGrants.role })
      .from(roleGrants)
      .where(
        and(
          eq(roleGrants.membershipId, rows[0]!.membershipId),
          inArray(roleGrants.role, [...LEAD_OPERATOR_ROLES]),
          isNull(roleGrants.revokedAt),
          or(isNull(roleGrants.startsAt), lte(roleGrants.startsAt, now)),
          or(isNull(roleGrants.expiresAt), gt(roleGrants.expiresAt, now)),
        ),
      )
      .limit(LEAD_OPERATOR_ROLES.length + 1);
    if (grants.length < 1 || grants.length > LEAD_OPERATOR_ROLES.length) {
      return false;
    }
    this.#actor = rows[0]!.user;
    return true;
  }

  async isAssignableHuman(
    scope: GrowthSuiteScope,
    userId: string,
  ): Promise<boolean> {
    const now = new Date();
    const rows = await this.#transaction
      .select({
        id: users.id,
        membershipId: organisationMemberships.id,
      })
      .from(organisationMemberships)
      .innerJoin(users, eq(organisationMemberships.userId, users.id))
      .where(
        and(
          eq(organisationMemberships.organisationId, scope.organisationId),
          eq(organisationMemberships.userId, userId),
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
    if (rows.length !== 1) return false;
    const grants = await this.#transaction
      .select({ role: roleGrants.role })
      .from(roleGrants)
      .where(
        and(
          eq(roleGrants.membershipId, rows[0]!.membershipId),
          inArray(roleGrants.role, [...LEAD_OPERATOR_ROLES]),
          isNull(roleGrants.revokedAt),
          or(isNull(roleGrants.startsAt), lte(roleGrants.startsAt, now)),
          or(isNull(roleGrants.expiresAt), gt(roleGrants.expiresAt, now)),
        ),
      )
      .limit(LEAD_OPERATOR_ROLES.length + 1);
    return grants.length >= 1 && grants.length <= LEAD_OPERATOR_ROLES.length;
  }

  async lockLead(_scope: GrowthSuiteScope, leadId: string): Promise<void> {
    await this.#transaction.execute(sql`
      SELECT pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
          ${leadId},
          710531
        )
      )
    `);
  }

  async listQueue(limit: number): Promise<readonly GrowthSuiteQueueRow[]> {
    const result = await this.#transaction.execute<GrowthSuiteQueueRow>(sql`
      SELECT
        request_id::text AS "requestId",
        organisation_label AS "organisationLabel",
        tender_category AS "tenderCategory",
        bid_stage AS "bidStage",
        tender_deadline AS "tenderDeadline",
        delivery_status AS "deliveryStatus",
        received_at AS "receivedAt"
      FROM valo_intake.list_bid_autopsy_work_queue(${limit}::integer)
    `);
    return result.rows;
  }

  async loadLeadEvents(
    scope: GrowthSuiteScope,
    leadIds: readonly string[],
  ): Promise<readonly GrowthSuiteLeadEventSummary[]> {
    if (leadIds.length === 0) return [];
    if (
      leadIds.length > GROWTH_SUITE_BOUNDS.maxListRows ||
      new Set(leadIds).size !== leadIds.length ||
      leadIds.some((id) => !UUID_PATTERN.test(id))
    ) {
      throw unavailable();
    }
    const idList = sql.join(
      leadIds.map((id) => sql`${id}`),
      sql`, `,
    );
    const typeList = sql.join(
      eventValues().map((type) => sql`${type}`),
      sql`, `,
    );
    const preflight = await this.#transaction.execute(sql`
      SELECT
        object_id AS "objectId",
        count(*)::text AS "eventCount",
        count(DISTINCT event_type)::text AS "distinctTypes",
        max(pg_catalog.octet_length(details))::text AS "maximumBytes"
      FROM public.audit_events
      WHERE organisation_id = ${scope.organisationId}::uuid
        AND object_type = ${LEAD_OBJECT_TYPE}
        AND object_id IN (${idList})
        AND event_type IN (${typeList})
      GROUP BY object_id
      LIMIT ${leadIds.length + 1}
    `);
    const counts = new Map<
      string,
      { eventCount: number; distinctTypes: number }
    >();
    for (const unknownRow of preflight.rows) {
      const row = unknownRow as Record<string, unknown>;
      const objectId = row.objectId;
      const eventCount = integer(row.eventCount as string | number | null);
      const distinctTypes = integer(
        row.distinctTypes as string | number | null,
      );
      const maximumBytes = integer(row.maximumBytes as string | number | null);
      if (
        typeof objectId !== "string" ||
        !leadIds.includes(objectId) ||
        counts.has(objectId) ||
        eventCount === null ||
        eventCount < 1 ||
        eventCount > MAX_EVENTS_PER_LEAD ||
        distinctTypes === null ||
        distinctTypes < 1 ||
        distinctTypes > eventValues().length ||
        maximumBytes === null ||
        maximumBytes < 1 ||
        maximumBytes > MAX_EVENT_DETAILS_BYTES
      ) {
        throw unavailable();
      }
      counts.set(objectId, { eventCount, distinctTypes });
    }
    if (preflight.rows.length > leadIds.length) throw unavailable();
    if (counts.size === 0) return [];

    const expectedLatestRows = [...counts.values()].reduce(
      (total, value) => total + value.distinctTypes,
      0,
    );
    const latest = await this.#transaction.execute<GrowthSuiteLeadEventRow>(sql`
      SELECT DISTINCT ON (object_id, event_type)
        object_id AS "objectId",
        event_type AS "eventType",
        details,
        seq,
        created_at AS "createdAt"
      FROM public.audit_events
      WHERE organisation_id = ${scope.organisationId}::uuid
        AND object_type = ${LEAD_OBJECT_TYPE}
        AND object_id IN (${idList})
        AND event_type IN (${typeList})
      ORDER BY object_id, event_type, seq DESC
      LIMIT ${expectedLatestRows + 1}
    `);
    if (latest.rows.length !== expectedLatestRows) throw unavailable();
    const byId = new Map<string, GrowthSuiteLeadEventRow[]>();
    for (const row of latest.rows) {
      if (
        typeof row.objectId !== "string" ||
        !counts.has(row.objectId) ||
        typeof row.eventType !== "string" ||
        !eventValues().includes(row.eventType as LeadEventType) ||
        typeof row.details !== "string"
      ) {
        throw unavailable();
      }
      const rows = byId.get(row.objectId) ?? [];
      if (rows.some(({ eventType }) => eventType === row.eventType)) {
        throw unavailable();
      }
      rows.push(row);
      byId.set(row.objectId, rows);
    }
    return [...counts.entries()].map(([objectId, count]) => {
      const rows = byId.get(objectId) ?? [];
      if (rows.length !== count.distinctTypes) throw unavailable();
      return { objectId, eventCount: count.eventCount, latest: rows };
    });
  }

  async transitionQueueStatus(
    leadId: string,
    expectedStatus: QueueDeliveryStatus,
    nextStatus: Exclude<QueueDeliveryStatus, "stored">,
  ): Promise<boolean> {
    const result = await this.#transaction.execute(sql`
      SELECT request_id::text AS "requestId"
      FROM valo_intake.transition_bid_autopsy_work_queue(
        ${leadId}::uuid,
        ${expectedStatus}::text,
        ${nextStatus}::text
      )
    `);
    return result.rows.length === 1;
  }

  async getContactHandoff(
    leadId: string,
  ): Promise<GrowthSuiteContactHandoffRow | null> {
    const result = await this.#transaction
      .execute<GrowthSuiteContactHandoffRow>(sql`
      SELECT
        request_id::text AS "requestId",
        contact_name AS "contactName",
        preferred_contact_method AS "preferredContactMethod",
        contact_value AS "contactValue"
      FROM valo_intake.get_bid_autopsy_contact_handoff(${leadId}::uuid)
    `);
    if (result.rows.length === 0) return null;
    if (result.rows.length !== 1) throw unavailable();
    return result.rows[0];
  }

  async appendLeadEvent(
    scope: GrowthSuiteScope,
    leadId: string,
    eventType: LeadEventType,
    details: string,
  ): Promise<void> {
    if (!this.#actor || this.#actor.id !== scope.actorUserId) {
      throw unavailable();
    }
    await writeAuditTx(this.#transaction, {
      user: this.#actor,
      organisationId: scope.organisationId,
      eventType,
      objectType: LEAD_OBJECT_TYPE,
      objectId: leadId,
      details,
    });
  }
}

export class PostgresGrowthSuiteDurableDriver implements GrowthSuiteDurableDriver {
  async transaction<T>(
    organisationId: string,
    callback: (transaction: GrowthSuiteDurableTransaction) => Promise<T>,
  ): Promise<T> {
    return withTenantDatabase(organisationId, () =>
      db.transaction(
        (transaction) =>
          callback(new DrizzleGrowthSuiteTransaction(transaction)),
        { isolationLevel: "read committed" },
      ),
    );
  }
}

interface ParsedLeadEventState {
  eventCount: number;
  assignedToUserId: string | null;
  slaDueAt: string | null;
  conversionProposal: LeadConversionProposal | null;
  conversionSeq: number;
  statusSeq: number;
  resolvedStatus: "new" | "qualified" | "not_a_fit" | "converted" | null;
  statusDecision: LeadStatusDecision | null;
  updatedAt: string | null;
}

function emptyEventState(): ParsedLeadEventState {
  return {
    eventCount: 0,
    assignedToUserId: null,
    slaDueAt: null,
    conversionProposal: null,
    conversionSeq: 0,
    statusSeq: 0,
    resolvedStatus: null,
    statusDecision: null,
    updatedAt: null,
  };
}

function parseLeadEventSummary(
  summary: GrowthSuiteLeadEventSummary | undefined,
): ParsedLeadEventState {
  if (!summary) return emptyEventState();
  if (
    !UUID_PATTERN.test(summary.objectId) ||
    !Number.isSafeInteger(summary.eventCount) ||
    summary.eventCount < 1 ||
    summary.eventCount > MAX_EVENTS_PER_LEAD ||
    summary.latest.length < 1 ||
    summary.latest.length > eventValues().length
  ) {
    throw unavailable();
  }
  const state = emptyEventState();
  state.eventCount = summary.eventCount;
  const seen = new Set<string>();
  for (const event of summary.latest) {
    const seq = integer(event.seq);
    const createdAt = isoInstant(event.createdAt);
    if (
      event.objectId !== summary.objectId ||
      seen.has(event.eventType) ||
      !eventValues().includes(event.eventType as LeadEventType) ||
      seq === null ||
      seq < 1 ||
      !createdAt ||
      Buffer.byteLength(event.details, "utf8") > MAX_EVENT_DETAILS_BYTES
    ) {
      throw unavailable();
    }
    seen.add(event.eventType);
    let details: unknown;
    try {
      details = JSON.parse(event.details);
    } catch {
      throw unavailable();
    }
    if (!plainRecord(details) || details.schema !== EVENT_SCHEMA) {
      throw unavailable();
    }
    switch (event.eventType as LeadEventType) {
      case EVENT_TYPES.assign:
        if (
          !exactKeys(details, ["schema", "action", "assigneeUserId"]) ||
          details.action !== "assign" ||
          typeof details.assigneeUserId !== "string" ||
          !UUID_PATTERN.test(details.assigneeUserId)
        ) {
          throw unavailable();
        }
        state.assignedToUserId = details.assigneeUserId;
        break;
      case EVENT_TYPES.set_sla:
        if (
          !exactKeys(details, ["schema", "action", "slaDueAt"]) ||
          details.action !== "set_sla" ||
          typeof details.slaDueAt !== "string" ||
          isoInstant(details.slaDueAt) !== details.slaDueAt
        ) {
          throw unavailable();
        }
        state.slaDueAt = details.slaDueAt;
        break;
      case EVENT_TYPES.set_status:
        if (details.action !== "set_status") {
          throw unavailable();
        }
        if (
          details.status === "converted"
            ? !exactKeys(details, [
                "schema",
                "action",
                "status",
                "reason",
                "decidedAt",
                "decidedByUserId",
                "externalTargetReference",
                "receiptSha256",
              ])
            : !exactKeys(details, [
                "schema",
                "action",
                "status",
                "reason",
                "decidedAt",
                "decidedByUserId",
              ])
        ) {
          throw unavailable();
        }
        if (
          !["qualified", "not_a_fit", "converted"].includes(
            details.status as string,
          ) ||
          !boundedText(
            details.reason,
            GROWTH_SUITE_BOUNDS.maxSummaryCodeUnits,
          ) ||
          typeof details.decidedAt !== "string" ||
          isoInstant(details.decidedAt) !== details.decidedAt ||
          typeof details.decidedByUserId !== "string" ||
          !UUID_PATTERN.test(details.decidedByUserId) ||
          (details.status === "converted" &&
            (!boundedText(
              details.externalTargetReference,
              GROWTH_SUITE_BOUNDS.maxLabelCodeUnits,
            ) ||
              typeof details.receiptSha256 !== "string" ||
              !SHA256_PATTERN.test(details.receiptSha256)))
        ) {
          throw unavailable();
        }
        state.statusSeq = seq;
        state.resolvedStatus = details.status as
          | "qualified"
          | "not_a_fit"
          | "converted";
        state.statusDecision = {
          status: state.resolvedStatus,
          reason: details.reason as string,
          decidedAt: details.decidedAt,
          decidedByUserId: details.decidedByUserId,
          externalTargetReference:
            details.status === "converted"
              ? (details.externalTargetReference as string)
              : null,
          receiptSha256:
            details.status === "converted"
              ? (details.receiptSha256 as string)
              : null,
        };
        break;
      case EVENT_TYPES.propose_conversion:
        if (
          !exactKeys(details, [
            "schema",
            "action",
            "proposalId",
            "proposedAt",
            "proposedByUserId",
            "suggestedPursuitTitle",
            "rationale",
          ]) ||
          details.action !== "propose_conversion" ||
          typeof details.proposalId !== "string" ||
          !UUID_PATTERN.test(details.proposalId) ||
          typeof details.proposedAt !== "string" ||
          isoInstant(details.proposedAt) !== details.proposedAt ||
          typeof details.proposedByUserId !== "string" ||
          !UUID_PATTERN.test(details.proposedByUserId) ||
          !boundedText(
            details.suggestedPursuitTitle,
            GROWTH_SUITE_BOUNDS.maxLabelCodeUnits,
          ) ||
          !boundedText(
            details.rationale,
            GROWTH_SUITE_BOUNDS.maxSummaryCodeUnits,
          )
        ) {
          throw unavailable();
        }
        state.conversionSeq = seq;
        state.conversionProposal = {
          id: details.proposalId,
          status: "pending_human_decision",
          proposedAt: details.proposedAt,
          proposedByUserId: details.proposedByUserId,
          suggestedPursuitTitle: details.suggestedPursuitTitle,
          rationale: details.rationale,
        };
        break;
      case EVENT_TYPES.contact_accessed:
        if (
          !exactKeys(details, ["schema", "action", "purpose"]) ||
          details.action !== "contact_accessed" ||
          ![
            "initial_follow_up",
            "qualification_call",
            "conversion_handoff",
          ].includes(details.purpose as string)
        ) {
          throw unavailable();
        }
        break;
    }
    if (!state.updatedAt || createdAt > state.updatedAt) {
      state.updatedAt = createdAt;
    }
  }
  return state;
}

function deliveryStatus(value: string): QueueDeliveryStatus | null {
  return ["stored", "follow_up_started", "closed"].includes(value)
    ? (value as QueueDeliveryStatus)
    : null;
}

function inboxStatus(
  delivery: QueueDeliveryStatus,
  events: ParsedLeadEventState,
): LeadInboxStatus {
  if (
    delivery !== "closed" &&
    events.conversionProposal &&
    events.conversionSeq > events.statusSeq
  ) {
    return "conversion_proposed";
  }
  return delivery === "stored"
    ? "new"
    : delivery === "follow_up_started"
      ? "qualified"
      : events.resolvedStatus === "converted"
        ? "converted"
        : "not_a_fit";
}

function queueItem(
  scope: GrowthSuiteScope,
  row: GrowthSuiteQueueRow,
  summary: GrowthSuiteLeadEventSummary | undefined,
): LeadInboxItem {
  const delivery = deliveryStatus(row.deliveryStatus);
  const receivedAt = isoInstant(row.receivedAt);
  const tenderDeadline = isoDate(row.tenderDeadline);
  const events = parseLeadEventSummary(summary);
  if (
    !UUID_PATTERN.test(row.requestId) ||
    !boundedText(
      row.organisationLabel,
      GROWTH_SUITE_BOUNDS.maxLabelCodeUnits,
    ) ||
    !["federal_public", "oil_and_gas", "donor_funded", "other"].includes(
      row.tenderCategory,
    ) ||
    !["live", "draft", "previously_submitted"].includes(row.bidStage) ||
    (row.tenderDeadline !== null && !tenderDeadline) ||
    !delivery ||
    !receivedAt ||
    (summary && summary.objectId !== row.requestId)
  ) {
    throw unavailable();
  }
  return {
    id: row.requestId,
    organisationId: scope.organisationId,
    leadReference: row.requestId,
    organisationLabel: row.organisationLabel,
    tenderCategory: row.tenderCategory,
    bidStage: row.bidStage,
    receivedAt,
    tenderDeadline,
    assignedToUserId: events.assignedToUserId,
    status: inboxStatus(delivery, events),
    slaDueAt: events.slaDueAt,
    conversionProposal: events.conversionProposal,
    latestStatusDecision: events.statusDecision,
    version: events.eventCount + 1,
    updatedAt:
      events.updatedAt && events.updatedAt > receivedAt
        ? events.updatedAt
        : receivedAt,
  };
}

function assertScope(scope: GrowthSuiteScope): void {
  if (
    !scope ||
    !UUID_PATTERN.test(scope.organisationId) ||
    !UUID_PATTERN.test(scope.actorUserId)
  ) {
    throw unavailable();
  }
}

function validLimit(limit: number): boolean {
  return (
    Number.isSafeInteger(limit) &&
    limit >= 1 &&
    limit <= GROWTH_SUITE_BOUNDS.maxListRows
  );
}

function policyValidMutation(mutation: LeadInboxMutation, now: Date): boolean {
  if (
    !mutation ||
    !Number.isSafeInteger(mutation.expectedVersion) ||
    mutation.expectedVersion < 1
  ) {
    return false;
  }
  switch (mutation.action) {
    case "assign":
      return UUID_PATTERN.test(mutation.assigneeUserId);
    case "set_status":
      return (
        ["qualified", "not_a_fit", "converted"].includes(mutation.status) &&
        boundedText(mutation.reason, GROWTH_SUITE_BOUNDS.maxSummaryCodeUnits) &&
        (mutation.status !== "converted" ||
          (boundedText(
            mutation.externalTargetReference,
            GROWTH_SUITE_BOUNDS.maxLabelCodeUnits,
          ) &&
            SHA256_PATTERN.test(mutation.receiptSha256)))
      );
    case "set_sla": {
      const parsed = new Date(mutation.slaDueAt);
      return (
        Number.isFinite(parsed.getTime()) &&
        parsed.toISOString() === mutation.slaDueAt &&
        parsed.getTime() > now.getTime() &&
        parsed.getTime() <=
          now.getTime() + GROWTH_SUITE_BOUNDS.maxSlaDays * 86_400_000
      );
    }
    case "propose_conversion":
      return (
        boundedText(
          mutation.suggestedPursuitTitle,
          GROWTH_SUITE_BOUNDS.maxLabelCodeUnits,
        ) &&
        boundedText(mutation.rationale, GROWTH_SUITE_BOUNDS.maxSummaryCodeUnits)
      );
  }
}

function statusTransition(
  current: QueueDeliveryStatus,
  target: "qualified" | "not_a_fit" | "converted",
): Exclude<QueueDeliveryStatus, "stored"> | null | false {
  if (target === "qualified") {
    return current === "stored"
      ? "follow_up_started"
      : current === "follow_up_started"
        ? null
        : false;
  }
  return current === "closed" ? null : "closed";
}

export interface DrizzleGrowthSuiteRepositoryOptions {
  driver?: GrowthSuiteDurableDriver;
  now?: () => Date;
  id?: () => string;
  /**
   * The one approved internal BidBox organisation that owns the global
   * pre-account intake queue. Absence or mismatch keeps durable lead
   * operations unavailable.
   */
  allowedOrganisationId?: string | null;
}

/**
 * Durable lead-operations adapter. The only public-intake fields it asks the
 * bulk database function for are company/workflow fields. One separately
 * authorised method can reveal only an assigned lead's preferred contact
 * channel after same-transaction role, assignment, purpose and version checks;
 * its audit receipt contains no PII. Mutable operational metadata is
 * append-only in the tenant audit chain. Quote writes stay closed until a
 * purpose-built durable commercial schema exists.
 */
export class DrizzleGrowthSuiteRepository implements GrowthSuiteRepository {
  readonly #driver: GrowthSuiteDurableDriver;
  readonly #now: () => Date;
  readonly #id: () => string;
  readonly #allowedOrganisationId: string | null;

  constructor(options: DrizzleGrowthSuiteRepositoryOptions = {}) {
    this.#driver = options.driver ?? new PostgresGrowthSuiteDurableDriver();
    this.#now = options.now ?? (() => new Date());
    this.#id = options.id ?? randomUUID;
    this.#allowedOrganisationId =
      options.allowedOrganisationId !== undefined
        ? options.allowedOrganisationId
        : (process.env.VALO_GROWTH_OPERATIONS_ORGANISATION_ID ?? null);
  }

  async listLeads(
    scope: GrowthSuiteScope,
    limit: number,
  ): Promise<readonly LeadInboxItem[]> {
    try {
      assertScope(scope);
      if (
        !this.#allowedOrganisationId ||
        !UUID_PATTERN.test(this.#allowedOrganisationId) ||
        scope.organisationId !== this.#allowedOrganisationId
      ) {
        throw unavailable();
      }
      if (!validLimit(limit)) throw unavailable();
      return await this.#driver.transaction(
        scope.organisationId,
        async (transaction) => {
          if (!(await transaction.requireHumanActor(scope))) {
            throw unavailable();
          }
          const queue = await transaction.listQueue(limit);
          if (
            queue.length > limit ||
            new Set(queue.map(({ requestId }) => requestId)).size !==
              queue.length
          ) {
            throw unavailable();
          }
          const summaries = await transaction.loadLeadEvents(
            scope,
            queue.map(({ requestId }) => requestId),
          );
          const byId = new Map(
            summaries.map((summary) => [summary.objectId, summary]),
          );
          if (byId.size !== summaries.length) throw unavailable();
          return queue.map((row) =>
            queueItem(scope, row, byId.get(row.requestId)),
          );
        },
      );
    } catch (error) {
      if (error instanceof GrowthSuiteRepositoryUnavailableError) throw error;
      throw unavailable(error);
    }
  }

  async mutateLead(
    scope: GrowthSuiteScope,
    leadId: string,
    mutation: LeadInboxMutation,
  ): Promise<GrowthSuiteMutationResult<LeadInboxItem>> {
    try {
      assertScope(scope);
      if (
        !this.#allowedOrganisationId ||
        !UUID_PATTERN.test(this.#allowedOrganisationId) ||
        scope.organisationId !== this.#allowedOrganisationId
      ) {
        throw unavailable();
      }
      const now = this.#now();
      if (!UUID_PATTERN.test(leadId) || !policyValidMutation(mutation, now)) {
        return { outcome: "policy_denied" };
      }
      return await this.#driver.transaction(
        scope.organisationId,
        async (transaction) => {
          if (!(await transaction.requireHumanActor(scope))) {
            throw unavailable();
          }
          await transaction.lockLead(scope, leadId);
          const queue = await transaction.listQueue(
            GROWTH_SUITE_BOUNDS.maxListRows,
          );
          const row = queue.find(({ requestId }) => requestId === leadId);
          if (!row) return { outcome: "not_found_or_conflict" } as const;
          const summaries = await transaction.loadLeadEvents(scope, [leadId]);
          if (summaries.length > 1) throw unavailable();
          const current = queueItem(scope, row, summaries[0]);
          if (current.version !== mutation.expectedVersion) {
            return { outcome: "not_found_or_conflict" } as const;
          }
          if (
            mutation.action === "set_status" &&
            current.status === mutation.status
          ) {
            const decision = current.latestStatusDecision;
            const exactReplay =
              decision?.status === mutation.status &&
              decision.reason === mutation.reason &&
              (mutation.status !== "converted" ||
                (decision.externalTargetReference ===
                  mutation.externalTargetReference &&
                  decision.receiptSha256 === mutation.receiptSha256));
            return exactReplay
              ? ({ outcome: "updated", record: current } as const)
              : ({ outcome: "policy_denied" } as const);
          }
          if (row.deliveryStatus === "closed") {
            return { outcome: "policy_denied" } as const;
          }
          if (
            (mutation.action === "propose_conversion" &&
              current.status !== "qualified") ||
            (mutation.action === "set_status" &&
              mutation.status === "converted" &&
              current.status !== "conversion_proposed") ||
            (mutation.action === "set_status" &&
              mutation.status === "qualified" &&
              !["new", "qualified"].includes(current.status))
          ) {
            return { outcome: "policy_denied" } as const;
          }
          if ((summaries[0]?.eventCount ?? 0) >= MAX_EVENTS_PER_LEAD) {
            throw unavailable();
          }

          let eventType: LeadEventType;
          let details: string;
          switch (mutation.action) {
            case "assign":
              if (
                !(await transaction.isAssignableHuman(
                  scope,
                  mutation.assigneeUserId,
                ))
              ) {
                return { outcome: "policy_denied" } as const;
              }
              eventType = EVENT_TYPES.assign;
              details = eventDetails({
                schema: EVENT_SCHEMA,
                action: "assign",
                assigneeUserId: mutation.assigneeUserId,
              });
              break;
            case "set_sla":
              eventType = EVENT_TYPES.set_sla;
              details = eventDetails({
                schema: EVENT_SCHEMA,
                action: "set_sla",
                slaDueAt: mutation.slaDueAt,
              });
              break;
            case "set_status": {
              const currentDelivery = deliveryStatus(row.deliveryStatus);
              if (!currentDelivery) throw unavailable();
              const transition = statusTransition(
                currentDelivery,
                mutation.status,
              );
              if (transition === false) {
                return { outcome: "not_found_or_conflict" } as const;
              }
              if (
                transition &&
                !(await transaction.transitionQueueStatus(
                  leadId,
                  currentDelivery,
                  transition,
                ))
              ) {
                return { outcome: "not_found_or_conflict" } as const;
              }
              if (transition) row.deliveryStatus = transition;
              eventType = EVENT_TYPES.set_status;
              details = eventDetails({
                schema: EVENT_SCHEMA,
                action: "set_status",
                status: mutation.status,
                reason: mutation.reason,
                decidedAt: now.toISOString(),
                decidedByUserId: scope.actorUserId,
                ...(mutation.status === "converted"
                  ? {
                      externalTargetReference: mutation.externalTargetReference,
                      receiptSha256: mutation.receiptSha256,
                    }
                  : {}),
              });
              break;
            }
            case "propose_conversion": {
              const proposalId = this.#id();
              if (!UUID_PATTERN.test(proposalId)) throw unavailable();
              eventType = EVENT_TYPES.propose_conversion;
              details = eventDetails({
                schema: EVENT_SCHEMA,
                action: "propose_conversion",
                proposalId,
                proposedAt: now.toISOString(),
                proposedByUserId: scope.actorUserId,
                suggestedPursuitTitle: mutation.suggestedPursuitTitle,
                rationale: mutation.rationale,
              });
              break;
            }
          }
          await transaction.appendLeadEvent(scope, leadId, eventType, details);
          const updatedSummaries = await transaction.loadLeadEvents(scope, [
            leadId,
          ]);
          if (updatedSummaries.length !== 1) throw unavailable();
          const updated = queueItem(scope, row, updatedSummaries[0]);
          if (updated.version !== current.version + 1) throw unavailable();
          return { outcome: "updated", record: updated } as const;
        },
      );
    } catch (error) {
      if (error instanceof GrowthSuiteRepositoryUnavailableError) throw error;
      throw unavailable(error);
    }
  }

  async listQuotes(
    _scope: GrowthSuiteScope,
    _limit: number,
  ): Promise<readonly QuoteProposal[]> {
    throw unavailable();
  }

  async getLeadContactHandoff(
    scope: GrowthSuiteScope,
    leadId: string,
    expectedVersion: number,
    purpose: LeadContactHandoffPurpose,
  ): Promise<GrowthSuiteMutationResult<LeadContactHandoff>> {
    try {
      assertScope(scope);
      if (
        !this.#allowedOrganisationId ||
        !UUID_PATTERN.test(this.#allowedOrganisationId) ||
        scope.organisationId !== this.#allowedOrganisationId
      ) {
        throw unavailable();
      }
      if (
        !UUID_PATTERN.test(leadId) ||
        !Number.isSafeInteger(expectedVersion) ||
        expectedVersion < 1 ||
        ![
          "initial_follow_up",
          "qualification_call",
          "conversion_handoff",
        ].includes(purpose)
      ) {
        return { outcome: "policy_denied" };
      }
      const now = this.#now();
      return await this.#driver.transaction(
        scope.organisationId,
        async (transaction) => {
          if (!(await transaction.requireHumanActor(scope)))
            throw unavailable();
          await transaction.lockLead(scope, leadId);
          const summaries = await transaction.loadLeadEvents(scope, [leadId]);
          if (summaries.length > 1) throw unavailable();
          const state = parseLeadEventSummary(summaries[0]);
          if (state.eventCount + 1 !== expectedVersion) {
            return { outcome: "not_found_or_conflict" } as const;
          }
          if (state.assignedToUserId !== scope.actorUserId) {
            return { outcome: "policy_denied" } as const;
          }
          if (
            purpose === "conversion_handoff" &&
            (!state.conversionProposal ||
              state.conversionSeq <= state.statusSeq)
          ) {
            return { outcome: "policy_denied" } as const;
          }
          if (state.eventCount >= MAX_EVENTS_PER_LEAD) throw unavailable();
          const handoff = await transaction.getContactHandoff(leadId);
          if (!handoff) return { outcome: "not_found_or_conflict" } as const;
          if (
            handoff.requestId !== leadId ||
            !boundedText(handoff.contactName, 120) ||
            !["email", "telephone"].includes(handoff.preferredContactMethod) ||
            !boundedText(
              handoff.contactValue,
              handoff.preferredContactMethod === "email" ? 254 : 32,
            )
          ) {
            throw unavailable();
          }
          await transaction.appendLeadEvent(
            scope,
            leadId,
            EVENT_TYPES.contact_accessed,
            eventDetails({
              schema: EVENT_SCHEMA,
              action: "contact_accessed",
              purpose,
            }),
          );
          const updated = await transaction.loadLeadEvents(scope, [leadId]);
          if (
            updated.length !== 1 ||
            updated[0]!.eventCount + 1 !== expectedVersion + 1
          ) {
            throw unavailable();
          }
          return {
            outcome: "updated",
            record: {
              leadId,
              contactName: handoff.contactName,
              preferredContactMethod: handoff.preferredContactMethod as
                | "email"
                | "telephone",
              contactValue: handoff.contactValue,
              purpose,
              accessedAt: now.toISOString(),
              version: expectedVersion + 1,
            },
          } as const;
        },
      );
    } catch (error) {
      if (error instanceof GrowthSuiteRepositoryUnavailableError) throw error;
      throw unavailable(error);
    }
  }

  async createQuoteDraft(
    _scope: GrowthSuiteScope,
    _draft: CreateQuoteDraft,
  ): Promise<QuoteProposal> {
    throw unavailable();
  }

  async approveQuote(
    _scope: GrowthSuiteScope,
    _quoteId: string,
    _expectedVersion: number,
  ): Promise<GrowthSuiteMutationResult<QuoteProposal>> {
    throw unavailable();
  }
}

export function createDrizzleGrowthSuiteRepository(
  options: DrizzleGrowthSuiteRepositoryOptions = {},
): GrowthSuiteRepository {
  return new DrizzleGrowthSuiteRepository(options);
}
