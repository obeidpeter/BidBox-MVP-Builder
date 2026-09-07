import {
  BookOpenCheck,
  CircleGauge,
  FileWarning,
  ShieldCheck,
  UserRoundCheck,
} from "lucide-react";
import {
  DataErrorPanel,
  LoadingPanel,
  PageHeader,
  StateBadge,
  StatusPanel,
  type SurfaceState,
} from "@/components/platform-states";
import { IntelligenceCapabilityCard } from "@/components/intelligence/intelligence-capability-card";
import IntelligenceReviewInbox, {
  type IntelligenceReviewDecision,
} from "@/components/intelligence/intelligence-review-inbox";
import {
  INTELLIGENCE_CAPABILITY_CATALOG,
  createProductionDisabledIntelligenceSnapshot,
  type IntelligenceCapabilitySnapshot,
  type IntelligenceCentreLoadState,
} from "@/components/intelligence/intelligence-contract";
import { Card, CardContent } from "@/components/ui/card";
import { formatWatInstant } from "@/lib/format";

export type { IntelligenceCentreLoadState } from "@/components/intelligence/intelligence-contract";

export interface IntelligenceCentreProps {
  loadState?: IntelligenceCentreLoadState;
  reviewMutationPending?: boolean;
  onReviewClaim?: (itemId: string) => void;
  onReviewDecision?: (
    itemId: string,
    decision: IntelligenceReviewDecision,
  ) => void;
}

const DEFAULT_LOAD_STATE: IntelligenceCentreLoadState = {
  status: "ready",
  snapshot: createProductionDisabledIntelligenceSnapshot(),
};

const FOUNDATION_CAPABILITY_IDS = new Set([
  "evidence_graph",
  "addendum_radar",
  "eligibility_passport",
  "grounded_copilot",
  "opportunity_radar",
  "response_studio",
  "submission_preflight",
  "clarification_assistant",
  "boq_sanity",
  "award_handoff",
]);

function fallbackCapability(
  id: (typeof INTELLIGENCE_CAPABILITY_CATALOG)[number]["id"],
): IntelligenceCapabilitySnapshot {
  return {
    id,
    state: "empty",
    stateReason:
      "This capability is missing from the current data. Its state is unknown.",
    reviewItemCount: null,
    citationCount: null,
    citations: [],
    lastUpdatedAt: null,
  };
}

function formatTimestamp(value: string | null): string {
  return formatWatInstant(value, {
    empty: "No current data",
    invalid: "Update time unavailable",
  });
}

function overallState(loadState: IntelligenceCentreLoadState): SurfaceState {
  if (loadState.status === "loading") return "pending";
  if (loadState.status === "error") return "error";
  const { snapshot } = loadState;
  if (snapshot.restrictedMode) return "unavailable";
  if (snapshot.environment === "production" && !snapshot.productionAiEnabled) {
    return "partial";
  }
  if (
    snapshot.capabilities.length < INTELLIGENCE_CAPABILITY_CATALOG.length ||
    snapshot.capabilities.some(
      (capability) => capability.state !== "review_ready",
    )
  ) {
    return "partial";
  }
  return "active";
}

