import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

async function json(path) {
  return JSON.parse(await readFile(resolve(root, path), "utf8"));
}

const [
  alerts,
  signals,
  synthetic,
  schedules,
  workerActivation,
  apiPackage,
  dbPackage,
  reconciler,
  workerFoundation,
  outbox,
] = await Promise.all([
  json("config/observability/alerts.v2.5.json"),
  json("config/observability/signals.v1.json"),
  json("config/observability/synthetic-alerts.v1.json"),
  json("config/operations/schedules.v1.json"),
  json("config/operations/worker-activation.v1.json"),
  json("artifacts/api-server/package.json"),
  json("lib/db/package.json"),
  readFile(
    resolve(
      root,
      "artifacts/api-server/src/lib/storageLifecycle/reconciler.ts",
    ),
    "utf8",
  ),
  readFile(
    resolve(root, "artifacts/api-server/src/lib/durableWorkerFoundation.ts"),
    "utf8",
  ),
  readFile(
    resolve(root, "artifacts/api-server/src/lib/transactionalOutbox.ts"),
    "utf8",
  ),
]);

assert.equal(
  alerts.status,
  "deployment_adapter_required",
  "Source alert policy must not claim that evaluation or paging is deployed",
);
assert.equal(
  signals.status,
  "source_registry_complete_deployment_mapping_required",
);
assert.equal(signals.registryVersion, "bidbox-operational-signals/v1");
assert.equal(
  synthetic.status,
  "fixtures_ready_adapter_execution_and_delivery_receipts_required",
);
assert.equal(
  schedules.status,
  "source_declared_platform_installation_not_evidenced",
);
assert.equal(schedules.timezone, "UTC");

const allowedSourceStatuses = new Set([
  "deployment_adapter_required",
  "deployment_derived",
  "emitted",
  "external_evidence_required",
]);
const allowedTypes = new Set([
  "counter",
  "counter_delta",
  "gauge",
  "histogram_bucket",
]);
const allowedLabels = new Set(signals.allowedLabelKeys);
const producerPathBySource = new Map([
  ["api_runtime", "artifacts/api-server/src/lib/observability.ts"],
  [
    "storage_deletion_reconciliation",
    "artifacts/api-server/scripts/run-storage-deletion-reconciler.ts",
  ],
  [
    "successful_storage_deletion_reconciliation",
    "artifacts/api-server/scripts/run-storage-deletion-reconciler.ts",
  ],
  [
    "storage_deletion_reconciliation_when_cycle_complete",
    "artifacts/api-server/scripts/run-storage-deletion-reconciler.ts",
  ],
  ["retention_scan", "artifacts/api-server/scripts/run-retention-scan.ts"],
  [
    "successful_complete_retention_scan_cycle",
    "artifacts/api-server/scripts/run-retention-scan.ts",
  ],
  ["public_intake_purge", "lib/db/scripts/run-intake-purge.mjs"],
  [
    "authenticated_rate_limit_purge",
    "lib/db/scripts/run-authenticated-rate-limit-purge.mjs",
  ],
  ["backup_evidence_verifier", "scripts/verify-operational-evidence.mjs"],
  ["audit_anchor_evidence_verifier", "scripts/verify-operational-evidence.mjs"],
]);
const producerSources = new Map();
for (const path of new Set(producerPathBySource.values())) {
  producerSources.set(path, await readFile(resolve(root, path), "utf8"));
}
const signalByName = new Map();
for (const signal of signals.signals ?? []) {
  assert.match(signal.name, /^[a-z][a-z0-9_.]+$/u);
  assert.equal(
    signalByName.has(signal.name),
    false,
    `Duplicate ${signal.name}`,
  );
  assert.ok(allowedTypes.has(signal.type), `${signal.name} has invalid type`);
  assert.ok(
    allowedSourceStatuses.has(signal.sourceStatus),
    `${signal.name} has invalid source status`,
  );
  assert.ok(signal.source, `${signal.name} needs a source`);
  assert.ok(signal.unit, `${signal.name} needs a unit`);
  assert.ok(Array.isArray(signal.labels), `${signal.name} needs labels`);
  assert.equal(new Set(signal.labels).size, signal.labels.length);
  for (const label of signal.labels) {
    assert.ok(
      allowedLabels.has(label),
      `${signal.name} uses unknown label ${label}`,
    );
  }
  if (signal.sourceStatus === "emitted") {
    const producerPath = producerPathBySource.get(signal.source);
    assert.ok(
      producerPath,
      `${signal.name} claims emission without a checked-in producer mapping`,
    );
    assert.match(
      producerSources.get(producerPath),
      new RegExp(`["']${signal.name.replaceAll(".", "\\.")}["']`, "u"),
      `${signal.name} is absent from ${producerPath}`,
    );
  }
  signalByName.set(signal.name, signal);
}

