import { UUID_PATTERN as UUID } from "@/lib/closed-contract";

export const CLAIMS_DESK_RECORD_TYPES = [
  "contract_event",
  "notice_deadline",
  "variation",
  "claim",
  "payment_certificate",
  "obligation",
] as const;
export type ClaimsDeskRecordType = (typeof CLAIMS_DESK_RECORD_TYPES)[number];

export const CLAIMS_DESK_ACTIONS = [
  "start_review",
  "propose_assessment",
  "approve_assessment",
  "return_assessment",
  "propose_closure",
  "approve_closure",
  "return_closure",
  "withdraw",
] as const;
export type ClaimsDeskAction = (typeof CLAIMS_DESK_ACTIONS)[number];

export const CLAIMS_DESK_REASON_CODES = [
  "evidence_received",
  "deadline_review",
  "assessment_ready",
  "assessment_checked",
  "assessment_returned",
  "closure_ready",
  "closure_checked",
  "closure_returned",
  "duplicate_record",
  "superseded_record",
  "other_human_review",
] as const;

export const CLAIMS_DESK_ASSESSMENT_CODES = [
  "requires_further_review",
  "commercial_position_recorded",
  "not_progressed",
] as const;

export interface ClaimsDeskDocumentBinding {
  documentId: string;
  sha256: string;
}

export interface ClaimsDeskReasonHistoryEntry {
  action: ClaimsDeskAction;
  reasonCode: string;
  assessmentCode: string | null;
  fromStatus: string;
  toStatus: string;
  actorUserId: string;
  occurredAt: string;
  receiptSha256: string;
}

export interface ClaimsDeskRecord {
  id: string;
  organisationId: string;
  projectId: string;
  recordType: ClaimsDeskRecordType;
  reference: string;
  eventDate: string;
  dueAt: string | null;
  amountMinor: number | null;
  currency: string | null;
  documentBindings: readonly ClaimsDeskDocumentBinding[];
  status: string;
  assessmentCode: string | null;
  pendingMakerUserId: string | null;
  version: number;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  latestReceiptSha256: string;
  reasonHistory: readonly ClaimsDeskReasonHistoryEntry[];
}

export interface ClaimsDeskSnapshot {
  organisationId: string;
  projectId: string;
  projectStatus: string;
  records: readonly ClaimsDeskRecord[];
  posture: {
    total: number;
    open: number;
    overdue: number;
    dueSoon: number;
    awaitingChecker: number;
    terminal: number;
  };
  truncated: false;
  generatedAt: string;
  legalConclusionAutomated: false;
  noticeDispatched: false;
  paymentMutated: false;
  authorityNote: string;
}

export interface ClaimsDeskCreateDraft {
  recordType: ClaimsDeskRecordType;
  reference: string;
  eventDate: string;
  dueAt: string | null;
  amountMinor: number | null;
  currency: string | null;
  documentBindings: readonly ClaimsDeskDocumentBinding[];
  idempotencyKey: string;
}

export interface ClaimsDeskTransitionDraft {
  action: ClaimsDeskAction;
  reasonCode: (typeof CLAIMS_DESK_REASON_CODES)[number];
  assessmentCode: (typeof CLAIMS_DESK_ASSESSMENT_CODES)[number] | null;
  documentBindings: readonly ClaimsDeskDocumentBinding[];
  idempotencyKey: string;
}

const SHA = /^[0-9a-f]{64}$/u;
const STATUSES = new Set([
  "registered",
  "under_review",
  "assessment_proposed",
  "assessed",
  "closure_proposed",
  "closed",
  "withdrawn",
]);
const PROHIBITED_KEYS =
  /(?:email|phone|address|subjectName|requesterName|rawPii)/iu;

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value);
  const set = new Set(expected);
  return keys.length === expected.length && keys.every((key) => set.has(key));
}

function safePayload(value: unknown): boolean {
  const serialised = JSON.stringify(value);
  if (serialised.length > 4_194_304) return false;
  const visit = (item: unknown): boolean => {
    if (Array.isArray(item)) return item.length <= 500 && item.every(visit);
    const row = object(item);
    if (!row) return typeof item !== "string" || item.length <= 2_048;
    return Object.entries(row).every(
      ([key, child]) => !PROHIBITED_KEYS.test(key) && visit(child),
    );
  };
  return visit(value);
}

function binding(value: unknown): value is ClaimsDeskDocumentBinding {
  const row = object(value);
  return Boolean(
    row &&
    exactKeys(row, ["documentId", "sha256"]) &&
    typeof row.documentId === "string" &&
    UUID.test(row.documentId) &&
    typeof row.sha256 === "string" &&
    SHA.test(row.sha256),
  );
}

function history(value: unknown): value is ClaimsDeskReasonHistoryEntry {
  const row = object(value);
  return Boolean(
    row &&
    exactKeys(row, [
      "action",
      "reasonCode",
      "assessmentCode",
      "fromStatus",
      "toStatus",
      "actorUserId",
      "occurredAt",
      "receiptSha256",
    ]) &&
    typeof row.action === "string" &&
    CLAIMS_DESK_ACTIONS.includes(row.action as ClaimsDeskAction) &&
    typeof row.reasonCode === "string" &&
    (row.assessmentCode === null || typeof row.assessmentCode === "string") &&
    typeof row.fromStatus === "string" &&
    STATUSES.has(row.fromStatus) &&
    typeof row.toStatus === "string" &&
    STATUSES.has(row.toStatus) &&
    typeof row.actorUserId === "string" &&
    UUID.test(row.actorUserId) &&
    typeof row.occurredAt === "string" &&
    typeof row.receiptSha256 === "string" &&
    SHA.test(row.receiptSha256),
  );
}

