import { describe, expect, it } from "vitest";
import { adaptAddendumImpactApplication } from "./addendum-impact-contract";

function validResponse(): Record<string, unknown> {
  return {
    replayed: false,
    authorityNote: "Committed controlled reopening.",
    application: {
      assessmentId: "addimpact-plan-1",
      impactManifestSha256: "d".repeat(64),
      appliedByUserId: "33333333-3333-7333-8333-333333333333",
      appliedByName: "Bola Manager",
      appliedAt: "2026-08-21T11:00:00.000Z",
      reason: "Apply only the reviewed deadline impact.",
      mutationCount: 1,
    },
  };
}

function application(value: Record<string, unknown>): Record<string, unknown> {
  return value.application as Record<string, unknown>;
}

describe("addendum apply response adapter", () => {
  it("returns the exact validated application", () => {
    const response = validResponse();
    expect(adaptAddendumImpactApplication(response)).toEqual(
      response.application,
    );
  });

  const malformedResponses: ReadonlyArray<
    readonly [string, (value: Record<string, unknown>) => void]
  > = [
    ["missing replay marker", (value) => delete value.replayed],
    ["non-boolean replay marker", (value) => (value.replayed = "false")],
    ["missing authority note", (value) => delete value.authorityNote],
    ["empty authority note", (value) => (value.authorityNote = "")],
    ["unexpected response property", (value) => (value.receipt = "extra")],
    [
      "unexpected application property",
      (value) => (application(value).receipt = "extra"),
    ],
    [
      "non-UUID actor",
      (value) => (application(value).appliedByUserId = "actor-1"),
    ],
    [
      "one-character actor name",
      (value) => (application(value).appliedByName = "B"),
    ],
    [
      "date without a time",
      (value) => (application(value).appliedAt = "2026-08-21"),
    ],
    [
      "fractional mutation count",
      (value) => (application(value).mutationCount = 1.5),
    ],
    [
      "oversized mutation count",
      (value) => (application(value).mutationCount = 2_049),
    ],
  ];

  for (const [name, mutate] of malformedResponses) {
    it(`rejects ${name}`, () => {
      const response = validResponse();
      mutate(response);
      expect(() => adaptAddendumImpactApplication(response)).toThrow(
        "Controlled reopening response is invalid",
      );
    });
  }
});
