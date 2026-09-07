import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import RequireAdmin from "./require-admin";

vi.mock("@workspace/api-client-react", () => ({
  useGetMe: () => ({
    data: { id: "user-1", role: "admin", status: "active" },
    isLoading: false,
  }),
}));

vi.mock("@/contexts/organisation-context", () => ({
  useOrganisationAccess: () => ({
    activeOrganisation: null,
    effectiveRoles: [],
    effectivePermissions: [],
    isLoading: false,
  }),
}));

describe("RequireAdmin tenant boundary", () => {
  it("does not admit a legacy admin without a verified organisation context", () => {
    render(
      <RequireAdmin>
        <p>Administrative secret</p>
      </RequireAdmin>,
    );

    expect(screen.queryByText("Administrative secret")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /access denied/i }),
    ).toBeInTheDocument();
  });
});
