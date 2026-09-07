import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PortfolioIntelligence from "./portfolio-intelligence";

const portfolioHook = vi.fn();
const refetch = vi.fn();
const ACTOR_ID = "99999999-9999-4999-8999-999999999999";

const state = {
  canRead: true,
  accessSource: "membership" as "membership" | "partner",
  actorName: "Portfolio Reviewer",
  meLoading: false,
  loading: false,
  pending: false,
  error: false,
  data: portfolioSnapshot(),
};

vi.mock("@workspace/api-client-react", () => ({
  getGetPortfolioIntelligenceQueryKey: () => ["/api/portfolio-intelligence"],
  useGetPortfolioIntelligence: (...args: unknown[]) => {
    portfolioHook(...args);
    return {
      data: state.data,
      isLoading: state.loading,
      isPending: state.pending,
      isError: state.error,
      isFetching: false,
      refetch,
    };
  },
  useGetMe: () => ({
    data: { id: ACTOR_ID, name: state.actorName },
    isLoading: state.meLoading,
    isPending: state.meLoading,
  }),
}));

vi.mock("@/contexts/organisation-context", () => ({
  useOrganisationAccess: () => ({
    activeOrganisation: {
      id: "organisation-1",
      membershipOrganisationId: "organisation-1",
      accessSource: state.accessSource,
    },
    isLoading: false,
  }),
  useOrganisationPermission: (permission: string) =>
    new Set([
      "project:read",
      "draft:read",
      "defect:read",
      "package:read",
      "analytics:read",
    ]).has(permission) && state.canRead,
}));

function portfolioSnapshot() {
  return {
    generatedAt: "2026-08-22T12:00:00.000Z",
    authorityNote:
      "Portfolio intelligence is deterministic operational evidence, not an award prediction.",
    totals: {
      projectCount: 3,
      responseReadyCount: 2,
      redTeamApprovedCount: 2,
      packageReadyCount: 1,
      rehearsalReadyCount: 1,
      confirmedOutcomeCount: 0,
    },
    projects: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        title: "Ready hospital supply",
        status: "reporting",
        deadline: "2026-08-30T12:00:00.000Z",
        responseStatus: "ready",
        redTeamStatus: "approved",
        packageStatus: "ready",
        rehearsalStatus: "rehearsal_ready",
        nextAction: "Authorised operator reviews the frozen package.",
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        title: "Blocked road works",
        status: "review",
        deadline: null,
        responseStatus: "review_required",
        redTeamStatus: "findings_open",
        packageStatus: "not_started",
        rehearsalStatus: "not_started",
        nextAction: "Resolve the fatal red-team finding.",
      },
      {
        id: "33333333-3333-4333-8333-333333333333",
        title: "Stale water programme",
        status: "reporting",
        deadline: "2026-09-04T12:00:00.000Z",
        responseStatus: "ready",
        redTeamStatus: "approved",
        packageStatus: "stale",
        rehearsalStatus: "stale",
        nextAction: "Reassemble against the current source snapshot.",
      },
    ],
    limitations: [
      "Statuses are deterministic workflow facts, not win predictions.",
    ],
  };
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const location = memoryLocation({ path: "/portfolio-intelligence" });
  return render(
    <QueryClientProvider client={queryClient}>
      <Router hook={location.hook}>
        <PortfolioIntelligence />
      </Router>
    </QueryClientProvider>,
  );
}

