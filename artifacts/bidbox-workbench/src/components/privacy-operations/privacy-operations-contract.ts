import { isRecord } from "@/lib/closed-contract";

export type PrivacyEvidenceState = "verified" | "missing" | "invalid";
export type PrivacyReviewPosture =
  | "current"
  | "due_soon"
  | "overdue"
  | "missing_review_date";

export interface PrivacyDsrItem {
  id: string;
  requestType: string;
  identityVerificationStatus: string;
  receivedAt: string;
  dueAt: string;
  status: string;
  assignedToUserId: string | null;
  responseEvidenceState: PrivacyEvidenceState;
  completedAt: string | null;
  urgency: "completed" | "overdue" | "due_soon" | "on_track";
  version: number;
  updatedAt: string;
}

export interface PrivacyConsentItem {
  id: string;
  privacyRecordId: string | null;
  capturedAt: string;
  withdrawnAt: string | null;
  state: "active" | "withdrawn";
  captureEvidenceState: PrivacyEvidenceState;
  withdrawalReceiptState: PrivacyEvidenceState;
  withdrawalEvidenceSha256: string | null;
  withdrawnByUserId: string | null;
  version: number;
  updatedAt: string;
}

export type PrivacyHoldReviewOutcome =
  | "continue"
  | "escalate_for_legal_review"
  | "release_recommended";

export interface PrivacyLegalHoldItem {
  id: string;
  projectId: string | null;
  status: string;
  placedByUserId: string;
  releasedByUserId: string | null;
  releasedAt: string | null;
  lastReviewOutcome: PrivacyHoldReviewOutcome | null;
  lastReviewedAt: string | null;
  lastReviewedByUserId: string | null;
  nextReviewAt: string | null;
  reviewEvidenceSha256: string | null;
  reviewPosture: PrivacyReviewPosture | "released";
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface PrivacySubprocessorItem {
  id: string;
  legalName: string;
  service: string;
  countryCode: string;
  dpaStatus: string;
  securityReviewStatus: string;
  approvedAt: string | null;
  nextReviewAt: string | null;
  reviewPosture: PrivacyReviewPosture;
  version: number;
  updatedAt: string;
}

export interface PrivacyTransferItem {
  id: string;
  subprocessorId: string | null;
  originCountry: string;
  destinationCountry: string;
  transferBasis: string;
  approvalEvidenceState: PrivacyEvidenceState;
  legalReviewStatus: string;
  nextReviewAt: string;
  reviewPosture: PrivacyReviewPosture;
  version: number;
  updatedAt: string;
}

export interface PrivacyDeletionItem {
  id: string;
  status: string;
  held: boolean;
  executedByUserId: string | null;
  executedAt: string | null;
  receiptState: "pending" | "recorded" | "missing" | "invalid";
  scopeManifestSha256: string | null;
  signedByUserId: string | null;
  completedAt: string | null;
  version: number;
  updatedAt: string;
}

export interface PrivacyOperationsDashboard {
  generatedAt: string;
  organisationId: string;
  boundedTo: number;
  legalDecisionAutomated: false;
  rawSubjectPiiIncluded: false;
  authorityNote: string;
  totals: {
    dataSubjectRequests: number;
    consentRecords: number;
    legalHolds: number;
    subprocessors: number;
    crossBorderTransfers: number;
    deletionActions: number;
  };
  truncated: {
    dataSubjectRequests: boolean;
    consentRecords: boolean;
    legalHolds: boolean;
    subprocessors: boolean;
    crossBorderTransfers: boolean;
    deletionActions: boolean;
  };
  dataSubjectRequests: readonly PrivacyDsrItem[];
  consentRecords: readonly PrivacyConsentItem[];
  legalHolds: readonly PrivacyLegalHoldItem[];
  subprocessors: readonly PrivacySubprocessorItem[];
  crossBorderTransfers: readonly PrivacyTransferItem[];
  deletionActions: readonly PrivacyDeletionItem[];
  blockers: readonly string[];
}

export interface PrivacyDsrTriageDraft {
  status:
    | "received"
    | "triaged"
    | "in_progress"
    | "awaiting_identity"
    | "on_hold";
  identityVerificationStatus: "pending" | "verified" | "failed";
  assignedToUserId: string;
  reasonCode:
    | "initial_triage"
    | "identity_pending"
    | "scope_confirmation"
    | "complexity_review"
    | "deadline_risk"
    | "other_review_required";
  decisionEvidenceSha256: string;
}

export interface PrivacyOperationsAssigneeList {
  organisationId: string;
  items: readonly { userId: string; name: string }[];
  limit: 100;
  truncated: false;
}

export interface PrivacyConsentWithdrawalDraft {
  withdrawnAt: string;
  evidenceSha256: string;
}

export interface PrivacyHoldReviewDraft {
  reviewOutcome: PrivacyHoldReviewOutcome;
  nextReviewAt: string;
  evidenceSha256: string;
}

export interface PrivacyWorkflowReceipt {
  receiptSha256: string;
  eventType:
    | "privacy.dsr_triage_recorded"
    | "privacy.consent_withdrawal_recorded"
    | "privacy.legal_hold_review_recorded";
  objectId: string;
  actorUserId: string;
  recordedAt: string;
  resultingVersion: number;
  legalDecisionAutomated: false;
}

const SHA256 = /^[0-9a-f]{64}$/u;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const FORBIDDEN_SUBJECT_KEYS = new Set([
  "subjectReference",
  "requesterReference",
  "affirmativeAction",
  "responseEvidence",
  "scope",
  "reason",
  "dataCategories",
  "subjectCategories",
]);

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return (
    keys.length === sorted.length &&
    keys.every((key, index) => key === sorted[index])
  );
}

