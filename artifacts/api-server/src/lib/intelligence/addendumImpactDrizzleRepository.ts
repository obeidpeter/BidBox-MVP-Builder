import { Buffer } from "node:buffer";
import {
  addendumImpactAssessments,
  addendumImpactItems,
  approvals,
  boqChecks,
  db,
  documentVersions,
  documentVersionSnapshots,
  documents,
  drafts,
  packages,
  projects,
  reports,
  requirementCitations,
  requirements,
  users,
  workTasks,
} from "@workspace/db";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { writeAuditTx } from "../audit";
import {
  validateProjectTransition,
  type ProjectStatus,
} from "../projectWorkflow";
import {
  buildAddendumImpactAssessment,
  type AddendumImpactAssessment,
  type AddendumImpactInput,
  type AddendumImpactTargetInput,
  type AddendumReopeningMutation,
} from "./addendumImpact";
import {
  type AddendumFieldCategory,
  type AddendumFieldInput,
  type AddendumRemovalInput,
} from "./addendumRadar";
import {
  ADDENDUM_IMPACT_BOUNDS,
  ADDENDUM_IMPACT_POLICY_VERSION,
  AddendumImpactRepositoryUnavailableError,
  type AddendumImpactRepository,
  type AddendumImpactRepositorySnapshot,
  type AddendumImpactReviewDecision,
  type AddendumImpactScope,
  type AddendumImpactSelection,
  type ApplyAddendumImpactInput,
  type FindAddendumImpactApplicationReplayInput,
  type RecordAddendumImpactReviewInput,
  type StoredAddendumImpactApplication,
  type StoredAddendumImpactReview,
} from "./addendumImpactContracts";
import {
  isIsoInstant,
  isValidId,
  sha256Text,
  type SourceDocument,
} from "./domain";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256 = /^[a-f0-9]{64}$/u;
const STRUCTURED_SNAPSHOT_SCHEMA = "valo.addendum-structured-snapshot/v2";
const ASSESSMENT_SNAPSHOT_SCHEMA = "valo.addendum-assessment-record/v1";
const MAX_VERSION_CANDIDATES = 64;
const MAX_ASSESSMENT_HISTORY = 16;
const MAX_PERSISTED_ITEMS = 4_096;

const FIELD_CATEGORIES = new Set<AddendumFieldCategory>([
  "deadline",
  "opening",
  "eligibility",
  "requirement",
  "boq",
  "submission_instruction",
  "contact",
  "other",
]);

type Database = typeof db;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type DatabaseReader = Pick<Database, "select">;

export class AddendumImpactPersistenceConflict extends Error {
  constructor(readonly reason: "stale" | "invalid_snapshot" | "capacity") {
    super(`Addendum impact persistence conflict: ${reason}`);
    this.name = "AddendumImpactPersistenceConflict";
  }
}

interface StructuredField {
  readonly externalId: string;
  readonly category: AddendumFieldCategory;
  readonly value: string;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly page?: number;
  readonly section?: string;
}

interface StructuredSetOperation extends StructuredField {
  readonly operation: "set";
}

interface StructuredRemoveOperation {
  readonly operation: "remove";
  readonly externalId: string;
  readonly category: AddendumFieldCategory;
  readonly instruction: string;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly page?: number;
  readonly section?: string;
}

type StructuredOperation = StructuredSetOperation | StructuredRemoveOperation;

interface StructuredSourceSnapshot {
  readonly schema: typeof STRUCTURED_SNAPSHOT_SCHEMA;
  readonly sourceId: string;
  readonly sourceKind: "solicitation" | "addendum";
  readonly mode: "full" | "delta";
  readonly baseVersionId: string | null;
  readonly authority: "authoritative";
  readonly origin: string;
  readonly fields: readonly StructuredField[];
  readonly operations: readonly StructuredOperation[];
}

interface VersionCandidate {
  readonly documentId: string;
  readonly documentVersionId: string;
  readonly supersedesVersionId: string | null;
  readonly filename: string;
  readonly versionNumber: number;
  readonly bytesSha256: string;
  readonly documentVersionSha256: string;
  readonly malwareStatus: string;
  readonly quarantineStatus: string;
  readonly redactionStatus: string;
  readonly capturedRedactionStatus: string;
  readonly createdAt: Date;
  readonly canonicalText: string;
  readonly canonicalTextSha256: string;
  readonly structuredSnapshot: string;
  readonly structuredSnapshotSha256: string;
  readonly snapshot: StructuredSourceSnapshot;
}

interface ResolvedAddendumVersionChain {
  readonly chain: readonly VersionCandidate[];
  readonly baseline: VersionCandidate;
  readonly revision: VersionCandidate;
  readonly baselineFields: readonly AddendumFieldInput[];
  readonly revisionFields: readonly AddendumFieldInput[];
  readonly removals: readonly AddendumRemovalInput[];
}

interface CurrentAddendumImpactPlan {
  readonly project: typeof projects.$inferSelect;
  readonly resolved: ResolvedAddendumVersionChain;
  readonly comparison: AddendumImpactInput;
  readonly assessment: AddendumImpactAssessment;
}

interface StoredAssessmentIdentity {
  readonly assessmentId: string;
  readonly radarId: string;
  readonly sourceManifestSha256: string;
  readonly impactManifestSha256: string;
  readonly changeCount: number;
  readonly impactCount: number;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function parseStructuredField(
  value: unknown,
  canonicalText: string,
): StructuredField | null {
  if (!record(value)) return null;
  if (
    !exactKeys(value, [
      "externalId",
      "category",
      "value",
      "startOffset",
      "endOffset",
      "page",
      "section",
    ]) ||
    typeof value.externalId !== "string" ||
    !isValidId(value.externalId) ||
    typeof value.category !== "string" ||
    !FIELD_CATEGORIES.has(value.category as AddendumFieldCategory) ||
    typeof value.value !== "string" ||
    value.value.length === 0 ||
    value.value.length > 20_000 ||
    !Number.isSafeInteger(value.startOffset) ||
    !Number.isSafeInteger(value.endOffset) ||
    (value.startOffset as number) < 0 ||
    (value.endOffset as number) <= (value.startOffset as number) ||
    (value.endOffset as number) > canonicalText.length ||
    canonicalText.slice(
      value.startOffset as number,
      value.endOffset as number,
    ) !== value.value ||
    (value.page !== undefined &&
      (!Number.isSafeInteger(value.page) || (value.page as number) < 1)) ||
    (value.section !== undefined &&
      (typeof value.section !== "string" || value.section.length > 2_000))
  ) {
    return null;
  }
  return {
    externalId: value.externalId,
    category: value.category as AddendumFieldCategory,
    value: value.value,
    startOffset: value.startOffset as number,
    endOffset: value.endOffset as number,
    ...(typeof value.page === "number" ? { page: value.page } : {}),
    ...(typeof value.section === "string" ? { section: value.section } : {}),
  };
}

function parseStructuredOperation(
  value: unknown,
  canonicalText: string,
): StructuredOperation | null {
  if (
    !record(value) ||
    (value.operation !== "set" && value.operation !== "remove")
  ) {
    return null;
  }
  if (value.operation === "set") {
    if (
      !exactKeys(value, [
        "operation",
        "externalId",
        "category",
        "value",
        "startOffset",
        "endOffset",
        "page",
        "section",
      ])
    ) {
      return null;
    }
    const field = parseStructuredField(
      {
        externalId: value.externalId,
        category: value.category,
        value: value.value,
        startOffset: value.startOffset,
        endOffset: value.endOffset,
        ...(value.page !== undefined ? { page: value.page } : {}),
        ...(value.section !== undefined ? { section: value.section } : {}),
      },
      canonicalText,
    );
    return field ? { operation: "set", ...field } : null;
  }
  if (
    !exactKeys(value, [
      "operation",
      "externalId",
      "category",
      "instruction",
      "startOffset",
      "endOffset",
      "page",
      "section",
    ]) ||
    typeof value.externalId !== "string" ||
    !isValidId(value.externalId) ||
    typeof value.category !== "string" ||
    !FIELD_CATEGORIES.has(value.category as AddendumFieldCategory) ||
    typeof value.instruction !== "string" ||
    value.instruction.length === 0 ||
    value.instruction.length > 20_000 ||
    !Number.isSafeInteger(value.startOffset) ||
    !Number.isSafeInteger(value.endOffset) ||
    (value.startOffset as number) < 0 ||
    (value.endOffset as number) <= (value.startOffset as number) ||
    (value.endOffset as number) > canonicalText.length ||
    canonicalText.slice(
      value.startOffset as number,
      value.endOffset as number,
    ) !== value.instruction ||
    (value.page !== undefined &&
      (!Number.isSafeInteger(value.page) || (value.page as number) < 1)) ||
    (value.section !== undefined &&
      (typeof value.section !== "string" || value.section.length > 2_000))
  ) {
    return null;
  }
  return {
    operation: "remove",
    externalId: value.externalId,
    category: value.category as AddendumFieldCategory,
    instruction: value.instruction,
    startOffset: value.startOffset as number,
    endOffset: value.endOffset as number,
    ...(typeof value.page === "number" ? { page: value.page } : {}),
    ...(typeof value.section === "string" ? { section: value.section } : {}),
  };
}

/**
 * Parses only the closed, version-bound extraction shape owned by this
 * feature. Mutable document projections and guessed field values are rejected.
 */
export function parseAddendumStructuredSnapshot(
  structuredSnapshot: string,
  canonicalText: string,
): StructuredSourceSnapshot | null {
  if (
    structuredSnapshot.length === 0 ||
    structuredSnapshot.length > 256_000 ||
    canonicalText.length === 0 ||
    canonicalText.length > ADDENDUM_IMPACT_BOUNDS.sourceCodeUnitsPerVersion
  ) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(structuredSnapshot);
  } catch {
    return null;
  }
  if (
    !record(parsed) ||
    !exactKeys(parsed, [
      "schema",
      "sourceId",
      "sourceKind",
      "mode",
      "baseVersionId",
      "authority",
      "origin",
      "fields",
      "operations",
    ]) ||
    parsed.schema !== STRUCTURED_SNAPSHOT_SCHEMA ||
    typeof parsed.sourceId !== "string" ||
    !UUID.test(parsed.sourceId) ||
    (parsed.sourceKind !== "solicitation" &&
      parsed.sourceKind !== "addendum") ||
    (parsed.mode !== "full" && parsed.mode !== "delta") ||
    parsed.authority !== "authoritative" ||
    typeof parsed.origin !== "string" ||
    parsed.origin.trim().length === 0 ||
    parsed.origin.length > 1_000 ||
    !Array.isArray(parsed.fields) ||
    parsed.fields.length > ADDENDUM_IMPACT_BOUNDS.fieldsPerVersion ||
    !Array.isArray(parsed.operations) ||
    parsed.operations.length > ADDENDUM_IMPACT_BOUNDS.fieldsPerVersion
  ) {
    return null;
  }
  if (
    (parsed.sourceKind === "solicitation" &&
      (parsed.mode !== "full" ||
        parsed.baseVersionId !== null ||
        parsed.fields.length === 0 ||
        parsed.operations.length !== 0)) ||
    (parsed.sourceKind === "addendum" &&
      (typeof parsed.baseVersionId !== "string" ||
        !UUID.test(parsed.baseVersionId) ||
        (parsed.mode === "full" &&
          parsed.fields.length === 0 &&
          parsed.operations.length === 0) ||
        (parsed.mode === "delta" &&
          (parsed.fields.length !== 0 || parsed.operations.length === 0))))
  ) {
    return null;
  }
  const fields = parsed.fields.map((value) =>
    parseStructuredField(value, canonicalText),
  );
  const operations = parsed.operations.map((value) =>
    parseStructuredOperation(value, canonicalText),
  );
  if (
    fields.some((field) => field === null) ||
    operations.some((operation) => operation === null) ||
    new Set(fields.map((field) => field?.externalId)).size !== fields.length ||
    new Set(operations.map((operation) => operation?.externalId)).size !==
      operations.length ||
    (parsed.mode === "full" &&
      operations.some((operation) => operation?.operation !== "remove")) ||
    (parsed.mode === "full" &&
      operations.some((operation) =>
        fields.some((field) => field?.externalId === operation?.externalId),
      ))
  ) {
    return null;
  }
  return {
    schema: STRUCTURED_SNAPSHOT_SCHEMA,
    sourceId: parsed.sourceId,
    sourceKind: parsed.sourceKind,
    mode: parsed.mode,
    baseVersionId:
      typeof parsed.baseVersionId === "string" ? parsed.baseVersionId : null,
    authority: "authoritative",
    origin: parsed.origin,
    fields: fields as StructuredField[],
    operations: operations as StructuredOperation[],
  };
}

