import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { describe, expect, it, vi } from "vitest";
import type {
  OperationsSuiteActions,
  OperationsSuiteSnapshot,
} from "@/components/operations-suite";
import PursuitOperationsSuite from "./pursuit-operations-suite";

const READY_SNAPSHOT: OperationsSuiteSnapshot = {
  generatedAt: "2026-08-11T08:30:00.000Z",
  opportunities: [
    {
      id: "opportunity-1",
      title: "Network operations framework",
      buyer: "Example Infrastructure Agency",
      reference: "EIA/ICT/2026/14",
      sourceType: "manual_url",
      sourceLabel: "Official procurement notice",
      sourceUrl: "https://example.gov.ng/notices/14",
      deadline: "2026-09-04T11:00:00.000Z",
      provenance: "Recorded by Ada from a manually supplied official URL.",
      status: "needs_confirmation",
      confirmedByName: null,
    },
  ],
  workItems: [
    {
      id: "work-1",
      title: "Map mandatory tax evidence",
      pursuitName: "Network operations framework",
      ownerName: "Ada Okafor",
      assignedToCurrentUser: true,
      status: "in_progress",
      dueAt: "2026-08-15T16:00:00.000Z",
      dependencyCount: 1,
      linkedRequirementCount: 3,
      evidenceCount: 2,
      href: "/projects/project-1/requirements",
    },
  ],
  evidenceRequests: [
    {
      id: "request-1",
      title: "Current tax clearance certificate",
      recipientName: "Client finance lead",
      status: "uploaded",
      dueAt: "2026-08-14T16:00:00.000Z",
      attestationRequired: true,
      uploadCount: 1,
      acceptedByName: null,
      href: "/requests/request-1",
    },
  ],
  submissionPackages: [
    {
      id: "package-1",
      name: "Technical submission",
      version: "v7",
      sha256: "a".repeat(64),
      status: "draft",
      copyCount: 2,
      deliveryMethod: "portal",
      qaChecks: [
        {
          id: "qa-1",
          label: "Unexpected blank pages",
          detail: "No unexpected blank pages were found in the rendered PDF.",
          status: "pass",
        },
        {
          id: "qa-2",
          label: "Signature fields",
          detail: "All required signature fields are present.",
          status: "pass",
        },
      ],
      previewHref: "/packages/package-1/preview",
    },
  ],
  credentialChecks: [
    {
      id: "credential-1",
      credentialName: "Tax clearance certificate",
      issuerName: "Federal Inland Revenue Service",
      reference: "TCC-001",
      status: "unverified",
      officialUrl: "https://example.gov.ng/verify",
    },
  ],
  missionEvents: [
    {
      id: "event-1",
      title: "Mandatory network site visit",
      type: "site_visit",
      status: "planned",
      required: true,
      startsAt: "2026-08-20T09:00:00.000Z",
      location: "Abuja data centre",
      delegateName: null,
      authorityConfirmed: false,
      proofStatus: "missing",
      checklist: ["Carry delegate letter", "Capture signed attendance proof"],
      href: "/events/event-1",
    },
  ],
  obligations: [
    {
      id: "obligation-1",
      title: "Submit mobilisation plan",
      contractName: "Network support contract",
      category: "deliverable",
      ownerName: "Chidi Bello",
      dueAt: "2026-09-10T16:00:00.000Z",
      status: "due",
      evidenceCount: 0,
      href: "/contracts/contract-1/obligations/1",
    },
  ],
  mobileReviewItems: [
    {
      id: "mobile-1",
      title: "Capture courier dispatch receipt",
      kind: "receipt",
      statusLabel: "Awaiting field operator",
      dueLabel: "Today",
      restrictedContent: true,
    },
  ],
};

function makeActions(): Required<OperationsSuiteActions> {
  return {
    onStartOpportunityIntake: vi.fn(),
    onConfirmOpportunity: vi.fn(),
    onChangeWorkStatus: vi.fn(),
    onIssueEvidenceRequest: vi.fn(),
    onAcceptEvidence: vi.fn(),
    onRequestEvidenceChanges: vi.fn(),
    onFreezeSubmissionPackage: vi.fn(),
    onRecordSubmissionReceipt: vi.fn(),
    onRecordCredentialCheck: vi.fn(),
    onAssignEventDelegate: vi.fn(),
    onRecordEventProof: vi.fn(),
    onRecordObligationDelivery: vi.fn(),
    onAddObligationEvidence: vi.fn(),
    onOpenMobileReview: vi.fn(),
    onCaptureMobileReceipt: vi.fn(),
  };
}

