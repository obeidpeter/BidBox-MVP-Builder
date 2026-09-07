export type OperationsRecordState = "ready" | "loading" | "error";

export interface OperationsSectionState {
  state?: OperationsRecordState;
  error?: string | null;
  readOnly?: boolean;
  onRetry?: () => void;
}

export type OpportunityStatus =
  | "needs_confirmation"
  | "deadline_missing"
  | "confirmed"
  | "duplicate"
  | "qualified"
  | "not_pursued"
  | "rejected";

export interface OpportunityRecord {
  id: string;
  title: string;
  buyer: string;
  reference: string;
  sourceType: "manual_url" | "forwarded_email" | "licensed_csv" | "ocds";
  sourceLabel: string;
  sourceUrl?: string | null;
  deadline: string | null;
  provenance: string;
  status: OpportunityStatus;
  duplicateOf?: string | null;
  confirmedByName?: string | null;
}

export type WorkItemStatus =
  | "backlog"
  | "ready"
  | "in_progress"
  | "blocked"
  | "in_review"
  | "done"
  | "cancelled";

export interface PursuitWorkItem {
  id: string;
  title: string;
  pursuitName: string;
  ownerName: string | null;
  assignedToCurrentUser: boolean;
  status: WorkItemStatus;
  dueAt: string | null;
  dependencyCount: number;
  linkedRequirementCount: number;
  evidenceCount: number;
  statusReason?: string | null;
  href?: string | null;
}

export type EvidenceRequestStatus =
  | "draft"
  | "shared_manually"
  | "response_recorded"
  | "requested"
  | "uploaded"
  | "accepted"
  | "changes_requested"
  | "overdue"
  | "closed";

export interface ClientEvidenceRequest {
  id: string;
  title: string;
  recipientName: string;
  status: EvidenceRequestStatus;
  dueAt: string | null;
  attestationRequired: boolean;
  uploadCount: number;
  priorRejectedResponseCount?: number;
  acceptedByName?: string | null;
  href?: string | null;
}

export type VisualQaStatus = "pass" | "warning" | "fail" | "not_run";

export interface VisualQaCheck {
  id: string;
  label: string;
  detail: string;
  status: VisualQaStatus;
}

export type SubmissionPackageStatus =
  | "draft"
  | "frozen"
  | "copies_prepared"
  | "sealed"
  | "dispatched"
  | "receipt_recorded"
  | "cancelled"
  | "qa_only";

export interface SubmissionPackageRecord {
  id: string;
  name: string;
  version: string;
  sha256: string | null;
  status: SubmissionPackageStatus;
  copyCount: number;
  deliveryMethod:
    | "portal"
    | "courier"
    | "hand_delivery"
    | "email"
    | "other"
    | "not_recorded";
  deliveryMethodLabel?: string | null;
  qaChecks: readonly VisualQaCheck[];
  receiptHash?: string | null;
  statusReason?: string | null;
  previewHref?: string | null;
}

export type CredentialCheckStatus =
  | "unverified"
  | "verified"
  | "not_verified"
  | "failed"
  | "inconclusive"
  | "expired";

export interface CredentialCheckRecord {
  id: string;
  credentialName: string;
  issuerName: string;
  reference: string;
  vaultItemVersion?: number;
  documentHash?: string | null;
  status: CredentialCheckStatus;
  officialUrl?: string | null;
  checkedAt?: string | null;
  checkedByName?: string | null;
  receiptHash?: string | null;
}

export type MissionEventType = "pre_bid" | "site_visit";
export type MissionProofStatus = "missing" | "recorded" | "accepted";
export type MissionEventStatus =
  | "planned"
  | "attended"
  | "missed"
  | "completed"
  | "cancelled";

export interface PursuitMissionEvent {
  id: string;
  title: string;
  type: MissionEventType;
  status: MissionEventStatus;
  required: boolean;
  startsAt: string | null;
  location: string;
  delegateName: string | null;
  authorityConfirmed: boolean;
  proofStatus: MissionProofStatus;
  checklist: readonly string[];
  statusReason?: string | null;
  href?: string | null;
}

export type ObligationStatus =
  | "open"
  | "upcoming"
  | "due"
  | "overdue"
  | "submitted"
  | "accepted"
  | "disputed"
  | "in_progress"
  | "satisfied"
  | "cancelled";

export interface PostAwardObligation {
  id: string;
  title: string;
  contractName: string;
  category:
    | "obligation"
    | "deliverable"
    | "payment"
    | "payment_milestone"
    | "notice"
    | "variation"
    | "completion_record";
  ownerName: string | null;
  dueAt: string | null;
  status: ObligationStatus;
  evidenceCount: number;
  amountLabel?: string | null;
  statusReason?: string | null;
  href?: string | null;
}

export interface MobileReviewItem {
  id: string;
  title: string;
  kind: "work" | "evidence" | "receipt" | "event";
  statusLabel: string;
  dueLabel: string;
  restrictedContent: boolean;
  href?: string | null;
}

export interface OperationsSuiteSnapshot {
  generatedAt: string | null;
  opportunities: readonly OpportunityRecord[];
  workItems: readonly PursuitWorkItem[];
  evidenceRequests: readonly ClientEvidenceRequest[];
  submissionPackages: readonly SubmissionPackageRecord[];
  credentialChecks: readonly CredentialCheckRecord[];
  missionEvents: readonly PursuitMissionEvent[];
  obligations: readonly PostAwardObligation[];
  mobileReviewItems: readonly MobileReviewItem[];
}

export type OperationsSuiteLoadState =
  | { status: "loading" }
  | { status: "error"; message: string; retry?: () => void }
  | { status: "ready"; snapshot: OperationsSuiteSnapshot };

export interface OperationsSuiteActions {
  onStartOpportunityIntake?: () => void;
  onConfirmOpportunity?: (opportunityId: string) => void;
  onChangeWorkStatus?: (workItemId: string, status: WorkItemStatus) => void;
  onIssueEvidenceRequest?: (requestId: string) => void;
  onAcceptEvidence?: (requestId: string) => void;
  onRequestEvidenceChanges?: (requestId: string) => void;
  onFreezeSubmissionPackage?: (packageId: string) => void;
  onRecordSubmissionReceipt?: (packageId: string) => void;
  onRecordCredentialCheck?: (credentialId: string) => void;
  onAssignEventDelegate?: (eventId: string) => void;
  onRecordEventProof?: (eventId: string) => void;
  onRecordObligationDelivery?: (obligationId: string) => void;
  onAddObligationEvidence?: (obligationId: string) => void;
  onOpenMobileReview?: (reviewId: string) => void;
  onCaptureMobileReceipt?: (reviewId: string) => void;
}

export const EMPTY_OPERATIONS_SUITE_SNAPSHOT: OperationsSuiteSnapshot = {
  generatedAt: null,
  opportunities: [],
  workItems: [],
  evidenceRequests: [],
  submissionPackages: [],
  credentialChecks: [],
  missionEvents: [],
  obligations: [],
  mobileReviewItems: [],
};
