import {
  getGetVaultExpiringQueryKey,
  getGetWorkflowAlertsQueryKey,
  getListProjectsQueryKey,
  useGetVaultExpiring,
  useGetWorkflowAlerts,
  useListProjects,
  type ProjectSummary,
} from "@workspace/api-client-react";
import {
  DataErrorPanel,
  DeadlineCaution,
  LoadingPanel,
  PageHeader,
  QueueCapabilityCard,
  StateBadge,
  StatusPanel,
  type SurfaceState,
} from "@/components/platform-states";
import { platformFeatureFlags } from "@/lib/platform-access";
import { formatWatInstant } from "@/lib/format";
import { useOnlineStatus } from "@/hooks/use-online-status";

const OPEN_PROJECT_STATUSES = new Set<ProjectSummary["status"]>([
  "intake",
  "extraction",
  "review",
  "defects",
  "reporting",
]);

function formatDateTime(value: string | null | undefined): string {
  return formatWatInstant(value, { empty: "Not recorded", suffix: " WAT" });
}

function projectState(project: ProjectSummary): {
  state: SurfaceState;
  label: string;
} {
  if (
    (project.fatalDefectCount ?? 0) > 0 ||
    project.conflictStatus === "blocked" ||
    project.conflictStatus === "declined"
  ) {
    return { state: "blocked", label: "Recorded blocker" };
  }
  if (project.status === "archived") {
    return { state: "unavailable", label: "Archived" };
  }
  if (project.status === "signed_off" || project.status === "exported") {
    return {
      state: "active",
      label: project.status === "signed_off" ? "Signed off" : "Exported",
    };
  }
  if (project.riskBand === "critical" || project.riskBand === "high") {
    return { state: "pending", label: `${project.riskBand} risk` };
  }
  return { state: "partial", label: project.status.replaceAll("_", " ") };
}

function deadlineOrder(left: ProjectSummary, right: ProjectSummary): number {
  const leftTime = left.deadline ? Date.parse(left.deadline) : Number.NaN;
  const rightTime = right.deadline ? Date.parse(right.deadline) : Number.NaN;
  const safeLeft = Number.isNaN(leftTime) ? Number.POSITIVE_INFINITY : leftTime;
  const safeRight = Number.isNaN(rightTime)
    ? Number.POSITIVE_INFINITY
    : rightTime;
  return safeLeft - safeRight;
}

