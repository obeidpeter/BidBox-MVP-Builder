import { useEffect, useRef, useState } from "react";
import { customFetch, useGetMe } from "@workspace/api-client-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  GrowthLeadContactHandoffResponse,
  GrowthLeadsResponse,
  GrowthOffersResponse,
  GrowthOnboardingMutationResponse,
  GrowthOnboardingResponse,
  LeadContactHandoff,
  LeadContactHandoffPurpose,
  LeadInboxAction,
  LeadInboxItem,
  OfferCatalogueItem,
  OnboardingJourney,
  OnboardingProgress,
} from "@/components/growth-suite/growth-suite-contract";
import { GrowthOnboardingJourney } from "@/components/growth-suite/onboarding-journey";
import { navigationForRole, platformFeatureFlags } from "@/lib/platform-access";
import { LeadOperationsInbox } from "@/components/growth-suite/lead-operations-inbox";
import { GrowthOfferCatalogue } from "@/components/growth-suite/offer-catalogue";
import {
  PageGatePanel,
  PageHeader,
  StatusPanel,
} from "@/components/platform-states";
import { Button } from "@/components/ui/button";
import { useOrganisationAccess } from "@/contexts/organisation-context";
import { useToast } from "@/hooks/use-toast";

const QUERY_ROOT = "growth-suite";
const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u;

function normalisedAuthorityRoles(roles: readonly string[]): string[] {
  return [...new Set(roles)].sort();
}

export function growthAuthorityFingerprint(input: {
  actorUserId: string;
  membershipId: string;
  organisationVersion: number;
  accessExpiresAt: string | null;
  roles: readonly string[];
  permissions: readonly string[];
}): string {
  return JSON.stringify({
    actorUserId: input.actorUserId,
    membershipId: input.membershipId,
    organisationVersion: input.organisationVersion,
    accessExpiresAt: input.accessExpiresAt,
    roles: normalisedAuthorityRoles(input.roles),
    permissions: [...new Set(input.permissions)].sort(),
  });
}

const ONBOARDING_LIVE_DESTINATIONS = new Set([
  "/projects",
  "/evidence-readiness",
  "/sbd",
  "/reports",
  "/organisation-settings",
]);

export function growthOnboardingDestinations(input: {
  roles: readonly string[];
  permissions: readonly string[];
  accessSource: "membership" | "partner" | null;
}): Array<{ href: string; label: string }> {
  if (input.accessSource !== "membership") return [];
  return navigationForRole(
    input.roles,
    platformFeatureFlags(),
    input.permissions,
    input.accessSource,
  )
    .filter(
      ({ href, state }) =>
        state === "active" && ONBOARDING_LIVE_DESTINATIONS.has(href),
    )
    .slice(0, 3)
    .map(({ href, label }) => ({ href, label }));
}

export function assertGrowthOnboardingAuthority(
  response: GrowthOnboardingResponse,
  expectedRoles: readonly string[],
): GrowthOnboardingResponse {
  const actual = normalisedAuthorityRoles(
    Array.isArray(response?.journey?.derivedFromRoles)
      ? response.journey.derivedFromRoles
      : [],
  );
  const expected = normalisedAuthorityRoles(expectedRoles);
  const checklistIds = new Set(
    response?.journey?.checklist?.map(({ id }) => id) ?? [],
  );
  const markerIds = response?.progress?.savedPracticeMarkerItemIds;
  const legacyMarkerIds = response?.progress?.completedItemIds;
  if (
    actual.length !== expected.length ||
    !actual.every((role, index) => role === expected[index]) ||
    response.journey.policyVersion !== response.progress.journeyVersion ||
    !Array.isArray(markerIds) ||
    !markerIds.every((id) => typeof id === "string") ||
    new Set(markerIds).size !== markerIds.length ||
    markerIds.some((id) => !checklistIds.has(id)) ||
    checklistIds.size !== response.journey.checklist.length ||
    !Array.isArray(legacyMarkerIds) ||
    legacyMarkerIds.length !== markerIds.length ||
    !legacyMarkerIds.every((id, index) => id === markerIds[index])
  ) {
    throw new Error("Growth onboarding authority changed");
  }
  return response;
}

