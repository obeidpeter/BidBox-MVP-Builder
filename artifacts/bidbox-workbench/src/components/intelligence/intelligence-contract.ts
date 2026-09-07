export type IntelligenceCapabilityId =
  | "evidence_graph"
  | "addendum_radar"
  | "eligibility_passport"
  | "grounded_copilot"
  | "opportunity_radar"
  | "response_studio"
  | "submission_preflight"
  | "clarification_assistant"
  | "boq_sanity"
  | "award_handoff"
  | "evaluation_score_planner"
  | "bid_security_integrity"
  | "regulatory_watchtower"
  | "consortium_responsibility"
  | "portal_submission_rehearsal"
  | "commercial_exposure"
  | "nigerian_content_composer"
  | "personnel_tailoring"
  | "contract_deviation"
  | "critical_path_simulator"
  | "integrity_sentinel"
  | "outcome_learning";

export type IntelligenceDecisionLevel = 1 | 2;

export type IntelligenceCapabilityState =
  | "review_ready"
  | "partial"
  | "empty"
  | "restricted"
  | "production_disabled";

export interface IntelligenceCitation {
  id: string;
  sourceName: string;
  locator: string;
  excerpt?: string;
}

export interface IntelligenceCapabilitySnapshot {
  id: IntelligenceCapabilityId;
  state: IntelligenceCapabilityState;
  stateReason: string;
  summary?: string;
  reviewItemCount?: number | null;
  citationCount?: number | null;
  citations?: readonly IntelligenceCitation[];
  lastUpdatedAt?: string | null;
}

export interface IntelligenceEvidenceLayerSnapshot {
  policyVersion: string;
  disposition: "ready" | "abstain" | "blocked";
  requestedMode: "complete_corpus" | "verified_spans";
  actualMode: "complete_corpus" | "verified_spans";
  manifestSha256: string | null;
  versionSha256: string | null;
  sourceCount: number;
  rejectedCount: number;
  blockers: readonly { code: string; path: string }[];
  coverage: {
    visibleDocumentCount: number;
    redactionEligibleDocumentCount: number;
    safeCurrentDocumentCount: number;
    verifiedDocumentCount: number;
    fullyVerifiedDocumentCount: number;
  };
}

export type IntelligenceReviewStatus =
  | "pending"
  | "in_review"
  | "changes_requested"
  | "approved"
  | "rejected";

export type IntelligenceReviewPriority = "critical" | "high" | "normal" | "low";

export interface IntelligenceReviewInboxSnapshot {
  projectId: string;
  generatedAt: string;
  environment: "production" | "staging" | "development";
  productionAiEnabled: boolean;
  sourceVersion: number | null;
  sourceManifestSha256: string | null;
  readOnly: boolean;
  authorityNote: string;
  counts: Record<IntelligenceReviewStatus, number>;
  items: readonly {
    id: string;
    capabilityId: IntelligenceCapabilityId;
    title: string;
    summary: string;
    status: IntelligenceReviewStatus;
    priority: IntelligenceReviewPriority;
    reviewType: string;
    reviewerName: string | null;
    assignedToCurrentUser: boolean;
    dueAt: string | null;
    sourceCount: number;
    staleSource: boolean;
    href: string | null;
    sourceVersion: number;
    reviewVersion: number | null;
  }[];
}

export interface IntelligenceCentreSnapshot {
  environment: "production" | "staging" | "development";
  productionAiEnabled: boolean;
  restrictedMode: boolean;
  generatedAt: string | null;
  project?: {
    id: string;
    title: string;
    status: string;
    deadline: string | null;
  };
  capabilities: readonly IntelligenceCapabilitySnapshot[];
  evidenceLayer?: IntelligenceEvidenceLayerSnapshot;
  reviewInbox?: IntelligenceReviewInboxSnapshot;
}

export type IntelligenceCentreLoadState =
  | { status: "loading" }
  | {
      status: "error";
      message: string;
      retry?: () => void;
    }
  | {
      status: "ready";
      snapshot: IntelligenceCentreSnapshot;
    };

