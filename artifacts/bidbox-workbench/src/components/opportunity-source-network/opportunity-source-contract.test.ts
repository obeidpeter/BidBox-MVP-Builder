import { expect, it } from "vitest";
import { adaptOpportunitySourceSnapshot } from "./opportunity-source-contract";

const organisationId = "11111111-1111-4111-8111-111111111111";
const candidate = {
  id: "22222222-2222-4222-8222-222222222222",
  organisationId,
  sourceKind: "manual_url",
  provenance: "operator_recorded",
  sourceSystem: "nocopo",
  sourceAuthority: "BPP",
  sourceLocator: "https://nocopo.bpp.gov.ng/opportunities/42",
  sourceLicenceReference: null,
  sourceLocatorSha256: "a".repeat(64),
  sourceContentSha256: null,
  receiptSha256: "b".repeat(64),
  dedupeKey: "c".repeat(64),
  externalReference: "NG-42",
  title: "Representative tender",
  procuringEntity: "Representative entity",
  jurisdiction: "NG",
  fundingSource: null,
  procurementCategory: null,
  publishedAt: null,
  submissionDeadline: null,
  observedAt: "2026-08-11T08:00:00.000Z",
  status: "pending_review",
  version: 1,
  recordedByUserId: "33333333-3333-4333-8333-333333333333",
  recordedByName: "Named Reviewer",
  reviewedByUserId: null,
  reviewedByName: null,
  reviewedAt: null,
  decisionReason: null,
  tenderId: null,
};

it("rejects cross-tenant and permissive authority responses", () => {
  const response = {
    items: [candidate],
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
  expect(
    adaptOpportunitySourceSnapshot(response, organisationId).items,
  ).toHaveLength(1);
  expect(() =>
    adaptOpportunitySourceSnapshot(
      response,
      "44444444-4444-4444-8444-444444444444",
    ),
  ).toThrow();
  expect(() =>
    adaptOpportunitySourceSnapshot(
      {
        ...response,
        authority: { ...response.authority, autonomousScrapingAllowed: true },
      },
      organisationId,
    ),
  ).toThrow();
});
