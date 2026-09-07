import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { isAbsolute, relative, resolve } from "node:path";

const REGISTRY_PATH = "config/product/second-wave.v1.json";
const MAX_EVIDENCE_BYTES = 4 * 1024 * 1024;

export const REQUIRED_SECOND_WAVE_CONTRACTS = Object.freeze({
  durable_retention_completion: Object.freeze({
    deliveryState: "source_integrated",
    productionState: "activation_blocked",
    availability: "admin_only_when_activated",
    externalEffects: "none_while_activation_blocked",
    evidence: Object.freeze([
      "config/operations/retention-completion-activation.v1.json",
      "lib/db/migrations/0011_retention_completion.sql",
      "lib/db/src/schema/index.ts",
      "artifacts/api-server/src/lib/retentionCompletion/service.ts",
      "artifacts/api-server/src/lib/retentionCompletion/drizzleRepository.ts",
      "artifacts/api-server/src/routes/index.ts",
      "artifacts/api-server/src/routes/retentionCompletion.ts",
      "lib/api-spec/openapi.yaml",
      "artifacts/bidbox-workbench/src/pages/settings.tsx",
      "docs/second-wave/IMPLEMENTATION.md",
    ]),
    guardAssertions: Object.freeze([
      [
        "config/operations/retention-completion-activation.v1.json",
        '"productionActivationGranted": false',
      ],
      [
        "lib/db/migrations/0011_retention_completion.sql",
        "retention_action_storage_events",
      ],
      [
        "lib/db/migrations/0011_retention_completion.sql",
        "REVOKE EXECUTE ON FUNCTION valo_security.purge_retention_project",
      ],
      [
        "artifacts/api-server/src/routes/index.ts",
        "loadCheckedRetentionCompletionActivationManifest()",
      ],
      [
        "artifacts/api-server/src/routes/retentionCompletion.ts",
        "retention-actions/:id/reconcile",
      ],
      [
        "artifacts/api-server/src/routes/retentionCompletion.ts",
        "retention-actions/:id/certify",
      ],
      ["lib/api-spec/openapi.yaml", "/retention-actions/{id}/reconcile:"],
      [
        "docs/second-wave/IMPLEMENTATION.md",
        "It never deletes an object synchronously.",
      ],
    ]),
  }),
  controlled_evaluation_runner: Object.freeze({
    deliveryState: "foundation_only",
    productionState: "activation_blocked",
    availability: "internal_unmounted",
    externalEffects: "provider_disconnected",
    evidence: Object.freeze([
      "config/operations/controlled-evaluation-runner.v1.json",
      "artifacts/api-server/src/lib/controlledEvaluationRunnerFoundation.ts",
      "artifacts/api-server/src/lib/controlledEvaluationRunnerFoundation.test.ts",
      "artifacts/api-server/src/lib/aiContinuousEval.ts",
      "docs/second-wave/IMPLEMENTATION.md",
    ]),
    guardAssertions: Object.freeze([
      [
        "config/operations/controlled-evaluation-runner.v1.json",
        '"deliveryState": "foundation_only"',
      ],
      [
        "config/operations/controlled-evaluation-runner.v1.json",
        '"productionActivationGranted": false',
      ],
      [
        "artifacts/api-server/src/lib/controlledEvaluationRunnerFoundation.ts",
        "readyForExecution: false",
      ],
      [
        "artifacts/api-server/src/lib/controlledEvaluationRunnerFoundation.ts",
        "rawOutputPersisted: false",
      ],
      [
        "config/operations/controlled-evaluation-runner.v1.json",
        '"privateAuthorisationEvidenceConnected": false',
      ],
    ]),
  }),
  authorised_evaluation_corpus: Object.freeze({
    deliveryState: "externally_blocked",
    productionState: "evidence_unavailable",
    availability: "not_available",
    externalEffects: "none",
    evidence: Object.freeze([
      "config/operations/controlled-evaluation-runner.v1.json",
      "artifacts/api-server/src/lib/evalHarness.ts",
      "docs/second-wave/IMPLEMENTATION.md",
    ]),
    guardAssertions: Object.freeze([
      [
        "config/operations/controlled-evaluation-runner.v1.json",
        '"authorisedProductionCorpusAvailable": false',
      ],
      [
        "artifacts/api-server/src/lib/evalHarness.ts",
        "EVAL_PRODUCTION_MIN_CORPUS = 25",
      ],
      [
        "docs/second-wave/IMPLEMENTATION.md",
        "An authorised production corpus remains externally blocked",
      ],
    ]),
  }),
});

