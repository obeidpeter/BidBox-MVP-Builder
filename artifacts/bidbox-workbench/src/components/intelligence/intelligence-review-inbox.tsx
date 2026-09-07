import { useId, useMemo, useState } from "react";
import {
  BookOpenCheck,
  CalendarClock,
  ExternalLink,
  Inbox,
  ShieldCheck,
  TriangleAlert,
  UserRoundCheck,
} from "lucide-react";
import {
  LoadingPanel,
  StateBadge,
  StatusPanel,
  type SurfaceState,
} from "@/components/platform-states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatWatInstant } from "@/lib/format";

export const INTELLIGENCE_REVIEW_STATUSES = [
  "pending",
  "in_review",
  "changes_requested",
  "approved",
  "rejected",
] as const;

export const INTELLIGENCE_REVIEW_PRIORITIES = [
  "critical",
  "high",
  "normal",
  "low",
] as const;

export type IntelligenceReviewStatus =
  (typeof INTELLIGENCE_REVIEW_STATUSES)[number];
export type IntelligenceReviewPriority =
  (typeof INTELLIGENCE_REVIEW_PRIORITIES)[number];
export type IntelligenceReviewDecision = Extract<
  IntelligenceReviewStatus,
  "changes_requested" | "approved" | "rejected"
>;
export type IntelligenceReviewEnvironment =
  | "production"
  | "staging"
  | "development";

export interface IntelligenceReviewInboxItem {
  id: string;
  capabilityId: string;
  title: string;
  summary: string;
  status: IntelligenceReviewStatus;
  priority: IntelligenceReviewPriority;
  reviewType: string;
  reviewerName: string | null;
  assignedToCurrentUser: boolean;
  dueAt: string | null;
  sourceCount: number;
  staleSource: boolean;
  href: string | null;
}

export interface IntelligenceReviewInboxProps {
  items: readonly IntelligenceReviewInboxItem[];
  environment: IntelligenceReviewEnvironment;
  productionAiEnabled: boolean;
  readOnly?: boolean;
  authorityNote?: string;
  showRuntimeBoundary?: boolean;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onClaim?: (itemId: string) => void;
  onDecision?: (itemId: string, decision: IntelligenceReviewDecision) => void;
}

type StatusFilter = IntelligenceReviewStatus | "all";
type PriorityFilter = IntelligenceReviewPriority | "all";

const STATUS_PRESENTATION: Record<
  IntelligenceReviewStatus,
  { label: string; state: SurfaceState }
> = {
  pending: { label: "Pending", state: "pending" },
  in_review: { label: "In review", state: "partial" },
  changes_requested: { label: "Changes requested", state: "blocked" },
  approved: { label: "Review accepted", state: "active" },
  rejected: { label: "Rejected", state: "error" },
};

const PRIORITY_PRESENTATION: Record<
  IntelligenceReviewPriority,
  { label: string; className: string }
> = {
  critical: {
    label: "Critical",
    className: "border-red-200 bg-red-50 text-red-800",
  },
  high: {
    label: "High",
    className: "border-amber-200 bg-amber-50 text-amber-900",
  },
  normal: {
    label: "Normal",
    className: "border-sky-200 bg-sky-50 text-sky-900",
  },
  low: {
    label: "Low",
    className: "border-border bg-muted text-muted-foreground",
  },
};

const STATUS_FILTERS: readonly StatusFilter[] = [
  "all",
  ...INTELLIGENCE_REVIEW_STATUSES,
];

function filterLabel(filter: StatusFilter): string {
  return filter === "all" ? "All" : STATUS_PRESENTATION[filter].label;
}

function formatEnvironment(environment: IntelligenceReviewEnvironment): string {
  return environment.charAt(0).toUpperCase() + environment.slice(1);
}

function formatSourceCount(value: number): string {
  const safeCount = Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  return `${safeCount.toLocaleString("en-NG")} ${safeCount === 1 ? "source" : "sources"}`;
}

