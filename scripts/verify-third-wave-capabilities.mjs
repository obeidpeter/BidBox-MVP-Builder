import { readFile, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REGISTRY_PATH = "config/product/third-wave.v1.json";
const MAX_EVIDENCE_BYTES = 4 * 1024 * 1024;

export const REQUIRED_THIRD_WAVE_CONTRACTS = Object.freeze({
  response_studio: Object.freeze({
    deliveryState: "integrated",
    productionState: "release_verification_required",
    availability: "role_and_tenant_guarded",
    externalEffects: "none",
    evidence: Object.freeze([
      "artifacts/api-server/src/lib/intelligence/boundedMvpResponseStudio.ts",
      "artifacts/api-server/src/lib/deliveryStudio/contracts.ts",
      "artifacts/api-server/src/lib/deliveryStudio/service.ts",
      "artifacts/api-server/src/lib/deliveryStudio/drizzleRepository.ts",
      "artifacts/api-server/src/routes/deliveryStudio.ts",
      "artifacts/bidbox-workbench/src/pages/project-tabs/delivery-studio-tab.tsx",
      "lib/api-spec/openapi.yaml",
      "docs/third-wave/IMPLEMENTATION.md",
    ]),
    guardAssertions: Object.freeze([
      [
        "artifacts/api-server/src/lib/intelligence/boundedMvpResponseStudio.ts",
        "export function validateCitationFirstResponse",
      ],
      [
        "artifacts/api-server/src/lib/deliveryStudio/contracts.ts",
        "DELIVERY_STUDIO_AUTHORITY_NOTE",
      ],
      [
        "artifacts/api-server/src/lib/deliveryStudio/service.ts",
        "validateCitationFirstResponse",
      ],
      ["artifacts/api-server/src/routes/deliveryStudio.ts", "delivery-studio"],
      [
        "artifacts/bidbox-workbench/src/pages/project-tabs/delivery-studio-tab.tsx",
        "Response Studio",
      ],
      ["lib/api-spec/openapi.yaml", "delivery-studio"],
      [
        "docs/third-wave/IMPLEMENTATION.md",
        "Every result remains deterministic evidence for a named human decision.",
      ],
    ]),
  }),
  red_team_review: Object.freeze({
    deliveryState: "integrated",
    productionState: "release_verification_required",
    availability: "role_and_tenant_guarded",
    externalEffects: "none",
    evidence: Object.freeze([
      "artifacts/api-server/src/lib/submissionReadiness.ts",
      "artifacts/api-server/src/lib/deliveryStudio/contracts.ts",
      "artifacts/api-server/src/lib/deliveryStudio/service.ts",
      "artifacts/api-server/src/lib/deliveryStudio/drizzleRepository.ts",
      "artifacts/api-server/src/routes/deliveryStudio.ts",
      "artifacts/bidbox-workbench/src/pages/project-tabs/delivery-studio-tab.tsx",
      "lib/api-spec/openapi.yaml",
      "docs/third-wave/IMPLEMENTATION.md",
    ]),
    guardAssertions: Object.freeze([
      [
        "artifacts/api-server/src/lib/submissionReadiness.ts",
        "red_team_incomplete",
      ],
      [
        "artifacts/api-server/src/lib/deliveryStudio/contracts.ts",
        "DELIVERY_STUDIO_AUTHORITY_NOTE",
      ],
      [
        "artifacts/api-server/src/lib/deliveryStudio/drizzleRepository.ts",
        "Fatal and likely-fatal findings cannot be cleared",
      ],
      [
        "artifacts/api-server/src/lib/deliveryStudio/drizzleRepository.ts",
        "attestation: input.data.attestation.trim()",
      ],
      ["artifacts/api-server/src/routes/deliveryStudio.ts", "delivery-studio"],
      [
        "artifacts/bidbox-workbench/src/pages/project-tabs/delivery-studio-tab.tsx",
        "Red-team review",
      ],
      [
        "docs/third-wave/IMPLEMENTATION.md",
        "Red-team approval is never inferred from an empty queue.",
      ],
    ]),
  }),
  package_assembly: Object.freeze({
    deliveryState: "integrated",
    productionState: "release_verification_required",
    availability: "role_and_tenant_guarded",
    externalEffects: "none",
    evidence: Object.freeze([
      "artifacts/api-server/src/lib/projectExportPackage.ts",
      "artifacts/api-server/src/lib/submissionReadiness.ts",
      "artifacts/api-server/src/lib/deliveryStudio/contracts.ts",
      "artifacts/api-server/src/lib/deliveryStudio/service.ts",
      "artifacts/api-server/src/lib/deliveryStudio/drizzleRepository.ts",
      "artifacts/api-server/src/routes/deliveryStudio.ts",
      "artifacts/bidbox-workbench/src/pages/project-tabs/delivery-studio-tab.tsx",
      "lib/api-spec/openapi.yaml",
      "docs/third-wave/IMPLEMENTATION.md",
    ]),
    guardAssertions: Object.freeze([
      [
        "artifacts/api-server/src/lib/projectExportPackage.ts",
        "export function buildCanonicalProjectExportManifest",
      ],
      [
        "artifacts/api-server/src/lib/submissionReadiness.ts",
        "export function evaluateSubmissionReadiness",
      ],
      [
        "artifacts/api-server/src/lib/deliveryStudio/contracts.ts",
        "DELIVERY_STUDIO_AUTHORITY_NOTE",
      ],
      ["artifacts/api-server/src/routes/deliveryStudio.ts", "delivery-studio"],
      [
        "artifacts/bidbox-workbench/src/pages/project-tabs/delivery-studio-tab.tsx",
        "Package assembly",
      ],
      [
        "docs/third-wave/IMPLEMENTATION.md",
        "Assembly cannot sign, export, deliver, or submit a package.",
      ],
    ]),
  }),
  submission_rehearsal: Object.freeze({
    deliveryState: "integrated",
    productionState: "release_verification_required",
    availability: "role_and_tenant_guarded",
    externalEffects: "none",
    evidence: Object.freeze([
      "artifacts/api-server/src/lib/intelligence/portalSubmissionRehearsal.ts",
      "artifacts/api-server/src/lib/deliveryStudio/contracts.ts",
      "artifacts/api-server/src/lib/deliveryStudio/service.ts",
      "artifacts/api-server/src/lib/deliveryStudio/drizzleRepository.ts",
      "artifacts/api-server/src/routes/deliveryStudio.ts",
      "artifacts/bidbox-workbench/src/pages/project-tabs/delivery-studio-tab.tsx",
      "lib/api-spec/openapi.yaml",
      "docs/third-wave/IMPLEMENTATION.md",
    ]),
    guardAssertions: Object.freeze([
      [
        "artifacts/api-server/src/lib/intelligence/portalSubmissionRehearsal.ts",
        "export function buildPortalSubmissionRehearsal",
      ],
      [
        "artifacts/api-server/src/lib/deliveryStudio/contracts.ts",
        "DELIVERY_STUDIO_AUTHORITY_NOTE",
      ],
      [
        "artifacts/api-server/src/lib/deliveryStudio/drizzleRepository.ts",
        "buildPortalSubmissionRehearsal",
      ],
      ["artifacts/api-server/src/routes/deliveryStudio.ts", "delivery-studio"],
      [
        "artifacts/bidbox-workbench/src/pages/project-tabs/delivery-studio-tab.tsx",
        "Submission rehearsal",
      ],
      [
        "docs/third-wave/IMPLEMENTATION.md",
        "No route logs in, uploads to, declares on, or submits through a procurement portal.",
      ],
    ]),
  }),
  portfolio_intelligence: Object.freeze({
    deliveryState: "integrated",
    productionState: "release_verification_required",
    availability: "role_and_tenant_guarded",
    externalEffects: "none",
    evidence: Object.freeze([
      "artifacts/api-server/src/lib/deliveryStudio/contracts.ts",
      "artifacts/api-server/src/lib/deliveryStudio/service.ts",
      "artifacts/api-server/src/lib/deliveryStudio/drizzleRepository.ts",
      "artifacts/api-server/src/routes/deliveryStudio.ts",
      "artifacts/bidbox-workbench/src/pages/portfolio-intelligence.tsx",
      "lib/api-spec/openapi.yaml",
      "docs/third-wave/IMPLEMENTATION.md",
    ]),
    guardAssertions: Object.freeze([
      [
        "artifacts/api-server/src/lib/deliveryStudio/contracts.ts",
        "DELIVERY_STUDIO_AUTHORITY_NOTE",
      ],
      [
        "artifacts/api-server/src/lib/deliveryStudio/service.ts",
        "Lesson derivation is unavailable",
      ],
      [
        "artifacts/api-server/src/lib/deliveryStudio/drizzleRepository.ts",
        "eq(outcomes.clientConfirmed, true)",
      ],
      [
        "artifacts/api-server/src/routes/deliveryStudio.ts",
        "portfolio-intelligence",
      ],
      [
        "artifacts/bidbox-workbench/src/pages/portfolio-intelligence.tsx",
        "Portfolio intelligence",
      ],
      ["lib/api-spec/openapi.yaml", "portfolio-intelligence"],
      [
        "docs/third-wave/IMPLEMENTATION.md",
        "Portfolio intelligence is tenant-local and never predicts an award.",
      ],
    ]),
  }),
});

const REQUIRED_CAPABILITY_IDS = Object.freeze(
  Object.keys(REQUIRED_THIRD_WAVE_CONTRACTS),
);
const REGISTRY_KEYS = Object.freeze([
  "schemaVersion",
  "registryId",
  "authority",
  "deterministicRuntimeLevel",
  "productionModelExecutionGranted",
  "autonomousExternalActionGranted",
  "capabilities",
]);
const CAPABILITY_KEYS = Object.freeze([
  "id",
  "title",
  "wave",
  "deliveryState",
  "productionState",
  "availability",
  "externalEffects",
  "runtimeLevel",
  "deterministic",
  "automaticMutation",
  "namedHumanAuthority",
  "modelExecution",
  "externalActionAuthorized",
  "releaseAuthority",
  "crossTenantReuse",
  "authorityBoundary",
  "evidence",
  "sourceAssertions",
]);

function fail(message) {
  throw new Error(`THIRD_WAVE_CAPABILITY_INVALID: ${message}`);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value, expected) {
  return (
    isRecord(value) &&
    Object.keys(value).length === expected.length &&
    Object.keys(value).every((key) => expected.includes(key))
  );
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

export function validateThirdWaveCapabilityRegistry(registry) {
  if (!hasExactKeys(registry, REGISTRY_KEYS)) {
    fail("registry must use the exact closed contract");
  }
  if (registry.schemaVersion !== 1) fail("schemaVersion must be 1");
  if (registry.registryId !== "bidbox-product-capabilities/third-wave-v1") {
    fail("registryId must identify the frozen third-wave registry");
  }
  if (
    registry.authority !==
    "checked_in_source_runtime_gates_and_release_evidence_are_authoritative"
  ) {
    fail("authority boundary must remain exact");
  }
  if (
    registry.deterministicRuntimeLevel !== 0 ||
    registry.productionModelExecutionGranted !== false ||
    registry.autonomousExternalActionGranted !== false
  ) {
    fail("global deterministic and external-action boundaries are overstated");
  }
  if (!Array.isArray(registry.capabilities)) {
    fail("capabilities must be an array");
  }
  const ids = registry.capabilities.map((capability) => capability?.id);
  if (!sameMembers(ids, REQUIRED_CAPABILITY_IDS)) {
    fail("registry must enumerate the exact approved third-wave scope");
  }

  for (const capability of registry.capabilities) {
    if (!hasExactKeys(capability, CAPABILITY_KEYS)) {
      fail("each capability must use the exact closed contract");
    }
    const contract = REQUIRED_THIRD_WAVE_CONTRACTS[capability.id];
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
    if (capability.wave !== "third") {
      fail(`${capability.id} must remain in the third wave`);
    }
    if (capability.runtimeLevel !== 0 || capability.deterministic !== true) {
      fail(`${capability.id} must remain deterministic runtime level 0`);
    }
    for (const field of [
      "automaticMutation",
      "modelExecution",
      "externalActionAuthorized",
      "releaseAuthority",
      "crossTenantReuse",
    ]) {
      if (capability[field] !== false) {
        fail(`${capability.id} must not claim ${field}`);
      }
    }
    if (capability.namedHumanAuthority !== true) {
      fail(`${capability.id} must preserve named-human authority`);
    }
    if (
      typeof capability.title !== "string" ||
      capability.title.trim().length < 3 ||
      typeof capability.authorityBoundary !== "string" ||
      capability.authorityBoundary.trim().length < 80
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
        !hasExactKeys(assertion, ["path", "includes"]) ||
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

export async function verifyThirdWaveCapabilityEvidence(root, registry) {
  validateThirdWaveCapabilityRegistry(registry);
  const cache = new Map();
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
  return {
    capabilityCount: registry.capabilities.length,
    evidenceFileCount: cache.size,
  };
}

async function main() {
  const root = resolve(import.meta.dirname, "..");
  const registry = parseJson(
    await readFile(resolve(root, REGISTRY_PATH), "utf8"),
    REGISTRY_PATH,
  );
  const result = await verifyThirdWaveCapabilityEvidence(root, registry);
  console.log(
    `Verified ${result.capabilityCount} third-wave capabilities across ${result.evidenceFileCount} evidence files.`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  await main();
}
