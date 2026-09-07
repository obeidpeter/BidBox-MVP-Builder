import { useState, type FormEvent } from "react";
import { ArrowRight, Clock3, Eye, UserRoundCheck, X } from "lucide-react";
import type {
  LeadContactHandoff,
  LeadContactHandoffPurpose,
  LeadInboxAction,
  LeadInboxItem,
} from "./growth-suite-contract";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatWatInstant, humaniseToken as readable } from "@/lib/format";

function compactDate(value: string | null): string {
  if (!value) return "Not set";
  return formatWatInstant(value, { withTime: value.includes("T") });
}

export function LeadOperationsInbox({
  items,
  currentUserId,
  handoff,
  handoffPendingLeadId = null,
  mutationPending = false,
  onAction,
  onRequestContactHandoff,
  onDismissContactHandoff,
}: {
  items: readonly LeadInboxItem[];
  currentUserId?: string;
  handoff?: LeadContactHandoff | null;
  handoffPendingLeadId?: string | null;
  mutationPending?: boolean;
  onAction?: (leadId: string, action: LeadInboxAction) => void;
  onRequestContactHandoff?: (
    leadId: string,
    expectedVersion: number,
    purpose: LeadContactHandoffPurpose,
  ) => void;
  onDismissContactHandoff?: () => void;
}) {
  const [slas, setSlas] = useState<Record<string, string>>({});
  const [proposal, setProposal] = useState<{
    leadId: string;
    title: string;
    rationale: string;
  } | null>(null);
  const [statusDecision, setStatusDecision] = useState<{
    leadId: string;
    status: "qualified" | "not_a_fit" | "converted";
    reason: string;
    externalTargetReference: string;
    receiptSha256: string;
  } | null>(null);
  const [contactRequest, setContactRequest] = useState<{
    leadId: string;
    purpose: LeadContactHandoffPurpose;
  } | null>(null);

  const assignToCurrentUser = (item: LeadInboxItem) => {
    if (!currentUserId) return;
    onAction?.(item.id, {
      action: "assign",
      expectedVersion: item.version,
      assigneeUserId: currentUserId,
    });
  };
  const setSla = (event: FormEvent<HTMLFormElement>, item: LeadInboxItem) => {
    event.preventDefault();
    const localValue = slas[item.id];
    if (!localValue) return;
    const parsed = new Date(localValue);
    if (Number.isNaN(parsed.getTime())) return;
    onAction?.(item.id, {
      action: "set_sla",
      expectedVersion: item.version,
      slaDueAt: parsed.toISOString(),
    });
  };

  return (
    <section aria-labelledby="lead-inbox-heading" className="space-y-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
          Lead operations inbox
        </p>
        <h2
          id="lead-inbox-heading"
          className="mt-1 font-serif text-2xl font-semibold"
        >
          Qualify leads before conversion
        </h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
          The queue hides contact details. Only the assigned operator can open
          one contact for a stated purpose. This page cannot send messages or
          create CRM records.
        </p>
      </div>

      {items.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No lead summaries are available for this organisation.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {items.map((item) => {
            const assignedToCurrentOperator = Boolean(
              currentUserId && item.assignedToUserId === currentUserId,
            );
            const contactHandoffAvailable =
              assignedToCurrentOperator &&
              !["not_a_fit", "converted"].includes(item.status);
            const visibleHandoff =
              assignedToCurrentOperator && handoff?.leadId === item.id
                ? handoff
                : null;
            return (
              <Card key={item.id}>
                <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <CardTitle className="text-base">
                        {item.organisationLabel}
                      </CardTitle>
                      <Badge variant="outline">{item.leadReference}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {readable(item.tenderCategory)} ·{" "}
                      {readable(item.bidStage)}
                    </p>
                  </div>
                  <Badge>{readable(item.status)}</Badge>
                </CardHeader>
                <CardContent className="space-y-5">
                  <dl className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
                    <div>
                      <dt className="text-xs text-muted-foreground">
                        Received
                      </dt>
                      <dd className="mt-1 font-medium">
                        {compactDate(item.receivedAt)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">
                        Tender deadline
                      </dt>
                      <dd className="mt-1 font-medium">
                        {compactDate(item.tenderDeadline)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">
                        Assigned operator
                      </dt>
                      <dd className="mt-1 font-medium">
                        {assignedToCurrentOperator
                          ? "You"
                          : item.assignedToUserId
                            ? "Assigned operator"
                            : "Unassigned"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">
                        Review due
                      </dt>
                      <dd className="mt-1 font-medium">
                        {compactDate(item.slaDueAt)}
                      </dd>
                    </div>
                  </dl>

                  <div className="grid gap-4 border-t border-border pt-4 lg:grid-cols-2">
                    <div className="space-y-2">
                      <p className="text-sm font-medium">Lead ownership</p>
                      <Button
                        type="button"
                        variant="outline"
                        className="min-h-11"
                        data-control-size="44"
                        disabled={
                          mutationPending ||
                          !currentUserId ||
                          assignedToCurrentOperator
                        }
                        onClick={() => assignToCurrentUser(item)}
                      >
                        <UserRoundCheck size={16} aria-hidden="true" />
                        {assignedToCurrentOperator
                          ? "Assigned to you"
                          : "Assign to me"}
                      </Button>
                      <p className="text-xs leading-5 text-muted-foreground">
                        An administrator must reassign a lead to someone else.
                        This page does not ask for or show their user ID.
                      </p>
                    </div>
                    <form
                      className="space-y-2"
                      onSubmit={(event) => setSla(event, item)}
                    >
                      <Label htmlFor={`lead-sla-${item.id}`}>
                        Set review deadline
                      </Label>
                      <div className="flex gap-2">
                        <Input
                          id={`lead-sla-${item.id}`}
                          type="datetime-local"
                          value={slas[item.id] ?? ""}
                          onChange={(event) =>
                            setSlas((current) => ({
                              ...current,
                              [item.id]: event.currentTarget.value,
                            }))
                          }
                        />
                        <Button
                          type="submit"
                          variant="outline"
                          disabled={mutationPending}
                        >
                          <Clock3 size={16} aria-hidden="true" />
                          Set deadline
                        </Button>
                      </div>
                    </form>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      disabled={mutationPending || item.status !== "new"}
                      onClick={() =>
                        setStatusDecision({
                          leadId: item.id,
                          status: "qualified",
                          reason: "",
                          externalTargetReference: "",
                          receiptSha256: "",
                        })
                      }
                    >
                      Mark qualified
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={
                        mutationPending ||
                        ["not_a_fit", "converted"].includes(item.status)
                      }
                      onClick={() =>
                        setStatusDecision({
                          leadId: item.id,
                          status: "not_a_fit",
                          reason: "",
                          externalTargetReference: "",
                          receiptSha256: "",
                        })
                      }
                    >
                      Mark not a fit
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={mutationPending || item.status !== "qualified"}
                      onClick={() =>
                        setProposal({
                          leadId: item.id,
                          title: "",
                          rationale: "",
                        })
                      }
                    >
                      Propose pursuit conversion
                      <ArrowRight size={16} aria-hidden="true" />
                    </Button>
                    {item.status === "conversion_proposed" ? (
                      <Button
                        type="button"
                        size="sm"
                        disabled={mutationPending}
                        onClick={() =>
                          setStatusDecision({
                            leadId: item.id,
                            status: "converted",
                            reason: "",
                            externalTargetReference: "",
                            receiptSha256: "",
                          })
                        }
                      >
                        Record manual conversion complete
                      </Button>
                    ) : null}
                    {contactHandoffAvailable ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={
                          mutationPending || handoffPendingLeadId === item.id
                        }
                        onClick={() =>
                          setContactRequest({
                            leadId: item.id,
                            purpose: "initial_follow_up",
                          })
                        }
                      >
                        <Eye size={16} aria-hidden="true" />
                        Open assigned contact
                      </Button>
                    ) : null}
                  </div>

                  {statusDecision?.leadId === item.id ? (
                    <form
                      aria-label={`Record ${readable(statusDecision.status)} for ${item.leadReference}`}
                      className="grid gap-3 rounded-lg border border-border p-4"
                      onSubmit={(event) => {
                        event.preventDefault();
                        const reason = statusDecision.reason.trim();
                        if (!reason) return;
                        if (statusDecision.status === "converted") {
                          const externalTargetReference =
                            statusDecision.externalTargetReference.trim();
                          const receiptSha256 = statusDecision.receiptSha256
                            .trim()
                            .toLowerCase();
                          if (
                            !externalTargetReference ||
                            !/^[a-f0-9]{64}$/u.test(receiptSha256)
                          ) {
                            return;
                          }
                          onAction?.(item.id, {
                            action: "set_status",
                            expectedVersion: item.version,
                            status: "converted",
                            reason,
                            externalTargetReference,
                            receiptSha256,
                          });
                        } else {
                          onAction?.(item.id, {
                            action: "set_status",
                            expectedVersion: item.version,
                            status: statusDecision.status,
                            reason,
                          });
                        }
                        setStatusDecision(null);
                      }}
                    >
                      <div>
                        <p className="text-sm font-semibold">
                          Record {readable(statusDecision.status)} decision
                        </p>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                          Record the business reason only. Do not include names,
                          email addresses or phone numbers because this reason
                          is kept in the record.
                        </p>
                      </div>
                      <Label htmlFor={`lead-status-reason-${item.id}`}>
                        Decision reason
                      </Label>
                      <Textarea
                        id={`lead-status-reason-${item.id}`}
                        maxLength={1000}
                        required
                        value={statusDecision.reason}
                        onChange={(event) => {
                          const reason = event.currentTarget.value;
                          setStatusDecision((current) =>
                            current ? { ...current, reason } : current,
                          );
                        }}
                      />
                      {statusDecision.status === "converted" ? (
                        <>
                          <Label htmlFor={`lead-target-reference-${item.id}`}>
                            External system reference
                          </Label>
                          <Input
                            id={`lead-target-reference-${item.id}`}
                            maxLength={160}
                            required
                            value={statusDecision.externalTargetReference}
                            onChange={(event) => {
                              const externalTargetReference =
                                event.currentTarget.value;
                              setStatusDecision((current) =>
                                current
                                  ? { ...current, externalTargetReference }
                                  : current,
                              );
                            }}
                          />
                          <Label htmlFor={`lead-conversion-receipt-${item.id}`}>
                            Manual conversion receipt SHA-256
                          </Label>
                          <Input
                            id={`lead-conversion-receipt-${item.id}`}
                            maxLength={64}
                            minLength={64}
                            pattern="[a-f0-9]{64}"
                            required
                            className="font-mono"
                            value={statusDecision.receiptSha256}
                            onChange={(event) => {
                              const receiptSha256 =
                                event.currentTarget.value.toLowerCase();
                              setStatusDecision((current) =>
                                current
                                  ? { ...current, receiptSha256 }
                                  : current,
                              );
                            }}
                          />
                          <p className="text-xs leading-5 text-muted-foreground">
                            This records a manual conversion receipt. It does
                            not create a client, CRM record or pursuit.
                          </p>
                        </>
                      ) : null}
                      <div className="flex flex-wrap gap-2">
                        <Button type="submit" disabled={mutationPending}>
                          Record {readable(statusDecision.status)}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => setStatusDecision(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </form>
                  ) : null}

                  {contactRequest?.leadId === item.id ? (
                    <form
                      aria-label={`Open assigned contact for ${item.leadReference}`}
                      className="grid gap-3 rounded-lg border border-border p-4"
                      onSubmit={(event) => {
                        event.preventDefault();
                        onRequestContactHandoff?.(
                          item.id,
                          item.version,
                          contactRequest.purpose,
                        );
                        setContactRequest(null);
                      }}
                    >
                      <div>
                        <p className="text-sm font-semibold">
                          Open contact for a stated purpose
                        </p>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                          Available only to the currently assigned operator.
                          This records access and sends no message.
                        </p>
                      </div>
                      <Label htmlFor={`lead-contact-purpose-${item.id}`}>
                        Contact purpose
                      </Label>
                      <select
                        id={`lead-contact-purpose-${item.id}`}
                        className="min-h-11 rounded-md border border-input bg-background px-3 py-2 text-sm"
                        value={contactRequest.purpose}
                        onChange={(event) => {
                          const purpose = event.currentTarget
                            .value as LeadContactHandoffPurpose;
                          setContactRequest((current) =>
                            current ? { ...current, purpose } : current,
                          );
                        }}
                      >
                        <option value="initial_follow_up">
                          Initial follow-up
                        </option>
                        <option value="qualification_call">
                          Qualification call
                        </option>
                        {item.status === "conversion_proposed" ? (
                          <option value="conversion_handoff">
                            Conversion handoff
                          </option>
                        ) : null}
                      </select>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="submit"
                          disabled={mutationPending || !onRequestContactHandoff}
                        >
                          Open contact for this purpose
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => setContactRequest(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </form>
                  ) : null}

                  {visibleHandoff ? (
                    <div
                      aria-live="polite"
                      className="rounded-lg border border-primary/30 bg-primary/[0.025] p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold">
                            Temporary contact details
                          </p>
                          <p className="mt-1 text-xs leading-5 text-muted-foreground">
                            Shown only in this view for{" "}
                            {readable(visibleHandoff.purpose)}. Do not copy it
                            into logs, saved reasons or bulk exports. No message
                            was sent.
                          </p>
                        </div>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="min-h-11 min-w-11"
                          data-control-size="44"
                          aria-label="Dismiss transient contact"
                          onClick={onDismissContactHandoff}
                        >
                          <X size={16} aria-hidden="true" />
                        </Button>
                      </div>
                      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
                        <div>
                          <dt className="text-xs text-muted-foreground">
                            Name
                          </dt>
                          <dd className="mt-1 font-medium">
                            {visibleHandoff.contactName}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted-foreground">
                            Preferred method
                          </dt>
                          <dd className="mt-1 font-medium">
                            {visibleHandoff.preferredContactMethod}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted-foreground">
                            Contact value
                          </dt>
                          <dd className="mt-1 break-all font-medium">
                            {visibleHandoff.contactValue}
                          </dd>
                        </div>
                      </dl>
                    </div>
                  ) : null}

                  {proposal?.leadId === item.id ? (
                    <form
                      aria-label={`Conversion proposal for ${item.leadReference}`}
                      className="grid gap-3 rounded-lg border border-primary/20 bg-primary/[0.025] p-4"
                      onSubmit={(event) => {
                        event.preventDefault();
                        const title = proposal.title.trim();
                        const rationale = proposal.rationale.trim();
                        if (!title || !rationale) return;
                        onAction?.(item.id, {
                          action: "propose_conversion",
                          expectedVersion: item.version,
                          suggestedPursuitTitle: title,
                          rationale,
                        });
                        setProposal(null);
                      }}
                    >
                      <p className="text-sm font-semibold">Proposal only</p>
                      <p className="text-xs leading-5 text-muted-foreground">
                        A proposal does not create a client, pursuit,
                        entitlement or contact activity.
                      </p>
                      <Label htmlFor={`lead-proposal-title-${item.id}`}>
                        Suggested pursuit title
                      </Label>
                      <Input
                        id={`lead-proposal-title-${item.id}`}
                        maxLength={160}
                        value={proposal.title}
                        onChange={(event) =>
                          setProposal((current) =>
                            current
                              ? { ...current, title: event.currentTarget.value }
                              : current,
                          )
                        }
                      />
                      <Label htmlFor={`lead-proposal-rationale-${item.id}`}>
                        Qualification rationale
                      </Label>
                      <Textarea
                        id={`lead-proposal-rationale-${item.id}`}
                        maxLength={1000}
                        value={proposal.rationale}
                        onChange={(event) =>
                          setProposal((current) =>
                            current
                              ? {
                                  ...current,
                                  rationale: event.currentTarget.value,
                                }
                              : current,
                          )
                        }
                      />
                      <div className="flex gap-2">
                        <Button type="submit" disabled={mutationPending}>
                          Record proposal
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => setProposal(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </form>
                  ) : null}

                  {item.conversionProposal ? (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
                      <p className="font-semibold">
                        Pending human conversion decision
                      </p>
                      <p className="mt-1">
                        {item.conversionProposal.suggestedPursuitTitle}
                      </p>
                    </div>
                  ) : null}

                  {item.latestStatusDecision ? (
                    <div className="rounded-lg border border-border p-3 text-sm">
                      <p className="font-semibold">
                        Latest recorded status decision
                      </p>
                      <p className="mt-1 text-muted-foreground">
                        {readable(item.latestStatusDecision.status)} by{" "}
                        {item.latestStatusDecision.decidedByUserId} on{" "}
                        {compactDate(item.latestStatusDecision.decidedAt)}
                      </p>
                      <p className="mt-2">{item.latestStatusDecision.reason}</p>
                      {item.latestStatusDecision.externalTargetReference ? (
                        <p className="mt-2 text-xs text-muted-foreground">
                          External target reference:{" "}
                          {item.latestStatusDecision.externalTargetReference}
                        </p>
                      ) : null}
                      {item.latestStatusDecision.receiptSha256 ? (
                        <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                          Receipt SHA-256:{" "}
                          {item.latestStatusDecision.receiptSha256}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </section>
  );
}
