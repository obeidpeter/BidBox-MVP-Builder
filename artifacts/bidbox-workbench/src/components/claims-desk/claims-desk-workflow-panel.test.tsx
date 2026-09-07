import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ClaimsDeskRecord } from "./claims-desk-contract";
import {
  ClaimsDeskCreatePanel,
  ClaimsDeskTransitionPanel,
} from "./claims-desk-workflow-panel";

const DOC = "10000000-0000-4000-8000-000000000001";
const SHA = "a".repeat(64);
const options = [
  {
    documentId: DOC,
    projectId: "40000000-0000-4000-8000-000000000004",
    filename: "claim-evidence.pdf",
    projectTitle: "Claims project",
    sha256: SHA,
    versionNumber: 1,
    detectedMime: "application/pdf",
    sizeBytes: 128,
    privacyEligible: true,
  },
];

function record(status: string): ClaimsDeskRecord {
  return {
    id: "20000000-0000-4000-8000-000000000002",
    organisationId: "30000000-0000-4000-8000-000000000003",
    projectId: "40000000-0000-4000-8000-000000000004",
    recordType: "claim",
    reference: "CLM-001",
    eventDate: "2026-08-01",
    dueAt: null,
    amountMinor: null,
    currency: null,
    documentBindings: [{ documentId: DOC, sha256: SHA }],
    status,
    assessmentCode: null,
    pendingMakerUserId:
      status === "assessment_proposed"
        ? "50000000-0000-4000-8000-000000000005"
        : null,
    version: 1,
    createdByUserId: "50000000-0000-4000-8000-000000000005",
    createdAt: "2026-08-01T12:00:00.000Z",
    updatedAt: "2026-08-01T12:00:00.000Z",
    latestReceiptSha256: SHA,
    reasonHistory: [],
  };
}

describe("Claims Desk workflow panels", () => {
  it("labels amounts as integer minor units and canonical document evidence", () => {
    render(
      <ClaimsDeskCreatePanel
        pending={false}
        evidenceOptions={options}
        onCreate={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/do not establish legal entitlement/u),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Approved document evidence")).toBeRequired();
  });

  it("does not enable evidence-dependent actions without a current selection", () => {
    const unboundRecord = {
      ...record("registered"),
      documentBindings: [],
    };
    const { rerender } = render(
      <ClaimsDeskCreatePanel
        pending={false}
        evidenceOptions={[]}
        onCreate={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Record evidence" }),
    ).toBeDisabled();
    rerender(
      <ClaimsDeskTransitionPanel
        records={[unboundRecord]}
        evidenceOptions={[]}
        pending={false}
        onTransition={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Record Start review" }),
    ).toBeDisabled();
  });

  it("shows only controlled actions for the current state", async () => {
    const user = userEvent.setup();
    render(
      <ClaimsDeskTransitionPanel
        records={[record("assessment_proposed")]}
        evidenceOptions={options}
        pending={false}
        onTransition={vi.fn()}
      />,
    );
    expect(
      screen.getByText("A different reviewer must approve this"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("combobox", { name: "Action" }));
    expect(
      screen.getByRole("option", { name: "Approve assessment" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Return assessment" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "Approve closure" }),
    ).not.toBeInTheDocument();
  });

  it("preserves a previously bound document outside the bounded option page", () => {
    const older = record("registered");
    older.documentBindings = [
      {
        documentId: "60000000-0000-4000-8000-000000000006",
        sha256: "c".repeat(64),
      },
    ];
    render(
      <ClaimsDeskTransitionPanel
        records={[older]}
        evidenceOptions={options}
        evidenceOptionsTruncated
        pending={false}
        onTransition={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("option", {
        name: "Previously attached document 1 — checked again on submit",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Record Start review" }),
    ).toBeEnabled();
    expect(
      screen.queryByText(older.documentBindings[0]!.documentId),
    ).not.toBeInTheDocument();
  });
});
