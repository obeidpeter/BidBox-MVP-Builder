import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, test } from "node:test";
import express from "express";
import type {
  BidAutopsyRateLimitConsumer,
  BidAutopsyRequestStore,
  NormalizedBidAutopsyRequest,
} from "../lib/publicBidAutopsyRequest";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??=
  "postgresql://bidbox_test:bidbox_test@127.0.0.1:1/bidbox_test";

const { createPublicBidAutopsyRouter, normalisePublicClientAddress } =
  await import("./public");

const ORIGIN = "https://bidbox.example.test";
const NOW = Date.parse("2026-08-10T12:00:00.000Z");
const REQUEST_ID = "10000000-0000-4000-8000-000000000001";
const IDEMPOTENCY_KEY = "20000000-0000-4000-8000-000000000002";
const RATE_LIMIT_SECRET = "public-lead-test-hmac-secret-32-bytes-minimum";
const servers = new Set<Server>();

const validBody = {
  contactName: "  Ada   Okafor ",
  companyName: " Northstar  Services Ltd ",
  businessEmail: "ADA@NORTHSTAR.EXAMPLE",
  businessTelephone: "+234 803 123 4567",
  tenderCategory: "federal_public",
  bidStage: "live",
  tenderDeadline: "2026-08-25",
  preferredContactMethod: "email",
  privacyNoticeAcknowledged: true,
  formStartedAt: "2026-08-10T11:59:55.000Z",
  website: "",
} as const;

afterEach(async () => {
  await Promise.all(
    [...servers].map(
      (server) =>
        new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        ),
    ),
  );
  servers.clear();
});

