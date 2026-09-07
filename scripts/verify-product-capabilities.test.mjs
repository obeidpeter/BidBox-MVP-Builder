import assert from "node:assert/strict";
import {
  copyFile,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import {
  REQUIRED_CAPABILITY_CONTRACTS,
  validateProductCapabilityRegistry,
  verifyProductCapabilityEvidence,
} from "./verify-product-capabilities.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const checkedInRegistry = JSON.parse(
  await readFile(
    resolve(repositoryRoot, "config/product/capabilities.v1.json"),
    "utf8",
  ),
);

function registry() {
  return structuredClone(checkedInRegistry);
}

async function copyEvidenceTree(targetRoot, value) {
  const paths = new Set(
    value.capabilities.flatMap((capability) => [
      ...capability.evidence,
      ...capability.sourceAssertions.map(({ path }) => path),
      ...REQUIRED_CAPABILITY_CONTRACTS[capability.id].guardAssertions.map(
        ({ path }) => path,
      ),
    ]),
  );
  for (const path of paths) {
    const target = resolve(targetRoot, path);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(resolve(repositoryRoot, path), target);
  }
}

test("requires the exact first-wave scope and frozen integration evidence", () => {
  const valid = registry();
  assert.doesNotThrow(() => validateProductCapabilityRegistry(valid));

  const missing = structuredClone(valid);
  missing.capabilities.pop();
  assert.throws(
    () => validateProductCapabilityRegistry(missing),
    /exact approved scope/u,
  );

  const overstated = structuredClone(valid);
  overstated.capabilities[4].deliveryState = "integrated";
  assert.throws(
    () => validateProductCapabilityRegistry(overstated),
    /role and tenant guards/u,
  );

  const automated = structuredClone(valid);
  automated.capabilities[0].automaticMutation = true;
  assert.throws(
    () => validateProductCapabilityRegistry(automated),
    /must not claim automatic mutation/u,
  );

  const selfDeclared = structuredClone(valid);
  selfDeclared.capabilities[1].evidence = ["evidence/self-declared.txt"];
  selfDeclared.capabilities[1].sourceAssertions = [
    { path: "evidence/self-declared.txt", includes: "looks integrated" },
  ];
  assert.throws(
    () => validateProductCapabilityRegistry(selfDeclared),
    /exact required evidence files/u,
  );
});

