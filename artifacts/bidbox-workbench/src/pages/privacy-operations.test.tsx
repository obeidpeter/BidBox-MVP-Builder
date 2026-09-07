import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PrivacyOperationsPage from "./privacy-operations";

const ORGANISATION_ID = "10000000-0000-4000-8000-000000000001";
const ACTOR_USER_ID = "20000000-0000-4000-8000-000000000002";
const CAPABILITY_KEY = "document:read|privacy:manage|privacy:read";
const mocks = vi.hoisted(() => ({
  customFetch: vi.fn(),
  accessSource: "membership" as "membership" | "partner",
  permissions: ["privacy:read", "privacy:manage", "document:read"],
  toast: vi.fn(),
}));

vi.mock("@workspace/api-client-react", () => ({
  customFetch: mocks.customFetch,
  useGetMe: () => ({
    data: { id: ACTOR_USER_ID },
    isLoading: false,
  }),
}));

vi.mock("@/contexts/organisation-context", () => ({
  useOrganisationAccess: () => ({
    activeOrganisation: {
      id: ORGANISATION_ID,
      accessSource: mocks.accessSource,
      membershipOrganisationId:
        mocks.accessSource === "membership" ? ORGANISATION_ID : null,
    },
    effectivePermissions: mocks.permissions,
    beginCriticalWorkflow: () => () => {},
  }),
}));