export default function ClientPortal() {
  const enabled = platformFeatureFlags().clientPortal;
  const online = useOnlineStatus();
  const projectsQuery = useListProjects(undefined, {
    query: {
      queryKey: getListProjectsQueryKey(),
      enabled,
    },
  });
  const alertsQuery = useGetWorkflowAlerts({
    query: {
      queryKey: getGetWorkflowAlertsQueryKey(),
      enabled,
    },
  });
  const vaultQuery = useGetVaultExpiring({
    query: {
      queryKey: getGetVaultExpiringQueryKey(),
      enabled,
    },
  });

  if (!enabled) {
    return (
      <div className="mx-auto w-full max-w-7xl space-y-7 p-5 sm:p-8">
        <PageHeader
          eyebrow="Client workspace"
          title="Client portal"
          description="See pursuit status, recorded blockers and evidence validity for your current role."
          state="pending"
        />
        <StatusPanel
          state="pending"
          title="Client portal is not active yet"
          description="This deployment has not activated the client workspace. Pursuits, uploads, orders, payments and packages remain unavailable."
        />
        <DeadlineCaution>
          Readiness is evidence-led. Deadline pressure never overrides a fatal
          requirement, expired evidence or missing named approval.
        </DeadlineCaution>
      </div>
    );
  }

  const loading =
    projectsQuery.isLoading ||
    projectsQuery.isPending ||
    alertsQuery.isLoading ||
    alertsQuery.isPending ||
    vaultQuery.isLoading ||
    vaultQuery.isPending;
  const hasError =
    projectsQuery.isError || alertsQuery.isError || vaultQuery.isError;
  const projects = [...(projectsQuery.data ?? [])].sort(deadlineOrder);
  const openProjects = projects.filter((project) =>
    OPEN_PROJECT_STATUSES.has(project.status),
  );
  const fatalProjects = projects.filter(
    (project) => (project.fatalDefectCount ?? 0) > 0,
  );
  const alertCount =
    (alertsQuery.data?.slaBreaches.length ?? 0) +
    (alertsQuery.data?.redTeamDue.length ?? 0);
  const atRiskEvidence = vaultQuery.data
    ? vaultQuery.data.buckets.expired +
      vaultQuery.data.buckets.critical +
      vaultQuery.data.buckets.warning +
      vaultQuery.data.buckets.upcoming
    : 0;

  const retry = () => {
    void projectsQuery.refetch();
    void alertsQuery.refetch();
    void vaultQuery.refetch();
  };

  return (
    <div className="mx-auto w-full max-w-7xl space-y-7 p-5 sm:p-8">
      <PageHeader
        eyebrow="Client workspace"
        title="Client portal"
        description="Read-only summaries of pursuits, workflow alerts and expiring evidence for your current organisation."
        state={!online ? "offline" : loading ? "pending" : "partial"}
      />

      <StatusPanel
        state="partial"
        title="Live summaries, limited actions"
        description="The summaries below are live. This portal does not support intake, uploads, orders or package delivery, so those actions are not shown."
      />

      {!online ? (
        <StatusPanel
          state="offline"
          title="Client workspace data may be stale"
          description="Reconnect before relying on a deadline, blocker or evidence-expiry signal."
        />
      ) : null}

      <DeadlineCaution>
        These summaries are not a submission-readiness decision. Fatal defects,
        conflicts, evidence gaps and named approvals still decide readiness
        inside each pursuit.
      </DeadlineCaution>

      {loading ? (
        <LoadingPanel label="Loading client workspace records" />
      ) : null}
      {hasError ? (
        <DataErrorPanel
          title="Some client workspace records could not be loaded"
          description="Some sections may be incomplete. Missing rows or counts do not mean an issue is cleared."
          onRetry={retry}
        />
      ) : null}

      {!loading ? (
        <section aria-labelledby="client-signals-heading" className="space-y-4">
          <div>
            <h2 id="client-signals-heading" className="text-xl font-semibold">
              Organisation summary
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Counts cover pursuits, workflow alerts and evidence for the
              selected organisation.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <QueueCapabilityCard
              title="Open pursuits"
              description="Pursuits in an active delivery status."
              state={
                projectsQuery.isError
                  ? "error"
                  : openProjects.length > 0
                    ? "active"
                    : "empty"
              }
              value={
                projectsQuery.isError ? "Unavailable" : openProjects.length
              }
            />
            <QueueCapabilityCard
              title="Fatal-blocker pursuits"
              description="Pursuits with at least one recorded fatal or likely-fatal defect."
              state={
                projectsQuery.isError
                  ? "error"
                  : fatalProjects.length > 0
                    ? "blocked"
                    : "empty"
              }
              value={
                projectsQuery.isError ? "Unavailable" : fatalProjects.length
              }
            />
            <QueueCapabilityCard
              title="Workflow alerts"
              description="Missed review deadlines and open independent-review windows."
              state={
                alertsQuery.isError
                  ? "error"
                  : alertCount > 0
                    ? "pending"
                    : "empty"
              }
              value={alertsQuery.isError ? "Unavailable" : alertCount}
            />
            <QueueCapabilityCard
              title="Evidence in expiry window"
              description="Expired or approaching-expiry Vault artefacts."
              state={
                vaultQuery.isError
                  ? "error"
                  : (vaultQuery.data?.buckets.expired ?? 0) > 0
                    ? "expired"
                    : atRiskEvidence > 0
                      ? "pending"
                      : "empty"
              }
              value={vaultQuery.isError ? "Unavailable" : atRiskEvidence}
            />
          </div>
        </section>
      ) : null}

      {projectsQuery.isSuccess ? (
        <section
          aria-labelledby="client-pursuits-heading"
          className="space-y-3"
        >
          <div>
            <h2 id="client-pursuits-heading" className="text-xl font-semibold">
              Pursuit register
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Read-only summaries; the recorded next step is not presented as an
              assignment to the signed-in person.
            </p>
          </div>
          {projects.length === 0 ? (
            <StatusPanel
              state="empty"
              title="No pursuits are available"
              description="No pursuits are available for this organisation. This does not confirm onboarding, access or readiness."
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border bg-card">
              <table className="w-full min-w-[920px] text-left text-sm">
                <caption className="sr-only">
                  Pursuits visible to the current client organisation
                </caption>
                <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Pursuit
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Status
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Deadline
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Recorded next step
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Requirements / defects
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {projects.map((project) => {
                    const status = projectState(project);
                    return (
                      <tr key={project.id}>
                        <td className="px-4 py-3">
                          <span className="block font-medium">
                            {project.tenderTitle}
                          </span>
                          <span className="mt-1 block text-xs text-muted-foreground">
                            {project.issuingEntity ||
                              "Issuing entity not recorded"}
                            {project.tenderRef ? ` - ${project.tenderRef}` : ""}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <StateBadge
                            state={status.state}
                            label={status.label}
                          />
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {formatDateTime(project.deadline)}
                        </td>
                        <td className="max-w-64 px-4 py-3 text-muted-foreground">
                          {project.nextAction || "No next step returned"}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs">
                          {project.requirementCount ?? 0} /{" "}
                          {project.defectCount ?? 0}
                          {(project.fatalDefectCount ?? 0) > 0 ? (
                            <span className="mt-1 block text-destructive">
                              {project.fatalDefectCount} fatal
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {alertsQuery.isSuccess ? (
        <section aria-labelledby="client-alerts-heading" className="space-y-3">
          <h2 id="client-alerts-heading" className="text-xl font-semibold">
            Workflow attention
          </h2>
          {alertCount === 0 ? (
            <StatusPanel
              state="empty"
              title="No workflow alerts returned"
              description="No missed review deadline or open independent-review window was returned. This is not a readiness confirmation."
            />
          ) : (
            <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
              {alertsQuery.data.slaBreaches.map((alert) => (
                <div key={`sla-${alert.projectId}`} className="p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{alert.tenderTitle}</p>
                    <StateBadge
                      state="blocked"
                      label="Review deadline missed"
                    />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Due {formatDateTime(alert.dueAt)}
                  </p>
                </div>
              ))}
              {alertsQuery.data.redTeamDue.map((alert) => (
                <div key={`red-${alert.projectId}`} className="p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{alert.tenderTitle}</p>
                    <StateBadge
                      state="pending"
                      label="Independent review open"
                    />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Window opened {formatDateTime(alert.dueAt)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {vaultQuery.isSuccess ? (
        <section
          aria-labelledby="client-evidence-heading"
          className="space-y-3"
        >
          <h2 id="client-evidence-heading" className="text-xl font-semibold">
            Evidence expiry register
          </h2>
          {vaultQuery.data.items.length === 0 ? (
            <StatusPanel
              state="empty"
              title="No evidence in the expiry window"
              description="No expiring evidence was returned. This does not prove that every requirement has approved, current evidence."
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border bg-card">
              <table className="w-full min-w-[680px] text-left text-sm">
                <caption className="sr-only">
                  Evidence expired or approaching expiry
                </caption>
                <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Artefact
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Client record
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Expiry
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Validity signal
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {vaultQuery.data.items.map((item) => (
                    <tr key={item.id}>
                      <td className="px-4 py-3 font-medium">
                        {item.artefactType}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {item.clientName || "Client name unavailable"}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {item.expiryDate || "Not recorded"}
                      </td>
                      <td className="px-4 py-3">
                        <StateBadge
                          state={
                            item.expiryBand === "expired"
                              ? "expired"
                              : item.expiryBand === "critical" ||
                                  item.expiryBand === "warning"
                                ? "pending"
                                : "partial"
                          }
                          label={item.expiryBand.replaceAll("_", " ")}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
