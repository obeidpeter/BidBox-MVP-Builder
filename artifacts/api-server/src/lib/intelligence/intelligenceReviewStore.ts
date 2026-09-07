import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, reviews } from "@workspace/db";
import type { LocalUser } from "../accessContext";
import { writeAuditTx } from "../audit";
import {
  INTELLIGENCE_CAPABILITY_IDS,
  type IntelligenceCapabilityId,
} from "./snapshot";
import type { IntelligenceSourceVersion } from "./intelligenceSourceVersion";

import { SHA256_HEX_PATTERN as SHA256 } from "../identifierPatterns";
const CAPABILITIES = new Set<string>(INTELLIGENCE_CAPABILITY_IDS);
const MAX_POSTGRES_INTEGER = 2_147_483_647;
const MAX_REVIEWER_NAME_CODE_UNITS = 512;
const OPAQUE_REVIEWER_NAMES = new Set(["assigned reviewer"]);

export const INTELLIGENCE_REVIEW_DECISIONS = [
  "changes_requested",
  "approved",
  "rejected",
] as const;

export type IntelligenceReviewDecision =
  (typeof INTELLIGENCE_REVIEW_DECISIONS)[number];

export interface IntelligenceReviewClaimBody {
  capabilityId: IntelligenceCapabilityId;
  expectedSourceVersion: number;
  expectedSourceManifestSha256: string;
  expectedReviewVersion: number | null;
}

export interface IntelligenceReviewDecisionBody extends Omit<
  IntelligenceReviewClaimBody,
  "expectedReviewVersion"
> {
  expectedReviewVersion: number;
  decision: IntelligenceReviewDecision;
}

export interface IntelligenceReviewFindings {
  schemaVersion: "valo.intelligence-review.v1";
  sourceManifestSha256: string;
  decision: IntelligenceReviewDecision | null;
}

export type IntelligenceReviewMutationErrorCode =
  | "invalid_request"
  | "source_changed"
  | "review_changed"
  | "already_claimed"
  | "already_decided"
  | "not_claimed"
  | "persistence_conflict";

export class IntelligenceReviewMutationError extends Error {
  constructor(readonly code: IntelligenceReviewMutationErrorCode) {
    super(code);
    this.name = "IntelligenceReviewMutationError";
  }
}

export interface IntelligenceReviewMutationResult {
  review: typeof reviews.$inferSelect;
  replayed: boolean;
}

function exactObject(
  value: unknown,
  expectedKeys: readonly string[],
): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === expectedKeys.length &&
    Object.keys(value).every((key) => expectedKeys.includes(key))
  );
}

function positiveVersion(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= MAX_POSTGRES_INTEGER
  );
}

/**
 * Review authority must resolve to the actor's actual users.name value. The
 * route-level presentation fallback is deliberately not a valid authority.
 */
export function isValidIntelligenceReviewerName(
  value: unknown,
): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return (
    value === trimmed &&
    value.length >= 1 &&
    value.length <= MAX_REVIEWER_NAME_CODE_UNITS &&
    !/^[\p{White_Space}\p{Cf}]*$/u.test(value) &&
    !/[\p{Cc}\p{Cs}]/u.test(value) &&
    !OPAQUE_REVIEWER_NAMES.has(value.toLocaleLowerCase("en-US"))
  );
}

/**
 * A retry is idempotent only when the persisted version is exactly the one
 * created by the requested compare-and-swap. `null` denotes the absent row
 * immediately preceding an inserted version-1 review.
 */
export function isImmediateIntelligenceReviewReplay(
  persistedVersion: unknown,
  expectedReviewVersion: unknown,
): boolean {
  if (!positiveVersion(persistedVersion)) return false;
  if (expectedReviewVersion === null) return persistedVersion === 1;
  return (
    positiveVersion(expectedReviewVersion) &&
    expectedReviewVersion === persistedVersion - 1
  );
}

function validCapability(value: unknown): value is IntelligenceCapabilityId {
  return typeof value === "string" && CAPABILITIES.has(value);
}

