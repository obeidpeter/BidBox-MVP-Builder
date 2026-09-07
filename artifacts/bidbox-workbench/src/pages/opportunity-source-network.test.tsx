import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OpportunitySourceNetworkPage from "./opportunity-source-network";

const mutationState = vi.hoisted(() => ({
  onError: undefined as (() => void) | undefined,
}));
const queryState = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}));
const toast = vi.hoisted(() => vi.fn());

vi.mock("@workspace/api-client-react", () => ({
  customFetch: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => queryState.current,
  useMutation: (options: { onError?: () => void }) => {
    mutationState.onError = options.onError;
    return {
      isPending: false,
      mutateAsync: vi.fn(),
    };
  },
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock(
  "@/components/opportunity-source-network/opportunity-source-console",
  () => ({
    OpportunitySourceConsole: () => <div>Opportunity source console</div>,
  }),
);

vi.mock("@/contexts/organisation-context", () => ({
  useOrganisationAccess: () => ({
    activeOrganisation: { id: "org-1", accessSource: "membership" },
    effectivePermissions: ["organisation:read", "project:create"],
    beginCriticalWorkflow: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-online-status", () => ({
  useOnlineStatus: () => true,
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast }),
}));

describe("Opportunity Source route mutation errors", () => {
  beforeEach(() => {
    queryState.current = {
      data: { items: [], limit: 250, truncated: false },
      isLoading: false,
      isPending: false,
      isError: false,
      isSuccess: true,
      refetch: vi.fn(),
    };
  });

  it("surfaces a destructive error instead of silently dropping a rejected write", () => {
    render(<OpportunitySourceNetworkPage />);
    expect(screen.getByText(/opportunity source console/i)).toBeInTheDocument();

    act(() => mutationState.onError?.());

    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: "destructive",
        title: "Opportunity source record could not be updated",
      }),
    );
  });

  it("keeps a cold paused source register pending instead of reporting an error", () => {
    queryState.current = {
      data: undefined,
      isLoading: false,
      isPending: true,
      isError: false,
      isSuccess: false,
      refetch: vi.fn(),
    };

    render(<OpportunitySourceNetworkPage />);

    expect(screen.getByText("Loading source receipts")).toBeInTheDocument();
    expect(
      screen.queryByText("Source receipts could not be verified"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/opportunity source console/i),
    ).not.toBeInTheDocument();
  });
});
