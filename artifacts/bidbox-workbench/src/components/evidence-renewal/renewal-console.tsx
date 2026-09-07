import { useState, type FormEvent } from "react";
import { CanonicalEvidencePicker } from "@/components/canonical-evidence-picker";
import {
  PageHeader,
  StateBadge,
  StatusPanel,
} from "@/components/platform-states";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type {
  EvidenceRenewalAuthorityList,
  EvidenceRenewalCreateDraft,
  EvidenceRenewalImpact,
  EvidenceRenewalPlan,
  EvidenceRenewalReviewDraft,
  EvidenceRenewalReviewReason,
  EvidenceRenewalSnapshot,
  EvidenceRenewalStageDraft,
} from "@/lib/evidence-renewal";
import type {
  CanonicalEvidenceBinding,
  CanonicalEvidenceOption,
} from "@/lib/canonical-evidence-options";
import { humaniseToken as label } from "@/lib/format";

interface PursuitOption {
  projectId: string;
  title: string;
}

interface VaultOption {
  id: string;
  artefactType: string;
  expiryDate: string | null;
}

function idempotencyKey(kind: string): string {
  return `${kind}-${globalThis.crypto.randomUUID()}`;
}

function statusState(status: EvidenceRenewalPlan["status"]) {
  if (status === "promoted") return "active" as const;
  if (status === "rejected") return "blocked" as const;
  return "pending" as const;
}

