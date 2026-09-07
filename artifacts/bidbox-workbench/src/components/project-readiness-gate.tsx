import {
  type Project,
  useGetProjectScorecard,
  useGetRisk,
  useListBoqChecks,
  useListDefects,
  useListDocuments,
  useListEvidence,
  useListReports,
  useListRequirements,
} from "@workspace/api-client-react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Circle,
  FileCheck2,
  Loader2,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  computeReadinessChecks,
  summarizeReadiness,
  type GateStatus,
  type ProjectTab as ReadinessProjectTab,
  type ReadinessAssessment,
} from "@/lib/readiness";

export type ProjectTab = ReadinessProjectTab | "delivery";

function statusMeta(status: GateStatus) {
  switch (status) {
    case "pass":
      return {
        icon: CheckCircle2,
        label: "Ready",
        badgeClass: "border-emerald-200 bg-emerald-50 text-emerald-700",
        iconClass: "text-emerald-600",
      };
    case "warning":
      return {
        icon: AlertTriangle,
        label: "Needs review",
        badgeClass: "border-amber-300 bg-amber-50 text-amber-800",
        iconClass: "text-amber-600",
      };
    case "blocked":
      return {
        icon: XCircle,
        label: "Blocked",
        badgeClass: "border-destructive/30 bg-destructive/10 text-destructive",
        iconClass: "text-destructive",
      };
  }
}