function toSourceDocument(candidate: VersionCandidate): SourceDocument {
  return {
    sourceId: candidate.snapshot.sourceId,
    versionId: candidate.documentVersionId,
    kind: candidate.snapshot.sourceKind,
    title: candidate.filename,
    content: candidate.canonicalText,
    contentSha256: candidate.canonicalTextSha256,
    capturedAt: candidate.createdAt.toISOString(),
    authority: candidate.snapshot.authority,
    origin: candidate.snapshot.origin,
  };
}

function toField(
  candidate: VersionCandidate,
  field: StructuredField,
): AddendumFieldInput {
  return {
    externalId: field.externalId,
    category: field.category,
    value: field.value,
    citation: {
      sourceId: candidate.snapshot.sourceId,
      sourceVersionId: candidate.documentVersionId,
      contentSha256: candidate.canonicalTextSha256,
      startOffset: field.startOffset,
      endOffset: field.endOffset,
      quote: field.value,
      ...(field.page !== undefined ? { page: field.page } : {}),
      ...(field.section !== undefined ? { section: field.section } : {}),
    },
  };
}

function toRemoval(
  candidate: VersionCandidate,
  operation: StructuredRemoveOperation,
): AddendumRemovalInput {
  return {
    externalId: operation.externalId,
    category: operation.category,
    citation: {
      sourceId: candidate.snapshot.sourceId,
      sourceVersionId: candidate.documentVersionId,
      contentSha256: candidate.canonicalTextSha256,
      startOffset: operation.startOffset,
      endOffset: operation.endOffset,
      quote: operation.instruction,
      ...(operation.page !== undefined ? { page: operation.page } : {}),
      ...(operation.section !== undefined
        ? { section: operation.section }
        : {}),
    },
  };
}

function sortedFields(
  state: ReadonlyMap<string, AddendumFieldInput>,
): AddendumFieldInput[] {
  return [...state.values()].sort((left, right) =>
    left.externalId.localeCompare(right.externalId),
  );
}

function candidateIsCurrentlyEligible(candidate: VersionCandidate): boolean {
  return (
    candidate.malwareStatus === "clean" &&
    candidate.quarantineStatus === "cleared" &&
    ["included", "redacted"].includes(candidate.redactionStatus) &&
    candidate.capturedRedactionStatus === candidate.redactionStatus
  );
}

function applySnapshotToEffectiveState(
  candidate: VersionCandidate,
  previous: ReadonlyMap<string, AddendumFieldInput>,
): {
  readonly state: ReadonlyMap<string, AddendumFieldInput>;
  readonly removals: readonly AddendumRemovalInput[];
} {
  const snapshot = candidate.snapshot;
  if (snapshot.sourceKind !== "addendum") {
    throw new AddendumImpactPersistenceConflict("invalid_snapshot");
  }
  const removalOperations = snapshot.operations.filter(
    (operation): operation is StructuredRemoveOperation =>
      operation.operation === "remove",
  );
  if (snapshot.mode === "full") {
    const next = new Map(
      snapshot.fields.map((field) => [
        field.externalId,
        toField(candidate, field),
      ]),
    );
    const removalById = new Map(
      removalOperations.map((operation) => [operation.externalId, operation]),
    );
    for (const [externalId, prior] of previous) {
      const current = next.get(externalId);
      if (current && current.category !== prior.category) {
        throw new AddendumImpactPersistenceConflict("invalid_snapshot");
      }
      if (!current) {
        const removal = removalById.get(externalId);
        if (!removal || removal.category !== prior.category) {
          throw new AddendumImpactPersistenceConflict("invalid_snapshot");
        }
      }
    }
    for (const removal of removalOperations) {
      const prior = previous.get(removal.externalId);
      if (
        !prior ||
        prior.category !== removal.category ||
        next.has(removal.externalId)
      ) {
        throw new AddendumImpactPersistenceConflict("invalid_snapshot");
      }
    }
    return {
      state: next,
      removals: removalOperations.map((operation) =>
        toRemoval(candidate, operation),
      ),
    };
  }

  const next = new Map(previous);
  const removals: AddendumRemovalInput[] = [];
  for (const operation of snapshot.operations) {
    const prior = previous.get(operation.externalId);
    if (operation.operation === "set") {
      if (prior && prior.category !== operation.category) {
        throw new AddendumImpactPersistenceConflict("invalid_snapshot");
      }
      next.set(operation.externalId, toField(candidate, operation));
      continue;
    }
    if (!prior || prior.category !== operation.category) {
      throw new AddendumImpactPersistenceConflict("invalid_snapshot");
    }
    next.delete(operation.externalId);
    removals.push(toRemoval(candidate, operation));
  }
  if (next.size > ADDENDUM_IMPACT_BOUNDS.fieldsPerVersion) {
    throw new AddendumImpactPersistenceConflict("capacity");
  }
  return { state: next, removals };
}

