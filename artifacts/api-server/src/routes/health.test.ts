import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { afterEach, describe, it } from "node:test";
import express from "express";
import { RuntimeReadiness } from "../lib/runtimeLifecycle";

process.env.DATABASE_URL ??=
  "postgresql://test:test@127.0.0.1:1/bidbox_health_test";
process.env.NODE_ENV = "test";

const { createHealthRouter } = await import("./health");

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
});

async function serve(input: {
  checkDatabase: (timeoutMillis: number) => Promise<boolean>;
  isAccepting: () => boolean;
  releaseSha256?: () => string | null;
  readinessTimeoutMillis?: number;
}): Promise<string> {
  const app = express();
  app.use(
    "/api",
    createHealthRouter({
      ...input,
      delivery: () => ({ metrics: "disconnected", paging: "disconnected" }),
    }),
  );
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}

const readyBody = {
  status: "ready",
  checks: { lifecycle: "ready", database: "ready" },
  delivery: { metrics: "disconnected", paging: "disconnected" },
};

describe("readiness boundary", () => {
  it("returns the frozen unauthenticated GET and HEAD contract", async () => {
    const releaseSha256 = "a".repeat(64);
    const origin = await serve({
      checkDatabase: async () => true,
      isAccepting: () => true,
      releaseSha256: () => releaseSha256,
    });
    const getResponse = await fetch(`${origin}/api/readyz`);
    assert.equal(getResponse.status, 200);
    assert.equal(getResponse.headers.get("cache-control"), "private, no-store");
    assert.equal(
      getResponse.headers.get("x-bidbox-release-sha256"),
      releaseSha256,
    );
    assert.deepEqual(await getResponse.json(), readyBody);

    const headResponse = await fetch(`${origin}/api/readyz`, {
      method: "HEAD",
    });
    assert.equal(headResponse.status, 200);
    assert.equal(
      headResponse.headers.get("cache-control"),
      "private, no-store",
    );
    assert.equal(await headResponse.text(), "");
  });

  it("never publishes malformed release identity input", async () => {
    const origin = await serve({
      checkDatabase: async () => true,
      isAccepting: () => true,
      releaseSha256: () => "not-a-release-digest",
    });
    const [liveness, readiness] = await Promise.all([
      fetch(`${origin}/api/healthz`),
      fetch(`${origin}/api/readyz`),
    ]);
    assert.equal(liveness.headers.has("x-bidbox-release-sha256"), false);
    assert.equal(readiness.headers.has("x-bidbox-release-sha256"), false);
  });

  it("does not touch the database while starting or draining", async () => {
    let probes = 0;
    const lifecycle = new RuntimeReadiness();
    const origin = await serve({
      checkDatabase: async () => {
        probes += 1;
        return true;
      },
      isAccepting: () => lifecycle.isReady(),
    });
    const starting = await fetch(`${origin}/api/readyz`);
    assert.equal(starting.status, 503);
    assert.deepEqual(await starting.json(), {
      status: "not_ready",
      checks: { lifecycle: "not_ready", database: "not_checked" },
      delivery: { metrics: "disconnected", paging: "disconnected" },
    });
    assert.equal(probes, 0);

    lifecycle.markAccepting();
    const accepting = await fetch(`${origin}/api/readyz`);
    assert.equal(accepting.status, 200);
    assert.equal(probes, 1);

    lifecycle.beginDrain();
    const draining = await fetch(`${origin}/api/readyz`);
    assert.equal(draining.status, 503);
    assert.deepEqual(await draining.json(), {
      status: "not_ready",
      checks: { lifecycle: "not_ready", database: "not_checked" },
      delivery: { metrics: "disconnected", paging: "disconnected" },
    });
    assert.equal(probes, 1);
  });

  it("fails readiness when draining begins during the database probe", async () => {
    const lifecycle = new RuntimeReadiness();
    lifecycle.markAccepting();
    let completeProbe: ((ready: boolean) => void) | undefined;
    let markProbeStarted: (() => void) | undefined;
    const probeStarted = new Promise<void>((resolve) => {
      markProbeStarted = resolve;
    });
    const origin = await serve({
      checkDatabase: () => {
        markProbeStarted?.();
        return new Promise<boolean>((resolve) => {
          completeProbe = resolve;
        });
      },
      isAccepting: () => lifecycle.isReady(),
    });

    const pendingResponse = fetch(`${origin}/api/readyz`);
    await probeStarted;
    lifecycle.beginDrain();
    completeProbe?.(true);

    const response = await pendingResponse;
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      status: "not_ready",
      checks: { lifecycle: "not_ready", database: "not_checked" },
      delivery: { metrics: "disconnected", paging: "disconnected" },
    });
  });

  it("fails closed on database failure and dependency timeout", async () => {
    const failedOrigin = await serve({
      checkDatabase: async () => {
        throw new Error("private database detail");
      },
      isAccepting: () => true,
    });
    const failed = await fetch(`${failedOrigin}/api/readyz`);
    assert.equal(failed.status, 503);
    assert.deepEqual(await failed.json(), {
      status: "not_ready",
      checks: { lifecycle: "ready", database: "not_ready" },
      delivery: { metrics: "disconnected", paging: "disconnected" },
    });

    const timeoutOrigin = await serve({
      checkDatabase: () => new Promise<boolean>(() => {}),
      isAccepting: () => true,
      readinessTimeoutMillis: 10,
    });
    const started = Date.now();
    const timedOut = await fetch(`${timeoutOrigin}/api/readyz`);
    assert.equal(timedOut.status, 503);
    assert(Date.now() - started < 500);
    assert.deepEqual(await timedOut.json(), {
      status: "not_ready",
      checks: { lifecycle: "ready", database: "not_ready" },
      delivery: { metrics: "disconnected", paging: "disconnected" },
    });
  });

  it("keeps liveness dependency-free and route matching exact", async () => {
    let probes = 0;
    const origin = await serve({
      checkDatabase: async () => {
        probes += 1;
        return false;
      },
      isAccepting: () => true,
    });
    const health = await fetch(`${origin}/api/healthz`);
    const nested = await fetch(`${origin}/api/readyz/extra`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: "ok" });
    assert.equal(probes, 0);
    assert.equal(nested.status, 404);
  });
});
