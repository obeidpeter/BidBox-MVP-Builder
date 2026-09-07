import {
  getGetDeliveryStudioQueryKey,
  useGetDeliveryStudio,
  useGetMe,
  useRunDeliveryStudioAction,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  FilePenLine,
  Loader2,
  PackageCheck,
  PlayCircle,
  RefreshCw,
  ShieldCheck,
  UserRoundCheck,
} from "lucide-react";
import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  DataErrorPanel,
  LoadingPanel,
  StateBadge,
  StatusPanel,
  type SurfaceState,
} from "@/components/platform-states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  useOrganisationAccess,
  useOrganisationPermission,
} from "@/contexts/organisation-context";
import { useToast } from "@/hooks/use-toast";
import { errorMessage, requestStatus } from "@/lib/errors";
import { formatWatInstant, humaniseTokenCapitalised } from "@/lib/format";

type DeliveryStudioCitation = {
  id: string;
  documentVersionId: string | null;
  evidenceCitation: string;
  evidenceHash: string;
};

type DeliveryStudioClaim = {
  id: string;
  claimKey: string;
  text: string;
  kind: string;
  supportMode: "exact_quote" | "paraphrase" | null;
  groundingStatus: string;
  reviewerUserId: string | null;
  citations: DeliveryStudioCitation[];
};

type DeliveryStudioSection = {
  id: string;
  sectionKey: string;
  title: string;
  status: string;
  currentVersionNumber: number;
  version: {
    id: string;
    content: string;
    contentHash: string;
    authorUserId: string | null;
    claims: DeliveryStudioClaim[];
  } | null;
};

type DeliveryStudioFinding = {
  id: string;
  category: string;
  severity: string;
  finding: string;
  status: string;
  resolution: string | null;
  resolvedByUserId: string | null;
  resolvedAt: string | null;
  version: number;
};

type DeliveryStudioRun = {
  id: string;
  status: string;
  sourceSnapshotHash: string;
  policyVersion: string;
  initiatedByUserId: string | null;
  approvedByUserId: string | null;
  approvedAt: string | null;
  approvalAttestation: string | null;
  createdAt: string;
  findings: DeliveryStudioFinding[];
};

type DeliveryStudioPackage = {
  id: string;
  status: string;
  versionId: string;
  versionNumber: number;
  sourceSnapshotHash: string;
  manifestHash: string;
  renderQaStatus: string;
  manifestItems: Array<{
    id: string;
    ordinal: number;
    itemType: string;
    sourceObjectId: string | null;
    sourceVersion: number | null;
    filename: string;
    sha256: string;
    sizeBytes: number;
  }>;
};

type DeliveryStudioReceipt = {
  id: string;
  packageVersionId: string;
  status: string;
  rehearsalId: string;
  readyForOperatorRehearsal: boolean;
  reviewerUserId: string;
  completedAt: string;
  issues: Array<{
    code: string;
    severity: "blocker" | "warning";
    message: string;
  }>;
};

type DeliveryStudioSnapshot = {
  authorityNote: string;
  generatedAt: string;
  version: number;
  project: {
    id: string;
    title: string;
    status: string;
    deadline: string | null;
  };
  sourceSnapshotHash: string;
  responseStudio: {
    status: string;
    sectionCount: number;
    claimCount: number;
    groundedClaimCount: number;
    placeholderCount: number;
    sections: DeliveryStudioSection[];
  };
  redTeamReview: {
    status: string;
    dueAt: string | null;
    run: DeliveryStudioRun | null;
  };
  packageAssembly: {
    status: string;
    package: DeliveryStudioPackage | null;
  };
  submissionRehearsal: {
    status: string;
    receipt: DeliveryStudioReceipt | null;
  };
  safety: {
    automaticMutation: false;
    externalPortalAction: false;
    namedHumanAuthority: true;
  };
};

type ResponseClaimInput = {
  claimKey: string;
  text: string;
  kind: "factual" | "instructional" | "opinion";
  supportMode?: "exact_quote" | "paraphrase";
  citations: Array<{
    documentId: string;
    documentVersionId: string;
    pageNumber: number;
    quote: string;
  }>;
};

type RehearsalHumanReviewInput = {
  state: "accepted" | "rejected" | "needs_changes";
  reviewerId: string;
  reviewedAt: string;
  note: string;
};

type RehearsalExactCitationInput = {
  sourceId: string;
  sourceVersionId: string;
  contentSha256: string;
  startOffset: number;
  endOffset: number;
  quote: string;
};

type PortalSubmissionRehearsalInput = {
  sources: Array<{
    sourceId: string;
    versionId: string;
    kind: "solicitation" | "addendum" | "other" | "company_evidence";
    title: string;
    content: string;
    contentSha256: string;
    capturedAt: string;
    authority: "authoritative";
    origin: string;
  }>;
  fields: Array<{
    externalId: string;
    label: string;
    fieldType: "file";
    required: true;
    uploadOrder: number;
    ruleText: string;
    citations: RehearsalExactCitationInput[];
    review: RehearsalHumanReviewInput;
  }>;
  files: Array<{
    externalId: string;
    filename: string;
    sizeBytes: number;
    sizeText: string;
    sha256: string;
    citations: RehearsalExactCitationInput[];
    review: RehearsalHumanReviewInput;
  }>;
  mappings: Array<{
    externalId: string;
    fieldExternalId: string;
    fileExternalId: string;
    rationale: string;
    citations: RehearsalExactCitationInput[];
    review: RehearsalHumanReviewInput;
  }>;
  rehearsalReview?: {
    subjectId: string;
    review: RehearsalHumanReviewInput;
  };
};

type DeliveryStudioAction =
  | {
      action: "save_response";
      sectionKey: string;
      title: string;
      content: string;
      changeSummary?: string;
      claims: ResponseClaimInput[];
    }
  | {
      action: "review_response_claim";
      claimId: string;
      decision: "accepted" | "rejected" | "needs_changes";
      note: string;
    }
  | {
      action: "start_red_team";
      policyVersion: string;
      findings: Array<{
        category: string;
        severity: "fatal" | "likely_fatal" | "scoring_risk" | "cosmetic";
        finding: string;
      }>;
    }
  | {
      action: "resolve_red_team_finding";
      runId: string;
      findingId: string;
      resolution: string;
    }
  | {
      action: "approve_red_team";
      runId: string;
      attestation: string;
    }
  | { action: "assemble_package"; packageType: "submission" }
  | {
      action: "rehearse_submission";
      packageVersionId: string;
      rehearsal: PortalSubmissionRehearsalInput;
    };

type DialogState =
  | { type: "response"; section?: DeliveryStudioSection }
  | { type: "response_edit_blocked"; section: DeliveryStudioSection }
  | { type: "claim"; claim: DeliveryStudioClaim }
  | { type: "red_team" }
  | {
      type: "finding";
      run: DeliveryStudioRun;
      finding: DeliveryStudioFinding;
    }
  | { type: "approve_red_team"; run: DeliveryStudioRun }
  | { type: "assemble_package" }
  | { type: "rehearsal"; deliveryPackage: DeliveryStudioPackage }
  | null;

const READY_STATES = new Set([
  "approved",
  "complete",
  "completed",
  "passed",
  "ready",
  "rehearsal_ready",
  "resolved",
  "reviewed",
  "signed_off",
]);
const BLOCKED_STATES = new Set([
  "blocked",
  "changes_requested",
  "failed",
  "findings_open",
  "incomplete",
  "rejected",
]);
const TERMINAL_PROJECT_STATES = new Set(["signed_off", "exported", "archived"]);
const DOMAIN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SHA_256_PATTERN = /^[a-f0-9]{64}$/iu;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const DELIVERY_STUDIO_READ_PERMISSIONS = [
  "project:read",
  "draft:read",
  "defect:read",
  "package:read",
] as const;

function normalizedStatus(value: string | null | undefined): string {
  return value?.trim().toLowerCase().replaceAll("-", "_") || "not_started";
}

function stageState(value: string): SurfaceState {
  const status = normalizedStatus(value);
  if (status === "stale" || status.includes("invalidated")) return "expired";
  if (status === "empty" || status === "not_started") return "empty";
  if (BLOCKED_STATES.has(status)) return "blocked";
  if (READY_STATES.has(status)) return "active";
  return "pending";
}

function statusLabel(value: string): string {
  return stageState(value) === "expired"
    ? "Stale"
    : humaniseTokenCapitalised(normalizedStatus(value));
}

