import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ReportsIndex from "./reports-index";

const apiState = vi.hoisted(() => ({
  projectsQuery: {} as Record<string, unknown>,
  reportsByProject: new Map<string, unknown>(),
}));

vi.mock("@workspace/api-client-react", () => ({
  getListReportsQueryKey: (id: string) => ["reports", id],
  listReports: vi.fn(async (id: string) => {
    const value = apiState.reportsByProject.get(id);
    if (value instanceof Error) throw value;
    return value ?? [];
  }),
  useListProjects: () => apiState.projectsQuery,
}));

function project(id: string, tenderTitle: string) {
  return {
    id,
    tenderTitle,
    clientName: `${tenderTitle} Client`,
  };
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ReportsIndex />
    </QueryClientProvider>,
  );
}

describe("reports directory data states", () => {
  beforeEach(() => {
    apiState.reportsByProject.clear();
    apiState.projectsQuery = {
      data: [],
      isLoading: false,
      isError: false,
      isSuccess: true,
      refetch: vi.fn(),
    };
  });

  it("does not present a failed pursuit query as an empty portfolio", () => {
    apiState.projectsQuery = {
      data: undefined,
      isLoading: false,
      isError: true,
      isSuccess: false,
      refetch: vi.fn(),
    };

    renderPage();

    expect(
      screen.getByText(/pursuit list could not be loaded/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/no pursuits are available/i),
    ).not.toBeInTheDocument();
  });

  it("excludes a failed report register from counts and labels its row unavailable", async () => {
    apiState.projectsQuery = {
      data: [
        project("project-a", "Airport Upgrade"),
        project("project-b", "Bridge Works"),
      ],
      isLoading: false,
      isError: false,
      isSuccess: true,
      refetch: vi.fn(),
    };
    apiState.reportsByProject.set("project-a", [
      {
        id: "report-1",
        version: 1,
        status: "draft",
        createdAt: "2026-08-01T09:00:00Z",
      },
      {
        id: "report-2",
        version: 2,
        status: "signed_off",
        createdAt: "2026-08-02T09:00:00Z",
      },
    ]);
    apiState.reportsByProject.set(
      "project-b",
      new Error("register unavailable"),
    );

    renderPage();

    expect(
      await screen.findByText(/some pursuit reports could not be loaded/i),
    ).toBeInTheDocument();
    const airportRow = screen.getByText("Airport Upgrade").closest("tr");
    const bridgeRow = screen.getByText("Bridge Works").closest("tr");
    expect(airportRow).not.toBeNull();
    expect(bridgeRow).not.toBeNull();
    expect(within(airportRow!).getByText("2")).toBeInTheDocument();
    expect(within(bridgeRow!).getAllByText("Unavailable")).toHaveLength(3);
    expect(within(bridgeRow!).queryByText("0")).not.toBeInTheDocument();
    expect(within(bridgeRow!).queryByText("No report")).not.toBeInTheDocument();
  });

  it("shows a genuine zero only after an empty register loads successfully", async () => {
    apiState.projectsQuery = {
      data: [project("project-a", "Airport Upgrade")],
      isLoading: false,
      isError: false,
      isSuccess: true,
      refetch: vi.fn(),
    };
    apiState.reportsByProject.set("project-a", []);

    renderPage();

    const row = (await screen.findByText("Airport Upgrade")).closest("tr");
    expect(row).not.toBeNull();
    expect(await within(row!).findByText("0")).toBeInTheDocument();
    expect(within(row!).getByText("No report")).toBeInTheDocument();
    expect(within(row!).queryByText("Unavailable")).not.toBeInTheDocument();
  });
});
