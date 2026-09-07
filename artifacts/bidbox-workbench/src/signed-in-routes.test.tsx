import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ProtectedRoutes from "./protected-routes";

let currentRole = "reviewer";
let currentAccessSource: "membership" | "partner" = "membership";

const TEST_PERMISSIONS = [
  "analytics:read",
  "document:read",
  "defect:read",
  "draft:read",
  "package:read",
  "project:read",
  "client:read",
  "requirement:read",
  "evidence:read",
  "report:read",
  "evaluation:read",
  "partner_relationship:read",
  "entitlement:read",
  "billing:read",
  "order:create",
  "audit:read",
  "membership:manage",
  "configuration:manage",
  "organisation:read",
];

const ROUTE_LOAD_WAIT = { timeout: 5_000 };

vi.mock("@clerk/clerk-react", () => ({
  SignedIn: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SignedOut: () => null,
  UserButton: () => <div data-testid="clerk-user-button" />,
  useAuth: () => ({ isSignedIn: true, getToken: async () => "test-token" }),
}));

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@workspace/api-client-react")>();
  return {
    ...actual,
    useGetMe: () => ({
      data: {
        id: "u1",
        email: "user@example.com",
        role: currentRole,
        status: "active",
      },
      isLoading: false,
      isPending: false,
      isError: false,
      isSuccess: true,
    }),
    useGetDashboardMetrics: () => ({ data: undefined, isLoading: false }),
    useListProjects: () => ({
      data: [],
      isLoading: false,
      isError: false,
      isSuccess: true,
      refetch: vi.fn(),
    }),
    useGetProjectIntelligence: () => ({
      data: undefined,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    }),
    useGetVaultExpiring: () => ({
      data: {
        items: [],
        buckets: { expired: 0, critical: 0, warning: 0, upcoming: 0 },
      },
      isLoading: false,
      isError: false,
      isSuccess: true,
      refetch: vi.fn(),
    }),
    useGetWorkflowAlerts: () => ({
      data: { slaBreaches: [], redTeamDue: [], vaultExpiring: [] },
      isLoading: false,
      isError: false,
      isSuccess: true,
      refetch: vi.fn(),
    }),
    useListPartnerRelationships: () => ({
      data: [],
      isLoading: false,
      isError: false,
      isSuccess: true,
      refetch: vi.fn(),
    }),
    useGetAccessReview: () => ({
      data: { month: "2026-08", rows: [] },
      isLoading: false,
      isPending: false,
      isError: false,
      isSuccess: true,
    }),
    useGetLegacyIntegrityAssessment: () => ({
      data: [],
      isLoading: false,
      isPending: false,
      isError: false,
      isSuccess: true,
    }),
    customFetch: async (path: string) => {
      if (path === "/api/growth-suite/onboarding") {
        return {
          journey: {
            policyVersion: "route-test-v1",
            derivedFromRoles: [currentRole],
            checklist: [],
            syntheticTour: {
              dataClassification: "synthetic_non_customer",
              writesAuthoritativeState: false,
              title: "Synthetic route test",
              steps: [],
            },
          },
          progress: {
            journeyVersion: "route-test-v1",
            savedPracticeMarkerItemIds: [],
            completedItemIds: [],
            version: 0,
          },
        };
      }
      if (path === "/api/growth-suite/offers") {
        return { catalogueVersion: "route-test-v1", items: [] };
      }
      if (path === "/api/commercial-retainer/snapshot") {
        return {
          snapshot: {
            organisationId: "org-test",
            manifest: {
              moduleVersion: "valo.commercial-retainer@v1",
              routeMounted: true,
              navigationMounted: true,
              openApiPublished: true,
              automaticPricingAllowed: false,
              paymentProviderConnected: false,
              externalMessagingConnected: false,
              autonomousWorkAllowed: false,
              makerCheckerRequired: true,
            },
            activation: {
              fixedPriceBookReady: false,
              providerConnected: false,
              manualReconciliationReady: true,
              retainerDeskReady: false,
            },
            offers: [],
            quotes: [],
            invoices: [],
            payments: [],
            entitlements: [],
            serviceRequests: [],
          },
        };
      }
      throw new Error(`Unexpected customFetch route in test: ${path}`);
    },
  };
});

vi.mock("./contexts/organisation-context", () => ({
  useOrganisationPermission: (permission: string) =>
    TEST_PERMISSIONS.includes(permission),
  useOrganisationAccess: () => {
    const activeOrganisation = {
      id: "org-test",
      name: "Test organisation",
      slug: "test-organisation",
      type: "client" as const,
      status: "active",
      countryCode: "NG",
      membershipId: "membership-test",
      membershipOrganisationId: "org-test",
      accessSource: currentAccessSource,
      partnerRelationshipId: null,
      accessExpiresAt: null,
      roles: [currentRole],
      permissions: TEST_PERMISSIONS,
      version: 1,
    };
    return {
      organisations: [activeOrganisation],
      activeOrganisation,
      effectiveRoles: [currentRole],
      effectivePermissions: TEST_PERMISSIONS,
      isLoading: false,
      isError: false,
      error: null,
      needsSelection: false,
      isSwitching: false,
      hasPendingMutation: false,
      hasCriticalWorkflow: false,
      beginCriticalWorkflow: () => () => undefined,
      selectOrganisation: async () => true,
      refetch: vi.fn(),
    };
  },
}));

