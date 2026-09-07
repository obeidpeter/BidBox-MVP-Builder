import { useRef, useState } from "react";
import {
  useListRequirements,
  useExtractRequirements,
  useCreateRequirement,
  useUpdateRequirement,
  useMergeRequirements,
  useGetProjectScorecard,
  getListRequirementsQueryKey,
  getGetProjectScorecardQueryKey,
  type Requirement,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2,
  Zap,
  CheckSquare,
  Target,
  Check,
  X,
  Pencil,
  Plus,
  Bot,
  UserRound,
  GitMerge,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useOrganisationPermission } from "@/contexts/organisation-context";
import { DataErrorPanel, LoadingPanel } from "@/components/platform-states";
import {
  FieldErrorMessage,
  FormErrorSummary,
  UnsavedChangesAlert,
} from "@/components/form-feedback";
import { errorMessage } from "@/lib/errors";

const CATEGORIES = [
  "eligibility",
  "administrative",
  "technical",
  "financial_format",
  "other",
] as const;

interface EditForm {
  text: string;
  category: (typeof CATEGORIES)[number];
  expectedEvidence: string;
  isMandatory: boolean;
  reviewerNotes: string;
}

const EMPTY_FORM: EditForm = {
  text: "",
  category: "other",
  expectedEvidence: "",
  isMandatory: true,
  reviewerNotes: "",
};

