export type AdapterKind =
  | "authentication"
  | "object_storage"
  | "malware_scan"
  | "ocr"
  | "model"
  | "email"
  | "whatsapp_business"
  | "payment"
  | "licensed_tender_feed"
  | "audit_anchor";

export interface AdapterDescriptor {
  kind: AdapterKind;
  provider: string;
  mode: "development" | "production";
  productionApproved: boolean;
  capabilities: string[];
  /**
   * Contract evidence used by the AI gateway before any client content leaves
   * BidBox. Absence is intentionally treated as unverified, never as a permissive
   * provider default.
   */
  dataGovernance?: ProviderDataGovernance;
}

export type ProviderRetentionMode =
  | "zero"
  | "bounded"
  | "provider_default"
  | "unknown";

export interface ProviderDataGovernance {
  externallyHosted: boolean;
  noTrainingVerified: boolean;
  retentionMode: ProviderRetentionMode;
  /** Required when retentionMode is bounded; null for zero/unknown modes. */
  maxRetentionDays: number | null;
  /** Approved processing-region identifiers, normalised to lower case. */
  regions: string[];
  dpaApproved: boolean;
  /** External providers must be false unless Restricted Mode approval exists. */
  restrictedModeEligible: boolean;
  /** Immutable reference to the reviewed contract/configuration evidence. */
  evidenceVersion: string | null;
}

export interface AdapterHealth {
  healthy: boolean;
  checkedAt: string;
  message: string;
}

export interface ManagedAdapter {
  descriptor: AdapterDescriptor;
  health(): Promise<AdapterHealth>;
}

export interface JsonModelRequest {
  model: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: unknown }>;
  maxOutputTokens: number;
  timeoutMs: number;
  idempotencyKey: string;
  signal?: AbortSignal;
  /** Exact, hashed registry schema. Gateway calls always provide this. */
  outputSchema?: {
    name: string;
    strict: true;
    schema: Readonly<Record<string, unknown>>;
  };
}

export interface JsonModelResponse {
  content: string;
  promptTokens: number | null;
  completionTokens: number | null;
  providerRequestId?: string | null;
}

export interface JsonModelAdapter extends ManagedAdapter {
  descriptor: AdapterDescriptor & { kind: "model" };
  completeJson(request: JsonModelRequest): Promise<JsonModelResponse>;
}

export interface OcrAdapter extends ManagedAdapter {
  descriptor: AdapterDescriptor & { kind: "ocr" };
  transcribe(input: {
    bytes: Uint8Array;
    mime: string;
    filename: string;
    timeoutMs: number;
    idempotencyKey: string;
  }): Promise<{ text: string; pageCount?: number; confidence?: number }>;
}

export interface MalwareAdapter extends ManagedAdapter {
  descriptor: AdapterDescriptor & { kind: "malware_scan" };
  scan(input: {
    bytes: Uint8Array;
    sha256: string;
    timeoutMs: number;
  }): Promise<{
    verdict: "clean" | "infected" | "indeterminate";
    engineVersion: string;
    evidence: string;
  }>;
}

export interface PaymentAdapter extends ManagedAdapter {
  descriptor: AdapterDescriptor & { kind: "payment" };
  verifyEvent(input: { payload: Uint8Array; signature: string }): Promise<{
    verified: boolean;
    eventId?: string;
    eventType?: string;
  }>;
  reconcile(
    reference: string,
  ): Promise<{ state: string; amountMinor: string; currency: string }>;
}

export interface NotificationAdapter extends ManagedAdapter {
  descriptor: AdapterDescriptor & { kind: "email" | "whatsapp_business" };
  deliver(input: {
    recipient: string;
    template: string;
    variables: Record<string, string>;
    idempotencyKey: string;
  }): Promise<{ providerMessageId: string; accepted: boolean }>;
}

export interface AuditAnchorAdapter extends ManagedAdapter {
  descriptor: AdapterDescriptor & { kind: "audit_anchor" };
  anchor(input: {
    firstSequence: number;
    lastSequence: number;
    chainHeadHash: string;
    manifest: Uint8Array;
    idempotencyKey: string;
  }): Promise<{
    immutableObjectReference: string;
    receiptHash: string;
    receiptSignature?: string;
  }>;
}

