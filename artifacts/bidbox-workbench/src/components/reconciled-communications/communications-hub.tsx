import { useState, type FormEvent } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  LockKeyhole,
  MailCheck,
  ReceiptText,
  RefreshCw,
  Send,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  CommunicationEvent,
  CommunicationMutation,
  CommunicationReferenceSet,
  CommunicationSnapshot,
  CommunicationTemplateId,
} from "./communications-contract";

const TEMPLATE_LABELS: Readonly<Record<CommunicationTemplateId, string>> = {
  deadline_reminder_v1: "Deadline reminder",
  evidence_request_ready_v1: "Evidence request ready",
  evidence_correction_required_v1: "Evidence correction required",
  package_ready_v1: "Released package ready",
};

const STATUS_LABELS: Readonly<Record<CommunicationEvent["status"], string>> = {
  queued: "Queued for human action",
  prepared: "Attempt recorded",
  accepted_pending_receipt: "Accepted — receipt pending",
  retry_wait: "Known not delivered — retry available",
  reconciliation_required: "Outcome unknown — verify receipt",
  delivered: "Verified delivered",
  dead_letter: "Closed without verified delivery",
};

const STATUS_STYLES: Readonly<Record<CommunicationEvent["status"], string>> = {
  queued: "border-info bg-info/10 text-foreground",
  prepared: "border-warning bg-warning/10 text-foreground",
  accepted_pending_receipt: "border-info bg-info/10 text-foreground",
  retry_wait: "border-warning bg-warning/10 text-foreground",
  reconciliation_required:
    "border-destructive bg-destructive/10 text-foreground",
  delivered: "border-border bg-muted text-success",
  dead_letter: "border-border bg-muted text-muted-foreground",
};