export function RequirementsTab({ projectId }: { projectId: string }) {
  const canWriteRequirements = useOrganisationPermission("requirement:write");
  const canReviewRequirements = useOrganisationPermission("requirement:review");
  const {
    data: requirements,
    isLoading: requirementsLoading,
    isPending: requirementsPending,
    isError: requirementsError,
    isSuccess: requirementsSuccess,
    refetch: refetchRequirements,
  } = useListRequirements(projectId);
  const {
    data: scorecard,
    isLoading: scorecardLoading,
    isPending: scorecardPending,
    isError: scorecardError,
    isSuccess: scorecardSuccess,
    refetch: refetchScorecard,
  } = useGetProjectScorecard(projectId);
  const extractReqs = useExtractRequirements();
  const createReq = useCreateRequirement();
  const updateReq = useUpdateRequirement();
  const mergeReqs = useMergeRequirements();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [editing, setEditing] = useState<Requirement | null>(null);
  const [adding, setAdding] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [survivorId, setSurvivorId] = useState<string | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [form, setForm] = useState<EditForm>(EMPTY_FORM);
  const [initialForm, setInitialForm] = useState<EditForm>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<{
    text?: string;
    form?: string;
  }>({});
  const [discardOpen, setDiscardOpen] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const requirementTextRef = useRef<HTMLTextAreaElement>(null);

  const recordsReady = requirementsSuccess && scorecardSuccess;

  const refresh = () => {
    queryClient.invalidateQueries({
      queryKey: getListRequirementsQueryKey(projectId),
    });
    queryClient.invalidateQueries({
      queryKey: getGetProjectScorecardQueryKey(projectId),
    });
  };

  const handleExtract = () => {
    if (!recordsReady) return;
    extractReqs.mutate(
      { id: projectId },
      {
        onSuccess: () => {
          refresh();
          toast({ title: "Requirement extraction complete" });
        },
        onError: (err) =>
          toast({
            variant: "destructive",
            title: "Could not extract requirements",
            description: errorMessage(
              err,
              "Try again after reloading the register.",
            ),
          }),
      },
    );
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
    setSurvivorId(null);
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        if (survivorId === id) setSurvivorId(null);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const selectedReqs = (requirements ?? []).filter((r) =>
    selectedIds.has(r.id),
  );

  const openMerge = () => {
    // Default the survivor to the first selected row so the reviewer can just
    // confirm, but let them change it in the dialog.
    setSurvivorId((cur) => cur ?? selectedReqs[0]?.id ?? null);
    setMergeError(null);
    setMergeOpen(true);
  };

  const handleMerge = () => {
    if (!recordsReady || !survivorId || selectedIds.size < 2) return;
    setMergeError(null);
    mergeReqs.mutate(
      {
        id: projectId,
        data: { requirementIds: Array.from(selectedIds), survivorId },
      },
      {
        onSuccess: () => {
          setMergeOpen(false);
          exitSelectMode();
          refresh();
          toast({ title: "Requirements merged" });
        },
        onError: (err) => {
          const message = errorMessage(
            err,
            "The requirements were not merged. Reload the register and try again.",
          );
          setMergeError(message);
          toast({
            variant: "destructive",
            title: "Could not merge requirements",
            description: message,
          });
        },
      },
    );
  };

  const citationOf = (r: Requirement) =>
    [r.pageRef, r.clauseRef].filter(Boolean).join(", ") ||
    (r.sourceDocName ?? "no citation");

  const rule = (req: Requirement, reviewStatus: "confirmed" | "rejected") => {
    if (!recordsReady) return;
    setActingId(req.id);
    updateReq.mutate(
      { id: req.id, data: { reviewStatus } },
      {
        onSuccess: refresh,
        onError: () =>
          toast({
            variant: "destructive",
            title: `Could not ${reviewStatus === "confirmed" ? "confirm" : "reject"} requirement`,
          }),
        onSettled: () => setActingId(null),
      },
    );
  };

  const openEdit = (req: Requirement) => {
    const nextForm: EditForm = {
      text: req.text,
      category: req.category,
      expectedEvidence: req.expectedEvidence ?? "",
      isMandatory: req.isMandatory,
      reviewerNotes: req.reviewerNotes ?? "",
    };
    setForm(nextForm);
    setInitialForm(nextForm);
    setFormErrors({});
    setEditing(req);
  };

  const openAdd = () => {
    setForm(EMPTY_FORM);
    setInitialForm(EMPTY_FORM);
    setFormErrors({});
    setAdding(true);
  };

  const closeDialog = () => {
    setEditing(null);
    setAdding(false);
    setFormErrors({});
    setDiscardOpen(false);
  };

  const requestCloseDialog = () => {
    if (saving) return;
    if (JSON.stringify(form) !== JSON.stringify(initialForm)) {
      setDiscardOpen(true);
      return;
    }
    closeDialog();
  };

  const handleSave = () => {
    if (!recordsReady) {
      setFormErrors({
        form: "Reload the requirements register before saving changes.",
      });
      return;
    }
    if (!form.text.trim()) {
      setFormErrors({ text: "Enter the requirement text." });
      requirementTextRef.current?.focus();
      return;
    }
    setFormErrors({});
    const common = {
      onSuccess: () => {
        closeDialog();
        refresh();
        toast({
          title: editing ? "Requirement updated" : "Requirement added",
        });
      },
      onError: (err: unknown) => {
        const message = errorMessage(
          err,
          "The requirement was not saved. Reload the register and try again.",
        );
        setFormErrors({ form: message });
        toast({
          variant: "destructive",
          title: "Could not save requirement",
          description: message,
        });
      },
    };
    if (editing) {
      // Saving an edit both applies the changes and rules the row "edited"
      // (verified-with-changes) — the reviewer stamp is applied server-side.
      updateReq.mutate(
        {
          id: editing.id,
          data: {
            text: form.text.trim(),
            category: form.category,
            expectedEvidence: form.expectedEvidence.trim() || null,
            isMandatory: form.isMandatory,
            reviewerNotes: form.reviewerNotes.trim() || null,
            reviewStatus:
              form.text.trim() === editing.text &&
              editing.reviewStatus !== "suggested"
                ? undefined
                : "edited",
          },
        },
        common,
      );
    } else {
      createReq.mutate(
        {
          id: projectId,
          data: {
            text: form.text.trim(),
            category: form.category,
            expectedEvidence: form.expectedEvidence.trim() || undefined,
            isMandatory: form.isMandatory,
          },
        },
        common,
      );
    }
  };

  const totals = scorecard?.totals;
  const reviewedAny =
    recordsReady &&
    !!totals &&
    totals.engineConfirmed +
      totals.engineEdited +
      totals.engineRejected +
      totals.manualVerified >
      0;
  const saving = createReq.isPending || updateReq.isPending;

  const statusBadge = (req: Requirement) => {
    switch (req.reviewStatus) {
      case "suggested":
        return (
          <Badge
            variant="outline"
            className="text-xs text-amber-700 border-amber-300 bg-amber-50"
          >
            suggested
          </Badge>
        );
      case "rejected":
        return (
          <Badge
            variant="outline"
            className="text-xs text-destructive border-destructive/30 bg-destructive/10"
          >
            rejected
          </Badge>
        );
      case "edited":
        return (
          <Badge variant="default" className="text-xs">
            edited
          </Badge>
        );
      case "confirmed":
        return (
          <Badge variant="default" className="text-xs">
            confirmed
          </Badge>
        );
      default:
        return (
          <Badge variant="secondary" className="text-xs capitalize">
            {req.reviewStatus}
          </Badge>
        );
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-serif font-medium">Requirements</h2>
        <div className="flex gap-2">
          {canReviewRequirements && selectMode ? (
            <>
              <span className="self-center text-xs text-muted-foreground">
                {selectedIds.size} selected
              </span>
              <Button
                onClick={openMerge}
                disabled={!recordsReady || selectedIds.size < 2}
                variant="default"
              >
                <GitMerge className="w-4 h-4 mr-2" />
                Merge selected
              </Button>
              <Button onClick={exitSelectMode} variant="ghost">
                Cancel
              </Button>
            </>
          ) : (
            <>
              {canReviewRequirements && (
                <>
                  <Button
                    onClick={() => setSelectMode(true)}
                    variant="outline"
                    disabled={
                      !recordsReady || !requirements || requirements.length < 2
                    }
                    title="Fold near-duplicate requirements into one"
                  >
                    <GitMerge className="w-4 h-4 mr-2" />
                    Merge
                  </Button>
                  <Button
                    onClick={openAdd}
                    variant="outline"
                    disabled={!recordsReady}
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Add requirement
                  </Button>
                </>
              )}
              {canWriteRequirements && (
                <Button
                  onClick={handleExtract}
                  disabled={!recordsReady || extractReqs.isPending}
                  variant="secondary"
                >
                  {extractReqs.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Zap className="w-4 h-4 mr-2" />
                  )}
                  Find requirements with AI
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {reviewedAny && totals && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-border bg-card px-4 py-2.5 text-xs shadow-xs">
          <div className="flex items-center gap-1.5 font-medium">
            <Target className="w-3.5 h-3.5 text-primary" />
            <span className="uppercase tracking-wider text-muted-foreground">
              Initial readiness results
            </span>
          </div>
          <span title="AI-only mandatory recall: verified mandatory requirements found by AI ÷ all verified mandatory requirements. Initial readiness target ≥ 85%.">
            Mandatory recall:{" "}
            <strong>
              {totals.mandatoryRecall == null
                ? "—"
                : `${(totals.mandatoryRecall * 100).toFixed(1)}%`}
            </strong>
            {totals.mandatoryRecall != null && (
              <span
                className={
                  totals.mandatoryRecall >= 0.85
                    ? "text-emerald-600"
                    : "text-destructive"
                }
              >
                {" "}
                ({totals.mandatoryRecall >= 0.85 ? "meets" : "below"} 85% gate)
              </span>
            )}
          </span>
          <span>
            Engine confirmed: <strong>{totals.engineConfirmed}</strong>
          </span>
          <span>
            Edited: <strong>{totals.engineEdited}</strong>
          </span>
          <span title="Engine suggestions a reviewer rejected (false positives).">
            Rejected: <strong>{totals.engineRejected}</strong>
          </span>
          <span title="Requirements a reviewer added that the engine missed.">
            Manual adds: <strong>{totals.manualVerified}</strong>
          </span>
          {totals.engineUnreviewed > 0 && (
            <span className="text-muted-foreground">
              {totals.engineUnreviewed} awaiting review
            </span>
          )}
        </div>
      )}

      <div className="bg-card border border-border rounded-lg shadow-xs overflow-hidden">
        {requirementsLoading ||
        scorecardLoading ||
        requirementsPending ||
        scorecardPending ? (
          <LoadingPanel label="Loading requirements and readiness results" />
        ) : requirementsError || scorecardError || !recordsReady ? (
          <div className="p-4">
            <DataErrorPanel
              title="We couldn't load the requirements register"
              description="The register or its readiness totals are unavailable. Review and editing actions stay disabled until both current records load."
              onRetry={() => {
                void refetchRequirements();
                void refetchScorecard();
              }}
            />
          </div>
        ) : requirements.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                {canReviewRequirements && selectMode && (
                  <TableHead className="w-[44px]" />
                )}
                <TableHead className="w-[110px]">Status</TableHead>
                <TableHead>Requirement</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Confidence</TableHead>
                <TableHead className="w-[130px] text-right">Review</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requirements.map((req) => (
                <TableRow
                  key={req.id}
                  className={
                    `${req.reviewStatus === "rejected" ? "opacity-50" : ""} ${
                      canReviewRequirements &&
                      selectMode &&
                      selectedIds.has(req.id)
                        ? "bg-primary/5"
                        : ""
                    }`.trim() || undefined
                  }
                >
                  {canReviewRequirements && selectMode && (
                    <TableCell>
                      <Checkbox
                        checked={selectedIds.has(req.id)}
                        onCheckedChange={() => toggleSelected(req.id)}
                        aria-label="Select requirement to merge"
                      />
                    </TableCell>
                  )}
                  <TableCell>
                    <div className="flex flex-col gap-1 items-start">
                      {statusBadge(req)}
                      <span
                        className="flex items-center gap-1 text-xs text-muted-foreground"
                        title={
                          req.origin === "manual"
                            ? "Added by a reviewer"
                            : req.origin === "engine"
                              ? "AI-extracted"
                              : "Pre-tracking row"
                        }
                      >
                        {req.origin === "manual" ? (
                          <>
                            <UserRound className="w-3 h-3" /> manual
                          </>
                        ) : req.origin === "engine" ? (
                          <>
                            <Bot className="w-3 h-3" /> engine
                          </>
                        ) : null}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <p className="text-sm font-medium leading-relaxed">
                      {req.text}
                    </p>
                    {(req.pageRef || req.clauseRef) && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Ref:{" "}
                        {[req.pageRef, req.clauseRef]
                          .filter(Boolean)
                          .join(", ")}
                      </p>
                    )}
                    {(req.mergedCitations?.length ?? 0) > 0 && (
                      <details className="mt-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
                        <summary className="cursor-pointer font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                          {req.origin === "engine" &&
                          req.mergedCitations?.length === 1
                            ? "Show source quote"
                            : `Show ${req.mergedCitations?.length ?? 0} recorded citation ${
                                req.mergedCitations?.length === 1
                                  ? "record"
                                  : "records"
                              }`}
                        </summary>
                        <ul className="mt-2 space-y-2">
                          {(req.mergedCitations ?? []).map(
                            (citation, index) => (
                              <li
                                key={`${citation.sourceDocId ?? "source"}-${index}`}
                                className="border-l-2 border-primary/40 pl-2"
                              >
                                {citation.text ? (
                                  <blockquote className="leading-relaxed text-foreground">
                                    “{citation.text}”
                                  </blockquote>
                                ) : (
                                  <p className="text-muted-foreground">
                                    No source excerpt is recorded.
                                  </p>
                                )}
                                <p className="mt-1 text-muted-foreground">
                                  {citation.sourceDocName ??
                                    "Source document name unavailable"}
                                  {[citation.pageRef, citation.clauseRef].some(
                                    Boolean,
                                  )
                                    ? ` · ${[
                                        citation.pageRef,
                                        citation.clauseRef,
                                      ]
                                        .filter(Boolean)
                                        .join(", ")}`
                                    : ""}
                                </p>
                              </li>
                            ),
                          )}
                        </ul>
                      </details>
                    )}
                    {req.reviewStatus === "edited" &&
                      req.engineText &&
                      req.engineText !== req.text && (
                        <p
                          className="text-xs text-muted-foreground mt-1 italic"
                          title="Original AI suggestion, kept for comparison with the reviewer's version."
                        >
                          AI suggested: “{req.engineText}”
                        </p>
                      )}
                    {req.reviewedByName && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Reviewed by {req.reviewedByName}
                        {req.reviewedAt
                          ? ` · ${new Date(req.reviewedAt).toLocaleString()}`
                          : ""}
                      </p>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1 items-start">
                      <Badge variant="secondary" className="capitalize text-xs">
                        {req.category.replace("_", " ")}
                      </Badge>
                      {req.isMandatory && (
                        <Badge
                          variant="outline"
                          className="text-xs uppercase tracking-wide"
                        >
                          mandatory
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {req.confidence && (
                      <Badge
                        variant="outline"
                        className={`capitalize text-xs ${
                          req.confidence === "high"
                            ? "text-emerald-600 border-emerald-200 bg-emerald-50"
                            : req.confidence === "medium"
                              ? "text-amber-600 border-amber-200 bg-amber-50"
                              : "text-destructive border-destructive/20 bg-destructive/10"
                        }`}
                      >
                        {req.confidence}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {canReviewRequirements &&
                        req.reviewStatus === "suggested" && (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Confirm as-is"
                              disabled={!recordsReady || actingId === req.id}
                              onClick={() => rule(req, "confirmed")}
                            >
                              <Check className="w-4 h-4 text-emerald-600" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Reject (false positive)"
                              disabled={!recordsReady || actingId === req.id}
                              onClick={() => rule(req, "rejected")}
                            >
                              <X className="w-4 h-4 text-destructive" />
                            </Button>
                          </>
                        )}
                      {canReviewRequirements && (
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Edit and confirm with changes"
                          onClick={() => openEdit(req)}
                          disabled={!recordsReady}
                        >
                          <Pencil className="w-4 h-4 text-muted-foreground" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="p-12 text-center text-muted-foreground">
            <CheckSquare className="w-12 h-12 mx-auto mb-3 text-muted" />
            <p>No requirements extracted yet.</p>
            {canWriteRequirements && (
              <Button
                variant="outline"
                className="mt-4"
                onClick={handleExtract}
                disabled={!recordsReady || extractReqs.isPending}
              >
                Find requirements with AI
              </Button>
            )}
          </div>
        )}
      </div>

      <Dialog
        open={canReviewRequirements && (!!editing || adding)}
        onOpenChange={(open) => !open && requestCloseDialog()}
      >
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle className="font-serif">
              {editing ? "Edit requirement" : "Add requirement"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <FormErrorSummary
              id="requirement-form-errors"
              errors={[formErrors.text, formErrors.form]}
              title="The requirement was not saved"
            />
            {editing?.engineText && (
              <div className="rounded-md bg-muted/40 border border-border px-3 py-2 text-xs text-muted-foreground">
                <span className="font-medium">AI suggestion:</span>{" "}
                {editing.engineText}
              </div>
            )}
            <div className="space-y-2">
              <label
                htmlFor="requirement-text"
                className="text-xs font-medium text-muted-foreground uppercase"
              >
                Requirement text
              </label>
              <Textarea
                ref={requirementTextRef}
                id="requirement-text"
                value={form.text}
                onChange={(e) => {
                  setForm({ ...form, text: e.target.value });
                  if (formErrors.text) {
                    setFormErrors((current) => ({
                      ...current,
                      text: undefined,
                    }));
                  }
                }}
                className="min-h-[90px]"
                aria-invalid={!!formErrors.text}
                aria-describedby={
                  formErrors.text ? "requirement-text-error" : undefined
                }
              />
              <FieldErrorMessage id="requirement-text-error">
                {formErrors.text}
              </FieldErrorMessage>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label
                  htmlFor="requirement-category"
                  className="text-xs font-medium text-muted-foreground uppercase"
                >
                  Category
                </label>
                <Select
                  value={form.category}
                  onValueChange={(val) =>
                    setForm({ ...form, category: val as EditForm["category"] })
                  }
                >
                  <SelectTrigger id="requirement-category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c} className="capitalize">
                        {c.replace("_", " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label
                  htmlFor="requirement-expected-evidence"
                  className="text-xs font-medium text-muted-foreground uppercase"
                >
                  Expected evidence
                </label>
                <Input
                  id="requirement-expected-evidence"
                  value={form.expectedEvidence}
                  onChange={(e) =>
                    setForm({ ...form, expectedEvidence: e.target.value })
                  }
                  placeholder="e.g. FIRS tax clearance certificate"
                />
              </div>
            </div>
            <label
              htmlFor="requirement-mandatory"
              className="flex items-center gap-2 text-sm"
            >
              <Checkbox
                id="requirement-mandatory"
                checked={form.isMandatory}
                onCheckedChange={(v) =>
                  setForm({ ...form, isMandatory: v === true })
                }
              />
              Mandatory requirement
            </label>
            {editing && (
              <div className="space-y-2">
                <label
                  htmlFor="requirement-reviewer-notes"
                  className="text-xs font-medium text-muted-foreground uppercase"
                >
                  Reviewer notes
                </label>
                <Textarea
                  id="requirement-reviewer-notes"
                  value={form.reviewerNotes}
                  onChange={(e) =>
                    setForm({ ...form, reviewerNotes: e.target.value })
                  }
                  className="min-h-[60px]"
                  placeholder="Why the change was made"
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={requestCloseDialog}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {editing ? "Save and mark edited" : "Add as confirmed"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={canReviewRequirements && mergeOpen}
        onOpenChange={(open) => {
          setMergeOpen(open);
          if (!open) setMergeError(null);
        }}
      >
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle className="font-serif">Merge requirements</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {mergeError ? (
              <p
                role="alert"
                className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {mergeError}
              </p>
            ) : null}
            <p className="text-sm text-muted-foreground">
              Choose which requirement survives. The others are folded into it
              and their source citations are preserved on the surviving row.
              Linked evidence and defects move to the survivor.
            </p>
            <div className="space-y-2">
              {selectedReqs.map((r) => {
                const isSurvivor = survivorId === r.id;
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setSurvivorId(r.id)}
                    className={`w-full text-left rounded-md border px-3 py-2 transition-colors ${
                      isSurvivor
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-muted/40"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium leading-snug">
                        {r.text}
                      </span>
                      {isSurvivor && (
                        <Badge variant="default" className="text-xs shrink-0">
                          survivor
                        </Badge>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      Citation: {citationOf(r)}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="rounded-md bg-muted/40 border border-border px-3 py-2">
              <p className="text-xs font-medium text-muted-foreground uppercase mb-1">
                Combined citations
              </p>
              <ul className="text-xs text-muted-foreground list-disc pl-4 space-y-0.5">
                {selectedReqs.map((r) => (
                  <li key={r.id}>
                    {citationOf(r)}
                    {survivorId === r.id ? " (survivor)" : ""}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMergeOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleMerge}
              disabled={!recordsReady || !survivorId || mergeReqs.isPending}
            >
              {mergeReqs.isPending && (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              )}
              Merge {selectedIds.size} into one
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <UnsavedChangesAlert
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        onDiscard={closeDialog}
        subject={editing ? "this requirement" : "this new requirement"}
      />
    </div>
  );
}
