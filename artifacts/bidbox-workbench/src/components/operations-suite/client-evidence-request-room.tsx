import { useId } from "react";
import {
  ArrowUpRight,
  CheckCircle2,
  FileUp,
  RotateCcw,
  Send,
} from "lucide-react";
import { StateBadge, type SurfaceState } from "@/components/platform-states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type {
  ClientEvidenceRequest,
  EvidenceRequestStatus,
  OperationsSectionState,
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

const STATUS: Record<
  EvidenceRequestStatus,
  { label: string; state: SurfaceState }
> = {
  draft: { label: "Draft", state: "unavailable" },
  shared_manually: { label: "Shared manually", state: "pending" },
  response_recorded: { label: "Response recorded", state: "partial" },
  requested: { label: "Awaiting client", state: "pending" },
  uploaded: { label: "Review uploaded files", state: "partial" },
  accepted: { label: "Accepted by reviewer", state: "active" },
  changes_requested: { label: "Changes requested", state: "blocked" },
  overdue: { label: "Overdue", state: "expired" },
  closed: { label: "Closed", state: "unavailable" },
};

export interface ClientEvidenceRequestRoomProps extends OperationsSectionState {
  requests: readonly ClientEvidenceRequest[];
  onIssueRequest?: (requestId: string) => void;
  onAcceptEvidence?: (requestId: string) => void;
  onRequestChanges?: (requestId: string) => void;
}

export function ClientEvidenceRequestRoom({
  requests,
  state = "ready",
  error,
  readOnly = false,
  onRetry,
  onIssueRequest,
  onAcceptEvidence,
  onRequestChanges,
}: ClientEvidenceRequestRoomProps) {
  const instanceId = useId();
  const boundary = RecordsBoundary({
    state,
    error,
    count: requests.length,
    loadingLabel: "Loading controlled client evidence requests",
    errorTitle: "Evidence requests could not be loaded",
    emptyTitle: "No client evidence requests are recorded",
    emptyDescription:
      "No request records were supplied. This does not establish that the pursuit has all required evidence.",
    onRetry,
  });

  return (
    <OperationsSection
      id="evidence-request-room"
      title="Client evidence requests"
      description="Track named requests, controlled upload slots, acknowledgements, due dates and reviewer receipts in one place."
      icon={<FileUp aria-hidden="true" className="size-5" />}
      busy={state === "loading"}
    >
      <HumanAuthorityNotice title="Evidence acceptance">
        Uploading a file never makes it approved evidence. A named reviewer must
        inspect its scope, currency and source before recording acceptance.
      </HumanAuthorityNotice>

      {boundary ?? (
        <ul
          className="grid list-none gap-4 p-0 lg:grid-cols-2"
          aria-label="Client evidence requests"
        >
          {requests.map((request) => {
            const presentation = STATUS[request.status];
            const href = safeInternalHref(request.href);
            const uploaded = request.status === "uploaded";
            return (
              <li key={request.id}>
                <Card className="h-full shadow-none">
                  <article
                    aria-labelledby={`${instanceId}-${request.id}-title`}
                  >
                    <CardHeader className="space-y-3 pb-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <StateBadge
                          state={presentation.state}
                          label={presentation.label}
                        />
                        <Badge variant="outline">
                          {request.attestationRequired
                            ? "Signed confirmation required"
                            : "No signed confirmation recorded"}
                        </Badge>
                      </div>
                      <div>
                        <h3
                          id={`${instanceId}-${request.id}-title`}
                          className="text-base font-semibold"
                        >
                          {request.title}
                        </h3>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Requested from {request.recipientName}
                        </p>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4 pt-0">
                      <RecordFacts
                        facts={[
                          {
                            label: "Due",
                            value: formatOperationsDate(request.dueAt),
                          },
                          {
                            label: "Files in upload slot",
                            value: safeCount(
                              request.uploadCount,
                            ).toLocaleString("en-NG"),
                          },
                          {
                            label: "Accepted by",
                            value: request.acceptedByName ?? "Not accepted",
                          },
                          {
                            label: "Prior rejected responses",
                            value: safeCount(
                              request.priorRejectedResponseCount ?? 0,
                            ).toLocaleString("en-NG"),
                          },
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
                              aria-label={`Open request: ${request.title}`}
                            >
                              <ArrowUpRight aria-hidden="true" />
                              Open request room
                            </a>
                          </Button>
                        ) : null}
                        {request.status === "draft" ? (
                          <Button
                            type="button"
                            className="min-h-11 w-full sm:w-auto"
                            data-control-size="44"
                            disabled={readOnly || !onIssueRequest}
                            onClick={() => onIssueRequest?.(request.id)}
                          >
                            <Send aria-hidden="true" />
                            Issue request
                          </Button>
                        ) : null}
                        {uploaded ? (
                          <>
                            <Button
                              type="button"
                              className="min-h-11 w-full sm:w-auto"
                              data-control-size="44"
                              disabled={readOnly || !onAcceptEvidence}
                              onClick={() => onAcceptEvidence?.(request.id)}
                            >
                              <CheckCircle2 aria-hidden="true" />
                              Record acceptance
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              className="min-h-11 w-full sm:w-auto"
                              data-control-size="44"
                              disabled={readOnly || !onRequestChanges}
                              onClick={() => onRequestChanges?.(request.id)}
                            >
                              <RotateCcw aria-hidden="true" />
                              Request changes
                            </Button>
                          </>
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

export default ClientEvidenceRequestRoom;
