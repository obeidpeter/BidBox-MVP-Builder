import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const operationsSource = readFileSync(
  new URL("./operationsSuite.ts", import.meta.url),
  "utf8",
);
const growthSource = readFileSync(
  new URL("./growthSuite.ts", import.meta.url),
  "utf8",
);
const reportsSource = readFileSync(
  new URL("./reports.ts", import.meta.url),
  "utf8",
);
const retentionCompletionSource = readFileSync(
  new URL("./retentionCompletion.ts", import.meta.url),
  "utf8",
);
const clientUploadSource = readFileSync(
  new URL("./clientActionUpload.ts", import.meta.url),
  "utf8",
);
const clientUploadServiceSource = readFileSync(
  new URL("../lib/storageLifecycle/clientUpload.ts", import.meta.url),
  "utf8",
);
const routeIndexSource = readFileSync(
  new URL("./index.ts", import.meta.url),
  "utf8",
);
const operationsErrorSource = readFileSync(
  new URL("../lib/operationsSuite/errors.ts", import.meta.url),
  "utf8",
);
const boundedJsonBodySource = readFileSync(
  new URL("./boundedJsonBody.ts", import.meta.url),
  "utf8",
);
const openApi = readFileSync(
  new URL("../../../../lib/api-spec/openapi.yaml", import.meta.url),
  "utf8",
);
const reactClient = readFileSync(
  new URL(
    "../../../../lib/api-client-react/src/generated/api.ts",
    import.meta.url,
  ),
  "utf8",
);
const zodClient = readFileSync(
  new URL("../../../../lib/api-zod/src/generated/api.ts", import.meta.url),
  "utf8",
);

type Suite = "operations" | "growth" | "reports" | "client-upload";
type Method = "get" | "post" | "patch";

interface ContractEntry {
  suite: Suite;
  method: Method;
  expressPath: string;
  openApiPath: string;
  operationId: string;
  statuses: readonly number[];
}

const OPERATIONS_READ = [200, 400, 401, 403, 409, 413, 422] as const;
const OPERATIONS_MUTATION = [200, 400, 401, 403, 404, 409, 413, 422] as const;
const OPERATIONS_CREATE = [201, 400, 401, 403, 409, 413] as const;

