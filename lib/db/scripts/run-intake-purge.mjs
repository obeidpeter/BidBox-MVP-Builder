import { pathToFileURL } from "node:url";
import {
  runMaintenanceCli,
  withMaintenanceSession,
} from "./maintenance-session.mjs";

const LOCK_KEY = 7_104;
const ROLE = /^[a-z][a-z0-9_]{2,62}$/u;

export function intakePurgeConfiguration(environment) {
  if (environment.NODE_ENV !== "production") {
    throw new Error("INTAKE_PURGE_NOT_PRODUCTION");
  }
  if (environment.VALO_MAINTENANCE_EXECUTE !== "confirmed") {
    throw new Error("INTAKE_PURGE_CONFIRMATION_REQUIRED");
  }
  const connectionString = environment.VALO_MAINTENANCE_DATABASE_URL?.trim();
  const expectedRole = environment.VALO_MAINTENANCE_DATABASE_ROLE?.trim();
  if (!connectionString) throw new Error("INTAKE_PURGE_DATABASE_REQUIRED");
  if (!expectedRole || !ROLE.test(expectedRole)) {
    throw new Error("INTAKE_PURGE_ROLE_REQUIRED");
  }
  if (expectedRole === "valo_app_runtime") {
    throw new Error("INTAKE_PURGE_RUNTIME_ROLE_PROHIBITED");
  }
  return { connectionString, expectedRole };
}

async function attestIntakePurgeIdentity(client, expectedRole) {
  const identity = await client.query(
    `SELECT current_user AS current_user,
            session_user AS session_user,
            role.rolsuper,
            role.rolbypassrls,
            pg_catalog.has_function_privilege(
              current_user,
              'valo_intake.purge_expired_bid_autopsy_requests()',
              'EXECUTE'
            ) AS can_purge_requests,
            pg_catalog.has_function_privilege(
              current_user,
              'valo_intake.purge_expired_bid_autopsy_rate_limits()',
              'EXECUTE'
            ) AS can_purge_rate_limits,
            EXISTS (
              SELECT 1
              FROM pg_catalog.pg_class relation
              JOIN pg_catalog.pg_namespace namespace
                ON namespace.oid = relation.relnamespace
              WHERE namespace.nspname = 'valo_intake'
                AND relation.relname IN (
                  'bid_autopsy_requests',
                  'bid_autopsy_rate_limits'
                )
                AND relation.relowner = role.oid
            ) AS owns_intake_table
     FROM pg_catalog.pg_roles role
     WHERE role.rolname = current_user`,
  );
  const proof = identity.rows[0];
  if (
    identity.rowCount !== 1 ||
    proof?.current_user !== expectedRole ||
    proof?.session_user !== expectedRole ||
    proof?.rolsuper !== false ||
    proof?.rolbypassrls !== false ||
    proof?.can_purge_requests !== true ||
    proof?.can_purge_rate_limits !== true ||
    proof?.owns_intake_table !== false
  ) {
    throw new Error("INTAKE_PURGE_IDENTITY_ATTESTATION_FAILED");
  }
}

export async function runIntakePurge(options = {}) {
  const environment = options.environment ?? process.env;
  const { connectionString, expectedRole } =
    intakePurgeConfiguration(environment);
  return withMaintenanceSession(
    {
      applicationName: "bidbox-intake-purge",
      connectionString,
      lockKey: LOCK_KEY,
      pool: options.pool,
      alreadyRunningError: "INTAKE_PURGE_ALREADY_RUNNING",
      attest: (client) => attestIntakePurgeIdentity(client, expectedRole),
    },
    async (client) => {
      const purged = await client.query(
        `SELECT
           valo_intake.purge_expired_bid_autopsy_requests() AS requests,
           valo_intake.purge_expired_bid_autopsy_rate_limits() AS rate_limits`,
      );
      const completedAtUnixSeconds = Math.floor(Date.now() / 1_000);
      return {
        event: "bidbox.intake.expiry_purge",
        purged: {
          rateLimits: Number(purged.rows[0]?.rate_limits ?? 0),
          requests: Number(purged.rows[0]?.requests ?? 0),
        },
        signals: {
          "bidbox.intake.purge_run_success": 1,
          "bidbox.intake.purge_last_success_unixtime_seconds":
            completedAtUnixSeconds,
        },
      };
    },
  );
}

async function main() {
  await runMaintenanceCli({
    run: runIntakePurge,
    errorCodePattern: /^INTAKE_PURGE_[A-Z_]+$/u,
    fallbackCode: "INTAKE_PURGE_OPERATION_FAILED",
    failureEvent: "bidbox.intake.expiry_purge_failed",
    failureSignals: { "bidbox.intake.purge_run_success": 0 },
  });
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  await main();
}