export interface AdapterReadinessIssue {
  kind: AdapterKind;
  code: "missing" | "development_only" | "not_approved" | "privacy_unverified";
  message: string;
}

/** Static minimum. Tenant-specific region/retention checks happen in aiGateway. */
export function hasVerifiedModelDataGovernance(
  descriptor: AdapterDescriptor,
): boolean {
  const governance = descriptor.dataGovernance;
  if (!governance) return false;
  if (
    governance.noTrainingVerified !== true ||
    governance.dpaApproved !== true ||
    typeof governance.externallyHosted !== "boolean" ||
    typeof governance.restrictedModeEligible !== "boolean"
  ) {
    return false;
  }
  if (!governance.evidenceVersion?.trim()) return false;
  if (
    !Array.isArray(governance.regions) ||
    governance.regions.length === 0 ||
    !governance.regions.every(
      (region) => typeof region === "string" && region.trim().length > 0,
    )
  ) {
    return false;
  }
  if (
    governance.retentionMode === "unknown" ||
    governance.retentionMode === "provider_default"
  ) {
    return false;
  }
  return (
    governance.retentionMode === "zero" ||
    (governance.maxRetentionDays != null &&
      Number.isInteger(governance.maxRetentionDays) &&
      governance.maxRetentionDays >= 0)
  );
}

/** Production startup must fail if a required capability is fake or absent. */
export function evaluateProductionAdapters(
  requiredKinds: AdapterKind[],
  adapters: AdapterDescriptor[],
): AdapterReadinessIssue[] {
  const issues: AdapterReadinessIssue[] = [];
  for (const kind of requiredKinds) {
    const candidates = adapters.filter((adapter) => adapter.kind === kind);
    if (candidates.length === 0) {
      issues.push({
        kind,
        code: "missing",
        message: `No ${kind} adapter is configured.`,
      });
      continue;
    }
    if (!candidates.some((adapter) => adapter.mode === "production")) {
      issues.push({
        kind,
        code: "development_only",
        message: `${kind} has only a clearly labelled development adapter.`,
      });
      continue;
    }
    if (
      !candidates.some(
        (adapter) =>
          adapter.mode === "production" && adapter.productionApproved === true,
      )
    ) {
      issues.push({
        kind,
        code: "not_approved",
        message: `${kind} has no production-approved configuration.`,
      });
      continue;
    }
    if (
      kind === "model" &&
      !candidates.some(
        (adapter) =>
          adapter.mode === "production" &&
          adapter.productionApproved === true &&
          hasVerifiedModelDataGovernance(adapter),
      )
    ) {
      issues.push({
        kind,
        code: "privacy_unverified",
        message:
          "model has no production-approved privacy, retention, region and DPA evidence.",
      });
    }
  }
  return issues;
}

export class ProviderChainError extends Error {
  readonly failures: Array<{
    provider: string;
    attempt: number;
    message: string;
  }>;

  constructor(
    failures: Array<{ provider: string; attempt: number; message: string }>,
  ) {
    super("Every configured model provider failed");
    this.name = "ProviderChainError";
    this.failures = failures;
  }
}

export async function executeJsonWithFallback(input: {
  request: JsonModelRequest;
  adapters: JsonModelAdapter[];
  attemptsPerAdapter: number;
  retryable: (error: unknown) => boolean;
}): Promise<{
  response: JsonModelResponse;
  provider: string;
  attempt: number;
}> {
  const failures: Array<{
    provider: string;
    attempt: number;
    message: string;
  }> = [];
  for (const adapter of input.adapters) {
    const maxAttempts = Math.max(1, Math.trunc(input.attemptsPerAdapter));
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return {
          response: await adapter.completeJson(input.request),
          provider: adapter.descriptor.provider,
          attempt,
        };
      } catch (error) {
        failures.push({
          provider: adapter.descriptor.provider,
          attempt,
          message:
            error instanceof Error ? error.message : "Unknown provider failure",
        });
        if (!input.retryable(error)) break;
      }
    }
  }
  throw new ProviderChainError(failures);
}