describe("PursuitOperationsSuite", () => {
  it("renders the complete governed operations path with explicit human boundaries", () => {
    render(
      <PursuitOperationsSuite
        loadState={{ status: "ready", snapshot: READY_SNAPSHOT }}
        actions={makeActions()}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Pursuit workflows" }),
    ).toBeInTheDocument();
    for (const heading of [
      "Opportunity intake",
      "My Work and pursuit tasks",
      "Client evidence requests",
      "Submission and visual package checks",
      "Credential checks",
      "Pre-bid meetings and site visits",
      "Post-award delivery",
      "Mobile summary for slow connections",
    ]) {
      expect(
        screen.getByRole("heading", { name: heading }),
      ).toBeInTheDocument();
    }
    expect(
      screen.getByRole("note", { name: "Manual submission boundary" }),
    ).toHaveTextContent(/does not click Submit/i);
    expect(
      screen.getByRole("note", { name: "Issuer authority" }),
    ).toHaveTextContent(/does not impersonate an issuer/i);
    expect(
      screen.getByRole("note", { name: "Online-first storage policy" }),
    ).toHaveTextContent(/not cached for offline use/i);
  });

  it("dispatches typed operator callbacks without performing external actions", async () => {
    const user = userEvent.setup();
    const actions = makeActions();
    render(
      <PursuitOperationsSuite
        loadState={{ status: "ready", snapshot: READY_SNAPSHOT }}
        actions={actions}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Confirm source and deadline" }),
    );
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Recorded work status" }),
      "in_review",
    );
    await user.click(screen.getByRole("button", { name: "Record acceptance" }));
    await user.click(
      screen.getByRole("button", { name: "Freeze package hash" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Record human check" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Assign authorised delegate" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Record attendance proof" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Record human delivery" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Capture human-held receipt" }),
    );

    expect(actions.onConfirmOpportunity).toHaveBeenCalledWith("opportunity-1");
    expect(actions.onChangeWorkStatus).toHaveBeenCalledWith(
      "work-1",
      "in_review",
    );
    expect(actions.onAcceptEvidence).toHaveBeenCalledWith("request-1");
    expect(actions.onFreezeSubmissionPackage).toHaveBeenCalledWith("package-1");
    expect(actions.onRecordCredentialCheck).toHaveBeenCalledWith(
      "credential-1",
    );
    expect(actions.onAssignEventDelegate).toHaveBeenCalledWith("event-1");
    expect(actions.onRecordEventProof).toHaveBeenCalledWith("event-1");
    expect(actions.onRecordObligationDelivery).toHaveBeenCalledWith(
      "obligation-1",
    );
    expect(actions.onCaptureMobileReceipt).toHaveBeenCalledWith("mobile-1");
  });

  it("keeps loading, failure and empty states distinct", async () => {
    const retry = vi.fn();
    const view = render(
      <PursuitOperationsSuite loadState={{ status: "loading" }} />,
    );
    expect(
      screen.getByText("Loading pursuit operations records"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Authorised opportunity intake" }),
    ).not.toBeInTheDocument();

    view.rerender(
      <PursuitOperationsSuite
        loadState={{ status: "error", message: "Service unavailable.", retry }}
      />,
    );
    expect(
      screen.getByRole("heading", {
        name: "Pursuit operations could not be loaded",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Missing records are not complete/i),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);

    view.rerender(<PursuitOperationsSuite />);
    expect(
      screen.getByRole("heading", {
        name: "No opportunities have been recorded",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "No post-award obligations are recorded",
      }),
    ).toBeInTheDocument();
  });

  it("disables mutations in read-only mode while preserving authorised navigation", () => {
    render(
      <PursuitOperationsSuite
        loadState={{ status: "ready", snapshot: READY_SNAPSHOT }}
        actions={makeActions()}
        readOnly
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Read-only operations view" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Confirm source and deadline" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("combobox", { name: "Recorded work status" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Record acceptance" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Freeze package hash" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("link", {
        name: "Open original source for Network operations framework",
      }),
    ).toHaveAttribute("href", "https://example.gov.ng/notices/14");
    expect(
      screen.getByRole("link", {
        name: "Open work item: Map mandatory tax evidence",
      }),
    ).toHaveAttribute("href", "/projects/project-1/requirements");
  });

  it("keeps every interactive control at least 44px and exposes a 360px-safe mobile surface", () => {
    const view = render(
      <PursuitOperationsSuite
        loadState={{ status: "ready", snapshot: READY_SNAPSHOT }}
        actions={makeActions()}
      />,
    );
    const controls =
      view.container.querySelectorAll<HTMLElement>("button, a, select");
    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) {
      expect(control).toHaveAttribute("data-control-size", "44");
      expect(control).toHaveClass("min-h-11");
    }
    const mobileSurface = view.container.querySelector(
      '[data-mobile-ready="360"]',
    );
    expect(mobileSurface).toHaveClass("min-w-0");
    const mobileItem = screen
      .getByRole("heading", { name: "Capture courier dispatch receipt" })
      .closest("article");
    expect(mobileItem).not.toBeNull();
    expect(within(mobileItem!).getByText("Online-only")).toBeInTheDocument();
  });

  it("has no detectable accessibility violations", async () => {
    const view = render(
      <PursuitOperationsSuite
        loadState={{ status: "ready", snapshot: READY_SNAPSHOT }}
        actions={makeActions()}
      />,
    );
    const results = await axe.run(view.container, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(
      results.violations.map(({ id, impact, nodes }) => ({
        id,
        impact,
        targets: nodes.map((node) => node.target),
      })),
    ).toEqual([]);
  }, 15_000);
});