function renderAt(path: string) {
  const { hook } = memoryLocation({ path, record: true });
  // Pages use react-query hooks directly (e.g. useWorkflowAlerts), so the
  // route tree needs a QueryClient just like App provides in production.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <Router hook={hook}>
        <ProtectedRoutes />
      </Router>
    </QueryClientProvider>,
  );
}

describe("signed-in routing", () => {
  beforeEach(() => {
    currentRole = "reviewer";
    currentAccessSource = "membership";
    vi.stubEnv("VITE_FEATURE_CLIENT_PORTAL", "false");
    vi.stubEnv("VITE_FEATURE_PARTNER_WORKSPACE", "false");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("renders the Dashboard at the protected app path", async () => {
    renderAt("/app");
    expect(
      await screen.findByRole(
        "heading",
        { name: /^dashboard$/i },
        ROUTE_LOAD_WAIT,
      ),
    ).toBeInTheDocument();
  });

  it("renders the NotFound page for an unknown protected path", async () => {
    renderAt("/no/such/protected/route");
    expect(
      await screen.findByRole(
        "heading",
        { name: /we couldn't find this page/i },
        ROUTE_LOAD_WAIT,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /^dashboard$/i }),
    ).not.toBeInTheDocument();
  });

  it("renders the activation-gated client portal for a client owner", async () => {
    currentRole = "client_organisation_owner";
    renderAt("/portal");
    expect(
      await screen.findByRole(
        "heading",
        {
          level: 1,
          name: /^client portal$/i,
        },
        ROUTE_LOAD_WAIT,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: /client portal is not active yet/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /activation unavailable/i }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByLabelText(/status: pending/i).length).toBeGreaterThan(
      0,
    );
    expect(screen.queryByText(/start secure intake/i)).not.toBeInTheDocument();
  });

  it("renders connected client summaries when the portal is activated", async () => {
    currentRole = "client_organisation_owner";
    vi.stubEnv("VITE_FEATURE_CLIENT_PORTAL", "true");
    renderAt("/portal");
    expect(
      await screen.findByRole(
        "heading",
        { name: /organisation summary/i },
        ROUTE_LOAD_WAIT,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /no pursuits are available/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/no workflow alerts returned/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/no evidence in the expiry window/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/start secure intake/i)).not.toBeInTheDocument();
  });

  it("redirects a client owner to pursuits when the portal is inactive", async () => {
    currentRole = "client_organisation_owner";
    renderAt("/app");
    expect(
      await screen.findByRole(
        "heading",
        {
          level: 1,
          name: /^pursuits$/i,
        },
        ROUTE_LOAD_WAIT,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /^dashboard$/i }),
    ).not.toBeInTheDocument();
  });

  it("redirects a client owner to the client portal when it is active", async () => {
    currentRole = "client_organisation_owner";
    vi.stubEnv("VITE_FEATURE_CLIENT_PORTAL", "true");
    renderAt("/app");
    expect(
      await screen.findByRole(
        "heading",
        {
          level: 1,
          name: /^client portal$/i,
        },
        ROUTE_LOAD_WAIT,
      ),
    ).toBeInTheDocument();
  });

  it("blocks an internal reviewer from opening the client portal directly", () => {
    currentRole = "reviewer";
    renderAt("/portal");
    expect(
      screen.getByRole("heading", { name: /access denied/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /^client portal$/i }),
    ).not.toBeInTheDocument();
  });

  it("renders the gated partner workspace for a partner reviewer", async () => {
    currentRole = "consultancy_partner_analyst_reviewer";
    renderAt("/partner");
    expect(
      await screen.findByRole(
        "heading",
        {
          level: 1,
          name: /^partner workspace$/i,
        },
        ROUTE_LOAD_WAIT,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: /partner workspace is not active yet/i,
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/add managed client/i)).not.toBeInTheDocument();
  });

  it("renders connected partner summaries without inferring client data", async () => {
    currentRole = "consultancy_partner_analyst_reviewer";
    vi.stubEnv("VITE_FEATURE_PARTNER_WORKSPACE", "true");
    renderAt("/partner");
    expect(
      await screen.findByRole(
        "heading",
        {
          name: /partner summary/i,
        },
        ROUTE_LOAD_WAIT,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/no partner relationships returned/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/no partner pursuits are available/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/no partner evidence in the expiry window/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/add managed client/i)).not.toBeInTheDocument();
  });

  it("keeps the consortium room under the partner workspace activation gate", async () => {
    currentRole = "consultancy_partner_analyst_reviewer";
    renderAt("/consortium-room");
    expect(
      await screen.findByRole(
        "heading",
        { name: /partner workspace is not active yet/i },
        ROUTE_LOAD_WAIT,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/assign, accept, and independently check/i),
    ).not.toBeInTheDocument();
  });

  it("loads the consortium room only for an activated partner-workspace role", async () => {
    currentRole = "consultancy_partner_analyst_reviewer";
    vi.stubEnv("VITE_FEATURE_PARTNER_WORKSPACE", "true");
    renderAt("/consortium-room");
    expect(
      await screen.findByRole(
        "heading",
        { name: /no active relationship project is available/i },
        ROUTE_LOAD_WAIT,
      ),
    ).toBeInTheDocument();
  });

  it("denies the consortium room to roles outside partner_workspace", () => {
    currentRole = "reviewer";
    vi.stubEnv("VITE_FEATURE_PARTNER_WORKSPACE", "true");
    renderAt("/consortium-room");
    expect(
      screen.getByRole("heading", { name: /access denied/i }),
    ).toBeInTheDocument();
  });

  it("opens pursuit workbench in the selected authorised partner context", async () => {
    currentRole = "consultancy_partner_administrator";
    vi.stubEnv("VITE_FEATURE_PARTNER_WORKSPACE", "true");
    renderAt("/projects");
    expect(
      await screen.findByRole(
        "heading",
        { name: /^pursuits$/i },
        ROUTE_LOAD_WAIT,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /access denied/i }),
    ).not.toBeInTheDocument();
  });

  it("opens the Intelligence Centre without implying model execution", async () => {
    currentRole = "client_reviewer_approver";
    renderAt("/intelligence");

    expect(
      await screen.findByRole(
        "heading",
        { name: "Bid insights" },
        ROUTE_LOAD_WAIT,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "No intelligence evidence is available",
      }),
    ).toBeInTheDocument();
  });

  it("opens the pursuit operations suite without replacing the reviews console", async () => {
    renderAt("/pursuit-operations");
    expect(
      await screen.findByRole(
        "heading",
        { name: /no accessible pursuits are available/i },
        ROUTE_LOAD_WAIT,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /^reviews$/i }),
    ).not.toBeInTheDocument();
  });

  it("opens growth operations for a directly assigned Valo operations administrator", async () => {
    currentRole = "valo_operations_administrator";
    renderAt("/growth-operations");
    expect(
      await screen.findByRole(
        "heading",
        { name: /leads & offers/i },
        ROUTE_LOAD_WAIT,
      ),
    ).toBeInTheDocument();
  });

  it("opens onboarding and offers for a direct client member", async () => {
    currentRole = "client_reviewer_approver";
    renderAt("/growth-operations");
    expect(
      await screen.findByRole(
        "heading",
        { name: /leads & offers/i },
        ROUTE_LOAD_WAIT,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /qualify before conversion/i }),
    ).not.toBeInTheDocument();
  });

  it("blocks partner-derived access from onboarding and offers", () => {
    currentRole = "consultancy_partner_analyst_reviewer";
    currentAccessSource = "partner";
    renderAt("/growth-operations");
    expect(
      screen.getByRole("heading", { name: /access denied/i }),
    ).toBeInTheDocument();
  });

  it("opens the tenant-bound Commercial & Retainer ledger for a direct authorised member", async () => {
    currentRole = "client_organisation_owner";
    renderAt("/commercial-retainer");
    expect(
      await screen.findByRole(
        "heading",
        { name: /quotes, invoices & retainers/i },
        ROUTE_LOAD_WAIT,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/approved price-book version is missing/i),
    ).toBeInTheDocument();
  });

  it("blocks partner-derived access from the Commercial & Retainer ledger", () => {
    currentRole = "consultancy_partner_administrator";
    currentAccessSource = "partner";
    renderAt("/commercial-retainer");
    expect(
      screen.getByRole("heading", { name: /access denied/i }),
    ).toBeInTheDocument();
  });

  it("opens the dedicated Claims Desk route for direct project-read membership", async () => {
    currentRole = "client_reviewer_approver";
    renderAt("/claims-desk");
    expect(
      await screen.findByRole(
        "heading",
        { name: /no active project is available/i },
        ROUTE_LOAD_WAIT,
      ),
    ).toBeInTheDocument();
  });

  it("blocks partner-derived access from the Claims Desk route", () => {
    currentRole = "consultancy_partner_analyst_reviewer";
    currentAccessSource = "partner";
    renderAt("/claims-desk");
    expect(
      screen.getByRole("heading", { name: /access denied/i }),
    ).toBeInTheDocument();
  });

  it("allows a read-only auditor to open the tenant-filtered security review", async () => {
    currentRole = "read_only_auditor";
    renderAt("/app/security");
    expect(
      await screen.findByRole(
        "heading",
        {
          level: 1,
          name: /security & audit/i,
        },
        ROUTE_LOAD_WAIT,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/no access records returned/i)).toBeInTheDocument();
  });
});
