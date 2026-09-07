import { useState, type FormEvent } from "react";
import { ExternalLink } from "lucide-react";
import {
  PageHeader,
  StateBadge,
  StatusPanel,
} from "@/components/platform-states";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type {
  ManualOpportunitySourceDraft,
  OpportunitySourceCandidate,
  OpportunitySourceSnapshot,
} from "./opportunity-source-contract";
import { OpportunityPursuitHandoffWorkflow } from "./opportunity-pursuit-handoff-workflow";
import { formatWatInstant } from "@/lib/format";

export interface OpportunitySourceConsoleProps {
  snapshot: OpportunitySourceSnapshot;
  canManage: boolean;
  pending: boolean;
  onRecord: (draft: ManualOpportunitySourceDraft) => Promise<void>;
  onDecision: (
    candidate: OpportunitySourceCandidate,
    decision: "accept" | "reject",
    reason: string,
  ) => Promise<void>;
}

function displayDate(value: string | null): string {
  return formatWatInstant(value, { empty: "Not recorded" });
}

function ManualSourceForm({
  pending,
  capacityReached,
  onRecord,
}: Pick<OpportunitySourceConsoleProps, "pending" | "onRecord"> & {
  capacityReached: boolean;
}) {
  const [deadline, setDeadline] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (capacityReached) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const optional = (key: string) =>
      String(values.get(key) ?? "").trim() || null;
    try {
      await onRecord({
        sourceKind: "manual_url",
        sourceSystem: String(values.get("sourceSystem") ?? "").trim(),
        sourceAuthority: String(values.get("sourceAuthority") ?? "").trim(),
        sourceLocator: String(values.get("sourceLocator") ?? "").trim(),
        sourceLicenceReference: optional("sourceLicenceReference"),
        externalReference: String(values.get("externalReference") ?? "").trim(),
        title: String(values.get("title") ?? "").trim(),
        procuringEntity: String(values.get("procuringEntity") ?? "").trim(),
        jurisdiction: "NG",
        fundingSource: optional("fundingSource"),
        procurementCategory: optional("procurementCategory"),
        publishedAt: null,
        submissionDeadline: deadline ? new Date(deadline).toISOString() : null,
        observedAt: new Date().toISOString(),
        sourceContentSha256: null,
      });
    } catch {
      return;
    }
    form.reset();
    setDeadline("");
  }

  return (
    <Card className="shadow-none">
      <CardContent className="p-5">
        <h2 className="text-lg font-semibold">Record an official source URL</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Record metadata only. Do not paste notice text, signed URLs,
          credentials or personal data.
        </p>
        <form className="mt-5 grid gap-4 sm:grid-cols-2" onSubmit={submit}>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="sourceLocator">Official HTTPS URL</Label>
            <Input
              id="sourceLocator"
              name="sourceLocator"
              type="url"
              required
              className="min-h-11"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sourceAuthority">Publishing authority</Label>
            <Input
              id="sourceAuthority"
              name="sourceAuthority"
              required
              maxLength={512}
              className="min-h-11"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sourceSystem">Source system ID</Label>
            <Input
              id="sourceSystem"
              name="sourceSystem"
              required
              maxLength={128}
              placeholder="bpp_nocopo"
              className="min-h-11"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="externalReference">Tender reference</Label>
            <Input
              id="externalReference"
              name="externalReference"
              required
              maxLength={128}
              className="min-h-11"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="submissionDeadline">Recorded deadline</Label>
            <Input
              id="submissionDeadline"
              type="datetime-local"
              value={deadline}
              onChange={(event) => setDeadline(event.target.value)}
              className="min-h-11"
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="title">Opportunity title</Label>
            <Input
              id="title"
              name="title"
              required
              maxLength={512}
              className="min-h-11"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="procuringEntity">Procuring entity</Label>
            <Input
              id="procuringEntity"
              name="procuringEntity"
              required
              maxLength={512}
              className="min-h-11"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="procurementCategory">Category (optional)</Label>
            <Input
              id="procurementCategory"
              name="procurementCategory"
              maxLength={512}
              className="min-h-11"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="fundingSource">Funding source (optional)</Label>
            <Input
              id="fundingSource"
              name="fundingSource"
              maxLength={512}
              className="min-h-11"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sourceLicenceReference">
              Licence/publication note (optional)
            </Label>
            <Input
              id="sourceLicenceReference"
              name="sourceLicenceReference"
              maxLength={1024}
              className="min-h-11"
            />
          </div>
          <Button
            type="submit"
            className="min-h-11 sm:col-span-2"
            disabled={pending || capacityReached}
          >
            {capacityReached
              ? "Pilot register is full"
              : pending
                ? "Recording…"
                : "Record for human review"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function CandidateCard({
  candidate,
  canManage,
  pending,
  onDecision,
}: {
  candidate: OpportunitySourceCandidate;
  canManage: boolean;
  pending: boolean;
  onDecision: OpportunitySourceConsoleProps["onDecision"];
}) {
  const [reason, setReason] = useState("");
  const decide = async (decision: "accept" | "reject") => {
    try {
      await onDecision(candidate, decision, reason.trim());
    } catch {
      // The route owns user-facing mutation errors. Consuming the rejection
      // here keeps React event handlers from producing unhandled promises.
    }
  };
  const state =
    candidate.status === "accepted"
      ? "active"
      : candidate.status === "rejected"
        ? "blocked"
        : "pending";
  return (
    <Card className="shadow-none">
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {candidate.sourceAuthority}
            </p>
            <h3 className="mt-1 font-semibold">{candidate.title}</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {candidate.procuringEntity}
            </p>
          </div>
          <StateBadge
            state={state}
            label={candidate.status.replace("_", " ")}
          />
        </div>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted-foreground">Reference</dt>
            <dd className="mt-1 break-all">{candidate.externalReference}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Deadline</dt>
            <dd className="mt-1">
              {displayDate(candidate.submissionDeadline)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Source record</dt>
            <dd className="mt-1">
              {candidate.provenance === "operator_recorded"
                ? "Recorded by operator"
                : "Verified by connected source"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Recorded by</dt>
            <dd className="mt-1">{candidate.recordedByName}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs text-muted-foreground">
              Receipt fingerprint
            </dt>
            <dd className="mt-1 break-all font-mono text-xs">
              {candidate.receiptSha256}
            </dd>
          </div>
        </dl>
        <a
          href={candidate.sourceLocator}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-11 items-center gap-2 rounded-md px-1 text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Inspect the recorded source{" "}
          <ExternalLink className="size-4" aria-hidden="true" />
        </a>
        {candidate.status === "pending_review" && canManage ? (
          <div className="space-y-3 border-t pt-4">
            <Label htmlFor={`reason-${candidate.id}`}>
              Reason for decision
            </Label>
            <Textarea
              id={`reason-${candidate.id}`}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={1024}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                className="min-h-11"
                disabled={pending || !reason.trim()}
                onClick={() => void decide("accept")}
              >
                Accept source record
              </Button>
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                disabled={pending || !reason.trim()}
                onClick={() => void decide("reject")}
              >
                Reject source record
              </Button>
            </div>
          </div>
        ) : null}
        {candidate.decisionReason ? (
          <p className="rounded-md bg-muted p-3 text-sm">
            <span className="font-medium">Decision:</span>{" "}
            {candidate.decisionReason}
          </p>
        ) : null}
        {candidate.status === "accepted" && canManage ? (
          <div className="border-t pt-4">
            <OpportunityPursuitHandoffWorkflow
              organisationId={candidate.organisationId}
              candidateId={candidate.id}
            />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function OpportunitySourceConsole(props: OpportunitySourceConsoleProps) {
  const pendingCount = props.snapshot.items.filter(
    ({ status }) => status === "pending_review",
  ).length;
  const capacityReached = props.snapshot.items.length >= props.snapshot.limit;
  return (
    <div className="mx-auto w-full max-w-7xl space-y-7 p-5 sm:p-8">
      <PageHeader
        eyebrow="Official sources"
        title="Opportunity sources"
        description="Record official source details, avoid duplicates and require a named person to confirm each opportunity. Valo never scrapes a source, qualifies an opportunity or starts a pursuit automatically."
        state={pendingCount ? "pending" : "active"}
      />
      <StatusPanel
        state="partial"
        title="Recorded source details need human review"
        description="Automatic source connections are off. Recorded links and details are for human review only; they are not instructions, endorsements or confirmed tender terms."
      />
      <StatusPanel
        state="partial"
        title="Pilot record limit"
        description={`This pilot stores up to ${props.snapshot.limit} source records per organisation and cannot archive them in the app. Pause intake before reaching the limit and use an approved retention migration. Never delete audit history to create space.`}
      />
      {props.canManage ? (
        <ManualSourceForm
          pending={props.pending}
          capacityReached={capacityReached}
          onRecord={props.onRecord}
        />
      ) : null}
      <section aria-labelledby="source-inbox-heading" className="space-y-4">
        <div>
          <h2 id="source-inbox-heading" className="text-lg font-semibold">
            Source review inbox
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {pendingCount} pending of {props.snapshot.items.length} source
            records.
          </p>
        </div>
        {props.snapshot.items.length ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {props.snapshot.items.map((candidate) => (
              <CandidateCard
                key={candidate.id}
                candidate={candidate}
                canManage={props.canManage}
                pending={props.pending}
                onDecision={props.onDecision}
              />
            ))}
          </div>
        ) : (
          <StatusPanel
            state="empty"
            title="No source receipts recorded"
            description="Use the form above to record an official HTTPS source for review by a named person."
          />
        )}
      </section>
    </div>
  );
}