async function getGrowthOnboarding(
  expectedRoles: readonly string[],
): Promise<GrowthOnboardingResponse> {
  const response = await customFetch<GrowthOnboardingResponse>(
    "/api/growth-suite/onboarding",
    {
      responseType: "json",
    },
  );
  return assertGrowthOnboardingAuthority(response, expectedRoles);
}

async function getGrowthOffers(): Promise<GrowthOffersResponse> {
  return customFetch("/api/growth-suite/offers", { responseType: "json" });
}

async function getGrowthLeads(): Promise<GrowthLeadsResponse> {
  return customFetch("/api/growth-suite/leads?limit=25", {
    responseType: "json",
    cache: "no-store",
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => key in value)
  );
}

function boundedText(value: unknown, maximum: number): string | null {
  return typeof value === "string" && value.trim() && value.length <= maximum
    ? value
    : null;
}

export function adaptLeadContactHandoffResponse(
  value: unknown,
  expected: { leadId: string; purpose: LeadContactHandoffPurpose },
): GrowthLeadContactHandoffResponse {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["handoff", "contactDataIncluded", "authorityNote"]) ||
    value.contactDataIncluded !== true ||
    !boundedText(value.authorityNote, 2_048) ||
    !isRecord(value.handoff) ||
    !exactKeys(value.handoff, [
      "leadId",
      "contactName",
      "preferredContactMethod",
      "contactValue",
      "purpose",
      "accessedAt",
      "version",
    ])
  ) {
    throw new Error("Invalid lead contact handoff response");
  }
  const handoff = value.handoff;
  const leadId = boundedText(handoff.leadId, 128);
  const contactName = boundedText(handoff.contactName, 160);
  const contactValue = boundedText(handoff.contactValue, 512);
  const accessedAt = boundedText(handoff.accessedAt, 64);
  const version = handoff.version;
  if (
    !leadId ||
    !ID_PATTERN.test(leadId) ||
    leadId !== expected.leadId ||
    !contactName ||
    !contactValue ||
    !["email", "telephone"].includes(
      handoff.preferredContactMethod as string,
    ) ||
    handoff.purpose !== expected.purpose ||
    !accessedAt ||
    Number.isNaN(Date.parse(accessedAt)) ||
    typeof version !== "number" ||
    !Number.isSafeInteger(version) ||
    version < 1
  ) {
    throw new Error("Invalid lead contact handoff response");
  }
  return {
    handoff: {
      leadId,
      contactName,
      preferredContactMethod: handoff.preferredContactMethod as
        | "email"
        | "telephone",
      contactValue,
      purpose: expected.purpose,
      accessedAt,
      version,
    },
    contactDataIncluded: true,
    authorityNote: value.authorityNote as string,
  };
}

export type GrowthLeadRegisterState =
  | "hidden"
  | "pending"
  | "unavailable"
  | "ready";

export function growthLeadRegisterState(input: {
  canOperateLeads: boolean;
  hasData: boolean;
  isLoading: boolean;
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
}): GrowthLeadRegisterState {
  if (!input.canOperateLeads) return "hidden";
  if (input.isLoading || input.isPending) return "pending";
  if (input.isError || !input.isSuccess || !input.hasData) {
    return "unavailable";
  }
  return "ready";
}

