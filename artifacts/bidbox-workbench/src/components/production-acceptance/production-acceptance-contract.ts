import { isRecord, SHA256_PATTERN, UUID_PATTERN } from "@/lib/closed-contract";

export const PRODUCTION_ACCEPTANCE_CATEGORIES = [
  "migration",
  "rls",
  "tenant_isolation",
  "browser_accessibility",
  "backup",
  "restore",
  "rollback",
] as const;

export type ProductionAcceptanceCategory =
  (typeof PRODUCTION_ACCEPTANCE_CATEGORIES)[number];

export type ProductionAcceptanceState =
  | "passed"
  | "failed"
  | "missing"
  | "expired"
  | "release_mismatch"
  | "integrity_failed";

export interface ProductionAcceptanceEvidenceRecord {
  id: string;
  organisationId: string;
  category: ProductionAcceptanceCategory;
  outcome: "passed" | "failed";
  environment: "staging" | "production" | "recovery_rehearsal";
  releaseSha256: string;
  ownerUserId: string;
  verifiedByUserId: string;
  observedAt: string;
  expiresAt: string;
  evidenceReference: string;
  artifactSha256: string;
  summary: string;
  recordedAt: string;
  evidenceDigest: string;
}

export interface ProductionAcceptanceCategorySnapshot {
  category: ProductionAcceptanceCategory;
  label: string;
  state: ProductionAcceptanceState;
  required: true;
  latestEvidence: ProductionAcceptanceEvidenceRecord | null;
}

export interface ProductionAcceptanceBlocker {
  code: string;
  category: ProductionAcceptanceCategory | null;
  message: string;
}

export interface ProductionAcceptanceSnapshot {
  generatedAt: string;
  organisationId: string;
  expectedReleaseSha256: string | null;
  recommendedDecision: "go" | "no_go";
  deploymentAuthorized: false;
  requiresNamedHumanApproval: true;
  categories: readonly ProductionAcceptanceCategorySnapshot[];
  blockers: readonly ProductionAcceptanceBlocker[];
  authorityNote: string;
}

export interface ProductionAcceptanceEvidenceDraft {
  category: ProductionAcceptanceCategory;
  outcome: "passed" | "failed";
  environment: "staging" | "production" | "recovery_rehearsal";
  releaseSha256: string;
  ownerUserId: string;
  observedAt: string;
  expiresAt: string;
  evidenceReference: string;
  artifactSha256: string;
  summary: string;
  idempotencyKey: string;
}

export interface ProductionAcceptanceAuthorityList {
  organisationId: string;
  items: readonly { userId: string; name: string }[];
  limit: 100;
  truncated: false;
}

const CATEGORY_SET = new Set<string>(PRODUCTION_ACCEPTANCE_CATEGORIES);
const STATE_SET = new Set<string>([
  "passed",
  "failed",
  "missing",
  "expired",
  "release_mismatch",
  "integrity_failed",
]);
function isDate(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function evidenceRecord(
  value: unknown,
  expectedOrganisationId?: string,
): ProductionAcceptanceEvidenceRecord | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== "string" ||
    !SHA256_PATTERN.test(value.id) ||
    typeof value.organisationId !== "string" ||
    !value.organisationId ||
    (expectedOrganisationId !== undefined &&
      value.organisationId !== expectedOrganisationId) ||
    typeof value.evidenceDigest !== "string" ||
    value.evidenceDigest !== value.id ||
    typeof value.category !== "string" ||
    !CATEGORY_SET.has(value.category) ||
    (value.outcome !== "passed" && value.outcome !== "failed") ||
    !["staging", "production", "recovery_rehearsal"].includes(
      String(value.environment),
    ) ||
    typeof value.releaseSha256 !== "string" ||
    !SHA256_PATTERN.test(value.releaseSha256) ||
    typeof value.artifactSha256 !== "string" ||
    !SHA256_PATTERN.test(value.artifactSha256) ||
    typeof value.ownerUserId !== "string" ||
    !value.ownerUserId ||
    typeof value.verifiedByUserId !== "string" ||
    !value.verifiedByUserId ||
    value.ownerUserId === value.verifiedByUserId ||
    !isDate(value.observedAt) ||
    !isDate(value.expiresAt) ||
    !isDate(value.recordedAt) ||
    typeof value.evidenceReference !== "string" ||
    !value.evidenceReference ||
    typeof value.summary !== "string" ||
    !value.summary
  ) {
    return null;
  }
  return value as unknown as ProductionAcceptanceEvidenceRecord;
}

