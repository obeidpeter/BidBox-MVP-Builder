import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import {
  OrganisationProvider,
  useOrganisationAccess,
} from "./organisation-context";
import { OrganisationSelectionGate } from "@/components/organisation-switcher";
import { OrganisationSwitcher } from "@/components/organisation-switcher";

const apiState = vi.hoisted(() => ({
  response: [] as unknown[],
  userId: "user-1",
  clerkUserId: "user-1",
  sessionId: "session-1",
  contextGetter: null as
    | null
    | (() => { organisationId?: string | null } | null),
}));

vi.mock("@clerk/clerk-react", () => ({
  useAuth: () => ({
    userId: apiState.clerkUserId,
    sessionId: apiState.sessionId,
  }),
}));

vi.mock("@workspace/api-client-react", () => ({
  customFetch: vi.fn(async () => apiState.response),
  setRequestContextGetter: vi.fn(
    (getter: () => { organisationId?: string | null } | null) => {
      apiState.contextGetter = getter;
    },
  ),
  getGetMeQueryKey: () => ["/api/me"],
  useGetMe: () => ({
    data: {
      id: apiState.userId,
      email: "member@example.com",
      role: "none",
      status: "active",
    },
    isLoading: false,
    isError: false,
  }),
}));

function renderProvider(child: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <OrganisationProvider>{child}</OrganisationProvider>
    </QueryClientProvider>,
  );
}

function AccessProbe() {
  const access = useOrganisationAccess();
  if (!access || access.isLoading) return <p>Loading access</p>;
  if (access.needsSelection) return <OrganisationSelectionGate />;
  return (
    <div>
      <p>Active: {access.activeOrganisation?.name ?? "none"}</p>
      <p>Roles: {access.effectiveRoles.join(",")}</p>
    </div>
  );
}

function organisation(id: string, name: string, roles: string[]) {
  return {
    id,
    name,
    slug: name.toLowerCase().replace(/\s+/g, "-"),
    type: "client",
    status: "active",
    countryCode: "NG",
    membershipId: "membership-" + id,
    membershipOrganisationId: id,
    accessSource: "membership",
    partnerRelationshipId: null,
    accessExpiresAt: null,
    roles,
    permissions: ["project:read"],
    version: 1,
  };
}