export function resolveAddendumVersionChain(
  candidates: readonly VersionCandidate[],
  selection: AddendumImpactSelection,
): ResolvedAddendumVersionChain | null {
  const byVersionId = new Map(
    candidates.map((candidate) => [candidate.documentVersionId, candidate]),
  );
  if (byVersionId.size !== candidates.length) {
    throw new AddendumImpactPersistenceConflict("invalid_snapshot");
  }
  const requestedRevision = selection.revisionVersionId
    ? byVersionId.get(selection.revisionVersionId)
    : undefined;
  if (selection.revisionVersionId && !requestedRevision) {
    return null;
  }
  const revision =
    requestedRevision ??
    [...candidates]
      .filter(({ snapshot }) => snapshot.sourceKind === "addendum")
      .sort(
        (left, right) =>
          right.createdAt.getTime() - left.createdAt.getTime() ||
          right.documentVersionId.localeCompare(left.documentVersionId),
      )[0];
  if (!revision || revision.snapshot.sourceKind !== "addendum") return null;

  const sameSeries = candidates.filter(
    ({ snapshot }) => snapshot.sourceId === revision.snapshot.sourceId,
  );
  const timestamps = new Set<number>();
  for (const candidate of sameSeries) {
    const timestamp = candidate.createdAt.getTime();
    if (
      !Number.isFinite(timestamp) ||
      timestamps.has(timestamp) ||
      candidate.snapshot.origin !==
        `document:${candidate.documentId}:version:${candidate.documentVersionId}` ||
      (candidate.snapshot.sourceKind === "solicitation" &&
        (candidate.snapshot.sourceId !== candidate.documentId ||
          candidate.supersedesVersionId !== null)) ||
      (candidate.snapshot.sourceKind === "addendum" &&
        candidate.supersedesVersionId !== null &&
        candidate.supersedesVersionId !== candidate.snapshot.baseVersionId)
    ) {
      throw new AddendumImpactPersistenceConflict("invalid_snapshot");
    }
    timestamps.add(timestamp);
  }

  const reversed: VersionCandidate[] = [];
  const visited = new Set<string>();
  let cursor: VersionCandidate | undefined = revision;
  while (cursor) {
    if (
      visited.has(cursor.documentVersionId) ||
      !candidateIsCurrentlyEligible(cursor)
    ) {
      throw new AddendumImpactPersistenceConflict("invalid_snapshot");
    }
    visited.add(cursor.documentVersionId);
    reversed.push(cursor);
    if (cursor.snapshot.sourceKind === "solicitation") break;
    const baseVersionId: string | null = cursor.snapshot.baseVersionId;
    const predecessor: VersionCandidate | undefined = baseVersionId
      ? byVersionId.get(baseVersionId)
      : undefined;
    const cursorCreatedAt = cursor.createdAt.getTime();
    const latestOlder = sameSeries
      .filter((candidate) => candidate.createdAt.getTime() < cursorCreatedAt)
      .sort(
        (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
      )[0];
    if (
      !predecessor ||
      latestOlder?.documentVersionId !== baseVersionId ||
      predecessor.snapshot.sourceId !== revision.snapshot.sourceId ||
      predecessor.createdAt.getTime() >= cursorCreatedAt
    ) {
      throw new AddendumImpactPersistenceConflict("invalid_snapshot");
    }
    cursor = predecessor;
  }
  const chain = reversed.reverse();
  const root = chain[0];
  const baseline = chain.at(-2);
  if (
    !root ||
    !baseline ||
    root.snapshot.sourceKind !== "solicitation" ||
    root.snapshot.sourceId !== root.documentId ||
    root.snapshot.mode !== "full" ||
    root.snapshot.baseVersionId !== null ||
    root.supersedesVersionId !== null ||
    sameSeries.some(
      (candidate) =>
        candidate.documentVersionId !== root.documentVersionId &&
        candidate.createdAt.getTime() < root.createdAt.getTime(),
    ) ||
    chain.some(
      (candidate, index) =>
        candidate.snapshot.sourceId !== revision.snapshot.sourceId ||
        (index > 0 && candidate.snapshot.sourceKind !== "addendum"),
    ) ||
    (selection.baselineVersionId !== undefined &&
      baseline.documentVersionId !== selection.baselineVersionId)
  ) {
    return null;
  }

  let state = new Map(
    root.snapshot.fields.map((field) => [
      field.externalId,
      toField(root, field),
    ]),
  );
  let baselineFields: readonly AddendumFieldInput[] = [];
  let revisionFields: readonly AddendumFieldInput[] = [];
  let removals: readonly AddendumRemovalInput[] = [];
  for (let index = 1; index < chain.length; index += 1) {
    const candidate = chain[index]!;
    const before = sortedFields(state);
    const applied = applySnapshotToEffectiveState(candidate, state);
    if (index === chain.length - 1) {
      baselineFields = before;
      revisionFields = sortedFields(applied.state);
      removals = applied.removals;
    }
    state = new Map(applied.state);
  }
  return {
    chain,
    baseline,
    revision,
    baselineFields,
    revisionFields,
    removals,
  };
}

function decisionFromStored(
  value: string,
): AddendumImpactReviewDecision | null {
  if (value === "accepted" || value === "rejected") return value;
  return value === "needs_changes" ? "changes_requested" : null;
}

function storedIdentity(value: string): StoredAssessmentIdentity | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (
    !record(parsed) ||
    parsed.schema !== ASSESSMENT_SNAPSHOT_SCHEMA ||
    typeof parsed.assessmentId !== "string" ||
    !isValidId(parsed.assessmentId) ||
    typeof parsed.radarId !== "string" ||
    !isValidId(parsed.radarId) ||
    typeof parsed.sourceManifestSha256 !== "string" ||
    !SHA256.test(parsed.sourceManifestSha256) ||
    typeof parsed.impactManifestSha256 !== "string" ||
    !SHA256.test(parsed.impactManifestSha256) ||
    !Number.isSafeInteger(parsed.changeCount) ||
    (parsed.changeCount as number) < 1 ||
    (parsed.changeCount as number) > ADDENDUM_IMPACT_BOUNDS.fieldsPerVersion ||
    !Number.isSafeInteger(parsed.impactCount) ||
    (parsed.impactCount as number) < 0 ||
    (parsed.impactCount as number) > ADDENDUM_IMPACT_BOUNDS.targets
  ) {
    return null;
  }
  return {
    assessmentId: parsed.assessmentId,
    radarId: parsed.radarId,
    sourceManifestSha256: parsed.sourceManifestSha256,
    impactManifestSha256: parsed.impactManifestSha256,
    changeCount: parsed.changeCount as number,
    impactCount: parsed.impactCount as number,
  };
}

function reviewFromAssessment(
  row: typeof addendumImpactAssessments.$inferSelect,
): StoredAddendumImpactReview | null {
  const decision = decisionFromStored(row.reviewState);
  const identity = storedIdentity(row.assessmentSnapshot);
  if (!decision) return null;
  if (
    !identity ||
    !row.reviewedByUserId ||
    !row.reviewedByName?.trim() ||
    !row.reviewedAt ||
    !row.reviewNote?.trim()
  ) {
    throw new AddendumImpactPersistenceConflict("invalid_snapshot");
  }
  return {
    assessmentId: identity.assessmentId,
    impactManifestSha256: identity.impactManifestSha256,
    decision,
    reason: row.reviewNote,
    reviewerUserId: row.reviewedByUserId,
    reviewerName: row.reviewedByName,
    reviewedAt: row.reviewedAt.toISOString(),
    version: row.version,
  };
}

function applicationFromAssessment(
  row: typeof addendumImpactAssessments.$inferSelect,
): StoredAddendumImpactApplication | null {
  const identity = storedIdentity(row.assessmentSnapshot);
  if (row.appliedState === "not_applied") return null;
  if (
    row.appliedState !== "applied" ||
    !identity ||
    !row.appliedByUserId ||
    !row.appliedByName?.trim() ||
    !row.appliedAt ||
    !row.applyNote?.trim()
  ) {
    throw new AddendumImpactPersistenceConflict("invalid_snapshot");
  }
  return {
    assessmentId: identity.assessmentId,
    impactManifestSha256: identity.impactManifestSha256,
    appliedByUserId: row.appliedByUserId,
    appliedByName: row.appliedByName,
    appliedAt: row.appliedAt.toISOString(),
    reason: row.applyNote,
    mutationCount: identity.impactCount,
  };
}