function isIso(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isNullableIso(value: unknown): value is string | null {
  return value === null || isIso(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function isNullableUuid(value: unknown): value is string | null {
  return value === null || isUuid(value);
}

function isVersion(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function boundedString(value: unknown, maxCodeUnits: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxCodeUnits
  );
}

function containsForbiddenSubjectKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsForbiddenSubjectKey);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(
    ([key, child]) =>
      FORBIDDEN_SUBJECT_KEYS.has(key) || containsForbiddenSubjectKey(child),
  );
}

function evidenceState(value: unknown): value is PrivacyEvidenceState {
  return value === "verified" || value === "missing" || value === "invalid";
}

function reviewPosture(value: unknown): value is PrivacyReviewPosture {
  return ["current", "due_soon", "overdue", "missing_review_date"].includes(
    String(value),
  );
}

function dsrItem(value: unknown): value is PrivacyDsrItem {
  return Boolean(
    isRecord(value) &&
    exactKeys(value, [
      "assignedToUserId",
      "completedAt",
      "dueAt",
      "id",
      "identityVerificationStatus",
      "receivedAt",
      "requestType",
      "responseEvidenceState",
      "status",
      "updatedAt",
      "urgency",
      "version",
    ]) &&
    isUuid(value.id) &&
    boundedString(value.requestType, 64) &&
    boundedString(value.identityVerificationStatus, 64) &&
    isIso(value.receivedAt) &&
    isIso(value.dueAt) &&
    boundedString(value.status, 64) &&
    isNullableUuid(value.assignedToUserId) &&
    evidenceState(value.responseEvidenceState) &&
    isNullableIso(value.completedAt) &&
    ["completed", "overdue", "due_soon", "on_track"].includes(
      String(value.urgency),
    ) &&
    isVersion(value.version) &&
    isIso(value.updatedAt),
  );
}

function consentItem(value: unknown): value is PrivacyConsentItem {
  return Boolean(
    isRecord(value) &&
    exactKeys(value, [
      "captureEvidenceState",
      "capturedAt",
      "id",
      "privacyRecordId",
      "state",
      "updatedAt",
      "version",
      "withdrawalEvidenceSha256",
      "withdrawalReceiptState",
      "withdrawnAt",
      "withdrawnByUserId",
    ]) &&
    isUuid(value.id) &&
    isNullableUuid(value.privacyRecordId) &&
    isIso(value.capturedAt) &&
    isNullableIso(value.withdrawnAt) &&
    (value.state === "active" || value.state === "withdrawn") &&
    evidenceState(value.captureEvidenceState) &&
    evidenceState(value.withdrawalReceiptState) &&
    (value.withdrawalEvidenceSha256 === null ||
      (typeof value.withdrawalEvidenceSha256 === "string" &&
        SHA256.test(value.withdrawalEvidenceSha256))) &&
    isNullableUuid(value.withdrawnByUserId) &&
    isVersion(value.version) &&
    isIso(value.updatedAt),
  );
}

function holdItem(value: unknown): value is PrivacyLegalHoldItem {
  return Boolean(
    isRecord(value) &&
    exactKeys(value, [
      "createdAt",
      "id",
      "lastReviewOutcome",
      "lastReviewedAt",
      "lastReviewedByUserId",
      "nextReviewAt",
      "placedByUserId",
      "projectId",
      "releasedAt",
      "releasedByUserId",
      "reviewEvidenceSha256",
      "reviewPosture",
      "status",
      "updatedAt",
      "version",
    ]) &&
    isUuid(value.id) &&
    isNullableUuid(value.projectId) &&
    boundedString(value.status, 64) &&
    isUuid(value.placedByUserId) &&
    isNullableUuid(value.releasedByUserId) &&
    isNullableIso(value.releasedAt) &&
    (value.lastReviewOutcome === null ||
      ["continue", "escalate_for_legal_review", "release_recommended"].includes(
        String(value.lastReviewOutcome),
      )) &&
    isNullableIso(value.lastReviewedAt) &&
    isNullableUuid(value.lastReviewedByUserId) &&
    isNullableIso(value.nextReviewAt) &&
    (value.reviewEvidenceSha256 === null ||
      (typeof value.reviewEvidenceSha256 === "string" &&
        SHA256.test(value.reviewEvidenceSha256))) &&
    (reviewPosture(value.reviewPosture) ||
      value.reviewPosture === "released") &&
    isVersion(value.version) &&
    isIso(value.createdAt) &&
    isIso(value.updatedAt),
  );
}

function subprocessorItem(value: unknown): value is PrivacySubprocessorItem {
  return Boolean(
    isRecord(value) &&
    exactKeys(value, [
      "approvedAt",
      "countryCode",
      "dpaStatus",
      "id",
      "legalName",
      "nextReviewAt",
      "reviewPosture",
      "securityReviewStatus",
      "service",
      "updatedAt",
      "version",
    ]) &&
    isUuid(value.id) &&
    boundedString(value.legalName, 160) &&
    boundedString(value.service, 160) &&
    boundedString(value.countryCode, 8) &&
    boundedString(value.dpaStatus, 64) &&
    boundedString(value.securityReviewStatus, 64) &&
    isNullableIso(value.approvedAt) &&
    isNullableIso(value.nextReviewAt) &&
    reviewPosture(value.reviewPosture) &&
    isVersion(value.version) &&
    isIso(value.updatedAt),
  );
}

function transferItem(value: unknown): value is PrivacyTransferItem {
  return Boolean(
    isRecord(value) &&
    exactKeys(value, [
      "approvalEvidenceState",
      "destinationCountry",
      "id",
      "legalReviewStatus",
      "nextReviewAt",
      "originCountry",
      "reviewPosture",
      "subprocessorId",
      "transferBasis",
      "updatedAt",
      "version",
    ]) &&
    isUuid(value.id) &&
    isNullableUuid(value.subprocessorId) &&
    boundedString(value.originCountry, 8) &&
    boundedString(value.destinationCountry, 8) &&
    boundedString(value.transferBasis, 128) &&
    evidenceState(value.approvalEvidenceState) &&
    boundedString(value.legalReviewStatus, 64) &&
    isIso(value.nextReviewAt) &&
    reviewPosture(value.reviewPosture) &&
    isVersion(value.version) &&
    isIso(value.updatedAt),
  );
}

function deletionItem(value: unknown): value is PrivacyDeletionItem {
  return Boolean(
    isRecord(value) &&
    exactKeys(value, [
      "completedAt",
      "executedAt",
      "executedByUserId",
      "held",
      "id",
      "receiptState",
      "scopeManifestSha256",
      "signedByUserId",
      "status",
      "updatedAt",
      "version",
    ]) &&
    isUuid(value.id) &&
    boundedString(value.status, 64) &&
    typeof value.held === "boolean" &&
    isNullableUuid(value.executedByUserId) &&
    isNullableIso(value.executedAt) &&
    ["pending", "recorded", "missing", "invalid"].includes(
      String(value.receiptState),
    ) &&
    (value.scopeManifestSha256 === null ||
      (typeof value.scopeManifestSha256 === "string" &&
        SHA256.test(value.scopeManifestSha256))) &&
    isNullableUuid(value.signedByUserId) &&
    isNullableIso(value.completedAt) &&
    isVersion(value.version) &&
    isIso(value.updatedAt),
  );
}

function booleanMap(value: unknown): boolean {
  return Boolean(
    isRecord(value) &&
    exactKeys(value, [
      "consentRecords",
      "crossBorderTransfers",
      "dataSubjectRequests",
      "deletionActions",
      "legalHolds",
      "subprocessors",
    ]) &&
    [
      "dataSubjectRequests",
      "consentRecords",
      "legalHolds",
      "subprocessors",
      "crossBorderTransfers",
      "deletionActions",
    ].every((key) => typeof value[key] === "boolean"),
  );
}

function totalMap(value: unknown): boolean {
  return Boolean(
    isRecord(value) &&
    exactKeys(value, [
      "consentRecords",
      "crossBorderTransfers",
      "dataSubjectRequests",
      "deletionActions",
      "legalHolds",
      "subprocessors",
    ]) &&
    [
      "dataSubjectRequests",
      "consentRecords",
      "legalHolds",
      "subprocessors",
      "crossBorderTransfers",
      "deletionActions",
    ].every(
      (key) => Number.isSafeInteger(value[key]) && Number(value[key]) >= 0,
    ),
  );
}

export function adaptPrivacyOperationsDashboard(
  value: unknown,
  expectedOrganisationId: string,
): PrivacyOperationsDashboard {
  if (
    containsForbiddenSubjectKey(value) ||
    !isRecord(value) ||
    !exactKeys(value, [
      "authorityNote",
      "blockers",
      "boundedTo",
      "consentRecords",
      "crossBorderTransfers",
      "dataSubjectRequests",
      "deletionActions",
      "generatedAt",
      "legalDecisionAutomated",
      "legalHolds",
      "organisationId",
      "rawSubjectPiiIncluded",
      "subprocessors",
      "totals",
      "truncated",
    ]) ||
    !isIso(value.generatedAt) ||
    value.organisationId !== expectedOrganisationId ||
    !Number.isInteger(value.boundedTo) ||
    Number(value.boundedTo) < 1 ||
    Number(value.boundedTo) > 50 ||
    value.legalDecisionAutomated !== false ||
    value.rawSubjectPiiIncluded !== false ||
    !boundedString(value.authorityNote, 2_000) ||
    !totalMap(value.totals) ||
    !booleanMap(value.truncated) ||
    !Array.isArray(value.dataSubjectRequests) ||
    !value.dataSubjectRequests.every(dsrItem) ||
    !Array.isArray(value.consentRecords) ||
    !value.consentRecords.every(consentItem) ||
    !Array.isArray(value.legalHolds) ||
    !value.legalHolds.every(holdItem) ||
    !Array.isArray(value.subprocessors) ||
    !value.subprocessors.every(subprocessorItem) ||
    !Array.isArray(value.crossBorderTransfers) ||
    !value.crossBorderTransfers.every(transferItem) ||
    !Array.isArray(value.deletionActions) ||
    !value.deletionActions.every(deletionItem) ||
    !Array.isArray(value.blockers) ||
    value.blockers.length > 20 ||
    !value.blockers.every((blocker) => boundedString(blocker, 500)) ||
    [
      value.dataSubjectRequests,
      value.consentRecords,
      value.legalHolds,
      value.subprocessors,
      value.crossBorderTransfers,
      value.deletionActions,
    ].some((items) => items.length > Number(value.boundedTo))
  ) {
    throw new Error("Invalid privacy operations response");
  }
  return value as unknown as PrivacyOperationsDashboard;
}

export function adaptPrivacyOperationsAssignees(
  value: unknown,
  expectedOrganisationId: string,
): PrivacyOperationsAssigneeList {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["items", "limit", "organisationId", "truncated"]) ||
    value.organisationId !== expectedOrganisationId ||
    value.limit !== 100 ||
    value.truncated !== false ||
    !Array.isArray(value.items) ||
    value.items.length > 100
  ) {
    throw new Error("Invalid privacy assignee response");
  }
  const seen = new Set<string>();
  const items = value.items.map((item) => {
    if (
      !isRecord(item) ||
      !exactKeys(item, ["name", "userId"]) ||
      !isUuid(item.userId) ||
      seen.has(item.userId) ||
      typeof item.name !== "string" ||
      item.name !== item.name.trim() ||
      item.name.length < 1 ||
      item.name.length > 512 ||
      /[\u0000-\u001f\u007f\ud800-\udfff]/u.test(item.name)
    ) {
      throw new Error("Invalid privacy assignee");
    }
    seen.add(item.userId);
    return { userId: item.userId, name: item.name };
  });
  return {
    organisationId: expectedOrganisationId,
    items,
    limit: 100,
    truncated: false,
  };
}

