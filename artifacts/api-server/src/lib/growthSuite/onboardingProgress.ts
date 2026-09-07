import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  auditEvents,
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
  isActiveAccessWindow,
  isOrganisationRole,
  isRoleAllowedForOrganisation,
  type OrganisationRole,
  type OrganisationType,
} from "../permissions";
import type { GrowthSuiteScope } from "./contracts";
import {
  deriveOnboardingJourney,
  ONBOARDING_POLICY_VERSION,
  type OnboardingJourney,
} from "./onboarding";

import { UUID_V1_5_PATTERN as UUID_PATTERN } from "../identifierPatterns";
const ITEM_ID_PATTERN = /^[a-z][a-z0-9-]{0,127}$/u;
// Partition receipts by the policy that defined the checklist. A future
// policy version starts its own CAS stream instead of making historical
// receipts unparsable or rewriting the tenant audit chain.
const PROGRESS_OBJECT_TYPE =
  `growth_suite.onboarding_progress.${ONBOARDING_POLICY_VERSION}` as const;
const EVENT_TYPES = [
  "growth_suite.onboarding_item_completed",
  "growth_suite.onboarding_item_reopened",
  "growth_suite.onboarding_practice_marker_saved",
  "growth_suite.onboarding_practice_marker_removed",
] as const;
const MAX_PROGRESS_EVENTS = 512;
const MAX_DETAILS_CODE_UNITS = 512;
const MAX_DETAILS_BYTES = 2_048;
const ONBOARDING_LOCK_DOMAIN = 730_211;

type ProgressEventType = (typeof EVENT_TYPES)[number];

export interface OnboardingProgress {
  journeyVersion: typeof ONBOARDING_POLICY_VERSION;
  savedPracticeMarkerItemIds: readonly string[];
  /** @deprecated Compatibility alias for savedPracticeMarkerItemIds. */
  completedItemIds: readonly string[];
  version: number;
}

export interface OnboardingProgressMutation {
  journeyVersion: typeof ONBOARDING_POLICY_VERSION;
  itemId: string;
  expectedVersion: number;
  markerSaved: boolean;
}

export type OnboardingProgressMutationResult =
  | { outcome: "updated"; progress: OnboardingProgress }
  | { outcome: "not_found_or_conflict" }
  | { outcome: "policy_denied" };

export interface OnboardingProgressRepository {
  getProgress(
    scope: GrowthSuiteScope,
    expectedRoles: readonly OrganisationRole[],
  ): Promise<OnboardingProgress>;
  mutateProgress(
    scope: GrowthSuiteScope,
    expectedRoles: readonly OrganisationRole[],
    mutation: OnboardingProgressMutation,
  ): Promise<OnboardingProgressMutationResult>;
}

export class OnboardingProgressUnavailableError extends Error {
  readonly name = "OnboardingProgressUnavailableError";

  constructor() {
    super("Onboarding progress is unavailable");
  }
}

export const unavailableOnboardingProgressRepository: OnboardingProgressRepository =
  {
    getProgress: async () => {
      throw new OnboardingProgressUnavailableError();
    },
    mutateProgress: async () => {
      throw new OnboardingProgressUnavailableError();
    },
  };

export interface ProgressEventRow {
  seq: number;
  eventType: string;
  details: string | null;
}

export interface AuthorisedActor {
  user: LocalUser;
  roles: readonly OrganisationRole[];
  journey: OnboardingJourney;
}

export interface ProgressTransaction {
  lock(scope: GrowthSuiteScope): Promise<void>;
  loadAuthorisedActor(
    scope: GrowthSuiteScope,
    now: Date,
  ): Promise<AuthorisedActor | null>;
  loadEvents(scope: GrowthSuiteScope): Promise<readonly ProgressEventRow[]>;
  appendEvent(
    scope: GrowthSuiteScope,
    actor: LocalUser,
    eventType: ProgressEventType,
    details: string,
  ): Promise<void>;
}

export interface OnboardingProgressDriver {
  transaction<T>(
    organisationId: string,
    callback: (transaction: ProgressTransaction) => Promise<T>,
  ): Promise<T>;
}

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function unavailable(cause?: unknown): OnboardingProgressUnavailableError {
  const error = new OnboardingProgressUnavailableError();
  if (cause !== undefined) Object.assign(error, { cause });
  return error;
}

function validScope(scope: GrowthSuiteScope): boolean {
  return (
    UUID_PATTERN.test(scope.organisationId) &&
    UUID_PATTERN.test(scope.actorUserId)
  );
}

