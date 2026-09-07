import { useId, useMemo, useState } from "react";
import { ArrowUpRight, ListChecks, UserRound } from "lucide-react";
import {
  StateBadge,
  StatusPanel,
  type SurfaceState,
} from "@/components/platform-states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type {
  OperationsSectionState,
  PursuitWorkItem,
  WorkItemStatus,
} from "./operations-suite-contract";
import {
  formatOperationsDate,
  HumanAuthorityNotice,
  OperationsSection,
  RecordsBoundary,
  RecordFacts,
  safeCount,
  safeInternalHref,
} from "./operations-suite-primitives";

const STATUS: Record<WorkItemStatus, { label: string; state: SurfaceState }> = {
  backlog: { label: "Backlog", state: "unavailable" },
  ready: { label: "Ready", state: "pending" },
  in_progress: { label: "In progress", state: "partial" },
  blocked: { label: "Blocked", state: "blocked" },
  in_review: { label: "In review", state: "pending" },
  done: { label: "Completed", state: "active" },
  cancelled: { label: "Cancelled", state: "unavailable" },
};

const STATUS_ORDER = Object.keys(STATUS) as WorkItemStatus[];

const STATUS_TRANSITIONS: Readonly<
  Record<WorkItemStatus, readonly WorkItemStatus[]>
> = {
  backlog: ["ready"],
  ready: ["in_progress", "blocked"],
  in_progress: ["blocked", "in_review", "done"],
  blocked: ["ready", "in_progress"],
  in_review: ["in_progress", "blocked", "done"],
  done: [],
  cancelled: [],
};

export interface PursuitOperationsBoardProps extends OperationsSectionState {
  items: readonly PursuitWorkItem[];
  onChangeStatus?: (workItemId: string, status: WorkItemStatus) => void;
}

