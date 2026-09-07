import { useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  customFetch,
  getListDocumentsQueryKey,
  getListProjectsQueryKey,
  getListVaultItemsQueryKey,
  useGetMe,
  useListDocuments,
  useListProjects,
  useListVaultItems,
} from "@workspace/api-client-react";
import { Link, useSearchParams } from "wouter";
import { LowBandwidthMobileReviewer } from "@/components/operations-suite";
import type {
  OperationsSuiteActions,
  WorkItemStatus,
} from "@/components/operations-suite";
import { PageGatePanel } from "@/components/platform-states";
import { Button } from "@/components/ui/button";
import { useOrganisationAccess } from "@/contexts/organisation-context";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { useToast } from "@/hooks/use-toast";
import { assertAuthorityScopeCurrent } from "@/lib/authority-scope";
import PursuitOperationsSuite from "./pursuit-operations-suite";
import PursuitOperationsSuiteRecorder, {
  type CanonicalDocumentOption,
  type OperationsRecorderCommand,
  type VaultItemOption,
} from "./pursuit-operations-suite-recorder";
import {
  adaptOperationsMobileQueuePayload,
  adaptOperationsSuitePayload,
  adaptPackageVersionListPayload,
  adaptProjectDocumentOptions,
  adaptVaultItemOptions,
  commandPermission,
  operationsCapabilityFingerprint,
  WORK_TRANSITIONS,
} from "./operations-suite-codec";

export {
  adaptOperationsMobileQueuePayload,
  adaptOperationsSuitePayload,
  adaptPackageVersionListPayload,
  adaptProjectDocumentOptions,
  adaptVaultItemOptions,
  OperationsSuitePayloadError,
} from "./operations-suite-codec";
export type {
  AdaptedOperationsSuitePayload,
  AdaptedPackageVersionList,
  OperationsSuiteAdapterContext,
} from "./operations-suite-codec";