function validExpectedVersion(value: unknown): value is number {
  return (
    Number.isSafeInteger(value) &&
    (value as number) >= 0 &&
    (value as number) <= MAX_PROGRESS_EVENTS
  );
}

function normalisedRoles(
  roles: readonly OrganisationRole[],
): readonly OrganisationRole[] {
  return [...new Set(roles)].sort();
}

function sameRoles(
  left: readonly OrganisationRole[],
  right: readonly OrganisationRole[],
): boolean {
  const a = normalisedRoles(left);
  const b = normalisedRoles(right);
  return a.length === b.length && a.every((role, index) => role === b[index]);
}

function parseEventDetails(
  row: ProgressEventRow,
  expectedPreviousVersion: number,
): {
  itemId: string;
  completed: boolean;
} {
  if (
    !Number.isSafeInteger(row.seq) ||
    row.seq < 1 ||
    !EVENT_TYPES.includes(row.eventType as ProgressEventType) ||
    typeof row.details !== "string" ||
    row.details.length > MAX_DETAILS_CODE_UNITS ||
    Buffer.byteLength(row.details, "utf8") > MAX_DETAILS_BYTES
  ) {
    throw unavailable();
  }
  let value: unknown;
  try {
    value = JSON.parse(row.details);
  } catch {
    throw unavailable();
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw unavailable();
  }
  const record = value as Record<string, unknown>;
  const legacy =
    row.eventType === "growth_suite.onboarding_item_completed" ||
    row.eventType === "growth_suite.onboarding_item_reopened";
  const expectedKeys = legacy
    ? "completed|itemId|journeyVersion|previousVersion|schemaVersion"
    : "itemId|journeyVersion|markerSaved|previousVersion|schemaVersion";
  const markerSaved = legacy ? record.completed : record.markerSaved;
  const eventSavesMarker =
    row.eventType === "growth_suite.onboarding_item_completed" ||
    row.eventType === "growth_suite.onboarding_practice_marker_saved";
  if (
    Object.keys(record).sort().join("|") !== expectedKeys ||
    record.schemaVersion !== (legacy ? 1 : 2) ||
    record.journeyVersion !== ONBOARDING_POLICY_VERSION ||
    typeof record.itemId !== "string" ||
    !ITEM_ID_PATTERN.test(record.itemId) ||
    typeof markerSaved !== "boolean" ||
    record.previousVersion !== expectedPreviousVersion ||
    markerSaved !== eventSavesMarker
  ) {
    throw unavailable();
  }
  return { itemId: record.itemId, completed: markerSaved };
}

export function reduceOnboardingProgress(
  journey: OnboardingJourney,
  rows: readonly ProgressEventRow[],
): OnboardingProgress {
  if (
    journey.policyVersion !== ONBOARDING_POLICY_VERSION ||
    rows.length > MAX_PROGRESS_EVENTS
  ) {
    throw unavailable();
  }
  const savedMarkers = new Set<string>();
  const allowed = new Set(journey.checklist.map(({ id }) => id));
  let previousSeq = -1;
  for (const [index, row] of rows.entries()) {
    if (row.seq <= previousSeq) throw unavailable();
    previousSeq = row.seq;
    const event = parseEventDetails(row, index);
    if (!allowed.has(event.itemId)) continue;
    if (event.completed) savedMarkers.add(event.itemId);
    else savedMarkers.delete(event.itemId);
  }
  const savedPracticeMarkerItemIds = [...savedMarkers].sort();
  return {
    journeyVersion: ONBOARDING_POLICY_VERSION,
    savedPracticeMarkerItemIds,
    completedItemIds: savedPracticeMarkerItemIds,
    version: rows.length,
  };
}

class DrizzleProgressTransaction implements ProgressTransaction {
  readonly #transaction: DatabaseTransaction;

  constructor(transaction: DatabaseTransaction) {
    this.#transaction = transaction;
  }

