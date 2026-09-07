export const AI_SHADOW_COHORTS = [
  "representative",
  "fatal_requirement",
  "abstention",
  "ocr_table",
  "injection",
  "tenant_isolation",
  "cost_latency",
] as const;

export const AI_SHADOW_CAPABILITIES = [
  "extract_pdf_multimodal",
  "extract_requirements",
  "map_evidence",
  "suggest_defects",
  "responsiveness_review",
] as const;

export type AiShadowCohort = (typeof AI_SHADOW_COHORTS)[number];
export type AiShadowCapability = (typeof AI_SHADOW_CAPABILITIES)[number];

export interface AiShadowPlanView {
  id: string;
  organisationId: string;
  capabilityId: AiShadowCapability;
  title: string;
  purpose: string;
  status: "active" | "closed";
  version: number;
  expectedCaseCount: number;
  expiresAt: string;
  createdByName: string;
  createdAt: string;
  closedByName: string | null;
  evaluationRecommendation:
    | "not_evaluated"
    | "blocked"
    | "eligible_for_governance_review";
  customerVisible: false;
  productionActivationGranted: false;
}

export interface AiShadowPlanSnapshot {
  plan: AiShadowPlanView;
  observationCount: number;
  coveredCohorts: AiShadowCohort[];
  blockers: string[];
}

export interface AiShadowSnapshot {
  generatedAt: string;
  plans: AiShadowPlanSnapshot[];
  authority: {
    runtimeConnected: true;
    modelExecutionConnected: false;
    providerDisclosureAllowed: false;
    rawOutputPersistenceAllowed: false;
    customerVisible: false;
    productionActivationGranted: false;
    authority: "named_human_governance_review_required";
  };
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const plain = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

export function adaptAiShadowSnapshot(
  value: unknown,
  organisationId: string,
): AiShadowSnapshot {
  if (
    !plain(value) ||
    typeof value.generatedAt !== "string" ||
    !Array.isArray(value.plans) ||
    value.plans.length > 25 ||
    !plain(value.authority) ||
    value.authority.runtimeConnected !== true ||
    value.authority.modelExecutionConnected !== false ||
    value.authority.providerDisclosureAllowed !== false ||
    value.authority.rawOutputPersistenceAllowed !== false ||
    value.authority.customerVisible !== false ||
    value.authority.productionActivationGranted !== false ||
    value.authority.authority !== "named_human_governance_review_required"
  ) {
    throw new Error("AI shadow programme response is not trusted");
  }
  const plans = value.plans.map((item): AiShadowPlanSnapshot => {
    if (
      !plain(item) ||
      !plain(item.plan) ||
      !UUID.test(String(item.plan.id)) ||
      item.plan.organisationId !== organisationId ||
      typeof item.plan.title !== "string" ||
      typeof item.plan.purpose !== "string" ||
      !AI_SHADOW_CAPABILITIES.includes(
        item.plan.capabilityId as AiShadowCapability,
      ) ||
      (item.plan.status !== "active" && item.plan.status !== "closed") ||
      !Number.isSafeInteger(item.plan.version) ||
      !Number.isSafeInteger(item.plan.expectedCaseCount) ||
      typeof item.plan.expiresAt !== "string" ||
      typeof item.plan.createdByName !== "string" ||
      typeof item.plan.createdAt !== "string" ||
      !(
        item.plan.closedByName === null ||
        typeof item.plan.closedByName === "string"
      ) ||
      !["not_evaluated", "blocked", "eligible_for_governance_review"].includes(
        String(item.plan.evaluationRecommendation),
      ) ||
      item.plan.customerVisible !== false ||
      item.plan.productionActivationGranted !== false ||
      !Number.isSafeInteger(item.observationCount) ||
      !Array.isArray(item.coveredCohorts) ||
      !item.coveredCohorts.every((cohort) =>
        AI_SHADOW_COHORTS.includes(cohort as AiShadowCohort),
      ) ||
      !Array.isArray(item.blockers) ||
      !item.blockers.every((blocker) => typeof blocker === "string")
    ) {
      throw new Error("AI shadow plan response is not trusted");
    }
    return item as unknown as AiShadowPlanSnapshot;
  });
  return {
    generatedAt: value.generatedAt,
    plans,
    authority: value.authority,
  } as AiShadowSnapshot;
}
