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
  useOrganisationPermission: () => false,
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
});