function record(
  value: unknown,
  organisationId: string,
  projectId: string,
): value is ClaimsDeskRecord {
  const row = object(value);
  return Boolean(
    row &&
    typeof row.id === "string" &&
    UUID.test(row.id) &&
    row.organisationId === organisationId &&
    row.projectId === projectId &&
    typeof row.recordType === "string" &&
    CLAIMS_DESK_RECORD_TYPES.includes(row.recordType as ClaimsDeskRecordType) &&
    typeof row.reference === "string" &&
    row.reference.length <= 80 &&
    typeof row.eventDate === "string" &&
    (row.dueAt === null || typeof row.dueAt === "string") &&
    (row.amountMinor === null ||
      (typeof row.amountMinor === "number" &&
        Number.isSafeInteger(row.amountMinor))) &&
    (row.currency === null ||
      (typeof row.currency === "string" && /^[A-Z]{3}$/u.test(row.currency))) &&
    Array.isArray(row.documentBindings) &&
    row.documentBindings.length >= 1 &&
    row.documentBindings.length <= 10 &&
    row.documentBindings.every(binding) &&
    typeof row.status === "string" &&
    STATUSES.has(row.status) &&
    (row.assessmentCode === null || typeof row.assessmentCode === "string") &&
    (row.pendingMakerUserId === null ||
      (typeof row.pendingMakerUserId === "string" &&
        UUID.test(row.pendingMakerUserId))) &&
    Number.isSafeInteger(row.version) &&
    Number(row.version) >= 1 &&
    typeof row.createdByUserId === "string" &&
    UUID.test(row.createdByUserId) &&
    typeof row.createdAt === "string" &&
    typeof row.updatedAt === "string" &&
    typeof row.latestReceiptSha256 === "string" &&
    SHA.test(row.latestReceiptSha256) &&
    Array.isArray(row.reasonHistory) &&
    row.reasonHistory.length <= 99 &&
    row.reasonHistory.every(history),
  );
}

export function adaptClaimsDeskSnapshot(
  value: unknown,
  organisationId: string,
  projectId: string,
): ClaimsDeskSnapshot {
  if (!safePayload(value)) throw new Error("Unsafe Claims Desk response");
  const row = object(value);
  const posture = object(row?.posture);
  const counts = posture
    ? exactKeys(posture, [
        "total",
        "open",
        "overdue",
        "dueSoon",
        "awaitingChecker",
        "terminal",
      ]) &&
      [
        "total",
        "open",
        "overdue",
        "dueSoon",
        "awaitingChecker",
        "terminal",
      ].every(
        (key) =>
          Number.isSafeInteger(posture[key]) && Number(posture[key]) >= 0,
      )
    : false;
  if (
    !row ||
    !exactKeys(row, [
      "organisationId",
      "projectId",
      "projectStatus",
      "records",
      "posture",
      "truncated",
      "generatedAt",
      "legalConclusionAutomated",
      "noticeDispatched",
      "paymentMutated",
      "authorityNote",
    ]) ||
    row.organisationId !== organisationId ||
    row.projectId !== projectId ||
    typeof row.projectStatus !== "string" ||
    !Array.isArray(row.records) ||
    row.records.length > 250 ||
    !row.records.every((item) => record(item, organisationId, projectId)) ||
    !counts ||
    row.truncated !== false ||
    typeof row.generatedAt !== "string" ||
    row.legalConclusionAutomated !== false ||
    row.noticeDispatched !== false ||
    row.paymentMutated !== false ||
    typeof row.authorityNote !== "string" ||
    row.authorityNote.length > 1_024
  ) {
    throw new Error("Claims Desk response failed its closed contract");
  }
  return row as unknown as ClaimsDeskSnapshot;
}

export function assertClaimsDeskMutationResponse(
  value: unknown,
  organisationId: string,
  projectId: string,
): ClaimsDeskRecord {
  if (!safePayload(value))
    throw new Error("Unsafe Claims Desk mutation response");
  const row = object(value);
  if (
    !row ||
    !exactKeys(row, [
      "outcome",
      "record",
      "replayed",
      "legalConclusionAutomated",
      "noticeDispatched",
      "paymentMutated",
      "authorityNote",
    ]) ||
    (row.outcome !== "created" && row.outcome !== "updated") ||
    !record(row.record, organisationId, projectId) ||
    row.legalConclusionAutomated !== false ||
    row.noticeDispatched !== false ||
    row.paymentMutated !== false
  ) {
    throw new Error("Claims Desk mutation failed its closed contract");
  }
  return row.record;
}

export function parseBindingLines(value: string): ClaimsDeskDocumentBinding[] {
  const rows = value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [documentId, sha256, ...extra] = line.split(/\s+/u);
      if (
        extra.length ||
        !documentId ||
        !sha256 ||
        !UUID.test(documentId) ||
        !SHA.test(sha256)
      ) {
        throw new Error(
          "Use one approved document ID and SHA-256 pair per line",
        );
      }
      return { documentId, sha256 };
    });
  if (rows.length < 1 || rows.length > 10) {
    throw new Error("Provide between one and ten approved document records");
  }
  if (new Set(rows.map((row) => row.documentId)).size !== rows.length) {
    throw new Error("Each approved document may be included once");
  }
  return rows;
}

export function bindingLines(
  bindings: readonly ClaimsDeskDocumentBinding[],
): string {
  return bindings.map((item) => `${item.documentId} ${item.sha256}`).join("\n");
}
