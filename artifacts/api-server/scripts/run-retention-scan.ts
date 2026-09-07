/**
 * Durable scheduled retention discovery. Every invocation owns one bounded
 * rotating organisation page; it opens requests only and never deletes data.
 */
import { assertRuntimeDatabaseSecurity, pool } from "@workspace/db";
import { randomUUID } from "node:crypto";
import { APP_CONFIG_ID } from "../src/lib/appConfig";
import { advanceDurableCycleEvidence } from "../src/lib/durableCycleEvidence";
import { runRetentionScan } from "../src/lib/retentionScan";

const RETENTION_SCAN_RUN_LOCK = 894_721_307;
const RETENTION_SCAN_LEASE_MINUTES = 10;

async function main(): Promise<number> {
  await assertRuntimeDatabaseSecurity();
  const runOwner = randomUUID();
  const client = await pool.connect();
  let advisoryLockHeld = false;
  let result;
  let authoritativeNow: Date | null = null;
  let durableFullCycleComplete = false;
  let cycleIncompleteBefore = false;
  let cycleIncompleteAfter = false;
  let completedAtUnixSeconds: number | null = null;
  try {
    const lock = await client.query<{ locked: boolean }>(
      "SELECT pg_catalog.pg_try_advisory_lock($1) AS locked",
      [RETENTION_SCAN_RUN_LOCK],
    );
    advisoryLockHeld = lock.rows[0]?.locked === true;
    if (!advisoryLockHeld) throw new Error("retention scan is already running");
    await client.query(
      "INSERT INTO app_config (id) VALUES ($1) ON CONFLICT (id) DO NOTHING",
      [APP_CONFIG_ID],
    );
    const claimed = await client.query<{
      cursor: string | null;
      cycleIncomplete: boolean;
    }>(
      `UPDATE app_config
         SET retention_scan_lease_owner = $2,
             retention_scan_lease_expires_at =
               pg_catalog.clock_timestamp() + ($3 * interval '1 minute')
       WHERE id = $1
         AND (retention_scan_lease_expires_at IS NULL
           OR retention_scan_lease_expires_at <= pg_catalog.clock_timestamp()
           OR retention_scan_lease_owner = $2)
       RETURNING retention_scan_cursor_organisation_id AS cursor,
         retention_scan_cycle_incomplete AS "cycleIncomplete"`,
      [APP_CONFIG_ID, runOwner, RETENTION_SCAN_LEASE_MINUTES],
    );
    if (claimed.rowCount !== 1) {
      throw new Error("retention scan durable lease is already held");
    }
    cycleIncompleteBefore = claimed.rows[0]?.cycleIncomplete === true;
    const authorityClock = await client.query<{ now: Date }>(
      "SELECT pg_catalog.clock_timestamp() AS now",
    );
    authoritativeNow = new Date(authorityClock.rows[0]?.now ?? "");
    if (!Number.isFinite(authoritativeNow.valueOf())) {
      throw new Error("retention scan database clock is unavailable");
    }
    result = await runRetentionScan({
      now: authoritativeNow,
      afterOrganisationId: claimed.rows[0]?.cursor ?? null,
    });
    const invocationIncomplete =
      result.tenantFailures > 0 ||
      result.tenantPagesRemaining > 0 ||
      result.missingConclusionAnchors > 0 ||
      result.missingConclusionAnchorPagesRemaining > 0;
    const cycleEvidence = advanceDurableCycleEvidence({
      carriedIncomplete: cycleIncompleteBefore,
      invocationIncomplete,
      cycleComplete: result.cycleComplete,
    });
    durableFullCycleComplete = cycleEvidence.fullCycleComplete;
    cycleIncompleteAfter = cycleEvidence.nextCycleIncomplete;
    const released = await client.query<{ completedAt: Date }>(
      `UPDATE app_config
         SET retention_scan_cursor_organisation_id = $3,
             retention_scan_cycle_incomplete = $4,
             retention_scan_lease_owner = NULL,
             retention_scan_lease_expires_at = NULL
       WHERE id = $1 AND retention_scan_lease_owner = $2
       RETURNING pg_catalog.clock_timestamp() AS "completedAt"`,
      [
        APP_CONFIG_ID,
        runOwner,
        result.nextOrganisationCursor,
        cycleIncompleteAfter,
      ],
    );
    if (released.rowCount !== 1) {
      throw new Error("retention scan cursor update was not persisted");
    }
    const completedAt = new Date(released.rows[0]?.completedAt ?? "");
    if (!Number.isFinite(completedAt.valueOf())) {
      throw new Error("retention scan completion clock is unavailable");
    }
    completedAtUnixSeconds = Math.floor(completedAt.valueOf() / 1_000);
  } finally {
    if (advisoryLockHeld) {
      await client
        .query("SELECT pg_catalog.pg_advisory_unlock($1)", [
          RETENTION_SCAN_RUN_LOCK,
        ])
        .catch(() => {});
    }
    client.release();
  }
  if (!result || !authoritativeNow || completedAtUnixSeconds === null) {
    throw new Error("retention scan did not run with an authoritative clock");
  }
  const successful = result.tenantFailures === 0;
  const fullCycleComplete = successful && durableFullCycleComplete;
  console.log(
    JSON.stringify({
      event: "bidbox.retention.discovery_scan",
      cycleEvidenceIncompleteBefore: cycleIncompleteBefore,
      cycleEvidenceIncompleteAfter: cycleIncompleteAfter,
      cycleComplete: result.cycleComplete,
      missingConclusionAnchors: result.missingConclusionAnchors,
      missingConclusionAnchorPagesRemaining:
        result.missingConclusionAnchorPagesRemaining,
      opened: result.opened.length,
      organisationPageTruncated: result.organisationPageTruncated,
      organisationsScanned: result.organisationsScanned,
      scanned: result.scanned,
      skippedExisting: result.skippedExisting,
      tenantFailures: result.tenantFailures,
      tenantPagesRemaining: result.tenantPagesRemaining,
      signals: {
        "bidbox.retention.missing_conclusion_anchors":
          result.missingConclusionAnchors,
        "bidbox.retention.tenant_failures": result.tenantFailures,
        "bidbox.retention.cycle_complete": fullCycleComplete ? 1 : 0,
        "bidbox.retention.scan_run_success": successful ? 1 : 0,
        ...(successful
          ? {
              "bidbox.retention.scan_last_success_unixtime_seconds":
                completedAtUnixSeconds,
            }
          : {}),
        ...(fullCycleComplete
          ? {
              "bidbox.retention.scan_last_full_cycle_unixtime_seconds":
                completedAtUnixSeconds,
            }
          : {}),
      },
    }),
  );
  return result.tenantFailures > 0 ? 1 : 0;
}

main()
  .then(async (code) => {
    await pool.end();
    process.exit(code);
  })
  .catch(async () => {
    console.error(
      JSON.stringify({
        error: "RETENTION_SCAN_FAILED",
        event: "bidbox.retention.discovery_scan_failed",
        signals: { "bidbox.retention.scan_run_success": 0 },
      }),
    );
    await pool.end().catch(() => {});
    process.exit(1);
  });
