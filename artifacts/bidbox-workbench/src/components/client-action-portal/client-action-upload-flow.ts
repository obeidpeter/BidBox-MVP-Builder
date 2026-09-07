import {
  CLIENT_ACTION_UPLOAD_MAXIMUM_BYTES,
  ClientActionUploadContractError,
  GOVERNED_CLIENT_UPLOAD_MIME_TYPES,
  adaptClientActionUploadFinalizationReceipt,
  adaptClientActionUploadLeaseGrant,
  type ClientActionUploadBinding,
  type ClientActionUploadFinalizationReceipt,
  type ClientActionUploadLeaseGrant,
} from "./client-action-upload-contract";

export type ClientActionUploadRetry =
  | "same_operation"
  | "new_lease"
  | "reload_scope"
  | "none";

export type ClientActionUploadPhase =
  | "checking"
  | "leasing"
  | "lease_ready"
  | "transferring"
  | "finalizing"
  | "completed";

export type ClientActionUploadProgress =
  | { phase: "checking" | "leasing" | "transferring" | "finalizing" }
  | {
      phase: "lease_ready";
      leaseId: string;
      expiresAt: string;
      replayed: boolean;
      lateRewriteClosure: "bounded-cushion-and-post-expiry-reconcile";
    }
  | {
      phase: "completed";
      receipt: ClientActionUploadFinalizationReceipt;
    };

export interface ClientActionUploadFile extends Blob {
  readonly name: string;
}

export interface RunClientActionUploadInput {
  binding: ClientActionUploadBinding;
  file: ClientActionUploadFile;
  idempotencyKey: string;
}

export interface RunClientActionUploadDependencies {
  assertCurrent(): void;
  issueLease(input: {
    binding: ClientActionUploadBinding;
    idempotencyKey: string;
  }): Promise<unknown>;
  putSignedObject(
    uploadUrl: string,
    init: RequestInit,
  ): Promise<Pick<Response, "ok" | "status" | "statusText">>;
  finalize(input: {
    binding: ClientActionUploadBinding;
    lease: ClientActionUploadLeaseGrant;
    idempotencyKey: string;
  }): Promise<unknown>;
  digest?(bytes: ArrayBuffer): Promise<string>;
  onProgress?(progress: ClientActionUploadProgress): void;
}

export class ClientActionUploadFlowError extends Error {
  constructor(
    message: string,
    readonly phase: ClientActionUploadPhase,
    readonly retry: ClientActionUploadRetry,
    readonly serverLeaseMayExist: boolean,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ClientActionUploadFlowError";
  }
}

const SAFE_KEY = /^[^\u0000-\u001f\u007f\ud800-\udfff]{16,128}$/u;
const SAFE_FILENAME = /^[^/\\\u0000-\u001f\u007f\ud800-\udfff]{1,255}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const GOVERNED_MIME = new Set<string>(GOVERNED_CLIENT_UPLOAD_MIME_TYPES);

function errorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const data = (error as { data?: unknown }).data;
  if (!data || typeof data !== "object") return null;
  const code = (data as Record<string, unknown>).code;
  return typeof code === "string" ? code : null;
}

function errorStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
}

function requestFailure(
  error: unknown,
  phase: "leasing" | "finalizing",
): ClientActionUploadFlowError {
  const code = errorCode(error);
  const status = errorStatus(error);
  const leaseMayExist = phase === "finalizing" || status === null;
  if (code === "expired" || status === 410) {
    return new ClientActionUploadFlowError(
      "The upload slot expired. Reload the current request slot before starting again.",
      phase,
      "new_lease",
      true,
      error,
    );
  }
  if (
    ["scope_denied", "not_found", "stale_version", "conflict"].includes(
      code ?? "",
    ) ||
    [403, 404, 409].includes(status ?? 0)
  ) {
    return new ClientActionUploadFlowError(
      "The organisation, membership, pursuit, request, slot, version or upload details are no longer current. Reload before retrying.",
      phase,
      "reload_scope",
      leaseMayExist,
      error,
    );
  }
  if (
    ["intake_rejected", "cleanup_unconfirmed"].includes(code ?? "") ||
    status === 422
  ) {
    return new ClientActionUploadFlowError(
      "The security checks did not finish this upload. Reload the request and follow the recorded result before retrying.",
      phase,
      "none",
      true,
      error,
    );
  }
  if (code === "unavailable") {
    return new ClientActionUploadFlowError(
      phase === "leasing"
        ? "Uploads are not active. No transfer started. Try again only after an administrator confirms that uploads are available."
        : "The security checks are unavailable. A temporary upload may exist; reload the current request before retrying.",
      phase,
      "none",
      phase === "finalizing",
      error,
    );
  }
  return new ClientActionUploadFlowError(
    phase === "leasing"
      ? "The upload permission result is unknown. Retry this same upload with the same file; do not start another upload."
      : "The final result is unknown. Retry the same upload so Valo can return the existing receipt.",
    phase,
    "same_operation",
    leaseMayExist,
    error,
  );
}

function assertCurrent(
  dependencies: RunClientActionUploadDependencies,
  phase: ClientActionUploadPhase,
  leaseMayExist: boolean,
): void {
  try {
    dependencies.assertCurrent();
  } catch (cause) {
    throw new ClientActionUploadFlowError(
      "The organisation, membership, pursuit, request, slot, version or upload details changed during upload. Reload before retrying.",
      phase,
      "reload_scope",
      leaseMayExist,
      cause,
    );
  }
}

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}

