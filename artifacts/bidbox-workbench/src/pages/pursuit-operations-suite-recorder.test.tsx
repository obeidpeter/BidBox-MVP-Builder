import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import PursuitOperationsSuiteRecorder, {
  type OperationsRecorderPermissions,
  type OperationsRecorderRecords,
} from "./pursuit-operations-suite-recorder";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

const RECORDS: OperationsRecorderRecords = {
  workItems: [
    {
      id: "work-1",
      label: "Prepare response",
      version: 4,
      status: "in_progress",
      approvalStatus: "pending",
    },
  ],
  evidenceRequests: [
    {
      id: "request-1",
      label: "Client evidence",
      version: 3,
      status: "response_recorded",
      slots: [
        {
          id: "slot-1",
          label: "Certificate",
          hasResponse: true,
          acceptanceDecision: null,
          priorResponseCount: 0,
          acceptedContentTypes: ["application/pdf"],
        },
        {
          id: "slot-2",
          label: "Replacement certificate",
          hasResponse: true,
          acceptanceDecision: "rejected",
          priorResponseCount: 1,
          acceptedContentTypes: ["application/pdf"],
        },
      ],
    },
  ],
  submissions: [
    {
      id: "room-1",
      label: "Package one",
      version: 2,
      status: "planning",
    },
  ],
  missions: [
    {
      id: "mission-1",
      label: "Site visit",
      version: 2,
      status: "planned",
      checklist: [{ id: "check-1", label: "Delegation letter" }],
    },
  ],
  postAwardItems: [
    {
      id: "award-1",
      label: "Mobilisation plan",
      version: 5,
      status: "open",
      evidenceDocumentIds: [],
    },
  ],
  packageVersions: [
    {
      packageId: "package-1",
      packageVersionId: "package-version-1",
      versionNumber: 2,
      manifestSha256: HASH_A,
      renderQaStatus: "pending",
      createdAt: "2026-08-11T08:00:00.000Z",
    },
  ],
  documents: [
    {
      id: "document-1",
      filename: "certificate.pdf",
      sha256: HASH_A,
      contentType: "application/pdf",
      status: "extraction complete; redaction included",
    },
  ],
  vaultItems: [
    {
      id: "vault-1",
      label: "Tax clearance — Revenue authority",
      version: 6,
      documentSha256: HASH_A,
      status: "active",
    },
  ],
};

const NO_PERMISSIONS: OperationsRecorderPermissions = {
  projectUpdate: false,
  projectAssign: false,
  evidenceWrite: false,
  evidenceApprove: false,
  packageExport: false,
  packageGenerate: false,
};

function renderRecorder(
  permissions: Partial<OperationsRecorderPermissions>,
  onCommand = vi.fn(),
) {
  const result = render(
    <PursuitOperationsSuiteRecorder
      permissions={{ ...NO_PERMISSIONS, ...permissions }}
      records={RECORDS}
      currentUserId="user-current"
      online
      onCommand={onCommand}
    />,
  );
  const openPanel = (title: string) => {
    const summary = screen.getByText(title);
    const details = summary.closest("details");
    if (!details) throw new Error(`Missing recorder panel: ${title}`);
    if (!details.open) fireEvent.click(summary);
  };
  return { ...result, onCommand, openPanel };
}

