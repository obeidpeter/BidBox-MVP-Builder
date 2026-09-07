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
  validateSecondWaveCapabilityRegistry,
  verifySecondWaveCapabilityEvidence,
} from "./verify-second-wave-capabilities.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const checkedInRegistry = JSON.parse(
  await readFile(
    resolve(repositoryRoot, "config/product/second-wave.v1.json"),
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

test("freezes the exact second-wave scope and truthful delivery states", () => {
  const valid = registry();
  assert.doesNotThrow(() => validateSecondWaveCapabilityRegistry(valid));

  const missing = registry();
  missing.capabilities.pop();
  assert.throws(
    () => validateSecondWaveCapabilityRegistry(missing),
    /exact approved second-wave scope/u,
  );

  const retentionActivated = registry();
  retentionActivated.capabilities[0].productionState = "active";
  assert.throws(
    () => validateSecondWaveCapabilityRegistry(retentionActivated),
    /overstated productionState/u,
  );

  const runnerIntegrated = registry();
  runnerIntegrated.capabilities[1].deliveryState = "integrated";
  assert.throws(
    () => validateSecondWaveCapabilityRegistry(runnerIntegrated),
    /overstated deliveryState/u,
  );

  const corpusAvailable = registry();
  corpusAvailable.capabilities[2].availability = "private_available";
  assert.throws(
    () => validateSecondWaveCapabilityRegistry(corpusAvailable),
    /overstated availability/u,
  );

  const selfDeclared = registry();
  selfDeclared.capabilities[0].sourceAssertions = [
    {
      path: "docs/second-wave/IMPLEMENTATION.md",
      includes: "source-side controls",
    },
  ];
  assert.throws(
    () => validateSecondWaveCapabilityRegistry(selfDeclared),
    /exact required source assertions/u,
  );
});

test("verifies integrated source while keeping production and external evidence blocked", async () => {
  const root = await mkdtemp(join(tmpdir(), "bidbox-second-wave-"));
  try {
    const valid = registry();
    await copyEvidenceTree(root, valid);
    assert.deepEqual(await verifySecondWaveCapabilityEvidence(root, valid), {
      capabilityCount: 3,
    });

    const retentionPath = resolve(
      root,
      "config/operations/retention-completion-activation.v1.json",
    );
    const retention = JSON.parse(await readFile(retentionPath, "utf8"));
    retention.productionActivationGranted = true;
    retention.status = "active";
    await writeFile(retentionPath, `${JSON.stringify(retention, null, 2)}\n`);
    await assert.rejects(
      verifySecondWaveCapabilityEvidence(root, valid),
      /retention production activation must remain denied/u,
    );

    await copyFile(
      resolve(
        repositoryRoot,
        "config/operations/retention-completion-activation.v1.json",
      ),
      retentionPath,
    );
    const controlledPath = resolve(
      root,
      "config/operations/controlled-evaluation-runner.v1.json",
    );
    const controlled = JSON.parse(await readFile(controlledPath, "utf8"));
    controlled.authorisedProductionCorpusAvailable = true;
    controlled.privateFixtureLoaderConnected = true;
    await writeFile(controlledPath, `${JSON.stringify(controlled, null, 2)}\n`);
    await assert.rejects(
      verifySecondWaveCapabilityEvidence(root, valid),
      /controlled evaluation must remain foundation-only and disconnected/u,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("detects missing retention integration evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "bidbox-second-wave-source-"));
  try {
    const valid = registry();
    await copyEvidenceTree(root, valid);
    const routePath = resolve(
      root,
      "artifacts/api-server/src/routes/retentionCompletion.ts",
    );
    const route = await readFile(routePath, "utf8");
    await writeFile(
      routePath,
      route.replaceAll("retention-actions/:id/reconcile", "removed-reconcile"),
      "utf8",
    );
    await assert.rejects(
      verifySecondWaveCapabilityEvidence(root, valid),
      /durable_retention_completion evidence is missing/u,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
