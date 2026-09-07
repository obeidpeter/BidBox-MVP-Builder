import type { EligibilityPassportResult } from "./eligibilityPassport";
import type { RuleAdvisory } from "../jurisdictionRules";

export const TENDER_CONTEXT_POLICY_VERSION = "valo.tender-context/v1";
export const TENDER_ELIGIBILITY_POLICY_VERSION =
  "valo.tender-eligibility-passport/v1";

export const TENDER_CONTEXT_AUTHORITY_NOTE =
  "This is tender-specific decision support based only on the selected source versions. " +
  "It is not legal advice, compliance clearance, a responsiveness decision, submission approval, or an award prediction.";

export const TENDER_CONTEXT_SELECTION_FRESHNESS_NOTE =
  "These eligible options reflect this read only. The server rechecks current source, review, approval, and access authority when you submit.";

export const TENDER_CONTEXT_BOUNDS = Object.freeze({
  contextVersionsPerProject: 50,
  passportsPerProject: 100,
  requirementsPerContext: 500,
  artifactsPerContext: 500,
  primaryDocumentOptions: 100,
  rulePackOptions: 100,
  requirementOptions: 500,
  companyEvidenceOptions: 500,
  scopesPerContext: 100,
  legalEntityCharacters: 300,
  scopeCharacters: 120,
  evidenceKindCharacters: 120,
  citationCharacters: 20_000,
  reviewNoteCharacters: 5_000,
  reviewerNameCharacters: 200,
  sourceManifestCodeUnits: 200_000,
  sourceManifestBytes: 800_000,
  contextSnapshotCodeUnits: 500_000,
  contextSnapshotBytes: 2_000_000,
  ruleAdvisoriesCodeUnits: 200_000,
  ruleAdvisoriesBytes: 800_000,
  eligibilityResultCodeUnits: 1_000_000,
  eligibilityResultBytes: 4_000_000,
});

export interface TenderContextScope {
  readonly organisationId: string;
  readonly actorUserId: string;
  readonly actorName: string;
  readonly source: "membership" | "partner" | "break_glass";
  readonly membershipId: string | null;
}

export interface TenderRequirementBindingDraft {
  readonly requirementId: string;
  readonly requirementCitationId: string;
  readonly evidenceKind: string;
  readonly mandatory: boolean;
  readonly requiresCurrentOnSubmissionDate: boolean;
  readonly requiresExactLegalEntityMatch: boolean;
}

export interface TenderArtifactBindingDraft {
  readonly vaultItemVersionId: string;
  readonly evidenceKind: string;
  readonly legalEntityName?: string;
  readonly citation: {
    readonly startOffset: number;
    readonly endOffset: number;
    readonly quote: string;
  };
}

export interface TenderContextVersionDraft {
  readonly primaryDocumentVersionId: string;
  readonly jurisdictionRulePackId: string;
  readonly legalEntityName: string;
  readonly submissionDate: string;
  readonly jurisdiction: string;
  readonly entityScopes: readonly string[];
  readonly categoryScopes: readonly string[];
  readonly requirements: readonly TenderRequirementBindingDraft[];
  readonly artifacts: readonly TenderArtifactBindingDraft[];
}

export type TenderReviewDecision = "accepted" | "needs_changes" | "rejected";

export interface TenderReviewDraft {
  readonly decision: TenderReviewDecision;
  readonly note: string;
}

export interface TenderNamedReview {
  readonly state: "pending_review" | TenderReviewDecision;
  readonly reviewedByUserId: string | null;
  readonly reviewedByName: string | null;
  readonly reviewedAt: string | null;
  readonly note: string | null;
}

export interface TenderContextRequirementRecord {
  readonly requirementId: string;
  readonly requirementCitationId: string;
  readonly description: string;
  readonly evidenceKind: string;
  readonly mandatory: boolean;
  readonly requiresCurrentOnSubmissionDate: boolean;
  readonly requiresExactLegalEntityMatch: boolean;
}

export interface TenderContextArtifactRecord {
  readonly vaultItemVersionId: string;
  readonly documentVersionId: string;
  readonly documentVersionSha256: string;
  readonly label: string;
  readonly issuer: string;
  readonly evidenceKind: string;
  readonly legalEntityName: string | null;
  readonly validFrom: string | null;
  readonly validUntil: string | null;
  readonly citation: {
    readonly sourceVersionId: string;
    readonly contentSha256: string;
    readonly startOffset: number;
    readonly endOffset: number;
    readonly quote: string;
  };
}

