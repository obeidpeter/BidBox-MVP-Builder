import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ReconciledCommunicationsRoute from "./reconciled-communications-route";

const ORGANISATION_ID = "10000000-0000-4000-8000-000000000001";

const mocks = vi.hoisted(() => ({
  customFetch: vi.fn(),
  accessSource: "membership" as "membership" | "partner",
  projectsQuery: {} as Record<string, unknown>,
}));

vi.mock("@workspace/api-client-react", () => ({
  customFetch: mocks.customFetch,
  getListProjectsQueryKey: () => ["projects"],
  useListProjects: () => mocks.projectsQuery,
}));

vi.mock("wouter", () => ({
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
}));

vi.mock("@/contexts/organisation-context", () => ({
  useOrganisationAccess: () => ({
    activeOrganisation: {
      id: ORGANISATION_ID,
      accessSource: mocks.accessSource,
      membershipOrganisationId:
        mocks.accessSource === "membership" ? ORGANISATION_ID : null,
    },
    effectivePermissions: ["project:read", "project:update"],
    beginCriticalWorkflow: () => () => {},
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ReconciledCommunicationsRoute />
    </QueryClientProvider>,
  );
}

describe("ReconciledCommunicationsRoute", () => {
  beforeEach(() => {
    mocks.customFetch.mockReset();
    mocks.accessSource = "membership";
    mocks.projectsQuery = {
      data: [],
      isLoading: false,
      isPending: false,
      isError: false,
      isSuccess: true,
    };
  });

  it("denies partner-derived access without requesting communication data", () => {
    mocks.accessSource = "partner";

    renderPage();

    expect(screen.getByText("Direct membership required")).toBeInTheDocument();
    expect(mocks.customFetch).not.toHaveBeenCalled();
  });

  it("does not infer an empty pursuit list from a cold-paused query", () => {
    mocks.projectsQuery = {
      data: undefined,
      isLoading: false,
      isPending: true,
      isError: false,
      isSuccess: false,
    };

    renderPage();

    expect(screen.getByText("Loading available pursuits")).toBeInTheDocument();
    expect(
      screen.queryByText("No pursuit is available"),
    ).not.toBeInTheDocument();
    expect(mocks.customFetch).not.toHaveBeenCalled();
  });
});
