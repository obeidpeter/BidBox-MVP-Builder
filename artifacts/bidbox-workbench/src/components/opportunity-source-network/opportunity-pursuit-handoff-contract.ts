import {
  isRecord as record,
  UUID_PATTERN as UUID,
} from "@/lib/closed-contract";

const SHA256 = /^[0-9a-f]{64}$/u;

export const OPPORTUNITY_PURSUIT_HANDOFF_AUTHORITY = Object.freeze({
  sourceReopenRequired: true,
  namedHumanConfirmationRequired: true,
  makerCheckerRequired: true,
  conflictRevalidationRequired: true,
  createdPursuitState: "intake" as const,
  pursuitActivated: false,
  providerFetchPerformed: false,
  autonomousPursuitActivationAllowed: false,
});

export interface OpportunityPursuitHandoffReceipt {
  schema: "valo.opportunity-pursuit-handoff/v1";
  organisationId: string;
  candidateId: string;
  projectId: string;
  clientId: string;
  clientVersion: number;
  tenderId: string;
  tenderLotId: string | null;
  tenderLotVersion: number | null;
  confirmedLotReference: string | null;
  reviewerUserId: string;
  sourceReceiptSha256: string;
  sourceLocatorSha256: string;
  confirmedBuyer: string;
  confirmedReference: string;
  confirmedSubmissionDeadline: string | null;
  confirmationNote: string;
  confirmedByUserId: string;
  confirmedByName: string;
  confirmedAt: string;
  conflictBoundarySha256: string;
  conflictStatus: "clear";
  matchedProjectId: null;
  projectStatus: "intake";
  idempotencyKeySha256: string;
  requestSha256: string;
  receiptSha256: string;
}

export interface ReadyOpportunityPursuitHandoff {
  state: "ready";
  source: {
    candidateId: string;
    candidateVersion: number;
    sourceReceiptSha256: string;
    sourceLocator: string;
    sourceLocatorSha256: string;
    tenderId: string;
    tenderVersion: number;
    title: string;
    buyer: string;
    reference: string;
    submissionDeadline: string | null;
    recordedByName: string;
    confirmedByName: string;
  };
  clients: readonly { id: string; name: string; version: number }[];
  reviewers: readonly { userId: string; name: string }[];
  lots: readonly {
    id: string;
    reference: string;
    title: string | null;
    submissionDeadline: string | null;
    version: number;
  }[];
  conflictBoundary: {
    sha256: string;
    matches: readonly {
      projectId: string;
      lot: string | null;
      status: string;
      version: number;
    }[];
    limit: 100;
    truncated: false;
  };
  authority: typeof OPPORTUNITY_PURSUIT_HANDOFF_AUTHORITY;
}

export type OpportunityPursuitHandoffPreparation =
  | ReadyOpportunityPursuitHandoff
  | {
      state: "completed";
      receipt: OpportunityPursuitHandoffReceipt;
      authority: typeof OPPORTUNITY_PURSUIT_HANDOFF_AUTHORITY;
    };

export interface OpportunityPursuitHandoffConfirmation {
  expectedCandidateVersion: number;
  expectedSourceReceiptSha256: string;
  expectedTenderVersion: number;
  expectedConflictBoundarySha256: string;
  clientId: string;
  expectedClientVersion: number;
  tenderLotId: string | null;
  expectedTenderLotVersion: number | null;
  confirmedLotReference: string | null;
  reviewerUserId: string;
  officialSourceReopened: true;
  confirmedBuyer: string;
  confirmedReference: string;
  confirmedSubmissionDeadline: string | null;
  confirmationNote: string;
}

export interface OpportunityPursuitHandoffResult {
  outcome: "created" | "replayed";
  receipt: OpportunityPursuitHandoffReceipt;
  authority: typeof OPPORTUNITY_PURSUIT_HANDOFF_AUTHORITY;
}

function exact(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const expected = new Set(keys);
  return (
    Object.keys(value).length === expected.size &&
    Object.keys(value).every((key) => expected.has(key))
  );
}

