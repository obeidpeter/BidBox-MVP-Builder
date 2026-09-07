import { useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  customFetch,
  getListProjectsQueryKey,
  getListVaultItemsQueryKey,
  useGetMe,
  useListProjects,
  useListVaultItems,
} from "@workspace/api-client-react";
import { useSearchParams } from "wouter";
import { EvidenceRenewalConsole } from "@/components/evidence-renewal";
import { LoadingPanel, PageGatePanel } from "@/components/platform-states";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useOrganisationAccess } from "@/contexts/organisation-context";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { useToast } from "@/hooks/use-toast";
import { assertAuthorityScopeCurrent } from "@/lib/authority-scope";
import { adaptCanonicalEvidenceOptions } from "@/lib/canonical-evidence-options";
import {
  adaptEvidenceRenewalAuthorities,
  adaptEvidenceRenewalMutation,
  adaptEvidenceRenewalSnapshot,
  type EvidenceRenewalCreateDraft,
  type EvidenceRenewalPlan,
  type EvidenceRenewalReviewDraft,
  type EvidenceRenewalStageDraft,
} from "@/lib/evidence-renewal";

const QUERY_ROOT = "evidence-renewal";

type RenewalMutation =
  | { kind: "create"; draft: EvidenceRenewalCreateDraft }
  | {
      kind: "stage";
      plan: EvidenceRenewalPlan;
      draft: EvidenceRenewalStageDraft;
    }
  | {
      kind: "review";
      plan: EvidenceRenewalPlan;
      draft: EvidenceRenewalReviewDraft;
    };

