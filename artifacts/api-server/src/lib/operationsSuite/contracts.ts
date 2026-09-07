/**
 * Bounded contracts for BidBox's pursuit operations suite.
 *
 * These records are deliberately coordination records. They never fetch an
 * opportunity, contact a client/issuer, verify a credential, submit a bid or
 * move money. External actions are performed by a named person and recorded
 * afterwards with evidence hashes.
 */

export const OPERATIONS_RECORD_KINDS = [
  "opportunity_intake",
  "work_item",
  "evidence_request",
  "submission_war_room",
  "visual_qa_report",
  "credential_verification",
  "mission",
  "post_award_item",
] as const;

export type OperationsRecordKind = (typeof OPERATIONS_RECORD_KINDS)[number];

export interface OperationsScope {
  organisationId: string;
  projectId: string;
  actorUserId: string;
}

export interface OperationsRecordBase<K extends OperationsRecordKind> {
  id: string;
  kind: K;
  organisationId: string;
  projectId: string;
  version: number;
  createdByUserId: string;
  updatedByUserId: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * An append-only explanation for a consequential status transition. The
 * route audit intentionally remains content-free; this versioned record is
 * the authoritative home of the human-supplied reason.
 */
export interface OperationsStatusReason {
  id: string;
  fromStatus: string;
  toStatus: string;
  reason: string;
  recordedByUserId: string;
  recordedAt: string;
}

export type OpportunitySourceType =
  | "manual_url"
  | "forwarded_email"
  | "licensed_csv"
  | "ocds";

export interface OpportunitySourceInput {
  type: OpportunitySourceType;
  /** URL, message identifier, licensed dataset identifier or OCDS release ID. */
  locator: string;
  receivedAt: string;
  /** Required for any imported dataset; describes the recorded right to use it. */
  authorisationBasis?: string | null;
  /** Required for content-bearing sources. The service never retrieves content. */
  contentSha256?: string | null;
}

export interface CreateOpportunityIntakeInput {
  title: string;
  issuer: string;
  reference?: string | null;
  lot?: string | null;
  deadline?: string | null;
  source: OpportunitySourceInput;
}

export interface OpportunityIntakeRecord extends OperationsRecordBase<"opportunity_intake"> {
  title: string;
  issuer: string;
  reference: string | null;
  lot: string | null;
  source: Required<
    Omit<OpportunitySourceInput, "authorisationBasis" | "contentSha256">
  > & {
    authorisationBasis: string | null;
    contentSha256: string | null;
  };
  /** Server-derived from normalized identifying facts and source provenance. */
  dedupeKey: string;
  provenanceSha256: string;
  deadline: string | null;
  deadlineStatus: "unconfirmed" | "human_confirmed";
  deadlineConfirmedByUserId: string | null;
  deadlineConfirmedAt: string | null;
  status: "recorded" | "qualified" | "not_pursued";
}

export interface WorkObjectLinks {
  requirementIds: string[];
  evidenceItemIds: string[];
  packageIds: string[];
}

export type WorkItemStatus =
  | "backlog"
  | "ready"
  | "in_progress"
  | "blocked"
  | "in_review"
  | "done"
  | "cancelled";

export interface WorkItemComment {
  id: string;
  body: string;
  authorUserId: string;
  createdAt: string;
}

export interface WorkItemApproval {
  status: "not_required" | "pending" | "approved" | "rejected";
  decidedByUserId: string | null;
  decidedAt: string | null;
  reason: string | null;
}

export interface CreateWorkItemInput {
  title: string;
  description?: string | null;
  ownerUserId?: string | null;
  dueAt?: string | null;
  priority?: "low" | "normal" | "high" | "critical";
  links?: Partial<WorkObjectLinks>;
  dependsOnIds?: string[];
  approvalRequired?: boolean;
}

export interface WorkItemRecord extends OperationsRecordBase<"work_item"> {
  title: string;
  description: string | null;
  ownerUserId: string | null;
  dueAt: string | null;
  priority: "low" | "normal" | "high" | "critical";
  status: WorkItemStatus;
  links: WorkObjectLinks;
  dependsOnIds: string[];
  comments: WorkItemComment[];
  approval: WorkItemApproval;
  statusReasonHistory: OperationsStatusReason[];
}

export interface UpdateWorkItemInput {
  expectedVersion: number;
  title?: string;
  description?: string | null;
  ownerUserId?: string | null;
  dueAt?: string | null;
  priority?: WorkItemRecord["priority"];
  status?: WorkItemStatus;
  links?: Partial<WorkObjectLinks>;
  dependsOnIds?: string[];
  /** Required when status transitions to cancelled. */
  reason?: string;
}

export interface AddWorkItemCommentInput {
  expectedVersion: number;
  body: string;
}

export interface DecideWorkItemApprovalInput {
  expectedVersion: number;
  decision: "approved" | "rejected";
  reason: string;
}

export interface EvidenceRequestSlotInput {
  label: string;
  required: boolean;
  acceptedContentTypes?: string[];
}

export interface EvidenceSlotResponse {
  documentId: string;
  sha256: string;
  attestation: string;
  recordedByUserId: string;
  recordedAt: string;
}

export interface EvidenceSlotAcceptance {
  decision: "accepted" | "rejected";
  reason: string;
  decidedByUserId: string;
  decidedAt: string;
}

export interface EvidenceSlotResponseHistoryItem {
  response: EvidenceSlotResponse;
  acceptance: EvidenceSlotAcceptance;
}

export interface EvidenceRequestSlot {
  id: string;
  label: string;
  required: boolean;
  acceptedContentTypes: string[];
  response: EvidenceSlotResponse | null;
  acceptance: EvidenceSlotAcceptance | null;
  /** Immutable prior rejected attempts, oldest first. */
  responseHistory: EvidenceSlotResponseHistoryItem[];
}

export interface CreateEvidenceRequestInput {
  recipientLabel: string;
  dueAt?: string | null;
  requestMessage: string;
  slots: EvidenceRequestSlotInput[];
}

export interface EvidenceRequestRecord extends OperationsRecordBase<"evidence_request"> {
  recipientLabel: string;
  dueAt: string | null;
  requestMessage: string;
  deliveryMode: "manual_out_of_band";
  status:
    | "draft"
    | "shared_manually"
    | "response_recorded"
    | "accepted"
    | "closed";
  sharedByUserId: string | null;
  sharedAt: string | null;
  slots: EvidenceRequestSlot[];
  receiptSha256: string | null;
}

export interface RecordEvidenceResponseInput {
  expectedVersion: number;
  slotId: string;
  documentId: string;
  sha256: string;
  attestation: string;
}

export interface DecideEvidenceResponseInput {
  expectedVersion: number;
  slotId: string;
  decision: "accepted" | "rejected";
  reason: string;
}

export interface CreateSubmissionWarRoomInput {
  packageId: string;
  packageVersionId: string;
  manifestSha256: string;
  copyCount?: number;
  sealIdentifiers?: string[];
}

export type SubmissionWarRoomStatus =
  | "planning"
  | "frozen"
  | "copies_prepared"
  | "sealed"
  | "dispatched"
  | "receipt_recorded"
  | "cancelled";

export interface SubmissionWarRoomRecord extends OperationsRecordBase<"submission_war_room"> {
  packageId: string;
  packageVersionId: string;
  manifestSha256: string;
  copyCount: number;
  sealIdentifiers: string[];
  status: SubmissionWarRoomStatus;
  externalActionPolicy: "record_only";
  frozenByUserId: string | null;
  frozenAt: string | null;
  dispatchedByUserId: string | null;
  dispatchedAt: string | null;
  dispatchMethod: string | null;
  receiptSha256: string | null;
  receiptRecordedByUserId: string | null;
  receiptRecordedAt: string | null;
  statusReasonHistory: OperationsStatusReason[];
}

export interface AdvanceSubmissionWarRoomInput {
  expectedVersion: number;
  toStatus: Exclude<SubmissionWarRoomStatus, "planning">;
  /** Required only when recording an already completed human dispatch. */
  dispatchMethod?: string | null;
  receiptSha256?: string | null;
  reason?: string | null;
}

export interface VisualQaPageInput {
  pageNumber: number;
  textCharacterCount: number;
  nonWhitespacePixelRatio: number;
  clippedElementCount: number;
}

export interface VisualQaCrossReferenceInput {
  label: string;
  resolved: boolean;
}

export interface VisualQaSignatureInput {
  label: string;
  required: boolean;
  present: boolean;
}

export interface CreateVisualQaReportInput {
  packageVersionId: string;
  manifestSha256: string;
  expectedManifestSha256: string;
  pages: VisualQaPageInput[];
  crossReferences?: VisualQaCrossReferenceInput[];
  signatures?: VisualQaSignatureInput[];
}

export type VisualQaFindingCode =
  | "manifest_mismatch"
  | "unexpected_blank_page"
  | "clipped_content"
  | "broken_cross_reference"
  | "missing_signature";

export interface VisualQaFinding {
  code: VisualQaFindingCode;
  severity: "blocker" | "warning";
  message: string;
  pageNumber: number | null;
}

export interface VisualQaResult {
  algorithmVersion: "visual-qa-v1";
  status: "pass" | "review" | "fail";
  inputSha256: string;
  findings: VisualQaFinding[];
}

export interface VisualQaReportRecord extends OperationsRecordBase<"visual_qa_report"> {
  packageVersionId: string;
  manifestSha256: string;
  expectedManifestSha256: string;
  result: VisualQaResult;
}

export interface CreateCredentialVerificationInput {
  vaultItemId: string;
  vaultItemVersion: number;
  documentSha256: string;
  authorityName: string;
  officialSourceLocator: string;
  checkedAt: string;
  outcome: "verified" | "not_verified" | "inconclusive";
  receiptSha256: string;
  notes?: string | null;
}

export interface CredentialVerificationRecord extends OperationsRecordBase<"credential_verification"> {
  vaultItemId: string;
  vaultItemVersion: number;
  documentSha256: string;
  authorityName: string;
  officialSourceLocator: string;
  checkedAt: string;
  checkedByUserId: string;
  outcome: "verified" | "not_verified" | "inconclusive";
  receiptSha256: string;
  notes: string | null;
  verificationMode: "human_recorded";
}

export interface MissionChecklistItemInput {
  label: string;
  required: boolean;
}

export interface MissionChecklistItem extends MissionChecklistItemInput {
  id: string;
  completedByUserId: string | null;
  completedAt: string | null;
}

export interface MissionProof {
  documentId: string;
  sha256: string;
  recordedByUserId: string;
  recordedAt: string;
}

export interface CreateMissionInput {
  missionType: "pre_bid" | "site_visit";
  title: string;
  location: string;
  startsAt: string;
  attendanceRequired: boolean;
  delegateUserId?: string | null;
  delegateAuthorityNote?: string | null;
  checklist: MissionChecklistItemInput[];
}

export interface MissionRecord extends OperationsRecordBase<"mission"> {
  missionType: "pre_bid" | "site_visit";
  title: string;
  location: string;
  startsAt: string;
  attendanceRequired: boolean;
  delegateUserId: string | null;
  delegateAuthorityNote: string | null;
  checklist: MissionChecklistItem[];
  proofs: MissionProof[];
  followUpWorkItemIds: string[];
  status: "planned" | "attended" | "missed" | "completed" | "cancelled";
  statusReasonHistory: OperationsStatusReason[];
}

export interface UpdateMissionInput {
  expectedVersion: number;
  status?: MissionRecord["status"];
  completedChecklistItemId?: string;
  proofDocumentId?: string;
  proofSha256?: string;
  followUpWorkItemId?: string;
  reason?: string;
}

export type PostAwardCategory =
  | "obligation"
  | "deliverable"
  | "variation"
  | "payment_milestone"
  | "notice"
  | "completion_record";

export interface CreatePostAwardItemInput {
  category: PostAwardCategory;
  title: string;
  description?: string | null;
  dueAt?: string | null;
  ownerUserId?: string | null;
  sourceDocumentId?: string | null;
  evidenceDocumentIds?: string[];
  valueMinorUnits?: number | null;
  currency?: string | null;
}

export interface PostAwardItemRecord extends OperationsRecordBase<"post_award_item"> {
  category: PostAwardCategory;
  title: string;
  description: string | null;
  dueAt: string | null;
  ownerUserId: string | null;
  sourceDocumentId: string | null;
  evidenceDocumentIds: string[];
  valueMinorUnits: number | null;
  currency: string | null;
  status: "open" | "in_progress" | "satisfied" | "disputed" | "cancelled";
  completionReceiptSha256: string | null;
  completedByUserId: string | null;
  completedAt: string | null;
  statusReasonHistory: OperationsStatusReason[];
}

export interface UpdatePostAwardItemInput {
  expectedVersion: number;
  status?: PostAwardItemRecord["status"];
  ownerUserId?: string | null;
  dueAt?: string | null;
  evidenceDocumentIds?: string[];
  completionReceiptSha256?: string | null;
  reason?: string;
}

export type OperationsRecord =
  | OpportunityIntakeRecord
  | WorkItemRecord
  | EvidenceRequestRecord
  | SubmissionWarRoomRecord
  | VisualQaReportRecord
  | CredentialVerificationRecord
  | MissionRecord
  | PostAwardItemRecord;

export interface OperationsSuiteSnapshot {
  organisationId: string;
  projectId: string;
  records: OperationsRecord[];
  counts: Record<OperationsRecordKind, number>;
}

export type OperationsMobileQueueAction =
  | "continue_work"
  | "review_evidence_response"
  | "record_submission_receipt"
  | "prepare_mission";

/** Compact online-only projection. It deliberately excludes record bodies. */
export interface OperationsMobileQueueItem {
  id: string;
  recordId: string;
  subresourceId: string | null;
  kind: "work_item" | "evidence_request" | "submission_war_room" | "mission";
  status: string;
  label: string;
  dueAt: string | null;
  priority: WorkItemRecord["priority"] | null;
  action: OperationsMobileQueueAction;
  restrictedContent: true;
}

export interface OperationsMobileQueue {
  restrictedContent: true;
  maxItems: 250;
  items: OperationsMobileQueueItem[];
}

export const OPERATIONS_ENVELOPE_SCHEMA = "valo.operations-suite/v1" as const;
