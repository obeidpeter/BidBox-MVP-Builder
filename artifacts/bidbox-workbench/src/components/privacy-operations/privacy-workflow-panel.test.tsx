import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { PrivacyOperationsDashboard } from "./privacy-operations-contract";
import { PrivacyWorkflowPanel } from "./privacy-workflow-panel";

const ORGANISATION_ID = "10000000-0000-4000-8000-000000000001";
const DSR_ID = "40000000-0000-4000-8000-000000000004";
const ASSIGNEE_ID = "30000000-0000-4000-8000-000000000003";
const SHA_A = "a".repeat(64);
const DOCUMENT_ID = "70000000-0000-4000-8000-000000000007";
const evidenceOptions = [
  {
    documentId: DOCUMENT_ID,
    projectId: "80000000-0000-4000-8000-000000000008",
    filename: "privacy-evidence.pdf",
    projectTitle: "Governed privacy evidence",
    sha256: SHA_A,
    versionNumber: 1,
    detectedMime: "application/pdf",
    sizeBytes: 128,
    privacyEligible: true,
  },
];

function dashboard(): PrivacyOperationsDashboard {
  return {
    generatedAt: "2026-08-11T12:00:00.000Z",
    organisationId: ORGANISATION_ID,
    boundedTo: 25,
    legalDecisionAutomated: false,
    rawSubjectPiiIncluded: false,
    authorityNote: "Named humans decide.",
    totals: {
      dataSubjectRequests: 1,
      consentRecords: 0,
      legalHolds: 0,
      subprocessors: 0,
      crossBorderTransfers: 0,
      deletionActions: 0,
    },
    truncated: {
      dataSubjectRequests: false,
      consentRecords: false,
      legalHolds: false,
      subprocessors: false,
      crossBorderTransfers: false,
      deletionActions: false,
    },
    dataSubjectRequests: [
      {
        id: DSR_ID,
        requestType: "access",
        identityVerificationStatus: "pending",
        receivedAt: "2026-08-01T12:00:00.000Z",
        dueAt: "2026-08-20T12:00:00.000Z",
        status: "received",
        assignedToUserId: null,
        responseEvidenceState: "missing",
        completedAt: null,
        urgency: "on_track",
        version: 3,
        updatedAt: "2026-08-01T12:00:00.000Z",
      },
    ],
    consentRecords: [],
    legalHolds: [],
    subprocessors: [],
    crossBorderTransfers: [],
    deletionActions: [],
    blockers: [],
  };
}

describe("PrivacyWorkflowPanel", () => {
  it("submits controlled DSR metadata, digest and current CAS version only", async () => {
    const onTriage = vi.fn().mockResolvedValue(undefined);
    render(
      <PrivacyWorkflowPanel
        dashboard={dashboard()}
        evidenceOptions={evidenceOptions}
        assigneeOptions={[{ id: ASSIGNEE_ID, name: "Privacy Assignee" }]}
        onTriage={onTriage}
        onWithdraw={vi.fn().mockResolvedValue(undefined)}
        onReviewHold={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    fireEvent.change(screen.getByLabelText("Data-subject request"), {
      target: { value: DSR_ID },
    });
    fireEvent.change(screen.getByLabelText("Assigned privacy manager"), {
      target: { value: ASSIGNEE_ID },
    });
    fireEvent.change(screen.getByLabelText("Decision evidence"), {
      target: { value: DOCUMENT_ID },
    });
    fireEvent.submit(
      screen
        .getByRole("button", { name: "Record review with version check" })
        .closest("form")!,
    );

    await waitFor(() => expect(onTriage).toHaveBeenCalledTimes(1));
    expect(onTriage).toHaveBeenCalledWith(
      DSR_ID,
      3,
      expect.objectContaining({
        status: "triaged",
        identityVerificationStatus: "pending",
        assignedToUserId: ASSIGNEE_ID,
        reasonCode: "initial_triage",
        decisionEvidenceSha256: SHA_A,
      }),
    );
    const draft = onTriage.mock.calls[0]?.[2];
    expect(draft).not.toHaveProperty("requesterReference");
    expect(draft).not.toHaveProperty("subjectReference");
    expect(draft).not.toHaveProperty("notes");
  });

  it("explains that hold review cannot release or delete data", async () => {
    const user = userEvent.setup();
    render(
      <PrivacyWorkflowPanel
        dashboard={dashboard()}
        evidenceOptions={evidenceOptions}
        assigneeOptions={[{ id: ASSIGNEE_ID, name: "Privacy Assignee" }]}
        onTriage={vi.fn().mockResolvedValue(undefined)}
        onWithdraw={vi.fn().mockResolvedValue(undefined)}
        onReviewHold={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    expect(
      screen.getByText(/cannot release a hold, delete data/iu),
    ).toBeInTheDocument();
    for (const tabName of [
      "Review request",
      "Record withdrawal",
      "Review hold",
    ]) {
      await user.click(screen.getByRole("tab", { name: tabName }));
      expect(
        screen.getByText(/server does not rescan or approve the document/iu),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(/checked again on submit/iu),
      ).not.toBeInTheDocument();
    }
  });

  it("keeps workflows disabled until an external or legacy digest is entered", async () => {
    const user = userEvent.setup();
    render(
      <PrivacyWorkflowPanel
        dashboard={dashboard()}
        evidenceOptions={[]}
        assigneeOptions={[{ id: ASSIGNEE_ID, name: "Privacy Assignee" }]}
        onTriage={vi.fn().mockResolvedValue(undefined)}
        onWithdraw={vi.fn().mockResolvedValue(undefined)}
        onReviewHold={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    expect(
      screen.getByRole("button", {
        name: "Record review with version check",
      }),
    ).toBeDisabled();
    await user.click(screen.getByRole("tab", { name: "Record withdrawal" }));
    expect(
      screen.getByRole("button", { name: "Record withdrawal evidence" }),
    ).toBeDisabled();
    await user.click(screen.getByRole("tab", { name: "Review hold" }));
    expect(
      screen.getByRole("button", { name: "Record hold review" }),
    ).toBeDisabled();
    await user.click(screen.getByRole("tab", { name: "Review request" }));
    fireEvent.change(
      screen.getByLabelText(/External or older decision evidence SHA-256/u),
      { target: { value: SHA_A } },
    );
    expect(
      screen.getByRole("button", {
        name: "Record review with version check",
      }),
    ).toBeEnabled();
  });
});