export default function EvidenceRenewalPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const access = useOrganisationAccess();
  const online = useOnlineStatus();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const meQuery = useGetMe();
  const organisationId = access?.activeOrganisation?.id ?? "";
  const actorUserId = meQuery.data?.id ?? "";
  const membershipId = access?.activeOrganisation?.membershipId ?? "";
  const authorityVersion = String(access?.activeOrganisation?.version ?? 0);
  const authorityExpiry = access?.activeOrganisation?.accessExpiresAt ?? "none";
  const permissions = access?.effectivePermissions ?? [];
  const capabilityKey = permissions
    .filter((permission) =>
      [
        "evidence:read",
        "evidence:write",
        "evidence:approve",
        "document:read",
      ].includes(permission),
    )
    .sort()
    .join("|");
  const directMembership = Boolean(
    access?.activeOrganisation?.accessSource === "membership" &&
    access.activeOrganisation.membershipOrganisationId === organisationId,
  );
  const canEnter = Boolean(
    organisationId &&
    actorUserId &&
    membershipId &&
    directMembership &&
    permissions.includes("evidence:read"),
  );
  const canManage = Boolean(
    canEnter &&
    permissions.includes("evidence:write") &&
    permissions.includes("document:read"),
  );
  const canVerify = Boolean(
    canEnter && permissions.includes("evidence:approve"),
  );
  const activeAuthority = useRef({
    organisationId,
    actorUserId,
    membershipId,
    authorityVersion,
    authorityExpiry,
    capabilityKey,
  });
  activeAuthority.current = {
    organisationId,
    actorUserId,
    membershipId,
    authorityVersion,
    authorityExpiry,
    capabilityKey,
  };
  const activeScope = useRef({
    organisationId,
    projectId: "",
    actorUserId,
    membershipId,
    authorityVersion,
    authorityExpiry,
    capabilityKey,
  });

  const projectsQuery = useListProjects(undefined, {
    query: {
      enabled: canEnter && online,
      queryKey: [
        ...getListProjectsQueryKey(),
        QUERY_ROOT,
        organisationId,
        actorUserId,
        membershipId,
        authorityVersion,
        authorityExpiry,
        capabilityKey,
      ],
      gcTime: 0,
      staleTime: 0,
      select: (projects) => {
        assertAuthorityScopeCurrent(
          activeAuthority.current,
          {
            organisationId,
            actorUserId,
            membershipId,
            authorityVersion,
            authorityExpiry,
            capabilityKey,
          },
          "Evidence renewal authority changed while pursuits loaded",
        );
        return projects;
      },
    },
  });
  const projects = (projectsQuery.data ?? []).filter(
    (project) => project.status !== "archived",
  );
  const requestedProjectId = searchParams.get("project")?.trim() ?? "";
  const selectedProject =
    projects.find(({ id }) => id === requestedProjectId) ?? projects[0];
  const projectId = selectedProject?.id ?? "";
  const clientId = selectedProject?.clientId ?? "";
  activeScope.current = {
    organisationId,
    projectId,
    actorUserId,
    membershipId,
    authorityVersion,
    authorityExpiry,
    capabilityKey,
  };
  const queryKey = [
    QUERY_ROOT,
    organisationId,
    projectId,
    actorUserId,
    membershipId,
    authorityVersion,
    authorityExpiry,
    capabilityKey,
  ] as const;

  const assertCurrent = (message: string) => {
    assertAuthorityScopeCurrent(
      activeScope.current,
      {
        organisationId,
        projectId,
        actorUserId,
        membershipId,
        authorityVersion,
        authorityExpiry,
        capabilityKey,
      },
      message,
    );
  };

  const snapshotQuery = useQuery({
    queryKey,
    enabled: canEnter && online && Boolean(projectId),
    queryFn: async () => {
      const payload = await customFetch<unknown>(
        `/api/projects/${projectId}/evidence-renewals`,
        { responseType: "json", cache: "no-store" },
      );
      assertCurrent("Evidence renewal scope changed while plans loaded");
      return adaptEvidenceRenewalSnapshot(payload, organisationId, projectId);
    },
  });

  const authoritiesQuery = useQuery({
    queryKey: [...queryKey, "authorities"],
    enabled: canEnter && online && Boolean(projectId),
    gcTime: 0,
    staleTime: 0,
    queryFn: async () => {
      const payload = await customFetch<unknown>(
        `/api/projects/${projectId}/evidence-renewals/authorities`,
        { responseType: "json", cache: "no-store" },
      );
      assertCurrent("Evidence renewal authority changed while options loaded");
      return adaptEvidenceRenewalAuthorities(payload, organisationId);
    },
  });

  const vaultQuery = useListVaultItems(clientId, {
    query: {
      enabled: canEnter && online && Boolean(clientId),
      queryKey: [
        ...getListVaultItemsQueryKey(clientId),
        QUERY_ROOT,
        organisationId,
        actorUserId,
        membershipId,
        authorityVersion,
        authorityExpiry,
        capabilityKey,
      ],
      gcTime: 0,
      staleTime: 0,
      select: (items) => {
        assertCurrent(
          "Evidence renewal authority changed while vault items loaded",
        );
        return items;
      },
    },
  });

  const canonicalQuery = useQuery({
    queryKey: [...queryKey, "canonical-evidence"],
    enabled: canManage && online && Boolean(projectId),
    gcTime: 0,
    staleTime: 0,
    queryFn: async () => {
      const payload = await customFetch<unknown>(
        `/api/canonical-evidence-options?projectId=${encodeURIComponent(projectId)}&limit=100`,
        { responseType: "json", cache: "no-store" },
      );
      assertCurrent(
        "Evidence renewal permissions changed while current documents loaded",
      );
      return adaptCanonicalEvidenceOptions(payload, organisationId, projectId);
    },
  });

  const mutation = useMutation({
    mutationFn: async (request: RenewalMutation) => {
      const requestedScope = {
        organisationId,
        projectId,
        actorUserId,
        membershipId,
        authorityVersion,
        authorityExpiry,
        capabilityKey,
      };
      const releaseCriticalWorkflow = access?.beginCriticalWorkflow();
      try {
        const url =
          request.kind === "create"
            ? `/api/projects/${projectId}/evidence-renewals`
            : request.kind === "stage"
              ? `/api/projects/${projectId}/evidence-renewals/${request.plan.id}/staged-replacement`
              : `/api/projects/${projectId}/evidence-renewals/${request.plan.id}/review`;
        const payload = await customFetch<unknown>(url, {
          method: "POST",
          headers:
            request.kind === "create"
              ? undefined
              : { "If-Match": `"${request.plan.version}"` },
          body: JSON.stringify(request.draft),
          responseType: "json",
          cache: "no-store",
        });
        assertAuthorityScopeCurrent(
          activeScope.current,
          requestedScope,
          "Evidence renewal authority changed while the action completed",
        );
        return adaptEvidenceRenewalMutation(
          payload,
          requestedScope.organisationId,
          requestedScope.projectId,
        );
      } finally {
        releaseCriticalWorkflow?.();
      }
    },
    onSuccess: (plan) => {
      toast({
        title: "Evidence renewal receipt recorded",
        description: `Version ${plan.version} · ${plan.latestReceiptSha256.slice(0, 12)}… · no external message sent`,
      });
      void queryClient.invalidateQueries({ queryKey });
      void queryClient.invalidateQueries({
        queryKey: getListVaultItemsQueryKey(clientId),
      });
      void queryClient.invalidateQueries({
        queryKey: [...queryKey, "canonical-evidence"],
      });
    },
    onError: () => {
      toast({
        variant: "destructive",
        title: "Evidence renewal action was not verified",
        description:
          "The request key is kept for a safe retry. No external message was confirmed as sent.",
      });
    },
  });

  if (!canEnter) {
    return (
      <PageGatePanel
        state="blocked"
        title="Direct evidence access required"
        description="Evidence renewal plans are unavailable through partner or emergency access."
      />
    );
  }
  if (!online) {
    return (
      <PageGatePanel
        state="offline"
        title="Evidence renewal is unavailable offline"
        description="Reconnect before reading or changing renewal plans."
      />
    );
  }
  if (projectsQuery.isLoading || !actorUserId) {
    return (
      <div className="p-5 sm:p-8">
        <LoadingPanel label="Loading evidence renewal access" />
      </div>
    );
  }
  if (projectsQuery.isError || projects.length === 0) {
    return (
      <PageGatePanel
        state={projectsQuery.isError ? "error" : "empty"}
        title={
          projectsQuery.isError
            ? "Pursuit scope is unavailable"
            : "No active pursuit"
        }
        description="Select a current pursuit before viewing a renewal plan."
      />
    );
  }

  const requiredLoading =
    snapshotQuery.isLoading ||
    authoritiesQuery.isLoading ||
    vaultQuery.isLoading ||
    (canManage && canonicalQuery.isLoading);
  const requiredError =
    snapshotQuery.isError ||
    authoritiesQuery.isError ||
    vaultQuery.isError ||
    (canManage && canonicalQuery.isError);

  return (
    <>
      <div className="mx-auto w-full max-w-7xl px-5 pt-5 sm:px-8 sm:pt-8">
        <div className="max-w-xl space-y-2">
          <Label htmlFor="renewal-project">Pursuit scope</Label>
          <select
            id="renewal-project"
            className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={projectId}
            onChange={(event) => {
              const next = new URLSearchParams(searchParams);
              next.set("project", event.target.value);
              setSearchParams(next);
            }}
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.tenderTitle}
              </option>
            ))}
          </select>
        </div>
      </div>
      {requiredLoading ? (
        <div className="p-5 sm:p-8">
          <LoadingPanel label="Verifying renewal plans and current authorities" />
        </div>
      ) : null}
      {requiredError ? (
        <PageGatePanel
          state="error"
          title="Evidence renewal records could not be checked"
          description="No empty list, current assignment, approved document or successful reminder is shown while this check is unavailable."
        >
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void snapshotQuery.refetch();
              void authoritiesQuery.refetch();
              void vaultQuery.refetch();
              if (canManage) void canonicalQuery.refetch();
            }}
          >
            Retry verification
          </Button>
        </PageGatePanel>
      ) : null}
      {!requiredLoading &&
      !requiredError &&
      snapshotQuery.data &&
      authoritiesQuery.data &&
      vaultQuery.data ? (
        <EvidenceRenewalConsole
          key={`${organisationId}:${projectId}:${actorUserId}:${membershipId}:${authorityVersion}:${authorityExpiry}:${capabilityKey}`}
          snapshot={snapshotQuery.data}
          authorities={authoritiesQuery.data}
          vaultItems={vaultQuery.data.map((item) => ({
            id: item.id,
            artefactType: item.artefactType,
            expiryDate: item.expiryDate ?? null,
          }))}
          pursuits={projects
            .filter((project) => project.clientId === clientId)
            .map((project) => ({
              projectId: project.id,
              title: project.tenderTitle,
            }))}
          canonicalOptions={canonicalQuery.data?.items ?? []}
          canonicalOptionsTruncated={canonicalQuery.data?.truncated ?? false}
          currentActorUserId={actorUserId}
          canManage={canManage}
          canVerify={canVerify}
          pending={mutation.isPending}
          onCreate={(draft) =>
            mutation.mutateAsync({ kind: "create", draft }).then(() => {})
          }
          onStage={(plan, draft) =>
            mutation.mutateAsync({ kind: "stage", plan, draft }).then(() => {})
          }
          onReview={(plan, draft) =>
            mutation.mutateAsync({ kind: "review", plan, draft }).then(() => {})
          }
        />
      ) : null}
    </>
  );
}
