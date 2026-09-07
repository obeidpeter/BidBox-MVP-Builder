import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OrganisationSettings from "./organisation-settings";

const mocks = vi.hoisted(() => ({
  membershipsQuery: {} as Record<string, unknown>,
}));

vi.mock("@workspace/api-client-react", () => ({
  getListOrganisationMembershipsQueryKey: (organisationId: string) => [
    "organisation-memberships",
    organisationId,
  ],
  useCreateOrganisationMembership: vi.fn(),
  useGetMe: () => ({ data: { id: "current-user" } }),
  useListOrganisationMemberships: () => mocks.membershipsQuery,
  useUpdateOrganisationMembership: vi.fn(),
}));

vi.mock("@/contexts/organisation-context", () => ({
  useOrganisationAccess: () => ({
    activeOrganisation: {
      id: "organisation-1",
      name: "Example Organisation",
      type: "client",
    },
    effectiveRoles: ["client_organisation_owner"],
  }),
}));

vi.mock("@/hooks/use-online-status", () => ({
  useOnlineStatus: () => true,
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

describe("OrganisationSettings", () => {
  beforeEach(() => {
    mocks.membershipsQuery = {
      data: undefined,
      error: null,
      isError: false,
      isLoading: false,
      isPending: true,
      isSuccess: false,
      refetch: vi.fn(),
    };
  });

  it("shows a cold paused membership request as pending rather than active blank", () => {
    render(<OrganisationSettings />);

    expect(screen.getByLabelText("Status: Pending")).toBeInTheDocument();
    expect(
      screen.getByText("Loading organisation memberships"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Membership register" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Status: Active")).not.toBeInTheDocument();
  });
});
