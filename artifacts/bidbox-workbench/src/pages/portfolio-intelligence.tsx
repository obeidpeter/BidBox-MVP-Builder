import {
  getGetPortfolioIntelligenceQueryKey,
  useGetPortfolioIntelligence,
  useGetMe,
} from "@workspace/api-client-react";
import { Link } from "wouter";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  CircleDotDashed,
  FileCheck2,
  PackageCheck,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  DataErrorPanel,
  LoadingPanel,
  PageHeader,
  StateBadge,
  StatusPanel,
  type SurfaceState,
} from "@/components/platform-states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useOrganisationAccess,
  useOrganisationPermission,
} from "@/contexts/organisation-context";
import { formatWatInstant, humaniseTokenCapitalised } from "@/lib/format";

type PortfolioProject = {
  id: string;
  title: string;
  status: string;
  deadline: string | null;
  responseStatus: string;
  redTeamStatus: string;
  packageStatus: string;
  rehearsalStatus: string;
  nextAction: string | null;
};

type PortfolioIntelligenceSnapshot = {
  generatedAt: string;
  authorityNote: string;
  totals: {
    projectCount: number;
    responseReadyCount: number;
    redTeamApprovedCount: number;
    packageReadyCount: number;
    rehearsalReadyCount: number;
    confirmedOutcomeCount: number;
  };
  projects: PortfolioProject[];
  limitations?: string[];
};

type PortfolioHealth = "ready" | "blocked" | "stale" | "in_progress";
type FilterHealth = "all" | PortfolioHealth;

const READY_STATES = new Set([
  "approved",
  "assembled",
  "complete",
  "completed",
  "passed",
  "ready",
  "rehearsal_ready",
  "resolved",
  "signed_off",
]);
const BLOCKED_STATES = new Set([
  "blocked",
  "changes_requested",
  "failed",
  "findings_open",
  "incomplete",
  "rejected",
]);

function normalizedStatus(value: string | null | undefined): string {
  return value?.trim().toLowerCase().replaceAll("-", "_") || "not_started";
}

function stageState(value: string): SurfaceState {
  const status = normalizedStatus(value);
  if (status.includes("stale") || status.includes("invalidated")) {
    return "expired";
  }
  if (BLOCKED_STATES.has(status)) return "blocked";
  if (READY_STATES.has(status)) return "active";
  return "pending";
}

function projectHealth(project: PortfolioProject): PortfolioHealth {
  const states = [
    project.responseStatus,
    project.redTeamStatus,
    project.packageStatus,
    project.rehearsalStatus,
  ].map(stageState);
  if (states.includes("expired")) return "stale";
  if (states.includes("blocked")) return "blocked";
  if (states.every((state) => state === "active")) return "ready";
  return "in_progress";
}

function healthState(health: PortfolioHealth): SurfaceState {
  if (health === "ready") return "active";
  if (health === "stale") return "expired";
  if (health === "blocked") return "blocked";
  return "pending";
}

function healthLabel(health: PortfolioHealth): string {
  if (health === "in_progress") return "In progress";
  return humaniseTokenCapitalised(health);
}

function StageStatus({ label, value }: { label: string; value: string }) {
  const state = stageState(value);
  const visibleStatus =
    state === "expired"
      ? "Stale"
      : humaniseTokenCapitalised(normalizedStatus(value));
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 py-1.5">
      <span className="truncate text-xs text-muted-foreground">{label}</span>
      <StateBadge state={state} label={visibleStatus} className="shrink-0" />
    </div>
  );
}

function MetricCard({
  label,
  value,
  state,
  icon: Icon,
}: {
  label: string;
  value: number;
  state: SurfaceState;
  icon: typeof BarChart3;
}) {
  return (
    <Card className="shadow-none">
      <CardContent className="flex items-center justify-between gap-4 p-5">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </p>
          <p
            className="mt-2 font-mono text-2xl font-semibold"
            aria-label={`${label}: ${value}`}
          >
            {value}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-muted/50 p-2.5">
          <Icon
            aria-hidden="true"
            className={
              state === "blocked"
                ? "size-5 text-destructive"
                : state === "active"
                  ? "size-5 text-emerald-700"
                  : "size-5 text-muted-foreground"
            }
          />
        </div>
      </CardContent>
    </Card>
  );
}