function fieldDependencies(
  text: string,
  fields: readonly AddendumFieldInput[],
): string[] {
  return fields
    .filter(({ value }) => text.includes(value) || value.includes(text))
    .map(({ externalId }) => externalId)
    .sort();
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function target(value: AddendumImpactTargetInput): AddendumImpactTargetInput {
  return value;
}

function closedProjectStatus(value: string): value is ProjectStatus {
  return [
    "intake",
    "extraction",
    "review",
    "defects",
    "reporting",
    "signed_off",
    "exported",
    "archived",
  ].includes(value);
}

function safeLabel(prefix: string, value: string | null | undefined): string {
  const detail = value?.trim().replace(/\s+/gu, " ") ?? "";
  return detail ? `${prefix}: ${detail.slice(0, 240)}` : prefix;
}

/**
 * Returns true only while a downstream object still needs the addendum action.
 * Keeping this policy beside the reload query prevents a completed application
 * from producing a fresh assessment revision for the same no-op mutations.
 */
export function isPendingAddendumImpactMutationTarget(
  objectType: AddendumImpactTargetInput["objectType"],
  currentState: string,
): boolean {
  if (objectType === "project") {
    return !["intake", "extraction", "review", "archived"].includes(
      currentState,
    );
  }
  if (objectType === "requirement" || objectType === "work_task") {
    return currentState !== "reopened";
  }
  if (objectType === "draft") {
    return !["draft", "reopened"].includes(currentState);
  }
  if (objectType === "boq_check") {
    return currentState !== "review_required";
  }
  if (objectType === "approval") {
    return currentState === "approved";
  }
  if (objectType === "package") {
    return !["draft", "stale", "invalidated"].includes(currentState);
  }
  return currentState === "signed_off";
}

async function loadTargets(
  database: DatabaseReader,
  scope: AddendumImpactScope,
  project: typeof projects.$inferSelect,
  resolved: ResolvedAddendumVersionChain,
  lockRows = false,
): Promise<AddendumImpactTargetInput[]> {
  const { baseline, revision } = resolved;
  const allFields = [...resolved.baselineFields, ...resolved.revisionFields];
  const documentIdByVersionId = new Map(
    resolved.chain.map((candidate) => [
      candidate.documentVersionId,
      candidate.documentId,
    ]),
  );
  const allFieldIds = unique(allFields.map(({ externalId }) => externalId));
  const requirementQuery = database
    .select()
    .from(requirements)
    .where(
      and(
        eq(requirements.organisationId, scope.organisationId),
        eq(requirements.projectId, project.id),
      ),
    )
    .orderBy(requirements.id)
    .limit(ADDENDUM_IMPACT_BOUNDS.targets + 1);
  const citationQuery = database
    .select({
      requirementId: requirementCitations.requirementId,
      documentVersionId: requirementCitations.documentVersionId,
      sourceSnippet: requirementCitations.sourceSnippet,
    })
    .from(requirementCitations)
    .innerJoin(
      requirements,
      eq(requirements.id, requirementCitations.requirementId),
    )
    .where(
      and(
        eq(requirementCitations.organisationId, scope.organisationId),
        eq(requirements.projectId, project.id),
        inArray(requirementCitations.documentVersionId, [
          ...resolved.chain.map(({ documentVersionId }) => documentVersionId),
        ]),
      ),
    )
    .orderBy(requirementCitations.id)
    .limit(ADDENDUM_IMPACT_BOUNDS.targets * 2 + 1);
  const taskQuery = database
    .select()
    .from(workTasks)
    .where(
      and(
        eq(workTasks.organisationId, scope.organisationId),
        eq(workTasks.projectId, project.id),
      ),
    )
    .orderBy(workTasks.id)
    .limit(ADDENDUM_IMPACT_BOUNDS.targets + 1);
  const boqQuery = database
    .select()
    .from(boqChecks)
    .where(
      and(
        eq(boqChecks.organisationId, scope.organisationId),
        eq(boqChecks.projectId, project.id),
        or(
          eq(boqChecks.sourceDocId, baseline.documentId),
          eq(boqChecks.sourceDocId, revision.documentId),
        ),
      ),
    )
    .orderBy(boqChecks.id)
    .limit(ADDENDUM_IMPACT_BOUNDS.targets + 1);
  const draftQuery = database
    .select()
    .from(drafts)
    .where(
      and(
        eq(drafts.organisationId, scope.organisationId),
        eq(drafts.projectId, project.id),
      ),
    )
    .orderBy(drafts.id)
    .limit(ADDENDUM_IMPACT_BOUNDS.targets + 1);
  const approvalQuery = database
    .select()
    .from(approvals)
    .where(
      and(
        eq(approvals.organisationId, scope.organisationId),
        eq(approvals.projectId, project.id),
        eq(approvals.decision, "approved"),
      ),
    )
    .orderBy(approvals.id)
    .limit(ADDENDUM_IMPACT_BOUNDS.targets + 1);
  const packageQuery = database
    .select()
    .from(packages)
    .where(
      and(
        eq(packages.organisationId, scope.organisationId),
        eq(packages.projectId, project.id),
      ),
    )
    .orderBy(packages.id)
    .limit(ADDENDUM_IMPACT_BOUNDS.targets + 1);
  const reportQuery = database
    .select()
    .from(reports)
    .where(
      and(
        eq(reports.organisationId, scope.organisationId),
        eq(reports.projectId, project.id),
        eq(reports.status, "signed_off"),
      ),
    )
    .orderBy(reports.id)
    .limit(ADDENDUM_IMPACT_BOUNDS.targets + 1);
  const loadedRows = lockRows
    ? ([
        await requirementQuery.for("share"),
        await citationQuery.for("share"),
        await taskQuery.for("share"),
        await boqQuery.for("share"),
        await draftQuery.for("share"),
        await approvalQuery.for("share"),
        await packageQuery.for("share"),
        await reportQuery.for("share"),
      ] as const)
    : await Promise.all([
        requirementQuery,
        citationQuery,
        taskQuery,
        boqQuery,
        draftQuery,
        approvalQuery,
        packageQuery,
        reportQuery,
      ]);
  const [
    requirementRows,
    citationRows,
    taskRows,
    boqRows,
    draftRows,
    approvalRows,
    packageRows,
    reportRows,
  ] = loadedRows;

  if (
    [
      requirementRows,
      taskRows,
      boqRows,
      draftRows,
      approvalRows,
      packageRows,
      reportRows,
    ].some((rows) => rows.length > ADDENDUM_IMPACT_BOUNDS.targets) ||
    citationRows.length > ADDENDUM_IMPACT_BOUNDS.targets * 2
  ) {
    throw new AddendumImpactPersistenceConflict("capacity");
  }

  const dependenciesByRequirement = new Map<string, string[]>();
  citationRows.forEach((citation) => {
    const fields = allFields.filter(
      ({ citation: fieldCitation }) =>
        fieldCitation.sourceVersionId === citation.documentVersionId,
    );
    dependenciesByRequirement.set(
      citation.requirementId,
      unique([
        ...(dependenciesByRequirement.get(citation.requirementId) ?? []),
        ...fieldDependencies(citation.sourceSnippet, fields),
      ]),
    );
  });
  requirementRows.forEach((requirement) => {
    const fieldsFromDocument = allFields.filter(
      ({ citation }) =>
        documentIdByVersionId.get(citation.sourceVersionId) ===
        requirement.sourceDocId,
    );
    const fields =
      fieldsFromDocument.length > 0 ? fieldsFromDocument : allFields;
    dependenciesByRequirement.set(
      requirement.id,
      unique([
        ...(dependenciesByRequirement.get(requirement.id) ?? []),
        ...fieldDependencies(requirement.text, fields),
      ]),
    );
  });

  const targets: AddendumImpactTargetInput[] = [];
  if (
    closedProjectStatus(project.status) &&
    isPendingAddendumImpactMutationTarget("project", project.status)
  ) {
    targets.push(
      target({
        externalId: project.id,
        objectType: "project",
        label: "Pursuit lifecycle",
        currentState: project.status,
        currentVersion: project.version,
        dependsOnFieldExternalIds: allFieldIds,
        proposedAction: "reopen",
      }),
    );
  }
  requirementRows.forEach((requirement) => {
    const dependencies = dependenciesByRequirement.get(requirement.id) ?? [];
    if (
      dependencies.length === 0 ||
      !isPendingAddendumImpactMutationTarget(
        "requirement",
        requirement.reviewStatus,
      )
    ) {
      return;
    }
    targets.push(
      target({
        externalId: requirement.id,
        objectType: "requirement",
        label: safeLabel("Requirement", requirement.text),
        currentState: requirement.reviewStatus,
        currentVersion: requirement.version,
        dependsOnFieldExternalIds: dependencies,
        proposedAction: "reopen",
      }),
    );
  });
  taskRows.forEach((task) => {
    if (!task.requirementId) return;
    const dependencies =
      dependenciesByRequirement.get(task.requirementId) ?? [];
    if (
      dependencies.length === 0 ||
      !isPendingAddendumImpactMutationTarget("work_task", task.status)
    ) {
      return;
    }
    targets.push(
      target({
        externalId: task.id,
        objectType: "work_task",
        label: safeLabel("Task", task.title),
        currentState: task.status,
        currentVersion: task.version,
        dependsOnFieldExternalIds: dependencies,
        proposedAction: "reopen",
      }),
    );
  });
  boqRows.forEach((check) => {
    const boqFields = allFields.filter(({ category }) => category === "boq");
    const matched = fieldDependencies(
      [check.lineRef, check.description, check.finding]
        .filter((value): value is string => Boolean(value))
        .join(" "),
      boqFields,
    );
    const dependencies =
      matched.length > 0
        ? matched
        : boqFields.map(({ externalId }) => externalId);
    if (
      dependencies.length === 0 ||
      !isPendingAddendumImpactMutationTarget("boq_check", check.status)
    ) {
      return;
    }
    targets.push(
      target({
        externalId: check.id,
        objectType: "boq_check",
        label: safeLabel("BOQ check", check.description ?? check.lineRef),
        currentState: check.status,
        currentVersion: check.version,
        dependsOnFieldExternalIds: unique(dependencies),
        proposedAction: "recheck",
      }),
    );
  });
  draftRows.forEach((draft) => {
    if (!isPendingAddendumImpactMutationTarget("draft", draft.status)) return;
    targets.push(
      target({
        externalId: draft.id,
        objectType: "draft",
        label: safeLabel("Draft", draft.title),
        currentState: draft.status,
        currentVersion: draft.version,
        dependsOnFieldExternalIds: allFieldIds,
        proposedAction: "reopen",
      }),
    );
  });
  approvalRows.forEach((approval) => {
    if (!isPendingAddendumImpactMutationTarget("approval", approval.decision)) {
      return;
    }
    targets.push(
      target({
        externalId: approval.id,
        objectType: "approval",
        label: safeLabel("Approval", approval.approvalType),
        currentState: approval.decision,
        currentVersion: approval.version,
        dependsOnFieldExternalIds: allFieldIds,
        proposedAction: "invalidate",
      }),
    );
  });
  packageRows.forEach((pack) => {
    if (!isPendingAddendumImpactMutationTarget("package", pack.status)) return;
    targets.push(
      target({
        externalId: pack.id,
        objectType: "package",
        label: safeLabel("Package", pack.packageType),
        currentState: pack.status,
        currentVersion: pack.version,
        dependsOnFieldExternalIds: allFieldIds,
        proposedAction: "invalidate",
      }),
    );
  });
  reportRows.forEach((report) => {
    if (!isPendingAddendumImpactMutationTarget("report", report.status)) {
      return;
    }
    targets.push(
      target({
        externalId: report.id,
        objectType: "report",
        label: `Signed report version ${report.version}`,
        currentState: report.status,
        currentVersion: report.optimisticLockVersion,
        dependsOnFieldExternalIds: allFieldIds,
        proposedAction: "invalidate",
      }),
    );
  });
  if (targets.length > ADDENDUM_IMPACT_BOUNDS.targets) {
    throw new AddendumImpactPersistenceConflict("capacity");
  }
  return targets;
}

async function loadVersionCandidates(
  database: DatabaseReader,
  scope: AddendumImpactScope,
  projectId: string,
  lockRows = false,
): Promise<VersionCandidate[]> {
  const query = database
    .select({
      documentId: documents.id,
      documentVersionId: documentVersions.id,
      supersedesVersionId: documentVersions.supersedesVersionId,
      filename: documents.filename,
      versionNumber: documentVersions.versionNumber,
      bytesSha256: documentVersions.sha256,
      documentVersionSha256: documentVersionSnapshots.documentVersionSha256,
      malwareStatus: documentVersions.malwareStatus,
      quarantineStatus: documentVersions.quarantineStatus,
      redactionStatus: documents.redactionStatus,
      capturedRedactionStatus: documentVersionSnapshots.capturedRedactionStatus,
      createdAt: documentVersions.createdAt,
      canonicalText: documentVersionSnapshots.canonicalText,
      canonicalTextSha256: documentVersionSnapshots.canonicalTextSha256,
      structuredSnapshot: documentVersionSnapshots.structuredSnapshot,
      structuredSnapshotSha256:
        documentVersionSnapshots.structuredSnapshotSha256,
      verifiedByUserId: documentVersionSnapshots.verifiedByUserId,
      verifiedByName: documentVersionSnapshots.verifiedByName,
      verifiedAt: documentVersionSnapshots.verifiedAt,
    })
    .from(documentVersions)
    .innerJoin(documents, eq(documents.id, documentVersions.documentId))
    .innerJoin(
      documentVersionSnapshots,
      eq(documentVersionSnapshots.documentVersionId, documentVersions.id),
    )
    .where(
      and(
        eq(documents.organisationId, scope.organisationId),
        eq(documentVersions.organisationId, scope.organisationId),
        eq(documentVersionSnapshots.organisationId, scope.organisationId),
        eq(documents.projectId, projectId),
        eq(documentVersionSnapshots.status, "verified"),
        sql`${documentVersionSnapshots.structuredSnapshot} IS NOT NULL`,
        sql`${documentVersionSnapshots.structuredSnapshotSha256} IS NOT NULL`,
      ),
    )
    .orderBy(desc(documentVersions.createdAt), desc(documentVersions.id))
    .limit(MAX_VERSION_CANDIDATES + 1);
  const rows = await (lockRows ? query.for("share") : query);
  if (rows.length > MAX_VERSION_CANDIDATES) {
    throw new AddendumImpactPersistenceConflict("capacity");
  }
  return rows.map((row) => {
    if (
      !row.structuredSnapshot ||
      !row.structuredSnapshotSha256 ||
      !UUID.test(row.verifiedByUserId ?? "") ||
      !row.verifiedByName?.trim() ||
      !row.verifiedAt ||
      !Number.isFinite(row.verifiedAt.getTime()) ||
      !SHA256.test(row.bytesSha256) ||
      !SHA256.test(row.documentVersionSha256) ||
      row.documentVersionSha256 !== row.bytesSha256 ||
      !["included", "redacted"].includes(row.capturedRedactionStatus) ||
      !SHA256.test(row.canonicalTextSha256) ||
      !SHA256.test(row.structuredSnapshotSha256) ||
      row.canonicalText.length >
        ADDENDUM_IMPACT_BOUNDS.sourceCodeUnitsPerVersion ||
      Buffer.byteLength(row.canonicalText, "utf8") >
        ADDENDUM_IMPACT_BOUNDS.sourceBytesPerVersion ||
      sha256Text(row.canonicalText) !== row.canonicalTextSha256 ||
      sha256Text(row.structuredSnapshot) !== row.structuredSnapshotSha256 ||
      !Number.isSafeInteger(row.versionNumber) ||
      row.versionNumber < 1 ||
      !Number.isFinite(row.createdAt.getTime())
    ) {
      throw new AddendumImpactPersistenceConflict("invalid_snapshot");
    }
    const snapshot = parseAddendumStructuredSnapshot(
      row.structuredSnapshot,
      row.canonicalText,
    );
    if (!snapshot) {
      throw new AddendumImpactPersistenceConflict("invalid_snapshot");
    }
    return {
      ...row,
      structuredSnapshot: row.structuredSnapshot,
      structuredSnapshotSha256: row.structuredSnapshotSha256,
      snapshot,
    };
  });
}

async function loadCurrentAddendumImpactPlan(
  database: DatabaseReader,
  scope: AddendumImpactScope,
  projectId: string,
  selection: AddendumImpactSelection,
  lockRows = false,
): Promise<CurrentAddendumImpactPlan | null> {
  const projectQuery = database
    .select()
    .from(projects)
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.organisationId, scope.organisationId),
      ),
    )
    .limit(1);
  const [project] = await (lockRows
    ? projectQuery.for("update")
    : projectQuery);
  if (!project) return null;
  const candidates = await loadVersionCandidates(
    database,
    scope,
    projectId,
    lockRows,
  );
  const resolved = resolveAddendumVersionChain(candidates, selection);
  if (!resolved) return null;
  const targets = await loadTargets(
    database,
    scope,
    project,
    resolved,
    lockRows,
  );
  const comparison: AddendumImpactInput = {
    sources: resolved.chain.map(toSourceDocument),
    baseline: {
      sourceId: resolved.baseline.snapshot.sourceId,
      sourceVersionId: resolved.baseline.documentVersionId,
      fields: resolved.baselineFields,
    },
    revision: {
      sourceId: resolved.revision.snapshot.sourceId,
      sourceVersionId: resolved.revision.documentVersionId,
      fields: resolved.revisionFields,
      removals: resolved.removals,
    },
    targets,
  };
  return {
    project,
    resolved,
    comparison,
    assessment: buildAddendumImpactAssessment(comparison),
  };
}

