import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const RETENTION_COMPLETION_ACTIVATION_ENV =
  "VALO_RETENTION_COMPLETION_ENABLED" as const;
export const RETENTION_COMPLETION_ACTIVATION_MANIFEST_ID =
  "bidbox-retention-completion-activation/v1" as const;
export const RETENTION_COMPLETION_WORKFLOW =
  "durable_two_phase_detach_reconcile_certify" as const;

export const RETENTION_COMPLETION_PRECONDITION_IDS = [
  "database_controls_attested",
  "storage_reconciler_schedule_verified",
  "storage_terminal_evidence_verified",
  "protected_record_selectors_reviewed",
  "deletion_rehearsal_verified",
  "activation_approval_recorded",
] as const;

export type RetentionCompletionPreconditionId =
  (typeof RETENTION_COMPLETION_PRECONDITION_IDS)[number];

export interface RetentionCompletionActivationPrecondition {
  id: RetentionCompletionPreconditionId;
  description: string;
  status: "open" | "verified";
  evidence: string | null;
}

export interface RetentionCompletionActivationManifest {
  schemaVersion: 1;
  manifestId: typeof RETENTION_COMPLETION_ACTIVATION_MANIFEST_ID;
  status: "preconditions_open_workflow_disabled" | "approved";
  workflow: typeof RETENTION_COMPLETION_WORKFLOW;
  productionActivationGranted: boolean;
  preconditions: readonly RetentionCompletionActivationPrecondition[];
}

export interface RetentionCompletionActivationBlocker {
  code:
    | "activation_manifest_invalid"
    | "production_activation_not_granted"
    | "activation_manifest_not_approved"
    | "environment_opt_in_missing";
  message: string;
}

export interface RetentionCompletionEvidenceBlocker {
  code: RetentionCompletionPreconditionId;
  message: string;
}

export interface RetentionCompletionActivationEvaluation {
  activated: boolean;
  manifestValid: boolean;
  environmentOptIn: boolean;
  workflow: typeof RETENTION_COMPLETION_WORKFLOW;
  activationBlockers: readonly RetentionCompletionActivationBlocker[];
  evidenceBlockers: readonly RetentionCompletionEvidenceBlocker[];
  makerCheckerRequired: true;
}

export const DEFAULT_RETENTION_COMPLETION_ACTIVATION_MANIFEST: RetentionCompletionActivationManifest =
  Object.freeze({
    schemaVersion: 1,
    manifestId: RETENTION_COMPLETION_ACTIVATION_MANIFEST_ID,
    status: "preconditions_open_workflow_disabled",
    workflow: RETENTION_COMPLETION_WORKFLOW,
    productionActivationGranted: false,
    preconditions: Object.freeze([
      {
        id: "database_controls_attested",
        description:
          "Retention control rows, tenant boundaries, immutable evidence and transition constraints are installed and runtime-attested.",
        status: "open",
        evidence: null,
      },
      {
        id: "storage_reconciler_schedule_verified",
        description:
          "The tenant-fair storage deletion reconciler has a production schedule, monitored liveness and bounded retry/dead-letter handling.",
        status: "open",
        evidence: null,
      },
      {
        id: "storage_terminal_evidence_verified",
        description:
          "Deleted and already-absent terminal receipts are independently exercised against the production storage adapter.",
        status: "open",
        evidence: null,
      },
      {
        id: "protected_record_selectors_reviewed",
        description:
          "Legal-hold, financial, accounting, retainer and Claims Desk selectors have named legal and finance review evidence.",
        status: "open",
        evidence: null,
      },
      {
        id: "deletion_rehearsal_verified",
        description:
          "A restore-aware end-to-end deletion rehearsal proves relational detach, object reconciliation and certificate postconditions.",
        status: "open",
        evidence: null,
      },
      {
        id: "activation_approval_recorded",
        description:
          "A named production owner approved the exact manifest after reviewing every preceding evidence reference.",
        status: "open",
        evidence: null,
      },
    ]),
  }) as RetentionCompletionActivationManifest;

const ACTIVATION_MANIFEST_RELATIVE_PATH =
  "config/operations/retention-completion-activation.v1.json";

/**
 * Load the checked operational manifest that is reviewed and shipped with the
 * release. Any missing, unreadable or malformed file returns null so runtime
 * activation remains fail-closed; there is no permissive environment-only
 * fallback and the built-in default is used only by dependency-injected tests.
 */
