import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AddendumImpactCentre from "./addendum-impact-centre";

const mocks = vi.hoisted(() => ({
  actorUserId: "33333333-3333-4333-8333-333333333333",
  customFetch: vi.fn(),
  beginCriticalWorkflow: vi.fn(),
  releaseCriticalWorkflow: vi.fn(),
  toast: vi.fn(),
  meLoading: false,
  mePending: false,
  meError: false,
  meRefetch: vi.fn(),
  permissions: [
    "project:read",
    "document:read",
    "requirement:read",
    "draft:read",
    "package:read",
    "report:read",
    "intelligence:review",
    "project:update",
    "requirement:review",
    "package:generate",
    "report:generate",
  ],
}));

vi.mock("@workspace/api-client-react", () => ({
  customFetch: mocks.customFetch,
  useGetMe: () => ({
    data:
      mocks.meLoading || mocks.mePending || mocks.meError
        ? undefined
        : { id: mocks.actorUserId },
    isLoading: mocks.meLoading,
    isPending: mocks.mePending,
    isError: mocks.meError,
    refetch: mocks.meRefetch,
  }),
}));

vi.mock("@/contexts/organisation-context", () => ({
  useOrganisationAccess: () => ({
    activeOrganisation: {
      id: "11111111-1111-4111-8111-111111111111",
      membershipId: "22222222-2222-4222-8222-222222222222",
      membershipOrganisationId: "11111111-1111-4111-8111-111111111111",
      accessSource: "membership",
    },
    effectivePermissions: mocks.permissions,
    beginCriticalWorkflow: mocks.beginCriticalWorkflow,
  }),
}));

