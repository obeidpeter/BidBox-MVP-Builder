import { useRef } from "react";
import { useSearchParams } from "wouter";
import {
  customFetch,
  getListProjectsQueryKey,
  useListProjects,
} from "@workspace/api-client-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  adaptCommunicationReferences,
  adaptCommunicationSnapshot,
  type CommunicationMutation,
  type CommunicationReferenceSet,
  type CommunicationSnapshot,
} from "@/components/reconciled-communications/communications-contract";
import { CommunicationsHub } from "@/components/reconciled-communications/communications-hub";
import {
  LoadingPanel,
  PageGatePanel,
  PageHeader,
  StatusPanel,
} from "@/components/platform-states";
import { Button } from "@/components/ui/button";
import { useOrganisationAccess } from "@/contexts/organisation-context";
import { useToast } from "@/hooks/use-toast";

const QUERY_ROOT = "reconciled-communications";

async function getSnapshot(
  projectId: string,
  organisationId: string,
): Promise<CommunicationSnapshot> {
  const value = await customFetch<unknown>(
    `/api/projects/${encodeURIComponent(projectId)}/communications`,
    { responseType: "json", cache: "no-store" },
  );
  return adaptCommunicationSnapshot(value, projectId, organisationId);
}

async function getReferences(
  projectId: string,
  organisationId: string,
): Promise<CommunicationReferenceSet> {
  const value = await customFetch<unknown>(
    `/api/projects/${encodeURIComponent(projectId)}/communications/references`,
    { responseType: "json", cache: "no-store" },
  );
  return adaptCommunicationReferences(value, projectId, organisationId);
}