export function parseIntelligenceReviewClaimBody(
  value: unknown,
): IntelligenceReviewClaimBody | null {
  const keys = [
    "capabilityId",
    "expectedSourceVersion",
    "expectedSourceManifestSha256",
    "expectedReviewVersion",
  ] as const;
  if (!exactObject(value, keys)) return null;
  if (
    !validCapability(value.capabilityId) ||
    !positiveVersion(value.expectedSourceVersion) ||
    typeof value.expectedSourceManifestSha256 !== "string" ||
    !SHA256.test(value.expectedSourceManifestSha256) ||
    (value.expectedReviewVersion !== null &&
      !positiveVersion(value.expectedReviewVersion))
  ) {
    return null;
  }
  return {
    capabilityId: value.capabilityId,
    expectedSourceVersion: value.expectedSourceVersion,
    expectedSourceManifestSha256: value.expectedSourceManifestSha256,
    expectedReviewVersion: value.expectedReviewVersion,
  };
}

export function parseIntelligenceReviewDecisionBody(
  value: unknown,
): IntelligenceReviewDecisionBody | null {
  const keys = [
    "capabilityId",
    "expectedSourceVersion",
    "expectedSourceManifestSha256",
    "expectedReviewVersion",
    "decision",
  ] as const;
  if (!exactObject(value, keys)) return null;
  if (
    !validCapability(value.capabilityId) ||
    !positiveVersion(value.expectedSourceVersion) ||
    typeof value.expectedSourceManifestSha256 !== "string" ||
    !SHA256.test(value.expectedSourceManifestSha256) ||
    !positiveVersion(value.expectedReviewVersion) ||
    typeof value.decision !== "string" ||
    !(INTELLIGENCE_REVIEW_DECISIONS as readonly string[]).includes(
      value.decision,
    )
  ) {
    return null;
  }
  return {
    capabilityId: value.capabilityId,
    expectedSourceVersion: value.expectedSourceVersion,
    expectedSourceManifestSha256: value.expectedSourceManifestSha256,
    expectedReviewVersion: value.expectedReviewVersion,
    decision: value.decision as IntelligenceReviewDecision,
  };
}

function findings(
  sourceManifestSha256: string,
  decision: IntelligenceReviewDecision | null,
): string {
  return JSON.stringify({
    schemaVersion: "valo.intelligence-review.v1",
    sourceManifestSha256,
    decision,
  } satisfies IntelligenceReviewFindings);
}

export function parseIntelligenceReviewFindings(
  value: string | null,
): IntelligenceReviewFindings | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      !exactObject(parsed, [
        "schemaVersion",
        "sourceManifestSha256",
        "decision",
      ]) ||
      parsed.schemaVersion !== "valo.intelligence-review.v1" ||
      typeof parsed.sourceManifestSha256 !== "string" ||
      !SHA256.test(parsed.sourceManifestSha256) ||
      (parsed.decision !== null &&
        (typeof parsed.decision !== "string" ||
          !(INTELLIGENCE_REVIEW_DECISIONS as readonly string[]).includes(
            parsed.decision,
          )))
    ) {
      return null;
    }
    return {
      schemaVersion: "valo.intelligence-review.v1",
      sourceManifestSha256: parsed.sourceManifestSha256,
      decision: parsed.decision as IntelligenceReviewDecision | null,
    };
  } catch {
    return null;
  }
}

export function intelligenceReviewManifestFromFindings(
  value: string | null,
): string | null {
  return parseIntelligenceReviewFindings(value)?.sourceManifestSha256 ?? null;
}

