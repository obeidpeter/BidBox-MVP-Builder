import type { CitationFirstResponseValidation } from "../intelligence/boundedMvpResponseStudio";
import type {
  PortalSubmissionRehearsalInput,
  PortalSubmissionRehearsalResult,
} from "../intelligence/portalSubmissionRehearsal";

export const DELIVERY_STUDIO_AUTHORITY_NOTE =
  "Delivery Studio organises cited response work for named-human review. It never submits to an external portal, approves its own work, predicts an outcome, or reuses another tenant's data.";

export const DELIVERY_STUDIO_SAFETY = Object.freeze({
  automaticMutation: false as const,
  externalPortalAction: false as const,
  namedHumanAuthority: true as const,
});

export interface DeliveryStudioSingleUnitCitation {
  readonly pageNumber: number;
  readonly quote: string;
  readonly startOffset?: number;
  readonly endOffset?: number;
}

export interface DeliveryStudioBoundCitationText {
  readonly canonicalPageText: string;
  readonly startOffset: number;
  readonly endOffset: number;
}

/**
 * Project company-evidence snapshots do not yet store page-boundary spans.
 * A verified one-page document, or a canonical extraction with no declared
 * physical page count, is therefore treated as one bounded canonical text
 * unit called page 1. Multi-page documents fail closed until trustworthy page
 * boundaries are persisted. Omitted offsets are accepted only when the exact
 * quote occurs once; the returned validator text is content-minimised.
 */
export function bindDeliveryStudioSingleUnitCitation(input: {
  readonly canonicalText: string;
  readonly pageCount: number | null;
  readonly citation: DeliveryStudioSingleUnitCitation;
}): DeliveryStudioBoundCitationText | null {
  const { citation, canonicalText, pageCount } = input;
  if (
    citation.pageNumber !== 1 ||
    (pageCount !== null && pageCount !== 1) ||
    canonicalText.length < 1 ||
    citation.quote.length < 1 ||
    citation.quote.length > 60_000
  ) {
    return null;
  }
  const hasStart = citation.startOffset !== undefined;
  const hasEnd = citation.endOffset !== undefined;
  if (hasStart !== hasEnd) return null;
  let sourceStart: number;
  let sourceEnd: number;
  if (hasStart && hasEnd) {
    if (
      !Number.isSafeInteger(citation.startOffset) ||
      !Number.isSafeInteger(citation.endOffset)
    ) {
      return null;
    }
    sourceStart = citation.startOffset as number;
    sourceEnd = citation.endOffset as number;
  } else {
    sourceStart = canonicalText.indexOf(citation.quote);
    sourceEnd = sourceStart + citation.quote.length;
    if (
      sourceStart < 0 ||
      canonicalText.indexOf(citation.quote, sourceEnd) >= 0
    ) {
      return null;
    }
  }
  return sourceStart >= 0 &&
    sourceEnd > sourceStart &&
    sourceEnd <= canonicalText.length &&
    canonicalText.slice(sourceStart, sourceEnd) === citation.quote
    ? {
        canonicalPageText: citation.quote,
        startOffset: 0,
        endOffset: citation.quote.length,
      }
    : null;
}

export interface DeliveryStudioRehearsalManifestMapping {
  readonly fieldLabel: string;
  readonly rationale: string;
}

export interface DeliveryStudioRehearsalManifestFile {
  readonly filename: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly mappings: readonly DeliveryStudioRehearsalManifestMapping[];
}

export function deliveryStudioRehearsalManifestTitle(
  packageVersionId: string,
): string {
  return `BidBox Delivery Studio package manifest ${packageVersionId}`;
}

export function deliveryStudioRehearsalManifestOrigin(
  packageId: string,
  packageVersionId: string,
): string {
  return `bidbox://delivery-studio/packages/${packageId}/versions/${packageVersionId}/manifest`;
}

/**
 * Canonical cited text for package-file facts and named-reviewed mappings.
 * Callers must still bind every file to the current persisted manifest.
 */
