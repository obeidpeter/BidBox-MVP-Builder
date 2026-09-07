import { useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  customFetch,
  getListProjectsQueryKey,
  useGetMe,
  useListProjects,
} from "@workspace/api-client-react";
import { useSearchParams } from "wouter";
import {
  adaptClaimsDeskSnapshot,
  assertClaimsDeskMutationResponse,
  ClaimsDeskCreatePanel,
  ClaimsDeskDashboard,
  ClaimsDeskTransitionPanel,
  type ClaimsDeskCreateDraft,
  type ClaimsDeskRecord,
  type ClaimsDeskTransitionDraft,
} from "@/components/claims-desk";
import { PageGatePanel, StatusPanel } from "@/components/platform-states";
import { Button } from "@/components/ui/button";
import { useOrganisationAccess } from "@/contexts/organisation-context";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { useToast } from "@/hooks/use-toast";
import { adaptCanonicalEvidenceOptions } from "@/lib/canonical-evidence-options";
import { assertAuthorityScopeCurrent } from "@/lib/authority-scope";

const QUERY_ROOT = "claims-desk";

type Mutation =
  | { kind: "create"; body: ClaimsDeskCreateDraft }
  | {
      kind: "transition";
      record: ClaimsDeskRecord;
      body: ClaimsDeskTransitionDraft;
    };

