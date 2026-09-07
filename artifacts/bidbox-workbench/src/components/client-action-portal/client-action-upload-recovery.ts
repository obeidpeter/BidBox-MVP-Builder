import type { ClientActionUploadBinding } from "./client-action-upload-contract";

const RECOVERY_SCHEMA = "valo.client-action-upload-recovery/v1" as const;
const PREFIX = "valo:client-action-upload-recovery:v1:";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SAFE_KEY = /^[^\u0000-\u001f\u007f\ud800-\udfff]{16,128}$/u;

export interface ClientActionUploadRecoveryScope {
  organisationId: string;
  membershipId: string;
  actorUserId: string;
  projectId: string;
  recordId: string;
  slotId: string;
  intentId: string;
  recordVersion: number;
}

export interface ClientActionUploadRecoveryMarker {
  schema: typeof RECOVERY_SCHEMA;
  scope: ClientActionUploadRecoveryScope;
  idempotencyKey: string;
  leaseId: string | null;
  expiresAt: string | null;
  lateRewriteClosure: null | "bounded-cushion-and-post-expiry-reconcile";
}

function exactObject(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const expected = new Set(keys);
  return Object.keys(candidate).length === expected.size &&
    Object.keys(candidate).every((key) => expected.has(key))
    ? candidate
    : null;
}

function validScope(value: unknown): ClientActionUploadRecoveryScope | null {
  const scope = exactObject(value, [
    "organisationId",
    "membershipId",
    "actorUserId",
    "projectId",
    "recordId",
    "slotId",
    "intentId",
    "recordVersion",
  ]);
  if (
    !scope ||
    !UUID.test(String(scope.organisationId)) ||
    !UUID.test(String(scope.membershipId)) ||
    !UUID.test(String(scope.actorUserId)) ||
    !UUID.test(String(scope.projectId)) ||
    !UUID.test(String(scope.recordId)) ||
    !UUID.test(String(scope.slotId)) ||
    !UUID.test(String(scope.intentId)) ||
    !Number.isSafeInteger(scope.recordVersion) ||
    (scope.recordVersion as number) < 1
  ) {
    return null;
  }
  return scope as unknown as ClientActionUploadRecoveryScope;
}

function exactInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString() === value;
}

function sameScope(
  left: ClientActionUploadRecoveryScope,
  right: ClientActionUploadRecoveryScope,
): boolean {
  return (
    left.organisationId === right.organisationId &&
    left.membershipId === right.membershipId &&
    left.actorUserId === right.actorUserId &&
    left.projectId === right.projectId &&
    left.recordId === right.recordId &&
    left.slotId === right.slotId &&
    left.intentId === right.intentId &&
    left.recordVersion === right.recordVersion
  );
}

export function clientActionUploadRecoveryScope(input: {
  binding: ClientActionUploadBinding;
  membershipId: string;
  actorUserId: string;
}): ClientActionUploadRecoveryScope {
  return {
    organisationId: input.binding.organisationId,
    membershipId: input.membershipId,
    actorUserId: input.actorUserId,
    projectId: input.binding.projectId,
    recordId: input.binding.recordId,
    slotId: input.binding.slotId,
    intentId: input.binding.intentId,
    recordVersion: input.binding.expectedRecordVersion,
  };
}

export function clientActionUploadRecoveryStorageKey(
  scope: ClientActionUploadRecoveryScope,
): string {
  return `${PREFIX}${[
    scope.organisationId,
    scope.membershipId,
    scope.actorUserId,
    scope.projectId,
    scope.recordId,
    scope.slotId,
    scope.intentId,
    String(scope.recordVersion),
  ].join(":")}`;
}

export function readClientActionUploadRecovery(
  storage: Pick<Storage, "getItem" | "removeItem">,
  expectedScope: ClientActionUploadRecoveryScope,
): ClientActionUploadRecoveryMarker | null {
  const key = clientActionUploadRecoveryStorageKey(expectedScope);
  const serialized = storage.getItem(key);
  if (serialized === null) return null;
  if (new TextEncoder().encode(serialized).byteLength > 1_024) {
    storage.removeItem(key);
    return null;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(serialized);
  } catch {
    storage.removeItem(key);
    return null;
  }
  const marker = exactObject(raw, [
    "schema",
    "scope",
    "idempotencyKey",
    "leaseId",
    "expiresAt",
    "lateRewriteClosure",
  ]);
  const scope = validScope(marker?.scope);
  if (
    !marker ||
    marker.schema !== RECOVERY_SCHEMA ||
    !scope ||
    !sameScope(scope, expectedScope) ||
    typeof marker.idempotencyKey !== "string" ||
    marker.idempotencyKey !== marker.idempotencyKey.trim() ||
    !SAFE_KEY.test(marker.idempotencyKey) ||
    (marker.leaseId !== null && !UUID.test(String(marker.leaseId))) ||
    (marker.expiresAt !== null && !exactInstant(marker.expiresAt)) ||
    (marker.leaseId === null) !== (marker.expiresAt === null) ||
    (marker.leaseId === null) !== (marker.lateRewriteClosure === null) ||
    (marker.lateRewriteClosure !== null &&
      marker.lateRewriteClosure !== "bounded-cushion-and-post-expiry-reconcile")
  ) {
    storage.removeItem(key);
    return null;
  }
  return {
    schema: RECOVERY_SCHEMA,
    scope,
    idempotencyKey: marker.idempotencyKey,
    leaseId: marker.leaseId as string | null,
    expiresAt: marker.expiresAt as string | null,
    lateRewriteClosure: marker.lateRewriteClosure as
      | null
      | "bounded-cushion-and-post-expiry-reconcile",
  };
}

export function writeClientActionUploadRecovery(
  storage: Pick<Storage, "setItem">,
  marker: ClientActionUploadRecoveryMarker,
): void {
  if (
    marker.schema !== RECOVERY_SCHEMA ||
    !validScope(marker.scope) ||
    marker.idempotencyKey !== marker.idempotencyKey.trim() ||
    !SAFE_KEY.test(marker.idempotencyKey) ||
    (marker.leaseId !== null && !UUID.test(marker.leaseId)) ||
    (marker.expiresAt !== null && !exactInstant(marker.expiresAt)) ||
    (marker.leaseId === null) !== (marker.expiresAt === null) ||
    (marker.leaseId === null) !== (marker.lateRewriteClosure === null) ||
    (marker.lateRewriteClosure !== null &&
      marker.lateRewriteClosure !== "bounded-cushion-and-post-expiry-reconcile")
  ) {
    throw new Error("Invalid client-upload recovery marker");
  }
  const serialized = JSON.stringify(marker);
  if (new TextEncoder().encode(serialized).byteLength > 1_024) {
    throw new Error("Invalid client-upload recovery marker");
  }
  storage.setItem(
    clientActionUploadRecoveryStorageKey(marker.scope),
    serialized,
  );
}

export function clearClientActionUploadRecovery(
  storage: Pick<Storage, "removeItem">,
  scope: ClientActionUploadRecoveryScope,
): void {
  storage.removeItem(clientActionUploadRecoveryStorageKey(scope));
}

export function pendingClientActionUploadRecovery(
  scope: ClientActionUploadRecoveryScope,
  idempotencyKey: string,
): ClientActionUploadRecoveryMarker {
  return {
    schema: RECOVERY_SCHEMA,
    scope,
    idempotencyKey,
    leaseId: null,
    expiresAt: null,
    lateRewriteClosure: null,
  };
}