const alertById = new Map();
for (const alert of alerts.alerts ?? []) {
  assert.equal(alertById.has(alert.id), false, `Duplicate alert ${alert.id}`);
  assert.ok(
    signalByName.has(alert.signal),
    `${alert.id} references unregistered signal ${alert.signal}`,
  );
  for (const requiredSignal of alert.requiresSignals ?? []) {
    assert.ok(
      signalByName.has(requiredSignal),
      `${alert.id} requires unregistered signal ${requiredSignal}`,
    );
  }
  alertById.set(alert.id, alert);
}

const syntheticByAlert = new Map();
for (const fixture of synthetic.cases ?? []) {
  assert.equal(
    syntheticByAlert.has(fixture.alertId),
    false,
    `Duplicate synthetic case ${fixture.alertId}`,
  );
  const alert = alertById.get(fixture.alertId);
  assert.ok(alert, `Unknown synthetic alert ${fixture.alertId}`);
  assert.equal(fixture.signal, alert.signal);
  assert.ok(Number.isFinite(fixture.value), `${fixture.alertId} needs a value`);
  assert.ok(
    fixture.supportingSignals &&
      typeof fixture.supportingSignals === "object" &&
      !Array.isArray(fixture.supportingSignals),
    `${fixture.alertId} needs bounded supporting signals`,
  );
  for (const requiredSignal of alert.requiresSignals ?? []) {
    assert.ok(
      Object.hasOwn(fixture.supportingSignals, requiredSignal),
      `${fixture.alertId} does not exercise ${requiredSignal}`,
    );
  }
  for (const [name, value] of Object.entries(fixture.supportingSignals)) {
    assert.ok(
      signalByName.has(name),
      `${fixture.alertId} uses unknown ${name}`,
    );
    assert.ok(Number.isFinite(value), `${fixture.alertId}/${name} is invalid`);
  }
  syntheticByAlert.set(fixture.alertId, fixture);
}
assert.deepEqual(
  [...alertById.keys()].sort(),
  [...syntheticByAlert.keys()].sort(),
  "Every alert needs exactly one adapter-neutral synthetic trigger fixture",
);

const expectedCommands = new Map([
  [
    "storage_deletion_reconciliation",
    "pnpm --filter @workspace/api-server run storage:reconcile-deletions",
  ],
  [
    "retention_request_scan",
    "pnpm --filter @workspace/api-server run retention:scan",
  ],
  [
    "public_intake_expiry_purge",
    "pnpm --filter @workspace/db run maintenance:purge:intake",
  ],
  [
    "authenticated-rate-limit-bucket-purge",
    "pnpm --filter @workspace/db run maintenance:purge:authenticated-rate-limits",
  ],
  [
    "audit_anchor_evidence_verification",
    "pnpm --filter @workspace/api-server run verify:audit-anchor-evidence",
  ],
  [
    "backup_evidence_verification",
    "pnpm --filter @workspace/api-server run verify:backup-evidence",
  ],
]);
const inProcessRunnerSource = await readFile(
  resolve(root, "scripts/run-inprocess-schedules.mjs"),
  "utf8",
);
assert.match(
  inProcessRunnerSource,
  /IN_PROCESS_SCHEDULES_ENVIRONMENT_KEY = "VALO_INPROCESS_SCHEDULES"/u,
  "The in-process runner must gate on the declared opt-in variable",
);
assert.match(
  inProcessRunnerSource,
  /prerequisites cannot be waived/u,
  "The in-process runner must refuse jobs that are not ready for install",
);

