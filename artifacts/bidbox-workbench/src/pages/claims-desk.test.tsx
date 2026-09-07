import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ClaimsDeskPage from "./claims-desk";

const ORG = "10000000-0000-4000-8000-000000000001";
const PROJECT = "20000000-0000-4000-8000-000000000002";
const ACTOR = "30000000-0000-4000-8000-000000000003";
const mocks = vi.hoisted(() => ({
  customFetch: vi.fn(),
  accessSource: "membership" as "membership" | "partner",
  permissions: ["project:read", "project:update", "document:read"],
  projectsQuery: {} as Record<string, unknown>,
  meQuery: {} as Record<string, unknown>,
  toast: vi.fn(),
}));

vi.mock("@workspace/api-client-react", () => ({
  customFetch: mocks.customFetch,
  getListProjectsQueryKey: () => ["/api/projects"],
  useListProjects: () => mocks.projectsQuery,
  useGetMe: () => mocks.meQuery,
}));
vi.mock("wouter", () => ({
  useSearchParams: () => [new URLSearchParams(`project=${PROJECT}`), vi.fn()],
}));
vi.mock("@/contexts/organisation-context", () => ({
  useOrganisationAccess: () => ({
    activeOrganisation: {
      id: ORG,
      accessSource: mocks.accessSource,
      membershipOrganisationId:
        mocks.accessSource === "membership" ? ORG : null,
    },
    effectivePermissions: mocks.permissions,
    beginCriticalWorkflow: () => () => {},
  }),
}));
vi.mock("@/hooks/use-online-status", () => ({ useOnlineStatus: () => true }));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

function response() {
  return {
    organisationId: ORG,
    projectId: PROJECT,
    projectStatus: "review",
    records: [],
    posture: {
      total: 0,
      open: 0,
      overdue: 0,
      dueSoon: 0,
      awaitingChecker: 0,
      terminal: 0,
    },
    truncated: false,
    generatedAt: "2026-08-11T12:00:00.000Z",
    legalConclusionAutomated: false,
    noticeDispatched: false,
    paymentMutated: false,
    authorityNote: "Human workflow evidence only.",
  };
}

function renderPage(prepare?: (client: QueryClient) => void) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  prepare?.(client);
  return render(
    <QueryClientProvider client={client}>
      <ClaimsDeskPage />
    </QueryClientProvider>,
  );
}

describe("ClaimsDeskPage", () => {
  beforeEach(() => {
    mocks.customFetch.mockReset();
    mocks.toast.mockReset();
    mocks.accessSource = "membership";
    mocks.permissions = ["project:read", "project:update", "document:read"];
    mocks.projectsQuery = {
      data: [
        {
          id: PROJECT,
          tenderTitle: "Claims test project",
          status: "review",
          createdAt: "2026-08-01T12:00:00.000Z",
        },
      ],
      isLoading: false,
      isPending: false,
      isError: false,
      isSuccess: true,
    };
    mocks.meQuery = {
      data: { id: ACTOR },
      isLoading: false,
      isPending: false,
      isError: false,
      isSuccess: true,
    };
    onlineManager.setOnline(true);
  });

  afterEach(() => onlineManager.setOnline(true));

  it("denies partner-derived access without requesting project data", () => {
    mocks.accessSource = "partner";
    renderPage();
    expect(
      screen.getByText("Direct project membership required"),
    ).toBeInTheDocument();
    expect(mocks.customFetch).not.toHaveBeenCalled();
  });

  it("does not infer an empty project scope from a cold-paused query", () => {
    mocks.projectsQuery = {
      data: undefined,
      isLoading: false,
      isPending: true,
      isError: false,
      isSuccess: false,
    };

    renderPage();

    expect(screen.getByText("Loading available projects")).toBeInTheDocument();
    expect(
      screen.queryByText("No active project is available"),
    ).not.toBeInTheDocument();
    expect(mocks.customFetch).not.toHaveBeenCalled();
  });

  it("keeps mutations unavailable while canonical evidence is cold-paused", () => {
    onlineManager.setOnline(false);
    renderPage((client) =>
      client.setQueryData(
        [
          "claims-desk",
          ORG,
          PROJECT,
          ACTOR,
          "document:read|project:read|project:update",
        ],
        response(),
      ),
    );

    expect(
      screen.getByText("Loading approved document choices"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", {
        name: "Record workflow evidence",
      }),
    ).not.toBeInTheDocument();
  });

  it("loads an exact tenant/project query and exposes bounded workflows", async () => {
    mocks.customFetch.mockImplementation((path: string) =>
      Promise.resolve(
        path.startsWith("/api/canonical-evidence-options")
          ? {
              organisationId: ORG,
              projectId: PROJECT,
              limit: 100,
              truncated: false,
              items: [],
            }
          : response(),
      ),
    );
    renderPage();
    await screen.findByRole("heading", { name: "Claims" });
    expect(mocks.customFetch).toHaveBeenCalledWith(
      `/api/projects/${PROJECT}/claims-desk`,
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(
      screen.getByRole("heading", { name: "Record workflow evidence" }),
    ).toBeInTheDocument();
  });

  it("keeps the desk read-only without project:update", async () => {
    mocks.permissions = ["project:read"];
    mocks.customFetch.mockResolvedValue(response());
    renderPage();
    await waitFor(() =>
      expect(screen.getByText("Claims is read-only")).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("heading", {
        name: "Record workflow evidence",
      }),
    ).not.toBeInTheDocument();
  });
});
