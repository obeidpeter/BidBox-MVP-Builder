import { useMemo, useState } from "react";
import {
  useGetAccessReview,
  useGetLegacyIntegrityAssessment,
} from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DataErrorPanel,
  LoadingPanel,
  PageHeader,
  QueueCapabilityCard,
  StateBadge,
  StatusPanel,
} from "@/components/platform-states";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { formatWatInstant } from "@/lib/format";

function currentMonth(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    timeZone: "Africa/Lagos",
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  return year && month
    ? year + "-" + month
    : new Date().toISOString().slice(0, 7);
}

function auditTime(value: string): string {
  return formatWatInstant(value, { suffix: " WAT" });
}

export default function SecurityAudit() {
  const online = useOnlineStatus();
  const [month, setMonth] = useState(currentMonth);
  const query = useGetAccessReview({ month, format: "json" });
  const assessmentQuery = useGetLegacyIntegrityAssessment();
  const review = useMemo(
    () =>
      query.data && typeof query.data !== "string" ? query.data : undefined,
    [query.data],
  );
  const assessment = assessmentQuery.data?.[0];
  const reviewPending = query.isLoading || query.isPending;
  const assessmentPending =
    assessmentQuery.isLoading || assessmentQuery.isPending;
  const reviewUnavailable =
    query.isError || (!reviewPending && !query.isSuccess);
  const assessmentUnavailable =
    assessmentQuery.isError ||
    (!assessmentPending && !assessmentQuery.isSuccess);

  return (
    <div className="mx-auto w-full max-w-7xl space-y-7 p-5 sm:p-8">
      <PageHeader
        eyebrow="Restricted administration"
        title="Security & audit"
        description="Review who accessed organisation data and which security queues are available. Server rules remain the source of truth."
        state={
          !online
            ? "offline"
            : reviewUnavailable || assessmentUnavailable
              ? "error"
              : reviewPending || assessmentPending
                ? "pending"
                : "active"
        }
      />

      {assessmentPending ? (
        <LoadingPanel label="Loading legacy audit integrity assessment" />
      ) : assessmentUnavailable ? (
        <DataErrorPanel
          title="Legacy integrity assessment could not be loaded"
          description="We could not load the stored legacy audit assessment. Do not assume the older audit chain is intact. Check your connection and access, then try again."
          onRetry={() => void assessmentQuery.refetch()}
        />
      ) : assessment ? (
        <StatusPanel
          state="pending"
          title="Recorded gap in the legacy v1 audit chain"
          description={assessment.finding}
        >
          <dl className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Preserved events
              </dt>
              <dd className="mt-1 font-mono">{assessment.sourceEventCount}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Payload hashes verified
              </dt>
              <dd className="mt-1 font-mono">{assessment.verifiedRanges}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Known discontinuity
              </dt>
              <dd className="mt-1 font-mono">
                {assessment.discontinuityRanges}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Assessed
              </dt>
              <dd className="mt-1">{auditTime(assessment.assessedAt)}</dd>
            </div>
          </dl>
          {assessment.probableCause ? (
            <p className="mt-4 border-t border-amber-200 pt-3 text-xs leading-5 text-muted-foreground">
              Recorded probable cause: {assessment.probableCause}
            </p>
          ) : null}
        </StatusPanel>
      ) : (
        <StatusPanel
          state="empty"
          title="No legacy integrity assessment is stored"
          description="No legacy assessment was returned for this organisation. This does not prove that the older audit chain is intact."
        />
      )}

      <section
        aria-labelledby="security-controls-heading"
        className="space-y-4"
      >
        <h2
          id="security-controls-heading"
          className="font-serif text-xl font-semibold"
        >
          Security controls available here
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <QueueCapabilityCard
            title="Access review"
            description="Monthly access records are available below."
            state="active"
          />
          <QueueCapabilityCard
            title="Emergency access"
            description="Emergency-access requests, independent approval and closure evidence are not available here."
            state="unavailable"
          />
          <QueueCapabilityCard
            title="Retention and deletion"
            description="Retention settings are available. Legal holds, deletion certificates and data-rights request queues are not connected here."
            state="partial"
          />
          <QueueCapabilityCard
            title="Security events"
            description="Incident and unusual-access review is not available here."
            state="unavailable"
          />
        </div>
      </section>

      <section aria-labelledby="access-review-heading" className="space-y-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2
              id="access-review-heading"
              className="font-serif text-xl font-semibold"
            >
              Monthly access review
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              The server returns access records for the selected month.
            </p>
          </div>
          <div className="w-full max-w-48 space-y-2">
            <Label htmlFor="access-review-month">Reporting month</Label>
            <Input
              id="access-review-month"
              type="month"
              value={month}
              max={currentMonth()}
              onChange={(event) => {
                if (/^\d{4}-\d{2}$/.test(event.target.value))
                  setMonth(event.target.value);
              }}
            />
          </div>
        </div>

        {reviewPending ? (
          <LoadingPanel label="Loading monthly access review" />
        ) : null}
        {reviewUnavailable ? (
          <DataErrorPanel
            title="Access review could not be loaded"
            description="Missing records do not prove that no access occurred. Check your connection and access, then try again."
            onRetry={() => void query.refetch()}
          />
        ) : null}
        {query.data && typeof query.data === "string" ? (
          <DataErrorPanel
            title="The access report has an unexpected format"
            description="The server returned text instead of the requested structured report, so no records are shown."
          />
        ) : null}

        {review && review.rows.length > 0 ? (
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full min-w-[920px] text-left text-sm">
              <caption className="sr-only">
                Attributed access events for {review.month}
              </caption>
              <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Time
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Person
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Client / project
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Action
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Object
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Details
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Audit source
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {review.rows.map((row, index) => (
                  <tr key={row.at + "-" + row.objectId + "-" + index}>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">
                      {auditTime(row.at)}
                    </td>
                    <td className="px-4 py-3">
                      {row.actor || "Person unavailable"}
                    </td>
                    <td className="px-4 py-3">
                      <span className="block">
                        {row.client || "Client unavailable"}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {row.project || "Project unavailable"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <StateBadge
                        state="active"
                        label={row.action || "Recorded"}
                      />
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <span className="block">
                        {row.objectType || "Object"}
                      </span>
                      <span className="block font-mono text-muted-foreground">
                        {row.objectId || "ID unavailable"}
                      </span>
                    </td>
                    <td className="max-w-sm px-4 py-3 text-xs text-muted-foreground">
                      {row.details || "No additional detail"}
                    </td>
                    <td className="px-4 py-3">
                      <StateBadge
                        state={
                          row.auditSource === "legacy_v1_archive"
                            ? "pending"
                            : "partial"
                        }
                        label={
                          row.auditSource === "legacy_v1_archive"
                            ? `Legacy v1 · ${row.integrityStatus.replace(/_/g, " ")}`
                            : "Active v2 chain record"
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : review && review.rows.length === 0 ? (
          <StatusPanel
            state="empty"
            title="No access records returned"
            description="The report is empty. Before treating this as no access, confirm that audit collection and protected storage are working."
          />
        ) : null}
      </section>
    </div>
  );
}
