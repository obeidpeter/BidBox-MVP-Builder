import assert from "node:assert/strict";
import test from "node:test";
import { sha256Text, type SourceDocument } from "./domain";
import { composeNigerianContentPlan } from "./nigerianContentComposer";

const accepted = {
  state: "accepted" as const,
  reviewerId: "reviewer-1",
  reviewedAt: "2026-08-10T10:00:00.000Z",
};
const content =
  "BidBox has 12 verified Nigerian engineers available for this pursuit.";
const source: SourceDocument = {
  sourceId: "staff-register",
  versionId: "v1",
  kind: "company_evidence",
  title: "Staff register",
  content,
  contentSha256: sha256Text(content),
  capturedAt: "2026-08-09T10:00:00.000Z",
  authority: "authoritative",
  origin: "vault:staff-register",
};
const fact = {
  externalId: "engineers",
  category: "personnel" as const,
  statement: content,
  quantifiedValue: 12,
  quantifiedUnit: "count" as const,
  citations: [
    {
      sourceId: source.sourceId,
      sourceVersionId: source.versionId,
      contentSha256: source.contentSha256,
      startOffset: 0,
      endOffset: content.length,
      quote: content,
    },
  ],
  availabilityReview: accepted,
};

test("composes only verified plan lines and requires exact named reviews", () => {
  const first = composeNigerianContentPlan({
    sources: [source],
    facts: [fact],
  });
  const lineId = first.lines[0]?.lineId;
  assert.ok(lineId);
  const second = composeNigerianContentPlan({
    sources: [source],
    facts: [fact],
    lineReviews: { [lineId]: accepted },
  });
  const ready = composeNigerianContentPlan({
    sources: [source],
    facts: [fact],
    lineReviews: { [lineId]: accepted },
    planReview: { subjectId: second.planId, review: accepted },
  });
  assert.equal(ready.status, "ready");
  assert.equal(ready.lines[0]?.usable, true);
  assert.equal(ready.planReview.state, "accepted");
  assert.equal(ready.commitmentAuthority, "none");
  assert.equal(ready.safety.externalAction, "none");
});

test("binds quantified commitments to the exact cited statement", () => {
  const result = composeNigerianContentPlan({
    sources: [source],
    facts: [{ ...fact, quantifiedValue: 25 }],
  });
  assert.equal(result.status, "blocked");
  assert.equal(
    result.issues.some(
      (issue) => issue.code === "nigerian_content_quantity_not_cited",
    ),
    true,
  );
});

test("does not relabel a cited duration as a headcount", () => {
  const durationContent = "Training will run for 12 days.";
  const durationSource = {
    ...source,
    sourceId: "training-plan",
    content: durationContent,
    contentSha256: sha256Text(durationContent),
  };
  const result = composeNigerianContentPlan({
    sources: [durationSource],
    facts: [
      {
        ...fact,
        category: "training",
        statement: durationContent,
        quantifiedUnit: "count",
        citations: [
          {
            ...fact.citations[0],
            sourceId: durationSource.sourceId,
            contentSha256: durationSource.contentSha256,
            endOffset: durationContent.length,
            quote: durationContent,
          },
        ],
      },
    ],
  });
  assert.equal(result.status, "blocked");
  assert.equal(
    result.issues.some(
      (issue) => issue.code === "nigerian_content_quantity_not_cited",
    ),
    true,
  );
});

test("does not relabel personnel evidence as equipment", () => {
  const result = composeNigerianContentPlan({
    sources: [source],
    facts: [{ ...fact, category: "equipment" }],
  });
  assert.equal(result.status, "blocked");
  assert.equal(
    result.issues.some(
      (issue) => issue.code === "nigerian_content_category_not_cited",
    ),
    true,
  );
});

test("a final plan review cannot transfer after line review changes", () => {
  const draft = composeNigerianContentPlan({
    sources: [source],
    facts: [fact],
  });
  const lineId = draft.lines[0]!.lineId;
  const reviewed = composeNigerianContentPlan({
    sources: [source],
    facts: [fact],
    lineReviews: { [lineId]: accepted },
  });
  const changed = composeNigerianContentPlan({
    sources: [source],
    facts: [fact],
    lineReviews: {
      [lineId]: { ...accepted, reviewerId: "reviewer-2" },
    },
    planReview: { subjectId: reviewed.planId, review: accepted },
  });
  assert.notEqual(changed.planId, reviewed.planId);
  assert.equal(changed.status, "blocked");
});

test("blocks invented or unverified Nigerian-content claims", () => {
  const result = composeNigerianContentPlan({
    sources: [{ ...source, authority: "unverified" }],
    facts: [{ ...fact, statement: "BidBox has 100 engineers." }],
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.lines.length, 0);
  assert.equal(
    result.issues.some(
      (issue) => issue.code === "nigerian_content_source_not_verified",
    ),
    true,
  );
});

test("rejects impossible percentage commitments", () => {
  const result = composeNigerianContentPlan({
    sources: [source],
    facts: [{ ...fact, quantifiedValue: 120, quantifiedUnit: "percent" }],
  });
  assert.equal(result.status, "blocked");
  assert.equal(
    result.issues.some(
      (issue) => issue.code === "invalid_nigerian_content_quantity",
    ),
    true,
  );
});

test("rejects fractional headcounts and unbounded quantified values", () => {
  const fractionalContent =
    "BidBox has 1.5 verified Nigerian personnel available.";
  const fractionalSource = {
    ...source,
    sourceId: "fractional-staff",
    content: fractionalContent,
    contentSha256: sha256Text(fractionalContent),
  };
  const fractional = composeNigerianContentPlan({
    sources: [fractionalSource],
    facts: [
      {
        ...fact,
        statement: fractionalContent,
        quantifiedValue: 1.5,
        citations: [
          {
            ...fact.citations[0],
            sourceId: fractionalSource.sourceId,
            contentSha256: fractionalSource.contentSha256,
            endOffset: fractionalContent.length,
            quote: fractionalContent,
          },
        ],
      },
    ],
  });
  const unbounded = composeNigerianContentPlan({
    sources: [source],
    facts: [{ ...fact, quantifiedValue: 1e308 }],
  });
  for (const result of [fractional, unbounded]) {
    assert.equal(result.status, "blocked");
    assert.equal(
      result.issues.some(
        (issue) => issue.code === "invalid_nigerian_content_quantity",
      ),
      true,
    );
  }
});

test("a plan-line review cannot transfer to a different availability attestation", () => {
  const first = composeNigerianContentPlan({
    sources: [source],
    facts: [fact],
  });
  const lineId = first.lines[0]?.lineId;
  assert.ok(lineId);
  const changed = composeNigerianContentPlan({
    sources: [source],
    facts: [
      {
        ...fact,
        availabilityReview: { ...accepted, reviewerId: "reviewer-2" },
      },
    ],
    lineReviews: { [lineId]: accepted },
  });
  assert.notEqual(changed.lines[0]?.lineId, lineId);
  assert.equal(changed.status, "blocked");
});