vi.mock("@/hooks/use-online-status", () => ({
  useOnlineStatus: () => true,
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

function dashboardResponse() {
  return {
    generatedAt: "2026-08-11T12:00:00.000Z",
    organisationId: ORGANISATION_ID,
    boundedTo: 25,
    legalDecisionAutomated: false,
    rawSubjectPiiIncluded: false,
    authorityNote:
      "Named humans decide; this centre cannot release holds or delete data.",
    totals: {
      dataSubjectRequests: 0,
      consentRecords: 0,
      legalHolds: 0,
      subprocessors: 0,
      crossBorderTransfers: 0,
      deletionActions: 0,
    },
    truncated: {
      dataSubjectRequests: false,
      consentRecords: false,
      legalHolds: false,
      subprocessors: false,
      crossBorderTransfers: false,
      deletionActions: false,
    },
    dataSubjectRequests: [],
    consentRecords: [],
    legalHolds: [],
    subprocessors: [],
    crossBorderTransfers: [],
    deletionActions: [],
    blockers: [],
  };
}

function assigneesResponse() {
  return {
    organisationId: ORGANISATION_ID,
    items: [
      {
        userId: "30000000-0000-4000-8000-000000000003",
        name: "Privacy Assignee",
      },
    ],
    limit: 100,
    truncated: false,
  };
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderPage(client = createQueryClient()) {
  return render(
    <QueryClientProvider client={client}>
      <PrivacyOperationsPage />
    </QueryClientProvider>,
  );
}

describe("PrivacyOperationsPage", () => {
  beforeEach(() => {
    onlineManager.setOnline(true);
    mocks.customFetch.mockReset();
    mocks.toast.mockReset();
    mocks.accessSource = "membership";
    mocks.permissions = ["privacy:read", "privacy:manage", "document:read"];
  });

  afterEach(() => {
    onlineManager.setOnline(true);
  });

  it("shows a cold paused governed picker while leaving manual digest evidence available", () => {
    const client = createQueryClient();
    client.setQueryData(
      ["privacy-operations", ORGANISATION_ID, ACTOR_USER_ID, CAPABILITY_KEY],
      dashboardResponse(),
    );
    client.setQueryData(
      [
        "privacy-operations",
        "assignees",
        ORGANISATION_ID,
        ACTOR_USER_ID,
        CAPABILITY_KEY,
      ],
      assigneesResponse(),
    );
    onlineManager.setOnline(false);

    renderPage(client);

    expect(
      screen.getByText("Loading approved document choices"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Decision evidence")).toBeDisabled();
    expect(
      screen.getByLabelText(/External or older decision evidence SHA-256/u),
    ).toBeEnabled();
    expect(
      screen.getByText(/Approved document choices are loading/u),
    ).toBeInTheDocument();
  });

  it("keeps a cold paused dashboard pending instead of reporting a verification error", () => {
    onlineManager.setOnline(false);

    renderPage();

    expect(
      screen.getByRole("heading", {
        name: "Loading privacy records",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", {
        name: "Privacy evidence could not be verified",
      }),
    ).not.toBeInTheDocument();
  });

  it("keeps a cold paused assignee directory pending after dashboard verification", () => {
    const client = createQueryClient();
    client.setQueryData(
      ["privacy-operations", ORGANISATION_ID, ACTOR_USER_ID, CAPABILITY_KEY],
      dashboardResponse(),
    );
    onlineManager.setOnline(false);

    renderPage(client);

    expect(screen.getByText("Loading privacy managers")).toBeInTheDocument();
    expect(
      screen.queryByText("Privacy managers could not be loaded"),
    ).not.toBeInTheDocument();
  });

  it("denies partner-derived access without calling the API", () => {
    mocks.accessSource = "partner";
    renderPage();
    expect(
      screen.getByText("Direct privacy membership required"),
    ).toBeInTheDocument();
    expect(mocks.customFetch).not.toHaveBeenCalled();
  });

  it("loads a tenant-bound bounded dashboard and exposes human workflows", async () => {
    mocks.customFetch.mockImplementation((url: string) =>
      Promise.resolve(
        url.endsWith("/assignees")
          ? assigneesResponse()
          : url.startsWith("/api/canonical-evidence-options")
            ? {
                organisationId: ORGANISATION_ID,
                projectId: null,
                limit: 100,
                truncated: false,
                items: [],
              }
            : dashboardResponse(),
      ),
    );
    renderPage();
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Privacy requests" }),
      ).toBeInTheDocument(),
    );
    expect(mocks.customFetch).toHaveBeenCalledWith(
      "/api/privacy-operations?limit=25",
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(
      screen.getByRole("heading", { name: "Record a privacy action" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("option", { name: "Privacy Assignee" }),
    ).toBeInTheDocument();
  });

  it("fails closed and retries when the privacy manager directory is unavailable", async () => {
    let assigneeAttempts = 0;
    mocks.customFetch.mockImplementation((url: string) => {
      if (url.endsWith("/assignees")) {
        assigneeAttempts += 1;
        return assigneeAttempts === 1
          ? Promise.reject(new Error("directory unavailable"))
          : Promise.resolve(assigneesResponse());
      }
      if (url.startsWith("/api/canonical-evidence-options")) {
        return Promise.resolve({
          organisationId: ORGANISATION_ID,
          projectId: null,
          limit: 100,
          truncated: false,
          items: [],
        });
      }
      return Promise.resolve(dashboardResponse());
    });

    renderPage();

    expect(
      await screen.findByText("Privacy managers could not be loaded"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/No active named privacy manager is available/u),
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Retry manager directory" }),
    );

    expect(
      await screen.findByRole("option", { name: "Privacy Assignee" }),
    ).toBeInTheDocument();
    expect(assigneeAttempts).toBe(2);
  });

  it("distinguishes a verified empty manager directory from a load failure", async () => {
    mocks.customFetch.mockImplementation((url: string) => {
      if (url.endsWith("/assignees")) {
        return Promise.resolve({ ...assigneesResponse(), items: [] });
      }
      if (url.startsWith("/api/canonical-evidence-options")) {
        return Promise.resolve({
          organisationId: ORGANISATION_ID,
          projectId: null,
          limit: 100,
          truncated: false,
          items: [],
        });
      }
      return Promise.resolve(dashboardResponse());
    });

    renderPage();

    expect(
      await screen.findByText(/No active named privacy manager is available/u),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Privacy managers could not be loaded"),
    ).not.toBeInTheDocument();
  });

  it("keeps the dashboard read-only without privacy:manage", async () => {
    mocks.permissions = ["privacy:read"];
    mocks.customFetch.mockResolvedValue(dashboardResponse());
    renderPage();
    await screen.findByRole("heading", { name: "Privacy requests" });
    expect(
      screen.queryByRole("heading", { name: "Record a privacy action" }),
    ).not.toBeInTheDocument();
  });

  it("keeps manual privacy evidence operable without document:read and skips the picker API", async () => {
    mocks.permissions = ["privacy:read", "privacy:manage"];
    mocks.customFetch.mockImplementation((url: string) =>
      Promise.resolve(
        url.endsWith("/assignees") ? assigneesResponse() : dashboardResponse(),
      ),
    );
    renderPage();
    await screen.findByRole("heading", {
      name: "Record a privacy action",
    });
    expect(
      await screen.findByRole("option", { name: "Privacy Assignee" }),
    ).toBeInTheDocument();
    expect(
      mocks.customFetch.mock.calls.some(([url]) =>
        String(url).startsWith("/api/canonical-evidence-options"),
      ),
    ).toBe(false);
    expect(
      screen.getByLabelText(/External or older decision evidence SHA-256/u),
    ).toBeInTheDocument();
  });
});