function CreateRenewalPlan({
  projectId,
  authorities,
  vaultItems,
  pursuits,
  currentActorUserId,
  pending,
  onCreate,
}: {
  projectId: string;
  authorities: EvidenceRenewalAuthorityList;
  vaultItems: readonly VaultOption[];
  pursuits: readonly PursuitOption[];
  currentActorUserId: string;
  pending: boolean;
  onCreate: (draft: EvidenceRenewalCreateDraft) => Promise<void>;
}) {
  const defaultOwner = authorities.owners.some(
    ({ userId }) => userId === currentActorUserId,
  )
    ? currentActorUserId
    : (authorities.owners[0]?.userId ?? "");
  const [vaultItemId, setVaultItemId] = useState(vaultItems[0]?.id ?? "");
  const [ownerUserId, setOwnerUserId] = useState(defaultOwner);
  const [verifierUserId, setVerifierUserId] = useState(
    authorities.verifiers.find(({ userId }) => userId !== defaultOwner)
      ?.userId ?? "",
  );
  const [targetDate, setTargetDate] = useState("");
  const [impacts, setImpacts] = useState<Record<string, EvidenceRenewalImpact>>(
    {
      [projectId]: "blocked",
    },
  );
  const [requestKey, setRequestKey] = useState(() =>
    idempotencyKey("renewal-plan"),
  );
  const renewRequestKey = () => setRequestKey(idempotencyKey("renewal-plan"));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (
      !vaultItemId ||
      !ownerUserId ||
      !verifierUserId ||
      ownerUserId === verifierUserId ||
      !targetDate ||
      !impacts[projectId]
    ) {
      return;
    }
    void onCreate({
      vaultItemId,
      ownerUserId,
      verifierUserId,
      targetDate,
      affectedPursuits: Object.entries(impacts).map(([affectedId, impact]) => ({
        projectId: affectedId,
        impact,
      })),
      idempotencyKey: requestKey,
    }).then(renewRequestKey, () => undefined);
  };

  return (
    <form
      className="space-y-5 rounded-lg border border-border bg-card p-5"
      onSubmit={submit}
      aria-labelledby="new-renewal-plan-heading"
    >
      <div>
        <h2
          id="new-renewal-plan-heading"
          className="font-serif text-xl font-semibold"
        >
          Open a renewal plan
        </h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          Assign a current direct owner and a different independent verifier. An
          internal due reminder is recorded for the owner; no external reminder
          is sent.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="renewal-vault-item">Expiring vault artefact</Label>
          <select
            id="renewal-vault-item"
            className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={vaultItemId}
            onChange={(event) => {
              setVaultItemId(event.target.value);
              renewRequestKey();
            }}
            required
          >
            <option value="" disabled>
              Select an approved evidence item
            </option>
            {vaultItems.map((item) => (
              <option key={item.id} value={item.id}>
                {item.artefactType} — expires{" "}
                {item.expiryDate ?? "not recorded"}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="renewal-target-date">Target date</Label>
          <Input
            id="renewal-target-date"
            type="date"
            value={targetDate}
            onChange={(event) => {
              setTargetDate(event.target.value);
              renewRequestKey();
            }}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="renewal-owner">Direct current owner</Label>
          <select
            id="renewal-owner"
            className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={ownerUserId}
            onChange={(event) => {
              setOwnerUserId(event.target.value);
              renewRequestKey();
            }}
            required
          >
            <option value="" disabled>
              Select owner
            </option>
            {authorities.owners.map((person) => (
              <option key={person.userId} value={person.userId}>
                {person.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="renewal-verifier">Independent verifier</Label>
          <select
            id="renewal-verifier"
            className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={verifierUserId}
            onChange={(event) => {
              setVerifierUserId(event.target.value);
              renewRequestKey();
            }}
            required
          >
            <option value="" disabled>
              Select verifier
            </option>
            {authorities.verifiers.map((person) => (
              <option key={person.userId} value={person.userId}>
                {person.name}
              </option>
            ))}
          </select>
          {ownerUserId && ownerUserId === verifierUserId ? (
            <p role="alert" className="text-xs text-destructive">
              The verifier must be a different person.
            </p>
          ) : null}
        </div>
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Affected-pursuit impact</legend>
        <p className="text-xs text-muted-foreground">
          The current pursuit is required. Add other pursuits for the same
          client only when their evidence status is affected.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          {pursuits.map((pursuit) => {
            const selected = impacts[pursuit.projectId] !== undefined;
            const required = pursuit.projectId === projectId;
            return (
              <div
                key={pursuit.projectId}
                className="rounded-md border border-border p-3"
              >
                <div className="flex items-start gap-3">
                  <Checkbox
                    id={`affected-${pursuit.projectId}`}
                    checked={selected}
                    disabled={required}
                    onCheckedChange={(checked) => {
                      renewRequestKey();
                      setImpacts((current) => {
                        if (checked)
                          return { ...current, [pursuit.projectId]: "monitor" };
                        const next = { ...current };
                        delete next[pursuit.projectId];
                        return next;
                      });
                    }}
                  />
                  <Label
                    htmlFor={`affected-${pursuit.projectId}`}
                    className="leading-5"
                  >
                    {pursuit.title}
                    {required ? " (current)" : ""}
                  </Label>
                </div>
                {selected ? (
                  <select
                    aria-label={`Impact for ${pursuit.title}`}
                    className="mt-3 min-h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={impacts[pursuit.projectId]}
                    onChange={(event) => {
                      renewRequestKey();
                      setImpacts((current) => ({
                        ...current,
                        [pursuit.projectId]: event.target
                          .value as EvidenceRenewalImpact,
                      }));
                    }}
                  >
                    <option value="blocked">Blocked</option>
                    <option value="at_risk">At risk</option>
                    <option value="monitor">Monitor</option>
                  </select>
                ) : null}
              </div>
            );
          })}
        </div>
      </fieldset>

      {vaultItems.length === 0 ? (
        <p role="status" className="text-sm text-muted-foreground">
          No approved evidence item is available for this client.
        </p>
      ) : null}
      <Button
        type="submit"
        disabled={
          pending ||
          vaultItems.length === 0 ||
          ownerUserId === verifierUserId ||
          !verifierUserId
        }
        className="min-h-11"
      >
        Record internal renewal plan
      </Button>
    </form>
  );
}

function StageReplacement({
  plan,
  options,
  pending,
  onStage,
}: {
  plan: EvidenceRenewalPlan;
  options: readonly CanonicalEvidenceOption[];
  pending: boolean;
  onStage: (
    plan: EvidenceRenewalPlan,
    draft: EvidenceRenewalStageDraft,
  ) => Promise<void>;
}) {
  const [binding, setBinding] = useState<CanonicalEvidenceBinding[]>([]);
  const [issueDate, setIssueDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [requestKey, setRequestKey] = useState(() =>
    idempotencyKey("renewal-stage"),
  );
  const renewRequestKey = () => setRequestKey(idempotencyKey("renewal-stage"));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const selected = binding[0];
    if (!selected || !issueDate || !expiryDate) return;
    void onStage(plan, {
      documentId: selected.documentId,
      sha256: selected.sha256,
      issueDate,
      expiryDate,
      idempotencyKey: requestKey,
    }).then(renewRequestKey, () => undefined);
  };
  return (
    <form
      className="mt-4 space-y-4 border-t border-border pt-4"
      onSubmit={submit}
    >
      <h3 className="text-sm font-semibold">Prepare approved replacement</h3>
      <CanonicalEvidencePicker
        id={`renewal-document-${plan.id}`}
        label="Current clean replacement document"
        options={options}
        value={binding}
        onChange={(nextBinding) => {
          setBinding(nextBinding);
          renewRequestKey();
        }}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`renewal-issue-${plan.id}`}>Issue date</Label>
          <Input
            id={`renewal-issue-${plan.id}`}
            type="date"
            value={issueDate}
            onChange={(event) => {
              setIssueDate(event.target.value);
              renewRequestKey();
            }}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`renewal-expiry-${plan.id}`}>Expiry date</Label>
          <Input
            id={`renewal-expiry-${plan.id}`}
            type="date"
            value={expiryDate}
            onChange={(event) => {
              setExpiryDate(event.target.value);
              renewRequestKey();
            }}
            required
          />
        </div>
      </div>
      <Button
        type="submit"
        disabled={pending || binding.length !== 1}
        className="min-h-11"
      >
        Stage for independent verification
      </Button>
    </form>
  );
}

function ReviewReplacement({
  plan,
  pending,
  onReview,
}: {
  plan: EvidenceRenewalPlan;
  pending: boolean;
  onReview: (
    plan: EvidenceRenewalPlan,
    draft: EvidenceRenewalReviewDraft,
  ) => Promise<void>;
}) {
  const [reason, setReason] =
    useState<EvidenceRenewalReviewReason>("quality_issue");
  const [approveRequestKey, setApproveRequestKey] = useState(() =>
    idempotencyKey("renewal-approve"),
  );
  const [rejectRequestKey, setRejectRequestKey] = useState(() =>
    idempotencyKey("renewal-reject"),
  );
  const decide = (decision: "approve" | "reject") => {
    void onReview(plan, {
      decision,
      reasonCode: decision === "approve" ? "replacement_verified" : reason,
      idempotencyKey:
        decision === "approve" ? approveRequestKey : rejectRequestKey,
    }).then(
      () => {
        if (decision === "approve") {
          setApproveRequestKey(idempotencyKey("renewal-approve"));
        } else {
          setRejectRequestKey(idempotencyKey("renewal-reject"));
        }
      },
      () => undefined,
    );
  };
  return (
    <div className="mt-4 space-y-3 border-t border-border pt-4">
      <h3 className="text-sm font-semibold">Independent verifier decision</h3>
      <p className="text-xs leading-5 text-muted-foreground">
        Approval rechecks the current clean document and updates the evidence
        record only if it has not changed. No external message is sent.
      </p>
      <div className="space-y-2">
        <Label htmlFor={`renewal-rejection-${plan.id}`}>Rejection reason</Label>
        <select
          id={`renewal-rejection-${plan.id}`}
          className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
          value={reason}
          onChange={(event) => {
            setReason(event.target.value as EvidenceRenewalReviewReason);
            setRejectRequestKey(idempotencyKey("renewal-reject"));
          }}
        >
          <option value="incorrect_document">Incorrect document</option>
          <option value="expiry_unacceptable">Expiry unacceptable</option>
          <option value="quality_issue">Quality issue</option>
        </select>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={pending}
          onClick={() => decide("approve")}
          className="min-h-11"
        >
          Verify and promote
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => decide("reject")}
          className="min-h-11"
        >
          Reject replacement
        </Button>
      </div>
    </div>
  );
}

export function EvidenceRenewalConsole({
  snapshot,
  authorities,
  vaultItems,
  pursuits,
  canonicalOptions,
  canonicalOptionsTruncated,
  currentActorUserId,
  canManage,
  canVerify,
  pending,
  onCreate,
  onStage,
  onReview,
}: {
  snapshot: EvidenceRenewalSnapshot;
  authorities: EvidenceRenewalAuthorityList;
  vaultItems: readonly VaultOption[];
  pursuits: readonly PursuitOption[];
  canonicalOptions: readonly CanonicalEvidenceOption[];
  canonicalOptionsTruncated: boolean;
  currentActorUserId: string;
  canManage: boolean;
  canVerify: boolean;
  pending: boolean;
  onCreate: (draft: EvidenceRenewalCreateDraft) => Promise<void>;
  onStage: (
    plan: EvidenceRenewalPlan,
    draft: EvidenceRenewalStageDraft,
  ) => Promise<void>;
  onReview: (
    plan: EvidenceRenewalPlan,
    draft: EvidenceRenewalReviewDraft,
  ) => Promise<void>;
}) {
  return (
    <div className="mx-auto w-full max-w-7xl space-y-7 p-5 sm:p-8">
      <PageHeader
        eyebrow="Evidence governance"
        title="Evidence renewal plans"
        description="Plan evidence renewals, prepare an approved replacement and require a different named verifier before the evidence record changes."
        state="active"
      />
      <StatusPanel
        state="partial"
        title="Internal list only"
        description={snapshot.authorityNote}
      />

      {canManage ? (
        <CreateRenewalPlan
          projectId={snapshot.projectId}
          authorities={authorities}
          vaultItems={vaultItems}
          pursuits={pursuits}
          currentActorUserId={currentActorUserId}
          pending={pending}
          onCreate={onCreate}
        />
      ) : null}

      <section className="space-y-4" aria-labelledby="renewal-register-heading">
        <div>
          <h2
            id="renewal-register-heading"
            className="font-serif text-xl font-semibold"
          >
            Renewal plans
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {snapshot.items.length} plan
            {snapshot.items.length === 1 ? "" : "s"} for this pursuit.
          </p>
        </div>
        {snapshot.items.length === 0 ? (
          <StatusPanel
            state="empty"
            title="No renewal plan recorded"
            description="This list is empty, but that does not prove every evidence item is current."
          />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {snapshot.items.map((plan) => {
              const ownerAction =
                canManage &&
                plan.owner.current &&
                plan.owner.userId === currentActorUserId &&
                plan.status === "planned";
              const verifierAction =
                canVerify &&
                plan.verifier.current &&
                plan.verifier.userId === currentActorUserId &&
                plan.owner.userId !== currentActorUserId &&
                plan.status === "replacement_staged";
              return (
                <article
                  key={plan.id}
                  className="rounded-lg border border-border bg-card p-5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold">{plan.artefactType}</h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Version {plan.version} · target {plan.targetDate}
                      </p>
                    </div>
                    <StateBadge
                      state={statusState(plan.status)}
                      label={label(plan.status)}
                    />
                  </div>
                  <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="text-xs text-muted-foreground">Owner</dt>
                      <dd>
                        {plan.owner.name}
                        {plan.owner.current ? "" : " (authority lapsed)"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">
                        Verifier
                      </dt>
                      <dd>
                        {plan.verifier.name}
                        {plan.verifier.current ? "" : " (authority lapsed)"}
                      </dd>
                    </div>
                  </dl>
                  <div className="mt-4 rounded-md border border-border bg-muted/30 p-3 text-sm">
                    <h4 className="font-medium">Reminder for the owner</h4>
                    <p className="mt-1 text-muted-foreground">
                      Due {plan.internalReminder.dueAt.slice(0, 10)} ·{" "}
                      {plan.internalReminder.status}. No external delivery
                      receipt exists.
                    </p>
                    {plan.internalReminder.assignedOwnerUserId ===
                    currentActorUserId ? (
                      <p role="status" className="mt-2 font-medium">
                        This receipt-backed reminder is assigned to you.
                      </p>
                    ) : (
                      <p className="mt-2 text-muted-foreground">
                        Assigned to {plan.owner.name}.
                      </p>
                    )}
                    <p className="mt-2 break-all font-mono text-[11px] text-muted-foreground">
                      Reminder receipt{" "}
                      {plan.internalReminder.recordedReceiptSha256}
                    </p>
                  </div>
                  <div className="mt-4">
                    <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Affected pursuits
                    </h4>
                    <ul className="mt-2 space-y-1 text-sm">
                      {plan.affectedPursuits.map((pursuit) => (
                        <li
                          key={pursuit.projectId}
                          className="flex justify-between gap-3"
                        >
                          <span>{pursuit.title}</span>
                          <span className="text-muted-foreground">
                            {label(pursuit.impact)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <p className="mt-4 break-all font-mono text-[11px] text-muted-foreground">
                    Receipt {plan.latestReceiptSha256}
                  </p>
                  {ownerAction ? (
                    <StageReplacement
                      plan={plan}
                      options={canonicalOptions}
                      pending={pending}
                      onStage={onStage}
                    />
                  ) : null}
                  {verifierAction ? (
                    <ReviewReplacement
                      plan={plan}
                      pending={pending}
                      onReview={onReview}
                    />
                  ) : null}
                  {plan.status === "replacement_staged" && !verifierAction ? (
                    <p className="mt-4 border-t border-border pt-4 text-sm text-muted-foreground">
                      Awaiting the assigned independent verifier.
                    </p>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>
      {canonicalOptionsTruncated ? (
        <p className="text-xs text-muted-foreground">
          The replacement list shows only the latest eligible documents. The
          server checks every selection again before saving.
        </p>
      ) : null}
    </div>
  );
}
