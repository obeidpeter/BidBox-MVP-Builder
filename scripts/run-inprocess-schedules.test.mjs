import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
  IN_PROCESS_SCHEDULES_ENVIRONMENT_KEY,
  createInProcessScheduleRunner,
  createScheduledCommandRunner,
  parseSupportedCron,
  readScheduleManifest,
  selectInProcessJobs,
} from "./run-inprocess-schedules.mjs";

const manifest = await readScheduleManifest();

function environmentSelecting(value) {
  return { [IN_PROCESS_SCHEDULES_ENVIRONMENT_KEY]: value };
}

test("cron support is limited to exact-minute daily and hourly shapes", () => {
  assert.deepEqual(parseSupportedCron("15 1 * * *"), { minute: 15, hour: 1 });
  assert.deepEqual(parseSupportedCron("15 * * * *"), {
    minute: 15,
    hour: null,
  });
  assert.equal(parseSupportedCron("*/15 * * * *"), null);
  assert.equal(parseSupportedCron("5 * * * 1"), null);
  assert.equal(parseSupportedCron("61 * * * *"), null);
  assert.equal(parseSupportedCron(""), null);
});

test("no opt-in selects nothing", () => {
  assert.deepEqual(selectInProcessJobs(manifest, {}), []);
  assert.deepEqual(
    selectInProcessJobs(manifest, environmentSelecting("  ")),
    [],
  );
});

test("only ready_for_platform_install jobs can be selected", () => {
  const jobs = selectInProcessJobs(
    manifest,
    environmentSelecting(
      "retention_request_scan,authenticated-rate-limit-bucket-purge",
    ),
  );
  assert.deepEqual(
    jobs.map((job) => job.id),
    ["retention_request_scan", "authenticated-rate-limit-bucket-purge"],
  );
  for (const blocked of [
    "storage_deletion_reconciliation",
    "public_intake_expiry_purge",
    "audit_anchor_evidence_verification",
    "backup_evidence_verification",
  ]) {
    assert.throws(
      () => selectInProcessJobs(manifest, environmentSelecting(blocked)),
      /prerequisites cannot be waived/u,
      blocked,
    );
  }
  assert.throws(
    () => selectInProcessJobs(manifest, environmentSelecting("no_such_job")),
    /unknown in-process schedule id/u,
  );
  assert.throws(
    () =>
      selectInProcessJobs(
        manifest,
        environmentSelecting("retention_request_scan,retention_request_scan"),
      ),
    /duplicate/u,
  );
});

test("firing matches UTC minutes, forbids overlap, and logs receipts", async () => {
  const receipts = [];
  let resolveRun;
  const running = new Promise((r) => {
    resolveRun = r;
  });
  const runner = createInProcessScheduleRunner({
    manifest,
    environment: environmentSelecting("authenticated-rate-limit-bucket-purge"),
    runCommand: () => running,
    log: (line) => receipts.push(JSON.parse(line)),
  });

  // Off-minute: nothing fires.
  await runner.tick(new Date("2026-08-13T10:14:00.000Z"));
  assert.equal(receipts.length, 0);

  // Due minute: fires once, and a repeat tick in the same minute is a no-op.
  const first = runner.tick(new Date("2026-08-13T10:15:00.000Z"));
  await Promise.resolve();
  const second = runner.tick(new Date("2026-08-13T10:15:20.000Z"));
  await second;

  // Next hour while still running: concurrency forbid records a skip.
  await runner.tick(new Date("2026-08-13T11:15:00.000Z"));
  assert.deepEqual(
    receipts.map((receipt) => receipt.event),
    ["started", "skipped_still_running"],
  );

  resolveRun({ exitCode: 0, failedToSpawn: false });
  await first;
  assert.deepEqual(
    receipts.map((receipt) => receipt.event),
    ["started", "skipped_still_running", "completed"],
  );
  assert.equal(receipts.at(-1).succeeded, true);
  assert.equal(receipts.at(-1).jobId, "authenticated-rate-limit-bucket-purge");

  // A later due minute fires again after completion.
  await runner.tick(new Date("2026-08-13T12:15:00.000Z"));
  assert.equal(
    receipts.filter((receipt) => receipt.event === "completed").length,
    2,
  );
});

test("a failing command is recorded, never thrown into the server", async () => {
  const receipts = [];
  const runner = createInProcessScheduleRunner({
    manifest,
    environment: environmentSelecting("retention_request_scan"),
    runCommand: async () => ({ exitCode: 1, failedToSpawn: false }),
    log: (line) => receipts.push(JSON.parse(line)),
  });
  await runner.tick(new Date("2026-08-13T01:15:00.000Z"));
  const completed = receipts.find((receipt) => receipt.event === "completed");
  assert.equal(completed.succeeded, false);
  assert.equal(completed.exitCode, 1);
});

test("delayed children retain only the runtime credential and a credential-free owner target", async () => {
  const ownerPassword = "owner-secret-never-retained";
  const runtimePassword = "runtime-secret-required-by-child";
  const environment = {
    NODE_ENV: "production",
    REPLIT_DEPLOYMENT: "1",
    DATABASE_URL: `postgresql://migration_owner:${ownerPassword}@database.example/bidbox?sslmode=require`,
    VALO_RUNTIME_DATABASE_URL: `postgresql://valo_app_runtime:${runtimePassword}@database.example/bidbox?sslmode=require`,
  };
  let childEnvironment;
  const runCommand = createScheduledCommandRunner({
    environment,
    spawnCommand: (_command, _arguments, options) => {
      childEnvironment = options.env;
      const child = new EventEmitter();
      child.kill = () => {};
      queueMicrotask(() => child.emit("exit", 0, null));
      return child;
    },
  });

  // @workspace/db performs this scrub when the API is imported, potentially
  // hours before the scheduled command is due.
  delete environment.DATABASE_URL;
  delete environment.VALO_RUNTIME_DATABASE_URL;

  const outcome = await runCommand({
    command: "pnpm --filter @workspace/api-server run retention:scan",
    timeoutSeconds: 10,
  });

  assert.equal(outcome.exitCode, 0);
  assert.equal(
    childEnvironment.DATABASE_URL,
    "postgresql://database.example/bidbox?sslmode=require",
  );
  assert.equal(
    childEnvironment.VALO_RUNTIME_DATABASE_URL,
    `postgresql://valo_app_runtime:${runtimePassword}@database.example/bidbox?sslmode=require`,
  );
  assert.doesNotMatch(JSON.stringify(childEnvironment), /migration_owner/u);
  assert.doesNotMatch(
    JSON.stringify(childEnvironment),
    new RegExp(ownerPassword, "u"),
  );
});