  async lock(scope: GrowthSuiteScope): Promise<void> {
    const key = `growth-onboarding:${scope.organisationId}:${scope.actorUserId}`;
    await this.#transaction.execute(sql`
      SELECT pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(${key}, ${ONBOARDING_LOCK_DOMAIN})
      )
    `);
  }

  async loadAuthorisedActor(
    scope: GrowthSuiteScope,
    now: Date,
  ): Promise<AuthorisedActor | null> {
    const rows = await this.#transaction
      .select({
        user: users,
        membership: organisationMemberships,
        organisation: organisations,
      })
      .from(organisationMemberships)
      .innerJoin(users, eq(organisationMemberships.userId, users.id))
      .innerJoin(
        organisations,
        eq(organisationMemberships.organisationId, organisations.id),
      )
      .where(
        and(
          eq(organisationMemberships.organisationId, scope.organisationId),
          eq(organisationMemberships.userId, scope.actorUserId),
        ),
      )
      .limit(2);
    if (rows.length !== 1) return null;
    const row = rows[0]!;
    if (
      row.user.status !== "active" ||
      typeof row.user.name !== "string" ||
      row.user.name !== row.user.name.trim() ||
      row.user.name.length === 0 ||
      row.user.name.length > 512 ||
      /[\u0000-\u001f\u007f\ud800-\udfff]/u.test(row.user.name) ||
      row.organisation.status !== "active" ||
      row.membership.delegatedByMembershipId !== null ||
      !isActiveAccessWindow(
        {
          status: row.membership.status,
          startsAt: row.membership.accessStartsAt,
          expiresAt: row.membership.accessExpiresAt,
        },
        now,
      )
    ) {
      return null;
    }
    const grants = await this.#transaction
      .select()
      .from(roleGrants)
      .where(eq(roleGrants.membershipId, row.membership.id))
      .limit(32);
    if (grants.length >= 32) throw unavailable();
    const organisationType = row.organisation.type as OrganisationType;
    const roles = grants
      .filter((grant) =>
        isActiveAccessWindow(
          {
            status: grant.revokedAt ? "revoked" : "active",
            startsAt: grant.startsAt,
            expiresAt: grant.expiresAt,
            revokedAt: grant.revokedAt,
          },
          now,
        ),
      )
      .map(({ role }) => role)
      .filter(isOrganisationRole)
      .filter((role) => isRoleAllowedForOrganisation(role, organisationType));
    const uniqueRoles = normalisedRoles(roles);
    if (uniqueRoles.length === 0) return null;
    return {
      user: row.user,
      roles: uniqueRoles,
      journey: deriveOnboardingJourney(uniqueRoles),
    };
  }

  async loadEvents(
    scope: GrowthSuiteScope,
  ): Promise<readonly ProgressEventRow[]> {
    const where = and(
      eq(auditEvents.organisationId, scope.organisationId),
      eq(auditEvents.userId, scope.actorUserId),
      eq(auditEvents.objectType, PROGRESS_OBJECT_TYPE),
      eq(auditEvents.objectId, scope.actorUserId),
      inArray(auditEvents.eventType, [...EVENT_TYPES]),
    );
    const [metadata] = await this.#transaction
      .select({
        count: sql<number>`count(*)::int`,
        maxCodeUnits: sql<number>`coalesce(max(length(${auditEvents.details})), 0)::int`,
        maxBytes: sql<number>`coalesce(max(octet_length(${auditEvents.details})), 0)::int`,
      })
      .from(auditEvents)
      .where(where);
    if (
      !metadata ||
      metadata.count > MAX_PROGRESS_EVENTS ||
      metadata.maxCodeUnits > MAX_DETAILS_CODE_UNITS ||
      metadata.maxBytes > MAX_DETAILS_BYTES
    ) {
      throw unavailable();
    }
    const rows = await this.#transaction
      .select({
        seq: auditEvents.seq,
        eventType: auditEvents.eventType,
        details: auditEvents.details,
      })
      .from(auditEvents)
      .where(where)
      .orderBy(asc(auditEvents.seq))
      .limit(MAX_PROGRESS_EVENTS + 1);
    if (rows.length !== metadata.count) throw unavailable();
    return rows;
  }

  async appendEvent(
    scope: GrowthSuiteScope,
    actor: LocalUser,
    eventType: ProgressEventType,
    details: string,
  ): Promise<void> {
    await writeAuditTx(this.#transaction, {
      user: actor,
      organisationId: scope.organisationId,
      eventType,
      objectType: PROGRESS_OBJECT_TYPE,
      objectId: scope.actorUserId,
      details,
    });
  }
}

export class PostgresOnboardingProgressDriver implements OnboardingProgressDriver {
  async transaction<T>(
    organisationId: string,
    callback: (transaction: ProgressTransaction) => Promise<T>,
  ): Promise<T> {
    return withTenantDatabase(organisationId, () =>
      db.transaction(
        (transaction) => callback(new DrizzleProgressTransaction(transaction)),
        { isolationLevel: "read committed" },
      ),
    );
  }
}

export interface DrizzleOnboardingProgressRepositoryOptions {
  driver?: OnboardingProgressDriver;
  now?: () => Date;
}

export class DrizzleOnboardingProgressRepository implements OnboardingProgressRepository {
  readonly #driver: OnboardingProgressDriver;
  readonly #now: () => Date;

  constructor(options: DrizzleOnboardingProgressRepositoryOptions = {}) {
    this.#driver = options.driver ?? new PostgresOnboardingProgressDriver();
    this.#now = options.now ?? (() => new Date());
  }

  async getProgress(
    scope: GrowthSuiteScope,
    expectedRoles: readonly OrganisationRole[],
  ): Promise<OnboardingProgress> {
    try {
      if (!validScope(scope)) throw unavailable();
      const now = this.#now();
      if (!Number.isFinite(now.getTime())) throw unavailable();
      return await this.#driver.transaction(
        scope.organisationId,
        async (transaction) => {
          await transaction.lock(scope);
          const actor = await transaction.loadAuthorisedActor(scope, now);
          if (!actor || !sameRoles(actor.roles, expectedRoles)) {
            throw unavailable();
          }
          return reduceOnboardingProgress(
            actor.journey,
            await transaction.loadEvents(scope),
          );
        },
      );
    } catch (error) {
      if (error instanceof OnboardingProgressUnavailableError) throw error;
      throw unavailable(error);
    }
  }

  async mutateProgress(
    scope: GrowthSuiteScope,
    expectedRoles: readonly OrganisationRole[],
    mutation: OnboardingProgressMutation,
  ): Promise<OnboardingProgressMutationResult> {
    try {
      if (
        !validScope(scope) ||
        mutation.journeyVersion !== ONBOARDING_POLICY_VERSION ||
        !ITEM_ID_PATTERN.test(mutation.itemId) ||
        !validExpectedVersion(mutation.expectedVersion) ||
        typeof mutation.markerSaved !== "boolean"
      ) {
        return { outcome: "policy_denied" };
      }
      const now = this.#now();
      if (!Number.isFinite(now.getTime())) throw unavailable();
      return await this.#driver.transaction(
        scope.organisationId,
        async (transaction) => {
          await transaction.lock(scope);
          const actor = await transaction.loadAuthorisedActor(scope, now);
          if (!actor || !sameRoles(actor.roles, expectedRoles)) {
            return { outcome: "policy_denied" };
          }
          const progress = reduceOnboardingProgress(
            actor.journey,
            await transaction.loadEvents(scope),
          );
          if (progress.version !== mutation.expectedVersion) {
            return { outcome: "not_found_or_conflict" };
          }
          if (
            !actor.journey.checklist.some(({ id }) => id === mutation.itemId)
          ) {
            return { outcome: "policy_denied" };
          }
          const markerAlreadySaved =
            progress.savedPracticeMarkerItemIds.includes(mutation.itemId);
          if (markerAlreadySaved === mutation.markerSaved) {
            return { outcome: "updated", progress };
          }
          if (progress.version >= MAX_PROGRESS_EVENTS) throw unavailable();
          const details = JSON.stringify({
            schemaVersion: 2,
            journeyVersion: ONBOARDING_POLICY_VERSION,
            itemId: mutation.itemId,
            previousVersion: progress.version,
            markerSaved: mutation.markerSaved,
          });
          await transaction.appendEvent(
            scope,
            actor.user,
            mutation.markerSaved
              ? "growth_suite.onboarding_practice_marker_saved"
              : "growth_suite.onboarding_practice_marker_removed",
            details,
          );
          const savedPracticeMarkerItemIds = new Set(
            progress.savedPracticeMarkerItemIds,
          );
          if (mutation.markerSaved)
            savedPracticeMarkerItemIds.add(mutation.itemId);
          else savedPracticeMarkerItemIds.delete(mutation.itemId);
          const markerIds = [...savedPracticeMarkerItemIds].sort();
          return {
            outcome: "updated",
            progress: {
              journeyVersion: ONBOARDING_POLICY_VERSION,
              savedPracticeMarkerItemIds: markerIds,
              completedItemIds: markerIds,
              version: progress.version + 1,
            },
          };
        },
      );
    } catch (error) {
      if (error instanceof OnboardingProgressUnavailableError) throw error;
      throw unavailable(error);
    }
  }
}

export function createDrizzleOnboardingProgressRepository(
  options: DrizzleOnboardingProgressRepositoryOptions = {},
): OnboardingProgressRepository {
  return new DrizzleOnboardingProgressRepository(options);
}