async function acquireAddendumMutationLocks(
  transaction: Transaction,
  scope: AddendumImpactScope,
  projectId: string,
  selection: Required<AddendumImpactSelection>,
): Promise<string> {
  // Membership administration writers take this first. The request route has
  // already revalidated the direct grants under the same outer transaction;
  // reacquiring the transaction lock here also protects direct repository use.
  await transaction.execute(sql`
    SELECT pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        ${`bidbox.membership-administration:${scope.organisationId}`},
        0
      )
    )
  `);
  const preflightCandidates = await loadVersionCandidates(
    transaction,
    scope,
    projectId,
  );
  const preflight = resolveAddendumVersionChain(preflightCandidates, selection);
  if (!preflight) {
    throw new AddendumImpactPersistenceConflict("stale");
  }
  const sourceId = preflight.revision.snapshot.sourceId;
  await transaction.execute(sql`
    SELECT pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        ${`bidbox.document-snapshot-series:${scope.organisationId}:${projectId}:${sourceId}`},
        0
      )
    )
  `);
  return sourceId;
}

function assertCurrentPlanIdentity(
  current: CurrentAddendumImpactPlan | null,
  expected: {
    readonly baselineDocumentVersionId: string;
    readonly revisionDocumentVersionId: string;
    readonly assessmentId: string;
    readonly radarId: string;
    readonly sourceManifestSha256: string;
    readonly impactManifestSha256: string;
  },
  lockedSourceId: string,
): asserts current is CurrentAddendumImpactPlan {
  if (
    !current ||
    current.resolved.baseline.documentVersionId !==
      expected.baselineDocumentVersionId ||
    current.resolved.revision.documentVersionId !==
      expected.revisionDocumentVersionId ||
    current.resolved.revision.snapshot.sourceId !== lockedSourceId ||
    current.assessment.assessmentId !== expected.assessmentId ||
    current.assessment.radarId !== expected.radarId ||
    current.assessment.sourceManifestSha256 !== expected.sourceManifestSha256 ||
    current.assessment.impactManifestSha256 !== expected.impactManifestSha256
  ) {
    throw new AddendumImpactPersistenceConflict("stale");
  }
}

function assessmentSnapshot(assessment: AddendumImpactAssessment): string {
  return JSON.stringify({
    schema: ASSESSMENT_SNAPSHOT_SCHEMA,
    policyVersion: ADDENDUM_IMPACT_POLICY_VERSION,
    assessmentId: assessment.assessmentId,
    radarId: assessment.radarId,
    sourceManifestSha256: assessment.sourceManifestSha256,
    impactManifestSha256: assessment.impactManifestSha256,
    status: assessment.status,
    changeCount: assessment.radar.changes.length,
    impactCount: assessment.impacts.length,
  });
}

function reviewState(decision: AddendumImpactReviewDecision): string {
  return decision === "changes_requested" ? "needs_changes" : decision;
}

function persistenceItems(
  assessment: AddendumImpactAssessment,
  input: RecordAddendumImpactReviewInput,
  assessmentRowId: string,
  reviewed: boolean,
) {
  const values: Array<typeof addendumImpactItems.$inferInsert> = [];
  assessment.radar.changes.forEach((change) => {
    const impacted = assessment.impacts.filter(({ changeIds }) =>
      changeIds.includes(change.changeId),
    );
    const common = {
      organisationId: input.scope.organisationId,
      assessmentId: assessmentRowId,
      changeId: change.changeId,
      category: change.category,
      kind: change.kind,
      beforeText: change.beforeValue ?? null,
      afterText: change.afterValue ?? null,
      citationData: JSON.stringify({
        before: change.beforeCitation ?? null,
        after: change.afterCitation ?? null,
      }),
      fieldExternalId: change.fieldExternalId,
      ...(reviewed
        ? {
            reviewState: reviewState(input.decision),
            reviewedByUserId: input.scope.actorUserId,
            reviewedByName: input.scope.actorName,
            reviewedAt: new Date(input.reviewedAt),
            reviewNote: input.reason,
          }
        : {}),
    };
    if (impacted.length === 0) {
      values.push({
        ...common,
        proposedAction: JSON.stringify({
          policy: ADDENDUM_IMPACT_POLICY_VERSION,
          action: "none",
          currentState: null,
        }),
      });
      return;
    }
    impacted.forEach((impact) => {
      values.push({
        ...common,
        affectedObjectType: impact.objectType,
        affectedObjectId: impact.targetId,
        affectedObjectVersion: impact.currentVersion,
        proposedAction: JSON.stringify({
          policy: ADDENDUM_IMPACT_POLICY_VERSION,
          action: impact.proposedAction,
          currentState: impact.currentState,
        }),
      });
    });
  });
  if (
    values.length === 0 ||
    values.length > MAX_PERSISTED_ITEMS ||
    values.some(
      ({ citationData }) =>
        !citationData ||
        citationData.length < 2 ||
        citationData.length > 40_000,
    )
  ) {
    throw new AddendumImpactPersistenceConflict("capacity");
  }
  return values;
}

function sameReview(
  row: typeof addendumImpactAssessments.$inferSelect,
  input: RecordAddendumImpactReviewInput,
): boolean {
  const identity = storedIdentity(row.assessmentSnapshot);
  return Boolean(
    identity?.assessmentId === input.assessmentId &&
    identity.radarId === input.radarId &&
    identity.sourceManifestSha256 === input.assessment.sourceManifestSha256 &&
    identity.impactManifestSha256 === input.impactManifestSha256 &&
    row.assessmentId === input.assessmentId &&
    row.radarId === input.radarId &&
    row.sourceManifestSha256 === input.assessment.sourceManifestSha256 &&
    row.impactManifestSha256 === input.impactManifestSha256 &&
    row.reviewState === reviewState(input.decision) &&
    row.reviewedByUserId === input.scope.actorUserId &&
    row.reviewedByName === input.scope.actorName &&
    row.reviewNote === input.reason &&
    input.expectedAssessmentVersion === 0,
  );
}

async function requireActor(
  transaction: Transaction,
  scope: AddendumImpactScope,
) {
  const [actor] = await transaction
    .select()
    .from(users)
    .where(eq(users.id, scope.actorUserId))
    .limit(1);
  if (
    !actor ||
    actor.status !== "active" ||
    actor.name?.trim() !== scope.actorName.trim()
  ) {
    throw new AddendumImpactPersistenceConflict("stale");
  }
  return actor;
}

function expectedTargetState(
  mutation: AddendumReopeningMutation,
  objectType: AddendumReopeningMutation["objectType"],
): boolean {
  const expected: Record<
    AddendumReopeningMutation["objectType"],
    AddendumReopeningMutation["toState"]
  > = {
    project: "reopened",
    requirement: "reopened",
    work_task: "reopened",
    draft: "reopened",
    boq_check: "review_required",
    approval: "invalidated",
    package: "invalidated",
    report: "invalidated",
  };
  return mutation.toState === expected[objectType];
}

