import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const scan = readFileSync(
  new URL("./retentionScan.ts", import.meta.url),
  "utf8",
);
const runner = readFileSync(
  new URL("../../scripts/run-retention-scan.ts", import.meta.url),
  "utf8",
);
const reports = readFileSync(
  new URL("../routes/reports.ts", import.meta.url),
  "utf8",
);

test("retention discovery is bounded, rotating and anchored to conclusion", () => {
  assert.match(scan, /const ORGANISATION_PAGE = 10/u);
  assert.match(scan, /const PER_TENANT_PROJECT_PAGE = 100/u);
  assert.match(scan, /projects\.concludedAt/u);
  assert.match(scan, /isNotNull\(projects\.concludedAt\)/u);
  assert.doesNotMatch(scan, /relevantDate:\s*p\.createdAt/u);
  assert.match(scan, /missingConclusionAnchors/u);
  assert.match(scan, /nextOrganisationCursor/u);
  assert.doesNotMatch(scan, /organisations\.status/u);
  assert.match(reports, /SELECT pg_catalog\.clock_timestamp\(\) AS now/u);
  assert.match(reports, /concludedAt: signed\.signedOffAt/u);
  assert.match(
    reports,
    /eventType: "report\.signed_off"[\s\S]*createdAt: signedOffAt/u,
  );
});

test("scheduled runner owns a durable lease and persists its cursor", () => {
  assert.match(runner, /pg_try_advisory_lock/u);
  assert.match(runner, /retention_scan_lease_owner/u);
  assert.match(runner, /retention_scan_lease_expires_at/u);
  assert.match(runner, /retention_scan_cursor_organisation_id/u);
  assert.match(runner, /retention_scan_cycle_incomplete/u);
  assert.match(runner, /SELECT pg_catalog\.clock_timestamp\(\) AS now/u);
  assert.match(
    runner,
    /advanceDurableCycleEvidence\(\{[\s\S]*carriedIncomplete: cycleIncompleteBefore,[\s\S]*invocationIncomplete,[\s\S]*cycleComplete: result\.cycleComplete/u,
  );
  assert.match(
    runner,
    /result\.tenantPagesRemaining > 0[\s\S]*result\.missingConclusionAnchors > 0[\s\S]*result\.missingConclusionAnchorPagesRemaining > 0/u,
  );
  assert.match(
    runner,
    /RETURNING pg_catalog\.clock_timestamp\(\) AS "completedAt"/u,
  );
  assert.match(runner, /bidbox\.retention\.missing_conclusion_anchors/u);
});