function text(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" && value.length >= 1 && value.length <= maximum
  );
}

function instant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

function authority(value: unknown): boolean {
  return (
    record(value) &&
    exact(value, Object.keys(OPPORTUNITY_PURSUIT_HANDOFF_AUTHORITY)) &&
    Object.entries(OPPORTUNITY_PURSUIT_HANDOFF_AUTHORITY).every(
      ([key, expected]) => value[key] === expected,
    )
  );
}

function receipt(value: unknown, organisationId: string) {
  const keys = [
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
  ];
  if (
    !record(value) ||
    !exact(value, keys) ||
    value.schema !== "valo.opportunity-pursuit-handoff/v1" ||
    value.organisationId !== organisationId ||
    !UUID.test(String(value.candidateId)) ||
    !UUID.test(String(value.projectId)) ||
    !UUID.test(String(value.clientId)) ||
    !Number.isSafeInteger(value.clientVersion) ||
    Number(value.clientVersion) < 1 ||
    !UUID.test(String(value.tenderId)) ||
    (value.tenderLotId !== null && !UUID.test(String(value.tenderLotId))) ||
    (value.tenderLotVersion !== null &&
      (!Number.isSafeInteger(value.tenderLotVersion) ||
        Number(value.tenderLotVersion) < 1)) ||
    (value.confirmedLotReference !== null &&
      !text(value.confirmedLotReference, 512)) ||
    (value.tenderLotId === null
      ? value.tenderLotVersion !== null || value.confirmedLotReference !== null
      : value.tenderLotVersion === null ||
        value.confirmedLotReference === null) ||
    !UUID.test(String(value.reviewerUserId)) ||
    !UUID.test(String(value.confirmedByUserId)) ||
    !SHA256.test(String(value.sourceReceiptSha256)) ||
    !SHA256.test(String(value.sourceLocatorSha256)) ||
    !SHA256.test(String(value.conflictBoundarySha256)) ||
    !SHA256.test(String(value.idempotencyKeySha256)) ||
    !SHA256.test(String(value.requestSha256)) ||
    !SHA256.test(String(value.receiptSha256)) ||
    !text(value.confirmedBuyer, 512) ||
    !text(value.confirmedReference, 128) ||
    !text(value.confirmationNote, 1_024) ||
    !text(value.confirmedByName, 512) ||
    !instant(value.confirmedAt) ||
    (value.confirmedSubmissionDeadline !== null &&
      !instant(value.confirmedSubmissionDeadline)) ||
    value.conflictStatus !== "clear" ||
    value.matchedProjectId !== null ||
    value.projectStatus !== "intake"
  ) {
    throw new Error("Invalid opportunity pursuit handoff receipt");
  }
  return value as unknown as OpportunityPursuitHandoffReceipt;
}

