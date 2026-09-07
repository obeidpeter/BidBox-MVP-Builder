import { useMemo, useState } from "react";
import type { ProjectSummary } from "@workspace/api-client-react";
import { ArrowRight, Clock3 } from "lucide-react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LoadingPanel, StateBadge, StatusPanel } from "./platform-states";
import { formatWatInstant } from "@/lib/format";
import {
  buildPursuitControlTower,
  PURSUIT_STAGES,
  type PursuitControlTowerSignals,
  type PursuitStageId,
} from "@/lib/pursuit-control-tower";

const VISIBLE_ITEM_LIMIT = 8;

type TowerView = "priority" | PursuitStageId;

export interface PursuitControlTowerProps {
  projects: readonly ProjectSummary[];
  projectState: "loading" | "unavailable" | "ready";
  signals: PursuitControlTowerSignals;
  signalState: "loading" | "unavailable" | "ready";
  roleLabel: string;
  now?: number;
}

function deadlineLabel(timestamp: number | null): string {
  if (timestamp === null) return "No submission deadline recorded";
  return `Deadline ${formatWatInstant(new Date(timestamp), { suffix: " WAT" })}`;
}

export function PursuitControlTower({
  projects,
  projectState,
  signals,
  signalState,
  roleLabel,
  now = Date.now(),
}: PursuitControlTowerProps) {
  const [view, setView] = useState<TowerView>("priority");
  const items = useMemo(
    () => buildPursuitControlTower(projects, signals, now),
    [now, projects, signals],
  );
  const counts = useMemo(
    () =>
      new Map(
        PURSUIT_STAGES.map((stage) => [
          stage.id,
          items.filter((item) => item.stage.id === stage.id).length,
        ]),
      ),
    [items],
  );
  const selectedItems =
    view === "priority"
      ? items
      : items.filter((item) => item.stage.id === view);
  const visibleItems = selectedItems.slice(0, VISIBLE_ITEM_LIMIT);
  const activeStage =
    view === "priority"
      ? null
      : PURSUIT_STAGES.find((stage) => stage.id === view);

  return (
    <section
      aria-labelledby="pursuit-control-tower-heading"
      className="space-y-4"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.13em] text-muted-foreground">
            Queue for {roleLabel}
          </p>
          <h2
            id="pursuit-control-tower-heading"
            className="mt-1 text-xl font-semibold tracking-tight"
          >
            Pursuit Control Tower
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
            Start with the highest-priority pursuit, or choose a stage. Ordering
            uses recorded deadlines and issues only; it is not a release or
            submission decision.
          </p>
        </div>
        <Link
          href="/projects"
          className="inline-flex items-center gap-2 rounded-sm text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          View pursuit register
          <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
      </div>

      {projectState === "loading" ? (
        <LoadingPanel label="Loading your pursuit queue" />
      ) : projectState === "unavailable" ? (
        <StatusPanel
          state="error"
          title="Pursuit queue could not be loaded"
          description="No stage, priority, deadline or next action is shown until the authorised pursuit register loads."
        />
      ) : items.length === 0 ? (
        <StatusPanel
          state="empty"
          title="No current pursuits returned"
          description="The authorised register contains no non-archived pursuits. This is an empty queue, not a readiness decision."
        />
      ) : (
        <>
          {signalState !== "ready" ? (
            <StatusPanel
              state="partial"
              title={
                signalState === "loading"
                  ? "Workflow signals are still loading"
                  : "Some workflow signals are unavailable"
              }
              description={
                signalState === "loading"
                  ? "Pursuit stages and recorded project issues are shown, but review-deadline and independent-review ordering may still change."
                  : "Pursuit stages and recorded project issues are shown, but missed review deadlines and independent reviews could not be checked. Their absence below does not mean they are clear."
              }
            />
          ) : null}

          <div
            className="flex gap-2 overflow-x-auto pb-2"
            role="group"
            aria-label="Filter pursuit queue by stage"
          >
            <Button
              type="button"
              variant={view === "priority" ? "default" : "outline"}
              className="min-h-11 shrink-0"
              aria-label={`Priority: ${items.length} pursuit${items.length === 1 ? "" : "s"}`}
              aria-pressed={view === "priority"}
              onClick={() => setView("priority")}
            >
              Priority
              <span className="ml-1 rounded-full bg-background/20 px-1.5 text-xs">
                {items.length}
              </span>
            </Button>
            {PURSUIT_STAGES.map((stage) => (
              <Button
                key={stage.id}
                type="button"
                variant={view === stage.id ? "default" : "outline"}
                className="min-h-11 shrink-0"
                aria-label={`${stage.shortLabel}: ${counts.get(stage.id) ?? 0} pursuit${counts.get(stage.id) === 1 ? "" : "s"}`}
                aria-pressed={view === stage.id}
                onClick={() => setView(stage.id)}
              >
                {stage.shortLabel}
                <span className="ml-1 rounded-full bg-background/20 px-1.5 text-xs">
                  {counts.get(stage.id) ?? 0}
                </span>
              </Button>
            ))}
          </div>

          {activeStage ? (
            <p className="text-sm text-muted-foreground" aria-live="polite">
              <span className="font-medium text-foreground">
                {activeStage.label}:
              </span>{" "}
              {activeStage.description}
            </p>
          ) : null}

          {selectedItems.length === 0 ? (
            <StatusPanel
              state="empty"
              title={`No pursuits at ${activeStage?.label.toLowerCase() ?? "this stage"}`}
              description="Choose another stage or open the full register. A zero here describes the authorised register only; it is not a readiness decision."
            />
          ) : (
            <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
              {visibleItems.map((item) => {
                const stageNumber =
                  PURSUIT_STAGES.findIndex(
                    (stage) => stage.id === item.stage.id,
                  ) + 1;
                const workflowSignalsUnverified = signalState !== "ready";
                const displayState =
                  workflowSignalsUnverified && item.state === "active"
                    ? "partial"
                    : item.state;
                const displayStateLabel =
                  workflowSignalsUnverified && item.state === "active"
                    ? "Workflow signals not verified"
                    : item.stateLabel;
                return (
                  <Link
                    key={item.project.id}
                    href={item.href}
                    aria-label={`Open next action for ${item.project.tenderTitle}`}
                    className="grid min-h-28 gap-4 px-4 py-4 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:grid-cols-[minmax(0,1fr)_auto] sm:px-5"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">
                          Stage {stageNumber} of {PURSUIT_STAGES.length} ·{" "}
                          {item.stage.shortLabel}
                        </Badge>
                        <StateBadge
                          state={displayState}
                          label={displayStateLabel}
                        />
                      </div>
                      <h3 className="mt-3 font-semibold text-foreground">
                        {item.project.tenderTitle}
                      </h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {item.project.clientName ?? "Client name unavailable"}
                        {item.project.reviewerName
                          ? ` · Reviewer: ${item.project.reviewerName}`
                          : " · Reviewer not recorded"}
                      </p>
                      <p className="mt-2 text-sm font-medium">
                        Next recorded action: {item.nextAction}
                      </p>
                      {item.signals.length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {item.signals.map((signal) => (
                            <StateBadge
                              key={signal.label}
                              state={signal.state}
                              label={signal.label}
                            />
                          ))}
                        </div>
                      ) : (
                        <p className="mt-2 text-xs text-muted-foreground">
                          {workflowSignalsUnverified
                            ? "No issue is present in the loaded project summary, but workflow alerts could not be verified. Open the pursuit for its authoritative readiness checks."
                            : "No issue is present in the loaded summary. Open the pursuit for its authoritative readiness checks."}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-3 sm:flex-col sm:items-end sm:justify-center">
                      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Clock3 aria-hidden="true" className="size-3.5" />
                        {deadlineLabel(item.deadlineTimestamp)}
                      </span>
                      <span className="inline-flex items-center gap-1 text-sm font-medium text-primary">
                        Open stage
                        <ArrowRight aria-hidden="true" className="size-4" />
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}

          {selectedItems.length > VISIBLE_ITEM_LIMIT ? (
            <p className="text-xs text-muted-foreground">
              Showing the first {VISIBLE_ITEM_LIMIT} of {selectedItems.length}{" "}
              pursuits in this view. Open the pursuit register to see the rest.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
