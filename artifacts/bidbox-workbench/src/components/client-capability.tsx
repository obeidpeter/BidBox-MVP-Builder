import { useRef, useState } from "react";
import {
  useListCapabilityItems,
  useCreateCapabilityItem,
  useUpdateCapabilityItem,
  useDeleteCapabilityItem,
  useListClientDocuments,
  getListCapabilityItemsQueryKey,
  getListClientDocumentsQueryKey,
  type CapabilityItem,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
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
  Award,
  Plus,
  Pencil,
  Trash2,
  Link2,
  Link2Off,
  BadgeCheck,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useOrganisationPermission } from "@/contexts/organisation-context";
import {
  DataErrorPanel,
  LoadingPanel,
  StatusPanel,
} from "@/components/platform-states";
import { DestructiveConfirmation } from "@/components/destructive-confirmation";
import {
  FieldErrorMessage,
  FormErrorSummary,
  UnsavedChangesAlert,
} from "@/components/form-feedback";
import { errorMessage } from "@/lib/errors";

const CLAIM_TYPES = [
  { value: "project", label: "Past Project" },
  { value: "personnel", label: "Key Personnel" },
  { value: "equipment", label: "Equipment" },
  { value: "certification", label: "Certification" },
  { value: "past_performance", label: "Past Performance" },
  { value: "other", label: "Other" },
] as const;

const NO_EVIDENCE = "__none__";

interface FormState {
  claimType: CapabilityItem["claimType"];
  description: string;
  evidenceDocId: string;
}

const EMPTY_FORM: FormState = {
  claimType: "project",
  description: "",
  evidenceDocId: NO_EVIDENCE,
};

