import {
  getGetVaultExpiringQueryKey,
  getGetWorkflowAlertsQueryKey,
  getListProjectsQueryKey,
  type Gate0Metric,
  type ProjectSummary,
  type VaultExpiringItem,
  useGetDashboardMetrics,
  useGetVaultExpiring,
  useGetWorkflowAlerts,
  useListProjects,
} from "@workspace/api-client-react";
import { ArrowRight, Check, FileCheck2, Target, X } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DataErrorPanel,
  LoadingPanel,
  PageHeader,
  StateBadge,
  StatusPanel,
  type SurfaceState,
} from "@/components/platform-states";
import { MyWorkInbox } from "@/components/my-work-inbox";
import { PursuitControlTower } from "@/components/pursuit-control-tower";
import { useOrganisationAccess } from "@/contexts/organisation-context";
import { formatWatInstant } from "@/lib/format";
import { platformRoleLabel } from "@/lib/platform-access";

const TERMINAL_STATUSES = new Set(["signed_off", "exported", "archived"]);
const LOADING_VALUE = "\u2026";
const UNAVAILABLE_VALUE = "\u2014";

const countFormatter = new Intl.NumberFormat("en-NG");

function parseRecordedDate(value: string): Date {
  // Project deadlines originate from a datetime-local field. When the stored
  // value has no explicit offset, treat it as the product's WAT business time
  // instead of silently applying the viewer's device timezone.
  const hasTime = value.includes("T");
  const hasExplicitZone = /(?:z|[+-]\d{2}:?\d{2})$/i.test(value);
  return new Date(hasTime && !hasExplicitZone ? `${value}+01:00` : value);
}

function formatWatDate(value: string): string {
  const parsed = parseRecordedDate(value);
  if (Number.isNaN(parsed.getTime())) return "Invalid recorded date";
  return formatWatInstant(parsed, { withTime: false });
}

