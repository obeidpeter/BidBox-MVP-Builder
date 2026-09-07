/**
 * Pure readiness-gate logic for a project: given the current registers, emit
 * the ordered checklist a reviewer walks before sign-off/export/archive.
 *
 * Kept free of React/query concerns so the rules are unit-testable and stay
 * aligned with the server's deterministic gates:
 *  - payment mirrors `paymentGateSatisfied` (dual confirmation, not just a
 *    confirmed status),
 *  - defects mirror `blockingSignOffDefects` (only OPEN fatal/likely-fatal
 *    block; unconfirmed AI suggestions are advisory).
 */

export type ProjectTab =
  | "overview"
  | "documents"
  | "requirements"
  | "evidence"
  | "boq"
  | "defects"
  | "risk"
  | "reports"
  | "audit";

export type GateStatus = "pass" | "warning" | "blocked";

export interface GateCheck {
  id: string;
  label: string;
  detail: string;
  status: GateStatus;
  tab: ProjectTab;
  action: string;
  required?: boolean;
}

const MATERIAL_DEFECTS = new Set(["fatal", "likely_fatal"]);
const RESOLVED_EVIDENCE = new Set(["present", "not_applicable"]);
const REVIEWED_REQUIREMENTS = new Set(["confirmed", "edited", "pending"]);
const TERMINAL_STATUSES = new Set(["signed_off", "exported", "archived"]);

export interface ReadinessProject {
  status: string;
  reviewerName?: string | null;
  paymentStatus?: string | null;
  paymentConfirmedByFounder?: boolean;
  paymentConfirmedByAdvisor?: boolean;
  paymentFounderConfirmedByName?: string | null;
  paymentAdvisorConfirmedByName?: string | null;
  conflictStatus?: string | null;
  restrictedMode?: boolean | null;
  redactionScope?: string | null;
  physicalArchiveInstruction?: string | null;
  riskBand?: string | null;
}

export interface ReadinessInput {
  project: ReadinessProject;
  documents: Array<{
    type: string;
    redactionStatus: string;
    sha256?: string | null;
    extractionStatus?: string | null;
  }>;
  requirements: Array<{
    id: string;
    reviewStatus: string;
    isMandatory: boolean;
  }>;
  evidence: Array<{ requirementId: string; evidenceStatus: string }>;
  defects: Array<{ severity: string; status: string }>;
  boqChecks: Array<{ status: string }>;
  mandatoryRecall: number | null;
  hasRisk: boolean;
  computedRiskBand?: string | null;
  reports: Array<{ status: string }>;
}

