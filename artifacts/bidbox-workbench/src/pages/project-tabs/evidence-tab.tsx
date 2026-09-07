import { useState } from "react";
import {
  useListEvidence,
  useMapEvidence,
  useCreateEvidence,
  useUpdateEvidence,
  useDeleteEvidence,
  useListRequirements,
  useListDocuments,
  getListEvidenceQueryKey,
  type EvidenceItem,
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
  Zap,
  Layers,
  Plus,
  Check,
  Pencil,
  Trash2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { mutationErrorToast } from "@/lib/errors";
import { useOrganisationPermission } from "@/contexts/organisation-context";

const STATUSES = [
  "present",
  "missing",
  "expired",
  "unclear",
  "not_applicable",
  "pending",
] as const;
const NONE = "__none__";

function statusClass(s: string): string {
  if (s === "present")
    return "text-emerald-600 border-emerald-200 bg-emerald-50";
  if (s === "missing" || s === "expired")
    return "text-destructive border-destructive/20 bg-destructive/10";
  return "text-amber-600 border-amber-200 bg-amber-50";
}

interface MapForm {
  requirementId: string;
  documentId: string;
  evidenceStatus: (typeof STATUSES)[number];
  excerpt: string;
  notes: string;
}
const EMPTY: MapForm = {
  requirementId: "",
  documentId: NONE,
  evidenceStatus: "present",
  excerpt: "",
  notes: "",
};

export function EvidenceTab({ projectId }: { projectId: string }) {
  const canWriteEvidence = useOrganisationPermission("evidence:write");
  const canApproveEvidence = useOrganisationPermission("evidence:approve");
  const { data: evidence, isLoading } = useListEvidence(projectId);
  const { data: requirements } = useListRequirements(projectId);
  const { data: documents } = useListDocuments(projectId);
  const mapEvidence = useMapEvidence();
  const createEvidence = useCreateEvidence();
  const updateEvidence = useUpdateEvidence();
  const deleteEvidence = useDeleteEvidence();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<MapForm>(EMPTY);
  const [actingId, setActingId] = useState<string | null>(null);

  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: getListEvidenceQueryKey(projectId),
    });

  const handleMap = () => {
    mapEvidence.mutate(
      { id: projectId },
      {
        onSuccess: refresh,
        onError: mutationErrorToast(toast, "Auto-map failed"),
      },
    );
  };

  const setStatus = (item: EvidenceItem, evidenceStatus: string) => {
    setActingId(item.id);
    updateEvidence.mutate(
      { id: item.id, data: { evidenceStatus } as never },
      {
        onSuccess: refresh,
        onError: mutationErrorToast(toast, "Could not update status"),
        onSettled: () => setActingId(null),
      },
    );
  };

  const confirmItem = (item: EvidenceItem) => {
    setActingId(item.id);
    updateEvidence.mutate(
      { id: item.id, data: { suggested: false } as never },
      {
        onSuccess: refresh,
        onError: mutationErrorToast(toast, "Could not confirm evidence"),
        onSettled: () => setActingId(null),
      },
    );
  };

  const handleDelete = (item: EvidenceItem) => {
    setActingId(item.id);
    deleteEvidence.mutate(
      { id: item.id },
      {
        onSuccess: refresh,
        onError: mutationErrorToast(toast, "Could not delete evidence"),
        onSettled: () => setActingId(null),
      },
    );
  };

  const openMap = () => {
    setEditingId(null);
    setForm({
      ...EMPTY,
      requirementId: requirements?.[0]?.id ?? "",
      evidenceStatus:
        canWriteEvidence && canApproveEvidence
          ? EMPTY.evidenceStatus
          : "pending",
    });
    setDialogOpen(true);
  };
  const openEdit = (item: EvidenceItem) => {
    setEditingId(item.id);
    setForm({
      requirementId: item.requirementId,
      documentId: item.documentId ?? NONE,
      evidenceStatus: item.evidenceStatus as MapForm["evidenceStatus"],
      excerpt: item.excerpt ?? "",
      notes: item.notes ?? "",
    });
    setDialogOpen(true);
  };

  const handleSave = () => {
    if (!form.requirementId) {
      toast({ variant: "destructive", title: "Pick a requirement" });
      return;
    }
    const common = {
      onSuccess: () => {
        setDialogOpen(false);
        refresh();
      },
      onError: mutationErrorToast(toast, "Could not save evidence"),
    };
    if (editingId) {
      updateEvidence.mutate(
        {
          id: editingId,
          data: {
            documentId: form.documentId === NONE ? undefined : form.documentId,
            ...(canWriteEvidence && canApproveEvidence
              ? { evidenceStatus: form.evidenceStatus }
              : {}),
            excerpt: form.excerpt.trim() || undefined,
            notes: form.notes.trim() || undefined,
          } as never,
        },
        common,
      );
    } else {
      createEvidence.mutate(
        {
          data: {
            projectId,
            requirementId: form.requirementId,
            documentId: form.documentId === NONE ? undefined : form.documentId,
            evidenceStatus:
              canWriteEvidence && canApproveEvidence
                ? form.evidenceStatus
                : "pending",
            excerpt: form.excerpt.trim() || undefined,
            notes: form.notes.trim() || undefined,
          } as never,
        },
        common,
      );
    }
  };

  const saving = createEvidence.isPending || updateEvidence.isPending;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-serif font-medium">Evidence links</h2>
        <div className="flex gap-2">
          {canWriteEvidence && (
            <>
              <Button onClick={openMap} variant="outline">
                <Plus className="w-4 h-4 mr-2" /> Link evidence
              </Button>
              <Button
                onClick={handleMap}
                disabled={mapEvidence.isPending}
                variant="secondary"
              >
                {mapEvidence.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Zap className="w-4 h-4 mr-2" />
                )}
                Suggest evidence links
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg shadow-xs overflow-hidden">
        {isLoading ? (
          <div className="p-8 flex justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : evidence && evidence.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead>Requirement</TableHead>
                <TableHead className="w-[150px]">Status</TableHead>
                <TableHead>Document</TableHead>
                <TableHead>Excerpt</TableHead>
                <TableHead className="w-[130px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {evidence.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="max-w-[260px]">
                    <p className="text-sm font-medium truncate">
                      {item.requirementText}
                    </p>
                    {item.suggested && (
                      <span className="text-xs text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded uppercase tracking-wider font-mono">
                        suggested
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {canWriteEvidence && canApproveEvidence ? (
                      <Select
                        value={item.evidenceStatus}
                        onValueChange={(v) => setStatus(item, v)}
                        disabled={actingId === item.id}
                      >
                        <SelectTrigger
                          className={`h-7 text-xs capitalize ${statusClass(item.evidenceStatus)}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {STATUSES.map((s) => (
                            <SelectItem
                              key={s}
                              value={s}
                              className="capitalize text-xs"
                            >
                              {s.replace("_", " ")}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Badge
                        variant="outline"
                        className={`text-xs capitalize ${statusClass(item.evidenceStatus)}`}
                      >
                        {item.evidenceStatus.replace("_", " ")}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {item.documentName || "—"}
                  </TableCell>
                  <TableCell className="text-sm">
                    {item.excerpt ? (
                      <p className="line-clamp-2 text-muted-foreground italic text-xs border-l-2 pl-2">
                        "{item.excerpt}"
                      </p>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {canWriteEvidence &&
                        canApproveEvidence &&
                        item.suggested && (
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Confirm mapping"
                            disabled={actingId === item.id}
                            onClick={() => confirmItem(item)}
                          >
                            <Check className="w-4 h-4 text-emerald-600" />
                          </Button>
                        )}
                      {canWriteEvidence &&
                        (canApproveEvidence ||
                          !(
                            item.confirmedBy ||
                            (!item.suggested &&
                              item.evidenceStatus !== "pending")
                          )) && (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Edit"
                              onClick={() => openEdit(item)}
                            >
                              <Pencil className="w-4 h-4 text-muted-foreground" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Delete"
                              disabled={actingId === item.id}
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
          <div className="p-12 text-center text-muted-foreground">
            <Layers className="w-12 h-12 mx-auto mb-3 text-muted" />
            <p>No evidence linked yet.</p>
          </div>
        )}
      </div>

      <Dialog
        open={canWriteEvidence && dialogOpen}
        onOpenChange={setDialogOpen}
      >
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle className="font-serif">
              {editingId ? "Edit evidence link" : "Link evidence"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase">
                Requirement
              </label>
              <Select
                value={form.requirementId}
                onValueChange={(v) => setForm({ ...form, requirementId: v })}
                disabled={!!editingId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a requirement" />
                </SelectTrigger>
                <SelectContent>
                  {(requirements ?? []).map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.text.slice(0, 70)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground uppercase">
                  Document
                </label>
                <Select
                  value={form.documentId}
                  onValueChange={(v) => setForm({ ...form, documentId: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>None</SelectItem>
                    {(documents ?? []).map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.filename}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground uppercase">
                  Status
                </label>
                {canWriteEvidence && canApproveEvidence ? (
                  <Select
                    value={form.evidenceStatus}
                    onValueChange={(v) =>
                      setForm({
                        ...form,
                        evidenceStatus: v as MapForm["evidenceStatus"],
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUSES.map((s) => (
                        <SelectItem key={s} value={s} className="capitalize">
                          {s.replace("_", " ")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
                    Pending review
                  </div>
                )}
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase">
                Excerpt
              </label>
              <Textarea
                value={form.excerpt}
                onChange={(e) => setForm({ ...form, excerpt: e.target.value })}
                className="min-h-[60px]"
                placeholder="Verbatim quote supporting the status"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase">
                Notes
              </label>
              <Textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                className="min-h-[50px]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {editingId ? "Save changes" : "Link evidence"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
