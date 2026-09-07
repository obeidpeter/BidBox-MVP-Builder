import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AiShadowProgrammePage from "./ai-shadow-programme";

const queryState = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => queryState.current,
  useMutation: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@workspace/api-client-react", () => ({
  customFetch: vi.fn(),
}));

vi.mock("@/contexts/organisation-context", () => ({
  useOrganisationAccess: () => ({
    activeOrganisation: {
      id: "organisation-a",
      accessSource: "membership",
    },
    effectiveRoles: ["valo_quality_adviser"],
    effectivePermissions: ["evaluation:read", "evaluation:manage"],
    beginCriticalWorkflow: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-online-status", () => ({
  useOnlineStatus: () => true,
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/components/ai-shadow-programme/ai-shadow-console", () => ({
  AiShadowProgrammeConsole: () => <div>AI shadow console</div>,
}));

describe("AiShadowProgrammePage query states", () => {
  beforeEach(() => {
    queryState.current = {
      data: undefined,
      isLoading: false,
      isPending: true,
      isError: false,
      isSuccess: false,
      refetch: vi.fn(),
    };
  });

  it("keeps a cold paused shadow register pending instead of reporting an error", () => {
    render(<AiShadowProgrammePage />);

    expect(screen.getByText("Loading AI test evidence")).toBeInTheDocument();
    expect(
      screen.queryByText("AI test evidence could not be verified"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("AI shadow console")).not.toBeInTheDocument();
  });
});