export interface IntelligenceCapabilityDefinition {
  id: IntelligenceCapabilityId;
  title: string;
  shortLabel: string;
  level: IntelligenceDecisionLevel;
  description: string;
  humanControl: string;
  evidenceBasis: string;
}

export const INTELLIGENCE_CAPABILITY_CATALOG: readonly IntelligenceCapabilityDefinition[] =
  [
    {
      id: "evidence_graph",
      title: "Evidence links",
      shortLabel: "Evidence links",
      level: 2,
      description:
        "Links reviewed requirements to source quotes, approved evidence and reusable capability claims.",
      humanControl:
        "A named reviewer checks every source quote and decides whether each proposed link applies.",
      evidenceBasis:
        "Versioned tender documents, requirement references, confirmed evidence and approved capability records.",
    },
    {
      id: "addendum_radar",
      title: "Addendum and deadline changes",
      shortLabel: "Addendum changes",
      level: 2,
      description:
        "Compares source versions and flags requirements, deadlines, BOQ checks and approvals that may be out of date.",
      humanControl:
        "A reviewer compares both current versions and confirms each impact before work is reopened.",
      evidenceBasis:
        "Versioned tender and addendum documents with timestamps, fingerprints and changed passages.",
    },
    {
      id: "eligibility_passport",
      title: "Tender eligibility check",
      shortLabel: "Eligibility check",
      level: 1,
      description:
        "Shows tender-specific eligibility coverage and expiring company evidence without inventing a universal checklist.",
      humanControl:
        "Client owners verify applicability, dates, issuing authority and remediation ownership for every item.",
      evidenceBasis:
        "Reviewed tender clauses, approved evidence versions and verified capability evidence.",
    },
    {
      id: "grounded_copilot",
      title: "Tender evidence assistant",
      shortLabel: "Evidence assistant",
      level: 1,
      description:
        "Drafts answers from accepted facts and stops when an approved source quote cannot support the question.",
      humanControl:
        "Users inspect the cited source before relying on an answer or copying it into work product.",
      evidenceBasis:
        "Selected tender, addendum, approved evidence and current SBD versions only.",
    },
    {
      id: "opportunity_radar",
      title: "Opportunity review",
      shortLabel: "Opportunity review",
      level: 1,
      description:
        "Ranks recorded opportunities against stated capability, location, lot, deadline and capacity criteria.",
      humanControl:
        "Business-development leaders decide bid or no-bid; the system never predicts an award or implies evaluator influence.",
      evidenceBasis:
        "Recorded opportunities, approved capability facts and current workload data.",
    },
    {
      id: "response_studio",
      title: "Evidence-linked response drafts",
      shortLabel: "Response drafts",
      level: 2,
      description:
        "Checks editable response drafts so every factual claim links to approved, current evidence.",
      humanControl:
        "Named authors and reviewers edit, accept or reject every draft claim before report or package sign-off.",
      evidenceBasis:
        "Reviewed requirements, approved capability versions, source quotes and versioned draft claims.",
    },
    {
      id: "submission_preflight",
      title: "Submission package checks",
      shortLabel: "Package checks",
      level: 1,
      description:
        "Runs rules-based release checks for source links, signatures, dates, BOQ issues, readiness and package history.",
      humanControl:
        "The named signatory makes the release decision; the system cannot mark a package submitted.",
      evidenceBasis:
        "Locked package contents, readiness rules, reviewer decisions and sign-off evidence.",
    },
    {
      id: "clarification_assistant",
      title: "Clarification question drafts",
      shortLabel: "Clarification drafts",
      level: 2,
      description:
        "Drafts questions linked to unclear, conflicting or unpriceable tender terms.",
      humanControl:
        "An authorised tender lead decides whether and how to send a question; Valo never sends it.",
      evidenceBasis:
        "Tender clauses, addenda, recorded conflicts and the confirmed clarification deadline.",
    },
    {
      id: "boq_sanity",
      title: "BOQ and commercial checks",
      shortLabel: "BOQ checks",
      level: 1,
      description:
        "Explains rules-based arithmetic, formula, unit, tax and unusual-value checks without selecting or changing a price.",
      humanControl:
        "Commercial reviewers resolve every exception and remain responsible for rates, assumptions and approvals.",
      evidenceBasis:
        "Uploaded BOQ values, formula lineage and an approved versioned rule pack.",
    },
    {
      id: "award_handoff",
      title: "Award-to-delivery handoff",
      shortLabel: "Delivery handoff",
      level: 2,
      description:
        "Drafts obligations, milestones, notices and evidence tasks from a recorded award or contract.",
      humanControl:
        "A contract or project manager accepts owners and dates; Valo never issues a notice or changes an external system.",
      evidenceBasis:
        "Client-confirmed outcome, signed contract or award source, approved submission and retained obligations.",
    },
    {
      id: "evaluation_score_planner",
      title: "Published evaluation plan",
      shortLabel: "Evaluation plan",
      level: 1,
      description:
        "Maps only published evaluation criteria, weights and supporting evidence without predicting evaluator behaviour or award probability.",
      humanControl:
        "A named bid reviewer confirms every criterion, score allocation and evidence mapping before it can guide the response plan.",
      evidenceBasis:
        "Published tender criteria, source quotes, accepted requirements and reviewed evidence links.",
    },
    {
      id: "bid_security_integrity",
      title: "Bid security and guarantee checks",
      shortLabel: "Security checks",
      level: 1,
      description:
        "Compares bid security terms with a verified instrument for amount, currency, beneficiary, wording, issuer and validity gaps.",
      humanControl:
        "Authorised legal, commercial and treasury reviewers decide remediation; Valo never instructs a bank or represents validity.",
      evidenceBasis:
        "Tender clauses, prescribed forms and versioned issued instruments with named review.",
    },
    {
      id: "regulatory_watchtower",
      title: "Regulatory change checks",
      shortLabel: "Regulatory changes",
      level: 1,
      description:
        "Shows how verified procurement or sector rule changes may affect pursuits and templates.",
      humanControl:
        "Compliance or legal owners approve source authority, interpretation and activation before any control or template changes.",
      evidenceBasis:
        "Versioned official rules, effective dates, changed passages and approved impact records.",
    },
    {
      id: "consortium_responsibility",
      title: "Consortium responsibilities",
      shortLabel: "Responsibilities",
      level: 2,
      description:
        "Proposes which organisation owns each eligibility, technical, commercial and signing obligation without treating credentials as transferable.",
      humanControl:
        "Authorised representatives accept each responsibility; Valo never binds a partner or edits consortium terms.",
      evidenceBasis:
        "Reviewed tender obligations, signed partner instruments, entity-specific evidence and named acceptance.",
    },
    {
      id: "portal_submission_rehearsal",
      title: "Portal submission practice",
      shortLabel: "Portal practice",
      level: 1,
      description:
        "Checks a locked package against approved portal fields, names, sizes and upload-order rules.",
      humanControl:
        "An authorised operator runs the real submission; Valo never logs in, clicks submit or acknowledges declarations.",
      evidenceBasis:
        "Frozen package hashes, versioned portal rules, rehearsal receipts and operator review.",
    },
    {
      id: "commercial_exposure",
      title: "Commercial cash-flow scenarios",
      shortLabel: "Cash-flow scenarios",
      level: 1,
      description:
        "Models rules-based scenarios for payment timing, retention, mobilisation, tax, bonds, foreign exchange and price adjustments.",
      humanControl:
        "Finance reviewers approve assumptions and decisions; Valo never selects a price, rate or financing commitment.",
      evidenceBasis:
        "Cited tender clauses, safe BOQ versions and explicitly reviewed scenario assumptions.",
    },
    {
      id: "nigerian_content_composer",
      title: "Nigerian-content plan evidence",
      shortLabel: "Content-plan evidence",
      level: 2,
      description:
        "Drafts plan lines from verified evidence about people, equipment, facilities, subcontracting and training.",
      humanControl:
        "Evidence owners confirm availability and every quantity or percentage before a plan line can be used.",
      evidenceBasis:
        "Tender-specific local-content clauses and current company evidence checked by a named reviewer.",
    },
    {
      id: "personnel_tailoring",
      title: "Past performance and key personnel",
      shortLabel: "People and experience",
      level: 2,
      description:
        "Suggests verified project and personnel facts that match the criteria while blocking unavailable people and unsupported claims.",
      humanControl:
        "HR, project and bid owners confirm that facts are current, people are available and selections are correct. Valo never embellishes credentials.",
      evidenceBasis:
        "Reviewed criteria, current CV and project evidence, source quotes and owner confirmations.",
    },
    {
      id: "contract_deviation",
      title: "Contract changes",
      shortLabel: "Contract changes",
      level: 1,
      description:
        "Compares tender, bid, clarification, award and draft-contract clauses to show changed, missing or new obligations.",
      humanControl:
        "Legal and commercial owners decide every issue; Valo never accepts terms or communicates a redline.",
      evidenceBasis:
        "Reviewed clauses from versioned documents at each contract stage.",
    },
    {
      id: "critical_path_simulator",
      title: "Pursuit schedule and capacity",
      shortLabel: "Schedule and capacity",
      level: 1,
      description:
        "Builds limited dependency and resource scenarios from accepted milestones and shows deadline or capacity conflicts.",
      humanControl:
        "Task owners confirm every owner and date change. The simulator never changes the approved plan.",
      evidenceBasis:
        "Source-backed milestones, accepted dependencies, capacity records and reviewed scenarios.",
    },
    {
      id: "integrity_sentinel",
      title: "Procurement integrity and conflicts",
      shortLabel: "Integrity and conflicts",
      level: 1,
      description:
        "Flags restricted issues for separation of duties, contact channels, relationships and overrides. These flags are never allegations.",
      humanControl:
        "Only authorised ethics or legal reviewers assess a signal; Valo makes no misconduct finding or external report.",
      evidenceBasis:
        "Organisation-specific audit history, declared relationships and confidential review by named people.",
    },
    {
      id: "outcome_learning",
      title: "Outcome lessons and repeat issues",
      shortLabel: "Outcome lessons",
      level: 2,
      description:
        "Suggests lessons for this organisation from client-confirmed outcomes and repeated documented issues. Confidential content is not used for training by default.",
      humanControl:
        "A governance owner approves each lesson, where it can be reused and how long it is kept. Reuse across organisations remains off.",
      evidenceBasis:
        "Client-confirmed outcomes, approved debrief sources, reviewed issues and approval for each lesson.",
    },
  ] as const;

