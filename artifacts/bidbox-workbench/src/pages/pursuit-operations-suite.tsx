import {
  BriefcaseBusiness,
  CalendarCheck2,
  FileCheck2,
  FileUp,
  Landmark,
  ListChecks,
  Radar,
  Smartphone,
} from "lucide-react";
import {
  ClientEvidenceRequestRoom,
  CredentialVerificationHub,
  EMPTY_OPERATIONS_SUITE_SNAPSHOT,
  EventMissionControl,
  LowBandwidthMobileReviewer,
  OpportunityIntake,
  PostAwardDeliveryControl,
  PursuitOperationsBoard,
  SubmissionWarRoom,
  type OperationsSuiteActions,
  type OperationsSuiteLoadState,
} from "@/components/operations-suite";
import {
  LoadingPanel,
  PageHeader,
  StatusPanel,
} from "@/components/platform-states";
import { Button } from "@/components/ui/button";

const DEFAULT_LOAD_STATE: OperationsSuiteLoadState = {
  status: "ready",
  snapshot: EMPTY_OPERATIONS_SUITE_SNAPSHOT,
};

const NAVIGATION = [
  {
    href: "#opportunity-intake",
    label: "Opportunity intake",
    icon: Radar,
    section: "opportunities",
  },
  {
    href: "#pursuit-board",
    label: "My Work",
    icon: ListChecks,
    section: "work",
  },
  {
    href: "#evidence-request-room",
    label: "Evidence requests",
    icon: FileUp,
    section: "evidence",
  },
  {
    href: "#submission-war-room",
    label: "Submission QA",
    icon: FileCheck2,
    section: "submissions",
  },
  {
    href: "#credential-verification",
    label: "Credentials",
    icon: Landmark,
    section: "credentials",
  },
  {
    href: "#event-mission-control",
    label: "Events",
    icon: CalendarCheck2,
    section: "missions",
  },
  {
    href: "#post-award-control",
    label: "Post-award",
    icon: BriefcaseBusiness,
    section: "postAward",
  },
  {
    href: "#mobile-reviewer",
    label: "Mobile review",
    icon: Smartphone,
    section: "mobile",
  },
] as const;

export interface OperationsSuiteVisibility {
  opportunities: boolean;
  work: boolean;
  evidence: boolean;
  submissions: boolean;
  credentials: boolean;
  missions: boolean;
  postAward: boolean;
  mobile: boolean;
}

const DEFAULT_VISIBILITY: OperationsSuiteVisibility = {
  opportunities: true,
  work: true,
  evidence: true,
  submissions: true,
  credentials: true,
  missions: true,
  postAward: true,
  mobile: true,
};

export interface PursuitOperationsSuiteProps {
  loadState?: OperationsSuiteLoadState;
  actions?: OperationsSuiteActions;
  readOnly?: boolean;
  online?: boolean;
  visibility?: Partial<OperationsSuiteVisibility>;
}

