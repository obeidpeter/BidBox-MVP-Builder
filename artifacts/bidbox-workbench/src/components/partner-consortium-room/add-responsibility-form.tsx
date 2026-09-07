import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import type {
  ConsortiumMutation,
  ConsortiumParticipantOption,
  ConsortiumParty,
} from "./partner-consortium-contract";
import { localIso, participantsFor } from "./consortium-support";

export function AddResponsibilityForm(props: {
  participants: readonly ConsortiumParticipantOption[];
  version: number;
  pending: boolean;
  onMutate: (mutation: ConsortiumMutation) => void;
}) {
  const [workstreamLabel, setWorkstreamLabel] = useState("");
  const [responsibleParty, setResponsibleParty] =
    useState<ConsortiumParty>("partner");
  const [accountableParty, setAccountableParty] =
    useState<ConsortiumParty>("client");
  const [ownerUserId, setOwnerUserId] = useState("");
  const [dueAt, setDueAt] = useState("");
  const ownerOptions = participantsFor(props.participants, responsibleParty);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    props.onMutate({
      kind: "responsibility",
      path: "responsibilities",
      body: {
        expectedVersion: props.version,
        workstreamLabel: workstreamLabel.trim(),
        responsibleParty,
        accountableParty,
        ownerUserId: ownerUserId.trim(),
        dueAt: localIso(dueAt),
      },
    });
  };

  return (
    <form
      className="grid gap-4 rounded-xl border bg-card p-5"
      onSubmit={submit}
    >
      <div>
        <h2 className="font-semibold">Add a responsibility</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Every row needs a named owner and separate acceptance from both
          parties.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <label className="grid gap-1.5 text-sm font-medium xl:col-span-2">
          Area of work
          <input
            required
            maxLength={160}
            className="min-h-11 rounded-md border border-input bg-background px-3 py-2"
            value={workstreamLabel}
            onChange={(event) => setWorkstreamLabel(event.currentTarget.value)}
          />
        </label>
        <label className="grid gap-1.5 text-sm font-medium">
          Responsible party (does the work)
          <select
            className="min-h-11 rounded-md border border-input bg-background px-3 py-2"
            value={responsibleParty}
            onChange={(event) => {
              setResponsibleParty(event.currentTarget.value as ConsortiumParty);
              setOwnerUserId("");
            }}
          >
            <option value="partner">Partner</option>
            <option value="client">Client</option>
          </select>
        </label>
        <label className="grid gap-1.5 text-sm font-medium">
          Accountable party (approves the outcome)
          <select
            className="min-h-11 rounded-md border border-input bg-background px-3 py-2"
            value={accountableParty}
            onChange={(event) =>
              setAccountableParty(event.currentTarget.value as ConsortiumParty)
            }
          >
            <option value="client">Client</option>
            <option value="partner">Partner</option>
          </select>
        </label>
        <label className="grid gap-1.5 text-sm font-medium">
          Named owner
          <select
            required
            className="min-h-11 rounded-md border border-input bg-background px-3 py-2"
            value={ownerUserId}
            disabled={props.pending || ownerOptions.length === 0}
            onChange={(event) => setOwnerUserId(event.currentTarget.value)}
          >
            <option value="">Select a current named member</option>
            {ownerOptions.map((participant) => (
              <option key={participant.userId} value={participant.userId}>
                {participant.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1.5 text-sm font-medium">
          Due date (optional)
          <input
            type="datetime-local"
            className="min-h-11 rounded-md border border-input bg-background px-3 py-2"
            value={dueAt}
            onChange={(event) => setDueAt(event.currentTarget.value)}
          />
        </label>
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={props.pending || !ownerUserId}>
          Add proposed responsibility
        </Button>
      </div>
    </form>
  );
}
