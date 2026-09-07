import {
  exactKeys as exact,
  isRecord as record,
  SHA256_PATTERN as SHA256,
  UUID_PATTERN as UUID,
} from "./closed-contract";

export type EvidenceRenewalImpact = "blocked" | "at_risk" | "monitor";
export type EvidenceRenewalStatus =
  | "planned"
  | "replacement_staged"
  | "promoted"
  | "rejected";
export type EvidenceRenewalReviewReason =
  | "replacement_verified"
  | "incorrect_document"
  | "expiry_unacceptable"
  | "quality_issue";

export const EVIDENCE_RENEWAL_AUTHORITY_NOTE =
  "This register records a receipt-backed internal due reminder and named-human evidence-renewal workflow. It does not send an external message, contact an issuer or client, approve a pursuit, or claim delivery outside Valo.";

export interface EvidenceRenewalAffectedPursuit {
  projectId: string;
  title: string;
  impact: EvidenceRenewalImpact;
}

export interface EvidenceRenewalStagedReplacement {
  documentId: string;
  documentVersionId: string;
  documentVersionNumber: number;
  sha256: string;
  issueDate: string;
  expiryDate: string;
  expectedVaultItemVersion: number;
  stagedByUserId: string;
  stagedAt: string;
}

export interface EvidenceRenewalInternalReminder {
  channel: "valo_evidence_renewal_register";
  assignedOwnerUserId: string;
  dueAt: string;
  status: "open" | "resolved";
  recordedReceiptSha256: string;
  resolvedReceiptSha256: string | null;
  externalDeliveryReceipt: null;
}

export interface EvidenceRenewalPlan {
  id: string;
  organisationId: string;
  projectId: string;
  vaultItemId: string;
  artefactType: string;
  owner: { userId: string; name: string; current: boolean };
  verifier: { userId: string; name: string; current: boolean };
  targetDate: string;
  internalReminder: EvidenceRenewalInternalReminder;
  affectedPursuits: readonly EvidenceRenewalAffectedPursuit[];
  status: EvidenceRenewalStatus;
  version: number;
  stagedReplacement: EvidenceRenewalStagedReplacement | null;
  reviewReasonCode: EvidenceRenewalReviewReason | null;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  latestReceiptSha256: string;
  promotionReceiptSha256: string | null;
  receipts: readonly {
    version: number;
    kind: "plan_created" | "replacement_staged" | "replacement_reviewed";
    occurredAt: string;
    actorUserId: string;
    sha256: string;
  }[];
  externalMessageSent: false;
}

export interface EvidenceRenewalSnapshot {
  organisationId: string;
  projectId: string;
  generatedAt: string;
  items: readonly EvidenceRenewalPlan[];
  limit: 100;
  truncated: false;
  externalMessagingConnected: false;
  authorityNote: string;
}

export interface EvidenceRenewalAuthorityList {
  organisationId: string;
  owners: readonly { userId: string; name: string }[];
  verifiers: readonly { userId: string; name: string }[];
  limit: 100;
  truncated: false;
}

export interface EvidenceRenewalCreateDraft {
  vaultItemId: string;
  ownerUserId: string;
  verifierUserId: string;
  targetDate: string;
  affectedPursuits: readonly {
    projectId: string;
    impact: EvidenceRenewalImpact;
  }[];
  idempotencyKey: string;
}

export interface EvidenceRenewalStageDraft {
  documentId: string;
  sha256: string;
  issueDate: string;
  expiryDate: string;
  idempotencyKey: string;
}

export interface EvidenceRenewalReviewDraft {
  decision: "approve" | "reject";
  reasonCode: EvidenceRenewalReviewReason;
  idempotencyKey: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;
const IMPACTS = new Set<EvidenceRenewalImpact>([
  "blocked",
  "at_risk",
  "monitor",
]);
const STATUSES = new Set<EvidenceRenewalStatus>([
  "planned",
  "replacement_staged",
  "promoted",
  "rejected",
]);
const REASONS = new Set<EvidenceRenewalReviewReason>([
  "replacement_verified",
  "incorrect_document",
  "expiry_unacceptable",
  "quality_issue",
]);

function text(value: unknown, max: number): value is string {
  return (
    typeof value === "string" &&
    value === value.trim() &&
    value.length >= 1 &&
    value.length <= max &&
    !/[\u0000-\u001f\u007f\ud800-\udfff]/u.test(value)
  );
}

function instant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString() === value;
}

