export const CLIENT_ACTION_UPLOAD_MAXIMUM_BYTES = 52_428_800;

export const GOVERNED_CLIENT_UPLOAD_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/zip",
  "application/x-zip-compressed",
  "image/png",
  "image/jpeg",
] as const;

export interface ClientActionUploadBinding {
  organisationId: string;
  projectId: string;
  recordId: string;
  slotId: string;
  intentId: string;
  expectedRecordVersion: number;
  filename: string;
  contentType: string;
  sizeBytes: number;
  declaredSha256: string;
  acceptedContentTypes: readonly string[];
}

export interface ClientActionUploadLeaseGrant {
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
  rawFileAcceptedByApi: false;
  externalMessageSentByValo: false;
  lateRewriteClosure: "bounded-cushion-and-post-expiry-reconcile";
}

export interface ClientActionUploadFinalizationReceipt {
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

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const MIME =
  /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/u;

export class ClientActionUploadContractError extends Error {
  constructor() {
    super("Invalid client-upload response");
    this.name = "ClientActionUploadContractError";
  }
}

function invalidContract(): never {
  throw new ClientActionUploadContractError();
}

function exactObject(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return invalidContract();
  }
  const candidate = value as Record<string, unknown>;
  const expected = new Set(keys);
  if (
    Object.keys(candidate).length !== expected.size ||
    Object.keys(candidate).some((key) => !expected.has(key))
  ) {
    return invalidContract();
  }
  return candidate;
}

function identifier(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) {
    return invalidContract();
  }
  return value;
}

function digest(value: unknown): string {
  if (typeof value !== "string" || !SHA256.test(value)) {
    return invalidContract();
  }
  return value;
}

function mime(value: unknown): string {
  if (typeof value !== "string" || !MIME.test(value)) {
    return invalidContract();
  }
  return value;
}

function positiveInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    return invalidContract();
  }
  return value as number;
}

function exactInstant(value: unknown): string {
  if (typeof value !== "string") return invalidContract();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== value) {
    return invalidContract();
  }
  return value;
}

function signedUploadUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 8_192) {
    return invalidContract();
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return invalidContract();
  }
  const localDevelopmentHost = ["localhost", "127.0.0.1", "[::1]"].includes(
    parsed.hostname,
  );
  if (
    (parsed.protocol !== "https:" &&
      !(parsed.protocol === "http:" && localDevelopmentHost)) ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.hash !== ""
  ) {
    return invalidContract();
  }
  return value;
}

export function adaptClientActionUploadLeaseGrant(
  value: unknown,
  binding: ClientActionUploadBinding,
): ClientActionUploadLeaseGrant {
  const grant = exactObject(value, [
    "leaseId",
    "recordId",
    "slotId",
    "intentId",
    "recordVersion",
    "objectPath",
    "uploadUrl",
    "filename",
    "contentType",
    "sizeBytes",
    "declaredSha256",
    "expiresAt",
    "replayed",
    "rawFileAcceptedByApi",
    "externalMessageSentByValo",
    "lateRewriteClosure",
  ]);
  const leaseId = identifier(grant.leaseId);
  const result: ClientActionUploadLeaseGrant = {
    leaseId,
    recordId: identifier(grant.recordId),
    slotId: identifier(grant.slotId),
    intentId: identifier(grant.intentId),
    recordVersion: positiveInteger(grant.recordVersion),
    objectPath:
      typeof grant.objectPath === "string"
        ? grant.objectPath
        : invalidContract(),
    uploadUrl: signedUploadUrl(grant.uploadUrl),
    filename:
      typeof grant.filename === "string" ? grant.filename : invalidContract(),
    contentType: mime(grant.contentType),
    sizeBytes: positiveInteger(grant.sizeBytes),
    declaredSha256: digest(grant.declaredSha256),
    expiresAt: exactInstant(grant.expiresAt),
    replayed:
      typeof grant.replayed === "boolean" ? grant.replayed : invalidContract(),
    rawFileAcceptedByApi:
      grant.rawFileAcceptedByApi === false ? false : invalidContract(),
    externalMessageSentByValo:
      grant.externalMessageSentByValo === false ? false : invalidContract(),
    lateRewriteClosure:
      grant.lateRewriteClosure === "bounded-cushion-and-post-expiry-reconcile"
        ? "bounded-cushion-and-post-expiry-reconcile"
        : invalidContract(),
  };
  if (
    result.recordId !== binding.recordId ||
    result.slotId !== binding.slotId ||
    result.intentId !== binding.intentId ||
    result.recordVersion !== binding.expectedRecordVersion ||
    result.objectPath !==
      `/objects/tenants/${binding.organisationId}/uploads/${leaseId}` ||
    result.filename !== binding.filename ||
    result.contentType !== binding.contentType ||
    result.sizeBytes !== binding.sizeBytes ||
    result.declaredSha256 !== binding.declaredSha256
  ) {
    return invalidContract();
  }
  return result;
}

export function adaptClientActionUploadFinalizationReceipt(
  value: unknown,
  binding: ClientActionUploadBinding,
  lease: ClientActionUploadLeaseGrant,
): ClientActionUploadFinalizationReceipt {
  const receipt = exactObject(value, [
    "leaseId",
    "recordId",
    "slotId",
    "intentId",
    "recordVersion",
    "documentId",
    "documentVersionId",
    "filename",
    "sha256",
    "sizeBytes",
    "detectedMime",
    "receiptSha256",
    "replayed",
    "extractionStarted",
    "rawFileAcceptedByApi",
    "externalMessageSentByValo",
  ]);
  const result: ClientActionUploadFinalizationReceipt = {
    leaseId: identifier(receipt.leaseId),
    recordId: identifier(receipt.recordId),
    slotId: identifier(receipt.slotId),
    intentId: identifier(receipt.intentId),
    recordVersion: positiveInteger(receipt.recordVersion),
    documentId: identifier(receipt.documentId),
    documentVersionId: identifier(receipt.documentVersionId),
    filename:
      typeof receipt.filename === "string"
        ? receipt.filename
        : invalidContract(),
    sha256: digest(receipt.sha256),
    sizeBytes: positiveInteger(receipt.sizeBytes),
    detectedMime: mime(receipt.detectedMime),
    receiptSha256: digest(receipt.receiptSha256),
    replayed:
      typeof receipt.replayed === "boolean"
        ? receipt.replayed
        : invalidContract(),
    extractionStarted:
      receipt.extractionStarted === false ? false : invalidContract(),
    rawFileAcceptedByApi:
      receipt.rawFileAcceptedByApi === false ? false : invalidContract(),
    externalMessageSentByValo:
      receipt.externalMessageSentByValo === false ? false : invalidContract(),
  };
  if (
    result.leaseId !== lease.leaseId ||
    result.recordId !== binding.recordId ||
    result.slotId !== binding.slotId ||
    result.intentId !== binding.intentId ||
    result.recordVersion !== binding.expectedRecordVersion + 1 ||
    result.documentId !== lease.leaseId ||
    result.filename !== binding.filename ||
    result.sha256 !== binding.declaredSha256 ||
    result.sizeBytes !== binding.sizeBytes
  ) {
    return invalidContract();
  }
  return result;
}