function dueDatePresentation(value: string | null): {
  label: string;
  dateTime?: string;
  overdue: boolean;
} {
  if (!value) return { label: "No due date", overdue: false };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return { label: "Due date unavailable", overdue: false };
  }
  return {
    label: formatWatInstant(date),
    dateTime: date.toISOString(),
    overdue: date.getTime() < Date.now(),
  };
}

function RuntimeBoundary({
  environment,
  productionAiEnabled,
}: Pick<IntelligenceReviewInboxProps, "environment" | "productionAiEnabled">) {
  if (environment !== "production") {
    return (
      <StatusPanel
        state="unavailable"
        title={`${formatEnvironment(environment)} review data`}
        description="This test inbox does not report production AI as active. Every item still needs a decision from a named person."
      />
    );
  }

  if (!productionAiEnabled) {
    return (
      <StatusPanel
        state="partial"
        title="Production model execution is disabled"
        description="Recorded and rules-based review items may still appear. Their presence does not mean AI analysis ran."
      />
    );
  }

  return (
    <StatusPanel
      state="partial"
      title="Production runtime reported available"
      description="An available AI service does not prove that an item was AI-generated, correct or approved. A named reviewer makes the decision."
    />
  );
}

function ReviewItem({
  item,
  headingId,
  readOnly,
  onClaim,
  onDecision,
}: {
  item: IntelligenceReviewInboxItem;
  headingId: string;
  readOnly: boolean;
  onClaim?: IntelligenceReviewInboxProps["onClaim"];
  onDecision?: IntelligenceReviewInboxProps["onDecision"];
}) {
  const status = STATUS_PRESENTATION[item.status];
  const priority = PRIORITY_PRESENTATION[item.priority];
  const due = dueDatePresentation(item.dueAt);
  const isTerminal =
    item.status === "approved" ||
    item.status === "rejected" ||
    item.status === "changes_requested";
  const canDecide =
    item.reviewerName !== null &&
    item.assignedToCurrentUser &&
    item.status === "in_review" &&
    onDecision;
  const hasActions = Boolean(
    item.href || (item.reviewerName ? canDecide : onClaim),
  );

  return (
    <Card className="shadow-none">
      <article aria-labelledby={headingId}>
        <CardHeader className="space-y-3 pb-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              <StateBadge state={status.state} label={status.label} />
              <Badge
                variant="outline"
                className={priority.className}
                aria-label={`Priority: ${priority.label}`}
              >
                {priority.label} priority
              </Badge>
            </div>
            <span className="font-mono text-xs text-muted-foreground">
              {item.reviewType}
            </span>
          </div>
          <div>
            <h3 id={headingId} className="text-base font-semibold">
              {item.title}
            </h3>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {item.summary}
            </p>
          </div>
        </CardHeader>

        <CardContent className="space-y-4 pt-0">
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <div className="min-w-0">
              <dt className="flex items-start gap-2 text-xs text-muted-foreground">
                <UserRoundCheck
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                />
                <span>Reviewer</span>
              </dt>
              <dd className="ml-6 mt-0.5 min-w-0">
                <span className="block truncate font-medium">
                  {item.reviewerName ?? "Unassigned"}
                </span>
                {item.reviewerName === null ? (
                  <p className="mt-0.5 text-xs text-amber-800">
                    Named reviewer required
                  </p>
                ) : null}
                {item.reviewerName !== null &&
                !item.assignedToCurrentUser &&
                !isTerminal ? (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Assigned to another reviewer
                  </p>
                ) : null}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="flex items-start gap-2 text-xs text-muted-foreground">
                <CalendarClock
                  aria-hidden="true"
                  className={cn(
                    "mt-0.5 size-4 shrink-0 text-muted-foreground",
                    due.overdue && "text-red-700",
                  )}
                />
                <span>Due</span>
              </dt>
              <dd
                className={cn(
                  "ml-6 mt-0.5 font-medium",
                  due.overdue && "text-red-700",
                )}
              >
                {due.dateTime ? (
                  <time dateTime={due.dateTime}>{due.label}</time>
                ) : (
                  due.label
                )}
                {due.overdue ? " · Overdue" : ""}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="flex items-start gap-2 text-xs text-muted-foreground">
                {item.staleSource ? (
                  <TriangleAlert
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0 text-amber-700"
                  />
                ) : (
                  <BookOpenCheck
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                  />
                )}
                <span>Evidence</span>
              </dt>
              <dd className="ml-6 mt-0.5 min-w-0">
                <span className="block font-medium">
                  {formatSourceCount(item.sourceCount)}
                </span>
                <p
                  className={cn(
                    "mt-0.5 text-xs text-muted-foreground",
                    item.staleSource && "text-amber-800",
                  )}
                >
                  {item.staleSource
                    ? "At least one source is stale"
                    : item.sourceCount > 0
                      ? "No source is flagged stale"
                      : "No source is attached"}
                </p>
              </dd>
            </div>
          </dl>

          {hasActions ? (
            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
              {item.href ? (
                <Button
                  asChild
                  variant="outline"
                  className="min-h-11"
                  data-control-size="44"
                >
                  <a href={item.href} aria-label={`Open review: ${item.title}`}>
                    <ExternalLink aria-hidden="true" />
                    Open review
                  </a>
                </Button>
              ) : null}

              {item.reviewerName === null && onClaim ? (
                <Button
                  type="button"
                  className="min-h-11"
                  data-control-size="44"
                  disabled={readOnly}
                  onClick={() => onClaim(item.id)}
                >
                  <UserRoundCheck aria-hidden="true" />
                  Claim review
                </Button>
              ) : null}

              {canDecide ? (
                <div
                  className="flex flex-wrap gap-2"
                  role="group"
                  aria-label={`Review decisions for ${item.title}`}
                >
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11"
                    data-control-size="44"
                    disabled={readOnly}
                    onClick={() => onDecision(item.id, "changes_requested")}
                  >
                    Request changes
                  </Button>
                  <Button
                    type="button"
                    className="min-h-11"
                    data-control-size="44"
                    disabled={readOnly}
                    onClick={() => onDecision(item.id, "approved")}
                  >
                    Accept review
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11 text-destructive"
                    data-control-size="44"
                    disabled={readOnly}
                    onClick={() => onDecision(item.id, "rejected")}
                  >
                    Reject
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </article>
    </Card>
  );
}

export function IntelligenceReviewInbox({
  items,
  environment,
  productionAiEnabled,
  readOnly = false,
  authorityNote,
  showRuntimeBoundary = true,
  loading = false,
  error = null,
  onRetry,
  onClaim,
  onDecision,
}: IntelligenceReviewInboxProps) {
  const instanceId = useId();
  const headingId = `${instanceId}-review-inbox-heading`;
  const priorityFilterId = `${instanceId}-priority-filter`;
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>("all");

  const statusCounts = useMemo(() => {
    const counts: Record<IntelligenceReviewStatus, number> = {
      pending: 0,
      in_review: 0,
      changes_requested: 0,
      approved: 0,
      rejected: 0,
    };
    for (const item of items) counts[item.status] += 1;
    return counts;
  }, [items]);

  const visibleItems = useMemo(
    () =>
      items.filter(
        (item) =>
          (statusFilter === "all" || item.status === statusFilter) &&
          (priorityFilter === "all" || item.priority === priorityFilter),
      ),
    [items, priorityFilter, statusFilter],
  );

  return (
    <section
      aria-labelledby={headingId}
      aria-busy={loading || undefined}
      className="space-y-5"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Inbox aria-hidden="true" className="size-5 text-primary" />
            <h2 id={headingId} className="font-serif text-xl font-semibold">
              Review inbox
            </h2>
          </div>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
            Prioritised evidence findings and reversible proposals. A named,
            authorised person owns every decision.
          </p>
        </div>
        <Badge variant="outline" className="w-fit gap-1.5">
          <ShieldCheck aria-hidden="true" className="size-3" />
          {formatEnvironment(environment)}
        </Badge>
      </div>

      {showRuntimeBoundary ? (
        <RuntimeBoundary
          environment={environment}
          productionAiEnabled={productionAiEnabled}
        />
      ) : null}

      {readOnly ? (
        <StatusPanel
          state="unavailable"
          title="Read-only review inbox"
          description="Assignments and decisions cannot be changed in this view. Source navigation remains available."
        />
      ) : null}

      {error ? (
        <StatusPanel
          state="error"
          title="Review items could not be loaded"
          description={`${error} Do not infer that the inbox is empty, complete or approved from this failure.`}
        >
          {onRetry ? (
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              data-control-size="44"
              onClick={onRetry}
            >
              Try again
            </Button>
          ) : null}
        </StatusPanel>
      ) : loading ? (
        <LoadingPanel label="Loading review items for this organisation" />
      ) : items.length === 0 ? (
        <StatusPanel
          state="empty"
          title="No review items are available"
          description="No records were supplied for this organisation. This is not an approval, readiness result or confirmation that no risks exist."
        />
      ) : (
        <>
          <div className="space-y-3 rounded-lg border border-border bg-card p-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Filter by status
              </p>
              <div
                className="mt-2 flex flex-wrap gap-2"
                role="group"
                aria-label="Filter review items by status"
              >
                {STATUS_FILTERS.map((filter) => {
                  const count =
                    filter === "all" ? items.length : statusCounts[filter];
                  const label = filterLabel(filter);
                  return (
                    <Button
                      key={filter}
                      type="button"
                      variant={
                        statusFilter === filter ? "secondary" : "outline"
                      }
                      className="min-h-11"
                      data-control-size="44"
                      aria-pressed={statusFilter === filter}
                      aria-label={`${label}: ${count} review ${count === 1 ? "item" : "items"}`}
                      onClick={() => setStatusFilter(filter)}
                    >
                      {label}
                      <span
                        aria-hidden="true"
                        className="rounded-full bg-muted px-2 py-0.5 font-mono text-xs"
                      >
                        {count}
                      </span>
                    </Button>
                  );
                })}
              </div>
            </div>

            <div className="max-w-xs">
              <label
                htmlFor={priorityFilterId}
                className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                Filter by priority
              </label>
              <select
                id={priorityFilterId}
                value={priorityFilter}
                onChange={(event) =>
                  setPriorityFilter(event.target.value as PriorityFilter)
                }
                className="mt-2 min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                data-control-size="44"
              >
                <option value="all">All priorities</option>
                {INTELLIGENCE_REVIEW_PRIORITIES.map((priority) => (
                  <option key={priority} value={priority}>
                    {PRIORITY_PRESENTATION[priority].label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <p
            className="text-sm text-muted-foreground"
            role="status"
            aria-live="polite"
          >
            Showing {visibleItems.length.toLocaleString("en-NG")} of{" "}
            {items.length.toLocaleString("en-NG")} review items
          </p>

          {visibleItems.length === 0 ? (
            <StatusPanel
              state="empty"
              title="No review items match these filters"
              description="Change or clear a filter to return to the supplied review records."
            />
          ) : (
            <ol className="space-y-4" aria-label="Review items">
              {visibleItems.map((item, index) => (
                <li key={item.id}>
                  <ReviewItem
                    item={item}
                    headingId={`${instanceId}-review-item-${index}`}
                    readOnly={readOnly}
                    onClaim={onClaim}
                    onDecision={onDecision}
                  />
                </li>
              ))}
            </ol>
          )}

          <div
            role="note"
            aria-label="Review authority boundary"
            className="flex gap-3 rounded-md border border-primary/20 bg-primary/[0.035] p-4 text-sm leading-6"
          >
            <UserRoundCheck
              aria-hidden="true"
              className="mt-1 size-4 shrink-0 text-primary"
            />
            <div>
              <p>
                Only a named, authorised reviewer may approve, reject or request
                changes. Valo does not approve evidence, waive findings or make
                the substantive bid decision.
              </p>
              {authorityNote ? (
                <p className="mt-2 border-t border-primary/15 pt-2 text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">
                    Review authority:
                  </span>{" "}
                  {authorityNote}
                </p>
              ) : null}
            </div>
          </div>
        </>
      )}
    </section>
  );
}

export default IntelligenceReviewInbox;
