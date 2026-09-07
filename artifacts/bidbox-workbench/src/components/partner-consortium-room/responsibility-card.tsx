import { useState } from "react";
import { RefreshCw, UserRoundCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  ConsortiumMutation,
  ConsortiumParticipantOption,
  ConsortiumParty,
  ConsortiumReasonCode,
  ConsortiumResponsibility,
} from "./partner-consortium-contract";
import { formatWatInstant } from "@/lib/format";
import {
  REASON_LABELS,
  REASONS,
  localIso,
  participantName,
  participantsFor,
} from "./consortium-support";

function dateTime(value: string | null): string {
  return formatWatInstant(value, { empty: "Not set" });
}

export function ResponsibilityCard(props: {
  item: ConsortiumResponsibility;
  participants: readonly ConsortiumParticipantOption[];
  roomVersion: number;
  actorParty: ConsortiumParty;
  actorUserId: string;
  canWrite: boolean;
  pending: boolean;
  onMutate: (mutation: ConsortiumMutation) => void;
}) {
  const [reasonCode, setReasonCode] =
    useState<ConsortiumReasonCode>("scope_unclear");
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(props.item.workstreamLabel);
  const [owner, setOwner] = useState(props.item.ownerUserId);
  const [responsible, setResponsible] = useState(props.item.responsibleParty);
  const [accountable, setAccountable] = useState(props.item.accountableParty);
  const [dueAt, setDueAt] = useState("");
  const currentPartyDecision = props.item.acceptances[props.actorParty];
  const mayDecide =
    props.canWrite &&
    props.item.status === "proposed" &&
    !currentPartyDecision &&
    props.item.createdByUserId !== props.actorUserId;
  const mayRevise =
    props.canWrite &&
    props.item.status !== "active" &&
    (props.actorParty === props.item.responsibleParty ||
      props.actorParty === props.item.accountableParty);
  const ownerOptions = participantsFor(props.participants, responsible);
  const ownerIsSelectable = ownerOptions.some(
    (participant) => participant.userId === owner,
  );

  return (
    <article className="rounded-xl border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">{props.item.workstreamLabel}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Version {props.item.iteration} · owner{" "}
            {participantName(
              props.participants,
              props.item.ownerUserId,
              props.item.responsibleParty,
            )}
          </p>
        </div>
        <span className="rounded-full border bg-muted px-2.5 py-1 text-xs font-medium">
          {props.item.status.replaceAll("_", " ")}
        </span>
      </div>
      <dl className="mt-4 grid gap-3 rounded-lg bg-muted/35 p-4 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-muted-foreground">
            Responsible (does the work)
          </dt>
          <dd className="mt-1 capitalize">{props.item.responsibleParty}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">
            Accountable (approves the outcome)
          </dt>
          <dd className="mt-1 capitalize">{props.item.accountableParty}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Client acceptance</dt>
          <dd className="mt-1">
            {props.item.acceptances.client?.decision ?? "Required"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Partner acceptance</dt>
          <dd className="mt-1">
            {props.item.acceptances.partner?.decision ?? "Required"}
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-xs text-muted-foreground">
        Due {dateTime(props.item.dueAt)}
      </p>

      {editing ? (
        <form
          className="mt-4 grid gap-3 rounded-lg border bg-muted/20 p-4 md:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            props.onMutate({
              kind: "revision",
              path: `responsibilities/${props.item.id}/revisions`,
              body: {
                expectedVersion: props.roomVersion,
                workstreamLabel: label.trim(),
                responsibleParty: responsible,
                accountableParty: accountable,
                ownerUserId: owner.trim(),
                dueAt: localIso(dueAt),
              },
            });
          }}
        >
          <label className="grid gap-1 text-sm font-medium">
            Area of work
            <input
              required
              maxLength={160}
              className="min-h-10 rounded-md border border-input bg-background px-3"
              value={label}
              onChange={(event) => setLabel(event.currentTarget.value)}
            />
          </label>
          <label className="grid gap-1 text-sm font-medium">
            Named owner
            <select
              required
              className="min-h-10 rounded-md border border-input bg-background px-3"
              value={owner}
              disabled={props.pending || ownerOptions.length === 0}
              onChange={(event) => setOwner(event.currentTarget.value)}
            >
              {ownerOptions.every(
                (participant) => participant.userId !== owner,
              ) ? (
                <option value="">Select a current named member</option>
              ) : null}
              {ownerOptions.map((participant) => (
                <option key={participant.userId} value={participant.userId}>
                  {participant.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm font-medium">
            Responsible party (does the work)
            <select
              className="min-h-10 rounded-md border border-input bg-background px-3"
              value={responsible}
              onChange={(event) => {
                setResponsible(event.currentTarget.value as ConsortiumParty);
                setOwner("");
              }}
            >
              <option value="client">Client</option>
              <option value="partner">Partner</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm font-medium">
            Accountable party (approves the outcome)
            <select
              className="min-h-10 rounded-md border border-input bg-background px-3"
              value={accountable}
              onChange={(event) =>
                setAccountable(event.currentTarget.value as ConsortiumParty)
              }
            >
              <option value="client">Client</option>
              <option value="partner">Partner</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm font-medium">
            Due date (optional)
            <input
              type="datetime-local"
              className="min-h-10 rounded-md border border-input bg-background px-3"
              value={dueAt}
              onChange={(event) => setDueAt(event.currentTarget.value)}
            />
          </label>
          <div className="flex items-end justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={props.pending || !ownerIsSelectable}
            >
              Submit changes
            </Button>
          </div>
        </form>
      ) : null}

      {props.canWrite ? (
        <div className="mt-4 flex flex-wrap items-end justify-end gap-2 border-t pt-4">
          {mayRevise ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditing(true)}
            >
              <RefreshCw className="mr-2 size-4" aria-hidden="true" />
              Edit responsibility
            </Button>
          ) : null}
          {mayDecide ? (
            <>
              <label className="grid gap-1 text-xs font-medium">
                Change reason
                <select
                  className="min-h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={reasonCode}
                  onChange={(event) =>
                    setReasonCode(
                      event.currentTarget.value as ConsortiumReasonCode,
                    )
                  }
                >
                  {REASONS.map((reason) => (
                    <option key={reason} value={reason}>
                      {REASON_LABELS[reason]}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                type="button"
                variant="outline"
                disabled={props.pending}
                onClick={() =>
                  props.onMutate({
                    kind: "responsibility_decision",
                    path: `responsibilities/${props.item.id}/decisions`,
                    body: {
                      expectedVersion: props.roomVersion,
                      decision: "changes_requested",
                      reasonCode,
                    },
                  })
                }
              >
                Request changes
              </Button>
              <Button
                type="button"
                disabled={props.pending}
                onClick={() =>
                  props.onMutate({
                    kind: "responsibility_decision",
                    path: `responsibilities/${props.item.id}/decisions`,
                    body: {
                      expectedVersion: props.roomVersion,
                      decision: "accepted",
                    },
                  })
                }
              >
                <UserRoundCheck className="mr-2 size-4" aria-hidden="true" />
                Accept for {props.actorParty}
              </Button>
            </>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
