import type { ReactNode } from "react";
import {
  PageHeader,
  StateBadge,
  StatusPanel,
} from "@/components/platform-states";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type {
  PrivacyEvidenceState,
  PrivacyOperationsDashboard,
  PrivacyReviewPosture,
} from "./privacy-operations-contract";
import { formatWatInstant, humaniseToken as readable } from "@/lib/format";

function formattedDate(value: string | null): string {
  return formatWatInstant(value, {
    empty: "Not recorded",
    invalid: "Invalid date",
  });
}

function EvidenceBadge({ state }: { state: PrivacyEvidenceState }) {
  return (
    <StateBadge
      state={
        state === "verified"
          ? "active"
          : state === "missing"
            ? "pending"
            : "error"
      }
      label={readable(state)}
    />
  );
}

function ReviewBadge({
  posture,
}: {
  posture: PrivacyReviewPosture | "released";
}) {
  return (
    <StateBadge
      state={
        posture === "current" || posture === "released"
          ? "active"
          : posture === "due_soon"
            ? "partial"
            : posture === "overdue"
              ? "expired"
              : "pending"
      }
      label={readable(posture)}
    />
  );
}

function EmptyList({ label }: { label: string }) {
  return (
    <p className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">
      No {label} are available for this organisation.
    </p>
  );
}

