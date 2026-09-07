import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SecurityAudit from "./security-audit";

const mocks = vi.hoisted(() => ({
  accessReview: {} as Record<string, unknown>,
  legacyAssessment: {} as Record<string, unknown>,
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetAccessReview: () => mocks.accessReview,
  useGetLegacyIntegrityAssessment: () => mocks.legacyAssessment,
}));

vi.mock("@/hooks/use-online-status", () => ({
  useOnlineStatus: () => true,
}));

const pausedQuery = () => ({
  data: undefined,
  isLoading: false,
  isPending: true,
  isError: false,
  isSuccess: false,
  refetch: vi.fn(),
});

describe("SecurityAudit", () => {
  beforeEach(() => {
    mocks.accessReview = pausedQuery();
    mocks.legacyAssessment = pausedQuery();
  });

  it("keeps cold paused audit sources pending instead of reporting an empty assessment", () => {
    render(<SecurityAudit />);

    expect(
      screen.getByText("Loading legacy audit integrity assessment"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Loading monthly access review"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("No legacy integrity assessment is stored"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("No access rows returned"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
  });
});