export function GrowthOperationsView({
  onboarding,
  onboardingProgress,
  catalogueVersion,
  offers,
  leads,
  leadRegisterState,
  currentUserId,
  scopeKey,
  leadContactHandoff,
  handoffPendingLeadId,
  canOperateLeads = false,
  mutationPending = false,
  onLeadAction,
  onRequestContactHandoff,
  onDismissContactHandoff,
  onOnboardingToggle,
  onboardingDestinations = [],
}: {
  onboarding: OnboardingJourney;
  onboardingProgress: OnboardingProgress;
  catalogueVersion: string;
  offers: readonly OfferCatalogueItem[];
  leads?: readonly LeadInboxItem[];
  leadRegisterState?: GrowthLeadRegisterState;
  currentUserId?: string;
  scopeKey?: string;
  leadContactHandoff?: LeadContactHandoff | null;
  handoffPendingLeadId?: string | null;
  canOperateLeads?: boolean;
  mutationPending?: boolean;
  onLeadAction?: (leadId: string, action: LeadInboxAction) => void;
  onRequestContactHandoff?: (
    leadId: string,
    expectedVersion: number,
    purpose: LeadContactHandoffPurpose,
  ) => void;
  onDismissContactHandoff?: () => void;
  onOnboardingToggle?: (itemId: string, markerSaved: boolean) => void;
  onboardingDestinations?: readonly { href: string; label: string }[];
}) {
  const resolvedLeadRegisterState =
    leadRegisterState ??
    (!canOperateLeads
      ? "hidden"
      : leads === undefined
        ? "unavailable"
        : "ready");
  return (
    <div className="mx-auto w-full max-w-7xl space-y-10 p-5 sm:p-8">
      <PageHeader
        eyebrow="Growth operations"
        title="Leads & offers"
        description="Qualify leads, practise first-pursuit tasks and review approved offer versions. This page cannot send messages, set prices, take payment, create CRM records or create pursuits. Quote records are not available."
        state="active"
      />
      {resolvedLeadRegisterState === "pending" ? (
        <StatusPanel
          state="pending"
          title="Loading lead queue"
          description="Lead summaries stay hidden until this organisation's queue loads."
        />
      ) : resolvedLeadRegisterState === "unavailable" ? (
        <StatusPanel
          state="error"
          title="Lead queue is unavailable"
          description="Onboarding and the offer catalogue are still available. This does not mean the queue is empty."
        />
      ) : resolvedLeadRegisterState === "ready" && leads ? (
        <LeadOperationsInbox
          key={scopeKey}
          items={leads}
          currentUserId={currentUserId}
          handoff={leadContactHandoff}
          handoffPendingLeadId={handoffPendingLeadId}
          mutationPending={mutationPending}
          onAction={onLeadAction}
          onRequestContactHandoff={onRequestContactHandoff}
          onDismissContactHandoff={onDismissContactHandoff}
        />
      ) : null}
      <GrowthOnboardingJourney
        journey={onboarding}
        progress={onboardingProgress}
        mutationPending={mutationPending}
        onToggle={onOnboardingToggle}
        liveDestinations={onboardingDestinations}
      />
      <GrowthOfferCatalogue
        catalogueVersion={catalogueVersion}
        offers={offers}
      />
    </div>
  );
}

