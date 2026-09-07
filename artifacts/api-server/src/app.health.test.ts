import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, before, describe, it } from "node:test";

const previousEnvironment = {
  CLERK_PUBLISHABLE_KEY: process.env.CLERK_PUBLISHABLE_KEY,
  CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
  CLERK_TELEMETRY_DISABLED: process.env.CLERK_TELEMETRY_DISABLED,
  CORS_ALLOWED_ORIGINS: process.env.CORS_ALLOWED_ORIGINS,
  DATABASE_URL: process.env.DATABASE_URL,
  NODE_ENV: process.env.NODE_ENV,
};

process.env.CLERK_PUBLISHABLE_KEY = `pk_test_${Buffer.from(
  "test.clerk.accounts.dev$",
).toString("base64url")}`;
process.env.CLERK_SECRET_KEY = ["sk", "test", "liveness-boundary"].join("_");
process.env.CLERK_TELEMETRY_DISABLED = "1";
const transitionOrigins = [
  "https://bidbox-mvp-builder.replit.app",
  "https://valo-mvp-builder.replit.app",
];
process.env.CORS_ALLOWED_ORIGINS = [
  "https://bidbox.example",
  ...transitionOrigins,
].join(",");
process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/bidbox_app_test";
process.env.NODE_ENV = "test";

const { default: app } = await import("./app");

describe("application liveness boundary", () => {
  let server: Server;
  let origin: string;

  before(async () => {
    server = createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    assert(address && typeof address !== "string");
    origin = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    for (const [name, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it("answers GET and HEAD probes sent through an internal Host without authentication", async () => {
    const getResponse = await fetch(`${origin}/api/healthz`, {
      headers: {
        Host: "127.0.0.1:8080",
        "X-Request-Id": "probe-01:health_check",
      },
    });
    assert.equal(getResponse.status, 200);
    assert.equal(getResponse.headers.get("x-content-type-options"), "nosniff");
    assert.match(
      getResponse.headers.get("content-security-policy") ?? "",
      /default-src 'none'/,
    );
    assert.equal(
      getResponse.headers.get("x-request-id"),
      "probe-01:health_check",
    );
    assert.deepEqual(await getResponse.json(), { status: "ok" });

    const headResponse = await fetch(`${origin}/api/healthz`, {
      method: "HEAD",
      headers: { Host: "127.0.0.1:8080" },
    });
    assert.equal(headResponse.status, 200);
    assert.equal(await headResponse.text(), "");
  });

  it("does not derive liveness from hostile Host or forwarded-host input", async () => {
    const response = await fetch(`${origin}/api/healthz`, {
      headers: {
        Host: "attacker.invalid",
        "X-Forwarded-Host": "metadata.attacker.invalid",
      },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok" });
  });

  it("accepts browser requests from both deployment origins during the rename", async () => {
    for (const browserOrigin of transitionOrigins) {
      const response = await fetch(`${origin}/api/healthz`, {
        headers: { Origin: browserOrigin },
      });
      assert.equal(response.status, 200);
      assert.equal(
        response.headers.get("access-control-allow-origin"),
        browserOrigin,
      );
      assert.equal(
        response.headers.get("access-control-allow-credentials"),
        "true",
      );
      assert.deepEqual(await response.json(), { status: "ok" });
    }
  });

  it("does not promote similarly named hosts into the browser allowlist", async () => {
    for (const browserOrigin of transitionOrigins) {
      const response = await fetch(`${origin}/api/healthz`, {
        headers: { Origin: `${browserOrigin}.attacker.invalid` },
      });
      assert.equal(response.status, 403);
      assert.equal(response.headers.get("access-control-allow-origin"), null);
      await response.body?.cancel();
    }
  });

  it("keeps readiness separate from dependency-free liveness while starting", async () => {
    const liveness = await fetch(`${origin}/api/healthz`);
    const readiness = await fetch(`${origin}/api/readyz`);

    assert.equal(liveness.status, 200);
    assert.equal(readiness.status, 503);
    assert.equal(readiness.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await readiness.json(), {
      status: "not_ready",
      checks: { lifecycle: "not_ready", database: "not_checked" },
      delivery: { metrics: "disconnected", paging: "disconnected" },
    });
  });

  it("keeps every protected endpoint behind Clerk", async () => {
    const [publicHostResponse, internalHostResponse] = await Promise.all([
      fetch(`${origin}/api/me`, {
        headers: { Host: "bidbox.example" },
      }),
      fetch(`${origin}/api/me`, {
        headers: { Host: "127.0.0.1:8080" },
      }),
    ]);
    assert.equal(publicHostResponse.status, 401);
    assert(
      internalHostResponse.status < 200 || internalHostResponse.status >= 300,
    );
  });

  it("does not bypass middleware for other methods or path prefixes", async () => {
    const [postResponse, nestedResponse, readinessNestedResponse] =
      await Promise.all([
        fetch(`${origin}/api/healthz`, {
          method: "POST",
          headers: { Host: "bidbox.example" },
        }),
        fetch(`${origin}/api/healthz/extra`, {
          headers: { Host: "bidbox.example" },
        }),
        fetch(`${origin}/api/readyz/extra`, {
          headers: { Host: "bidbox.example" },
        }),
      ]);

    assert.notEqual(postResponse.status, 200);
    assert.notEqual(nestedResponse.status, 200);
    assert.notEqual(readinessNestedResponse.status, 200);
  });
});
