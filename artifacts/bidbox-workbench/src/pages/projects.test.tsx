import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectSummary } from "@workspace/api-client-react";
import Projects from "./projects";
import {
  filterAndSortProjects,
  formatDeadlineWat,
  deadlineInputToIsoWat,
  parseProjectDeadline,
  readProjectRegisterFilters,
  retainEligibleSelectionId,
  type ProjectRegisterFilters,
} from "./project-register";

const REGISTER_CLOCK_TEST_INTERVAL_MS = 60 * 1000;

const apiState = vi.hoisted(() => ({
  projectsQuery: {} as Record<string, unknown>,
  clientsQuery: {} as Record<string, unknown>,
  usersQuery: {} as Record<string, unknown>,
  retryProjects: vi.fn(),
  retryClients: vi.fn(),
  retryUsers: vi.fn(),
  createProject: vi.fn(),
  canCreateProject: true,
}));

vi.mock("@workspace/api-client-react", () => ({
  getListProjectsQueryKey: () => ["projects"],
  getListUsersQueryKey: () => ["users"],
  useListProjects: () => apiState.projectsQuery,
  useListClients: () => apiState.clientsQuery,
  useListUsers: () => apiState.usersQuery,
  useCreateProject: () => ({
    isPending: false,
    mutate: apiState.createProject,
  }),
}));