function validateBinding(binding: ClientActionUploadBinding): void {
  const accepted =
    binding.acceptedContentTypes.length === 0 ||
    binding.acceptedContentTypes.includes(binding.contentType);
  if (
    binding.sizeBytes < 1 ||
    binding.sizeBytes > CLIENT_ACTION_UPLOAD_MAXIMUM_BYTES ||
    !SAFE_FILENAME.test(binding.filename) ||
    !SHA256.test(binding.declaredSha256) ||
    !GOVERNED_MIME.has(binding.contentType) ||
    !accepted
  ) {
    throw new ClientActionUploadFlowError(
      "These upload details do not meet the file rules. Record valid details before selecting a file.",
      "checking",
      "reload_scope",
      false,
    );
  }
}

export async function runClientActionUpload(
  input: RunClientActionUploadInput,
  dependencies: RunClientActionUploadDependencies,
): Promise<ClientActionUploadFinalizationReceipt> {
  dependencies.onProgress?.({ phase: "checking" });
  assertCurrent(dependencies, "checking", false);
  validateBinding(input.binding);
  if (!SAFE_KEY.test(input.idempotencyKey)) {
    throw new ClientActionUploadFlowError(
      "This upload cannot be resumed because its saved reference is invalid.",
      "checking",
      "none",
      false,
    );
  }
  const contentType = input.file.type.trim().toLocaleLowerCase("en-US");
  if (
    input.file.name !== input.binding.filename ||
    input.file.size !== input.binding.sizeBytes ||
    contentType !== input.binding.contentType
  ) {
    throw new ClientActionUploadFlowError(
      "The selected file does not match the acknowledged filename, size and file type.",
      "checking",
      "none",
      false,
    );
  }

  let bytes: ArrayBuffer;
  let measuredSha256: string;
  try {
    bytes = await input.file.arrayBuffer();
    measuredSha256 = await (dependencies.digest ?? sha256)(bytes);
  } catch (cause) {
    throw new ClientActionUploadFlowError(
      "The selected file could not be read and checked on this device. No upload permission was requested.",
      "checking",
      "none",
      false,
      cause,
    );
  }
  assertCurrent(dependencies, "checking", false);
  if (
    bytes.byteLength !== input.binding.sizeBytes ||
    measuredSha256 !== input.binding.declaredSha256
  ) {
    throw new ClientActionUploadFlowError(
      "The selected file does not match the acknowledged SHA-256 fingerprint and size. No upload permission was requested.",
      "checking",
      "none",
      false,
    );
  }

  dependencies.onProgress?.({ phase: "leasing" });
  let lease: ClientActionUploadLeaseGrant;
  try {
    const rawLease = await dependencies.issueLease({
      binding: input.binding,
      idempotencyKey: input.idempotencyKey,
    });
    assertCurrent(dependencies, "leasing", true);
    lease = adaptClientActionUploadLeaseGrant(rawLease, input.binding);
  } catch (error) {
    if (error instanceof ClientActionUploadFlowError) throw error;
    if (error instanceof ClientActionUploadContractError) {
      throw new ClientActionUploadFlowError(
        "The upload permission did not match this request. No file was transferred; server expiry and cleanup still apply.",
        "leasing",
        "none",
        true,
        error,
      );
    }
    throw requestFailure(error, "leasing");
  }
  dependencies.onProgress?.({
    phase: "lease_ready",
    leaseId: lease.leaseId,
    expiresAt: lease.expiresAt,
    replayed: lease.replayed,
    lateRewriteClosure: lease.lateRewriteClosure,
  });
  assertCurrent(dependencies, "lease_ready", true);

  dependencies.onProgress?.({ phase: "transferring" });
  let uploadResponse: Pick<Response, "ok" | "status" | "statusText">;
  try {
    uploadResponse = await dependencies.putSignedObject(lease.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": lease.contentType },
      body: input.file,
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      cache: "no-store",
    });
  } catch (cause) {
    throw new ClientActionUploadFlowError(
      "The transfer result is unknown. Retry the same upload while the upload slot is active. A temporary upload may still exist on the server.",
      "transferring",
      "same_operation",
      true,
      cause,
    );
  }
  if (!uploadResponse.ok) {
    throw new ClientActionUploadFlowError(
      `Storage rejected the transfer (${uploadResponse.status}). Retry the same upload while the upload slot is active.`,
      "transferring",
      "same_operation",
      true,
    );
  }
  assertCurrent(dependencies, "transferring", true);

  dependencies.onProgress?.({ phase: "finalizing" });
  let receipt: ClientActionUploadFinalizationReceipt;
  try {
    const rawReceipt = await dependencies.finalize({
      binding: input.binding,
      lease,
      idempotencyKey: input.idempotencyKey,
    });
    assertCurrent(dependencies, "finalizing", true);
    receipt = adaptClientActionUploadFinalizationReceipt(
      rawReceipt,
      input.binding,
      lease,
    );
  } catch (error) {
    if (error instanceof ClientActionUploadFlowError) throw error;
    if (error instanceof ClientActionUploadContractError) {
      throw new ClientActionUploadFlowError(
        "The final receipt did not match this request. Reload the current request and review the server result before retrying.",
        "finalizing",
        "none",
        true,
        error,
      );
    }
    throw requestFailure(error, "finalizing");
  }
  dependencies.onProgress?.({ phase: "completed", receipt });
  return receipt;
}