function completedTimestampIsValid(value: Date | null): boolean {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function persistedReviewLifecycleIsCoherent(
  review: Pick<
    typeof reviews.$inferSelect,
    "status" | "findings" | "completedAt"
  >,
): boolean {
  const envelope = parseIntelligenceReviewFindings(review.findings);
  if (!envelope) return false;
  if (review.status === "in_review" || review.status === "pending") {
    return envelope.decision === null && review.completedAt === null;
  }
  if (
    review.status === "approved" ||
    review.status === "rejected" ||
    review.status === "changes_requested"
  ) {
    return (
      envelope.decision === review.status &&
      completedTimestampIsValid(review.completedAt)
    );
  }
  return false;
}

function assertExpectedSource(
  body: IntelligenceReviewClaimBody | IntelligenceReviewDecisionBody,
  source: IntelligenceSourceVersion,
): void {
  if (
    body.expectedSourceVersion !== source.version ||
    body.expectedSourceManifestSha256 !== source.manifestHash
  ) {
    throw new IntelligenceReviewMutationError("source_changed");
  }
}

function reviewType(capabilityId: IntelligenceCapabilityId): string {
  return `intelligence.${capabilityId}`;
}

export function intelligenceReviewId(input: {
  organisationId: string;
  projectId: string;
  capabilityId: IntelligenceCapabilityId;
}): string {
  const bytes = Buffer.from(
    createHash("sha256")
      .update(
        [
          "valo.intelligence-review.id.v1",
          input.organisationId,
          input.projectId,
          input.capabilityId,
        ].join("\0"),
      )
      .digest()
      .subarray(0, 16),
  );
  // RFC 4122-compatible deterministic UUID: version 5/variant 1 bits make
  // the primary key shape valid while SHA-256 supplies the collision domain.
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

type ReviewTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function lockAndFind(
  tx: ReviewTx,
  input: {
    organisationId: string;
    projectId: string;
    capabilityId: IntelligenceCapabilityId;
  },
): Promise<typeof reviews.$inferSelect | null> {
  const key = `intelligence-review:${input.projectId}:${input.capabilityId}`;
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`,
  );
  const rows = await tx
    .select()
    .from(reviews)
    .where(
      and(
        eq(reviews.organisationId, input.organisationId),
        eq(reviews.projectId, input.projectId),
        eq(reviews.reviewType, reviewType(input.capabilityId)),
        eq(reviews.objectType, "intelligence_capability"),
        eq(reviews.objectId, input.projectId),
      ),
    )
    .orderBy(desc(reviews.updatedAt), desc(reviews.version), desc(reviews.id))
    .limit(2);
  if (rows.length > 1) {
    throw new IntelligenceReviewMutationError("persistence_conflict");
  }
  return rows[0] ?? null;
}

function bindingMatches(
  review: typeof reviews.$inferSelect,
  source: IntelligenceSourceVersion,
): boolean {
  const envelope = parseIntelligenceReviewFindings(review.findings);
  return (
    persistedReviewLifecycleIsCoherent(review) &&
    review.sourceVersion === source.version &&
    envelope?.sourceManifestSha256 === source.manifestHash
  );
}

export async function claimIntelligenceReview(input: {
  organisationId: string;
  projectId: string;
  actor: LocalUser;
  source: IntelligenceSourceVersion;
  body: IntelligenceReviewClaimBody;
}): Promise<IntelligenceReviewMutationResult> {
  if (!isValidIntelligenceReviewerName(input.actor.name)) {
    throw new IntelligenceReviewMutationError("invalid_request");
  }
  assertExpectedSource(input.body, input.source);
  return db.transaction(async (tx) => {
    const existing = await lockAndFind(tx, {
      organisationId: input.organisationId,
      projectId: input.projectId,
      capabilityId: input.body.capabilityId,
    });
    if (
      existing &&
      bindingMatches(existing, input.source) &&
      existing.status === "in_review" &&
      existing.reviewerUserId === input.actor.id
    ) {
      if (
        !isImmediateIntelligenceReviewReplay(
          existing.version,
          input.body.expectedReviewVersion,
        )
      ) {
        throw new IntelligenceReviewMutationError("review_changed");
      }
      return { review: existing, replayed: true };
    }
    if ((existing?.version ?? null) !== input.body.expectedReviewVersion) {
      throw new IntelligenceReviewMutationError("review_changed");
    }
    if (existing && bindingMatches(existing, input.source)) {
      if (existing.status === "in_review") {
        throw new IntelligenceReviewMutationError("already_claimed");
      }
      if (
        existing.status === "approved" ||
        existing.status === "rejected" ||
        existing.status === "changes_requested"
      ) {
        throw new IntelligenceReviewMutationError("already_decided");
      }
    }

    const now = new Date();
    let saved: typeof reviews.$inferSelect | undefined;
    if (existing) {
      [saved] = await tx
        .update(reviews)
        .set({
          reviewerUserId: input.actor.id,
          status: "in_review",
          findings: findings(input.source.manifestHash, null),
          sourceVersion: input.source.version,
          completedAt: null,
          version: sql`${reviews.version} + 1`,
          updatedAt: now,
        })
        .where(
          and(
            eq(reviews.id, existing.id),
            eq(reviews.version, existing.version),
          ),
        )
        .returning();
    } else {
      [saved] = await tx
        .insert(reviews)
        .values({
          id: intelligenceReviewId({
            organisationId: input.organisationId,
            projectId: input.projectId,
            capabilityId: input.body.capabilityId,
          }),
          organisationId: input.organisationId,
          projectId: input.projectId,
          reviewType: reviewType(input.body.capabilityId),
          objectType: "intelligence_capability",
          objectId: input.projectId,
          reviewerUserId: input.actor.id,
          status: "in_review",
          findings: findings(input.source.manifestHash, null),
          sourceVersion: input.source.version,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
    }
    if (!saved) {
      throw new IntelligenceReviewMutationError("persistence_conflict");
    }
    await writeAuditTx(tx, {
      user: input.actor,
      organisationId: input.organisationId,
      projectId: input.projectId,
      eventType: "intelligence.review_claimed",
      objectType: "intelligence_capability",
      objectId: input.projectId,
      details: JSON.stringify({
        capabilityId: input.body.capabilityId,
        sourceVersion: input.source.version,
        sourceManifestSha256: input.source.manifestHash,
        reviewVersion: saved.version,
      }),
    });
    return { review: saved, replayed: false };
  });
}

export async function decideIntelligenceReview(input: {
  organisationId: string;
  projectId: string;
  actor: LocalUser;
  source: IntelligenceSourceVersion;
  body: IntelligenceReviewDecisionBody;
}): Promise<IntelligenceReviewMutationResult> {
  if (!isValidIntelligenceReviewerName(input.actor.name)) {
    throw new IntelligenceReviewMutationError("invalid_request");
  }
  assertExpectedSource(input.body, input.source);
  return db.transaction(async (tx) => {
    const existing = await lockAndFind(tx, {
      organisationId: input.organisationId,
      projectId: input.projectId,
      capabilityId: input.body.capabilityId,
    });
    if (!existing) {
      throw new IntelligenceReviewMutationError("not_claimed");
    }
    if (
      bindingMatches(existing, input.source) &&
      existing.reviewerUserId === input.actor.id &&
      existing.status === input.body.decision
    ) {
      if (
        !isImmediateIntelligenceReviewReplay(
          existing.version,
          input.body.expectedReviewVersion,
        )
      ) {
        throw new IntelligenceReviewMutationError("review_changed");
      }
      return { review: existing, replayed: true };
    }
    if (!bindingMatches(existing, input.source)) {
      throw new IntelligenceReviewMutationError("source_changed");
    }
    if (
      existing.reviewerUserId !== input.actor.id ||
      existing.status !== "in_review"
    ) {
      throw new IntelligenceReviewMutationError("not_claimed");
    }
    if (existing.version !== input.body.expectedReviewVersion) {
      throw new IntelligenceReviewMutationError("review_changed");
    }
    const now = new Date();
    const [saved] = await tx
      .update(reviews)
      .set({
        status: input.body.decision,
        findings: findings(input.source.manifestHash, input.body.decision),
        completedAt: now,
        version: sql`${reviews.version} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(reviews.id, existing.id),
          eq(reviews.version, existing.version),
          eq(reviews.reviewerUserId, input.actor.id),
          eq(reviews.status, "in_review"),
        ),
      )
      .returning();
    if (!saved) {
      throw new IntelligenceReviewMutationError("persistence_conflict");
    }
    await writeAuditTx(tx, {
      user: input.actor,
      organisationId: input.organisationId,
      projectId: input.projectId,
      eventType: "intelligence.review_decided",
      objectType: "intelligence_capability",
      objectId: input.projectId,
      details: JSON.stringify({
        capabilityId: input.body.capabilityId,
        decision: input.body.decision,
        sourceVersion: input.source.version,
        sourceManifestSha256: input.source.manifestHash,
        reviewVersion: saved.version,
      }),
    });
    return { review: saved, replayed: false };
  });
}
