import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RequireArea from "./require-area";

const queryState = vi.hoisted(() => ({
  me: {
    data: {
      id: "user-1",
      role: "global_admin",
      status: "active",
    } as { id: string; role: string; status: string } | undefined,
    isLoading: false,
    isPending: false,
    error: null as Error | null,
  },
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetMe: () => queryState.me,
}));

vi.mock("@/contexts/organisation-context", () => ({
  useOrganisationAccess: () => ({
    organisations: [],
    activeOrganisation: null,
    effectiveRoles: [],
    effectivePermissions: [],
    isLoading: false,
    isError: false,
    needsSelection: false,
  }),
}));

describe("RequireArea tenant boundary", () => {
  beforeEach(() => {
    queryState.me = {
      data: { id: "user-1", role: "global_admin", status: "active" },
      isLoading: false,
      isPending: false,
      error: null,
    };
  });

  it("keeps a cold paused identity query in the access-checking state", () => {
    queryState.me = {
      data: undefined,
      isLoading: false,
      isPending: true,
      error: null,
    };
    render(
      <RequireArea area="pursuit_workbench">
        <p>Tenant secret</p>
      </RequireArea>,
    );

    expect(screen.getByText(/checking your access/i)).toBeInTheDocument();
    expect(screen.queryByText("Tenant secret")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", {
        name: /we couldn't verify your access/i,
      }),
    ).not.toBeInTheDocument();
  });

  it("does not fall back to the legacy user role when no organisation is active", () => {
    render(
      <RequireArea area="pursuit_workbench">
        <p>Tenant secret</p>
      </RequireArea>,
    );

    expect(screen.queryByText("Tenant secret")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /organisation access required/i }),
    ).toBeInTheDocument();
  });
});