async function applyTargetMutation(
  transaction: Transaction,
  input: ApplyAddendumImpactInput,
  mutation: AddendumReopeningMutation,
): Promise<void> {
  if (
    !UUID.test(mutation.targetId) ||
    mutation.fromState === mutation.toState ||
    !expectedTargetState(mutation, mutation.objectType)
  ) {
    throw new AddendumImpactPersistenceConflict("invalid_snapshot");
  }
  const now = new Date(input.appliedAt);
  let rows: Array<{ id: string }> = [];
  if (mutation.objectType === "project") {
    const [current] = await transaction
      .select()
      .from(projects)
      .where(
        and(
          eq(projects.id, mutation.targetId),
          eq(projects.organisationId, input.scope.organisationId),
          eq(projects.version, mutation.expectedVersion),
          eq(projects.status, mutation.fromState),
        ),
      )
      .for("update");
    if (!current || !closedProjectStatus(current.status)) {
      throw new AddendumImpactPersistenceConflict("stale");
    }
    const transition = validateProjectTransition({
      fromStatus: current.status,
      toStatus: "review",
      reviewerId: current.reviewerId,
      paymentStatus: current.paymentStatus as
        | "not_required"
        | "pending"
        | "confirmed",
      paymentConfirmedByFounder: current.paymentConfirmedByFounder,
      paymentConfirmedByAdvisor: current.paymentConfirmedByAdvisor,
      paymentFounderConfirmedBy: current.paymentFounderConfirmedBy,
      paymentAdvisorConfirmedBy: current.paymentAdvisorConfirmedBy,
      conflictStatus: current.conflictStatus as
        | "clear"
        | "blocked"
        | "consented"
        | "declined",
    });
    if (!transition.ok) throw new AddendumImpactPersistenceConflict("stale");
    rows = await transaction
      .update(projects)
      .set({
        status: "review",
        version: mutation.expectedVersion + 1,
        updatedAt: now,
      })
      .where(
        and(
          eq(projects.id, mutation.targetId),
          eq(projects.organisationId, input.scope.organisationId),
          eq(projects.version, mutation.expectedVersion),
          eq(projects.status, mutation.fromState),
        ),
      )
      .returning({ id: projects.id });
  } else if (mutation.objectType === "requirement") {
    rows = await transaction
      .update(requirements)
      .set({
        reviewStatus: "reopened",
        version: mutation.expectedVersion + 1,
        updatedAt: now,
      })
      .where(
        and(
          eq(requirements.id, mutation.targetId),
          eq(requirements.organisationId, input.scope.organisationId),
          eq(requirements.projectId, input.projectId),
          eq(requirements.version, mutation.expectedVersion),
          eq(requirements.reviewStatus, mutation.fromState),
        ),
      )
      .returning({ id: requirements.id });
  } else if (mutation.objectType === "work_task") {
    rows = await transaction
      .update(workTasks)
      .set({
        status: "reopened",
        completedAt: null,
        version: mutation.expectedVersion + 1,
        updatedAt: now,
      })
      .where(
        and(
          eq(workTasks.id, mutation.targetId),
          eq(workTasks.organisationId, input.scope.organisationId),
          eq(workTasks.projectId, input.projectId),
          eq(workTasks.version, mutation.expectedVersion),
          eq(workTasks.status, mutation.fromState),
        ),
      )
      .returning({ id: workTasks.id });
  } else if (mutation.objectType === "draft") {
    rows = await transaction
      .update(drafts)
      .set({
        status: "reopened",
        version: mutation.expectedVersion + 1,
        updatedAt: now,
      })
      .where(
        and(
          eq(drafts.id, mutation.targetId),
          eq(drafts.organisationId, input.scope.organisationId),
          eq(drafts.projectId, input.projectId),
          eq(drafts.version, mutation.expectedVersion),
          eq(drafts.status, mutation.fromState),
        ),
      )
      .returning({ id: drafts.id });
  } else if (mutation.objectType === "boq_check") {
    rows = await transaction
      .update(boqChecks)
      .set({
        status: "review_required",
        version: mutation.expectedVersion + 1,
        updatedAt: now,
      })
      .where(
        and(
          eq(boqChecks.id, mutation.targetId),
          eq(boqChecks.organisationId, input.scope.organisationId),
          eq(boqChecks.projectId, input.projectId),
          eq(boqChecks.version, mutation.expectedVersion),
          eq(boqChecks.status, mutation.fromState),
        ),
      )
      .returning({ id: boqChecks.id });
  } else if (mutation.objectType === "approval") {
    rows = await transaction
      .update(approvals)
      .set({
        decision: "invalidated",
        version: mutation.expectedVersion + 1,
        updatedAt: now,
      })
      .where(
        and(
          eq(approvals.id, mutation.targetId),
          eq(approvals.organisationId, input.scope.organisationId),
          eq(approvals.projectId, input.projectId),
          eq(approvals.version, mutation.expectedVersion),
          eq(approvals.decision, mutation.fromState),
        ),
      )
      .returning({ id: approvals.id });
  } else if (mutation.objectType === "package") {
    rows = await transaction
      .update(packages)
      .set({
        status: "invalidated",
        version: mutation.expectedVersion + 1,
        updatedAt: now,
      })
      .where(
        and(
          eq(packages.id, mutation.targetId),
          eq(packages.organisationId, input.scope.organisationId),
          eq(packages.projectId, input.projectId),
          eq(packages.version, mutation.expectedVersion),
          eq(packages.status, mutation.fromState),
        ),
      )
      .returning({ id: packages.id });
  } else if (mutation.objectType === "report") {
    rows = await transaction
      .update(reports)
      .set({
        status: "invalidated",
        optimisticLockVersion: mutation.expectedVersion + 1,
        updatedAt: now,
      })
      .where(
        and(
          eq(reports.id, mutation.targetId),
          eq(reports.organisationId, input.scope.organisationId),
          eq(reports.projectId, input.projectId),
          eq(reports.optimisticLockVersion, mutation.expectedVersion),
          eq(reports.status, mutation.fromState),
        ),
      )
      .returning({ id: reports.id });
  }
  if (rows.length !== 1) {
    throw new AddendumImpactPersistenceConflict("stale");
  }
}

function parsedStoredAction(value: string): {
  action: "reopen" | "invalidate" | "recheck" | "none";
  currentState: string | null;
} | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (
    !record(parsed) ||
    parsed.policy !== ADDENDUM_IMPACT_POLICY_VERSION ||
    !["reopen", "invalidate", "recheck", "none"].includes(
      String(parsed.action),
    ) ||
    (parsed.currentState !== null &&
      (typeof parsed.currentState !== "string" ||
        parsed.currentState.length === 0 ||
        parsed.currentState.length > 160))
  ) {
    return null;
  }
  return {
    action: parsed.action as "reopen" | "invalidate" | "recheck" | "none",
    currentState: parsed.currentState as string | null,
  };
}

function expectedMutationState(
  action: "reopen" | "invalidate" | "recheck",
): AddendumReopeningMutation["toState"] {
  if (action === "reopen") return "reopened";
  if (action === "invalidate") return "invalidated";
  return "review_required";
}

function exactPersistedMutationPlan(
  itemRows: readonly (typeof addendumImpactItems.$inferSelect)[],
  mutations: readonly AddendumReopeningMutation[],
): boolean {
  const byTarget = new Map<
    string,
    {
      objectType: AddendumReopeningMutation["objectType"];
      targetId: string;
      expectedVersion: number;
      fromState: string;
      toState: AddendumReopeningMutation["toState"];
      changeIds: string[];
    }
  >();
  for (const row of itemRows) {
    const action = parsedStoredAction(row.proposedAction);
    if (!action) return false;
    if (action.action === "none") {
      if (
        row.affectedObjectType !== null ||
        row.affectedObjectId !== null ||
        row.affectedObjectVersion !== null ||
        action.currentState !== null
      ) {
        return false;
      }
      continue;
    }
    if (
      !row.affectedObjectType ||
      !row.affectedObjectId ||
      !row.affectedObjectVersion ||
      !action.currentState ||
      ![
        "project",
        "requirement",
        "work_task",
        "draft",
        "boq_check",
        "approval",
        "package",
        "report",
      ].includes(row.affectedObjectType)
    ) {
      return false;
    }
    const key = `${row.affectedObjectType}\0${row.affectedObjectId}`;
    const current = byTarget.get(key);
    if (
      current &&
      (current.expectedVersion !== row.affectedObjectVersion ||
        current.fromState !== action.currentState ||
        current.toState !== expectedMutationState(action.action))
    ) {
      return false;
    }
    byTarget.set(key, {
      objectType:
        row.affectedObjectType as AddendumReopeningMutation["objectType"],
      targetId: row.affectedObjectId,
      expectedVersion: row.affectedObjectVersion,
      fromState: action.currentState,
      toState: expectedMutationState(action.action),
      changeIds: unique([...(current?.changeIds ?? []), row.changeId]),
    });
  }
  const persisted = [...byTarget.values()].sort((left, right) =>
    `${left.objectType}:${left.targetId}`.localeCompare(
      `${right.objectType}:${right.targetId}`,
    ),
  );
  const requested = mutations
    .map((mutation) => ({
      objectType: mutation.objectType,
      targetId: mutation.targetId,
      expectedVersion: mutation.expectedVersion,
      fromState: mutation.fromState,
      toState: mutation.toState,
      changeIds: [...mutation.changeIds].sort(),
    }))
    .sort((left, right) =>
      `${left.objectType}:${left.targetId}`.localeCompare(
        `${right.objectType}:${right.targetId}`,
      ),
    );
  return JSON.stringify(persisted) === JSON.stringify(requested);
}

export class DrizzleAddendumImpactRepository implements AddendumImpactRepository {
  constructor(
    private readonly database: Database = db,
    private readonly auditWriter: typeof writeAuditTx = writeAuditTx,
  ) {}