export function ProjectReadinessGate({
  project,
  onGoToTab,
  onAssessmentChange,
}: {
  project: Project;
  onGoToTab: (tab: ProjectTab) => void;
  onAssessmentChange?: (assessment: ReadinessAssessment) => void;
}) {
  const projectId = project.id;
  const documentsQuery = useListDocuments(projectId);
  const requirementsQuery = useListRequirements(projectId);
  const scorecardQuery = useGetProjectScorecard(projectId);
  const evidenceQuery = useListEvidence(projectId);
  const defectsQuery = useListDefects(projectId);
  const boqQuery = useListBoqChecks(projectId);
  const riskQuery = useGetRisk(projectId);
  const reportsQuery = useListReports(projectId);

  const queries = [
    documentsQuery,
    requirementsQuery,
    scorecardQuery,
    evidenceQuery,
    defectsQuery,
    boqQuery,
    riskQuery,
    reportsQuery,
  ];
  // A failed register load must not masquerade as a "Blocked/Missing"
  // verdict — the gate refuses to rule on data it does not have.
  const isError = queries.some((q) => q.isError);
  const isLoading =
    !isError && queries.some((q) => q.isLoading || q.isPending || q.isFetching);

  const checks = computeReadinessChecks({
    project,
    documents: documentsQuery.data ?? [],
    requirements: requirementsQuery.data ?? [],
    evidence: evidenceQuery.data ?? [],
    defects: defectsQuery.data ?? [],
    boqChecks: boqQuery.data ?? [],
    mandatoryRecall: scorecardQuery.data?.totals?.mandatoryRecall ?? null,
    hasRisk: Boolean(riskQuery.data),
    computedRiskBand: riskQuery.data?.band ?? null,
    reports: reportsQuery.data ?? [],
  });
  const summary = summarizeReadiness(checks);

  useEffect(() => {
    if (!onAssessmentChange) return;
    if (isLoading) {
      onAssessmentChange({ status: "loading" });
      return;
    }
    if (isError) {
      onAssessmentChange({ status: "error" });
      return;
    }
    onAssessmentChange({ status: "ready", summary });
  }, [
    isError,
    isLoading,
    onAssessmentChange,
    summary.blockedRequired,
    summary.nextCheck?.action,
    summary.nextCheck?.detail,
    summary.nextCheck?.id,
    summary.nextCheck?.label,
    summary.nextCheck?.tab,
    summary.passedRequired,
    summary.progress,
    summary.ready,
    summary.requiredTotal,
    summary.warningCount,
  ]);

  return (
    <section className="bg-card border border-border rounded-xl shadow-xs overflow-hidden">
      <div className="p-6 border-b border-border">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <ShieldCheck
                className="w-5 h-5 text-primary"
                aria-hidden="true"
              />
              <h3 className="font-serif text-xl font-medium">
                Pursuit readiness
              </h3>
              {!isLoading && !isError && (
                <Badge
                  variant="outline"
                  className={
                    summary.ready
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-destructive/30 bg-destructive/10 text-destructive"
                  }
                >
                  {summary.ready
                    ? "Core registers ready"
                    : `${summary.blockedRequired} blocker${summary.blockedRequired === 1 ? "" : "s"}`}
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground max-w-3xl">
              Check the core status, intake, evidence, defects, BOQ, risk and
              report records. Delivery Studio response and independent red-team
              gates must also pass before sign-off.
            </p>
          </div>
          {!isLoading && !isError && (
            <div className="min-w-[240px] space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">
                  {summary.progress}% complete
                </span>
                <span className="text-muted-foreground">
                  {summary.passedRequired}/{summary.requiredTotal} required
                </span>
              </div>
              <Progress value={summary.progress} />
              {summary.warningCount > 0 && (
                <p className="text-xs text-muted-foreground">
                  {summary.warningCount} advisory item
                  {summary.warningCount === 1 ? "" : "s"} should be reviewed
                  before delivery.
                </p>
              )}
            </div>
          )}
        </div>
        {!isLoading && !isError && summary.nextCheck && (
          <div className="mt-4 flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <FileCheck2
                className="mt-0.5 w-4 h-4 text-muted-foreground"
                aria-hidden="true"
              />
              <div>
                <p className="text-sm font-medium">
                  Next action: {summary.nextCheck.label}
                </p>
                <p className="text-xs text-muted-foreground">
                  {summary.nextCheck.detail}
                </p>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onGoToTab(summary.nextCheck!.tab)}
            >
              {summary.nextCheck.action}
              <ArrowRight className="w-4 h-4 ml-2" aria-hidden="true" />
            </Button>
          </div>
        )}
      </div>

      {isLoading ? (
        <div
          className="p-8 flex items-center justify-center text-sm text-muted-foreground"
          role="status"
          aria-live="polite"
          aria-label="Checking readiness"
        >
          <Loader2 className="w-5 h-5 mr-2 animate-spin" aria-hidden="true" />
          Checking readiness
        </div>
      ) : isError ? (
        <div
          className="p-8 flex items-center justify-center gap-2 text-sm text-destructive"
          role="alert"
        >
          <XCircle className="w-5 h-5" aria-hidden="true" />
          Some pursuit records could not be loaded, so readiness cannot be
          assessed. Retry when the connection recovers.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
          {checks.map((check) => {
            const meta = statusMeta(check.status);
            const Icon = meta.icon;
            return (
              <div
                key={check.id}
                className="border-b border-r border-border p-4 min-h-[154px]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Icon
                      className={`w-4 h-4 ${meta.iconClass}`}
                      aria-hidden="true"
                    />
                    <h4 className="text-sm font-semibold">{check.label}</h4>
                  </div>
                  <Badge
                    variant="outline"
                    className={`text-xs ${meta.badgeClass}`}
                  >
                    {meta.label}
                  </Badge>
                </div>
                <p className="mt-3 text-sm text-muted-foreground leading-5">
                  {check.detail}
                </p>
                <Button
                  size="sm"
                  variant="ghost"
                  className="mt-3 h-8 px-0 text-primary hover:bg-transparent"
                  onClick={() => onGoToTab(check.tab)}
                >
                  {check.action}
                  <ArrowRight
                    className="w-3.5 h-3.5 ml-1.5"
                    aria-hidden="true"
                  />
                </Button>
              </div>
            );
          })}
        </div>
      )}

      {!isLoading && !isError && summary.ready && (
        <div className="flex items-center gap-2 border-t border-border bg-emerald-50 px-6 py-3 text-sm text-emerald-800">
          <Circle
            className="w-3 h-3 fill-emerald-600 text-emerald-600"
            aria-hidden="true"
          />
          Required checks are clear. Advisory warnings should still be reviewed
          before external delivery.
        </div>
      )}
    </section>
  );
}