const scheduleIds = new Set();
for (const job of schedules.jobs ?? []) {
  assert.equal(scheduleIds.has(job.id), false, `Duplicate schedule ${job.id}`);
  scheduleIds.add(job.id);
  assert.equal(job.command, expectedCommands.get(job.id));
  assert.match(job.schedule, /^[0-9*/, -]+$/u);
  assert.ok(Number.isSafeInteger(job.timeoutSeconds));
  assert.ok(job.timeoutSeconds >= 60 && job.timeoutSeconds <= 900);
  assert.equal(job.concurrencyPolicy, "forbid");
  assert.equal(
    job.platformScheduleStatus,
    "not_installed",
    `${job.id} must not claim platform installation without a receipt`,
  );
  assert.ok(["blocked", "ready_for_platform_install"].includes(job.activation));
  assert.ok(Array.isArray(job.prerequisites) && job.prerequisites.length > 0);
  if (job.activation === "ready_for_platform_install") {
    assert.deepEqual(
      job.inProcessRunner,
      {
        available: true,
        optInEnvironmentVariable: "VALO_INPROCESS_SCHEDULES",
        runner: "scripts/run-inprocess-schedules.mjs",
      },
      `${job.id} must declare the bounded in-process runner it is served by`,
    );
  } else {
    assert.equal(
      job.inProcessRunner,
      undefined,
      `${job.id} is blocked and must not advertise an in-process runner`,
    );
  }
  for (const signalName of [job.fullCycleSignal, job.lastSuccessSignal]) {
    if (signalName) {
      assert.ok(
        signalByName.has(signalName),
        `${job.id} references unregistered signal ${signalName}`,
      );
    }
  }
}
assert.deepEqual([...scheduleIds].sort(), [...expectedCommands.keys()].sort());
const anchorSchedule = (schedules.jobs ?? []).find(
  (job) => job.id === "audit_anchor_evidence_verification",
);
assert.deepEqual(
  anchorSchedule?.prerequisites?.filter((value) => value.includes("tenant")),
  [
    "independently_pinned_retained_obligation_tenant_count_and_digest",
    "all_retained_obligation_tenants_in_evidence_cycle",
  ],
  "Audit anchoring must cover every retained-obligation tenant, not only active tenants",
);
assert.equal(
  apiPackage.scripts?.["verify:audit-anchor-evidence"],
  "node ../../scripts/verify-operational-evidence.mjs --kind audit-anchor",
);
assert.equal(
  apiPackage.scripts?.["verify:backup-evidence"],
  "node ../../scripts/verify-operational-evidence.mjs --kind backup",
);
assert.equal(
  dbPackage.scripts?.["maintenance:purge:intake"],
  "node ./scripts/run-intake-purge.mjs",
);
assert.equal(
  dbPackage.scripts?.["maintenance:purge:authenticated-rate-limits"],
  "node ./scripts/run-authenticated-rate-limit-purge.mjs",
);
assert.match(
  reconciler,
  /platformScheduleDeclaredInRepository:\s*true/u,
  "Storage lifecycle metadata must acknowledge the source manifest",
);

assert.equal(
  workerActivation.status,
  "preconditions_open_control_router_unmounted",
  "The worker control plane must not claim activation without evidenced preconditions",
);
assert.equal(workerActivation.controlRouterMounted, false);
const workerPreconditionIds = new Set();
for (const precondition of workerActivation.preconditions ?? []) {
  assert.equal(
    workerPreconditionIds.has(precondition.id),
    false,
    `Duplicate worker precondition ${precondition.id}`,
  );
  workerPreconditionIds.add(precondition.id);
  assert.ok(precondition.description, `${precondition.id} needs a description`);
  assert.ok(
    precondition.boundStatusFlag,
    `${precondition.id} must bind a source status flag`,
  );
  assert.ok(["open", "satisfied"].includes(precondition.status));
  if (precondition.status === "satisfied") {
    assert.ok(
      typeof precondition.evidence === "string" && precondition.evidence,
      `${precondition.id} cannot be satisfied without named evidence`,
    );
  } else {
    assert.equal(
      precondition.evidence,
      null,
      `${precondition.id} is open and must not carry evidence`,
    );
  }
}
assert.deepEqual(
  [...workerPreconditionIds].sort(),
  [
    "budget_settlement_implemented",
    "control_router_publication_reviewed",
    "provider_governance_verified",
    "trusted_receipt_verification_implemented",
    "workload_identity_connected",
  ],
  "The tracked worker preconditions must stay the reviewed set",
);
// While any precondition stays open, the source status flags it binds must
// still declare the capability off — the manifest cannot drift ahead of code.
if (
  (workerActivation.preconditions ?? []).some(
    (precondition) => precondition.status === "open",
  )
) {
  assert.match(
    workerFoundation,
    /userAuthenticatedControlRouteMounted:\s*false/u,
    "Worker control router must stay unmounted while preconditions are open",
  );
  assert.match(workerFoundation, /workloadIdentityConnected:\s*false/u);
  assert.match(workerFoundation, /externalProviderInvocationAllowed:\s*false/u);
  assert.match(outbox, /trustedReceiptVerificationImplemented:\s*false/u);
}

console.log(
  `operational controls valid: ${signalByName.size} signals, ` +
    `${alertById.size} alert fixtures, ${scheduleIds.size} source schedules; ` +
    "platform installation remains unverified",
);
