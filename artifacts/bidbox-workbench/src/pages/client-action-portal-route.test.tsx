import { render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ClientActionPortalRoute from "./client-action-portal-route";

const routeState = vi.hoisted(() => ({
  me: {} as Record<string, unknown>,
  projects: {} as Record<string, unknown>,
  snapshot: {} as Record<string, unknown>,
  authorities: {} as Record<string, unknown>,
}));

vi.mock("@workspace/api-client-react", () => ({
  customFetch: vi.fn(),
  getListProjectsQueryKey: () => ["projects"],
  useGetMe: () => routeState.me,
  useListProjects: () => routeState.projects,
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { queryKey?: readonly unknown[] }) =>
    options.queryKey?.includes("authorities")
      ? routeState.authorities
      : routeState.snapshot,
  useMutation: () => ({
    isPending: false,
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
  }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@/components/client-action-portal/client-action-workspace", () => ({
  ClientActionWorkspace: () => <div>Client action records</div>,
}));

vi.mock("@/contexts/organisation-context", () => ({
  useOrganisationAccess: () => ({
    activeOrganisation: {
      id: "org-1",
      accessSource: "membership",
      membershipId: "membership-1",
      membershipOrganisationId: "org-1",
      version: 1,
    },
    effectivePermissions: ["project:read", "evidence:read"],
    beginCriticalWorkflow: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

function renderRoute() {
  const location = memoryLocation({ path: "/client-actions" });
  return render(
    <Router hook={location.hook}>
      <ClientActionPortalRoute />
    </Router>,
  );
}

describe("Client Action portal query states", () => {
  beforeEach(() => {
    routeState.me = {
      data: { id: "user-1" },
      isLoading: false,
      isPending: false,
      isError: false,
    };
    routeState.projects = {
      data: [
        {
          id: "project-1",
          tenderTitle: "Road rehabilitation",
          status: "review",
        },
      ],
      isLoading: false,
      isPending: false,
      isError: false,
      isSuccess: true,
    };
    routeState.snapshot = {
      data: undefined,
      isLoading: true,
      isPending: true,
      isError: false,
      refetch: vi.fn(),
    };
    routeState.authorities = {
      data: undefined,
      isLoading: false,
      isPending: true,
      isError: false,
      isSuccess: false,
      refetch: vi.fn(),
    };
  });

  it("does not render the error panel during the initial snapshot load", () => {
    renderRoute();

    expect(
      screen.getByText(/loading controlled client actions/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", {
        name: /client actions are unavailable/i,
      }),
    ).not.toBeInTheDocument();
  });

  it("keeps a cold paused project request pending instead of showing no pursuit", () => {
    routeState.projects = {
      data: undefined,
      isLoading: false,
      isPending: true,
      isError: false,
      isSuccess: false,
    };

    renderRoute();

    expect(screen.getByText(/loading available pursuits/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /no pursuit is available/i }),
    ).not.toBeInTheDocument();
  });
});
