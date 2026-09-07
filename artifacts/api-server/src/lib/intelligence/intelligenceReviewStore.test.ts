import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??=
  "postgresql://test:test@database.test.invalid:5432/bidbox_test";

const {
  claimIntelligenceReview,
  decideIntelligenceReview,
  IntelligenceReviewMutationError,
  isImmediateIntelligenceReviewReplay,
  isValidIntelligenceReviewerName,
  intelligenceReviewManifestFromFindings,
  intelligenceReviewId,
  parseIntelligenceReviewFindings,
  parseIntelligenceReviewClaimBody,
  parseIntelligenceReviewDecisionBody,
} = await import("./intelligenceReviewStore");

const sourceManifest = "a".repeat(64);

test("review authority requires a real bounded users.name", () => {
  assert.equal(isValidIntelligenceReviewerName("Amina Bello"), true);
  assert.equal(isValidIntelligenceReviewerName("A".repeat(512)), true);
  for (const invalid of [
    null,
    "",
    "   ",
    "\u200B",
    " Amina Bello",
    "Amina Bello ",
    "Amina\nBello",
    "Assigned reviewer",
    "ASSIGNED REVIEWER",
    "A".repeat(513),
  ]) {
    assert.equal(isValidIntelligenceReviewerName(invalid), false);
  }
});

test("claim and decision stores reject unnamed authority before persistence", async () => {
  const common = {
    organisationId: "00000000-0000-4000-8000-000000000001",
    projectId: "00000000-0000-4000-8000-000000000002",
    actor: { name: null } as never,
    source: {} as never,
  };
  const invalidRequest = (error: unknown) =>
    error instanceof IntelligenceReviewMutationError &&
    error.code === "invalid_request";

  await assert.rejects(
    claimIntelligenceReview({
      ...common,
      body: {
        capabilityId: "evidence_graph",
        expectedSourceVersion: 1,
        expectedSourceManifestSha256: sourceManifest,
        expectedReviewVersion: null,
      },
    }),
    invalidRequest,
  );
  await assert.rejects(
    decideIntelligenceReview({
      ...common,
      body: {
        capabilityId: "evidence_graph",
        expectedSourceVersion: 1,
        expectedSourceManifestSha256: sourceManifest,
        expectedReviewVersion: 1,
        decision: "approved",
      },
    }),
    invalidRequest,
  );
});

test("optimistic replay accepts only the immediate predecessor", () => {
  assert.equal(isImmediateIntelligenceReviewReplay(1, null), true);
  assert.equal(isImmediateIntelligenceReviewReplay(2, 1), true);
  assert.equal(isImmediateIntelligenceReviewReplay(19, 18), true);

  for (const [persisted, expected] of [
    [2, null],
    [2, 2],
    [2, 0],
    [3, 1],
    [1, 1],
    [0, null],
    [2, Number.NaN],
    [2, 1.5],
  ] as const) {
    assert.equal(
      isImmediateIntelligenceReviewReplay(persisted, expected),
      false,
    );
  }
});

test("review identity is deterministic and capability scoped", () => {
  const base = {
    organisationId: "00000000-0000-4000-8000-000000000001",
    projectId: "00000000-0000-4000-8000-000000000002",
    capabilityId: "evidence_graph" as const,
  };
  assert.equal(intelligenceReviewId(base), intelligenceReviewId(base));
  assert.match(intelligenceReviewId(base), /^[a-f0-9-]{36}$/u);
  assert.notEqual(
    intelligenceReviewId(base),
    intelligenceReviewId({ ...base, capabilityId: "response_studio" }),
  );
});

test("review claim parser accepts only the exact bounded contract", () => {
  assert.deepEqual(
    parseIntelligenceReviewClaimBody({
      capabilityId: "evidence_graph",
      expectedSourceVersion: 7,
      expectedSourceManifestSha256: sourceManifest,
      expectedReviewVersion: null,
    }),
    {
      capabilityId: "evidence_graph",
      expectedSourceVersion: 7,
      expectedSourceManifestSha256: sourceManifest,
      expectedReviewVersion: null,
    },
  );
  assert.equal(
    parseIntelligenceReviewClaimBody({
      capabilityId: "evidence_graph",
      expectedSourceVersion: 7,
      expectedSourceManifestSha256: sourceManifest,
      expectedReviewVersion: null,
      injected: true,
    }),
    null,
  );
  assert.equal(
    parseIntelligenceReviewClaimBody({
      capabilityId: "not_real",
      expectedSourceVersion: 7,
      expectedSourceManifestSha256: sourceManifest,
      expectedReviewVersion: null,
    }),
    null,
  );
});

test("review decision parser rejects stale shapes and non-decisions", () => {
  assert.equal(
    parseIntelligenceReviewDecisionBody({
      capabilityId: "response_studio",
      expectedSourceVersion: 4,
      expectedSourceManifestSha256: sourceManifest,
      expectedReviewVersion: 2,
      decision: "approved",
    })?.decision,
    "approved",
  );
  assert.equal(
    parseIntelligenceReviewDecisionBody({
      capabilityId: "response_studio",
      expectedSourceVersion: 4,
      expectedSourceManifestSha256: sourceManifest,
      expectedReviewVersion: 2,
      decision: "authoritative_release",
    }),
    null,
  );
});

test("persisted source binding requires the exact closed findings envelope", () => {
  assert.deepEqual(
    parseIntelligenceReviewFindings(
      JSON.stringify({
        schemaVersion: "valo.intelligence-review.v1",
        sourceManifestSha256: sourceManifest,
        decision: "approved",
      }),
    ),
    {
      schemaVersion: "valo.intelligence-review.v1",
      sourceManifestSha256: sourceManifest,
      decision: "approved",
    },
  );
  assert.equal(
    intelligenceReviewManifestFromFindings(
      JSON.stringify({
        schemaVersion: "valo.intelligence-review.v1",
        sourceManifestSha256: sourceManifest,
        decision: "approved",
      }),
    ),
    sourceManifest,
  );
  assert.equal(
    intelligenceReviewManifestFromFindings(
      JSON.stringify({
        schemaVersion: "valo.intelligence-review.v1",
        sourceManifestSha256: sourceManifest,
        decision: "approved",
        extra: true,
      }),
    ),
    null,
  );
});
