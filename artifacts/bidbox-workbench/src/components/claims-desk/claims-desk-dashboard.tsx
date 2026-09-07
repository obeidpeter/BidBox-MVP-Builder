import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  FileCheck2,
  Scale,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ClaimsDeskSnapshot } from "./claims-desk-contract";
import { humaniseTokenCapitalised as label } from "@/lib/format";

function minorAmount(amount: number | null, currency: string | null): string {
  if (amount === null || !currency) return "No amount recorded";
  return `${currency} ${amount.toLocaleString()} minor units`;
}

export function ClaimsDeskDashboard({
  snapshot,
}: {
  snapshot: ClaimsDeskSnapshot;
}) {
  const metrics = [
    { label: "Open records", value: snapshot.posture.open, icon: FileCheck2 },
    { label: "Overdue", value: snapshot.posture.overdue, icon: AlertTriangle },
    { label: "Due in 7 days", value: snapshot.posture.dueSoon, icon: Clock3 },
    {
      label: "Awaiting second review",
      value: snapshot.posture.awaitingChecker,
      icon: Scale,
    },
    { label: "Closed", value: snapshot.posture.terminal, icon: CheckCircle2 },
  ] as const;

  return (
    <section aria-labelledby="claims-desk-title" className="space-y-6">
      <div className="overflow-hidden rounded-3xl border border-sidebar-border bg-sidebar p-6 text-sidebar-foreground sm:p-8">
        <div className="max-w-3xl space-y-3">
          <Badge className="bg-sidebar-accent text-sidebar-foreground hover:bg-sidebar-accent">
            Project record · {label(snapshot.projectStatus)}
          </Badge>
          <h1
            id="claims-desk-title"
            className="text-3xl font-semibold tracking-tight sm:text-4xl"
          >
            Claims
          </h1>
          <p className="text-sm leading-6 text-sidebar-foreground/80 sm:text-base">
            {snapshot.authorityNote}
          </p>
        </div>
      </div>

      <div
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"
        aria-label="Claims summary"
      >
        {metrics.map(({ label: metricLabel, value, icon: Icon }) => (
          <Card key={metricLabel}>
            <CardContent className="flex items-center justify-between p-5">
              <div>
                <p className="text-sm text-muted-foreground">{metricLabel}</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">
                  {value}
                </p>
              </div>
              <Icon aria-hidden="true" className="size-5 text-primary" />
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Project records</CardTitle>
        </CardHeader>
        <CardContent>
          {snapshot.records.length === 0 ? (
            <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
              No claims evidence has been recorded for this project.
            </div>
          ) : (
            <div className="space-y-3">
              {snapshot.records.map((record) => (
                <article
                  key={record.id}
                  className="rounded-2xl border bg-muted/20 p-4"
                  aria-label={`${label(record.recordType)} ${record.reference}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-medium">{record.reference}</h3>
                        <Badge variant="outline">
                          {label(record.recordType)}
                        </Badge>
                        <Badge>{label(record.status)}</Badge>
                      </div>
                      <p className="mt-2 text-sm text-muted-foreground">
                        Event date {record.eventDate}
                        {record.dueAt
                          ? ` · Due ${new Date(record.dueAt).toLocaleString()}`
                          : ""}
                      </p>
                    </div>
                    <div className="text-right text-sm">
                      <p className="font-medium tabular-nums">
                        {minorAmount(record.amountMinor, record.currency)}
                      </p>
                      <p className="text-muted-foreground">
                        Version {record.version}
                      </p>
                    </div>
                  </div>
                  <dl className="mt-4 grid gap-3 text-xs text-muted-foreground sm:grid-cols-3">
                    <div>
                      <dt>Approved document evidence</dt>
                      <dd className="mt-1 font-mono text-foreground">
                        {record.documentBindings.length} document
                        {record.documentBindings.length === 1 ? "" : "s"}
                      </dd>
                    </div>
                    <div>
                      <dt>Latest receipt</dt>
                      <dd
                        className="mt-1 font-mono text-foreground"
                        title={record.latestReceiptSha256}
                      >
                        {record.latestReceiptSha256.slice(0, 16)}…
                      </dd>
                    </div>
                    <div>
                      <dt>Last recorded</dt>
                      <dd className="mt-1 text-foreground">
                        {new Date(record.updatedAt).toLocaleString()}
                      </dd>
                    </div>
                  </dl>
                  {record.reasonHistory.length > 0 ? (
                    <details className="mt-4 text-sm">
                      <summary className="cursor-pointer font-medium">
                        Reason history ({record.reasonHistory.length})
                      </summary>
                      <ol className="mt-3 space-y-2 border-l pl-4">
                        {record.reasonHistory.map((entry) => (
                          <li key={entry.receiptSha256}>
                            <span className="font-medium">
                              {label(entry.action)}
                            </span>{" "}
                            · {label(entry.reasonCode)} ·{" "}
                            {label(entry.fromStatus)} → {label(entry.toStatus)}
                            <div className="font-mono text-xs text-muted-foreground">
                              {entry.actorUserId.slice(0, 8)} ·{" "}
                              {entry.receiptSha256.slice(0, 12)}…
                            </div>
                          </li>
                        ))}
                      </ol>
                    </details>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