describe("PursuitOperationsSuiteRecorder", () => {
  it("exposes all eight bounded domains and their essential mutation controls", () => {
    const { openPanel } = renderRecorder({
      projectUpdate: true,
      projectAssign: true,
      evidenceWrite: true,
      evidenceApprove: true,
      packageExport: true,
      packageGenerate: true,
    });
    for (const title of [
      "1. Opportunity intake",
      "2. Pursuit work",
      "3. Client evidence request",
      "4. Submission tracking",
      "5. Visual package checks",
      "6. Credential verification",
      "7. Pre-bid and site-visit mission",
      "8. Post-award delivery",
    ]) {
      openPanel(title);
    }

    for (const action of [
      "Record opportunity source",
      "Record work item",
      "Record comment",
      "Record work status",
      "Record approval decision",
      "Record request draft",
      "Mark manually shared",
      "Record uploaded response",
      "Record response decision",
      "Create submission custody room",
      "Record custody stage",
      "Evaluate and record visual QA",
      "Record human credential check",
      "Record mission plan",
      "Record mission update",
      "Record post-award item",
      "Record post-award update",
    ]) {
      expect(screen.getByRole("button", { name: action })).toBeEnabled();
    }
  });

  it("separates work assignment and evidence approval from write controls", () => {
    const work = renderRecorder({ projectAssign: true });
    work.openPanel("2. Pursuit work");
    expect(
      screen.getByRole("button", { name: "Record work item" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Record comment" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Record approval decision" }),
    ).toBeEnabled();
    work.unmount();

    const evidence = renderRecorder({ evidenceApprove: true });
    evidence.openPanel("3. Client evidence request");
    expect(
      screen.getByRole("button", { name: "Record request draft" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Record uploaded response" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Record response decision" }),
    ).toBeEnabled();
    expect(screen.getByLabelText("Responded request slot")).toHaveTextContent(
      "Certificate · slot-1 · response awaiting decision",
    );
  });

  it("discovers server-generated mission checklist and follow-up work IDs", async () => {
    const user = userEvent.setup();
    const { openPanel } = renderRecorder({ projectUpdate: true });
    openPanel("7. Pre-bid and site-visit mission");

    await user.selectOptions(
      screen.getByLabelText("Current mission"),
      "mission-1",
    );
    expect(
      screen.getByLabelText("Completed checklist item (optional)"),
    ).toHaveTextContent("Delegation letter · check-1");
    expect(
      screen.getByLabelText("Follow-up work item (optional)"),
    ).toHaveTextContent("Prepare response · work-1");
  });

  it("assigns work, mission and post-award records to the authenticated operator", async () => {
    const user = userEvent.setup();
    const onCommand = vi.fn();
    const { openPanel } = renderRecorder({ projectUpdate: true }, onCommand);
    openPanel("2. Pursuit work");
    openPanel("7. Pre-bid and site-visit mission");
    openPanel("8. Post-award delivery");

    await user.type(screen.getByLabelText("Work title"), "Prepare response");
    await user.selectOptions(
      screen.getByLabelText("Work owner"),
      "user-current",
    );
    await user.click(screen.getByRole("button", { name: "Record work item" }));
    expect(onCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/operations-suite/work-items",
        body: expect.objectContaining({ ownerUserId: "user-current" }),
      }),
    );

    await user.type(screen.getByLabelText("Mission title"), "Site briefing");
    await user.type(screen.getByLabelText("Location"), "Abuja office");
    await user.type(
      screen.getByLabelText("Start time, ISO"),
      "2026-08-20T09:00:00.000Z",
    );
    await user.selectOptions(
      screen.getByLabelText("Mission delegate"),
      "user-current",
    );
    await user.type(
      screen.getByLabelText("Delegate authority note (required with delegate)"),
      "The authenticated operator recorded their delegated authority.",
    );
    await user.click(screen.getByLabelText(/^Checklist JSON/u));
    await user.paste("[]");
    await user.click(
      screen.getByRole("button", { name: "Record mission plan" }),
    );
    expect(onCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/operations-suite/missions",
        body: expect.objectContaining({
          delegateUserId: "user-current",
          delegateAuthorityNote:
            "The authenticated operator recorded their delegated authority.",
        }),
      }),
    );

    await user.type(
      screen.getByLabelText("Title", { selector: "#postTitle" }),
      "Mobilisation plan",
    );
    await user.selectOptions(
      screen.getByLabelText("Post-award owner"),
      "user-current",
    );
    await user.click(
      screen.getByRole("button", { name: "Record post-award item" }),
    );
    expect(onCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/operations-suite/post-award-items",
        body: expect.objectContaining({ ownerUserId: "user-current" }),
      }),
    );

    await user.selectOptions(
      screen.getByLabelText("Current post-award item"),
      "award-1",
    );
    await user.selectOptions(
      screen.getByLabelText("Updated post-award owner"),
      "user-current",
    );
    await user.click(
      screen.getByRole("button", { name: "Record post-award update" }),
    );
    expect(onCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/operations-suite/post-award-items/award-1",
        body: {
          expectedVersion: 5,
          ownerUserId: "user-current",
        },
      }),
    );
  }, 15_000);

  it("records credential provenance against a canonical vault version and document hash", async () => {
    const user = userEvent.setup();
    const { onCommand, openPanel } = renderRecorder({ evidenceApprove: true });
    openPanel("6. Credential verification");

    await user.selectOptions(
      screen.getByLabelText(/^Active evidence item and current document/u),
      "vault-1",
    );
    await user.type(
      screen.getByLabelText("Official authority name"),
      "Revenue authority",
    );
    await user.type(
      screen.getByLabelText("Official source locator"),
      "https://verify.example.test/credential",
    );
    await user.type(
      screen.getByLabelText("Human checked time, ISO"),
      "2026-08-11T09:00:00.000Z",
    );
    await user.type(screen.getByLabelText("Check receipt SHA-256"), HASH_B);
    await user.click(
      screen.getByRole("button", { name: "Record human credential check" }),
    );

    expect(onCommand).toHaveBeenCalledWith({
      path: "/operations-suite/credential-verifications",
      method: "POST",
      successTitle: "Human credential check recorded",
      body: {
        vaultItemId: "vault-1",
        vaultItemVersion: 6,
        documentSha256: HASH_A,
        authorityName: "Revenue authority",
        officialSourceLocator: "https://verify.example.test/credential",
        checkedAt: "2026-08-11T09:00:00.000Z",
        outcome: "verified",
        receiptSha256: HASH_B,
      },
    });
  }, 15_000);

  it("requires and sends a human reason for work cancellation", async () => {
    const user = userEvent.setup();
    const { onCommand, openPanel } = renderRecorder({ projectUpdate: true });
    openPanel("2. Pursuit work");

    await user.selectOptions(
      screen.getByLabelText("Current work item", { selector: "#statusWorkId" }),
      "work-1",
    );
    await user.selectOptions(screen.getByLabelText("Next status"), "cancelled");
    await user.type(
      screen.getByLabelText("Status reason (required for cancellation)"),
      "Pursuit formally withdrawn by the named bid manager.",
    );
    await user.click(
      screen.getByRole("button", { name: "Record work status" }),
    );

    expect(onCommand).toHaveBeenCalledWith({
      path: "/operations-suite/work-items/work-1",
      method: "PATCH",
      successTitle: "Work status recorded",
      body: {
        expectedVersion: 4,
        status: "cancelled",
        reason: "Pursuit formally withdrawn by the named bid manager.",
      },
    });
  });

  it("binds custody and visual QA to the selected canonical package version", async () => {
    const user = userEvent.setup();
    const { onCommand, openPanel } = renderRecorder({
      packageExport: true,
      packageGenerate: true,
    });
    openPanel("4. Submission tracking");
    openPanel("5. Visual package checks");

    await user.selectOptions(
      screen.getByLabelText("Approved package version", {
        selector: "#submissionPackageVersion",
      }),
      "package-version-1",
    );
    await user.click(
      screen.getByRole("button", { name: "Create submission custody room" }),
    );
    expect(onCommand).toHaveBeenCalledWith({
      path: "/operations-suite/submission-war-rooms",
      method: "POST",
      successTitle: "Submission custody room recorded",
      body: {
        packageId: "package-1",
        packageVersionId: "package-version-1",
        manifestSha256: HASH_A,
        copyCount: 0,
        sealIdentifiers: [],
      },
    });

    await user.selectOptions(
      screen.getByLabelText("Approved package version", {
        selector: "#qaPackageVersion",
      }),
      "package-version-1",
    );
    await user.click(screen.getByLabelText(/^Page metrics JSON/u));
    await user.paste("[]");
    await user.click(
      screen.getByRole("button", { name: "Evaluate and record visual QA" }),
    );
    expect(onCommand).toHaveBeenCalledWith({
      path: "/operations-suite/visual-qa-reports",
      method: "POST",
      successTitle: "Visual QA metrics evaluated and recorded",
      body: {
        packageVersionId: "package-version-1",
        manifestSha256: HASH_A,
        expectedManifestSha256: HASH_A,
        pages: [],
      },
    });
  });

  it("binds evidence, mission proof and post-award completion to canonical documents", async () => {
    const user = userEvent.setup();
    const onCommand = vi.fn();
    const { openPanel } = renderRecorder(
      { evidenceWrite: true, projectUpdate: true },
      onCommand,
    );
    openPanel("3. Client evidence request");
    openPanel("7. Pre-bid and site-visit mission");
    openPanel("8. Post-award delivery");

    await user.selectOptions(
      screen.getByLabelText("Current request slot", {
        selector: "#responseEvidenceSlot",
      }),
      "request-1/slot-2",
    );
    await user.selectOptions(
      screen.getByLabelText("Approved uploaded document"),
      "document-1",
    );
    await user.type(
      screen.getByLabelText("Named operator confirmation"),
      "Selected from the current authorised project document list.",
    );
    await user.click(
      screen.getByRole("button", { name: "Record uploaded response" }),
    );
    expect(onCommand).toHaveBeenCalledWith({
      path: "/operations-suite/evidence-requests/request-1/responses",
      method: "POST",
      successTitle: "Evidence response recorded",
      body: {
        expectedVersion: 3,
        slotId: "slot-2",
        documentId: "document-1",
        sha256: HASH_A,
        attestation:
          "Selected from the current authorised project document list.",
      },
    });

    await user.selectOptions(
      screen.getByLabelText("Current mission"),
      "mission-1",
    );
    await user.selectOptions(
      screen.getByLabelText(/^Approved visit proof document \(optional\)/u),
      "document-1",
    );
    await user.click(
      screen.getByRole("button", { name: "Record mission update" }),
    );
    expect(onCommand).toHaveBeenCalledWith({
      path: "/operations-suite/missions/mission-1",
      method: "PATCH",
      successTitle: "Mission update recorded",
      body: {
        expectedVersion: 2,
        proofDocumentId: "document-1",
        proofSha256: HASH_A,
      },
    });

    await user.selectOptions(
      screen.getByLabelText("Current post-award item"),
      "award-1",
    );
    await user.selectOptions(
      screen.getByLabelText(
        /^Approved completion evidence or receipt \(optional\)/u,
      ),
      "document-1",
    );
    await user.selectOptions(
      screen.getByLabelText("Status (optional)", {
        selector: "#postUpdateStatus",
      }),
      "satisfied",
    );
    await user.click(
      screen.getByRole("button", { name: "Record post-award update" }),
    );
    expect(onCommand).toHaveBeenCalledWith({
      path: "/operations-suite/post-award-items/award-1",
      method: "PATCH",
      successTitle: "Post-award update recorded",
      body: {
        expectedVersion: 5,
        status: "satisfied",
        evidenceDocumentIds: ["document-1"],
        completionReceiptSha256: HASH_A,
      },
    });
  }, 15_000);
});
