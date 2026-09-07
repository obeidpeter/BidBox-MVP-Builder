import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  authenticatedRateLimitPurgeConfiguration,
  runAuthenticatedRateLimitPurge,
} from "./run-authenticated-rate-limit-purge.mjs";

const migration = readFileSync(
  new URL("../migrations/0008_production_assurance.sql", import.meta.url),
  "utf8",
);
const purgeBody = migration.match(
  /CREATE FUNCTION valo_security\.purge_expired_authenticated_rate_limit_buckets\(\)[\s\S]*?AS \$function\$\r?\n([\s\S]*?)\r?\n\$function\$;/u,
)?.[1];
assert.ok(purgeBody);

const environment = {
  NODE_ENV: "production",
  VALO_AUTH_RATE_LIMIT_MAINTENANCE_EXECUTE: "confirmed",
  VALO_MAINTENANCE_DATABASE_OWNER_ROLE: "bidbox_database_owner",
  VALO_MAINTENANCE_DATABASE_URL: "postgresql://example.invalid/bidbox",
};

function ownerProof(overrides = {}) {
  return {
    can_execute: true,
    current_user: "bidbox_database_owner",
    actor_table_owner: "bidbox_database_owner",
    function_contract_valid: true,
    function_owner: "bidbox_database_owner",
    function_source: purgeBody,
    public_can_access_actor_table: false,
    rolbypassrls: true,
    rolsuper: false,
    runtime_can_execute: false,
    runtime_can_access_actor_table: false,
    session_user: "bidbox_database_owner",
    table_owner: "bidbox_database_owner",
    ...overrides,
  };
}

test("requires an explicitly confirmed owner identity distinct from runtime", () => {
  assert.throws(
    () =>
      authenticatedRateLimitPurgeConfiguration({
        ...environment,
        VALO_AUTH_RATE_LIMIT_MAINTENANCE_EXECUTE: undefined,
      }),
    /AUTH_RATE_LIMIT_PURGE_CONFIRMATION_REQUIRED/u,
  );
  assert.throws(
    () =>
      authenticatedRateLimitPurgeConfiguration({
        ...environment,
        VALO_MAINTENANCE_DATABASE_OWNER_ROLE: "valo_app_runtime",
      }),
    /AUTH_RATE_LIMIT_PURGE_RUNTIME_ROLE_PROHIBITED/u,
  );
});

test("attests owner and runtime denial before one bounded purge page", async () => {
  const queries = [];
  const client = {
    async query(source, parameters) {
      queries.push({ source, parameters });
      if (/SELECT current_user/u.test(source)) {
        return { rowCount: 1, rows: [ownerProof()] };
      }
      if (/pg_try_advisory_lock/u.test(source)) {
        return { rowCount: 1, rows: [{ locked: true }] };
      }
      if (/clock_timestamp/u.test(source)) {
        return {
          rowCount: 1,
          rows: [{ cutoff: new Date("2026-08-13T12:00:00.000Z") }],
        };
      }
      if (/^SELECT valo_security\.purge_expired/u.test(source.trim())) {
        return { rowCount: 1, rows: [{ purged: "1000" }] };
      }
      if (/authenticated_rate_limit_buckets bucket/u.test(source)) {
        return { rowCount: 1, rows: [{ exists: true }] };
      }
      return { rowCount: 1, rows: [{ pg_advisory_unlock: true }] };
    },
    release() {},
  };
  const result = await runAuthenticatedRateLimitPurge({
    environment,
    pool: { connect: async () => client },
  });

  assert.equal(result.purgedRows, 1000);
  assert.equal(result.cycleComplete, false);
  assert.equal(
    result.signals["bidbox.authenticated_rate_limit.purge_cycle_complete"],
    0,
  );
  assert.equal(
    "bidbox.authenticated_rate_limit.purge_last_full_cycle_unixtime_seconds" in
      result.signals,
    false,
  );
  assert.equal(
    queries.filter(({ source }) => /pg_advisory_unlock/u.test(source)).length,
    1,
  );
});

test("does not claim a full cycle while an expired row remains after SKIP LOCKED", async () => {
  const client = {
    async query(source) {
      if (/SELECT current_user/u.test(source)) {
        return { rowCount: 1, rows: [ownerProof()] };
      }
      if (/pg_try_advisory_lock/u.test(source)) {
        return { rowCount: 1, rows: [{ locked: true }] };
      }
      if (/clock_timestamp/u.test(source)) {
        return {
          rowCount: 1,
          rows: [{ cutoff: new Date("2026-08-13T12:00:00.000Z") }],
        };
      }
      if (/^SELECT valo_security\.purge_expired/u.test(source.trim())) {
        return { rowCount: 1, rows: [{ purged: "0" }] };
      }
      if (/authenticated_rate_limit_buckets bucket/u.test(source)) {
        return { rowCount: 1, rows: [{ exists: true }] };
      }
      return { rowCount: 1, rows: [{ pg_advisory_unlock: true }] };
    },
    release() {},
  };
  const result = await runAuthenticatedRateLimitPurge({
    environment,
    pool: { connect: async () => client },
  });
  assert.equal(result.purgedRows, 0);
  assert.equal(result.cycleComplete, false);
  assert.equal(
    "bidbox.authenticated_rate_limit.purge_last_full_cycle_unixtime_seconds" in
      result.signals,
    false,
  );
});

test("fails before locking when runtime can execute the owner-only function", async () => {
  const queries = [];
  const client = {
    async query(source) {
      queries.push(source);
      return {
        rowCount: 1,
        rows: [ownerProof({ runtime_can_execute: true })],
      };
    },
    release() {},
  };
  await assert.rejects(
    runAuthenticatedRateLimitPurge({
      environment,
      pool: { connect: async () => client },
    }),
    /AUTH_RATE_LIMIT_PURGE_IDENTITY_ATTESTATION_FAILED/u,
  );
  assert.equal(
    queries.some((source) => /pg_try_advisory_lock/u.test(source)),
    false,
  );
});

test("fails before locking when the privileged routine or actor table drifts", async () => {
  for (const override of [
    { function_contract_valid: false },
    { function_source: `${purgeBody}\n-- drift` },
    { runtime_can_access_actor_table: true },
    { public_can_access_actor_table: true },
    { actor_table_owner: "unexpected_owner" },
  ]) {
    const queries = [];
    const client = {
      async query(source) {
        queries.push(source);
        return { rowCount: 1, rows: [ownerProof(override)] };
      },
      release() {},
    };
    await assert.rejects(
      runAuthenticatedRateLimitPurge({
        environment,
        pool: { connect: async () => client },
      }),
      /AUTH_RATE_LIMIT_PURGE_IDENTITY_ATTESTATION_FAILED/u,
    );
    assert.equal(
      queries.some((source) => /pg_try_advisory_lock/u.test(source)),
      false,
    );
  }
});
