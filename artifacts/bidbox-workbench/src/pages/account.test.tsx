import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AccountPage from "./account";

const USER_ID = "2e1295d3-898f-4757-abec-a06df959401e";

vi.mock("@clerk/clerk-react", () => ({
  UserProfile: () => <div>Clerk security profile</div>,
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetMe: () => ({ data: { id: USER_ID } }),
}));

vi.mock("@/contexts/organisation-context", () => ({
  useOrganisationAccess: () => ({
    activeOrganisation: { name: "Example Organisation" },
    effectiveRoles: ["client_organisation_owner"],
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

describe("AccountPage", () => {
  it("shows the current user's Valo ID alongside profile and security details", () => {
    render(<AccountPage />);

    expect(
      screen.getByRole("heading", { name: "Profile and security" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Example Organisation")).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Valo user ID" }),
    ).toHaveTextContent(USER_ID);
    expect(
      screen.getByRole("button", { name: "Copy Valo user ID" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Clerk security profile")).toBeInTheDocument();
  });
});
