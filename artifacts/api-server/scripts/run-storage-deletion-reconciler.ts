/**
 * Durable first-party object deletion reconciler. Run from a scheduled
 * deployment; each invocation takes one bounded rotating tenant page.
 * It never sends a message or follows a user-supplied URL.
 */
import { assertRuntimeDatabaseSecurity, pool } from "@workspace/db";
import { randomUUID } from "node:crypto";
import { APP_CONFIG_ID } from "../src/lib/appConfig";
import { advanceDurableCycleEvidence } from "../src/lib/durableCycleEvidence";
import { runStorageDeletionReconciliation } from "../src/lib/storageLifecycle/reconciler";

const STORAGE_LIFECYCLE_RUN_LOCK = 894_721_306;
const STORAGE_LIFECYCLE_LEASE_MINUTES = 10;

async function main(): Promise<number> {
  await assertRuntimeDatabaseSecurity();
  const runOwner = randomUUID();
  const client = await pool.connect();
  let lockAcquired = false;
  let result;
  let durableFullCycleComplete = false;
  let cycleIncompleteBefore = false;
  let cycleIncompleteAfter = false;
  let completedAtUnixSeconds: number | null = null;
  try {
    const lock = await client.query<{ locked: boolean }>(
      "SELECT pg_catalog.pg_try_advisory_lock($1) AS locked",
      [STORAGE_LIFECYCLE_RUN_LOCK],
    );
    lockAcquired = lock.rows[0]?.locked === true;
    if (!lockAcquired) {
      throw new Error("storage lifecycle reconciliation is already running");
    }
    await client.query(
      "INSERT INTO app_config (id) VALUES ($1) ON CONFLICT (id) DO NOTHING",
      [APP_CONFIG_ID],
    );
    const claimed = await client.query<{
      cursor: string | null;
      cycleIncomplete: boolean;
    }>(
      `UPDATE app_config
         SET storage_lifecycle_lease_owner = $2,
             storage_lifecycle_lease_expires_at =
               pg_catalog.clock_timestamp() + ($3 * interval '1 minute')
       WHERE id = $1
         AND (storage_lifecycle_lease_expires_at IS NULL
           OR storage_lifecycle_lease_expires_at <= pg_catalog.clock_timestamp()
           OR storage_lifecycle_lease_owner = $2)
       RETURNING storage_lifecycle_cursor_organisation_id AS cursor,
         storage_lifecycle_cycle_incomplete AS "cycleIncomplete"`,
      [APP_CONFIG_ID, runOwner, STORAGE_LIFECYCLE_LEASE_MINUTES],
    );
    if (claimed.rowCount !== 1) {
      throw new Error("storage lifecycle durable lease is already held");
    }
    cycleIncompleteBefore = claimed.rows[0]?.cycleIncomplete === true;
    result = await runStorageDeletionReconciliation(undefined, {
      afterOrganisationId: claimed.rows[0]?.cursor ?? null,
    });
    const invocationIncomplete =
      result.tenantFailures > 0 ||
      result.intentFailures > 0 ||
      result.tenantPagesRemaining > 0 ||
      result.uploadLeasePagesRemaining > 0 ||
      result.terminalRetentionPagesRemaining > 0 ||
      result.runBudgetExhausted;
    const cycleEvidence = advanceDurableCycleEvidence({
      carriedIncomplete: cycleIncompleteBefore,
      invocationIncomplete,
      cycleComplete: result.cycleComplete,
    });
    durableFullCycleComplete = cycleEvidence.fullCycleComplete;
    cycleIncompleteAfter = cycleEvidence.nextCycleIncomplete;
    const released = await client.query<{ completedAt: Date }>(
      `UPDATE app_config
         SET storage_lifecycle_cursor_organisation_id = $3,
             storage_lifecycle_cycle_incomplete = $4,
             storage_lifecycle_lease_owner = NULL,
             storage_lifecycle_lease_expires_at = NULL
       WHERE id = $1 AND storage_lifecycle_lease_owner = $2
       RETURNING pg_catalog.clock_timestamp() AS "completedAt"`,
      [
        APP_CONFIG_ID,
        runOwner,
        result.nextOrganisationCursor,
        cycleIncompleteAfter,
      ],
    );
    if (released.rowCount !== 1) {
      throw new Error("storage lifecycle cursor update was not persisted");
    }
    const completedAt = new Date(released.rows[0]?.completedAt ?? "");
    if (!Number.isFinite(completedAt.valueOf())) {
      throw new Error("storage lifecycle database clock is unavailable");
    }
    completedAtUnixSeconds = Math.floor(completedAt.valueOf() / 1_000);
  } finally {
    if (lockAcquired) {
      await client
        .query("SELECT pg_catalog.pg_advisory_unlock($1)", [
          STORAGE_LIFECYCLE_RUN_LOCK,
        ])
        .catch(() => {});
    }
    client.release();
  }
  if (!result || completedAtUnixSeconds === null) {
    throw new Error("storage lifecycle reconciliation did not run");
  }
  const successful = result.tenantFailures === 0 && result.intentFailures === 0;
  const fullCycleComplete = successful && durableFullCycleComplete;
  console.log(
    JSON.stringify({
      event: "bidbox.storage.deletion_reconciliation",
      cancelled: result.cancelled,
      completed: result.completed,
      completedLeaseCleanupQueued: result.completedLeaseCleanupQueued,
      cycleEvidenceIncompleteBefore: cycleIncompleteBefore,
      cycleEvidenceIncompleteAfter: cycleIncompleteAfter,
      cycleComplete: result.cycleComplete,
      deadLetter: result.deadLetter,
      intentFailures: result.intentFailures,
      intentsConsidered: result.intentsConsidered,
      oldestPendingAgeSeconds: result.oldestPendingAgeSeconds,
      organisationPageTruncated: result.organisationPageTruncated,
      organisationsScanned: result.organisationsScanned,
      quarantinedLeaseCleanupQueued: result.quarantinedLeaseCleanupQueued,
      rejectedLeaseCleanupQueued: result.rejectedLeaseCleanupQueued,
      replayed: result.replayed,
      retryWait: result.retryWait,
      runBudgetExhausted: result.runBudgetExhausted,
      tenantFailures: result.tenantFailures,
      tenantPagesRemaining: result.tenantPagesRemaining,
      terminalRetentionPagesRemaining: result.terminalRetentionPagesRemaining,
      terminalRowsConsidered: result.terminalRowsConsidered,
      terminalRowsPurged: result.terminalRowsPurged,
      unconfirmedLeaseCleanupQueued: result.unconfirmedLeaseCleanupQueued,
      uploadLeasePagesRemaining: result.uploadLeasePagesRemaining,
      uploadLeasesConsidered: result.uploadLeasesConsidered,
      uploadLeasesExpired: result.uploadLeasesExpired,
      signals: {
        "bidbox.storage.deletion_dead_letter_transitions": result.deadLetter,
        "bidbox.storage.deletion_oldest_sampled_age_seconds":
          result.oldestPendingAgeSeconds,
        "bidbox.storage.deletion_sample_complete": fullCycleComplete ? 1 : 0,
        "bidbox.storage.deletion_run_success": successful ? 1 : 0,
        ...(successful
          ? {
              "bidbox.storage.deletion_last_success_unixtime_seconds":
                completedAtUnixSeconds,
            }
          : {}),
        ...(fullCycleComplete
          ? {
              "bidbox.storage.deletion_last_full_cycle_unixtime_seconds":
                completedAtUnixSeconds,
            }
          : {}),
      },
    }),
  );
  return result.tenantFailures > 0 || result.intentFailures > 0 ? 1 : 0;
}

main()
  .then(async (code) => {
    await pool.end();
    process.exit(code);
  })
  .catch(async () => {
    console.error(
      JSON.stringify({
        error: "STORAGE_DELETION_RECONCILIATION_FAILED",
        event: "bidbox.storage.deletion_reconciliation_failed",
        signals: { "bidbox.storage.deletion_run_success": 0 },
      }),
    );
    await pool.end().catch(() => {});
    process.exit(1);
  });
