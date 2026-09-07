import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createIdempotentAsyncCloser,
  createRuntimePoolConfig,
  createSingleFlightReadinessProbe,
} from "./poolConfig";

const connectionString = "postgresql://runtime:secret@db.example/bidbox";

describe("runtime database pool configuration", () => {
  it("applies conservative connection, query and session budgets", () => {
    const config = createRuntimePoolConfig(connectionString, {});

    assert.deepEqual(config, {
      application_name: "bidbox-api",
      connectionString,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      idle_in_transaction_session_timeout: 300_000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10_000,
      lock_timeout: 5_000,
      max: 10,
      maxLifetimeSeconds: 1_800,
      query_timeout: 35_000,
      statement_timeout: 30_000,
    });
  });

  it("accepts bounded overrides", () => {
    const config = createRuntimePoolConfig(connectionString, {
      VALO_DB_CONNECTION_TIMEOUT_MS: "2500",
      VALO_DB_IDLE_TRANSACTION_TIMEOUT_MS: "120000",
      VALO_DB_LOCK_TIMEOUT_MS: "2000",
      VALO_DB_POOL_IDLE_TIMEOUT_MS: "45000",
      VALO_DB_POOL_MAX: "16",
      VALO_DB_POOL_MAX_LIFETIME_SECONDS: "900",
      VALO_DB_QUERY_TIMEOUT_MS: "45000",
      VALO_DB_STATEMENT_TIMEOUT_MS: "40000",
    });

    assert.equal(config.max, 16);
    assert.equal(config.query_timeout, 45_000);
    assert.equal(config.statement_timeout, 40_000);
    assert.equal(config.idle_in_transaction_session_timeout, 120_000);
  });

  it("fails startup on malformed, unsafe or contradictory budgets", () => {
    assert.throws(
      () =>
        createRuntimePoolConfig(connectionString, { VALO_DB_POOL_MAX: "0" }),
      /VALO_DB_POOL_MAX must be between 2 and 100/u,
    );
    assert.throws(
      () =>
        createRuntimePoolConfig(connectionString, {
          VALO_DB_QUERY_TIMEOUT_MS: "many",
        }),
      /VALO_DB_QUERY_TIMEOUT_MS must be a whole number/u,
    );
    assert.throws(
      () =>
        createRuntimePoolConfig(connectionString, {
          VALO_DB_QUERY_TIMEOUT_MS: "10000",
          VALO_DB_STATEMENT_TIMEOUT_MS: "20000",
        }),
      /query_timeout_ms must be greater/iu,
    );
    assert.throws(
      () =>
        createRuntimePoolConfig(
          `${connectionString}?sslmode=require&statement_timeout=0`,
          {},
        ),
      /Database URL cannot override runtime connection or query budgets/u,
    );
    assert.doesNotThrow(() =>
      createRuntimePoolConfig(`${connectionString}?sslmode=require`, {}),
    );
  });

  it("keeps a timed-out readiness query single-flight until it settles", async (context) => {
    let finish: (() => void) | undefined;
    let runs = 0;
    const dependencyHandles = new Set<NodeJS.Timeout>();
    context.after(() => {
      for (const handle of dependencyHandles) clearInterval(handle);
    });
    const check = createSingleFlightReadinessProbe(
      () =>
        new Promise<void>((resolve) => {
          runs += 1;
          // A real database request keeps a socket referenced while it is in
          // flight. Model that here so the probe's intentionally unref'ed
          // deadline timer can fire when this test runs in isolation.
          const dependencyHandle = setInterval(() => undefined, 60_000);
          dependencyHandles.add(dependencyHandle);
          finish = () => {
            clearInterval(dependencyHandle);
            dependencyHandles.delete(dependencyHandle);
            resolve();
          };
        }),
      { cacheMillis: 0 },
    );

    assert.deepEqual(await Promise.all([check(5), check(5), check(5)]), [
      false,
      false,
      false,
    ]);
    assert.equal(runs, 1);
    finish?.();
    await new Promise<void>((resolve) => setImmediate(resolve));

    const secondGeneration = check(5);
    assert.equal(runs, 2);
    finish?.();
    assert.equal(await secondGeneration, true);
  });

  it("bounds rapid sequential readiness checks with a short result TTL", async () => {
    let now = 10_000;
    let runs = 0;
    const check = createSingleFlightReadinessProbe(
      async () => {
        runs += 1;
        throw new Error("dependency unavailable");
      },
      { cacheMillis: 1_000, now: () => now },
    );

    assert.deepEqual(await Promise.all([check(50), check(50), check(50)]), [
      false,
      false,
      false,
    ]);
    assert.equal(runs, 1);
    assert.equal(await check(50), false);
    assert.equal(runs, 1);

    now += 1_001;
    assert.equal(await check(50), false);
    assert.equal(runs, 2);
  });

  it("closes a pool only once when shutdown callers race", async () => {
    let closes = 0;
    const close = createIdempotentAsyncCloser(async () => {
      closes += 1;
    });
    const first = close();
    const second = close();
    assert.equal(first, second);
    await Promise.all([first, second]);
    assert.equal(closes, 1);
  });
});