function SummaryMetric({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof CircleGauge;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <Card className="shadow-none">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="rounded-md border border-border bg-muted p-2">
            <Icon aria-hidden="true" className="size-4" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">{label}</p>
            <p className="mt-1 font-mono text-xl font-semibold">{value}</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {detail}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function IntelligenceCentreReady({
  loadState,
  reviewMutationPending = false,
  onReviewClaim,
  onReviewDecision,
}: {
  loadState: Extract<IntelligenceCentreLoadState, { status: "ready" }>;
  reviewMutationPending?: boolean;
  onReviewClaim?: IntelligenceCentreProps["onReviewClaim"];
  onReviewDecision?: IntelligenceCentreProps["onReviewDecision"];
}) {
  const { snapshot } = loadState;
  const capabilityById = new Map(
    snapshot.capabilities.map((capability) => [capability.id, capability]),
  );
  const capabilityCards = INTELLIGENCE_CAPABILITY_CATALOG.map((definition) => ({
    definition,
    snapshot:
      capabilityById.get(definition.id) ?? fallbackCapability(definition.id),
  }));
  const capabilityGroups = [
    {
      id: "foundation",
      title: "Bid intelligence foundation",
      description:
        "The evidence, intake, drafting, readiness and handoff capabilities already represented in Valo's pursuit workflow.",
      cards: capabilityCards.filter(({ definition }) =>
        FOUNDATION_CAPABILITY_IDS.has(definition.id),
      ),
    },
    {
      id: "advanced",
      title: "Advanced decision support",
      description:
        "Rules-based checks for scoring, financial instruments, regulation, partners, submissions, commercial exposure, delivery planning, integrity and lessons learned.",
      cards: capabilityCards.filter(
        ({ definition }) => !FOUNDATION_CAPABILITY_IDS.has(definition.id),
      ),
    },
  ];
  const suppliedIds = new Set(snapshot.capabilities.map(({ id }) => id));
  const missingCount = INTELLIGENCE_CAPABILITY_CATALOG.filter(
    ({ id }) => !suppliedIds.has(id),
  ).length;
  const reviewItemValues = snapshot.capabilities
    .map(({ reviewItemCount }) => reviewItemCount)
    .filter((value): value is number => value != null);
  const citationValues = snapshot.capabilities
    .map(({ citationCount }) => citationCount)
    .filter((value): value is number => value != null);
  const totalReviewItems = reviewItemValues.reduce(
    (sum, value) => sum + value,
    0,
  );
  const totalCitations = citationValues.reduce((sum, value) => sum + value, 0);
  const reportingCoverage = snapshot.capabilities.filter(
    ({ reviewItemCount, citationCount }) =>
      reviewItemCount != null && citationCount != null,
  ).length;

  return (
    <>
      {snapshot.restrictedMode ? (
        <StatusPanel
          state="unavailable"
          title="Restricted Mode is active"
          description="Only services explicitly approved for the active Restricted Mode boundary may process content. Unavailable capabilities remain manual; this page does not bypass that boundary."
        />
      ) : null}

      {snapshot.environment === "production" &&
      !snapshot.productionAiEnabled ? (
        <StatusPanel
          state="partial"
          title="Production model execution is disabled"
          description="Recorded rules-based signals remain available. AI features are not running. A person must review all results until provider, privacy, search, evaluation, budget and organisation checks pass."
        />
      ) : null}

      {snapshot.capabilities.length === 0 ? (
        <StatusPanel
          state="empty"
          title="No intelligence evidence is available"
          description="The capability list is shown for reference, but there are no current statuses, counts or sources to rely on."
        />
      ) : missingCount > 0 ? (
        <StatusPanel
          state="partial"
          title="The current intelligence data is incomplete"
          description={`${missingCount} of ${INTELLIGENCE_CAPABILITY_CATALOG.length} capability states were not supplied. Missing entries are shown as unknown, not as clear or disabled.`}
        />
      ) : null}

      {snapshot.evidenceLayer ? (
        <StatusPanel
          state={
            snapshot.evidenceLayer.disposition === "ready"
              ? "active"
              : snapshot.evidenceLayer.disposition === "abstain"
                ? "partial"
                : "blocked"
          }
          title={
            snapshot.evidenceLayer.disposition === "ready"
              ? "Verified evidence spans are searchable"
              : snapshot.evidenceLayer.disposition === "abstain"
                ? "Evidence search is abstaining"
                : "Evidence search is blocked"
          }
          description={`${snapshot.evidenceLayer.sourceCount.toLocaleString("en-NG")} exact, current source passage${snapshot.evidenceLayer.sourceCount === 1 ? " is" : "s are"} available after named review. ${snapshot.evidenceLayer.rejectedCount.toLocaleString("en-NG")} candidate passage${snapshot.evidenceLayer.rejectedCount === 1 ? " was" : "s were"} rejected. This search does not use AI or approve claims.`}
        />
      ) : (
        <StatusPanel
          state="partial"
          title="Evidence layer status is unavailable"
          description="No searchable evidence state was supplied. Do not infer that evidence is absent or verified."
        />
      )}

      <section
        aria-labelledby="intelligence-summary-heading"
        className="space-y-4"
      >
        <div>
          <h2
            id="intelligence-summary-heading"
            className="font-serif text-xl font-semibold"
          >
            Evidence at a glance
          </h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Counts are descriptive review evidence. They are not quality scores,
            approvals or predictions.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryMetric
            icon={UserRoundCheck}
            label="Visible review items"
            value={
              reviewItemValues.length === 0
                ? "Not reported"
                : totalReviewItems.toLocaleString("en-NG")
            }
            detail="Recorded items still need review by a named person."
          />
          <SummaryMetric
            icon={BookOpenCheck}
            label="Source references"
            value={
              citationValues.length === 0
                ? "Not reported"
                : totalCitations.toLocaleString("en-NG")
            }
            detail="Reported references; source correctness must still be checked."
          />
          <SummaryMetric
            icon={CircleGauge}
            label="Reporting coverage"
            value={`${reportingCoverage}/${INTELLIGENCE_CAPABILITY_CATALOG.length}`}
            detail="Capabilities with both review-item and citation counts."
          />
          <SummaryMetric
            icon={ShieldCheck}
            label="Current runtime"
            value="Level 0"
            detail="The maximum planned levels are 1–2. AI previews, drafts and automatic actions are off."
          />
        </div>
      </section>

      {snapshot.reviewInbox ? (
        <IntelligenceReviewInbox
          items={snapshot.reviewInbox.items}
          environment={snapshot.reviewInbox.environment}
          productionAiEnabled={snapshot.reviewInbox.productionAiEnabled}
          readOnly={snapshot.reviewInbox.readOnly || reviewMutationPending}
          authorityNote={snapshot.reviewInbox.authorityNote}
          showRuntimeBoundary={false}
          onClaim={onReviewClaim}
          onDecision={onReviewDecision}
        />
      ) : (
        <StatusPanel
          state="partial"
          title="Review inbox is unavailable"
          description="No review queue was supplied. Do not infer that there is nothing to review."
        />
      )}

      <section
        aria-labelledby="capability-catalogue-heading"
        className="space-y-4"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2
              id="capability-catalogue-heading"
              className="font-serif text-xl font-semibold"
            >
              Decision-support catalogue
            </h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
              Every capability stays inside an explicit evidence boundary and
              leaves the substantive decision with an authorised person.
            </p>
          </div>
          <StateBadge
            state={
              missingCount > 0
                ? "partial"
                : snapshot.capabilities.length === 0
                  ? "empty"
                  : "active"
            }
            label={`${INTELLIGENCE_CAPABILITY_CATALOG.length} capabilities defined`}
          />
        </div>
        <div className="space-y-8">
          {capabilityGroups.map((group) => (
            <section
              key={group.id}
              aria-labelledby={`capability-group-${group.id}`}
              className="space-y-4"
            >
              <div>
                <h3
                  id={`capability-group-${group.id}`}
                  className="text-base font-semibold"
                >
                  {group.title}
                </h3>
                <p className="mt-1 max-w-4xl text-sm leading-6 text-muted-foreground">
                  {group.description}
                </p>
              </div>
              <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                {group.cards.map(({ definition, snapshot: capability }) => (
                  <IntelligenceCapabilityCard
                    key={definition.id}
                    definition={definition}
                    snapshot={capability}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      </section>

      <aside aria-labelledby="decision-contract-heading">
        <Card className="border-primary/25 bg-primary/[0.035] shadow-none">
          <CardContent className="grid gap-5 p-5 lg:grid-cols-[auto_1fr_auto] lg:items-center">
            <div className="rounded-lg border border-primary/20 bg-background p-3 text-primary">
              <FileWarning aria-hidden="true" className="size-5" />
            </div>
            <div>
              <h2
                id="decision-contract-heading"
                className="text-sm font-semibold"
              >
                The decision contract
              </h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Suggestions may be incomplete or wrong. Open the named source,
                record your decision and keep the reviewer identity. Valo does
                not approve evidence, waive findings, set prices, predict awards
                or submit bids.
              </p>
            </div>
            <div className="text-xs leading-5 text-muted-foreground lg:text-right">
              <p>Latest update</p>
              <p className="font-medium text-foreground">
                {formatTimestamp(snapshot.generatedAt)} WAT
              </p>
            </div>
          </CardContent>
        </Card>
      </aside>
    </>
  );
}

export default function IntelligenceCentre({
  loadState = DEFAULT_LOAD_STATE,
  reviewMutationPending = false,
  onReviewClaim,
  onReviewDecision,
}: IntelligenceCentreProps) {
  const state = overallState(loadState);

  return (
    <main className="mx-auto w-full max-w-7xl space-y-7 p-5 sm:p-8">
      <PageHeader
        eyebrow="Human-led bid intelligence"
        title="Bid insights"
        description="Review evidence-based suggestions and drafts. Valo helps authorised reviewers find risk; people make and carry out every decision."
        state={state}
      />

      {loadState.status === "loading" ? (
        <LoadingPanel label="Loading intelligence evidence for this organisation" />
      ) : null}

      {loadState.status === "error" ? (
        <DataErrorPanel
          title="Intelligence evidence could not be loaded"
          description={`${loadState.message} Do not infer that capabilities are clear, empty, enabled or disabled from this failure.`}
          onRetry={loadState.retry}
        />
      ) : null}

      {loadState.status === "ready" ? (
        <IntelligenceCentreReady
          loadState={loadState}
          reviewMutationPending={reviewMutationPending}
          onReviewClaim={onReviewClaim}
          onReviewDecision={onReviewDecision}
        />
      ) : null}
    </main>
  );
}
