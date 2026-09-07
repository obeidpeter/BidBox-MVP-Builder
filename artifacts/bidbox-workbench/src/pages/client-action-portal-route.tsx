import { useRef, useState } from "react";
import { useSearchParams } from "wouter";
import {
  customFetch,
  getListProjectsQueryKey,
  useGetMe,
  useListProjects,
} from "@workspace/api-client-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  adaptClientActionAuthorities,
  adaptClientActionSnapshot,
  type ClientActionAuthorityDirectory,
  type ClientActionSnapshot,
} from "@/components/client-action-portal/client-action-contract";
import {
  ClientActionUploadFlowError,
  runClientActionUpload,
  type ClientActionUploadProgress,
  type RunClientActionUploadInput,
} from "@/components/client-action-portal/client-action-upload-flow";
import { assertClientActionUploadTargetCurrent } from "@/components/client-action-portal/client-action-upload-scope";
import {
  ClientActionWorkspace,
  type ClientActionMutation,
} from "@/components/client-action-portal/client-action-workspace";
import {
  LoadingPanel,
  PageGatePanel,
  PageHeader,
  StatusPanel,
} from "@/components/platform-states";
import { Button } from "@/components/ui/button";
import { useOrganisationAccess } from "@/contexts/organisation-context";
import { useToast } from "@/hooks/use-toast";
import { assertAuthorityScopeCurrent } from "@/lib/authority-scope";

const QUERY_ROOT = "client-action-portal";
const CLIENT_ACTION_QUERY_CAPABILITIES = [
  "project:read",
  "evidence:write",
  "evidence:approve",
  "document:upload",
  "package:export",
] as const;

function capabilityFingerprint(permissions: readonly string[]): string {
  return CLIENT_ACTION_QUERY_CAPABILITIES.map((permission) =>
    permissions.includes(permission) ? permission : `!${permission}`,
  ).join("|");
}

async function getSnapshot(
  projectId: string,
  organisationId: string,
): Promise<ClientActionSnapshot> {
  const value = await customFetch<unknown>(
    `/api/projects/${encodeURIComponent(projectId)}/client-actions`,
    { responseType: "json", cache: "no-store" },
  );
  return adaptClientActionSnapshot(value, projectId, organisationId);
}

async function getAuthorities(input: {
  organisationId: string;
  projectId: string;
  currentUserId: string;
}): Promise<ClientActionAuthorityDirectory> {
  const value = await customFetch<unknown>(
    `/api/projects/${encodeURIComponent(input.projectId)}/client-actions/authorities`,
    { responseType: "json", cache: "no-store" },
  );
  return adaptClientActionAuthorities(
    value,
    input.organisationId,
    input.projectId,
    input.currentUserId,
  );
}