vi.mock("@/contexts/organisation-context", () => ({
  useOrganisationPermission: (permission: string) =>
    permission === "project:create" ? apiState.canCreateProject : true,
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

function project(
  id: string,
  tenderTitle: string,
  overrides: Partial<ProjectSummary> & { reviewerId?: string | null } = {},
): ProjectSummary & { reviewerId?: string | null } {
  return {
    id,
    clientId: "client-a",
    clientName: "Apex Client",
    tenderTitle,
    issuingEntity: null,
    tenderRef: null,
    lot: null,
    deadline: null,
    segment: "other",
    status: "intake",
    reviewerName: "Ada Reviewer",
    reviewerId: "reviewer-ada",
    slaClass: "standard",
    paymentStatus: "pending",
    conflictStatus: "clear",
    restrictedMode: false,
    riskScore: null,
    riskBand: "low",
    outcome: "none",
    nextAction: null,
    defectCount: 0,
    fatalDefectCount: 0,
    requirementCount: 0,
    createdAt: "2026-08-01T09:00:00Z",
    ...overrides,
  };
}

const DEFAULT_FILTERS: ProjectRegisterFilters = {
  search: "",
  status: "all",
  risk: "all",
  client: "",
  reviewer: "",
  deadline: "all",
  sort: "deadline_asc",
};

function Wrapper({ children }: PropsWithChildren) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function renderPage() {
  return render(<Projects />, { wrapper: Wrapper });
}

describe("project register controls", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/projects");
    apiState.retryProjects.mockReset();
    apiState.retryClients.mockReset();
    apiState.retryUsers.mockReset();
    apiState.createProject.mockReset();
    apiState.canCreateProject = true;
    apiState.projectsQuery = {
      data: [],
      isLoading: false,
      isPending: false,
      isError: false,
      isSuccess: true,
      isFetching: false,
      refetch: apiState.retryProjects,
    };
    apiState.clientsQuery = {
      data: [{ id: "client-a", name: "Apex Client" }],
      isLoading: false,
      isPending: false,
      isError: false,
      isSuccess: true,
      isFetching: false,
      refetch: apiState.retryClients,
    };
    apiState.usersQuery = {
      data: [
        {
          id: "named-reviewer",
          name: "Named reviewer",
          email: "named@example.test",
          role: "reviewer",
          status: "active",
          membershipStatus: "active",
          reviewerEligible: true,
        },
      ],
      isLoading: false,
      isPending: false,
      isError: false,
      isSuccess: true,
      isFetching: false,
      refetch: apiState.retryUsers,
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("never presents a failed register as an empty portfolio and offers retry", async () => {
    apiState.projectsQuery = {
      data: undefined,
      isLoading: false,
      isError: true,
      isSuccess: false,
      isFetching: false,
      refetch: apiState.retryProjects,
    };

    renderPage();

    expect(
      screen.getByText(/pursuit register could not be loaded/i),
    ).toBeInTheDocument();
    expect(screen.queryByText("No pursuits found.")).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: /retry loading pursuit register/i }),
    );
    expect(apiState.retryProjects).toHaveBeenCalledTimes(1);
  });

  it("shows a genuine empty state only after a successful complete response", () => {
    renderPage();

    expect(screen.getByText("No pursuits found.")).toBeInTheDocument();
    expect(
      screen.queryByText(/register state is unavailable/i),
    ).not.toBeInTheDocument();
  });

  it("keeps a cold paused project register pending instead of rendering unavailable or empty", () => {
    apiState.projectsQuery = {
      data: undefined,
      isLoading: false,
      isPending: true,
      isError: false,
      isSuccess: false,
      isFetching: false,
      refetch: apiState.retryProjects,
    };

    renderPage();

    expect(
      screen.getByLabelText(/loading pursuit register/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/pursuit register could not be loaded/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("No pursuits found.")).not.toBeInTheDocument();
  });

  it("does not tell a read-only user to create a project", () => {
    apiState.canCreateProject = false;

    renderPage();

    expect(
      screen.getByText(
        /no pursuits are available for your current organisation access/i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/create a pursuit to begin/i),
    ).not.toBeInTheDocument();
  });

  it("requires a deliberate reviewer choice and explains the server-managed commercial gate", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: /new pursuit/i }));

    expect(
      await screen.findByText(/every new pursuit starts with payment pending/i),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Reviewer")).toHaveTextContent(
      "Select reviewer",
    );
    expect(
      screen.getByRole("button", { name: "Create pursuit" }),
    ).toBeDisabled();
    expect(screen.queryByLabelText("Payment Gate")).not.toBeInTheDocument();
  });

  it("clears a crafted clientId that is outside the loaded tenant directory", async () => {
    window.history.replaceState({}, "", "/projects?clientId=foreign-client-id");
    renderPage();

    expect(
      await screen.findByRole("heading", { name: /create pursuit/i }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByLabelText("Client")).toHaveTextContent(
        "Select client",
      );
    });
    expect(
      screen.getByRole("button", { name: "Create pursuit" }),
    ).toBeDisabled();
  });

  it("distinguishes a failed client directory from a genuine empty directory", async () => {
    const user = userEvent.setup();
    apiState.clientsQuery = {
      data: undefined,
      isLoading: false,
      isError: true,
      isSuccess: false,
      isFetching: false,
      refetch: apiState.retryClients,
    };
    renderPage();

    await user.click(screen.getByRole("button", { name: /new pursuit/i }));
    expect(
      await screen.findByText(/client list could not be loaded/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/no client records are available/i),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /retry clients/i }));
    expect(apiState.retryClients).toHaveBeenCalledTimes(1);
  });

  it("shows genuine no-client guidance only after a successful directory response", async () => {
    apiState.clientsQuery = {
      data: [],
      isLoading: false,
      isError: false,
      isSuccess: true,
      isFetching: false,
      refetch: apiState.retryClients,
    };
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: /new pursuit/i }));
    expect(
      await screen.findByText(/no client records are available/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/client list could not be loaded/i),
    ).not.toBeInTheDocument();
  });

  it("keeps a cold paused client directory pending instead of claiming it is empty", async () => {
    apiState.clientsQuery = {
      data: undefined,
      isLoading: false,
      isPending: true,
      isError: false,
      isSuccess: false,
      isFetching: false,
      refetch: apiState.retryClients,
    };
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: /new pursuit/i }));

    expect(await screen.findByText(/loading clients/i)).toBeInTheDocument();
    expect(
      screen.queryByText(/client list could not be loaded/i),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/no client records are available/i),
    ).not.toBeInTheDocument();
  });

  it("fails closed and offers retry when reviewer authority is unavailable", async () => {
    apiState.usersQuery = {
      data: undefined,
      isLoading: false,
      isPending: false,
      isError: true,
      isSuccess: false,
      isFetching: false,
      refetch: apiState.retryUsers,
    };
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: /new pursuit/i }));
    expect(
      await screen.findByText(/reviewer list could not be loaded/i),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Reviewer")).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /retry reviewers/i }));
    expect(apiState.retryUsers).toHaveBeenCalledTimes(1);
  });

  it("keeps a cold paused reviewer directory pending instead of claiming no reviewer exists", async () => {
    apiState.usersQuery = {
      data: undefined,
      isLoading: false,
      isPending: true,
      isError: false,
      isSuccess: false,
      isFetching: false,
      refetch: apiState.retryUsers,
    };
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: /new pursuit/i }));

    expect(await screen.findByText(/loading reviewers/i)).toBeInTheDocument();
    expect(
      screen.queryByText(/no active reviewer with direct access is available/i),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Reviewer")).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Create pursuit" }),
    ).toBeDisabled();
  });

  it("applies bounded search from the URL and writes subsequent search changes back", async () => {
    window.history.replaceState({}, "", "/projects?q=Airport");
    apiState.projectsQuery = {
      data: [
        project("airport", "Airport Upgrade"),
        project("bridge", "Bridge Rehabilitation"),
      ],
      isLoading: false,
      isError: false,
      isSuccess: true,
      isFetching: false,
      refetch: apiState.retryProjects,
    };

    renderPage();

    expect(screen.getByText("Airport Upgrade")).toBeInTheDocument();
    expect(screen.queryByText("Bridge Rehabilitation")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Search register"), {
      target: { value: "Bridge" },
    });

    await waitFor(() => {
      expect(new URLSearchParams(window.location.search).get("q")).toBe(
        "Bridge",
      );
    });
    expect(
      await screen.findByText("Bridge Rehabilitation"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Airport Upgrade")).not.toBeInTheDocument();
  });

  it("refreshes time-sensitive buckets on the bounded register clock", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-10T22:30:00.000Z"));
    window.history.replaceState({}, "", "/projects?deadline=overdue");
    apiState.projectsQuery = {
      data: [
        project("soon", "Deadline crossing", {
          deadline: "2026-08-10T22:30:30.000Z",
        }),
      ],
      isLoading: false,
      isError: false,
      isSuccess: true,
      isFetching: false,
      refetch: apiState.retryProjects,
    };

    renderPage();
    expect(screen.queryByText("Deadline crossing")).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(REGISTER_CLOCK_TEST_INTERVAL_MS);
    });

    expect(screen.getByText("Deadline crossing")).toBeInTheDocument();
  });
});

