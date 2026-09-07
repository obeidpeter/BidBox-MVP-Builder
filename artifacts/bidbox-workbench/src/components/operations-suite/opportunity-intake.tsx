import { ExternalLink, Link2, Radar, UserCheck } from "lucide-react";
import { StateBadge, type SurfaceState } from "@/components/platform-states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type {
  OpportunityRecord,
  OperationsSectionState,
} from "./operations-suite-contract";
import {
  formatOperationsDate,
  HumanAuthorityNotice,
  OperationsSection,
  RecordsBoundary,
  RecordFacts,
  safeExternalHref,
} from "./operations-suite-primitives";

const STATUS: Record<
  OpportunityRecord["status"],
  { label: string; state: SurfaceState }
> = {
  needs_confirmation: { label: "Needs confirmation", state: "pending" },
  deadline_missing: { label: "Deadline not recorded", state: "blocked" },
  confirmed: {
    label: "Deadline confirmed; qualification pending",
    state: "partial",
  },
  duplicate: { label: "Possible duplicate", state: "partial" },
  qualified: { label: "Human-qualified", state: "active" },
  not_pursued: { label: "Not pursued", state: "unavailable" },
  rejected: { label: "Rejected", state: "unavailable" },
};

const SOURCE_LABEL: Record<OpportunityRecord["sourceType"], string> = {
  manual_url: "Manual URL",
  forwarded_email: "Forwarded email",
  licensed_csv: "Licensed CSV",
  ocds: "OCDS import",
};

export interface OpportunityIntakeProps extends OperationsSectionState {
  opportunities: readonly OpportunityRecord[];
  onStartIntake?: () => void;
  onConfirm?: (opportunityId: string) => void;
}

export function OpportunityIntake({
  opportunities,
  state = "ready",
  error,
  readOnly = false,
  onRetry,
  onStartIntake,
  onConfirm,
}: OpportunityIntakeProps) {
  const boundary = RecordsBoundary({
    state,
    error,
    count: opportunities.length,
    loadingLabel: "Loading opportunity records and source details",
    errorTitle: "Opportunity intake could not be loaded",
    emptyTitle: "No opportunities have been recorded",
    emptyDescription:
      "No authorised source records were supplied. This does not mean that no suitable opportunities exist.",
    onRetry,
  });

  return (
    <OperationsSection
      id="opportunity-intake"
      title="Opportunity intake"
      description="Record links, forwarded notices and licensed datasets with their source, duplicate warnings and a deadline confirmed by a person."
      icon={<Radar aria-hidden="true" className="size-5" />}
      busy={state === "loading"}
    >
      <HumanAuthorityNotice title="Source confirmation">
        Imported fields are untrusted until an authorised person opens the
        original notice and confirms the buyer, reference and deadline. Valo
        does not scrape or apply to external portals from this view.
      </HumanAuthorityNotice>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          className="min-h-11 w-full sm:w-auto"
          data-control-size="44"
          disabled={readOnly || state !== "ready" || !onStartIntake}
          onClick={onStartIntake}
        >
          <Link2 aria-hidden="true" />
          Record opportunity source
        </Button>
      </div>

      {boundary ?? (
        <ul
          className="grid list-none gap-4 p-0 lg:grid-cols-2"
          aria-label="Opportunity intake records"
        >
          {opportunities.map((opportunity) => {
            const presentation = STATUS[opportunity.status];
            const sourceHref = safeExternalHref(opportunity.sourceUrl);
            const needsConfirmation =
              opportunity.status === "needs_confirmation" ||
              opportunity.status === "duplicate";
            return (
              <li key={opportunity.id}>
                <Card className="h-full shadow-none">
                  <article aria-labelledby={`${opportunity.id}-title`}>
                    <CardHeader className="space-y-3 pb-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <StateBadge
                          state={presentation.state}
                          label={presentation.label}
                        />
                        <Badge variant="outline">
                          {SOURCE_LABEL[opportunity.sourceType]}
                        </Badge>
                      </div>
                      <div>
                        <h3
                          id={`${opportunity.id}-title`}
                          className="text-base font-semibold"
                        >
                          {opportunity.title}
                        </h3>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {opportunity.buyer}
                        </p>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4 pt-0">
                      <RecordFacts
                        facts={[
                          { label: "Reference", value: opportunity.reference },
                          {
                            label: "Recorded deadline",
                            value: formatOperationsDate(opportunity.deadline),
                          },
                          {
                            label: "Confirmed by",
                            value:
                              opportunity.confirmedByName ?? "Not confirmed",
                          },
                        ]}
                      />
                      <div className="rounded-md border border-border bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">
                        <p className="font-medium text-foreground">
                          {opportunity.sourceLabel}
                        </p>
                        <p>{opportunity.provenance}</p>
                        {opportunity.duplicateOf ? (
                          <p className="mt-1 text-amber-800">
                            Possible match: {opportunity.duplicateOf}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap gap-2 border-t border-border pt-4">
                        {sourceHref ? (
                          <Button
                            asChild
                            variant="outline"
                            className="min-h-11 w-full sm:w-auto"
                            data-control-size="44"
                          >
                            <a
                              href={sourceHref}
                              target="_blank"
                              rel="noreferrer"
                              aria-label={`Open original source for ${opportunity.title}`}
                            >
                              <ExternalLink aria-hidden="true" />
                              Open original source
                            </a>
                          </Button>
                        ) : null}
                        {needsConfirmation ? (
                          <Button
                            type="button"
                            className="min-h-11 w-full sm:w-auto"
                            data-control-size="44"
                            disabled={readOnly || !onConfirm}
                            onClick={() => onConfirm?.(opportunity.id)}
                          >
                            <UserCheck aria-hidden="true" />
                            Confirm source and deadline
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

export default OpportunityIntake;