describe("organisation access context", () => {
  beforeEach(() => {
    sessionStorage.clear();
    apiState.response = [];
    apiState.userId = "user-1";
    apiState.clerkUserId = "user-1";
    apiState.sessionId = "session-1";
  });

  it("auto-selects a single verified membership before exposing its roles", async () => {
    apiState.response = [
      organisation("org-1", "Northwind Nigeria", ["client_organisation_owner"]),
    ];
    renderProvider(<AccessProbe />);
    expect(
      await screen.findByText("Active: Northwind Nigeria"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Roles: client_organisation_owner"),
    ).toBeInTheDocument();
    expect(apiState.contextGetter?.()?.organisationId).toBe("org-1");
  });

  it("keeps a cold paused organisation query pending instead of exposing an empty context", () => {
    onlineManager.setOnline(false);
    try {
      apiState.response = [
        organisation("org-1", "Northwind Nigeria", [
          "client_organisation_owner",
        ]),
      ];
      const view = renderProvider(<AccessProbe />);
      expect(screen.getByText("Loading access")).toBeInTheDocument();
      expect(screen.queryByText("Active: none")).not.toBeInTheDocument();
      view.unmount();
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it("requires an explicit choice when more than one membership is active", async () => {
    apiState.response = [
      organisation("org-1", "Northwind Nigeria", ["client_administrator"]),
      organisation("org-2", "Contoso Nigeria", ["client_reviewer_approver"]),
    ];
    const user = userEvent.setup();
    renderProvider(<AccessProbe />);
    expect(
      await screen.findByRole("heading", { name: /select an organisation/i }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /contoso nigeria/i }));
    await waitFor(() =>
      expect(screen.getByText("Active: Contoso Nigeria")).toBeInTheDocument(),
    );
    expect(apiState.contextGetter?.()?.organisationId).toBe("org-2");
  });

  it("selects a server-verified partner client context and exposes only its effective permissions", async () => {
    apiState.response = [
      organisation("partner-1", "Consultancy", [
        "consultancy_partner_administrator",
      ]),
      {
        ...organisation("client-1", "Assigned Client", [
          "consultancy_partner_administrator",
        ]),
        membershipId: "partner-membership-1",
        membershipOrganisationId: "partner-1",
        accessSource: "partner",
        partnerRelationshipId: "relationship-1",
        permissions: ["project:read", "evidence:write"],
      },
    ];
    const user = userEvent.setup();
    renderProvider(<AccessProbe />);
    await user.click(
      await screen.findByRole("button", { name: /assigned client/i }),
    );
    await waitFor(() =>
      expect(screen.getByText("Active: Assigned Client")).toBeInTheDocument(),
    );
    expect(apiState.contextGetter?.()?.organisationId).toBe("client-1");
  });

  it("fails closed when the membership response is malformed", async () => {
    apiState.response = [{ id: "org-without-roles" }];

    function ErrorProbe() {
      const access = useOrganisationAccess();
      return <p>{access?.isError ? "Access error" : "No error"}</p>;
    }

    renderProvider(<ErrorProbe />);
    expect(await screen.findByText("Access error")).toBeInTheDocument();
    expect(apiState.contextGetter?.()?.organisationId ?? null).toBeNull();
  });

  it.each([
    ["a replacement session", "user-1", "session-2"],
    ["a different account", "user-2", "session-3"],
  ])(
    "does not inherit the selected tenant across %s",
    async (_label, nextUserId, nextSessionId) => {
      apiState.response = [
        organisation("org-1", "Northwind Nigeria", ["client_administrator"]),
        organisation("org-2", "Contoso Nigeria", ["client_reviewer_approver"]),
      ];
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      const ui = () => (
        <QueryClientProvider client={queryClient}>
          <OrganisationProvider>
            <AccessProbe />
          </OrganisationProvider>
        </QueryClientProvider>
      );
      const user = userEvent.setup();
      const view = render(ui());
      await user.click(
        await screen.findByRole("button", { name: /contoso nigeria/i }),
      );
      await screen.findByText("Active: Contoso Nigeria");

      apiState.userId = nextUserId;
      apiState.clerkUserId = nextUserId;
      apiState.sessionId = nextSessionId;
      view.rerender(ui());

      expect(
        await screen.findByRole("heading", { name: /select an organisation/i }),
      ).toBeInTheDocument();
      expect(apiState.contextGetter?.()?.organisationId ?? null).toBeNull();
    },
  );

  it("blocks organisation switching for the complete critical workflow lifetime", async () => {
    apiState.response = [
      organisation("org-1", "Northwind Nigeria", ["client_administrator"]),
      organisation("org-2", "Contoso Nigeria", ["client_reviewer_approver"]),
    ];
    sessionStorage.setItem(
      "valo:selected-organisation:user-1%3Asession-1",
      "org-1",
    );
    let releaseWorkflow: (() => void) | undefined;

    function WorkflowProbe() {
      const access = useOrganisationAccess();
      return (
        <>
          <button
            type="button"
            onClick={() => {
              releaseWorkflow = access?.beginCriticalWorkflow();
            }}
          >
            Begin upload
          </button>
          <button type="button" onClick={() => releaseWorkflow?.()}>
            Finish upload
          </button>
          <OrganisationSwitcher />
        </>
      );
    }

    const user = userEvent.setup();
    renderProvider(<WorkflowProbe />);
    const switcher = await screen.findByRole("combobox", {
      name: /active organisation/i,
    });
    expect(switcher).toBeEnabled();

    await user.click(screen.getByRole("button", { name: /begin upload/i }));
    expect(switcher).toBeDisabled();
    expect(
      screen.getByText(/change or sensitive task is in progress/i),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /finish upload/i }));
    expect(switcher).toBeEnabled();
  });
});
