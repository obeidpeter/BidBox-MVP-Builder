import { canonicalJsonLocale, sha256Hex } from "../canonicalDigest";
import {
  EVIDENCE_RENEWAL_BOUNDS,
  EVIDENCE_RENEWAL_IMPACTS,
  EVIDENCE_RENEWAL_LEDGER_SCHEMA,
  EVIDENCE_RENEWAL_REVIEW_REASONS,
  EvidenceRenewalUnavailableError,
  type EvidenceRenewalAffectedPursuitDraft,
  type EvidenceRenewalCreateDraft,
  type EvidenceRenewalMutationOutcome,
  type EvidenceRenewalReceipt,
  type EvidenceRenewalReviewDraft,
  type EvidenceRenewalReviewReason,
  type EvidenceRenewalScope,
  type EvidenceRenewalStageDraft,
  type EvidenceRenewalStagedReplacement,
  type EvidenceRenewalStatus,
} from "./contracts";

export const EVIDENCE_RENEWAL_AUTHORITY_NOTE =
  "This register records a receipt-backed internal due reminder and named-human evidence-renewal workflow. It does not send an external message, contact an issuer or client, approve a pursuit, or claim delivery outside BidBox.";

export const ZERO_SHA256 = "0".repeat(64);
import {
  SHA256_HEX_PATTERN as SHA256_PATTERN,
  UUID_PATTERN,
} from "../identifierPatterns";
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;

type JsonObject = Record<string, unknown>;
export type EvidenceRenewalLedgerEventKind =
  | "plan_created"
  | "replacement_staged"
  | "replacement_reviewed";

export interface EvidenceRenewalCreationPayload {
  vaultItemId: string;
  ownerUserId: string;
  ownerMembershipId: string;
  verifierUserId: string;
  targetDate: string;
  reminderDueAt: string;
  affectedPursuits: readonly EvidenceRenewalAffectedPursuitDraft[];
}

export interface EvidenceRenewalStagePayload {
  documentId: string;
  documentVersionId: string;
  documentVersionNumber: number;
  sha256: string;
  issueDate: string;
  expiryDate: string;
  expectedVaultItemVersion: number;
}

export interface EvidenceRenewalReviewPayload {
  decision: "approve" | "reject";
  reasonCode: EvidenceRenewalReviewReason;
}

export interface PersistedEvidenceRenewalEvent {
  schema: typeof EVIDENCE_RENEWAL_LEDGER_SCHEMA;
  eventId: string;
  planId: string;
  aggregateVersion: number;
  kind: EvidenceRenewalLedgerEventKind;
  organisationId: string;
  projectId: string;
  occurredAt: string;
  actorUserId: string;
  actorMembershipId: string;
  idempotencyKeySha256: string;
  requestSha256: string;
  previousReceiptSha256: string;
  creation: EvidenceRenewalCreationPayload | null;
  stage: EvidenceRenewalStagePayload | null;
  review: EvidenceRenewalReviewPayload | null;
  receiptSha256: string;
}

