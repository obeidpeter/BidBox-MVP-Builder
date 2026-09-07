import { useState } from "react";
import { Link, useParams } from "wouter";
import {
  useGetSbdTemplate,
  useUpdateSbdTemplate,
  useDeleteSbdTemplate,
  useCreateSbdTemplateVersion,
  useCreateSbdAnnotation,
  useDeleteSbdAnnotation,
  getGetSbdTemplateQueryKey,
  getListSbdTemplatesQueryKey,
  type SbdAnnotation,
  SbdTemplateUpdateStatus,
  SbdAnnotationCreateKind,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
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
import { Loader2, ArrowLeft, GitBranch, Trash2, Plus, Tag } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { StatusBadge } from "./sbd";
import { useOrganisationPermission } from "@/contexts/organisation-context";

const KIND_LABELS: Record<string, string> = {
  format: "Format",
  deviation: "Deviation",
  mandatory: "Mandatory",
  note: "Note",
};

const STATUSES = ["draft", "active", "superseded"];

interface AnnotationForm {
  agency: string;
  section: string;
  kind: string;
  quirk: string;
}

const EMPTY_ANNOTATION: AnnotationForm = {
  agency: "",
  section: "",
  kind: "format",
  quirk: "",
};

export default function SbdDetails() {
  const canReviewRequirements = useOrganisationPermission("requirement:review");
  const params = useParams();
  const id = params.id as string;
  const [, navigate] = useLocation();
  const { data: template, isLoading } = useGetSbdTemplate(id);
  const updateTemplate = useUpdateSbdTemplate();
  const deleteTemplate = useDeleteSbdTemplate();
  const createVersion = useCreateSbdTemplateVersion();
  const createAnnotation = useCreateSbdAnnotation();
  const deleteAnnotation = useDeleteSbdAnnotation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [annDialogOpen, setAnnDialogOpen] = useState(false);
  const [annForm, setAnnForm] = useState<AnnotationForm>(EMPTY_ANNOTATION);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: getGetSbdTemplateQueryKey(id) });
    queryClient.invalidateQueries({ queryKey: getListSbdTemplatesQueryKey() });
  };

  if (isLoading) {
    return (
      <div className="p-10 flex justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!template) {
    return (
      <div className="p-10 text-center text-muted-foreground">
        <p>Template not found.</p>
        <Link
          href="/sbd"
          className="text-primary hover:underline text-sm mt-2 inline-block"
        >
          Back to corpus
        </Link>
      </div>
    );
  }

  const changeStatus = (status: string) => {
    updateTemplate.mutate(
      { id, data: { status: status as SbdTemplateUpdateStatus } },
      {
        onSuccess: refresh,
        onError: () =>
          toast({ variant: "destructive", title: "Could not update status" }),
      },
    );
  };

  const handleNewVersion = () => {
    createVersion.mutate(
      { id },
      {
        onSuccess: (created) => {
          toast({ title: `Created v${created.version} as draft` });
          queryClient.invalidateQueries({
            queryKey: getListSbdTemplatesQueryKey(),
          });
          navigate(`/sbd/${created.id}`);
        },
        onError: () =>
          toast({ variant: "destructive", title: "Could not create version" }),
      },
    );
  };

  const handleDeleteTemplate = () => {
    deleteTemplate.mutate(
      { id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({
            queryKey: getListSbdTemplatesQueryKey(),
          });
          navigate("/sbd");
        },
        onError: () =>
          toast({ variant: "destructive", title: "Could not delete template" }),
      },
    );
  };

  const handleAddAnnotation = () => {
    if (!annForm.quirk.trim()) {
      toast({ variant: "destructive", title: "Annotation text is required" });
      return;
    }
    createAnnotation.mutate(
      {
        id,
        data: {
          agency: annForm.agency.trim() || undefined,
          section: annForm.section.trim() || undefined,
          kind: annForm.kind as SbdAnnotationCreateKind,
          quirk: annForm.quirk.trim(),
        },
      },
      {
        onSuccess: () => {
          setAnnDialogOpen(false);
          setAnnForm(EMPTY_ANNOTATION);
          refresh();
        },
        onError: () =>
          toast({ variant: "destructive", title: "Could not add annotation" }),
      },
    );
  };

  const handleDeleteAnnotation = (annId: string) => {
    deleteAnnotation.mutate(
      { id: annId },
      {
        onSuccess: refresh,
        onError: () =>
          toast({
            variant: "destructive",
            title: "Could not delete annotation",
          }),
      },
    );
  };

  return (
    <div className="p-6 md:p-10 max-w-5xl mx-auto w-full space-y-6">
      <Link
        href="/sbd"
        className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
      >
        <ArrowLeft className="w-4 h-4" />
        Standard bidding documents
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <span className="font-mono text-sm text-muted-foreground">
              {template.code}
            </span>
            <Badge variant="outline" className="text-xs">
              v{template.version}
            </Badge>
            <StatusBadge status={template.status} />
          </div>
          <h1 className="text-2xl font-serif tracking-tight font-medium">
            {template.title}
          </h1>
          {template.issuingCircular && (
            <p className="text-sm text-muted-foreground">
              Circular: {template.issuingCircular}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {canReviewRequirements && (
            <>
              <Select value={template.status} onValueChange={changeStatus}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => (
                    <SelectItem key={s} value={s} className="capitalize">
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                variant="outline"
                onClick={handleNewVersion}
                disabled={createVersion.isPending}
              >
                {createVersion.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <GitBranch className="w-4 h-4 mr-2" />
                )}
                New version
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label="Delete template"
                onClick={handleDeleteTemplate}
              >
                <Trash2 className="w-4 h-4 text-muted-foreground hover:text-destructive" />
              </Button>
            </>
          )}
        </div>
      </div>

      {template.summary && (
        <div className="bg-card border border-border rounded-lg p-4 text-sm text-muted-foreground">
          {template.summary}
        </div>
      )}

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-serif tracking-tight font-medium">
            Agency format notes
          </h2>
          {canReviewRequirements && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setAnnDialogOpen(true)}
            >
              <Plus className="w-4 h-4 mr-2" />
              Add note
            </Button>
          )}
        </div>

        <div className="bg-card border border-border rounded-lg shadow-xs overflow-hidden">
          {template.annotations.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead>Agency</TableHead>
                  <TableHead>Section</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead>Quirk</TableHead>
                  <TableHead className="w-[60px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {template.annotations.map((a: SbdAnnotation) => (
                  <TableRow key={a.id}>
                    <TableCell className="text-sm">{a.agency || "—"}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {a.section || "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {KIND_LABELS[a.kind] ?? a.kind}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">{a.quirk}</TableCell>
                    <TableCell>
                      {canReviewRequirements && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Delete annotation"
                          onClick={() => handleDeleteAnnotation(a.id)}
                        >
                          <Trash2 className="w-4 h-4 text-muted-foreground hover:text-destructive" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="p-10 text-center text-muted-foreground">
              <Tag className="w-10 h-10 mx-auto mb-3 text-muted" />
              <p>No agency format notes for this template version.</p>
              <p className="text-sm mt-1">
                Record agency-specific formatting and required deviations here.
              </p>
            </div>
          )}
        </div>
      </div>

      <Dialog
        open={canReviewRequirements && annDialogOpen}
        onOpenChange={setAnnDialogOpen}
      >
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle className="font-serif">
              Add agency format note
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground uppercase">
                  Agency
                </label>
                <Input
                  placeholder="e.g. BPP, NNPC"
                  value={annForm.agency}
                  onChange={(e) =>
                    setAnnForm({ ...annForm, agency: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground uppercase">
                  Section
                </label>
                <Input
                  placeholder="e.g. ITB 12.1"
                  value={annForm.section}
                  onChange={(e) =>
                    setAnnForm({ ...annForm, section: e.target.value })
                  }
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase">
                Kind
              </label>
              <Select
                value={annForm.kind}
                onValueChange={(val) => setAnnForm({ ...annForm, kind: val })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(KIND_LABELS).map(([val, label]) => (
                    <SelectItem key={val} value={val}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase">
                Format note
              </label>
              <Textarea
                placeholder="Describe the format quirk or deviation to watch for."
                value={annForm.quirk}
                onChange={(e) =>
                  setAnnForm({ ...annForm, quirk: e.target.value })
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAnnDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleAddAnnotation}
              disabled={createAnnotation.isPending}
            >
              {createAnnotation.isPending && (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              )}
              Add note
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
