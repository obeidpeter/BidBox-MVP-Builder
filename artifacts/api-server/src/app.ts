import express, { type ErrorRequestHandler, type Express } from "express";
import cors from "cors";
import { rateLimit } from "express-rate-limit";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import router from "./routes";
import { logger } from "./lib/logger";
import {
  CLERK_PROXY_PATH,
  clerkProxyHostsFromOrigins,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";
import { dedupeClerkCookies } from "./middlewares/dedupeClerkCookies";
import {
  createRateLimiter,
  parseAllowedOrigins,
  securityHeaders,
} from "./middlewares/security";
import { registerProductionWebApp } from "./lib/webApp";
import { createPublicBidAutopsyRouter } from "./routes/public";
import healthRouter from "./routes/health";
import { operationalSignals, requestCorrelationId } from "./lib/observability";

const app: Express = express();
app.disable("x-powered-by");
if (process.env.TRUST_PROXY === "1") app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    genReqId(req, res) {
      const requestId = requestCorrelationId(req.headers);
      res.setHeader("X-Request-Id", requestId);
      return requestId;
    },
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(operationalSignals.middleware());

const allowedOrigins = parseAllowedOrigins(process.env.CORS_ALLOWED_ORIGINS);
const clerkProxyHosts = clerkProxyHostsFromOrigins(allowedOrigins);

// The Clerk proxy streams raw bytes and must be mounted before body parsers.
// Its public host is selected only from the exact CORS origin allowlist.
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware(clerkProxyHosts));

app.use(securityHeaders);
app.use(
  cors({
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Authorization",
      "Content-Type",
      "Idempotency-Key",
      "If-Match",
      "X-Request-Id",
      "X-BidBox-Organisation-Id",
      "X-BidBox-Break-Glass-Session",
      // Legacy names accepted for one release (see middlewares/tenancy.ts).
      "X-Valo-Organisation-Id",
      "X-Valo-Break-Glass-Session",
    ],
    exposedHeaders: ["X-Request-Id"],
    origin(origin, callback) {
      // Server-to-server and same-origin requests do not carry Origin.
      if (!origin || allowedOrigins.has(origin.replace(/\/$/, ""))) {
        callback(null, true);
        return;
      }
      callback(new Error("Origin not allowed"));
    },
  }),
);
const rejectDisallowedCorsOrigin: ErrorRequestHandler = (
  error,
  _req,
  res,
  next,
) => {
  if (error instanceof Error && error.message === "Origin not allowed") {
    res.status(403).json({ error: "Request could not be accepted" });
    return;
  }
  next(error);
};
app.use(rejectDisallowedCorsOrigin);

// Liveness remains dependency-free; readiness checks lifecycle and database.
// Both exact routes are independent of Clerk and request throttling so the
// deployment sidecar can probe through its internal Host header. Mounting the
// router here avoids any path-prefix bypass in protected middleware.
app.use("/api", healthRouter);

const configuredRateLimitWindowMs = Number(
  process.env.RATE_LIMIT_WINDOW_MS || 60_000,
);
const configuredRateLimitMax = Number(
  process.env.RATE_LIMIT_MAX_REQUESTS || 300,
);
const rateLimitWindowMs =
  Number.isFinite(configuredRateLimitWindowMs) &&
  configuredRateLimitWindowMs > 0
    ? configuredRateLimitWindowMs
    : 60_000;
const rateLimitMax =
  Number.isSafeInteger(configuredRateLimitMax) && configuredRateLimitMax > 0
    ? configuredRateLimitMax
    : 300;
app.use(
  createRateLimiter({
    windowMs: rateLimitWindowMs,
    max: rateLimitMax,
  }),
);
// Keep the bounded BidBox limiter authoritative, then layer a supported limiter
// for framework-aware security tooling and defence in depth. Doubling the
// secondary fixed-window allowance prevents it from rejecting traffic that the
// primary per-client fixed window accepted across a secondary window boundary.
app.use(
  rateLimit({
    windowMs: Math.min(rateLimitWindowMs, 2_147_483_647),
    limit: Math.min(Number.MAX_SAFE_INTEGER, rateLimitMax * 2),
    standardHeaders: false,
    legacyHeaders: false,
    skip: (req) => req.method === "OPTIONS" || req.path === "/healthz",
    // Match the primary limiter's exact-IP grouping. The default IPv6 subnet
    // grouping would otherwise combine clients the BidBox policy keeps separate.
    keyGenerator: (req) => req.ip || req.socket.remoteAddress || "unknown",
    validate: { keyGeneratorIpFallback: false },
    passOnStoreError: false,
    handler: (_req, res) => {
      res.status(429).json({ error: "Too many requests" });
    },
  }),
);
app.use(
  "/api/public",
  createPublicBidAutopsyRouter({
    allowedOrigins,
    trustedProxyConfigured: process.env.TRUST_PROXY === "1",
  }),
);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// Collapse duplicated Clerk cookies (a Replit dev-preview quirk) to the freshest
// value before Clerk verifies the session — otherwise a lingering expired copy
// can shadow the valid token and yield a spurious 401.
app.use(dedupeClerkCookies);

app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req, clerkProxyHosts) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

app.use("/api", router);

if (process.env.NODE_ENV === "production") {
  registerProductionWebApp(app);
}

export default app;
