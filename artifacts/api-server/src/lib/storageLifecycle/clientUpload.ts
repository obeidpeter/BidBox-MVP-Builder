import type { AccessContext, LocalUser } from "../accessContext";

import { UUID_PATTERN as UUID } from "../identifierPatterns";
const CONTROL = /[\u0000-\u001f\u007f\ud800-\udfff]/u;

export const CLIENT_UPLOAD_REQUEST_BODY_BYTES = 4_096;

export interface GovernedClientUploadScope {
  organisationId: string;
  projectId: string;
  actor: LocalUser;
  accessContext: AccessContext;
}

export interface IssueClientUploadLeaseCommand {
  recordId: string;
  slotId: string;
  intentId: string;
  expectedRecordVersion: number;
  idempotencyKey: string;
}

export interface FinalizeClientUploadCommand extends IssueClientUploadLeaseCommand {
  leaseId: string;
}

export interface ClientUploadLeaseGrant {
  leaseId: string;
  recordId: string;
  slotId: string;
  intentId: string;
  recordVersion: number;
  objectPath: string;
  uploadUrl: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  declaredSha256: string;
  expiresAt: string;
  replayed: boolean;
  lateRewriteClosure: "bounded-cushion-and-post-expiry-reconcile";
  rawFileAcceptedByApi: false;
  externalMessageSentByValo: false;
}

export interface ClientUploadFinalizationReceipt {
  leaseId: string;
  recordId: string;
  slotId: string;
  intentId: string;
  recordVersion: number;
  documentId: string;
  documentVersionId: string;
  filename: string;
  sha256: string;
  sizeBytes: number;
  detectedMime: string;
  receiptSha256: string;
  replayed: boolean;
  extractionStarted: false;
  rawFileAcceptedByApi: false;
  externalMessageSentByValo: false;
}

export interface GovernedClientUploadRepository {
  issueLease(
    scope: GovernedClientUploadScope,
    command: IssueClientUploadLeaseCommand,
  ): Promise<ClientUploadLeaseGrant>;
  finalize(
    scope: GovernedClientUploadScope,
    command: FinalizeClientUploadCommand,
  ): Promise<ClientUploadFinalizationReceipt>;
}

export type GovernedClientUploadActivation = (
  scope: GovernedClientUploadScope,
) => Promise<boolean>;

export type GovernedClientUploadErrorCode =
  | "invalid_request"
  | "scope_denied"
  | "not_found"
  | "stale_version"
  | "conflict"
  | "expired"
  | "capacity_exceeded"
  | "intake_rejected"
  | "cleanup_unconfirmed"
  | "unavailable";

export class GovernedClientUploadError extends Error {
  constructor(
    readonly code: GovernedClientUploadErrorCode,
    message: string,
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "GovernedClientUploadError";
  }
}

export function governedClientUploadHttpStatus(
  error: GovernedClientUploadError,
): number {
  switch (error.code) {
    case "invalid_request":
      return 400;
    case "scope_denied":
      return 403;
    case "not_found":
      return 404;
    case "stale_version":
    case "conflict":
    case "cleanup_unconfirmed":
      return 409;
    case "expired":
      return 410;
    case "capacity_exceeded":
      return 413;
    case "intake_rejected":
      return 422;
    case "unavailable":
      return 503;
  }
}

function invalid(message: string): never {
  throw new GovernedClientUploadError("invalid_request", message);
}

function exactObject(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalid("Request body must be an object.");
  }
  const record = value as Record<string, unknown>;
  const expected = new Set(keys);
  if (
    Object.keys(record).length !== expected.size ||
    Object.keys(record).some((key) => !expected.has(key))
  ) {
    invalid("Request body contains missing or unsupported fields.");
  }
  return record;
}

function uuid(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID.test(value)) {
    invalid(`${label} is invalid.`);
  }
  return value.toLowerCase();
}

function positiveVersion(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    invalid("expectedVersion must be a positive integer.");
  }
  return value as number;
}

function idempotencyKey(value: unknown): string {
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    value.length < 16 ||
    value.length > 128 ||
    CONTROL.test(value)
  ) {
    invalid("Idempotency-Key must contain 16 to 128 safe characters.");
  }
  return value;
}

export class GovernedClientUploadService {
  constructor(
    readonly repository: GovernedClientUploadRepository,
    readonly activation: GovernedClientUploadActivation = async () => false,
  ) {}

  issueLease(input: {
    scope: GovernedClientUploadScope;
    recordId: unknown;
    slotId: unknown;
    idempotencyKey: unknown;
    body: unknown;
  }): Promise<ClientUploadLeaseGrant> {
    const body = exactObject(input.body, ["expectedVersion", "intentId"]);
    const command = {
      recordId: uuid(input.recordId, "recordId"),
      slotId: uuid(input.slotId, "slotId"),
      intentId: uuid(body.intentId, "intentId"),
      expectedRecordVersion: positiveVersion(body.expectedVersion),
      idempotencyKey: idempotencyKey(input.idempotencyKey),
    };
    return this.activation(input.scope).then((activated) => {
      if (!activated) {
        throw new GovernedClientUploadError(
          "unavailable",
          "Governed client upload issuance is not activated.",
          {
            activation: "blocked",
            sideEffectsApplied: false,
          },
        );
      }
      return this.repository.issueLease(input.scope, command);
    });
  }

  finalize(input: {
    scope: GovernedClientUploadScope;
    recordId: unknown;
    slotId: unknown;
    leaseId: unknown;
    idempotencyKey: unknown;
    body: unknown;
  }): Promise<ClientUploadFinalizationReceipt> {
    const body = exactObject(input.body, ["expectedVersion", "intentId"]);
    return this.repository.finalize(input.scope, {
      recordId: uuid(input.recordId, "recordId"),
      slotId: uuid(input.slotId, "slotId"),
      leaseId: uuid(input.leaseId, "leaseId"),
      intentId: uuid(body.intentId, "intentId"),
      expectedRecordVersion: positiveVersion(body.expectedVersion),
      idempotencyKey: idempotencyKey(input.idempotencyKey),
    });
  }
}
