import { useState } from "react";
import {
  useListDefects,
  useSuggestDefects,
  useCreateDefect,
  updateDefect as updateDefectRequest,
  useListRequirements,
  getListDefectsQueryKey,
  type Defect,
} from "@workspace/api-client-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
  AlertOctagon,
  Check,
  Plus,
  Pencil,
  ShieldCheck,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { mutationErrorToast } from "@/lib/errors";
import { useOrganisationPermission } from "@/contexts/organisation-context";

const DEFECT_TYPES = [
  "omission",
  "expiry",
  "arithmetic",
  "formatting",
  "responsiveness",
  "eligibility",
  "unsupported_claim",
  "validity",
] as const;
const SEVERITIES = [
  "fatal",
  "likely_fatal",
  "scoring_risk",
  "cosmetic",
] as const;
const SEVERITY_RANK: Record<(typeof SEVERITIES)[number], number> = {
  cosmetic: 0,
  scoring_risk: 1,
  likely_fatal: 2,
  fatal: 3,
};

interface DefectForm {
  type: (typeof DEFECT_TYPES)[number];
  severity: (typeof SEVERITIES)[number];
  description: string;
  remediation: string;
  owner: string;
  requirementId: string;
}
const NONE = "__none__";
const EMPTY: DefectForm = {
  type: "omission",
  severity: "likely_fatal",
  description: "",
  remediation: "",
  owner: "",
  requirementId: NONE,
};

