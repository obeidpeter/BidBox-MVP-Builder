import { useState } from "react";
import {
  CheckCircle2,
  ClipboardCheck,
  Handshake,
  LockKeyhole,
  ShieldCheck,
  UserRoundCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  ConsortiumMutation,
  ConsortiumParticipantOption,
  ConsortiumSnapshot,
} from "./partner-consortium-contract";
import { AddResponsibilityForm } from "./add-responsibility-form";
import { participantsFor, short } from "./consortium-support";
import { QaCard } from "./qa-card";
import { ResponsibilityCard } from "./responsibility-card";

export function ConsortiumRoomInitializer(props: {
  participants: readonly ConsortiumParticipantOption[];
  pending: boolean;
  onMutate: (mutation: ConsortiumMutation) => void;
}) {
  const [clientCoordinatorUserId, setClientCoordinatorUserId] = useState("");
  const [partnerCoordinatorUserId, setPartnerCoordinatorUserId] = useState("");
  const [idempotencyKey] = useState(
    () => `consortium-room-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`,
  );
  const clientParticipants = participantsFor(props.participants, "client");
  const partnerParticipants = participantsFor(props.participants, "partner");
  const canInitialize =
    clientParticipants.length > 0 && partnerParticipants.length > 0;

  return (
    <form
      className="grid gap-5 rounded-xl border bg-card p-5 shadow-sm"
      onSubmit={(event) => {
        event.preventDefault();
        props.onMutate({
          kind: "initialize",
          path: "",
          body: {
            idempotencyKey,
            clientCoordinatorUserId: clientCoordinatorUserId.trim(),
            partnerCoordinatorUserId: partnerCoordinatorUserId.trim(),
          },
        });
      }}
    >
      <div>
        <h2 className="text-lg font-semibold">Set up the relationship room</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose one active member from each party. The relationship and both
          memberships are checked before the room is created.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="grid gap-1.5 text-sm font-medium">
          Client coordinator
          <select
            required
            className="min-h-11 rounded-md border border-input bg-background px-3 py-2"
            value={clientCoordinatorUserId}
            disabled={props.pending || clientParticipants.length === 0}
            onChange={(event) =>
              setClientCoordinatorUserId(event.currentTarget.value)
            }
          >
            <option value="">Select an active client member</option>
            {clientParticipants.map((participant) => (
              <option key={participant.userId} value={participant.userId}>
                {participant.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1.5 text-sm font-medium">
          Partner coordinator
          <select
            required
            className="min-h-11 rounded-md border border-input bg-background px-3 py-2"
            value={partnerCoordinatorUserId}
            disabled={props.pending || partnerParticipants.length === 0}
            onChange={(event) =>
              setPartnerCoordinatorUserId(event.currentTarget.value)
            }
          >
            <option value="">Select an active partner member</option>
            {partnerParticipants.map((participant) => (
              <option key={participant.userId} value={participant.userId}>
                {participant.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!canInitialize ? (
        <p className="text-sm text-amber-800" role="status">
          Setup is unavailable until at least one current named member is
          available for each party.
        </p>
      ) : null}
      <div className="flex justify-end">
        <Button
          type="submit"
          disabled={
            props.pending ||
            !canInitialize ||
            !clientCoordinatorUserId ||
            !partnerCoordinatorUserId
          }
        >
          <Handshake className="mr-2 size-4" aria-hidden="true" />
          Set up room
        </Button>
      </div>
    </form>
  );
}

export function PartnerConsortiumWorkspace(props: {
  snapshot: ConsortiumSnapshot;
  participants: readonly ConsortiumParticipantOption[];
  actorUserId: string;
  canWrite: boolean;
  pending: boolean;
  onMutate: (mutation: ConsortiumMutation) => void;
}) {
  const room = props.snapshot.room;
  const latestReceipt = room.auditReceipts.at(-1)!;
  return (
    <div className="space-y-6">
      <section className="grid gap-3 lg:grid-cols-3">
        <div className="rounded-xl border bg-card p-4">
          <ShieldCheck className="size-5 text-emerald-700" aria-hidden="true" />
          <h2 className="mt-3 text-sm font-semibold">Relationship checked</h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Every read and change rechecks this active relationship and pursuit.
          </p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <UserRoundCheck className="size-5 text-sky-700" aria-hidden="true" />
          <h2 className="mt-3 text-sm font-semibold">Two-party review</h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            The person who creates a row cannot approve it. Both parties must
            accept it.
          </p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <LockKeyhole className="size-5 text-violet-700" aria-hidden="true" />
          <h2 className="mt-3 text-sm font-semibold">Coordination only</h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            No agreement generation, settlement, messaging, learning, or
            external action exists here.
          </p>
        </div>
      </section>

      <section className="rounded-xl border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Room state
            </p>
            <h2 className="mt-1 text-xl font-semibold">
              {room.status.replaceAll("_", " ")}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              You are acting for the {props.snapshot.actorParty} party · version{" "}
              {room.version}
            </p>
          </div>
          <div className="text-right text-xs text-muted-foreground">
            <div>{room.auditReceipts.length} immutable receipts</div>
            <div className="mt-1 font-mono">
              Head {short(latestReceipt.receiptSha256, 10, 8)}
            </div>
          </div>
        </div>
        {room.status === "ready_for_client_release" ? (
          <p className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
            <CheckCircle2
              className="mt-0.5 size-4 shrink-0"
              aria-hidden="true"
            />
            Coordination checks are complete. This is readiness evidence only;
            the room cannot sign, release, submit, or send anything.
          </p>
        ) : null}
      </section>

      {props.canWrite ? (
        <AddResponsibilityForm
          participants={props.participants}
          version={room.version}
          pending={props.pending}
          onMutate={props.onMutate}
        />
      ) : null}

      <section className="space-y-3" aria-labelledby="responsibility-heading">
        <div>
          <h2 id="responsibility-heading" className="text-lg font-semibold">
            Responsibility matrix
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {room.responsibilities.length} workstream
            {room.responsibilities.length === 1 ? "" : "s"}
          </p>
        </div>
        {room.responsibilities.length === 0 ? (
          <div className="rounded-xl border border-dashed p-8 text-center">
            <ClipboardCheck
              className="mx-auto size-6 text-muted-foreground"
              aria-hidden="true"
            />
            <h3 className="mt-3 font-semibold">No responsibilities recorded</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              No ownership or acceptance is recorded.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {room.responsibilities.map((item) => (
              <ResponsibilityCard
                key={item.id}
                item={item}
                participants={props.participants}
                roomVersion={room.version}
                actorParty={props.snapshot.actorParty}
                actorUserId={props.actorUserId}
                canWrite={props.canWrite}
                pending={props.pending}
                onMutate={props.onMutate}
              />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3" aria-labelledby="qa-heading">
        <div>
          <h2 id="qa-heading" className="text-lg font-semibold">
            QA and co-sign checklist
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Fixed checks with named preparers, reviewers from the other party
            and evidence fingerprints.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {room.qaChecklist.map((item) => (
            <QaCard
              key={item.id}
              item={item}
              participants={props.participants}
              roomVersion={room.version}
              actorParty={props.snapshot.actorParty}
              actorUserId={props.actorUserId}
              canWrite={props.canWrite}
              pending={props.pending}
              onMutate={props.onMutate}
            />
          ))}
        </div>
      </section>

      <section className="rounded-xl border bg-muted/25 p-4 text-xs text-muted-foreground">
        <div className="flex items-start gap-2">
          <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>
            Retention follows the client-owned pursuit. This room cannot be
            deleted on its own, and every change adds a linked audit receipt
            without storing the changed content in that receipt.
          </p>
        </div>
      </section>
    </div>
  );
}