export interface TenderContextVersionRecord {
  readonly id: string;
  readonly projectId: string;
  readonly versionNumber: number;
  readonly supersedesContextVersionId: string | null;
  readonly primaryDocumentVersionId: string;
  readonly jurisdictionRulePackId: string;
  readonly rulePackLabel: string;
  readonly legalEntityName: string;
  readonly submissionDate: string;
  readonly jurisdiction: string;
  readonly entityScopes: readonly string[];
  readonly categoryScopes: readonly string[];
  readonly sourceManifestSha256: string;
  readonly contextSha256: string;
  readonly status: "pending_review" | TenderReviewDecision | "superseded";
  readonly review: TenderNamedReview;
  readonly ruleAdvisories: readonly RuleAdvisory[];
  readonly requirements: readonly TenderContextRequirementRecord[];
  readonly artifacts: readonly TenderContextArtifactRecord[];
  readonly createdAt: string;
  readonly version: number;
}

export interface TenderEligibilityPassportRecord {
  readonly id: string;
  readonly projectId: string;
  readonly tenderContextVersionId: string;
  readonly passportId: string;
  readonly sourceManifestSha256: string;
  readonly resultSnapshotSha256: string;
  readonly resultStatus:
    | "blocked"
    | "incomplete"
    | "review_required"
    | "ready_for_human_tender_review";
  readonly eligibleForNamedTenderReview: boolean;
  readonly result: Omit<EligibilityPassportResult, "readyForSubmissionUse">;
  readonly review: TenderNamedReview;
  readonly createdAt: string;
  readonly version: number;
}

export interface TenderContextCentre {
  readonly policyVersion: typeof TENDER_CONTEXT_POLICY_VERSION;
  readonly eligibilityPolicyVersion: typeof TENDER_ELIGIBILITY_POLICY_VERSION;
  readonly authorityNote: typeof TENDER_CONTEXT_AUTHORITY_NOTE;
  readonly project: { readonly id: string; readonly title: string };
  readonly selectionOptions: {
    readonly freshnessNote: typeof TENDER_CONTEXT_SELECTION_FRESHNESS_NOTE;
    readonly primaryDocuments: readonly {
      readonly documentId: string;
      readonly documentVersionId: string;
      readonly filename: string;
      readonly versionNumber: number;
      readonly verifiedByName: string;
    }[];
    readonly rulePacks: readonly {
      readonly id: string;
      readonly label: string;
      readonly packKey: string;
      readonly version: string;
      readonly jurisdiction: string;
      readonly approvedByName: string;
    }[];
    readonly requirements: readonly {
      readonly requirementId: string;
      readonly requirementCitationId: string;
      readonly description: string;
      readonly sourceDocumentName: string;
      readonly sourceSnippet: string;
      readonly pageNumber: number | null;
      readonly paragraphRef: string | null;
      readonly suggestedEvidenceKind: string;
      readonly mandatoryByDefault: boolean;
      readonly reviewedByName: string;
    }[];
    readonly companyEvidence: readonly {
      readonly vaultItemVersionId: string;
      readonly sourceDocumentId: string;
      readonly documentVersionId: string;
      readonly versionNumber: number;
      readonly label: string;
      readonly issuer: string;
      readonly validFrom: string | null;
      readonly validUntil: string | null;
      readonly approvedByName: string;
    }[];
  };
  readonly contexts: readonly TenderContextVersionRecord[];
  readonly passports: readonly TenderEligibilityPassportRecord[];
}

export type TenderContextWriteResult<T> =
  | { readonly outcome: "created" | "updated"; readonly value: T }
  | {
      readonly outcome:
        | "not_found"
        | "conflict"
        | "version_conflict"
        | "state_conflict";
    };

export interface TenderContextRepository {
  readCentre(
    scope: TenderContextScope,
    projectId: string,
  ): Promise<TenderContextCentre | null>;
  createContext(
    scope: TenderContextScope,
    projectId: string,
    draft: TenderContextVersionDraft,
    now: Date,
  ): Promise<TenderContextWriteResult<TenderContextVersionRecord>>;
  reviewContext(
    scope: TenderContextScope,
    projectId: string,
    contextVersionId: string,
    expectedVersion: number,
    draft: TenderReviewDraft,
    now: Date,
  ): Promise<TenderContextWriteResult<TenderContextVersionRecord>>;
  createPassport(
    scope: TenderContextScope,
    projectId: string,
    contextVersionId: string,
    now: Date,
  ): Promise<TenderContextWriteResult<TenderEligibilityPassportRecord>>;
  reviewPassport(
    scope: TenderContextScope,
    projectId: string,
    passportRecordId: string,
    expectedVersion: number,
    draft: TenderReviewDraft,
    now: Date,
  ): Promise<TenderContextWriteResult<TenderEligibilityPassportRecord>>;
}

export class TenderContextRepositoryUnavailableError extends Error {
  constructor(message = "Tender context persistence is unavailable") {
    super(message);
    this.name = "TenderContextRepositoryUnavailableError";
  }
}
