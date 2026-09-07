import { useEffect, useId, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import {
  captureDocumentVersionSnapshot,
  createTenderContextVersion,
  createTenderEligibilityPassport,
  getGetCurrentDocumentVersionSnapshotQueryKey,
  getGetTenderContextCentreQueryKey,
  getListDocumentsQueryKey,
  reviewDocumentVersionSnapshot,
  reviewTenderContextVersion,
  reviewTenderEligibilityPassport,
  useGetCurrentDocumentVersionSnapshot,
  useGetMe,
  useGetTenderContextCentre,
  useListDocuments,
  type DocumentStructuredSnapshotV2,
  type TenderArtifactBindingCreate,
  type TenderContextVersion,
  type TenderEligibilityPassport,
  type TenderNamedReviewRequestDecision,
  type TenderRequirementBindingCreate,
} from "@workspace/api-client-react";
import { ArrowLeft, FileCheck2, RefreshCw, ShieldCheck } from "lucide-react";
import {
  DataErrorPanel,
  LoadingPanel,
  PageGatePanel,
  PageHeader,
  StateBadge,
  StatusPanel,
  type SurfaceState,
} from "@/components/platform-states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useOrganisationAccess } from "@/contexts/organisation-context";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/errors";
import { queryDisplayState } from "./tender-context-route-state";

const READ_PERMISSIONS = [
  "project:read",
  "document:read",
  "requirement:read",
  "evidence:read",
  "rule_pack:read",
] as const;

function directMembership(
  access: ReturnType<typeof useOrganisationAccess>,
): boolean {
  const organisation = access?.activeOrganisation;
  return Boolean(
    organisation &&
    organisation.accessSource === "membership" &&
    organisation.membershipOrganisationId === organisation.id &&
    organisation.partnerRelationshipId === null,
  );
}

function parseJsonArray<T>(raw: string, label: string): T[] {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(`${label} must be valid JSON.`);
  }
  if (!Array.isArray(value)) throw new Error(`${label} must be a JSON list.`);
  return value as T[];
}

function parseStructuredSnapshot(raw: string): DocumentStructuredSnapshotV2 {
  if (raw.length > 256_000) {
    throw new Error(
      "The structured snapshot is larger than 256,000 characters.",
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("The structured snapshot must be valid JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The structured snapshot must be one JSON object.");
  }
  const proposal = value as Record<string, unknown>;
  if (
    proposal.schema !== "valo.addendum-structured-snapshot/v2" ||
    (proposal.sourceKind !== "solicitation" &&
      proposal.sourceKind !== "addendum") ||
    (proposal.mode !== "full" && proposal.mode !== "delta") ||
    proposal.authority !== "authoritative" ||
    !Array.isArray(proposal.fields) ||
    !Array.isArray(proposal.operations)
  ) {
    throw new Error(
      "Use the closed v2 source kind, mode, authority, fields and operations contract.",
    );
  }
  return value as DocumentStructuredSnapshotV2;
}

function splitScopes(value: string): string[] {
  const scopes = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (scopes.length === 0 || new Set(scopes).size !== scopes.length) {
    throw new Error("Enter one or more unique comma-separated scopes.");
  }
  return scopes;
}

function recordedState(value: string): SurfaceState {
  if (value === "pending_review" || value === "captured") return "pending";
  if (value === "rejected") return "blocked";
  if (value === "needs_changes") return "partial";
  if (value === "superseded") return "unavailable";
  return "partial";
}

function ReviewActions({
  disabled,
  busy,
  onReview,
}: {
  disabled: boolean;
  busy: boolean;
  onReview: (decision: TenderNamedReviewRequestDecision, note: string) => void;
}) {
  const [note, setNote] = useState("");
  const reviewNoteId = useId();
  const submit = (decision: TenderNamedReviewRequestDecision) => {
    const normalized = note.trim();
    if (!normalized) return;
    onReview(decision, normalized);
  };
  return (
    <div className="mt-4 space-y-3 border-t border-border pt-4">
      <Label htmlFor={reviewNoteId}>Named review note</Label>
      <Textarea
        id={reviewNoteId}
        aria-label="Named review note"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        maxLength={5_000}
        placeholder="Record what you checked and why."
        disabled={disabled || busy}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          onClick={() => submit("accepted")}
          disabled={disabled || busy || !note.trim()}
        >
          Accept record
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => submit("needs_changes")}
          disabled={disabled || busy || !note.trim()}
        >
          Request changes
        </Button>
        <Button
          type="button"
          size="sm"
          variant="destructive"
          onClick={() => submit("rejected")}
          disabled={disabled || busy || !note.trim()}
        >
          Reject record
        </Button>
      </div>
      {disabled ? (
        <p className="text-xs text-muted-foreground">
          A different current member with Intelligence review permission must
          record the decision.
        </p>
      ) : null}
    </div>
  );
}