export default function PursuitOperationsSuiteRoute() {
  const [searchParams, setSearchParams] = useSearchParams();
  const compactMode = searchParams.get("view") === "mobile";
  const online = useOnlineStatus();
  const { toast } = useToast();
  const organisationAccess = useOrganisationAccess();
  const meQuery = useGetMe();
  const organisationId = organisationAccess?.activeOrganisation?.id ?? "";
  const actorUserId = meQuery.data?.id ?? "";
  const effectivePermissions = organisationAccess?.effectivePermissions ?? [];
  const capabilityKey = operationsCapabilityFingerprint(effectivePermissions);
  const hasProjectRead = effectivePermissions.includes("project:read");
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
      enabled: Boolean(organisationId && actorUserId && hasProjectRead),
      select: (availableProjects) => {
        assertAuthorityScopeCurrent(
          activeActorContext.current,
          { organisationId, actorUserId, capabilityKey },
          "Operations authority changed while pursuits loaded",
        );
        return availableProjects;
      },
    },
  });
  const projects = projectsQuery.data ?? [];
  const requestedProjectId = searchParams.get("project");
  const selectedProject =
    projects.find(({ id }) => id === requestedProjectId) ?? projects[0];
  const projectId = selectedProject?.id ?? "";
  const clientId = selectedProject?.clientId ?? "";
  const canRead = Boolean(organisationId && actorUserId && hasProjectRead);
  const canMutate = Boolean(
    canRead && effectivePermissions.includes("project:update"),
  );
  const canReadEvidence = effectivePermissions.includes("evidence:read");
  const canReadDocuments = effectivePermissions.includes("document:read");
  const canReadPackages = effectivePermissions.includes("package:read");
  const canExportPackages = effectivePermissions.includes("package:export");
  const canGeneratePackages = effectivePermissions.includes("package:generate");
  const canLoadPackageVersions = Boolean(
    !compactMode &&
    canReadPackages &&
    (canExportPackages || canGeneratePackages) &&
    projectId,
  );
  const recorderPermissions = {
    projectUpdate: effectivePermissions.includes("project:update"),
    projectAssign: effectivePermissions.includes("project:assign"),
    evidenceWrite:
      canReadEvidence && effectivePermissions.includes("evidence:write"),
    evidenceApprove:
      canReadEvidence && effectivePermissions.includes("evidence:approve"),
    packageExport: canReadPackages && canExportPackages,
    packageGenerate: canReadPackages && canGeneratePackages,
  };
  const canRecordAnyOperation =
    Object.values(recorderPermissions).some(Boolean);
  const canLoadDocumentReferences = Boolean(
    !compactMode &&
    canReadDocuments &&
    projectId &&
    (recorderPermissions.projectUpdate ||
      recorderPermissions.evidenceWrite ||
      recorderPermissions.evidenceApprove),
  );
  const activeReadScope = useRef({
    organisationId,
    projectId,
    actorUserId,
    capabilityKey,
  });
  activeReadScope.current = {
    organisationId,
    projectId,
    actorUserId,
    capabilityKey,
  };

  const suiteQuery = useQuery({
    queryKey: [
      "operations-suite",
      organisationId,
      projectId,
      actorUserId,
      capabilityKey,
    ],
    enabled: Boolean(!compactMode && canRead && projectId && actorUserId),
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
        `/api/projects/${encodeURIComponent(projectId)}/operations-suite`,
        { responseType: "json", cache: "no-store" },
      );
      const result = adaptOperationsSuitePayload(payload, {
        organisationId,
        projectId,
        projectTitle: selectedProject?.tenderTitle ?? "Selected pursuit",
        currentUserId: actorUserId,
      });
      assertAuthorityScopeCurrent(
        activeReadScope.current,
        requestedScope,
        "Operations authority changed while records loaded",
      );
      return result;
    },
  });
  const mobileQueueQuery = useQuery({
    queryKey: [
      "operations-suite-mobile-queue",
      organisationId,
      projectId,
      actorUserId,
      capabilityKey,
    ],
    enabled: Boolean(compactMode && canRead && projectId && actorUserId),
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
        `/api/projects/${encodeURIComponent(projectId)}/operations-suite/mobile-queue`,
        { responseType: "json", cache: "no-store" },
      );
      const result = adaptOperationsMobileQueuePayload(payload, projectId);
      assertAuthorityScopeCurrent(
        activeReadScope.current,
        requestedScope,
        "Operations authority changed while queue loaded",
      );
      return result;
    },
  });
  const packageVersionQuery = useQuery({
    queryKey: [
      "project-export-package-versions",
      organisationId,
      projectId,
      actorUserId,
      capabilityKey,
    ],
    enabled: canLoadPackageVersions,
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
        `/api/projects/${encodeURIComponent(projectId)}/package-versions`,
        { responseType: "json", cache: "no-store" },
      );
      const result = adaptPackageVersionListPayload(payload);
      assertAuthorityScopeCurrent(
        activeReadScope.current,
        requestedScope,
        "Operations authority changed while packages loaded",
      );
      return result;
    },
  });
  const documentsQuery = useListDocuments<CanonicalDocumentOption[]>(
    projectId,
    {
      query: {
        queryKey: [
          ...getListDocumentsQueryKey(projectId),
          organisationId,
          actorUserId,
          capabilityKey,
        ],
        enabled: canLoadDocumentReferences,
        staleTime: 0,
        gcTime: 0,
        select: (documents) => {
          assertAuthorityScopeCurrent(
            activeReadScope.current,
            {
              organisationId,
              projectId,
              actorUserId,
              capabilityKey,
            },
            "Operations authority changed while documents loaded",
          );
          return adaptProjectDocumentOptions(documents, projectId);
        },
      },
      request: { cache: "no-store" },
    },
  );
  const canLoadVaultItems = Boolean(
    !compactMode &&
    canReadEvidence &&
    recorderPermissions.evidenceApprove &&
    clientId &&
    documentsQuery.isSuccess,
  );
  const vaultItemsQuery = useListVaultItems<VaultItemOption[]>(clientId, {
    query: {
      queryKey: [
        ...getListVaultItemsQueryKey(clientId),
        organisationId,
        actorUserId,
        capabilityKey,
      ],
      enabled: canLoadVaultItems,
      staleTime: 0,
      gcTime: 0,
      select: (vaultItems) => {
        assertAuthorityScopeCurrent(
          activeReadScope.current,
          {
            organisationId,
            projectId,
            actorUserId,
            capabilityKey,
          },
          "Operations authority changed while Vault loaded",
        );
        return adaptVaultItemOptions(
          vaultItems,
          clientId,
          documentsQuery.data ?? [],
        );
      },
    },
    request: { cache: "no-store" },
  });
  const activeMutationScope = useRef({
    organisationId,
    projectId,
    actorUserId,
    capabilityKey,
  });
  activeMutationScope.current = {
    organisationId,
    projectId,
    actorUserId,
    capabilityKey,
  };
  const executeScopedCommand = async (
    path: string,
    options: Parameters<typeof customFetch>[1],
  ) => {
    const requestedScope = {
      organisationId,
      projectId,
      actorUserId,
      capabilityKey,
    };
    const releaseCriticalWorkflow = organisationAccess?.beginCriticalWorkflow();
    try {
      const result = await customFetch(path, options);
      assertAuthorityScopeCurrent(
        activeMutationScope.current,
        requestedScope,
        "Pursuit changed while the operation was recorded",
      );
      return result;
    } finally {
      releaseCriticalWorkflow?.();
    }
  };

  const refreshAfterMutation = (title: string) => {
    toast({ title });
    void suiteQuery.refetch();
    if (canLoadPackageVersions) void packageVersionQuery.refetch();
    if (canLoadDocumentReferences) void documentsQuery.refetch();
    if (canLoadVaultItems) void vaultItemsQuery.refetch();
  };
  const mutationFailure = (title: string) => {
    toast({
      variant: "destructive",
      title,
      description:
        "Refresh the selected pursuit before trying again. No external action was taken.",
    });
    void suiteQuery.refetch();
    if (canLoadPackageVersions) void packageVersionQuery.refetch();
    if (canLoadDocumentReferences) void documentsQuery.refetch();
    if (canLoadVaultItems) void vaultItemsQuery.refetch();
  };
  const deadlineMutation = useMutation({
    mutationFn: ({
      recordId,
      expectedVersion,
      deadline,
    }: {
      recordId: string;
      expectedVersion: number;
      deadline: string;
    }) =>
      executeScopedCommand(
        `/api/projects/${encodeURIComponent(projectId)}/operations-suite/opportunities/${encodeURIComponent(recordId)}/confirm-deadline`,
        {
          method: "POST",
          body: JSON.stringify({ expectedVersion, deadline }),
          responseType: "json",
          cache: "no-store",
        },
      ),
    onSuccess: () => refreshAfterMutation("Deadline confirmation recorded"),
    onError: () => mutationFailure("Deadline confirmation was not recorded"),
  });
  const workMutation = useMutation({
    mutationFn: ({
      recordId,
      expectedVersion,
      status,
    }: {
      recordId: string;
      expectedVersion: number;
      status: WorkItemStatus;
    }) =>
      executeScopedCommand(
        `/api/projects/${encodeURIComponent(projectId)}/operations-suite/work-items/${encodeURIComponent(recordId)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ expectedVersion, status }),
          responseType: "json",
          cache: "no-store",
        },
      ),
    onSuccess: () => refreshAfterMutation("Work status recorded"),
    onError: () => mutationFailure("Work status was not recorded"),
  });
  const recorderMutation = useMutation({
    mutationFn: (command: OperationsRecorderCommand) =>
      executeScopedCommand(
        `/api/projects/${encodeURIComponent(projectId)}${command.path}`,
        {
          method: command.method,
          body: JSON.stringify(command.body),
          responseType: "json",
          cache: "no-store",
        },
      ),
    onSuccess: (_result, command) => refreshAfterMutation(command.successTitle),
    onError: () => mutationFailure("The operations command was not recorded"),
  });
  const operationPending =
    recorderMutation.isPending ||
    deadlineMutation.isPending ||
    workMutation.isPending;

  if (!canRead) {
    return (
      <PageGatePanel
        state="blocked"
        title="Pursuit read access required"
        description="Your current organisation access does not include pursuit records. No operations data was requested."
      />
    );
  }

  if (projectsQuery.isLoading || meQuery.isLoading) {
    return <PursuitOperationsSuite loadState={{ status: "loading" }} />;
  }

  if (projectsQuery.isError || meQuery.isError || !meQuery.data) {
    return (
      <PursuitOperationsSuite
        loadState={{
          status: "error",
          message: "The authorised project list could not be loaded.",
          retry: () => {
            void projectsQuery.refetch();
            void meQuery.refetch();
          },
        }}
      />
    );
  }

  if (!selectedProject) {
    return (
      <PageGatePanel
        state="empty"
        title="No accessible pursuits are available"
        description="No pursuit was returned for your current access. This does not mean the organisation has no pursuits."
      />
    );
  }

  const projectSelector = (
    <section
      aria-labelledby="operations-project-heading"
      className="mx-auto w-full max-w-7xl px-4 pt-4 sm:px-8 sm:pt-8"
    >
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="operations-project-heading" className="text-sm font-semibold">
            Active pursuit
          </h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Records and requests are limited to this selected pursuit.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label
            className="grid gap-1.5 text-xs font-medium"
            htmlFor="operations-project"
          >
            Pursuit
            <select
              id="operations-project"
              className="min-h-11 min-w-64 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-control-size="44"
              value={projectId}
              disabled={operationPending}
              onChange={(event) => {
                const nextProjectId = event.currentTarget.value;
                setSearchParams(
                  (current) => {
                    const next = new URLSearchParams(current);
                    next.set("project", nextProjectId);
                    return next;
                  },
                  { replace: true },
                );
              }}
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.tenderTitle}
                </option>
              ))}
            </select>
          </label>
          <Button
            asChild
            variant="outline"
            className="min-h-11"
            data-control-size="44"
          >
            <Link
              href={`/pursuit-operations?project=${encodeURIComponent(projectId)}${compactMode ? "" : "&view=mobile"}`}
              aria-disabled={operationPending}
              onClick={(event) => {
                if (operationPending) event.preventDefault();
              }}
            >
              {compactMode
                ? "Back to full pursuit operations"
                : "Open low-bandwidth mobile queue"}
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );

  if (compactMode) {
    return (
      <main className="mx-auto w-full max-w-7xl space-y-6 pb-8">
        {projectSelector}
        <div className="px-4 sm:px-8">
          <LowBandwidthMobileReviewer
            items={mobileQueueQuery.data ?? []}
            state={
              mobileQueueQuery.isLoading
                ? "loading"
                : mobileQueueQuery.isError
                  ? "error"
                  : "ready"
            }
            error={
              mobileQueueQuery.isError
                ? "The compact task list was unavailable or invalid. This does not mean the list is empty."
                : undefined
            }
            onRetry={() => void mobileQueueQuery.refetch()}
            readOnly
            online={online}
          />
        </div>
      </main>
    );
  }

  const adapter = suiteQuery.data;
  const actions: OperationsSuiteActions =
    canMutate && online
      ? {
          onConfirmOpportunity: (recordId) => {
            const record = adapter?.opportunityMutations.get(recordId);
            if (
              !record ||
              !record.deadline ||
              record.deadlineStatus !== "unconfirmed" ||
              deadlineMutation.isPending
            ) {
              mutationFailure("Current deadline confirmation is unavailable");
              return;
            }
            deadlineMutation.mutate({
              recordId,
              expectedVersion: record.version,
              deadline: record.deadline,
            });
          },
          onChangeWorkStatus: (recordId, status) => {
            const record = adapter?.workMutations.get(recordId);
            if (
              !record ||
              !WORK_TRANSITIONS[record.status].includes(status) ||
              workMutation.isPending
            ) {
              mutationFailure("That work transition is unavailable");
              return;
            }
            workMutation.mutate({
              recordId,
              expectedVersion: record.version,
              status,
            });
          },
        }
      : {};

  const loadState = suiteQuery.isLoading
    ? ({ status: "loading" } as const)
    : suiteQuery.isError || !adapter
      ? ({
          status: "error" as const,
          message:
            "The operations summary for this organisation was unavailable or invalid.",
          retry: () => void suiteQuery.refetch(),
        } as const)
      : ({ status: "ready" as const, snapshot: adapter.snapshot } as const);

  return (
    <div>
      {projectSelector}
      <PursuitOperationsSuite
        loadState={loadState}
        actions={actions}
        readOnly={!canRecordAnyOperation || !online}
        online={online}
        visibility={{
          opportunities: Boolean(
            adapter?.visibleKinds.includes("opportunity_intake"),
          ),
          work: Boolean(adapter?.visibleKinds.includes("work_item")),
          evidence: Boolean(
            canReadEvidence &&
            adapter?.visibleKinds.includes("evidence_request"),
          ),
          submissions: Boolean(
            canReadPackages &&
            adapter?.visibleKinds.includes("submission_war_room") &&
            adapter.visibleKinds.includes("visual_qa_report"),
          ),
          credentials: Boolean(
            canReadEvidence &&
            adapter?.visibleKinds.includes("credential_verification"),
          ),
          missions: Boolean(adapter?.visibleKinds.includes("mission")),
          postAward: Boolean(adapter?.visibleKinds.includes("post_award_item")),
          mobile: false,
        }}
      />
      {adapter ? (
        <PursuitOperationsSuiteRecorder
          key={`${organisationId}:${projectId}:${actorUserId}:${capabilityKey}`}
          permissions={recorderPermissions}
          currentUserId={meQuery.data?.id}
          records={{
            ...adapter.recorderRecords,
            packageVersions: packageVersionQuery.data?.items ?? [],
            documents: documentsQuery.data ?? [],
            vaultItems: vaultItemsQuery.data ?? [],
          }}
          online={online}
          pending={operationPending}
          packageVersionsState={
            packageVersionQuery.isLoading
              ? "loading"
              : packageVersionQuery.isError
                ? "error"
                : "ready"
          }
          packageVersionsTruncated={
            packageVersionQuery.data?.truncated ?? false
          }
          documentsState={
            !canReadDocuments
              ? "unavailable"
              : documentsQuery.isLoading
                ? "loading"
                : documentsQuery.isError
                  ? "error"
                  : "ready"
          }
          vaultItemsState={
            !canReadEvidence || !canReadDocuments || !clientId
              ? "unavailable"
              : documentsQuery.isLoading || vaultItemsQuery.isLoading
                ? "loading"
                : documentsQuery.isError || vaultItemsQuery.isError
                  ? "error"
                  : "ready"
          }
          onCommand={(command) => {
            const requiredPermission = commandPermission(command);
            if (
              !online ||
              !effectivePermissions.includes(requiredPermission) ||
              recorderMutation.isPending
            ) {
              mutationFailure("This operations command is unavailable");
              return;
            }
            recorderMutation.mutate(command);
          }}
        />
      ) : null}
    </div>
  );
}
