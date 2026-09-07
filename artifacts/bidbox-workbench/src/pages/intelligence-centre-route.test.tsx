import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { beforeEach, describe, expect, it, vi } from "vitest";
import IntelligenceCentreRoute from "./intelligence-centre-route";

const projectRefetch = vi.fn();
const listProjects = vi.fn();
const intelligenceRefetch = vi.fn();
const getIntelligence = vi.fn();
const claimReview = vi.fn();
const decideReview = vi.fn();
const toast = vi.fn();
const customFetch = vi.fn();
const beginCriticalWorkflow = vi.fn(() => vi.fn());

const state = {
  projectsError: false,
  projectsPending: false,
  permissions: [
    "client:read",
    "project:read",
    "document:read",
    "requirement:read",
    "evidence:read",
    "defect:read",
    "report:read",
    "draft:read",
    "package:read",
    "evaluation:read",
    "intelligence:review",
  ],
  projects: [
    {
      id: "project-1",
      tenderTitle: "Road rehabilitation",
    },
    {
      id: "project-2",
      tenderTitle: "Hospital equipment",
    },
  ],
};

vi.mock("@workspace/api-client-react", () => ({
  customFetch: (path: string, options?: unknown) => customFetch(path, options),
  getGetProjectIntelligenceQueryKey: (projectId: string) => [
    "/api/projects/intelligence",
    projectId,
  ],
  getListProjectsQueryKey: () => ["/api/projects"],
  useListProjects: (...args: unknown[]) => {
    listProjects(...args);
    return {
      data: state.projectsPending ? undefined : state.projects,
      isLoading: false,
      isPending: state.projectsPending,
      isError: state.projectsError,
      isSuccess: !state.projectsPending && !state.projectsError,
      refetch: projectRefetch,
    };
  },
  useGetProjectIntelligence: (...args: unknown[]) => getIntelligence(...args),
  useClaimIntelligenceReview: () => ({
    mutate: claimReview,
    isPending: false,
  }),
  useDecideIntelligenceReview: () => ({
    mutate: decideReview,
    isPending: false,
  }),
  useGetMe: () => ({
    data: { id: "actor-1" },
    isLoading: false,
    isPending: false,
    isError: false,
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast }),
}));

vi.mock("@/contexts/organisation-context", () => ({
  useOrganisationAccess: () => ({
    activeOrganisation: {
      id: "org-1",
      membershipId: "membership-1",
      membershipOrganisationId: "org-1",
      accessSource: "membership",
    },
    effectivePermissions: state.permissions,
    beginCriticalWorkflow,
  }),
}));

function snapshot(projectId: string) {
  return {
    environment: "development" as const,
    productionAiEnabled: false,
    restrictedMode: false,
    generatedAt: "2026-08-10T12:00:00.000Z",
    project: {
      id: projectId,
      title:
        projectId === "project-2"
          ? "Hospital equipment"
          : "Road rehabilitation",
      status: "review",
      deadline: null,
    },
    capabilities: [],
  };
}

function reviewSnapshot(projectId: string) {
  return {
    ...snapshot(projectId),
    reviewInbox: {
      projectId,
      generatedAt: "2026-08-10T12:00:00.000Z",
      environment: "development" as const,
      productionAiEnabled: false,
      sourceVersion: 4,
      sourceManifestSha256: "a".repeat(64),
      readOnly: false,
      authorityNote:
        "A named review records scrutiny only and grants no release authority.",
      counts: {
        pending: 1,
        in_review: 1,
        changes_requested: 0,
        approved: 0,
        rejected: 0,
      },
      items: [
        {
          id: "evidence_graph",
          capabilityId: "evidence_graph" as const,
          title: "Evidence Graph",
          summary: "One evidence mapping requires review.",
          status: "pending" as const,
          priority: "high" as const,
          reviewType: "intelligence_capability",
          reviewerName: null,
          assignedToCurrentUser: false,
          dueAt: null,
          sourceCount: 2,
          staleSource: false,
          href: null,
          sourceVersion: 4,
          reviewVersion: null as number | null,
        },
        {
          id: "eligibility_passport",
          capabilityId: "eligibility_passport" as const,
          title: "Eligibility Passport",
          summary: "The assigned reviewer must decide this item.",
          status: "in_review" as const,
          priority: "critical" as const,
          reviewType: "intelligence_capability",
          reviewerName: "Ada Reviewer",
          assignedToCurrentUser: true,
          dueAt: null,
          sourceCount: 3,
          staleSource: false,
          href: null,
          sourceVersion: 4,
          reviewVersion: 2,
        },
      ],
    },
  };
}

