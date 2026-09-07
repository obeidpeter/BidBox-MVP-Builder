import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CommercialRetainerPage, {
  adaptCommercialRetainerSnapshot,
} from "./commercial-retainer";

const queryState = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}));
const identityState = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => queryState.current,
  useMutation: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@workspace/api-client-react", () => ({
  customFetch: vi.fn(),
  useGetMe: () => identityState.current,
}));

vi.mock("@/contexts/organisation-context", () => ({
  useOrganisationAccess: () => ({
    activeOrganisation: {
      id: "org-a",
      membershipId: "membership-a",
      membershipOrganisationId: "org-a",
      accessSource: "membership",
    },
    effectiveRoles: ["client_administrator"],
    effectivePermissions: ["billing:read", "entitlement:read", "order:create"],
    beginCriticalWorkflow: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/components/commercial-retainer/commercial-control-centre", () => ({
  CommercialControlCentre: () => <div>Commercial control centre</div>,
}));

function envelope() {
  return {
    snapshot: {
      organisationId: "org-a",
      manifest: {
        moduleVersion: "valo.commercial-retainer@v1",
        routeMounted: true,
        navigationMounted: true,
        openApiPublished: true,
        automaticPricingAllowed: false,
        paymentProviderConnected: false,
        externalMessagingConnected: false,
        autonomousWorkAllowed: false,
        makerCheckerRequired: true,
      },
      activation: {
        fixedPriceBookReady: false,
        providerConnected: false,
        manualReconciliationReady: true,
        retainerDeskReady: false,
      },
      offers: [],
      quotes: [] as unknown[],
      invoices: [],
      payments: [],
      entitlements: [],
      serviceRequests: [],
    },
  };
}

describe("adaptCommercialRetainerSnapshot", () => {
  beforeEach(() => {
    queryState.current = {
      data: envelope().snapshot,
      isLoading: false,
      isPending: false,
      isError: false,
      isSuccess: true,
      refetch: vi.fn(),
    };
    identityState.current = {
      data: { id: "actor-a" },
      isLoading: false,
      isPending: false,
      isError: false,
      isSuccess: true,
      refetch: vi.fn(),
    };
  });

  it("accepts only a bounded fail-closed authority contract", () => {
    expect(
      adaptCommercialRetainerSnapshot(envelope(), "org-a").activation,
    ).toEqual({
      fixedPriceBookReady: false,
      providerConnected: false,
      manualReconciliationReady: true,
      retainerDeskReady: false,
    });
  });

  it("rejects any server claim that a provider or autonomous action is connected", () => {
    const provider = envelope();
    provider.snapshot.manifest.paymentProviderConnected = true;
    expect(() => adaptCommercialRetainerSnapshot(provider, "org-a")).toThrow(
      /safety contract/u,
    );

    const autonomous = envelope();
    autonomous.snapshot.manifest.autonomousWorkAllowed = true;
    expect(() => adaptCommercialRetainerSnapshot(autonomous, "org-a")).toThrow(
      /safety contract/u,
    );
  });

  it("rejects oversized ledgers instead of truncating silently", () => {
    const oversized = envelope();
    oversized.snapshot.quotes = Array.from({ length: 51 }, () => ({}));
    expect(() => adaptCommercialRetainerSnapshot(oversized, "org-a")).toThrow(
      /contains too many items/u,
    );
  });

  it("rejects a snapshot issued for another active organisation", () => {
    expect(() => adaptCommercialRetainerSnapshot(envelope(), "org-b")).toThrow(
      /safety contract/u,
    );
  });

  it("keeps cold paused ledger and identity reads pending", () => {
    const coldPaused = {
      data: undefined,
      isLoading: false,
      isPending: true,
      isError: false,
      isSuccess: false,
      refetch: vi.fn(),
    };
    queryState.current = coldPaused;
    identityState.current = coldPaused;

    render(<CommercialRetainerPage />);

    expect(screen.getByText("Loading commercial records")).toBeInTheDocument();
    expect(
      screen.queryByText("Commercial records could not be verified"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Commercial control centre"),
    ).not.toBeInTheDocument();
  });
});