export default function TenderContextRoute() {
  const { id: projectId = "" } = useParams<{ id: string }>();
  const access = useOrganisationAccess();
  const meQuery = useGetMe();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const organisationId = access?.activeOrganisation?.id ?? "";
  const actorUserId = meQuery.data?.id ?? "";
  const permissions = access?.effectivePermissions ?? [];
  const canRead = Boolean(
    projectId &&
    organisationId &&
    READ_PERMISSIONS.every((permission) => permissions.includes(permission)),
  );
  const isDirectMember = directMembership(access);
  const canPropose = Boolean(
    canRead && isDirectMember && permissions.includes("requirement:write"),
  );
  const canReview = Boolean(
    canRead && isDirectMember && permissions.includes("intelligence:review"),
  );
  const capabilityKey = [
    ...READ_PERMISSIONS,
    "requirement:write",
    "intelligence:review",
  ]
    .map((permission) =>
      permissions.includes(permission) ? permission : `!${permission}`,
    )
    .join("|");
  const centreQueryKey = [
    ...getGetTenderContextCentreQueryKey(projectId),
    organisationId,
    actorUserId,
    capabilityKey,
  ] as const;
  const centreQuery = useGetTenderContextCentre(projectId, {
    query: {
      enabled: canRead && Boolean(actorUserId),
      queryKey: centreQueryKey,
      staleTime: 0,
      gcTime: 0,
    },
  });
  const documentsQuery = useListDocuments(projectId, {
    query: {
      enabled: canRead && Boolean(actorUserId),
      queryKey: [
        ...getListDocumentsQueryKey(projectId),
        organisationId,
        actorUserId,
        capabilityKey,
      ],
      staleTime: 0,
      gcTime: 0,
    },
  });
  const documents = documentsQuery.data ?? [];
  const [selectedDocumentId, setSelectedDocumentId] = useState("");
  useEffect(() => {
    if (
      !selectedDocumentId ||
      !documents.some((document) => document.id === selectedDocumentId)
    ) {
      setSelectedDocumentId(documents[0]?.id ?? "");
    }
  }, [documents, selectedDocumentId]);
  const snapshotQueryKey = [
    ...getGetCurrentDocumentVersionSnapshotQueryKey(selectedDocumentId),
    organisationId,
    actorUserId,
    capabilityKey,
  ] as const;
  const snapshotQuery = useGetCurrentDocumentVersionSnapshot(
    selectedDocumentId,
    {
      query: {
        enabled: canRead && Boolean(selectedDocumentId && actorUserId),
        queryKey: snapshotQueryKey,
        staleTime: 0,
        gcTime: 0,
        retry: false,
      },
    },
  );
  const currentVersion = snapshotQuery.data;
  const [companyEvidenceOnly, setCompanyEvidenceOnly] = useState(false);
  const [structuredJson, setStructuredJson] = useState("");
  useEffect(() => {
    if (!currentVersion || currentVersion.snapshot) return;
    setCompanyEvidenceOnly(false);
    setStructuredJson(
      JSON.stringify(
        {
          schema: "valo.addendum-structured-snapshot/v2",
          sourceId: currentVersion.documentId,
          sourceKind: "solicitation",
          mode: "full",
          baseVersionId: null,
          authority: "authoritative",
          origin: `document:${currentVersion.documentId}:version:${currentVersion.documentVersionId}`,
          fields: [],
          operations: [],
        },
        null,
        2,
      ),
    );
  }, [
    currentVersion?.documentId,
    currentVersion?.documentVersionId,
    currentVersion?.snapshot,
  ]);

  const refreshSnapshot = async () => {
    await queryClient.invalidateQueries({ queryKey: snapshotQueryKey });
  };
  const refreshCentre = async () => {
    await queryClient.invalidateQueries({ queryKey: centreQueryKey });
  };
  const runCritical = async (work: () => Promise<void>) => {
    const release = access?.beginCriticalWorkflow();
    try {
      await work();
    } finally {
      release?.();
    }
  };
  const showMutationError = (title: string, error: unknown) => {
    toast({
      variant: "destructive",
      title,
      description: errorMessage(
        error,
        "The selected source or authority changed. Refresh and check the exact current records.",
      ),
    });
  };

  const captureSnapshot = useMutation({
    mutationFn: async () => {
      if (!currentVersion)
        throw new Error("Choose a current document version.");
      const structuredSnapshot = companyEvidenceOnly
        ? null
        : parseStructuredSnapshot(structuredJson);
      return captureDocumentVersionSnapshot(currentVersion.documentId, {
        documentVersionId: currentVersion.documentVersionId,
        structuredSnapshot,
      });
    },
  });
  const reviewSnapshot = useMutation({
    mutationFn: async (decision: "verified" | "rejected") => {
      const snapshot = currentVersion?.snapshot;
      if (!currentVersion || !snapshot)
        throw new Error("No snapshot is ready for review.");
      return reviewDocumentVersionSnapshot(
        currentVersion.documentId,
        snapshot.id,
        { decision },
        `"${snapshot.version}"`,
      );
    },
  });

  const [contextDraft, setContextDraft] = useState({
    primaryDocumentVersionId: "",
    jurisdictionRulePackId: "",
    legalEntityName: "",
    submissionDate: "",
    jurisdiction: "NG",
    entityScopes: "bidder",
    categoryScopes: "eligibility",
    requirements: "[]",
    artifacts: "[]",
  });
  useEffect(() => {
    if (!currentVersion?.documentVersionId) return;
    setContextDraft((current) => ({
      ...current,
      primaryDocumentVersionId: currentVersion.documentVersionId,
    }));
  }, [currentVersion?.documentVersionId]);
  const createContext = useMutation({
    mutationFn: async () => {
      const requirements = parseJsonArray<TenderRequirementBindingCreate>(
        contextDraft.requirements,
        "Requirements",
      );
      const artifacts = parseJsonArray<TenderArtifactBindingCreate>(
        contextDraft.artifacts,
        "Evidence bindings",
      );
      if (requirements.length === 0) {
        throw new Error("Select at least one reviewed tender requirement.");
      }
      return createTenderContextVersion(projectId, {
        primaryDocumentVersionId: contextDraft.primaryDocumentVersionId.trim(),
        jurisdictionRulePackId: contextDraft.jurisdictionRulePackId.trim(),
        legalEntityName: contextDraft.legalEntityName.trim(),
        submissionDate: contextDraft.submissionDate,
        jurisdiction: contextDraft.jurisdiction.trim().toUpperCase(),
        entityScopes: splitScopes(contextDraft.entityScopes),
        categoryScopes: splitScopes(contextDraft.categoryScopes),
        requirements,
        artifacts,
      });
    },
  });
  const reviewContext = useMutation({
    mutationFn: async ({
      record,
      decision,
      note,
    }: {
      record: TenderContextVersion;
      decision: TenderNamedReviewRequestDecision;
      note: string;
    }) =>
      reviewTenderContextVersion(
        projectId,
        record.id,
        { decision, note },
        `"${record.version}"`,
      ),
  });
  const createPassport = useMutation({
    mutationFn: (record: TenderContextVersion) =>
      createTenderEligibilityPassport(projectId, record.id),
  });
  const reviewPassport = useMutation({
    mutationFn: async ({
      record,
      decision,
      note,
    }: {
      record: TenderEligibilityPassport;
      decision: TenderNamedReviewRequestDecision;
      note: string;
    }) =>
      reviewTenderEligibilityPassport(
        projectId,
        record.id,
        { decision, note },
        `"${record.version}"`,
      ),
  });

  const centreState = queryDisplayState({
    isLoading: centreQuery.isLoading,
    isPending: centreQuery.isPending,
    isError: centreQuery.isError,
    isSuccess: centreQuery.isSuccess,
    hasData: centreQuery.data !== undefined,
  });
  const documentsState = queryDisplayState({
    isLoading: documentsQuery.isLoading,
    isPending: documentsQuery.isPending,
    isError: documentsQuery.isError,
    isSuccess: documentsQuery.isSuccess,
    hasData: documentsQuery.data !== undefined,
  });
  const snapshotState = queryDisplayState({
    isLoading: snapshotQuery.isLoading,
    isPending: snapshotQuery.isPending,
    isError: snapshotQuery.isError,
    isSuccess: snapshotQuery.isSuccess,
    hasData: snapshotQuery.data !== undefined,
  });

  if (meQuery.isError) {
    return (
      <div className="p-6 sm:p-8">
        <DataErrorPanel
          title="Your identity could not be checked"
          description="No Tender Context permission or record was assumed. Retry the identity check before continuing."
          onRetry={() => void meQuery.refetch()}
        />
      </div>
    );
  }
  if (access?.isError) {
    return (
      <div className="p-6 sm:p-8">
        <DataErrorPanel
          title="Organisation access could not be checked"
          description="No tender source or eligibility record was loaded. Refresh the organisation access before continuing."
          onRetry={access.refetch}
        />
      </div>
    );
  }
  if (access?.isLoading || meQuery.isLoading || meQuery.isPending) {
    return (
      <div className="p-6 sm:p-8">
        <LoadingPanel label="Checking Tender Context access" />
      </div>
    );
  }
  if (!canRead) {
    return (
      <PageGatePanel
        state="blocked"
        title="Tender Context access required"
        description="You need access to this pursuit, its documents, reviewed requirements, evidence and Nigeria rule packs. Partial source access is not loaded."
      />
    );
  }
  if (centreState === "loading" || documentsState === "loading") {
    return (
      <div className="p-6 sm:p-8">
        <LoadingPanel label="Loading the Tender Context workspace" />
      </div>
    );
  }
  if (
    centreState === "error" ||
    documentsState === "error" ||
    centreState === "unavailable" ||
    documentsState === "unavailable" ||
    !centreQuery.data
  ) {
    return (
      <div className="p-6 sm:p-8">
        <DataErrorPanel
          title="Tender Context records could not be checked"
          description="The failed request does not mean the pursuit is eligible or that its records are missing."
          onRetry={() => {
            void centreQuery.refetch();
            void documentsQuery.refetch();
          }}
        />
      </div>
    );
  }
  const centre = centreQuery.data;

  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 p-5 sm:p-8">
      <PageHeader
        eyebrow="Pursuit workspace"
        title="Tender Context and Eligibility Passport"
        description="Build a tender-specific record from exact reviewed sources, then ask a different named person to review it. This does not provide legal advice, compliance clearance, submission approval or an award prediction."
        state="partial"
        actions={
          <Button asChild variant="outline">
            <Link href={`/projects/${projectId}`}>
              <ArrowLeft className="mr-2 size-4" aria-hidden="true" />
              Back to pursuit
            </Link>
          </Button>
        }
      />

      <StatusPanel
        state="partial"
        title="Recorded decisions are point-in-time records"
        description="Accepted and ready labels below show what was recorded at review. They do not prove current usability. Before every new review or passport generation, the server rechecks the exact document bytes, redaction, evidence approval and Nigeria rule pack; changed authority returns a conflict without updating the record."
      />

      <Card id="source-snapshot">
        <CardHeader>
          <CardTitle>
            Step 1 — Capture and review an exact source version
          </CardTitle>
          <CardDescription>
            Choose a current pursuit document. A proposer records the complete
            v2 structure; a different reviewer verifies the exact bytes,
            redaction state, text and predecessor chain.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {documents.length === 0 ? (
            <StatusPanel
              state="empty"
              title="No pursuit documents"
              description="Add and extract a tender document in the pursuit before creating a source snapshot."
            />
          ) : (
            <>
              <div className="grid gap-2">
                <Label htmlFor="tender-source-document">Current document</Label>
                <select
                  id="tender-source-document"
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={selectedDocumentId}
                  onChange={(event) =>
                    setSelectedDocumentId(event.target.value)
                  }
                >
                  {documents.map((document) => (
                    <option key={document.id} value={document.id}>
                      {document.filename} — {document.redactionStatus}
                    </option>
                  ))}
                </select>
              </div>
              {snapshotState === "loading" ? (
                <LoadingPanel label="Checking the exact current document version" />
              ) : snapshotState === "error" ? (
                <DataErrorPanel
                  title="The current document version could not be checked"
                  description="The failed source request does not show that the version is missing or eligible. Refresh before making a decision."
                  onRetry={() => void snapshotQuery.refetch()}
                />
              ) : snapshotState === "unavailable" || !currentVersion ? (
                <StatusPanel
                  state="unavailable"
                  title="No current source version is available"
                  description="The selected document does not currently expose one unambiguous extracted version for snapshot capture. This is not an eligibility decision."
                >
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void snapshotQuery.refetch()}
                  >
                    <RefreshCw className="mr-2 size-4" aria-hidden="true" />
                    Check again
                  </Button>
                </StatusPanel>
              ) : (
                <div className="space-y-5">
                  <div className="grid gap-3 rounded-lg border border-border bg-muted/30 p-4 text-sm sm:grid-cols-2">
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Exact version
                      </p>
                      <p className="mt-1 break-all font-mono text-xs">
                        {currentVersion.documentVersionId}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Uploaded-byte SHA-256
                      </p>
                      <p className="mt-1 break-all font-mono text-xs">
                        {currentVersion.documentVersionSha256}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Captured redaction boundary
                      </p>
                      <p className="mt-1 capitalize">
                        {currentVersion.redactionStatus}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Extraction status
                      </p>
                      <p className="mt-1 capitalize">
                        {currentVersion.extractionStatus}
                      </p>
                    </div>
                  </div>
                  {currentVersion.snapshot ? (
                    <div className="rounded-lg border border-border p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="font-medium">Immutable snapshot</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Proposed by {currentVersion.snapshot.capturedByName}{" "}
                            · version {currentVersion.snapshot.version}
                          </p>
                        </div>
                        <StateBadge
                          state={recordedState(currentVersion.snapshot.status)}
                          label={`Recorded: ${currentVersion.snapshot.status.replaceAll("_", " ")}`}
                        />
                      </div>
                      <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                        <p className="break-all font-mono">
                          Text: {currentVersion.snapshot.canonicalTextSha256}
                        </p>
                        <p className="break-all font-mono">
                          Structure:{" "}
                          {currentVersion.snapshot.structuredSnapshotSha256 ??
                            "none (company evidence only)"}
                        </p>
                        <p>
                          Redaction captured as:{" "}
                          {currentVersion.snapshot.capturedRedactionStatus}
                        </p>
                        <p>
                          Reviewer:{" "}
                          {currentVersion.snapshot.verifiedByName ??
                            "Awaiting a different reviewer"}
                        </p>
                      </div>
                      {currentVersion.snapshot.status === "captured" ? (
                        <div className="mt-4 flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            disabled={
                              !canReview ||
                              actorUserId ===
                                currentVersion.snapshot.capturedByUserId ||
                              reviewSnapshot.isPending
                            }
                            onClick={() =>
                              void runCritical(async () => {
                                try {
                                  await reviewSnapshot.mutateAsync("verified");
                                  await refreshSnapshot();
                                  toast({
                                    title: "Exact source snapshot verified",
                                  });
                                } catch (error) {
                                  showMutationError(
                                    "Snapshot review was not recorded",
                                    error,
                                  );
                                }
                              })
                            }
                          >
                            <ShieldCheck
                              className="mr-2 size-4"
                              aria-hidden="true"
                            />
                            Verify exact snapshot
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="destructive"
                            disabled={
                              !canReview ||
                              actorUserId ===
                                currentVersion.snapshot.capturedByUserId ||
                              reviewSnapshot.isPending
                            }
                            onClick={() =>
                              void runCritical(async () => {
                                try {
                                  await reviewSnapshot.mutateAsync("rejected");
                                  await refreshSnapshot();
                                  toast({ title: "Source snapshot rejected" });
                                } catch (error) {
                                  showMutationError(
                                    "Snapshot review was not recorded",
                                    error,
                                  );
                                }
                              })
                            }
                          >
                            Reject snapshot
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="flex items-start gap-3 rounded-lg border border-border p-4">
                        <Checkbox
                          id="company-evidence-only"
                          checked={companyEvidenceOnly}
                          onCheckedChange={(value) =>
                            setCompanyEvidenceOnly(value === true)
                          }
                          disabled={!canPropose}
                        />
                        <div>
                          <Label htmlFor="company-evidence-only">
                            Capture without a tender structure
                          </Label>
                          <p className="mt-1 text-xs leading-5 text-muted-foreground">
                            Use only for a currently approved company-evidence
                            version. It cannot become a solicitation or addendum
                            source later; changing that choice requires a new
                            document version.
                          </p>
                        </div>
                      </div>
                      {!companyEvidenceOnly ? (
                        <div className="grid gap-2">
                          <Label htmlFor="structured-snapshot-json">
                            Complete v2 structured proposal
                          </Label>
                          <Textarea
                            id="structured-snapshot-json"
                            value={structuredJson}
                            onChange={(event) =>
                              setStructuredJson(event.target.value)
                            }
                            rows={18}
                            spellCheck={false}
                            className="font-mono text-xs"
                            disabled={!canPropose}
                          />
                          <p className="text-xs leading-5 text-muted-foreground">
                            Do not infer the series, source kind or stable field
                            IDs from a filename. Every field or operation must
                            cite an exact zero-based UTF-16 span in the
                            immutable text. A root solicitation is full with no
                            base; an addendum names the exact immediate
                            predecessor and uses explicit set/remove operations.
                          </p>
                        </div>
                      ) : null}
                      <details className="rounded-lg border border-border p-4">
                        <summary className="cursor-pointer text-sm font-medium">
                          Inspect immutable canonical text for exact offsets
                        </summary>
                        <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-3 text-xs">
                          {currentVersion.canonicalText}
                        </pre>
                      </details>
                      <Button
                        type="button"
                        disabled={!canPropose || captureSnapshot.isPending}
                        onClick={() =>
                          void runCritical(async () => {
                            try {
                              await captureSnapshot.mutateAsync();
                              await refreshSnapshot();
                              toast({
                                title: "Snapshot proposal captured",
                                description:
                                  "A different named reviewer must verify it.",
                              });
                            } catch (error) {
                              showMutationError(
                                "Snapshot proposal was not captured",
                                error,
                              );
                            }
                          })
                        }
                      >
                        <FileCheck2
                          className="mr-2 size-4"
                          aria-hidden="true"
                        />
                        Capture exact proposal
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card id="context-wizard">
        <CardHeader>
          <CardTitle>Step 2 — Propose this tender’s context</CardTitle>
          <CardDescription>
            Select only verified source versions, reviewed requirement citations
            and approved company evidence for this named tender. This is not a
            universal Nigeria eligibility list.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="primary-version">
                Primary verified document version ID
              </Label>
              <Input
                id="primary-version"
                value={contextDraft.primaryDocumentVersionId}
                onChange={(event) =>
                  setContextDraft({
                    ...contextDraft,
                    primaryDocumentVersionId: event.target.value,
                  })
                }
                disabled={!canPropose}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="rule-pack">Approved Nigeria rule-pack ID</Label>
              <Input
                id="rule-pack"
                value={contextDraft.jurisdictionRulePackId}
                onChange={(event) =>
                  setContextDraft({
                    ...contextDraft,
                    jurisdictionRulePackId: event.target.value,
                  })
                }
                placeholder="Exact approved rule-pack UUID"
                disabled={!canPropose}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="legal-entity">Tendering legal entity</Label>
              <Input
                id="legal-entity"
                value={contextDraft.legalEntityName}
                onChange={(event) =>
                  setContextDraft({
                    ...contextDraft,
                    legalEntityName: event.target.value,
                  })
                }
                maxLength={300}
                disabled={!canPropose}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="submission-date">Submission date</Label>
              <Input
                id="submission-date"
                type="date"
                value={contextDraft.submissionDate}
                onChange={(event) =>
                  setContextDraft({
                    ...contextDraft,
                    submissionDate: event.target.value,
                  })
                }
                disabled={!canPropose}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="jurisdiction">Nigeria jurisdiction code</Label>
              <Input
                id="jurisdiction"
                value={contextDraft.jurisdiction}
                onChange={(event) =>
                  setContextDraft({
                    ...contextDraft,
                    jurisdiction: event.target.value,
                  })
                }
                placeholder="NG or NG-LA"
                disabled={!canPropose}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="entity-scopes">
                Entity scopes (comma-separated)
              </Label>
              <Input
                id="entity-scopes"
                value={contextDraft.entityScopes}
                onChange={(event) =>
                  setContextDraft({
                    ...contextDraft,
                    entityScopes: event.target.value,
                  })
                }
                disabled={!canPropose}
              />
            </div>
            <div className="grid gap-2 md:col-span-2">
              <Label htmlFor="category-scopes">
                Tender categories (comma-separated)
              </Label>
              <Input
                id="category-scopes"
                value={contextDraft.categoryScopes}
                onChange={(event) =>
                  setContextDraft({
                    ...contextDraft,
                    categoryScopes: event.target.value,
                  })
                }
                disabled={!canPropose}
              />
            </div>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="requirement-bindings">
                Reviewed requirement bindings
              </Label>
              <Textarea
                id="requirement-bindings"
                rows={10}
                className="font-mono text-xs"
                value={contextDraft.requirements}
                onChange={(event) =>
                  setContextDraft({
                    ...contextDraft,
                    requirements: event.target.value,
                  })
                }
                disabled={!canPropose}
              />
              <p className="text-xs leading-5 text-muted-foreground">
                JSON list of exact requirementId, requirementCitationId,
                evidenceKind and the three review flags. At least one reviewed
                citation is required.
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="artifact-bindings">
                Approved company-evidence bindings
              </Label>
              <Textarea
                id="artifact-bindings"
                rows={10}
                className="font-mono text-xs"
                value={contextDraft.artifacts}
                onChange={(event) =>
                  setContextDraft({
                    ...contextDraft,
                    artifacts: event.target.value,
                  })
                }
                disabled={!canPropose}
              />
              <p className="text-xs leading-5 text-muted-foreground">
                Optional JSON list of exact vaultItemVersionId, evidenceKind and
                immutable citation offset, end and quote. A typed legal entity
                only matches when the verified quote says the same name.
              </p>
            </div>
          </div>
          <Button
            type="button"
            disabled={!canPropose || createContext.isPending}
            onClick={() =>
              void runCritical(async () => {
                try {
                  await createContext.mutateAsync();
                  await refreshCentre();
                  toast({
                    title: "Tender Context proposed",
                    description:
                      "A different named reviewer must accept it before passport generation.",
                  });
                } catch (error) {
                  showMutationError("Tender Context was not created", error);
                }
              })
            }
          >
            Propose Tender Context
          </Button>
        </CardContent>
      </Card>

      <section aria-labelledby="context-history-heading" className="space-y-4">
        <div>
          <h2
            id="context-history-heading"
            className="font-serif text-2xl font-semibold"
          >
            Step 3 — Named context review
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Review history is preserved. Acceptance rechecks current source,
            evidence and rule-pack authority.
          </p>
        </div>
        {centre.contexts.length === 0 ? (
          <StatusPanel
            state="empty"
            title="No Tender Context versions"
            description="Capture and verify the exact source, then propose this tender’s first context."
          />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {centre.contexts.map((record) => (
              <Card key={record.id}>
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <CardTitle>
                        Context version {record.versionNumber}
                      </CardTitle>
                      <CardDescription>
                        {record.legalEntityName} · submission{" "}
                        {record.submissionDate}
                      </CardDescription>
                    </div>
                    <StateBadge
                      state={recordedState(record.status)}
                      label={`Recorded: ${record.status.replaceAll("_", " ")}`}
                    />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-2 text-sm sm:grid-cols-2">
                    <p>
                      <span className="text-muted-foreground">Rule pack:</span>{" "}
                      {record.rulePackLabel}
                    </p>
                    <p>
                      <span className="text-muted-foreground">
                        Jurisdiction:
                      </span>{" "}
                      {record.jurisdiction}
                    </p>
                    <p>
                      <span className="text-muted-foreground">
                        Requirements:
                      </span>{" "}
                      {record.requirements.length}
                    </p>
                    <p>
                      <span className="text-muted-foreground">
                        Evidence items:
                      </span>{" "}
                      {record.artifacts.length}
                    </p>
                  </div>
                  <p className="mt-3 break-all font-mono text-xs text-muted-foreground">
                    Source manifest: {record.sourceManifestSha256}
                  </p>
                  {record.review.reviewedByName ? (
                    <p className="mt-3 text-xs text-muted-foreground">
                      Reviewed by {record.review.reviewedByName} at{" "}
                      {record.review.reviewedAt
                        ? new Date(record.review.reviewedAt).toLocaleString()
                        : "an unrecorded time"}
                      .
                    </p>
                  ) : null}
                  {record.status === "pending_review" ? (
                    <ReviewActions
                      disabled={!canReview}
                      busy={reviewContext.isPending}
                      onReview={(decision, note) =>
                        void runCritical(async () => {
                          try {
                            await reviewContext.mutateAsync({
                              record,
                              decision,
                              note,
                            });
                            await refreshCentre();
                            toast({ title: "Tender Context review recorded" });
                          } catch (error) {
                            showMutationError(
                              "Tender Context review was not recorded",
                              error,
                            );
                          }
                        })
                      }
                    />
                  ) : null}
                  {record.status === "accepted" ? (
                    <Button
                      type="button"
                      className="mt-4"
                      disabled={!canPropose || createPassport.isPending}
                      onClick={() =>
                        void runCritical(async () => {
                          try {
                            await createPassport.mutateAsync(record);
                            await refreshCentre();
                            toast({
                              title: "Eligibility Passport generated",
                              description:
                                "A different named reviewer must check the point-in-time result.",
                            });
                          } catch (error) {
                            showMutationError(
                              "Eligibility Passport was not generated",
                              error,
                            );
                          }
                        })
                      }
                    >
                      Generate this tender’s Eligibility Passport
                    </Button>
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section
        id="eligibility-passports"
        aria-labelledby="passport-heading"
        className="space-y-4"
      >
        <div>
          <h2
            id="passport-heading"
            className="font-serif text-2xl font-semibold"
          >
            Step 4 — Eligibility Passport review
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Each passport applies only to the named tender and selected company
            evidence. It is not universal qualification or clearance.
          </p>
        </div>
        {centre.passports.length === 0 ? (
          <StatusPanel
            state="empty"
            title="No Eligibility Passports"
            description="A current member can generate one after a different reviewer accepts a Tender Context."
          />
        ) : (
          <div className="space-y-4">
            {centre.passports.map((passport) => (
              <Card key={passport.id}>
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <CardTitle>Eligibility Passport</CardTitle>
                      <CardDescription>
                        Generated{" "}
                        {new Date(passport.createdAt).toLocaleString()} for one
                        accepted Tender Context.
                      </CardDescription>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline">
                        Recorded result:{" "}
                        {passport.resultStatus.replaceAll("_", " ")}
                      </Badge>
                      <StateBadge
                        state={recordedState(passport.review.state)}
                        label={`Review: ${passport.review.state.replaceAll("_", " ")}`}
                      />
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-3 text-sm sm:grid-cols-3">
                    <div>
                      <p className="text-xs text-muted-foreground">Criteria</p>
                      <p className="mt-1 text-lg font-semibold">
                        {passport.result.criteria.length}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Blockers and warnings
                      </p>
                      <p className="mt-1 text-lg font-semibold">
                        {passport.result.issues.length}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Named review readiness at generation
                      </p>
                      <p className="mt-1 text-sm font-medium">
                        {passport.eligibleForNamedTenderReview
                          ? "Ready for a person to review"
                          : "Not ready"}
                      </p>
                    </div>
                  </div>
                  <p className="mt-3 break-all font-mono text-xs text-muted-foreground">
                    Result snapshot: {passport.resultSnapshotSha256}
                  </p>
                  {passport.result.issues.length > 0 ? (
                    <ul className="mt-4 space-y-2 text-sm">
                      {passport.result.issues
                        .slice(0, 10)
                        .map((issue, index) => (
                          <li
                            key={`${issue.code}-${index}`}
                            className="rounded border border-border p-3"
                          >
                            <span className="font-medium capitalize">
                              {issue.severity}:
                            </span>{" "}
                            {issue.message}
                          </li>
                        ))}
                    </ul>
                  ) : null}
                  {passport.review.state === "pending_review" ? (
                    <ReviewActions
                      disabled={!canReview}
                      busy={reviewPassport.isPending}
                      onReview={(decision, note) =>
                        void runCritical(async () => {
                          try {
                            await reviewPassport.mutateAsync({
                              record: passport,
                              decision,
                              note,
                            });
                            await refreshCentre();
                            toast({
                              title: "Eligibility Passport review recorded",
                            });
                          } catch (error) {
                            showMutationError(
                              "Eligibility Passport review was not recorded",
                              error,
                            );
                          }
                        })
                      }
                    />
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <p className="text-xs leading-5 text-muted-foreground">
        {centre.authorityNote}
      </p>
    </main>
  );
}