function addendumSnapshot(projectId: string) {
  return {
    policyVersion: "valo.addendum-impact/v1",
    authorityNote:
      "Review records scrutiny only. Applying the plan is a separate controlled action.",
    project: { id: projectId, title: "Road rehabilitation" },
    baseline: {
      documentId: "document-1",
      documentVersionId: "version-1",
      filename: "invitation.pdf",
      versionNumber: 1,
      sha256: "a".repeat(64),
      capturedAt: "2026-08-01T08:00:00.000Z",
    },
    revision: {
      documentId: "document-2",
      documentVersionId: "version-2",
      filename: "addendum-1.pdf",
      versionNumber: 1,
      sha256: "b".repeat(64),
      capturedAt: "2026-08-18T08:00:00.000Z",
    },
    assessment: {
      id: "assessment-1",
      version: 0,
      radarId: "radar-1",
      sourceManifestSha256: "c".repeat(64),
      impactManifestSha256: "d".repeat(64),
      status: "reviewed_no_affected_work",
      readyForReopening: false,
      changes: [],
      impacts: [],
      issues: [],
    },
    review: null,
    reviewStale: false,
    application: null,
    requiredConfirmation: "REOPEN AFFECTED WORK",
  };
}

function renderAt(path: string) {
  const location = memoryLocation({ path });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <Router hook={location.hook}>
        <IntelligenceCentreRoute />
      </Router>
    </QueryClientProvider>,
  );
}

