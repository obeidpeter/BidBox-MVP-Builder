import { describe, it, expect } from "vitest";
import {
  computeReadinessChecks,
  paymentGatePasses,
  summarizeReadiness,
  type ReadinessInput,
} from "./readiness";

function baseInput(overrides: Partial<ReadinessInput> = {}): ReadinessInput {
  return {
    project: {
      status: "review",
      reviewerName: "Ada Obi",
      paymentStatus: "not_required",
      paymentConfirmedByFounder: false,
      paymentConfirmedByAdvisor: false,
      conflictStatus: "clear",
      restrictedMode: false,
      redactionScope: null,
      physicalArchiveInstruction: null,
      riskBand: null,
    },
    documents: [
      { type: "tender", redactionStatus: "included", sha256: "a", extractionStatus: "extracted" },
      { type: "bid", redactionStatus: "included", sha256: "b", extractionStatus: "extracted" },
    ],
    requirements: [{ id: "r1", reviewStatus: "confirmed", isMandatory: true }],
    evidence: [{ requirementId: "r1", evidenceStatus: "present" }],
    defects: [],
    boqChecks: [],
    mandatoryRecall: 0.9,
    hasRisk: true,
    computedRiskBand: "low",
    reports: [{ status: "signed_off" }],
    ...overrides,
  };
}

function check(input: ReadinessInput, id: string) {
  const found = computeReadinessChecks(input).find((c) => c.id === id);
  if (!found) throw new Error(`no check ${id}`);
  return found;
}

describe("payment gate", () => {
  it("passes when no payment is required", () => {
    expect(paymentGatePasses({ status: "review", paymentStatus: "not_required" })).toBe(true);
  });

  it("mirrors the server: confirmed status alone is NOT enough", () => {
    expect(
      paymentGatePasses({
        status: "review",
        paymentStatus: "confirmed",
        paymentConfirmedByFounder: true,
        paymentConfirmedByAdvisor: false,
        paymentFounderConfirmedByName: "Ada Obi",
      }),
    ).toBe(false);
    expect(
      paymentGatePasses({
        status: "review",
        paymentStatus: "confirmed",
        paymentConfirmedByFounder: true,
        paymentConfirmedByAdvisor: true,
        paymentFounderConfirmedByName: "Ada Obi",
        paymentAdvisorConfirmedByName: "Chidi Eze",
      }),
    ).toBe(true);
  });

  it("legacy flags without identity stamps do NOT satisfy the gate (matches server)", () => {
    expect(
      paymentGatePasses({
        status: "review",
        paymentStatus: "confirmed",
        paymentConfirmedByFounder: true,
        paymentConfirmedByAdvisor: true,
      }),
    ).toBe(false);

    const input = baseInput();
    input.project.paymentStatus = "confirmed";
    input.project.paymentConfirmedByFounder = true;
    input.project.paymentConfirmedByAdvisor = true;
    const governance = check(input, "governance");
    expect(governance.status).toBe("blocked");
    expect(governance.detail).toMatch(/legacy/i);
  });

  it("blocks the governance check until dual confirmation lands", () => {
    const input = baseInput();
    input.project.paymentStatus = "confirmed";
    input.project.paymentConfirmedByFounder = true;
    input.project.paymentFounderConfirmedByName = "Ada Obi";
    input.project.paymentConfirmedByAdvisor = false;
    const governance = check(input, "governance");
    expect(governance.status).toBe("blocked");
    expect(governance.detail).toMatch(/dual confirmation/i);
  });
});

describe("defect gate", () => {
  it("blocks only on OPEN material defects, matching blockingSignOffDefects", () => {
    const open = baseInput({
      defects: [{ severity: "fatal", status: "open" }],
    });
    expect(check(open, "defects").status).toBe("blocked");

    // Suggested (unconfirmed AI) fatal defects are advisory, never blocking.
    const suggested = baseInput({
      defects: [{ severity: "fatal", status: "suggested" }],
    });
    expect(check(suggested, "defects").status).toBe("warning");

    const remediated = baseInput({
      defects: [{ severity: "fatal", status: "remediated" }],
    });
    expect(check(remediated, "defects").status).toBe("pass");
  });
});

describe("summary", () => {
  it("is ready when no required check is blocked", () => {
    const input = baseInput({
      project: { ...baseInput().project, physicalArchiveInstruction: "Return to client" },
    });
    const summary = summarizeReadiness(computeReadinessChecks(input));
    expect(summary.ready).toBe(true);
    expect(summary.blockedRequired).toBe(0);
  });

  it("surfaces the first blocker as the next action", () => {
    const input = baseInput({ documents: [] });
    const summary = summarizeReadiness(computeReadinessChecks(input));
    expect(summary.ready).toBe(false);
    expect(summary.nextCheck?.id).toBe("documents");
  });
});
