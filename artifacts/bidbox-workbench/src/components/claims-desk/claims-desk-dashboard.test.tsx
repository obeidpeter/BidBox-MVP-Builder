import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  adaptClaimsDeskSnapshot,
  parseBindingLines,
  type ClaimsDeskSnapshot,
} from "./claims-desk-contract";
import { ClaimsDeskDashboard } from "./claims-desk-dashboard";

const ORG = "10000000-0000-4000-8000-000000000001";
const PROJECT = "20000000-0000-4000-8000-000000000002";
const RECORD = "30000000-0000-4000-8000-000000000003";
const ACTOR = "40000000-0000-4000-8000-000000000004";
const DOC = "50000000-0000-4000-8000-000000000005";
const SHA = "a".repeat(64);

function snapshot(): ClaimsDeskSnapshot {
  return {
    organisationId: ORG,
    projectId: PROJECT,
    projectStatus: "review",
    records: [
      {
        id: RECORD,
        organisationId: ORG,
        projectId: PROJECT,
        recordType: "claim",
        reference: "CLM-001",
        eventDate: "2026-08-01",
        dueAt: "2026-08-20T12:00:00.000Z",
        amountMinor: 125_000,
        currency: "NGN",
        documentBindings: [{ documentId: DOC, sha256: SHA }],
        status: "under_review",
        assessmentCode: null,
        pendingMakerUserId: null,
        version: 2,
        createdByUserId: ACTOR,
        createdAt: "2026-08-01T12:00:00.000Z",
        updatedAt: "2026-08-02T12:00:00.000Z",
        latestReceiptSha256: SHA,
        reasonHistory: [
          {
            action: "start_review",
            reasonCode: "evidence_received",
            assessmentCode: null,
            fromStatus: "registered",
            toStatus: "under_review",
            actorUserId: ACTOR,
            occurredAt: "2026-08-02T12:00:00.000Z",
            receiptSha256: "b".repeat(64),
          },
        ],
      },
    ],
    posture: {
      total: 1,
      open: 1,
      overdue: 0,
      dueSoon: 1,
      awaitingChecker: 0,
      terminal: 0,
    },
    truncated: false,
    generatedAt: "2026-08-11T12:00:00.000Z",
    legalConclusionAutomated: false,
    noticeDispatched: false,
    paymentMutated: false,
    authorityNote: "Human workflow evidence only; no legal or payment action.",
  };
}

describe("ClaimsDeskDashboard", () => {
  it("shows bounded posture, minor units and immutable evidence", () => {
    render(<ClaimsDeskDashboard snapshot={snapshot()} />);
    expect(screen.getByRole("heading", { name: "Claims" })).toBeInTheDocument();
    expect(screen.getByText("Awaiting second review")).toBeInTheDocument();
    expect(screen.getByText("NGN 125,000 minor units")).toBeInTheDocument();
    expect(screen.getByText("Reason history (1)")).toBeInTheDocument();
  });

  it("accepts a server-shaped snapshot with bindings and reason history", () => {
    // Regression: binding() and history() once carried each other's key
    // lists, so any snapshot containing a real record failed the closed
    // contract and the desk showed only its error state. The positive path
    // must stay asserted.
    const adapted = adaptClaimsDeskSnapshot(snapshot(), ORG, PROJECT);
    expect(adapted.records).toHaveLength(1);
    expect(adapted.records[0]?.documentBindings).toEqual([
      { documentId: DOC, sha256: SHA },
    ]);
    expect(adapted.records[0]?.reasonHistory[0]?.action).toBe("start_review");
  });

  it("rejects malformed bindings and history entries individually", () => {
    const withBinding = (binding: unknown) => {
      const base = snapshot();
      base.records[0]!.documentBindings = [
        binding as (typeof base.records)[number]["documentBindings"][number],
      ];
      return base;
    };
    expect(() =>
      adaptClaimsDeskSnapshot(
        withBinding({ documentId: DOC, sha256: SHA, extra: true }),
        ORG,
        PROJECT,
      ),
    ).toThrow(/closed contract/u);
    expect(() =>
      adaptClaimsDeskSnapshot(
        withBinding({ documentId: DOC, sha256: "not-a-sha" }),
        ORG,
        PROJECT,
      ),
    ).toThrow(/closed contract/u);

    const withHistory = (entry: Record<string, unknown>) => {
      const base = snapshot();
      base.records[0]!.reasonHistory = [
        entry as unknown as (typeof base.records)[number]["reasonHistory"][number],
      ];
      return base;
    };
    const validEntry = () => ({
      action: "start_review",
      reasonCode: "evidence_received",
      assessmentCode: null,
      fromStatus: "registered",
      toStatus: "under_review",
      actorUserId: ACTOR,
      occurredAt: "2026-08-02T12:00:00.000Z",
      receiptSha256: "b".repeat(64),
    });
    expect(() =>
      adaptClaimsDeskSnapshot(
        withHistory({ ...validEntry(), toStatus: "not_a_status" }),
        ORG,
        PROJECT,
      ),
    ).toThrow(/closed contract/u);
    const missingKey = validEntry() as Record<string, unknown>;
    delete missingKey.receiptSha256;
    expect(() =>
      adaptClaimsDeskSnapshot(withHistory(missingKey), ORG, PROJECT),
    ).toThrow(/closed contract/u);
  });

  it("fails closed on unknown response keys, automated claims and scope mismatch", () => {
    expect(() =>
      adaptClaimsDeskSnapshot(
        { ...snapshot(), unexpected: true },
        ORG,
        PROJECT,
      ),
    ).toThrow(/closed contract/u);
    expect(() =>
      adaptClaimsDeskSnapshot(
        { ...snapshot(), legalConclusionAutomated: true },
        ORG,
        PROJECT,
      ),
    ).toThrow(/closed contract/u);
    expect(() => adaptClaimsDeskSnapshot(snapshot(), ORG, RECORD)).toThrow(
      /closed contract/u,
    );
  });

  it("parses only unique approved document ID and SHA-256 pairs", () => {
    expect(parseBindingLines(`${DOC} ${SHA}`)).toHaveLength(1);
    expect(() => parseBindingLines(`${DOC} ${SHA}\n${DOC} ${SHA}`)).toThrow(
      /once/u,
    );
    expect(() => parseBindingLines(`${DOC} raw-content`)).toThrow(/SHA-256/u);
  });
});