export default function GrowthOperationsPage() {
  const access = useOrganisationAccess();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const meQuery = useGetMe();
  const organisationId = access?.activeOrganisation?.id ?? "";
  const actorUserId = meQuery.data?.id ?? "";
  const roles = access?.effectiveRoles ?? [];
  const permissions = access?.effectivePermissions ?? [];
  const directMembership =
    access?.activeOrganisation?.accessSource === "membership";
  const canView = Boolean(
    organisationId &&
    actorUserId &&
    directMembership &&
    permissions.includes("organisation:read"),
  );
  const canOperateLeads = Boolean(
    canView &&
    permissions.includes("client:update") &&
    roles.some((role) =>
      ["valo_operations_administrator", "valo_analyst"].includes(role),
    ),
  );
  const onboardingDestinations = growthOnboardingDestinations({
    roles,
    permissions,
    accessSource: access?.activeOrganisation?.accessSource ?? null,
  });
  const authorityFingerprint = growthAuthorityFingerprint({
    actorUserId,
    membershipId: access?.activeOrganisation?.membershipId ?? "",
    organisationVersion: access?.activeOrganisation?.version ?? 0,
    accessExpiresAt: access?.activeOrganisation?.accessExpiresAt ?? null,
    roles,
    permissions,
  });
  const authorityScopeKey = `${organisationId}:${authorityFingerprint}`;
  const queryPrefix = [
    QUERY_ROOT,
    organisationId,
    authorityFingerprint,
  ] as const;
  const onboardingQueryKey = [...queryPrefix, "onboarding"] as const;
  const onboardingQuery = useQuery({
    queryKey: onboardingQueryKey,
    queryFn: () => getGrowthOnboarding(roles),
    enabled: canView,
  });
  const offersQuery = useQuery({
    queryKey: [...queryPrefix, "offers"],
    queryFn: getGrowthOffers,
    enabled: canView,
  });
  const leadsQuery = useQuery({
    queryKey: [...queryPrefix, "leads"],
    queryFn: getGrowthLeads,
    enabled: canOperateLeads,
  });
  const leadRegisterState = growthLeadRegisterState({
    canOperateLeads,
    hasData: leadsQuery.data !== undefined,
    isLoading: leadsQuery.isLoading,
    isPending: leadsQuery.isPending,
    isError: leadsQuery.isError,
    isSuccess: leadsQuery.isSuccess,
  });
  const [leadContactHandoff, setLeadContactHandoff] =
    useState<LeadContactHandoff | null>(null);
  const [handoffPendingLeadId, setHandoffPendingLeadId] = useState<
    string | null
  >(null);
  const handoffAbortRef = useRef<AbortController | null>(null);
  const activeAuthorityScopeRef = useRef(authorityScopeKey);
  activeAuthorityScopeRef.current = authorityScopeKey;

  const clearContactHandoff = () => {
    handoffAbortRef.current?.abort();
    handoffAbortRef.current = null;
    setLeadContactHandoff(null);
    setHandoffPendingLeadId(null);
  };

  useEffect(() => {
    clearContactHandoff();
    return () => handoffAbortRef.current?.abort();
  }, [authorityScopeKey]);

  useEffect(() => {
    if (!leadContactHandoff) return;
    const current = leadsQuery.data?.items.find(
      ({ id }) => id === leadContactHandoff.leadId,
    );
    if (
      !current ||
      current.assignedToUserId !== meQuery.data?.id ||
      current.version > leadContactHandoff.version
    ) {
      setLeadContactHandoff(null);
    }
  }, [leadContactHandoff, leadsQuery.data?.items, meQuery.data?.id]);

  const invalidateLeads = () =>
    queryClient.invalidateQueries({ queryKey: [...queryPrefix, "leads"] });
  const mutationError = (title: string) => () =>
    toast({
      variant: "destructive",
      title,
      description:
        "Reload this organisation's queue before trying again. No external action was taken.",
    });
  const onboardingMutation = useMutation({
    mutationFn: ({
      itemId,
      markerSaved,
      journeyVersion,
      expectedVersion,
    }: {
      itemId: string;
      markerSaved: boolean;
      journeyVersion: string;
      expectedVersion: number;
      queryKey: readonly unknown[];
    }): Promise<GrowthOnboardingMutationResponse> =>
      customFetch("/api/growth-suite/onboarding/progress", {
        method: "POST",
        body: JSON.stringify({
          journeyVersion,
          itemId,
          expectedVersion,
          markerSaved,
        }),
        responseType: "json",
      }),
    onSuccess: (_response, variables) => {
      // The mutation receipt does not carry the authority-derived journey.
      // Never install it into an old role-scoped cache: the exact GET validates
      // current derived roles, policy and marker membership before display.
      void queryClient.invalidateQueries({ queryKey: variables.queryKey });
      toast({
        title: variables.markerSaved
          ? "Practice marker saved"
          : "Practice marker removed",
      });
    },
    onError: (_error, variables) => {
      mutationError("Onboarding practice marker could not be recorded")();
      void queryClient.invalidateQueries({
        queryKey: variables.queryKey,
      });
    },
  });
  const leadMutation = useMutation({
    mutationFn: ({
      leadId,
      action,
    }: {
      leadId: string;
      action: LeadInboxAction;
    }) =>
      customFetch(
        `/api/growth-suite/leads/${encodeURIComponent(leadId)}/actions`,
        {
          method: "POST",
          body: JSON.stringify(action),
          responseType: "json",
          cache: "no-store",
        },
      ),
    onMutate: clearContactHandoff,
    onSuccess: () => {
      toast({ title: "Lead operation recorded" });
      void invalidateLeads();
    },
    onError: mutationError("Lead operation could not be recorded"),
  });

  const requestContactHandoff = async (
    leadId: string,
    expectedVersion: number,
    purpose: LeadContactHandoffPurpose,
  ) => {
    const current = leadsQuery.data?.items.find(({ id }) => id === leadId);
    if (
      !current ||
      current.version !== expectedVersion ||
      current.assignedToUserId !== meQuery.data?.id
    ) {
      mutationError("Assigned contact could not be opened")();
      void invalidateLeads();
      return;
    }
    clearContactHandoff();
    const requestAuthorityScope = authorityScopeKey;
    const releaseCriticalWorkflow = access?.beginCriticalWorkflow();
    const controller = new AbortController();
    handoffAbortRef.current = controller;
    setHandoffPendingLeadId(leadId);
    try {
      const payload = await customFetch<unknown>(
        `/api/growth-suite/leads/${encodeURIComponent(leadId)}/contact-handoff`,
        {
          method: "POST",
          body: JSON.stringify({ expectedVersion, purpose }),
          responseType: "json",
          cache: "no-store",
          signal: controller.signal,
        },
      );
      if (
        controller.signal.aborted ||
        activeAuthorityScopeRef.current !== requestAuthorityScope
      ) {
        return;
      }
      const response = adaptLeadContactHandoffResponse(payload, {
        leadId,
        purpose,
      });
      if (
        controller.signal.aborted ||
        activeAuthorityScopeRef.current !== requestAuthorityScope
      ) {
        return;
      }
      setLeadContactHandoff(response.handoff);
      toast({ title: "Assigned contact opened for the recorded purpose" });
      void invalidateLeads();
    } catch {
      if (controller.signal.aborted) return;
      mutationError("Assigned contact could not be opened")();
      void invalidateLeads();
    } finally {
      releaseCriticalWorkflow?.();
      if (handoffAbortRef.current === controller) {
        handoffAbortRef.current = null;
        setHandoffPendingLeadId(null);
      }
    }
  };

  if (meQuery.isLoading || meQuery.isPending) {
    return (
      <PageGatePanel
        state="pending"
        title="Resolving your identity"
        description="Leads and offers stay closed until we verify your identity and organisation access."
      />
    );
  }
  if (
    meQuery.isError ||
    !meQuery.isSuccess ||
    (organisationId && directMembership && !actorUserId)
  ) {
    return (
      <PageGatePanel
        state="error"
        title="Current identity could not be resolved"
        description="We cannot show onboarding progress or links until we verify your current identity."
      />
    );
  }
  if (!canView) {
    return (
      <PageGatePanel
        state="blocked"
        title="Direct organisation membership required"
        description="You need a direct organisation membership. Partner access and emergency access are not accepted."
      />
    );
  }
  if (
    onboardingQuery.isLoading ||
    onboardingQuery.isPending ||
    offersQuery.isLoading ||
    offersQuery.isPending
  ) {
    return (
      <PageGatePanel
        state="pending"
        title="Loading leads and offers"
        description="Loading your onboarding checklist and approved offer catalogue."
      />
    );
  }
  if (
    onboardingQuery.isError ||
    offersQuery.isError ||
    !onboardingQuery.isSuccess ||
    !offersQuery.isSuccess ||
    !onboardingQuery.data ||
    !offersQuery.data
  ) {
    return (
      <PageGatePanel
        state="error"
        title="Leads and offers could not be loaded"
        description="We have not treated onboarding or the catalogue as empty. Try again when the service is available."
      >
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            void onboardingQuery.refetch();
            void offersQuery.refetch();
          }}
        >
          Retry
        </Button>
      </PageGatePanel>
    );
  }

  return (
    <>
      <GrowthOperationsView
        onboarding={onboardingQuery.data.journey}
        onboardingProgress={onboardingQuery.data.progress}
        onboardingDestinations={onboardingDestinations}
        catalogueVersion={offersQuery.data.catalogueVersion}
        offers={offersQuery.data.items}
        leads={
          leadRegisterState === "ready" ? leadsQuery.data?.items : undefined
        }
        leadRegisterState={leadRegisterState}
        currentUserId={meQuery.data?.id}
        scopeKey={authorityScopeKey}
        leadContactHandoff={leadContactHandoff}
        handoffPendingLeadId={handoffPendingLeadId}
        canOperateLeads={canOperateLeads}
        mutationPending={
          leadMutation.isPending ||
          onboardingMutation.isPending ||
          handoffPendingLeadId !== null
        }
        onLeadAction={(leadId, action) =>
          leadMutation.mutate({ leadId, action })
        }
        onRequestContactHandoff={(leadId, expectedVersion, purpose) => {
          void requestContactHandoff(leadId, expectedVersion, purpose);
        }}
        onDismissContactHandoff={clearContactHandoff}
        onOnboardingToggle={(itemId, markerSaved) =>
          onboardingMutation.mutate({
            itemId,
            markerSaved,
            journeyVersion: onboardingQuery.data.journey.policyVersion,
            expectedVersion: onboardingQuery.data.progress.version,
            queryKey: onboardingQueryKey,
          })
        }
      />
    </>
  );
}
