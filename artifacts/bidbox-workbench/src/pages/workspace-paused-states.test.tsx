import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ClientPortal from "./client-portal";
import PartnerWorkspace from "./partner-workspace";

const queryState = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}));

vi.mock("@workspace/api-client-react", () => ({
  getGetVaultExpiringQueryKey: () => ["vault-expiring"],
  getGetWorkflowAlertsQueryKey: () => ["workflow-alerts"],
  getListPartnerRelationshipsQueryKey: () => ["partner-relationships"],
  getListProjectsQueryKey: () => ["projects"],
  useGetVaultExpiring: () => queryState.current,
  useGetWorkflowAlerts: () => queryState.current,
  useListPartnerRelationships: () => queryState.current,
  useListProjects: () => queryState.current,
}));

vi.mock("@/hooks/use-online-status", () => ({
  useOnlineStatus: () => true,
}));

describe("Workspace cold-paused query states", () => {
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

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("keeps the client workspace pending instead of rendering zero-valued signals", () => {
    vi.stubEnv("VITE_FEATURE_CLIENT_PORTAL", "true");

    render(<ClientPortal />);

    expect(
      screen.getByText(/loading client workspace records/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /connected tenant signals/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /no pursuit records returned/i }),
    ).not.toBeInTheDocument();
  });

  it("keeps the partner workspace pending instead of rendering empty relationship and risk counts", () => {
    vi.stubEnv("VITE_FEATURE_PARTNER_WORKSPACE", "true");

    render(<PartnerWorkspace />);

    expect(
      screen.getByText(/loading partner workspace records/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /connected partner signals/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", {
        name: /no partner relationships returned/i,
      }),
    ).not.toBeInTheDocument();
  });
});