export function loadCheckedRetentionCompletionActivationManifest(
  cwd = process.cwd(),
): unknown {
  const candidates = [
    resolve(cwd, ACTIVATION_MANIFEST_RELATIVE_PATH),
    resolve(cwd, "..", "..", ACTIVATION_MANIFEST_RELATIVE_PATH),
  ];
  const sources: string[] = [];
  for (const candidate of candidates) {
    try {
      sources.push(readFileSync(candidate, "utf8"));
    } catch {
      // Missing candidates are expected across root and package working dirs.
    }
  }
  const unique = [...new Set(sources)];
  if (unique.length !== 1) return null;
  try {
    return JSON.parse(unique[0]!) as unknown;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const expected = new Set(keys);
  return (
    Object.keys(value).length === expected.size &&
    Object.keys(value).every((key) => expected.has(key))
  );
}

function parseManifest(
  value: unknown,
): RetentionCompletionActivationManifest | null {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "schemaVersion",
      "manifestId",
      "status",
      "workflow",
      "productionActivationGranted",
      "preconditions",
    ]) ||
    value.schemaVersion !== 1 ||
    value.manifestId !== RETENTION_COMPLETION_ACTIVATION_MANIFEST_ID ||
    (value.status !== "preconditions_open_workflow_disabled" &&
      value.status !== "approved") ||
    value.workflow !== RETENTION_COMPLETION_WORKFLOW ||
    typeof value.productionActivationGranted !== "boolean" ||
    !Array.isArray(value.preconditions) ||
    value.preconditions.length !== RETENTION_COMPLETION_PRECONDITION_IDS.length
  ) {
    return null;
  }
  const expectedIds = new Set<string>(RETENTION_COMPLETION_PRECONDITION_IDS);
  const seen = new Set<string>();
  const preconditions: RetentionCompletionActivationPrecondition[] = [];
  for (const candidate of value.preconditions) {
    if (
      !isRecord(candidate) ||
      !exactKeys(candidate, ["id", "description", "status", "evidence"]) ||
      typeof candidate.id !== "string" ||
      !expectedIds.has(candidate.id) ||
      seen.has(candidate.id) ||
      typeof candidate.description !== "string" ||
      candidate.description.trim() !== candidate.description ||
      candidate.description.length < 16 ||
      candidate.description.length > 1_024 ||
      (candidate.status !== "open" && candidate.status !== "verified") ||
      (candidate.evidence !== null &&
        (typeof candidate.evidence !== "string" ||
          candidate.evidence.trim() !== candidate.evidence ||
          candidate.evidence.length < 8 ||
          candidate.evidence.length > 1_024)) ||
      (candidate.status === "verified" && candidate.evidence === null)
    ) {
      return null;
    }
    seen.add(candidate.id);
    preconditions.push(
      candidate as unknown as RetentionCompletionActivationPrecondition,
    );
  }
  return {
    schemaVersion: 1,
    manifestId: RETENTION_COMPLETION_ACTIVATION_MANIFEST_ID,
    status: value.status,
    workflow: RETENTION_COMPLETION_WORKFLOW,
    productionActivationGranted: value.productionActivationGranted,
    preconditions,
  };
}

export function evaluateRetentionCompletionActivation(
  manifest: unknown = DEFAULT_RETENTION_COMPLETION_ACTIVATION_MANIFEST,
  env: Readonly<Record<string, string | undefined>> = process.env,
): RetentionCompletionActivationEvaluation {
  const parsed = parseManifest(manifest);
  const environmentOptIn = env[RETENTION_COMPLETION_ACTIVATION_ENV] === "true";
  const activationBlockers: RetentionCompletionActivationBlocker[] = [];
  const evidenceBlockers: RetentionCompletionEvidenceBlocker[] = [];
  if (!parsed) {
    activationBlockers.push({
      code: "activation_manifest_invalid",
      message: "The retention activation manifest is invalid.",
    });
  } else {
    if (!parsed.productionActivationGranted) {
      activationBlockers.push({
        code: "production_activation_not_granted",
        message: "Production retention completion has not been approved.",
      });
    }
    if (parsed.status !== "approved") {
      activationBlockers.push({
        code: "activation_manifest_not_approved",
        message: "The retention activation manifest is not approved.",
      });
    }
    for (const precondition of parsed.preconditions) {
      if (precondition.status !== "verified" || !precondition.evidence) {
        evidenceBlockers.push({
          code: precondition.id,
          message: precondition.description,
        });
      }
    }
  }
  if (!environmentOptIn) {
    activationBlockers.push({
      code: "environment_opt_in_missing",
      message: `The ${RETENTION_COMPLETION_ACTIVATION_ENV} environment opt-in is not enabled.`,
    });
  }
  return {
    activated:
      Boolean(parsed) &&
      parsed!.productionActivationGranted &&
      parsed!.status === "approved" &&
      evidenceBlockers.length === 0 &&
      environmentOptIn,
    manifestValid: Boolean(parsed),
    environmentOptIn,
    workflow: RETENTION_COMPLETION_WORKFLOW,
    activationBlockers,
    evidenceBlockers,
    makerCheckerRequired: true,
  };
}
