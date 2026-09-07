import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PRODUCTION_ACCEPTANCE_CATEGORIES } from "@/components/production-acceptance/production-acceptance-contract";
import ProductionAcceptancePage from "./production-acceptance";

const mocks = vi.hoisted(() => ({
  customFetch: vi.fn(),
  accessSource: "membership" as "membership" | "partner",
  roles: ["valo_operations_administrator"],
  permissions: ["audit:read", "configuration:manage"],
  toast: vi.fn(),
}));

vi.mock("@workspace/api-client-react", () => ({
  customFetch: mocks.customFetch,
}));

vi.mock("@/contexts/organisation-context", () => ({
  useOrganisationAccess: () => ({
    activeOrganisation: {
      id: "organisation-a",
      accessSource: mocks.accessSource,
    },
    effectiveRoles: mocks.roles,
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

const RELEASE_SHA = "a".repeat(64);
const OWNER_USER_ID = "33333333-3333-4333-8333-333333333333";

function authoritiesResponse() {
  return {
    organisationId: "organisation-a",
    items: [{ userId: OWNER_USER_ID, name: "Migration Owner" }],
    limit: 100,
    truncated: false,
  };
}

function snapshotResponse() {
  return {
    generatedAt: "2026-08-11T10:00:00.000Z",
    organisationId: "organisation-a",
    expectedReleaseSha256: RELEASE_SHA,
    recommendedDecision: "go",
    deploymentAuthorized: false,
    requiresNamedHumanApproval: true,
    blockers: [],
    authorityNote:
      "This console records evidence only. A named human makes the final decision.",
    categories: PRODUCTION_ACCEPTANCE_CATEGORIES.map((category) => ({
      category,
      label: category.replaceAll("_", " "),
      state: "passed",
      required: true,
      latestEvidence: {
        schema: "valo.production-acceptance-evidence/v1",
        id: "b".repeat(64),
        organisationId: "organisation-a",
        category,
        outcome: "passed",
        environment: "recovery_rehearsal",
        releaseSha256: RELEASE_SHA,
        ownerUserId: "evidence-owner",
        verifiedByUserId: "quality-verifier",
        observedAt: "2026-08-11T09:00:00.000Z",
        expiresAt: "2026-08-18T09:00:00.000Z",
        evidenceReference: `private/${category}/run-1`,
        artifactSha256: "c".repeat(64),
        summary: "Synthetic rehearsal evidence retained for review.",
        recordedAt: "2026-08-11T10:00:00.000Z",
        evidenceDigest: "b".repeat(64),
      },
    })),
  };
}

function renderPage(configure?: (client: QueryClient) => void) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  configure?.(client);
  return render(
    <QueryClientProvider client={client}>
      <ProductionAcceptancePage />
    </QueryClientProvider>,
  );
}

describe("ProductionAcceptancePage", () => {
  beforeEach(() => {
    onlineManager.setOnline(true);
    mocks.customFetch.mockReset();
    mocks.toast.mockReset();
    mocks.accessSource = "membership";
    mocks.roles = ["valo_operations_administrator"];
    mocks.permissions = ["audit:read", "configuration:manage"];
  });

  afterEach(() => {
    onlineManager.setOnline(true);
  });

  it("denies partner-derived access without calling the API", () => {
    mocks.accessSource = "partner";
    renderPage();
    expect(
      screen.getByText("Release-check access required"),
    ).toBeInTheDocument();
    expect(mocks.customFetch).not.toHaveBeenCalled();
  });

  it("loads a tenant-bound snapshot and exposes evidence recording only to writers", async () => {
    mocks.customFetch.mockImplementation((url: string) =>
      Promise.resolve(
        url.endsWith("/authorities")
          ? authoritiesResponse()
          : snapshotResponse(),
      ),
    );
    renderPage();
    await waitFor(() =>
      expect(
        screen.getByRole("heading", {
          name: "Release checks",
        }),
      ).toBeInTheDocument(),
    );
    expect(mocks.customFetch).toHaveBeenCalledWith(
      "/api/production-acceptance",
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(
      screen.getByRole("heading", { name: "Record retained evidence" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("option", { name: /^Migration Owner/u }),
    ).toBeInTheDocument();
  });

  it("fails closed and retries when the authority directory is unavailable", async () => {
    let authorityAttempts = 0;
    mocks.customFetch.mockImplementation((url: string) => {
      if (url.endsWith("/authorities")) {
        authorityAttempts += 1;
        return authorityAttempts === 1
          ? Promise.reject(new Error("directory unavailable"))
          : Promise.resolve(authoritiesResponse());
      }
      return Promise.resolve(snapshotResponse());
    });

    renderPage();

    expect(
      await screen.findByText("Acceptance owners could not be loaded"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/No other active owner is available/u),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry owner list" }));

    expect(
      await screen.findByRole("option", { name: /^Migration Owner/u }),
    ).toBeInTheDocument();
    expect(authorityAttempts).toBe(2);
  });

  it("distinguishes a verified empty authority directory from a load failure", async () => {
    mocks.customFetch.mockImplementation((url: string) =>
      Promise.resolve(
        url.endsWith("/authorities")
          ? { ...authoritiesResponse(), items: [] }
          : snapshotResponse(),
      ),
    );

    renderPage();

    expect(
      await screen.findByText(/No other active owner is available/u),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Acceptance owners could not be loaded"),
    ).not.toBeInTheDocument();
  });

  it("keeps the register read-only when the role lacks recording authority", async () => {
    mocks.roles = ["restricted_platform_administrator"];
    mocks.permissions = ["audit:read", "feature_flag:manage"];
    mocks.customFetch.mockResolvedValue(snapshotResponse());
    renderPage();
    await screen.findByRole("heading", {
      name: "Release checks",
    });
    expect(
      screen.queryByRole("heading", { name: "Record retained evidence" }),
    ).not.toBeInTheDocument();
  });

  it("keeps a cold paused acceptance snapshot pending", () => {
    onlineManager.setOnline(false);

    renderPage();

    expect(
      screen.getByText("Loading production acceptance evidence"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        "Production acceptance evidence could not be verified",
      ),
    ).not.toBeInTheDocument();
    expect(mocks.customFetch).not.toHaveBeenCalled();
  });

  it("keeps a cold paused authority directory pending after the snapshot is verified", () => {
    onlineManager.setOnline(false);

    renderPage((client) => {
      client.setQueryData(
        ["production-acceptance", "organisation-a"],
        snapshotResponse(),
      );
    });

    expect(screen.getByText("Loading acceptance owners")).toBeInTheDocument();
    expect(
      screen.queryByText("Acceptance owners could not be loaded"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Record retained evidence" }),
    ).not.toBeInTheDocument();
  });
});