  async load(
    scope: AddendumImpactScope,
    projectId: string,
    selection: AddendumImpactSelection,
  ): Promise<AddendumImpactRepositorySnapshot | null> {
    try {
      const current = await loadCurrentAddendumImpactPlan(
        this.database,
        scope,
        projectId,
        selection,
      );
      if (!current) return null;
      const {
        project,
        resolved,
        comparison,
        assessment: rawAssessment,
      } = current;
      const assessmentRows = await this.database
        .select()
        .from(addendumImpactAssessments)
        .where(
          and(
            eq(addendumImpactAssessments.organisationId, scope.organisationId),
            eq(addendumImpactAssessments.projectId, projectId),
            eq(
              addendumImpactAssessments.baselineDocumentVersionId,
              resolved.baseline.documentVersionId,
            ),
            eq(
              addendumImpactAssessments.revisionDocumentVersionId,
              resolved.revision.documentVersionId,
            ),
            eq(addendumImpactAssessments.radarId, rawAssessment.radarId),
            eq(
              addendumImpactAssessments.assessmentId,
              rawAssessment.assessmentId,
            ),
            eq(
              addendumImpactAssessments.impactManifestSha256,
              rawAssessment.impactManifestSha256,
            ),
          ),
        )
        .limit(2);
      if (assessmentRows.length > 1) {
        throw new AddendumImpactPersistenceConflict("invalid_snapshot");
      }
      const assessment = assessmentRows[0] ?? null;
      if (
        assessment &&
        (assessment.sourceManifestSha256 !==
          rawAssessment.sourceManifestSha256 ||
          assessment.radarId !== rawAssessment.radarId ||
          assessment.assessmentId !== rawAssessment.assessmentId ||
          assessment.impactManifestSha256 !==
            rawAssessment.impactManifestSha256 ||
          storedIdentity(assessment.assessmentSnapshot)
            ?.impactManifestSha256 !== rawAssessment.impactManifestSha256)
      ) {
        throw new AddendumImpactPersistenceConflict("invalid_snapshot");
      }
      return {
        organisationId: scope.organisationId,
        projectId,
        projectTitle: project.tenderTitle,
        baseline: {
          documentId: resolved.baseline.documentId,
          documentVersionId: resolved.baseline.documentVersionId,
          filename: resolved.baseline.filename,
          versionNumber: resolved.baseline.versionNumber,
          sha256: resolved.baseline.bytesSha256,
          capturedAt: resolved.baseline.createdAt.toISOString(),
        },
        revision: {
          documentId: resolved.revision.documentId,
          documentVersionId: resolved.revision.documentVersionId,
          filename: resolved.revision.filename,
          versionNumber: resolved.revision.versionNumber,
          sha256: resolved.revision.bytesSha256,
          capturedAt: resolved.revision.createdAt.toISOString(),
        },
        comparison,
        assessmentVersion: assessment?.version ?? 0,
        review: assessment ? reviewFromAssessment(assessment) : null,
        application: assessment ? applicationFromAssessment(assessment) : null,
      };
    } catch (error) {
      if (error instanceof AddendumImpactPersistenceConflict) {
        throw new AddendumImpactRepositoryUnavailableError();
      }
      throw error;
    }
  }

  async recordReview(input: RecordAddendumImpactReviewInput) {
    try {
      if (
        !UUID.test(input.projectId) ||
        !UUID.test(input.baselineDocumentVersionId) ||
        !UUID.test(input.revisionDocumentVersionId) ||
        input.scope.source !== "membership" ||
        !UUID.test(input.scope.membershipId ?? "") ||
        !isIsoInstant(input.reviewedAt) ||
        input.reason.trim().length === 0 ||
        input.reason.length > 2_000 ||
        input.assessment.assessmentId !== input.assessmentId ||
        input.assessment.radarId !== input.radarId ||
        input.assessment.impactManifestSha256 !== input.impactManifestSha256 ||
        !SHA256.test(input.assessment.sourceManifestSha256) ||
        input.assessment.radar.changes.length === 0 ||
        !Number.isSafeInteger(input.expectedAssessmentVersion) ||
        input.expectedAssessmentVersion < 0
      ) {
        return { outcome: "conflict" as const };
      }
      return await this.database.transaction(
        async (transaction) => {
          const selection = {
            baselineVersionId: input.baselineDocumentVersionId,
            revisionVersionId: input.revisionDocumentVersionId,
          } as const;
          const lockedSourceId = await acquireAddendumMutationLocks(
            transaction,
            input.scope,
            input.projectId,
            selection,
          );
          const actor = await requireActor(transaction, input.scope);
          const current = await loadCurrentAddendumImpactPlan(
            transaction,
            input.scope,
            input.projectId,
            selection,
            true,
          );
          assertCurrentPlanIdentity(
            current,
            {
              baselineDocumentVersionId: input.baselineDocumentVersionId,
              revisionDocumentVersionId: input.revisionDocumentVersionId,
              assessmentId: input.assessmentId,
              radarId: input.radarId,
              sourceManifestSha256: input.assessment.sourceManifestSha256,
              impactManifestSha256: input.impactManifestSha256,
            },
            lockedSourceId,
          );

          const existingRows = await transaction
            .select()
            .from(addendumImpactAssessments)
            .where(
              and(
                eq(
                  addendumImpactAssessments.organisationId,
                  input.scope.organisationId,
                ),
                eq(addendumImpactAssessments.projectId, input.projectId),
                eq(
                  addendumImpactAssessments.baselineDocumentVersionId,
                  input.baselineDocumentVersionId,
                ),
                eq(
                  addendumImpactAssessments.revisionDocumentVersionId,
                  input.revisionDocumentVersionId,
                ),
                eq(addendumImpactAssessments.radarId, input.radarId),
                eq(addendumImpactAssessments.assessmentId, input.assessmentId),
                eq(
                  addendumImpactAssessments.impactManifestSha256,
                  input.impactManifestSha256,
                ),
              ),
            )
            .limit(2)
            .for("update");
          if (existingRows.length > 1) {
            throw new AddendumImpactPersistenceConflict("invalid_snapshot");
          }
          const existing = existingRows[0];
          if (existing && sameReview(existing, input)) {
            const value = reviewFromAssessment(existing);
            if (!value)
              throw new AddendumImpactPersistenceConflict("invalid_snapshot");
            return { outcome: "replayed" as const, value };
          }
          if (
            existing ||
            (!existing && input.expectedAssessmentVersion !== 0)
          ) {
            throw new AddendumImpactPersistenceConflict("stale");
          }

          const storedSnapshot = assessmentSnapshot(input.assessment);
          const reviewedAt = new Date(input.reviewedAt);
          const inserted = await transaction
            .insert(addendumImpactAssessments)
            .values({
              organisationId: input.scope.organisationId,
              projectId: input.projectId,
              baselineDocumentVersionId: input.baselineDocumentVersionId,
              revisionDocumentVersionId: input.revisionDocumentVersionId,
              radarId: input.radarId,
              assessmentId: input.assessmentId,
              sourceManifestSha256: input.assessment.sourceManifestSha256,
              impactManifestSha256: input.impactManifestSha256,
              assessmentSnapshot: storedSnapshot,
              version: 1,
            })
            .onConflictDoNothing()
            .returning();
          if (inserted.length !== 1) {
            throw new AddendumImpactPersistenceConflict("stale");
          }
          const pending = inserted[0]!;
          const pendingItems = persistenceItems(
            input.assessment,
            input,
            pending.id,
            false,
          );
          await transaction.insert(addendumImpactItems).values(pendingItems);
          const terminalAssessments = await transaction
            .update(addendumImpactAssessments)
            .set({
              reviewState: reviewState(input.decision),
              reviewedByUserId: input.scope.actorUserId,
              reviewedByName: input.scope.actorName,
              reviewedAt,
              reviewNote: input.reason,
              version: 2,
              updatedAt: reviewedAt,
            })
            .where(
              and(
                eq(addendumImpactAssessments.id, pending.id),
                eq(addendumImpactAssessments.reviewState, "pending_review"),
                eq(addendumImpactAssessments.appliedState, "not_applied"),
                eq(addendumImpactAssessments.version, 1),
              ),
            )
            .returning();
          const terminalItems = await transaction
            .update(addendumImpactItems)
            .set({
              reviewState: reviewState(input.decision),
              reviewedByUserId: input.scope.actorUserId,
              reviewedByName: input.scope.actorName,
              reviewedAt,
              reviewNote: input.reason,
              version: 2,
              updatedAt: reviewedAt,
            })
            .where(
              and(
                eq(
                  addendumImpactItems.organisationId,
                  input.scope.organisationId,
                ),
                eq(addendumImpactItems.assessmentId, pending.id),
                eq(addendumImpactItems.reviewState, "pending_review"),
                eq(addendumImpactItems.version, 1),
              ),
            )
            .returning({ id: addendumImpactItems.id });
          if (
            terminalAssessments.length !== 1 ||
            terminalItems.length !== pendingItems.length
          ) {
            throw new AddendumImpactPersistenceConflict("stale");
          }
          const stored = terminalAssessments[0]!;
          await this.auditWriter(transaction, {
            user: actor,
            organisationId: input.scope.organisationId,
            projectId: input.projectId,
            eventType: "addendum_impact.review_recorded",
            objectType: "addendum_impact_assessment",
            objectId: stored.id,
            details: JSON.stringify({
              policyVersion: ADDENDUM_IMPACT_POLICY_VERSION,
              assessmentId: input.assessmentId,
              radarId: input.radarId,
              sourceManifestSha256: input.assessment.sourceManifestSha256,
              impactManifestSha256: input.impactManifestSha256,
              decision: input.decision,
              baselineDocumentVersionId: input.baselineDocumentVersionId,
              revisionDocumentVersionId: input.revisionDocumentVersionId,
              reason: input.reason,
            }),
            createdAt: reviewedAt,
          });
          const value = reviewFromAssessment(stored);
          if (!value)
            throw new AddendumImpactPersistenceConflict("invalid_snapshot");
          return { outcome: "recorded" as const, value };
        },
        { isolationLevel: "read committed" },
      );
    } catch (error) {
      if (error instanceof AddendumImpactPersistenceConflict) {
        return { outcome: "conflict" as const };
      }
      throw error;
    }
  }