export function DefectsTab({ projectId }: { projectId: string }) {
  const canWriteDefects = useOrganisationPermission("defect:write");
  const canReviewDefects = useOrganisationPermission("defect:review");
  const { data: defects, isLoading } = useListDefects(projectId);
  const { data: requirements } = useListRequirements(projectId);
  const suggestDefects = useSuggestDefects();
  const createDefect = useCreateDefect();
  const updateDefect = useMutation({
    mutationFn: ({
      defect,
      data,
    }: {
      defect: Defect;
      data: Record<string, unknown>;
    }) =>
      updateDefectRequest(defect.id, data as never, {
        headers: { "If-Match": `"${defect.version}"` },
      }),
  });
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<DefectForm>(EMPTY);
  const [actingId, setActingId] = useState<string | null>(null);

  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: getListDefectsQueryKey(projectId),
    });

  const handleSuggest = () => {
    suggestDefects.mutate(
      { id: projectId },
      {
        onSuccess: refresh,
        onError: mutationErrorToast(toast, "Defect suggestion failed"),
      },
    );
  };

  const patch = (d: Defect, data: Record<string, unknown>, verb: string) => {
    setActingId(d.id);
    updateDefect.mutate(
      { defect: d, data },
      {
        onSuccess: refresh,
        onError: mutationErrorToast(toast, `Could not ${verb} defect`),
        onSettled: () => setActingId(null),
      },
    );
  };

  // Promote an AI suggestion to a confirmed-live defect. This is what makes a
  // fatal defect actually block sign-off — until a defect is "open" the
  // fatal-block invariant cannot fire.
  const confirm = (d: Defect) =>
    patch(d, { status: "open", suggested: false }, "confirm");

  const openAdd = () => {
    setEditingId(null);
    setForm(EMPTY);
    setDialogOpen(true);
  };
  const openEdit = (d: Defect) => {
    setEditingId(d.id);
    setForm({
      type: d.type as DefectForm["type"],
      severity: d.severity as DefectForm["severity"],
      description: d.description,
      remediation: d.remediation ?? "",
      owner: d.owner ?? "",
      requirementId: d.requirementId ?? NONE,
    });
    setDialogOpen(true);
  };

  const handleSave = () => {
    if (!form.description.trim()) {
      toast({ variant: "destructive", title: "Description is required" });
      return;
    }
    const body = {
      type: form.type,
      ...(!editingId || canReviewDefects ? { severity: form.severity } : {}),
      description: form.description.trim(),
      remediation: form.remediation.trim() || undefined,
      owner: form.owner.trim() || undefined,
      requirementId:
        form.requirementId === NONE ? undefined : form.requirementId,
    };
    const opts = {
      onSuccess: () => {
        setDialogOpen(false);
        refresh();
      },
      onError: mutationErrorToast(toast, "Could not save defect"),
    };
    if (editingId) {
      const current = defects?.find((defect) => defect.id === editingId);
      if (!current) {
        toast({
          variant: "destructive",
          title: "Reload the defect before editing",
        });
        return;
      }
      updateDefect.mutate({ defect: current, data: body }, opts);
    } else {
      createDefect.mutate({ data: { ...body, projectId } as never }, opts);
    }
  };

  const saving = createDefect.isPending || updateDefect.isPending;
  const editingDefect = editingId
    ? defects?.find((defect) => defect.id === editingId)
    : undefined;
  const allowedEditSeverities = editingDefect
    ? SEVERITIES.filter(
        (severity) =>
          SEVERITY_RANK[severity] >=
          SEVERITY_RANK[editingDefect.severity as (typeof SEVERITIES)[number]],
      )
    : SEVERITIES;

  const statusBadge = (d: Defect) => {
    if (d.status === "suggested" || d.suggested)
      return (
        <Badge
          variant="outline"
          className="text-xs text-blue-700 border-blue-300 bg-blue-50"
        >
          suggested
        </Badge>
      );
    if (d.status === "open")
      return (
        <Badge
          variant="outline"
          className="text-xs text-destructive border-destructive/30 bg-destructive/10"
        >
          open
        </Badge>
      );
    if (d.status === "remediated")
      return (
        <Badge
          variant="outline"
          className="text-xs text-emerald-700 border-emerald-300 bg-emerald-50"
        >
          remediated
        </Badge>
      );
    if (d.status === "waived")
      return (
        <Badge variant="outline" className="text-xs text-muted-foreground">
          waived
        </Badge>
      );
    return (
      <Badge variant="outline" className="text-xs capitalize">
        {d.status}
      </Badge>
    );
  };

  const openFatalCount = (defects ?? []).filter(
    (d) =>
      d.status === "open" &&
      (d.severity === "fatal" || d.severity === "likely_fatal"),
  ).length;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-serif font-medium">
          Issues and independent review
        </h2>
        <div className="flex gap-2">
          {canWriteDefects && (
            <Button onClick={openAdd} variant="outline">
              <Plus className="w-4 h-4 mr-2" /> Add issue
            </Button>
          )}
          {canWriteDefects && (
            <Button
              onClick={handleSuggest}
              disabled={suggestDefects.isPending}
              variant="secondary"
            >
              {suggestDefects.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Zap className="w-4 h-4 mr-2" />
              )}
              Suggest issues
            </Button>
          )}
        </div>
      </div>

      {openFatalCount > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
          <ShieldCheck className="w-4 h-4 shrink-0" />
          <p>
            {openFatalCount} open fatal or likely-fatal issue(s). Report
            sign-off stays blocked until each has a saved fix, waiver or
            reclassification decision.
          </p>
        </div>
      )}

      <div className="bg-card border border-border rounded-lg shadow-xs overflow-hidden">
        {isLoading ? (
          <div className="p-8 flex justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : defects && defects.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead className="w-[110px]">Status</TableHead>
                <TableHead className="w-[120px]">Severity</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="w-[200px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {defects.map((defect) => (
                <TableRow
                  key={defect.id}
                  className={
                    defect.status === "waived" ? "opacity-60" : undefined
                  }
                >
                  <TableCell>{statusBadge(defect)}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        defect.severity === "fatal" ||
                        defect.severity === "likely_fatal"
                          ? "destructive"
                          : "secondary"
                      }
                      className="capitalize text-xs"
                    >
                      {defect.severity.replace("_", " ")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground capitalize">
                    {defect.type.replace("_", " ")}
                  </TableCell>
                  <TableCell>
                    <p className="text-sm font-medium">{defect.description}</p>
                    {defect.remediation && (
                      <p className="text-xs text-muted-foreground mt-1">
                        <span className="font-semibold text-foreground">
                          Remediation:
                        </span>{" "}
                        {defect.remediation}
                      </p>
                    )}
                    {defect.requirementText && (
                      <p className="text-xs text-muted-foreground mt-1 truncate">
                        ↳ {defect.requirementText}
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {canReviewDefects &&
                        (defect.status === "suggested" || defect.suggested) && (
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Confirm and mark open"
                            disabled={actingId === defect.id}
                            onClick={() => confirm(defect)}
                          >
                            <Check className="w-4 h-4 text-emerald-600" />
                          </Button>
                        )}
                      {canWriteDefects && (
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Edit defect details"
                          onClick={() => openEdit(defect)}
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
            <AlertOctagon className="w-12 h-12 mx-auto mb-3 text-muted" />
            <p>No issues identified.</p>
          </div>
        )}
      </div>

      <Dialog
        open={(canWriteDefects || canReviewDefects) && dialogOpen}
        onOpenChange={setDialogOpen}
      >
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle className="font-serif">
              {editingId ? "Edit issue" : "Add issue"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground uppercase">
                  Type
                </label>
                <Select
                  value={form.type}
                  onValueChange={(v) =>
                    setForm({ ...form, type: v as DefectForm["type"] })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DEFECT_TYPES.map((t) => (
                      <SelectItem key={t} value={t} className="capitalize">
                        {t.replace("_", " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground uppercase">
                  Severity
                </label>
                {!editingId || canReviewDefects ? (
                  <Select
                    value={form.severity}
                    onValueChange={(v) =>
                      setForm({
                        ...form,
                        severity: v as DefectForm["severity"],
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {allowedEditSeverities.map((sv) => (
                        <SelectItem key={sv} value={sv} className="capitalize">
                          {sv.replace("_", " ")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm capitalize">
                    {form.severity.replace("_", " ")}
                  </div>
                )}
              </div>
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
                className="min-h-[80px]"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase">
                Remediation
              </label>
              <Textarea
                value={form.remediation}
                onChange={(e) =>
                  setForm({ ...form, remediation: e.target.value })
                }
                className="min-h-[60px]"
                placeholder="Concrete fix"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground uppercase">
                  Owner
                </label>
                <Input
                  value={form.owner}
                  onChange={(e) => setForm({ ...form, owner: e.target.value })}
                  placeholder="Who fixes it"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground uppercase">
                  Related Requirement
                </label>
                <Select
                  value={form.requirementId}
                  onValueChange={(v) => setForm({ ...form, requirementId: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>None</SelectItem>
                    {(requirements ?? []).map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.text.slice(0, 60)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {editingId ? "Save changes" : "Add issue"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