export function buildDeliveryStudioRehearsalManifestText(input: {
  readonly packageId: string;
  readonly packageVersionId: string;
  readonly files: readonly DeliveryStudioRehearsalManifestFile[];
}): string {
  const lines = [
    "BidBox Delivery Studio package manifest",
    `Package ID: ${input.packageId}`,
    `Package version ID: ${input.packageVersionId}`,
  ];
  const files = [...input.files].sort((left, right) =>
    left.filename.localeCompare(right.filename),
  );
  for (const file of files) {
    lines.push(
      "",
      `File: ${file.filename}`,
      `Size: ${file.sizeBytes} bytes`,
      `SHA-256: ${file.sha256}`,
    );
    const mappings = [...file.mappings].sort(
      (left, right) =>
        left.fieldLabel.localeCompare(right.fieldLabel) ||
        left.rationale.localeCompare(right.rationale),
    );
    for (const mapping of mappings) {
      lines.push(
        `Mapping: ${file.filename} assigned to ${mapping.fieldLabel}. ${mapping.rationale}`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

export interface DeliveryStudioScope {
  readonly organisationId: string;
  readonly actorUserId: string;
  readonly actorName: string;
  readonly membershipId: string;
}

export interface ResponseCitationInput {
  readonly documentId: string;
  readonly documentVersionId: string;
  readonly pageNumber: number;
  readonly quote: string;
  readonly startOffset?: number;
  readonly endOffset?: number;
}

export interface ResponseClaimInput {
  readonly claimKey: string;
  readonly text: string;
  readonly kind: "factual" | "instructional" | "opinion";
  readonly supportMode?: "exact_quote" | "paraphrase";
  readonly citations: readonly ResponseCitationInput[];
}

export interface SaveResponseAction {
  readonly action: "save_response";
  readonly sectionKey: string;
  readonly title: string;
  readonly content: string;
  readonly changeSummary?: string;
  readonly claims: readonly ResponseClaimInput[];
}

export interface ReviewResponseClaimAction {
  readonly action: "review_response_claim";
  readonly claimId: string;
  readonly decision: "accepted" | "rejected" | "needs_changes";
  readonly note: string;
}

export interface RedTeamFindingInput {
  readonly category: string;
  readonly severity: "fatal" | "likely_fatal" | "scoring_risk" | "cosmetic";
  readonly finding: string;
  readonly objectType?: string;
  readonly objectId?: string;
}

export interface StartRedTeamAction {
  readonly action: "start_red_team";
  readonly policyVersion: string;
  readonly findings: readonly RedTeamFindingInput[];
}

export interface ResolveRedTeamFindingAction {
  readonly action: "resolve_red_team_finding";
  readonly runId: string;
  readonly findingId: string;
  readonly resolution: string;
}

export interface ApproveRedTeamAction {
  readonly action: "approve_red_team";
  readonly runId: string;
  readonly attestation: string;
}

export interface AssemblePackageAction {
  readonly action: "assemble_package";
  readonly packageType: "submission";
}

export interface RehearseSubmissionAction {
  readonly action: "rehearse_submission";
  readonly packageVersionId: string;
  readonly rehearsal: PortalSubmissionRehearsalInput;
}

export type DeliveryStudioAction =
  | SaveResponseAction
  | ReviewResponseClaimAction
  | StartRedTeamAction
  | ResolveRedTeamFindingAction
  | ApproveRedTeamAction
  | AssemblePackageAction
  | RehearseSubmissionAction;

export type ResponseStudioStatus =
  | "empty"
  | "draft"
  | "review_required"
  | "ready";
export type RedTeamReviewStatus =
  | "not_started"
  | "running"
  | "findings_open"
  | "ready_for_approval"
  | "approved"
  | "stale";
export type PackageAssemblyStatus = "not_started" | "draft" | "ready" | "stale";
export type SubmissionRehearsalStatus =
  | "not_started"
  | "blocked"
  | "incomplete"
  | "review_required"
  | "rehearsal_ready"
  | "stale";

export interface DeliveryStudioCitation {
  readonly id: string;
  readonly documentVersionId: string | null;
  readonly evidenceCitation: string;
  readonly evidenceHash: string;
}

export interface DeliveryStudioClaim {
  readonly id: string;
  readonly claimKey: string;
  readonly text: string;
  readonly kind: string;
  readonly supportMode: "exact_quote" | "paraphrase" | null;
  readonly groundingStatus: string;
  readonly reviewerUserId: string | null;
  readonly citations: readonly DeliveryStudioCitation[];
}

export interface DeliveryStudioSection {
  readonly id: string;
  readonly sectionKey: string;
  readonly title: string;
  readonly status: string;
  readonly currentVersionNumber: number;
  readonly version: {
    readonly id: string;
    readonly content: string;
    readonly contentHash: string;
    readonly authorUserId: string | null;
    readonly claims: readonly DeliveryStudioClaim[];
  } | null;
}

export interface DeliveryStudioRedTeamRun {
  readonly id: string;
  readonly status: string;
  readonly sourceSnapshotHash: string;
  readonly policyVersion: string;
  readonly initiatedByUserId: string | null;
  readonly approvedByUserId: string | null;
  readonly approvedAt: string | null;
  readonly approvalAttestation: string | null;
  readonly createdAt: string;
  readonly findings: readonly {
    readonly id: string;
    readonly category: string;
    readonly severity: string;
    readonly finding: string;
    readonly status: string;
    readonly resolution: string | null;
    readonly resolvedByUserId: string | null;
    readonly resolvedAt: string | null;
    readonly version: number;
  }[];
}

export interface DeliveryStudioPackage {
  readonly id: string;
  readonly status: string;
  readonly versionId: string;
  readonly versionNumber: number;
  readonly sourceSnapshotHash: string;
  readonly manifestHash: string;
  readonly renderQaStatus: string;
  readonly manifestItems: readonly {
    readonly id: string;
    readonly ordinal: number;
    readonly itemType: string;
    readonly sourceObjectId: string | null;
    readonly sourceVersion: number | null;
    readonly filename: string;
    readonly sha256: string;
    readonly sizeBytes: number;
  }[];
}

export interface DeliveryStudioRehearsalReceipt {
  readonly id: string;
  readonly packageVersionId: string;
  readonly status: Exclude<SubmissionRehearsalStatus, "not_started" | "stale">;
  readonly rehearsalId: string;
  readonly readyForOperatorRehearsal: boolean;
  readonly reviewerUserId: string;
  readonly completedAt: string;
  readonly issues: readonly {
    readonly code: string;
    readonly severity: "blocker" | "warning";
    readonly message: string;
  }[];
}

export interface DeliveryStudioEnvelope {
  readonly authorityNote: string;
  readonly generatedAt: string;
  readonly version: number;
  readonly project: {
    readonly id: string;
    readonly title: string;
    readonly status: string;
    readonly deadline: string | null;
  };
  readonly sourceSnapshotHash: string;
  readonly responseStudio: {
    readonly status: ResponseStudioStatus;
    readonly sectionCount: number;
    readonly claimCount: number;
    readonly groundedClaimCount: number;
    readonly placeholderCount: number;
    readonly sections: readonly DeliveryStudioSection[];
  };
  readonly redTeamReview: {
    readonly status: RedTeamReviewStatus;
    readonly dueAt: string | null;
    readonly run: DeliveryStudioRedTeamRun | null;
  };
  readonly packageAssembly: {
    readonly status: PackageAssemblyStatus;
    readonly package: DeliveryStudioPackage | null;
  };
  readonly submissionRehearsal: {
    readonly status: SubmissionRehearsalStatus;
    readonly receipt: DeliveryStudioRehearsalReceipt | null;
  };
  readonly safety: typeof DELIVERY_STUDIO_SAFETY;
}

export type DeliveryStudioRepositorySnapshot = Omit<
  DeliveryStudioEnvelope,
  "authorityNote" | "generatedAt" | "safety"
>;

export interface PortfolioIntelligenceEnvelope {
  readonly generatedAt: string;
  readonly authorityNote: string;
  readonly totals: {
    readonly projectCount: number;
    readonly responseReadyCount: number;
    readonly redTeamApprovedCount: number;
    readonly packageReadyCount: number;
    readonly rehearsalReadyCount: number;
    readonly confirmedOutcomeCount: number;
  };
  readonly projects: readonly {
    readonly id: string;
    readonly title: string;
    readonly status: string;
    readonly deadline: string | null;
    readonly responseStatus: ResponseStudioStatus;
    readonly redTeamStatus: RedTeamReviewStatus;
    readonly packageStatus: PackageAssemblyStatus;
    readonly rehearsalStatus: SubmissionRehearsalStatus;
    readonly nextAction: string;
  }[];
  readonly limitations: readonly string[];
}

export type PortfolioRepositorySnapshot = Omit<
  PortfolioIntelligenceEnvelope,
  "generatedAt" | "authorityNote" | "limitations"
>;

export interface DeliveryStudioDerivedAction {
  readonly responseValidation?: CitationFirstResponseValidation;
  readonly normalizedRehearsal?: PortalSubmissionRehearsalInput;
  readonly rehearsalResult?: PortalSubmissionRehearsalResult;
}

export interface DeliveryStudioMutationInput {
  readonly scope: DeliveryStudioScope;
  readonly projectId: string;
  readonly data: DeliveryStudioAction;
  readonly ifMatch: number;
  readonly idempotencyKey: string;
  readonly occurredAt: string;
  readonly derived: DeliveryStudioDerivedAction;
}

export interface DeliveryStudioMutationRecord {
  readonly outcome: "recorded" | "replayed";
  readonly receiptId: string;
}

export interface DeliveryStudioMutationResponse {
  readonly projectId: string;
  readonly action: DeliveryStudioAction["action"];
  readonly outcome: "recorded" | "replayed";
  readonly receiptId: string;
  readonly data: DeliveryStudioEnvelope;
}

export interface DeliveryStudioRepository {
  load(
    scope: Pick<DeliveryStudioScope, "organisationId">,
    projectId: string,
  ): Promise<DeliveryStudioRepositorySnapshot | null>;
  prepareResponseValidation(
    scope: Pick<DeliveryStudioScope, "organisationId">,
    projectId: string,
    action: SaveResponseAction,
  ): Promise<
    Parameters<
      typeof import("../intelligence/boundedMvpResponseStudio").validateCitationFirstResponse
    >[0]
  >;
  mutate(
    input: DeliveryStudioMutationInput,
  ): Promise<DeliveryStudioMutationRecord>;
  portfolio(
    scope: Pick<DeliveryStudioScope, "organisationId">,
  ): Promise<PortfolioRepositorySnapshot>;
}

export type DeliveryStudioErrorCode =
  | "invalid_request"
  | "not_found"
  | "stale_version"
  | "idempotency_conflict"
  | "review_required"
  | "conflict";

export class DeliveryStudioError extends Error {
  constructor(
    readonly code: DeliveryStudioErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DeliveryStudioError";
  }
}
