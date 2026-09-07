import { exactKeys as exact, isRecord as record } from "@/lib/closed-contract";

export type OpportunitySourceKind =
  | "manual_url"
  | "ocds"
  | "licensed_feed"
  | "forwarded_notice"
  | "csv";
export type OpportunitySourceStatus =
  | "pending_review"
  | "accepted"
  | "rejected";

export interface OpportunitySourceCandidate {
  id: string;
  organisationId: string;
  sourceKind: OpportunitySourceKind;
  provenance: "operator_recorded" | "adapter_verified";
  sourceSystem: string;
  sourceAuthority: string;
  sourceLocator: string;
  sourceLicenceReference: string | null;
  sourceLocatorSha256: string;
  sourceContentSha256: string | null;
  receiptSha256: string;
  dedupeKey: string;
  externalReference: string;
  title: string;
  procuringEntity: string;
  jurisdiction: string;
  fundingSource: string | null;
  procurementCategory: string | null;
  publishedAt: string | null;
  submissionDeadline: string | null;
  observedAt: string;
  status: OpportunitySourceStatus;
  version: number;
  recordedByUserId: string;
  recordedByName: string;
  reviewedByUserId: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  decisionReason: string | null;
  tenderId: string | null;
}

export interface OpportunitySourceSnapshot {
  items: OpportunitySourceCandidate[];
  limit: 250;
  truncated: false;
  authority: {
    runtimeConnected: true;
    externalAcquisitionConnected: false;
    autonomousScrapingAllowed: false;
    autonomousPursuitActivationAllowed: false;
    authority: "named_human_confirmation_required";
  };
}

export interface ManualOpportunitySourceDraft {
  sourceKind: "manual_url";
  sourceSystem: string;
  sourceAuthority: string;
  sourceLocator: string;
  sourceLicenceReference: string | null;
  externalReference: string;
  title: string;
  procuringEntity: string;
  jurisdiction: string;
  fundingSource: string | null;
  procurementCategory: string | null;
  publishedAt: string | null;
  submissionDeadline: string | null;
  observedAt: string;
  sourceContentSha256: null;
}

const SHA256 = /^[0-9a-f]{64}$/u;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const KINDS = new Set<OpportunitySourceKind>([
  "manual_url",
  "ocds",
  "licensed_feed",
  "forwarded_notice",
  "csv",
]);
const STATUSES = new Set<OpportunitySourceStatus>([
  "pending_review",
  "accepted",
  "rejected",
]);
const CANDIDATE_KEYS = [
  "id",
  "organisationId",
  "sourceKind",
  "provenance",
  "sourceSystem",
  "sourceAuthority",
  "sourceLocator",
  "sourceLicenceReference",
  "sourceLocatorSha256",
  "sourceContentSha256",
  "receiptSha256",
  "dedupeKey",
  "externalReference",
  "title",
  "procuringEntity",
  "jurisdiction",
  "fundingSource",
  "procurementCategory",
  "publishedAt",
  "submissionDeadline",
  "observedAt",
  "status",
  "version",
  "recordedByUserId",
  "recordedByName",
  "reviewedByUserId",
  "reviewedByName",
  "reviewedAt",
  "decisionReason",
  "tenderId",
] as const;

function text(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" && value.length >= 1 && value.length <= maximum
  );
}

function nullableText(value: unknown, maximum: number): boolean {
  return value === null || text(value, maximum);
}

function instant(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function nullableInstant(value: unknown): boolean {
  return value === null || instant(value);
}

export function adaptOpportunitySourceCandidate(
  value: unknown,
  organisationId: string,
): OpportunitySourceCandidate {
  if (
    !record(value) ||
    !exact(value, CANDIDATE_KEYS) ||
    !UUID.test(String(value.id)) ||
    value.organisationId !== organisationId ||
    !KINDS.has(value.sourceKind as OpportunitySourceKind) ||
    (value.provenance !== "operator_recorded" &&
      value.provenance !== "adapter_verified") ||
    !text(value.sourceSystem, 128) ||
    !text(value.sourceAuthority, 512) ||
    !text(value.sourceLocator, 2_048) ||
    !String(value.sourceLocator).startsWith("https://") ||
    !nullableText(value.sourceLicenceReference, 1_024) ||
    !SHA256.test(String(value.sourceLocatorSha256)) ||
    (value.sourceContentSha256 !== null &&
      !SHA256.test(String(value.sourceContentSha256))) ||
    !SHA256.test(String(value.receiptSha256)) ||
    !SHA256.test(String(value.dedupeKey)) ||
    !text(value.externalReference, 128) ||
    !text(value.title, 512) ||
    !text(value.procuringEntity, 512) ||
    !text(value.jurisdiction, 2) ||
    !nullableText(value.fundingSource, 512) ||
    !nullableText(value.procurementCategory, 512) ||
    !nullableInstant(value.publishedAt) ||
    !nullableInstant(value.submissionDeadline) ||
    !instant(value.observedAt) ||
    !STATUSES.has(value.status as OpportunitySourceStatus) ||
    !Number.isSafeInteger(value.version) ||
    (value.version as number) < 1 ||
    !UUID.test(String(value.recordedByUserId)) ||
    !text(value.recordedByName, 512) ||
    (value.reviewedByUserId !== null &&
      !UUID.test(String(value.reviewedByUserId))) ||
    !nullableText(value.reviewedByName, 512) ||
    !nullableInstant(value.reviewedAt) ||
    !nullableText(value.decisionReason, 1_024) ||
    (value.tenderId !== null && !UUID.test(String(value.tenderId)))
  ) {
    throw new Error("Invalid opportunity source candidate response");
  }
  return value as unknown as OpportunitySourceCandidate;
}

export function adaptOpportunitySourceSnapshot(
  value: unknown,
  organisationId: string,
): OpportunitySourceSnapshot {
  if (
    !record(value) ||
    !exact(value, ["items", "limit", "truncated", "authority"]) ||
    !Array.isArray(value.items) ||
    value.items.length > 250 ||
    value.limit !== 250 ||
    value.truncated !== false ||
    !record(value.authority) ||
    !exact(value.authority, [
      "runtimeConnected",
      "externalAcquisitionConnected",
      "autonomousScrapingAllowed",
      "autonomousPursuitActivationAllowed",
      "authority",
    ]) ||
    value.authority.runtimeConnected !== true ||
    value.authority.externalAcquisitionConnected !== false ||
    value.authority.autonomousScrapingAllowed !== false ||
    value.authority.autonomousPursuitActivationAllowed !== false ||
    value.authority.authority !== "named_human_confirmation_required"
  ) {
    throw new Error("Invalid opportunity source snapshot response");
  }
  return {
    items: value.items.map((item) =>
      adaptOpportunitySourceCandidate(item, organisationId),
    ),
    limit: 250,
    truncated: false,
    authority: {
      runtimeConnected: true,
      externalAcquisitionConnected: false,
      autonomousScrapingAllowed: false,
      autonomousPursuitActivationAllowed: false,
      authority: "named_human_confirmation_required",
    },
  };
}
