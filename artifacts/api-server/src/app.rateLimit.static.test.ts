import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(
  new URL("./app.ts", import.meta.url),
  "utf8",
).replace(/\r\n?/gu, "\n");

test("layers a supported rate limiter inside the bounded BidBox policy boundary", () => {
  const healthRoutes = source.indexOf('app.use("/api", healthRouter)');
  const bidboxLimiter = source.indexOf("createRateLimiter({");
  const supportedLimiter = source.indexOf("rateLimit({");
  const publicRoutes = source.indexOf('app.use(\n  "/api/public",');
  const authentication = source.indexOf("clerkMiddleware((req)");
  const protectedRoutes = source.indexOf('app.use("/api", router)');

  assert.ok(healthRoutes >= 0, "health routes must be mounted");
  assert.ok(
    bidboxLimiter > healthRoutes,
    "BidBox limiter must follow health routes",
  );
  assert.ok(
    supportedLimiter > bidboxLimiter,
    "supported limiter must remain behind the authoritative BidBox limiter",
  );
  assert.ok(
    publicRoutes > supportedLimiter,
    "public routes must remain behind both limiters",
  );
  assert.ok(
    authentication > supportedLimiter,
    "authentication must remain behind both limiters",
  );
  assert.ok(
    protectedRoutes > authentication,
    "protected routes must remain behind authentication",
  );
});

test("keeps the supported layer silent and aligned with BidBox bypass semantics", () => {
  const supportedLimiter = source.slice(
    source.indexOf("rateLimit({"),
    source.indexOf('app.use(\n  "/api/public",'),
  );

  assert.match(supportedLimiter, /standardHeaders: false/);
  assert.match(supportedLimiter, /legacyHeaders: false/);
  assert.match(
    supportedLimiter,
    /limit: Math\.min\(Number\.MAX_SAFE_INTEGER, rateLimitMax \* 2\)/,
  );
  assert.match(
    supportedLimiter,
    /req\.method === "OPTIONS" \|\| req\.path === "\/healthz"/,
  );
  assert.match(
    supportedLimiter,
    /req\.ip \|\| req\.socket\.remoteAddress \|\| "unknown"/,
  );
  assert.match(
    supportedLimiter,
    /validate: \{ keyGeneratorIpFallback: false \}/,
  );
  assert.match(supportedLimiter, /passOnStoreError: false/);
});