export function adaptOpportunityPursuitHandoffPreparation(
  value: unknown,
  organisationId: string,
  candidateId: string,
): OpportunityPursuitHandoffPreparation {
  if (!record(value) || !authority(value.authority)) {
    throw new Error("Invalid opportunity pursuit handoff response");
  }
  if (value.state === "completed") {
    if (!exact(value, ["state", "receipt", "authority"])) {
      throw new Error("Invalid opportunity pursuit handoff response");
    }
    const parsed = receipt(value.receipt, organisationId);
    if (parsed.candidateId !== candidateId) {
      throw new Error("Invalid opportunity pursuit handoff response");
    }
    return {
      state: "completed",
      receipt: parsed,
      authority: OPPORTUNITY_PURSUIT_HANDOFF_AUTHORITY,
    };
  }
  if (
    value.state !== "ready" ||
    !exact(value, [
      "state",
      "source",
      "clients",
      "reviewers",
      "lots",
      "conflictBoundary",
      "authority",
    ]) ||
    !record(value.source) ||
    !exact(value.source, [
      "candidateId",
      "candidateVersion",
      "sourceReceiptSha256",
      "sourceLocator",
      "sourceLocatorSha256",
      "tenderId",
      "tenderVersion",
      "title",
      "buyer",
      "reference",
      "submissionDeadline",
      "recordedByName",
      "confirmedByName",
    ]) ||
    value.source.candidateId !== candidateId ||
    !UUID.test(String(value.source.tenderId)) ||
    !Number.isSafeInteger(value.source.candidateVersion) ||
    !Number.isSafeInteger(value.source.tenderVersion) ||
    !SHA256.test(String(value.source.sourceReceiptSha256)) ||
    !SHA256.test(String(value.source.sourceLocatorSha256)) ||
    !text(value.source.sourceLocator, 2_048) ||
    !String(value.source.sourceLocator).startsWith("https://") ||
    !text(value.source.title, 512) ||
    !text(value.source.buyer, 512) ||
    !text(value.source.reference, 512) ||
    (value.source.submissionDeadline !== null &&
      !instant(value.source.submissionDeadline)) ||
    !text(value.source.recordedByName, 512) ||
    !text(value.source.confirmedByName, 512) ||
    !Array.isArray(value.clients) ||
    value.clients.length > 100 ||
    value.clients.some(
      (item) =>
        !record(item) ||
        !exact(item, ["id", "name", "version"]) ||
        !UUID.test(String(item.id)) ||
        !text(item.name, 512) ||
        !Number.isSafeInteger(item.version),
    ) ||
    !Array.isArray(value.reviewers) ||
    value.reviewers.length > 100 ||
    value.reviewers.some(
      (item) =>
        !record(item) ||
        !exact(item, ["userId", "name"]) ||
        !UUID.test(String(item.userId)) ||
        !text(item.name, 512),
    ) ||
    !Array.isArray(value.lots) ||
    value.lots.length > 100 ||
    value.lots.some(
      (item) =>
        !record(item) ||
        !exact(item, [
          "id",
          "reference",
          "title",
          "submissionDeadline",
          "version",
        ]) ||
        !UUID.test(String(item.id)) ||
        !text(item.reference, 512) ||
        (item.title !== null && !text(item.title, 512)) ||
        (item.submissionDeadline !== null &&
          !instant(item.submissionDeadline)) ||
        !Number.isSafeInteger(item.version),
    ) ||
    !record(value.conflictBoundary) ||
    !exact(value.conflictBoundary, [
      "sha256",
      "matches",
      "limit",
      "truncated",
    ]) ||
    !SHA256.test(String(value.conflictBoundary.sha256)) ||
    value.conflictBoundary.limit !== 100 ||
    value.conflictBoundary.truncated !== false ||
    !Array.isArray(value.conflictBoundary.matches) ||
    value.conflictBoundary.matches.length > 100 ||
    value.conflictBoundary.matches.some(
      (item) =>
        !record(item) ||
        !exact(item, ["projectId", "lot", "status", "version"]) ||
        !UUID.test(String(item.projectId)) ||
        (item.lot !== null && !text(item.lot, 512)) ||
        !text(item.status, 128) ||
        !Number.isSafeInteger(item.version),
    )
  ) {
    throw new Error("Invalid opportunity pursuit handoff response");
  }
  return value as unknown as ReadyOpportunityPursuitHandoff;
}

export function adaptOpportunityPursuitHandoffResult(
  value: unknown,
  organisationId: string,
  candidateId: string,
): OpportunityPursuitHandoffResult {
  if (
    !record(value) ||
    !exact(value, ["outcome", "receipt", "authority"]) ||
    (value.outcome !== "created" && value.outcome !== "replayed") ||
    !authority(value.authority)
  ) {
    throw new Error("Invalid opportunity pursuit handoff result");
  }
  const parsed = receipt(value.receipt, organisationId);
  if (parsed.candidateId !== candidateId) {
    throw new Error("Invalid opportunity pursuit handoff result");
  }
  return {
    outcome: value.outcome,
    receipt: parsed,
    authority: OPPORTUNITY_PURSUIT_HANDOFF_AUTHORITY,
  };
}
