import { useEffect, useRef, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { ArrowRight, CheckCircle2, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  markEncryptedFieldDraftPromoted,
  prepareEncryptedFieldDraftPromotion,
  isEncryptedFieldDraftExpired,
  type EncryptedFieldDraft,
} from "@/lib/encrypted-offline-field";
import {
  FIELD_DRAFT_PROMOTION_FIELDS,
  FieldDraftPromotionError,
  adaptFieldDraftPromotionReceipt,
  adaptFieldDraftPromotionTarget,
  buildFieldDraftPromotionCommand,
  recoverVerifiedFieldDraftPromotionReceipt,
  verifyFieldDraftPromotionReceipt,
  type FieldDraftPromotionCommand,
  type FieldDraftPromotionDiff,
  type FieldDraftPromotionField,
  type FieldDraftPromotionReceipt,
  type FieldDraftPromotionTarget,
} from "@/lib/field-draft-promotion";
import { adaptOperationsSuitePayload } from "@/pages/operations-suite-codec";

interface TargetOption {
  id: string;
  label: string;
  version: number;
  status: string;
  approvalStatus: "not_required" | "pending" | "approved" | "rejected";
}

interface ReviewedPromotion {
  target: FieldDraftPromotionTarget;
  command: FieldDraftPromotionCommand;
  diff: FieldDraftPromotionDiff[];
  idempotencyKey: string;
}

export interface FieldDraftPromotionReviewProps {
  draft: EncryptedFieldDraft;
  organisationId: string;
  actorUserId: string;
  actorLabel: string;
  projectTitle: string;
  online: boolean;
  canPromote: boolean;
  disabled?: boolean;
  onMarked: (receipt: FieldDraftPromotionReceipt) => void | Promise<void>;
  beginCriticalWorkflow: () => () => void;
}

const FIELD_LABELS: Record<FieldDraftPromotionField, string> = {
  title: "Title",
  note: "Draft note",
  checklist: "Checklist items",
};

function message(error: unknown): string {
  if (error instanceof FieldDraftPromotionError) {
    switch (error.code) {
      case "scope_changed":
        return "Your actor, organisation or pursuit authority changed. Close this review and start again.";
      case "incompatible_target":
        return "The selected work item is no longer compatible with promotion.";
      case "invalid_selection":
        return "Select at least one field that changes the approved work item.";
      case "receipt_invalid":
        return "The server receipt could not be verified. The local draft has been retained.";
      case "invalid_target":
        return "The selected work item could not be safely checked.";
    }
  }
  return "The promotion could not be completed. The encrypted local draft has been retained.";
}

export function FieldDraftPromotionReview({
  draft,
  organisationId,
  actorUserId,
  actorLabel,
  projectTitle,
  online,
  canPromote,
  disabled = false,
  onMarked,
  beginCriticalWorkflow,
}: FieldDraftPromotionReviewProps) {
  const scopeKey = `${organisationId}:${actorUserId}:${draft.projectId ?? "none"}:${draft.id}:${draft.version}`;
  const activeScope = useRef(scopeKey);
  activeScope.current = scopeKey;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [targets, setTargets] = useState<TargetOption[]>([]);
  const [targetId, setTargetId] = useState("");
  const [selectedFields, setSelectedFields] = useState<
    FieldDraftPromotionField[]
  >(
    FIELD_DRAFT_PROMOTION_FIELDS.filter(
      (field) => field !== "checklist" || draft.checklist.length > 0,
    ),
  );
  const [reviewed, setReviewed] = useState<ReviewedPromotion | null>(null);
  const [prepared, setPrepared] = useState(Boolean(draft.pendingPromotion));

  useEffect(() => {
    setOpen(false);
    setBusy(false);
    setError(null);
    setTargets([]);
    setTargetId("");
    setSelectedFields(
      FIELD_DRAFT_PROMOTION_FIELDS.filter(
        (field) => field !== "checklist" || draft.checklist.length > 0,
      ),
    );
    setReviewed(null);
    setPrepared(Boolean(draft.pendingPromotion));
    if (draft.pendingPromotion) {
      const pending = draft.pendingPromotion;
      setOpen(true);
      setTargetId(pending.targetRecordId);
      setSelectedFields([...pending.command.selectedFields]);
      setReviewed({
        target: {
          id: pending.targetRecordId,
          organisationId,
          projectId: pending.command.draft.projectId,
          version: pending.command.expectedTargetVersion,
          title: "Reload the work item to recover",
          description: "",
          status: "in_progress",
          approvalStatus: "not_required",
          commentCount: 0,
          compatible: true,
          promotionReceipts: [],
        },
        command: pending.command,
        diff: [],
        idempotencyKey: pending.idempotencyKey,
      });
    }
  }, [
    scopeKey,
    draft.checklist.length,
    draft.pendingPromotion,
    organisationId,
  ]);

  const assertCurrent = (expected: string) => {
    if (activeScope.current !== expected) {
      throw new FieldDraftPromotionError("scope_changed");
    }
  };

  const loadTarget = async (
    requestedTargetId: string,
    expectedScope: string,
  ): Promise<FieldDraftPromotionTarget> => {
    if (!draft.projectId) {
      throw new FieldDraftPromotionError("scope_changed");
    }
    const payload = await customFetch<unknown>(
      `/api/projects/${encodeURIComponent(draft.projectId)}/operations-suite/records/${encodeURIComponent(requestedTargetId)}`,
      { responseType: "json", cache: "no-store" },
    );
    assertCurrent(expectedScope);
    return adaptFieldDraftPromotionTarget(payload, {
      organisationId,
      projectId: draft.projectId,
    });
  };

  const begin = async () => {
    if (
      !online ||
      !canPromote ||
      !draft.projectId ||
      !actorLabel.trim() ||
      draft.promotion ||
      draft.pendingPromotion
    ) {
      return;
    }
    const expectedScope = scopeKey;
    setOpen(true);
    setBusy(true);
    setError(null);
    setReviewed(null);
    try {
      const payload = await customFetch<unknown>(
        `/api/projects/${encodeURIComponent(draft.projectId)}/operations-suite`,
        { responseType: "json", cache: "no-store" },
      );
      assertCurrent(expectedScope);
      const adapted = adaptOperationsSuitePayload(payload, {
        organisationId,
        projectId: draft.projectId,
        projectTitle,
        currentUserId: actorUserId,
      });
      const compatible = adapted.recorderRecords.workItems.filter(
        (target) =>
          !["done", "cancelled"].includes(target.status) &&
          target.approvalStatus !== "approved",
      );
      setTargets(compatible);
      setTargetId("");
    } catch (caught) {
      setError(message(caught));
    } finally {
      if (activeScope.current === expectedScope) setBusy(false);
    }
  };

  const review = async () => {
    if (!targetId || selectedFields.length === 0 || !draft.projectId) return;
    const expectedScope = scopeKey;
    setBusy(true);
    setError(null);
    try {
      const target = await loadTarget(targetId, expectedScope);
      const plan = buildFieldDraftPromotionCommand(
        draft,
        target,
        selectedFields,
        { organisationId, actorUserId, projectId: draft.projectId },
      );
      setReviewed({
        target,
        ...plan,
        idempotencyKey: crypto.randomUUID(),
      });
    } catch (caught) {
      setReviewed(null);
      setError(message(caught));
    } finally {
      if (activeScope.current === expectedScope) setBusy(false);
    }
  };

  const retainVerifiedReceipt = async (
    receipt: FieldDraftPromotionReceipt,
    expectedScope: string,
  ) => {
    assertCurrent(expectedScope);
    await markEncryptedFieldDraftPromoted(
      organisationId,
      actorUserId,
      draft.id,
      draft.version,
      receipt,
    );
    assertCurrent(expectedScope);
    await onMarked(receipt);
  };

  const promote = async () => {
    if (
      !reviewed ||
      !draft.projectId ||
      !online ||
      !canPromote ||
      !actorLabel.trim() ||
      isEncryptedFieldDraftExpired(draft)
    ) {
      return;
    }
    const expectedScope = scopeKey;
    setBusy(true);
    setError(null);
    const releaseCriticalWorkflow = beginCriticalWorkflow();
    try {
      // A second no-store read refreshes project visibility, target state and
      // version immediately before the explicit mutation.
      const current = await loadTarget(reviewed.target.id, expectedScope);
      const recovered = await recoverVerifiedFieldDraftPromotionReceipt(
        current,
        reviewed.command,
        reviewed.idempotencyKey,
      );
      if (recovered) {
        await retainVerifiedReceipt(recovered, expectedScope);
        return;
      }
      if (current.version !== reviewed.target.version) {
        if (prepared) {
          throw new FieldDraftPromotionError("receipt_invalid");
        }
        const refreshed = buildFieldDraftPromotionCommand(
          draft,
          current,
          reviewed.command.selectedFields,
          { organisationId, actorUserId, projectId: draft.projectId },
        );
        setReviewed({
          target: current,
          ...refreshed,
          idempotencyKey: crypto.randomUUID(),
        });
        setError(
          "The work item changed. The comparison and version were refreshed; review them before confirming again.",
        );
        return;
      }
      if (!prepared) {
        await prepareEncryptedFieldDraftPromotion(
          organisationId,
          actorUserId,
          draft.id,
          draft.version,
          reviewed.target.id,
          reviewed.idempotencyKey,
          reviewed.command,
        );
        assertCurrent(expectedScope);
        setPrepared(true);
      }
      const payload = await customFetch<unknown>(
        `/api/projects/${encodeURIComponent(draft.projectId)}/operations-suite/work-items/${encodeURIComponent(reviewed.target.id)}/field-draft-promotions`,
        {
          method: "POST",
          headers: { "Idempotency-Key": reviewed.idempotencyKey },
          body: JSON.stringify(reviewed.command),
          responseType: "json",
          cache: "no-store",
        },
      );
      assertCurrent(expectedScope);
      const receipt = await verifyFieldDraftPromotionReceipt(
        adaptFieldDraftPromotionReceipt(payload),
        reviewed.command,
        reviewed.target.id,
        reviewed.idempotencyKey,
      );
      await retainVerifiedReceipt(receipt, expectedScope);
    } catch (caught) {
      setError(message(caught));
    } finally {
      releaseCriticalWorkflow();
      if (activeScope.current === expectedScope) setBusy(false);
    }
  };

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        className="min-h-11"
        disabled={
          disabled ||
          !online ||
          !canPromote ||
          !draft.projectId ||
          !actorLabel.trim() ||
          Boolean(draft.promotion) ||
          Boolean(draft.pendingPromotion)
        }
        onClick={() => void begin()}
      >
        Review and promote
      </Button>
    );
  }

  return (
    <section
      aria-label={`Review promotion for ${draft.title}`}
      className="space-y-4 rounded-lg border border-primary/30 bg-primary/5 p-4"
    >
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold">Review and add selected fields</h3>
          <Badge variant="outline">No automatic sync</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {actorLabel} is reviewing a copy into one existing approved work item
          for {projectTitle}. The device draft is not evidence and remains on
          this device after a verified receipt.
        </p>
        {prepared ? (
          <p className="text-sm font-medium">
            Recovering the previously prepared submission with its original
            submission reference. Valo will verify a receipt before marking it.
          </p>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {targets.length === 0 && !busy && !reviewed ? (
        <p className="text-sm text-muted-foreground">
          No compatible existing work item is currently authorised for this
          pursuit. Valo will not create or choose a target automatically.
        </p>
      ) : null}

      {targets.length > 0 ? (
        <div className="grid gap-3">
          <div className="grid gap-2">
            <Label htmlFor={`promotion-target-${draft.id}`}>
              Existing approved work item
            </Label>
            <select
              id={`promotion-target-${draft.id}`}
              className="min-h-11 rounded-md border bg-background px-3"
              value={targetId}
              disabled={busy}
              onChange={(event) => {
                setTargetId(event.target.value);
                setReviewed(null);
              }}
            >
              <option value="" disabled>
                Choose a work item
              </option>
              {targets.map((target) => (
                <option key={target.id} value={target.id}>
                  {target.label} · {target.status.replaceAll("_", " ")} · v
                  {target.version}
                </option>
              ))}
            </select>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Fields to copy</legend>
            <div className="flex flex-wrap gap-3">
              {FIELD_DRAFT_PROMOTION_FIELDS.map((field) => (
                <label
                  key={field}
                  className="flex min-h-11 items-center gap-2 rounded-md border bg-background px-3 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={selectedFields.includes(field)}
                    disabled={
                      busy || (field === "checklist" && !draft.checklist.length)
                    }
                    onChange={(event) => {
                      const next = new Set(selectedFields);
                      if (event.target.checked) next.add(field);
                      else next.delete(field);
                      setSelectedFields(
                        FIELD_DRAFT_PROMOTION_FIELDS.filter((candidate) =>
                          next.has(candidate),
                        ),
                      );
                      setReviewed(null);
                    }}
                  />
                  {FIELD_LABELS[field]}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      ) : null}

      {reviewed ? (
        <div className="space-y-3" aria-label="Field-by-field promotion diff">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <RefreshCw aria-hidden="true" className="size-4" />
            <span>
              Target version {reviewed.target.version} refreshed for review
            </span>
          </div>
          {reviewed.diff.map((entry) => (
            <div
              key={entry.field}
              className="grid gap-2 rounded-md border bg-background p-3 sm:grid-cols-[1fr_auto_1fr] sm:items-start"
            >
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Current {entry.label}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm">
                  {entry.before}
                </p>
              </div>
              <ArrowRight
                aria-hidden="true"
                className="mt-5 hidden size-4 text-muted-foreground sm:block"
              />
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  After explicit {entry.effect}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm">
                  {entry.after}
                </p>
              </div>
            </div>
          ))}
          <div className="flex items-start gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm">
            <CheckCircle2
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-emerald-700"
            />
            <span>
              A successful receipt records the target version and hashes only;
              it does not claim evidence creation or local deletion.
            </span>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {targets.length > 0 && !reviewed ? (
          <Button
            type="button"
            className="min-h-11"
            disabled={busy || !targetId || selectedFields.length === 0}
            onClick={() => void review()}
          >
            Review field differences
          </Button>
        ) : null}
        {reviewed ? (
          <Button
            type="button"
            className="min-h-11"
            disabled={busy || !online || !canPromote || !actorLabel.trim()}
            onClick={() => void promote()}
          >
            {prepared
              ? "Recover prepared promotion"
              : "Promote selected fields"}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          disabled={busy || prepared}
          onClick={() => {
            setOpen(false);
            setReviewed(null);
            setError(null);
          }}
        >
          Cancel review
        </Button>
      </div>
    </section>
  );
}
