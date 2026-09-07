export const ADDENDUM_IMPACT_POLICY_VERSION = "valo.addendum-impact/v1";
export const ADDENDUM_REOPEN_CONFIRMATION = "REOPEN AFFECTED WORK";

export type AddendumImpactReviewDecision =
  | "accepted"
  | "changes_requested"
  | "rejected";

export interface AddendumSourceVersion {
  documentId: string;
  documentVersionId: string;
  filename: string;
  versionNumber: number;
  sha256: string;
  capturedAt: string;
}

export interface AddendumCitation {
  citationId: string;
  sourceVersionId: string;
  sourceTitle: string;
  contentSha256: string;
  quote: string;
  startOffset: number;
  endOffset: number;
  page: number | null;
  section: string | null;
}

export interface AddendumChange {
  id: string;
  fieldExternalId: string;
  category: string;
  kind: "added" | "changed" | "removed";
  beforeValue: string | null;
  afterValue: string | null;
  beforeCitation: AddendumCitation | null;
  afterCitation: AddendumCitation | null;
  reviewState: "unreviewed" | "accepted" | "rejected" | "needs_changes";
}

export interface AddendumDownstreamImpact {
  targetId: string;
  objectType:
    | "project"
    | "requirement"
    | "work_task"
    | "draft"
    | "boq_check"
    | "approval"
    | "package"
    | "report";
  label: string;
  currentState: string;
  currentVersion: number;
  proposedAction: "reopen" | "invalidate" | "recheck";
  changeIds: readonly string[];
  fieldExternalIds: readonly string[];
}

export interface AddendumImpactReview {
  assessmentId: string;
  impactManifestSha256: string;
  decision: AddendumImpactReviewDecision;
  reason: string;
  reviewerUserId: string;
  reviewerName: string;
  reviewedAt: string;
  version: number;
}

export interface AddendumImpactApplication {
  assessmentId: string;
  impactManifestSha256: string;
  appliedByUserId: string;
  appliedByName: string;
  appliedAt: string;
  reason: string;
  mutationCount: number;
}

export interface AddendumImpactCentreSnapshot {
  policyVersion: string;
  authorityNote: string;
  project: { id: string; title: string };
  baseline: AddendumSourceVersion;
  revision: AddendumSourceVersion;
  assessment: {
    id: string;
    version: number;
    radarId: string;
    sourceManifestSha256: string;
    impactManifestSha256: string;
    status:
      | "blocked"
      | "no_changes"
      | "review_required"
      | "ready_to_reopen"
      | "reviewed_no_affected_work";
    readyForReopening: boolean;
    changes: readonly AddendumChange[];
    impacts: readonly AddendumDownstreamImpact[];
    issues: readonly {
      code: string;
      severity: "blocker" | "warning";
      message: string;
    }[];
  };
  review: AddendumImpactReview | null;
  reviewStale: boolean;
  application: AddendumImpactApplication | null;
  requiredConfirmation: typeof ADDENDUM_REOPEN_CONFIRMATION;
}

export interface AddendumImpactReviewRequest {
  baselineVersionId: string;
  revisionVersionId: string;
  assessmentId: string;
  radarId: string;
  expectedImpactManifestSha256: string;
  expectedAssessmentVersion: number;
  decision: AddendumImpactReviewDecision;
  reason: string;
}

export interface AddendumImpactApplyRequest {
  baselineVersionId: string;
  revisionVersionId: string;
  assessmentId: string;
  radarId: string;
  expectedImpactManifestSha256: string;
  expectedAssessmentVersion: number;
  reason: string;
  confirmation: string;
}

const SHA256 = /^[a-f0-9]{64}$/u;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const RFC3339_DATE_TIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;
const STATUSES = new Set([
  "blocked",
  "no_changes",
  "review_required",
  "ready_to_reopen",
  "reviewed_no_affected_work",
]);
const CHANGE_KINDS = new Set(["added", "changed", "removed"]);
const REVIEW_STATES = new Set([
  "unreviewed",
  "accepted",
  "rejected",
  "needs_changes",
]);
const REVIEW_DECISIONS = new Set(["accepted", "changes_requested", "rejected"]);
const OBJECT_TYPES = new Set([
  "project",
  "requirement",
  "work_task",
  "draft",
  "boq_check",
  "approval",
  "package",
  "report",
]);
const ACTIONS = new Set(["reopen", "invalidate", "recheck"]);

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === expected.length &&
    keys.every((key) => expected.includes(key))
  );
}

function text(value: unknown, maximum = 20_000): value is string {
  return (
    typeof value === "string" && value.length > 0 && value.length <= maximum
  );
}

function integer(value: unknown, minimum = 0): value is number {
  return (
    typeof value === "number" && Number.isSafeInteger(value) && value >= minimum
  );
}

function nullableText(
  value: unknown,
  maximum = 20_000,
): value is string | null {
  return value === null || text(value, maximum);
}

function instant(value: unknown): value is string {
  return (
    text(value, 64) &&
    RFC3339_DATE_TIME.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function stringArray(value: unknown, maximum = 2_048): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= maximum &&
    value.every((entry) => text(entry, 160)) &&
    new Set(value).size === value.length
  );
}

function sourceVersion(value: unknown): value is AddendumSourceVersion {
  if (!record(value)) return false;
  return (
    text(value.documentId, 160) &&
    text(value.documentVersionId, 160) &&
    text(value.filename, 1_000) &&
    integer(value.versionNumber, 1) &&
    typeof value.sha256 === "string" &&
    SHA256.test(value.sha256) &&
    instant(value.capturedAt)
  );
}