export default function PortfolioIntelligence() {
  const organisationAccess = useOrganisationAccess();
  const activeOrganisation = organisationAccess?.activeOrganisation;
  const hasDirectMembership = Boolean(
    activeOrganisation?.accessSource === "membership" &&
    activeOrganisation.membershipOrganisationId === activeOrganisation.id,
  );
  const canReadProjects = useOrganisationPermission("project:read");
  const canReadDrafts = useOrganisationPermission("draft:read");
  const canReadDefects = useOrganisationPermission("defect:read");
  const canReadPackages = useOrganisationPermission("package:read");
  const canReadAnalytics = useOrganisationPermission("analytics:read");
  const canRead =
    canReadProjects &&
    canReadDrafts &&
    canReadDefects &&
    canReadPackages &&
    canReadAnalytics;
  const meQuery = useGetMe();
  const actorName = meQuery.data?.name?.trim() ?? "";
  const hasNamedActor = Boolean(
    meQuery.data?.id && actorName.length >= 2 && actorName.length <= 200,
  );
  const canRequestPortfolio = canRead && hasDirectMembership && hasNamedActor;
  const portfolioQuery = useGetPortfolioIntelligence({
    query: {
      enabled: canRequestPortfolio,
      queryKey: getGetPortfolioIntelligenceQueryKey(),
    },
  });
  const [search, setSearch] = useState("");
  const [healthFilter, setHealthFilter] = useState<FilterHealth>("all");
  const snapshot = portfolioQuery.data as
    | PortfolioIntelligenceSnapshot
    | undefined;
  const projects = snapshot?.projects ?? [];
  const healthCounts = useMemo(
    () =>
      projects.reduce(
        (counts, project) => {
          counts[projectHealth(project)] += 1;
          return counts;
        },
        { ready: 0, blocked: 0, stale: 0, in_progress: 0 } satisfies Record<
          PortfolioHealth,
          number
        >,
      ),
    [projects],
  );
  const visibleProjects = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return projects.filter((project) => {
      const matchesHealth =
        healthFilter === "all" || projectHealth(project) === healthFilter;
      const matchesSearch =
        needle.length === 0 ||
        project.title.toLowerCase().includes(needle) ||
        project.status.toLowerCase().includes(needle) ||
        (project.nextAction ?? "").toLowerCase().includes(needle);
      return matchesHealth && matchesSearch;
    });
  }, [healthFilter, projects, search]);

  if (organisationAccess?.isLoading || meQuery.isLoading || meQuery.isPending) {
    return (
      <div className="p-5 sm:p-8">
        <LoadingPanel label="Checking portfolio intelligence access" />
      </div>
    );
  }

  if (!canRead || !hasDirectMembership) {
    return (
      <div className="p-5 sm:p-8">
        <StatusPanel
          state="blocked"
          title="Portfolio intelligence access required"
          description="You need a direct membership in the selected organisation with every required project, draft, defect, package and analytics read grant. Partner access and narrower grants do not request or reveal portfolio records."
        />
      </div>
    );
  }

  if (!hasNamedActor) {
    return (
      <div className="p-5 sm:p-8">
        <StatusPanel
          state="blocked"
          title="Named profile required"
          description="Portfolio intelligence requires your signed-in profile to have a name between 2 and 200 characters. No portfolio records were requested or shown."
        />
      </div>
    );
  }

  if (portfolioQuery.isLoading || portfolioQuery.isPending) {
    return (
      <div className="p-5 sm:p-8">
        <LoadingPanel label="Loading portfolio intelligence" />
      </div>
    );
  }

  if (portfolioQuery.isError) {
    return (
      <div className="p-5 sm:p-8">
        <DataErrorPanel
          title="Portfolio intelligence could not be loaded"
          description="Valo could not verify the current organisation portfolio. No missing, blocked or ready state has been inferred from the failed request."
          onRetry={() => void portfolioQuery.refetch()}
        />
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className="p-5 sm:p-8">
        <StatusPanel
          state="unavailable"
          title="Portfolio intelligence is unavailable"
          description="The organisation summary returned no verifiable snapshot. Refresh before using it to plan delivery work."
        />
      </div>
    );
  }

  const pageState: SurfaceState =
    projects.length === 0
      ? "empty"
      : healthCounts.stale > 0
        ? "expired"
        : healthCounts.blocked > 0
          ? "blocked"
          : healthCounts.ready === projects.length
            ? "active"
            : "pending";

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-6 p-5 sm:p-8">
      <PageHeader
        eyebrow="Organisation delivery oversight"
        title="Portfolio intelligence"
        description="See the governed delivery position for every visible pursuit, then open the project record for the source detail and next human action."
        state={pageState}
        actions={
          <Button
            type="button"
            variant="outline"
            onClick={() => void portfolioQuery.refetch()}
            disabled={portfolioQuery.isFetching}
          >
            <RefreshCw
              aria-hidden="true"
              className={`mr-2 size-4 ${portfolioQuery.isFetching ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Visible pursuits"
          value={projects.length}
          state="partial"
          icon={BarChart3}
        />
        <MetricCard
          label="Ready"
          value={healthCounts.ready}
          state="active"
          icon={CheckCircle2}
        />
        <MetricCard
          label="Blocked"
          value={healthCounts.blocked}
          state="blocked"
          icon={AlertTriangle}
        />
        <MetricCard
          label="Stale"
          value={healthCounts.stale}
          state="expired"
          icon={RefreshCw}
        />
      </div>

      <section
        aria-labelledby="portfolio-coverage-heading"
        className="space-y-3"
      >
        <div>
          <h2 id="portfolio-coverage-heading" className="text-lg font-semibold">
            Governed portfolio coverage
          </h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Server-counted workflow and reviewed-outcome facts for the selected
            organisation. These counts are not award predictions or cross-tenant
            benchmarks.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <MetricCard
            label="Response ready"
            value={snapshot.totals.responseReadyCount}
            state="active"
            icon={FileCheck2}
          />
          <MetricCard
            label="Red-team approved"
            value={snapshot.totals.redTeamApprovedCount}
            state="active"
            icon={ShieldCheck}
          />
          <MetricCard
            label="Package ready"
            value={snapshot.totals.packageReadyCount}
            state="active"
            icon={PackageCheck}
          />
          <MetricCard
            label="Rehearsal ready"
            value={snapshot.totals.rehearsalReadyCount}
            state="active"
            icon={ClipboardCheck}
          />
          <MetricCard
            label="Confirmed outcomes"
            value={snapshot.totals.confirmedOutcomeCount}
            state="partial"
            icon={CheckCircle2}
          />
        </div>
      </section>

      <Card className="shadow-none">
        <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-end sm:justify-between">
          <label
            className="grid flex-1 gap-1.5 text-xs font-medium"
            htmlFor="portfolio-search"
          >
            Search pursuits
            <Input
              id="portfolio-search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.currentTarget.value)}
              placeholder="Title, project status or next action"
            />
          </label>
          <label
            className="grid gap-1.5 text-xs font-medium"
            htmlFor="portfolio-health"
          >
            Delivery state
            <Select
              value={healthFilter}
              onValueChange={(value) => setHealthFilter(value as FilterHealth)}
            >
              <SelectTrigger id="portfolio-health" className="w-full sm:w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All states</SelectItem>
                <SelectItem value="ready">Ready</SelectItem>
                <SelectItem value="blocked">Blocked</SelectItem>
                <SelectItem value="stale">Stale</SelectItem>
                <SelectItem value="in_progress">In progress</SelectItem>
              </SelectContent>
            </Select>
          </label>
        </CardContent>
      </Card>

      {projects.length === 0 ? (
        <StatusPanel
          state="empty"
          title="No pursuits are available for portfolio intelligence"
          description="No visible pursuit delivery snapshots were returned for the selected organisation. This is an empty portfolio, not a readiness verdict."
        />
      ) : visibleProjects.length === 0 ? (
        <StatusPanel
          state="empty"
          title="No pursuits match these filters"
          description="Clear the search or choose another delivery state. The underlying portfolio snapshot has not changed."
        >
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setSearch("");
              setHealthFilter("all");
            }}
          >
            Clear filters
          </Button>
        </StatusPanel>
      ) : (
        <section aria-labelledby="portfolio-projects-heading">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2
                id="portfolio-projects-heading"
                className="text-lg font-semibold"
              >
                Pursuit delivery positions
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Showing {visibleProjects.length} of {projects.length} pursuits
              </p>
            </div>
            <Badge variant="outline" className="font-mono text-xs">
              Snapshot{" "}
              {formatWatInstant(snapshot.generatedAt, { suffix: " WAT" })}
            </Badge>
          </div>
          <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
            {visibleProjects.map((project) => {
              const health = projectHealth(project);
              return (
                <Card key={project.id} className="shadow-none">
                  <CardHeader className="border-b border-border pb-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <CardTitle className="truncate text-base">
                          {project.title}
                        </CardTitle>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <Badge variant="outline">
                            {humaniseTokenCapitalised(project.status)}
                          </Badge>
                          <span className="inline-flex items-center gap-1">
                            <CalendarClock
                              aria-hidden="true"
                              className="size-3.5"
                            />
                            {formatWatInstant(project.deadline, {
                              empty: "No deadline recorded",
                              suffix: project.deadline ? " WAT" : "",
                            })}
                          </span>
                        </div>
                      </div>
                      <StateBadge
                        state={healthState(health)}
                        label={healthLabel(health)}
                        className="shrink-0"
                      />
                    </div>
                  </CardHeader>
                  <CardContent className="p-5">
                    <div className="divide-y divide-border">
                      <StageStatus
                        label="Response Studio"
                        value={project.responseStatus}
                      />
                      <StageStatus
                        label="Red-team review"
                        value={project.redTeamStatus}
                      />
                      <StageStatus
                        label="Package assembly"
                        value={project.packageStatus}
                      />
                      <StageStatus
                        label="Submission rehearsal"
                        value={project.rehearsalStatus}
                      />
                    </div>
                    <div className="mt-4 rounded-lg border border-border bg-muted/30 p-3">
                      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Next human action
                      </p>
                      <p className="mt-1 text-sm leading-6">
                        {project.nextAction?.trim() ||
                          (health === "ready"
                            ? "Keep the frozen package under named-human control until delivery."
                            : "Open the project delivery record to review current blockers.")}
                      </p>
                    </div>
                    <Button asChild variant="outline" className="mt-4 w-full">
                      <Link href={`/projects/${project.id}?tab=delivery`}>
                        Open delivery studio
                        <ArrowRight
                          aria-hidden="true"
                          className="ml-2 size-4"
                        />
                      </Link>
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      )}

      <Card className="border-sky-200 bg-sky-50/60 shadow-none">
        <CardContent className="flex gap-3 p-5 text-sm text-sky-950">
          <ShieldCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
          <div>
            <h2 className="font-semibold">
              Decision authority stays with named people
            </h2>
            <p className="mt-1 leading-6">
              {snapshot.authorityNote ||
                "This portfolio is operational evidence, not a bid-success forecast or release approval."}
            </p>
            <p className="mt-1 leading-6">
              Valo does not sign in to, upload to or submit through an external
              procurement portal.
            </p>
          </div>
        </CardContent>
      </Card>

      {snapshot.limitations && snapshot.limitations.length > 0 ? (
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CircleDotDashed aria-hidden="true" className="size-4" />
              Snapshot limitations
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-disc space-y-2 pl-5 text-sm leading-6 text-muted-foreground">
              {snapshot.limitations.map((limitation) => (
                <li key={limitation}>{limitation}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
