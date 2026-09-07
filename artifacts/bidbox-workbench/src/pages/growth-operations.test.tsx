import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  default as GrowthOperationsPage,
  GrowthOperationsView,
  adaptLeadContactHandoffResponse,
  assertGrowthOnboardingAuthority,
  growthAuthorityFingerprint,
  growthLeadRegisterState,
  growthOnboardingDestinations,
} from "./growth-operations";
import type {
  LeadInboxItem,
  OfferCatalogueItem,
  OnboardingJourney,
  OnboardingProgress,
} from "@/components/growth-suite/growth-suite-contract";

const pageMocks = vi.hoisted(() => ({
  activeOrganisationId: "organisation-a",
  beginCriticalWorkflow: vi.fn(),
  customFetch: vi.fn(),
  releaseCriticalWorkflow: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@workspace/api-client-react", () => ({
  customFetch: pageMocks.customFetch,
  useGetMe: () => ({
    data: { id: "operator-1" },
    isLoading: false,
    isPending: false,
    isError: false,
    isSuccess: true,
  }),
}));

vi.mock("@/contexts/organisation-context", () => ({
  useOrganisationAccess: () => ({
    activeOrganisation: {
      id: pageMocks.activeOrganisationId,
      accessSource: "membership",
    },
    effectiveRoles: ["valo_operations_administrator"],
    effectivePermissions: ["organisation:read", "client:update"],
    beginCriticalWorkflow: pageMocks.beginCriticalWorkflow,
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: pageMocks.toast }),
}));

const ONBOARDING: OnboardingJourney = {
  policyVersion: "2026-08-11.2",
  derivedFromRoles: ["valo_operations_administrator"],
  checklist: [
    {
      id: "confirm-active-workspace",
      title: "Confirm the active workspace",
      purpose: "Verify the active organisation and role.",
      practiceMarkerReceipt:
        "Self-recorded practice marker saved; this is not evidence that the described task was completed.",
      completionEvidence:
        "Self-recorded practice marker saved; this is not evidence that the described task was completed.",
    },
  ],
  syntheticTour: {
    dataClassification: "synthetic_non_customer",
    writesAuthoritativeState: false,
    title: "First verified finding",
    steps: [
      {
        id: "tour-requirement",
        title: "Open a mandatory requirement",
        instruction: "Inspect the exact synthetic clause.",
        syntheticObjectReference: "SYN-PURSUIT-001/REQ-004",
      },
    ],
  },
};

const ONBOARDING_PROGRESS: OnboardingProgress = {
  journeyVersion: "2026-08-11.2",
  savedPracticeMarkerItemIds: [],
  completedItemIds: [],
  version: 0,
};

const OFFER: OfferCatalogueItem = {
  sku: "bid_autopsy",
  versionId: "bid_autopsy@1",
  revision: 1,
  title: "Bid Autopsy",
  summary: "A bounded review of an existing bid.",
  includedOutcomes: ["Reviewed defect register"],
  excludedActions: ["Tender submission"],
  pricingMode: "human_quote_required",
  paymentMode: "external_manual_only",
  status: "active",
};

const LEAD: LeadInboxItem = {
  id: "lead-1",
  organisationId: "valo-org",
  leadReference: "AUT-2026-0001",
  organisationLabel: "Example Engineering Limited",
  tenderCategory: "federal_public",
  bidStage: "live",
  receivedAt: "2026-08-11T08:00:00.000Z",
  tenderDeadline: "2026-09-01",
  assignedToUserId: null,
  status: "new",
  slaDueAt: null,
  conversionProposal: null,
  latestStatusDecision: null,
  version: 4,
  updatedAt: "2026-08-11T08:00:00.000Z",
};

beforeEach(() => {
  pageMocks.activeOrganisationId = "organisation-a";
  pageMocks.beginCriticalWorkflow
    .mockReset()
    .mockReturnValue(pageMocks.releaseCriticalWorkflow);
  pageMocks.releaseCriticalWorkflow.mockReset();
  pageMocks.customFetch.mockReset();
  pageMocks.toast.mockReset();
});