export default function ClientActionPortalRoute() {
  const [searchParams, setSearchParams] = useSearchParams();
  const access = useOrganisationAccess();
  const meQuery = useGetMe();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [uploadInFlight, setUploadInFlight] = useState(false);
  const uploadInFlightRef = useRef(false);
  const organisationId = access?.activeOrganisation?.id ?? "";
  const directMembership =
    access?.activeOrganisation?.accessSource === "membership" &&
    access.activeOrganisation.membershipOrganisationId === organisationId;
  const permissions = access?.effectivePermissions ?? [];
  const membershipId = access?.activeOrganisation?.membershipId ?? "";
  const membershipOrganisationId =
    access?.activeOrganisation?.membershipOrganisationId ?? "";
  const accessSource = access?.activeOrganisation?.accessSource ?? "";
  const accessVersion = String(access?.activeOrganisation?.version ?? "");
  const actorUserId = meQuery.data?.id ?? "";
  const capabilityKey = capabilityFingerprint(permissions);
  const canAccess = Boolean(
    organisationId && directMembership && permissions.includes("project:read"),
  );
  const activeActorContext = useRef({
    organisationId,
    actorUserId,
    capabilityKey,
  });
  activeActorContext.current = {
    organisationId,
    actorUserId,
    capabilityKey,
  };
  const projectsQuery = useListProjects(undefined, {
    query: {
      queryKey: [
        ...getListProjectsQueryKey(),
        organisationId,
        actorUserId,
        capabilityKey,
      ],
      enabled: canAccess && Boolean(actorUserId),
      select: (projects) => {
        assertAuthorityScopeCurrent(
          activeActorContext.current,
          { organisationId, actorUserId, capabilityKey },
          "Client action authority changed while pursuits loaded",
        );
        return projects;
      },
    },
  });
  const projects = projectsQuery.data ?? [];
  const requestedProjectId = searchParams.get("project")?.trim() ?? "";
  const selectedProject =
    projects.find(({ id }) => id === requestedProjectId) ?? projects[0];
  const projectId = selectedProject?.id ?? "";
  const canView = Boolean(projectId && canAccess);
  const canCreateEvidenceRequest =
    canView &&
    permissions.includes("evidence:write") &&
    selectedProject?.status !== "signed_off" &&
    selectedProject?.status !== "exported" &&
    selectedProject?.status !== "archived";
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
    queryFn: async () => {
      const requestedScope = {
        organisationId,
        projectId,
        actorUserId,
        capabilityKey,
      };
      const result = await getSnapshot(projectId, organisationId);
      assertAuthorityScopeCurrent(
        activeScope.current,
        requestedScope,
        "Client action authority changed while records loaded",
      );
      return result;
    },
    enabled: canView && Boolean(actorUserId),
  });
  const activeSnapshot = useRef<ClientActionSnapshot | undefined>(undefined);
  activeSnapshot.current = snapshotQuery.data;
  const activeUploadScope = useRef({
    organisationId,
    projectId,
    actorUserId,
    capabilityKey,
    membershipId,
    membershipOrganisationId,
    accessSource,
    accessVersion,
  });
  activeUploadScope.current = {
    organisationId,
    projectId,
    actorUserId,
    capabilityKey,
    membershipId,
    membershipOrganisationId,
    accessSource,
    accessVersion,
  };
  const authorityQueryKey = [
    QUERY_ROOT,
    "authorities",
    organisationId,
    projectId,
    actorUserId,
    capabilityKey,
  ] as const;
  const authoritiesQuery = useQuery({
    queryKey: authorityQueryKey,
    queryFn: async () => {
      const currentUserId = actorUserId;
      if (!currentUserId) throw new Error("Named actor is unavailable");
      const requestedScope = {
        organisationId,
        projectId,
        actorUserId,
        capabilityKey,
      };
      const result = await getAuthorities({
        ...requestedScope,
        currentUserId,
      });
      assertAuthorityScopeCurrent(
        activeScope.current,
        requestedScope,
        "Client action scope changed while authorities loaded",
      );
      return result;
    },
    enabled: canCreateEvidenceRequest && Boolean(actorUserId),
  });
  const mutation = useMutation({
    mutationFn: async (input: ClientActionMutation) => {
      const requestedScope = {
        organisationId,
        projectId,
        actorUserId,
        capabilityKey,
      };
      const release = access?.beginCriticalWorkflow();
      try {
        const result = await customFetch(
          `/api/projects/${encodeURIComponent(projectId)}/client-actions/${input.path}`,
          {
            method: "POST",
            body: JSON.stringify(input.body),
            responseType: "json",
            cache: "no-store",
          },
        );
        assertAuthorityScopeCurrent(
          activeScope.current,
          requestedScope,
          "Client action scope changed while action completed",
        );
        return result;
      } finally {
        release?.();
      }
    },
    onSuccess: () => {
      toast({ title: "Client action recorded" });
      void queryClient.invalidateQueries({ queryKey });
    },
    onError: () => {
      toast({
        variant: "destructive",
        title: "Client action could not be recorded",
        description:
          "Reload the current pursuit before retrying. No message, file upload or package transfer was performed by this action.",
      });
      void queryClient.invalidateQueries({ queryKey });
    },
  });
  const uploadExactIntent = async (
    input: RunClientActionUploadInput,
    onProgress: (progress: ClientActionUploadProgress) => void,
  ) => {
    if (uploadInFlightRef.current) {
      throw new ClientActionUploadFlowError(
        "Another upload is still active. Wait for its confirmed result before starting a different slot.",
        "checking",
        "reload_scope",
        false,
      );
    }
    uploadInFlightRef.current = true;
    const requestedScope = { ...activeUploadScope.current };
    const assertCurrent = () => {
      assertAuthorityScopeCurrent(
        activeUploadScope.current,
        requestedScope,
        "Client request upload permissions or organisation changed",
      );
      assertClientActionUploadTargetCurrent(
        activeSnapshot.current,
        input.binding,
        requestedScope.actorUserId,
      );
    };
    setUploadInFlight(true);
    const release = access?.beginCriticalWorkflow();
    try {
      const receipt = await runClientActionUpload(input, {
        assertCurrent,
        onProgress,
        issueLease: ({ binding, idempotencyKey }) =>
          customFetch<unknown>(
            `/api/projects/${encodeURIComponent(binding.projectId)}/client-actions/evidence-requests/${encodeURIComponent(binding.recordId)}/slots/${encodeURIComponent(binding.slotId)}/upload-leases`,
            {
              method: "POST",
              headers: { "Idempotency-Key": idempotencyKey },
              body: JSON.stringify({
                expectedVersion: binding.expectedRecordVersion,
                intentId: binding.intentId,
              }),
              responseType: "json",
              cache: "no-store",
            },
          ),
        putSignedObject: (uploadUrl, init) => fetch(uploadUrl, init),
        finalize: ({ binding, lease, idempotencyKey }) =>
          customFetch<unknown>(
            `/api/projects/${encodeURIComponent(binding.projectId)}/client-actions/evidence-requests/${encodeURIComponent(binding.recordId)}/slots/${encodeURIComponent(binding.slotId)}/upload-leases/${encodeURIComponent(lease.leaseId)}/finalize`,
            {
              method: "POST",
              headers: { "Idempotency-Key": idempotencyKey },
              body: JSON.stringify({
                expectedVersion: binding.expectedRecordVersion,
                intentId: binding.intentId,
              }),
              responseType: "json",
              cache: "no-store",
            },
          ),
      });
      toast({
        title: "Evidence uploaded",
        description:
          "Secure intake attached the exact file to this request slot. No external message or package transfer was performed.",
      });
      void queryClient.invalidateQueries({ queryKey });
      return receipt;
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Upload did not complete",
        description:
          error instanceof Error
            ? error.message
            : "Reload the exact request slot before retrying.",
      });
      void queryClient.invalidateQueries({ queryKey });
      throw error;
    } finally {
      release?.();
      uploadInFlightRef.current = false;
      setUploadInFlight(false);
    }
  };

  if (!canAccess) {
    return (
      <PageGatePanel
        state="blocked"
        title="Direct client membership required"
        description="Client actions are not available through partner-derived or emergency access."
      />
    );
  }
  if (meQuery.isLoading || meQuery.isPending) {
    return (
      <div className="p-5 sm:p-8">
        <LoadingPanel label="Loading available pursuits" />
      </div>
    );
  }
  if (meQuery.isError || !meQuery.data) {
    return (
      <PageGatePanel
        state="error"
        title="Available pursuits could not be verified"
        description="No pursuit or action is shown while this check is unavailable."
      />
    );
  }
  if (projectsQuery.isLoading || projectsQuery.isPending) {
    return (
      <div className="p-5 sm:p-8">
        <LoadingPanel label="Loading available pursuits" />
      </div>
    );
  }
  if (projectsQuery.isError || !projectsQuery.isSuccess) {
    return (
      <PageGatePanel
        state="error"
        title="Available pursuits could not be verified"
        description="No pursuit or action is shown while this check is unavailable."
      />
    );
  }
  if (!canView) {
    return (
      <PageGatePanel
        state="empty"
        title="No pursuit is available"
        description="An authorised bid lead must create or share a pursuit before client actions can be recorded."
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-7 p-5 sm:p-8">
      <section
        aria-labelledby="client-action-project-heading"
        className="flex flex-col gap-3 rounded-lg border bg-card p-4 sm:flex-row sm:items-end sm:justify-between"
      >
        <div>
          <h2
            id="client-action-project-heading"
            className="text-sm font-semibold"
          >
            Active pursuit
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Requests and acknowledgements are limited to this exact project.
          </p>
        </div>
        <label
          className="grid gap-1.5 text-xs font-medium"
          htmlFor="client-action-project"
        >
          Pursuit
          <select
            id="client-action-project"
            className="min-h-11 min-w-64 rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={projectId}
            disabled={mutation.isPending || uploadInFlight}
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
        eyebrow="Client requests"
        title="Provide evidence and confirm delivery"
        description="Respond to evidence requests, correct uploads and acknowledge the exact package released to you. Every action is linked to the named user and pursuit."
        state={
          snapshotQuery.isError
            ? "error"
            : snapshotQuery.isLoading || snapshotQuery.isPending
              ? "pending"
              : "active"
        }
      />
      {permissions.includes("evidence:write") &&
      (selectedProject?.status === "signed_off" ||
        selectedProject?.status === "exported" ||
        selectedProject?.status === "archived") ? (
        <StatusPanel
          state="unavailable"
          title="Evidence-request creation is closed"
          description="This pursuit is signed off, exported, or archived. Existing client-action records remain reviewable, but new evidence requests cannot be added to released content."
        />
      ) : null}
      {snapshotQuery.isLoading || snapshotQuery.isPending ? (
        <LoadingPanel label="Loading controlled client actions" />
      ) : null}
      {snapshotQuery.isError ||
      (!(snapshotQuery.isLoading || snapshotQuery.isPending) &&
        !snapshotQuery.data) ? (
        <StatusPanel
          state="error"
          title="Client actions are unavailable"
          description="No request list or completed delivery is shown while this data is unavailable."
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
      {snapshotQuery.data && actorUserId ? (
        <ClientActionWorkspace
          key={`${organisationId}:${membershipId}:${accessVersion}:${projectId}:${actorUserId}:${capabilityKey}`}
          snapshot={snapshotQuery.data}
          currentUserId={actorUserId}
          membershipId={membershipId}
          canReview={permissions.includes("evidence:approve")}
          canCreateEvidenceRequest={canCreateEvidenceRequest}
          authorityOptions={authoritiesQuery.data?.items ?? []}
          authorityState={
            authoritiesQuery.isError
              ? "error"
              : authoritiesQuery.isLoading || authoritiesQuery.isPending
                ? "loading"
                : "ready"
          }
          pending={mutation.isPending || uploadInFlight}
          onMutate={(input) => mutation.mutate(input)}
          canUpload={
            directMembership && permissions.includes("document:upload")
          }
          onUpload={uploadExactIntent}
          onReload={() => snapshotQuery.refetch()}
        />
      ) : null}
    </div>
  );
}