export function PrivacyOperationsDashboardView({
  dashboard,
  workflowPanel,
}: {
  dashboard: PrivacyOperationsDashboard;
  workflowPanel?: ReactNode;
}) {
  const totalVisible =
    dashboard.dataSubjectRequests.length +
    dashboard.consentRecords.length +
    dashboard.legalHolds.length +
    dashboard.subprocessors.length +
    dashboard.crossBorderTransfers.length +
    dashboard.deletionActions.length;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-7 p-5 sm:p-8">
      <PageHeader
        eyebrow="Privacy records"
        title="Privacy requests"
        description="Review privacy requests and evidence for this organisation. Personal references are hidden, and legal decisions are never automatic."
        state={dashboard.blockers.length > 0 ? "partial" : "active"}
      />

      <StatusPanel
        state={dashboard.blockers.length > 0 ? "partial" : "active"}
        title={
          dashboard.blockers.length > 0
            ? "A named person must review these issues"
            : "No blocker is visible in the current view"
        }
        description={dashboard.authorityNote}
      >
        <div className="grid gap-3 text-sm sm:grid-cols-3">
          <p>
            <span className="font-medium">Loaded records:</span> {totalVisible}
          </p>
          <p>
            <span className="font-medium">Operational blockers:</span>{" "}
            {dashboard.blockers.length}
          </p>
          <p>
            <span className="font-medium">Personal details:</span> hidden
          </p>
        </div>
      </StatusPanel>

      <section aria-labelledby="privacy-counts-heading" className="space-y-3">
        <div>
          <h2 id="privacy-counts-heading" className="text-lg font-semibold">
            Privacy record counts
          </h2>
          <p className="text-sm text-muted-foreground">
            Each list shows at most {dashboard.boundedTo} records. The totals
            cover all records in the database.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[
            ["Data-subject requests", dashboard.totals.dataSubjectRequests],
            ["Consent records", dashboard.totals.consentRecords],
            ["Legal holds", dashboard.totals.legalHolds],
            ["Subprocessors", dashboard.totals.subprocessors],
            ["Cross-border transfers", dashboard.totals.crossBorderTransfers],
            ["Deletion actions", dashboard.totals.deletionActions],
          ].map(([label, total]) => (
            <Card key={label} className="shadow-none">
              <CardContent className="p-5">
                <p className="text-sm text-muted-foreground">{label}</p>
                <p className="mt-2 text-3xl font-semibold">{total}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {dashboard.blockers.length > 0 ? (
        <section
          aria-labelledby="privacy-blockers-heading"
          className="space-y-3"
        >
          <h2 id="privacy-blockers-heading" className="text-lg font-semibold">
            Operational blockers
          </h2>
          <ul className="space-y-2">
            {dashboard.blockers.map((blocker) => (
              <li
                key={blocker}
                className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950"
              >
                {blocker}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {workflowPanel}

      <Tabs defaultValue="requests" className="space-y-4">
        <TabsList className="h-auto flex-wrap justify-start">
          <TabsTrigger value="requests">Data rights</TabsTrigger>
          <TabsTrigger value="consents">Consent</TabsTrigger>
          <TabsTrigger value="holds">Holds</TabsTrigger>
          <TabsTrigger value="processors">Processors</TabsTrigger>
          <TabsTrigger value="transfers">Transfers</TabsTrigger>
          <TabsTrigger value="deletions">Deletion receipts</TabsTrigger>
        </TabsList>

        <TabsContent value="requests" className="space-y-3">
          {dashboard.dataSubjectRequests.length === 0 ? (
            <EmptyList label="data-subject requests" />
          ) : (
            dashboard.dataSubjectRequests.map((item) => (
              <Card key={item.id} className="shadow-none">
                <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
                  <div>
                    <CardTitle className="text-base capitalize">
                      {readable(item.requestType)} request
                    </CardTitle>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">
                      {item.id}
                    </p>
                  </div>
                  <StateBadge
                    state={
                      item.urgency === "overdue"
                        ? "expired"
                        : item.urgency === "due_soon"
                          ? "partial"
                          : "active"
                    }
                    label={readable(item.urgency)}
                  />
                </CardHeader>
                <CardContent className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <p className="text-xs text-muted-foreground">Status</p>
                    <p className="mt-1 capitalize">{readable(item.status)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Identity check
                    </p>
                    <p className="mt-1 capitalize">
                      {readable(item.identityVerificationStatus)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Assigned manager
                    </p>
                    <p className="mt-1 break-all font-mono text-xs">
                      {item.assignedToUserId ?? "Unassigned"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Due</p>
                    <p className="mt-1">{formattedDate(item.dueAt)}</p>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="consents" className="space-y-3">
          {dashboard.consentRecords.length === 0 ? (
            <EmptyList label="consent records" />
          ) : (
            dashboard.consentRecords.map((item) => (
              <Card key={item.id} className="shadow-none">
                <CardContent className="grid gap-4 p-5 text-sm sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Consent record
                    </p>
                    <p className="mt-1 break-all font-mono text-xs">
                      {item.id}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">State</p>
                    <p className="mt-1 capitalize">{item.state}</p>
                  </div>
                  <div>
                    <p className="mb-1 text-xs text-muted-foreground">
                      Capture evidence
                    </p>
                    <EvidenceBadge state={item.captureEvidenceState} />
                  </div>
                  <div>
                    <p className="mb-1 text-xs text-muted-foreground">
                      Withdrawal receipt
                    </p>
                    <EvidenceBadge state={item.withdrawalReceiptState} />
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="holds" className="space-y-3">
          {dashboard.legalHolds.length === 0 ? (
            <EmptyList label="legal holds" />
          ) : (
            dashboard.legalHolds.map((item) => (
              <Card key={item.id} className="shadow-none">
                <CardContent className="grid gap-4 p-5 text-sm sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <p className="text-xs text-muted-foreground">Hold</p>
                    <p className="mt-1 break-all font-mono text-xs">
                      {item.id}
                    </p>
                  </div>
                  <div>
                    <p className="mb-1 text-xs text-muted-foreground">
                      Review status
                    </p>
                    <ReviewBadge posture={item.reviewPosture} />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Last review decision
                    </p>
                    <p className="mt-1 capitalize">
                      {item.lastReviewOutcome
                        ? readable(item.lastReviewOutcome)
                        : "Not reviewed"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Next review</p>
                    <p className="mt-1">{formattedDate(item.nextReviewAt)}</p>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="processors" className="space-y-3">
          {dashboard.subprocessors.length === 0 ? (
            <EmptyList label="subprocessors" />
          ) : (
            dashboard.subprocessors.map((item) => (
              <Card key={item.id} className="shadow-none">
                <CardContent className="grid gap-4 p-5 text-sm sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <p className="font-medium">{item.legalName}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.service}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Country</p>
                    <p className="mt-1">{item.countryCode}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Data agreement / security review
                    </p>
                    <p className="mt-1 capitalize">
                      {readable(item.dpaStatus)} /{" "}
                      {readable(item.securityReviewStatus)}
                    </p>
                  </div>
                  <div>
                    <ReviewBadge posture={item.reviewPosture} />
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="transfers" className="space-y-3">
          {dashboard.crossBorderTransfers.length === 0 ? (
            <EmptyList label="cross-border transfers" />
          ) : (
            dashboard.crossBorderTransfers.map((item) => (
              <Card key={item.id} className="shadow-none">
                <CardContent className="grid gap-4 p-5 text-sm sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <p className="font-medium">
                      {item.originCountry} → {item.destinationCountry}
                    </p>
                    <p className="text-xs text-muted-foreground capitalize">
                      {readable(item.transferBasis)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Legal review
                    </p>
                    <p className="mt-1 capitalize">
                      {readable(item.legalReviewStatus)}
                    </p>
                  </div>
                  <div>
                    <EvidenceBadge state={item.approvalEvidenceState} />
                  </div>
                  <div>
                    <ReviewBadge posture={item.reviewPosture} />
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="deletions" className="space-y-3">
          {dashboard.deletionActions.length === 0 ? (
            <EmptyList label="deletion actions" />
          ) : (
            dashboard.deletionActions.map((item) => (
              <Card key={item.id} className="shadow-none">
                <CardContent className="grid gap-4 p-5 text-sm sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Deletion action
                    </p>
                    <p className="mt-1 break-all font-mono text-xs">
                      {item.id}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Status</p>
                    <p className="mt-1 capitalize">{readable(item.status)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Legal hold</p>
                    <p className="mt-1">{item.held ? "Held" : "Not held"}</p>
                  </div>
                  <div>
                    <EvidenceBadge
                      state={
                        item.receiptState === "recorded"
                          ? "verified"
                          : item.receiptState === "pending"
                            ? "missing"
                            : item.receiptState
                      }
                    />
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>

      <p className="text-xs text-muted-foreground">
        Last updated {formattedDate(dashboard.generatedAt)}. Requester and data
        subject references are not included.
      </p>
    </div>
  );
}
