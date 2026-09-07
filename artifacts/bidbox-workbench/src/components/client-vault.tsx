import { useRef, useState } from "react";
import {
  useListVaultItems,
  useCreateVaultItem,
  useUpdateVaultItem,
  useDeleteVaultItem,
  useListClientDocuments,
  getListVaultItemsQueryKey,
  getListClientDocumentsQueryKey,
  type VaultItem,
  type VaultItemExpiryBand,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
import { Loader2, ShieldPlus, Pencil, Trash2, Vault } from "lucide-react";
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

/**
 * Certificate Vault artefact taxonomy (build brief §11 / TRD Appendix-B):
 * the standard Nigerian compliance set, with a free-text escape hatch.
 */
const ARTEFACT_TYPES = [
  "CAC Registration",
  "Tax Clearance (FIRS)",
  "PENCOM Compliance",
  "ITF Compliance",
  "NSITF Compliance",
  "Group Life Insurance",
  "Audited Accounts",
  "BPP/CCSP Registration",
  "NCDMB/NipeX Registration",
  "Sector Licence",
  "ISO Certification",
  "Performance Bond Facility",
];
const OTHER = "__other__";
const NO_SOURCE_DOCUMENT = "__none__";

const BAND_STYLES: Record<VaultItemExpiryBand, string> = {
  expired: "bg-destructive/10 text-destructive border-destructive/30",
  critical: "bg-destructive/10 text-destructive border-destructive/30",
  warning:
    "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30",
  upcoming:
    "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30",
  ok: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  unknown: "bg-muted text-muted-foreground border-border",
};

export function expiryBadgeLabel(
  item: Pick<VaultItem, "expiryBand" | "daysToExpiry">,
): string {
  const d = item.daysToExpiry;
  switch (item.expiryBand) {
    case "expired":
      return d == null ? "Expired" : `Expired ${Math.abs(d)}d ago`;
    case "critical":
      return d === 0 ? "Expires today" : `${d}d left`;
    case "warning":
    case "upcoming":
      return `${d}d left`;
    case "ok":
      return "In date";
    default:
      return "No expiry date";
  }
}

export function ExpiryBadge({
  item,
}: {
  item: Pick<VaultItem, "expiryBand" | "daysToExpiry">;
}) {
  return (
    <Badge
      variant="outline"
      className={`text-xs ${BAND_STYLES[item.expiryBand] ?? BAND_STYLES.unknown}`}
    >
      {expiryBadgeLabel(item)}
    </Badge>
  );
}

interface FormState {
  artefactTypeChoice: string;
  artefactTypeOther: string;
  issuer: string;
  issueDate: string;
  expiryDate: string;
  renewalLeadDays: string;
  sourceDocumentId: string;
}

const EMPTY_FORM: FormState = {
  artefactTypeChoice: ARTEFACT_TYPES[0],
  artefactTypeOther: "",
  issuer: "",
  issueDate: "",
  expiryDate: "",
  renewalLeadDays: "",
  sourceDocumentId: NO_SOURCE_DOCUMENT,
};

export function ClientVault({ clientId }: { clientId: string }) {
  const canReadEvidence = useOrganisationPermission("evidence:read");
  const canReadDocuments = useOrganisationPermission("document:read");
  const canWriteEvidence = useOrganisationPermission("evidence:write");
  const {
    data: items,
    isLoading: itemsLoading,
    isPending: itemsPending,
    isError: itemsError,
    isSuccess: itemsSuccess,
    refetch: refetchItems,
  } = useListVaultItems(clientId, {
    query: {
      queryKey: getListVaultItemsQueryKey(clientId),
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
  const createItem = useCreateVaultItem();
  const updateItem = useUpdateVaultItem();
  const deleteItem = useDeleteVaultItem();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [initialForm, setInitialForm] = useState<FormState>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<{
    artefactType?: string;
    renewalLeadDays?: string;
    form?: string;
  }>({});
  const [discardOpen, setDiscardOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<VaultItem | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const customArtefactTypeRef = useRef<HTMLInputElement>(null);
  const renewalLeadDaysRef = useRef<HTMLInputElement>(null);

  const documentsReady = !canReadDocuments || documentsSuccess;
  const recordsReady = canReadEvidence && itemsSuccess && documentsReady;

  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: getListVaultItemsQueryKey(clientId),
    });

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setInitialForm(EMPTY_FORM);
    setFormErrors({});
    setDialogOpen(true);
  };

  const openEdit = (item: VaultItem) => {
    setEditingId(item.id);
    const known = ARTEFACT_TYPES.includes(item.artefactType);
    const nextForm: FormState = {
      artefactTypeChoice: known ? item.artefactType : OTHER,
      artefactTypeOther: known ? "" : item.artefactType,
      issuer: item.issuer ?? "",
      issueDate: item.issueDate ?? "",
      expiryDate: item.expiryDate ?? "",
      renewalLeadDays:
        item.renewalLeadDays != null ? String(item.renewalLeadDays) : "",
      sourceDocumentId: item.sourceDocumentId ?? NO_SOURCE_DOCUMENT,
    };
    setForm(nextForm);
    setInitialForm(nextForm);
    setFormErrors({});
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
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

  const artefactType =
    form.artefactTypeChoice === OTHER
      ? form.artefactTypeOther.trim()
      : form.artefactTypeChoice;

  const handleSave = () => {
    if (!recordsReady) {
      setFormErrors({
        form: "Reload the evidence register and source documents before saving.",
      });
      return;
    }
    if (!artefactType) {
      setFormErrors({ artefactType: "Enter the evidence type." });
      customArtefactTypeRef.current?.focus();
      return;
    }
    if (
      form.renewalLeadDays &&
      (!Number.isFinite(Number(form.renewalLeadDays)) ||
        !Number.isInteger(Number(form.renewalLeadDays)) ||
        Number(form.renewalLeadDays) < 0)
    ) {
      setFormErrors({
        renewalLeadDays: "Enter zero or a positive whole number of days.",
      });
      renewalLeadDaysRef.current?.focus();
      return;
    }
    setFormErrors({});
    const createPayload = {
      artefactType,
      issuer: form.issuer.trim() || undefined,
      issueDate: form.issueDate || undefined,
      expiryDate: form.expiryDate || undefined,
      renewalLeadDays: form.renewalLeadDays
        ? Number(form.renewalLeadDays)
        : undefined,
    };
    const updatePayload = {
      artefactType,
      issuer: form.issuer.trim() || null,
      issueDate: form.issueDate || null,
      expiryDate: form.expiryDate || null,
      renewalLeadDays: form.renewalLeadDays
        ? Number(form.renewalLeadDays)
        : null,
    };
    const sourceDocumentId =
      form.sourceDocumentId === NO_SOURCE_DOCUMENT
        ? undefined
        : form.sourceDocumentId;
    const opts = {
      onSuccess: () => {
        closeDialog();
        refresh();
        toast({
          title: editingId ? "Evidence item updated" : "Evidence item added",
        });
      },
      onError: (err: unknown) => {
        const message = errorMessage(
          err,
          "The evidence item was not saved. Reload the register and try again.",
        );
        setFormErrors({ form: message });
        toast({
          variant: "destructive",
          title: "Could not save evidence item",
          description: message,
        });
      },
    };
    if (editingId) {
      updateItem.mutate(
        {
          id: editingId,
          data: {
            ...updatePayload,
            sourceDocumentId: sourceDocumentId ?? null,
          },
        },
        opts,
      );
    } else {
      createItem.mutate(
        {
          id: clientId,
          data: sourceDocumentId
            ? { ...createPayload, sourceDocumentId }
            : createPayload,
        },
        opts,
      );
    }
  };

  const handleDelete = () => {
    if (!recordsReady || !itemToDelete) return;
    const item = itemToDelete;
    setDeleteError(null);
    deleteItem.mutate(
      { id: item.id },
      {
        onSuccess: () => {
          setItemToDelete(null);
          refresh();
          toast({
            title: "Evidence item deleted",
            description: `${item.artefactType} was permanently removed from the client vault.`,
          });
        },
        onError: (err) => {
          const message = errorMessage(
            err,
            "The evidence item was not deleted. Reload the vault and try again.",
          );
          setDeleteError(message);
          toast({
            variant: "destructive",
            title: `Could not delete ${item.artefactType}`,
            description: message,
          });
        },
      },
    );
  };

  const saving = createItem.isPending || updateItem.isPending;
  const itemIdentity = (item: VaultItem) =>
    `${item.artefactType} — ${
      item.issuer?.trim() || "issuer not recorded"
    } · version ${item.version} · ID ${item.id}`;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-serif tracking-tight font-medium">
          Certificates and evidence
        </h2>
        {canWriteEvidence && (
          <Button
            size="sm"
            variant="outline"
            onClick={openCreate}
            disabled={!recordsReady}
          >
            <ShieldPlus className="w-4 h-4 mr-2" />
            Add evidence item
          </Button>
        )}
      </div>

      {canReadEvidence && !canReadDocuments ? (
        <StatusPanel
          state="blocked"
          title="Document access required for source options"
          description="Evidence records remain visible, but source-document choices are unavailable. Ask an organisation administrator for Document read access to inspect or change source links."
        />
      ) : null}

      <div className="bg-card border border-border rounded-lg shadow-xs overflow-hidden">
        {!canReadEvidence ? (
          <div className="p-4">
            <StatusPanel
              state="blocked"
              title="Evidence access required"
              description="You need Evidence read access to view the client vault. No evidence or document request was sent."
            />
          </div>
        ) : itemsLoading ||
          itemsPending ||
          (canReadDocuments && (documentsLoading || documentsPending)) ? (
          <LoadingPanel label="Loading client evidence and source documents" />
        ) : itemsError ||
          (canReadDocuments && documentsError) ||
          !recordsReady ? (
          <div className="p-4">
            <DataErrorPanel
              title="We couldn't load the client evidence register"
              description="Evidence items or their source documents are unavailable. Editing and deletion stay disabled until both current records load."
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
                <TableHead>Artefact</TableHead>
                <TableHead>Issuer</TableHead>
                <TableHead>Issued</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Renewal Lead</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Telemetry</TableHead>
                <TableHead className="w-[90px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">
                    {item.artefactType}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {item.issuer || "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {item.issueDate || "—"}
                  </TableCell>
                  <TableCell className="text-sm">
                    {item.expiryDate || "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {item.renewalLeadDays != null
                      ? `${item.renewalLeadDays}d`
                      : "—"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {item.sha256 ? (
                      <span
                        title={item.objectPath ?? undefined}
                        className="font-mono"
                      >
                        {item.sha256.slice(0, 12)}...
                        <span className="ml-2 font-sans text-muted-foreground">
                          v{item.version}
                        </span>
                      </span>
                    ) : (
                      "-"
                    )}
                  </TableCell>
                  <TableCell>
                    <ExpiryBadge item={item} />
                  </TableCell>
                  <TableCell>
                    {canWriteEvidence && (
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Edit ${itemIdentity(item)}`}
                          onClick={() => openEdit(item)}
                          disabled={!recordsReady}
                        >
                          <Pencil className="w-4 h-4 text-muted-foreground" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Delete ${itemIdentity(item)}`}
                          onClick={() => {
                            setDeleteError(null);
                            setItemToDelete(item);
                          }}
                          disabled={!recordsReady || deleteItem.isPending}
                        >
                          <Trash2 className="w-4 h-4 text-muted-foreground hover:text-destructive" />
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="p-10 text-center text-muted-foreground">
            <Vault className="w-12 h-12 mx-auto mb-3 text-muted" />
            <p>No compliance evidence recorded for this client.</p>
            <p className="text-sm mt-1">
              Add the client's certificates and other compliance evidence.
            </p>
          </div>
        )}
      </div>

      <Dialog
        open={canWriteEvidence && dialogOpen}
        onOpenChange={(open) => !open && requestCloseDialog()}
      >
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="font-serif">
              {editingId ? "Edit evidence item" : "Add evidence item"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <FormErrorSummary
              id="vault-item-form-errors"
              errors={[
                formErrors.artefactType,
                formErrors.renewalLeadDays,
                formErrors.form,
              ]}
              title="The evidence item was not saved"
            />
            <div className="space-y-2">
              <label
                htmlFor="vault-artefact-type"
                className="text-xs font-medium text-muted-foreground uppercase"
              >
                Evidence type
              </label>
              <Select
                value={form.artefactTypeChoice}
                onValueChange={(val) => {
                  setForm({ ...form, artefactTypeChoice: val });
                  if (val !== OTHER && formErrors.artefactType) {
                    setFormErrors((current) => ({
                      ...current,
                      artefactType: undefined,
                    }));
                  }
                }}
              >
                <SelectTrigger id="vault-artefact-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ARTEFACT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                  <SelectItem value={OTHER}>Other…</SelectItem>
                </SelectContent>
              </Select>
              {form.artefactTypeChoice === OTHER && (
                <div className="space-y-2">
                  <label
                    htmlFor="vault-custom-artefact-type"
                    className="text-xs font-medium text-muted-foreground"
                  >
                    Custom evidence type
                  </label>
                  <Input
                    ref={customArtefactTypeRef}
                    id="vault-custom-artefact-type"
                    placeholder="Evidence type"
                    value={form.artefactTypeOther}
                    onChange={(e) => {
                      setForm({ ...form, artefactTypeOther: e.target.value });
                      if (formErrors.artefactType) {
                        setFormErrors((current) => ({
                          ...current,
                          artefactType: undefined,
                        }));
                      }
                    }}
                    aria-invalid={!!formErrors.artefactType}
                    aria-describedby={
                      formErrors.artefactType
                        ? "vault-artefact-type-error"
                        : undefined
                    }
                  />
                  <FieldErrorMessage id="vault-artefact-type-error">
                    {formErrors.artefactType}
                  </FieldErrorMessage>
                </div>
              )}
            </div>
            <div className="space-y-2">
              <label
                htmlFor="vault-issuer"
                className="text-xs font-medium text-muted-foreground uppercase"
              >
                Issuer
              </label>
              <Input
                id="vault-issuer"
                placeholder="Issuing body"
                value={form.issuer}
                onChange={(e) => setForm({ ...form, issuer: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label
                  htmlFor="vault-issue-date"
                  className="text-xs font-medium text-muted-foreground uppercase"
                >
                  Issue date
                </label>
                <Input
                  id="vault-issue-date"
                  type="date"
                  value={form.issueDate}
                  onChange={(e) =>
                    setForm({ ...form, issueDate: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <label
                  htmlFor="vault-expiry-date"
                  className="text-xs font-medium text-muted-foreground uppercase"
                >
                  Expiry date
                </label>
                <Input
                  id="vault-expiry-date"
                  type="date"
                  value={form.expiryDate}
                  onChange={(e) =>
                    setForm({ ...form, expiryDate: e.target.value })
                  }
                />
              </div>
            </div>
            <div className="space-y-2">
              <label
                htmlFor="vault-renewal-lead-days"
                className="text-xs font-medium text-muted-foreground uppercase"
              >
                Renewal lead time (days)
              </label>
              <Input
                ref={renewalLeadDaysRef}
                id="vault-renewal-lead-days"
                type="number"
                min={0}
                step={1}
                placeholder="e.g. 60 — how long renewal takes"
                value={form.renewalLeadDays}
                onChange={(e) => {
                  setForm({ ...form, renewalLeadDays: e.target.value });
                  if (formErrors.renewalLeadDays) {
                    setFormErrors((current) => ({
                      ...current,
                      renewalLeadDays: undefined,
                    }));
                  }
                }}
                aria-invalid={!!formErrors.renewalLeadDays}
                aria-describedby={
                  formErrors.renewalLeadDays
                    ? "vault-renewal-lead-days-error"
                    : undefined
                }
              />
              <FieldErrorMessage id="vault-renewal-lead-days-error">
                {formErrors.renewalLeadDays}
              </FieldErrorMessage>
            </div>
            {canReadDocuments ? (
              <div className="space-y-2">
                <label
                  htmlFor="vault-source-document"
                  className="text-xs font-medium text-muted-foreground uppercase"
                >
                  Source document
                </label>
                <Select
                  value={form.sourceDocumentId}
                  onValueChange={(sourceDocumentId) =>
                    setForm({ ...form, sourceDocumentId })
                  }
                >
                  <SelectTrigger
                    id="vault-source-document"
                    aria-describedby="vault-source-document-help"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_SOURCE_DOCUMENT}>
                      No linked source document
                    </SelectItem>
                    {(clientDocs ?? []).map((doc) => (
                      <SelectItem key={doc.id} value={doc.id}>
                        {doc.filename}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p
                  id="vault-source-document-help"
                  className="text-xs text-muted-foreground"
                >
                  Linking a document records its storage path and SHA-256
                  fingerprint on this evidence item.
                </p>
              </div>
            ) : (
              <StatusPanel
                state="blocked"
                title="Document access required"
                description="The existing source link is preserved. Document read access is required to inspect or choose a different source document."
              />
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={requestCloseDialog}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {editingId ? "Save changes" : "Add evidence item"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <UnsavedChangesAlert
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        onDiscard={closeDialog}
        subject={editingId ? "this evidence item" : "this new evidence item"}
      />

      <DestructiveConfirmation
        open={!!itemToDelete}
        onOpenChange={(open) => {
          if (!open) {
            setItemToDelete(null);
            setDeleteError(null);
          }
        }}
        itemName={
          itemToDelete ? itemIdentity(itemToDelete) : "Selected evidence item"
        }
        title="Permanently delete this evidence item?"
        consequence="This removes the certificate or evidence record, its source-document link and its renewal telemetry. This action cannot be undone."
        confirmLabel="Delete evidence item"
        pendingLabel="Deleting evidence item…"
        pending={deleteItem.isPending}
        error={deleteError}
        onConfirm={handleDelete}
      />
    </div>
  );
}
