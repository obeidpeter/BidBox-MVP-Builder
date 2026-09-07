import { useId } from "react";
import { ArrowUpRight, FilePlus2, PackageCheck, Truck } from "lucide-react";
import { StateBadge, type SurfaceState } from "@/components/platform-states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type {
  ObligationStatus,
  OperationsSectionState,
  PostAwardObligation,
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

const STATUS: Record<ObligationStatus, { label: string; state: SurfaceState }> =
  {
    open: { label: "Open", state: "pending" },
    upcoming: { label: "Upcoming", state: "partial" },
    due: { label: "Due", state: "pending" },
    overdue: { label: "Overdue", state: "expired" },
    submitted: { label: "Delivery recorded", state: "pending" },
    accepted: { label: "Acceptance recorded", state: "active" },
    disputed: { label: "Disputed", state: "blocked" },
    in_progress: { label: "In progress", state: "partial" },
    satisfied: { label: "Satisfied record", state: "active" },
    cancelled: { label: "Cancelled", state: "unavailable" },
  };

const CATEGORY: Record<PostAwardObligation["category"], string> = {
  obligation: "Obligation",
  deliverable: "Deliverable",
  payment: "Payment milestone",
  payment_milestone: "Payment milestone",
  notice: "Contract notice",
  variation: "Variation",
  completion_record: "Completion record",
};

export interface PostAwardDeliveryControlProps extends OperationsSectionState {
  obligations: readonly PostAwardObligation[];
  onRecordDelivery?: (obligationId: string) => void;
  onAddEvidence?: (obligationId: string) => void;
}

export function PostAwardDeliveryControl({
  obligations,
  state = "ready",
  error,
  readOnly = false,
  onRetry,
  onRecordDelivery,
  onAddEvidence,
}: PostAwardDeliveryControlProps) {
  const instanceId = useId();
  const boundary = RecordsBoundary({
    state,
    error,
    count: obligations.length,
    loadingLabel: "Loading post-award obligations",
    errorTitle: "Post-award obligations could not be loaded",
    emptyTitle: "No post-award obligations are recorded",
    emptyDescription:
      "No obligation record was supplied. This does not establish that a contract has no deliverables, notices, variations or payment conditions.",
    onRetry,
  });

  return (
    <OperationsSection
      id="post-award-control"
      title="Post-award delivery"
      description="Link contract deliverables, changes, notices and payment milestones to owners and completion evidence."
      icon={<Truck aria-hidden="true" className="size-5" />}
      busy={state === "loading"}
    >
      <HumanAuthorityNotice title="Contract authority">
        Status changes are internal records, not contractual notices, acceptance
        certificates or payment confirmations. Authorised people perform those
        acts through the contract&apos;s required channel.
      </HumanAuthorityNotice>

      {boundary ?? (
        <ul
          className="grid list-none gap-4 p-0 lg:grid-cols-2"
          aria-label="Post-award obligations"
        >
          {obligations.map((obligation) => {
            const presentation = STATUS[obligation.status];
            const href = safeInternalHref(obligation.href);
            const canRecordDelivery =
              obligation.status === "upcoming" ||
              obligation.status === "due" ||
              obligation.status === "overdue";
            return (
              <li key={obligation.id}>
                <Card className="h-full shadow-none">
                  <article
                    aria-labelledby={`${instanceId}-${obligation.id}-title`}
                  >
                    <CardHeader className="space-y-3 pb-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <StateBadge
                          state={presentation.state}
                          label={presentation.label}
                        />
                        <Badge variant="outline">
                          {CATEGORY[obligation.category]}
                        </Badge>
                      </div>
                      <div>
                        <h3
                          id={`${instanceId}-${obligation.id}-title`}
                          className="text-base font-semibold"
                        >
                          {obligation.title}
                        </h3>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {obligation.contractName}
                        </p>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4 pt-0">
                      <RecordFacts
                        facts={[
                          {
                            label: "Owner",
                            value: obligation.ownerName ?? "Unassigned",
                          },
                          {
                            label: "Due",
                            value: formatOperationsDate(obligation.dueAt),
                          },
                          {
                            label: "Evidence records",
                            value: safeCount(
                              obligation.evidenceCount,
                            ).toLocaleString("en-NG"),
                          },
                          ...(obligation.amountLabel
                            ? [
                                {
                                  label: "Recorded amount",
                                  value: obligation.amountLabel,
                                },
                              ]
                            : []),
                          ...(obligation.statusReason
                            ? [
                                {
                                  label: "Applicable status reason",
                                  value: obligation.statusReason,
                                },
                              ]
                            : []),
                        ]}
                      />
                      <div className="flex flex-wrap gap-2 border-t border-border pt-4">
                        {href ? (
                          <Button
                            asChild
                            variant="outline"
                            className="min-h-11 w-full sm:w-auto"
                            data-control-size="44"
                          >
                            <a
                              href={href}
                              aria-label={`Open obligation: ${obligation.title}`}
                            >
                              <ArrowUpRight aria-hidden="true" />
                              Open obligation
                            </a>
                          </Button>
                        ) : null}
                        {canRecordDelivery ? (
                          <Button
                            type="button"
                            className="min-h-11 w-full sm:w-auto"
                            data-control-size="44"
                            disabled={readOnly || !onRecordDelivery}
                            onClick={() => onRecordDelivery?.(obligation.id)}
                          >
                            <PackageCheck aria-hidden="true" />
                            Record human delivery
                          </Button>
                        ) : null}
                        {obligation.status !== "accepted" ? (
                          <Button
                            type="button"
                            variant="outline"
                            className="min-h-11 w-full sm:w-auto"
                            data-control-size="44"
                            disabled={readOnly || !onAddEvidence}
                            onClick={() => onAddEvidence?.(obligation.id)}
                          >
                            <FilePlus2 aria-hidden="true" />
                            Add completion evidence
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
    </OperationsSection>
  );
}

export default PostAwardDeliveryControl;
