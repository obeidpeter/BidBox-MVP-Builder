import { randomUUID } from "node:crypto";
import {
  db,
  documentVersions,
  documentVersionSnapshots,
  documents,
  jurisdictionRulePacks,
  jurisdictionRules,
  organisationMemberships,
  organisations,
  projects,
  requirementCitations,
  requirements,
  roleGrants,
  tenderContextArtifacts,
  tenderContextRequirements,
  tenderContextVersions,
  tenderEligibilityPassports,
  users,
  vaultItems,
  vaultItemVersions,
  withTenantDatabase,
} from "@workspace/db";
import {
  and,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";
import {
  evaluateJurisdictionRules,
  type JurisdictionRule,
  type RuleAdvisory,
} from "../jurisdictionRules";
import {
  ORGANISATION_ROLES,
  isOrganisationRole,
  isRoleAllowedForOrganisation,
  permissionsForRoles,
  type OrganisationType,
  type Permission,
} from "../permissions";
import { writeAuditTx } from "../audit";
import {
  isIsoDate,
  isIsoInstant,
  isValidId,
  sha256Text,
  type ExactCitation,
  type HumanReview,
  type SourceDocument,
} from "./domain";
import {
  evaluateEligibilityPassport,
  type EligibilityArtifactInput,
  type EligibilityPassportResult,
  type EligibilityRequirementInput,
} from "./eligibilityPassport";
import {
  buildEligibilityResultSnapshot,
  buildTenderContext,
  publicEligibilityStatus,
  TENDER_CONTEXT_SNAPSHOT_SCHEMA,
  TENDER_ELIGIBILITY_RESULT_SCHEMA,
  TENDER_SOURCE_MANIFEST_SCHEMA,
  tenderCanonicalJson,
  tenderRulePackMaterialSha256,
  tenderSha256,
  type ResolvedTenderArtifact,
  type ResolvedTenderRequirement,
  type ResolvedTenderRulePack,
  type ResolvedTenderSource,
} from "./tenderContext";
import {
  TENDER_CONTEXT_AUTHORITY_NOTE,
  TENDER_CONTEXT_BOUNDS,
  TENDER_CONTEXT_POLICY_VERSION,
  TENDER_ELIGIBILITY_POLICY_VERSION,
  TenderContextRepositoryUnavailableError,
  type TenderContextArtifactRecord,
  type TenderContextCentre,
  type TenderContextRepository,
  type TenderContextRequirementRecord,
  type TenderContextScope,
  type TenderContextVersionDraft,
  type TenderContextVersionRecord,
  type TenderContextWriteResult,
  type TenderEligibilityPassportRecord,
  type TenderNamedReview,
  type TenderReviewDraft,
} from "./tenderContextContracts";
import {
  citationMatchesImmutableSnapshot,
  currentArtifactAuthorityMatches,
  isCanonicalSnapshotRedactionStatus,
  legalEntityNameMatchesCitation,
  serializedTenderValueWithinBound,
  uniqueCitationOffset,
} from "./tenderContextPersistencePolicy";

type Database = typeof db;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256 = /^[0-9a-f]{64}$/u;
const PROPOSE_PERMISSIONS = [
  "project:read",
  "document:read",
  "requirement:read",
  "evidence:read",
  "rule_pack:read",
  "requirement:write",
] as const satisfies readonly Permission[];
const REVIEW_PERMISSIONS = [
  "project:read",
  "document:read",
  "requirement:read",
  "evidence:read",
  "rule_pack:read",
  "intelligence:review",
] as const satisfies readonly Permission[];
const MAX_RULES = 1_000;

type ContextRow = typeof tenderContextVersions.$inferSelect;
type PassportRow = typeof tenderEligibilityPassports.$inferSelect;

interface ManifestSource {
  readonly sourceId: string;
  readonly versionId: string;
  readonly documentVersionSha256: string;
  readonly kind: SourceDocument["kind"];
  readonly title: string;
  readonly contentSha256: string;
  readonly capturedAt: string;
  readonly authority: SourceDocument["authority"];
  readonly origin: string;
}

interface TenderSourceManifest {
  readonly schema: typeof TENDER_SOURCE_MANIFEST_SCHEMA;
  readonly sources: readonly ManifestSource[];
  readonly jurisdictionRulePack: {
    readonly id: string;
    readonly packKey: string;
    readonly version: string;
    readonly sourceManifestHash: string;
    readonly rulesSha256: string;
    readonly advisoryOnly: true;
  };
}

interface SnapshotRequirement extends TenderContextRequirementRecord {
  readonly bindingId: string;
  readonly citation: ExactCitation;
  readonly review: HumanReview;
}

interface SnapshotArtifact extends TenderContextArtifactRecord {
  readonly bindingId: string;
  readonly citation: ExactCitation;
  readonly review: HumanReview;
}

interface TenderContextSnapshot {
  readonly schema: typeof TENDER_CONTEXT_SNAPSHOT_SCHEMA;
  readonly legalEntityName: string;
  readonly submissionDate: string;
  readonly jurisdiction: string;
  readonly entityScopes: readonly string[];
  readonly categoryScopes: readonly string[];
  readonly primaryDocumentVersionId: string;
  readonly sourceManifestSha256: string;
  readonly ruleAdvisories: readonly RuleAdvisory[];
  readonly requirements: readonly SnapshotRequirement[];
  readonly artifacts: readonly SnapshotArtifact[];
}

class TenderContextPersistenceConflict extends Error {
  constructor(
    readonly reason:
      | "not_found"
      | "conflict"
      | "version_conflict"
      | "state_conflict"
      | "invalid_snapshot",
  ) {
    super(`Tender context persistence conflict: ${reason}`);
    this.name = "TenderContextPersistenceConflict";
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function json(value: string, maximum: number): unknown {
  if (value.length < 2 || value.length > maximum) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function stringArray(
  value: unknown,
  maximumItems: number = TENDER_CONTEXT_BOUNDS.scopesPerContext,
  maximumCharacters: number = TENDER_CONTEXT_BOUNDS.scopeCharacters,
): string[] | null {
  if (
    !Array.isArray(value) ||
    value.length > maximumItems ||
    value.some(
      (entry) =>
        typeof entry !== "string" ||
        entry.length === 0 ||
        entry.length > maximumCharacters,
    ) ||
    new Set(value).size !== value.length
  ) {
    return null;
  }
  return value as string[];
}

function stableId(value: unknown): value is string {
  return typeof value === "string" && isValidId(value);
}

function sha(value: unknown): value is string {
  return typeof value === "string" && SHA256.test(value);
}

function exactCitation(value: unknown): ExactCitation | null {
  if (
    !record(value) ||
    !stableId(value.sourceId) ||
    !stableId(value.sourceVersionId) ||
    !sha(value.contentSha256) ||
    !Number.isSafeInteger(value.startOffset) ||
    !Number.isSafeInteger(value.endOffset) ||
    Number(value.startOffset) < 0 ||
    Number(value.endOffset) <= Number(value.startOffset) ||
    typeof value.quote !== "string" ||
    value.quote.length === 0 ||
    value.quote.length > TENDER_CONTEXT_BOUNDS.citationCharacters
  ) {
    return null;
  }
  return {
    sourceId: value.sourceId,
    sourceVersionId: value.sourceVersionId,
    contentSha256: value.contentSha256,
    startOffset: Number(value.startOffset),
    endOffset: Number(value.endOffset),
    quote: value.quote,
    ...(Number.isSafeInteger(value.page) && Number(value.page) > 0
      ? { page: Number(value.page) }
      : {}),
    ...(typeof value.section === "string" && value.section.length <= 2_000
      ? { section: value.section }
      : {}),
  };
}

function humanReview(value: unknown): HumanReview | null {
  if (!record(value) || value.state !== "accepted") return null;
  if (
    !stableId(value.reviewerId) ||
    typeof value.reviewedAt !== "string" ||
    !isIsoInstant(value.reviewedAt) ||
    (value.note !== undefined &&
      (typeof value.note !== "string" ||
        value.note.length > TENDER_CONTEXT_BOUNDS.reviewNoteCharacters))
  ) {
    return null;
  }
  return {
    state: "accepted",
    reviewerId: value.reviewerId,
    reviewedAt: value.reviewedAt,
    ...(typeof value.note === "string" ? { note: value.note } : {}),
  };
}

function ruleAdvisory(value: unknown): RuleAdvisory | null {
  if (
    !record(value) ||
    !stableId(value.ruleId) ||
    typeof value.applicable !== "boolean" ||
    typeof value.enabled !== "boolean" ||
    typeof value.manualReviewRequired !== "boolean" ||
    typeof value.message !== "string" ||
    value.message.length === 0 ||
    value.message.length > 1_000
  ) {
    return null;
  }
  const sourceUrls = stringArray(value.sourceUrls, 100, 2_000);
  return sourceUrls
    ? {
        ruleId: value.ruleId,
        applicable: value.applicable,
        enabled: value.enabled,
        manualReviewRequired: value.manualReviewRequired,
        message: value.message,
        sourceUrls,
      }
    : null;
}

function parseManifest(value: string): TenderSourceManifest | null {
  const parsed = json(value, 200_000);
  if (
    !record(parsed) ||
    parsed.schema !== TENDER_SOURCE_MANIFEST_SCHEMA ||
    !Array.isArray(parsed.sources) ||
    parsed.sources.length === 0 ||
    parsed.sources.length >
      TENDER_CONTEXT_BOUNDS.requirementsPerContext +
        TENDER_CONTEXT_BOUNDS.artifactsPerContext +
        1 ||
    !record(parsed.jurisdictionRulePack)
  ) {
    return null;
  }
  const sources: ManifestSource[] = [];
  for (const candidate of parsed.sources) {
    if (
      !record(candidate) ||
      !stableId(candidate.sourceId) ||
      !stableId(candidate.versionId) ||
      !sha(candidate.documentVersionSha256) ||
      !["solicitation", "addendum", "company_evidence"].includes(
        String(candidate.kind),
      ) ||
      typeof candidate.title !== "string" ||
      candidate.title.trim().length === 0 ||
      candidate.title.length > 1_000 ||
      !sha(candidate.contentSha256) ||
      typeof candidate.capturedAt !== "string" ||
      !isIsoInstant(candidate.capturedAt) ||
      !["authoritative", "corroborating"].includes(
        String(candidate.authority),
      ) ||
      typeof candidate.origin !== "string" ||
      candidate.origin.length === 0 ||
      candidate.origin.length > 1_000
    ) {
      return null;
    }
    sources.push(candidate as unknown as ManifestSource);
  }
  const pack = parsed.jurisdictionRulePack;
  if (
    !UUID.test(String(pack.id)) ||
    !stableId(pack.packKey) ||
    !stableId(pack.version) ||
    !sha(pack.sourceManifestHash) ||
    !sha(pack.rulesSha256) ||
    pack.advisoryOnly !== true ||
    new Set(sources.map((source) => source.versionId)).size !== sources.length
  ) {
    return null;
  }
  return {
    schema: TENDER_SOURCE_MANIFEST_SCHEMA,
    sources,
    jurisdictionRulePack: {
      id: String(pack.id),
      packKey: pack.packKey,
      version: pack.version,
      sourceManifestHash: pack.sourceManifestHash,
      rulesSha256: pack.rulesSha256,
      advisoryOnly: true,
    },
  };
}

function parseContextSnapshot(value: string): TenderContextSnapshot | null {
  const parsed = json(value, 500_000);
  if (
    !record(parsed) ||
    parsed.schema !== TENDER_CONTEXT_SNAPSHOT_SCHEMA ||
    typeof parsed.legalEntityName !== "string" ||
    parsed.legalEntityName.length === 0 ||
    parsed.legalEntityName.length >
      TENDER_CONTEXT_BOUNDS.legalEntityCharacters ||
    typeof parsed.submissionDate !== "string" ||
    !isIsoDate(parsed.submissionDate) ||
    typeof parsed.jurisdiction !== "string" ||
    !/^NG(?:-[A-Z0-9]{1,12})?$/u.test(parsed.jurisdiction) ||
    !UUID.test(String(parsed.primaryDocumentVersionId)) ||
    !sha(parsed.sourceManifestSha256) ||
    !Array.isArray(parsed.requirements) ||
    parsed.requirements.length === 0 ||
    parsed.requirements.length > TENDER_CONTEXT_BOUNDS.requirementsPerContext ||
    !Array.isArray(parsed.artifacts) ||
    parsed.artifacts.length > TENDER_CONTEXT_BOUNDS.artifactsPerContext ||
    !Array.isArray(parsed.ruleAdvisories)
  ) {
    return null;
  }
  const entityScopes = stringArray(parsed.entityScopes);
  const categoryScopes = stringArray(parsed.categoryScopes);
  const advisories = parsed.ruleAdvisories.map(ruleAdvisory);
  if (!entityScopes || !categoryScopes || advisories.some((entry) => !entry)) {
    return null;
  }
  const snapshotRequirements: SnapshotRequirement[] = [];
  for (const candidate of parsed.requirements) {
    if (!record(candidate)) return null;
    const citation = exactCitation(candidate.citation);
    const review = humanReview(candidate.review);
    if (
      !UUID.test(String(candidate.bindingId)) ||
      !UUID.test(String(candidate.requirementId)) ||
      !UUID.test(String(candidate.requirementCitationId)) ||
      typeof candidate.description !== "string" ||
      candidate.description.trim().length === 0 ||
      candidate.description.length > 20_000 ||
      !stableId(candidate.evidenceKind) ||
      typeof candidate.mandatory !== "boolean" ||
      typeof candidate.requiresCurrentOnSubmissionDate !== "boolean" ||
      typeof candidate.requiresExactLegalEntityMatch !== "boolean" ||
      !citation ||
      !review
    ) {
      return null;
    }
    snapshotRequirements.push({
      bindingId: String(candidate.bindingId),
      requirementId: String(candidate.requirementId),
      requirementCitationId: String(candidate.requirementCitationId),
      description: candidate.description,
      evidenceKind: candidate.evidenceKind,
      mandatory: candidate.mandatory,
      requiresCurrentOnSubmissionDate:
        candidate.requiresCurrentOnSubmissionDate,
      requiresExactLegalEntityMatch: candidate.requiresExactLegalEntityMatch,
      citation,
      review,
    });
  }
  const snapshotArtifacts: SnapshotArtifact[] = [];
  for (const candidate of parsed.artifacts) {
    if (!record(candidate)) return null;
    const citation = exactCitation(candidate.citation);
    const review = humanReview(candidate.review);
    if (
      !UUID.test(String(candidate.bindingId)) ||
      !UUID.test(String(candidate.vaultItemVersionId)) ||
      !UUID.test(String(candidate.documentVersionId)) ||
      !sha(candidate.documentVersionSha256) ||
      typeof candidate.label !== "string" ||
      candidate.label.trim().length === 0 ||
      candidate.label.length > 500 ||
      typeof candidate.issuer !== "string" ||
      candidate.issuer.trim().length === 0 ||
      candidate.issuer.length > 500 ||
      !stableId(candidate.evidenceKind) ||
      (candidate.legalEntityName !== null &&
        (typeof candidate.legalEntityName !== "string" ||
          candidate.legalEntityName.length === 0 ||
          candidate.legalEntityName.length >
            TENDER_CONTEXT_BOUNDS.legalEntityCharacters)) ||
      (candidate.validFrom !== null &&
        (typeof candidate.validFrom !== "string" ||
          !isIsoDate(candidate.validFrom))) ||
      (candidate.validUntil !== null &&
        (typeof candidate.validUntil !== "string" ||
          !isIsoDate(candidate.validUntil))) ||
      !citation ||
      !review
    ) {
      return null;
    }
    snapshotArtifacts.push({
      bindingId: String(candidate.bindingId),
      vaultItemVersionId: String(candidate.vaultItemVersionId),
      documentVersionId: String(candidate.documentVersionId),
      documentVersionSha256: candidate.documentVersionSha256,
      label: candidate.label,
      issuer: candidate.issuer,
      evidenceKind: candidate.evidenceKind,
      legalEntityName: candidate.legalEntityName as string | null,
      validFrom: candidate.validFrom as string | null,
      validUntil: candidate.validUntil as string | null,
      citation,
      review,
    });
  }
  if (
    new Set(snapshotRequirements.map(({ requirementId }) => requirementId))
      .size !== snapshotRequirements.length ||
    new Set(
      snapshotArtifacts.map(
        ({ vaultItemVersionId, evidenceKind }) =>
          `${vaultItemVersionId}\0${evidenceKind}`,
      ),
    ).size !== snapshotArtifacts.length
  ) {
    return null;
  }
  return {
    schema: TENDER_CONTEXT_SNAPSHOT_SCHEMA,
    legalEntityName: parsed.legalEntityName,
    submissionDate: parsed.submissionDate,
    jurisdiction: parsed.jurisdiction,
    entityScopes,
    categoryScopes,
    primaryDocumentVersionId: String(parsed.primaryDocumentVersionId),
    sourceManifestSha256: parsed.sourceManifestSha256,
    ruleAdvisories: advisories as RuleAdvisory[],
    requirements: snapshotRequirements,
    artifacts: snapshotArtifacts,
  };
}

function deterministicUuid(value: unknown): string {
  const digest = tenderSha256(tenderCanonicalJson(value));
  const characters = digest.slice(0, 32).split("");
  characters[12] = "5";
  characters[16] = (
    (Number.parseInt(characters[16] ?? "0", 16) & 3) |
    8
  ).toString(16);
  const raw = characters.join("");
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`;
}

function dateOnly(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function namedReview(row: {
  readonly status: string;
  readonly reviewedByUserId: string | null;
  readonly reviewedByName: string | null;
  readonly reviewedAt: Date | null;
  readonly reviewNote: string | null;
}): TenderNamedReview {
  const state = row.status === "superseded" ? "accepted" : row.status;
  return {
    state: state as TenderNamedReview["state"],
    reviewedByUserId: row.reviewedByUserId,
    reviewedByName: row.reviewedByName,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    note: row.reviewNote,
  };
}

function contextRecord(row: ContextRow): TenderContextVersionRecord {
  if (
    !SHA256.test(row.sourceManifestSha256) ||
    tenderSha256(row.sourceManifest) !== row.sourceManifestSha256 ||
    !SHA256.test(row.contextSha256) ||
    tenderSha256(row.contextSnapshot) !== row.contextSha256
  ) {
    throw new TenderContextPersistenceConflict("invalid_snapshot");
  }
  const manifest = parseManifest(row.sourceManifest);
  const snapshot = parseContextSnapshot(row.contextSnapshot);
  const entityScopes = stringArray(json(row.entityScopes, 10_000));
  const categoryScopes = stringArray(json(row.categoryScopes, 10_000));
  if (
    !manifest ||
    !snapshot ||
    !entityScopes ||
    !categoryScopes ||
    snapshot.sourceManifestSha256 !== row.sourceManifestSha256 ||
    snapshot.primaryDocumentVersionId !== row.primaryDocumentVersionId ||
    manifest.jurisdictionRulePack.id !== row.jurisdictionRulePackId ||
    snapshot.legalEntityName !== row.legalEntityName ||
    snapshot.submissionDate !== row.submissionDate ||
    snapshot.jurisdiction !== row.jurisdiction ||
    tenderCanonicalJson(snapshot.entityScopes) !==
      tenderCanonicalJson(entityScopes) ||
    tenderCanonicalJson(snapshot.categoryScopes) !==
      tenderCanonicalJson(categoryScopes) ||
    tenderCanonicalJson(snapshot.ruleAdvisories) !== row.ruleAdvisories
  ) {
    throw new TenderContextPersistenceConflict("invalid_snapshot");
  }
  return {
    id: row.id,
    projectId: row.projectId,
    versionNumber: row.versionNumber,
    supersedesContextVersionId: row.supersedesContextVersionId,
    primaryDocumentVersionId: row.primaryDocumentVersionId,
    jurisdictionRulePackId: row.jurisdictionRulePackId,
    rulePackLabel: `${manifest.jurisdictionRulePack.packKey}@${manifest.jurisdictionRulePack.version}`,
    legalEntityName: row.legalEntityName,
    submissionDate: row.submissionDate,
    jurisdiction: row.jurisdiction,
    entityScopes,
    categoryScopes,
    sourceManifestSha256: row.sourceManifestSha256,
    contextSha256: row.contextSha256,
    status: row.status as TenderContextVersionRecord["status"],
    review: namedReview(row),
    ruleAdvisories: snapshot.ruleAdvisories,
    requirements: snapshot.requirements.map(
      ({
        bindingId: _bindingId,
        citation: _citation,
        review: _review,
        ...item
      }) => item,
    ),
    artifacts: snapshot.artifacts.map(
      ({ bindingId: _bindingId, review: _review, ...item }) => item,
    ),
    createdAt: row.createdAt.toISOString(),
    version: row.version,
  };
}

function passportRecord(row: PassportRow): TenderEligibilityPassportRecord {
  if (
    !SHA256.test(row.resultSnapshotSha256) ||
    tenderSha256(row.resultSnapshot) !== row.resultSnapshotSha256
  ) {
    throw new TenderContextPersistenceConflict("invalid_snapshot");
  }
  const parsed = json(row.resultSnapshot, 1_000_000);
  if (
    !record(parsed) ||
    parsed.schema !== TENDER_ELIGIBILITY_RESULT_SCHEMA ||
    parsed.tenderContextVersionId !== row.tenderContextVersionId ||
    typeof parsed.eligibleForNamedTenderReview !== "boolean" ||
    !record(parsed.result) ||
    parsed.result.passportId !== row.passportId ||
    parsed.result.readyForSubmissionUse !== undefined ||
    !Array.isArray(parsed.result.requirements) ||
    !Array.isArray(parsed.result.artifacts) ||
    !Array.isArray(parsed.result.criteria) ||
    !Array.isArray(parsed.result.issues)
  ) {
    throw new TenderContextPersistenceConflict("invalid_snapshot");
  }
  return {
    id: row.id,
    projectId: row.projectId,
    tenderContextVersionId: row.tenderContextVersionId,
    passportId: row.passportId,
    sourceManifestSha256: row.sourceManifestSha256,
    resultSnapshotSha256: row.resultSnapshotSha256,
    resultStatus:
      row.resultStatus as TenderEligibilityPassportRecord["resultStatus"],
    eligibleForNamedTenderReview: parsed.eligibleForNamedTenderReview,
    result: parsed.result as unknown as Omit<
      EligibilityPassportResult,
      "readyForSubmissionUse"
    >,
    review: namedReview({ ...row, status: row.reviewState }),
    createdAt: row.createdAt.toISOString(),
    version: row.version,
  };
}

async function configureMutation(
  transaction: Transaction,
  scope: TenderContextScope,
  projectId: string,
) {
  await transaction.execute(sql`SET LOCAL lock_timeout = '3s'`);
  await transaction.execute(sql`SET LOCAL statement_timeout = '15s'`);
  await transaction.execute(sql`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`bidbox.membership-administration:${scope.organisationId}`}, 0)
    )
  `);
  await transaction.execute(sql`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`bidbox.tender-context:${scope.organisationId}:${projectId}`}, 0)
    )
  `);
}

async function requireCurrentWriteAuthority(
  transaction: Transaction,
  scope: TenderContextScope,
  requiredPermissions: readonly Permission[],
) {
  if (
    scope.source !== "membership" ||
    !scope.membershipId ||
    !UUID.test(scope.membershipId)
  ) {
    throw new TenderContextPersistenceConflict("conflict");
  }
  const rows = await transaction
    .select({
      actor: users,
      membershipId: organisationMemberships.id,
      organisationType: organisations.type,
    })
    .from(organisationMemberships)
    .innerJoin(users, eq(users.id, organisationMemberships.userId))
    .innerJoin(
      organisations,
      eq(organisations.id, organisationMemberships.organisationId),
    )
    .where(
      and(
        eq(organisationMemberships.id, scope.membershipId),
        eq(organisationMemberships.organisationId, scope.organisationId),
        eq(organisationMemberships.userId, scope.actorUserId),
        eq(organisationMemberships.status, "active"),
        isNull(organisationMemberships.delegatedByMembershipId),
        or(
          isNull(organisationMemberships.accessStartsAt),
          lte(organisationMemberships.accessStartsAt, sql`clock_timestamp()`),
        ),
        or(
          isNull(organisationMemberships.accessExpiresAt),
          gt(organisationMemberships.accessExpiresAt, sql`clock_timestamp()`),
        ),
        eq(users.status, "active"),
        eq(organisations.status, "active"),
      ),
    )
    .limit(2);
  const authority = rows[0];
  if (
    rows.length !== 1 ||
    !authority ||
    authority.actor.name?.trim() !== scope.actorName.trim()
  ) {
    throw new TenderContextPersistenceConflict("conflict");
  }
  const grants = await transaction
    .select({ role: roleGrants.role })
    .from(roleGrants)
    .where(
      and(
        eq(roleGrants.membershipId, authority.membershipId),
        isNull(roleGrants.revokedAt),
        or(
          isNull(roleGrants.startsAt),
          lte(roleGrants.startsAt, sql`clock_timestamp()`),
        ),
        or(
          isNull(roleGrants.expiresAt),
          gt(roleGrants.expiresAt, sql`clock_timestamp()`),
        ),
      ),
    )
    .limit(ORGANISATION_ROLES.length + 1);
  if (grants.length > ORGANISATION_ROLES.length) {
    throw new TenderContextPersistenceConflict("conflict");
  }
  const roles = grants
    .map(({ role }) => role)
    .filter(isOrganisationRole)
    .filter((role) =>
      isRoleAllowedForOrganisation(
        role,
        authority.organisationType as OrganisationType,
      ),
    );
  const permissions = permissionsForRoles(roles);
  if (!requiredPermissions.every((permission) => permissions.has(permission))) {
    throw new TenderContextPersistenceConflict("conflict");
  }
  return authority.actor;
}

async function lockedProject(
  transaction: Transaction,
  scope: TenderContextScope,
  projectId: string,
) {
  const [project] = await transaction
    .select()
    .from(projects)
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.organisationId, scope.organisationId),
      ),
    )
    .limit(1)
    .for("update");
  if (!project) throw new TenderContextPersistenceConflict("not_found");
  if (project.status === "archived") {
    throw new TenderContextPersistenceConflict("state_conflict");
  }
  return project;
}

function sourceDocument(
  row: {
    document: typeof documents.$inferSelect;
    documentVersion: typeof documentVersions.$inferSelect;
    snapshot: typeof documentVersionSnapshots.$inferSelect;
  },
  kind: SourceDocument["kind"],
  authority: SourceDocument["authority"],
): ResolvedTenderSource {
  if (
    !row.document.organisationId ||
    !isCanonicalSnapshotRedactionStatus(row.document.redactionStatus) ||
    row.documentVersion.malwareStatus !== "clean" ||
    row.documentVersion.quarantineStatus !== "cleared" ||
    row.snapshot.status !== "verified" ||
    row.snapshot.capturedRedactionStatus !== row.document.redactionStatus ||
    !row.snapshot.verifiedByUserId ||
    !row.snapshot.verifiedByName?.trim() ||
    !row.snapshot.verifiedAt ||
    !SHA256.test(row.documentVersion.sha256) ||
    row.snapshot.documentVersionSha256 !== row.documentVersion.sha256 ||
    !SHA256.test(row.snapshot.canonicalTextSha256) ||
    sha256Text(row.snapshot.canonicalText) !==
      row.snapshot.canonicalTextSha256 ||
    row.snapshot.canonicalText.length > 5_000_000
  ) {
    throw new TenderContextPersistenceConflict("conflict");
  }
  return {
    sourceId: row.document.id,
    versionId: row.documentVersion.id,
    documentVersionSha256: row.documentVersion.sha256,
    kind,
    title: row.document.filename,
    content: row.snapshot.canonicalText,
    contentSha256: row.snapshot.canonicalTextSha256,
    capturedAt: row.documentVersion.createdAt.toISOString(),
    authority,
    origin: `document:${row.document.id}`,
  };
}

function addExactSource(
  sources: Map<string, ResolvedTenderSource>,
  source: ResolvedTenderSource,
): void {
  const current = sources.get(source.versionId);
  if (current && tenderCanonicalJson(current) !== tenderCanonicalJson(source)) {
    throw new TenderContextPersistenceConflict("conflict");
  }
  sources.set(source.versionId, source);
}

function jsonStrings(value: string, maximum: number): string[] | null {
  return stringArray(json(value, 50_000), maximum, 2_000);
}

async function loadRulePack(
  transaction: Transaction,
  draft: Pick<
    TenderContextVersionDraft,
    | "jurisdictionRulePackId"
    | "jurisdiction"
    | "entityScopes"
    | "categoryScopes"
  >,
): Promise<ResolvedTenderRulePack> {
  const [pack] = await transaction
    .select()
    .from(jurisdictionRulePacks)
    .where(eq(jurisdictionRulePacks.id, draft.jurisdictionRulePackId))
    .limit(1)
    .for("share");
  if (
    !pack ||
    pack.status !== "approved" ||
    pack.advisoryOnly !== true ||
    !pack.approvedByUserId ||
    !pack.approvedAt ||
    !SHA256.test(pack.sourceManifestHash) ||
    !(
      pack.jurisdiction === draft.jurisdiction ||
      (pack.jurisdiction === "NG" && draft.jurisdiction.startsWith("NG-"))
    )
  ) {
    throw new TenderContextPersistenceConflict("conflict");
  }
  const approvers = await transaction
    .select({ id: users.id, name: users.name, status: users.status })
    .from(users)
    .where(eq(users.id, pack.approvedByUserId))
    .limit(2)
    .for("share");
  if (
    approvers.length !== 1 ||
    approvers[0]?.status !== "active" ||
    !approvers[0]?.name?.trim()
  ) {
    throw new TenderContextPersistenceConflict("conflict");
  }
  const rows = await transaction
    .select()
    .from(jurisdictionRules)
    .where(eq(jurisdictionRules.rulePackId, pack.id))
    .limit(MAX_RULES + 1)
    .for("share");
  if (rows.length === 0 || rows.length > MAX_RULES) {
    throw new TenderContextPersistenceConflict("conflict");
  }
  const rules: JurisdictionRule[] = rows.map((rule) => {
    const sourceUrls = jsonStrings(rule.sourceUrls, 100);
    const entityScope = jsonStrings(rule.entityScope, 100);
    const categoryScope = jsonStrings(rule.categoryScope, 100);
    if (
      !isValidId(rule.ruleKey) ||
      !sourceUrls ||
      !entityScope ||
      !categoryScope ||
      !rule.domain.trim() ||
      !rule.jurisdiction.trim()
    ) {
      throw new TenderContextPersistenceConflict("conflict");
    }
    return {
      ruleId: rule.ruleKey,
      domain: rule.domain,
      jurisdiction: rule.jurisdiction,
      effectiveFrom: rule.effectiveFrom.toISOString().slice(0, 10),
      effectiveTo: dateOnly(rule.effectiveTo),
      entityScope,
      categoryScope,
      legalReviewStatus: rule.legalReviewStatus,
      severity: rule.severity,
      enabled: rule.enabled,
      sourceUrls,
    };
  });
  return {
    id: pack.id,
    packKey: pack.packKey,
    version: pack.version,
    sourceManifestHash: pack.sourceManifestHash,
    advisoryOnly: true,
    rules,
  };
}

async function resolveContextMaterial(
  transaction: Transaction,
  scope: TenderContextScope,
  project: typeof projects.$inferSelect,
  draft: TenderContextVersionDraft,
) {
  const sources = new Map<string, ResolvedTenderSource>();
  const [primary] = await transaction
    .select({
      document: documents,
      documentVersion: documentVersions,
      snapshot: documentVersionSnapshots,
    })
    .from(documentVersions)
    .innerJoin(documents, eq(documents.id, documentVersions.documentId))
    .innerJoin(
      documentVersionSnapshots,
      eq(documentVersionSnapshots.documentVersionId, documentVersions.id),
    )
    .where(
      and(
        eq(documentVersions.id, draft.primaryDocumentVersionId),
        eq(documentVersions.organisationId, scope.organisationId),
        eq(documents.organisationId, scope.organisationId),
        eq(documents.projectId, project.id),
        eq(documents.type, "tender"),
        eq(documentVersionSnapshots.organisationId, scope.organisationId),
      ),
    )
    .limit(1)
    .for("share");
  if (!primary) throw new TenderContextPersistenceConflict("conflict");
  addExactSource(
    sources,
    sourceDocument(primary, "solicitation", "authoritative"),
  );

  const requirementRows = await transaction
    .select({
      requirement: requirements,
      citation: requirementCitations,
      document: documents,
      documentVersion: documentVersions,
      snapshot: documentVersionSnapshots,
    })
    .from(requirementCitations)
    .innerJoin(
      requirements,
      eq(requirements.id, requirementCitations.requirementId),
    )
    .innerJoin(
      documentVersions,
      eq(documentVersions.id, requirementCitations.documentVersionId),
    )
    .innerJoin(documents, eq(documents.id, documentVersions.documentId))
    .innerJoin(
      documentVersionSnapshots,
      eq(documentVersionSnapshots.documentVersionId, documentVersions.id),
    )
    .where(
      and(
        inArray(
          requirements.id,
          draft.requirements.map(({ requirementId }) => requirementId),
        ),
        inArray(
          requirementCitations.id,
          draft.requirements.map(
            ({ requirementCitationId }) => requirementCitationId,
          ),
        ),
        eq(requirements.organisationId, scope.organisationId),
        eq(requirements.projectId, project.id),
        eq(requirementCitations.organisationId, scope.organisationId),
        eq(documentVersions.organisationId, scope.organisationId),
        eq(documents.organisationId, scope.organisationId),
        eq(documents.projectId, project.id),
        eq(documents.type, "tender"),
        eq(documentVersionSnapshots.organisationId, scope.organisationId),
      ),
    )
    .limit(draft.requirements.length + 1)
    .for("share");
  const requirementByKey = new Map(
    requirementRows.map((row) => [
      `${row.requirement.id}\0${row.citation.id}`,
      row,
    ]),
  );
  const resolvedRequirements: ResolvedTenderRequirement[] =
    draft.requirements.map((binding) => {
      const row = requirementByKey.get(
        `${binding.requirementId}\0${binding.requirementCitationId}`,
      );
      if (
        !row ||
        !["confirmed", "edited"].includes(row.requirement.reviewStatus) ||
        !row.requirement.reviewedBy ||
        !row.requirement.reviewedByName?.trim() ||
        !row.requirement.reviewedAt ||
        row.citation.verificationStatus !== "verified" ||
        !row.citation.verifiedByUserId ||
        !row.citation.verifiedAt ||
        !SHA256.test(row.citation.sourceSnippetHash) ||
        sha256Text(row.citation.sourceSnippet) !==
          row.citation.sourceSnippetHash
      ) {
        throw new TenderContextPersistenceConflict("conflict");
      }
      const source = sourceDocument(row, "solicitation", "authoritative");
      const startOffset = uniqueCitationOffset(
        source.content,
        row.citation.sourceSnippet,
      );
      if (startOffset === null) {
        throw new TenderContextPersistenceConflict("conflict");
      }
      const citation: ExactCitation = {
        sourceId: source.sourceId,
        sourceVersionId: source.versionId,
        contentSha256: source.contentSha256,
        startOffset,
        endOffset: startOffset + row.citation.sourceSnippet.length,
        quote: row.citation.sourceSnippet,
        ...(row.citation.pageNumber ? { page: row.citation.pageNumber } : {}),
        ...(row.citation.paragraphRef
          ? { section: row.citation.paragraphRef }
          : {}),
      };
      if (!citationMatchesImmutableSnapshot(source.content, citation)) {
        throw new TenderContextPersistenceConflict("conflict");
      }
      addExactSource(sources, source);
      const input: EligibilityRequirementInput = {
        externalId: row.requirement.id,
        description: row.requirement.text,
        evidenceKind: binding.evidenceKind,
        mandatory: binding.mandatory,
        requiresCurrentOnSubmissionDate:
          binding.requiresCurrentOnSubmissionDate,
        requiresExactLegalEntityMatch: binding.requiresExactLegalEntityMatch,
        citations: [citation],
        review: {
          state: "accepted",
          reviewerId: row.requirement.reviewedBy,
          reviewedAt: row.requirement.reviewedAt.toISOString(),
          ...(row.requirement.reviewerNotes
            ? { note: row.requirement.reviewerNotes }
            : {}),
        },
      };
      return {
        bindingId: deterministicUuid({
          kind: "tender_requirement_binding",
          organisationId: scope.organisationId,
          projectId: project.id,
          binding,
          input,
        }),
        requirementId: row.requirement.id,
        requirementCitationId: row.citation.id,
        description: row.requirement.text,
        evidenceKind: binding.evidenceKind,
        mandatory: binding.mandatory,
        requiresCurrentOnSubmissionDate:
          binding.requiresCurrentOnSubmissionDate,
        requiresExactLegalEntityMatch: binding.requiresExactLegalEntityMatch,
        input,
      };
    });

  const resolvedArtifacts: ResolvedTenderArtifact[] = [];
  if (draft.artifacts.length > 0) {
    const artifactRows = await transaction
      .select({
        item: vaultItems,
        itemVersion: vaultItemVersions,
        document: documents,
        documentVersion: documentVersions,
        snapshot: documentVersionSnapshots,
      })
      .from(vaultItemVersions)
      .innerJoin(vaultItems, eq(vaultItems.id, vaultItemVersions.vaultItemId))
      .innerJoin(
        documentVersions,
        eq(documentVersions.id, vaultItemVersions.documentVersionId),
      )
      .innerJoin(documents, eq(documents.id, documentVersions.documentId))
      .innerJoin(
        documentVersionSnapshots,
        eq(documentVersionSnapshots.documentVersionId, documentVersions.id),
      )
      .where(
        and(
          inArray(
            vaultItemVersions.id,
            draft.artifacts.map(({ vaultItemVersionId }) => vaultItemVersionId),
          ),
          eq(vaultItemVersions.organisationId, scope.organisationId),
          eq(vaultItems.organisationId, scope.organisationId),
          eq(vaultItems.clientId, project.clientId),
          eq(vaultItems.status, "active"),
          eq(vaultItems.sourceDocumentId, documents.id),
          eq(documentVersions.organisationId, scope.organisationId),
          eq(documents.organisationId, scope.organisationId),
          eq(documentVersionSnapshots.organisationId, scope.organisationId),
        ),
      )
      .limit(draft.artifacts.length + 1)
      .for("share");
    const approverIds = artifactRows
      .map(({ itemVersion }) => itemVersion.approvedByUserId)
      .filter((id): id is string => Boolean(id));
    const approvers =
      approverIds.length > 0
        ? await transaction
            .select({ id: users.id, name: users.name, status: users.status })
            .from(users)
            .where(inArray(users.id, approverIds))
            .limit(approverIds.length + 1)
            .for("share")
        : [];
    const approverById = new Map(approvers.map((user) => [user.id, user]));
    const artifactById = new Map(
      artifactRows.map((row) => [row.itemVersion.id, row]),
    );
    draft.artifacts.forEach((binding) => {
      const row = artifactById.get(binding.vaultItemVersionId);
      if (
        !row ||
        row.itemVersion.verificationState !== "approved" ||
        !row.itemVersion.approvedByUserId ||
        !row.itemVersion.approvedAt ||
        row.itemVersion.withdrawnAt
      ) {
        throw new TenderContextPersistenceConflict("conflict");
      }
      const source = sourceDocument(row, "company_evidence", "corroborating");
      if (!citationMatchesImmutableSnapshot(source.content, binding.citation)) {
        throw new TenderContextPersistenceConflict("conflict");
      }
      if (
        binding.legalEntityName &&
        !legalEntityNameMatchesCitation(
          binding.legalEntityName,
          binding.citation.quote,
        )
      ) {
        throw new TenderContextPersistenceConflict("conflict");
      }
      addExactSource(sources, source);
      const issuer = (
        row.itemVersion.issuingAuthority ?? row.item.issuer
      )?.trim();
      if (!issuer) throw new TenderContextPersistenceConflict("conflict");
      const approver = approverById.get(row.itemVersion.approvedByUserId);
      if (
        !currentArtifactAuthorityMatches(
          {
            vaultItemVersionId: row.itemVersion.id,
            documentVersionId: row.documentVersion.id,
            documentVersionSha256: row.documentVersion.sha256,
            label: row.item.artefactType,
            issuer,
            validFrom: dateOnly(row.itemVersion.issueDate),
            validUntil: dateOnly(row.itemVersion.expiryDate),
            reviewerId: row.itemVersion.approvedByUserId,
            reviewedAt: row.itemVersion.approvedAt.toISOString(),
          },
          {
            vaultItemVersionId: row.itemVersion.id,
            vaultItemOrganisationId: row.item.organisationId,
            versionOrganisationId: row.itemVersion.organisationId,
            expectedOrganisationId: scope.organisationId,
            clientId: row.item.clientId,
            expectedClientId: project.clientId,
            itemStatus: row.item.status,
            sourceDocumentId: row.item.sourceDocumentId,
            documentId: row.document.id,
            versionDocumentId: row.documentVersion.documentId,
            documentVersionId: row.documentVersion.id,
            documentVersionSha256: row.documentVersion.sha256,
            snapshotDocumentVersionSha256: row.snapshot.documentVersionSha256,
            verificationState: row.itemVersion.verificationState,
            withdrawnAt: row.itemVersion.withdrawnAt,
            approvedByUserId: row.itemVersion.approvedByUserId,
            approvedAt: row.itemVersion.approvedAt,
            approverStatus: approver?.status ?? null,
            approverName: approver?.name ?? null,
            label: row.item.artefactType,
            issuer,
            validFrom: dateOnly(row.itemVersion.issueDate),
            validUntil: dateOnly(row.itemVersion.expiryDate),
          },
        )
      ) {
        throw new TenderContextPersistenceConflict("conflict");
      }
      const citation: ExactCitation = {
        sourceId: source.sourceId,
        sourceVersionId: source.versionId,
        contentSha256: source.contentSha256,
        ...binding.citation,
      };
      const input: EligibilityArtifactInput = {
        externalId: row.itemVersion.id,
        evidenceKind: binding.evidenceKind,
        label: row.item.artefactType,
        issuer,
        ...(binding.legalEntityName
          ? { legalEntityName: binding.legalEntityName }
          : {}),
        ...(dateOnly(row.itemVersion.issueDate)
          ? { validFrom: dateOnly(row.itemVersion.issueDate)! }
          : {}),
        ...(dateOnly(row.itemVersion.expiryDate)
          ? { validUntil: dateOnly(row.itemVersion.expiryDate)! }
          : {}),
        citations: [citation],
        review: {
          state: "accepted",
          reviewerId: row.itemVersion.approvedByUserId,
          reviewedAt: row.itemVersion.approvedAt.toISOString(),
        },
      };
      resolvedArtifacts.push({
        bindingId: deterministicUuid({
          kind: "tender_artifact_binding",
          organisationId: scope.organisationId,
          projectId: project.id,
          binding,
          input,
        }),
        vaultItemVersionId: row.itemVersion.id,
        documentVersionId: row.documentVersion.id,
        documentVersionSha256: row.documentVersion.sha256,
        label: row.item.artefactType,
        issuer,
        evidenceKind: binding.evidenceKind,
        legalEntityName: binding.legalEntityName ?? null,
        validFrom: dateOnly(row.itemVersion.issueDate),
        validUntil: dateOnly(row.itemVersion.expiryDate),
        input,
      });
    });
  }
  return {
    draft,
    primaryDocumentVersionId: primary.documentVersion.id,
    sources: [...sources.values()],
    requirements: resolvedRequirements,
    artifacts: resolvedArtifacts,
    rulePack: await loadRulePack(transaction, draft),
  };
}

async function readCentreTx(
  transaction: Transaction,
  scope: TenderContextScope,
  projectId: string,
): Promise<TenderContextCentre | null> {
  const [project] = await transaction
    .select({ id: projects.id, title: projects.tenderTitle })
    .from(projects)
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.organisationId, scope.organisationId),
        ne(projects.status, "archived"),
      ),
    )
    .limit(1);
  if (!project) return null;
  const [contextRows, passportRows] = await Promise.all([
    transaction
      .select()
      .from(tenderContextVersions)
      .where(
        and(
          eq(tenderContextVersions.organisationId, scope.organisationId),
          eq(tenderContextVersions.projectId, projectId),
        ),
      )
      .orderBy(desc(tenderContextVersions.versionNumber))
      .limit(TENDER_CONTEXT_BOUNDS.contextVersionsPerProject + 1),
    transaction
      .select()
      .from(tenderEligibilityPassports)
      .where(
        and(
          eq(tenderEligibilityPassports.organisationId, scope.organisationId),
          eq(tenderEligibilityPassports.projectId, projectId),
        ),
      )
      .orderBy(desc(tenderEligibilityPassports.createdAt))
      .limit(TENDER_CONTEXT_BOUNDS.passportsPerProject + 1),
  ]);
  if (
    contextRows.length > TENDER_CONTEXT_BOUNDS.contextVersionsPerProject ||
    passportRows.length > TENDER_CONTEXT_BOUNDS.passportsPerProject
  ) {
    throw new TenderContextPersistenceConflict("invalid_snapshot");
  }
  return {
    policyVersion: TENDER_CONTEXT_POLICY_VERSION,
    eligibilityPolicyVersion: TENDER_ELIGIBILITY_POLICY_VERSION,
    authorityNote: TENDER_CONTEXT_AUTHORITY_NOTE,
    project,
    contexts: contextRows.map(contextRecord),
    passports: passportRows.map(passportRecord),
  };
}

async function exactContextRecord(
  transaction: Transaction,
  scope: TenderContextScope,
  projectId: string,
  contextId: string,
): Promise<TenderContextVersionRecord> {
  const centre = await readCentreTx(transaction, scope, projectId);
  const value = centre?.contexts.find(({ id }) => id === contextId);
  if (!value) throw new TenderContextPersistenceConflict("invalid_snapshot");
  return value;
}

async function exactPassportRecord(
  transaction: Transaction,
  scope: TenderContextScope,
  projectId: string,
  passportId: string,
): Promise<TenderEligibilityPassportRecord> {
  const centre = await readCentreTx(transaction, scope, projectId);
  const value = centre?.passports.find(({ id }) => id === passportId);
  if (!value) throw new TenderContextPersistenceConflict("invalid_snapshot");
  return value;
}

async function verifyBindings(
  transaction: Transaction,
  scope: TenderContextScope,
  context: ContextRow,
  snapshot: TenderContextSnapshot,
): Promise<void> {
  const [requirementRows, artifactRows] = await Promise.all([
    transaction
      .select()
      .from(tenderContextRequirements)
      .where(
        and(
          eq(tenderContextRequirements.organisationId, scope.organisationId),
          eq(tenderContextRequirements.projectId, context.projectId),
          eq(tenderContextRequirements.tenderContextVersionId, context.id),
        ),
      )
      .limit(TENDER_CONTEXT_BOUNDS.requirementsPerContext + 1),
    transaction
      .select()
      .from(tenderContextArtifacts)
      .where(
        and(
          eq(tenderContextArtifacts.organisationId, scope.organisationId),
          eq(tenderContextArtifacts.projectId, context.projectId),
          eq(tenderContextArtifacts.tenderContextVersionId, context.id),
        ),
      )
      .limit(TENDER_CONTEXT_BOUNDS.artifactsPerContext + 1),
  ]);
  if (
    requirementRows.length !== snapshot.requirements.length ||
    artifactRows.length !== snapshot.artifacts.length
  ) {
    throw new TenderContextPersistenceConflict("invalid_snapshot");
  }
  const requirementById = new Map(requirementRows.map((row) => [row.id, row]));
  for (const item of snapshot.requirements) {
    const row = requirementById.get(item.bindingId);
    if (
      !row ||
      row.requirementId !== item.requirementId ||
      row.requirementCitationId !== item.requirementCitationId ||
      row.evidenceKind !== item.evidenceKind ||
      row.mandatory !== item.mandatory ||
      row.requiresCurrentOnSubmissionDate !==
        item.requiresCurrentOnSubmissionDate ||
      row.requiresExactLegalEntityMatch !==
        item.requiresExactLegalEntityMatch ||
      row.bindingSha256 !== tenderSha256(tenderCanonicalJson(item))
    ) {
      throw new TenderContextPersistenceConflict("invalid_snapshot");
    }
  }
  const artifactById = new Map(artifactRows.map((row) => [row.id, row]));
  for (const item of snapshot.artifacts) {
    const row = artifactById.get(item.bindingId);
    if (
      !row ||
      row.vaultItemVersionId !== item.vaultItemVersionId ||
      row.documentVersionId !== item.documentVersionId ||
      row.evidenceKind !== item.evidenceKind ||
      row.legalEntityName !== item.legalEntityName ||
      row.citationStartOffset !== item.citation.startOffset ||
      row.citationEndOffset !== item.citation.endOffset ||
      row.citationQuote !== item.citation.quote ||
      row.citationQuoteSha256 !== sha256Text(item.citation.quote) ||
      row.bindingSha256 !== tenderSha256(tenderCanonicalJson(item))
    ) {
      throw new TenderContextPersistenceConflict("invalid_snapshot");
    }
  }
}

async function sourcesFromManifest(
  transaction: Transaction,
  scope: TenderContextScope,
  projectId: string,
  manifest: TenderSourceManifest,
): Promise<ResolvedTenderSource[]> {
  const rows = await transaction
    .select({
      document: documents,
      documentVersion: documentVersions,
      snapshot: documentVersionSnapshots,
    })
    .from(documentVersions)
    .innerJoin(documents, eq(documents.id, documentVersions.documentId))
    .innerJoin(
      documentVersionSnapshots,
      eq(documentVersionSnapshots.documentVersionId, documentVersions.id),
    )
    .where(
      and(
        inArray(
          documentVersions.id,
          manifest.sources.map(({ versionId }) => versionId),
        ),
        eq(documentVersions.organisationId, scope.organisationId),
        eq(documents.organisationId, scope.organisationId),
        eq(documentVersionSnapshots.organisationId, scope.organisationId),
      ),
    )
    .limit(manifest.sources.length + 1)
    .for("share");
  if (rows.length !== manifest.sources.length) {
    throw new TenderContextPersistenceConflict("invalid_snapshot");
  }
  const byVersion = new Map(rows.map((row) => [row.documentVersion.id, row]));
  return manifest.sources.map((entry) => {
    const row = byVersion.get(entry.versionId);
    if (
      !row ||
      row.document.id !== entry.sourceId ||
      row.documentVersion.sha256 !== entry.documentVersionSha256 ||
      row.snapshot.documentVersionSha256 !== entry.documentVersionSha256 ||
      (entry.kind !== "company_evidence" &&
        row.document.projectId !== projectId)
    ) {
      throw new TenderContextPersistenceConflict("invalid_snapshot");
    }
    const source = sourceDocument(row, entry.kind, entry.authority);
    if (
      source.contentSha256 !== entry.contentSha256 ||
      source.capturedAt !== entry.capturedAt ||
      entry.origin !== `document:${row.document.id}`
    ) {
      throw new TenderContextPersistenceConflict("invalid_snapshot");
    }
    return { ...source, title: entry.title, origin: entry.origin };
  });
}

async function revalidateCurrentArtifactAuthority(
  transaction: Transaction,
  scope: TenderContextScope,
  project: typeof projects.$inferSelect,
  snapshot: TenderContextSnapshot,
): Promise<void> {
  if (snapshot.artifacts.length === 0) return;
  const rows = await transaction
    .select({
      item: vaultItems,
      itemVersion: vaultItemVersions,
      document: documents,
      documentVersion: documentVersions,
      snapshot: documentVersionSnapshots,
    })
    .from(vaultItemVersions)
    .innerJoin(vaultItems, eq(vaultItems.id, vaultItemVersions.vaultItemId))
    .innerJoin(
      documentVersions,
      eq(documentVersions.id, vaultItemVersions.documentVersionId),
    )
    .innerJoin(documents, eq(documents.id, documentVersions.documentId))
    .innerJoin(
      documentVersionSnapshots,
      eq(documentVersionSnapshots.documentVersionId, documentVersions.id),
    )
    .where(
      and(
        inArray(
          vaultItemVersions.id,
          snapshot.artifacts.map(
            ({ vaultItemVersionId }) => vaultItemVersionId,
          ),
        ),
        eq(vaultItemVersions.organisationId, scope.organisationId),
      ),
    )
    .limit(snapshot.artifacts.length + 1)
    .for("share");
  if (rows.length !== snapshot.artifacts.length) {
    throw new TenderContextPersistenceConflict("state_conflict");
  }
  const approverIds = rows
    .map(({ itemVersion }) => itemVersion.approvedByUserId)
    .filter((id): id is string => Boolean(id));
  const approvers =
    approverIds.length > 0
      ? await transaction
          .select({ id: users.id, name: users.name, status: users.status })
          .from(users)
          .where(inArray(users.id, approverIds))
          .limit(approverIds.length + 1)
          .for("share")
      : [];
  const approverById = new Map(approvers.map((user) => [user.id, user]));
  const rowById = new Map(rows.map((row) => [row.itemVersion.id, row]));
  for (const accepted of snapshot.artifacts) {
    const row = rowById.get(accepted.vaultItemVersionId);
    const reviewerId = accepted.review.reviewerId;
    const reviewedAt = accepted.review.reviewedAt;
    if (!row || !reviewerId || !reviewedAt) {
      throw new TenderContextPersistenceConflict("state_conflict");
    }
    const approver = row.itemVersion.approvedByUserId
      ? approverById.get(row.itemVersion.approvedByUserId)
      : undefined;
    const issuer = (
      row.itemVersion.issuingAuthority ?? row.item.issuer
    )?.trim();
    if (
      !issuer ||
      !currentArtifactAuthorityMatches(
        {
          vaultItemVersionId: accepted.vaultItemVersionId,
          documentVersionId: accepted.documentVersionId,
          documentVersionSha256: accepted.documentVersionSha256,
          label: accepted.label,
          issuer: accepted.issuer,
          validFrom: accepted.validFrom,
          validUntil: accepted.validUntil,
          reviewerId,
          reviewedAt,
        },
        {
          vaultItemVersionId: row.itemVersion.id,
          vaultItemOrganisationId: row.item.organisationId,
          versionOrganisationId: row.itemVersion.organisationId,
          expectedOrganisationId: scope.organisationId,
          clientId: row.item.clientId,
          expectedClientId: project.clientId,
          itemStatus: row.item.status,
          sourceDocumentId: row.item.sourceDocumentId,
          documentId: row.document.id,
          versionDocumentId: row.documentVersion.documentId,
          documentVersionId: row.documentVersion.id,
          documentVersionSha256: row.documentVersion.sha256,
          snapshotDocumentVersionSha256: row.snapshot.documentVersionSha256,
          verificationState: row.itemVersion.verificationState,
          withdrawnAt: row.itemVersion.withdrawnAt,
          approvedByUserId: row.itemVersion.approvedByUserId,
          approvedAt: row.itemVersion.approvedAt,
          approverStatus: approver?.status ?? null,
          approverName: approver?.name ?? null,
          label: row.item.artefactType,
          issuer,
          validFrom: dateOnly(row.itemVersion.issueDate),
          validUntil: dateOnly(row.itemVersion.expiryDate),
        },
      )
    ) {
      throw new TenderContextPersistenceConflict("state_conflict");
    }
    // Also retain the source eligibility boundary at generation time.
    sourceDocument(row, "company_evidence", "corroborating");
  }
}

function evaluatePassportFromAcceptedSnapshot(
  snapshot: TenderContextSnapshot,
  sources: readonly ResolvedTenderSource[],
): EligibilityPassportResult {
  return evaluateEligibilityPassport({
    legalEntityName: snapshot.legalEntityName,
    submissionDate: snapshot.submissionDate,
    sources,
    requirements: snapshot.requirements.map((item) => ({
      externalId: item.requirementId,
      description: item.description,
      evidenceKind: item.evidenceKind,
      mandatory: item.mandatory,
      requiresCurrentOnSubmissionDate: item.requiresCurrentOnSubmissionDate,
      requiresExactLegalEntityMatch: item.requiresExactLegalEntityMatch,
      citations: [item.citation],
      review: item.review,
    })),
    artifacts: snapshot.artifacts.map((item) => ({
      externalId: item.vaultItemVersionId,
      evidenceKind: item.evidenceKind,
      label: item.label,
      issuer: item.issuer,
      ...(item.legalEntityName
        ? { legalEntityName: item.legalEntityName }
        : {}),
      ...(item.validFrom ? { validFrom: item.validFrom } : {}),
      ...(item.validUntil ? { validUntil: item.validUntil } : {}),
      citations: [item.citation],
      review: item.review,
    })),
  });
}

async function validateCurrentRulePack(
  transaction: Transaction,
  context: ContextRow,
  manifest: TenderSourceManifest,
  snapshot: TenderContextSnapshot,
): Promise<void> {
  const current = await loadRulePack(transaction, {
    jurisdictionRulePackId: context.jurisdictionRulePackId,
    jurisdiction: snapshot.jurisdiction,
    entityScopes: snapshot.entityScopes,
    categoryScopes: snapshot.categoryScopes,
  });
  const recorded = manifest.jurisdictionRulePack;
  const advisories = evaluateJurisdictionRules([...current.rules], {
    at: `${snapshot.submissionDate}T00:00:00.000Z`,
    jurisdiction: snapshot.jurisdiction,
    entityScopes: [...snapshot.entityScopes],
    categoryScopes: [...snapshot.categoryScopes],
  }).sort((left, right) => left.ruleId.localeCompare(right.ruleId));
  if (
    current.id !== recorded.id ||
    current.packKey !== recorded.packKey ||
    current.version !== recorded.version ||
    current.sourceManifestHash !== recorded.sourceManifestHash ||
    tenderRulePackMaterialSha256(current.rules) !== recorded.rulesSha256 ||
    tenderCanonicalJson(advisories) !== context.ruleAdvisories ||
    tenderCanonicalJson(advisories) !==
      tenderCanonicalJson(snapshot.ruleAdvisories)
  ) {
    throw new TenderContextPersistenceConflict("state_conflict");
  }
}

async function validateStoredContextForAcceptance(
  transaction: Transaction,
  scope: TenderContextScope,
  project: typeof projects.$inferSelect,
  context: ContextRow,
): Promise<{
  manifest: TenderSourceManifest;
  snapshot: TenderContextSnapshot;
  sources: ResolvedTenderSource[];
}> {
  // contextRecord performs the complete immutable row/snapshot/hash binding check.
  contextRecord(context);
  const manifest = parseManifest(context.sourceManifest);
  const snapshot = parseContextSnapshot(context.contextSnapshot);
  if (
    !manifest ||
    !snapshot ||
    snapshot.sourceManifestSha256 !== context.sourceManifestSha256
  ) {
    throw new TenderContextPersistenceConflict("invalid_snapshot");
  }
  await validateCurrentRulePack(transaction, context, manifest, snapshot);
  await verifyBindings(transaction, scope, context, snapshot);
  await revalidateCurrentArtifactAuthority(
    transaction,
    scope,
    project,
    snapshot,
  );
  const sources = await sourcesFromManifest(
    transaction,
    scope,
    project.id,
    manifest,
  );
  return { manifest, snapshot, sources };
}

function writeResult<T>(
  error: unknown,
): TenderContextWriteResult<T> | undefined {
  if (!(error instanceof TenderContextPersistenceConflict)) return undefined;
  if (error.reason === "invalid_snapshot") {
    throw new TenderContextRepositoryUnavailableError();
  }
  return { outcome: error.reason };
}

export class DrizzleTenderContextRepository implements TenderContextRepository {
  constructor(
    private readonly database: Database = db,
    private readonly auditWriter: typeof writeAuditTx = writeAuditTx,
  ) {}

  async readCentre(
    scope: TenderContextScope,
    projectId: string,
  ): Promise<TenderContextCentre | null> {
    try {
      return await withTenantDatabase(scope.organisationId, () =>
        this.database.transaction((transaction) =>
          readCentreTx(transaction, scope, projectId),
        ),
      );
    } catch (error) {
      if (error instanceof TenderContextPersistenceConflict) {
        throw new TenderContextRepositoryUnavailableError();
      }
      throw error;
    }
  }

  async createContext(
    scope: TenderContextScope,
    projectId: string,
    draft: TenderContextVersionDraft,
    now: Date,
  ): Promise<TenderContextWriteResult<TenderContextVersionRecord>> {
    try {
      return await withTenantDatabase(scope.organisationId, () =>
        this.database.transaction(
          async (transaction) => {
            await configureMutation(transaction, scope, projectId);
            const actor = await requireCurrentWriteAuthority(
              transaction,
              scope,
              PROPOSE_PERMISSIONS,
            );
            const project = await lockedProject(transaction, scope, projectId);
            const rows = await transaction
              .select({
                id: tenderContextVersions.id,
                versionNumber: tenderContextVersions.versionNumber,
              })
              .from(tenderContextVersions)
              .where(
                and(
                  eq(
                    tenderContextVersions.organisationId,
                    scope.organisationId,
                  ),
                  eq(tenderContextVersions.projectId, projectId),
                ),
              )
              .orderBy(desc(tenderContextVersions.versionNumber))
              .limit(TENDER_CONTEXT_BOUNDS.contextVersionsPerProject + 1);
            if (
              rows.length >= TENDER_CONTEXT_BOUNDS.contextVersionsPerProject
            ) {
              throw new TenderContextPersistenceConflict("conflict");
            }
            const material = await resolveContextMaterial(
              transaction,
              scope,
              project,
              draft,
            );
            const built = buildTenderContext(material);
            const serializedRuleAdvisories = tenderCanonicalJson(
              built.ruleAdvisories,
            );
            if (
              !serializedTenderValueWithinBound(
                built.sourceManifest,
                TENDER_CONTEXT_BOUNDS.sourceManifestCodeUnits,
                TENDER_CONTEXT_BOUNDS.sourceManifestBytes,
              ) ||
              !serializedTenderValueWithinBound(
                built.contextSnapshot,
                TENDER_CONTEXT_BOUNDS.contextSnapshotCodeUnits,
                TENDER_CONTEXT_BOUNDS.contextSnapshotBytes,
              ) ||
              !serializedTenderValueWithinBound(
                serializedRuleAdvisories,
                TENDER_CONTEXT_BOUNDS.ruleAdvisoriesCodeUnits,
                TENDER_CONTEXT_BOUNDS.ruleAdvisoriesBytes,
              )
            ) {
              throw new TenderContextPersistenceConflict("conflict");
            }
            const existing = await transaction
              .select({ id: tenderContextVersions.id })
              .from(tenderContextVersions)
              .where(
                and(
                  eq(
                    tenderContextVersions.organisationId,
                    scope.organisationId,
                  ),
                  eq(tenderContextVersions.projectId, projectId),
                  eq(tenderContextVersions.contextSha256, built.contextSha256),
                ),
              )
              .limit(1);
            if (existing.length > 0) {
              throw new TenderContextPersistenceConflict("conflict");
            }
            const contextId = randomUUID();
            const versionNumber = (rows[0]?.versionNumber ?? 0) + 1;
            await transaction.insert(tenderContextVersions).values({
              id: contextId,
              organisationId: scope.organisationId,
              projectId,
              versionNumber,
              supersedesContextVersionId: rows[0]?.id ?? null,
              primaryDocumentVersionId: material.primaryDocumentVersionId,
              jurisdictionRulePackId: material.rulePack.id,
              legalEntityName: draft.legalEntityName,
              submissionDate: draft.submissionDate,
              jurisdiction: draft.jurisdiction,
              entityScopes: tenderCanonicalJson(draft.entityScopes),
              categoryScopes: tenderCanonicalJson(draft.categoryScopes),
              sourceManifest: built.sourceManifest,
              sourceManifestSha256: built.sourceManifestSha256,
              contextSnapshot: built.contextSnapshot,
              contextSha256: built.contextSha256,
              ruleAdvisories: serializedRuleAdvisories,
              status: "pending_review",
              createdByUserId: actor.id,
              createdAt: now,
              updatedAt: now,
            });
            const snapshot = parseContextSnapshot(built.contextSnapshot);
            if (!snapshot) {
              throw new TenderContextPersistenceConflict("invalid_snapshot");
            }
            await transaction.insert(tenderContextRequirements).values(
              snapshot.requirements.map((item) => ({
                id: item.bindingId,
                organisationId: scope.organisationId,
                projectId,
                tenderContextVersionId: contextId,
                requirementId: item.requirementId,
                requirementCitationId: item.requirementCitationId,
                evidenceKind: item.evidenceKind,
                mandatory: item.mandatory,
                requiresCurrentOnSubmissionDate:
                  item.requiresCurrentOnSubmissionDate,
                requiresExactLegalEntityMatch:
                  item.requiresExactLegalEntityMatch,
                bindingSha256: tenderSha256(tenderCanonicalJson(item)),
                createdAt: now,
              })),
            );
            if (snapshot.artifacts.length > 0) {
              await transaction.insert(tenderContextArtifacts).values(
                snapshot.artifacts.map((item) => ({
                  id: item.bindingId,
                  organisationId: scope.organisationId,
                  projectId,
                  tenderContextVersionId: contextId,
                  vaultItemVersionId: item.vaultItemVersionId,
                  documentVersionId: item.documentVersionId,
                  evidenceKind: item.evidenceKind,
                  legalEntityName: item.legalEntityName,
                  citationStartOffset: item.citation.startOffset,
                  citationEndOffset: item.citation.endOffset,
                  citationQuote: item.citation.quote,
                  citationQuoteSha256: sha256Text(item.citation.quote),
                  bindingSha256: tenderSha256(tenderCanonicalJson(item)),
                  createdAt: now,
                })),
              );
            }
            await this.auditWriter(transaction, {
              user: actor,
              organisationId: scope.organisationId,
              projectId,
              eventType: "tender_context.created",
              objectType: "tender_context_version",
              objectId: contextId,
              details: tenderCanonicalJson({
                policyVersion: TENDER_CONTEXT_POLICY_VERSION,
                versionNumber,
                sourceManifestSha256: built.sourceManifestSha256,
                contextSha256: built.contextSha256,
                status: "pending_review",
              }),
              createdAt: now,
            });
            return {
              outcome: "created" as const,
              value: await exactContextRecord(
                transaction,
                scope,
                projectId,
                contextId,
              ),
            };
          },
          { isolationLevel: "read committed" },
        ),
      );
    } catch (error) {
      const mapped = writeResult<TenderContextVersionRecord>(error);
      if (mapped) return mapped;
      throw error;
    }
  }

  async reviewContext(
    scope: TenderContextScope,
    projectId: string,
    contextVersionId: string,
    expectedVersion: number,
    draft: TenderReviewDraft,
    now: Date,
  ): Promise<TenderContextWriteResult<TenderContextVersionRecord>> {
    try {
      return await withTenantDatabase(scope.organisationId, () =>
        this.database.transaction(
          async (transaction) => {
            await configureMutation(transaction, scope, projectId);
            const actor = await requireCurrentWriteAuthority(
              transaction,
              scope,
              REVIEW_PERMISSIONS,
            );
            const project = await lockedProject(transaction, scope, projectId);
            const [current] = await transaction
              .select()
              .from(tenderContextVersions)
              .where(
                and(
                  eq(tenderContextVersions.id, contextVersionId),
                  eq(
                    tenderContextVersions.organisationId,
                    scope.organisationId,
                  ),
                  eq(tenderContextVersions.projectId, projectId),
                ),
              )
              .limit(1)
              .for("update");
            if (!current)
              throw new TenderContextPersistenceConflict("not_found");
            if (current.version !== expectedVersion) {
              throw new TenderContextPersistenceConflict("version_conflict");
            }
            if (current.status !== "pending_review") {
              throw new TenderContextPersistenceConflict("state_conflict");
            }
            if (current.createdByUserId === actor.id) {
              throw new TenderContextPersistenceConflict("state_conflict");
            }
            let acceptedPredecessor: { id: string; version: number } | null =
              null;
            if (draft.decision === "accepted") {
              await validateStoredContextForAcceptance(
                transaction,
                scope,
                project,
                current,
              );
              const acceptedRows = await transaction
                .select({
                  id: tenderContextVersions.id,
                  version: tenderContextVersions.version,
                })
                .from(tenderContextVersions)
                .where(
                  and(
                    eq(
                      tenderContextVersions.organisationId,
                      scope.organisationId,
                    ),
                    eq(tenderContextVersions.projectId, projectId),
                    eq(tenderContextVersions.status, "accepted"),
                    ne(tenderContextVersions.id, contextVersionId),
                  ),
                )
                .orderBy(desc(tenderContextVersions.versionNumber))
                .limit(2)
                .for("update");
              if (acceptedRows.length > 1) {
                throw new TenderContextPersistenceConflict("invalid_snapshot");
              }
              acceptedPredecessor = acceptedRows[0] ?? null;
            }
            const updated = await transaction
              .update(tenderContextVersions)
              .set({
                status: draft.decision,
                reviewedByUserId: actor.id,
                reviewedByName: actor.name,
                reviewedAt: now,
                reviewNote: draft.note,
                version: expectedVersion + 1,
                updatedAt: now,
              })
              .where(
                and(
                  eq(tenderContextVersions.id, contextVersionId),
                  eq(
                    tenderContextVersions.organisationId,
                    scope.organisationId,
                  ),
                  eq(tenderContextVersions.projectId, projectId),
                  eq(tenderContextVersions.version, expectedVersion),
                  eq(tenderContextVersions.status, "pending_review"),
                ),
              )
              .returning({ id: tenderContextVersions.id });
            if (updated.length !== 1) {
              throw new TenderContextPersistenceConflict("version_conflict");
            }
            if (acceptedPredecessor) {
              const superseded = await transaction
                .update(tenderContextVersions)
                .set({
                  status: "superseded",
                  version: acceptedPredecessor.version + 1,
                  updatedAt: now,
                })
                .where(
                  and(
                    eq(tenderContextVersions.id, acceptedPredecessor.id),
                    eq(
                      tenderContextVersions.organisationId,
                      scope.organisationId,
                    ),
                    eq(tenderContextVersions.projectId, projectId),
                    eq(tenderContextVersions.status, "accepted"),
                    eq(
                      tenderContextVersions.version,
                      acceptedPredecessor.version,
                    ),
                  ),
                )
                .returning({ id: tenderContextVersions.id });
              if (superseded.length !== 1) {
                throw new TenderContextPersistenceConflict("version_conflict");
              }
              await this.auditWriter(transaction, {
                user: actor,
                organisationId: scope.organisationId,
                projectId,
                eventType: "tender_context.superseded",
                objectType: "tender_context_version",
                objectId: acceptedPredecessor.id,
                details: tenderCanonicalJson({
                  policyVersion: TENDER_CONTEXT_POLICY_VERSION,
                  previousVersion: acceptedPredecessor.version,
                  supersededByContextVersionId: contextVersionId,
                }),
                createdAt: now,
              });
            }
            await this.auditWriter(transaction, {
              user: actor,
              organisationId: scope.organisationId,
              projectId,
              eventType: "tender_context.reviewed",
              objectType: "tender_context_version",
              objectId: contextVersionId,
              details: tenderCanonicalJson({
                policyVersion: TENDER_CONTEXT_POLICY_VERSION,
                decision: draft.decision,
                expectedVersion,
                supersededContextVersionId: acceptedPredecessor?.id ?? null,
                supersededContextVersion: acceptedPredecessor?.version ?? null,
              }),
              createdAt: now,
            });
            return {
              outcome: "updated" as const,
              value: await exactContextRecord(
                transaction,
                scope,
                projectId,
                contextVersionId,
              ),
            };
          },
          { isolationLevel: "read committed" },
        ),
      );
    } catch (error) {
      const mapped = writeResult<TenderContextVersionRecord>(error);
      if (mapped) return mapped;
      throw error;
    }
  }

  async createPassport(
    scope: TenderContextScope,
    projectId: string,
    contextVersionId: string,
    now: Date,
  ): Promise<TenderContextWriteResult<TenderEligibilityPassportRecord>> {
    try {
      return await withTenantDatabase(scope.organisationId, () =>
        this.database.transaction(
          async (transaction) => {
            await configureMutation(transaction, scope, projectId);
            const actor = await requireCurrentWriteAuthority(
              transaction,
              scope,
              PROPOSE_PERMISSIONS,
            );
            const project = await lockedProject(transaction, scope, projectId);
            const [context] = await transaction
              .select()
              .from(tenderContextVersions)
              .where(
                and(
                  eq(tenderContextVersions.id, contextVersionId),
                  eq(
                    tenderContextVersions.organisationId,
                    scope.organisationId,
                  ),
                  eq(tenderContextVersions.projectId, projectId),
                ),
              )
              .limit(1)
              .for("update");
            if (!context)
              throw new TenderContextPersistenceConflict("not_found");
            if (context.status !== "accepted") {
              throw new TenderContextPersistenceConflict("state_conflict");
            }
            const passportCount = await transaction
              .select({ id: tenderEligibilityPassports.id })
              .from(tenderEligibilityPassports)
              .where(
                and(
                  eq(
                    tenderEligibilityPassports.organisationId,
                    scope.organisationId,
                  ),
                  eq(tenderEligibilityPassports.projectId, projectId),
                ),
              )
              .limit(TENDER_CONTEXT_BOUNDS.passportsPerProject + 1);
            if (
              passportCount.length >= TENDER_CONTEXT_BOUNDS.passportsPerProject
            ) {
              throw new TenderContextPersistenceConflict("conflict");
            }
            const { snapshot, sources } =
              await validateStoredContextForAcceptance(
                transaction,
                scope,
                project,
                context,
              );
            const result = evaluatePassportFromAcceptedSnapshot(
              snapshot,
              sources,
            );
            const duplicate = await transaction
              .select({ id: tenderEligibilityPassports.id })
              .from(tenderEligibilityPassports)
              .where(
                and(
                  eq(
                    tenderEligibilityPassports.organisationId,
                    scope.organisationId,
                  ),
                  eq(tenderEligibilityPassports.projectId, projectId),
                  eq(tenderEligibilityPassports.passportId, result.passportId),
                ),
              )
              .limit(1);
            if (duplicate.length > 0) {
              throw new TenderContextPersistenceConflict("conflict");
            }
            const resultSnapshot = buildEligibilityResultSnapshot(
              context.id,
              result,
            );
            if (
              !serializedTenderValueWithinBound(
                resultSnapshot,
                TENDER_CONTEXT_BOUNDS.eligibilityResultCodeUnits,
                TENDER_CONTEXT_BOUNDS.eligibilityResultBytes,
              )
            ) {
              throw new TenderContextPersistenceConflict("conflict");
            }
            const passportRecordId = randomUUID();
            await transaction.insert(tenderEligibilityPassports).values({
              id: passportRecordId,
              organisationId: scope.organisationId,
              projectId,
              tenderContextVersionId: context.id,
              passportId: result.passportId,
              sourceManifestSha256: context.sourceManifestSha256,
              resultSnapshot,
              resultSnapshotSha256: tenderSha256(resultSnapshot),
              resultStatus: publicEligibilityStatus(result),
              reviewState: "pending_review",
              createdByUserId: actor.id,
              createdAt: now,
              updatedAt: now,
            });
            await this.auditWriter(transaction, {
              user: actor,
              organisationId: scope.organisationId,
              projectId,
              eventType: "tender_eligibility_passport.created",
              objectType: "tender_eligibility_passport",
              objectId: passportRecordId,
              details: tenderCanonicalJson({
                policyVersion: TENDER_ELIGIBILITY_POLICY_VERSION,
                tenderContextVersionId: context.id,
                passportId: result.passportId,
                resultStatus: publicEligibilityStatus(result),
              }),
              createdAt: now,
            });
            return {
              outcome: "created" as const,
              value: await exactPassportRecord(
                transaction,
                scope,
                projectId,
                passportRecordId,
              ),
            };
          },
          { isolationLevel: "read committed" },
        ),
      );
    } catch (error) {
      const mapped = writeResult<TenderEligibilityPassportRecord>(error);
      if (mapped) return mapped;
      throw error;
    }
  }

  async reviewPassport(
    scope: TenderContextScope,
    projectId: string,
    passportRecordId: string,
    expectedVersion: number,
    draft: TenderReviewDraft,
    now: Date,
  ): Promise<TenderContextWriteResult<TenderEligibilityPassportRecord>> {
    try {
      return await withTenantDatabase(scope.organisationId, () =>
        this.database.transaction(
          async (transaction) => {
            await configureMutation(transaction, scope, projectId);
            const actor = await requireCurrentWriteAuthority(
              transaction,
              scope,
              REVIEW_PERMISSIONS,
            );
            const project = await lockedProject(transaction, scope, projectId);
            const [current] = await transaction
              .select()
              .from(tenderEligibilityPassports)
              .where(
                and(
                  eq(tenderEligibilityPassports.id, passportRecordId),
                  eq(
                    tenderEligibilityPassports.organisationId,
                    scope.organisationId,
                  ),
                  eq(tenderEligibilityPassports.projectId, projectId),
                ),
              )
              .limit(1)
              .for("update");
            if (!current)
              throw new TenderContextPersistenceConflict("not_found");
            if (current.version !== expectedVersion) {
              throw new TenderContextPersistenceConflict("version_conflict");
            }
            if (
              current.reviewState !== "pending_review" ||
              current.createdByUserId === actor.id ||
              (draft.decision === "accepted" &&
                current.resultStatus !== "ready_for_human_tender_review")
            ) {
              throw new TenderContextPersistenceConflict("state_conflict");
            }
            if (draft.decision === "accepted") {
              const [context] = await transaction
                .select()
                .from(tenderContextVersions)
                .where(
                  and(
                    eq(
                      tenderContextVersions.id,
                      current.tenderContextVersionId,
                    ),
                    eq(
                      tenderContextVersions.organisationId,
                      scope.organisationId,
                    ),
                    eq(tenderContextVersions.projectId, projectId),
                    eq(tenderContextVersions.status, "accepted"),
                  ),
                )
                .limit(1)
                .for("update");
              if (
                !context ||
                current.sourceManifestSha256 !== context.sourceManifestSha256 ||
                tenderSha256(current.resultSnapshot) !==
                  current.resultSnapshotSha256
              ) {
                throw new TenderContextPersistenceConflict("state_conflict");
              }
              const { snapshot, sources } =
                await validateStoredContextForAcceptance(
                  transaction,
                  scope,
                  project,
                  context,
                );
              const recomputed = evaluatePassportFromAcceptedSnapshot(
                snapshot,
                sources,
              );
              const recomputedSnapshot = buildEligibilityResultSnapshot(
                context.id,
                recomputed,
              );
              if (
                current.passportId !== recomputed.passportId ||
                current.resultStatus !== publicEligibilityStatus(recomputed) ||
                current.resultStatus !== "ready_for_human_tender_review" ||
                current.resultSnapshot !== recomputedSnapshot ||
                current.resultSnapshotSha256 !==
                  tenderSha256(recomputedSnapshot)
              ) {
                throw new TenderContextPersistenceConflict("state_conflict");
              }
            }
            const updated = await transaction
              .update(tenderEligibilityPassports)
              .set({
                reviewState: draft.decision,
                reviewedByUserId: actor.id,
                reviewedByName: actor.name,
                reviewedAt: now,
                reviewNote: draft.note,
                version: expectedVersion + 1,
                updatedAt: now,
              })
              .where(
                and(
                  eq(tenderEligibilityPassports.id, passportRecordId),
                  eq(
                    tenderEligibilityPassports.organisationId,
                    scope.organisationId,
                  ),
                  eq(tenderEligibilityPassports.projectId, projectId),
                  eq(tenderEligibilityPassports.version, expectedVersion),
                  eq(tenderEligibilityPassports.reviewState, "pending_review"),
                ),
              )
              .returning({ id: tenderEligibilityPassports.id });
            if (updated.length !== 1) {
              throw new TenderContextPersistenceConflict("version_conflict");
            }
            await this.auditWriter(transaction, {
              user: actor,
              organisationId: scope.organisationId,
              projectId,
              eventType: "tender_eligibility_passport.reviewed",
              objectType: "tender_eligibility_passport",
              objectId: passportRecordId,
              details: tenderCanonicalJson({
                policyVersion: TENDER_ELIGIBILITY_POLICY_VERSION,
                decision: draft.decision,
                expectedVersion,
                authorityNote: TENDER_CONTEXT_AUTHORITY_NOTE,
              }),
              createdAt: now,
            });
            return {
              outcome: "updated" as const,
              value: await exactPassportRecord(
                transaction,
                scope,
                projectId,
                passportRecordId,
              ),
            };
          },
          { isolationLevel: "read committed" },
        ),
      );
    } catch (error) {
      const mapped = writeResult<TenderEligibilityPassportRecord>(error);
      if (mapped) return mapped;
      throw error;
    }
  }
}

export function createDrizzleTenderContextRepository(): TenderContextRepository {
  return new DrizzleTenderContextRepository();
}
