import { useId, useMemo, useState } from "react";
import type {
  CurrentDocumentVersionSnapshot,
  Document,
} from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { humaniseTokenCapitalised } from "@/lib/format";

function shortHash(value: string): string {
  return value.length > 20 ? `${value.slice(0, 10)}…${value.slice(-8)}` : value;
}

export function GovernedDocumentPicker({
  label,
  description,
  documents,
  selectedDocumentId,
  onSelect,
  currentVersion,
  documentsLoading,
  documentsError,
  versionLoading,
  versionError,
  requireVerifiedSnapshot = false,
}: {
  label: string;
  description: string;
  documents: Document[];
  selectedDocumentId: string;
  onSelect: (documentId: string) => void;
  currentVersion: CurrentDocumentVersionSnapshot | undefined;
  documentsLoading: boolean;
  documentsError: boolean;
  versionLoading: boolean;
  versionError: boolean;
  requireVerifiedSnapshot?: boolean;
}) {
  const controlId = useId();
  const [search, setSearch] = useState("");
  const governedDocuments = useMemo(
    () =>
      documents.filter((document) => document.redactionStatus !== "excluded"),
    [documents],
  );
  const filteredDocuments = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return governedDocuments;
    return governedDocuments.filter((document) =>
      [document.filename, document.type, document.source, document.id]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase().includes(query)),
    );
  }, [governedDocuments, search]);
  const selectedDocument = governedDocuments.find(
    (document) => document.id === selectedDocumentId,
  );
  const selectableDocuments =
    selectedDocument &&
    !filteredDocuments.some((document) => document.id === selectedDocument.id)
      ? [selectedDocument, ...filteredDocuments]
      : filteredDocuments;
  const snapshotIsVerified = currentVersion?.snapshot?.status === "verified";

  return (
    <div className="grid gap-3">
      <div>
        <Label htmlFor={`${controlId}-select`}>{label}</Label>
        <p
          id={`${controlId}-description`}
          className="mt-1 text-xs leading-5 text-muted-foreground"
        >
          {description}
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
        <div className="grid gap-1.5">
          <Label htmlFor={`${controlId}-search`} className="text-xs">
            Search available documents
          </Label>
          <Input
            id={`${controlId}-search`}
            type="search"
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
            placeholder="Filename, type or source"
            disabled={documentsLoading || documentsError}
          />
        </div>
        <div className="grid gap-1.5">
          <span className="text-xs font-medium">Filtered selection</span>
          <select
            id={`${controlId}-select`}
            aria-describedby={`${controlId}-description`}
            className="h-10 min-w-0 rounded-md border border-input bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50"
            value={selectedDocumentId}
            onChange={(event) => onSelect(event.currentTarget.value)}
            disabled={
              documentsLoading ||
              documentsError ||
              governedDocuments.length === 0
            }
          >
            <option value="">No document selected</option>
            {selectableDocuments.map((document) => (
              <option key={document.id} value={document.id}>
                {document.filename} — {humaniseTokenCapitalised(document.type)}{" "}
                · {humaniseTokenCapitalised(document.redactionStatus)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {documentsLoading ? (
        <p role="status" className="text-xs text-muted-foreground">
          Loading documents available to your current organisation role…
        </p>
      ) : documentsError ? (
        <p role="alert" className="text-xs leading-5 text-destructive">
          The governed project-document list could not be verified. No document
          or version identifier can be entered from memory.
        </p>
      ) : governedDocuments.length === 0 ? (
        <p className="text-xs leading-5 text-muted-foreground">
          No included or redacted project document is available to this role.
          Add or restore a governed document before creating a citation.
        </p>
      ) : filteredDocuments.length === 0 ? (
        <p className="text-xs leading-5 text-muted-foreground">
          No available document matches this search. Clear the search to inspect
          the full permission-scoped list.
        </p>
      ) : null}

      {selectedDocumentId ? (
        versionLoading ? (
          <p role="status" className="text-xs text-muted-foreground">
            Verifying the exact current document version…
          </p>
        ) : versionError ? (
          <p role="alert" className="text-xs leading-5 text-destructive">
            The selected document's current version could not be verified. It
            cannot be used for this action.
          </p>
        ) : currentVersion ? (
          <div className="rounded-md border border-border bg-muted/30 p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-sm font-medium">{currentVersion.filename}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  The current version is supplied by the server and cannot be
                  edited here.
                </p>
              </div>
              <Badge
                variant={
                  requireVerifiedSnapshot && !snapshotIsVerified
                    ? "destructive"
                    : "outline"
                }
              >
                {currentVersion.snapshot
                  ? `Snapshot ${humaniseTokenCapitalised(currentVersion.snapshot.status)}`
                  : "No reviewed snapshot"}
              </Badge>
            </div>
            <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Exact current version</dt>
                <dd className="mt-0.5 break-all font-mono">
                  {currentVersion.documentVersionId}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Version SHA-256</dt>
                <dd
                  className="mt-0.5 font-mono"
                  title={currentVersion.documentVersionSha256}
                >
                  {shortHash(currentVersion.documentVersionSha256)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Redaction</dt>
                <dd className="mt-0.5">
                  {humaniseTokenCapitalised(currentVersion.redactionStatus)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Extraction</dt>
                <dd className="mt-0.5">
                  {humaniseTokenCapitalised(currentVersion.extractionStatus)}
                </dd>
              </div>
            </dl>
            {requireVerifiedSnapshot && !snapshotIsVerified ? (
              <p
                role="alert"
                className="mt-3 text-xs leading-5 text-destructive"
              >
                Rehearsal requires the exact current document version to have a
                verified named-human snapshot. Capture or verify it in Tender
                Context before continuing.
              </p>
            ) : null}
          </div>
        ) : (
          <p role="alert" className="text-xs leading-5 text-destructive">
            No unambiguous current version is available for the selected
            document. It cannot be used for this action.
          </p>
        )
      ) : null}
    </div>
  );
}
