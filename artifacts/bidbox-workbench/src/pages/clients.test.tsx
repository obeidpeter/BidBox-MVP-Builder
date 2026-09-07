import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Clients from "./clients";

const apiState = vi.hoisted(() => ({
  clientsQuery: {} as Record<string, unknown>,
  retryClients: vi.fn(),
  createClient: vi.fn(),
  canCreateClient: false,
}));

vi.mock("@workspace/api-client-react", () => ({
  getListClientsQueryKey: () => ["clients"],
  useListClients: () => apiState.clientsQuery,
  useCreateClient: () => ({
    isPending: false,
    mutate: apiState.createClient,
  }),
}));

vi.mock("@/contexts/organisation-context", () => ({
  useOrganisationPermission: () => apiState.canCreateClient,
}));

function Wrapper({ children }: PropsWithChildren) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("Clients", () => {
  beforeEach(() => {
    apiState.retryClients.mockReset();
    apiState.createClient.mockReset();
    apiState.canCreateClient = false;
    apiState.clientsQuery = {
      data: [],
      isLoading: false,
      isPending: false,
      isError: false,
      isSuccess: true,
      refetch: apiState.retryClients,
    };
  });

  it("does not present a failed register as an empty client portfolio", async () => {
    apiState.clientsQuery = {
      data: undefined,
      isLoading: false,
      isPending: false,
      isError: true,
      isSuccess: false,
      refetch: apiState.retryClients,
    };

    render(<Clients />, { wrapper: Wrapper });

    expect(
      screen.getByText("Client register could not be loaded"),
    ).toBeInTheDocument();
    expect(screen.queryByText("No clients found.")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(apiState.retryClients).toHaveBeenCalledTimes(1);
  });

  it("does not infer an empty register from a cold-paused query", () => {
    apiState.clientsQuery = {
      data: undefined,
      isLoading: false,
      isPending: true,
      isError: false,
      isSuccess: false,
      refetch: apiState.retryClients,
    };

    render(<Clients />, { wrapper: Wrapper });

    expect(screen.queryByText("No clients found.")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Client register could not be loaded"),
    ).not.toBeInTheDocument();
  });

  it("renders an empty register only after a successful empty response", () => {
    render(<Clients />, { wrapper: Wrapper });

    expect(screen.getByText("No clients found.")).toBeInTheDocument();
  });

  it("shows linked email validation and focuses the invalid field", async () => {
    apiState.canCreateClient = true;
    const user = userEvent.setup();
    render(<Clients />, { wrapper: Wrapper });

    await user.click(screen.getByRole("button", { name: "New Client" }));
    await user.type(screen.getByLabelText("Company name"), "Example Limited");
    await user.type(screen.getByLabelText("Contact email"), "not-an-email");
    await user.click(screen.getByRole("button", { name: "Create client" }));

    const email = screen.getByLabelText("Contact email");
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(email).toHaveAccessibleDescription(
      "Enter a valid contact email address",
    );
    expect(email).toHaveFocus();
    expect(
      screen.getByText("Check the highlighted client details"),
    ).toBeInTheDocument();
    expect(apiState.createClient).not.toHaveBeenCalled();
  });

  it("keeps entered values and shows a persistent server error", async () => {
    apiState.canCreateClient = true;
    apiState.createClient.mockImplementationOnce(
      (_input: unknown, options: { onError: (error: Error) => void }) => {
        options.onError(new Error("The client name already exists."));
      },
    );
    const user = userEvent.setup();
    render(<Clients />, { wrapper: Wrapper });

    await user.click(screen.getByRole("button", { name: "New Client" }));
    const name = screen.getByLabelText("Company name");
    await user.type(name, "Example Limited");
    await user.click(screen.getByRole("button", { name: "Create client" }));

    expect(screen.getByText("Client was not created")).toBeInTheDocument();
    expect(
      screen.getByText("The client name already exists."),
    ).toBeInTheDocument();
    expect(name).toHaveValue("Example Limited");
  });

  it("guards a dirty client form before closing", async () => {
    apiState.canCreateClient = true;
    const user = userEvent.setup();
    render(<Clients />, { wrapper: Wrapper });

    await user.click(screen.getByRole("button", { name: "New Client" }));
    await user.type(screen.getByLabelText("Company name"), "Unsaved Limited");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(
      screen.getByRole("heading", { name: "Discard unsaved changes?" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.getByDisplayValue("Unsaved Limited")).toBeInTheDocument();
  });
});