const manifest: readonly ContractEntry[] = [
  {
    suite: "client-upload",
    method: "post",
    expressPath:
      "/projects/:id/client-actions/evidence-requests/:recordId/slots/:slotId/upload-leases",
    openApiPath:
      "/projects/{id}/client-actions/evidence-requests/{recordId}/slots/{slotId}/upload-leases",
    operationId: "issueClientActionUploadLease",
    statuses: [200, 201, 400, 401, 403, 404, 409, 410, 413, 500, 503],
  },
  {
    suite: "client-upload",
    method: "post",
    expressPath:
      "/projects/:id/client-actions/evidence-requests/:recordId/slots/:slotId/upload-leases/:leaseId/finalize",
    openApiPath:
      "/projects/{id}/client-actions/evidence-requests/{recordId}/slots/{slotId}/upload-leases/{leaseId}/finalize",
    operationId: "finalizeClientActionUploadLease",
    statuses: [200, 201, 400, 401, 403, 404, 409, 410, 413, 422, 500, 503],
  },
  {
    suite: "reports",
    method: "get",
    expressPath: "/projects/:id/package-versions",
    openApiPath: "/projects/{id}/package-versions",
    operationId: "listProjectPackageVersions",
    statuses: [200, 401, 403, 404, 500],
  },
  {
    suite: "growth",
    method: "get",
    expressPath: "/growth-suite/onboarding",
    openApiPath: "/growth-suite/onboarding",
    operationId: "getGrowthOnboarding",
    statuses: [200, 401, 403, 503],
  },
  {
    suite: "growth",
    method: "post",
    expressPath: "/growth-suite/onboarding/progress",
    openApiPath: "/growth-suite/onboarding/progress",
    operationId: "mutateGrowthOnboardingProgress",
    statuses: [200, 400, 401, 403, 409, 503],
  },
  {
    suite: "growth",
    method: "get",
    expressPath: "/growth-suite/offers",
    openApiPath: "/growth-suite/offers",
    operationId: "getGrowthOfferCatalogue",
    statuses: [200, 401, 403],
  },
  {
    suite: "growth",
    method: "get",
    expressPath: "/growth-suite/leads",
    openApiPath: "/growth-suite/leads",
    operationId: "listGrowthLeads",
    statuses: [200, 400, 401, 403, 503],
  },
  {
    suite: "growth",
    method: "post",
    expressPath: "/growth-suite/leads/:id/actions",
    openApiPath: "/growth-suite/leads/{id}/actions",
    operationId: "mutateGrowthLead",
    statuses: [200, 400, 401, 403, 409, 503],
  },
  {
    suite: "growth",
    method: "post",
    expressPath: "/growth-suite/leads/:id/contact-handoff",
    openApiPath: "/growth-suite/leads/{id}/contact-handoff",
    operationId: "openGrowthLeadContactHandoff",
    statuses: [200, 400, 401, 403, 409, 503],
  },
  {
    suite: "growth",
    method: "get",
    expressPath: "/growth-suite/quotes",
    openApiPath: "/growth-suite/quotes",
    operationId: "listGrowthQuotes",
    statuses: [200, 400, 401, 403, 503],
  },
  {
    suite: "growth",
    method: "post",
    expressPath: "/growth-suite/quotes",
    openApiPath: "/growth-suite/quotes",
    operationId: "createGrowthQuoteDraft",
    statuses: [201, 400, 401, 403, 503],
  },
  {
    suite: "growth",
    method: "post",
    expressPath: "/growth-suite/quotes/:id/approve",
    openApiPath: "/growth-suite/quotes/{id}/approve",
    operationId: "approveGrowthQuote",
    statuses: [200, 400, 401, 403, 409, 503],
  },
  {
    suite: "operations",
    method: "get",
    expressPath: "/projects/:id/operations-suite",
    openApiPath: "/projects/{id}/operations-suite",
    operationId: "getOperationsSuiteSnapshot",
    statuses: OPERATIONS_READ,
  },
  {
    suite: "operations",
    method: "get",
    expressPath: "/projects/:id/operations-suite/my-work",
    openApiPath: "/projects/{id}/operations-suite/my-work",
    operationId: "listMyOperationsWork",
    statuses: OPERATIONS_READ,
  },
  {
    suite: "operations",
    method: "get",
    expressPath: "/projects/:id/operations-suite/mobile-queue",
    openApiPath: "/projects/{id}/operations-suite/mobile-queue",
    operationId: "getOperationsMobileQueue",
    statuses: OPERATIONS_READ,
  },
  {
    suite: "operations",
    method: "get",
    expressPath: "/projects/:id/operations-suite/records/:recordId",
    openApiPath: "/projects/{id}/operations-suite/records/{recordId}",
    operationId: "getOperationsRecord",
    statuses: [200, 400, 401, 403, 404, 413, 422],
  },
  {
    suite: "operations",
    method: "post",
    expressPath: "/projects/:id/operations-suite/opportunities",
    openApiPath: "/projects/{id}/operations-suite/opportunities",
    operationId: "createOperationsOpportunityIntake",
    statuses: OPERATIONS_CREATE,
  },
  {
    suite: "operations",
    method: "post",
    expressPath:
      "/projects/:id/operations-suite/opportunities/:recordId/confirm-deadline",
    openApiPath:
      "/projects/{id}/operations-suite/opportunities/{recordId}/confirm-deadline",
    operationId: "confirmOperationsOpportunityDeadline",
    statuses: OPERATIONS_MUTATION,
  },
  {
    suite: "operations",
    method: "post",
    expressPath: "/projects/:id/operations-suite/work-items",
    openApiPath: "/projects/{id}/operations-suite/work-items",
    operationId: "createOperationsWorkItem",
    statuses: [...OPERATIONS_CREATE, 422],
  },
  {
    suite: "operations",
    method: "patch",
    expressPath: "/projects/:id/operations-suite/work-items/:recordId",
    openApiPath: "/projects/{id}/operations-suite/work-items/{recordId}",
    operationId: "updateOperationsWorkItem",
    statuses: OPERATIONS_MUTATION,
  },
  {
    suite: "operations",
    method: "post",
    expressPath: "/projects/:id/operations-suite/work-items/:recordId/comments",
    openApiPath:
      "/projects/{id}/operations-suite/work-items/{recordId}/comments",
    operationId: "addOperationsWorkItemComment",
    statuses: OPERATIONS_MUTATION,
  },
  {
    suite: "operations",
    method: "post",
    expressPath:
      "/projects/:id/operations-suite/work-items/:recordId/field-draft-promotions",
    openApiPath:
      "/projects/{id}/operations-suite/work-items/{recordId}/field-draft-promotions",
    operationId: "promoteFieldDraftToOperationsWorkItem",
    statuses: OPERATIONS_MUTATION,
  },
  {
    suite: "operations",
    method: "post",
    expressPath: "/projects/:id/operations-suite/work-items/:recordId/approval",
    openApiPath:
      "/projects/{id}/operations-suite/work-items/{recordId}/approval",
    operationId: "decideOperationsWorkItemApproval",
    statuses: OPERATIONS_MUTATION,
  },
  {
    suite: "operations",
    method: "post",
    expressPath: "/projects/:id/operations-suite/evidence-requests",
    openApiPath: "/projects/{id}/operations-suite/evidence-requests",
    operationId: "createOperationsEvidenceRequest",
    statuses: OPERATIONS_CREATE,
  },
  {
    suite: "operations",
    method: "post",
    expressPath:
      "/projects/:id/operations-suite/evidence-requests/:recordId/mark-shared",
    openApiPath:
      "/projects/{id}/operations-suite/evidence-requests/{recordId}/mark-shared",
    operationId: "markOperationsEvidenceRequestShared",
    statuses: OPERATIONS_MUTATION,
  },
  {
    suite: "operations",
    method: "post",
    expressPath:
      "/projects/:id/operations-suite/evidence-requests/:recordId/responses",
    openApiPath:
      "/projects/{id}/operations-suite/evidence-requests/{recordId}/responses",
    operationId: "recordOperationsEvidenceResponse",
    statuses: OPERATIONS_MUTATION,
  },
  {
    suite: "operations",
    method: "post",
    expressPath:
      "/projects/:id/operations-suite/evidence-requests/:recordId/decisions",
    openApiPath:
      "/projects/{id}/operations-suite/evidence-requests/{recordId}/decisions",
    operationId: "decideOperationsEvidenceResponse",
    statuses: OPERATIONS_MUTATION,
  },
  {
    suite: "operations",
    method: "post",
    expressPath: "/projects/:id/operations-suite/submission-war-rooms",
    openApiPath: "/projects/{id}/operations-suite/submission-war-rooms",
    operationId: "createOperationsSubmissionWarRoom",
    statuses: OPERATIONS_CREATE,
  },
  {
    suite: "operations",
    method: "post",
    expressPath:
      "/projects/:id/operations-suite/submission-war-rooms/:recordId/advance",
    openApiPath:
      "/projects/{id}/operations-suite/submission-war-rooms/{recordId}/advance",
    operationId: "advanceOperationsSubmissionWarRoom",
    statuses: OPERATIONS_MUTATION,
  },
  {
    suite: "operations",
    method: "post",
    expressPath: "/projects/:id/operations-suite/visual-qa-reports",
    openApiPath: "/projects/{id}/operations-suite/visual-qa-reports",
    operationId: "createOperationsVisualQaReport",
    statuses: OPERATIONS_CREATE,
  },
  {
    suite: "operations",
    method: "post",
    expressPath: "/projects/:id/operations-suite/credential-verifications",
    openApiPath: "/projects/{id}/operations-suite/credential-verifications",
    operationId: "createOperationsCredentialVerification",
    statuses: OPERATIONS_CREATE,
  },
  {
    suite: "operations",
    method: "post",
    expressPath: "/projects/:id/operations-suite/missions",
    openApiPath: "/projects/{id}/operations-suite/missions",
    operationId: "createOperationsMission",
    statuses: OPERATIONS_CREATE,
  },
  {
    suite: "operations",
    method: "patch",
    expressPath: "/projects/:id/operations-suite/missions/:recordId",
    openApiPath: "/projects/{id}/operations-suite/missions/{recordId}",
    operationId: "updateOperationsMission",
    statuses: OPERATIONS_MUTATION,
  },
  {
    suite: "operations",
    method: "post",
    expressPath: "/projects/:id/operations-suite/post-award-items",
    openApiPath: "/projects/{id}/operations-suite/post-award-items",
    operationId: "createOperationsPostAwardItem",
    statuses: OPERATIONS_CREATE,
  },
  {
    suite: "operations",
    method: "patch",
    expressPath: "/projects/:id/operations-suite/post-award-items/:recordId",
    openApiPath: "/projects/{id}/operations-suite/post-award-items/{recordId}",
    operationId: "updateOperationsPostAwardItem",
    statuses: OPERATIONS_MUTATION,
  },
];

