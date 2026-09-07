import assert from "node:assert/strict";
import test from "node:test";
import {
  intakePurgeConfiguration,
  runIntakePurge,
} from "./run-intake-purge.mjs";

const environment = {
  NODE_ENV: "production",
  VALO_MAINTENANCE_DATABASE_ROLE: "valo_intake_maintenance",
  VALO_MAINTENANCE_DATABASE_URL: "postgresql://example.invalid/bidbox",
  VALO_MAINTENANCE_EXECUTE: "confirmed",
};

test("requires a separately named, explicitly confirmed maintenance identity", () => {
  assert.throws(
    () => intakePurgeConfiguration({ ...environment, NODE_ENV: "test" }),
    /INTAKE_PURGE_NOT_PRODUCTION/u,
  );
  assert.throws(
    () =>
      intakePurgeConfiguration({
        ...environment,
        VALO_MAINTENANCE_EXECUTE: undefined,
      }),
    /INTAKE_PURGE_CONFIRMATION_REQUIRED/u,
  );
  assert.throws(
    () =>
      intakePurgeConfiguration({
        ...environment,
        VALO_MAINTENANCE_DATABASE_ROLE: "valo_app_runtime",
      }),
    /INTAKE_PURGE_RUNTIME_ROLE_PROHIBITED/u,
  );
});

test("attests a non-owner role, serialises the purge, and emits bounded evidence", async () => {
  const queries = [];
  const client = {
    async query(source, parameters) {
      queries.push({ source, parameters });
      if (/SELECT current_user/u.test(source)) {
        return {
          rowCount: 1,
          rows: [
            {
              can_purge_rate_limits: true,
              can_purge_requests: true,
              current_user: "valo_intake_maintenance",
              owns_intake_table: false,
              rolbypassrls: false,
              rolsuper: false,
              session_user: "valo_intake_maintenance",
            },
          ],
        };
      }
      if (/pg_try_advisory_lock/u.test(source)) {
        return { rowCount: 1, rows: [{ locked: true }] };
      }
      if (/purge_expired_bid_autopsy_requests/u.test(source)) {
        return { rowCount: 1, rows: [{ rate_limits: 9, requests: 3 }] };
      }
      return { rowCount: 1, rows: [{ pg_advisory_unlock: true }] };
    },
    release() {},
  };
  const result = await runIntakePurge({
    environment,
    pool: { connect: async () => client },
  });

  assert.deepEqual(result.purged, { rateLimits: 9, requests: 3 });
  assert.equal(result.signals["bidbox.intake.purge_run_success"], 1);
  assert.ok(
    Number.isSafeInteger(
      result.signals["bidbox.intake.purge_last_success_unixtime_seconds"],
    ),
  );
  assert.equal(
    queries.filter(({ source }) => /\bBEGIN\b/u.test(source)).length,
    1,
  );
  assert.equal(
    queries.filter(({ source }) => /\bCOMMIT\b/u.test(source)).length,
    1,
  );
  assert.equal(
    queries.filter(({ source }) => /pg_advisory_unlock/u.test(source)).length,
    1,
  );
});

test("fails closed before mutation when the connected identity is privileged", async () => {
  const queries = [];
  const client = {
    async query(source) {
      queries.push(source);
      return {
        rowCount: 1,
        rows: [
          {
            can_purge_rate_limits: true,
            can_purge_requests: true,
            current_user: "valo_intake_maintenance",
            owns_intake_table: false,
            rolbypassrls: false,
            rolsuper: true,
            session_user: "valo_intake_maintenance",
          },
        ],
      };
    },
    release() {},
  };
  await assert.rejects(
    runIntakePurge({ environment, pool: { connect: async () => client } }),
    /INTAKE_PURGE_IDENTITY_ATTESTATION_FAILED/u,
  );
  assert.equal(
    queries.some((source) =>
      /purge_expired_bid_autopsy_requests/u.test(source),
    ),
    true,
    "identity query contains the function name but must not execute it",
  );
  assert.equal(
    queries.some((source) => /^BEGIN$/u.test(source)),
    false,
  );
});
