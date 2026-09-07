import {
  useListDocuments,
  useDeleteDocument,
  useUpdateDocument,
  useVerifyDocument,
  useExtractDocument,
  getListDocumentsQueryKey,
  type Document,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FileText,
  Loader2,
  Trash2,
  Lock,
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
  RefreshCw,
} from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { errorMessage, mutationErrorToast } from "@/lib/errors";
import { useOrganisationPermission } from "@/contexts/organisation-context";
import { DataErrorPanel, LoadingPanel } from "@/components/platform-states";
import { DestructiveConfirmation } from "@/components/destructive-confirmation";

const NDA_ALLOWED = new Set(["signed", "not_required"]);
const DOC_TYPES = [
  "tender",
  "bid",
  "certificate",
  "boq",
  "evidence",
  "other",
] as const;
const REDACTION = ["excluded", "redacted", "included"] as const;
const PENDING_EXTRACTION = new Set(["pending", "extracting"]);

function documentDeleteTarget(document: Document): string {
  const recordedAt = document.dateReceived ?? document.createdAt;
  return `${document.filename} — ${document.type.replaceAll("_", " ")} document; ID ${document.id}; recorded ${recordedAt}`;
}

export function DocumentsTab({
  projectId,
  ndaStatus,
  conflictStatus,
  restrictedMode,
}: {
  projectId: string;
  ndaStatus?: string | null;
  conflictStatus?: string | null;
  restrictedMode?: boolean | null;
}) {
  const canUploadDocument = useOrganisationPermission("document:upload");
  const canReviewDocuments = useOrganisationPermission("evidence:approve");
  const canDeleteDocument = useOrganisationPermission("document:delete");
  const ndaCleared = !!ndaStatus && NDA_ALLOWED.has(ndaStatus);
  const intakeBlockedByConflict =
    conflictStatus === "blocked" || conflictStatus === "declined";
  // Poll while any document is still extracting so the status flips live.
  const {
    data: documents,
    isLoading,
    isPending: documentsPending,
    isError,
    isSuccess,
    refetch,
  } = useListDocuments(projectId, {
    query: {
      refetchInterval: (query: { state: { data?: Document[] } }) =>
        query.state.data?.some((d) =>
          PENDING_EXTRACTION.has(d.extractionStatus ?? ""),
        )
          ? 2500
          : false,
    } as never,
  });
  const deleteDocument = useDeleteDocument();
  const updateDocument = useUpdateDocument();
  const verifyDocument = useVerifyDocument();
  const extractDocument = useExtractDocument();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [integrity, setIntegrity] = useState<Record<string, "ok" | "failed">>(
    {},
  );
  const [verifyingIds, setVerifyingIds] = useState<Set<string>>(new Set());
  const [documentToDelete, setDocumentToDelete] = useState<Document | null>(
    null,
  );
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: getListDocumentsQueryKey(projectId),
    });

  const patchDoc = (
    id: string,
    data: { type?: string; redactionStatus?: string },
    label: string,
  ) => {
    if (!isSuccess) return;
    updateDocument.mutate(
      { id, data: data as never },
      {
        onSuccess: refresh,
        onError: mutationErrorToast(toast, `Could not update ${label}`),
      },
    );
  };

  const handleDelete = () => {
    if (!documentToDelete || !isSuccess) return;
    deleteDocument.mutate(
      { id: documentToDelete.id },
      {
        onSuccess: () => {
          const filename = documentToDelete.filename;
          setDocumentToDelete(null);
          setDeleteError(null);
          refresh();
          toast({
            title: "Document deleted",
            description: `${filename} was permanently removed.`,
          });
        },
        onError: (err) => {
          const message = errorMessage(
            err,
            "The document was not deleted. Only an admin can delete documents.",
          );
          setDeleteError(message);
          toast({
            variant: "destructive",
            title: "Could not delete document",
            description: message,
          });
        },
      },
    );
  };

  const handleReextract = (id: string) => {
    if (!isSuccess) return;
    extractDocument.mutate(
      { id },
      {
        onSuccess: refresh,
        onError: (err) => {
          refresh();
          toast({
            variant: "destructive",
            title: "Could not start extraction",
            description: errorMessage(err, ""),
          });
        },
      },
    );
  };

  const handleVerify = async (id: string, filename: string) => {
    if (!isSuccess) return;
    setVerifyingIds((prev) => new Set(prev).add(id));
    try {
      const result = await verifyDocument.mutateAsync({ id });
      if (result.ok) {
        setIntegrity((prev) => ({ ...prev, [id]: "ok" }));
        toast({
          title: "Integrity verified",
          description: `${filename} matches its intake SHA-256.`,
        });
      } else if (result.actualSha256 == null) {
        toast({
          variant: "destructive",
          title: "Verification unavailable",
          description: `${filename}: the stored object could not be read — try again; if this persists, contact an administrator.`,
        });
      } else {
        setIntegrity((prev) => ({ ...prev, [id]: "failed" }));
        toast({
          variant: "destructive",
          title: "Integrity check FAILED",
          description: `${filename} does not match its intake SHA-256 — the stored file has changed.`,
        });
      }
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Verification unavailable",
        description: errorMessage(err, "This document could not be verified."),
      });
    } finally {
      setVerifyingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const extractionBadge = (doc: Document) => {
    const s = doc.extractionStatus ?? "pending";
    // Extraction telemetry (FR-OCR-01/02): the badge names the method and
    // confidence, and the tooltip carries the per-document extraction notes.
    const title = doc.extractionNotes ?? undefined;
    if (s === "quarantined") {
      return (
        <Badge
          variant="outline"
          title={title}
          className="text-xs text-destructive border-destructive/30 bg-destructive/10"
        >
          security quarantined
        </Badge>
      );
    }
    if (doc.redactionStatus === "excluded") {
      return (
        <Badge
          variant="outline"
          title={title}
          className="text-xs text-amber-700 border-amber-300 bg-amber-50"
        >
          excluded · no model
        </Badge>
      );
    }
    if (s === "extracted") {
      const viaOcr = doc.extractionMethod === "multimodal_ocr";
      const pct =
        doc.extractionConfidence != null
          ? ` ${(doc.extractionConfidence * 100).toFixed(0)}%`
          : "";
      return (
        <Badge
          variant="outline"
          title={title}
          className={
            viaOcr
              ? "text-xs text-amber-700 border-amber-300 bg-amber-50"
              : "text-xs text-emerald-600 border-emerald-200 bg-emerald-50"
          }
        >
          {viaOcr ? `OCR${pct} — verify` : `text ready${pct}`}
        </Badge>
      );
    }
    if (s === "extracting" || s === "pending")
      return (
        <Badge
          variant="outline"
          className="text-xs text-amber-700 border-amber-300 bg-amber-50"
        >
          <Loader2 className="w-3 h-3 mr-1 animate-spin" /> extracting
        </Badge>
      );
    if (s === "skipped")
      return (
        <Badge
          variant="outline"
          title={title}
          className="text-xs text-teal-700 border-teal-300 bg-teal-50"
        >
          ready to extract
        </Badge>
      );
    return (
      <Badge
        variant="outline"
        title={title}
        className="text-xs text-destructive border-destructive/30 bg-destructive/10"
      >
        failed
      </Badge>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-serif font-medium">Pursuit documents</h2>
        {canUploadDocument && (
          <Button disabled aria-describedby="document-upload-unavailable">
            <Lock className="w-4 h-4 mr-2" />
            Upload unavailable
          </Button>
        )}
      </div>

      {canUploadDocument && (
        <div
          id="document-upload-unavailable"
          role="status"
          className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400"
        >
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>
            New pursuit document uploads are temporarily unavailable. Signed
            uploads stay off until every upload has a durable lease and the
            storage provider is confirmed to create new files only. Existing
            documents remain available to read and manage. This control will not
            send an upload request.
          </p>
        </div>
      )}

      {canUploadDocument && !ndaCleared && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
          <Lock className="w-4 h-4 mt-0.5 shrink-0" />
          <p>
            Record this client's NDA status before any future document intake.
            Resolving the NDA status does not turn on uploads.
          </p>
        </div>
      )}

      {canUploadDocument && intakeBlockedByConflict && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
          <p>
            This pursuit has a {conflictStatus} conflict decision. It must be
            cleared or consented before any future document intake. Resolving it
            does not turn on uploads.
          </p>
        </div>
      )}

      {restrictedMode && (
        <div className="flex items-start gap-2 rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-3 text-sm text-blue-700 dark:text-blue-300">
          <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0" />
          <p>
            Restricted Mode is active for this pursuit. Keep only approved
            redacted material available to AI steps.
          </p>
        </div>
      )}

      {canReviewDocuments && (
        <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground">
          <FileText className="w-4 h-4 mt-0.5 shrink-0" />
          <p>
            Documents are <strong>excluded</strong> by default, so financial
            pages stay out of AI analysis. Set a tender or bid document to
            <strong>included</strong> or <strong>redacted</strong>, then choose
            <strong>Start extraction</strong> before AI extraction or evidence
            mapping can read it. Excluded documents are skipped and never sent
            to AI text recognition.
          </p>
        </div>
      )}

      <div className="bg-card border border-border rounded-lg shadow-xs overflow-hidden">
        {isLoading || documentsPending ? (
          <LoadingPanel label="Loading pursuit documents" />
        ) : isError || !isSuccess ? (
          <div className="p-4">
            <DataErrorPanel
              title="We couldn't load the pursuit documents"
              description="Document records and their current security status are unavailable. Actions stay disabled until the latest records load."
              onRetry={() => void refetch()}
            />
          </div>
        ) : documents.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead>Filename</TableHead>
                <TableHead className="w-[130px]">Type</TableHead>
                <TableHead className="w-[130px]">Redaction</TableHead>
                <TableHead>Extraction</TableHead>
                <TableHead>Integrity</TableHead>
                <TableHead className="w-[80px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {documents.map((doc) => (
                <TableRow key={doc.id}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                      <span className="truncate max-w-[240px]">
                        {doc.filename}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {canUploadDocument ? (
                      <Select
                        value={doc.type}
                        onValueChange={(v) =>
                          patchDoc(doc.id, { type: v }, "type")
                        }
                      >
                        <SelectTrigger
                          aria-label={`${doc.filename} document type`}
                          className="h-7 text-xs capitalize"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {DOC_TYPES.map((t) => (
                            <SelectItem
                              key={t}
                              value={t}
                              className="capitalize text-xs"
                            >
                              {t}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="text-xs capitalize">{doc.type}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {canReviewDocuments &&
                    doc.extractionStatus !== "quarantined" ? (
                      <Select
                        value={doc.redactionStatus}
                        onValueChange={(v) =>
                          patchDoc(
                            doc.id,
                            { redactionStatus: v },
                            "redaction status",
                          )
                        }
                      >
                        <SelectTrigger
                          aria-label={`${doc.filename} redaction status`}
                          className={`h-7 text-xs capitalize ${doc.redactionStatus === "excluded" ? "text-amber-700" : ""}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {REDACTION.map((r) => (
                            <SelectItem
                              key={r}
                              value={r}
                              className="capitalize text-xs"
                            >
                              {r}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="text-xs capitalize">
                        {doc.redactionStatus}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      {extractionBadge(doc)}
                      {canReviewDocuments &&
                        doc.redactionStatus !== "excluded" &&
                        (doc.extractionStatus === "failed" ||
                          doc.extractionStatus === "skipped") && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            title={
                              doc.extractionStatus === "failed"
                                ? "Retry extraction"
                                : "Start extraction"
                            }
                            aria-label={
                              doc.extractionStatus === "failed"
                                ? `Retry extraction for ${doc.filename}`
                                : `Start extraction for ${doc.filename}`
                            }
                            onClick={() => handleReextract(doc.id)}
                            disabled={extractDocument.isPending}
                          >
                            <RefreshCw className="w-3.5 h-3.5 text-muted-foreground" />
                          </Button>
                        )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {doc.sha256 ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2"
                        onClick={() => handleVerify(doc.id, doc.filename)}
                        disabled={verifyingIds.has(doc.id)}
                        title={`Intake SHA-256: ${doc.sha256}`}
                      >
                        {verifyingIds.has(doc.id) ? (
                          <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                        ) : integrity[doc.id] === "ok" ? (
                          <ShieldCheck className="w-4 h-4 mr-1 text-emerald-600" />
                        ) : integrity[doc.id] === "failed" ? (
                          <ShieldAlert className="w-4 h-4 mr-1 text-destructive" />
                        ) : (
                          <ShieldQuestion className="w-4 h-4 mr-1 text-muted-foreground" />
                        )}
                        <span className="text-xs">
                          {integrity[doc.id] === "ok"
                            ? "Verified"
                            : integrity[doc.id] === "failed"
                              ? "FAILED"
                              : "Verify"}
                        </span>
                      </Button>
                    ) : (
                      <span
                        className="text-xs text-muted-foreground"
                        title="Uploaded before integrity records were added — no intake fingerprint is recorded."
                      >
                        No fingerprint
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {canDeleteDocument && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Delete ${documentDeleteTarget(doc)}`}
                        onClick={() => {
                          setDeleteError(null);
                          setDocumentToDelete(doc);
                        }}
                        disabled={deleteDocument.isPending}
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
          <div className="p-12 text-center text-muted-foreground">
            <FileText className="w-12 h-12 mx-auto mb-3 text-muted" />
            <p>No documents uploaded yet.</p>
          </div>
        )}
      </div>

      <DestructiveConfirmation
        open={!!documentToDelete}
        onOpenChange={(open) => {
          if (!open) {
            setDocumentToDelete(null);
            setDeleteError(null);
          }
        }}
        itemName={
          documentToDelete
            ? documentDeleteTarget(documentToDelete)
            : "Selected document"
        }
        title="Permanently delete this document?"
        consequence="This removes the stored document record and can break extraction, evidence links and later report review. This action cannot be undone."
        confirmLabel="Delete document"
        pendingLabel="Deleting document…"
        pending={deleteDocument.isPending}
        error={deleteError}
        onConfirm={handleDelete}
      />
    </div>
  );
}