function citation(value: unknown): value is AddendumCitation {
  if (value === null) return true;
  if (!record(value)) return false;
  return (
    text(value.citationId, 160) &&
    text(value.sourceVersionId, 160) &&
    text(value.sourceTitle, 1_000) &&
    typeof value.contentSha256 === "string" &&
    SHA256.test(value.contentSha256) &&
    text(value.quote) &&
    integer(value.startOffset) &&
    integer(value.endOffset, 1) &&
    value.endOffset > value.startOffset &&
    (value.page === null || integer(value.page, 1)) &&
    (value.section === null || text(value.section, 2_000))
  );
}

function change(value: unknown): value is AddendumChange {
  if (!record(value)) return false;
  return (
    text(value.id, 160) &&
    text(value.fieldExternalId, 160) &&
    text(value.category, 100) &&
    typeof value.kind === "string" &&
    CHANGE_KINDS.has(value.kind) &&
    nullableText(value.beforeValue) &&
    nullableText(value.afterValue) &&
    citation(value.beforeCitation) &&
    citation(value.afterCitation) &&
    typeof value.reviewState === "string" &&
    REVIEW_STATES.has(value.reviewState)
  );
}

function impact(value: unknown): value is AddendumDownstreamImpact {
  if (!record(value)) return false;
  return (
    text(value.targetId, 160) &&
    typeof value.objectType === "string" &&
    OBJECT_TYPES.has(value.objectType) &&
    text(value.label, 1_000) &&
    text(value.currentState, 160) &&
    integer(value.currentVersion, 1) &&
    typeof value.proposedAction === "string" &&
    ACTIONS.has(value.proposedAction) &&
    stringArray(value.changeIds) &&
    stringArray(value.fieldExternalIds)
  );
}

function review(value: unknown): value is AddendumImpactReview | null {
  if (value === null) return true;
  if (!record(value)) return false;
  return (
    text(value.assessmentId, 160) &&
    typeof value.impactManifestSha256 === "string" &&
    SHA256.test(value.impactManifestSha256) &&
    typeof value.decision === "string" &&
    REVIEW_DECISIONS.has(value.decision) &&
    text(value.reason, 2_000) &&
    text(value.reviewerUserId, 160) &&
    text(value.reviewerName, 200) &&
    instant(value.reviewedAt) &&
    integer(value.version, 1)
  );
}

export function isAddendumImpactApplication(
  value: unknown,
): value is AddendumImpactApplication {
  if (
    !record(value) ||
    !exactKeys(value, [
      "assessmentId",
      "impactManifestSha256",
      "appliedByUserId",
      "appliedByName",
      "appliedAt",
      "reason",
      "mutationCount",
    ])
  ) {
    return false;
  }
  return (
    text(value.assessmentId, 128) &&
    typeof value.impactManifestSha256 === "string" &&
    SHA256.test(value.impactManifestSha256) &&
    typeof value.appliedByUserId === "string" &&
    UUID.test(value.appliedByUserId) &&
    text(value.appliedByName, 200) &&
    value.appliedByName.length >= 2 &&
    instant(value.appliedAt) &&
    text(value.reason, 2_000) &&
    integer(value.mutationCount, 1) &&
    value.mutationCount <= 2_048
  );
}

export function adaptAddendumImpactCentre(
  value: unknown,
  expectedProjectId: string,
): AddendumImpactCentreSnapshot {
  if (!record(value) || !record(value.project) || !record(value.assessment)) {
    throw new Error("Addendum impact response is invalid");
  }
  const assessment = value.assessment;
  const changes = assessment.changes;
  const impacts = assessment.impacts;
  const issues = assessment.issues;
  const applicationValid =
    value.application === null ||
    isAddendumImpactApplication(value.application);
  if (
    value.policyVersion !== ADDENDUM_IMPACT_POLICY_VERSION ||
    !text(value.authorityNote, 2_000) ||
    value.project.id !== expectedProjectId ||
    !text(value.project.title, 1_000) ||
    !sourceVersion(value.baseline) ||
    !sourceVersion(value.revision) ||
    value.baseline.documentVersionId === value.revision.documentVersionId ||
    !text(assessment.id, 160) ||
    !integer(assessment.version) ||
    !text(assessment.radarId, 160) ||
    typeof assessment.sourceManifestSha256 !== "string" ||
    !SHA256.test(assessment.sourceManifestSha256) ||
    typeof assessment.impactManifestSha256 !== "string" ||
    !SHA256.test(assessment.impactManifestSha256) ||
    typeof assessment.status !== "string" ||
    !STATUSES.has(assessment.status) ||
    typeof assessment.readyForReopening !== "boolean" ||
    !Array.isArray(changes) ||
    changes.length > 512 ||
    !changes.every(change) ||
    !Array.isArray(impacts) ||
    impacts.length > 2_048 ||
    !impacts.every(impact) ||
    !Array.isArray(issues) ||
    issues.length > 4_096 ||
    !issues.every(
      (issue) =>
        record(issue) &&
        text(issue.code, 160) &&
        (issue.severity === "blocker" || issue.severity === "warning") &&
        text(issue.message, 2_000),
    ) ||
    !review(value.review) ||
    typeof value.reviewStale !== "boolean" ||
    !applicationValid ||
    value.requiredConfirmation !== ADDENDUM_REOPEN_CONFIRMATION
  ) {
    throw new Error("Addendum impact response is invalid");
  }
  return value as unknown as AddendumImpactCentreSnapshot;
}

export function adaptAddendumImpactApplication(
  value: unknown,
): AddendumImpactApplication {
  if (
    !record(value) ||
    !exactKeys(value, ["replayed", "authorityNote", "application"]) ||
    typeof value.replayed !== "boolean" ||
    !text(value.authorityNote, 2_000) ||
    !isAddendumImpactApplication(value.application)
  ) {
    throw new Error("Controlled reopening response is invalid");
  }
  return value.application;
}
