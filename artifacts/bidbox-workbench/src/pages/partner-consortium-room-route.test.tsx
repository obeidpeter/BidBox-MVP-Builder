import { render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PartnerConsortiumRoomRoute from "./partner-consortium-room-route";

const routeState = vi.hoisted(() => ({
  permissions: [] as string[],
  projects: {} as Record<string, unknown>,
  relationships: {} as Record<string, unknown>,
}));
const listProjects = vi.hoisted(() => vi.fn());
const listRelationships = vi.hoisted(() => vi.fn());

vi.mock("@workspace/api-client-react", () => ({
  customFetch: vi.fn(),
  getListPartnerRelationshipsQueryKey: () => ["partner-relationships"],
  getListProjectsQueryKey: () => ["projects"],
  useGetMe: () => ({
    data: { id: "user-1" },
    isLoading: false,
    isPending: false,
    isError: false,
  }),
  useListProjects: (...args: unknown[]) => {
    listProjects(...args);
    return routeState.projects;
  },
  useListPartnerRelationships: (...args: unknown[]) => {
    listRelationships(...args);
    return routeState.relationships;
  },
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    data: undefined,
    isLoading: false,
    isPending: true,
    isError: false,
    isSuccess: false,
    refetch: vi.fn(),
  }),
  useMutation: () => ({ isPending: false, mutate: vi.fn() }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@/contexts/organisation-context", () => ({
  useOrganisationAccess: () => ({
    activeOrganisation: {
      id: "org-1",
      accessSource: "membership",
      membershipOrganisationId: "org-1",
      partnerRelationshipId: null,
    },
    effectivePermissions: routeState.permissions,
    beginCriticalWorkflow: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

function renderRoute() {
  const location = memoryLocation({ path: "/consortium-room" });
  return render(
    <Router hook={location.hook}>
      <PartnerConsortiumRoomRoute />
    </Router>,
  );
}

describe("Partner Consortium room authority and pending states", () => {
  beforeEach(() => {
    routeState.permissions = ["partner_relationship:read", "project:read"];
    routeState.projects = {
      data: [],
      isLoading: false,
      isPending: false,
      isError: false,
      isSuccess: true,
    };
    routeState.relationships = {
      data: [],
      isLoading: false,
      isPending: false,
      isError: false,
      isSuccess: true,
    };
    listProjects.mockClear();
    listRelationships.mockClear();
  });

  it("disables both directory reads when project authority is missing", () => {
    routeState.permissions = ["partner_relationship:read"];

    renderRoute();

    expect(
      screen.getByRole("heading", {
        name: /relationship access required/i,
      }),
    ).toBeInTheDocument();
    expect(listProjects.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        query: expect.objectContaining({ enabled: false }),
      }),
    );
    expect(listRelationships.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        query: expect.objectContaining({ enabled: false }),
      }),
    );
  });

  it("keeps cold paused directory reads pending instead of inferring no relationship project", () => {
    routeState.projects = {
      data: undefined,
      isLoading: false,
      isPending: true,
      isError: false,
      isSuccess: false,
    };
    routeState.relationships = { ...routeState.projects };

    renderRoute();

    expect(
      screen.getByText(/verifying relationship, project, and named actor/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", {
        name: /no active relationship project is available/i,
      }),
    ).not.toBeInTheDocument();
  });
});
