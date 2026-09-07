import express, {
  Router,
  type ErrorRequestHandler,
  type IRouter,
  type Request,
  type RequestHandler,
  type Response,
} from "express";
import { isIP } from "node:net";
import {
  SubmitBidAutopsyRequestBody,
  SubmitBidAutopsyRequestHeader,
} from "@workspace/api-zod";
import {
  PUBLIC_LEAD_DESTINATION,
  bidAutopsyRateLimitClientKey,
  consumeBidAutopsyRateLimit,
  storeBidAutopsyRequest,
  type BidAutopsyRateLimitConsumer,
  type BidAutopsyRequestStore,
  type NormalizedBidAutopsyRequest,
} from "../lib/publicBidAutopsyRequest";
import { logger } from "../lib/logger";

const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
const MINIMUM_COMPLETION_MS = 2_000;
const MAXIMUM_FORM_AGE_MS = 24 * 60 * 60 * 1_000;
const MAXIMUM_FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1_000;
const MINIMUM_RATE_LIMIT_SECRET_BYTES = 32;
const DEVELOPMENT_RATE_LIMIT_SECRET =
  "bidbox-development-only-public-lead-rate-limit-secret";
const NEXT_STEP =
  "BidBox will use your preferred contact method to confirm scope and the secure next step. Do not send tender files until that process is agreed.";

function boundedPositiveInteger(
  value: string | undefined,
  fallback: number,
  maximum: number,
): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0
    ? Math.min(parsed, maximum)
    : fallback;
}

function boundedRetentionDays(
  value: string | number | undefined,
): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 3_650
    ? parsed
    : null;
}

function normaliseText(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/g, " ");
}

function isRealIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month! - 1 &&
    date.getUTCDate() === day
  );
}

function normaliseRequest(
  body: ReturnType<typeof SubmitBidAutopsyRequestBody.parse>,
): NormalizedBidAutopsyRequest | null {
  const rawValues = [
    body.contactName,
    body.companyName,
    body.businessEmail,
    body.businessTelephone,
  ];
  if (rawValues.some((value) => CONTROL_CHARACTER.test(value))) return null;

  const contactName = normaliseText(body.contactName);
  const companyName = normaliseText(body.companyName);
  const businessEmail = normaliseText(body.businessEmail).toLowerCase();
  const businessTelephone = normaliseText(body.businessTelephone);
  if (
    contactName.length < 2 ||
    contactName.length > 120 ||
    companyName.length < 2 ||
    companyName.length > 160 ||
    businessEmail.length < 5 ||
    businessEmail.length > 254 ||
    businessTelephone.length < 7 ||
    businessTelephone.length > 32 ||
    (body.tenderDeadline != null && !isRealIsoDate(body.tenderDeadline))
  ) {
    return null;
  }

  return {
    contactName,
    companyName,
    businessEmail,
    businessTelephone,
    tenderCategory: body.tenderCategory,
    bidStage: body.bidStage,
    tenderDeadline: body.tenderDeadline ?? null,
    preferredContactMethod: body.preferredContactMethod,
  };
}

export interface PublicBidAutopsyRouterOptions {
  allowedOrigins: ReadonlySet<string>;
  destination?: string;
  now?: () => number;
  store?: BidAutopsyRequestStore;
  consumeRateLimit?: BidAutopsyRateLimitConsumer;
  rateLimitHmacSecret?: string;
  rateLimitWindowMs?: number;
  rateLimitMax?: number;
  retentionDays?: number;
  nodeEnv?: string;
  trustedProxyConfigured?: boolean;
  recordReceipt?: (event: PublicBidAutopsyReceiptEvent) => void;
}

export interface PublicBidAutopsyReceiptEvent {
  event: "public_bid_autopsy_request_stored";
  requestId: string;
  destination: typeof PUBLIC_LEAD_DESTINATION;
  replayed: boolean;
}

function resolveRateLimitSecret(
  configured: string | undefined,
  nodeEnv: string | undefined,
): string | null {
  if (configured != null) {
    if (
      Buffer.byteLength(configured, "utf8") < MINIMUM_RATE_LIMIT_SECRET_BYTES
    ) {
      return null;
    }
    return configured;
  }
  if (nodeEnv === "production") {
    return null;
  }
  return DEVELOPMENT_RATE_LIMIT_SECRET;
}

