export type LeadInboxStatus =
  | "new"
  | "qualified"
  | "not_a_fit"
  | "converted"
  | "conversion_proposed";

export type LeadInboxAction =
  | { action: "assign"; expectedVersion: number; assigneeUserId: string }
  | {
      action: "set_status";
      expectedVersion: number;
      status: "qualified" | "not_a_fit";
      reason: string;
    }
  | {
      action: "set_status";
      expectedVersion: number;
      status: "converted";
      reason: string;
      externalTargetReference: string;
      receiptSha256: string;
    }
  | { action: "set_sla"; expectedVersion: number; slaDueAt: string }
  | {
      action: "propose_conversion";
      expectedVersion: number;
      suggestedPursuitTitle: string;
      rationale: string;
    };

export interface LeadInboxItem {
  id: string;
  organisationId: string;
  leadReference: string;
  organisationLabel: string;
  tenderCategory: string;
  bidStage: string;
  receivedAt: string;
  tenderDeadline: string | null;
  assignedToUserId: string | null;
  status: LeadInboxStatus;
  slaDueAt: string | null;
  conversionProposal: {
    id: string;
    status: "pending_human_decision";
    proposedAt: string;
    proposedByUserId: string;
    suggestedPursuitTitle: string;
    rationale: string;
  } | null;
  latestStatusDecision: {
    status: "qualified" | "not_a_fit" | "converted";
    reason: string;
    decidedAt: string;
    decidedByUserId: string;
    externalTargetReference: string | null;
    receiptSha256: string | null;
  } | null;
  version: number;
  updatedAt: string;
}

export type LeadContactHandoffPurpose =
  | "initial_follow_up"
  | "qualification_call"
  | "conversion_handoff";

export interface LeadContactHandoff {
  leadId: string;
  contactName: string;
  preferredContactMethod: "email" | "telephone";
  contactValue: string;
  purpose: LeadContactHandoffPurpose;
  accessedAt: string;
  version: number;
}

export interface GrowthLeadContactHandoffResponse {
  handoff: LeadContactHandoff;
  contactDataIncluded: true;
  authorityNote: string;
}

export interface OnboardingJourney {
  policyVersion: string;
  derivedFromRoles: string[];
  checklist: Array<{
    id: string;
    title: string;
    purpose: string;
    practiceMarkerReceipt: string;
    /** @deprecated Compatibility-only neutral text. */
    completionEvidence: string;
  }>;
  syntheticTour: {
    dataClassification: "synthetic_non_customer";
    writesAuthoritativeState: false;
    title: string;
    steps: Array<{
      id: string;
      title: string;
      instruction: string;
      syntheticObjectReference: string;
    }>;
  };
}

export interface OnboardingProgress {
  journeyVersion: string;
  savedPracticeMarkerItemIds: string[];
  /** @deprecated Compatibility alias. */
  completedItemIds: string[];
  version: number;
}

export interface OnboardingProgressMutation {
  journeyVersion: string;
  itemId: string;
  expectedVersion: number;
  markerSaved: boolean;
}

export interface OfferCatalogueItem {
  sku: "bid_autopsy" | "assisted_bid" | "evidence_readiness_retainer";
  versionId: string;
  revision: number;
  title: string;
  summary: string;
  includedOutcomes: string[];
  excludedActions: string[];
  pricingMode: "human_quote_required";
  paymentMode: "external_manual_only";
  status: "active";
}

export interface QuoteProposal {
  id: string;
  organisationId: string;
  customerReference: string;
  offerVersionId: string;
  scopeSummary: string;
  currency: string;
  amountMinor: number;
  validUntil: string;
  status: "draft" | "approved";
  createdByUserId: string;
  approvedByUserId: string | null;
  approvedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface QuoteDraft {
  customerReference: string;
  offerVersionId: string;
  scopeSummary: string;
  currency: string;
  amountMinor: number;
  validUntil: string;
}

export interface GrowthOnboardingResponse {
  journey: OnboardingJourney;
  progress: OnboardingProgress;
  authorityNote: string;
}

export interface GrowthOnboardingMutationResponse {
  progress: OnboardingProgress;
  authorityNote: string;
}

export interface GrowthOffersResponse {
  catalogueVersion: string;
  items: OfferCatalogueItem[];
  authorityNote: string;
}

export interface GrowthLeadsResponse {
  items: LeadInboxItem[];
  count: number;
  contactDataIncluded: false;
  authorityNote: string;
}

export interface GrowthQuotesResponse {
  items: QuoteProposal[];
  count: number;
  authorityNote: string;
}