export default function ClaimsDeskPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const access = useOrganisationAccess();
  const online = useOnlineStatus();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const meQuery = useGetMe();
  const organisationId = access?.activeOrganisation?.id ?? "";
  const permissions = access?.effectivePermissions ?? [];
  const actorUserId = meQuery.data?.id ?? "";
  const capabilityKey = permissions
    .filter((permission) =>
      ["project:read", "project:update", "document:read"].includes(permission),
    )
    .sort()
    .join("|");
  const directMembership =
    access?.activeOrganisation?.accessSource === "membership" &&
    access.activeOrganisation.membershipOrganisationId === organisationId;
  const canEnter = Boolean(
    organisationId && directMembership && permissions.includes("project:read"),
  );
  const activeOrganisationId = useRef(organisationId);
  activeOrganisationId.current = organisationId;
  const projectsQuery = useListProjects(undefined, {
    query: {
      enabled: canEnter && online && Boolean(actorUserId),
      queryKey: [
        ...getListProjectsQueryKey(),
        organisationId,
        actorUserId,
        capabilityKey,
      ],
      select: (projects) => {
        if (activeOrganisationId.current !== organisationId) {
          throw new Error("Organisation changed while projects loaded");
        }
        return projects;
      },
    },
  });
  const projects = (projectsQuery.data ?? []).filter(
    (project) => project.status !== "archived",
  );
  const requestedProjectId = searchParams.get("project")?.trim() ?? "";
  const selectedProject =
    projects.find((project) => project.id === requestedProjectId) ??
    projects[0];
  const projectId = selectedProject?.id ?? "";
  const canRead = Boolean(canEnter && projectId && actorUserId);
  const canManage = Boolean(
    canRead &&
    actorUserId &&
    permissions.includes("project:update") &&
    permissions.includes("document:read"),
  );
  const activeScope = useRef({
    organisationId,
    projectId,
    actorUserId,
    capabilityKey,
  });
  activeScope.current = {
    organisationId,
    projectId,
    actorUserId,
    capabilityKey,
  };
  const queryKey = [
    QUERY_ROOT,
    organisationId,
    projectId,
    actorUserId,
    capabilityKey,
  ] as const;

  const snapshotQuery = useQuery({
    queryKey,
    enabled: canRead && online,
    queryFn: async () => {
      const requestedScope = {
        organisationId,
        projectId,
        actorUserId,
        capabilityKey,
      };
      const payload = await customFetch<unknown>(
        `/api/projects/${projectId}/claims-desk`,
        { responseType: "json", cache: "no-store" },
      );
      assertAuthorityScopeCurrent(
        activeScope.current,
        requestedScope,
        "Claims Desk scope changed while evidence loaded",
      );
      return adaptClaimsDeskSnapshot(payload, organisationId, projectId);
    },
  });

  const evidenceOptionsQuery = useQuery({
    queryKey: [
      "canonical-evidence-options",
      organisationId,
      projectId,
      actorUserId,
      capabilityKey,
      "claims-desk",
    ],
    enabled: canManage && online,
    staleTime: 0,
    gcTime: 0,
    queryFn: async () => {
      const requestedScope = {
        organisationId,
        projectId,
        actorUserId,
        capabilityKey,
      };
      const payload = await customFetch<unknown>(
        `/api/canonical-evidence-options?projectId=${encodeURIComponent(projectId)}&limit=100`,
        { responseType: "json", cache: "no-store" },
      );
      assertAuthorityScopeCurrent(
        activeScope.current,
        requestedScope,
        "Claims Desk authority changed while evidence options loaded",
      );
      return adaptCanonicalEvidenceOptions(payload, organisationId, projectId);
    },
  });
  const identityPending = meQuery.isLoading || meQuery.isPending;
  const identityUnavailable =
    meQuery.isError ||
    (!identityPending && (!meQuery.isSuccess || actorUserId === ""));
  const projectsPending = projectsQuery.isLoading || projectsQuery.isPending;
  const projectsUnavailable =
    projectsQuery.isError ||
    (!projectsPending &&
      (!projectsQuery.isSuccess || projectsQuery.data === undefined));
  const snapshotPending = snapshotQuery.isLoading || snapshotQuery.isPending;
  const snapshotUnavailable =
    snapshotQuery.isError ||
    (!snapshotPending &&
      (!snapshotQuery.isSuccess || snapshotQuery.data === undefined));
  const evidenceOptionsPending =
    canManage &&
    (evidenceOptionsQuery.isLoading || evidenceOptionsQuery.isPending);
  const evidenceOptionsUnavailable =
    canManage &&
    !evidenceOptionsPending &&
    (evidenceOptionsQuery.isError ||
      !evidenceOptionsQuery.isSuccess ||
      evidenceOptionsQuery.data === undefined);

  const mutation = useMutation({
    mutationFn: async (request: Mutation) => {
      const requestedScope = {
        organisationId,
        projectId,
        actorUserId,
        capabilityKey,
      };
      const releaseCriticalWorkflow = access?.beginCriticalWorkflow();
      try {
        const path =
          request.kind === "create"
            ? `/api/projects/${projectId}/claims-desk/records`
            : `/api/projects/${projectId}/claims-desk/records/${request.record.id}/transitions`;
        const payload = await customFetch<unknown>(path, {
          method: "POST",
          headers:
            request.kind === "transition"
              ? { "If-Match": `"${request.record.version}"` }
              : undefined,
          body: JSON.stringify(request.body),
          responseType: "json",
          cache: "no-store",
        });
        assertAuthorityScopeCurrent(
          activeScope.current,
          requestedScope,
          "Claims Desk authority changed while evidence was recorded",
        );
        const record = assertClaimsDeskMutationResponse(
          payload,
          requestedScope.organisationId,
          requestedScope.projectId,
        );
        return {
          organisationId: requestedScope.organisationId,
          projectId: requestedScope.projectId,
          record,
        };
      } finally {
        releaseCriticalWorkflow?.();
      }
    },
    onSuccess: ({
      organisationId: recordedOrg,
      projectId: recordedProject,
      record,
    }) => {
      toast({
        title: "Claims evidence recorded",
        description: `Version ${record.version} · receipt ${record.latestReceiptSha256.slice(0, 12)}…`,
      });
      void queryClient.invalidateQueries({
        queryKey: [QUERY_ROOT, recordedOrg, recordedProject],
      });
    },
    onError: () =>
      toast({
        title: "Claims evidence was not recorded",
        description:
          "Reload the project record and confirm the latest version, independent approval and approved document evidence before trying again.",
        variant: "destructive",
      }),
  });

  if (!canEnter)
    return (
      <PageGatePanel
        state="blocked"
        title="Direct project membership required"
        description="You need an active direct organisation membership with permission to view projects. Partner access and emergency access are not accepted."
      />
    );
  if (!online)
    return (
      <PageGatePanel
        state="offline"
        title="Live claims evidence is unavailable offline"
        description="We cannot use cached data to decide any commercial, deadline or claims status. Reconnect to load the project record."
      />
    );
  if (identityPending)
    return (
      <PageGatePanel
        state="pending"
        title="Checking your identity"
        description="Claims stays closed until we verify your identity for this organisation."
      />
    );
  if (identityUnavailable)
    return (
      <PageGatePanel
        state="error"
        title="Your identity could not be verified"
        description="We cannot show any project, commercial or claims status."
      />
    );
  if (projectsPending)
    return (
      <PageGatePanel
        state="pending"
        title="Loading available projects"
        description="Choose an active project before using Claims."
      />
    );
  if (projectsUnavailable)
    return (
      <PageGatePanel
        state="error"
        title="Available projects could not be verified"
        description="We have not assumed any commercial or claims status."
      />
    );
  if (!selectedProject)
    return (
      <PageGatePanel
        state="empty"
        title="No active project is available"
        description="Create an active project or get direct access to one before recording claims evidence."
      />
    );
  if (snapshotPending)
    return (
      <PageGatePanel
        state="pending"
        title="Loading the project record"
        description="Checking project scope, receipt history and workflow status."
      />
    );
  if (snapshotUnavailable || !snapshotQuery.data)
    return (
      <PageGatePanel
        state="error"
        title="Claims evidence could not be verified"
        description="We have not assumed any entitlement, value, notice delivery or payment status."
      >
        <Button
          type="button"
          variant="outline"
          onClick={() => void snapshotQuery.refetch()}
        >
          Retry verification
        </Button>
      </PageGatePanel>
    );

  return (
    <main className="space-y-6 p-5 sm:p-8">
      <section
        aria-labelledby="claims-desk-project-heading"
        className="flex flex-col gap-3 rounded-lg border bg-card p-4 sm:flex-row sm:items-end sm:justify-between"
      >
        <div>
          <h2
            id="claims-desk-project-heading"
            className="text-sm font-semibold"
          >
            Active project scope
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            All records, document digests and receipts are limited to this
            project.
          </p>
        </div>
        <label
          className="grid gap-1.5 text-xs font-medium"
          htmlFor="claims-desk-project"
        >
          Project
          <select
            id="claims-desk-project"
            className="min-h-11 min-w-64 rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={projectId}
            disabled={mutation.isPending}
            onChange={(event) => {
              const next = new URLSearchParams(searchParams);
              next.set("project", event.currentTarget.value);
              setSearchParams(next, { replace: true });
            }}
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.tenderTitle} · {project.status.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
      </section>
      <ClaimsDeskDashboard snapshot={snapshotQuery.data} />
      {evidenceOptionsPending ? (
        <StatusPanel
          state="pending"
          title="Loading approved document choices"
          description="Claims actions stay disabled until current approved document versions are verified."
        />
      ) : evidenceOptionsUnavailable ? (
        <StatusPanel
          state="error"
          title="Approved documents could not be verified"
          description="Claims actions stay disabled until current approved document versions can be reloaded."
        />
      ) : canManage && evidenceOptionsQuery.data ? (
        <div className="grid gap-6 xl:grid-cols-2">
          <ClaimsDeskCreatePanel
            pending={mutation.isPending || evidenceOptionsQuery.isLoading}
            evidenceOptions={evidenceOptionsQuery.data?.items ?? []}
            evidenceOptionsTruncated={
              evidenceOptionsQuery.data?.truncated ?? false
            }
            onCreate={(body) =>
              mutation.mutateAsync({ kind: "create", body }).then(() => {})
            }
          />
          <ClaimsDeskTransitionPanel
            records={snapshotQuery.data.records}
            pending={mutation.isPending || evidenceOptionsQuery.isLoading}
            evidenceOptions={evidenceOptionsQuery.data?.items ?? []}
            evidenceOptionsTruncated={
              evidenceOptionsQuery.data?.truncated ?? false
            }
            onTransition={(record, body) =>
              mutation
                .mutateAsync({ kind: "transition", record, body })
                .then(() => {})
            }
          />
        </div>
      ) : !canManage ? (
        <StatusPanel
          state="blocked"
          title="Claims is read-only"
          description="You need permission to update projects to add workflow evidence. Viewing the record does not authorise a notice, invoice or payment."
        />
      ) : null}
    </main>
  );
}