/** Normalises equivalent socket/proxy address forms before keyed hashing. */
export function normalisePublicClientAddress(
  rawAddress: string | undefined,
): string | null {
  if (!rawAddress) return null;
  let address = rawAddress.trim().toLowerCase();
  const zoneIndex = address.lastIndexOf("%");
  if (zoneIndex > 0) address = address.slice(0, zoneIndex);
  if (address.startsWith("::ffff:") && isIP(address.slice(7)) === 4) {
    return address.slice(7);
  }
  const version = isIP(address);
  if (version === 4) return address;
  if (version !== 6) return null;
  try {
    const hostname = new URL(`http://[${address}]/`).hostname;
    return hostname.slice(1, -1);
  } catch {
    return null;
  }
}

function createSharedPublicRateLimiter(options: {
  consume: BidAutopsyRateLimitConsumer;
  secret: string;
  windowMs: number;
  max: number;
  now: () => number;
}): RequestHandler {
  const windowSeconds = Math.max(1, Math.ceil(options.windowMs / 1_000));
  return async (req, res, next) => {
    const address = normalisePublicClientAddress(
      req.ip || req.socket.remoteAddress,
    );
    if (!address) {
      res.status(503).json({ error: "Request intake is not available" });
      return;
    }
    try {
      const decision = await options.consume(
        bidAutopsyRateLimitClientKey(address, options.secret),
        windowSeconds,
        options.max,
      );
      const resetAt = decision.resetAt.getTime();
      if (
        typeof decision.allowed !== "boolean" ||
        !Number.isSafeInteger(decision.remaining) ||
        decision.remaining < 0 ||
        decision.remaining > options.max ||
        !Number.isFinite(resetAt)
      ) {
        throw new Error("Invalid public intake rate limit decision");
      }
      res.setHeader("RateLimit-Limit", String(options.max));
      res.setHeader("RateLimit-Remaining", String(decision.remaining));
      res.setHeader("RateLimit-Reset", String(Math.ceil(resetAt / 1_000)));
      if (!decision.allowed) {
        res.setHeader(
          "Retry-After",
          String(Math.max(1, Math.ceil((resetAt - options.now()) / 1_000))),
        );
        res.status(429).json({ error: "Too many requests" });
        return;
      }
      next();
    } catch {
      // The shared limiter is mandatory: database/decision failures fail closed.
      res.status(503).json({ error: "Request intake is not available" });
    }
  };
}

function requireApprovedOrigin(
  allowedOrigins: ReadonlySet<string>,
): RequestHandler {
  return (req, res, next) => {
    const origin = req.get("Origin")?.replace(/\/$/, "");
    if (!origin || !allowedOrigins.has(origin)) {
      res.status(403).json({ error: "Request could not be accepted" });
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    next();
  };
}

const requireJsonContentType: RequestHandler = (req, res, next) => {
  const contentType = req.get("Content-Type") ?? "";
  const contentEncoding = req.get("Content-Encoding")?.trim().toLowerCase();
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentType)) {
    res.status(415).json({ error: "Request must use application/json" });
    return;
  }
  if (contentEncoding && contentEncoding !== "identity") {
    res.status(415).json({ error: "Unsupported request encoding" });
    return;
  }
  next();
};

const publicJsonError: ErrorRequestHandler = (error, _req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }
  const status = Number(
    (error as { status?: unknown; statusCode?: unknown }).status ??
      (error as { statusCode?: unknown }).statusCode,
  );
  if (status === 413) {
    res.status(413).json({ error: "Request body is too large" });
    return;
  }
  if (status === 415) {
    res.status(415).json({ error: "Unsupported request encoding" });
    return;
  }
  if (error instanceof SyntaxError || status === 400) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  res.status(503).json({ error: "Request intake is not available" });
};