export function PursuitOperationsSuite({
  loadState = DEFAULT_LOAD_STATE,
  actions = {},
  readOnly = false,
  online = true,
  visibility: visibilityOverrides,
}: PursuitOperationsSuiteProps) {
  const visibility = { ...DEFAULT_VISIBILITY, ...visibilityOverrides };

  return (
    <main
      className="mx-auto w-full max-w-7xl space-y-8 p-4 sm:p-8"
      data-page="pursuit-operations-suite"
    >
      <PageHeader
        eyebrow="Pursuit operations"
        title="Pursuit workflows"
        description="Move from approved opportunity intake to delivery evidence. A person must still handle external submissions, issuer checks and contract actions."
        state={
          !online
            ? "offline"
            : loadState.status === "error"
              ? "error"
              : readOnly
                ? "unavailable"
                : "partial"
        }
      />

      {readOnly ? (
        <StatusPanel
          state="unavailable"
          title="Read-only operations view"
          description="Changes are disabled. You can still open available source and record links."
        />
      ) : null}

      {loadState.status === "loading" ? (
        <LoadingPanel label="Loading pursuit operations records" />
      ) : loadState.status === "error" ? (
        <StatusPanel
          state="error"
          title="Pursuit operations could not be loaded"
          description={`${loadState.message} Missing records are not complete, approved or optional.`}
        >
          {loadState.retry ? (
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              data-control-size="44"
              onClick={loadState.retry}
            >
              Try again
            </Button>
          ) : null}
        </StatusPanel>
      ) : (
        <>
          <nav aria-label="Pursuit operations sections">
            <ul className="flex list-none gap-2 overflow-x-auto p-0 pb-2">
              {NAVIGATION.filter(({ section }) => visibility[section]).map(
                ({ href, label, icon: Icon }) => (
                  <li key={href} className="shrink-0">
                    <Button
                      asChild
                      variant="outline"
                      className="min-h-11"
                      data-control-size="44"
                    >
                      <a href={href}>
                        <Icon aria-hidden="true" />
                        {label}
                      </a>
                    </Button>
                  </li>
                ),
              )}
            </ul>
          </nav>

          {loadState.snapshot.generatedAt ? (
            <p className="text-xs text-muted-foreground">
              Updated{" "}
              <time dateTime={loadState.snapshot.generatedAt}>
                {loadState.snapshot.generatedAt}
              </time>
              . Each external fact still requires source review.
            </p>
          ) : null}

          {visibility.opportunities ? (
            <OpportunityIntake
              opportunities={loadState.snapshot.opportunities}
              readOnly={readOnly}
              onStartIntake={actions.onStartOpportunityIntake}
              onConfirm={actions.onConfirmOpportunity}
            />
          ) : null}
          {visibility.work ? (
            <PursuitOperationsBoard
              items={loadState.snapshot.workItems}
              readOnly={readOnly}
              onChangeStatus={actions.onChangeWorkStatus}
            />
          ) : null}
          {visibility.evidence ? (
            <ClientEvidenceRequestRoom
              requests={loadState.snapshot.evidenceRequests}
              readOnly={readOnly}
              onIssueRequest={actions.onIssueEvidenceRequest}
              onAcceptEvidence={actions.onAcceptEvidence}
              onRequestChanges={actions.onRequestEvidenceChanges}
            />
          ) : null}
          {visibility.submissions ? (
            <SubmissionWarRoom
              packages={loadState.snapshot.submissionPackages}
              readOnly={readOnly}
              onFreezePackage={actions.onFreezeSubmissionPackage}
              onRecordReceipt={actions.onRecordSubmissionReceipt}
            />
          ) : null}
          {visibility.credentials ? (
            <CredentialVerificationHub
              credentials={loadState.snapshot.credentialChecks}
              readOnly={readOnly}
              onRecordCheck={actions.onRecordCredentialCheck}
            />
          ) : null}
          {visibility.missions ? (
            <EventMissionControl
              events={loadState.snapshot.missionEvents}
              readOnly={readOnly}
              onAssignDelegate={actions.onAssignEventDelegate}
              onRecordProof={actions.onRecordEventProof}
            />
          ) : null}
          {visibility.postAward ? (
            <PostAwardDeliveryControl
              obligations={loadState.snapshot.obligations}
              readOnly={readOnly}
              onRecordDelivery={actions.onRecordObligationDelivery}
              onAddEvidence={actions.onAddObligationEvidence}
            />
          ) : null}
          {visibility.mobile ? (
            <LowBandwidthMobileReviewer
              items={loadState.snapshot.mobileReviewItems}
              readOnly={readOnly}
              online={online}
              onOpenReview={actions.onOpenMobileReview}
              onCaptureReceipt={actions.onCaptureMobileReceipt}
            />
          ) : null}
        </>
      )}
    </main>
  );
}

export default PursuitOperationsSuite;