export function assertPrivacyWorkflowResponse(
  value: unknown,
  expectedObjectId: string,
  expectedEventType: PrivacyWorkflowReceipt["eventType"],
): asserts value is {
  outcome: "updated";
  resultingVersion: number;
  receipt: PrivacyWorkflowReceipt;
  legalDecisionAutomated: false;
  authorityNote: string;
} {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "authorityNote",
      "legalDecisionAutomated",
      "outcome",
      "receipt",
      "resultingVersion",
    ]) ||
    value.outcome !== "updated" ||
    !isVersion(value.resultingVersion) ||
    !isRecord(value.receipt) ||
    !exactKeys(value.receipt, [
      "actorUserId",
      "eventType",
      "legalDecisionAutomated",
      "objectId",
      "receiptSha256",
      "recordedAt",
      "resultingVersion",
    ]) ||
    !SHA256.test(String(value.receipt.receiptSha256)) ||
    ![
      "privacy.dsr_triage_recorded",
      "privacy.consent_withdrawal_recorded",
      "privacy.legal_hold_review_recorded",
    ].includes(String(value.receipt.eventType)) ||
    value.receipt.eventType !== expectedEventType ||
    value.receipt.objectId !== expectedObjectId ||
    !isUuid(value.receipt.actorUserId) ||
    !isIso(value.receipt.recordedAt) ||
    value.receipt.resultingVersion !== value.resultingVersion ||
    value.receipt.legalDecisionAutomated !== false ||
    value.legalDecisionAutomated !== false ||
    !boundedString(value.authorityNote, 2_000)
  ) {
    throw new Error("Invalid privacy workflow response");
  }
}
