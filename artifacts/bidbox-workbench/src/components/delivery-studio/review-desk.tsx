import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, BookOpenCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { formatWatInstant, humaniseTokenCapitalised } from "@/lib/format";

type ReviewDeskCitation = {
  id: string;
  documentVersionId: string | null;
  evidenceCitation: string;
  evidenceHash: string;
};

type ReviewDeskClaim = {
  id: string;
  claimKey: string;
  text: string;
  kind: string;
  supportMode: string | null;
  groundingStatus: string;
  reviewerUserId: string | null;
  citations: ReviewDeskCitation[];
};

type ReviewDeskSection = {
  id: string;
  sectionKey: string;
  title: string;
  status: string;
  currentVersionNumber: number;
  version: {
    id: string;
    content: string;
    contentHash: string;
    authorUserId: string | null;
    claims: ReviewDeskClaim[];
  } | null;
};

type ReviewDeskFinding = {
  id: string;
  category: string;
  severity: string;
  finding: string;
  status: string;
};

type ReviewDeskRun = {
  id: string;
  status: string;
  sourceSnapshotHash: string;
  policyVersion: string;
  initiatedByUserId: string | null;
  approvedByUserId: string | null;
  approvedAt: string | null;
  createdAt: string;
  findings: ReviewDeskFinding[];
};

function shortIdentifier(value: string | null | undefined): string {
  if (!value) return "Not recorded";
  return value.length > 24
    ? `${value.slice(0, 12)}…${value.slice(-10)}`
    : value;
}