function sourceRoutes(source: string): string[] {
  return [...source.matchAll(/router\.(get|post|patch)\(\s*"([^"]+)"/gu)]
    .map((match) => `${match[1]} ${match[2]}`)
    .sort();
}

function openApiOperation(entry: ContractEntry): string {
  const pathMarker = `\n  ${entry.openApiPath}:\n`;
  const pathStart = openApi.indexOf(pathMarker);
  assert.notEqual(pathStart, -1, `missing OpenAPI path ${entry.openApiPath}`);
  const nextPath = openApi.indexOf("\n  /", pathStart + pathMarker.length);
  const pathBlock = openApi.slice(
    pathStart,
    nextPath === -1 ? openApi.indexOf("\ncomponents:", pathStart) : nextPath,
  );
  const methodMarker = `\n    ${entry.method}:\n`;
  const methodStart = pathBlock.indexOf(methodMarker);
  assert.notEqual(
    methodStart,
    -1,
    `missing ${entry.method} ${entry.openApiPath}`,
  );
  const remaining = pathBlock.slice(methodStart + methodMarker.length);
  const nextMethod = remaining.search(
    /\n    (?:get|post|patch|put|delete):\n/u,
  );
  return remaining.slice(0, nextMethod === -1 ? undefined : nextMethod);
}

function openApiSchema(name: string): string {
  const marker = `\n    ${name}:\n`;
  const start = openApi.indexOf(marker);
  assert.notEqual(start, -1, `missing OpenAPI schema ${name}`);
  const remaining = openApi.slice(start + marker.length);
  const next = remaining.search(/\n    [A-Za-z][A-Za-z0-9]+:\n/u);
  return remaining.slice(0, next === -1 ? undefined : next);
}

function pascal(value: string): string {
  return value[0]!.toUpperCase() + value.slice(1);
}

test("growth, operations, package discovery and governed client upload routes have one exact OpenAPI operation each", () => {
  for (const suite of ["growth", "operations"] as const) {
    const expected = manifest
      .filter((entry) => entry.suite === suite)
      .map(({ method, expressPath }) => `${method} ${expressPath}`)
      .sort();
    const actual = sourceRoutes(
      suite === "growth" ? growthSource : operationsSource,
    );
    assert.deepEqual(actual, expected, `${suite} route manifest drifted`);
  }
  const reportRoutes = sourceRoutes(reportsSource);
  for (const { method, expressPath } of manifest.filter(
    ({ suite }) => suite === "reports",
  )) {
    const expected = `${method} ${expressPath}`;
    assert.equal(
      reportRoutes.filter((route) => route === expected).length,
      1,
      `reports route ${expected} must be mounted exactly once`,
    );
  }
  const clientUploadEntries = manifest.filter(
    ({ suite }) => suite === "client-upload",
  );
  assert.equal(clientUploadEntries.length, 2);
  assert.match(
    clientUploadSource,
    /const base =\s*"\/projects\/:id\/client-actions\/evidence-requests\/:recordId\/slots\/:slotId\/upload-leases";/u,
  );
  assert.match(clientUploadSource, /router\.post\(base,/u);
  assert.match(
    clientUploadSource,
    /router\.post\(\s*`\$\{base\}\/:leaseId\/finalize`,/u,
  );

  for (const entry of manifest) {
    const operation = openApiOperation(entry);
    assert.match(
      operation,
      new RegExp(`operationId: ${entry.operationId}\\b`, "u"),
    );
    const actualStatuses = [...operation.matchAll(/^        "(\d{3})":/gmu)]
      .map((match) => Number(match[1]))
      .sort((left, right) => left - right);
    assert.deepEqual(
      actualStatuses,
      [...entry.statuses].sort((left, right) => left - right),
      `${entry.operationId} status contract drifted`,
    );
  }
});

test("documented errors come from the mounted authentication and suite policies", () => {
  assert.ok(
    routeIndexSource.indexOf("router.use(attachUser)") <
      routeIndexSource.indexOf("router.use(attachTenantContext)"),
  );
  assert.ok(
    routeIndexSource.indexOf("router.use(attachTenantContext)") <
      routeIndexSource.indexOf("router.use(operationsSuiteRouter)"),
  );
  assert.ok(
    routeIndexSource.indexOf("router.use(attachTenantContext)") <
      routeIndexSource.indexOf("router.use(growthSuiteRouter)"),
  );
  assert.ok(
    routeIndexSource.indexOf("router.use(attachTenantDatabase)") <
      routeIndexSource.indexOf("router.use(clientActionUploadRouter)"),
  );
  for (const [code, status] of [
    ["invalid_request", 400],
    ["scope_denied", 403],
    ["not_found", 404],
    ["conflict", 409],
    ["stale_version", 409],
    ["capacity_exceeded", 413],
    ["policy_denied", 422],
  ] as const) {
    assert.match(
      operationsErrorSource,
      new RegExp(`case "${code}":[\\s\\S]{0,80}return ${status};`, "u"),
    );
  }
  for (const status of [400, 403, 409, 503]) {
    assert.match(growthSource, new RegExp(`\\.status\\(${status}\\)`, "u"));
  }
  assert.match(operationsSource, /res\.status\(created \? 201 : 200\)/u);
  assert.match(
    operationsSource,
    /createBoundedJsonBody\([\s\S]*?OPERATIONS_SUITE_BOUNDS\.requestBodyBytes,[\s\S]*?"operations",[\s\S]*?\)/u,
  );
  assert.match(boundedJsonBodySource, /res\.status\(413\)\.json/u);
  assert.match(
    boundedJsonBodySource,
    /Request body exceeds the \$\{domain\} bound\./u,
  );
  for (const [code, status] of [
    ["invalid_request", 400],
    ["scope_denied", 403],
    ["not_found", 404],
    ["expired", 410],
    ["capacity_exceeded", 413],
    ["intake_rejected", 422],
    ["unavailable", 503],
  ] as const) {
    assert.match(
      clientUploadServiceSource,
      new RegExp(`case "${code}":[\\s\\S]{0,80}return ${status};`, "u"),
    );
  }
  assert.match(
    clientUploadServiceSource,
    /case "stale_version":[\s\S]{0,120}case "conflict":[\s\S]{0,120}case "cleanup_unconfirmed":[\s\S]{0,80}return 409;/u,
  );
  assert.match(
    clientUploadSource,
    /CLIENT_UPLOAD_REQUEST_BODY_BYTES,[\s\S]*?"client-action"/u,
  );
  assert.match(
    clientUploadSource,
    /code: error\.code,[\s\S]*?\.\.\.\(error\.details \?\? \{\}\)/u,
  );
  const releasedRetentionOperations = [
    {
      suite: "operations",
      method: "post",
      expressPath: "/retention-requests/:id/complete",
      openApiPath: "/retention-requests/{id}/complete",
      operationId: "completeRetentionRequest",
      statuses: [202, 400, 401, 403, 404, 409, 412, 413, 428, 500, 503],
    },
    {
      suite: "operations",
      method: "post",
      expressPath: "/retention-actions/:id/reconcile",
      openApiPath: "/retention-actions/{id}/reconcile",
      operationId: "reconcileRetentionAction",
      statuses: [200, 400, 401, 403, 404, 409, 412, 413, 428, 500, 503],
    },
    {
      suite: "operations",
      method: "post",
      expressPath: "/retention-actions/:id/certify",
      openApiPath: "/retention-actions/{id}/certify",
      operationId: "certifyRetentionAction",
      statuses: [200, 400, 401, 403, 404, 409, 412, 413, 428, 500, 503],
    },
  ] as const satisfies readonly ContractEntry[];
  for (const entry of releasedRetentionOperations) {
    const operation = openApiOperation(entry);
    assert.match(
      operation,
      new RegExp(`operationId: ${entry.operationId}\\b`, "u"),
    );
    assert.deepEqual(
      [...operation.matchAll(/^        "(\d{3})":/gmu)]
        .map((match) => Number(match[1]))
        .sort((left, right) => left - right),
      [...entry.statuses].sort((left, right) => left - right),
      `${entry.operationId} released response contract drifted`,
    );
    assert.match(operation, /RetentionCompletionSnapshot/u);
    assert.match(operation, /RetentionCompletionConflict/u);
    assert.match(operation, /RetentionCompletionStaleVersion/u);
    assert.match(operation, /RetentionCompletionUnavailable/u);
    assert.match(operation, /components\/headers\/PrivateNoStore/u);
  }
  assert.ok(
    routeIndexSource.indexOf("router.use(attachTenantDatabase)") <
      routeIndexSource.indexOf("router.use(retentionCompletionRouter)"),
  );
  assert.match(
    retentionCompletionSource,
    /router\.post\(\s*"\/retention-requests\/:id\/complete",[\s\S]*?requirePermissionOrLegacy\("retention:manage"\),[\s\S]*?mutation\("detach"\)/u,
  );
  assert.match(
    retentionCompletionSource,
    /router\.post\(\s*"\/retention-actions\/:id\/reconcile",[\s\S]*?requirePermissionOrLegacy\("retention:manage"\),[\s\S]*?mutation\("reconcile"\)/u,
  );
  assert.match(
    retentionCompletionSource,
    /router\.post\(\s*"\/retention-actions\/:id\/certify",[\s\S]*?requirePermissionOrLegacy\("retention:manage"\),[\s\S]*?mutation\("certify"\)/u,
  );
  assert.match(
    openApiSchema("RetentionCompletionUnavailable"),
    /RetentionCompletionNotActivated[\s\S]*?RetentionCompletionControlPlaneUnavailable/u,
  );
  assert.match(
    openApiSchema("RetentionCompletionNotActivated"),
    /additionalProperties: false[\s\S]*?RETENTION_COMPLETION_NOT_ACTIVATED[\s\S]*?sideEffectsApplied: \{ type: boolean, const: false \}[\s\S]*?RetentionCompletionReadiness/u,
  );
  assert.match(
    openApiSchema("RetentionCompletionReadiness"),
    /durable_two_phase_detach_reconcile_certify[\s\S]*?activationBlockers[\s\S]*?evidenceBlockers/u,
  );
});

test("the generated React and Zod surfaces contain every suite operation", () => {
  assert.equal(manifest.length, 35);
  for (const { operationId } of manifest) {
    assert.match(
      reactClient,
      new RegExp(`export const ${operationId} =`, "u"),
      `missing React client ${operationId}`,
    );
    assert.match(
      zodClient,
      new RegExp(`export const ${pascal(operationId)}Response =`, "u"),
      `missing Zod response ${operationId}`,
    );
  }
});

test("generated mutation clients transmit every required concurrency header", () => {
  for (const [operationId, headerName, variable] of [
    [
      "promoteFieldDraftToOperationsWorkItem",
      "Idempotency-Key",
      "idempotencyKey",
    ],
    ["confirmOpportunityPursuitHandoff", "Idempotency-Key", "idempotencyKey"],
    ["issueClientActionUploadLease", "Idempotency-Key", "idempotencyKey"],
    ["finalizeClientActionUploadLease", "Idempotency-Key", "idempotencyKey"],
    ["stageEvidenceRenewalReplacement", "If-Match", "ifMatch"],
    ["reviewEvidenceRenewalReplacement", "If-Match", "ifMatch"],
  ] as const) {
    const start = reactClient.indexOf(`export const ${operationId} = async`);
    const hook = reactClient.indexOf(
      `export const use${pascal(operationId)} =`,
      start,
    );
    const end = reactClient.indexOf("\nexport const get", hook);
    assert.ok(
      start >= 0 && hook > start && end > hook,
      `${operationId} client block missing`,
    );
    const block = reactClient.slice(start, end);
    assert.match(
      block,
      new RegExp(`${variable}: string`, "u"),
      `${operationId} omits the required header argument`,
    );
    assert.match(
      block,
      new RegExp(`'${headerName}': ${variable}`, "u"),
      `${operationId} does not transmit ${headerName}`,
    );
    assert.ok(
      block.includes(`;${variable}: string}`),
      `${operationId} mutation variables omit ${variable}`,
    );
  }
});

test("frozen suite payloads retain their route-level concurrency, visibility and canonical-manifest contracts", () => {
  assert.match(openApi, /const: "2026-08-11\.2"/u);
  assert.match(
    openApi,
    /GrowthOnboardingResponse:[\s\S]*?required: \[journey, progress, authorityNote\]/u,
  );
  assert.match(
    openApi,
    /GrowthOnboardingProgressMutation:[\s\S]*?required: \[journeyVersion, itemId, expectedVersion, completed\][\s\S]*?minimum: 0/u,
  );
  assert.match(
    openApi,
    /OperationsSuiteSnapshotResponse:[\s\S]*?required:[\s\S]*?organisationId,[\s\S]*?projectId,[\s\S]*?records,[\s\S]*?counts,[\s\S]*?visibility,[\s\S]*?authority/u,
  );
  assert.match(
    openApi,
    /OperationsMobileQueue:[\s\S]*?required: \[restrictedContent, maxItems, items\][\s\S]*?const: 250/u,
  );
  const credentialVerification = openApiSchema(
    "OperationsCreateCredentialVerification",
  );
  assert.match(
    credentialVerification,
    /vaultItemVersion[\s\S]*?minimum: 1[\s\S]*?documentSha256/u,
  );
  assert.match(
    openApi,
    /VaultItem:[\s\S]*?required:[\s\S]*?version[\s\S]*?version: \{ type: integer, minimum: 1 \}/u,
  );
  assert.doesNotMatch(credentialVerification, /vaultItemVersionId/u);
  assert.match(operationsSource, /vaultItemVersion/u);
  assert.doesNotMatch(operationsSource, /vaultItemVersionId/u);
  assert.match(
    openApi,
    /OperationsCreateVisualQaReport:[\s\S]*?required:[\s\S]*?manifestSha256[\s\S]*?expectedManifestSha256/u,
  );
  assert.match(
    openApi,
    /OperationsCreateSubmissionWarRoom:[\s\S]*?required: \[packageId, packageVersionId, manifestSha256\]/u,
  );
  const promotionEntry = manifest.find(
    ({ operationId }) =>
      operationId === "promoteFieldDraftToOperationsWorkItem",
  )!;
  const promotionOperation = openApiOperation(promotionEntry);
  assert.match(
    promotionOperation,
    /FieldDraftPromotionIdempotencyKey[\s\S]*?x-bidbox-request-body-max-bytes: 1048576/u,
  );
  assert.match(
    promotionOperation,
    /tenant, project, draft ID and draft-version tuple may be promoted to the[\s\S]*?target only once/u,
  );
  const promotionRequest = openApiSchema(
    "OperationsFieldDraftPromotionRequest",
  );
  for (const field of [
    "schema",
    "draft",
    "expectedTargetVersion",
    "selectedFields",
    "values",
  ]) {
    assert.match(promotionRequest, new RegExp(`${field}:`, "u"));
  }
  assert.match(
    openApiSchema("OperationsFieldDraftPromotionSelectedFields"),
    /canonical title, note, checklist order[\s\S]*?prefixItems:/u,
  );
  const promotionReceipt = openApiSchema(
    "OperationsFieldDraftPromotionReceipt",
  );
  for (const literal of [
    "valo.field-draft-promotion-receipt/v1",
    "authoritativeEvidenceCreated: { type: boolean, const: false }",
    "localDraftDeleted: { type: boolean, const: false }",
    "replayed: { type: boolean }",
  ]) {
    assert.match(
      promotionReceipt,
      new RegExp(literal.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"),
    );
  }
  for (const schema of [
    "OperationsWorkItemRecord",
    "OperationsSubmissionWarRoomRecord",
    "OperationsMissionRecord",
    "OperationsPostAwardItemRecord",
  ]) {
    assert.match(
      openApi,
      new RegExp(`${schema}:[\\s\\S]*?statusReasonHistory`, "u"),
    );
  }
  for (const schema of [
    "OperationsUpdateWorkItem",
    "OperationsAdvanceSubmissionWarRoom",
    "OperationsUpdateMission",
    "OperationsUpdatePostAwardItem",
  ]) {
    assert.match(
      openApi,
      new RegExp(
        `${schema}:[\\s\\S]*?const: cancelled[\\s\\S]*?required: \\[reason\\]`,
        "u",
      ),
    );
  }
  assert.match(
    zodClient,
    /GetOperationsMobileQueueResponse = zod\.object\(\{[\s\S]*?"restrictedContent": zod\.literal\(true\),[\s\S]*?"maxItems": zod\.literal\(250\)/u,
  );
  for (const schema of [
    "UpdateOperationsWorkItemBody",
    "AdvanceOperationsSubmissionWarRoomBody",
    "UpdateOperationsMissionBody",
    "UpdateOperationsPostAwardItemBody",
  ]) {
    assert.match(
      zodClient,
      new RegExp(
        `${schema} = [\\s\\S]*?superRefine\\(\\(value, context\\) => \\{[\\s\\S]*?reason is required when status is cancelled`,
        "u",
      ),
    );
  }
});

test("governed client upload preserves its closed lease, receipt and error contracts", () => {
  const issueEntry = manifest.find(
    ({ operationId }) => operationId === "issueClientActionUploadLease",
  )!;
  const finalizeEntry = manifest.find(
    ({ operationId }) => operationId === "finalizeClientActionUploadLease",
  )!;
  const issue = openApiOperation(issueEntry);
  const finalize = openApiOperation(finalizeEntry);
  for (const operation of [issue, finalize]) {
    assert.match(operation, /ClientActionUploadIdempotencyKey/u);
    assert.match(operation, /ClientActionUploadLeaseRequest/u);
    assert.match(operation, /x-bidbox-request-body-max-bytes: 4096/u);
    assert.match(operation, /ClientActionUploadExpired/u);
    assert.match(operation, /ClientActionUploadUnavailable/u);
  }
  assert.doesNotMatch(
    issue,
    /(?:rawFile|multipart\/form-data|application\/octet-stream)/u,
  );
  assert.match(issue, /server-disabled by default/u);
  assert.match(issue, /does not activate production use/u);
  assert.doesNotMatch(
    finalize,
    /(?:rawFile|multipart\/form-data|application\/octet-stream)/u,
  );
  assert.match(finalize, /ClientActionUploadIntakeRejected/u);

  const request = openApiSchema("ClientActionUploadLeaseRequest");
  assert.match(request, /additionalProperties: false/u);
  assert.match(request, /required: \[expectedVersion, intentId\]/u);
  assert.doesNotMatch(
    request,
    /(?:rawFile|bytes|filename|contentType|sha256):/u,
  );
  const lease = openApiSchema("ClientActionUploadLeaseGrant");
  for (const contract of [
    "lateRewriteClosure",
    "bounded-cushion-and-post-expiry-reconcile",
    "rawFileAcceptedByApi: { type: boolean, const: false }",
    "externalMessageSentByValo: { type: boolean, const: false }",
    "maximum: 52428800",
  ]) {
    assert.match(
      lease,
      new RegExp(contract.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"),
    );
  }
  const receipt = openApiSchema("ClientActionUploadFinalizationReceipt");
  for (const contract of [
    "receiptSha256",
    "extractionStarted: { type: boolean, const: false }",
    "rawFileAcceptedByApi: { type: boolean, const: false }",
    "externalMessageSentByValo: { type: boolean, const: false }",
  ]) {
    assert.match(
      receipt,
      new RegExp(contract.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"),
    );
  }
  const governedError = openApiSchema("ClientActionUploadGovernedError");
  assert.match(governedError, /additionalProperties: false/u);
  for (const detail of [
    "leaseStatus",
    "references",
    "findings",
    "cleanupConfirmed",
    "quarantinedPath",
    "possibleQuarantinedPath",
    "quarantineCopyConfirmed",
    "activation",
    "sideEffectsApplied",
  ]) {
    assert.match(governedError, new RegExp(`${detail}:`, "u"));
  }

  for (const operationId of [
    "issueClientActionUploadLease",
    "finalizeClientActionUploadLease",
  ]) {
    const marker = pascal(operationId);
    assert.match(
      zodClient,
      new RegExp(`export const ${marker}Body = [\\s\\S]*?\\.strict\\(\\)`, "u"),
    );
    assert.match(
      zodClient,
      new RegExp(
        `export const ${marker}Response = [\\s\\S]*?\\.strict\\(\\)`,
        "u",
      ),
    );
  }
  assert.match(
    zodClient,
    /IssueClientActionUploadLeaseResponse = [\s\S]*?"lateRewriteClosure": zod\.literal\("bounded-cushion-and-post-expiry-reconcile"\)[\s\S]*?"rawFileAcceptedByApi": zod\.literal\(false\)/u,
  );
  assert.match(
    zodClient,
    /FinalizeClientActionUploadLeaseResponse = [\s\S]*?"extractionStarted": zod\.literal\(false\)[\s\S]*?"externalMessageSentByValo": zod\.literal\(false\)/u,
  );
});

test("lead decisions and the transient contact handoff preserve their closed PII boundary", () => {
  const qualification = openApiSchema("GrowthLeadQualificationStatusMutation");
  assert.match(
    qualification,
    /required: \[action, expectedVersion, status, reason\]/u,
  );
  assert.match(qualification, /enum: \[qualified, not_a_fit\]/u);
  assert.match(
    qualification,
    /reason: \{ type: string, minLength: 1, maxLength: 1000 \}/u,
  );

  const converted = openApiSchema("GrowthLeadConvertedStatusMutation");
  assert.match(converted, /status: \{ type: string, const: converted \}/u);
  assert.match(converted, /externalTargetReference:/u);
  assert.match(converted, /receiptSha256:/u);
  assert.match(converted, /pattern: "\^\[a-f0-9\]\{64\}\$"/u);

  const inbox = openApiSchema("GrowthLeadInboxItem");
  assert.match(inbox, /- latestStatusDecision/u);
  assert.match(
    inbox,
    /enum: \[new, qualified, not_a_fit, converted, conversion_proposed\]/u,
  );
  assert.doesNotMatch(
    inbox,
    /(?:^|\n)        (?:contactName|contactValue|email|telephone):/u,
  );

  const contactEntry = manifest.find(
    ({ operationId }) => operationId === "openGrowthLeadContactHandoff",
  )!;
  const contactOperation = openApiOperation(contactEntry);
  assert.match(contactOperation, /Cache-Control: private, no-store/u);
  assert.match(
    contactOperation,
    /\$ref: "#\/components\/headers\/PrivateNoStore"/u,
  );
  assert.match(
    contactOperation,
    /\$ref: "#\/components\/headers\/VaryOrganisationContext"/u,
  );

  const request = openApiSchema("GrowthLeadContactHandoffRequest");
  assert.match(request, /additionalProperties: false/u);
  assert.match(request, /required: \[expectedVersion, purpose\]/u);
  assert.match(
    request,
    /enum: \[initial_follow_up, qualification_call, conversion_handoff\]/u,
  );
  const contactResponse = openApiSchema("GrowthLeadContactHandoffResponse");
  assert.match(
    contactResponse,
    /required: \[handoff, contactDataIncluded, authorityNote\]/u,
  );
  assert.match(contactResponse, /contactDataIncluded:[\s\S]*?const: true/u);
  for (const schemaName of [
    "GrowthLeadEmailContactHandoff",
    "GrowthLeadTelephoneContactHandoff",
  ]) {
    const handoff = openApiSchema(schemaName);
    for (const property of [
      "contactName",
      "preferredContactMethod",
      "contactValue",
      "purpose",
      "accessedAt",
      "version",
    ]) {
      assert.match(handoff, new RegExp(`${property}:`, "u"));
    }
  }
  assert.match(
    growthSource,
    /setHeader\("Cache-Control", "private, no-store"\)[\s\S]*?res\.vary\("X-BidBox-Organisation-Id"\)/u,
  );
  assert.match(
    zodClient,
    /OpenGrowthLeadContactHandoffBody = zod\.object\([\s\S]*?\)\.strict\(\)/u,
  );
  assert.match(
    zodClient,
    /OpenGrowthLeadContactHandoffResponse = zod\.object\([\s\S]*?"contactDataIncluded": zod\.literal\(true\)[\s\S]*?\)\.strict\(\)/u,
  );
  assert.match(
    zodClient,
    /ListGrowthLeadsResponse = zod\.object\([\s\S]*?"contactDataIncluded": zod\.literal\(false\)/u,
  );
  assert.match(
    zodClient,
    /MutateGrowthLeadBody = zod\.union\([\s\S]*?"status": zod\.literal\("converted"\)[\s\S]*?"receiptSha256":[\s\S]*?\.strict\(\)/u,
  );
});

test("package discovery is metadata-only and evidence response history stays paired and bounded", () => {
  const packageEntry = manifest.find(
    ({ operationId }) => operationId === "listProjectPackageVersions",
  )!;
  const packageOperation = openApiOperation(packageEntry);
  assert.match(packageOperation, /response is metadata-only/u);
  assert.match(packageOperation, /Cache-Control: private, no-store/u);
  assert.match(
    packageOperation,
    /\$ref: "#\/components\/headers\/PrivateNoStore"/u,
  );

  const packageResponse = openApiSchema(
    "ProjectExportPackageVersionListResponse",
  );
  assert.match(packageResponse, /required: \[items, limit, truncated\]/u);
  assert.match(packageResponse, /maxItems: 100/u);
  assert.match(packageResponse, /const: 100/u);
  const packageItem = openApiSchema("ProjectExportPackageVersionSummary");
  for (const property of [
    "packageId",
    "packageVersionId",
    "packageType",
    "versionNumber",
    "manifestSha256",
    "renderQaStatus",
    "createdAt",
  ]) {
    assert.match(packageItem, new RegExp(`${property}:`, "u"));
  }
  assert.doesNotMatch(
    packageItem,
    /(?:readinessSnapshot|sourceSnapshotHash|docxObjectPath|pdfObjectPath|zipObjectPath|bytes|contentText):/u,
  );
  const packageRouteStart = reportsSource.indexOf(
    '"/projects/:id/package-versions"',
  );
  const packageRouteEnd = reportsSource.indexOf(
    '"/projects/:id/export"',
    packageRouteStart,
  );
  assert.ok(packageRouteStart >= 0 && packageRouteEnd > packageRouteStart);
  const packageRoute = reportsSource.slice(packageRouteStart, packageRouteEnd);
  assert.match(packageRoute, /Cache-Control", "private, no-store/u);
  assert.doesNotMatch(
    packageRoute,
    /readinessSnapshot|sourceSnapshotHash|docxObjectPath|pdfObjectPath|zipObjectPath|contentText/u,
  );
  assert.match(
    zodClient,
    /ListProjectPackageVersionsResponse = zod\.object\([\s\S]*?"packageType": zod\.literal\("project_export"\)[\s\S]*?"limit": zod\.literal\(100\)[\s\S]*?\)\.strict\(\)/u,
  );

  const historyItem = openApiSchema(
    "OperationsEvidenceSlotResponseHistoryItem",
  );
  assert.match(historyItem, /required: \[response, acceptance\]/u);
  const evidenceSlot = openApiSchema("OperationsEvidenceRequestSlot");
  assert.match(evidenceSlot, /responseHistory,/u);
  assert.match(
    evidenceSlot,
    /responseHistory:[\s\S]*?maxItems: 20[\s\S]*?OperationsEvidenceSlotResponseHistoryItem/u,
  );
  assert.match(
    zodClient,
    /"responseHistory": zod\.array\(zod\.object\(\{[\s\S]{0,1800}?"response": zod\.object\([\s\S]{0,1800}?"acceptance": zod\.object\([\s\S]{0,1800}?\}\)\)\.max\(/u,
  );
});

test("contracts preserve the human-only and record-only authority boundaries", () => {
  const controlNote =
    "Every assignment, qualification, conversion proposal, quote term and quote approval is a named human action. This surface sends no email, creates no CRM record, converts no pursuit, submits no bid, calculates no price and collects no payment.";
  assert.match(
    growthSource,
    new RegExp(controlNote.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"),
  );
  assert.match(
    openApi,
    new RegExp(controlNote.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"),
  );
  assert.match(openApi, /const: synthetic_non_customer/u);
  assert.match(openApi, /const: human_quote_required/u);
  assert.match(openApi, /const: external_manual_only/u);
  assert.match(openApi, /contactDataIncluded:[\s\S]*?const: false/u);
  assert.match(openApi, /externalActionPolicy:[\s\S]*?const: record_only/u);
  assert.match(openApi, /deliveryMode:[\s\S]*?const: manual_out_of_band/u);
  assert.match(openApi, /verificationMode:[\s\S]*?const: human_recorded/u);
  assert.match(
    openApi,
    /OperationsAuthorityBoundary:[\s\S]*?submission: \{ type: string, const: record_only \}/u,
  );
  assert.doesNotMatch(
    openApiOperation(
      manifest.find(({ operationId }) => operationId === "mutateGrowthLead")!,
    ),
    /send_email|convert_pursuit|contact_lead/u,
  );
  assert.doesNotMatch(
    openApiOperation(
      manifest.find(
        ({ operationId }) =>
          operationId === "advanceOperationsSubmissionWarRoom",
      )!,
    ),
    /automated_submission|submit_now|provider_request/u,
  );
});
