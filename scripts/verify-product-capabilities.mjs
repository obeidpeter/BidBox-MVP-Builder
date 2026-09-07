import assert from "node:assert/strict";
import { lstat, readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const CAPABILITY_ID = /^[a-z][a-z0-9_]{2,79}$/u;
const DELIVERY_STATES = new Set([
  "integrated",
  "foundation_only",
  "disabled",
  "planned",
]);
const AVAILABILITY_STATES = new Set([
  "role_and_tenant_guarded",
  "internal_unmounted",
  "unavailable",
]);
const EXTERNAL_EFFECT_STATES = new Set([
  "none",
  "provider_disconnected",
  "connected",
]);
const REQUIRED_FIRST_WAVE_CAPABILITIES = new Set([
  "pursuit_control_tower",
  "tender_context_wizard",
  "eligibility_passport",
  "addendum_impact_centre",
  "durable_worker_foundation",
]);
const REQUIRED_WORKER_PRECONDITIONS = new Set([
  "workload_identity_connected",
  "provider_governance_verified",
  "budget_settlement_implemented",
  "trusted_receipt_verification_implemented",
  "control_router_publication_reviewed",
]);
const CENTRAL_TENANT_GUARD_ASSERTIONS = Object.freeze([
  Object.freeze({
    path: "artifacts/api-server/src/routes/index.ts",
    includes:
      "router.use(attachTenantDatabase);\nrouter.use(enforceTenantResourceBoundary);",
  }),
  Object.freeze({
    path: "artifacts/api-server/src/routes/index.ts",
    includes:
      "router.use(enforceTenantResourceBoundary);\n\nrouter.use(usersRouter);",
  }),
  Object.freeze({
    path: "artifacts/api-server/src/middlewares/databaseTenancy.ts",
    includes: "export function commitTenantDatabaseBeforeResponse(",
  }),
]);
const FIRST_WAVE_RLS_GUARD_ASSERTIONS = Object.freeze([
  Object.freeze({
    path: "lib/db/migrations/0010_tender_context_and_addendum.sql",
    includes: `FOREACH tenant_table IN ARRAY ARRAY[
    'addendum_impact_assessments',
    'addendum_impact_items',
    'document_version_snapshots',
    'tender_context_artifacts',
    'tender_context_requirements',
    'tender_context_versions',
    'tender_eligibility_passports'
  ]::text[]`,
  }),
  Object.freeze({
    path: "lib/db/migrations/0010_tender_context_and_addendum.sql",
    includes: "ALTER TABLE public.%I FORCE ROW LEVEL SECURITY",
  }),
  Object.freeze({
    path: "lib/db/migrations/0010_tender_context_and_addendum.sql",
    includes: "organisation_id = valo_security.current_organisation_id()",
  }),
  Object.freeze({
    path: "lib/db/src/runtimeSecurity.ts",
    includes: `const independentlyAttestedTables = new Set([
    "addendum_impact_assessments",
    "addendum_impact_items",
    "authenticated_rate_limit_buckets",
    "document_version_snapshots",
    "tender_context_artifacts",
    "tender_context_requirements",
    "tender_context_versions",
    "tender_eligibility_passports",
  ]);`,
  }),
  Object.freeze({
    path: "lib/db/src/runtimeSecurity.ts",
    includes: "tablePolicies.length !== 1",
  }),
]);
export const REQUIRED_CAPABILITY_CONTRACTS = Object.freeze({
  pursuit_control_tower: Object.freeze({
    evidence: Object.freeze([
      "artifacts/bidbox-workbench/src/pages/dashboard.tsx",
      "artifacts/bidbox-workbench/src/components/pursuit-control-tower.tsx",
      "artifacts/bidbox-workbench/src/lib/pursuit-control-tower.ts",
    ]),
    sourceAssertions: Object.freeze([
      Object.freeze({
        path: "artifacts/bidbox-workbench/src/pages/dashboard.tsx",
        includes: "<PursuitControlTower",
      }),
      Object.freeze({
        path: "artifacts/bidbox-workbench/src/components/pursuit-control-tower.tsx",
        includes: "export function PursuitControlTower",
      }),
      Object.freeze({
        path: "artifacts/bidbox-workbench/src/lib/pursuit-control-tower.ts",
        includes: "export function buildPursuitControlTower",
      }),
    ]),
    guardAssertions: Object.freeze([
      ...CENTRAL_TENANT_GUARD_ASSERTIONS,
      Object.freeze({
        path: "artifacts/bidbox-workbench/src/protected-routes.tsx",
        includes: '<Route path="/dashboard" component={RoleHome} />',
      }),
      Object.freeze({
        path: "artifacts/bidbox-workbench/src/components/role-home.tsx",
        includes: "if (isInternalRole(roles)) return <Dashboard />;",
      }),
      Object.freeze({
        path: "artifacts/api-server/src/routes/projects.ts",
        includes: 'requirePermissionOrLegacy("project:read")',
      }),
      Object.freeze({
        path: "artifacts/api-server/src/routes/operations.ts",
        includes: 'requirePermissionOrLegacy("project:read")',
      }),
    ]),
  }),
  tender_context_wizard: Object.freeze({
    evidence: Object.freeze([
      "artifacts/api-server/src/routes/documentVersionSnapshots.ts",
      "artifacts/api-server/src/routes/tenderContext.ts",
      "artifacts/api-server/src/lib/intelligence/tenderContextDrizzleRepository.ts",
      "artifacts/api-server/src/routes/index.ts",
      "artifacts/bidbox-workbench/src/pages/tender-context-route.tsx",
      "artifacts/bidbox-workbench/src/protected-routes.tsx",
      "artifacts/bidbox-workbench/src/pages/project-details.tsx",
    ]),
    sourceAssertions: Object.freeze([
      Object.freeze({
        path: "artifacts/api-server/src/routes/documentVersionSnapshots.ts",
        includes: "commitTenantDatabaseBeforeResponse",
      }),
      Object.freeze({
        path: "artifacts/api-server/src/routes/tenderContext.ts",
        includes: 'router.use("/projects/:id/tender-context", privateResponse)',
      }),
      Object.freeze({
        path: "artifacts/api-server/src/lib/intelligence/tenderContextDrizzleRepository.ts",
        includes: "validateStoredContextForAcceptance",
      }),
      Object.freeze({
        path: "artifacts/api-server/src/routes/index.ts",
        includes: "router.use(documentVersionSnapshotRouter);",
      }),
      Object.freeze({
        path: "artifacts/api-server/src/routes/index.ts",
        includes: "router.use(tenderContextRouter);",
      }),
      Object.freeze({
        path: "artifacts/bidbox-workbench/src/pages/tender-context-route.tsx",
        includes: "export default function TenderContextRoute()",
      }),
      Object.freeze({
        path: "artifacts/bidbox-workbench/src/protected-routes.tsx",
        includes: '<Route path="/projects/:id/tender-context">',
      }),
      Object.freeze({
        path: "artifacts/bidbox-workbench/src/pages/project-details.tsx",
        includes: "`/projects/${id}/tender-context`",
      }),
    ]),
    guardAssertions: Object.freeze([
      ...CENTRAL_TENANT_GUARD_ASSERTIONS,
      ...FIRST_WAVE_RLS_GUARD_ASSERTIONS,
      Object.freeze({
        path: "artifacts/api-server/src/routes/documentVersionSnapshots.ts",
        includes: "resolveCurrentDirectAuthority(",
      }),
      Object.freeze({
        path: "artifacts/api-server/src/routes/documentVersionSnapshots.ts",
        includes: 'access.source !== "membership"',
      }),
      Object.freeze({
        path: "artifacts/api-server/src/routes/documentVersionSnapshots.ts",
        includes: "!permissions.every((permission) =>",
      }),
      Object.freeze({
        path: "artifacts/api-server/src/lib/documentVersionSnapshotRepository.ts",
        includes: "async function requireCurrentAuthority(",
      }),
      Object.freeze({
        path: "artifacts/api-server/src/routes/tenderContext.ts",
        includes: "resolveCurrentDirectAuthority(",
      }),
      Object.freeze({
        path: "artifacts/api-server/src/routes/tenderContext.ts",
        includes: "!requiredPermissions.every((permission) =>",
      }),
      Object.freeze({
        path: "artifacts/api-server/src/lib/intelligence/tenderContextDrizzleRepository.ts",
        includes: "async function requireCurrentWriteAuthority(",
      }),
    ]),
  }),
  eligibility_passport: Object.freeze({
    evidence: Object.freeze([
      "artifacts/api-server/src/routes/tenderContext.ts",
      "artifacts/api-server/src/lib/intelligence/tenderContextDrizzleRepository.ts",
      "artifacts/api-server/src/lib/intelligence/tenderContext.ts",
      "artifacts/api-server/src/lib/intelligence/tenderContextContracts.ts",
      "artifacts/api-server/src/routes/index.ts",
      "artifacts/bidbox-workbench/src/pages/tender-context-route.tsx",
      "artifacts/bidbox-workbench/src/protected-routes.tsx",
      "artifacts/bidbox-workbench/src/pages/project-details.tsx",
    ]),
    sourceAssertions: Object.freeze([
      Object.freeze({
        path: "artifacts/api-server/src/routes/tenderContext.ts",
        includes: "eligibility-passports/:passportRecordId/review",
      }),
      Object.freeze({
        path: "artifacts/api-server/src/lib/intelligence/tenderContextDrizzleRepository.ts",
        includes: "evaluatePassportFromAcceptedSnapshot",
      }),
      Object.freeze({
        path: "artifacts/api-server/src/lib/intelligence/tenderContextContracts.ts",
        includes: "TENDER_CONTEXT_AUTHORITY_NOTE",
      }),
      Object.freeze({
        path: "artifacts/api-server/src/routes/index.ts",
        includes: "router.use(tenderContextRouter);",
      }),
      Object.freeze({
        path: "artifacts/bidbox-workbench/src/pages/tender-context-route.tsx",
        includes: "createTenderEligibilityPassport",
      }),
      Object.freeze({
        path: "artifacts/bidbox-workbench/src/protected-routes.tsx",
        includes: '<Route path="/projects/:id/tender-context">',
      }),
      Object.freeze({
        path: "artifacts/bidbox-workbench/src/pages/project-details.tsx",
        includes: "Open Tender Context &amp; Eligibility Passport",
      }),
    ]),
    guardAssertions: Object.freeze([
      ...CENTRAL_TENANT_GUARD_ASSERTIONS,
      ...FIRST_WAVE_RLS_GUARD_ASSERTIONS,
      Object.freeze({
        path: "artifacts/api-server/src/routes/tenderContext.ts",
        includes: "resolveCurrentDirectAuthority(",
      }),
      Object.freeze({
        path: "artifacts/api-server/src/routes/tenderContext.ts",
        includes: "!requiredPermissions.every((permission) =>",
      }),
      Object.freeze({
        path: "artifacts/api-server/src/lib/intelligence/tenderContextDrizzleRepository.ts",
        includes: "async function requireCurrentWriteAuthority(",
      }),
      Object.freeze({
        path: "artifacts/api-server/src/lib/intelligence/tenderContextDrizzleRepository.ts",
        includes: "await validateStoredContextForAcceptance(",
      }),
    ]),
  }),
  addendum_impact_centre: Object.freeze({
    evidence: Object.freeze([
      "artifacts/api-server/src/routes/addendumImpact.ts",
      "artifacts/api-server/src/lib/intelligence/addendumImpactService.ts",
      "artifacts/api-server/src/routes/index.ts",
      "artifacts/bidbox-workbench/src/components/intelligence/addendum-impact-centre.tsx",
      "artifacts/bidbox-workbench/src/components/intelligence/addendum-impact-contract.ts",
      "artifacts/bidbox-workbench/src/pages/intelligence-centre-route.tsx",
    ]),
    sourceAssertions: Object.freeze([
      Object.freeze({
        path: "artifacts/api-server/src/routes/addendumImpact.ts",
        includes: "commitTenantDatabaseBeforeResponse",
      }),
      Object.freeze({
        path: "artifacts/api-server/src/lib/intelligence/addendumImpactService.ts",
        includes: "ADDENDUM_REOPEN_CONFIRMATION",
      }),
      Object.freeze({
        path: "artifacts/api-server/src/routes/index.ts",
        includes: "router.use(addendumImpactRouter);",
      }),
      Object.freeze({
        path: "artifacts/bidbox-workbench/src/components/intelligence/addendum-impact-contract.ts",
        includes: "REOPEN AFFECTED WORK",
      }),
      Object.freeze({
        path: "artifacts/bidbox-workbench/src/pages/intelligence-centre-route.tsx",
        includes: "<AddendumImpactCentre projectId={selectedProjectId} />",
      }),
    ]),
    guardAssertions: Object.freeze([
      ...CENTRAL_TENANT_GUARD_ASSERTIONS,
      ...FIRST_WAVE_RLS_GUARD_ASSERTIONS,
      Object.freeze({
        path: "artifacts/api-server/src/routes/addendumImpact.ts",
        includes: "resolveCurrentDirectAuthority(",
      }),
      Object.freeze({
        path: "artifacts/api-server/src/routes/addendumImpact.ts",
        includes: 'context.source !== "membership"',
      }),
      Object.freeze({
        path: "artifacts/api-server/src/routes/addendumImpact.ts",
        includes: "!requiredPermissions.every((permission) =>",
      }),
      Object.freeze({
        path: "artifacts/api-server/src/lib/intelligence/addendumImpactDrizzleRepository.ts",
        includes: "async function acquireAddendumMutationLocks(",
      }),
      Object.freeze({
        path: "artifacts/api-server/src/lib/intelligence/addendumImpactDrizzleRepository.ts",
        includes: "function assertCurrentPlanIdentity(",
      }),
    ]),
  }),
  durable_worker_foundation: Object.freeze({
    evidence: Object.freeze([
      "config/operations/worker-activation.v1.json",
      "artifacts/api-server/src/lib/durableWorkerFoundation.ts",
      "artifacts/api-server/src/routes/index.ts",
      "lib/api-spec/openapi.yaml",
    ]),
    sourceAssertions: Object.freeze([
      Object.freeze({
        path: "config/operations/worker-activation.v1.json",
        includes: "preconditions_open_control_router_unmounted",
      }),
      Object.freeze({
        path: "config/operations/worker-activation.v1.json",
        includes: '"controlRouterMounted": false',
      }),
      Object.freeze({
        path: "artifacts/api-server/src/lib/durableWorkerFoundation.ts",
        includes: 'throw new DurableWorkerError("provider_disconnected")',
      }),
    ]),
    guardAssertions: Object.freeze([]),
  }),
});

function assertPlainObject(value, label) {
  assert.ok(
    value && typeof value === "object" && !Array.isArray(value),
    `${label} must be an object`,
  );
}

function assertWorkspacePath(path, label) {
  assert.equal(typeof path, "string", `${label} must be a string`);
  assert.ok(path.length > 0, `${label} must not be empty`);
  assert.equal(isAbsolute(path), false, `${label} must be workspace-relative`);
  const normalized = path.replaceAll("\\", "/");
  assert.equal(normalized, path, `${label} must use forward slashes`);
  assert.equal(
    normalized.split("/").includes(".."),
    false,
    `${label} must stay within the workspace`,
  );
}

export function validateProductCapabilityRegistry(registry) {
  assertPlainObject(registry, "Capability registry");
  assert.equal(registry.schemaVersion, 1);
  assert.equal(registry.registryId, "bidbox-product-capabilities/v1");
  assert.equal(
    registry.authority,
    "checked_in_source_and_runtime_gates_are_authoritative",
  );
  assert.ok(Array.isArray(registry.capabilities));

  const seen = new Set();
  for (const capability of registry.capabilities) {
    assertPlainObject(capability, "Capability");
    assert.match(capability.id, CAPABILITY_ID);
    assert.equal(seen.has(capability.id), false, `Duplicate ${capability.id}`);
    seen.add(capability.id);
    assert.equal(capability.wave, "first");
    assert.ok(
      DELIVERY_STATES.has(capability.deliveryState),
      `${capability.id} has an invalid delivery state`,
    );
    assert.ok(
      AVAILABILITY_STATES.has(capability.availability),
      `${capability.id} has an invalid availability`,
    );
    assert.ok(
      EXTERNAL_EFFECT_STATES.has(capability.externalEffects),
      `${capability.id} has an invalid external-effects state`,
    );
    assert.equal(typeof capability.title, "string");
    assert.ok(capability.title.trim().length >= 3);
    assert.equal(typeof capability.authorityBoundary, "string");
    assert.ok(
      capability.authorityBoundary.trim().length >= 20,
      `${capability.id} must state its authority boundary`,
    );
    assert.equal(typeof capability.automaticMutation, "boolean");
    assert.equal(
      capability.automaticMutation,
      false,
      `${capability.id} must not claim automatic mutation in the first wave`,
    );
    assert.equal(
      capability.namedHumanAuthority,
      true,
      `${capability.id} must preserve named-human authority`,
    );
    const requiredContract = REQUIRED_CAPABILITY_CONTRACTS[capability.id];
    assert.ok(
      requiredContract,
      `${capability.id} has no frozen capability evidence contract`,
    );
    assert.ok(
      Array.isArray(capability.evidence) && capability.evidence.length > 0,
      `${capability.id} needs checked-in evidence`,
    );
    assert.deepEqual(
      capability.evidence,
      [...requiredContract.evidence],
      `${capability.id} must declare the exact required evidence files`,
    );
    for (const [index, path] of capability.evidence.entries()) {
      assertWorkspacePath(path, `${capability.id}.evidence[${index}]`);
    }
    assert.ok(
      Array.isArray(capability.sourceAssertions) &&
        capability.sourceAssertions.length > 0,
      `${capability.id} needs checked-in source assertions`,
    );
    assert.deepEqual(
      capability.sourceAssertions,
      requiredContract.sourceAssertions.map((item) => ({ ...item })),
      `${capability.id} must declare the exact required source assertions`,
    );
    for (const [
      index,
      sourceAssertion,
    ] of capability.sourceAssertions.entries()) {
      assertPlainObject(
        sourceAssertion,
        `${capability.id}.sourceAssertions[${index}]`,
      );
      assertWorkspacePath(
        sourceAssertion.path,
        `${capability.id}.sourceAssertions[${index}].path`,
      );
      assert.equal(typeof sourceAssertion.includes, "string");
      assert.ok(sourceAssertion.includes.length >= 3);
    }

    if (capability.deliveryState === "integrated") {
      assert.equal(
        capability.availability,
        "role_and_tenant_guarded",
        `${capability.id} may only claim integration behind role and tenant guards`,
      );
    }
    if (capability.availability === "internal_unmounted") {
      assert.equal(
        capability.deliveryState,
        "foundation_only",
        `${capability.id} must not claim an unmounted foundation is integrated`,
      );
    }
    if (capability.externalEffects === "provider_disconnected") {
      assert.notEqual(
        capability.deliveryState,
        "integrated",
        `${capability.id} must not claim an externally disconnected effect is integrated`,
      );
    }
    if (capability.deliveryState === "integrated") {
      assert.equal(
        capability.externalEffects,
        "none",
        `${capability.id} must not claim connected external effects in the first wave`,
      );
    }
  }

  assert.deepEqual(
    new Set(seen),
    REQUIRED_FIRST_WAVE_CAPABILITIES,
    "The first-wave registry must enumerate the exact approved scope",
  );
  return registry;
}

async function readRegularWorkspaceFile(root, path) {
  const absolute = resolve(root, path);
  const relativePath = relative(root, absolute);
  assert.ok(
    relativePath &&
      relativePath !== ".." &&
      !relativePath.startsWith(`..${sep}`) &&
      !isAbsolute(relativePath),
    `${path} escapes the workspace`,
  );
  const stat = await lstat(absolute);
  assert.equal(stat.isFile(), true, `${path} must be a regular file`);
  assert.equal(stat.isSymbolicLink(), false, `${path} must not be a symlink`);
  return readFile(absolute, "utf8");
}

export async function verifyProductCapabilityEvidence(root, registry) {
  validateProductCapabilityRegistry(registry);
  const sourceByPath = new Map();
  for (const capability of registry.capabilities) {
    for (const path of capability.evidence) {
      if (!sourceByPath.has(path)) {
        sourceByPath.set(path, await readRegularWorkspaceFile(root, path));
      }
    }
    for (const sourceAssertion of capability.sourceAssertions) {
      let source = sourceByPath.get(sourceAssertion.path);
      if (source === undefined) {
        source = await readRegularWorkspaceFile(root, sourceAssertion.path);
        sourceByPath.set(sourceAssertion.path, source);
      }
      assert.ok(
        source.includes(sourceAssertion.includes),
        `${capability.id} evidence is missing ${JSON.stringify(sourceAssertion.includes)} in ${sourceAssertion.path}`,
      );
    }
    const requiredContract = REQUIRED_CAPABILITY_CONTRACTS[capability.id];
    for (const guardAssertion of requiredContract.guardAssertions) {
      let source = sourceByPath.get(guardAssertion.path);
      if (source === undefined) {
        source = await readRegularWorkspaceFile(root, guardAssertion.path);
        sourceByPath.set(guardAssertion.path, source);
      }
      assert.ok(
        source.includes(guardAssertion.includes),
        `${capability.id} guard evidence is missing ${JSON.stringify(guardAssertion.includes)} in ${guardAssertion.path}`,
      );
    }
  }

  const workerActivation = JSON.parse(
    sourceByPath.get("config/operations/worker-activation.v1.json") ??
      (await readRegularWorkspaceFile(
        root,
        "config/operations/worker-activation.v1.json",
      )),
  );
  const worker = registry.capabilities.find(
    ({ id }) => id === "durable_worker_foundation",
  );
  assert.equal(workerActivation.controlRouterMounted, false);
  assert.equal(
    workerActivation.status,
    "preconditions_open_control_router_unmounted",
  );
  assert.equal(worker.deliveryState, "foundation_only");
  assert.equal(worker.availability, "internal_unmounted");
  assert.equal(worker.externalEffects, "provider_disconnected");
  assert.equal(worker.automaticMutation, false);
  assert.ok(Array.isArray(workerActivation.preconditions));
  assert.deepEqual(
    new Set(workerActivation.preconditions.map(({ id }) => id)),
    REQUIRED_WORKER_PRECONDITIONS,
    "Worker activation must retain the exact reviewed precondition set",
  );
  assert.equal(
    workerActivation.preconditions.length,
    REQUIRED_WORKER_PRECONDITIONS.size,
    "Worker activation preconditions must be unique",
  );
  assert.ok(
    workerActivation.preconditions.every(({ status }) => status === "open"),
    "Worker activation must remain fail closed while its evidence is open",
  );
  const routeIndex = sourceByPath.get(
    "artifacts/api-server/src/routes/index.ts",
  );
  const openApi = sourceByPath.get("lib/api-spec/openapi.yaml");
  assert.equal(typeof routeIndex, "string");
  assert.equal(typeof openApi, "string");
  assert.equal(
    routeIndex.includes("createDurableWorkerFoundationRouter"),
    false,
    "Durable worker control router must remain unmounted",
  );
  assert.equal(
    routeIndex.includes('"./durableWorkerFoundation"'),
    false,
    "Durable worker control router must not be imported by the application",
  );
  assert.equal(
    /^  \/[^\n]*(?:worker|outbox)[^\n]*:/imu.test(openApi),
    false,
    "Durable worker and outbox control paths must remain unpublished",
  );
  assert.equal(
    /operationId:\s*\S*(?:Worker|Outbox)/u.test(openApi),
    false,
    "Durable worker and outbox control operations must remain unpublished",
  );
  return { capabilityCount: registry.capabilities.length };
}

export async function loadAndVerifyProductCapabilityRegistry(root) {
  const registry = JSON.parse(
    await readRegularWorkspaceFile(root, "config/product/capabilities.v1.json"),
  );
  return verifyProductCapabilityEvidence(root, registry);
}

const modulePath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === modulePath) {
  const root = resolve(import.meta.dirname, "..");
  const result = await loadAndVerifyProductCapabilityRegistry(root);
  console.log(`Verified ${result.capabilityCount} first-wave capabilities.`);
}
