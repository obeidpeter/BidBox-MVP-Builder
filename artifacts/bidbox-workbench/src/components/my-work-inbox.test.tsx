import type { ReactNode } from "react";
import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MyWorkInbox } from "./my-work-inbox";

const ORGANISATION_ID = "10000000-0000-4000-8000-000000000001";
const ACTOR_ID = "20000000-0000-4000-8000-000000000002";
const PROJECT_ID = "30000000-0000-4000-8000-000000000003";
const mocks = vi.hoisted(() => ({
  customFetch: vi.fn(),
  online: true,
}));

vi.mock("@workspace/api-client-react", () => ({
  customFetch: mocks.customFetch,
  useGetMe: () => ({
    data: { id: ACTOR_ID },
    isLoading: false,
    isPending: false,
    isError: false,
    isSuccess: true,
  }),
}));

vi.mock("@/contexts/organisation-context", () => ({
  useOrganisationAccess: () => ({
    activeOrganisation: {
      id: ORGANISATION_ID,
      accessSource: "membership",
      membershipOrganisationId: ORGANISATION_ID,
      membershipId: "40000000-0000-4000-8000-000000000004",
    },
    effectivePermissions: ["project:read", "project:update"],
  }),
}));

vi.mock("@/hooks/use-online-status", () => ({
  useOnlineStatus: () => mocks.online,
}));

vi.mock("wouter", () => ({
  Link: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

function response() {
  return {
    organisationId: ORGANISATION_ID,
    generatedAt: "2026-08-12T09:00:00.000Z",
    businessTimeZone: "Africa/Lagos",
    limit: 50,
    truncated: true,
    restrictedContent: true,
    groups: {
      overdue: [
        {
          key: "a".repeat(64),
          assignment: "owned",
          kind: "work_item",
          title: "Review response evidence",
          projectTitle: "Lagos transport bid",
          status: "in_progress",
          dueAt: "2026-08-11T14:00:00.000Z",
          priority: "high",
          href: `/pursuit-operations?project=${PROJECT_ID}`,
        },
      ],
      today: [],
      upcoming: [],
      unscheduled: [],
    },
  };
}

function renderInbox() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MyWorkInbox />
    </QueryClientProvider>,
  );
}

describe("MyWorkInbox", () => {
  beforeEach(() => {
    onlineManager.setOnline(true);
    mocks.customFetch.mockReset();
    mocks.online = true;
  });

  afterEach(() => {
    onlineManager.setOnline(true);
  });

  it("keeps a cold paused inbox pending instead of reporting a failed or empty read", () => {
    onlineManager.setOnline(false);

    renderInbox();

    expect(
      screen.getByText("Loading current work assignments"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("My Work could not be loaded"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("No active work to show"),
    ).not.toBeInTheDocument();
    expect(mocks.customFetch).not.toHaveBeenCalled();
  });

  it("loads only the authority-scoped private inbox and renders truncation", async () => {
    mocks.customFetch.mockResolvedValue(response());
    renderInbox();

    expect(
      await screen.findByRole("link", { name: /Review response evidence/u }),
    ).toHaveAttribute("href", `/pursuit-operations?project=${PROJECT_ID}`);
    expect(mocks.customFetch).toHaveBeenCalledWith(
      "/api/work-inbox?limit=50",
      expect.objectContaining({ cache: "no-store", responseType: "json" }),
    );
    expect(screen.getByText(/first 50 tasks/iu)).toBeInTheDocument();
  });

  it("shows loading and then fails closed when the authority-scoped read fails", async () => {
    let rejectRead: (error: Error) => void = () => {};
    mocks.customFetch.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectRead = reject;
      }),
    );
    renderInbox();
    expect(
      screen.getByText("Loading current work assignments"),
    ).toBeInTheDocument();
    rejectRead(new Error("unavailable"));
    await waitFor(() =>
      expect(
        screen.getByText("My Work could not be loaded"),
      ).toBeInTheDocument(),
    );
  });

  it("shows no cached authority state offline and performs no request", () => {
    mocks.online = false;
    renderInbox();
    expect(
      screen.getByText("My Work is unavailable offline"),
    ).toBeInTheDocument();
    expect(mocks.customFetch).not.toHaveBeenCalled();
  });
});