export function createProductionDisabledIntelligenceSnapshot(): IntelligenceCentreSnapshot {
  return {
    environment: "production",
    productionAiEnabled: false,
    restrictedMode: false,
    generatedAt: null,
    evidenceLayer: {
      policyVersion: "unavailable",
      disposition: "blocked",
      requestedMode: "verified_spans",
      actualMode: "verified_spans",
      manifestSha256: null,
      versionSha256: null,
      sourceCount: 0,
      rejectedCount: 0,
      blockers: [{ code: "not_connected", path: "evidenceLayer" }],
      coverage: {
        visibleDocumentCount: 0,
        redactionEligibleDocumentCount: 0,
        safeCurrentDocumentCount: 0,
        verifiedDocumentCount: 0,
        fullyVerifiedDocumentCount: 0,
      },
    },
    reviewInbox: {
      projectId: "",
      generatedAt: new Date(0).toISOString(),
      environment: "production",
      productionAiEnabled: false,
      sourceVersion: null,
      sourceManifestSha256: null,
      readOnly: true,
      authorityNote:
        "No connected review source is available. No approval can be inferred.",
      counts: {
        pending: 0,
        in_review: 0,
        changes_requested: 0,
        approved: 0,
        rejected: 0,
      },
      items: [],
    },
    capabilities: INTELLIGENCE_CAPABILITY_CATALOG.map((capability) => ({
      id: capability.id,
      state: "production_disabled",
      stateReason:
        "No connected production evidence is available for this capability.",
      reviewItemCount: null,
      citationCount: null,
      citations: [],
      lastUpdatedAt: null,
    })),
  };
}
