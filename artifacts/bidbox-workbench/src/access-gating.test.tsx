import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import Layout from "./components/layout";
import RequireAdmin from "./components/require-admin";

type MeResult = {
  data?: unknown;
  isLoading: boolean;
  isPending?: boolean;
  isError?: boolean;
  error?: unknown;
};

let meResult: MeResult = { data: undefined, isLoading: true };

const TEST_PERMISSIONS = [
  "analytics:read",
  "project:read",
  "client:read",
  "requirement:read",
  "evidence:read",
  "report:read",
  "partner_relationship:read",
  "entitlement:read",
  "audit:read",
  "membership:manage",
  "configuration:manage",
  "organisation:read",
];

vi.mock("@clerk/clerk-react", () => ({
  UserButton: () => <div data-testid="clerk-user-button" />,
  useAuth: () => ({ isSignedIn: true, getToken: async () => "test-token" }),
}));

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@workspace/api-client-react")>();
  return {
    ...actual,
    useGetMe: () => meResult,
    getGetMeQueryKey: () => ["/api/me"],
    useListProjects: () => ({
      data: [],
      isError: false,
      isLoading: false,
    }),
  };
});

vi.mock("./contexts/organisation-context", () => ({
  useOrganisationAccess: () => {
    const identity = meResult.data as
      | { role?: string; hasOrganisation?: boolean }
      | undefined;
    const role = identity?.role;
    const activeOrganisation =
      role && identity?.hasOrganisation !== false
        ? {
            id: "org-test",
            name: "Test organisation",
            slug: "test-organisation",
            type: "client" as const,
            status: "active",
            countryCode: "NG",
            membershipId: "membership-test",
            membershipOrganisationId: "org-test",
            accessSource: "membership" as const,
            partnerRelationshipId: null,
            accessExpiresAt: null,
            roles: [role],
            permissions: TEST_PERMISSIONS,
            version: 1,
          }
        : null;
    return {
      organisations: activeOrganisation ? [activeOrganisation] : [],
      activeOrganisation,
      effectiveRoles: activeOrganisation?.roles ?? [],
      effectivePermissions: activeOrganisation?.permissions ?? [],
      isLoading: meResult.isLoading,
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

function renderLayout() {
  return render(
    <Layout>
      <div data-testid="protected-child">Protected Content</div>
    </Layout>,
  );
}

describe("access gating in Layout", () => {
  beforeEach(() => {
    meResult = { data: undefined, isLoading: true };
    window.history.pushState({}, "", "/app");
  });

  it("lets a signed-in user without an organisation open their profile", () => {
    meResult = {
      data: {
        id: "2e1295d3-898f-4757-abec-a06df959401e",
        email: "new-user@example.com",
        name: "New User",
        role: "none",
        status: "active",
        hasOrganisation: false,
      },
      isLoading: false,
    };
    window.history.pushState({}, "", "/account");

    renderLayout();

    expect(screen.getByTestId("protected-child")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Valo home" })).toBeInTheDocument();
    expect(
      screen.queryByText(/you don't have organisation access yet/i),
    ).not.toBeInTheDocument();
  });

  it("shows a new user's ID while ordinary workspace routes remain blocked", () => {
    const userId = "2e1295d3-898f-4757-abec-a06df959401e";
    meResult = {
      data: {
        id: userId,
        email: "new-user@example.com",
        name: "New User",
        role: "none",
        status: "active",
        hasOrganisation: false,
      },
      isLoading: false,
    };

    renderLayout();

    expect(
      screen.getByText(/you don't have organisation access yet/i),
    ).toBeInTheDocument();
    expect(screen.getByText(userId)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Copy Valo user ID" }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("protected-child")).not.toBeInTheDocument();
  });

  it("shows the Pending Access screen for a role 'none' account and hides the app", () => {
    meResult = {
      data: {
        id: "u1",
        email: "pending@example.com",
        name: "Pending User",
        role: "none",
        status: "active",
      },
      isLoading: false,
    };
    renderLayout();
    expect(screen.getByText(/no role assigned yet/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/valo dashboard/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId("protected-child")).not.toBeInTheDocument();
  });

  it("shows the blocked Account Disabled screen for a disabled account and hides the app", () => {
    meResult = {
      data: {
        id: "u2",
        email: "disabled@example.com",
        name: "Disabled User",
        role: "reviewer",
        status: "disabled",
      },
      isLoading: false,
    };
    renderLayout();
    expect(screen.getByText(/account disabled/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/status: blocked/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/valo dashboard/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId("protected-child")).not.toBeInTheDocument();
  });

  it("shows the Authentication Failed screen when useGetMe errors", () => {
    meResult = { data: undefined, isLoading: false, error: new Error("boom") };
    renderLayout();
    expect(screen.getByText(/we couldn't sign you in/i)).toBeInTheDocument();
    expect(screen.queryByTestId("protected-child")).not.toBeInTheDocument();
  });

  it("shows the Authentication Failed screen when there is no user", () => {
    meResult = { data: undefined, isLoading: false };
    renderLayout();
    expect(screen.getByText(/we couldn't sign you in/i)).toBeInTheDocument();
    expect(screen.queryByTestId("protected-child")).not.toBeInTheDocument();
  });

  it("keeps a cold paused identity query in the authentication loading state", () => {
    meResult = {
      data: undefined,
      isLoading: false,
      isPending: true,
      isError: false,
    };
    renderLayout();
    expect(
      screen.getByText(/signing you in and opening your workspace/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/we couldn't sign you in/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("protected-child")).not.toBeInTheDocument();
  });

  it("fails closed when the server returns an unknown role", () => {
    meResult = {
      data: {
        id: "ux",
        email: "unknown@example.com",
        name: "Unknown Role",
        role: "unexpected_role",
        status: "active",
      },
      isLoading: false,
    };
    renderLayout();
    expect(screen.getByText(/this role isn't supported/i)).toBeInTheDocument();
    expect(screen.queryByTestId("protected-child")).not.toBeInTheDocument();
  });

  it("renders the nav and children for a valid approved user", () => {
    meResult = {
      data: {
        id: "u3",
        email: "approved@example.com",
        name: "Approved User",
        role: "reviewer",
        status: "active",
      },
      isLoading: false,
    };
    renderLayout();
    expect(screen.getByLabelText(/valo dashboard/i)).toBeInTheDocument();
    expect(screen.getByText(/^dashboard$/i)).toBeInTheDocument();
    expect(screen.getByText(/^pursuit workflows$/i)).toBeInTheDocument();
    expect(screen.getByText(/^claims$/i)).toBeInTheDocument();
    expect(screen.getByText(/^leads & offers$/i)).toBeInTheDocument();
    expect(screen.getByTestId("protected-child")).toBeInTheDocument();
    expect(screen.queryByText(/no role assigned yet/i)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/we couldn't sign you in/i),
    ).not.toBeInTheDocument();
  });

  it("shows the Settings nav item for an approved admin", () => {
    meResult = {
      data: {
        id: "u4",
        email: "admin@example.com",
        name: "Admin User",
        role: "admin",
        status: "active",
      },
      isLoading: false,
    };
    renderLayout();
    expect(screen.getByText(/^platform settings$/i)).toBeInTheDocument();
    expect(screen.getByText(/^leads & offers$/i)).toBeInTheDocument();
  });

  it("hides the Settings nav item from an approved reviewer", () => {
    meResult = {
      data: {
        id: "u5",
        email: "reviewer@example.com",
        name: "Reviewer User",
        role: "reviewer",
        status: "active",
      },
      isLoading: false,
    };
    renderLayout();
    expect(screen.getByText(/^dashboard$/i)).toBeInTheDocument();
    expect(screen.queryByText(/^platform settings$/i)).not.toBeInTheDocument();
  });

  it("shows pursuit and client-facing surfaces to a client owner", () => {
    meResult = {
      data: {
        id: "u8",
        email: "owner@example.com",
        name: "Client Owner",
        role: "client_organisation_owner",
        status: "active",
      },
      isLoading: false,
    };
    renderLayout();
    expect(screen.getByText(/client workspace/i)).toBeInTheDocument();
    expect(screen.getByText(/^pursuits$/i)).toBeInTheDocument();
    expect(screen.getByText(/^clients$/i)).toBeInTheDocument();
    expect(screen.getByText(/evidence library/i)).toBeInTheDocument();
    expect(screen.getByText(/^pursuit workflows$/i)).toBeInTheDocument();
    expect(screen.getByText(/^leads & offers$/i)).toBeInTheDocument();
    expect(screen.getByText(/billing & access/i)).toBeInTheDocument();
    expect(screen.queryByText(/^operations$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^platform settings$/i)).not.toBeInTheDocument();
  });

  it("shows the channel review surfaces to a partner reviewer", () => {
    meResult = {
      data: {
        id: "u9",
        email: "partner@example.com",
        name: "Partner Reviewer",
        role: "consultancy_partner_analyst_reviewer",
        status: "active",
      },
      isLoading: false,
    };
    renderLayout();
    expect(screen.getByText(/partner workspace/i)).toBeInTheDocument();
    expect(screen.getByText(/^consortium workspace$/i)).toBeInTheDocument();
    expect(screen.getByText(/evidence library/i)).toBeInTheDocument();
    expect(screen.getByText(/notifications/i)).toBeInTheDocument();
    expect(screen.queryByText(/billing & access/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/security & audit/i)).not.toBeInTheDocument();
  });

  it("gives the canonical quality-adviser role review access without settings", () => {
    meResult = {
      data: {
        id: "u10",
        email: "qa@example.com",
        name: "Quality Adviser",
        role: "valo_quality_adviser",
        status: "active",
      },
      isLoading: false,
    };
    renderLayout();
    expect(screen.getByText(/^operations$/i)).toBeInTheDocument();
    expect(screen.getByText(/evidence library/i)).toBeInTheDocument();
    expect(screen.queryByText(/^platform settings$/i)).not.toBeInTheDocument();
  });
});

describe("RequireAdmin route guard for the settings page", () => {
  beforeEach(() => {
    meResult = { data: undefined, isLoading: true };
  });

  it("does not evaluate cached administration authority while identity is pending", () => {
    meResult = {
      data: undefined,
      isLoading: false,
      isPending: true,
      isError: false,
    };
    render(
      <RequireAdmin>
        <div data-testid="settings-admin-controls">Personnel Management</div>
      </RequireAdmin>,
    );
    expect(screen.getByText(/checking admin access/i)).toBeInTheDocument();
    expect(
      screen.queryByTestId("settings-admin-controls"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/access denied/i)).not.toBeInTheDocument();
  });

  it("blocks an approved reviewer from the settings route with access denied", () => {
    meResult = {
      data: {
        id: "u6",
        email: "reviewer@example.com",
        name: "Reviewer User",
        role: "reviewer",
        status: "active",
      },
      isLoading: false,
    };
    render(
      <RequireAdmin>
        <div data-testid="settings-admin-controls">Personnel Management</div>
      </RequireAdmin>,
    );
    expect(screen.getByText(/access denied/i)).toBeInTheDocument();
    expect(
      screen.queryByTestId("settings-admin-controls"),
    ).not.toBeInTheDocument();
  });

  it("renders the settings admin controls for an approved admin", () => {
    meResult = {
      data: {
        id: "u7",
        email: "admin@example.com",
        name: "Admin User",
        role: "admin",
        status: "active",
      },
      isLoading: false,
    };
    render(
      <RequireAdmin>
        <div data-testid="settings-admin-controls">Personnel Management</div>
      </RequireAdmin>,
    );
    expect(screen.getByTestId("settings-admin-controls")).toBeInTheDocument();
    expect(screen.queryByText(/access denied/i)).not.toBeInTheDocument();
  });

  it("renders supported settings controls for a canonical operations administrator", () => {
    meResult = {
      data: {
        id: "u11",
        email: "operations@example.com",
        name: "Operations Admin",
        role: "valo_operations_administrator",
        status: "active",
      },
      isLoading: false,
    };
    render(
      <RequireAdmin>
        <div data-testid="settings-admin-controls">Personnel Management</div>
      </RequireAdmin>,
    );
    expect(screen.getByTestId("settings-admin-controls")).toBeInTheDocument();
    expect(screen.queryByText(/access denied/i)).not.toBeInTheDocument();
  });
});
