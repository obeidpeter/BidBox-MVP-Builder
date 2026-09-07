import { useId } from "react";
import {
  ArrowUpRight,
  CalendarCheck2,
  ClipboardCheck,
  MapPin,
  UserPlus,
} from "lucide-react";
import { StateBadge, type SurfaceState } from "@/components/platform-states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type {
  MissionEventStatus,
  MissionProofStatus,
  OperationsSectionState,
  PursuitMissionEvent,
} from "./operations-suite-contract";
import {
  formatOperationsDate,
  HumanAuthorityNotice,
  OperationsSection,
  RecordsBoundary,
  RecordFacts,
  safeInternalHref,
} from "./operations-suite-primitives";

const PROOF_STATUS: Record<
  MissionProofStatus,
  { label: string; state: SurfaceState }
> = {
  missing: { label: "Proof missing", state: "blocked" },
  recorded: { label: "Proof recorded", state: "pending" },
  accepted: { label: "Proof accepted", state: "active" },
};

const EVENT_STATUS: Record<
  MissionEventStatus,
  { label: string; state: SurfaceState }
> = {
  planned: { label: "Planned", state: "pending" },
  attended: { label: "Attendance recorded", state: "partial" },
  missed: { label: "Missed", state: "blocked" },
  completed: { label: "Completed", state: "active" },
  cancelled: { label: "Cancelled", state: "unavailable" },
};

export interface EventMissionControlProps extends OperationsSectionState {
  events: readonly PursuitMissionEvent[];
  onAssignDelegate?: (eventId: string) => void;
  onRecordProof?: (eventId: string) => void;
}

export function EventMissionControl({
  events,
  state = "ready",
  error,
  readOnly = false,
  onRetry,
  onAssignDelegate,
  onRecordProof,
}: EventMissionControlProps) {
  const instanceId = useId();
  const boundary = RecordsBoundary({
    state,
    error,
    count: events.length,
    loadingLabel: "Loading pre-bid and site-visit obligations",
    errorTitle: "Event obligations could not be loaded",
    emptyTitle: "No pre-bid or site-visit events are recorded",
    emptyDescription:
      "No event record was supplied. Review the source tender before concluding that attendance is not required.",
    onRetry,
  });

  return (
    <OperationsSection
      id="event-mission-control"
      title="Pre-bid meetings and site visits"
      description="Coordinate attendance, delegated authority, field checklists and reviewed proof for required tender events."
      icon={<CalendarCheck2 aria-hidden="true" className="size-5" />}
      busy={state === "loading"}
    >
      <HumanAuthorityNotice title="Attendance boundary">
        Valo cannot attend, sign a register or prove presence. A named delegate
        performs the visit and a reviewer validates the resulting proof.
      </HumanAuthorityNotice>

      {boundary ?? (
        <ul
          className="grid list-none gap-4 p-0 lg:grid-cols-2"
          aria-label="Pre-bid and site-visit events"
        >
          {events.map((event) => {
            const proof = PROOF_STATUS[event.proofStatus];
            const eventState = EVENT_STATUS[event.status];
            const href = safeInternalHref(event.href);
            return (
              <li key={event.id}>
                <Card className="h-full shadow-none">
                  <article aria-labelledby={`${instanceId}-${event.id}-title`}>
                    <CardHeader className="space-y-3 pb-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <StateBadge state={proof.state} label={proof.label} />
                        <div className="flex flex-wrap gap-2">
                          <Badge variant="outline">
                            {event.type === "pre_bid"
                              ? "Pre-bid meeting"
                              : "Site visit"}
                          </Badge>
                          <StateBadge
                            state={eventState.state}
                            label={eventState.label}
                          />
                          {event.required ? (
                            <Badge
                              className="border-red-200 bg-red-50 text-red-800"
                              variant="outline"
                            >
                              Mandatory
                            </Badge>
                          ) : null}
                        </div>
                      </div>
                      <h3
                        id={`${instanceId}-${event.id}-title`}
                        className="text-base font-semibold"
                      >
                        {event.title}
                      </h3>
                    </CardHeader>
                    <CardContent className="space-y-4 pt-0">
                      <RecordFacts
                        facts={[
                          {
                            label: "Starts",
                            value: formatOperationsDate(event.startsAt),
                          },
                          { label: "Location", value: event.location },
                          {
                            label: "Delegate",
                            value: event.delegateName ?? "Unassigned",
                          },
                          {
                            label: "Delegate authority",
                            value: event.authorityConfirmed
                              ? "Confirmed"
                              : "Not confirmed",
                          },
                          ...(event.statusReason
                            ? [
                                {
                                  label: "Applicable status reason",
                                  value: event.statusReason,
                                },
                              ]
                            : []),
                        ]}
                      />

                      <div className="rounded-lg border border-border bg-muted/20 p-3">
                        <h4 className="flex items-center gap-2 text-sm font-semibold">
                          <MapPin aria-hidden="true" className="size-4" />
                          Field checklist
                        </h4>
                        {event.checklist.length > 0 ? (
                          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                            {event.checklist.map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="mt-2 text-sm text-muted-foreground">
                            No checklist has been recorded.
                          </p>
                        )}
                      </div>

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
                              aria-label={`Open event plan: ${event.title}`}
                            >
                              <ArrowUpRight aria-hidden="true" />
                              Open event plan
                            </a>
                          </Button>
                        ) : null}
                        {!event.delegateName || !event.authorityConfirmed ? (
                          <Button
                            type="button"
                            className="min-h-11 w-full sm:w-auto"
                            data-control-size="44"
                            disabled={readOnly || !onAssignDelegate}
                            onClick={() => onAssignDelegate?.(event.id)}
                          >
                            <UserPlus aria-hidden="true" />
                            Assign authorised delegate
                          </Button>
                        ) : null}
                        {event.proofStatus !== "accepted" ? (
                          <Button
                            type="button"
                            variant="outline"
                            className="min-h-11 w-full sm:w-auto"
                            data-control-size="44"
                            disabled={readOnly || !onRecordProof}
                            onClick={() => onRecordProof?.(event.id)}
                          >
                            <ClipboardCheck aria-hidden="true" />
                            Record attendance proof
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

export default EventMissionControl;