function formatList(items: string[]) {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

function makeCheck(
  id: string,
  label: string,
  status: GateStatus,
  detail: string,
  tab: ProjectTab,
  action: string,
  required = true,
): GateCheck {
  return { id, label, status, detail, tab, action, required };
}

/**
 * Mirrors the server's paymentGateSatisfied for the fields the API exposes:
 * a confirmed status needs both legs flagged AND both identity stamps
 * present. A flag without an identity (legacy rows written before the
 * confirmation endpoint existed) does NOT satisfy the server gate, so it
 * must not read as satisfied here either.
 */
export function paymentGatePasses(project: ReadinessProject): boolean {
  if (!project.paymentStatus || project.paymentStatus === "not_required")
    return true;
  return (
    project.paymentStatus === "confirmed" &&
    project.paymentConfirmedByFounder === true &&
    project.paymentConfirmedByAdvisor === true &&
    !!project.paymentFounderConfirmedByName &&
    !!project.paymentAdvisorConfirmedByName
  );
}

/** A leg is a legacy confirmation when it is flagged but carries no identity stamp. */
export function hasLegacyPaymentLeg(project: ReadinessProject): boolean {
  return (
    (project.paymentConfirmedByFounder === true &&
      !project.paymentFounderConfirmedByName) ||
    (project.paymentConfirmedByAdvisor === true &&
      !project.paymentAdvisorConfirmedByName)
  );
}

export function computeReadinessChecks(input: ReadinessInput): GateCheck[] {
  const {
    project,
    documents,
    requirements,
    evidence,
    defects,
    boqChecks,
    reports,
  } = input;

  const tenderDocs = documents.filter((doc) => doc.type === "tender");
  const bidDocs = documents.filter((doc) => doc.type === "bid");
  const boqDocs = documents.filter((doc) => doc.type === "boq");
  const includedDocs = documents.filter(
    (doc) => doc.redactionStatus !== "excluded",
  );
  const hashlessDocs = documents.filter((doc) => !doc.sha256);
  const extractingDocs = includedDocs.filter(
    (doc) =>
      doc.extractionStatus === "pending" ||
      doc.extractionStatus === "extracting",
  );
  const extractedDocs = includedDocs.filter(
    (doc) => doc.extractionStatus === "extracted",
  );
  const failedExtractionDocs = includedDocs.filter(
    (doc) => doc.extractionStatus === "failed",
  );

  const unreviewedRequirements = requirements.filter(
    (req) => req.reviewStatus === "suggested",
  );
  const reviewedRequirements = requirements.filter((req) =>
    REVIEWED_REQUIREMENTS.has(req.reviewStatus),
  );
  const mandatoryRequirements = reviewedRequirements.filter(
    (req) => req.isMandatory,
  );
  const unresolvedMandatory = mandatoryRequirements.filter((req) => {
    const matches = evidence.filter((item) => item.requirementId === req.id);
    return (
      matches.length === 0 ||
      matches.some((item) => !RESOLVED_EVIDENCE.has(item.evidenceStatus))
    );
  });

  // Aligned with blockingSignOffDefects: only OPEN material defects block
  // sign-off. Suggested (unconfirmed AI) defects never block — they are a
  // review queue, surfaced as an advisory instead.
  const openMaterialDefects = defects.filter(
    (defect) =>
      defect.status === "open" && MATERIAL_DEFECTS.has(defect.severity),
  );
  const suggestedDefects = defects.filter(
    (defect) => defect.status === "suggested",
  );
  const flaggedBoqChecks = boqChecks.filter(
    (check) => check.status === "flagged",
  );
  const signedReports = reports.filter(
    (report) => report.status === "signed_off",
  );
  const draftReports = reports.filter((report) => report.status === "draft");

  const paymentPasses = paymentGatePasses(project);
  const legacyLeg = hasLegacyPaymentLeg(project);
  const awaitingDualConfirmation =
    project.paymentStatus === "confirmed" &&
    (!project.paymentConfirmedByFounder || !project.paymentConfirmedByAdvisor);

  return [
    makeCheck(
      "governance",
      "Payment and governance",
      !project.reviewerName || !paymentPasses ? "blocked" : "pass",
      !project.reviewerName
        ? "Assign a named reviewer before this project moves forward."
        : project.paymentStatus === "confirmed" && legacyLeg
          ? "A payment leg was confirmed without an identity stamp (legacy). Re-confirm each leg so the gate records who confirmed."
          : awaitingDualConfirmation
            ? "Payment needs dual confirmation by founder and advisor (two distinct people)."
            : project.paymentStatus === "pending"
              ? "Payment confirmation is still pending."
              : project.paymentStatus === "confirmed"
                ? "Payment is dual-confirmed and a named reviewer is assigned."
                : "No payment gate is required for this engagement.",
      "overview",
      "Open Governance",
    ),
    makeCheck(
      "conflict",
      "Conflict and restriction controls",
      project.conflictStatus === "blocked" ||
        project.conflictStatus === "declined"
        ? "blocked"
        : project.restrictedMode && !project.redactionScope
          ? "warning"
          : "pass",
      project.conflictStatus === "blocked" ||
        project.conflictStatus === "declined"
        ? "Conflict status blocks document intake and downstream review."
        : project.restrictedMode && !project.redactionScope
          ? "Restricted mode is enabled without a recorded redaction scope."
          : project.restrictedMode
            ? "Restricted mode has a recorded redaction scope."
            : "No active conflict blocker is recorded.",
      "overview",
      "Open Controls",
    ),
    makeCheck(
      "documents",
      "Tender and bid documents",
      tenderDocs.length === 0 || bidDocs.length === 0 || hashlessDocs.length > 0
        ? "blocked"
        : "pass",
      tenderDocs.length === 0 || bidDocs.length === 0
        ? `Missing ${formatList(
            [
              tenderDocs.length === 0 ? "tender document" : "",
              bidDocs.length === 0 ? "bid document" : "",
            ].filter(Boolean),
          )}.`
        : hashlessDocs.length > 0
          ? `${hashlessDocs.length} document${hashlessDocs.length === 1 ? "" : "s"} lack an intake SHA-256 manifest.`
          : "Tender and bid files are uploaded with SHA-256 intake manifests.",
      "documents",
      "Open Documents",
    ),
    makeCheck(
      "extraction",
      "Document extraction",
      includedDocs.length === 0 || extractingDocs.length > 0
        ? "blocked"
        : failedExtractionDocs.length > 0 || extractedDocs.length === 0
          ? "warning"
          : "pass",
      includedDocs.length === 0
        ? "Promote at least one document to included or redacted before extraction."
        : extractingDocs.length > 0
          ? `${extractingDocs.length} included document${extractingDocs.length === 1 ? "" : "s"} still extracting.`
          : failedExtractionDocs.length > 0
            ? `${failedExtractionDocs.length} included document${failedExtractionDocs.length === 1 ? "" : "s"} failed extraction.`
            : extractedDocs.length === 0
              ? "No included document has extracted text yet."
              : `${extractedDocs.length} included document${extractedDocs.length === 1 ? "" : "s"} have extracted text.`,
      "documents",
      "Review Extraction",
    ),
    makeCheck(
      "requirements",
      "Requirement review",
      requirements.length === 0 || unreviewedRequirements.length > 0
        ? "blocked"
        : "pass",
      requirements.length === 0
        ? "No requirement matrix exists yet."
        : unreviewedRequirements.length > 0
          ? `${unreviewedRequirements.length} AI suggestion${unreviewedRequirements.length === 1 ? "" : "s"} still need a reviewer ruling.`
          : `${reviewedRequirements.length} requirement${reviewedRequirements.length === 1 ? "" : "s"} have reviewer rulings.`,
      "requirements",
      "Review Requirements",
    ),
    makeCheck(
      "gate0",
      "Initial readiness",
      input.mandatoryRecall == null
        ? "warning"
        : input.mandatoryRecall >= 0.85
          ? "pass"
          : "warning",
      input.mandatoryRecall == null
        ? "The percentage of mandatory requirements found is not available until reviewers record their decisions."
        : `The system found ${(input.mandatoryRecall * 100).toFixed(1)}% of mandatory requirements after reviewer decisions, against the 85% target.`,
      "requirements",
      "Open readiness results",
      false,
    ),
    makeCheck(
      "evidence",
      "Mandatory evidence",
      mandatoryRequirements.length === 0 || unresolvedMandatory.length > 0
        ? "blocked"
        : "pass",
      mandatoryRequirements.length === 0
        ? "No reviewed mandatory requirements are available for evidence mapping."
        : unresolvedMandatory.length > 0
          ? `${unresolvedMandatory.length} mandatory requirement${unresolvedMandatory.length === 1 ? "" : "s"} lack resolved evidence.`
          : "Every reviewed mandatory requirement has resolved evidence.",
      "evidence",
      "Map Evidence",
    ),
    makeCheck(
      "boq",
      "BOQ check",
      boqDocs.length === 0
        ? "warning"
        : boqChecks.length === 0 || flaggedBoqChecks.length > 0
          ? "blocked"
          : "pass",
      boqDocs.length === 0
        ? "No BOQ document is marked for this project."
        : boqChecks.length === 0
          ? "A BOQ document exists, but no BOQ check has been run."
          : flaggedBoqChecks.length > 0
            ? `${flaggedBoqChecks.length} BOQ finding${flaggedBoqChecks.length === 1 ? "" : "s"} remain flagged.`
            : "BOQ checks have no active flags.",
      "boq",
      "Open BOQ",
    ),
    makeCheck(
      "defects",
      "Material defects",
      openMaterialDefects.length > 0
        ? "blocked"
        : suggestedDefects.length > 0
          ? "warning"
          : "pass",
      openMaterialDefects.length > 0
        ? `${openMaterialDefects.length} open fatal or likely-fatal defect${openMaterialDefects.length === 1 ? "" : "s"} must be resolved.`
        : suggestedDefects.length > 0
          ? `${suggestedDefects.length} suggested defect${suggestedDefects.length === 1 ? "" : "s"} still need reviewer action.`
          : "No open fatal or likely-fatal defects remain.",
      "defects",
      "Resolve Defects",
    ),
    makeCheck(
      "risk",
      "Risk assessment",
      input.hasRisk || project.riskBand ? "pass" : "blocked",
      input.hasRisk || project.riskBand
        ? `Current risk band is ${(input.computedRiskBand ?? project.riskBand ?? "").replace("_", " ")}.`
        : "Generate the deterministic risk assessment before reporting.",
      "risk",
      "Open Risk",
    ),
    makeCheck(
      "report",
      "Report sign-off",
      signedReports.length > 0 || TERMINAL_STATUSES.has(project.status)
        ? "pass"
        : draftReports.length > 0
          ? "blocked"
          : "warning",
      signedReports.length > 0 || TERMINAL_STATUSES.has(project.status)
        ? "A signed-off report is available."
        : draftReports.length > 0
          ? "A draft report exists and needs named-reviewer sign-off."
          : "No report has been generated yet.",
      "reports",
      signedReports.length > 0
        ? "Open Reports"
        : draftReports.length > 0
          ? "Sign Off Report"
          : "Generate Report",
    ),
    makeCheck(
      "export",
      "Export and archive",
      (signedReports.length > 0 || TERMINAL_STATUSES.has(project.status)) &&
        project.physicalArchiveInstruction
        ? "pass"
        : "blocked",
      !signedReports.length && !TERMINAL_STATUSES.has(project.status)
        ? "Export stays blocked until named-reviewer sign-off."
        : !project.physicalArchiveInstruction
          ? "Record physical archive instructions before ZIP export."
          : "Signed-off package is eligible for ZIP export.",
      (signedReports.length > 0 || TERMINAL_STATUSES.has(project.status)) &&
        !project.physicalArchiveInstruction
        ? "overview"
        : "reports",
      (signedReports.length > 0 || TERMINAL_STATUSES.has(project.status)) &&
        !project.physicalArchiveInstruction
        ? "Add Archive Note"
        : "Open Reports",
    ),
  ];
}

export interface ReadinessSummary {
  requiredTotal: number;
  passedRequired: number;
  blockedRequired: number;
  warningCount: number;
  progress: number;
  ready: boolean;
  nextCheck: GateCheck | undefined;
}

export type ReadinessAssessment =
  | { status: "not_checked" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; summary: ReadinessSummary };

export function summarizeReadiness(checks: GateCheck[]): ReadinessSummary {
  const requiredChecks = checks.filter((check) => check.required !== false);
  const passedRequired = requiredChecks.filter(
    (check) => check.status === "pass",
  ).length;
  const blockedRequired = requiredChecks.filter(
    (check) => check.status === "blocked",
  ).length;
  const warningCount = checks.filter(
    (check) => check.status === "warning",
  ).length;
  return {
    requiredTotal: requiredChecks.length,
    passedRequired,
    blockedRequired,
    warningCount,
    progress: Math.round((passedRequired / requiredChecks.length) * 100),
    ready: blockedRequired === 0,
    nextCheck:
      checks.find((check) => check.status === "blocked") ??
      checks.find((check) => check.status === "warning"),
  };
}
