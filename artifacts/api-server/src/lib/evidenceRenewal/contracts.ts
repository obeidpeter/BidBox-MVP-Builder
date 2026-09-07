export const EVIDENCE_RENEWAL_NAMESPACE = "[EVIDENCE-RENEWAL:" as const;
export const EVIDENCE_RENEWAL_LEDGER_SCHEMA =
  "valo.evidence-renewal-ledger/v1" as const;
export const EVIDENCE_RENEWAL_AUDIT_SCHEMA =
  "valo.evidence-renewal-audit-receipt/v1" as const;
export const EVIDENCE_RENEWAL_READ_PERMISSION = "evidence:read" as const;
export const EVIDENCE_RENEWAL_MANAGE_PERMISSION = "evidence:write" as const;
export const EVIDENCE_RENEWAL_VERIFY_PERMISSION = "evidence:approve" as const;

export const EVIDENCE_RENEWAL_BOUNDS = Object.freeze({
  plansPerProject: 100,
  eventsPerProject: 300,
  eventsPerPlan: 3,
  affectedPursuits: 25,
  authorities: 100,
  envelopeCodeUnits: 16_384,
  envelopeBytes: 32_768,
  snapshotBytes: 2_097_152,
  requestBodyBytes: 65_536,
  idempotencyKeyCharacters: 128,
});

export const EVIDENCE_RENEWAL_IMPACTS = [
  "blocked",
  "at_risk",
  "monitor",
] as const;
export type EvidenceRenewalImpact = (typeof EVIDENCE_RENEWAL_IMPACTS)[number];

export const EVIDENCE_RENEWAL_REVIEW_REASONS = [
  "replacement_verified",
  "incorrect_document",
  "expiry_unacceptable",
  "quality_issue",
] as const;
export type EvidenceRenewalReviewReason =
  (typeof EVIDENCE_RENEWAL_REVIEW_REASONS)[number];

export type EvidenceRenewalStatus =
  | "planned"
  | "replacement_staged"
  | "promoted"
  | "rejected";

export interface EvidenceRenewalScope {
  organisationId: string;
  projectId: string;
  actorUserId: string;
  actorMembershipId: string;
}

export interface EvidenceRenewalAffectedPursuitDraft {
  projectId: string;
  impact: EvidenceRenewalImpact;
}

export interface EvidenceRenewalCreateDraft {
  vaultItemId: string;
  ownerUserId: string;
  verifierUserId: string;
  targetDate: string;
  affectedPursuits: readonly EvidenceRenewalAffectedPursuitDraft[];
  idempotencyKey: string;
}

export interface EvidenceRenewalStageDraft {
  documentId: string;
  sha256: string;
  issueDate: string;
  expiryDate: string;
  idempotencyKey: string;
}

export interface EvidenceRenewalReviewDraft {
  decision: "approve" | "reject";
  reasonCode: EvidenceRenewalReviewReason;
  idempotencyKey: string;
}

export interface EvidenceRenewalReceipt {
  version: number;
  kind: "plan_created" | "replacement_staged" | "replacement_reviewed";
  occurredAt: string;
  actorUserId: string;
  sha256: string;
}

export interface EvidenceRenewalAuthorityAssignment {
  userId: string;
  name: string;
  current: boolean;
}

export interface EvidenceRenewalAffectedPursuit extends EvidenceRenewalAffectedPursuitDraft {
  title: string;
}

export interface EvidenceRenewalStagedReplacement {
  documentId: string;
  documentVersionId: string;
  documentVersionNumber: number;
  sha256: string;
  issueDate: string;
  expiryDate: string;
  expectedVaultItemVersion: number;
  stagedByUserId: string;
  stagedAt: string;
}

export interface EvidenceRenewalInternalReminder {
  channel: "bidbox_evidence_renewal_register";
  assignedOwnerUserId: string;
  dueAt: string;
  status: "open" | "resolved";
  recordedReceiptSha256: string;
  resolvedReceiptSha256: string | null;
  externalDeliveryReceipt: null;
}

export interface EvidenceRenewalPlan {
  id: string;
  organisationId: string;
  projectId: string;
  vaultItemId: string;
  artefactType: string;
  owner: EvidenceRenewalAuthorityAssignment;
  verifier: EvidenceRenewalAuthorityAssignment;
  targetDate: string;
  internalReminder: EvidenceRenewalInternalReminder;
  affectedPursuits: readonly EvidenceRenewalAffectedPursuit[];
  status: EvidenceRenewalStatus;
  version: number;
  stagedReplacement: EvidenceRenewalStagedReplacement | null;
  reviewReasonCode: EvidenceRenewalReviewReason | null;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  latestReceiptSha256: string;
  promotionReceiptSha256: string | null;
  receipts: readonly EvidenceRenewalReceipt[];
  externalMessageSent: false;
}

export interface EvidenceRenewalSnapshot {
  organisationId: string;
  projectId: string;
  generatedAt: string;
  items: readonly EvidenceRenewalPlan[];
  limit: 100;
  truncated: false;
  externalMessagingConnected: false;
  authorityNote: string;
}

export interface EvidenceRenewalAuthority {
  userId: string;
  name: string;
}

export interface EvidenceRenewalAuthorityList {
  organisationId: string;
  owners: readonly EvidenceRenewalAuthority[];
  verifiers: readonly EvidenceRenewalAuthority[];
  limit: 100;
  truncated: false;
}

export type EvidenceRenewalMutationOutcome =
  | { outcome: "created"; plan: EvidenceRenewalPlan; replayed: boolean }
  | { outcome: "updated"; plan: EvidenceRenewalPlan; replayed: boolean }
  | {
      outcome:
        | "not_found"
        | "version_conflict"
        | "state_conflict"
        | "authority_conflict"
        | "maker_checker_conflict"
        | "idempotency_conflict"
        | "evidence_conflict"
        | "vault_conflict"
        | "archived"
        | "capacity_exceeded";
    };

export interface EvidenceRenewalRepository {
  readSnapshot(
    scope: EvidenceRenewalScope,
    now: Date,
  ): Promise<EvidenceRenewalSnapshot>;
  listAuthorities(
    scope: EvidenceRenewalScope,
    now: Date,
  ): Promise<EvidenceRenewalAuthorityList>;
  createPlan(
    scope: EvidenceRenewalScope,
    draft: EvidenceRenewalCreateDraft,
    now: Date,
  ): Promise<EvidenceRenewalMutationOutcome>;
  stageReplacement(
    scope: EvidenceRenewalScope,
    planId: string,
    expectedVersion: number,
    draft: EvidenceRenewalStageDraft,
    now: Date,
  ): Promise<EvidenceRenewalMutationOutcome>;
  reviewReplacement(
    scope: EvidenceRenewalScope,
    planId: string,
    expectedVersion: number,
    draft: EvidenceRenewalReviewDraft,
    now: Date,
  ): Promise<EvidenceRenewalMutationOutcome>;
}

export class EvidenceRenewalUnavailableError extends Error {
  constructor(message = "Evidence renewal persistence is unavailable") {
    super(message);
    this.name = "EvidenceRenewalUnavailableError";
  }
}

export class EvidenceRenewalProjectAccessError extends Error {
  constructor(public readonly code: "not_found" | "archived") {
    super(code);
    this.name = "EvidenceRenewalProjectAccessError";
  }
}