describe("Intelligence Centre route", () => {
  beforeEach(() => {
    state.projectsError = false;
    state.projectsPending = false;
    state.permissions = [
      "client:read",
      "project:read",
      "document:read",
      "requirement:read",
      "evidence:read",
      "defect:read",
      "report:read",
      "draft:read",
      "package:read",
      "evaluation:read",
      "intelligence:review",
    ];
    state.projects = [
      { id: "project-1", tenderTitle: "Road rehabilitation" },
      { id: "project-2", tenderTitle: "Hospital equipment" },
    ];
    projectRefetch.mockReset();
    listProjects.mockReset();
    intelligenceRefetch.mockReset();
    getIntelligence.mockReset();
    claimReview.mockReset();
    decideReview.mockReset();
    toast.mockReset();
    customFetch.mockReset();
    beginCriticalWorkflow.mockClear();
    customFetch.mockImplementation((path: string) => {
      const match = /^\/api\/projects\/([^/]+)\/addendum-impact$/u.exec(path);
      if (match?.[1]) return Promise.resolve(addendumSnapshot(match[1]));
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });
    getIntelligence.mockImplementation((projectId: string) => ({
      data: snapshot(projectId),
      isLoading: false,
      isPending: false,
      isError: false,
      isSuccess: true,
      refetch: intelligenceRefetch,
    }));
  });

  it("honours a deep-linked project and switches within the authorised list", async () => {
    renderAt("/intelligence?project=project-2");

    const projectSelect = screen.getByRole("combobox", { name: "Pursuit" });
    expect(projectSelect).toHaveValue("project-2");
    expect(getIntelligence).toHaveBeenCalledWith(
      "project-2",
      expect.objectContaining({
        query: expect.objectContaining({ enabled: true }),
      }),
    );

    await userEvent.selectOptions(projectSelect, "project-1");
    expect(getIntelligence).toHaveBeenLastCalledWith(
      "project-1",
      expect.objectContaining({
        query: expect.objectContaining({ enabled: true }),
      }),
    );
  });

  it("keeps a cold paused project request pending instead of showing an empty catalogue", () => {
    state.projectsPending = true;
    state.projects = [];

    renderAt("/intelligence");

    expect(
      screen.getByText(/loading intelligence evidence for this organisation/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", {
        name: /no intelligence evidence is available/i,
      }),
    ).not.toBeInTheDocument();
  });

  it("keeps a cold paused intelligence request pending instead of using the disconnected snapshot", () => {
    getIntelligence.mockImplementation(() => ({
      data: undefined,
      isLoading: false,
      isPending: true,
      isError: false,
      isSuccess: false,
      refetch: intelligenceRefetch,
    }));

    renderAt("/intelligence?project=project-1");

    expect(
      screen.getByText(/loading intelligence evidence for this organisation/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", {
        name: /no intelligence evidence is available/i,
      }),
    ).not.toBeInTheDocument();
  });

  it("keeps project transport failures distinct and retryable", async () => {
    state.projectsError = true;
    state.projects = [];
    renderAt("/intelligence");

    expect(
      screen.getByRole("heading", {
        name: "Intelligence evidence could not be loaded",
      }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(projectRefetch).toHaveBeenCalledTimes(1);
    expect(intelligenceRefetch).not.toHaveBeenCalled();
  });

  it("fails closed before loading combined source content when one read grant is missing", () => {
    state.permissions = state.permissions.filter(
      (permission) => permission !== "document:read",
    );
    renderAt("/intelligence?project=project-1");

    expect(
      screen.getByRole("heading", {
        name: "Intelligence source access required",
      }),
    ).toBeInTheDocument();
    expect(getIntelligence).toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({
        query: expect.objectContaining({ enabled: false }),
      }),
    );
    expect(listProjects).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({
        query: expect.objectContaining({ enabled: false }),
      }),
    );
  });

  it("shows an honest empty catalogue when there are no visible pursuits", () => {
    state.projects = [];
    renderAt("/intelligence");

    expect(
      screen.getByRole("heading", {
        name: "No intelligence evidence is available",
      }),
    ).toBeInTheDocument();
    expect(getIntelligence).toHaveBeenCalledWith(
      "",
      expect.objectContaining({
        query: expect.objectContaining({ enabled: false }),
      }),
    );
  });

  it("binds claim and decision mutations to the exact source and review versions", async () => {
    getIntelligence.mockImplementation((projectId: string) => ({
      data: reviewSnapshot(projectId),
      isLoading: false,
      isError: false,
      refetch: intelligenceRefetch,
    }));
    renderAt("/intelligence?project=project-1");

    await userEvent.click(screen.getByRole("button", { name: "Claim review" }));
    expect(claimReview).toHaveBeenCalledWith({
      id: "project-1",
      data: {
        capabilityId: "evidence_graph",
        expectedSourceVersion: 4,
        expectedSourceManifestSha256: "a".repeat(64),
        expectedReviewVersion: null,
      },
    });

    await userEvent.click(
      screen.getByRole("button", { name: "Accept review" }),
    );
    expect(decideReview).toHaveBeenCalledWith({
      id: "project-1",
      data: {
        capabilityId: "eligibility_passport",
        expectedSourceVersion: 4,
        expectedSourceManifestSha256: "a".repeat(64),
        expectedReviewVersion: 2,
        decision: "approved",
      },
    });
  });

  it("mounts the Addendum Impact Centre for the selected pursuit", async () => {
    renderAt("/intelligence?project=project-1");

    expect(
      await screen.findByRole("heading", {
        name: "See what changed before reopening work",
      }),
    ).toBeInTheDocument();
    expect(customFetch).toHaveBeenCalledWith(
      "/api/projects/project-1/addendum-impact",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("allows a stale review projection to be reclaimed against the current source binding", async () => {
    getIntelligence.mockImplementation((projectId: string) => {
      const data = reviewSnapshot(projectId);
      data.reviewInbox.items[0] = {
        ...data.reviewInbox.items[0],
        staleSource: true,
        sourceVersion: data.reviewInbox.sourceVersion,
        reviewVersion: 3,
      };
      return {
        data,
        isLoading: false,
        isError: false,
        refetch: intelligenceRefetch,
      };
    });
    renderAt("/intelligence?project=project-1");

    await userEvent.click(screen.getByRole("button", { name: "Claim review" }));
    expect(claimReview).toHaveBeenCalledWith({
      id: "project-1",
      data: {
        capabilityId: "evidence_graph",
        expectedSourceVersion: 4,
        expectedSourceManifestSha256: "a".repeat(64),
        expectedReviewVersion: 3,
      },
    });
  });
});
