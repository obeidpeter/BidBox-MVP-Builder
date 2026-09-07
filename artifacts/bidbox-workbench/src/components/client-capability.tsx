import { useState } from "react";
import {
  useListCapabilityItems,
  useCreateCapabilityItem,
  useUpdateCapabilityItem,
  useDeleteCapabilityItem,
  useListClientDocuments,
  getListCapabilityItemsQueryKey,
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

export function ClientCapability({ clientId }: { clientId: string }) {
  const canWriteEvidence = useOrganisationPermission("evidence:write");
  const canApproveEvidence = useOrganisationPermission("evidence:approve");
  const { data: items, isLoading } = useListCapabilityItems(clientId);
  const { data: clientDocs } = useListClientDocuments(clientId);
  const createItem = useCreateCapabilityItem();
  const updateItem = useUpdateCapabilityItem();
  const deleteItem = useDeleteCapabilityItem();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({
    claimType: "project",
    description: "",
    evidenceDocId: NO_EVIDENCE,
  });

  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: getListCapabilityItemsQueryKey(clientId),
    });

  const openCreate = () => {
    setEditingId(null);
    setForm({
      claimType: "project",
      description: "",
      evidenceDocId: NO_EVIDENCE,
    });
    setDialogOpen(true);
  };

  const openEdit = (item: CapabilityItem) => {
    setEditingId(item.id);
    setForm({
      claimType: item.claimType,
      description: item.description ?? "",
      evidenceDocId: item.evidenceDocId ?? NO_EVIDENCE,
    });
    setDialogOpen(true);
  };

  const handleSave = () => {
    const opts = {
      onSuccess: () => {
        setDialogOpen(false);
        refresh();
      },
      onError: (err: unknown) =>
        toast({
          variant: "destructive",
          title: "Could not save claim",
          description: err instanceof Error ? err.message : undefined,
        }),
    };
    if (editingId) {
      updateItem.mutate(
        {
          id: editingId,
          data: {
            claimType: form.claimType,
            description: form.description.trim() || undefined,
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
    approvedStatus: "approved" | "rejected" | "pending",
  ) => {
    updateItem.mutate(
      { id: item.id, data: { approvedStatus } },
      {
        onSuccess: refresh,
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

  const handleDelete = (item: CapabilityItem) => {
    deleteItem.mutate(
      { id: item.id },
      {
        onSuccess: refresh,
        onError: () =>
          toast({ variant: "destructive", title: "Could not delete claim" }),
      },
    );
  };

  const saving = createItem.isPending || updateItem.isPending;
  const claimLabel = (v: string) =>
    CLAIM_TYPES.find((c) => c.value === v)?.label ?? v;

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
          <Button size="sm" variant="outline" onClick={openCreate}>
            <Plus className="w-4 h-4 mr-2" />
            Add claim
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
                              !item.evidenceDocId || updateItem.isPending
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
                            onClick={() => setApproval(item, "pending")}
                            disabled={updateItem.isPending}
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
                              aria-label="Edit capability claim"
                              onClick={() => openEdit(item)}
                            >
                              <Pencil className="w-4 h-4 text-muted-foreground" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label="Delete capability claim"
                              onClick={() => handleDelete(item)}
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
        onOpenChange={setDialogOpen}
      >
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle className="font-serif">
              {editingId ? "Edit claim" : "Add capability claim"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase">
                Claim type
              </label>
              <Select
                value={form.claimType}
                onValueChange={(val) =>
                  setForm({ ...form, claimType: val as FormState["claimType"] })
                }
              >
                <SelectTrigger>
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
              <label className="text-xs font-medium text-muted-foreground uppercase">
                Description
              </label>
              <Textarea
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
                placeholder="e.g. Completed 32km federal road rehabilitation, Kaduna, 2024 — ₦1.8bn"
                className="min-h-[80px]"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase">
                Evidence document
              </label>
              <Select
                value={form.evidenceDocId}
                onValueChange={(val) =>
                  setForm({ ...form, evidenceDocId: val })
                }
              >
                <SelectTrigger>
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
              <p className="text-xs text-muted-foreground">
                Evidence must be a document already uploaded to one of this
                client's projects.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {editingId ? "Save changes" : "Add claim"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