export function createPublicBidAutopsyRouter(
  options: PublicBidAutopsyRouterOptions,
): IRouter {
  const router: IRouter = Router();
  const now = options.now ?? Date.now;
  const store = options.store ?? storeBidAutopsyRequest;
  const consumeRateLimit =
    options.consumeRateLimit ?? consumeBidAutopsyRateLimit;
  const destination =
    options.destination ?? process.env.VALO_PUBLIC_LEAD_DESTINATION;
  const rateLimitWindowMs =
    options.rateLimitWindowMs ??
    boundedPositiveInteger(
      process.env.PUBLIC_LEAD_RATE_LIMIT_WINDOW_MS,
      15 * 60 * 1_000,
      60 * 60 * 1_000,
    );
  const rateLimitMax =
    options.rateLimitMax ??
    boundedPositiveInteger(process.env.PUBLIC_LEAD_RATE_LIMIT_MAX, 10, 100);
  const rateLimitSecret = resolveRateLimitSecret(
    options.rateLimitHmacSecret ??
      process.env.PUBLIC_LEAD_RATE_LIMIT_HMAC_SECRET,
    options.nodeEnv ?? process.env.NODE_ENV,
  );
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV;
  const retentionDays = boundedRetentionDays(
    options.retentionDays ?? process.env.VALO_PUBLIC_LEAD_RETENTION_DAYS,
  );
  const intakeConfigurationReady =
    destination === PUBLIC_LEAD_DESTINATION &&
    rateLimitSecret !== null &&
    retentionDays !== null &&
    (nodeEnv !== "production" || options.trustedProxyConfigured === true);
  const recordReceipt =
    options.recordReceipt ??
    ((event: PublicBidAutopsyReceiptEvent) => {
      logger.info(event, "Public Bid Autopsy request stored");
    });

  router.post(
    "/bid-autopsy-requests",
    requireApprovedOrigin(options.allowedOrigins),
    requireJsonContentType,
    (_req, res, next) => {
      if (!intakeConfigurationReady) {
        res.status(503).json({ error: "Request intake is not available" });
        return;
      }
      next();
    },
    createSharedPublicRateLimiter({
      consume: consumeRateLimit,
      secret: rateLimitSecret ?? DEVELOPMENT_RATE_LIMIT_SECRET,
      windowMs: rateLimitWindowMs,
      max: rateLimitMax,
      now,
    }),
    express.json({ limit: "16kb", strict: true }),
    async (req: Request, res: Response) => {
      const parsedHeader = SubmitBidAutopsyRequestHeader.safeParse({
        "Idempotency-Key": req.get("Idempotency-Key")?.trim(),
      });
      const parsed = SubmitBidAutopsyRequestBody.strict().safeParse(req.body);
      if (!parsedHeader.success || !parsed.success) {
        res.status(400).json({ error: "Invalid request" });
        return;
      }
      const idempotencyKey = parsedHeader.data["Idempotency-Key"];

      const startedAt = Date.parse(parsed.data.formStartedAt);
      const elapsed = now() - startedAt;
      // Client time is a low-confidence abuse signal, not an authorization
      // boundary. Permit bounded clock skew; the shared database limiter and
      // honeypot remain the authoritative abuse controls.
      if (
        parsed.data.website !== "" ||
        parsed.data.privacyNoticeAcknowledged !== true ||
        !Number.isFinite(startedAt) ||
        elapsed < -MAXIMUM_FUTURE_CLOCK_SKEW_MS ||
        (elapsed >= 0 && elapsed < MINIMUM_COMPLETION_MS) ||
        elapsed > MAXIMUM_FORM_AGE_MS
      ) {
        res.status(400).json({ error: "Invalid request" });
        return;
      }

      const normalized = normaliseRequest(parsed.data);
      if (!normalized) {
        res.status(400).json({ error: "Invalid request" });
        return;
      }

      try {
        const stored = await store(idempotencyKey, normalized, retentionDays!);
        if (!stored.payloadMatches) {
          res.status(409).json({
            error: "This submission key was already used for another request",
          });
          return;
        }
        try {
          recordReceipt({
            event: "public_bid_autopsy_request_stored",
            requestId: stored.requestId,
            destination: PUBLIC_LEAD_DESTINATION,
            replayed: stored.replayed,
          });
        } catch {
          // Observability must not turn a committed idempotent receipt into a retry.
        }
        res.status(202).json({
          requestId: stored.requestId,
          status: "accepted",
          replayed: stored.replayed,
          acceptedAt: stored.acceptedAt.toISOString(),
          nextStep: NEXT_STEP,
        });
      } catch {
        // Never log the body or provider/database error beside public PII.
        res.status(503).json({ error: "Request intake is not available" });
      }
    },
  );
  router.use(publicJsonError);
  return router;
}