  async findApplicationReplay(
    input: FindAddendumImpactApplicationReplayInput,
  ): Promise<StoredAddendumImpactApplication | null> {
    if (
      !UUID.test(input.projectId) ||
      !UUID.test(input.baselineDocumentVersionId) ||
      !UUID.test(input.revisionDocumentVersionId) ||
      input.scope.source !== "membership" ||
      !UUID.test(input.scope.membershipId ?? "") ||
      !isValidId(input.assessmentId) ||
      !isValidId(input.radarId) ||
      !SHA256.test(input.impactManifestSha256) ||
      !Number.isSafeInteger(input.expectedAssessmentVersion) ||
      input.expectedAssessmentVersion < 1 ||
      input.reason.trim().length === 0 ||
      input.reason.length > 2_000
    ) {
      return null;
    }
    try {
      return await this.database.transaction(
        async (transaction) => {
          await requireActor(transaction, input.scope);
          const rows = await transaction
            .select()
            .from(addendumImpactAssessments)
            .where(
              and(
                eq(
                  addendumImpactAssessments.organisationId,
                  input.scope.organisationId,
                ),
                eq(addendumImpactAssessments.projectId, input.projectId),
                eq(
                  addendumImpactAssessments.baselineDocumentVersionId,
                  input.baselineDocumentVersionId,
                ),
                eq(
                  addendumImpactAssessments.revisionDocumentVersionId,
                  input.revisionDocumentVersionId,
                ),
                eq(addendumImpactAssessments.radarId, input.radarId),
                eq(addendumImpactAssessments.assessmentId, input.assessmentId),
                eq(
                  addendumImpactAssessments.impactManifestSha256,
                  input.impactManifestSha256,
                ),
                eq(addendumImpactAssessments.appliedState, "applied"),
              ),
            )
            .limit(2)
            .for("update");
          if (rows.length !== 1) return null;
          const row = rows[0]!;
          const identity = storedIdentity(row.assessmentSnapshot);
          const review = reviewFromAssessment(row);
          const application = applicationFromAssessment(row);
          return identity?.assessmentId === input.assessmentId &&
            identity.radarId === input.radarId &&
            identity.impactManifestSha256 === input.impactManifestSha256 &&
            row.assessmentId === input.assessmentId &&
            row.radarId === input.radarId &&
            row.impactManifestSha256 === input.impactManifestSha256 &&
            row.version === input.expectedAssessmentVersion + 1 &&
            review?.decision === "accepted" &&
            review.reviewerUserId !== input.scope.actorUserId &&
            application?.appliedByUserId === input.scope.actorUserId &&
            application.appliedByName === input.scope.actorName &&
            application.reason === input.reason
            ? application
            : null;
        },
        { isolationLevel: "read committed" },
      );
    } catch (error) {
      if (error instanceof AddendumImpactPersistenceConflict) return null;
      throw error;
    }
  }

  async applyReopening(input: ApplyAddendumImpactInput) {
    try {
      if (
        !UUID.test(input.projectId) ||
        !UUID.test(input.baselineDocumentVersionId) ||
        !UUID.test(input.revisionDocumentVersionId) ||
        input.scope.source !== "membership" ||
        !UUID.test(input.scope.membershipId ?? "") ||
        !SHA256.test(input.sourceManifestSha256) ||
        !SHA256.test(input.impactManifestSha256) ||
        !Number.isSafeInteger(input.expectedAssessmentVersion) ||
        input.expectedAssessmentVersion < 1 ||
        !isIsoInstant(input.appliedAt) ||
        input.reason.trim().length === 0 ||
        input.reason.length > 2_000 ||
        input.review.reviewerUserId === input.scope.actorUserId ||
        input.mutations.length === 0 ||
        input.mutations.length > ADDENDUM_IMPACT_BOUNDS.targets
      ) {
        return { outcome: "conflict" as const };
      }
      return await this.database.transaction(
        async (transaction) => {
          const selection = {
            baselineVersionId: input.baselineDocumentVersionId,
            revisionVersionId: input.revisionDocumentVersionId,
          } as const;
          const lockedSourceId = await acquireAddendumMutationLocks(
            transaction,
            input.scope,
            input.projectId,
            selection,
          );
          const actor = await requireActor(transaction, input.scope);
          const current = await loadCurrentAddendumImpactPlan(
            transaction,
            input.scope,
            input.projectId,
            selection,
            true,
          );
          const rows = await transaction
            .select()
            .from(addendumImpactAssessments)
            .where(
              and(
                eq(
                  addendumImpactAssessments.organisationId,
                  input.scope.organisationId,
                ),
                eq(addendumImpactAssessments.projectId, input.projectId),
                eq(
                  addendumImpactAssessments.baselineDocumentVersionId,
                  input.baselineDocumentVersionId,
                ),
                eq(
                  addendumImpactAssessments.revisionDocumentVersionId,
                  input.revisionDocumentVersionId,
                ),
                eq(addendumImpactAssessments.radarId, input.radarId),
                eq(addendumImpactAssessments.assessmentId, input.assessmentId),
                eq(
                  addendumImpactAssessments.impactManifestSha256,
                  input.impactManifestSha256,
                ),
                eq(
                  addendumImpactAssessments.sourceManifestSha256,
                  input.sourceManifestSha256,
                ),
              ),
            )
            .orderBy(desc(addendumImpactAssessments.createdAt))
            .limit(MAX_ASSESSMENT_HISTORY + 1)
            .for("update");
          if (rows.length > MAX_ASSESSMENT_HISTORY) {
            throw new AddendumImpactPersistenceConflict("capacity");
          }
          const assessment = rows.find(
            (row) =>
              storedIdentity(row.assessmentSnapshot)?.assessmentId ===
              input.assessmentId,
          );
          if (!assessment) throw new AddendumImpactPersistenceConflict("stale");
          const identity = storedIdentity(assessment.assessmentSnapshot);
          if (!identity)
            throw new AddendumImpactPersistenceConflict("invalid_snapshot");
          if (assessment.appliedState === "applied") {
            const replay = applicationFromAssessment(assessment);
            if (
              replay &&
              replay.appliedByUserId === input.scope.actorUserId &&
              replay.appliedByName === input.scope.actorName &&
              replay.reason === input.reason
            ) {
              return { outcome: "replayed" as const, value: replay };
            }
            throw new AddendumImpactPersistenceConflict("stale");
          }
          assertCurrentPlanIdentity(
            current,
            {
              baselineDocumentVersionId: input.baselineDocumentVersionId,
              revisionDocumentVersionId: input.revisionDocumentVersionId,
              assessmentId: input.assessmentId,
              radarId: input.radarId,
              sourceManifestSha256: input.sourceManifestSha256,
              impactManifestSha256: input.impactManifestSha256,
            },
            lockedSourceId,
          );
          const storedReview = reviewFromAssessment(assessment);
          if (
            assessment.version !== input.expectedAssessmentVersion ||
            assessment.reviewState !== "accepted" ||
            assessment.appliedState !== "not_applied" ||
            !storedReview ||
            storedReview.decision !== "accepted" ||
            storedReview.reviewerUserId === input.scope.actorUserId ||
            JSON.stringify(storedReview) !== JSON.stringify(input.review) ||
            assessment.assessmentId !== input.assessmentId ||
            assessment.radarId !== input.radarId ||
            assessment.impactManifestSha256 !== input.impactManifestSha256 ||
            identity.radarId !== input.radarId ||
            identity.sourceManifestSha256 !== input.sourceManifestSha256 ||
            identity.impactManifestSha256 !== input.impactManifestSha256
          ) {
            throw new AddendumImpactPersistenceConflict("stale");
          }
          const itemRows = await transaction
            .select()
            .from(addendumImpactItems)
            .where(
              and(
                eq(
                  addendumImpactItems.organisationId,
                  input.scope.organisationId,
                ),
                eq(addendumImpactItems.assessmentId, assessment.id),
              ),
            )
            .limit(MAX_PERSISTED_ITEMS + 1)
            .for("update");
          if (
            itemRows.length === 0 ||
            itemRows.length > MAX_PERSISTED_ITEMS ||
            itemRows.some(
              (item) =>
                item.reviewState !== "accepted" ||
                item.reviewedByUserId !== storedReview.reviewerUserId ||
                item.reviewedByName !== storedReview.reviewerName ||
                item.reviewedAt?.toISOString() !== storedReview.reviewedAt,
            ) ||
            !exactPersistedMutationPlan(itemRows, input.mutations)
          ) {
            throw new AddendumImpactPersistenceConflict("invalid_snapshot");
          }

          for (const mutation of input.mutations) {
            await applyTargetMutation(transaction, input, mutation);
          }
          const nextVersion = assessment.version + 1;
          const updated = await transaction
            .update(addendumImpactAssessments)
            .set({
              appliedState: "applied",
              appliedByUserId: input.scope.actorUserId,
              appliedByName: input.scope.actorName,
              appliedAt: new Date(input.appliedAt),
              applyNote: input.reason,
              version: nextVersion,
              updatedAt: new Date(input.appliedAt),
            })
            .where(
              and(
                eq(addendumImpactAssessments.id, assessment.id),
                eq(addendumImpactAssessments.version, assessment.version),
                eq(addendumImpactAssessments.reviewState, "accepted"),
                eq(addendumImpactAssessments.appliedState, "not_applied"),
              ),
            )
            .returning();
          if (updated.length !== 1) {
            throw new AddendumImpactPersistenceConflict("stale");
          }
          await this.auditWriter(transaction, {
            user: actor,
            organisationId: input.scope.organisationId,
            projectId: input.projectId,
            eventType: "addendum_impact.controlled_reopening_applied",
            objectType: "addendum_impact_assessment",
            objectId: assessment.id,
            details: JSON.stringify({
              policyVersion: ADDENDUM_IMPACT_POLICY_VERSION,
              assessmentId: input.assessmentId,
              radarId: input.radarId,
              sourceManifestSha256: input.sourceManifestSha256,
              impactManifestSha256: input.impactManifestSha256,
              baselineDocumentVersionId: input.baselineDocumentVersionId,
              revisionDocumentVersionId: input.revisionDocumentVersionId,
              reason: input.reason,
              segregationOfDuties: {
                reviewedByUserId: storedReview.reviewerUserId,
                appliedByUserId: input.scope.actorUserId,
                distinct: true,
              },
              preservedHistoricalAuthority: {
                approval: [
                  "decidedByUserId",
                  "decidedAt",
                  "reason",
                  "evidenceSnapshotHash",
                ],
                report: [
                  "reviewerId",
                  "reviewerName",
                  "attestation",
                  "signedOffAt",
                ],
              },
              targets: input.mutations.map((mutation) => ({
                objectType: mutation.objectType,
                targetId: mutation.targetId,
                expectedVersion: mutation.expectedVersion,
                fromState: mutation.fromState,
                toState: mutation.toState,
                changeIds: mutation.changeIds,
              })),
            }),
            createdAt: new Date(input.appliedAt),
          });
          const value = applicationFromAssessment(updated[0]!);
          if (!value)
            throw new AddendumImpactPersistenceConflict("invalid_snapshot");
          return { outcome: "recorded" as const, value };
        },
        { isolationLevel: "read committed" },
      );
    } catch (error) {
      if (error instanceof AddendumImpactPersistenceConflict) {
        return { outcome: "conflict" as const };
      }
      throw error;
    }
  }
}

export function createDrizzleAddendumImpactRepository(): AddendumImpactRepository {
  return new DrizzleAddendumImpactRepository();
}