const REQUIRED_CAPABILITY_IDS = Object.freeze(
  Object.keys(REQUIRED_SECOND_WAVE_CONTRACTS),
);
const REQUIRED_RETENTION_PRECONDITIONS = Object.freeze([
  "activation_approval_recorded",
  "database_controls_attested",
  "deletion_rehearsal_verified",
  "protected_record_selectors_reviewed",
  "storage_reconciler_schedule_verified",
  "storage_terminal_evidence_verified",
]);

function fail(message) {
  throw new Error(`SECOND_WAVE_CAPABILITY_INVALID: ${message}`);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactStringArray(value, label) {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((item) => typeof item !== "string" || item.length === 0) ||
    new Set(value).size !== value.length
  ) {
    fail(`${label} must be a non-empty unique string array`);
  }
}

function sameMembers(actual, expected) {
  return (
    actual.length === expected.length &&
    [...actual]
      .sort()
      .every((item, index) => item === [...expected].sort()[index])
  );
}

function assertionKey(value) {
  return `${value.path}\u0000${value.includes}`;
}

function safeEvidencePath(root, path) {
  if (
    typeof path !== "string" ||
    path.length === 0 ||
    isAbsolute(path) ||
    path.includes("\\") ||
    path.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    fail(`unsafe evidence path ${String(path)}`);
  }
  const absolute = resolve(root, path);
  const fromRoot = relative(root, absolute);
  if (fromRoot.startsWith("..") || isAbsolute(fromRoot)) {
    fail(`evidence escapes the repository: ${path}`);
  }
  return absolute;
}

export function validateSecondWaveCapabilityRegistry(registry) {
  if (!isRecord(registry)) fail("registry must be an object");
  if (registry.schemaVersion !== 1) fail("schemaVersion must be 1");
  if (registry.registryId !== "bidbox-product-capabilities/second-wave-v1") {
    fail("registryId must identify the frozen second-wave registry");
  }
  if (
    registry.authority !==
    "checked_in_source_runtime_gates_and_external_evidence_are_authoritative"
  ) {
    fail("authority boundary must remain exact");
  }
  if (!Array.isArray(registry.capabilities)) {
    fail("capabilities must be an array");
  }
  const ids = registry.capabilities.map((capability) => capability?.id);
  if (!sameMembers(ids, REQUIRED_CAPABILITY_IDS)) {
    fail("registry must enumerate the exact approved second-wave scope");
  }
  for (const capability of registry.capabilities) {
    if (!isRecord(capability)) fail("each capability must be an object");
    const contract = REQUIRED_SECOND_WAVE_CONTRACTS[capability.id];
    if (!contract) fail(`unknown capability ${String(capability.id)}`);
    for (const key of [
      "deliveryState",
      "productionState",
      "availability",
      "externalEffects",
    ]) {
      if (capability[key] !== contract[key]) {
        fail(`${capability.id} has an overstated ${key}`);
      }
    }
    if (capability.wave !== "second") {
      fail(`${capability.id} must remain in the second wave`);
    }
    if (capability.automaticMutation !== false) {
      fail(`${capability.id} must not claim automatic mutation`);
    }
    if (capability.namedHumanAuthority !== true) {
      fail(`${capability.id} must preserve named-human authority`);
    }
    if (
      typeof capability.title !== "string" ||
      capability.title.trim().length < 3 ||
      typeof capability.authorityBoundary !== "string" ||
      capability.authorityBoundary.trim().length < 40
    ) {
      fail(`${capability.id} needs a meaningful title and authority boundary`);
    }
    exactStringArray(capability.evidence, `${capability.id}.evidence`);
    if (!sameMembers(capability.evidence, contract.evidence)) {
      fail(`${capability.id} must cite the exact required evidence files`);
    }
    if (
      !Array.isArray(capability.sourceAssertions) ||
      capability.sourceAssertions.length === 0
    ) {
      fail(`${capability.id} needs source assertions`);
    }
    for (const assertion of capability.sourceAssertions) {
      if (
        !isRecord(assertion) ||
        typeof assertion.path !== "string" ||
        !capability.evidence.includes(assertion.path) ||
        typeof assertion.includes !== "string" ||
        assertion.includes.length < 8
      ) {
        fail(`${capability.id} has an invalid source assertion`);
      }
    }
    const actualAssertions = capability.sourceAssertions.map(assertionKey);
    const requiredAssertions = contract.guardAssertions.map(
      ([path, includes]) => `${path}\u0000${includes}`,
    );
    if (!sameMembers(actualAssertions, requiredAssertions)) {
      fail(`${capability.id} must keep the exact required source assertions`);
    }
  }
}