test("verifies central mounts, UI discovery and the unmounted worker boundary", async () => {
  const root = await mkdtemp(join(tmpdir(), "bidbox-capability-test-"));
  try {
    const valid = registry();
    await copyEvidenceTree(root, valid);

    assert.deepEqual(await verifyProductCapabilityEvidence(root, valid), {
      capabilityCount: 5,
    });

    const tenderUiPath = resolve(
      root,
      "artifacts/bidbox-workbench/src/pages/tender-context-route.tsx",
    );
    const tenderUi = await readFile(tenderUiPath, "utf8");
    await writeFile(
      tenderUiPath,
      tenderUi.replace(
        "export default function TenderContextRoute()",
        "function RemovedTenderContextRoute()",
      ),
      "utf8",
    );
    await assert.rejects(
      verifyProductCapabilityEvidence(root, valid),
      /tender_context_wizard evidence is missing/u,
    );
    await writeFile(tenderUiPath, tenderUi, "utf8");

    const tenderRoutePath = resolve(
      root,
      "artifacts/api-server/src/routes/tenderContext.ts",
    );
    const tenderRoute = await readFile(tenderRoutePath, "utf8");
    await writeFile(
      tenderRoutePath,
      tenderRoute.replace(
        "resolveCurrentDirectAuthority(",
        "removedCurrentDirectAuthority(",
      ),
      "utf8",
    );
    await assert.rejects(
      verifyProductCapabilityEvidence(root, valid),
      /tender_context_wizard guard evidence is missing/u,
    );
    await writeFile(tenderRoutePath, tenderRoute, "utf8");

    const snapshotRoutePath = resolve(
      root,
      "artifacts/api-server/src/routes/documentVersionSnapshots.ts",
    );
    const snapshotRoute = await readFile(snapshotRoutePath, "utf8");
    await writeFile(
      snapshotRoutePath,
      snapshotRoute.replace(
        "!permissions.every((permission) =>",
        "!removedPermissionsGate.every((permission) =>",
      ),
      "utf8",
    );
    await assert.rejects(
      verifyProductCapabilityEvidence(root, valid),
      /tender_context_wizard guard evidence is missing/u,
    );
    await writeFile(snapshotRoutePath, snapshotRoute, "utf8");

    const centralRouteIndexPath = resolve(
      root,
      "artifacts/api-server/src/routes/index.ts",
    );
    const centralRouteIndex = await readFile(centralRouteIndexPath, "utf8");
    await writeFile(
      centralRouteIndexPath,
      centralRouteIndex.replace(
        "router.use(attachTenantDatabase);\nrouter.use(enforceTenantResourceBoundary);",
        "router.use(enforceTenantResourceBoundary);\nrouter.use(attachTenantDatabase);",
      ),
      "utf8",
    );
    await assert.rejects(
      verifyProductCapabilityEvidence(root, valid),
      /pursuit_control_tower guard evidence is missing/u,
    );
    await writeFile(centralRouteIndexPath, centralRouteIndex, "utf8");

    const tenantGuardPair =
      "router.use(attachTenantDatabase);\nrouter.use(enforceTenantResourceBoundary);";
    await writeFile(
      centralRouteIndexPath,
      centralRouteIndex
        .replace(`${tenantGuardPair}\n\n`, "")
        .replace(
          "router.use(addendumImpactRouter);",
          `router.use(addendumImpactRouter);\n${tenantGuardPair}`,
        ),
      "utf8",
    );
    await assert.rejects(
      verifyProductCapabilityEvidence(root, valid),
      /pursuit_control_tower guard evidence is missing/u,
    );
    await writeFile(centralRouteIndexPath, centralRouteIndex, "utf8");

    const migrationPath = resolve(
      root,
      "lib/db/migrations/0010_tender_context_and_addendum.sql",
    );
    const migration = await readFile(migrationPath, "utf8");
    await writeFile(
      migrationPath,
      migration.replace("    'tender_context_versions',\n", ""),
      "utf8",
    );
    await assert.rejects(
      verifyProductCapabilityEvidence(root, valid),
      /tender_context_wizard guard evidence is missing/u,
    );
    await writeFile(migrationPath, migration, "utf8");

    await writeFile(
      migrationPath,
      migration.replace(
        "ALTER TABLE public.%I FORCE ROW LEVEL SECURITY",
        "ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY",
      ),
      "utf8",
    );
    await assert.rejects(
      verifyProductCapabilityEvidence(root, valid),
      /tender_context_wizard guard evidence is missing/u,
    );
    await writeFile(migrationPath, migration, "utf8");

    const routeIndexPath = resolve(
      root,
      "artifacts/api-server/src/routes/index.ts",
    );
    const routeIndex = await readFile(routeIndexPath, "utf8");
    await writeFile(
      routeIndexPath,
      `${routeIndex}\ncreateDurableWorkerFoundationRouter();\n`,
      "utf8",
    );
    await assert.rejects(
      verifyProductCapabilityEvidence(root, valid),
      /control router must remain unmounted/u,
    );
    await writeFile(routeIndexPath, routeIndex, "utf8");

    const workerPath = resolve(
      root,
      "config/operations/worker-activation.v1.json",
    );
    const worker = JSON.parse(await readFile(workerPath, "utf8"));
    worker.preconditions = [];
    await writeFile(workerPath, `${JSON.stringify(worker, null, 2)}\n`, "utf8");
    await assert.rejects(
      verifyProductCapabilityEvidence(root, valid),
      /exact reviewed precondition set/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