function date(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(parsed.valueOf()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function authority(
  value: unknown,
): { userId: string; name: string; current: boolean } | null {
  if (
    !record(value) ||
    !exact(value, ["userId", "name", "current"]) ||
    typeof value.userId !== "string" ||
    !UUID.test(value.userId) ||
    !text(value.name, 512) ||
    typeof value.current !== "boolean"
  ) {
    return null;
  }
  return value as unknown as {
    userId: string;
    name: string;
    current: boolean;
  };
}

function stagedReplacement(
  value: unknown,
): EvidenceRenewalStagedReplacement | null {
  if (
    !record(value) ||
    !exact(value, [
      "documentId",
      "documentVersionId",
      "documentVersionNumber",
      "sha256",
      "issueDate",
      "expiryDate",
      "expectedVaultItemVersion",
      "stagedByUserId",
      "stagedAt",
    ]) ||
    typeof value.documentId !== "string" ||
    !UUID.test(value.documentId) ||
    typeof value.documentVersionId !== "string" ||
    !UUID.test(value.documentVersionId) ||
    !Number.isSafeInteger(value.documentVersionNumber) ||
    Number(value.documentVersionNumber) < 1 ||
    typeof value.sha256 !== "string" ||
    !SHA256.test(value.sha256) ||
    !date(value.issueDate) ||
    !date(value.expiryDate) ||
    String(value.expiryDate) <= String(value.issueDate) ||
    !Number.isSafeInteger(value.expectedVaultItemVersion) ||
    Number(value.expectedVaultItemVersion) < 1 ||
    typeof value.stagedByUserId !== "string" ||
    !UUID.test(value.stagedByUserId) ||
    !instant(value.stagedAt)
  ) {
    return null;
  }
  return value as unknown as EvidenceRenewalStagedReplacement;
}

function adaptPlan(
  value: unknown,
  organisationId: string,
  projectId: string,
): EvidenceRenewalPlan {
  if (
    !record(value) ||
    !exact(value, [
      "id",
      "organisationId",
      "projectId",
      "vaultItemId",
      "artefactType",
      "owner",
      "verifier",
      "targetDate",
      "internalReminder",
      "affectedPursuits",
      "status",
      "version",
      "stagedReplacement",
      "reviewReasonCode",
      "createdByUserId",
      "createdAt",
      "updatedAt",
      "latestReceiptSha256",
      "promotionReceiptSha256",
      "receipts",
      "externalMessageSent",
    ]) ||
    typeof value.id !== "string" ||
    !UUID.test(value.id) ||
    value.organisationId !== organisationId ||
    value.projectId !== projectId ||
    typeof value.vaultItemId !== "string" ||
    !UUID.test(value.vaultItemId) ||
    !text(value.artefactType, 1_024) ||
    !date(value.targetDate) ||
    typeof value.status !== "string" ||
    !STATUSES.has(value.status as EvidenceRenewalStatus) ||
    !Number.isSafeInteger(value.version) ||
    Number(value.version) < 1 ||
    typeof value.createdByUserId !== "string" ||
    !UUID.test(value.createdByUserId) ||
    !instant(value.createdAt) ||
    !instant(value.updatedAt) ||
    typeof value.latestReceiptSha256 !== "string" ||
    !SHA256.test(value.latestReceiptSha256) ||
    (value.promotionReceiptSha256 !== null &&
      (typeof value.promotionReceiptSha256 !== "string" ||
        !SHA256.test(value.promotionReceiptSha256))) ||
    value.externalMessageSent !== false ||
    !Array.isArray(value.affectedPursuits) ||
    value.affectedPursuits.length < 1 ||
    value.affectedPursuits.length > 25 ||
    !Array.isArray(value.receipts) ||
    value.receipts.length !== value.version ||
    value.receipts.length > 3
  ) {
    throw new Error("Invalid evidence-renewal plan response");
  }
  const owner = authority(value.owner);
  const verifier = authority(value.verifier);
  if (!owner || !verifier || owner.userId === verifier.userId) {
    throw new Error("Invalid evidence-renewal authority response");
  }
  const reminder = value.internalReminder;
  if (
    !record(reminder) ||
    !exact(reminder, [
      "channel",
      "assignedOwnerUserId",
      "dueAt",
      "status",
      "recordedReceiptSha256",
      "resolvedReceiptSha256",
      "externalDeliveryReceipt",
    ]) ||
    reminder.channel !== "valo_evidence_renewal_register" ||
    reminder.assignedOwnerUserId !== owner.userId ||
    !instant(reminder.dueAt) ||
    reminder.dueAt !== `${value.targetDate}T16:00:00.000Z` ||
    (reminder.status !== "open" && reminder.status !== "resolved") ||
    typeof reminder.recordedReceiptSha256 !== "string" ||
    !SHA256.test(reminder.recordedReceiptSha256) ||
    (reminder.resolvedReceiptSha256 !== null &&
      (typeof reminder.resolvedReceiptSha256 !== "string" ||
        !SHA256.test(reminder.resolvedReceiptSha256))) ||
    reminder.externalDeliveryReceipt !== null
  ) {
    throw new Error("Invalid internal renewal reminder response");
  }
  const affectedIds = new Set<string>();
  const affectedPursuits = value.affectedPursuits.map((item) => {
    if (
      !record(item) ||
      !exact(item, ["projectId", "title", "impact"]) ||
      typeof item.projectId !== "string" ||
      !UUID.test(item.projectId) ||
      affectedIds.has(item.projectId) ||
      !text(item.title, 1_024) ||
      typeof item.impact !== "string" ||
      !IMPACTS.has(item.impact as EvidenceRenewalImpact)
    ) {
      throw new Error("Invalid affected-pursuit response");
    }
    affectedIds.add(item.projectId);
    return item as unknown as EvidenceRenewalAffectedPursuit;
  });
  if (!affectedIds.has(projectId)) {
    throw new Error("Renewal scope is absent from affected pursuits");
  }
  const receipts = value.receipts.map((item, index) => {
    if (
      !record(item) ||
      !exact(item, [
        "version",
        "kind",
        "occurredAt",
        "actorUserId",
        "sha256",
      ]) ||
      item.version !== index + 1 ||
      !["plan_created", "replacement_staged", "replacement_reviewed"].includes(
        String(item.kind),
      ) ||
      !instant(item.occurredAt) ||
      typeof item.actorUserId !== "string" ||
      !UUID.test(item.actorUserId) ||
      typeof item.sha256 !== "string" ||
      !SHA256.test(item.sha256)
    ) {
      throw new Error("Invalid renewal receipt chain response");
    }
    return item as EvidenceRenewalPlan["receipts"][number];
  });
  if (
    receipts[0]?.kind !== "plan_created" ||
    receipts.at(-1)?.sha256 !== value.latestReceiptSha256 ||
    reminder.recordedReceiptSha256 !== receipts[0].sha256
  ) {
    throw new Error("Inconsistent renewal receipt head");
  }
  const staged =
    value.stagedReplacement === null
      ? null
      : stagedReplacement(value.stagedReplacement);
  if (value.stagedReplacement !== null && !staged) {
    throw new Error("Invalid staged replacement response");
  }
  const reason = value.reviewReasonCode;
  if (
    reason !== null &&
    (typeof reason !== "string" ||
      !REASONS.has(reason as EvidenceRenewalReviewReason))
  ) {
    throw new Error("Invalid renewal review response");
  }
  const status = value.status as EvidenceRenewalStatus;
  const stateConsistent =
    (status === "planned" &&
      value.version === 1 &&
      staged === null &&
      reason === null &&
      value.promotionReceiptSha256 === null &&
      reminder.status === "open" &&
      reminder.resolvedReceiptSha256 === null) ||
    (status === "replacement_staged" &&
      value.version === 2 &&
      staged !== null &&
      staged.stagedByUserId === owner.userId &&
      reason === null &&
      value.promotionReceiptSha256 === null &&
      reminder.status === "open" &&
      reminder.resolvedReceiptSha256 === null) ||
    (status === "promoted" &&
      value.version === 3 &&
      staged !== null &&
      reason === "replacement_verified" &&
      value.promotionReceiptSha256 === value.latestReceiptSha256 &&
      reminder.status === "resolved" &&
      reminder.resolvedReceiptSha256 === value.latestReceiptSha256) ||
    (status === "rejected" &&
      value.version === 3 &&
      staged !== null &&
      reason !== null &&
      reason !== "replacement_verified" &&
      value.promotionReceiptSha256 === null &&
      reminder.status === "resolved" &&
      reminder.resolvedReceiptSha256 === value.latestReceiptSha256);
  if (!stateConsistent) throw new Error("Inconsistent renewal plan state");
  return {
    ...(value as unknown as EvidenceRenewalPlan),
    owner,
    verifier,
    internalReminder: reminder as unknown as EvidenceRenewalInternalReminder,
    affectedPursuits,
    receipts,
    stagedReplacement: staged,
    reviewReasonCode: reason as EvidenceRenewalReviewReason | null,
  };
}

export function adaptEvidenceRenewalSnapshot(
  value: unknown,
  organisationId: string,
  projectId: string,
): EvidenceRenewalSnapshot {
  if (
    !record(value) ||
    !exact(value, [
      "organisationId",
      "projectId",
      "generatedAt",
      "items",
      "limit",
      "truncated",
      "externalMessagingConnected",
      "authorityNote",
    ]) ||
    value.organisationId !== organisationId ||
    value.projectId !== projectId ||
    !instant(value.generatedAt) ||
    !Array.isArray(value.items) ||
    value.items.length > 100 ||
    value.limit !== 100 ||
    value.truncated !== false ||
    value.externalMessagingConnected !== false ||
    value.authorityNote !== EVIDENCE_RENEWAL_AUTHORITY_NOTE
  ) {
    throw new Error("Invalid evidence-renewal snapshot response");
  }
  const items = value.items.map((item) =>
    adaptPlan(item, organisationId, projectId),
  );
  if (new Set(items.map(({ id }) => id)).size !== items.length) {
    throw new Error("Duplicate renewal plan response");
  }
  return {
    ...(value as unknown as EvidenceRenewalSnapshot),
    items,
  };
}

function authorityOptions(value: unknown): { userId: string; name: string }[] {
  if (!Array.isArray(value) || value.length > 100) {
    throw new Error("Invalid renewal authority options");
  }
  const ids = new Set<string>();
  return value.map((item) => {
    if (
      !record(item) ||
      !exact(item, ["userId", "name"]) ||
      typeof item.userId !== "string" ||
      !UUID.test(item.userId) ||
      ids.has(item.userId) ||
      !text(item.name, 512)
    ) {
      throw new Error("Invalid renewal authority option");
    }
    ids.add(item.userId);
    return item as unknown as { userId: string; name: string };
  });
}

export function adaptEvidenceRenewalAuthorities(
  value: unknown,
  organisationId: string,
): EvidenceRenewalAuthorityList {
  if (
    !record(value) ||
    !exact(value, [
      "organisationId",
      "owners",
      "verifiers",
      "limit",
      "truncated",
    ]) ||
    value.organisationId !== organisationId ||
    value.limit !== 100 ||
    value.truncated !== false
  ) {
    throw new Error("Invalid evidence-renewal authority response");
  }
  return {
    organisationId,
    owners: authorityOptions(value.owners),
    verifiers: authorityOptions(value.verifiers),
    limit: 100,
    truncated: false,
  };
}

export function adaptEvidenceRenewalMutation(
  value: unknown,
  organisationId: string,
  projectId: string,
): EvidenceRenewalPlan {
  if (
    !record(value) ||
    !exact(value, [
      "outcome",
      "plan",
      "replayed",
      "externalMessageSent",
      "authorityNote",
    ]) ||
    (value.outcome !== "created" && value.outcome !== "updated") ||
    typeof value.replayed !== "boolean" ||
    value.externalMessageSent !== false ||
    value.authorityNote !== EVIDENCE_RENEWAL_AUTHORITY_NOTE
  ) {
    throw new Error("Invalid evidence-renewal mutation response");
  }
  return adaptPlan(value.plan, organisationId, projectId);
}