export function ReviewDesk({
  sections,
  redTeamRun,
  redTeamStatus,
  sourceSnapshotHash,
}: {
  sections: ReviewDeskSection[];
  redTeamRun: ReviewDeskRun | null;
  redTeamStatus: string;
  sourceSnapshotHash: string;
}) {
  const reviewItems = useMemo(
    () =>
      sections.flatMap((section) =>
        (section.version?.claims ?? []).map((claim) => ({ section, claim })),
      ),
    [sections],
  );
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    setSelectedIndex((current) =>
      Math.min(current, Math.max(reviewItems.length - 1, 0)),
    );
  }, [reviewItems.length]);

  const selected = reviewItems[selectedIndex];

  return (
    <Card className="shadow-none" aria-labelledby="delivery-review-desk-title">
      <CardHeader className="border-b border-border pb-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex gap-3">
            <div className="mt-0.5 rounded-lg border border-border bg-muted/50 p-2">
              <BookOpenCheck aria-hidden="true" className="size-5" />
            </div>
            <div>
              <h2
                id="delivery-review-desk-title"
                className="text-lg font-semibold tracking-tight"
              >
                Review Desk
              </h2>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
                Compare the recorded source context, response claim and review
                provenance without leaving the current delivery snapshot.
              </p>
            </div>
          </div>
          {selected ? (
            <div className="flex shrink-0 items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                aria-label="Previous review claim"
                onClick={() => setSelectedIndex((current) => current - 1)}
                disabled={selectedIndex === 0}
              >
                <ArrowLeft aria-hidden="true" className="mr-1 size-4" />
                Previous
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                aria-label="Next review claim"
                onClick={() => setSelectedIndex((current) => current + 1)}
                disabled={selectedIndex === reviewItems.length - 1}
              >
                Next
                <ArrowRight aria-hidden="true" className="ml-1 size-4" />
              </Button>
            </div>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="p-5 sm:p-6">
        {!selected ? (
          <p className="text-sm leading-6 text-muted-foreground">
            No explicit response claims are available to compare. This empty
            desk does not imply that a response or review has passed.
          </p>
        ) : (
          <>
            <p
              className="mb-4 text-sm text-muted-foreground"
              aria-live="polite"
            >
              Claim {selectedIndex + 1} of {reviewItems.length} ·{" "}
              <span className="font-mono">{selected.claim.claimKey}</span>
            </p>
            <div className="grid gap-4 lg:grid-cols-3">
              <section
                aria-labelledby="review-desk-source-title"
                className="min-w-0 rounded-lg border border-border bg-muted/15 p-4"
              >
                <h3
                  id="review-desk-source-title"
                  className="text-sm font-semibold"
                >
                  Source and citation
                </h3>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Source snapshot{" "}
                  <span
                    className="font-mono text-foreground"
                    title={sourceSnapshotHash}
                  >
                    {shortIdentifier(sourceSnapshotHash)}
                  </span>
                </p>
                {selected.claim.citations.length === 0 ? (
                  <p className="mt-4 text-sm leading-6 text-muted-foreground">
                    No source citation is recorded for this claim.
                  </p>
                ) : (
                  <ol className="mt-4 space-y-3">
                    {selected.claim.citations.map((citation, index) => (
                      <li
                        key={citation.id}
                        className="rounded-md border border-border bg-background p-3 text-sm"
                      >
                        <p className="font-medium">Citation {index + 1}</p>
                        <p className="mt-1 leading-6">
                          {citation.evidenceCitation}
                        </p>
                        <dl className="mt-3 grid gap-2 text-xs">
                          <div>
                            <dt className="text-muted-foreground">
                              Document version
                            </dt>
                            <dd
                              className="mt-0.5 break-all font-mono"
                              title={citation.documentVersionId ?? undefined}
                            >
                              {citation.documentVersionId ?? "Not recorded"}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-muted-foreground">
                              Evidence hash
                            </dt>
                            <dd
                              className="mt-0.5 break-all font-mono"
                              title={citation.evidenceHash}
                            >
                              {citation.evidenceHash}
                            </dd>
                          </div>
                        </dl>
                      </li>
                    ))}
                  </ol>
                )}
              </section>

              <section
                aria-labelledby="review-desk-response-title"
                className="min-w-0 rounded-lg border border-border bg-muted/15 p-4"
              >
                <h3
                  id="review-desk-response-title"
                  className="text-sm font-semibold"
                >
                  Response and claim
                </h3>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Badge variant="outline">
                    {humaniseTokenCapitalised(selected.claim.kind)}
                  </Badge>
                  <Badge variant="secondary">
                    {humaniseTokenCapitalised(selected.claim.groundingStatus)}
                  </Badge>
                  {selected.claim.supportMode ? (
                    <Badge variant="outline">
                      {humaniseTokenCapitalised(selected.claim.supportMode)}
                    </Badge>
                  ) : null}
                </div>
                <p className="mt-4 text-sm font-medium leading-6">
                  {selected.claim.text}
                </p>
                <dl className="mt-4 grid gap-3 text-xs">
                  <div>
                    <dt className="text-muted-foreground">Response section</dt>
                    <dd className="mt-0.5 font-medium">
                      {selected.section.title} v
                      {selected.section.currentVersionNumber}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Response version</dt>
                    <dd className="mt-0.5 break-all font-mono">
                      {selected.section.version?.id ?? "Not recorded"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Content hash</dt>
                    <dd
                      className="mt-0.5 break-all font-mono"
                      title={selected.section.version?.contentHash}
                    >
                      {selected.section.version?.contentHash ?? "Not recorded"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Author</dt>
                    <dd className="mt-0.5 break-all font-mono">
                      {selected.section.version?.authorUserId ?? "Not recorded"}
                    </dd>
                  </div>
                </dl>
                <details className="mt-4 rounded-md border border-border bg-background p-3 text-sm">
                  <summary className="cursor-pointer font-medium">
                    Response content context
                  </summary>
                  <p className="mt-3 whitespace-pre-wrap leading-6">
                    {selected.section.version?.content ||
                      "No current response content is recorded."}
                  </p>
                </details>
              </section>

              <section
                aria-labelledby="review-desk-review-title"
                className="min-w-0 rounded-lg border border-border bg-muted/15 p-4"
              >
                <h3
                  id="review-desk-review-title"
                  className="text-sm font-semibold"
                >
                  Red-team and review
                </h3>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Badge variant="secondary">
                    {humaniseTokenCapitalised(redTeamStatus)}
                  </Badge>
                  <Badge variant="outline">
                    Claim reviewer:{" "}
                    {shortIdentifier(selected.claim.reviewerUserId)}
                  </Badge>
                </div>
                {!redTeamRun ? (
                  <p className="mt-4 text-sm leading-6 text-muted-foreground">
                    No red-team run is recorded for this response snapshot.
                  </p>
                ) : (
                  <>
                    <dl className="mt-4 grid gap-3 text-xs">
                      <div>
                        <dt className="text-muted-foreground">Review run</dt>
                        <dd className="mt-0.5 break-all font-mono">
                          {redTeamRun.id}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">
                          Policy version
                        </dt>
                        <dd className="mt-0.5 font-medium">
                          {redTeamRun.policyVersion}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">
                          Reviewed source snapshot
                        </dt>
                        <dd
                          className="mt-0.5 break-all font-mono"
                          title={redTeamRun.sourceSnapshotHash}
                        >
                          {redTeamRun.sourceSnapshotHash}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Started</dt>
                        <dd className="mt-0.5">
                          {formatWatInstant(redTeamRun.createdAt, {
                            suffix: " WAT",
                          })}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Approval</dt>
                        <dd className="mt-0.5">
                          {redTeamRun.approvedAt
                            ? `${formatWatInstant(redTeamRun.approvedAt, { suffix: " WAT" })} by ${shortIdentifier(redTeamRun.approvedByUserId)}`
                            : "Not recorded"}
                        </dd>
                      </div>
                    </dl>
                    <div className="mt-4">
                      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Run findings ({redTeamRun.findings.length})
                      </p>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        The current projection does not link individual findings
                        to one claim, so all findings from this review run are
                        shown.
                      </p>
                      {redTeamRun.findings.length > 0 ? (
                        <ul className="mt-2 space-y-2">
                          {redTeamRun.findings.map((finding) => (
                            <li
                              key={finding.id}
                              className="rounded-md border border-border bg-background p-3 text-sm"
                            >
                              <div className="flex flex-wrap gap-2">
                                <Badge variant="outline">
                                  {humaniseTokenCapitalised(finding.severity)}
                                </Badge>
                                <Badge variant="secondary">
                                  {humaniseTokenCapitalised(finding.status)}
                                </Badge>
                              </div>
                              <p className="mt-2 leading-6">
                                {finding.finding}
                              </p>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-2 text-sm text-muted-foreground">
                          No findings are recorded on this run.
                        </p>
                      )}
                    </div>
                  </>
                )}
              </section>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