export default function ReconciledCommunicationsRoute() {
  const [searchParams, setSearchParams] = useSearchParams();
  const access = useOrganisationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const organisationId = access?.activeOrganisation?.id ?? "";
  const permissions = access?.effectivePermissions ?? [];
  const directMembership =
    access?.activeOrganisation?.accessSource === "membership" &&
    access.activeOrganisation.membershipOrganisationId === organisationId;
  const canAccess = Boolean(
    organisationId && directMembership && permissions.includes("project:read"),
  );
  const activeOrganisationId = useRef(organisationId);
  activeOrganisationId.current = organisationId;
  const projectsQuery = useListProjects(undefined, {
    query: {
      queryKey: [...getListProjectsQueryKey(), organisationId],
      enabled: canAccess,
      select: (projects) => {
        if (activeOrganisationId.current !== organisationId) {
          throw new Error("Organisation changed while pursuits loaded");
        }
        return projects;
      },
    },
  });
  const projects = projectsQuery.data ?? [];
  const projectsPending = projectsQuery.isLoading || projectsQuery.isPending;
  const projectsUnavailable =
    projectsQuery.isError ||
    (!projectsPending &&
      (!projectsQuery.isSuccess || projectsQuery.data === undefined));
  const requestedProjectId = searchParams.get("project")?.trim() ?? "";
  const selectedProject =
    projects.find(({ id }) => id === requestedProjectId) ?? projects[0];
  const projectId = selectedProject?.id ?? "";
  const canManage = canAccess && permissions.includes("project:update");
  const canView = Boolean(projectId && canAccess);
  const activeScope = useRef({ organisationId, projectId });
  activeScope.current = { organisationId, projectId };
  const queryKey = [QUERY_ROOT, organisationId, projectId] as const;
  const referenceKey = [
    QUERY_ROOT,
    "references",
    organisationId,
    projectId,
  ] as const;

  const snapshotQuery = useQuery({
    queryKey,
    queryFn: async () => {
      const requestedScope = { organisationId, projectId };
      const result = await getSnapshot(projectId, organisationId);
      if (
        activeScope.current.organisationId !== requestedScope.organisationId ||
        activeScope.current.projectId !== requestedScope.projectId
      ) {
        throw new Error("Communication scope changed while the history loaded");
      }
      return result;
    },
    enabled: canView,
  });
  const referencesQuery = useQuery({
    queryKey: referenceKey,
    queryFn: async () => {
      const requestedScope = { organisationId, projectId };
      const result = await getReferences(projectId, organisationId);
      if (
        activeScope.current.organisationId !== requestedScope.organisationId ||
        activeScope.current.projectId !== requestedScope.projectId
      ) {
        throw new Error("Communication scope changed while choices loaded");
      }
      return result;
    },
    enabled: Boolean(canManage && projectId),
  });
  const snapshotPending = snapshotQuery.isLoading || snapshotQuery.isPending;
  const snapshotUnavailable =
    snapshotQuery.isError ||
    (!snapshotPending &&
      (!snapshotQuery.isSuccess || snapshotQuery.data === undefined));

  const mutation = useMutation({
    mutationFn: async (input: CommunicationMutation) => {
      const requestedScope = { organisationId, projectId };
      const release = access?.beginCriticalWorkflow();
      try {
        const result = await customFetch(
          `/api/projects/${encodeURIComponent(projectId)}/communications/${input.path}`,
          {
            method: "POST",
            body: JSON.stringify(input.body),
            responseType: "json",
            cache: "no-store",
          },
        );
        if (
          activeScope.current.organisationId !==
            requestedScope.organisationId ||
          activeScope.current.projectId !== requestedScope.projectId
        ) {
          throw new Error(
            "Communication scope changed while the action completed",
          );
        }
        return { input, result };
      } finally {
        release?.();
      }
    },
    onSuccess: ({ input }) => {
      toast({
        title:
          input.kind === "queue"
            ? "Message plan created"
            : input.kind === "attempt"
              ? "Delivery attempt added to the record"
              : "Provider receipt checked",
        description:
          input.kind === "attempt"
            ? "The provider may have accepted the request, but delivery stays pending until a trusted receipt is verified."
            : undefined,
      });
      void queryClient.invalidateQueries({ queryKey });
      void queryClient.invalidateQueries({ queryKey: referenceKey });
    },
    onError: () => {
      toast({
        variant: "destructive",
        title: "Communication action could not be verified",
        description:
          "Reload this pursuit before trying again. Do not assume that a message was sent or delivered.",
      });
      void queryClient.invalidateQueries({ queryKey });
      void queryClient.invalidateQueries({ queryKey: referenceKey });
    },
  });

  if (!canAccess) {
    return (
      <PageGatePanel
        state="blocked"
        title="Direct membership required"
        description="This communication record requires direct organisation membership. Partner access and emergency access are not accepted."
      />
    );
  }
  if (projectsPending) {
    return (
      <div className="p-5 sm:p-8">
        <LoadingPanel label="Loading available pursuits" />
      </div>
    );
  }
  if (projectsUnavailable) {
    return (
      <PageGatePanel
        state="error"
        title="Available pursuits could not be verified"
        description="We have not assumed any communication scope or delivery status."
      />
    );
  }
  if (!canView) {
    return (
      <PageGatePanel
        state="empty"
        title="No pursuit is available"
        description="Select an authorised pursuit before creating a message plan."
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-7 p-5 sm:p-8">
      <section
        aria-labelledby="communications-project-heading"
        className="flex flex-col gap-3 rounded-lg border bg-card p-4 sm:flex-row sm:items-end sm:justify-between"
      >
        <div>
          <h2
            id="communications-project-heading"
            className="text-sm font-semibold"
          >
            Active pursuit
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            All message plans, attempts, consent records and receipts are
            limited to this project.
          </p>
        </div>
        <label
          className="grid gap-1.5 text-xs font-medium"
          htmlFor="communications-project"
        >
          Pursuit
          <select
            id="communications-project"
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
                {project.tenderTitle}
              </option>
            ))}
          </select>
        </label>
      </section>

      <PageHeader
        eyebrow="Communication history"
        title="Communication log"
        description="Use approved templates, record each delivery attempt before it happens, and verify provider receipts. Provider acceptance alone is not delivery."
        state={
          snapshotUnavailable ? "error" : snapshotPending ? "pending" : "active"
        }
      />

      {snapshotPending ? (
        <LoadingPanel label="Loading the communication log" />
      ) : null}
      {snapshotUnavailable ? (
        <StatusPanel
          state="error"
          title="Communication log is unavailable"
          description="We could not load the communication record. This does not mean the queue is empty or delivery is complete."
        >
          <Button
            type="button"
            variant="outline"
            onClick={() => void snapshotQuery.refetch()}
          >
            Retry
          </Button>
        </StatusPanel>
      ) : null}
      {snapshotQuery.data ? (
        <CommunicationsHub
          key={`${organisationId}:${projectId}`}
          snapshot={snapshotQuery.data}
          references={referencesQuery.data ?? null}
          referencesLoading={
            referencesQuery.isLoading || referencesQuery.isPending
          }
          canManage={canManage}
          pending={mutation.isPending}
          onMutate={(input) => mutation.mutate(input)}
        />
      ) : null}
    </div>
  );
}