function newIntentKey(): string {
  const identifier = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`;
  return `human-queued-${identifier}`;
}

function iso(value: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "";
  return parsed.toISOString();
}

function short(value: string, start = 8, end = 6): string {
  if (value.length <= start + end + 1) return value;
  return `${value.slice(0, start)}…${value.slice(-end)}`;
}

function formatInstant(value: string | null): string {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function contextSummary(event: CommunicationEvent): string {
  switch (event.context.kind) {
    case "deadline":
      return `Project deadline ${formatInstant(event.context.deadlineAt)}`;
    case "evidence_request":
      return `Evidence request ${short(event.context.requestId)} · due ${formatInstant(event.context.dueAt)}`;
    case "evidence_correction":
      return `Evidence request ${short(event.context.requestId)} · correction ${event.context.correctionSequence}`;
    case "released_package":
      return `Package ${short(event.context.packageVersionId)} · manifest ${short(event.context.manifestSha256, 10, 8)}`;
  }
}

function QueueIntentForm(props: {
  pending: boolean;
  references: CommunicationReferenceSet;
  onMutate: (mutation: CommunicationMutation) => void;
}) {
  const [recipientUserId, setRecipientUserId] = useState("");
  const [contextId, setContextId] = useState("");
  const [deliveryDeadline, setDeliveryDeadline] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(newIntentKey);
  const recipient = props.references.recipients.find(
    (candidate) => candidate.userId === recipientUserId,
  );
  const eligibleContexts = props.references.contexts.filter(
    (candidate) =>
      candidate.recipientUserId === null ||
      candidate.recipientUserId === recipientUserId,
  );
  const selectedContext = eligibleContexts.find(
    (candidate) => candidate.id === contextId,
  );

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!recipient || !selectedContext) return;
    props.onMutate({
      kind: "queue",
      path: "intents",
      body: {
        idempotencyKey,
        channel: recipient.channel,
        templateId: selectedContext.templateId,
        recipientUserId: recipient.userId,
        consentEvidenceSha256: recipient.consentEvidenceSha256,
        context: selectedContext.context,
        deadlineAt: iso(deliveryDeadline),
        maxAttempts: 3,
      },
    });
  };

  return (
    <form
      className="grid gap-5 rounded-xl border bg-card p-5 shadow-sm"
      onSubmit={onSubmit}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">
            Create an approved message plan
          </h3>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Choose a named recipient with verified consent and an approved
            project reference. Free-text messages and manually entered addresses
            are not allowed.
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800">
          <LockKeyhole className="size-3.5" aria-hidden="true" />
          Minimum data
        </span>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="grid gap-1.5 text-sm font-medium">
          Consented recipient
          <select
            className="min-h-11 rounded-md border border-input bg-background px-3 py-2"
            required
            value={recipientUserId}
            onChange={(event) => {
              setRecipientUserId(event.currentTarget.value);
              setContextId("");
            }}
          >
            <option value="">Select a named recipient</option>
            {props.references.recipients.map((candidate) => (
              <option key={candidate.userId} value={candidate.userId}>
                {candidate.name} · Email consent verified
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1.5 text-sm font-medium">
          Approved template and project
          <select
            className="min-h-11 rounded-md border border-input bg-background px-3 py-2"
            required
            value={contextId}
            disabled={!recipient}
            onChange={(event) => setContextId(event.currentTarget.value)}
          >
            <option value="">Select a verified project reference</option>
            {eligibleContexts.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {TEMPLATE_LABELS[candidate.templateId]} · {candidate.label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1.5 text-sm font-medium">
          Delivery attempt deadline
          <input
            type="datetime-local"
            className="min-h-11 rounded-md border border-input bg-background px-3 py-2"
            required
            value={deliveryDeadline}
            onChange={(event) => setDeliveryDeadline(event.currentTarget.value)}
          />
        </label>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border bg-muted/35 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">
            Duplicate-prevention key
          </span>{" "}
          <code className="break-all">{idempotencyKey}</code>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setIdempotencyKey(newIntentKey())}
        >
          Generate new key
        </Button>
      </div>
      <div className="flex justify-end">
        <Button
          type="submit"
          disabled={props.pending || !recipient || !selectedContext}
        >
          <Send className="mr-2 size-4" aria-hidden="true" />
          Create message plan
        </Button>
      </div>
    </form>
  );
}

function EventCard(props: {
  event: CommunicationEvent;
  canManage: boolean;
  pending: boolean;
  onMutate: (mutation: CommunicationMutation) => void;
}) {
  const [receiptReference, setReceiptReference] = useState("");
  const latest = props.event.attempts.at(-1) ?? null;
  const retryDue =
    latest?.nextAttemptAt == null ||
    Date.parse(latest.nextAttemptAt) <= Date.now();
  const canAttempt =
    props.event.status === "queued" ||
    props.event.status === "prepared" ||
    (props.event.status === "retry_wait" && retryDue);
  const canReconcile =
    latest != null &&
    ["accepted_pending_receipt", "outcome_unknown"].includes(latest.status);

  return (
    <article className="rounded-xl border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">
              {TEMPLATE_LABELS[props.event.templateId]}
            </h3>
            <span
              className={`rounded-full border px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[props.event.status]}`}
            >
              {STATUS_LABELS[props.event.status]}
            </span>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {contextSummary(props.event)}
          </p>
        </div>
        <div className="text-right text-xs text-muted-foreground">
          <div>Version {props.event.version}</div>
          <div>{props.event.channel.replace("_", " ")}</div>
        </div>
      </div>

      <dl className="mt-5 grid gap-3 rounded-lg border bg-muted/25 p-4 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-muted-foreground">Recipient identity</dt>
          <dd className="mt-1 font-mono">
            {short(props.event.recipientUserId)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Attempt deadline</dt>
          <dd className="mt-1">{formatInstant(props.event.deadlineAt)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Attempts</dt>
          <dd className="mt-1">
            {props.event.attempts.length} / {props.event.maxAttempts}
          </dd>
        </div>
      </dl>

      {latest ? (
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted-foreground">
          <span>
            Latest attempt:{" "}
            <strong className="text-foreground">
              {latest.status.replaceAll("_", " ")}
            </strong>
          </span>
          <span>Provider: {latest.provider}</span>
          {latest.nextAttemptAt ? (
            <span>Retry after: {formatInstant(latest.nextAttemptAt)}</span>
          ) : null}
          {latest.receiptSha256 ? (
            <span>Receipt: {short(latest.receiptSha256, 10, 8)}</span>
          ) : null}
        </div>
      ) : null}

      {props.event.status === "accepted_pending_receipt" ? (
        <p className="mt-4 flex items-start gap-2 rounded-lg border border-info bg-info/10 p-3 text-sm text-foreground">
          <Clock3 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          Provider acceptance is not delivery. A trusted receipt must be
          verified before Valo will show this as delivered.
        </p>
      ) : null}
      {props.event.status === "reconciliation_required" ? (
        <p className="mt-4 flex items-start gap-2 rounded-lg border border-destructive bg-destructive/10 p-3 text-sm text-foreground">
          <AlertTriangle
            className="mt-0.5 size-4 shrink-0"
            aria-hidden="true"
          />
          The provider outcome is unknown. Do not retry. Verify the receipt for
          the same attempt to avoid sending a duplicate message.
        </p>
      ) : null}
      {props.event.status === "delivered" ? (
        <p className="mt-4 flex items-start gap-2 rounded-lg border border-border bg-muted p-3 text-sm text-success">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          Delivery is backed by an independently verified provider receipt.
        </p>
      ) : null}

      {props.canManage ? (
        <div className="mt-5 flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-end sm:justify-end">
          {canReconcile && latest ? (
            <label className="grid flex-1 gap-1.5 text-sm font-medium sm:max-w-md">
              Receipt reference
              <input
                className="min-h-10 rounded-md border border-input bg-background px-3 py-2 font-mono text-sm"
                maxLength={256}
                pattern="[A-Za-z0-9][A-Za-z0-9._:/-]*"
                autoComplete="off"
                value={receiptReference}
                onChange={(event) =>
                  setReceiptReference(event.currentTarget.value)
                }
              />
            </label>
          ) : null}
          {canAttempt ? (
            <Button
              type="button"
              variant="outline"
              disabled={props.pending}
              onClick={() =>
                props.onMutate({
                  kind: "attempt",
                  path: `intents/${props.event.id}/attempts`,
                  body: { expectedVersion: props.event.version },
                })
              }
            >
              <MailCheck className="mr-2 size-4" aria-hidden="true" />
              Record delivery attempt
            </Button>
          ) : null}
          {canReconcile && latest ? (
            <Button
              type="button"
              disabled={props.pending || !receiptReference.trim()}
              onClick={() =>
                props.onMutate({
                  kind: "reconcile",
                  path: `intents/${props.event.id}/reconciliations`,
                  body: {
                    expectedVersion: props.event.version,
                    attemptId: latest.id,
                    receiptReference: receiptReference.trim(),
                  },
                })
              }
            >
              <ReceiptText className="mr-2 size-4" aria-hidden="true" />
              Verify receipt
            </Button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

export function CommunicationsHub(props: {
  snapshot: CommunicationSnapshot;
  references: CommunicationReferenceSet | null;
  referencesLoading: boolean;
  canManage: boolean;
  pending: boolean;
  onMutate: (mutation: CommunicationMutation) => void;
}) {
  return (
    <div className="space-y-6">
      <section
        className="grid gap-3 md:grid-cols-3"
        aria-label="Communication safeguards"
      >
        <div className="rounded-xl border bg-card p-4">
          <ShieldCheck className="size-5 text-emerald-700" aria-hidden="true" />
          <h2 className="mt-3 text-sm font-semibold">
            Approved templates only
          </h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Free-text content and raw recipient addresses cannot enter the
            communication record.
          </p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <RefreshCw className="size-5 text-sky-700" aria-hidden="true" />
          <h2 className="mt-3 text-sm font-semibold">
            Human-controlled delivery
          </h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            A named operator starts every attempt. Version checks prevent stale
            updates.
          </p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <ReceiptText className="size-5 text-violet-700" aria-hidden="true" />
          <h2 className="mt-3 text-sm font-semibold">
            Verified receipt required
          </h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Provider acceptance stays pending until a trusted receipt is
            verified.
          </p>
        </div>
      </section>

      <section
        className={`rounded-xl border p-4 ${
          props.snapshot.policy.providersConnected
            ? "border-emerald-200 bg-emerald-50"
            : "border-amber-200 bg-amber-50"
        }`}
      >
        <div className="flex items-start gap-3">
          {props.snapshot.policy.providersConnected ? (
            <ShieldCheck
              className="mt-0.5 size-5 text-emerald-700"
              aria-hidden="true"
            />
          ) : (
            <AlertTriangle
              className="mt-0.5 size-5 text-amber-800"
              aria-hidden="true"
            />
          )}
          <div>
            <h2 className="text-sm font-semibold">
              {props.snapshot.policy.providersConnected
                ? "Approved message provider is connected"
                : "Message providers are disconnected"}
            </h2>
            <p className="mt-1 text-xs leading-5">
              {props.snapshot.policy.providersConnected
                ? "Valo checks provider health and approval after it records the planned attempt."
                : "Attempts will be recorded as known not delivered. Valo will not simulate or claim an external send."}
            </p>
          </div>
        </div>
      </section>

      {props.canManage && props.references ? (
        <QueueIntentForm
          pending={props.pending}
          references={props.references}
          onMutate={props.onMutate}
        />
      ) : props.canManage ? (
        <section
          className={`rounded-xl border p-5 ${
            props.referencesLoading
              ? "bg-muted/30"
              : "border-amber-200 bg-amber-50"
          }`}
        >
          <h2 className="font-semibold">
            {props.referencesLoading
              ? "Loading verified choices"
              : "Verified choices unavailable"}
          </h2>
          <p
            className={`mt-1 text-sm ${
              props.referencesLoading
                ? "text-muted-foreground"
                : "text-amber-950"
            }`}
          >
            {props.referencesLoading
              ? "Valo is loading the approved recipient and project choices."
              : "Manual participant IDs, consent records and project references are not accepted. Reload when the approved choices are available."}
          </p>
        </section>
      ) : (
        <section className="rounded-xl border bg-muted/30 p-5">
          <h2 className="font-semibold">Read-only communication log</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Project update permission is required to queue, attempt, or
            reconcile a communication.
          </p>
        </section>
      )}

      <section
        className="space-y-3"
        aria-labelledby="communication-ledger-heading"
      >
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2
              id="communication-ledger-heading"
              className="text-lg font-semibold"
            >
              Communication log
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {props.snapshot.events.length} approved message plan
              {props.snapshot.events.length === 1 ? "" : "s"}
            </p>
          </div>
        </div>
        {props.snapshot.events.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-muted/20 p-8 text-center">
            <Send
              className="mx-auto size-6 text-muted-foreground"
              aria-hidden="true"
            />
            <h3 className="mt-3 font-semibold">No message plans</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Nothing has been sent or assumed for this pursuit.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {props.snapshot.events.map((event) => (
              <EventCard
                key={event.id}
                event={event}
                canManage={props.canManage}
                pending={props.pending}
                onMutate={props.onMutate}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