describe("project register filtering and WAT ordering", () => {
  it("bounds text and rejects unknown enumerated URL values", () => {
    const params = new URLSearchParams({
      q: "x".repeat(200),
      status: "invented",
      risk: "impossible",
      deadline: "sometime",
      sort: "random",
    });

    expect(readProjectRegisterFilters(params)).toEqual({
      ...DEFAULT_FILTERS,
      search: "x".repeat(120),
    });
  });

  it("combines authority-loaded fields and applies a stable deadline sort", () => {
    const projects = [
      project("no-deadline", "Zulu Tender", { deadline: null }),
      project("later", "Airport Tender", {
        clientId: "client-b",
        status: "review",
        riskBand: "high",
        reviewerName: "Bola Reviewer",
        reviewerId: "reviewer-bola",
        deadline: "2026-08-16T12:00:00Z",
      }),
      project("earlier-b", "Same Tender", {
        clientId: "client-b",
        status: "review",
        riskBand: "high",
        reviewerName: "Bola Reviewer",
        reviewerId: "reviewer-bola",
        deadline: "2026-08-11T00:30:00Z",
      }),
      project("earlier-a", "Same Tender", {
        clientId: "client-b",
        status: "review",
        riskBand: "high",
        reviewerName: "Bola Reviewer",
        reviewerId: "reviewer-bola",
        deadline: "2026-08-11T00:30:00Z",
      }),
    ];

    const result = filterAndSortProjects(
      projects,
      {
        ...DEFAULT_FILTERS,
        search: "tender",
        status: "review",
        risk: "high",
        client: "client-b",
        reviewer: "reviewer-bola",
        deadline: "next_7_days",
      },
      Date.parse("2026-08-10T22:30:00Z"),
    );

    expect(result.map(({ id }) => id)).toEqual([
      "earlier-a",
      "earlier-b",
      "later",
    ]);
  });

  it("uses WAT calendar days for deadline buckets and labels", () => {
    const result = filterAndSortProjects(
      [
        project("wat-tomorrow", "WAT tomorrow", {
          deadline: "2026-08-10T23:30:00Z",
        }),
        project("wat-today", "WAT today", {
          deadline: "2026-08-10T22:45:00Z",
        }),
      ],
      { ...DEFAULT_FILTERS, deadline: "due_today" },
      Date.parse("2026-08-10T22:30:00Z"),
    );

    expect(result.map(({ id }) => id)).toEqual(["wat-today"]);
    expect(formatDeadlineWat("2026-08-10T23:30:00Z")).toMatch(
      /11 Aug 2026, 00:30 WAT/u,
    );
  });

  it("parses naive legacy and creation deadlines as WAT, never host-local time", () => {
    expect(parseProjectDeadline("2026-08-11T00:30")).toEqual({
      kind: "valid",
      timestamp: Date.parse("2026-08-10T23:30:00.000Z"),
    });
    expect(deadlineInputToIsoWat("2026-08-11T00:30")).toBe(
      "2026-08-10T23:30:00.000Z",
    );
    expect(parseProjectDeadline("2026-02-30T10:00")).toEqual({
      kind: "invalid",
    });
    expect(parseProjectDeadline(null)).toEqual({ kind: "none" });
  });

  it("filters duplicate reviewer names by opaque reviewer identity", () => {
    const result = filterAndSortProjects(
      [
        project("ada-one", "First project", {
          reviewerId: "reviewer-one",
          reviewerName: "Ada Reviewer",
        }),
        project("ada-two", "Second project", {
          reviewerId: "reviewer-two",
          reviewerName: "Ada Reviewer",
        }),
      ],
      { ...DEFAULT_FILTERS, reviewer: "reviewer-two" },
    );

    expect(result.map(({ id }) => id)).toEqual(["ada-two"]);
    const params = new URLSearchParams({ reviewer: "reviewer-two" });
    expect(readProjectRegisterFilters(params).reviewer).toBe("reviewer-two");
    expect(params.toString()).not.toContain("Ada");
  });

  it("clears client or reviewer selections after directory eligibility is lost", () => {
    expect(
      retainEligibleSelectionId("reviewer-a", [
        { id: "reviewer-a" },
        { id: "reviewer-b" },
      ]),
    ).toBe("reviewer-a");
    expect(
      retainEligibleSelectionId("reviewer-a", [{ id: "reviewer-b" }]),
    ).toBe("");
  });
});
