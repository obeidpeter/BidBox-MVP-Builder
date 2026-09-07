export const BID_AUTOPSY_ENDPOINT = "/api/public/bid-autopsy-requests";
export const BID_AUTOPSY_OPERATION_STORAGE_KEY =
  "valo.public.bid-autopsy-operation.v1";
const MAXIMUM_FORM_AGE_MS = 24 * 60 * 60 * 1_000;

export interface BidAutopsyOperationState {
  version: 1;
  idempotencyKey: string;
  formStartedAt: string;
  payloadDigest: string | null;
}

export type TenderCategory =
  | "federal_public"
  | "oil_and_gas"
  | "donor_funded"
  | "other";

export type BidStage = "live" | "draft" | "previously_submitted";
export type PreferredContactMethod = "email" | "telephone";

export interface BidAutopsyRequestPayload {
  contactName: string;
  companyName: string;
  businessEmail: string;
  businessTelephone: string;
  tenderCategory: TenderCategory;
  bidStage: BidStage;
  tenderDeadline?: string;
  preferredContactMethod: PreferredContactMethod;
  privacyNoticeAcknowledged: true;
  formStartedAt: string;
  website: string;
}

export interface BidAutopsyRequestReceipt {
  requestId: string;
  status: "accepted";
  replayed: boolean;
  acceptedAt: string;
  nextStep: string;
}

export class BidAutopsyRequestError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super("The request could not be confirmed.");
    this.name = "BidAutopsyRequestError";
  }
}

export function createBidAutopsyIdempotencyKey(): string {
  return globalThis.crypto.randomUUID();
}

function createBidAutopsyOperationState(): BidAutopsyOperationState {
  return {
    version: 1,
    idempotencyKey: createBidAutopsyIdempotencyKey(),
    formStartedAt: new Date().toISOString(),
    payloadDigest: null,
  };
}

function getSessionStorage(): Storage | null {
  try {
    return globalThis.window?.sessionStorage ?? null;
  } catch {
    return null;
  }
}

function isBidAutopsyOperationState(
  value: unknown,
): value is BidAutopsyOperationState {
  if (!value || typeof value !== "object") return false;
  const state = value as Record<string, unknown>;
  const expectedKeys = [
    "formStartedAt",
    "idempotencyKey",
    "payloadDigest",
    "version",
  ];
  const actualKeys = Object.keys(state).sort();
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    return false;
  }

  const startedAt =
    typeof state.formStartedAt === "string"
      ? Date.parse(state.formStartedAt)
      : Number.NaN;
  const formAge = Date.now() - startedAt;
  const validStartedAt =
    typeof state.formStartedAt === "string" &&
    !Number.isNaN(startedAt) &&
    new Date(startedAt).toISOString() === state.formStartedAt &&
    formAge >= 0 &&
    formAge <= MAXIMUM_FORM_AGE_MS;
  const validIdempotencyKey =
    typeof state.idempotencyKey === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      state.idempotencyKey,
    );
  const validDigest =
    state.payloadDigest === null ||
    (typeof state.payloadDigest === "string" &&
      /^[0-9a-f]{64}$/.test(state.payloadDigest));

  return (
    state.version === 1 && validIdempotencyKey && validStartedAt && validDigest
  );
}

export function isBidAutopsyOperationStateCurrent(
  value: unknown,
): value is BidAutopsyOperationState {
  return isBidAutopsyOperationState(value);
}

export function loadBidAutopsyOperationState(
  storage: Storage | null = getSessionStorage(),
): BidAutopsyOperationState {
  const freshState = createBidAutopsyOperationState();
  if (!storage) return freshState;

  try {
    const stored = storage.getItem(BID_AUTOPSY_OPERATION_STORAGE_KEY);
    if (stored) {
      const parsed: unknown = JSON.parse(stored);
      if (isBidAutopsyOperationState(parsed)) return parsed;
      storage.removeItem(BID_AUTOPSY_OPERATION_STORAGE_KEY);
    }
    storage.setItem(
      BID_AUTOPSY_OPERATION_STORAGE_KEY,
      JSON.stringify(freshState),
    );
  } catch {
    // Storage can be blocked by browser privacy settings. The in-memory state
    // still protects retries for the lifetime of this mounted form.
  }
  return freshState;
}

export function saveBidAutopsyOperationState(
  state: BidAutopsyOperationState,
  storage: Storage | null = getSessionStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(BID_AUTOPSY_OPERATION_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Keep the operation state in memory when session storage is unavailable.
  }
}

export function clearBidAutopsyOperationState(
  storage: Storage | null = getSessionStorage(),
): void {
  if (!storage) return;
  try {
    storage.removeItem(BID_AUTOPSY_OPERATION_STORAGE_KEY);
  } catch {
    // A confirmed request does not retain any operation state in application
    // memory beyond the mounted receipt view.
  }
}

export async function digestBidAutopsyPayload(
  normalisedPayload: string,
): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("Cryptographic request retry protection is unavailable.");
  }
  const digest = await subtle.digest(
    "SHA-256",
    new TextEncoder().encode(normalisedPayload),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function isBidAutopsyRequestReceipt(
  value: unknown,
): value is BidAutopsyRequestReceipt {
  if (!value || typeof value !== "object") return false;
  const receipt = value as Record<string, unknown>;
  return (
    typeof receipt.requestId === "string" &&
    receipt.status === "accepted" &&
    typeof receipt.replayed === "boolean" &&
    typeof receipt.acceptedAt === "string" &&
    typeof receipt.nextStep === "string"
  );
}

export async function submitBidAutopsyRequest(
  payload: BidAutopsyRequestPayload,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<BidAutopsyRequestReceipt> {
  const response = await fetch(BID_AUTOPSY_ENDPOINT, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok) {
    const retryAfterHeader = response.headers.get("Retry-After");
    const parsedRetryAfter =
      retryAfterHeader && /^\d+$/.test(retryAfterHeader)
        ? Number.parseInt(retryAfterHeader, 10)
        : null;
    const retryAfterSeconds =
      parsedRetryAfter !== null &&
      Number.isSafeInteger(parsedRetryAfter) &&
      parsedRetryAfter > 0 &&
      parsedRetryAfter <= 86_400
        ? parsedRetryAfter
        : null;
    throw new BidAutopsyRequestError(response.status, retryAfterSeconds);
  }
  const receipt: unknown = await response.json();
  if (!isBidAutopsyRequestReceipt(receipt))
    throw new BidAutopsyRequestError(502);
  return receipt;
}