export function ClientCapability({ clientId }: { clientId: string }) {
  const canReadEvidence = useOrganisationPermission("evidence:read");
  const canReadDocuments = useOrganisationPermission("document:read");
  const canWriteEvidence = useOrganisationPermission("evidence:write");
  const canApproveEvidence = useOrganisationPermission("evidence:approve");
  const {
    data: items,
    isLoading: itemsLoading,
    isPending: itemsPending,
    isError: itemsError,
    isSuccess: itemsSuccess,
    refetch: refetchItems,
  } = useListCapabilityItems(clientId, {
    query: {
      queryKey: getListCapabilityItemsQueryKey(clientId),
      enabled: canReadEvidence && Boolean(clientId),
    },
  });
  const {
    data: clientDocs,
    isLoading: documentsLoading,
    isPending: documentsPending,
    isError: documentsError,
    isSuccess: documentsSuccess,
    refetch: refetchDocuments,
  } = useListClientDocuments(clientId, {
    query: {
      queryKey: getListClientDocumentsQueryKey(clientId),
      enabled: canReadDocuments && Boolean(clientId),
    },
  });
  const createItem = useCreateCapabilityItem();
  const updateItem = useUpdateCapabilityItem();
  const deleteItem = useDeleteCapabilityItem();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [initialForm, setInitialForm] = useState<FormState>(EMPTY_FORM);
  const [descriptionError, setDescriptionError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [destructiveAction, setDestructiveAction] = useState<{
    kind: "delete" | "revoke";
    item: CapabilityItem;
  } | null>(null);
  const [destructiveError, setDestructiveError] = useState<string | null>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);

  const documentsReady = !canReadDocuments || documentsSuccess;
  const recordsReady = canReadEvidence && itemsSuccess && documentsReady;

  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: getListCapabilityItemsQueryKey(clientId),
    });

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setInitialForm(EMPTY_FORM);
    setDescriptionError(null);
    setFormError(null);
    setDialogOpen(true);
  };

  const openEdit = (item: CapabilityItem) => {
    setEditingId(item.id);
    const nextForm: FormState = {
      claimType: item.claimType,
      description: item.description ?? "",
      evidenceDocId: item.evidenceDocId ?? NO_EVIDENCE,
    };
    setForm(nextForm);
    setInitialForm(nextForm);
    setDescriptionError(null);
    setFormError(null);
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setDescriptionError(null);
    setFormError(null);
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
      setFormError(
        "Reload the capability register and source documents before saving.",
      );
      return;
    }
    if (!editingId && !form.description.trim()) {
      setDescriptionError("Enter the capability claim.");
      descriptionRef.current?.focus();
      return;
    }
    setDescriptionError(null);
    setFormError(null);
    const opts = {
      onSuccess: () => {
        closeDialog();
        refresh();
        toast({ title: editingId ? "Claim updated" : "Claim added" });
      },
      onError: (err: unknown) => {
        const message = errorMessage(
          err,
          "The claim was not saved. Reload the register and try again.",
        );
        setFormError(message);
        toast({
          variant: "destructive",
          title: "Could not save claim",
          description: message,
        });
      },
    };
    if (editingId) {
      updateItem.mutate(
        {
          id: editingId,
          data: {
            claimType: form.claimType,
            description: form.description.trim() || null,
            evidenceDocId:
              form.evidenceDocId === NO_EVIDENCE ? null : form.evidenceDocId,
          },
        },
        opts,
      );
    } else {
      createItem.mutate(
        {
          id: clientId,
          data: {
            claimType: form.claimType,
            description: form.description.trim() || undefined,
            evidenceDocId:
              form.evidenceDocId === NO_EVIDENCE
                ? undefined
                : form.evidenceDocId,
          },
        },
        opts,
      );
    }
  };

  const setApproval = (
    item: CapabilityItem,
    approvedStatus: "approved" | "rejected",
  ) => {
    if (!recordsReady) return;
    updateItem.mutate(
      { id: item.id, data: { approvedStatus } },
      {
        onSuccess: () => {
          refresh();
          toast({
            title:
              approvedStatus === "approved"
                ? "Claim approved"
                : "Claim rejected",
          });
        },
        onError: (err: unknown) =>
          toast({
            variant: "destructive",
            title: "Approval blocked",
            description:
              err instanceof Error && err.message.includes("evidence")
                ? "A claim cannot be approved without an evidence link. Attach evidence first."
                : "Could not update approval status.",
          }),
      },
    );
  };

  const handleDestructiveAction = () => {
    if (!recordsReady || !destructiveAction) return;
    const { kind, item } = destructiveAction;
    setDestructiveError(null);
    if (kind === "revoke") {
      updateItem.mutate(
        { id: item.id, data: { approvedStatus: "pending" } },
        {
          onSuccess: () => {
            setDestructiveAction(null);
            refresh();
            toast({
              title: "Approval revoked",
              description:
                "The claim is no longer available for draft use until it is approved again.",
            });
          },
          onError: (err) => {
            const message = errorMessage(
              err,
              "Approval was not revoked. Reload the capability register and try again.",
            );
            setDestructiveError(message);
            toast({
              variant: "destructive",
              title: "Could not revoke approval",
              description: message,
            });
          },
        },
      );
      return;
    }
    deleteItem.mutate(
      { id: item.id },
      {
        onSuccess: () => {
          setDestructiveAction(null);
          refresh();
          toast({
            title: "Claim deleted",
            description: `${claimName(item)} was permanently removed.`,
          });
        },
        onError: (err) => {
          const message = errorMessage(
            err,
            "The claim was not deleted. Reload the capability register and try again.",
          );
          setDestructiveError(message);
          toast({
            variant: "destructive",
            title: "Could not delete claim",
            description: message,
          });
        },
      },
    );
  };

  const saving = createItem.isPending || updateItem.isPending;
  const claimLabel = (v: string) =>
    CLAIM_TYPES.find((c) => c.value === v)?.label ?? v;
  const claimName = (item: CapabilityItem) =>
    item.description?.trim() || `${claimLabel(item.claimType)} claim`;
  const claimIdentity = (item: CapabilityItem) =>
    `${claimName(item)} — ${claimLabel(item.claimType)} · ${
      item.evidenceDocName?.trim() || "no evidence document"
    } · ID ${item.id}`;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-serif tracking-tight font-medium">
            Capability claims
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Only approved claims linked to evidence can be used in drafts.
            Unsupported claims are flagged and never filled in.
          </p>
        </div>
        {canWriteEvidence && (
          <Button
            size="sm"
            variant="outline"
            onClick={openCreate}
            disabled={!recordsReady}
          >
            <Plus className="w-4 h-4 mr-2" />
            Add claim
          </Button>
        )}
      </div>

      {canReadEvidence && !canReadDocuments ? (
        <StatusPanel
          state="blocked"
          title="Document access required for evidence options"
          description="Capability claims remain visible, but source-document choices are unavailable. Ask an organisation administrator for Document read access to inspect or change evidence links."
        />
      ) : null}

      <div className="bg-card border border-border rounded-lg shadow-xs overflow-hidden">
        {!canReadEvidence ? (
          <div className="p-4">
            <StatusPanel
              state="blocked"
              title="Evidence access required"
              description="You need Evidence read access to view capability claims. No claim or document request was sent."
            />
          </div>
        ) : itemsLoading ||
          itemsPending ||
          (canReadDocuments && (documentsLoading || documentsPending)) ? (
          <LoadingPanel label="Loading capability claims and evidence documents" />
        ) : itemsError ||
          (canReadDocuments && documentsError) ||
          !recordsReady ? (
          <div className="p-4">
            <DataErrorPanel
              title="We couldn't load the capability register"
              description="Claims or their evidence documents are unavailable. Approval, editing and deletion stay disabled until both current records load."
              onRetry={() => {
                void refetchItems();
                if (canReadDocuments) void refetchDocuments();
              }}
            />
          </div>
        ) : items.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead>Claim</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Evidence</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Verified</TableHead>
                <TableHead className="w-[180px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow
                  key={item.id}
                  className={
                    item.approvedStatus === "rejected"
                      ? "opacity-50"
                      : undefined
                  }
                >
                  <TableCell className="max-w-[360px]">
                    <p className="text-sm font-medium leading-relaxed">
                      {item.description || "—"}
                    </p>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="text-xs">
                      {claimLabel(item.claimType)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {item.evidenceDocId ? (
                      <span className="flex items-center gap-1.5 text-xs">
                        <Link2 className="w-3.5 h-3.5 text-emerald-600" />
                        {item.evidenceDocName ?? "Linked document"}
                      </span>
                    ) : (
                      <span
                        className="flex items-center gap-1.5 text-xs text-amber-700"
                        title="Not claimable until evidence is attached and the claim approved."
                      >
                        <Link2Off className="w-3.5 h-3.5" />
                        No evidence — non-claimable
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {item.claimable ? (
                      <Badge className="text-xs bg-emerald-600 hover:bg-emerald-600">
                        <BadgeCheck className="w-3 h-3 mr-1" />
                        claimable
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs capitalize">
                        {item.approvedStatus}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {item.verifiedAt ? (
                      <div>
                        <div className="font-medium text-foreground">
                          {item.verifierName ?? "Verified"}
                        </div>
                        <div>{new Date(item.verifiedAt).toLocaleString()}</div>
                      </div>
                    ) : (
                      "-"
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {canWriteEvidence &&
                        canApproveEvidence &&
                        item.approvedStatus !== "approved" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2 text-xs"
                            title={
                              item.evidenceDocId
                                ? "Approve claim"
                                : "Attach evidence before approving"
                            }
                            onClick={() => setApproval(item, "approved")}
                            disabled={
                              !recordsReady ||
                              !item.evidenceDocId ||
                              updateItem.isPending
                            }
                          >
                            Approve
                          </Button>
                        )}
                      {canWriteEvidence &&
                        canApproveEvidence &&
                        item.approvedStatus === "approved" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2 text-xs"
                            onClick={() => {
                              setDestructiveError(null);
                              setDestructiveAction({ kind: "revoke", item });
                            }}
                            disabled={!recordsReady || updateItem.isPending}
                          >
                            Revoke
                          </Button>
                        )}
                      {canWriteEvidence &&
                        (item.approvedStatus !== "approved" ||
                          canApproveEvidence) && (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Edit ${claimIdentity(item)}`}
                              onClick={() => openEdit(item)}
                              disabled={!recordsReady}
                            >
                              <Pencil className="w-4 h-4 text-muted-foreground" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Delete ${claimIdentity(item)}`}
                              onClick={() => {
                                setDestructiveError(null);
                                setDestructiveAction({ kind: "delete", item });
                              }}
                              disabled={!recordsReady || deleteItem.isPending}
                            >
                              <Trash2 className="w-4 h-4 text-muted-foreground hover:text-destructive" />
                            </Button>
                          </>
                        )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="p-10 text-center text-muted-foreground">
            <Award className="w-12 h-12 mx-auto mb-3 text-muted" />
            <p>No capability claims recorded for this client.</p>
            <p className="text-sm mt-1">
              Record past projects, people, equipment and certifications, with
              an evidence document for each claim.
            </p>
          </div>
        )}
      </div>

      <Dialog
        open={canWriteEvidence && dialogOpen}
        onOpenChange={(open) => !open && requestCloseDialog()}
      >
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle className="font-serif">
              {editingId ? "Edit claim" : "Add capability claim"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <FormErrorSummary
              id="capability-form-errors"
              errors={[descriptionError, formError]}
              title="The claim was not saved"
            />
            <div className="space-y-2">
              <label
                htmlFor="capability-claim-type"
                className="text-xs font-medium text-muted-foreground uppercase"
              >
                Claim type
              </label>
              <Select
                value={form.claimType}
                onValueChange={(val) =>
                  setForm({ ...form, claimType: val as FormState["claimType"] })
                }
              >
                <SelectTrigger id="capability-claim-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CLAIM_TYPES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label
                htmlFor="capability-description"
                className="text-xs font-medium text-muted-foreground uppercase"
              >
                Description
              </label>
              <Textarea
                ref={descriptionRef}
                id="capability-description"
                value={form.description}
                onChange={(e) => {
                  setForm({ ...form, description: e.target.value });
                  if (descriptionError) setDescriptionError(null);
                }}
                placeholder="e.g. Completed 32km federal road rehabilitation, Kaduna, 2024 — ₦1.8bn"
                className="min-h-[80px]"
                aria-invalid={!!descriptionError}
                aria-describedby={
                  descriptionError ? "capability-description-error" : undefined
                }
              />
              <FieldErrorMessage id="capability-description-error">
                {descriptionError}
              </FieldErrorMessage>
            </div>
            {canReadDocuments ? (
              <div className="space-y-2">
                <label
                  htmlFor="capability-evidence-document"
                  className="text-xs font-medium text-muted-foreground uppercase"
                >
                  Evidence document
                </label>
                <Select
                  value={form.evidenceDocId}
                  onValueChange={(val) =>
                    setForm({ ...form, evidenceDocId: val })
                  }
                >
                  <SelectTrigger
                    id="capability-evidence-document"
                    aria-describedby="capability-evidence-help"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_EVIDENCE}>
                      No evidence yet (claim stays non-claimable)
                    </SelectItem>
                    {(clientDocs ?? []).map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.filename}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p
                  id="capability-evidence-help"
                  className="text-xs text-muted-foreground"
                >
                  Evidence must be a document already uploaded to one of this
                  client's projects.
                </p>
              </div>
            ) : (
              <StatusPanel
                state="blocked"
                title="Document access required"
                description="The existing evidence link is preserved. Document read access is required to inspect or choose a different source document."
              />
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={requestCloseDialog}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {editingId ? "Save changes" : "Add claim"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <UnsavedChangesAlert
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        onDiscard={closeDialog}
        subject={
          editingId ? "this capability claim" : "this new capability claim"
        }
      />

      <DestructiveConfirmation
        open={!!destructiveAction}
        onOpenChange={(open) => {
          if (!open) {
            setDestructiveAction(null);
            setDestructiveError(null);
          }
        }}
        itemName={
          destructiveAction
            ? claimIdentity(destructiveAction.item)
            : "Selected capability claim"
        }
        title={
          destructiveAction?.kind === "revoke"
            ? "Revoke approval for this claim?"
            : "Permanently delete this claim?"
        }
        consequence={
          destructiveAction?.kind === "revoke"
            ? "The claim will immediately stop being claimable and cannot be used in drafts until a reviewer approves it again."
            : "This removes the claim, its evidence link and its verification state. This action cannot be undone."
        }
        confirmLabel={
          destructiveAction?.kind === "revoke"
            ? "Revoke approval"
            : "Delete claim"
        }
        pendingLabel={
          destructiveAction?.kind === "revoke"
            ? "Revoking approval…"
            : "Deleting claim…"
        }
        pending={updateItem.isPending || deleteItem.isPending}
        error={destructiveError}
        onConfirm={handleDestructiveAction}
      />
    </div>
  );
}