export function PursuitOperationsBoard({
  items,
  state = "ready",
  error,
  readOnly = false,
  onRetry,
  onChangeStatus,
}: PursuitOperationsBoardProps) {
  const instanceId = useId();
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const visibleItems = useMemo(
    () =>
      scope === "mine"
        ? items.filter((item) => item.assignedToCurrentUser)
        : items,
    [items, scope],
  );
  const boundary = RecordsBoundary({
    state,
    error,
    count: items.length,
    loadingLabel: "Loading pursuit work for this organisation",
    errorTitle: "Pursuit work could not be loaded",
    emptyTitle: "No pursuit work is recorded",
    emptyDescription:
      "No work items were supplied. This does not establish that every requirement, dependency or approval is complete.",
    onRetry,
  });

  return (
    <OperationsSection
      id="pursuit-board"
      title="My Work and pursuit tasks"
      description="Coordinate owners, due dates and requirement or evidence links. Planned work is not shown as complete."
      icon={<ListChecks aria-hidden="true" className="size-5" />}
      busy={state === "loading"}
    >
      <HumanAuthorityNotice title="Recorded coordination">
        Moving a card records an operator decision; it does not complete a
        requirement, approve evidence or notify an external party. Cancellation
        is recorded separately with an explicit human reason.
      </HumanAuthorityNotice>

      {boundary ?? (
        <>
          <div
            className="flex flex-wrap gap-2"
            role="group"
            aria-label="Choose pursuit work scope"
          >
            <Button
              type="button"
              variant={scope === "mine" ? "secondary" : "outline"}
              className="min-h-11 flex-1 sm:flex-none"
              data-control-size="44"
              aria-pressed={scope === "mine"}
              onClick={() => setScope("mine")}
            >
              <UserRound aria-hidden="true" />
              My Work
            </Button>
            <Button
              type="button"
              variant={scope === "all" ? "secondary" : "outline"}
              className="min-h-11 flex-1 sm:flex-none"
              data-control-size="44"
              aria-pressed={scope === "all"}
              onClick={() => setScope("all")}
            >
              All pursuit work
            </Button>
          </div>

          <p
            className="text-sm text-muted-foreground"
            role="status"
            aria-live="polite"
          >
            Showing {visibleItems.length.toLocaleString("en-NG")} of{" "}
            {items.length.toLocaleString("en-NG")} work items
          </p>

          {visibleItems.length === 0 ? (
            <StatusPanel
              state="empty"
              title="No work is assigned to you"
              description="The broader pursuit board may still contain unassigned or colleague-owned work."
            />
          ) : (
            <ul
              className="grid list-none gap-4 p-0 lg:grid-cols-2"
              aria-label="Pursuit work items"
            >
              {visibleItems.map((item) => {
                const itemStatus = STATUS[item.status];
                const href = safeInternalHref(item.href);
                const selectId = `${instanceId}-${item.id}-status`;
                return (
                  <li key={item.id}>
                    <Card className="h-full shadow-none">
                      <article
                        aria-labelledby={`${instanceId}-${item.id}-title`}
                      >
                        <CardHeader className="space-y-3 pb-4">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <StateBadge
                              state={itemStatus.state}
                              label={itemStatus.label}
                            />
                            <span className="text-xs text-muted-foreground">
                              {item.pursuitName}
                            </span>
                          </div>
                          <h3
                            id={`${instanceId}-${item.id}-title`}
                            className="text-base font-semibold"
                          >
                            {item.title}
                          </h3>
                        </CardHeader>
                        <CardContent className="space-y-4 pt-0">
                          <RecordFacts
                            facts={[
                              {
                                label: "Owner",
                                value: item.ownerName ?? "Unassigned",
                              },
                              {
                                label: "Due",
                                value: formatOperationsDate(item.dueAt),
                              },
                              {
                                label: "Dependencies",
                                value: safeCount(
                                  item.dependencyCount,
                                ).toLocaleString("en-NG"),
                              },
                              {
                                label: "Requirements linked",
                                value: safeCount(
                                  item.linkedRequirementCount,
                                ).toLocaleString("en-NG"),
                              },
                              {
                                label: "Evidence linked",
                                value: safeCount(
                                  item.evidenceCount,
                                ).toLocaleString("en-NG"),
                              },
                              ...(item.statusReason
                                ? [
                                    {
                                      label: "Applicable status reason",
                                      value: item.statusReason,
                                    },
                                  ]
                                : []),
                            ]}
                          />
                          <div className="grid gap-3 border-t border-border pt-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                            <div>
                              <label
                                htmlFor={selectId}
                                className="text-xs font-medium text-muted-foreground"
                              >
                                Recorded work status
                              </label>
                              <select
                                id={selectId}
                                value={item.status}
                                disabled={
                                  readOnly ||
                                  !onChangeStatus ||
                                  STATUS_TRANSITIONS[item.status].length === 0
                                }
                                onChange={(event) =>
                                  onChangeStatus?.(
                                    item.id,
                                    event.target.value as WorkItemStatus,
                                  )
                                }
                                className="mt-1 min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                data-control-size="44"
                              >
                                {STATUS_ORDER.filter(
                                  (status) =>
                                    status === item.status ||
                                    STATUS_TRANSITIONS[item.status].includes(
                                      status,
                                    ),
                                ).map((status) => (
                                  <option key={status} value={status}>
                                    {STATUS[status].label}
                                  </option>
                                ))}
                              </select>
                            </div>
                            {href ? (
                              <Button
                                asChild
                                variant="outline"
                                className="min-h-11 w-full sm:w-auto"
                                data-control-size="44"
                              >
                                <a
                                  href={href}
                                  aria-label={`Open work item: ${item.title}`}
                                >
                                  <ArrowUpRight aria-hidden="true" />
                                  Open
                                </a>
                              </Button>
                            ) : null}
                          </div>
                        </CardContent>
                      </article>
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </OperationsSection>
  );
}

export default PursuitOperationsBoard;