async function start(options?: {
  destination?: string;
  store?: BidAutopsyRequestStore;
  consumeRateLimit?: BidAutopsyRateLimitConsumer;
  rateLimitMax?: number;
  nodeEnv?: string;
  trustProxy?: boolean | number;
  omitRateLimitSecret?: boolean;
  omitRetention?: boolean;
  recordReceipt?: Parameters<
    typeof createPublicBidAutopsyRouter
  >[0]["recordReceipt"];
}): Promise<string> {
  const app = express();
  if (options?.trustProxy != null) app.set("trust proxy", options.trustProxy);
  app.use(
    "/api/public",
    createPublicBidAutopsyRouter({
      allowedOrigins: new Set([ORIGIN]),
      destination: options?.destination ?? "database",
      now: () => NOW,
      store:
        options?.store ??
        (async () => ({
          requestId: REQUEST_ID,
          acceptedAt: new Date(NOW),
          replayed: false,
          payloadMatches: true,
        })),
      consumeRateLimit:
        options?.consumeRateLimit ??
        (async () => ({
          allowed: true,
          remaining: Math.max(0, (options?.rateLimitMax ?? 20) - 1),
          resetAt: new Date(NOW + 60_000),
        })),
      rateLimitHmacSecret: options?.omitRateLimitSecret
        ? undefined
        : RATE_LIMIT_SECRET,
      rateLimitWindowMs: 60_000,
      rateLimitMax: options?.rateLimitMax ?? 20,
      retentionDays: options?.omitRetention ? undefined : 30,
      nodeEnv: options?.nodeEnv ?? "test",
      trustedProxyConfigured: options?.trustProxy === 1,
      recordReceipt: options?.recordReceipt ?? (() => undefined),
    }),
  );
  const server = createServer(app);
  servers.add(server);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function submit(
  baseUrl: string,
  body: unknown = validBody,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${baseUrl}/api/public/bid-autopsy-requests`, {
    method: "POST",
    headers: {
      Origin: ORIGIN,
      "Content-Type": "application/json",
      "Idempotency-Key": IDEMPOTENCY_KEY,
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("public Bid Autopsy request route", () => {
  test("canonicalises equivalent IP forms and rejects non-address keys", () => {
    assert.equal(
      normalisePublicClientAddress("::ffff:203.0.113.9"),
      "203.0.113.9",
    );
    assert.equal(
      normalisePublicClientAddress("2001:0db8:0:0:0:0:0:1"),
      "2001:db8::1",
    );
    assert.equal(normalisePublicClientAddress("not-an-address"), null);
  });

  test("stores a normalized bounded request and returns no response-time promise", async () => {
    const seen: Array<{
      key: string;
      request: NormalizedBidAutopsyRequest;
      retentionDays: number;
    }> = [];
    const baseUrl = await start({
      store: async (key, request, retentionDays) => {
        seen.push({ key, request, retentionDays });
        return {
          requestId: REQUEST_ID,
          acceptedAt: new Date(NOW),
          replayed: false,
          payloadMatches: true,
        };
      },
    });

    const response = await submit(baseUrl);
    assert.equal(response.status, 202);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), {
      requestId: REQUEST_ID,
      status: "accepted",
      replayed: false,
      acceptedAt: "2026-08-10T12:00:00.000Z",
      nextStep:
        "BidBox will use your preferred contact method to confirm scope and the secure next step. Do not send tender files until that process is agreed.",
    });
    assert.deepEqual(seen, [
      {
        key: IDEMPOTENCY_KEY,
        request: {
          contactName: "Ada Okafor",
          companyName: "Northstar Services Ltd",
          businessEmail: "ada@northstar.example",
          businessTelephone: "+234 803 123 4567",
          tenderCategory: "federal_public",
          bidStage: "live",
          tenderDeadline: "2026-08-25",
          preferredContactMethod: "email",
        },
        retentionDays: 30,
      },
    ]);
  });

  test("returns the original receipt for a safe idempotent replay", async () => {
    const baseUrl = await start({
      store: async () => ({
        requestId: REQUEST_ID,
        acceptedAt: new Date(NOW - 10_000),
        replayed: true,
        payloadMatches: true,
      }),
    });
    const response = await submit(baseUrl);
    assert.equal(response.status, 202);
    assert.equal(
      ((await response.json()) as { replayed: boolean }).replayed,
      true,
    );
  });

  test("rejects reuse of an idempotency key for different business data", async () => {
    const baseUrl = await start({
      store: async () => ({
        requestId: REQUEST_ID,
        acceptedAt: new Date(NOW),
        replayed: true,
        payloadMatches: false,
      }),
    });
    const response = await submit(baseUrl);
    assert.equal(response.status, 409);
  });

  test("fails closed when the authorised database destination is not enabled", async () => {
    let called = false;
    const baseUrl = await start({
      destination: "",
      store: async () => {
        called = true;
        throw new Error("must not run");
      },
    });
    const response = await submit(baseUrl);
    assert.equal(response.status, 503);
    assert.equal(called, false);
  });

  test("fails closed when production retention, HMAC, or trusted-proxy configuration is missing", async () => {
    let limiterCalls = 0;
    const consumeRateLimit: BidAutopsyRateLimitConsumer = async () => {
      limiterCalls += 1;
      return {
        allowed: true,
        remaining: 1,
        resetAt: new Date(NOW + 60_000),
      };
    };
    const bases = await Promise.all([
      start({
        nodeEnv: "production",
        trustProxy: 1,
        omitRateLimitSecret: true,
        consumeRateLimit,
      }),
      start({
        nodeEnv: "production",
        trustProxy: 1,
        omitRetention: true,
        consumeRateLimit,
      }),
      start({ nodeEnv: "production", consumeRateLimit }),
    ]);
    for (const baseUrl of bases) {
      assert.equal((await submit(baseUrl)).status, 503);
    }
    assert.equal(limiterCalls, 0);
  });

  test("requires an exact approved Origin and JSON content type", async () => {
    const baseUrl = await start();
    assert.equal(
      (await submit(baseUrl, validBody, { Origin: "https://evil.example" }))
        .status,
      403,
    );
    assert.equal(
      (await submit(baseUrl, validBody, { "Content-Type": "text/plain" }))
        .status,
      415,
    );
    assert.equal(
      (
        await fetch(`${baseUrl}/api/public/bid-autopsy-requests`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": IDEMPOTENCY_KEY,
          },
          body: JSON.stringify(validBody),
        })
      ).status,
      403,
    );
  });

  test("returns safe JSON errors for malformed and oversized bodies", async () => {
    const baseUrl = await start();
    const unsupportedEncoding = await submit(baseUrl, validBody, {
      "Content-Encoding": "x-unsupported",
    });
    assert.equal(unsupportedEncoding.status, 415);
    assert.equal(
      unsupportedEncoding.headers.get("content-type"),
      "application/json; charset=utf-8",
    );
    assert.deepEqual(await unsupportedEncoding.json(), {
      error: "Unsupported request encoding",
    });

    const malformed = await submit(baseUrl, "{");
    assert.equal(malformed.status, 400);
    assert.deepEqual(await malformed.json(), { error: "Invalid request" });

    const oversized = await submit(baseUrl, {
      ...validBody,
      companyName: "x".repeat(17_000),
    });
    assert.equal(oversized.status, 413);
    assert.deepEqual(await oversized.json(), {
      error: "Request body is too large",
    });
  });

  test("rejects bot signals, header injection, invalid dates, unknown fields, and bad keys", async () => {
    const baseUrl = await start();
    const invalidBodies: unknown[] = [
      { ...validBody, website: "filled-by-bot" },
      { ...validBody, formStartedAt: "2026-08-10T11:59:59.500Z" },
      { ...validBody, formStartedAt: "2026-08-10T12:05:00.001Z" },
      { ...validBody, contactName: "Ada\r\nBcc: victim@example.test" },
      { ...validBody, tenderDeadline: "2026-02-30" },
      { ...validBody, privacyNoticeAcknowledged: false },
      { ...validBody, unexpected: "field" },
    ];
    for (const body of invalidBodies) {
      assert.equal((await submit(baseUrl, body)).status, 400);
    }
    assert.equal(
      (await submit(baseUrl, validBody, { "Idempotency-Key": "not-a-uuid" }))
        .status,
      400,
    );
  });

  test("accepts bounded client clock skew without weakening the ordinary completion check", async () => {
    const baseUrl = await start();
    const response = await submit(baseUrl, {
      ...validBody,
      formStartedAt: "2026-08-10T12:01:00.000Z",
    });

    assert.equal(response.status, 202);
  });

  test("applies a dedicated public-intake rate limit before database work", async () => {
    let calls = 0;
    let limiterCalls = 0;
    const baseUrl = await start({
      rateLimitMax: 1,
      consumeRateLimit: async () => {
        limiterCalls += 1;
        return {
          allowed: limiterCalls <= 1,
          remaining: 0,
          resetAt: new Date(NOW + 60_000),
        };
      },
      store: async () => {
        calls += 1;
        return {
          requestId: REQUEST_ID,
          acceptedAt: new Date(NOW),
          replayed: false,
          payloadMatches: true,
        };
      },
    });
    assert.equal((await submit(baseUrl)).status, 202);
    const limited = await submit(baseUrl);
    assert.equal(limited.status, 429);
    assert.equal(calls, 1);
    assert.equal(limiterCalls, 2);
    assert.ok(Number(limited.headers.get("retry-after")) >= 1);
  });

  test("fails closed when the shared limiter is unavailable", async () => {
    let stored = false;
    const baseUrl = await start({
      consumeRateLimit: async () => {
        throw new Error("database unavailable");
      },
      store: async () => {
        stored = true;
        throw new Error("must not run");
      },
    });
    const response = await submit(baseUrl);
    assert.equal(response.status, 503);
    assert.equal(stored, false);
  });

  test("uses the socket unless one trusted proxy is configured and ignores spoofed leftmost hops", async () => {
    const directKeys: string[] = [];
    const direct = await start({
      consumeRateLimit: async (key) => {
        directKeys.push(key);
        return {
          allowed: true,
          remaining: 19,
          resetAt: new Date(NOW + 60_000),
        };
      },
    });
    await submit(direct, validBody, { "X-Forwarded-For": "203.0.113.10" });
    await submit(direct, validBody, { "X-Forwarded-For": "198.51.100.10" });
    assert.equal(directKeys[0], directKeys[1]);

    const proxyKeys: string[] = [];
    const proxied = await start({
      trustProxy: 1,
      consumeRateLimit: async (key) => {
        proxyKeys.push(key);
        return {
          allowed: true,
          remaining: 19,
          resetAt: new Date(NOW + 60_000),
        };
      },
    });
    await submit(proxied, validBody, {
      "X-Forwarded-For": "203.0.113.10, 198.51.100.20",
    });
    await submit(proxied, validBody, {
      "X-Forwarded-For": "192.0.2.44, 198.51.100.20",
    });
    await submit(proxied, validBody, {
      "X-Forwarded-For": "192.0.2.44, 198.51.100.21",
    });
    assert.equal(proxyKeys[0], proxyKeys[1]);
    assert.notEqual(proxyKeys[1], proxyKeys[2]);
  });

  test("emits only the opaque committed-receipt monitoring event", async () => {
    const events: unknown[] = [];
    const baseUrl = await start({
      recordReceipt: (event) => events.push(event),
    });
    assert.equal((await submit(baseUrl)).status, 202);
    assert.deepEqual(events, [
      {
        event: "public_bid_autopsy_request_stored",
        requestId: REQUEST_ID,
        destination: "database",
        replayed: false,
      },
    ]);
    const serialised = JSON.stringify(events);
    for (const forbidden of [
      "contactName",
      "companyName",
      "businessEmail",
      "businessTelephone",
      "clientAddress",
      "idempotencyKey",
      "payloadFingerprint",
    ]) {
      assert.equal(serialised.includes(forbidden), false);
    }
  });
});
