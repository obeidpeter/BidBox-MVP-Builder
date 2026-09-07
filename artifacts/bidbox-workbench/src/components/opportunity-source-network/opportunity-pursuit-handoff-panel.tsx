import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ExternalLink, ShieldCheck } from "lucide-react";
import { StateBadge, StatusPanel } from "@/components/platform-states";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type {
  OpportunityPursuitHandoffConfirmation,
  OpportunityPursuitHandoffPreparation,
  ReadyOpportunityPursuitHandoff,
} from "./opportunity-pursuit-handoff-contract";

export interface OpportunityPursuitHandoffPanelProps {
  preparation: OpportunityPursuitHandoffPreparation;
  pending: boolean;
  onConfirm: (
    candidateId: string,
    confirmation: OpportunityPursuitHandoffConfirmation,
  ) => Promise<void>;
}

function HandoffForm({
  preparation,
  pending,
  onConfirm,
}: {
  preparation: ReadyOpportunityPursuitHandoff;
  pending: boolean;
  onConfirm: OpportunityPursuitHandoffPanelProps["onConfirm"];
}) {
  const firstClient = preparation.clients[0]?.id ?? "";
  const firstReviewer = preparation.reviewers[0]?.userId ?? "";
  const [clientId, setClientId] = useState(firstClient);
  const [reviewerUserId, setReviewerUserId] = useState(firstReviewer);
  const [lotId, setLotId] = useState("");
  const [buyer, setBuyer] = useState(preparation.source.buyer);
  const [reference, setReference] = useState(preparation.source.reference);
  const [deadline, setDeadline] = useState(
    preparation.source.submissionDeadline ?? "",
  );
  const [sourceReopened, setSourceReopened] = useState(false);
  const selectedClient =
    preparation.clients.find(({ id }) => id === clientId) ?? null;
  const selectedLot = preparation.lots.find(({ id }) => id === lotId) ?? null;
  const effectiveLot = selectedLot?.reference ?? null;
  const selectedConflict = useMemo(
    () =>
      preparation.conflictBoundary.matches.find(
        (match) => (match.lot ?? "") === (effectiveLot ?? ""),
      ) ?? null,
    [effectiveLot, preparation.conflictBoundary.matches],
  );

  useEffect(() => {
    setDeadline(
      selectedLot?.submissionDeadline ??
        preparation.source.submissionDeadline ??
        "",
    );
  }, [preparation.source.submissionDeadline, selectedLot]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !sourceReopened ||
      !selectedClient ||
      !reviewerUserId ||
      selectedConflict
    ) {
      return;
    }
    const form = new FormData(event.currentTarget);
    try {
      await onConfirm(preparation.source.candidateId, {
        expectedCandidateVersion: preparation.source.candidateVersion,
        expectedSourceReceiptSha256: preparation.source.sourceReceiptSha256,
        expectedTenderVersion: preparation.source.tenderVersion,
        expectedConflictBoundarySha256: preparation.conflictBoundary.sha256,
        clientId: selectedClient.id,
        expectedClientVersion: selectedClient.version,
        tenderLotId: selectedLot?.id ?? null,
        expectedTenderLotVersion: selectedLot?.version ?? null,
        confirmedLotReference: selectedLot?.reference ?? null,
        reviewerUserId,
        officialSourceReopened: true,
        confirmedBuyer: buyer.trim(),
        confirmedReference: reference.trim(),
        confirmedSubmissionDeadline: deadline.trim() || null,
        confirmationNote: String(form.get("confirmationNote") ?? "").trim(),
      });
    } catch {
      // The workflow owns the visible mutation error and idempotency digest.
      // Keep this exact confirmation intact so the named human can reconcile
      // the authoritative result and retry without leaking an event promise.
    }
  }

  const missingChoices =
    preparation.clients.length === 0 || preparation.reviewers.length === 0;
  return (
    <Card className="shadow-none">
      <CardContent className="space-y-5 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Manual confirmation
            </p>
            <h3 className="mt-1 text-lg font-semibold">
              Create a draft pursuit
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              This creates a draft intake record only. It does not activate a
              pursuit, contact a provider or open an external portal.
            </p>
          </div>
          <StateBadge state="pending" label="Confirmation required" />
        </div>

        <a
          href={preparation.source.sourceLocator}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-11 items-center gap-2 rounded-md text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Reopen the official source
          <ExternalLink className="size-4" aria-hidden="true" />
        </a>

        {missingChoices ? (
          <StatusPanel
            state="blocked"
            title="Client and independent reviewer required"
            description="Add a client to this organisation and choose a different active reviewer before confirming this handoff."
          />
        ) : null}
        {selectedConflict ? (
          <StatusPanel
            state="blocked"
            title="Current tender and lot conflict"
            description={`Project ${selectedConflict.projectId} already occupies this tender and lot. Resolve that conflict before creating another pursuit.`}
          />
        ) : null}

        <form className="grid gap-4 sm:grid-cols-2" onSubmit={submit}>
          <div className="space-y-2">
            <Label htmlFor={`handoff-client-${preparation.source.candidateId}`}>
              Client
            </Label>
            <select
              id={`handoff-client-${preparation.source.candidateId}`}
              className="flex min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
              required
            >
              <option value="">Select client</option>
              {preparation.clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label
              htmlFor={`handoff-reviewer-${preparation.source.candidateId}`}
            >
              Independent named reviewer
            </Label>
            <select
              id={`handoff-reviewer-${preparation.source.candidateId}`}
              className="flex min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={reviewerUserId}
              onChange={(event) => setReviewerUserId(event.target.value)}
              required
            >
              <option value="">Select reviewer</option>
              {preparation.reviewers.map((reviewer) => (
                <option key={reviewer.userId} value={reviewer.userId}>
                  {reviewer.name}
                </option>
              ))}
            </select>
          </div>
          {preparation.lots.length ? (
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor={`handoff-lot-${preparation.source.candidateId}`}>
                Tender lot
              </Label>
              <select
                id={`handoff-lot-${preparation.source.candidateId}`}
                className="flex min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={lotId}
                onChange={(event) => setLotId(event.target.value)}
              >
                <option value="">Whole tender / no lot</option>
                {preparation.lots.map((lot) => (
                  <option key={lot.id} value={lot.id}>
                    {lot.reference}
                    {lot.title ? ` — ${lot.title}` : ""}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor={`handoff-buyer-${preparation.source.candidateId}`}>
              Buyer confirmed from official source
            </Label>
            <Input
              id={`handoff-buyer-${preparation.source.candidateId}`}
              value={buyer}
              onChange={(event) => setBuyer(event.target.value)}
              maxLength={512}
              required
              className="min-h-11"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`handoff-ref-${preparation.source.candidateId}`}>
              Reference confirmed
            </Label>
            <Input
              id={`handoff-ref-${preparation.source.candidateId}`}
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              maxLength={128}
              required
              className="min-h-11"
            />
          </div>
          <div className="space-y-2">
            <Label
              htmlFor={`handoff-deadline-${preparation.source.candidateId}`}
            >
              Confirmed deadline (ISO 8601; leave blank if none)
            </Label>
            <Input
              id={`handoff-deadline-${preparation.source.candidateId}`}
              value={deadline}
              onChange={(event) => setDeadline(event.target.value)}
              placeholder="2026-09-01T12:00:00.000Z"
              className="min-h-11"
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor={`handoff-note-${preparation.source.candidateId}`}>
              Confirmation note
            </Label>
            <Textarea
              id={`handoff-note-${preparation.source.candidateId}`}
              name="confirmationNote"
              maxLength={1024}
              required
              placeholder="State what you checked on the reopened official source."
            />
          </div>
          <label className="flex min-h-11 items-start gap-3 rounded-md border p-3 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={sourceReopened}
              onChange={(event) => setSourceReopened(event.target.checked)}
              className="mt-0.5 size-4"
            />
            <span>
              I reopened the official source and personally confirmed the buyer,
              reference, selected lot and deadline shown above.
            </span>
          </label>
          <Button
            type="submit"
            className="min-h-11 sm:col-span-2"
            disabled={
              pending ||
              missingChoices ||
              Boolean(selectedConflict) ||
              !sourceReopened ||
              !buyer.trim() ||
              !reference.trim()
            }
          >
            <ShieldCheck aria-hidden="true" />
            {pending ? "Confirming handoff…" : "Create intake pursuit only"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export function OpportunityPursuitHandoffPanel(
  props: OpportunityPursuitHandoffPanelProps,
) {
  if (props.preparation.state === "completed") {
    return (
      <StatusPanel
        state="active"
        title="Intake pursuit created"
        description={`${props.preparation.receipt.confirmedByName} confirmed this source. Pursuit ${props.preparation.receipt.projectId} remains in intake and is not active.`}
      >
        <p className="break-all font-mono text-xs text-muted-foreground">
          Receipt {props.preparation.receipt.receiptSha256}
        </p>
      </StatusPanel>
    );
  }
  return <HandoffForm {...props} preparation={props.preparation} />;
}

export default OpportunityPursuitHandoffPanel;
