import { useState } from "react";
import { Link } from "wouter";
import {
  useListSbdTemplates,
  useCreateSbdTemplate,
  getListSbdTemplatesQueryKey,
  type SbdTemplate,
  SbdTemplateCreateCategory,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
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
import { Loader2, FilePlus2, Library } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useOrganisationPermission } from "@/contexts/organisation-context";

const CATEGORY_LABELS: Record<string, string> = {
  goods: "Goods",
  works: "Works",
  consultancy: "Consultancy",
  non_consultancy: "Non-Consultancy",
  special: "Special",
};

const STATUS_STYLES: Record<string, string> = {
  active:
    "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  draft: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30",
  superseded: "bg-muted text-muted-foreground border-border",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge
      variant="outline"
      className={`text-xs capitalize ${STATUS_STYLES[status] ?? STATUS_STYLES.superseded}`}
    >
      {status}
    </Badge>
  );
}

interface FormState {
  code: string;
  title: string;
  category: string;
  issuingCircular: string;
  summary: string;
}

const EMPTY_FORM: FormState = {
  code: "",
  title: "",
  category: "goods",
  issuingCircular: "",
  summary: "",
};

export default function SbdCorpus() {
  const canReviewRequirements = useOrganisationPermission("requirement:review");
  const { data: templates, isLoading } = useListSbdTemplates();
  const createTemplate = useCreateSbdTemplate();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: getListSbdTemplatesQueryKey() });

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const handleSave = () => {
    if (!form.code.trim() || !form.title.trim()) {
      toast({ variant: "destructive", title: "Code and title are required" });
      return;
    }
    createTemplate.mutate(
      {
        data: {
          code: form.code.trim(),
          title: form.title.trim(),
          category: form.category as SbdTemplateCreateCategory,
          issuingCircular: form.issuingCircular.trim() || undefined,
          summary: form.summary.trim() || undefined,
        },
      },
      {
        onSuccess: () => {
          setDialogOpen(false);
          refresh();
        },
        onError: () =>
          toast({ variant: "destructive", title: "Could not create template" }),
      },
    );
  };

  return (
    <div className="p-6 md:p-10 max-w-6xl mx-auto w-full space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-serif tracking-tight font-medium">
            Requirements &amp; compliance
          </h1>
          <p className="text-muted-foreground text-sm mt-1 max-w-2xl">
            Reusable, versioned bidding-document templates with notes about each
            agency's required format.
          </p>
        </div>
        {canReviewRequirements && (
          <Button size="sm" onClick={openCreate}>
            <FilePlus2 className="w-4 h-4 mr-2" />
            New template
          </Button>
        )}
      </div>

      <div className="bg-card border border-border rounded-lg shadow-xs overflow-hidden">
        {isLoading ? (
          <div className="p-10 flex justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : templates && templates.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead>Code</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Annotations</TableHead>
                <TableHead>Circular</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.map((t: SbdTemplate) => (
                <TableRow
                  key={t.id}
                  className="cursor-pointer hover:bg-muted/20"
                >
                  <TableCell className="font-mono text-sm">
                    <Link href={`/sbd/${t.id}`} className="hover:underline">
                      {t.code}
                    </Link>
                  </TableCell>
                  <TableCell className="font-medium">
                    <Link href={`/sbd/${t.id}`} className="hover:underline">
                      {t.title}
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {CATEGORY_LABELS[t.category] ?? t.category}
                  </TableCell>
                  <TableCell className="text-sm">v{t.version}</TableCell>
                  <TableCell>
                    <StatusBadge status={t.status} />
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {t.annotationCount ?? 0}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {t.issuingCircular || "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="p-12 text-center text-muted-foreground">
            <Library className="w-12 h-12 mx-auto mb-3 text-muted" />
            <p>No Standard Bidding Documents yet.</p>
            <p className="text-sm mt-1">
              Add the revised BPP documents as reusable templates.
            </p>
          </div>
        )}
      </div>

      <Dialog
        open={canReviewRequirements && dialogOpen}
        onOpenChange={setDialogOpen}
      >
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle className="font-serif">New SBD template</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground uppercase">
                  Code
                </label>
                <Input
                  placeholder="e.g. SBD-GOODS"
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground uppercase">
                  Category
                </label>
                <Select
                  value={form.category}
                  onValueChange={(val) => setForm({ ...form, category: val })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(CATEGORY_LABELS).map(([val, label]) => (
                      <SelectItem key={val} value={val}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase">
                Title
              </label>
              <Input
                placeholder="Standard Bidding Document — Procurement of Goods"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase">
                Issuing Circular
              </label>
              <Input
                placeholder="e.g. BPP Circular Ref. …"
                value={form.issuingCircular}
                onChange={(e) =>
                  setForm({ ...form, issuingCircular: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase">
                Summary
              </label>
              <Textarea
                placeholder="Scope and notes on this document family."
                value={form.summary}
                onChange={(e) => setForm({ ...form, summary: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={createTemplate.isPending}>
              {createTemplate.isPending && (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              )}
              Create template
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