describe("GrowthOperationsView", () => {
  it("never treats an unresolved lead register as an authoritative empty queue", () => {
    const baseProps = {
      onboarding: ONBOARDING,
      onboardingProgress: ONBOARDING_PROGRESS,
      catalogueVersion: "2026-08-11.1",
      offers: [OFFER],
      canOperateLeads: true,
    };
    const pending = render(
      <GrowthOperationsView {...baseProps} leadRegisterState="pending" />,
    );

    expect(screen.getByText("Loading lead queue")).toBeInTheDocument();
    expect(
      screen.queryByText(
        "No lead summaries are available for this organisation.",
      ),
    ).not.toBeInTheDocument();
    pending.unmount();

    render(
      <GrowthOperationsView {...baseProps} leadRegisterState="unavailable" />,
    );
    expect(screen.getByText("Lead queue is unavailable")).toBeInTheDocument();
    expect(
      screen.queryByText(
        "No lead summaries are available for this organisation.",
      ),
    ).not.toBeInTheDocument();
  });

  it("classifies cold-paused, unresolved and successful lead queries distinctly", () => {
    expect(
      growthLeadRegisterState({
        canOperateLeads: true,
        hasData: false,
        isLoading: false,
        isPending: true,
        isError: false,
        isSuccess: false,
      }),
    ).toBe("pending");
    expect(
      growthLeadRegisterState({
        canOperateLeads: true,
        hasData: false,
        isLoading: false,
        isPending: false,
        isError: false,
        isSuccess: false,
      }),
    ).toBe("unavailable");
    expect(
      growthLeadRegisterState({
        canOperateLeads: true,
        hasData: true,
        isLoading: false,
        isPending: false,
        isError: false,
        isSuccess: true,
      }),
    ).toBe("ready");
  });

  it("presents all three bounded growth workflows without contact or payment actions", () => {
    const { container } = render(
      <GrowthOperationsView
        onboarding={ONBOARDING}
        onboardingProgress={ONBOARDING_PROGRESS}
        catalogueVersion="2026-08-11.1"
        offers={[OFFER]}
        leads={[LEAD]}
        canOperateLeads
      />,
    );

    expect(
      screen.getByRole("heading", { name: /qualify leads before conversion/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /practise in a sample workspace/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /agree scope before price/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("SYN-PURSUIT-001/REQ-004")).toBeInTheDocument();
    expect(
      screen.getByText(/price entered and approved by people/i),
    ).toBeInTheDocument();
    expect(container.querySelector('a[href^="mailto:"]')).toBeNull();
    expect(container.querySelector('a[href^="tel:"]')).toBeNull();
    expect(container.querySelector('input[type="email"]')).toBeNull();
    expect(container.querySelector('input[type="tel"]')).toBeNull();
    expect(
      screen.queryByRole("button", { name: /pay/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /send email/i }),
    ).not.toBeInTheDocument();
  });

  it("requires a durable PII-free reason for a lead status decision", async () => {
    const user = userEvent.setup();
    const onLeadAction = vi.fn();
    render(
      <GrowthOperationsView
        onboarding={ONBOARDING}
        onboardingProgress={ONBOARDING_PROGRESS}
        catalogueVersion="2026-08-11.1"
        offers={[OFFER]}
        leads={[LEAD]}
        currentUserId="operator-1"
        canOperateLeads
        onLeadAction={onLeadAction}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Assign to me" }));
    expect(onLeadAction).toHaveBeenCalledWith("lead-1", {
      action: "assign",
      expectedVersion: 4,
      assigneeUserId: "operator-1",
    });
    await user.click(screen.getByRole("button", { name: /mark qualified/i }));
    await user.type(
      screen.getByLabelText("Decision reason"),
      "Scope and delivery window confirmed by the named operator.",
    );
    await user.click(
      screen.getByRole("button", { name: /^record qualified$/i }),
    );
    expect(onLeadAction).toHaveBeenCalledWith("lead-1", {
      action: "set_status",
      expectedVersion: 4,
      status: "qualified",
      reason: "Scope and delivery window confirmed by the named operator.",
    });

    expect(
      screen.getByText("Quote records are not available"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^draft quote$/i }),
    ).not.toBeInTheDocument();
  });

  it("records manual conversion only with target reference and receipt", async () => {
    const user = userEvent.setup();
    const onLeadAction = vi.fn();
    const lead: LeadInboxItem = {
      ...LEAD,
      status: "conversion_proposed",
      version: 7,
      assignedToUserId: "operator-1",
      conversionProposal: {
        id: "proposal-1",
        status: "pending_human_decision",
        proposedAt: "2026-08-11T08:30:00.000Z",
        proposedByUserId: "operator-1",
        suggestedPursuitTitle: "Roads tender",
        rationale: "Qualified by a named operator.",
      },
    };
    render(
      <GrowthOperationsView
        onboarding={ONBOARDING}
        onboardingProgress={ONBOARDING_PROGRESS}
        catalogueVersion="2026-08-11.1"
        offers={[OFFER]}
        leads={[lead]}
        currentUserId="operator-1"
        canOperateLeads
        onLeadAction={onLeadAction}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Open assigned contact" }),
    );
    expect(
      screen.getByRole("option", { name: "Conversion handoff" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(
      screen.getByRole("button", { name: /manual conversion complete/i }),
    );
    await user.type(
      screen.getByLabelText("Decision reason"),
      "Conversion was completed by the named operator in the external system.",
    );
    await user.type(
      screen.getByLabelText("External system reference"),
      "CRM-CASE-042",
    );
    await user.type(
      screen.getByLabelText("Manual conversion receipt SHA-256"),
      "c".repeat(64),
    );
    await user.click(
      screen.getByRole("button", { name: /^record converted$/i }),
    );
    expect(onLeadAction).toHaveBeenCalledWith("lead-1", {
      action: "set_status",
      expectedVersion: 7,
      status: "converted",
      reason:
        "Conversion was completed by the named operator in the external system.",
      externalTargetReference: "CRM-CASE-042",
      receiptSha256: "c".repeat(64),
    });
  });

  it("reveals one purpose-bound contact transiently for the assigned operator", async () => {
    const user = userEvent.setup();
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const onRequestContactHandoff = vi.fn();
    const onDismissContactHandoff = vi.fn();
    const assignedLead = { ...LEAD, assignedToUserId: "operator-1" };
    const props = {
      onboarding: ONBOARDING,
      onboardingProgress: ONBOARDING_PROGRESS,
      catalogueVersion: "2026-08-11.1",
      offers: [OFFER],
      leads: [assignedLead],
      canOperateLeads: true,
      currentUserId: "operator-1",
      onRequestContactHandoff,
      onDismissContactHandoff,
    };
    const { rerender, container } = render(<GrowthOperationsView {...props} />);

    await user.click(
      screen.getByRole("button", { name: "Open assigned contact" }),
    );
    expect(
      screen.queryByRole("option", { name: "Conversion handoff" }),
    ).not.toBeInTheDocument();
    await user.selectOptions(
      screen.getByLabelText("Contact purpose"),
      "qualification_call",
    );
    await user.click(
      screen.getByRole("button", { name: "Open contact for this purpose" }),
    );
    expect(onRequestContactHandoff).toHaveBeenCalledWith(
      "lead-1",
      4,
      "qualification_call",
    );

    rerender(
      <GrowthOperationsView
        {...props}
        leadContactHandoff={{
          leadId: "lead-1",
          contactName: "Amina Okafor",
          preferredContactMethod: "email",
          contactValue: "amina@example.test",
          purpose: "qualification_call",
          accessedAt: "2026-08-11T09:00:00.000Z",
          version: 5,
        }}
      />,
    );
    expect(screen.getByText("Amina Okafor")).toBeInTheDocument();
    expect(screen.getByText("amina@example.test")).toBeInTheDocument();
    expect(container.querySelector('a[href^="mailto:"]')).toBeNull();
    expect(container.querySelector('a[href^="tel:"]')).toBeNull();
    expect(setItem).not.toHaveBeenCalled();
    const dismiss = screen.getByRole("button", {
      name: "Dismiss transient contact",
    });
    expect(dismiss).toHaveAttribute("data-control-size", "44");
    expect(dismiss).toHaveClass("min-h-11", "min-w-11");
    await user.click(dismiss);
    expect(onDismissContactHandoff).toHaveBeenCalledOnce();
    setItem.mockRestore();
  });

  it("fails closed on a mismatched contact handoff response", () => {
    expect(() =>
      adaptLeadContactHandoffResponse(
        {
          handoff: {
            leadId: "another-lead",
            contactName: "Amina Okafor",
            preferredContactMethod: "email",
            contactValue: "amina@example.test",
            purpose: "initial_follow_up",
            accessedAt: "2026-08-11T09:00:00.000Z",
            version: 5,
          },
          contactDataIncluded: true,
          authorityNote: "No message was sent.",
        },
        { leadId: "lead-1", purpose: "initial_follow_up" },
      ),
    ).toThrow("Invalid lead contact handoff response");
  });

  it("guards the handoff as critical work and discards an old-organisation response", async () => {
    const user = userEvent.setup();
    let resolveHandoff: ((value: unknown) => void) | undefined;
    const pendingHandoff = new Promise<unknown>((resolve) => {
      resolveHandoff = resolve;
    });
    const assignedLead = {
      ...LEAD,
      assignedToUserId: "operator-1",
    };
    pageMocks.customFetch.mockImplementation((path: string) => {
      if (path === "/api/growth-suite/onboarding") {
        return Promise.resolve({
          journey: ONBOARDING,
          progress: ONBOARDING_PROGRESS,
        });
      }
      if (path === "/api/growth-suite/offers") {
        return Promise.resolve({
          catalogueVersion: "2026-08-11.1",
          items: [OFFER],
        });
      }
      if (path === "/api/growth-suite/leads?limit=25") {
        return Promise.resolve({ items: [assignedLead] });
      }
      if (path.endsWith("/contact-handoff")) return pendingHandoff;
      throw new Error(`Unexpected request: ${path}`);
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const page = () => (
      <QueryClientProvider client={queryClient}>
        <GrowthOperationsPage />
      </QueryClientProvider>
    );
    const { rerender } = render(page());

    await screen.findByRole("button", { name: "Open assigned contact" });
    await user.click(screen.getByRole("button", { name: "Mark qualified" }));
    await user.type(
      screen.getByLabelText("Decision reason"),
      "Sensitive old-tenant qualification rationale.",
    );
    await user.click(
      screen.getByRole("button", { name: "Open assigned contact" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Open contact for this purpose" }),
    );
    expect(pageMocks.beginCriticalWorkflow).toHaveBeenCalledOnce();
    expect(pageMocks.releaseCriticalWorkflow).not.toHaveBeenCalled();

    pageMocks.activeOrganisationId = "organisation-b";
    rerender(page());
    await act(async () => {
      resolveHandoff?.({
        handoff: {
          leadId: "lead-1",
          contactName: "Old tenant contact",
          preferredContactMethod: "email",
          contactValue: "old-tenant@example.test",
          purpose: "initial_follow_up",
          accessedAt: "2026-08-11T09:00:00.000Z",
          version: 5,
        },
        contactDataIncluded: true,
        authorityNote: "No message was sent.",
      });
      await pendingHandoff;
    });

    await waitFor(() =>
      expect(pageMocks.releaseCriticalWorkflow).toHaveBeenCalledOnce(),
    );
    expect(screen.queryByText("Old tenant contact")).not.toBeInTheDocument();
    expect(
      screen.queryByText("old-tenant@example.test"),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Decision reason")).not.toBeInTheDocument();
  });

  it("emits a version-bound onboarding checkpoint and renders persisted progress", async () => {
    const user = userEvent.setup();
    const onOnboardingToggle = vi.fn();
    const { rerender } = render(
      <GrowthOperationsView
        onboarding={ONBOARDING}
        onboardingProgress={ONBOARDING_PROGRESS}
        catalogueVersion="2026-08-11.2"
        offers={[OFFER]}
        onOnboardingToggle={onOnboardingToggle}
      />,
    );
    const checkpoint = screen.getByRole("button", {
      name: /save practice marker/i,
    });
    expect(checkpoint).toHaveAttribute("aria-pressed", "false");
    await user.click(checkpoint);
    expect(onOnboardingToggle).toHaveBeenCalledWith(
      "confirm-active-workspace",
      true,
    );
    rerender(
      <GrowthOperationsView
        onboarding={ONBOARDING}
        onboardingProgress={{
          ...ONBOARDING_PROGRESS,
          savedPracticeMarkerItemIds: ["confirm-active-workspace"],
          completedItemIds: ["confirm-active-workspace"],
          version: 1,
        }}
        catalogueVersion="2026-08-11.2"
        offers={[OFFER]}
        onOnboardingToggle={onOnboardingToggle}
      />,
    );
    expect(
      screen.getByRole("button", { name: /remove marker/i }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/practice marker saved/i)).toBeInTheDocument();
    expect(screen.queryByText("Workspace confirmed.")).not.toBeInTheDocument();
    expect(
      screen.queryByText(/synthetic tour completed/i),
    ).not.toBeInTheDocument();
  });

  it("rejects a journey derived from stale same-tenant roles", () => {
    expect(() =>
      assertGrowthOnboardingAuthority(
        {
          journey: { ...ONBOARDING, derivedFromRoles: ["bid_manager"] },
          progress: ONBOARDING_PROGRESS,
          authorityNote: "Human-controlled practice only.",
        },
        ["valo_operations_administrator"],
      ),
    ).toThrow("Growth onboarding authority changed");
  });

  it("rejects cross-policy, duplicate, unknown, and inconsistent marker state", () => {
    const response = {
      journey: ONBOARDING,
      progress: ONBOARDING_PROGRESS,
      authorityNote: "Human-controlled practice only.",
    };
    expect(() =>
      assertGrowthOnboardingAuthority(
        {
          ...response,
          progress: { ...ONBOARDING_PROGRESS, journeyVersion: "stale" },
        },
        ["valo_operations_administrator"],
      ),
    ).toThrow("Growth onboarding authority changed");
    for (const savedPracticeMarkerItemIds of [
      ["confirm-active-workspace", "confirm-active-workspace"],
      ["not-in-this-journey"],
    ]) {
      expect(() =>
        assertGrowthOnboardingAuthority(
          {
            ...response,
            progress: {
              ...ONBOARDING_PROGRESS,
              savedPracticeMarkerItemIds,
              completedItemIds: savedPracticeMarkerItemIds,
            },
          },
          ["valo_operations_administrator"],
        ),
      ).toThrow("Growth onboarding authority changed");
    }
    expect(() =>
      assertGrowthOnboardingAuthority(
        {
          ...response,
          progress: {
            ...ONBOARDING_PROGRESS,
            savedPracticeMarkerItemIds: ["confirm-active-workspace"],
            completedItemIds: [],
          },
        },
        ["valo_operations_administrator"],
      ),
    ).toThrow("Growth onboarding authority changed");
  });

  it("separates same-tenant onboarding caches when authority changes", () => {
    const base = {
      actorUserId: "operator-1",
      membershipId: "membership-1",
      organisationVersion: 3,
      accessExpiresAt: "2026-09-01T00:00:00.000Z",
      roles: ["valo_analyst"],
      permissions: ["organisation:read"],
    };
    const original = growthAuthorityFingerprint(base);
    expect(
      growthAuthorityFingerprint({ ...base, organisationVersion: 4 }),
    ).not.toBe(original);
    expect(
      growthAuthorityFingerprint({
        ...base,
        roles: ["valo_operations_administrator"],
      }),
    ).not.toBe(original);
    expect(
      growthAuthorityFingerprint({ ...base, actorUserId: "operator-2" }),
    ).not.toBe(original);
  });

  it("derives live destinations only from current direct authority", () => {
    const direct = growthOnboardingDestinations({
      roles: ["bid_manager"],
      permissions: ["project:read", "evidence:read"],
      accessSource: "membership",
    });
    expect(direct).toEqual([
      { href: "/projects", label: "Pursuits" },
      { href: "/evidence-readiness", label: "Evidence library" },
    ]);
    expect(
      growthOnboardingDestinations({
        roles: ["bid_manager"],
        permissions: ["project:read"],
        accessSource: "membership",
      }),
    ).toEqual([{ href: "/projects", label: "Pursuits" }]);
    expect(
      growthOnboardingDestinations({
        roles: ["bid_manager"],
        permissions: ["project:read", "evidence:read"],
        accessSource: "partner",
      }),
    ).toEqual([]);
  });

  it("separates self-recorded practice from authorised live-work destinations", () => {
    const onOnboardingToggle = vi.fn();
    render(
      <GrowthOperationsView
        onboarding={ONBOARDING}
        onboardingProgress={ONBOARDING_PROGRESS}
        onboardingDestinations={[
          { href: "/projects", label: "Pursuits" },
          { href: "/evidence-readiness", label: "Evidence library" },
        ]}
        catalogueVersion="2026-08-11.2"
        offers={[OFFER]}
        onOnboardingToggle={onOnboardingToggle}
      />,
    );

    expect(screen.getByText("Practice only")).toBeInTheDocument();
    expect(
      screen.getByText(/not proof that you completed real work/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /continue in your live workspace/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /pursuits/i })).toHaveAttribute(
      "href",
      "/projects",
    );
    expect(
      screen.getByRole("link", { name: /evidence library/i }),
    ).toHaveAttribute("href", "/evidence-readiness");
    expect(onOnboardingToggle).not.toHaveBeenCalled();
  });
});