async function readEvidence(root, path, cache) {
  if (cache.has(path)) return cache.get(path);
  const absolute = safeEvidencePath(root, path);
  const metadata = await stat(absolute).catch(() => null);
  if (
    !metadata?.isFile() ||
    metadata.size <= 0 ||
    metadata.size > MAX_EVIDENCE_BYTES
  ) {
    fail(`${path} must be a bounded, non-empty regular file`);
  }
  const source = await readFile(absolute, "utf8");
  cache.set(path, source);
  return source;
}

function parseJson(source, path) {
  try {
    return JSON.parse(source);
  } catch {
    fail(`${path} must contain valid JSON`);
  }
}

function verifyRetentionActivation(manifest) {
  if (
    !isRecord(manifest) ||
    manifest.manifestId !== "bidbox-retention-completion-activation/v1" ||
    manifest.status !== "preconditions_open_workflow_disabled" ||
    manifest.workflow !== "durable_two_phase_detach_reconcile_certify" ||
    manifest.productionActivationGranted !== false
  ) {
    fail("retention production activation must remain denied");
  }
  if (!Array.isArray(manifest.preconditions)) {
    fail("retention activation preconditions are missing");
  }
  const ids = manifest.preconditions.map((item) => item?.id);
  if (!sameMembers(ids, REQUIRED_RETENTION_PRECONDITIONS)) {
    fail("retention activation must keep the exact reviewed precondition set");
  }
  for (const precondition of manifest.preconditions) {
    if (
      !isRecord(precondition) ||
      typeof precondition.description !== "string" ||
      precondition.description.trim().length < 20 ||
      precondition.status !== "open" ||
      precondition.evidence !== null
    ) {
      fail("open retention preconditions cannot carry synthetic evidence");
    }
  }
}

function verifyControlledEvaluationActivation(manifest) {
  if (
    !isRecord(manifest) ||
    manifest.controlId !== "bidbox-controlled-evaluation-runner/v1" ||
    manifest.deliveryState !== "foundation_only" ||
    manifest.manifestBindingImplemented !== true ||
    manifest.tenantAndProjectBindingRequired !== true ||
    manifest.privateFixtureLoaderConnected !== false ||
    manifest.privateAuthorisationEvidenceConnected !== false ||
    manifest.centralGatewayConnected !== false ||
    manifest.continuousEvaluationWriterConnected !== false ||
    manifest.rawFixturePersistenceAllowed !== false ||
    manifest.rawOutputPersistenceAllowed !== false ||
    manifest.customerVisible !== false ||
    manifest.authorisedProductionCorpusAvailable !== false ||
    manifest.productionActivationGranted !== false ||
    manifest.activation !== "blocked"
  ) {
    fail("controlled evaluation must remain foundation-only and disconnected");
  }
  exactStringArray(manifest.blockers, "controlled evaluation blockers");
  const requiredBlockers = [
    "authorised_private_corpus_unavailable",
    "independent_adjudication_evidence_unavailable",
    "private_authorisation_evidence_disconnected",
    "private_fixture_loader_disconnected",
    "central_gateway_disconnected",
    "continuous_evaluation_writer_disconnected",
    "operations_activation_approval_unavailable",
  ];
  if (!sameMembers(manifest.blockers, requiredBlockers)) {
    fail("controlled evaluation must keep the exact external blocker set");
  }
}

export async function verifySecondWaveCapabilityEvidence(root, registry) {
  validateSecondWaveCapabilityRegistry(registry);
  const cache = new Map();
  verifyRetentionActivation(
    parseJson(
      await readEvidence(
        root,
        "config/operations/retention-completion-activation.v1.json",
        cache,
      ),
      "config/operations/retention-completion-activation.v1.json",
    ),
  );
  verifyControlledEvaluationActivation(
    parseJson(
      await readEvidence(
        root,
        "config/operations/controlled-evaluation-runner.v1.json",
        cache,
      ),
      "config/operations/controlled-evaluation-runner.v1.json",
    ),
  );
  for (const capability of registry.capabilities) {
    for (const path of capability.evidence) {
      await readEvidence(root, path, cache);
    }
    for (const assertion of capability.sourceAssertions) {
      const source = await readEvidence(root, assertion.path, cache);
      if (!source.includes(assertion.includes)) {
        fail(
          `${capability.id} evidence is missing ${JSON.stringify(assertion.includes)} in ${assertion.path}`,
        );
      }
    }
  }
  return { capabilityCount: registry.capabilities.length };
}

async function main() {
  const root = resolve(import.meta.dirname, "..");
  const registry = parseJson(
    await readFile(resolve(root, REGISTRY_PATH), "utf8"),
    REGISTRY_PATH,
  );
  const result = await verifySecondWaveCapabilityEvidence(root, registry);
  console.log(`Verified ${result.capabilityCount} second-wave capabilities.`);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  await main();
}