function deadlineTime(project: ProjectSummary): number | null {
  if (!project.deadline) return null;
  const timestamp = parseRecordedDate(project.deadline).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

function formatGate0Value(value: number, unit: Gate0Metric["unit"]): string {
  return unit === "ratio"
    ? `${(value * 100).toFixed(0)}%`
    : countFormatter.format(value);
}

function vaultState(item: VaultExpiringItem): SurfaceState {
  if (item.expiryBand === "expired" || item.expiryBand === "critical") {
    return "expired";
  }
  if (item.expiryBand === "warning" || item.expiryBand === "upcoming") {
    return "pending";
  }
  return "partial";
}

function vaultStateLabel(item: VaultExpiringItem): string {
  const days = item.daysToExpiry;
  if (item.expiryBand === "expired") {
    return days === null || days === undefined
      ? "Expired"
      : `Expired ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ago`;
  }
  if (item.expiryBand === "critical" && days === 0) return "Expires today";
  if (days !== null && days !== undefined) {
    return `${days} day${days === 1 ? "" : "s"} remaining`;
  }
  return "Expiry needs review";
}

function SignalCard({
  title,
  value,
  description,
  state,
}: {
  title: string;
  value: string | number;
  description: string;
  state: SurfaceState;
}) {
  return (
    <Card className="shadow-none">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold">{title}</h2>
            <p
              className="mt-3 text-3xl font-semibold tracking-tight"
              aria-label={`${title}: ${value}`}
            >
              {value}
            </p>
          </div>
          <StateBadge state={state} />
        </div>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      </CardContent>
    </Card>
  );
}

function SectionHeading({
  id,
  title,
  description,
  action,
}: {
  id: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h2 id={id} className="text-xl font-semibold tracking-tight">
          {title}
        </h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      </div>
      {action}
    </div>
  );
}

export default function Dashboard() {
  const access = useOrganisationAccess();
  const permissions = access?.effectivePermissions ?? [];
  const effectiveRoles = access?.effectiveRoles ?? [];
  const canReadProjects = permissions.includes("project:read");
  const canReadEvidence = permissions.includes("evidence:read");
  const metricsQuery = useGetDashboardMetrics();
  const projectsQuery = useListProjects(undefined, {
    query: {
      queryKey: getListProjectsQueryKey(),
      enabled: canReadProjects,
    },
  });
  const vaultQuery = useGetVaultExpiring({
    query: {
      queryKey: getGetVaultExpiringQueryKey(),
      enabled: canReadEvidence,
    },
  });
  const alertsQuery = useGetWorkflowAlerts({
    query: {
      queryKey: getGetWorkflowAlertsQueryKey(),
      enabled: canReadProjects,
    },
  });

  const metrics = metricsQuery.data;
  const projects = projectsQuery.data ?? [];
  const expiring = vaultQuery.data;
  const workflowAlerts = alertsQuery.data;
  const activeProjects = projects.filter(
    (project) => !TERMINAL_STATUSES.has(project.status),
  );
  const slaProjectIds = new Set(
    workflowAlerts?.slaBreaches.map((alert) => alert.projectId) ?? [],
  );
  const redTeamProjectIds = new Set(
    workflowAlerts?.redTeamDue.map((alert) => alert.projectId) ?? [],
  );
  const controlTowerSignals = {
    slaProjectIds,
    independentReviewProjectIds: redTeamProjectIds,
  };
  const roleLabel =
    effectiveRoles.length === 1
      ? platformRoleLabel(effectiveRoles[0])
      : effectiveRoles.length > 1
        ? effectiveRoles.map(platformRoleLabel).join(" and ")
        : "your current access";

  const activeDeadlineProjects = activeProjects
    .filter((project) => deadlineTime(project) !== null)
    .sort(
      (left, right) =>
        (deadlineTime(left) ?? Number.POSITIVE_INFINITY) -
        (deadlineTime(right) ?? Number.POSITIVE_INFINITY),
    );
  const now = Date.now();
  const recordedDeadlinesPassed = activeDeadlineProjects.filter(
    (project) => (deadlineTime(project) ?? Number.POSITIVE_INFINITY) < now,
  ).length;
  const conflictBlocked = activeProjects.filter(
    (project) =>
      project.conflictStatus === "blocked" ||
      project.conflictStatus === "declined",
  ).length;
  const materialFindingProjects = activeProjects.filter(
    (project) => (project.fatalDefectCount ?? 0) > 0,
  ).length;

  const sources = [
    { name: "portfolio measures", query: metricsQuery },
    ...(canReadProjects
      ? [
          { name: "pursuit register", query: projectsQuery },
          { name: "workflow alerts", query: alertsQuery },
        ]
      : []),
    ...(canReadEvidence
      ? [{ name: "evidence validity", query: vaultQuery }]
      : []),
  ];
  const restrictedSources = [
    ...(!canReadProjects ? ["pursuit data and workflow issues"] : []),
    ...(!canReadEvidence ? ["evidence validity"] : []),
  ];
  const queryPending = (query: (typeof sources)[number]["query"]) =>
    query.isLoading || query.isPending;
  const unavailableSources = sources.filter(
    ({ query }) =>
      query.isError ||
      (!queryPending(query) && (!query.isSuccess || query.data === undefined)),
  );
  const allLoading = sources.every(({ query }) => queryPending(query));
  const anyLoading = sources.some(({ query }) => queryPending(query));
  const allUnavailable = unavailableSources.length === sources.length;
  const pageState: SurfaceState = allLoading
    ? "pending"
    : allUnavailable
      ? "error"
      : unavailableSources.length > 0 ||
          anyLoading ||
          restrictedSources.length > 0
        ? "partial"
        : "active";
  const alertsPending = alertsQuery.isLoading || alertsQuery.isPending;
  const alertsUnavailable =
    alertsQuery.isError ||
    (!alertsPending && (!alertsQuery.isSuccess || !workflowAlerts));
  const projectsPending = projectsQuery.isLoading || projectsQuery.isPending;
  const projectsUnavailable =
    projectsQuery.isError ||
    (!projectsPending &&
      (!projectsQuery.isSuccess || projectsQuery.data === undefined));
  const vaultPending = vaultQuery.isLoading || vaultQuery.isPending;
  const vaultUnavailable =
    vaultQuery.isError ||
    (!vaultPending && (!vaultQuery.isSuccess || vaultQuery.data === undefined));
  const metricsPending = metricsQuery.isLoading || metricsQuery.isPending;
  const metricsUnavailable =
    metricsQuery.isError ||
    (!metricsPending &&
      (!metricsQuery.isSuccess || metricsQuery.data === undefined));

  const retryAll = () => {
    void metricsQuery.refetch();
    if (canReadProjects) {
      void projectsQuery.refetch();
      void alertsQuery.refetch();
    }
    if (canReadEvidence) void vaultQuery.refetch();
  };

  return (
    <main className="mx-auto w-full max-w-7xl space-y-8 p-5 sm:p-8">
      <PageHeader
        title="Dashboard"
        description="Start with your work, then open the pursuit that needs attention. Dates and times use West Africa Time (WAT)."
        state={pageState}
        actions={
          canReadProjects ? (
            <Button asChild variant="outline">
              <Link href="/projects">Open all pursuits</Link>
            </Button>
          ) : undefined
        }
      />

      {allLoading ? <LoadingPanel label="Loading dashboard data" /> : null}

      {allUnavailable && !allLoading ? (
        <DataErrorPanel
          title="Dashboard data could not be loaded"
          description="No decision, deadline or readiness conclusion can be drawn until the dashboard sources respond."
          onRetry={retryAll}
        />
      ) : null}

      {!allUnavailable && unavailableSources.length > 0 ? (
        <StatusPanel
          state="partial"
          title="Some dashboard data is unavailable"
          description={`Available sections remain visible, but ${unavailableSources.map((source) => source.name).join(", ")} could not be checked. An unavailable count is not zero.`}
        >
          <Button type="button" variant="outline" onClick={retryAll}>
            Retry unavailable data
          </Button>
        </StatusPanel>
      ) : null}

      {!allLoading && restrictedSources.length > 0 ? (
        <StatusPanel
          state="unavailable"
          title="Some data is outside your current access"
          description={`Your current role cannot read ${restrictedSources.join(" and ")}. These records were not requested, and hidden counts are not shown as zero.`}
        />
      ) : null}

      {!allLoading && !allUnavailable && canReadProjects ? (
        <PursuitControlTower
          projects={projects}
          projectState={
            projectsPending
              ? "loading"
              : projectsUnavailable
                ? "unavailable"
                : "ready"
          }
          signals={controlTowerSignals}
          signalState={
            alertsPending
              ? "loading"
              : alertsUnavailable
                ? "unavailable"
                : "ready"
          }
          roleLabel={roleLabel}
          now={now}
        />
      ) : null}

      <MyWorkInbox />

      {!allLoading && !allUnavailable ? (
        <section
          aria-labelledby="attention-snapshot-heading"
          className="space-y-4"
        >
          <SectionHeading
            id="attention-snapshot-heading"
            title="Items needing attention"
            description="These counts do not approve a release or submission. Open the relevant pursuit to check its current status."
          />
          {canReadProjects ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <SignalCard
                title="Review deadlines missed"
                value={
                  alertsPending
                    ? LOADING_VALUE
                    : alertsUnavailable
                      ? UNAVAILABLE_VALUE
                      : (workflowAlerts?.slaBreaches.length ?? 0)
                }
                state={
                  alertsPending
                    ? "pending"
                    : alertsUnavailable
                      ? "error"
                      : (workflowAlerts?.slaBreaches.length ?? 0) > 0
                        ? "blocked"
                        : "empty"
                }
                description="Workflow reviews that are past their recorded review deadline."
              />
              <SignalCard
                title="Recorded deadlines passed"
                value={
                  projectsPending
                    ? LOADING_VALUE
                    : projectsUnavailable
                      ? UNAVAILABLE_VALUE
                      : recordedDeadlinesPassed
                }
                state={
                  projectsPending
                    ? "pending"
                    : projectsUnavailable
                      ? "error"
                      : recordedDeadlinesPassed > 0
                        ? "pending"
                        : "empty"
                }
                description="Active pursuits whose recorded submission time is in the past; this does not assert submission status."
              />
              <SignalCard
                title="Conflict blocks"
                value={
                  projectsPending
                    ? LOADING_VALUE
                    : projectsUnavailable
                      ? UNAVAILABLE_VALUE
                      : conflictBlocked
                }
                state={
                  projectsPending
                    ? "pending"
                    : projectsUnavailable
                      ? "error"
                      : conflictBlocked > 0
                        ? "blocked"
                        : "empty"
                }
                description="Active pursuits with a blocked or declined conflict decision."
              />
              <SignalCard
                title="Important findings recorded"
                value={
                  projectsPending
                    ? LOADING_VALUE
                    : projectsUnavailable
                      ? UNAVAILABLE_VALUE
                      : materialFindingProjects
                }
                state={
                  projectsPending
                    ? "pending"
                    : projectsUnavailable
                      ? "error"
                      : materialFindingProjects > 0
                        ? "pending"
                        : "empty"
                }
                description="Pursuits containing fatal or likely-fatal findings. Their current resolution status must be checked in the pursuit readiness gate."
              />
            </div>
          ) : (
            <StatusPanel
              state="unavailable"
              title="Items needing attention are restricted"
              description="Review deadlines, submission deadlines, conflicts and important findings need pursuit access. No pursuit data was requested and no hidden count is shown as zero."
            />
          )}
        </section>
      ) : null}

      {!allLoading && !allUnavailable && canReadEvidence ? (
        <section
          aria-labelledby="evidence-validity-heading"
          className="space-y-4"
        >
          <SectionHeading
            id="evidence-validity-heading"
            title="Expiring evidence"
            description="Client evidence that is expired or nearing its recorded expiry date."
            action={
              <Link
                href="/evidence-readiness"
                className="inline-flex items-center gap-2 rounded-sm text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                Open evidence readiness
                <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
            }
          />
          {vaultPending ? (
            <LoadingPanel label="Loading evidence validity" />
          ) : vaultUnavailable || !expiring ? (
            <StatusPanel
              state="error"
              title="Evidence validity is unavailable"
              description="Vault expiry records could not be verified. Do not infer that evidence is current."
            />
          ) : expiring.items.length === 0 ? (
            <StatusPanel
              state="empty"
              title="No expiry exceptions returned"
              description="The Vault endpoint returned no artefacts in its expiry window."
            />
          ) : (
            <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
              {expiring.items.slice(0, 6).map((item) => (
                <Link
                  key={item.id}
                  href={`/clients/${item.clientId}`}
                  aria-label={`Open evidence record: ${item.artefactType} for ${item.clientName ?? "client"}`}
                  className="flex min-h-20 items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <div className="min-w-0">
                    <p className="font-medium">{item.artefactType}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {item.clientName ?? "Client name unavailable"}
                      {item.expiryDate
                        ? ` · Recorded expiry ${formatWatDate(item.expiryDate)}`
                        : " · Expiry date unavailable"}
                    </p>
                  </div>
                  <StateBadge
                    state={vaultState(item)}
                    label={vaultStateLabel(item)}
                  />
                </Link>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {!allLoading && !allUnavailable ? (
        <section aria-labelledby="gate-zero-heading" className="space-y-4">
          <SectionHeading
            id="gate-zero-heading"
            title="Initial readiness check"
            description="Business validation thresholds from dashboard data. These measures do not replace pursuit-level quality or release checks."
          />
          {metricsPending ? (
            <LoadingPanel label="Loading initial readiness measures" />
          ) : metricsUnavailable || !metrics ? (
            <StatusPanel
              state="error"
              title="Initial readiness measures are unavailable"
              description="The metrics source did not return a verified initial readiness result."
            />
          ) : !metrics.gate0 ? (
            <StatusPanel
              state="unavailable"
              title="Initial readiness measures are not present"
              description="Portfolio metrics loaded, but this response did not include the initial readiness thresholds."
            />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-4">
                <Target aria-hidden="true" className="size-5 text-primary" />
                <p className="font-semibold">
                  {metrics.gate0.metCount} of {metrics.gate0.totalCount}{" "}
                  thresholds met
                </p>
                <StateBadge
                  state={
                    metrics.gate0.metCount === metrics.gate0.totalCount
                      ? "active"
                      : "pending"
                  }
                  label={
                    metrics.gate0.metCount === metrics.gate0.totalCount
                      ? "Thresholds met"
                      : "Thresholds outstanding"
                  }
                />
              </div>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {metrics.gate0.metrics.map((metric) => (
                  <Card key={metric.key} className="shadow-none">
                    <CardContent className="p-5">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <h3 className="text-sm font-semibold">
                            {metric.label}
                          </h3>
                          {metric.description ? (
                            <p className="mt-1 text-sm leading-6 text-muted-foreground">
                              {metric.description}
                            </p>
                          ) : null}
                        </div>
                        <span
                          className={`flex size-8 shrink-0 items-center justify-center rounded-full border ${metric.met ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-900"}`}
                          role="img"
                          aria-label={
                            metric.met
                              ? "Threshold met"
                              : "Threshold outstanding"
                          }
                        >
                          {metric.met ? (
                            <Check aria-hidden="true" className="size-4" />
                          ) : (
                            <X aria-hidden="true" className="size-4" />
                          )}
                        </span>
                      </div>
                      <p className="mt-4 text-2xl font-semibold">
                        {formatGate0Value(metric.value, metric.unit)}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Target:{" "}
                        {formatGate0Value(metric.threshold, metric.unit)} or
                        more
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </>
          )}
        </section>
      ) : null}

      <aside className="flex gap-3 rounded-lg border border-border bg-muted/30 p-4 text-sm leading-6 text-muted-foreground">
        <FileCheck2 aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
        <p>
          Dashboard signals help teams decide what to review first. Named
          reviewers must still confirm evidence, resolve blocking findings and
          complete the pursuit-level readiness checks before sign-off or export.
        </p>
      </aside>
    </main>
  );
}
