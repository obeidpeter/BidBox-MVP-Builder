import { expect, it } from "vitest";
import {
  adaptOpportunityPursuitHandoffPreparation,
  adaptOpportunityPursuitHandoffResult,
} from "./opportunity-pursuit-handoff-contract";

export const ORGANISATION_ID = "11111111-1111-4111-8111-111111111111";
export const CANDIDATE_ID = "22222222-2222-4222-8222-222222222222";

export function readyHandoffResponse() {
  return {
    state: "ready",
    source: {
      candidateId: CANDIDATE_ID,
      candidateVersion: 2,
      sourceReceiptSha256: "a".repeat(64),
      sourceLocator: "https://procurement.example.test/notices/NG-42",
      sourceLocatorSha256: "b".repeat(64),
      tenderId: "33333333-3333-4333-8333-333333333333",
      tenderVersion: 1,
      title: "Representative opportunity",
      buyer: "Representative buyer",
      reference: "NG-42",
      submissionDeadline: "2026-09-01T12:00:00.000Z",
      recordedByName: "Source Recorder",
      confirmedByName: "Source Reviewer",
    },
    clients: [
      {
        id: "44444444-4444-4444-8444-444444444444",
        name: "Representative Client",
        version: 1,
      },
    ],
    reviewers: [
      {
        userId: "55555555-5555-4555-8555-555555555555",
        name: "Independent Reviewer",
      },
    ],
    lots: [
      {
        id: "66666666-6666-4666-8666-666666666666",
        reference: "LOT-1",
        title: "Equipment",
        submissionDeadline: "2026-09-02T12:00:00.000Z",
        version: 1,
      },
    ],
    conflictBoundary: {
      sha256: "c".repeat(64),
      matches: [],
      limit: 100,
      truncated: false,
    },
    authority: {
      sourceReopenRequired: true,
      namedHumanConfirmationRequired: true,
      makerCheckerRequired: true,
      conflictRevalidationRequired: true,
      createdPursuitState: "intake",
      pursuitActivated: false,
      providerFetchPerformed: false,
      autonomousPursuitActivationAllowed: false,
    },
  };
}

it("accepts only the exact tenant, candidate and fail-closed authority contract", () => {
  const response = readyHandoffResponse();
  expect(
    adaptOpportunityPursuitHandoffPreparation(
      response,
      ORGANISATION_ID,
      CANDIDATE_ID,
    ).state,
  ).toBe("ready");
  expect(() =>
    adaptOpportunityPursuitHandoffPreparation(
      {
        ...response,
        authority: { ...response.authority, pursuitActivated: true },
      },
      ORGANISATION_ID,
      CANDIDATE_ID,
    ),
  ).toThrow();
  expect(() =>
    adaptOpportunityPursuitHandoffPreparation(
      response,
      ORGANISATION_ID,
      "77777777-7777-4777-8777-777777777777",
    ),
  ).toThrow();
});

it("rejects unbounded directories, unknown fields and malformed conflict digests", () => {
  const response = readyHandoffResponse();
  expect(() =>
    adaptOpportunityPursuitHandoffPreparation(
      { ...response, rawSourceText: "untrusted" },
      ORGANISATION_ID,
      CANDIDATE_ID,
    ),
  ).toThrow();
  expect(() =>
    adaptOpportunityPursuitHandoffPreparation(
      {
        ...response,
        conflictBoundary: { ...response.conflictBoundary, sha256: "bad" },
      },
      ORGANISATION_ID,
      CANDIDATE_ID,
    ),
  ).toThrow();
  expect(() =>
    adaptOpportunityPursuitHandoffPreparation(
      {
        ...response,
        clients: Array.from({ length: 101 }, () => response.clients[0]),
      },
      ORGANISATION_ID,
      CANDIDATE_ID,
    ),
  ).toThrow();
});

it("keeps the confirmed reference bound identical to the server contract", () => {
  const receipt = {
    schema: "valo.opportunity-pursuit-handoff/v1",
    organisationId: ORGANISATION_ID,
    candidateId: CANDIDATE_ID,
    projectId: "77777777-7777-4777-8777-777777777777",
    clientId: "44444444-4444-4444-8444-444444444444",
    clientVersion: 1,
    tenderId: "33333333-3333-4333-8333-333333333333",
    tenderLotId: null,
    tenderLotVersion: null,
    confirmedLotReference: null,
    reviewerUserId: "55555555-5555-4555-8555-555555555555",
    sourceReceiptSha256: "a".repeat(64),
    sourceLocatorSha256: "b".repeat(64),
    confirmedBuyer: "Representative buyer",
    confirmedReference: "R".repeat(129),
    confirmedSubmissionDeadline: null,
    confirmationNote: "Checked",
    confirmedByUserId: "88888888-8888-4888-8888-888888888888",
    confirmedByName: "Handoff Maker",
    confirmedAt: "2026-08-13T12:00:00.000Z",
    conflictBoundarySha256: "c".repeat(64),
    conflictStatus: "clear",
    matchedProjectId: null,
    projectStatus: "intake",
    idempotencyKeySha256: "d".repeat(64),
    requestSha256: "e".repeat(64),
    receiptSha256: "f".repeat(64),
  };
  expect(() =>
    adaptOpportunityPursuitHandoffResult(
      {
        outcome: "created",
        receipt,
        authority: readyHandoffResponse().authority,
      },
      ORGANISATION_ID,
      CANDIDATE_ID,
    ),
  ).toThrow();
});
