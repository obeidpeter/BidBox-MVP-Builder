import { useId } from "react";
import { Camera, CloudOff, LockKeyhole, Smartphone } from "lucide-react";
import { StateBadge } from "@/components/platform-states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type {
  MobileReviewItem,
  OperationsSectionState,
} from "./operations-suite-contract";
import {
  HumanAuthorityNotice,
  OperationsSection,
  RecordsBoundary,
} from "./operations-suite-primitives";

const KIND_LABEL: Record<MobileReviewItem["kind"], string> = {
  work: "Work review",
  evidence: "Evidence review",
  receipt: "Receipt capture",
  event: "Field event",
};

export interface LowBandwidthMobileReviewerProps extends OperationsSectionState {
  items: readonly MobileReviewItem[];
  online?: boolean;
  onOpenReview?: (reviewId: string) => void;
  onCaptureReceipt?: (reviewId: string) => void;
}

export function LowBandwidthMobileReviewer({
  items,
  state = "ready",
  error,
  readOnly = false,
  online = true,
  onRetry,
  onOpenReview,
  onCaptureReceipt,
}: LowBandwidthMobileReviewerProps) {
  const instanceId = useId();
  const boundary = RecordsBoundary({
    state,
    error,
    count: items.length,
    loadingLabel: "Loading compact mobile review records",
    errorTitle: "Mobile review records could not be loaded",
    emptyTitle: "No mobile review items are available",
    emptyDescription:
      "No mobile queue records were supplied. This does not mean that broader pursuit work is complete.",
    onRetry,
  });

  return (
    <OperationsSection
      id="mobile-reviewer"
      title="Mobile summary for slow connections"
      description="A compact task list that loads without the full operations view. Record contents are excluded, and restricted content is available only online."
      icon={<Smartphone aria-hidden="true" className="size-5" />}
      busy={state === "loading"}
    >
      <HumanAuthorityNotice title="Online-first storage policy">
        Restricted tender content is not cached for offline use. Losing
        connectivity pauses review actions; it never converts stale local data
        into a current decision. This compact page does not fetch the full
        operations record.
      </HumanAuthorityNotice>

      <div className="min-w-0 space-y-4" data-mobile-ready="360">
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <StateBadge
                state={online ? "active" : "offline"}
                label={online ? "Online" : "Offline"}
              />
              <Badge variant="outline">Compact summary</Badge>
            </div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              {online
                ? "Current compact summaries were loaded from the server. Use the full-operations link above for record actions."
                : "No tender content has been stored for offline use."}
            </p>
          </div>
        </div>

        {!online ? (
          <div
            role="alert"
            className="flex gap-3 rounded-lg border border-slate-300 bg-slate-100 p-4 text-sm text-slate-900"
          >
            <CloudOff aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            Reconnect before refreshing summaries or returning to full pursuit
            operations.
          </div>
        ) : null}

        {boundary ?? (
          <ul
            className="grid list-none gap-3 p-0 sm:grid-cols-2"
            aria-label="Mobile summary items"
          >
            {items.map((item) => (
              <li key={item.id}>
                <Card className="h-full min-w-0 shadow-none">
                  <article aria-labelledby={`${instanceId}-${item.id}-title`}>
                    <CardHeader className="space-y-3 p-4 pb-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Badge variant="outline">{KIND_LABEL[item.kind]}</Badge>
                        {item.restrictedContent ? (
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <LockKeyhole
                              aria-hidden="true"
                              className="size-3"
                            />
                            Online-only
                          </span>
                        ) : null}
                      </div>
                      <h3
                        id={`${instanceId}-${item.id}-title`}
                        className="break-words text-sm font-semibold"
                      >
                        {item.title}
                      </h3>
                    </CardHeader>
                    <CardContent className="space-y-3 p-4 pt-0">
                      <p className="text-xs leading-5 text-muted-foreground">
                        {item.statusLabel} · {item.dueLabel}
                      </p>
                      {onOpenReview ||
                      (item.kind === "receipt" && onCaptureReceipt) ? (
                        <div className="grid gap-2">
                          {onOpenReview ? (
                            <Button
                              type="button"
                              variant="outline"
                              className="min-h-11 w-full"
                              data-control-size="44"
                              disabled={!online}
                              onClick={() => onOpenReview(item.id)}
                            >
                              Open current record
                            </Button>
                          ) : null}
                          {item.kind === "receipt" && onCaptureReceipt ? (
                            <Button
                              type="button"
                              className="min-h-11 w-full"
                              data-control-size="44"
                              disabled={!online || readOnly}
                              onClick={() => onCaptureReceipt(item.id)}
                            >
                              <Camera aria-hidden="true" />
                              Capture human-held receipt
                            </Button>
                          ) : null}
                        </div>
                      ) : null}
                    </CardContent>
                  </article>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>
    </OperationsSection>
  );
}

export default LowBandwidthMobileReviewer;
