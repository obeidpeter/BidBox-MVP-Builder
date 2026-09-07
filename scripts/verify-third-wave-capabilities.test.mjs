import assert from "node:assert/strict";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

import {
  validateThirdWaveCapabilityRegistry,
  verifyThirdWaveCapabilityEvidence,
} from "./verify-third-wave-capabilities.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const checkedInRegistry = JSON.parse(
  await readFile(
    resolve(repositoryRoot, "config/product/third-wave.v1.json"),
    "utf8",
  ),
);

function registry() {
  return structuredClone(checkedInRegistry);
}

async function copyEvidenceTree(targetRoot, value) {
  const paths = new Set(
    value.capabilities.flatMap((capability) => capability.evidence),
  );
  for (const path of paths) {
    const target = resolve(targetRoot, path);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(resolve(repositoryRoot, path), target);
  }
}

test("freezes the exact five-capability third-wave scope", () => {
  const valid = registry();
  assert.doesNotThrow(() => validateThirdWaveCapabilityRegistry(valid));

  const missing = registry();
  missing.capabilities.pop();
  assert.throws(
    () => validateThirdWaveCapabilityRegistry(missing),
    /exact approved third-wave scope/u,
  );

  const extra = registry();
  extra.capabilities.push({ ...extra.capabilities[0], id: "extra_scope" });
  assert.throws(
    () => validateThirdWaveCapabilityRegistry(extra),
    /exact approved third-wave scope/u,
  );

  const activated = registry();
  activated.capabilities[0].productionState = "active";
  assert.throws(
    () => validateThirdWaveCapabilityRegistry(activated),
    /overstated productionState/u,
  );
});

test("rejects autonomous, model-backed, release, and cross-tenant claims", () => {
  for (const field of [
    "automaticMutation",
    "modelExecution",
    "externalActionAuthorized",
    "releaseAuthority",
    "crossTenantReuse",
  ]) {
    const overstated = registry();
    overstated.capabilities[0][field] = true;
    assert.throws(
      () => validateThirdWaveCapabilityRegistry(overstated),
      new RegExp(`must not claim ${field}`, "u"),
    );
  }

  const unnamed = registry();
  unnamed.capabilities[1].namedHumanAuthority = false;
  assert.throws(
    () => validateThirdWaveCapabilityRegistry(unnamed),
    /preserve named-human authority/u,
  );

  const nondeterministic = registry();
  nondeterministic.capabilities[2].runtimeLevel = 2;
  assert.throws(
    () => validateThirdWaveCapabilityRegistry(nondeterministic),
    /deterministic runtime level 0/u,
  );

  const globalModel = registry();
  globalModel.productionModelExecutionGranted = true;
  assert.throws(
    () => validateThirdWaveCapabilityRegistry(globalModel),
    /global deterministic and external-action boundaries are overstated/u,
  );
});

test("rejects registry expansion and self-declared evidence", () => {
  const expanded = registry();
  expanded.capabilities[0].futureProvider = "connected";
  assert.throws(
    () => validateThirdWaveCapabilityRegistry(expanded),
    /exact closed contract/u,
  );

  const selfDeclared = registry();
  selfDeclared.capabilities[0].sourceAssertions = [
    {
      path: "docs/third-wave/IMPLEMENTATION.md",
      includes: "source integration",
    },
  ];
  assert.throws(
    () => validateThirdWaveCapabilityRegistry(selfDeclared),
    /exact required source assertions/u,
  );

  const unsafe = registry();
  unsafe.capabilities[0].evidence[0] = "../outside.txt";
  assert.throws(
    () => validateThirdWaveCapabilityRegistry(unsafe),
    /exact required evidence files/u,
  );
});

test("verifies all checked-in third-wave evidence and guard assertions", async () => {
  const root = await mkdtemp(join(tmpdir(), "bidbox-third-wave-"));
  try {
    const valid = registry();
    await copyEvidenceTree(root, valid);
    const expectedEvidenceFiles = new Set(
      valid.capabilities.flatMap((capability) => capability.evidence),
    ).size;
    assert.deepEqual(await verifyThirdWaveCapabilityEvidence(root, valid), {
      capabilityCount: 5,
      evidenceFileCount: expectedEvidenceFiles,
    });

    const servicePath = resolve(
      root,
      "artifacts/api-server/src/lib/deliveryStudio/service.ts",
    );
    const service = await readFile(servicePath, "utf8");
    await writeFile(
      servicePath,
      service.replaceAll(
        "validateCitationFirstResponse",
        "removedCitationFirstValidator",
      ),
      "utf8",
    );
    await assert.rejects(
      verifyThirdWaveCapabilityEvidence(root, valid),
      /response_studio evidence is missing/u,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("fails closed when an exact evidence file is missing", async () => {
  const root = await mkdtemp(join(tmpdir(), "bidbox-third-wave-missing-"));
  try {
    const valid = registry();
    await copyEvidenceTree(root, valid);
    await rm(
      resolve(
        root,
        "artifacts/bidbox-workbench/src/pages/portfolio-intelligence.tsx",
      ),
    );
    await assert.rejects(
      verifyThirdWaveCapabilityEvidence(root, valid),
      /portfolio-intelligence\.tsx must be a bounded, non-empty regular file/u,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