export interface ReducedEvidenceRenewalPlan {
  id: string;
  organisationId: string;
  projectId: string;
  vaultItemId: string;
  ownerUserId: string;
  ownerMembershipId: string;
  verifierUserId: string;
  targetDate: string;
  reminderDueAt: string;
  affectedPursuits: readonly EvidenceRenewalAffectedPursuitDraft[];
  status: EvidenceRenewalStatus;
  version: number;
  stagedReplacement: EvidenceRenewalStagedReplacement | null;
  reviewReasonCode: EvidenceRenewalReviewReason | null;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  latestReceiptSha256: string;
  promotionReceiptSha256: string | null;
  receipts: readonly EvidenceRenewalReceipt[];
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function exactKeys(value: JsonObject, expected: readonly string[]): boolean {
  const expectedSet = new Set(expected);
  const actual = Object.keys(value);
  return (
    actual.length === expected.length &&
    actual.every((key) => expectedSet.has(key))
  );
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(parsed.valueOf()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function validInstant(value: unknown): value is string {
  return (
    typeof value === "string" &&
    ISO_TIMESTAMP_PATTERN.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function parseAffectedPursuits(
  value: unknown,
): EvidenceRenewalAffectedPursuitDraft[] | null {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > EVIDENCE_RENEWAL_BOUNDS.affectedPursuits
  ) {
    return null;
  }
  const ids = new Set<string>();
  const pursuits: EvidenceRenewalAffectedPursuitDraft[] = [];
  for (const entry of value) {
    if (
      !isObject(entry) ||
      !exactKeys(entry, ["projectId", "impact"]) ||
      typeof entry.projectId !== "string" ||
      !UUID_PATTERN.test(entry.projectId) ||
      typeof entry.impact !== "string" ||
      !EVIDENCE_RENEWAL_IMPACTS.includes(entry.impact as never) ||
      ids.has(entry.projectId)
    ) {
      return null;
    }
    ids.add(entry.projectId);
    pursuits.push({
      projectId: entry.projectId,
      impact: entry.impact as EvidenceRenewalAffectedPursuitDraft["impact"],
    });
  }
  return pursuits.sort((left, right) =>
    left.projectId.localeCompare(right.projectId),
  );
}

export function parseEvidenceRenewalCreateDraft(
  value: unknown,
): EvidenceRenewalCreateDraft | null {
  if (
    !isObject(value) ||
    !exactKeys(value, [
      "vaultItemId",
      "ownerUserId",
      "verifierUserId",
      "targetDate",
      "affectedPursuits",
      "idempotencyKey",
    ]) ||
    typeof value.vaultItemId !== "string" ||
    !UUID_PATTERN.test(value.vaultItemId) ||
    typeof value.ownerUserId !== "string" ||
    !UUID_PATTERN.test(value.ownerUserId) ||
    typeof value.verifierUserId !== "string" ||
    !UUID_PATTERN.test(value.verifierUserId) ||
    value.ownerUserId === value.verifierUserId ||
    !validDate(value.targetDate) ||
    typeof value.idempotencyKey !== "string" ||
    !IDEMPOTENCY_PATTERN.test(value.idempotencyKey)
  ) {
    return null;
  }
  const affectedPursuits = parseAffectedPursuits(value.affectedPursuits);
  return affectedPursuits
    ? {
        vaultItemId: value.vaultItemId,
        ownerUserId: value.ownerUserId,
        verifierUserId: value.verifierUserId,
        targetDate: value.targetDate,
        affectedPursuits,
        idempotencyKey: value.idempotencyKey,
      }
    : null;
}

export function parseEvidenceRenewalStageDraft(
  value: unknown,
): EvidenceRenewalStageDraft | null {
  if (
    !isObject(value) ||
    !exactKeys(value, [
      "documentId",
      "sha256",
      "issueDate",
      "expiryDate",
      "idempotencyKey",
    ]) ||
    typeof value.documentId !== "string" ||
    !UUID_PATTERN.test(value.documentId) ||
    typeof value.sha256 !== "string" ||
    !SHA256_PATTERN.test(value.sha256) ||
    !validDate(value.issueDate) ||
    !validDate(value.expiryDate) ||
    value.expiryDate <= value.issueDate ||
    typeof value.idempotencyKey !== "string" ||
    !IDEMPOTENCY_PATTERN.test(value.idempotencyKey)
  ) {
    return null;
  }
  return value as unknown as EvidenceRenewalStageDraft;
}

export function parseEvidenceRenewalReviewDraft(
  value: unknown,
): EvidenceRenewalReviewDraft | null {
  if (
    !isObject(value) ||
    !exactKeys(value, ["decision", "reasonCode", "idempotencyKey"]) ||
    (value.decision !== "approve" && value.decision !== "reject") ||
    typeof value.reasonCode !== "string" ||
    !EVIDENCE_RENEWAL_REVIEW_REASONS.includes(value.reasonCode as never) ||
    (value.decision === "approve") !==
      (value.reasonCode === "replacement_verified") ||
    typeof value.idempotencyKey !== "string" ||
    !IDEMPOTENCY_PATTERN.test(value.idempotencyKey)
  ) {
    return null;
  }
  return value as unknown as EvidenceRenewalReviewDraft;
}

export function canonicalEvidenceRenewalJson(value: unknown): string {
  return canonicalJsonLocale(value);
}

export function evidenceRenewalSha256(value: unknown): string {
  return sha256Hex(canonicalEvidenceRenewalJson(value));
}

import { deterministicUuidFromHex } from "../deterministicUuid";
export const deterministicEvidenceRenewalUuid = deterministicUuidFromHex;

function eventWithoutReceipt(event: PersistedEvidenceRenewalEvent) {
  const { receiptSha256: _receiptSha256, ...content } = event;
  return content;
}

export function createEvidenceRenewalEventReceipt(
  event: Omit<PersistedEvidenceRenewalEvent, "receiptSha256">,
): string {
  return evidenceRenewalSha256(event);
}

function validCreation(
  value: unknown,
): value is EvidenceRenewalCreationPayload {
  if (
    !isObject(value) ||
    !exactKeys(value, [
      "vaultItemId",
      "ownerUserId",
      "ownerMembershipId",
      "verifierUserId",
      "targetDate",
      "reminderDueAt",
      "affectedPursuits",
    ]) ||
    typeof value.vaultItemId !== "string" ||
    !UUID_PATTERN.test(value.vaultItemId) ||
    typeof value.ownerUserId !== "string" ||
    !UUID_PATTERN.test(value.ownerUserId) ||
    typeof value.ownerMembershipId !== "string" ||
    !UUID_PATTERN.test(value.ownerMembershipId) ||
    typeof value.verifierUserId !== "string" ||
    !UUID_PATTERN.test(value.verifierUserId) ||
    value.ownerUserId === value.verifierUserId ||
    !validDate(value.targetDate) ||
    !validInstant(value.reminderDueAt) ||
    value.reminderDueAt !== `${value.targetDate}T16:00:00.000Z`
  ) {
    return false;
  }
  return parseAffectedPursuits(value.affectedPursuits) !== null;
}

function validStage(value: unknown): value is EvidenceRenewalStagePayload {
  return Boolean(
    isObject(value) &&
    exactKeys(value, [
      "documentId",
      "documentVersionId",
      "documentVersionNumber",
      "sha256",
      "issueDate",
      "expiryDate",
      "expectedVaultItemVersion",
    ]) &&
    typeof value.documentId === "string" &&
    UUID_PATTERN.test(value.documentId) &&
    typeof value.documentVersionId === "string" &&
    UUID_PATTERN.test(value.documentVersionId) &&
    Number.isSafeInteger(value.documentVersionNumber) &&
    Number(value.documentVersionNumber) >= 1 &&
    typeof value.sha256 === "string" &&
    SHA256_PATTERN.test(value.sha256) &&
    validDate(value.issueDate) &&
    validDate(value.expiryDate) &&
    String(value.expiryDate) > String(value.issueDate) &&
    Number.isSafeInteger(value.expectedVaultItemVersion) &&
    Number(value.expectedVaultItemVersion) >= 1,
  );
}

function validReview(value: unknown): value is EvidenceRenewalReviewPayload {
  return Boolean(
    isObject(value) &&
    exactKeys(value, ["decision", "reasonCode"]) &&
    (value.decision === "approve" || value.decision === "reject") &&
    typeof value.reasonCode === "string" &&
    EVIDENCE_RENEWAL_REVIEW_REASONS.includes(value.reasonCode as never) &&
    (value.decision === "approve") ===
      (value.reasonCode === "replacement_verified"),
  );
}

export function serializeEvidenceRenewalEvent(
  event: PersistedEvidenceRenewalEvent,
): string {
  const value = canonicalEvidenceRenewalJson(event);
  if (
    value.length > EVIDENCE_RENEWAL_BOUNDS.envelopeCodeUnits ||
    Buffer.byteLength(value, "utf8") > EVIDENCE_RENEWAL_BOUNDS.envelopeBytes
  ) {
    throw new EvidenceRenewalUnavailableError(
      "Evidence renewal event exceeds its bounded envelope",
    );
  }
  return value;
}

export function parseEvidenceRenewalEvent(
  value: string | null,
  rowId: string,
  scope: Pick<EvidenceRenewalScope, "organisationId" | "projectId">,
): PersistedEvidenceRenewalEvent {
  let raw: unknown;
  try {
    raw = value ? JSON.parse(value) : null;
  } catch {
    throw new EvidenceRenewalUnavailableError("Malformed renewal event");
  }
  if (
    !isObject(raw) ||
    !exactKeys(raw, [
      "schema",
      "eventId",
      "planId",
      "aggregateVersion",
      "kind",
      "organisationId",
      "projectId",
      "occurredAt",
      "actorUserId",
      "actorMembershipId",
      "idempotencyKeySha256",
      "requestSha256",
      "previousReceiptSha256",
      "creation",
      "stage",
      "review",
      "receiptSha256",
    ]) ||
    raw.schema !== EVIDENCE_RENEWAL_LEDGER_SCHEMA ||
    raw.eventId !== rowId ||
    typeof raw.planId !== "string" ||
    !UUID_PATTERN.test(raw.planId) ||
    !Number.isSafeInteger(raw.aggregateVersion) ||
    Number(raw.aggregateVersion) < 1 ||
    !["plan_created", "replacement_staged", "replacement_reviewed"].includes(
      String(raw.kind),
    ) ||
    raw.organisationId !== scope.organisationId ||
    raw.projectId !== scope.projectId ||
    !validInstant(raw.occurredAt) ||
    typeof raw.actorUserId !== "string" ||
    !UUID_PATTERN.test(raw.actorUserId) ||
    typeof raw.actorMembershipId !== "string" ||
    !UUID_PATTERN.test(raw.actorMembershipId) ||
    typeof raw.idempotencyKeySha256 !== "string" ||
    !SHA256_PATTERN.test(raw.idempotencyKeySha256) ||
    typeof raw.requestSha256 !== "string" ||
    !SHA256_PATTERN.test(raw.requestSha256) ||
    typeof raw.previousReceiptSha256 !== "string" ||
    !SHA256_PATTERN.test(raw.previousReceiptSha256) ||
    typeof raw.receiptSha256 !== "string" ||
    !SHA256_PATTERN.test(raw.receiptSha256)
  ) {
    throw new EvidenceRenewalUnavailableError(
      "Renewal event failed scope, identity or bounds",
    );
  }
  const event = raw as unknown as PersistedEvidenceRenewalEvent;
  if (
    evidenceRenewalSha256(eventWithoutReceipt(event)) !== event.receiptSha256 ||
    (event.kind === "plan_created") !== validCreation(event.creation) ||
    (event.kind === "replacement_staged") !== validStage(event.stage) ||
    (event.kind === "replacement_reviewed") !== validReview(event.review) ||
    (event.kind !== "plan_created" && event.creation !== null) ||
    (event.kind !== "replacement_staged" && event.stage !== null) ||
    (event.kind !== "replacement_reviewed" && event.review !== null)
  ) {
    throw new EvidenceRenewalUnavailableError(
      "Renewal event failed closed-schema or receipt verification",
    );
  }
  if (event.creation) {
    event.creation = {
      ...event.creation,
      affectedPursuits: parseAffectedPursuits(event.creation.affectedPursuits)!,
    };
  }
  return event;
}

function receipt(event: PersistedEvidenceRenewalEvent): EvidenceRenewalReceipt {
  return {
    version: event.aggregateVersion,
    kind: event.kind,
    occurredAt: event.occurredAt,
    actorUserId: event.actorUserId,
    sha256: event.receiptSha256,
  };
}

export function reduceEvidenceRenewalLedger(
  events: readonly PersistedEvidenceRenewalEvent[],
): ReducedEvidenceRenewalPlan[] {
  const byPlan = new Map<string, PersistedEvidenceRenewalEvent[]>();
  const idempotency = new Set<string>();
  for (const event of events) {
    if (idempotency.has(event.idempotencyKeySha256)) {
      throw new EvidenceRenewalUnavailableError(
        "Renewal idempotency evidence is duplicated",
      );
    }
    idempotency.add(event.idempotencyKeySha256);
    const aggregate = byPlan.get(event.planId) ?? [];
    aggregate.push(event);
    byPlan.set(event.planId, aggregate);
  }
  if (byPlan.size > EVIDENCE_RENEWAL_BOUNDS.plansPerProject) {
    throw new EvidenceRenewalUnavailableError("Renewal plan bound exceeded");
  }
  const plans: ReducedEvidenceRenewalPlan[] = [];
  for (const [planId, unsorted] of byPlan) {
    if (unsorted.length > EVIDENCE_RENEWAL_BOUNDS.eventsPerPlan) {
      throw new EvidenceRenewalUnavailableError(
        "Renewal per-plan event bound exceeded",
      );
    }
    const ordered = [...unsorted].sort(
      (left, right) => left.aggregateVersion - right.aggregateVersion,
    );
    const genesis = ordered[0];
    if (
      !genesis ||
      genesis.kind !== "plan_created" ||
      !genesis.creation ||
      genesis.aggregateVersion !== 1 ||
      genesis.previousReceiptSha256 !== ZERO_SHA256
    ) {
      throw new EvidenceRenewalUnavailableError(
        "Renewal aggregate has no valid genesis receipt",
      );
    }
    let plan: ReducedEvidenceRenewalPlan = {
      id: planId,
      organisationId: genesis.organisationId,
      projectId: genesis.projectId,
      vaultItemId: genesis.creation.vaultItemId,
      ownerUserId: genesis.creation.ownerUserId,
      ownerMembershipId: genesis.creation.ownerMembershipId,
      verifierUserId: genesis.creation.verifierUserId,
      targetDate: genesis.creation.targetDate,
      reminderDueAt: genesis.creation.reminderDueAt,
      affectedPursuits: genesis.creation.affectedPursuits,
      status: "planned",
      version: 1,
      stagedReplacement: null,
      reviewReasonCode: null,
      createdByUserId: genesis.actorUserId,
      createdAt: genesis.occurredAt,
      updatedAt: genesis.occurredAt,
      latestReceiptSha256: genesis.receiptSha256,
      promotionReceiptSha256: null,
      receipts: [receipt(genesis)],
    };
    for (let index = 1; index < ordered.length; index += 1) {
      const event = ordered[index];
      if (
        !event ||
        event.aggregateVersion !== index + 1 ||
        event.previousReceiptSha256 !== plan.latestReceiptSha256
      ) {
        throw new EvidenceRenewalUnavailableError(
          "Renewal receipt chain is incomplete",
        );
      }
      if (
        event.kind === "replacement_staged" &&
        event.stage &&
        plan.status === "planned" &&
        event.actorUserId === plan.ownerUserId
      ) {
        plan = {
          ...plan,
          status: "replacement_staged",
          version: event.aggregateVersion,
          stagedReplacement: {
            ...event.stage,
            stagedByUserId: event.actorUserId,
            stagedAt: event.occurredAt,
          },
          updatedAt: event.occurredAt,
          latestReceiptSha256: event.receiptSha256,
          receipts: [...plan.receipts, receipt(event)],
        };
        continue;
      }
      if (
        event.kind === "replacement_reviewed" &&
        event.review &&
        plan.status === "replacement_staged" &&
        plan.stagedReplacement &&
        event.actorUserId === plan.verifierUserId &&
        event.actorUserId !== plan.ownerUserId &&
        event.actorUserId !== plan.stagedReplacement.stagedByUserId
      ) {
        plan = {
          ...plan,
          status: event.review.decision === "approve" ? "promoted" : "rejected",
          version: event.aggregateVersion,
          reviewReasonCode: event.review.reasonCode,
          updatedAt: event.occurredAt,
          latestReceiptSha256: event.receiptSha256,
          promotionReceiptSha256:
            event.review.decision === "approve" ? event.receiptSha256 : null,
          receipts: [...plan.receipts, receipt(event)],
        };
        continue;
      }
      throw new EvidenceRenewalUnavailableError(
        "Renewal event violates owner, checker or state invariants",
      );
    }
    plans.push(plan);
  }
  return plans.sort(
    (left, right) =>
      right.updatedAt.localeCompare(left.updatedAt) ||
      left.id.localeCompare(right.id),
  );
}

export function evidenceRenewalMutationHttpStatus(
  outcome: EvidenceRenewalMutationOutcome,
): number {
  if (outcome.outcome === "created") return 201;
  if (outcome.outcome === "updated") return 200;
  if (outcome.outcome === "not_found") return 404;
  if (outcome.outcome === "capacity_exceeded") return 429;
  return 409;
}