function categorySnapshot(
  value: unknown,
): ProductionAcceptanceCategorySnapshot | null {
  if (
    !isRecord(value) ||
    typeof value.category !== "string" ||
    !CATEGORY_SET.has(value.category) ||
    typeof value.label !== "string" ||
    !value.label ||
    typeof value.state !== "string" ||
    !STATE_SET.has(value.state) ||
    value.required !== true
  ) {
    return null;
  }
  const latestEvidence =
    value.latestEvidence === null ? null : evidenceRecord(value.latestEvidence);
  if (value.latestEvidence !== null && !latestEvidence) return null;
  if (latestEvidence && latestEvidence.category !== value.category) return null;
  return {
    category: value.category as ProductionAcceptanceCategory,
    label: value.label,
    state: value.state as ProductionAcceptanceState,
    required: true,
    latestEvidence,
  };
}

function snapshotBlocker(value: unknown): ProductionAcceptanceBlocker | null {
  if (
    !isRecord(value) ||
    typeof value.code !== "string" ||
    !value.code ||
    typeof value.message !== "string" ||
    !value.message ||
    (value.category !== null &&
      (typeof value.category !== "string" || !CATEGORY_SET.has(value.category)))
  ) {
    return null;
  }
  return {
    code: value.code,
    category: value.category as ProductionAcceptanceCategory | null,
    message: value.message,
  };
}

export function adaptProductionAcceptanceSnapshot(
  value: unknown,
  expectedOrganisationId: string,
): ProductionAcceptanceSnapshot {
  if (
    !isRecord(value) ||
    !isDate(value.generatedAt) ||
    value.organisationId !== expectedOrganisationId ||
    (value.expectedReleaseSha256 !== null &&
      (typeof value.expectedReleaseSha256 !== "string" ||
        !SHA256_PATTERN.test(value.expectedReleaseSha256))) ||
    (value.recommendedDecision !== "go" &&
      value.recommendedDecision !== "no_go") ||
    value.deploymentAuthorized !== false ||
    value.requiresNamedHumanApproval !== true ||
    !Array.isArray(value.categories) ||
    !Array.isArray(value.blockers) ||
    typeof value.authorityNote !== "string" ||
    !value.authorityNote
  ) {
    throw new Error("Invalid production acceptance response");
  }
  const categories = value.categories.map(categorySnapshot);
  const blockers = value.blockers.map(snapshotBlocker);
  if (
    categories.some((category) => category === null) ||
    blockers.some((blocker) => blocker === null) ||
    categories.length !== PRODUCTION_ACCEPTANCE_CATEGORIES.length ||
    new Set(categories.map((category) => category!.category)).size !==
      PRODUCTION_ACCEPTANCE_CATEGORIES.length ||
    categories.some(
      (category) =>
        category!.latestEvidence?.organisationId !== undefined &&
        category!.latestEvidence?.organisationId !== expectedOrganisationId,
    ) ||
    (value.recommendedDecision === "go" &&
      (blockers.length !== 0 ||
        categories.some((category) => category!.state !== "passed"))) ||
    (value.recommendedDecision === "no_go" && blockers.length === 0)
  ) {
    throw new Error("Inconsistent production acceptance response");
  }
  return {
    generatedAt: value.generatedAt,
    organisationId: value.organisationId,
    expectedReleaseSha256: value.expectedReleaseSha256,
    recommendedDecision: value.recommendedDecision,
    deploymentAuthorized: false,
    requiresNamedHumanApproval: true,
    categories: categories as ProductionAcceptanceCategorySnapshot[],
    blockers: blockers as ProductionAcceptanceBlocker[],
    authorityNote: value.authorityNote,
  };
}

export function assertProductionAcceptanceRecordResponse(
  value: unknown,
  expectedOrganisationId: string,
): void {
  if (
    !isRecord(value) ||
    !evidenceRecord(value.record, expectedOrganisationId) ||
    typeof value.replayed !== "boolean" ||
    value.deploymentAuthorized !== false ||
    typeof value.authorityNote !== "string" ||
    !value.authorityNote
  ) {
    throw new Error("Invalid production acceptance mutation response");
  }
}

export function adaptProductionAcceptanceAuthorities(
  value: unknown,
  expectedOrganisationId: string,
): ProductionAcceptanceAuthorityList {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 4 ||
    value.organisationId !== expectedOrganisationId ||
    value.limit !== 100 ||
    value.truncated !== false ||
    !Array.isArray(value.items) ||
    value.items.length > 100
  ) {
    throw new Error("Invalid production acceptance authorities response");
  }
  const seen = new Set<string>();
  const items = value.items.map((item) => {
    if (
      !isRecord(item) ||
      Object.keys(item).length !== 2 ||
      typeof item.userId !== "string" ||
      !UUID_PATTERN.test(item.userId) ||
      seen.has(item.userId) ||
      typeof item.name !== "string" ||
      item.name !== item.name.trim() ||
      item.name.length < 1 ||
      item.name.length > 512 ||
      /[\u0000-\u001f\u007f\ud800-\udfff]/u.test(item.name)
    ) {
      throw new Error("Invalid production acceptance authority");
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