vi.mock("@/hooks/use-online-status", () => ({
  useOnlineStatus: () => true,
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

const PROJECT_ID = "44444444-4444-4444-8444-444444444444";
const BASELINE_ID = "55555555-5555-4555-8555-555555555555";
const REVISION_ID = "66666666-6666-4666-8666-666666666666";

function snapshot(reviewerUserId = "77777777-7777-4777-8777-777777777777") {
  return {
    policyVersion: "valo.addendum-impact/v1",
    authorityNote:
      "Review records scrutiny only. Applying the plan is a separate controlled action.",
    project: { id: PROJECT_ID, title: "Road rehabilitation" },
    baseline: {
      documentId: "88888888-8888-4888-8888-888888888888",
      documentVersionId: BASELINE_ID,
      filename: "invitation.pdf",
      versionNumber: 1,
      sha256: "a".repeat(64),
      capturedAt: "2026-08-01T08:00:00.000Z",
    },
    revision: {
      documentId: "99999999-9999-4999-8999-999999999999",
      documentVersionId: REVISION_ID,
      filename: "addendum-1.pdf",
      versionNumber: 1,
      sha256: "b".repeat(64),
      capturedAt: "2026-08-18T08:00:00.000Z",
    },
    assessment: {
      id: "addimpact-plan-1",
      version: 4,
      radarId: "addradar-1",
      sourceManifestSha256: "c".repeat(64),
      impactManifestSha256: "d".repeat(64),
      status: "ready_to_reopen",
      readyForReopening: true,
      changes: [
        {
          id: "change-1",
          fieldExternalId: "submission-deadline",
          category: "deadline",
          kind: "changed",
          beforeValue: "20 August 2026",
          afterValue: "27 August 2026",
          beforeCitation: {
            citationId: "citation-before",
            sourceVersionId: BASELINE_ID,
            sourceTitle: "invitation.pdf",
            contentSha256: "e".repeat(64),
            quote: "20 August 2026",
            startOffset: 10,
            endOffset: 24,
            page: 3,
            section: "Submission deadline",
          },
          afterCitation: {
            citationId: "citation-after",
            sourceVersionId: REVISION_ID,
            sourceTitle: "addendum-1.pdf",
            contentSha256: "f".repeat(64),
            quote: "27 August 2026",
            startOffset: 10,
            endOffset: 24,
            page: 3,
            section: "Submission deadline",
          },
          reviewState: "accepted",
        },
      ],
      impacts: [
        {
          targetId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          objectType: "package",
          label: "Signed submission package",
          currentState: "signed_off",
          currentVersion: 3,
          proposedAction: "invalidate",
          changeIds: ["change-1"],
          fieldExternalIds: ["submission-deadline"],
        },
      ],
      issues: [],
    },
    review: {
      assessmentId: "addimpact-plan-1",
      impactManifestSha256: "d".repeat(64),
      decision: "accepted",
      reason: "The exact deadline and package impact are correct.",
      reviewerUserId,
      reviewerName: "Ada Reviewer",
      reviewedAt: "2026-08-21T10:00:00.000Z",
      version: 4,
    },
    reviewStale: false,
    application: null,
    requiredConfirmation: "REOPEN AFFECTED WORK",
  };
}

function application() {
  return {
    assessmentId: "addimpact-plan-1",
    impactManifestSha256: "d".repeat(64),
    appliedByUserId: mocks.actorUserId,
    appliedByName: "Bola Manager",
    appliedAt: "2026-08-21T11:00:00.000Z",
    reason: "Apply only the reviewed deadline impact.",
    mutationCount: 1,
  };
}

function renderCentre() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <AddendumImpactCentre projectId={PROJECT_ID} />
    </QueryClientProvider>,
  );
}

describe("Addendum Impact Centre", () => {
  beforeEach(() => {
    mocks.actorUserId = "33333333-3333-4333-8333-333333333333";
    mocks.meLoading = false;
    mocks.mePending = false;
    mocks.meError = false;
    mocks.meRefetch.mockReset();
    mocks.permissions = [
      "project:read",
      "document:read",
      "requirement:read",
      "draft:read",
      "package:read",
      "report:read",
      "intelligence:review",
      "project:update",
      "requirement:review",
      "package:generate",
      "report:generate",
    ];
    mocks.customFetch.mockReset();
    mocks.beginCriticalWorkflow.mockReset();
    mocks.releaseCriticalWorkflow.mockReset();
    mocks.toast.mockReset();
    mocks.beginCriticalWorkflow.mockReturnValue(mocks.releaseCriticalWorkflow);
    mocks.customFetch.mockImplementation(
      (path: string, options?: RequestInit) => {
        if (!options?.method) return Promise.resolve(snapshot());
        if (path.endsWith("/review")) return Promise.resolve(snapshot());
        if (path.endsWith("/apply")) {
          return Promise.resolve({
            replayed: false,
            authorityNote: "Committed controlled reopening.",
            application: application(),
          });
        }
        return Promise.reject(new Error(`Unexpected request: ${path}`));
      },
    );
  });

  it("keeps a cold identity query ahead of the permission gate", () => {
    mocks.mePending = true;
    renderCentre();

    expect(
      screen.getByRole("heading", {
        name: "Checking your identity and access",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", {
        name: "Addendum comparison access required",
      }),
    ).not.toBeInTheDocument();
    expect(mocks.customFetch).not.toHaveBeenCalled();
  });

  it("shows a retryable identity error instead of a permission denial", async () => {
    mocks.meError = true;
    renderCentre();
    const user = userEvent.setup();

    expect(
      screen.getByRole("heading", {
        name: "Your identity could not be checked",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", {
        name: "Addendum comparison access required",
      }),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Try identity check again" }),
    );
    expect(mocks.meRefetch).toHaveBeenCalledOnce();
    expect(mocks.customFetch).not.toHaveBeenCalled();
  });

  it("shows exact before-and-after citations and the version-bound impact", async () => {
    renderCentre();

    expect(
      await screen.findByRole("heading", {
        name: "See what changed before reopening work",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/follow the verified addendum chain/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Effective version before this addendum"),
    ).toBeInTheDocument();
    expect(screen.getByText("Selected addendum")).toBeInTheDocument();
    expect(screen.getByText("20 August 2026")).toBeInTheDocument();
    expect(screen.getByText("27 August 2026")).toBeInTheDocument();
    expect(screen.getByText("Signed submission package")).toBeInTheDocument();
    expect(mocks.customFetch).toHaveBeenCalledWith(
      `/api/projects/${PROJECT_ID}/addendum-impact`,
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("binds a named review to both exact source versions and the current plan", async () => {
    renderCentre();
    const user = userEvent.setup();
    await screen.findByRole("button", { name: "Record named review" });
    await user.type(
      screen.getByLabelText("Reason"),
      "I checked the exact deadline and downstream package.",
    );
    await user.click(
      screen.getByRole("button", { name: "Record named review" }),
    );

    await waitFor(() =>
      expect(mocks.customFetch).toHaveBeenCalledWith(
        `/api/projects/${PROJECT_ID}/addendum-impact/review`,
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            baselineVersionId: BASELINE_ID,
            revisionVersionId: REVISION_ID,
            assessmentId: "addimpact-plan-1",
            radarId: "addradar-1",
            expectedImpactManifestSha256: "d".repeat(64),
            expectedAssessmentVersion: 4,
            decision: "accepted",
            reason: "I checked the exact deadline and downstream package.",
          }),
        }),
      ),
    );
    expect(mocks.beginCriticalWorkflow).toHaveBeenCalledOnce();
    expect(mocks.releaseCriticalWorkflow).toHaveBeenCalledOnce();
  });

  it("requires typed confirmation and sends a separate exact apply command", async () => {
    renderCentre();
    const user = userEvent.setup();
    const applyButton = await screen.findByRole("button", {
      name: "Apply controlled reopening",
    });
    expect(applyButton).toBeDisabled();
    await user.type(
      screen.getByLabelText("Reason for reopening"),
      "Apply only the reviewed deadline impact.",
    );
    await user.type(
      screen.getByLabelText("Type REOPEN AFFECTED WORK"),
      "REOPEN AFFECTED WORK",
    );
    expect(applyButton).toBeEnabled();
    await user.click(applyButton);

    await waitFor(() =>
      expect(mocks.customFetch).toHaveBeenCalledWith(
        `/api/projects/${PROJECT_ID}/addendum-impact/apply`,
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            baselineVersionId: BASELINE_ID,
            revisionVersionId: REVISION_ID,
            assessmentId: "addimpact-plan-1",
            radarId: "addradar-1",
            expectedImpactManifestSha256: "d".repeat(64),
            expectedAssessmentVersion: 4,
            reason: "Apply only the reviewed deadline impact.",
            confirmation: "REOPEN AFFECTED WORK",
          }),
        }),
      ),
    );
    expect(
      await screen.findByText(/controlled reopening recorded/i),
    ).toBeInTheDocument();
  });

  it("does not let the named reviewer apply their own decision", async () => {
    mocks.actorUserId = "77777777-7777-4777-8777-777777777777";
    mocks.customFetch.mockResolvedValue(snapshot(mocks.actorUserId));
    renderCentre();

    expect(
      await screen.findByRole("heading", {
        name: "A different person must apply this plan",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Apply controlled reopening" }),
    ).not.toBeInTheDocument();
  });
});
