import { useState } from "react";
import {
  useListVaultItems,
  useCreateVaultItem,
  useUpdateVaultItem,
  useDeleteVaultItem,
  useListClientDocuments,
  getListVaultItemsQueryKey,
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
  const canWriteEvidence = useOrganisationPermission("evidence:write");
  const { data: items, isLoading } = useListVaultItems(clientId);
  const { data: clientDocs } = useListClientDocuments(clientId);
  const createItem = useCreateVaultItem();
  const updateItem = useUpdateVaultItem();
  const deleteItem = useDeleteVaultItem();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: getListVaultItemsQueryKey(clientId),
    });

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (item: VaultItem) => {
    setEditingId(item.id);
    const known = ARTEFACT_TYPES.includes(item.artefactType);
    setForm({
      artefactTypeChoice: known ? item.artefactType : OTHER,
      artefactTypeOther: known ? "" : item.artefactType,
      issuer: item.issuer ?? "",
      issueDate: item.issueDate ?? "",
      expiryDate: item.expiryDate ?? "",
      renewalLeadDays:
        item.renewalLeadDays != null ? String(item.renewalLeadDays) : "",
      sourceDocumentId: item.sourceDocumentId ?? NO_SOURCE_DOCUMENT,
    });
    setDialogOpen(true);
  };

  const artefactType =
    form.artefactTypeChoice === OTHER
      ? form.artefactTypeOther.trim()
      : form.artefactTypeChoice;

  const handleSave = () => {
    if (!artefactType) {
      toast({ variant: "destructive", title: "Artefact type is required" });
      return;
    }
    const payload = {
      artefactType,
      issuer: form.issuer.trim() || undefined,
      issueDate: form.issueDate || undefined,
      expiryDate: form.expiryDate || undefined,
      renewalLeadDays: form.renewalLeadDays
        ? Number(form.renewalLeadDays)
        : undefined,
    };
    const sourceDocumentId =
      form.sourceDocumentId === NO_SOURCE_DOCUMENT
        ? undefined
        : form.sourceDocumentId;
    const opts = {
      onSuccess: () => {
        setDialogOpen(false);
        refresh();
      },
      onError: () =>
        toast({ variant: "destructive", title: "Could not save vault item" }),
    };
    if (editingId) {
      updateItem.mutate(
        {
          id: editingId,
          data: { ...payload, sourceDocumentId: sourceDocumentId ?? null },
        },
        opts,
      );
    } else {
      createItem.mutate(
        {
          id: clientId,
          data: sourceDocumentId ? { ...payload, sourceDocumentId } : payload,
        },
        opts,
      );
    }
  };

  const handleDelete = (item: VaultItem) => {
    deleteItem.mutate(
      { id: item.id },
      {
        onSuccess: refresh,
        onError: () =>
          toast({
            variant: "destructive",
            title: `Could not delete ${item.artefactType}`,
          }),
      },
    );
  };

  const saving = createItem.isPending || updateItem.isPending;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-serif tracking-tight font-medium">
          Certificates and evidence
        </h2>
        {canWriteEvidence && (
          <Button size="sm" variant="outline" onClick={openCreate}>
            <ShieldPlus className="w-4 h-4 mr-2" />
            Add evidence item
          </Button>
        )}
      </div>

      <div className="bg-card border border-border rounded-lg shadow-xs overflow-hidden">
        {isLoading ? (
          <div className="p-8 flex justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : items && items.length > 0 ? (
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
                          aria-label={`Edit ${item.artefactType}`}
                          onClick={() => openEdit(item)}
                        >
                          <Pencil className="w-4 h-4 text-muted-foreground" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Delete ${item.artefactType}`}
                          onClick={() => handleDelete(item)}
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
        onOpenChange={setDialogOpen}
      >
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="font-serif">
              {editingId ? "Edit evidence item" : "Add evidence item"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase">
                Evidence type
              </label>
              <Select
                value={form.artefactTypeChoice}
                onValueChange={(val) =>
                  setForm({ ...form, artefactTypeChoice: val })
                }
              >
                <SelectTrigger>
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
                <Input
                  placeholder="Evidence type"
                  value={form.artefactTypeOther}
                  onChange={(e) =>
                    setForm({ ...form, artefactTypeOther: e.target.value })
                  }
                />
              )}
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase">
                Issuer
              </label>
              <Input
                placeholder="Issuing body"
                value={form.issuer}
                onChange={(e) => setForm({ ...form, issuer: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground uppercase">
                  Issue date
                </label>
                <Input
                  type="date"
                  value={form.issueDate}
                  onChange={(e) =>
                    setForm({ ...form, issueDate: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground uppercase">
                  Expiry date
                </label>
                <Input
                  type="date"
                  value={form.expiryDate}
                  onChange={(e) =>
                    setForm({ ...form, expiryDate: e.target.value })
                  }
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase">
                Renewal lead time (days)
              </label>
              <Input
                type="number"
                min={0}
                placeholder="e.g. 60 — how long renewal takes"
                value={form.renewalLeadDays}
                onChange={(e) =>
                  setForm({ ...form, renewalLeadDays: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase">
                Source document
              </label>
              <Select
                value={form.sourceDocumentId}
                onValueChange={(sourceDocumentId) =>
                  setForm({ ...form, sourceDocumentId })
                }
              >
                <SelectTrigger>
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
              <p className="text-xs text-muted-foreground">
                Linking a document records its storage path and SHA-256
                fingerprint on this evidence item.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {editingId ? "Save changes" : "Add evidence item"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
