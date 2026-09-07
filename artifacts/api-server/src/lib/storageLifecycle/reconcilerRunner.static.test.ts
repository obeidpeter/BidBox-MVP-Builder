import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const runner = readFileSync(
  new URL(
    "../../../scripts/run-storage-deletion-reconciler.ts",
    import.meta.url,
  ),
  "utf8",
);

test("full-cycle evidence carries every incomplete page across invocations", () => {
  assert.match(runner, /storage_lifecycle_cycle_incomplete/u);
  assert.match(
    runner,
    /advanceDurableCycleEvidence\(\{[\s\S]*carriedIncomplete: cycleIncompleteBefore,[\s\S]*invocationIncomplete,[\s\S]*cycleComplete: result\.cycleComplete/u,
  );
  for (const incompleteSignal of [
    "result.tenantFailures > 0",
    "result.intentFailures > 0",
    "result.tenantPagesRemaining > 0",
    "result.uploadLeasePagesRemaining > 0",
    "result.terminalRetentionPagesRemaining > 0",
    "result.runBudgetExhausted",
  ]) {
    assert.ok(runner.includes(incompleteSignal), incompleteSignal);
  }
  assert.match(
    runner,
    /"bidbox\.storage\.deletion_sample_complete":\s*fullCycleComplete \? 1 : 0/u,
  );
  assert.match(
    runner,
    /RETURNING pg_catalog\.clock_timestamp\(\) AS "completedAt"/u,
  );
  assert.doesNotMatch(runner, /Date\.now\(\)/u);
});