describe("PortfolioIntelligence", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView ??= vi.fn();
    state.canRead = true;
    state.accessSource = "membership";
    state.actorName = "Portfolio Reviewer";
    state.meLoading = false;
    state.loading = false;
    state.pending = false;
    state.error = false;
    state.data = portfolioSnapshot();
    portfolioHook.mockReset();
    refetch.mockReset();
  });

  it("shows ready, blocked and stale pursuits without presenting an award score", async () => {
    const user = userEvent.setup();
    renderPage();

    expect(
      screen.getByRole("heading", { name: "Portfolio intelligence" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Ready hospital supply")).toBeInTheDocument();
    expect(screen.getByText("Blocked road works")).toBeInTheDocument();
    expect(screen.getByText("Stale water programme")).toBeInTheDocument();
    expect(screen.getAllByLabelText("Status: Ready").length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText("Status: Blocked").length).toBeGreaterThan(
      0,
    );
    expect(screen.getAllByLabelText("Status: Stale").length).toBeGreaterThan(0);
    for (const metric of [
      "Response ready: 2",
      "Red-team approved: 2",
      "Package ready: 1",
      "Rehearsal ready: 1",
      "Confirmed outcomes: 0",
    ]) {
      expect(screen.getByLabelText(metric)).toBeInTheDocument();
    }
    expect(screen.queryByText(/win probability/i)).not.toBeInTheDocument();
    expect(
      screen.getByText(
        /does not sign in to, upload to or submit through an external procurement portal/i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("link", { name: "Open delivery studio" })[0],
    ).toHaveAttribute(
      "href",
      "/projects/11111111-1111-4111-8111-111111111111?tab=delivery",
    );

    const deliveryState = screen.getByRole("combobox", {
      name: "Delivery state",
    });
    deliveryState.focus();
    await user.keyboard("{ArrowDown}");
    expect(
      await screen.findByRole("option", { name: "Ready" }),
    ).toBeInTheDocument();
    await user.keyboard("{ArrowDown}{Enter}");
    expect(screen.getByText("Ready hospital supply")).toBeInTheDocument();
    expect(screen.queryByText("Blocked road works")).not.toBeInTheDocument();
    expect(screen.queryByText("Stale water programme")).not.toBeInTheDocument();
  });

  it("fails closed without analytics:read and disables the request", () => {
    state.canRead = false;
    renderPage();

    expect(
      screen.getByRole("heading", {
        name: "Portfolio intelligence access required",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Ready hospital supply")).not.toBeInTheDocument();
    expect(portfolioHook).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({ enabled: false }),
      }),
    );
  });

  it("fails closed for partner access even when every read grant is present", () => {
    state.accessSource = "partner";
    renderPage();

    expect(
      screen.getByRole("heading", {
        name: "Portfolio intelligence access required",
      }),
    ).toBeInTheDocument();
    expect(portfolioHook).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({ enabled: false }),
      }),
    );
  });

  it.each(["", " ", "A", "A".repeat(201)])(
    "does not request portfolio intelligence for an invalid actor name %#",
    (actorName) => {
      state.actorName = actorName;
      renderPage();

      expect(
        screen.getByRole("heading", { name: "Named profile required" }),
      ).toBeInTheDocument();
      expect(portfolioHook).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.objectContaining({ enabled: false }),
        }),
      );
    },
  );

  it("keeps empty portfolio and filtered-empty states explicit", async () => {
    const view = renderPage();
    await userEvent.type(
      screen.getByRole("searchbox", { name: "Search pursuits" }),
      "not present",
    );
    expect(
      screen.getByRole("heading", { name: "No pursuits match these filters" }),
    ).toBeInTheDocument();

    state.data = { ...portfolioSnapshot(), projects: [] };
    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <Router hook={memoryLocation({ path: "/portfolio-intelligence" }).hook}>
          <PortfolioIntelligence />
        </Router>
      </QueryClientProvider>,
    );
    expect(
      screen.getByRole("heading", {
        name: "No pursuits are available for portfolio intelligence",
      }),
    ).toBeInTheDocument();
  });

  it("keeps cold-paused loading separate and transport errors retryable", async () => {
    state.pending = true;
    const view = renderPage();
    expect(
      screen.getByText("Loading portfolio intelligence"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/No pursuits are available/i),
    ).not.toBeInTheDocument();

    state.pending = false;
    state.error = true;
    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <Router hook={memoryLocation({ path: "/portfolio-intelligence" }).hook}>
          <PortfolioIntelligence />
        </Router>
      </QueryClientProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