function shortHash(value: string | null | undefined): string {
  if (!value) return "Not recorded";
  return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-8)}` : value;
}

function StageCard({
  title,
  description,
  status,
  icon: Icon,
  actions,
  children,
}: {
  title: string;
  description: string;
  status: string;
  icon: typeof FilePenLine;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="shadow-none">
      <CardHeader className="border-b border-border pb-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex gap-3">
            <div className="mt-0.5 rounded-lg border border-border bg-muted/50 p-2">
              <Icon aria-hidden="true" className="size-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-lg font-semibold tracking-tight">
                  {title}
                </h3>
                <StateBadge
                  state={stageState(status)}
                  label={statusLabel(status)}
                />
              </div>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
                {description}
              </p>
            </div>
          </div>
          {actions ? (
            <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="p-5 sm:p-6">{children}</CardContent>
    </Card>
  );
}

function ReadOnlyNote({ permission }: { permission: string }) {
  return (
    <p className="text-xs leading-5 text-muted-foreground">
      This stage is read-only because your current organisation role does not
      include {permission}.
    </p>
  );
}

function ActionError({ message }: { message: string | null }) {
  return message ? (
    <StatusPanel
      state="error"
      title="The delivery action was not recorded"
      description={message}
    />
  ) : null;
}

const EMPTY_RESPONSE_FORM = {
  sectionKey: "",
  title: "",
  content: "",
  changeSummary: "",
  claimLines: "",
  claimKind: "opinion" as ResponseClaimInput["kind"],
  supportMode: "exact_quote" as NonNullable<ResponseClaimInput["supportMode"]>,
  documentId: "",
  documentVersionId: "",
  pageNumber: "",
  quote: "",
};

type RehearsalFileMappingForm = {
  manifestItemId: string;
  fieldExternalId: string;
  fieldLabel: string;
  uploadOrder: string;
  portalRuleText: string;
  mappingExternalId: string;
  mappingRationale: string;
};

type RehearsalForm = {
  portalSourceId: string;
  portalSourceVersionId: string;
  reviewAccepted: boolean;
  reviewNote: string;
  rehearsalSubjectId: string;
  fileMappings: RehearsalFileMappingForm[];
};

const EMPTY_REHEARSAL_FORM: RehearsalForm = {
  portalSourceId: "",
  portalSourceVersionId: "",
  reviewAccepted: false,
  reviewNote: "",
  rehearsalSubjectId: "",
  fileMappings: [],
};

function buildRehearsalManifestText(
  deliveryPackage: DeliveryStudioPackage,
  fileMappings: readonly RehearsalFileMappingForm[],
): string {
  const lines = [
    "Valo Delivery Studio package manifest",
    `Package ID: ${deliveryPackage.id}`,
    `Package version ID: ${deliveryPackage.versionId}`,
  ];
  const mappingByItemId = new Map(
    fileMappings.map((mapping) => [mapping.manifestItemId, mapping]),
  );
  const files = [...deliveryPackage.manifestItems].sort((left, right) =>
    left.filename.localeCompare(right.filename),
  );
  for (const file of files) {
    lines.push(
      "",
      `File: ${file.filename}`,
      `Size: ${file.sizeBytes} bytes`,
      `SHA-256: ${file.sha256}`,
    );
    const mapping = mappingByItemId.get(file.id);
    if (mapping) {
      lines.push(
        `Mapping: ${file.filename} assigned to ${mapping.fieldLabel.trim()}. ${mapping.mappingRationale.trim()}`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function DeliveryStudioTab({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const organisationAccess = useOrganisationAccess();
  const activeOrganisation = organisationAccess?.activeOrganisation;
  const effectivePermissions = organisationAccess?.effectivePermissions ?? [];
  const hasDirectMembership = Boolean(
    activeOrganisation?.accessSource === "membership" &&
    activeOrganisation.membershipOrganisationId === activeOrganisation.id,
  );
  const canReadStudio = Boolean(
    hasDirectMembership &&
    DELIVERY_STUDIO_READ_PERMISSIONS.every((permission) =>
      effectivePermissions.includes(permission),
    ),
  );
  const canWriteDraft = useOrganisationPermission("draft:write");
  const canReadDocuments = useOrganisationPermission("document:read");
  const canReadEvidence = useOrganisationPermission("evidence:read");
  const canWriteResponse = canWriteDraft && canReadDocuments && canReadEvidence;
  const canReviewResponse = useOrganisationPermission("draft:review");
  const canWriteDefects = useOrganisationPermission("defect:write");
  const canReviewDefects = useOrganisationPermission("defect:review");
  const canReviewIntelligence = useOrganisationPermission(
    "intelligence:review",
  );
  const canGeneratePackage = useOrganisationPermission("package:generate");
  const canSignPackage = useOrganisationPermission("package:sign_off");
  const canStartRedTeam =
    canReviewResponse && canWriteDefects && canReviewIntelligence;
  const canResolveRedTeam = canReviewDefects && canReviewIntelligence;
  const canApproveRedTeam =
    canReviewResponse &&
    canReviewDefects &&
    canSignPackage &&
    canReviewIntelligence;
  const meQuery = useGetMe();
  const actorUserId = meQuery.data?.id ?? "";
  const actorName = meQuery.data?.name?.trim() ?? "";
  const hasNamedActor = Boolean(
    actorUserId.length > 0 && actorName.length >= 2 && actorName.length <= 200,
  );
  const canRequestStudio = canReadStudio && hasNamedActor;
  const studioQuery = useGetDeliveryStudio(projectId, {
    query: {
      enabled: canRequestStudio && projectId.length > 0,
      queryKey: getGetDeliveryStudioQueryKey(projectId),
    },
  });
  const [dialog, setDialog] = useState<DialogState>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [responseForm, setResponseForm] = useState(EMPTY_RESPONSE_FORM);
  const [responseFormError, setResponseFormError] = useState<string | null>(
    null,
  );
  const [claimDecision, setClaimDecision] = useState<
    "accepted" | "rejected" | "needs_changes"
  >("needs_changes");
  const [claimNote, setClaimNote] = useState("");
  const [redTeamForm, setRedTeamForm] = useState({
    policyVersion: "",
    category: "compliance",
    severity: "scoring_risk" as
      | "fatal"
      | "likely_fatal"
      | "scoring_risk"
      | "cosmetic",
    findings: "",
  });
  const [resolution, setResolution] = useState("");
  const [attestation, setAttestation] = useState("");
  const [rehearsalForm, setRehearsalForm] = useState(EMPTY_REHEARSAL_FORM);
  const [rehearsalFormError, setRehearsalFormError] = useState<string | null>(
    null,
  );
  const [rehearsalPreparing, setRehearsalPreparing] = useState(false);
  const snapshot = studioQuery.data as DeliveryStudioSnapshot | undefined;
  const projectIsReleased = TERMINAL_PROJECT_STATES.has(
    normalizedStatus(snapshot?.project.status),
  );
  const projectReleasedRef = useRef(projectIsReleased);
  projectReleasedRef.current = projectIsReleased;

  const mutation = useRunDeliveryStudioAction({
    mutation: {
      onSuccess: (result: { data: DeliveryStudioSnapshot }) => {
        queryClient.setQueryData(
          getGetDeliveryStudioQueryKey(projectId),
          result.data,
        );
        setDialog(null);
        setActionError(null);
        setResponseFormError(null);
        setRehearsalFormError(null);
        setRehearsalPreparing(false);
        setResolution("");
        setAttestation("");
        toast({ title: "Delivery Studio updated" });
      },
      onError: (error: unknown) => {
        const status = requestStatus(error);
        const stale = status === 409 || status === 412;
        setActionError(
          errorMessage(
            error,
            stale
              ? "The source or workflow version changed. Refresh before trying again."
              : "The action was rejected. No approval, package release or external action was inferred.",
          ),
        );
        toast({
          variant: "destructive",
          title: stale ? "Delivery snapshot is stale" : "Action rejected",
          description: stale
            ? "Refresh before recording another human decision."
            : "No delivery authority was granted.",
        });
      },
    },
  });

  const runAction = (data: DeliveryStudioAction) => {
    if (
      !snapshot ||
      projectReleasedRef.current ||
      !Number.isSafeInteger(snapshot.version)
    ) {
      return;
    }
    setActionError(null);
    mutation.mutate({
      projectId,
      data,
      ifMatch: String(snapshot.version),
      idempotencyKey: crypto.randomUUID(),
    });
  };

  const openResponse = (section?: DeliveryStudioSection) => {
    if (projectIsReleased) return;
    if (section) {
      setDialog({ type: "response_edit_blocked", section });
      return;
    }
    setResponseFormError(null);
    setResponseForm(EMPTY_RESPONSE_FORM);
    setDialog({ type: "response" });
  };

  const submitResponse = () => {
    const sectionKey = responseForm.sectionKey.trim();
    const title = responseForm.title.trim();
    const content = responseForm.content.trim();
    const claimTexts = responseForm.claimLines
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (!sectionKey || !title || !content) {
      setResponseFormError(
        "Section key, title and response content are required.",
      );
      return;
    }
    if (claimTexts.length === 0) {
      setResponseFormError(
        "Record at least one explicit claim for this response section.",
      );
      return;
    }
    if (claimTexts.length > 20) {
      setResponseFormError(
        "Record no more than 20 claims in one section version.",
      );
      return;
    }
    const citationValues = [
      responseForm.documentId,
      responseForm.documentVersionId,
      responseForm.pageNumber,
      responseForm.quote,
    ];
    const citationStarted = citationValues.some(
      (value) => value.trim().length > 0,
    );
    const citationComplete = citationValues.every(
      (value) => value.trim().length > 0,
    );
    const pageNumber = Number(responseForm.pageNumber);
    if (
      citationStarted &&
      (!citationComplete || !Number.isSafeInteger(pageNumber) || pageNumber < 1)
    ) {
      setResponseFormError(
        "Complete the document, version, positive page number and exact quote for the citation.",
      );
      return;
    }
    if (
      claimTexts.length > 0 &&
      responseForm.claimKind !== "opinion" &&
      !citationComplete
    ) {
      setResponseFormError(
        "Factual and instructional claims require a complete source citation.",
      );
      return;
    }
    const citations = citationComplete
      ? [
          {
            documentId: responseForm.documentId.trim(),
            documentVersionId: responseForm.documentVersionId.trim(),
            pageNumber,
            quote: responseForm.quote.trim(),
          },
        ]
      : [];
    const claims: ResponseClaimInput[] = claimTexts.map((text, index) => ({
      claimKey: `${sectionKey}-claim-${index + 1}`,
      text,
      kind: responseForm.claimKind,
      ...(citations.length > 0
        ? { supportMode: responseForm.supportMode }
        : {}),
      citations,
    }));
    runAction({
      action: "save_response",
      sectionKey,
      title,
      content,
      ...(responseForm.changeSummary.trim()
        ? { changeSummary: responseForm.changeSummary.trim() }
        : {}),
      claims,
    });
  };

  const openRehearsal = (deliveryPackage: DeliveryStudioPackage) => {
    if (projectIsReleased || deliveryPackage.manifestItems.length !== 1) {
      return;
    }
    const priorReceipt = snapshot?.submissionRehearsal.receipt;
    setRehearsalForm({
      ...EMPTY_REHEARSAL_FORM,
      rehearsalSubjectId:
        priorReceipt?.packageVersionId === deliveryPackage.versionId &&
        DOMAIN_ID_PATTERN.test(priorReceipt.rehearsalId)
          ? priorReceipt.rehearsalId
          : "",
      fileMappings: deliveryPackage.manifestItems.map((item) => ({
        manifestItemId: item.id,
        fieldExternalId: `portal-file-${item.ordinal}`,
        fieldLabel: "",
        uploadOrder: String(item.ordinal),
        portalRuleText: "",
        mappingExternalId: `portal-mapping-${item.ordinal}`,
        mappingRationale: "",
      })),
    });
    setRehearsalFormError(null);
    setDialog({ type: "rehearsal", deliveryPackage });
  };

  const updateRehearsalFileMapping = (
    manifestItemId: string,
    patch: Partial<RehearsalFileMappingForm>,
  ) => {
    setRehearsalForm((current) => ({
      ...current,
      fileMappings: current.fileMappings.map((mapping) =>
        mapping.manifestItemId === manifestItemId
          ? { ...mapping, ...patch }
          : mapping,
      ),
    }));
  };

  const submitRehearsal = async () => {
    if (dialog?.type !== "rehearsal" || projectIsReleased) return;
    const deliveryPackage = dialog.deliveryPackage;
    const portalSourceId = rehearsalForm.portalSourceId.trim();
    const portalSourceVersionId = rehearsalForm.portalSourceVersionId.trim();
    const reviewNote = rehearsalForm.reviewNote.trim();
    const rehearsalSubjectId = rehearsalForm.rehearsalSubjectId.trim();
    if (
      !portalSourceId ||
      !portalSourceVersionId ||
      !reviewNote ||
      !actorUserId
    ) {
      setRehearsalFormError(
        "Complete the verified portal document IDs, exact rule quote and named review. Your authenticated user identity must also be available.",
      );
      return;
    }
    if (
      !UUID_PATTERN.test(portalSourceId) ||
      !UUID_PATTERN.test(portalSourceVersionId)
    ) {
      setRehearsalFormError(
        "Portal source and version IDs must identify a verified project document and use UUID format.",
      );
      return;
    }
    if (
      deliveryPackage.manifestItems.length !== 1 ||
      rehearsalForm.fileMappings.length !== deliveryPackage.manifestItems.length
    ) {
      setRehearsalFormError(
        "This bounded browser rehearsal is available only for a package with exactly one manifest file.",
      );
      return;
    }
    const itemById = new Map(
      deliveryPackage.manifestItems.map((item) => [item.id, item]),
    );
    const normalizedMappings = rehearsalForm.fileMappings.map((mapping) => ({
      ...mapping,
      fieldExternalId: mapping.fieldExternalId.trim(),
      fieldLabel: mapping.fieldLabel.trim(),
      portalRuleText: mapping.portalRuleText.trim(),
      mappingExternalId: mapping.mappingExternalId.trim(),
      mappingRationale: mapping.mappingRationale.trim(),
      uploadOrder: mapping.uploadOrder.trim(),
    }));
    if (
      normalizedMappings.some(
        (mapping) =>
          !itemById.has(mapping.manifestItemId) ||
          !mapping.fieldExternalId ||
          !mapping.fieldLabel ||
          !mapping.portalRuleText ||
          !mapping.mappingExternalId ||
          !mapping.mappingRationale,
      )
    ) {
      setRehearsalFormError(
        "Complete one reviewed portal field and mapping for every assembled manifest file.",
      );
      return;
    }
    const mappingIds = normalizedMappings.flatMap((mapping) => [
      mapping.fieldExternalId,
      mapping.mappingExternalId,
    ]);
    if (
      mappingIds.some((value) => !DOMAIN_ID_PATTERN.test(value)) ||
      new Set(mappingIds).size !== mappingIds.length ||
      !DOMAIN_ID_PATTERN.test(actorUserId) ||
      (rehearsalSubjectId && !DOMAIN_ID_PATTERN.test(rehearsalSubjectId))
    ) {
      setRehearsalFormError(
        "Field, mapping and review IDs must be unique stable domain IDs with no unsupported characters.",
      );
      return;
    }
    const invalidMapping = normalizedMappings.find((mapping) => {
      const uploadOrder = Number(mapping.uploadOrder);
      const normalizedRule = mapping.portalRuleText
        .toLowerCase()
        .replace(/\s+/gu, " ");
      return (
        !Number.isSafeInteger(uploadOrder) ||
        uploadOrder < 1 ||
        mapping.fieldLabel.length > 2_000 ||
        mapping.portalRuleText.length > 20_000 ||
        mapping.mappingRationale.length > 20_000 ||
        !normalizedRule.includes(
          `required file field ${mapping.fieldLabel.toLowerCase()},`,
        ) ||
        !normalizedRule.includes(`upload order ${uploadOrder}`)
      );
    });
    if (invalidMapping) {
      setRehearsalFormError(
        `The rule for ${itemById.get(invalidMapping.manifestItemId)?.filename ?? "a manifest file"} must be an exact excerpt from the verified source and state “required file field [label],” plus its positive upload order.`,
      );
      return;
    }
    if (
      deliveryPackage.manifestItems.some(
        (item) =>
          !DOMAIN_ID_PATTERN.test(item.id) ||
          !SHA_256_PATTERN.test(item.sha256) ||
          !Number.isSafeInteger(item.sizeBytes) ||
          item.sizeBytes < 1,
      )
    ) {
      setRehearsalFormError(
        "The assembled package contains an invalid manifest file identity, size or SHA-256.",
      );
      return;
    }
    if (!rehearsalForm.reviewAccepted) {
      setRehearsalFormError(
        "Explicitly accept the exact portal fields, files and mappings before recording this named review.",
      );
      return;
    }

    const manifestSourceContent = buildRehearsalManifestText(
      deliveryPackage,
      normalizedMappings,
    );
    if (manifestSourceContent.length > 20_000) {
      setRehearsalFormError(
        "The canonical package-manifest citation exceeds the 20,000-character rehearsal bound.",
      );
      return;
    }

    setRehearsalPreparing(true);
    setRehearsalFormError(null);
    try {
      const [portalSourceHash, manifestSourceHash] = await Promise.all([
        sha256Hex(normalizedMappings[0]!.portalRuleText),
        sha256Hex(manifestSourceContent),
      ]);
      if (projectReleasedRef.current) return;
      const reviewedAt = new Date().toISOString();
      const review: RehearsalHumanReviewInput = {
        state: "accepted",
        reviewerId: actorUserId,
        reviewedAt,
        note: reviewNote,
      };
      const manifestCitation: RehearsalExactCitationInput = {
        sourceId: deliveryPackage.id,
        sourceVersionId: deliveryPackage.versionId,
        contentSha256: manifestSourceHash,
        startOffset: 0,
        endOffset: manifestSourceContent.length,
        quote: manifestSourceContent,
      };
      const portalCitations = new Map(
        normalizedMappings.map((mapping) => {
          const startOffset = 0;
          return [
            mapping.manifestItemId,
            {
              sourceId: portalSourceId,
              sourceVersionId: portalSourceVersionId,
              contentSha256: portalSourceHash,
              startOffset,
              endOffset: startOffset + mapping.portalRuleText.length,
              quote: mapping.portalRuleText,
            } satisfies RehearsalExactCitationInput,
          ];
        }),
      );
      const rehearsal: PortalSubmissionRehearsalInput = {
        sources: [
          {
            sourceId: portalSourceId,
            versionId: portalSourceVersionId,
            kind: "other",
            title: "Verified project portal source",
            content: normalizedMappings[0]!.portalRuleText,
            contentSha256: portalSourceHash,
            capturedAt: reviewedAt,
            authority: "authoritative",
            origin: `document:${portalSourceId}:version:${portalSourceVersionId}`,
          },
          {
            sourceId: deliveryPackage.id,
            versionId: deliveryPackage.versionId,
            kind: "company_evidence",
            title: `Valo Delivery Studio package manifest ${deliveryPackage.versionId}`,
            content: manifestSourceContent,
            contentSha256: manifestSourceHash,
            capturedAt: reviewedAt,
            authority: "authoritative",
            origin: `valo://delivery-studio/packages/${deliveryPackage.id}/versions/${deliveryPackage.versionId}/manifest`,
          },
        ],
        fields: normalizedMappings.map((mapping) => ({
          externalId: mapping.fieldExternalId,
          label: mapping.fieldLabel,
          fieldType: "file",
          required: true,
          uploadOrder: Number(mapping.uploadOrder),
          ruleText: mapping.portalRuleText,
          citations: [portalCitations.get(mapping.manifestItemId)!],
          review,
        })),
        files: deliveryPackage.manifestItems.map((item) => ({
          externalId: item.id,
          filename: item.filename,
          sizeBytes: item.sizeBytes,
          sizeText: `${item.sizeBytes} bytes`,
          sha256: item.sha256.toLowerCase(),
          citations: [manifestCitation],
          review,
        })),
        mappings: normalizedMappings.map((mapping) => ({
          externalId: mapping.mappingExternalId,
          fieldExternalId: mapping.fieldExternalId,
          fileExternalId: mapping.manifestItemId,
          rationale: mapping.mappingRationale,
          citations: [
            portalCitations.get(mapping.manifestItemId)!,
            manifestCitation,
          ],
          review,
        })),
        ...(rehearsalSubjectId
          ? {
              rehearsalReview: {
                subjectId: rehearsalSubjectId,
                review,
              },
            }
          : {}),
      };
      runAction({
        action: "rehearse_submission",
        packageVersionId: deliveryPackage.versionId,
        rehearsal,
      });
    } catch {
      setRehearsalFormError(
        "The cited excerpts could not be hashed in this browser. No rehearsal was recorded.",
      );
    } finally {
      setRehearsalPreparing(false);
    }
  };

  const stages = useMemo(
    () =>
      snapshot
        ? [
            snapshot.responseStudio.status,
            snapshot.redTeamReview.status,
            snapshot.packageAssembly.status,
            snapshot.submissionRehearsal.status,
          ]
        : [],
    [snapshot],
  );
  const completedStages = stages.filter(
    (status) => stageState(status) === "active",
  ).length;
  const overallState: SurfaceState =
    stages.length === 0 ||
    stages.every((status) => stageState(status) === "empty")
      ? "empty"
      : stages.some((status) => stageState(status) === "expired")
        ? "expired"
        : stages.some((status) => stageState(status) === "blocked")
          ? "blocked"
          : completedStages === stages.length
            ? "active"
            : "pending";

  if (organisationAccess?.isLoading || meQuery.isLoading || meQuery.isPending) {
    return <LoadingPanel label="Checking Delivery Studio access" />;
  }

  if (!canReadStudio) {
    return (
      <StatusPanel
        state="blocked"
        title="Delivery Studio access required"
        description="You need a direct membership in the selected organisation with project, draft, defect and package read permissions. Partner access and narrower grants do not request or reveal Delivery Studio records."
      />
    );
  }

  if (!hasNamedActor) {
    return (
      <StatusPanel
        state="blocked"
        title="Named profile required"
        description="Delivery Studio requires your signed-in profile to have a name between 2 and 200 characters. No Delivery Studio records were requested or shown."
      />
    );
  }

  if (studioQuery.isLoading || studioQuery.isPending) {
    return <LoadingPanel label="Loading Delivery Studio" />;
  }

  if (studioQuery.isError) {
    return (
      <DataErrorPanel
        title="Delivery Studio could not be loaded"
        description="Valo could not verify the response, review, package and rehearsal records. No readiness state has been inferred from the failed request."
        onRetry={() => void studioQuery.refetch()}
      />
    );
  }

  if (!snapshot) {
    return (
      <StatusPanel
        state="unavailable"
        title="Delivery Studio is unavailable"
        description="The pursuit returned no verifiable delivery snapshot. Refresh before recording work or relying on a status."
      />
    );
  }

  const run = snapshot.redTeamReview.run;
  const openFindings =
    run?.findings.filter(
      (finding) => normalizedStatus(finding.status) !== "resolved",
    ) ?? [];
  const deliveryPackage = snapshot.packageAssembly.package;
  const receipt = snapshot.submissionRehearsal.receipt;
  const canAssemble =
    snapshot.responseStudio.status === "ready" &&
    snapshot.redTeamReview.status === "approved";

  return (
    <div className="space-y-5">
      <Card className="shadow-none">
        <CardContent className="p-5 sm:p-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="font-serif text-2xl font-semibold tracking-tight">
                  Delivery Studio
                </h2>
                <StateBadge
                  state={overallState}
                  label={
                    overallState === "active"
                      ? "Ready"
                      : overallState === "expired"
                        ? "Stale"
                        : undefined
                  }
                />
              </div>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Move cited response work through independent challenge,
                deterministic package assembly and a no-portal-action submission
                rehearsal.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => void studioQuery.refetch()}
              disabled={studioQuery.isFetching || mutation.isPending}
            >
              <RefreshCw
                aria-hidden="true"
                className={`mr-2 size-4 ${studioQuery.isFetching ? "animate-spin" : ""}`}
              />
              Refresh
            </Button>
          </div>
          <div className="mt-5 grid gap-5 border-t border-border pt-5 lg:grid-cols-[1fr_auto] lg:items-end">
            <div>
              <div className="mb-2 flex items-center justify-between gap-4 text-sm">
                <span className="font-medium">Stage progress</span>
                <span className="text-muted-foreground">
                  {completedStages} of 4 ready
                </span>
              </div>
              <Progress value={completedStages * 25} />
            </div>
            <dl className="grid grid-cols-2 gap-x-5 gap-y-2 text-xs text-muted-foreground">
              <div>
                <dt>Snapshot</dt>
                <dd className="mt-0.5 font-medium text-foreground">
                  v{snapshot.version} ·{" "}
                  {formatWatInstant(snapshot.generatedAt, { suffix: " WAT" })}
                </dd>
              </div>
              <div>
                <dt>Source binding</dt>
                <dd
                  className="mt-0.5 font-mono text-foreground"
                  title={snapshot.sourceSnapshotHash}
                >
                  {shortHash(snapshot.sourceSnapshotHash)}
                </dd>
              </div>
            </dl>
          </div>
        </CardContent>
      </Card>

      <ActionError message={actionError} />

      {projectIsReleased ? (
        <StatusPanel
          state="active"
          title="Released project — Delivery Studio is read-only"
          description={`This project is ${statusLabel(snapshot.project.status).toLowerCase()}. Its response, review, package and rehearsal evidence remains visible, but no Delivery Studio mutation can be opened or recorded.`}
        />
      ) : null}

      {overallState === "empty" ? (
        <StatusPanel
          state="empty"
          title="No delivery work has been recorded yet"
          description="Start with a bounded response section. An empty studio is not an approval or a submission-ready verdict."
        />
      ) : overallState === "expired" ? (
        <StatusPanel
          state="expired"
          title="One or more delivery stages are stale"
          description="The source snapshot or an upstream reviewed object changed. Re-run the affected human-controlled stage before assembling or relying on the package."
        />
      ) : overallState === "blocked" ? (
        <StatusPanel
          state="blocked"
          title="Delivery has unresolved blockers"
          description="Use the stage detail below to resolve cited response, red-team or rehearsal issues. A blocked stage cannot be treated as ready."
        />
      ) : overallState === "active" ? (
        <StatusPanel
          state="active"
          title="The recorded delivery stages are ready for named-human control"
          description="This status does not sign, export, upload or submit the package. Keep final declarations and external delivery with the authorised people."
        />
      ) : null}

      <StageCard
        title="Response Studio"
        description="Write bounded sections, identify claims and bind factual or instructional statements to exact source versions. Placeholders and unsupported claims block readiness."
        status={snapshot.responseStudio.status}
        icon={FilePenLine}
        actions={
          canWriteResponse && !projectIsReleased ? (
            <Button
              type="button"
              onClick={() => openResponse()}
              disabled={mutation.isPending}
            >
              Add response section
            </Button>
          ) : undefined
        }
      >
        <div className="grid gap-3 sm:grid-cols-4">
          {[
            ["Sections", snapshot.responseStudio.sectionCount],
            ["Claims", snapshot.responseStudio.claimCount],
            ["Grounded claims", snapshot.responseStudio.groundedClaimCount],
            ["Placeholders", snapshot.responseStudio.placeholderCount],
          ].map(([label, value]) => (
            <div
              key={String(label)}
              className="rounded-lg border border-border bg-muted/25 p-3"
            >
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="mt-1 font-mono text-xl font-semibold">{value}</p>
            </div>
          ))}
        </div>
        {!canWriteResponse ? (
          <div className="mt-4">
            <ReadOnlyNote permission="draft:write, document:read and evidence:read" />
          </div>
        ) : null}
        {snapshot.responseStudio.sections.length === 0 ? (
          <p className="mt-5 text-sm text-muted-foreground">
            No response sections are recorded. Start with one section and
            explicitly classify each claim.
          </p>
        ) : (
          <div className="mt-5 space-y-3">
            {snapshot.responseStudio.sections.map((section) => (
              <ResponseSection
                key={section.id}
                section={section}
                canWrite={canWriteResponse && !projectIsReleased}
                canReview={canReviewResponse && !projectIsReleased}
                mutationPending={mutation.isPending}
                onEdit={() => openResponse(section)}
                onReview={(claim) => {
                  setClaimDecision("needs_changes");
                  setClaimNote("");
                  setDialog({ type: "claim", claim });
                }}
              />
            ))}
          </div>
        )}
      </StageCard>

      <StageCard
        title="Red-team review"
        description="A named independent reviewer challenges the current source-bound response. Empty queues never imply approval, and every finding stays open until explicitly resolved."
        status={snapshot.redTeamReview.status}
        icon={ShieldCheck}
        actions={
          !projectIsReleased && (canStartRedTeam || canApproveRedTeam) ? (
            <>
              {canStartRedTeam &&
              (!run || snapshot.redTeamReview.status === "stale") ? (
                <Button
                  type="button"
                  onClick={() => setDialog({ type: "red_team" })}
                  disabled={mutation.isPending}
                >
                  Start red-team review
                </Button>
              ) : null}
              {run &&
              canApproveRedTeam &&
              openFindings.length === 0 &&
              run.initiatedByUserId !== actorUserId &&
              normalizedStatus(snapshot.redTeamReview.status) !== "approved" &&
              normalizedStatus(snapshot.redTeamReview.status) !== "stale" ? (
                <Button
                  type="button"
                  onClick={() => setDialog({ type: "approve_red_team", run })}
                  disabled={mutation.isPending}
                >
                  Record approval
                </Button>
              ) : null}
            </>
          ) : undefined
        }
      >
        {!canStartRedTeam && !canResolveRedTeam && !canApproveRedTeam ? (
          <ReadOnlyNote permission="the required red-team action permissions" />
        ) : null}
        {!run ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No red-team run is recorded. This means review has not started; it
            does not mean the response passed.
          </p>
        ) : (
          <div className="space-y-4">
            <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="text-xs text-muted-foreground">
                  Policy version
                </dt>
                <dd className="mt-1 font-medium">{run.policyVersion}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Started</dt>
                <dd className="mt-1">
                  {formatWatInstant(run.createdAt, { suffix: " WAT" })}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Open findings</dt>
                <dd className="mt-1 font-mono font-semibold">
                  {openFindings.length}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Review due</dt>
                <dd className="mt-1">
                  {formatWatInstant(snapshot.redTeamReview.dueAt, {
                    empty: "No due time recorded",
                    suffix: snapshot.redTeamReview.dueAt ? " WAT" : "",
                  })}
                </dd>
              </div>
            </dl>
            {run.initiatedByUserId === actorUserId &&
            openFindings.length === 0 &&
            normalizedStatus(snapshot.redTeamReview.status) !== "approved" &&
            normalizedStatus(snapshot.redTeamReview.status) !== "stale" ? (
              <StatusPanel
                state="pending"
                title="Independent approval is required"
                description="You started this red-team run. A different named reviewer must inspect the current source-bound result and record any approval."
              />
            ) : null}
            {run.findings.length === 0 ? (
              <StatusPanel
                state="pending"
                title="The run contains no findings"
                description="A named reviewer must still attest to the completed independent review. An empty findings list is not self-approval."
              />
            ) : (
              <div className="space-y-2">
                {run.findings.map((finding) => {
                  const resolved =
                    normalizedStatus(finding.status) === "resolved";
                  const blocking = ["fatal", "likely_fatal"].includes(
                    normalizedStatus(finding.severity),
                  );
                  return (
                    <div
                      key={finding.id}
                      className="rounded-lg border border-border p-4"
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge
                              variant={
                                finding.severity === "fatal"
                                  ? "destructive"
                                  : "outline"
                              }
                            >
                              {humaniseTokenCapitalised(finding.severity)}
                            </Badge>
                            <Badge variant="secondary">
                              {humaniseTokenCapitalised(finding.category)}
                            </Badge>
                            <StateBadge
                              state={resolved ? "active" : "blocked"}
                              label={resolved ? "Resolved" : "Open"}
                            />
                          </div>
                          <p className="mt-3 text-sm leading-6">
                            {finding.finding}
                          </p>
                          {finding.resolution ? (
                            <p className="mt-2 rounded-md bg-muted p-3 text-xs leading-5 text-muted-foreground">
                              Resolution: {finding.resolution}
                            </p>
                          ) : null}
                        </div>
                        {!resolved &&
                        canResolveRedTeam &&
                        !projectIsReleased &&
                        !blocking ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              setDialog({ type: "finding", run, finding })
                            }
                            disabled={mutation.isPending}
                          >
                            Resolve finding
                          </Button>
                        ) : null}
                        {!resolved && blocking ? (
                          <p className="max-w-xs text-xs leading-5 text-muted-foreground">
                            Remediate the cited source, then run a new
                            independent review. A note cannot clear a blocking
                            finding.
                          </p>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {run.approvedAt ? (
              <div className="space-y-2">
                <p className="flex items-center gap-2 text-sm text-emerald-800">
                  <UserRoundCheck aria-hidden="true" className="size-4" />
                  Named-human approval recorded{" "}
                  {formatWatInstant(run.approvedAt, { suffix: " WAT" })}
                </p>
                {run.approvalAttestation ? (
                  <p className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs leading-5 text-emerald-950">
                    Attestation: {run.approvalAttestation}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
      </StageCard>

      <StageCard
        title="Package assembly"
        description="Build one deterministic submission manifest from the current reviewed inputs. Assembly cannot sign, export, deliver or submit a package."
        status={snapshot.packageAssembly.status}
        icon={PackageCheck}
        actions={
          canGeneratePackage && !projectIsReleased ? (
            <Button
              type="button"
              onClick={() => setDialog({ type: "assemble_package" })}
              disabled={!canAssemble || mutation.isPending}
              title={
                canAssemble
                  ? undefined
                  : "Response and red-team review must be ready first."
              }
            >
              Assemble package
            </Button>
          ) : undefined
        }
      >
        {!canGeneratePackage ? (
          <ReadOnlyNote permission="package:generate" />
        ) : null}
        {!deliveryPackage ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No governed package version is recorded. Response readiness and
            red-team approval are required before assembly.
          </p>
        ) : (
          <div className="space-y-4">
            <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="text-xs text-muted-foreground">
                  Package version
                </dt>
                <dd className="mt-1 font-medium">
                  v{deliveryPackage.versionNumber}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">
                  Manifest items
                </dt>
                <dd className="mt-1 font-mono font-semibold">
                  {deliveryPackage.manifestItems.length}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Render QA</dt>
                <dd className="mt-1">
                  {humaniseTokenCapitalised(deliveryPackage.renderQaStatus)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Manifest hash</dt>
                <dd
                  className="mt-1 font-mono"
                  title={deliveryPackage.manifestHash}
                >
                  {shortHash(deliveryPackage.manifestHash)}
                </dd>
              </div>
            </dl>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[620px] text-left text-sm">
                <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Order</th>
                    <th className="px-4 py-3 font-medium">File</th>
                    <th className="px-4 py-3 font-medium">Type</th>
                    <th className="px-4 py-3 font-medium">Bytes</th>
                    <th className="px-4 py-3 font-medium">SHA-256</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {deliveryPackage.manifestItems.map((item) => (
                    <tr key={item.id}>
                      <td className="px-4 py-3 font-mono">{item.ordinal}</td>
                      <td className="px-4 py-3 font-medium">{item.filename}</td>
                      <td className="px-4 py-3">
                        {humaniseTokenCapitalised(item.itemType)}
                      </td>
                      <td className="px-4 py-3 font-mono">
                        {item.sizeBytes.toLocaleString("en-NG")}
                      </td>
                      <td className="px-4 py-3 font-mono" title={item.sha256}>
                        {shortHash(item.sha256)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        <div className="mt-4 rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs leading-5 text-sky-950">
          {canSignPackage
            ? "Your role includes package:sign_off. Final sign-off remains a separate named-human gate in Package & export; assembly here does not sign it."
            : "Package sign-off requires a separate named person with package:sign_off. Assembly does not grant that authority."}
        </div>
      </StageCard>

      <StageCard
        title="Submission rehearsal"
        description="Inspect a frozen package against cited portal fields and manual declarations. Valo never uses credentials, accepts declarations, uploads files or clicks submit."
        status={snapshot.submissionRehearsal.status}
        icon={ClipboardCheck}
        actions={
          canReviewIntelligence && !projectIsReleased ? (
            <Button
              type="button"
              onClick={() => deliveryPackage && openRehearsal(deliveryPackage)}
              disabled={
                !deliveryPackage ||
                deliveryPackage.manifestItems.length !== 1 ||
                normalizedStatus(snapshot.packageAssembly.status) !== "ready" ||
                mutation.isPending ||
                rehearsalPreparing
              }
              title={
                deliveryPackage &&
                deliveryPackage.manifestItems.length === 1 &&
                normalizedStatus(snapshot.packageAssembly.status) === "ready"
                  ? undefined
                  : "A ready assembled package with exactly one manifest file is required for this bounded browser rehearsal."
              }
            >
              Prepare submission rehearsal
            </Button>
          ) : undefined
        }
      >
        {!canReviewIntelligence ? (
          <div className="mb-4">
            <ReadOnlyNote permission="intelligence:review" />
          </div>
        ) : null}
        {!receipt ? (
          <StatusPanel
            state={deliveryPackage ? "pending" : "empty"}
            title={
              deliveryPackage
                ? "A reviewed portal profile is required"
                : "No package is available to rehearse"
            }
            description={
              deliveryPackage
                ? deliveryPackage.manifestItems.length === 1
                  ? "Prepare its single file-field mapping from an exact verified portal-rule quote. Canonical package evidence is derived automatically; this cannot use credentials, upload or submit."
                  : "Browser rehearsal is unavailable because this package does not contain exactly one manifest file. Use a governed multi-file rehearsal workflow instead."
                : "Assemble and freeze a governed package before preparing the separate cited portal profile."
            }
          />
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs text-muted-foreground">
                  Operator rehearsal
                </p>
                <p className="mt-1 font-medium">
                  {receipt.readyForOperatorRehearsal ? "Ready" : "Not ready"}
                </p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs text-muted-foreground">Rehearsal ID</p>
                <p className="mt-1 font-mono text-xs">{receipt.rehearsalId}</p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs text-muted-foreground">Completed</p>
                <p className="mt-1 text-sm">
                  {formatWatInstant(receipt.completedAt, { suffix: " WAT" })}
                </p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs text-muted-foreground">Issues</p>
                <p className="mt-1 font-mono font-semibold">
                  {receipt.issues.length}
                </p>
              </div>
            </div>
            {receipt.issues.length > 0 ? (
              <div className="space-y-2">
                {receipt.issues.map((issue) => (
                  <div
                    key={`${issue.code}:${issue.message}`}
                    className={`flex gap-3 rounded-lg border p-3 text-sm ${
                      issue.severity === "blocker"
                        ? "border-red-200 bg-red-50 text-red-900"
                        : "border-amber-200 bg-amber-50 text-amber-950"
                    }`}
                  >
                    <AlertTriangle
                      aria-hidden="true"
                      className="mt-0.5 size-4 shrink-0"
                    />
                    <div>
                      <p className="font-medium">
                        {humaniseTokenCapitalised(issue.code)}
                      </p>
                      <p className="mt-0.5 leading-5">{issue.message}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="flex items-center gap-2 text-sm text-emerald-800">
                <CheckCircle2 aria-hidden="true" className="size-4" />
                No rehearsal issues are recorded. External submission still
                requires the authorised operator.
              </p>
            )}
          </div>
        )}
      </StageCard>

      <Card className="border-sky-200 bg-sky-50/60 shadow-none">
        <CardContent className="flex gap-3 p-5 text-sm text-sky-950">
          <UserRoundCheck
            aria-hidden="true"
            className="mt-0.5 size-5 shrink-0"
          />
          <div>
            <h2 className="font-semibold">
              Named-human authority is mandatory
            </h2>
            <p className="mt-1 leading-6">{snapshot.authorityNote}</p>
            <p className="mt-1 leading-6">
              Automatic mutation: off · External portal action: off ·
              Named-human authority: required.
            </p>
          </div>
        </CardContent>
      </Card>

      <Dialog
        open={dialog !== null && !projectIsReleased}
        onOpenChange={(open) =>
          !open && !mutation.isPending && !rehearsalPreparing && setDialog(null)
        }
      >
        <DialogContent
          className={`max-h-[90dvh] overflow-y-auto ${
            dialog?.type === "rehearsal" ? "max-w-4xl" : "max-w-2xl"
          }`}
        >
          {dialog?.type === "response" ? (
            <>
              <DialogHeader>
                <DialogTitle>
                  {dialog.section
                    ? "Save a new response version"
                    : "Add a response section"}
                </DialogTitle>
                <DialogDescription>
                  Record bounded manual content. Factual and instructional
                  claims require an exact source-version citation; saving never
                  approves the response.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="response-section-key">Section key</Label>
                  <Input
                    id="response-section-key"
                    value={responseForm.sectionKey}
                    onChange={(event) =>
                      setResponseForm({
                        ...responseForm,
                        sectionKey: event.currentTarget.value,
                      })
                    }
                    maxLength={80}
                    disabled={Boolean(dialog.section)}
                    placeholder="technical-approach"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="response-title">Title</Label>
                  <Input
                    id="response-title"
                    value={responseForm.title}
                    onChange={(event) =>
                      setResponseForm({
                        ...responseForm,
                        title: event.currentTarget.value,
                      })
                    }
                    maxLength={200}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="response-content">Response content</Label>
                  <Textarea
                    id="response-content"
                    value={responseForm.content}
                    onChange={(event) =>
                      setResponseForm({
                        ...responseForm,
                        content: event.currentTarget.value,
                      })
                    }
                    rows={8}
                    maxLength={12_000}
                    placeholder="Write the bounded response section. Remove TODO and placeholder text before review."
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="response-change-summary">
                    Change summary (optional)
                  </Label>
                  <Input
                    id="response-change-summary"
                    value={responseForm.changeSummary}
                    onChange={(event) =>
                      setResponseForm({
                        ...responseForm,
                        changeSummary: event.currentTarget.value,
                      })
                    }
                    maxLength={500}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="response-claims">
                    Claims, one per line (maximum 20)
                  </Label>
                  <Textarea
                    id="response-claims"
                    value={responseForm.claimLines}
                    onChange={(event) =>
                      setResponseForm({
                        ...responseForm,
                        claimLines: event.currentTarget.value,
                      })
                    }
                    rows={4}
                    maxLength={4_000}
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="grid gap-1.5">
                    <Label htmlFor="response-claim-kind">Claim kind</Label>
                    <Select
                      value={responseForm.claimKind}
                      onValueChange={(value) =>
                        setResponseForm({
                          ...responseForm,
                          claimKind: value as ResponseClaimInput["kind"],
                        })
                      }
                    >
                      <SelectTrigger id="response-claim-kind">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="opinion">Opinion</SelectItem>
                        <SelectItem value="factual">Factual</SelectItem>
                        <SelectItem value="instructional">
                          Instructional
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="response-support-mode">Citation mode</Label>
                    <Select
                      value={responseForm.supportMode}
                      onValueChange={(value) =>
                        setResponseForm({
                          ...responseForm,
                          supportMode: value as NonNullable<
                            ResponseClaimInput["supportMode"]
                          >,
                        })
                      }
                    >
                      <SelectTrigger id="response-support-mode">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="exact_quote">Exact quote</SelectItem>
                        <SelectItem value="paraphrase">
                          Paraphrase — named review required
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <fieldset className="grid gap-3 rounded-lg border border-border p-4">
                  <legend className="px-1 text-sm font-medium">
                    Source citation for these claims
                  </legend>
                  <p className="text-xs leading-5 text-muted-foreground">
                    Leave all citation fields empty only for opinion claims.
                    This bounded form applies one citation to every listed
                    claim.
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="grid gap-1.5">
                      <Label htmlFor="response-document-id">Document ID</Label>
                      <Input
                        id="response-document-id"
                        value={responseForm.documentId}
                        onChange={(event) =>
                          setResponseForm({
                            ...responseForm,
                            documentId: event.currentTarget.value,
                          })
                        }
                        maxLength={100}
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="response-document-version-id">
                        Document version ID
                      </Label>
                      <Input
                        id="response-document-version-id"
                        value={responseForm.documentVersionId}
                        onChange={(event) =>
                          setResponseForm({
                            ...responseForm,
                            documentVersionId: event.currentTarget.value,
                          })
                        }
                        maxLength={100}
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="response-page-number">Page number</Label>
                      <Input
                        id="response-page-number"
                        inputMode="numeric"
                        value={responseForm.pageNumber}
                        onChange={(event) =>
                          setResponseForm({
                            ...responseForm,
                            pageNumber: event.currentTarget.value,
                          })
                        }
                        maxLength={6}
                      />
                    </div>
                    <div className="grid gap-1.5 sm:col-span-2">
                      <Label htmlFor="response-quote">Exact quote</Label>
                      <Textarea
                        id="response-quote"
                        value={responseForm.quote}
                        onChange={(event) =>
                          setResponseForm({
                            ...responseForm,
                            quote: event.currentTarget.value,
                          })
                        }
                        rows={3}
                        maxLength={2_000}
                      />
                    </div>
                  </div>
                </fieldset>
                {responseFormError ? (
                  <p role="alert" className="text-sm text-destructive">
                    {responseFormError}
                  </p>
                ) : null}
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDialog(null)}
                  disabled={mutation.isPending}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={submitResponse}
                  disabled={mutation.isPending}
                >
                  {mutation.isPending ? (
                    <Loader2
                      aria-hidden="true"
                      className="mr-2 size-4 animate-spin"
                    />
                  ) : null}
                  Save response version
                </Button>
              </DialogFooter>
            </>
          ) : null}

          {dialog?.type === "response_edit_blocked" ? (
            <>
              <DialogHeader>
                <DialogTitle>
                  Existing response version is read-only
                </DialogTitle>
                <DialogDescription>
                  {dialog.section.title} v{dialog.section.currentVersionNumber}{" "}
                  cannot be edited safely in this bounded form.
                </DialogDescription>
              </DialogHeader>
              <div
                role="note"
                className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950"
              >
                <p>
                  The stored response projection does not expose every original
                  document ID, page, quote and offset needed to reconstruct its
                  save request. Re-saving it here could silently replace mixed
                  claim kinds, support modes or citations.
                </p>
                <p>
                  To preserve all {dialog.section.version?.claims.length ?? 0}{" "}
                  recorded claims and their evidence exactly, no mutation is
                  available. Add a separate response section, or wait for a
                  claim-preserving version editor.
                </p>
              </div>
              <DialogFooter>
                <Button type="button" onClick={() => setDialog(null)}>
                  Close without changes
                </Button>
              </DialogFooter>
            </>
          ) : null}

          {dialog?.type === "claim" ? (
            <>
              <DialogHeader>
                <DialogTitle>Review response claim</DialogTitle>
                <DialogDescription>
                  Record a named review decision for “{dialog.claim.text}”. This
                  reviews the claim only and grants no package or release
                  authority.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="claim-decision">Decision</Label>
                  <Select
                    value={claimDecision}
                    onValueChange={(value) =>
                      setClaimDecision(value as typeof claimDecision)
                    }
                  >
                    <SelectTrigger id="claim-decision">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="accepted">Accepted</SelectItem>
                      <SelectItem value="needs_changes">
                        Needs changes
                      </SelectItem>
                      <SelectItem value="rejected">Rejected</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="claim-note">Review note</Label>
                  <Textarea
                    id="claim-note"
                    value={claimNote}
                    onChange={(event) =>
                      setClaimNote(event.currentTarget.value)
                    }
                    rows={4}
                    maxLength={1_000}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDialog(null)}
                  disabled={mutation.isPending}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  disabled={mutation.isPending || claimNote.trim().length === 0}
                  onClick={() =>
                    runAction({
                      action: "review_response_claim",
                      claimId: dialog.claim.id,
                      decision: claimDecision,
                      note: claimNote.trim(),
                    })
                  }
                >
                  Record claim review
                </Button>
              </DialogFooter>
            </>
          ) : null}

          {dialog?.type === "red_team" ? (
            <>
              <DialogHeader>
                <DialogTitle>Start red-team review</DialogTitle>
                <DialogDescription>
                  Bind a named independent review to the current response
                  snapshot. Enter manual findings one per line, or start an
                  explicitly empty run that still requires separate approval.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="red-team-policy">
                    Approved policy version
                  </Label>
                  <Input
                    id="red-team-policy"
                    value={redTeamForm.policyVersion}
                    onChange={(event) =>
                      setRedTeamForm({
                        ...redTeamForm,
                        policyVersion: event.currentTarget.value,
                      })
                    }
                    maxLength={100}
                    placeholder="Enter the organisation-approved rubric version"
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="grid gap-1.5">
                    <Label htmlFor="red-team-category">Finding category</Label>
                    <Input
                      id="red-team-category"
                      value={redTeamForm.category}
                      onChange={(event) =>
                        setRedTeamForm({
                          ...redTeamForm,
                          category: event.currentTarget.value,
                        })
                      }
                      maxLength={80}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="red-team-severity">Severity</Label>
                    <Select
                      value={redTeamForm.severity}
                      onValueChange={(value) =>
                        setRedTeamForm({
                          ...redTeamForm,
                          severity: value as typeof redTeamForm.severity,
                        })
                      }
                    >
                      <SelectTrigger id="red-team-severity">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="fatal">Fatal</SelectItem>
                        <SelectItem value="likely_fatal">
                          Likely fatal
                        </SelectItem>
                        <SelectItem value="scoring_risk">
                          Scoring risk
                        </SelectItem>
                        <SelectItem value="cosmetic">Cosmetic</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="red-team-findings">
                    Manual findings, one per line (maximum 20)
                  </Label>
                  <Textarea
                    id="red-team-findings"
                    value={redTeamForm.findings}
                    onChange={(event) =>
                      setRedTeamForm({
                        ...redTeamForm,
                        findings: event.currentTarget.value,
                      })
                    }
                    rows={6}
                    maxLength={6_000}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDialog(null)}
                  disabled={mutation.isPending}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  disabled={
                    mutation.isPending ||
                    redTeamForm.policyVersion.trim().length === 0 ||
                    redTeamForm.findings
                      .split("\n")
                      .filter((line) => line.trim()).length > 20
                  }
                  onClick={() =>
                    runAction({
                      action: "start_red_team",
                      policyVersion: redTeamForm.policyVersion.trim(),
                      findings: redTeamForm.findings
                        .split("\n")
                        .map((line) => line.trim())
                        .filter(Boolean)
                        .map((finding) => ({
                          category: redTeamForm.category.trim() || "general",
                          severity: redTeamForm.severity,
                          finding,
                        })),
                    })
                  }
                >
                  Start source-bound review
                </Button>
              </DialogFooter>
            </>
          ) : null}

          {dialog?.type === "finding" ? (
            <>
              <DialogHeader>
                <DialogTitle>Resolve red-team finding</DialogTitle>
                <DialogDescription>{dialog.finding.finding}</DialogDescription>
              </DialogHeader>
              <div className="grid gap-1.5 py-2">
                <Label htmlFor="finding-resolution">Resolution evidence</Label>
                <Textarea
                  id="finding-resolution"
                  value={resolution}
                  onChange={(event) => setResolution(event.currentTarget.value)}
                  rows={5}
                  maxLength={2_000}
                />
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDialog(null)}
                  disabled={mutation.isPending}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  disabled={mutation.isPending || resolution.trim().length < 4}
                  onClick={() =>
                    runAction({
                      action: "resolve_red_team_finding",
                      runId: dialog.run.id,
                      findingId: dialog.finding.id,
                      resolution: resolution.trim(),
                    })
                  }
                >
                  Record resolution
                </Button>
              </DialogFooter>
            </>
          ) : null}

          {dialog?.type === "approve_red_team" ? (
            <>
              <DialogHeader>
                <DialogTitle>Record independent red-team approval</DialogTitle>
                <DialogDescription>
                  Confirm the named review is complete against policy{" "}
                  {dialog.run.policyVersion}. This does not approve or sign a
                  package.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-1.5 py-2">
                <Label htmlFor="red-team-attestation">
                  Named reviewer attestation
                </Label>
                <Textarea
                  id="red-team-attestation"
                  value={attestation}
                  onChange={(event) =>
                    setAttestation(event.currentTarget.value)
                  }
                  rows={5}
                  maxLength={2_000}
                  placeholder="State what was independently reviewed and why all findings are resolved."
                />
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDialog(null)}
                  disabled={mutation.isPending}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  disabled={
                    mutation.isPending || attestation.trim().length < 12
                  }
                  onClick={() =>
                    runAction({
                      action: "approve_red_team",
                      runId: dialog.run.id,
                      attestation: attestation.trim(),
                    })
                  }
                >
                  Record named-human approval
                </Button>
              </DialogFooter>
            </>
          ) : null}

          {dialog?.type === "assemble_package" ? (
            <>
              <DialogHeader>
                <DialogTitle>Assemble submission package</DialogTitle>
                <DialogDescription>
                  Create a deterministic manifest from the current response and
                  approved red-team snapshot. This action does not sign, export,
                  upload, deliver or submit the package.
                </DialogDescription>
              </DialogHeader>
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
                A later source or response change will make this package stale.
                Final visual QA, sign-off and delivery remain separate
                named-human controls.
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDialog(null)}
                  disabled={mutation.isPending}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  disabled={mutation.isPending}
                  onClick={() =>
                    runAction({
                      action: "assemble_package",
                      packageType: "submission",
                    })
                  }
                >
                  <PlayCircle aria-hidden="true" className="mr-2 size-4" />
                  Assemble governed manifest
                </Button>
              </DialogFooter>
            </>
          ) : null}

          {dialog?.type === "rehearsal" ? (
            <>
              <DialogHeader>
                <DialogTitle>Prepare submission rehearsal</DialogTitle>
                <DialogDescription>
                  Bind the package's single manifest file to one reviewed portal
                  field and exact verified project-document quote. This is an
                  inspection record only: it has no credential, declaration
                  acceptance, upload, delivery or submit control.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-5 py-2">
                <div className="rounded-lg border border-sky-200 bg-sky-50 p-4 text-sm leading-6 text-sky-950">
                  The server binds the document IDs to the current verified
                  project snapshot and corrects the quote offsets. Canonical
                  company-manifest title, origin, content and hash are derived
                  from this frozen package, never typed by the operator.
                </div>

                <fieldset className="grid gap-4 rounded-lg border border-border p-4">
                  <legend className="px-1 text-sm font-semibold">
                    Verified portal-rule source
                  </legend>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="grid gap-1.5">
                      <Label htmlFor="rehearsal-portal-source-id">
                        Project document ID
                      </Label>
                      <Input
                        id="rehearsal-portal-source-id"
                        value={rehearsalForm.portalSourceId}
                        onChange={(event) =>
                          setRehearsalForm({
                            ...rehearsalForm,
                            portalSourceId: event.currentTarget.value,
                          })
                        }
                        maxLength={128}
                        placeholder="00000000-0000-4000-8000-000000000000"
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="rehearsal-portal-version-id">
                        Project document version ID
                      </Label>
                      <Input
                        id="rehearsal-portal-version-id"
                        value={rehearsalForm.portalSourceVersionId}
                        onChange={(event) =>
                          setRehearsalForm({
                            ...rehearsalForm,
                            portalSourceVersionId: event.currentTarget.value,
                          })
                        }
                        maxLength={128}
                        placeholder="00000000-0000-4000-8000-000000000000"
                      />
                    </div>
                    <p className="text-xs leading-5 text-muted-foreground sm:col-span-2">
                      Only IDs are entered here. Filename, source kind,
                      canonical text, hash, capture time, authority and origin
                      are bound server-side from the verified current document
                      snapshot.
                    </p>
                  </div>
                </fieldset>

                <fieldset className="grid gap-4 rounded-lg border border-border p-4">
                  <legend className="px-1 text-sm font-semibold">
                    Assembled package file and mapping
                  </legend>
                  {dialog.deliveryPackage.manifestItems[0] &&
                  rehearsalForm.fileMappings[0] ? (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <dl className="grid gap-2 rounded-md bg-muted/40 p-3 text-xs sm:col-span-2 sm:grid-cols-3">
                        <div>
                          <dt className="text-muted-foreground">Filename</dt>
                          <dd className="mt-1 font-medium">
                            {dialog.deliveryPackage.manifestItems[0].filename}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">Exact size</dt>
                          <dd className="mt-1 font-mono">
                            {dialog.deliveryPackage.manifestItems[0].sizeBytes}{" "}
                            bytes
                          </dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">SHA-256</dt>
                          <dd
                            className="mt-1 font-mono"
                            title={
                              dialog.deliveryPackage.manifestItems[0].sha256
                            }
                          >
                            {shortHash(
                              dialog.deliveryPackage.manifestItems[0].sha256,
                            )}
                          </dd>
                        </div>
                      </dl>
                      <div className="grid gap-1.5">
                        <Label htmlFor="rehearsal-field-id">
                          Portal field ID
                        </Label>
                        <Input
                          id="rehearsal-field-id"
                          value={rehearsalForm.fileMappings[0].fieldExternalId}
                          onChange={(event) =>
                            updateRehearsalFileMapping(
                              dialog.deliveryPackage.manifestItems[0]!.id,
                              { fieldExternalId: event.currentTarget.value },
                            )
                          }
                          maxLength={128}
                        />
                      </div>
                      <div className="grid gap-1.5">
                        <Label htmlFor="rehearsal-field-label">
                          Portal field label
                        </Label>
                        <Input
                          id="rehearsal-field-label"
                          value={rehearsalForm.fileMappings[0].fieldLabel}
                          onChange={(event) =>
                            updateRehearsalFileMapping(
                              dialog.deliveryPackage.manifestItems[0]!.id,
                              { fieldLabel: event.currentTarget.value },
                            )
                          }
                          maxLength={2_000}
                        />
                      </div>
                      <div className="grid gap-1.5">
                        <Label htmlFor="rehearsal-upload-order">
                          Upload order
                        </Label>
                        <Input
                          id="rehearsal-upload-order"
                          type="number"
                          min={1}
                          step={1}
                          value={rehearsalForm.fileMappings[0].uploadOrder}
                          onChange={(event) =>
                            updateRehearsalFileMapping(
                              dialog.deliveryPackage.manifestItems[0]!.id,
                              { uploadOrder: event.currentTarget.value },
                            )
                          }
                        />
                      </div>
                      <div className="grid gap-1.5">
                        <Label htmlFor="rehearsal-mapping-id">Mapping ID</Label>
                        <Input
                          id="rehearsal-mapping-id"
                          value={
                            rehearsalForm.fileMappings[0].mappingExternalId
                          }
                          onChange={(event) =>
                            updateRehearsalFileMapping(
                              dialog.deliveryPackage.manifestItems[0]!.id,
                              { mappingExternalId: event.currentTarget.value },
                            )
                          }
                          maxLength={128}
                        />
                      </div>
                      <div className="grid gap-1.5 sm:col-span-2">
                        <Label htmlFor="rehearsal-portal-rule">
                          Exact portal rule quote
                        </Label>
                        <Textarea
                          id="rehearsal-portal-rule"
                          value={rehearsalForm.fileMappings[0].portalRuleText}
                          onChange={(event) =>
                            updateRehearsalFileMapping(
                              dialog.deliveryPackage.manifestItems[0]!.id,
                              { portalRuleText: event.currentTarget.value },
                            )
                          }
                          rows={4}
                          maxLength={20_000}
                        />
                        <p className="text-xs leading-5 text-muted-foreground">
                          Quote exact unique text from the verified document. It
                          must state “required file field [label],” and “upload
                          order [number]”.
                        </p>
                      </div>
                      <div className="grid gap-1.5 sm:col-span-2">
                        <Label htmlFor="rehearsal-mapping-rationale">
                          Mapping rationale
                        </Label>
                        <Textarea
                          id="rehearsal-mapping-rationale"
                          value={rehearsalForm.fileMappings[0].mappingRationale}
                          onChange={(event) =>
                            updateRehearsalFileMapping(
                              dialog.deliveryPackage.manifestItems[0]!.id,
                              { mappingRationale: event.currentTarget.value },
                            )
                          }
                          rows={2}
                          maxLength={20_000}
                        />
                      </div>
                      <p className="text-xs leading-5 text-muted-foreground sm:col-span-2">
                        The complete canonical company-manifest evidence source
                        and its full citation are generated automatically from
                        this immutable file and reviewed mapping.
                      </p>
                    </div>
                  ) : null}
                </fieldset>

                <fieldset className="grid gap-4 rounded-lg border border-border p-4">
                  <legend className="px-1 text-sm font-semibold">
                    Named review
                  </legend>
                  <div className="grid gap-4">
                    <div className="rounded-md bg-muted/40 p-3 text-sm">
                      Named reviewer: {actorUserId || "Identity unavailable"}
                    </div>
                    <div className="grid gap-1.5 sm:col-span-2">
                      <Label htmlFor="rehearsal-review-note">Review note</Label>
                      <Textarea
                        id="rehearsal-review-note"
                        value={rehearsalForm.reviewNote}
                        onChange={(event) =>
                          setRehearsalForm({
                            ...rehearsalForm,
                            reviewNote: event.currentTarget.value,
                          })
                        }
                        rows={3}
                        maxLength={5_000}
                        placeholder="State what source, field, file and mapping were checked."
                      />
                    </div>
                    <label
                      htmlFor="rehearsal-review-acceptance"
                      className="flex items-start gap-3 rounded-md border border-border p-3 text-sm leading-6"
                    >
                      <input
                        id="rehearsal-review-acceptance"
                        type="checkbox"
                        className="mt-1 size-4"
                        checked={rehearsalForm.reviewAccepted}
                        onChange={(event) =>
                          setRehearsalForm({
                            ...rehearsalForm,
                            reviewAccepted: event.currentTarget.checked,
                          })
                        }
                      />
                      <span>
                        I accept this exact portal field, assembled file and
                        mapping as the current named operator. This does not
                        authorise credentials, upload or submission.
                      </span>
                    </label>
                    <div className="rounded-md border border-border p-3 text-xs leading-5 text-muted-foreground">
                      {rehearsalForm.rehearsalSubjectId ? (
                        <>
                          Overall review will bind to stable rehearsal ID{" "}
                          <span className="font-mono text-foreground">
                            {rehearsalForm.rehearsalSubjectId}
                          </span>
                          . Keep the reviewed inputs unchanged from the first
                          pass.
                        </>
                      ) : (
                        <>
                          This first pass returns a stable rehearsal ID. Open
                          the resulting current receipt and run the same
                          reviewed inputs again to bind the overall review.
                        </>
                      )}
                    </div>
                  </div>
                </fieldset>

                {rehearsalFormError ? (
                  <p role="alert" className="text-sm text-destructive">
                    {rehearsalFormError}
                  </p>
                ) : null}
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDialog(null)}
                  disabled={mutation.isPending || rehearsalPreparing}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={() => void submitRehearsal()}
                  disabled={mutation.isPending || rehearsalPreparing}
                >
                  {rehearsalPreparing ? (
                    <Loader2
                      aria-hidden="true"
                      className="mr-2 size-4 animate-spin"
                    />
                  ) : (
                    <ClipboardCheck
                      aria-hidden="true"
                      className="mr-2 size-4"
                    />
                  )}
                  Record bounded rehearsal
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ResponseSection({
  section,
  canWrite,
  canReview,
  mutationPending,
  onEdit,
  onReview,
}: {
  section: DeliveryStudioSection;
  canWrite: boolean;
  canReview: boolean;
  mutationPending: boolean;
  onEdit: () => void;
  onReview: (claim: DeliveryStudioClaim) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const claims = section.version?.claims ?? [];
  return (
    <div className="rounded-lg border border-border">
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">{section.title}</h3>
            <Badge variant="outline">v{section.currentVersionNumber}</Badge>
            <StateBadge
              state={stageState(section.status)}
              label={statusLabel(section.status)}
            />
          </div>
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            {section.sectionKey}
          </p>
        </div>
        <div className="flex gap-2">
          {canWrite ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onEdit}
              disabled={mutationPending}
            >
              Edit response
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
          >
            {expanded ? "Hide details" : "Show details"}
            {expanded ? (
              <ChevronUp aria-hidden="true" className="ml-1 size-4" />
            ) : (
              <ChevronDown aria-hidden="true" className="ml-1 size-4" />
            )}
          </Button>
        </div>
      </div>
      {expanded ? (
        <div className="space-y-4 border-t border-border p-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Current content
            </p>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6">
              {section.version?.content || "No current version content."}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Claims ({claims.length})
            </p>
            {claims.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                No explicit claims are recorded for this version.
              </p>
            ) : (
              <div className="mt-2 space-y-2">
                {claims.map((claim) => (
                  <div
                    key={claim.id}
                    className="rounded-md border border-border bg-muted/20 p-3"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="secondary">
                            {humaniseTokenCapitalised(claim.kind)}
                          </Badge>
                          <StateBadge
                            state={stageState(claim.groundingStatus)}
                            label={statusLabel(claim.groundingStatus)}
                          />
                          <span className="text-xs text-muted-foreground">
                            {claim.citations.length} citation
                            {claim.citations.length === 1 ? "" : "s"}
                          </span>
                        </div>
                        <p className="mt-2 text-sm leading-6">{claim.text}</p>
                        {claim.citations.map((citation) => (
                          <p
                            key={citation.id}
                            className="mt-2 font-mono text-xs text-muted-foreground"
                            title={citation.evidenceHash}
                          >
                            {citation.evidenceCitation} ·{" "}
                            {shortHash(citation.evidenceHash)}
                          </p>
                        ))}
                      </div>
                      {canReview ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => onReview(claim)}
                          disabled={mutationPending}
                        >
                          Review claim
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
