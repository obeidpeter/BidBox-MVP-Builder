import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  EXCLUDED_CONTROL_PLANE_PATHS,
  PRESERVED_OPERATIONS_GROWTH_OPERATION_IDS,
  ROADMAP_API_OPERATIONS,
} from "./roadmap-api-parity.manifest.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const specPath = resolve(here, "openapi.yaml");
const routesRoot = resolve(root, "artifacts", "api-server", "src", "routes");
const generatedClientPath = resolve(
  root,
  "lib",
  "api-client-react",
  "src",
  "generated",
  "api.ts",
);
const generatedZodPath = resolve(
  root,
  "lib",
  "api-zod",
  "src",
  "generated",
  "api.ts",
);
const generatedZodTypesIndexPath = resolve(
  root,
  "lib",
  "api-zod",
  "src",
  "generated",
  "types",
  "index.ts",
);
const generatedTenderContextCompanyEvidenceOptionPath = resolve(
  root,
  "lib",
  "api-zod",
  "src",
  "generated",
  "types",
  "tenderContextCompanyEvidenceOption.ts",
);

function parseOperations(source) {
  const operations = new Map();
  let inPaths = false;
  let currentPath = null;
  let current = null;

  for (const line of source.split(/\r?\n/u)) {
    if (line === "paths:") {
      inPaths = true;
      continue;
    }
    if (inPaths && line === "components:") break;
    if (!inPaths) continue;

    const pathMatch = /^  (\/[^:]+):$/u.exec(line);
    if (pathMatch) {
      currentPath = pathMatch[1];
      current = null;
      continue;
    }
    const methodMatch = /^    (get|post|put|patch|delete|head):$/u.exec(line);
    if (methodMatch && currentPath) {
      current = {
        path: currentPath,
        method: methodMatch[1],
        operationId: null,
        description: null,
        statuses: [],
        privateNoStore: false,
        varyOrganisation: false,
        etag: false,
        public: false,
      };
      operations.set(`${current.method} ${current.path}`, current);
      continue;
    }
    if (!current) continue;

    const operationIdMatch = /^      operationId: (\S+)$/u.exec(line);
    if (operationIdMatch) current.operationId = operationIdMatch[1];
    const descriptionMatch = /^      description: (.+)$/u.exec(line);
    if (descriptionMatch) current.description = descriptionMatch[1];
    const statusMatch = /^        "(\d{3})":/u.exec(line);
    if (statusMatch) current.statuses.push(statusMatch[1]);
    if (line.includes("#/components/headers/PrivateNoStore")) {
      current.privateNoStore = true;
    }
    if (line.includes("#/components/headers/CommercialPrivateNoStore")) {
      current.privateNoStore = true;
    }
    if (line.includes("#/components/headers/VaryOrganisationContext")) {
      current.varyOrganisation = true;
    }
    if (line.includes("#/components/headers/VersionETag")) {
      current.etag = true;
    }
    if (line === "      security: []") current.public = true;
  }
  return operations;
}

function pascalOperationId(operationId) {
  return `${operationId[0].toUpperCase()}${operationId.slice(1)}`;
}

function generatedBlock(source, marker) {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing generated marker ${marker}`);
  const next = source.indexOf("\nexport const ", start + marker.length);
  return source.slice(start, next === -1 ? source.length : next);
}

function schemaBlock(source, name) {
  const marker = `\n    ${name}:\n`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing schema ${name}`);
  const remaining = source.slice(start + marker.length);
  const next = remaining.search(/\n    [A-Za-z][A-Za-z0-9]+:\n/u);
  return remaining.slice(0, next === -1 ? undefined : next);
}

function parameterBlock(source, name) {
  const marker = `\n    ${name}:\n`;
  const start = source.indexOf(marker, source.indexOf("\n  parameters:\n"));
  assert.notEqual(start, -1, `missing parameter ${name}`);
  const remaining = source.slice(start + marker.length);
  const next = remaining.search(/\n    [A-Za-z][A-Za-z0-9]+:\n/u);
  return remaining.slice(0, next === -1 ? undefined : next);
}

function sourceRouteInventory(source) {
  return [...source.matchAll(/router\.(get|post|patch)\(\s*"([^"]+)"/gu)]
    .map((match) => `${match[1]} ${match[2]}`)
    .sort();
}

test("every published OpenAPI operationId is globally unique", () => {
  const spec = readFileSync(specPath, "utf8");
  const operationIds = [...spec.matchAll(/^      operationId: (\S+)$/gmu)].map(
    (match) => match[1],
  );
  assert.ok(operationIds.length > 0);
  assert.equal(new Set(operationIds).size, operationIds.length);
});

test("roadmap manifest is unique and publishes exactly the frozen public operations", () => {
  assert.equal(ROADMAP_API_OPERATIONS.length, 76);
  assert.equal(PRESERVED_OPERATIONS_GROWTH_OPERATION_IDS.length, 33);
  const routeKeys = ROADMAP_API_OPERATIONS.map(
    ({ method, path }) => `${method} ${path}`,
  );
  const operationIds = ROADMAP_API_OPERATIONS.map(
    ({ operationId }) => operationId,
  );
  assert.equal(new Set(routeKeys).size, routeKeys.length);
  assert.equal(new Set(operationIds).size, operationIds.length);
});

test("OpenAPI route, method, status and privacy contracts match the frozen manifest", () => {
  const spec = readFileSync(specPath, "utf8");
  const parsed = parseOperations(spec);

  for (const expected of ROADMAP_API_OPERATIONS) {
    const key = `${expected.method} ${expected.path}`;
    const actual = parsed.get(key);
    assert.ok(actual, `missing OpenAPI operation ${key}`);
    assert.equal(
      actual.operationId,
      expected.operationId,
      `${key} operationId`,
    );
    assert.deepEqual(
      [...actual.statuses].sort(),
      [...expected.statuses].sort(),
      `${key} statuses`,
    );
    assert.equal(
      actual.privateNoStore,
      expected.privateNoStore,
      `${key} Cache-Control privacy`,
    );
    assert.equal(
      actual.varyOrganisation,
      expected.varyOrganisation,
      `${key} tenant Vary privacy`,
    );
    assert.equal(actual.etag, Boolean(expected.etag), `${key} ETag parity`);
  }
});

test("public readiness publishes exact status, cache and authentication boundaries", () => {
  const parsed = parseOperations(readFileSync(specPath, "utf8"));
  const readiness = parsed.get("get /readyz");
  assert.ok(readiness, "missing OpenAPI operation get /readyz");
  assert.equal(readiness.operationId, "readinessCheck");
  assert.deepEqual(readiness.statuses, ["200", "503"]);
  assert.equal(readiness.privateNoStore, true);
  assert.equal(readiness.varyOrganisation, false);
  assert.equal(readiness.public, true);
});

test("every published operation exists in its mounted route source", () => {
  const sources = new Map();
  for (const operation of ROADMAP_API_OPERATIONS) {
    const source =
      sources.get(operation.source) ??
      readFileSync(resolve(routesRoot, operation.source), "utf8");
    sources.set(operation.source, source);
    assert.ok(
      source.includes(operation.sourcePattern),
      `${operation.operationId} is not present in ${operation.source}`,
    );
  }

  const index = readFileSync(resolve(routesRoot, "index.ts"), "utf8").replace(
    /\s+/gu,
    "",
  );
  for (const mount of [
    "router.use(workInboxRouter)",
    "router.use(canonicalEvidenceOptionsRouter)",
    'router.use("/commercial-retainer",commercialRetainerRouter)',
    "router.use(clientActionPortalRouter)",
    "router.use(clientActionUploadRouter)",
    "router.use(partnerConsortiumRoomRouter)",
    "router.use(reconciledCommunicationsRouter)",
    "router.use(opportunitySourceNetworkRouter)",
    "router.use(opportunityPursuitHandoffRouter)",
    "router.use(evidenceRenewalRouter)",
    "router.use(productionAcceptanceRouter)",
    "router.use(privacyOperationsRouter)",
    "router.use(claimsDeskRouter)",
    "router.use(deliveryStudioRouter)",
    "router.use(aiShadowProgrammeRouter)",
    "router.use(addendumImpactRouter)",
  ]) {
    assert.ok(index.includes(mount), `missing guarded route mount ${mount}`);
  }
});

test("Wave 2 route sources expose exactly the frozen public descriptors", () => {
  const opportunity = readFileSync(
    resolve(routesRoot, "opportunityPursuitHandoff.ts"),
    "utf8",
  );
  assert.deepEqual(sourceRouteInventory(opportunity), [
    "get /opportunity-sources/:candidateId/pursuit-handoff",
    "post /opportunity-sources/:candidateId/pursuit-handoff/confirm",
  ]);
  const renewal = readFileSync(
    resolve(routesRoot, "evidenceRenewal.ts"),
    "utf8",
  );
  assert.deepEqual(sourceRouteInventory(renewal), [
    "get /projects/:projectId/evidence-renewals",
    "get /projects/:projectId/evidence-renewals/authorities",
    "post /projects/:projectId/evidence-renewals",
    "post /projects/:projectId/evidence-renewals/:planId/review",
    "post /projects/:projectId/evidence-renewals/:planId/staged-replacement",
  ]);
});

test("Delivery Studio publishes the exact runtime action bounds and transport preconditions", () => {
  const spec = readFileSync(specPath, "utf8");
  const route = readFileSync(resolve(routesRoot, "deliveryStudio.ts"), "utf8");
  const compactRoute = route.replace(/\s+/gu, " ");
  const compactSchema = (name) => schemaBlock(spec, name).replace(/\s+/gu, " ");
  const includesAll = (name, needles) => {
    const schema = compactSchema(name);
    for (const needle of needles) {
      assert.ok(schema.includes(needle), `${name} drifted from ${needle}`);
    }
  };

  for (const parserBound of [
    "textBetween(value.title, 1, 300)",
    "textBetween(value.content, 1, 60_000)",
    "textBetween(value.changeSummary, 1, 2_000)",
    "value.claims.length < 1",
    "value.claims.length > 500",
    "textBetween(candidate.text, 1, 5_000)",
    "candidate.citations.length > 500",
    "textBetween(citation.quote, 1, 20_000)",
    "textBetween(value.note, 2, 5_000)",
    "textBetween(value.policyVersion, 1, 128)",
    "value.findings.length > 500",
    "textBetween(finding.category, 1, 120)",
    "textBetween(finding.finding, 1, 10_000)",
    "textBetween(finding.objectType, 1, 120)",
    "textBetween(value.resolution, 2, 5_000)",
    "textBetween(value.attestation, 10, 2_000)",
    "textBetween(value.title, 1, 2_000)",
    "textBetween(value.content, 1, 2_000_000)",
    "textBetween(value.capturedAt, 1, 40)",
    "textBetween(value.origin, 1, 2_000)",
    "textBetween(value.reviewerId, 1, 128)",
    "textBetween(value.reviewedAt, 1, 40)",
    "textBetween(value.label, 1, 2_000)",
    "(value.uploadOrder as number) < 1",
    "textBetween(value.maxFileBytesText, 1, 2_000)",
    "textBetween(value.requiredFilenamePrefix, 1, 2_000)",
    "textBetween(value.filename, 1, 500)",
    "(value.sizeBytes as number) < 1",
    "textBetween(value.sizeText, 1, 2_000)",
    "textBetween(value.rationale, 1, 20_000)",
    "value.sources.length > 500",
    "value.fields.length > 500",
    "value.files.length > 500",
    "value.mappings.length > 500",
  ]) {
    assert.ok(
      compactRoute.includes(parserBound),
      `runtime parser lost bound ${parserBound}`,
    );
  }

  includesAll("DeliveryStudioResponseCitationInput", [
    "quote: { type: string, minLength: 1, maxLength: 20000 }",
    "dependentRequired: startOffset: [endOffset] endOffset: [startOffset]",
  ]);
  includesAll("DeliveryStudioResponseClaimInput", [
    "text: { type: string, minLength: 1, maxLength: 5000 }",
    "not: description: Factual and instructional claims cannot have an empty citation list. required: [kind, citations] properties: kind: enum: [factual, instructional] citations: maxItems: 0",
    "citations: type: array maxItems: 500",
    "description: Required and non-empty when kind is factual or instructional.",
  ]);
  assert.ok(
    compactRoute.includes(
      '(candidate.kind !== "opinion" && citations.length === 0)',
    ),
    "runtime parser must reject uncited factual and instructional claims",
  );
  const generatedZod = readFileSync(generatedZodPath, "utf8");
  assert.ok(
    generatedZod.includes(
      'value.kind !== "opinion" && value.citations.length === 0',
    ),
    "generated Zod must reject uncited factual and instructional claims",
  );
  includesAll("DeliveryStudioSaveResponseAction", [
    "title: { type: string, minLength: 1, maxLength: 300 }",
    "content: { type: string, minLength: 1, maxLength: 60000 }",
    "changeSummary: { type: string, minLength: 1, maxLength: 2000 }",
    "claims: type: array minItems: 1 maxItems: 500",
  ]);
  includesAll("DeliveryStudioReviewResponseClaimAction", [
    "note: { type: string, minLength: 2, maxLength: 5000 }",
  ]);
  includesAll("DeliveryStudioRedTeamFindingInput", [
    "category: { type: string, minLength: 1, maxLength: 120 }",
    "finding: { type: string, minLength: 1, maxLength: 10000 }",
    "objectType: { type: string, minLength: 1, maxLength: 120 }",
  ]);
  includesAll("DeliveryStudioStartRedTeamAction", [
    "policyVersion: { type: string, minLength: 1, maxLength: 128 }",
    "findings: type: array maxItems: 500",
  ]);
  includesAll("DeliveryStudioRedTeamRun", [
    "approvedAt, approvalAttestation, createdAt",
    'approvalAttestation: oneOf: - { type: string, minLength: 10, maxLength: 2000 } - { type: "null" }',
  ]);
  includesAll("DeliveryStudioResolveRedTeamFindingAction", [
    "resolution: { type: string, minLength: 2, maxLength: 5000 }",
  ]);
  includesAll("DeliveryStudioApproveRedTeamAction", [
    "attestation: { type: string, minLength: 10, maxLength: 2000 }",
  ]);
  includesAll("DeliveryStudioSourceDocumentInput", [
    "title: { type: string, minLength: 1, maxLength: 2000 }",
    "content: { type: string, minLength: 1, maxLength: 2000000 }",
    "capturedAt: { type: string, minLength: 1, maxLength: 40 }",
    "origin: { type: string, minLength: 1, maxLength: 2000 }",
  ]);
  includesAll("DeliveryStudioHumanReviewInput", [
    '$ref: "#/components/schemas/DeliveryStudioTextIdentifier"',
    "reviewedAt: { type: string, minLength: 1, maxLength: 40 }",
    "note: { type: string, minLength: 1, maxLength: 5000 }",
  ]);
  includesAll("DeliveryStudioPortalFieldRequirementInput", [
    "label: { type: string, minLength: 1, maxLength: 2000 }",
    "uploadOrder: type: integer minimum: 1 maximum: 9007199254740991",
    "maxFileBytesText: { type: string, minLength: 1, maxLength: 2000 }",
    "allowedExtensions: type: array maxItems: 50 items: type: string minLength: 1 maxLength: 2000",
    "requiredFilenamePrefix: { type: string, minLength: 1, maxLength: 2000 }",
  ]);
  assert.ok(
    !compactSchema("DeliveryStudioPortalFieldRequirementInput").includes(
      "uniqueItems",
    ),
    "runtime accepts duplicate allowed extensions",
  );
  includesAll("DeliveryStudioPortalPackageFileInput", [
    "filename: { type: string, minLength: 1, maxLength: 500 }",
    "sizeBytes: type: integer minimum: 1 maximum: 9007199254740991",
    "sizeText: { type: string, minLength: 1, maxLength: 2000 }",
  ]);
  includesAll("DeliveryStudioPortalFileMappingInput", [
    "rationale: { type: string, minLength: 1, maxLength: 20000 }",
  ]);
  includesAll("DeliveryStudioPortalSubmissionRehearsalInput", [
    "sources: type: array maxItems: 500",
    "fields: type: array maxItems: 500",
    "files: type: array maxItems: 500",
    "mappings: type: array maxItems: 500",
  ]);
  const portfolioTotals = compactSchema("PortfolioIntelligenceTotals");
  assert.ok(
    !portfolioTotals.includes("lessonProposalCount"),
    "portfolio contract must not publish an unimplemented lesson total",
  );

  const actionStart = spec.indexOf(
    "  /projects/{projectId}/delivery-studio/actions:",
  );
  const actionEnd = spec.indexOf("\n  /portfolio-intelligence:", actionStart);
  const operation = spec.slice(actionStart, actionEnd);
  for (const contract of [
    '$ref: "#/components/parameters/IfMatchVersion"',
    '$ref: "#/components/parameters/DeliveryStudioIdempotencyKey"',
    "x-bidbox-request-body-max-bytes: 4000000",
    '"401": { $ref: "#/components/responses/Unauthorized" }',
    '"412": { $ref: "#/components/responses/PreconditionFailed" }',
    '"413": { $ref: "#/components/responses/DeliveryStudioPayloadTooLarge" }',
    '"428": { $ref: "#/components/responses/PreconditionRequired" }',
  ]) {
    assert.ok(operation.includes(contract), `action contract lost ${contract}`);
  }
  for (const [operationId, endMarker] of [
    ["getDeliveryStudio", "  /projects/{projectId}/delivery-studio/actions:"],
    ["getPortfolioIntelligence", "  /storage/uploads/request-url:"],
  ]) {
    const operationStart = spec.indexOf(`      operationId: ${operationId}`);
    const operationEnd = spec.indexOf(endMarker, operationStart);
    const getOperation = spec.slice(operationStart, operationEnd);
    const conflictStart = getOperation.indexOf('        "409":');
    const conflictEnd = getOperation.indexOf('        "500":', conflictStart);
    assert.ok(conflictStart >= 0, `${operationId} lost its bounded conflict`);
    const conflict = getOperation.slice(conflictStart, conflictEnd);
    for (const privateHeader of [
      "#/components/headers/PrivateNoStore",
      "#/components/headers/VaryOrganisationContext",
    ]) {
      assert.ok(
        conflict.includes(privateHeader),
        `${operationId} 409 lost ${privateHeader}`,
      );
    }
  }
  const boqStart = spec.indexOf("  /projects/{projectId}/boq-verification:");
  const boqEnd = spec.indexOf(
    "\n  /projects/{projectId}/boq-verification/runs:",
    boqStart,
  );
  assert.ok(
    spec
      .slice(boqStart, boqEnd)
      .includes(
        '"500": { $ref: "#/components/responses/InternalServerError" }',
      ),
    "existing BOQ verification 500 response regressed",
  );
});

test("governed Client Action upload publishes the exact closed metadata and status boundary", () => {
  const spec = readFileSync(specPath, "utf8");
  const parsed = parseOperations(spec);
  const expected = [
    [
      "post /projects/{id}/client-actions/evidence-requests/{recordId}/slots/{slotId}/upload-leases",
      "issueClientActionUploadLease",
      [
        "200",
        "201",
        "400",
        "401",
        "403",
        "404",
        "409",
        "410",
        "413",
        "500",
        "503",
      ],
    ],
    [
      "post /projects/{id}/client-actions/evidence-requests/{recordId}/slots/{slotId}/upload-leases/{leaseId}/finalize",
      "finalizeClientActionUploadLease",
      [
        "200",
        "201",
        "400",
        "401",
        "403",
        "404",
        "409",
        "410",
        "413",
        "422",
        "500",
        "503",
      ],
    ],
  ];
  for (const [key, operationId, statuses] of expected) {
    const operation = parsed.get(key);
    assert.ok(operation, `missing ${key}`);
    assert.equal(operation.operationId, operationId);
    assert.deepEqual(operation.statuses, statuses);
    assert.equal(operation.privateNoStore, true);
    const start = spec.indexOf(`      operationId: ${operationId}`);
    assert.ok(start >= 0);
    const block = spec.slice(start, spec.indexOf("\n  /", start));
    for (const contract of [
      "ClientActionUploadIdempotencyKey",
      "ClientActionUploadLeaseRequest",
      "x-bidbox-request-body-max-bytes: 4096",
    ]) {
      assert.ok(block.includes(contract), `${operationId} omits ${contract}`);
    }
    if (operationId === "issueClientActionUploadLease") {
      for (const statement of [
        "server-disabled by default",
        "returns 503",
        "does not activate production use",
      ]) {
        assert.ok(
          block.includes(statement),
          `${operationId} omits ${statement}`,
        );
      }
    }
  }

  const request = schemaBlock(spec, "ClientActionUploadLeaseRequest");
  assert.match(request, /additionalProperties: false/u);
  assert.match(request, /required: \[expectedVersion, intentId\]/u);
  assert.match(request, /maximum: 9007199254740991/u);
  assert.doesNotMatch(request, /(?:rawFile|bytes|content|filename|sha256):/u);

  const grant = schemaBlock(spec, "ClientActionUploadLeaseGrant");
  for (const contract of [
    "lateRewriteClosure",
    "bounded-cushion-and-post-expiry-reconcile",
    "rawFileAcceptedByApi: { type: boolean, const: false }",
    "externalMessageSentByValo: { type: boolean, const: false }",
    "maximum: 52428800",
  ]) {
    assert.ok(grant.includes(contract), `lease grant omits ${contract}`);
  }
  const receipt = schemaBlock(spec, "ClientActionUploadFinalizationReceipt");
  for (const contract of [
    "receiptSha256",
    "extractionStarted: { type: boolean, const: false }",
    "rawFileAcceptedByApi: { type: boolean, const: false }",
    "externalMessageSentByValo: { type: boolean, const: false }",
  ]) {
    assert.ok(
      receipt.includes(contract),
      `finalization receipt omits ${contract}`,
    );
  }
  assert.match(
    spec,
    /ClientActionUploadConflictError:[\s\S]*?enum: \[stale_version, conflict, cleanup_unconfirmed\]/u,
  );
  assert.match(spec, /ClientActionUploadExpiredError:[\s\S]*?const: expired/u);
  assert.match(
    spec,
    /ClientActionUploadIntakeRejectedError:[\s\S]*?const: intake_rejected/u,
  );
  assert.match(
    schemaBlock(spec, "ClientActionUploadGovernedError"),
    /activation: \{ type: string, const: blocked \}[\s\S]*?sideEffectsApplied: \{ type: boolean, const: false \}/u,
  );

  const source = readFileSync(
    resolve(routesRoot, "clientActionUpload.ts"),
    "utf8",
  );
  assert.match(
    source,
    /CLIENT_UPLOAD_REQUEST_BODY_BYTES,[\s\S]*?"client-action"/u,
  );
  assert.match(source, /res\.status\(result\.replayed \? 200 : 201\)/u);
  assert.doesNotMatch(source, /req\.(?:file|files)|\.single\(|\.array\(/u);
  const service = readFileSync(
    resolve(
      root,
      "artifacts",
      "api-server",
      "src",
      "lib",
      "storageLifecycle",
      "clientUpload.ts",
    ),
    "utf8",
  );
  assert.match(service, /rawFileAcceptedByApi: false/u);
  assert.match(service, /externalMessageSentByValo: false/u);
});

test("retention completion publishes a guarded detach, reconcile and independent-certification protocol", () => {
  const spec = readFileSync(specPath, "utf8");
  const operations = parseOperations(spec);
  for (const [key, operationId, statuses] of [
    [
      "get /retention-requests",
      "listRetentionRequests",
      ["200", "401", "403", "500"],
    ],
    [
      "get /retention-completion/readiness",
      "getRetentionCompletionReadiness",
      ["200", "401", "403", "500", "503"],
    ],
    [
      "get /retention-requests/{id}/completion",
      "getRetentionRequestCompletion",
      ["200", "401", "403", "404", "500", "503"],
    ],
    [
      "post /retention-requests/{id}/complete",
      "completeRetentionRequest",
      [
        "202",
        "400",
        "401",
        "403",
        "404",
        "409",
        "412",
        "413",
        "428",
        "500",
        "503",
      ],
    ],
    [
      "post /retention-actions/{id}/reconcile",
      "reconcileRetentionAction",
      [
        "200",
        "400",
        "401",
        "403",
        "404",
        "409",
        "412",
        "413",
        "428",
        "500",
        "503",
      ],
    ],
    [
      "post /retention-actions/{id}/certify",
      "certifyRetentionAction",
      [
        "200",
        "400",
        "401",
        "403",
        "404",
        "409",
        "412",
        "413",
        "428",
        "500",
        "503",
      ],
    ],
  ]) {
    const operation = operations.get(key);
    assert.ok(operation, `missing ${key}`);
    assert.equal(operation.operationId, operationId);
    assert.deepEqual(operation.statuses, statuses);
    assert.equal(operation.privateNoStore, true);
    assert.equal(operation.varyOrganisation, true);
  }

  for (const operationId of [
    "completeRetentionRequest",
    "reconcileRetentionAction",
    "certifyRetentionAction",
  ]) {
    const start = spec.indexOf(`      operationId: ${operationId}`);
    const block = spec.slice(start, spec.indexOf("\n  /", start));
    assert.match(block, /#\/components\/parameters\/IfMatchVersion/u);
    assert.match(
      block,
      /#\/components\/parameters\/RetentionCompletionIdempotencyKey/u,
    );
    assert.match(block, /RetentionCompletionAttestation/u);
    assert.match(block, /RetentionCompletionSnapshot/u);
    assert.match(block, /RetentionCompletionStaleVersion/u);
    assert.match(block, /RetentionCompletionUnavailable/u);
  }

  const request = schemaBlock(spec, "RetentionRequest");
  for (const contract of [
    "additionalProperties: false",
    "projectId",
    "subjectProjectId",
    "requestedByUserId",
    "requestedByName",
    "version",
    "enum: [pending, reconciling, completed, blocked]",
  ]) {
    assert.ok(
      request.includes(contract),
      `retention request omits ${contract}`,
    );
  }

  const readiness = schemaBlock(spec, "RetentionCompletionReadiness");
  for (const contract of [
    "activated",
    "manifestValid",
    "environmentOptIn",
    "activationBlockers",
    "evidenceBlockers",
    "makerCheckerRequired",
    "durable_two_phase_detach_reconcile_certify",
  ]) {
    assert.ok(readiness.includes(contract), `readiness omits ${contract}`);
  }
  const permissions = schemaBlock(spec, "RetentionCompletionPermissions");
  for (const permission of ["canStart", "canReconcile", "canCertify"]) {
    assert.ok(
      permissions.includes(permission),
      `readiness omits ${permission}`,
    );
  }

  const attestation = schemaBlock(spec, "RetentionCompletionAttestation");
  for (const contract of [
    "additionalProperties: false",
    "required: [attestation]",
    "minLength: 16",
    "maxLength: 512",
  ]) {
    assert.ok(
      attestation.includes(contract),
      `retention attestation omits ${contract}`,
    );
  }

  const action = schemaBlock(spec, "RetentionAction");
  for (const contract of [
    "retentionRequestId",
    "enum: [pending, detached, reconciled, certified, blocked]",
    "sourceManifest",
    "sourceManifestSha256",
    "purgeReceipt",
    "purgeReceiptSha256",
    "purgedAt",
    "reconciliationManifest",
    "reconciliationManifestSha256",
    "preparedByUserId",
    "checkedByUserId",
  ]) {
    assert.ok(action.includes(contract), `retention action omits ${contract}`);
  }

  const binding = schemaBlock(spec, "RetentionObjectBinding");
  assert.match(binding, /terminalDisposition/u);
  assert.match(binding, /const: project_retention/u);
  assert.doesNotMatch(binding, /objectPath|objectPathSha256/u);

  const certificate = schemaBlock(spec, "RetentionDeletionCertificate");
  for (const contract of [
    "certificateManifest",
    "certificateManifestSha256",
    "signedByUserId",
    "signedByName",
  ]) {
    assert.ok(certificate.includes(contract), `certificate omits ${contract}`);
  }
  assert.doesNotMatch(certificate, /exceptions/u);

  const snapshot = schemaBlock(spec, "RetentionCompletionSnapshot");
  for (const contract of [
    "objectReconciliation",
    "objectBindings",
    "retainedCategories",
    "blockers",
    "certificate",
    "permissions",
    "generatedAt",
  ]) {
    assert.ok(snapshot.includes(contract), `snapshot omits ${contract}`);
  }

  const unavailable = schemaBlock(spec, "RetentionCompletionUnavailable");
  assert.match(unavailable, /RetentionCompletionNotActivated/u);
  assert.match(unavailable, /RetentionCompletionControlPlaneUnavailable/u);
  const notActivated = schemaBlock(spec, "RetentionCompletionNotActivated");
  for (const contract of [
    "additionalProperties: false",
    "required: [error, code, sideEffectsApplied, readiness]",
    "const: RETENTION_COMPLETION_NOT_ACTIVATED",
    "RetentionCompletionReadiness",
  ]) {
    assert.ok(
      notActivated.includes(contract),
      `retention activation refusal omits ${contract}`,
    );
  }

  const staleVersion = schemaBlock(spec, "RetentionCompletionStaleVersion");
  for (const contract of [
    "additionalProperties: false",
    "required: [error, code, sideEffectsApplied]",
    "const: stale_version",
    "RetentionCompletionSnapshot",
  ]) {
    assert.ok(
      staleVersion.includes(contract),
      `retention stale-version response omits ${contract}`,
    );
  }
  const controlPlaneUnavailable = schemaBlock(
    spec,
    "RetentionCompletionControlPlaneUnavailable",
  );
  for (const contract of [
    "additionalProperties: false",
    "required: [error, code, sideEffectsApplied]",
    "const: persistence_unavailable",
    "const: false",
  ]) {
    assert.ok(
      controlPlaneUnavailable.includes(contract),
      `retention control-plane refusal omits ${contract}`,
    );
  }

  const listStart = spec.indexOf("      operationId: listRetentionRequests");
  const listBlock = spec.slice(listStart, spec.indexOf("\n  /", listStart));
  assert.match(listBlock, /maxItems: 100/u);
  assert.match(listBlock, /RetentionRequest/u);
  assert.doesNotMatch(listBlock, /RetentionCompletionSnapshot/u);
});

test("bounded pilots publish their lifetime capacity and retention limits on every operation", () => {
  const parsed = parseOperations(readFileSync(specPath, "utf8"));
  const byOperationId = new Map(
    [...parsed.values()].map((operation) => [operation.operationId, operation]),
  );
  for (const operationId of [
    "listOpportunitySourceCandidates",
    "getOpportunitySourceCandidate",
    "recordManualOpportunitySource",
    "decideOpportunitySourceCandidate",
  ]) {
    const description = byOperationId.get(operationId)?.description ?? "";
    for (const statement of [
      "250 lifetime source receipts per organisation",
      "no in-app archive",
      "reviewed retention/storage migration",
      "audit events must never be deleted",
    ]) {
      assert.ok(
        description.includes(statement),
        `${operationId} omits ${statement}`,
      );
    }
  }
  for (const operationId of [
    "prepareOpportunityPursuitHandoff",
    "confirmOpportunityPursuitHandoff",
  ]) {
    const description = byOperationId.get(operationId)?.description ?? "";
    for (const statement of [
      "250 lifetime handoff receipts per organisation",
      "no in-app archive",
      "reviewed retention/storage migration",
      "audit events must never be deleted",
    ]) {
      assert.ok(
        description.includes(statement),
        `${operationId} omits ${statement}`,
      );
    }
  }
  for (const operationId of [
    "getAiShadowProgramme",
    "createAiShadowPlan",
    "recordAiShadowObservation",
    "closeAiShadowPlan",
  ]) {
    const description = byOperationId.get(operationId)?.description ?? "";
    for (const statement of [
      "no-provider, no-output evidence register",
      "25 lifetime plans per organisation",
      "no in-app archive",
      "never grants production activation",
      "reviewed retention/storage migration",
      "audit events must never be deleted",
    ]) {
      assert.ok(
        description.includes(statement),
        `${operationId} omits ${statement}`,
      );
    }
  }
});

test("generated React and Zod clients contain every public roadmap operation", () => {
  const client = readFileSync(generatedClientPath, "utf8");
  const zod = readFileSync(generatedZodPath, "utf8");

  for (const operation of ROADMAP_API_OPERATIONS) {
    assert.ok(
      client.includes(`export const ${operation.operationId}`),
      `React client missing ${operation.operationId}`,
    );
    const pascal = pascalOperationId(operation.operationId);
    const response = generatedBlock(zod, `export const ${pascal}Response`);
    assert.ok(
      response.includes(".strict()"),
      `${pascal}Response is not strict`,
    );
    if (operation.method !== "get" && operation.requestBody !== false) {
      const body = generatedBlock(zod, `export const ${pascal}Body`);
      assert.ok(body.includes(".strict()"), `${pascal}Body is not strict`);
    }
  }
});

test("generated Delivery Studio clients preserve all actions, exact bounds and required headers", () => {
  const client = readFileSync(generatedClientPath, "utf8");
  const zod = readFileSync(generatedZodPath, "utf8");
  const start = client.indexOf("export const runDeliveryStudioAction = async");
  const operation = client.slice(
    start,
    client.indexOf("export const getGetPortfolioIntelligenceUrl", start),
  );
  assert.notEqual(start, -1, "React client lost runDeliveryStudioAction");
  for (const transport of [
    "ifMatch: string",
    "idempotencyKey: string",
    "'If-Match': ifMatch",
    "'Idempotency-Key': idempotencyKey",
    "{projectId: string;data: BodyType<DeliveryStudioAction>;ifMatch: string;idempotencyKey: string}",
    "const {projectId,data,ifMatch,idempotencyKey} = props",
    "runDeliveryStudioAction(projectId,data,ifMatch,idempotencyKey,requestOptions)",
    "UnauthorizedResponse",
    "PreconditionFailedResponse",
    "DeliveryStudioPayloadTooLargeResponse",
  ]) {
    assert.ok(
      operation.includes(transport),
      `generated client lost ${transport}`,
    );
  }

  const body = generatedBlock(zod, "export const RunDeliveryStudioActionBody");
  for (const action of [
    "save_response",
    "review_response_claim",
    "start_red_team",
    "resolve_red_team_finding",
    "approve_red_team",
    "assemble_package",
    "rehearse_submission",
  ]) {
    assert.ok(
      body.includes(`'${action}'`) || body.includes(`\"${action}\"`),
      `generated action union lost ${action}`,
    );
  }
  for (const bound of [
    "runDeliveryStudioActionBodyOneTitleMax = 300;",
    "runDeliveryStudioActionBodyOneChangeSummaryMax = 2000;",
    "runDeliveryStudioActionBodyOneClaimsItemCitationsItemQuoteMax = 20000;",
    "runDeliveryStudioActionBodyTwoNoteMin = 2;",
    "runDeliveryStudioActionBodyThreePolicyVersionMax = 128;",
    "runDeliveryStudioActionBodyThreeFindingsItemCategoryMax = 120;",
    "runDeliveryStudioActionBodyThreeFindingsItemFindingMax = 10000;",
    "runDeliveryStudioActionBodyFourResolutionMin = 2;",
    "runDeliveryStudioActionBodyFourResolutionMax = 5000;",
    "runDeliveryStudioActionBodyFiveAttestationMin = 10;",
    "runDeliveryStudioActionBodyFiveAttestationMax = 2000;",
    "runDeliveryStudioActionBodySevenRehearsalSourcesItemContentMax = 2000000;",
    "runDeliveryStudioActionBodySevenRehearsalFilesItemFilenameMax = 500;",
    "runDeliveryStudioActionResponseDataRedTeamReviewRunOneApprovalAttestationOneMin = 10;",
    "runDeliveryStudioActionResponseDataRedTeamReviewRunOneApprovalAttestationOneMax = 2000;",
  ]) {
    assert.ok(zod.includes(bound), `generated Zod lost ${bound}`);
  }
  assert.ok(
    body.includes("})).min(1).max(runDeliveryStudioActionBodyOneClaimsMax)"),
    "generated claim list must retain its non-empty bound after claim refinement",
  );
  assert.ok(
    body.includes('value.kind !== "opinion" && value.citations.length === 0') &&
      body.includes('path: ["citations"]'),
    "generated claim schema must enforce citations for factual and instructional claims",
  );
  assert.ok(body.includes(".strict()"));
  assert.ok(
    !body.includes('reviewedAt": zod.date()'),
    "runtime accepts bounded timestamp text, not Date objects",
  );
  assert.ok(body.includes("zod.number().int().safe()"));
  assert.ok(
    body.includes('"uploadOrder": zod.number().int().safe().min(1).max('),
  );
  assert.ok(
    body.includes('"sizeBytes": zod.number().int().safe().min(1).max('),
  );
  assert.ok(
    body.includes(
      "Citation offsets must be supplied together and end after start",
    ),
    "generated action validator lost citation offset parity",
  );
  const response = generatedBlock(
    zod,
    "export const RunDeliveryStudioActionResponse",
  );
  for (const literal of [
    "\"outcome\": zod.enum(['recorded', 'replayed'])",
    '"automaticMutation": zod.literal(false)',
    '"externalPortalAction": zod.literal(false)',
    '"namedHumanAuthority": zod.literal(true)',
    '"approvalAttestation": zod.union([zod.string().min(',
  ]) {
    assert.ok(response.includes(literal), `response widened ${literal}`);
  }
  assert.ok(response.includes(".strict()"));

  const thirdWaveStart = zod.indexOf("export const GetDeliveryStudioParams =");
  const thirdWaveEnd = zod.indexOf(
    "export const RequestUploadUrlResponse =",
    thirdWaveStart,
  );
  const thirdWave = zod.slice(thirdWaveStart, thirdWaveEnd);
  assert.doesNotMatch(thirdWave, /zod\.number\(\)(?!\.int\(\)\.safe\(\))/u);
  assert.ok(!thirdWave.includes("zod.date()"));
  assert.ok(thirdWave.includes("zod.string().datetime({ offset: true })"));

  for (const [operationId, endMarker] of [
    ["getDeliveryStudio", "export const getRunDeliveryStudioActionUrl"],
    ["getPortfolioIntelligence", "export const getRequestUploadUrlUrl"],
  ]) {
    const operationStart = client.indexOf(`export const ${operationId} =`);
    const getOperation = client.slice(
      operationStart,
      client.indexOf(endMarker, operationStart),
    );
    assert.ok(
      getOperation.includes("ErrorEnvelope"),
      `${operationId} generated client lost its private conflict envelope`,
    );
  }
  const portfolioResponse = generatedBlock(
    zod,
    "export const GetPortfolioIntelligenceResponse",
  );
  assert.ok(!portfolioResponse.includes("lessonProposalCount"));
});

test("generated Client Action upload bodies, receipts and status literals stay strict", () => {
  const client = readFileSync(generatedClientPath, "utf8");
  const zod = readFileSync(generatedZodPath, "utf8");
  for (const operationId of [
    "issueClientActionUploadLease",
    "finalizeClientActionUploadLease",
  ]) {
    assert.ok(
      client.includes(`export const ${operationId}`),
      `React client missing ${operationId}`,
    );
    const pascal = pascalOperationId(operationId);
    const body = generatedBlock(zod, `export const ${pascal}Body`);
    assert.ok(body.includes('"expectedVersion"'));
    assert.ok(body.includes('"intentId"'));
    assert.ok(body.includes(".strict()"));
    const response = generatedBlock(zod, `export const ${pascal}Response`);
    assert.ok(response.includes(".strict()"));
  }
  const lease = generatedBlock(
    zod,
    "export const IssueClientActionUploadLeaseResponse",
  );
  for (const literal of [
    'zod.literal("bounded-cushion-and-post-expiry-reconcile")',
    '"rawFileAcceptedByApi": zod.literal(false)',
    '"externalMessageSentByValo": zod.literal(false)',
    '"replayed": zod.union([zod.literal(true), zod.literal(false)])',
  ]) {
    assert.ok(lease.includes(literal), `lease response widened ${literal}`);
  }
  const finalized = generatedBlock(
    zod,
    "export const FinalizeClientActionUploadLeaseResponse",
  );
  for (const literal of [
    '"extractionStarted": zod.literal(false)',
    '"rawFileAcceptedByApi": zod.literal(false)',
    '"externalMessageSentByValo": zod.literal(false)',
    '"replayed": zod.union([zod.literal(true), zod.literal(false)])',
  ]) {
    assert.ok(
      finalized.includes(literal),
      `finalization response widened ${literal}`,
    );
  }
});

test("generated retention phase transitions keep strict bodies and both required headers", () => {
  const client = readFileSync(generatedClientPath, "utf8");
  const zod = readFileSync(generatedZodPath, "utf8");
  for (const [operationId, endMarker] of [
    ["completeRetentionRequest", "export const getReconcileRetentionActionUrl"],
    ["reconcileRetentionAction", "export const getCertifyRetentionActionUrl"],
    ["certifyRetentionAction", "export const getGetAppConfigUrl"],
  ]) {
    const start = client.indexOf(`export const ${operationId} = async`);
    const block = client.slice(start, client.indexOf(endMarker, start));
    assert.ok(block.includes("Promise<RetentionCompletionSnapshot>"));
    assert.ok(block.includes("ifMatch: string"));
    assert.ok(block.includes("idempotencyKey: string"));
    assert.ok(block.includes("'If-Match': ifMatch"));
    assert.ok(block.includes("'Idempotency-Key': idempotencyKey"));
    assert.ok(block.includes("ifMatch,idempotencyKey,requestOptions"));

    const pascal = pascalOperationId(operationId);
    const body = generatedBlock(zod, `export const ${pascal}Body`);
    const response = generatedBlock(zod, `export const ${pascal}Response`);
    assert.ok(
      body.includes(
        `"attestation": zod.string().min(${operationId}BodyAttestationMin).max(${operationId}BodyAttestationMax)`,
      ),
    );
    assert.ok(
      zod.includes(`export const ${operationId}BodyAttestationMin = 16;`),
    );
    assert.ok(
      zod.includes(`export const ${operationId}BodyAttestationMax = 512;`),
    );
    assert.ok(body.includes(".strict()"));
    assert.ok(response.includes(".strict()"));
    for (const purgeProof of [
      '"purgeReceipt"',
      '"purgeReceiptSha256"',
      '"purgedAt"',
    ]) {
      assert.ok(
        response.includes(purgeProof),
        `${operationId} response omits ${purgeProof}`,
      );
    }
  }

  const readiness = generatedBlock(
    zod,
    "export const GetRetentionCompletionReadinessResponse",
  );
  assert.ok(readiness.includes('"activated"'));
  assert.ok(readiness.includes('"activationBlockers"'));
  assert.ok(readiness.includes('"evidenceBlockers"'));
  assert.ok(readiness.includes(".strict()"));
});

test("generated storage dead-letter commands require their CAS header", () => {
  const client = readFileSync(generatedClientPath, "utf8");
  for (const [operationId, endMarker] of [
    [
      "replayStorageDeletionDeadLetter",
      "export const getResolveStorageDeletionDeadLetterUrl",
    ],
    [
      "resolveStorageDeletionDeadLetter",
      "export const getCompleteRetentionRequestUrl",
    ],
  ]) {
    const block = client.slice(
      client.indexOf(`export const ${operationId} = async`),
      client.indexOf(endMarker, client.indexOf(`export const ${operationId}`)),
    );
    assert.ok(block.includes("ifMatch: string"));
    assert.ok(block.includes("'If-Match': ifMatch"));
    assert.ok(block.includes("ifMatch,requestOptions"));
    assert.ok(block.includes("ifMatch} = props"));
  }
});

test("generated first-wave named reviews require their CAS header", () => {
  const spec = readFileSync(specPath, "utf8");
  const client = readFileSync(generatedClientPath, "utf8");
  for (const [operationId, endMarker] of [
    [
      "reviewDocumentVersionSnapshot",
      "export const getGetTenderContextCentreUrl",
    ],
    [
      "reviewTenderContextVersion",
      "export const getCreateTenderEligibilityPassportUrl",
    ],
    [
      "reviewTenderEligibilityPassport",
      "export const getGetAddendumImpactCentreUrl",
    ],
  ]) {
    const operationStart = spec.indexOf(`operationId: ${operationId}`);
    assert.notEqual(operationStart, -1, `OpenAPI lost ${operationId}`);
    const nextOperation = spec.indexOf(
      "\n      operationId:",
      operationStart + 1,
    );
    const operation = spec.slice(
      operationStart,
      nextOperation === -1 ? spec.length : nextOperation,
    );
    assert.ok(
      operation.includes('$ref: "#/components/parameters/IfMatchVersion"'),
      `${operationId} lost its required If-Match contract`,
    );

    const start = client.indexOf(`export const ${operationId} = async`);
    const block = client.slice(start, client.indexOf(endMarker, start));
    assert.ok(block.includes("ifMatch: string"));
    assert.ok(block.includes("'If-Match': ifMatch"));
    assert.ok(block.includes("ifMatch,requestOptions"));
    assert.ok(block.includes("ifMatch} = props"));
  }
});

test("If-Match contracts stop at the runtime safe-integer boundary", () => {
  const spec = readFileSync(specPath, "utf8");
  const patterns = ["IfMatchVersion", "IfMatchVersionOptional"].map((name) => {
    const block = parameterBlock(spec, name);
    assert.match(block, /maxLength: 21/u);
    const match = /pattern: '([^']+)'/u.exec(block);
    assert.ok(match, `${name} lost its version pattern`);
    return match[1];
  });
  assert.equal(patterns[0], patterns[1]);
  const version = new RegExp(patterns[0], "u");
  for (const accepted of ["1", '"9007199254740991"', 'W/"9007199254740991"']) {
    assert.equal(
      version.test(accepted),
      true,
      `rejected safe ETag ${accepted}`,
    );
  }
  for (const rejected of [
    "0",
    "9007199254740992",
    'W/"9999999999999999"',
    "10000000000000000",
  ]) {
    assert.equal(
      version.test(rejected),
      false,
      `accepted unsafe ETag ${rejected}`,
    );
  }

  const zod = readFileSync(generatedZodPath, "utf8");
  for (const [startMarker, endMarker] of [
    [
      "export const ReviewDocumentVersionSnapshotParams =",
      "export const GetTenderContextCentreParams =",
    ],
    [
      "export const ReviewTenderContextVersionParams =",
      "export const CreateTenderEligibilityPassportParams =",
    ],
    [
      "export const ReviewTenderEligibilityPassportParams =",
      "export const GetAddendumImpactCentreParams =",
    ],
  ]) {
    const start = zod.indexOf(startMarker);
    const block = zod.slice(start, zod.indexOf(endMarker, start));
    assert.ok(block.includes("900719925474099[01]"));
    assert.match(
      block,
      /HeaderIfMatchMax = 21;[\s\S]*zod\.string\(\)\.max\([A-Za-z0-9]+HeaderIfMatchMax\)/u,
    );
  }
});

test("generated first-wave arrays preserve OpenAPI uniqueItems", () => {
  const spec = readFileSync(specPath, "utf8");
  assert.equal(
    schemaBlock(spec, "TenderContextVersionCreateRequest").match(
      /uniqueItems: true/gu,
    )?.length,
    2,
  );
  assert.equal(
    schemaBlock(spec, "AddendumDownstreamImpact").match(/uniqueItems: true/gu)
      ?.length,
    2,
  );

  const zod = readFileSync(generatedZodPath, "utf8");
  for (const [startMarker, endMarker, expectedCount] of [
    [
      "export const CreateTenderContextVersionParams =",
      "export const ReviewTenderContextVersionParams =",
      2,
    ],
    [
      "export const GetAddendumImpactCentreParams =",
      "export const ReviewAddendumImpactParams =",
      2,
    ],
    [
      "export const ReviewAddendumImpactParams =",
      "export const ApplyAddendumImpactParams =",
      2,
    ],
  ]) {
    const start = zod.indexOf(startMarker);
    const block = zod.slice(start, zod.indexOf(endMarker, start));
    assert.equal(
      block.match(/new Set\(values\)\.size === values\.length/gu)?.length ?? 0,
      expectedCount,
      `${startMarker} lost unique-items validation`,
    );
  }
});

test("generated first-wave authority records enforce state and stamp invariants", () => {
  const spec = readFileSync(specPath, "utf8");
  for (const schemaName of [
    "DocumentVersionSnapshot",
    "TenderNamedReview",
    "TenderHumanReview",
  ]) {
    const schema = schemaBlock(spec, schemaName);
    assert.match(schema, /allOf:/u, `${schemaName} lost its conditional`);
    assert.match(schema, /if:/u, `${schemaName} lost its state branch`);
    assert.match(schema, /else:/u, `${schemaName} lost its decided branch`);
  }

  const zod = readFileSync(generatedZodPath, "utf8");
  for (const [startMarker, endMarker, message, expectedCount] of [
    [
      "export const GetCurrentDocumentVersionSnapshotParams =",
      "export const CaptureDocumentVersionSnapshotParams =",
      "Snapshot status and named verification stamp are inconsistent",
      1,
    ],
    [
      "export const CaptureDocumentVersionSnapshotParams =",
      "export const ReviewDocumentVersionSnapshotParams =",
      "Snapshot status and named verification stamp are inconsistent",
      1,
    ],
    [
      "export const ReviewDocumentVersionSnapshotParams =",
      "export const GetTenderContextCentreParams =",
      "Snapshot status and named verification stamp are inconsistent",
      1,
    ],
    [
      "export const GetTenderContextCentreParams =",
      "export const CreateTenderContextVersionParams =",
      "Review state and named reviewer stamp are inconsistent",
      2,
    ],
    [
      "export const CreateTenderContextVersionParams =",
      "export const ReviewTenderContextVersionParams =",
      "Review state and named reviewer stamp are inconsistent",
      1,
    ],
    [
      "export const ReviewTenderContextVersionParams =",
      "export const CreateTenderEligibilityPassportParams =",
      "Review state and named reviewer stamp are inconsistent",
      1,
    ],
    [
      "export const CreateTenderEligibilityPassportParams =",
      "export const ReviewTenderEligibilityPassportParams =",
      "Review state and named reviewer stamp are inconsistent",
      1,
    ],
    [
      "export const ReviewTenderEligibilityPassportParams =",
      "export const GetAddendumImpactCentreParams =",
      "Review state and named reviewer stamp are inconsistent",
      1,
    ],
    [
      "export const GetTenderContextCentreParams =",
      "export const CreateTenderContextVersionParams =",
      "A recorded decision requires its reviewer and review time",
      3,
    ],
    [
      "export const CreateTenderEligibilityPassportParams =",
      "export const ReviewTenderEligibilityPassportParams =",
      "A recorded decision requires its reviewer and review time",
      3,
    ],
    [
      "export const ReviewTenderEligibilityPassportParams =",
      "export const GetAddendumImpactCentreParams =",
      "A recorded decision requires its reviewer and review time",
      3,
    ],
  ]) {
    const start = zod.indexOf(startMarker);
    const block = zod.slice(start, zod.indexOf(endMarker, start));
    assert.equal(
      block.split(message).length - 1,
      expectedCount,
      `${startMarker} lost ${message}`,
    );
  }
  const snapshot = zod.slice(
    zod.indexOf("export const GetCurrentDocumentVersionSnapshotParams ="),
    zod.indexOf("export const CaptureDocumentVersionSnapshotParams ="),
  );
  assert.ok(
    snapshot.includes("value.verifiedByUserId === value.capturedByUserId"),
    "snapshot verification no longer enforces maker-checker separation",
  );
  assert.equal(
    zod.match(/value\.verifiedByName\.length > 0/gu)?.length ?? 0,
    3,
    "snapshot verification accepts an empty named-verifier stamp",
  );
  assert.equal(
    zod.match(/value\.reviewedByName\.length > 0/gu)?.length ?? 0,
    6,
    "tender review accepts an empty named-reviewer stamp",
  );
});

test("document snapshot runtime accepts the OpenAPI RFC 9562 UUID range", () => {
  const route = readFileSync(
    resolve(routesRoot, "documentVersionSnapshots.ts"),
    "utf8",
  );
  const identifiers = readFileSync(
    resolve(
      root,
      "artifacts",
      "api-server",
      "src",
      "lib",
      "identifierPatterns.ts",
    ),
    "utf8",
  );
  assert.match(
    route,
    /import \{ UUID_PATTERN \} from "\.\.\/lib\/identifierPatterns"/u,
  );
  assert.equal(route.match(/UUID_PATTERN\.test/gu)?.length, 2);
  assert.doesNotMatch(route, /\[1-5\]\[0-9a-f\]\{3\}/u);
  assert.match(identifiers, /UUID_PATTERN\s*=\s*\/[\s\S]*\[1-8\]/u);
  assert.match(
    schemaBlock(readFileSync(specPath, "utf8"), "DocumentVersionSnapshot"),
    /documentVersionId: \{ type: string, format: uuid \}/u,
  );
});

test("generated Zod barrel removes the operation/schema name collision", () => {
  const index = readFileSync(generatedZodTypesIndexPath, "utf8");
  assert.ok(
    !index.includes("export * from './getAddendumImpactCentreParams';"),
  );
});

test("generated first-wave integers reject fractions and unsafe numbers", () => {
  const zod = readFileSync(generatedZodPath, "utf8");
  for (const [startMarker, endMarker, expectedIntegerCount] of [
    [
      "export const GetCurrentDocumentVersionSnapshotParams =",
      "export const CaptureDocumentVersionSnapshotParams =",
      10,
    ],
    [
      "export const CaptureDocumentVersionSnapshotParams =",
      "export const ReviewDocumentVersionSnapshotParams =",
      19,
    ],
    [
      "export const ReviewDocumentVersionSnapshotParams =",
      "export const GetTenderContextCentreParams =",
      10,
    ],
    [
      "export const GetTenderContextCentreParams =",
      "export const CreateTenderContextVersionParams =",
      14,
    ],
    [
      "export const CreateTenderContextVersionParams =",
      "export const ReviewTenderContextVersionParams =",
      6,
    ],
    [
      "export const ReviewTenderContextVersionParams =",
      "export const CreateTenderEligibilityPassportParams =",
      4,
    ],
    [
      "export const CreateTenderEligibilityPassportParams =",
      "export const ReviewTenderEligibilityPassportParams =",
      7,
    ],
    [
      "export const ReviewTenderEligibilityPassportParams =",
      "export const GetAddendumImpactCentreParams =",
      7,
    ],
    [
      "export const GetAddendumImpactCentreParams =",
      "export const ReviewAddendumImpactParams =",
      12,
    ],
    [
      "export const ReviewAddendumImpactParams =",
      "export const ApplyAddendumImpactParams =",
      13,
    ],
    [
      "export const ApplyAddendumImpactParams =",
      "export const SearchProjectIntelligenceEvidenceParams =",
      2,
    ],
  ]) {
    const start = zod.indexOf(startMarker);
    const end = zod.indexOf(endMarker, start);
    assert.notEqual(start, -1, `generated Zod lost ${startMarker}`);
    assert.notEqual(end, -1, `generated Zod lost ${endMarker}`);
    const operation = zod.slice(start, end);
    assert.equal(
      operation.match(/zod\.number\(\)\.int\(\)\.safe\(\)/gu)?.length ?? 0,
      expectedIntegerCount,
      `${startMarker} lost integer/safe-number validation`,
    );
    assert.equal(
      operation.match(/zod\.number\(\)(?!\.int\(\)\.safe\(\))/gu)?.length ?? 0,
      0,
      `${startMarker} still accepts a fractional or unsafe number`,
    );
  }
});

test("generated first-wave Zod schemas preserve JSON date strings", () => {
  const zod = readFileSync(generatedZodPath, "utf8");
  for (const [startMarker, endMarker, expectedDateCount] of [
    [
      "export const GetCurrentDocumentVersionSnapshotParams =",
      "export const CaptureDocumentVersionSnapshotParams =",
      2,
    ],
    [
      "export const CaptureDocumentVersionSnapshotParams =",
      "export const ReviewDocumentVersionSnapshotParams =",
      2,
    ],
    [
      "export const ReviewDocumentVersionSnapshotParams =",
      "export const GetTenderContextCentreParams =",
      2,
    ],
    [
      "export const GetTenderContextCentreParams =",
      "export const CreateTenderContextVersionParams =",
      16,
    ],
    [
      "export const CreateTenderContextVersionParams =",
      "export const ReviewTenderContextVersionParams =",
      6,
    ],
    [
      "export const ReviewTenderContextVersionParams =",
      "export const CreateTenderEligibilityPassportParams =",
      5,
    ],
    [
      "export const CreateTenderEligibilityPassportParams =",
      "export const ReviewTenderEligibilityPassportParams =",
      9,
    ],
    [
      "export const ReviewTenderEligibilityPassportParams =",
      "export const GetAddendumImpactCentreParams =",
      9,
    ],
    [
      "export const GetAddendumImpactCentreParams =",
      "export const ReviewAddendumImpactParams =",
      4,
    ],
    [
      "export const ReviewAddendumImpactParams =",
      "export const ApplyAddendumImpactParams =",
      4,
    ],
    [
      "export const ApplyAddendumImpactParams =",
      "export const SearchProjectIntelligenceEvidenceParams =",
      1,
    ],
  ]) {
    const start = zod.indexOf(startMarker);
    const end = zod.indexOf(endMarker, start);
    const operation = zod.slice(start, end);
    assert.equal(
      operation.match(/zod\.date\(\)/gu)?.length ?? 0,
      0,
      `${startMarker} expects JavaScript Date objects instead of JSON strings`,
    );
    assert.equal(
      (operation.match(/zod\.string\(\)\.date\(\)/gu)?.length ?? 0) +
        (operation.match(/zod\.string\(\)\.datetime\(\{ offset: true \}\)/gu)
          ?.length ?? 0),
      expectedDateCount,
      `${startMarker} lost a date or date-time wire validator`,
    );
  }

  const createStart = zod.indexOf(
    "export const CreateTenderContextVersionParams =",
  );
  const createEnd = zod.indexOf(
    "export const ReviewTenderContextVersionParams =",
    createStart,
  );
  assert.ok(
    zod
      .slice(createStart, createEnd)
      .includes('"submissionDate": zod.string().date()'),
    "Tender Context JSON submissionDate no longer accepts YYYY-MM-DD",
  );

  const centreStart = zod.indexOf(
    "export const GetTenderContextCentreParams =",
  );
  const centreEnd = zod.indexOf(
    "export const CreateTenderContextVersionParams =",
    centreStart,
  );
  const centre = zod.slice(centreStart, centreEnd);
  for (const fieldName of ["validFrom", "validUntil"]) {
    assert.ok(
      centre.includes(`"${fieldName}": zod.string().date().nullable()`),
      `Tender Context company-evidence ${fieldName} lost its nullable date-only wire validator`,
    );
  }
});

test("explicit-clear update schemas use OpenAPI 3.1 null unions", () => {
  const spec = readFileSync(specPath, "utf8");
  const contracts = new Map([
    [
      "CapabilityItemUpdate",
      new Map([
        ["description", "string"],
        ["evidenceDocId", "string"],
      ]),
    ],
    [
      "VaultItemUpdate",
      new Map([
        ["issuer", "string"],
        ["issueDate", "string"],
        ["expiryDate", "string"],
        ["renewalLeadDays", "integer"],
        ["sourceDocumentId", "string"],
      ]),
    ],
    [
      "RequirementUpdate",
      new Map([
        ["pageRef", "string"],
        ["clauseRef", "string"],
        ["expectedEvidence", "string"],
        ["reviewerNotes", "string"],
      ]),
    ],
    [
      "EvidenceUpdate",
      new Map([
        ["documentId", "string"],
        ["excerpt", "string"],
        ["notes", "string"],
      ]),
    ],
    [
      "DefectUpdate",
      new Map([
        ["requirementId", "string"],
        ["evidenceSnapshot", "string"],
        ["remediation", "string"],
        ["owner", "string"],
      ]),
    ],
  ]);

  for (const [schemaName, fields] of contracts) {
    const schema = schemaBlock(spec, schemaName);
    assert.doesNotMatch(
      schema,
      /nullable:\s*true/u,
      `${schemaName} still relies on the OpenAPI 3.0 nullable extension`,
    );
    for (const [fieldName, primitiveType] of fields) {
      assert.match(
        schema,
        new RegExp(
          `^        ${fieldName}: \\{ type: \\[${primitiveType}, "null"\\]`,
          "mu",
        ),
        `${schemaName}.${fieldName} lost its explicit JSON null union`,
      );
    }
  }
});

test("standalone Tender Context company-evidence types preserve date-only JSON strings", () => {
  const model = readFileSync(
    generatedTenderContextCompanyEvidenceOptionPath,
    "utf8",
  );
  assert.match(model, /^  validFrom: string \| null;$/mu);
  assert.match(model, /^  validUntil: string \| null;$/mu);
  assert.doesNotMatch(model, /\bDate\b/u);
});

test("generated React and Zod trees preserve every published operation", () => {
  const spec = readFileSync(specPath, "utf8");
  const client = readFileSync(generatedClientPath, "utf8");
  const zod = readFileSync(generatedZodPath, "utf8");
  const operationIds = [...spec.matchAll(/^      operationId: (\S+)$/gmu)].map(
    (match) => match[1],
  );
  for (const operationId of operationIds) {
    assert.ok(
      client.includes(`export const ${operationId}`),
      `React client lost ${operationId}`,
    );
    assert.ok(
      zod.includes(`export const ${pascalOperationId(operationId)}Response`),
      `Zod tree lost ${operationId}`,
    );
  }
});

test("generated readiness and Wave 1 read models stay strict and literal", () => {
  const client = readFileSync(generatedClientPath, "utf8");
  const zod = readFileSync(generatedZodPath, "utf8");
  assert.ok(client.includes("export const readinessCheck"));

  const readiness = generatedBlock(zod, "export const ReadinessCheckResponse");
  for (const contract of [
    '"status": zod.literal("ready")',
    '"lifecycle": zod.literal("ready")',
    '"database": zod.literal("ready")',
    ".strict()",
  ]) {
    assert.ok(readiness.includes(contract), `readiness widened ${contract}`);
  }

  const inbox = generatedBlock(zod, "export const GetWorkInboxResponse");
  for (const contract of [
    '"businessTimeZone": zod.literal("Africa/Lagos")',
    '"restrictedContent": zod.literal(true)',
    'zod.literal("/commercial-retainer")',
    ".strict()",
  ]) {
    assert.ok(inbox.includes(contract), `work inbox widened ${contract}`);
  }
  assert.ok(
    inbox.includes("HrefTwoRegExp"),
    "work inbox pursuit link pattern was not generated",
  );

  const evidence = generatedBlock(
    zod,
    "export const ListCanonicalEvidenceOptionsResponse",
  );
  assert.ok(evidence.includes('"privacyEligible": zod.boolean()'));
  assert.ok(evidence.includes(".strict()"));
});

test("generated Zod preserves closed authority and bounded-list literals", () => {
  const zod = readFileSync(generatedZodPath, "utf8");
  const exactLiterals = [
    [
      "GetProductionAcceptanceSnapshotResponse",
      [
        '"deploymentAuthorized": zod.literal(false)',
        '"requiresNamedHumanApproval": zod.literal(true)',
      ],
    ],
    [
      "ListProductionAcceptanceAuthoritiesResponse",
      ['"limit": zod.literal(100)', '"truncated": zod.literal(false)'],
    ],
    [
      "GetClientActionSnapshotResponse",
      [
        '"externalMessaging": zod.literal(false)',
        '"uploadIntentOnly": zod.literal(true)',
      ],
    ],
    [
      "ListClientActionAuthoritiesResponse",
      ['"limit": zod.literal(100)', '"truncated": zod.literal(false)'],
    ],
    [
      "ListOpportunitySourceCandidatesResponse",
      [
        '"externalAcquisitionConnected": zod.literal(false)',
        '"autonomousScrapingAllowed": zod.literal(false)',
      ],
    ],
    [
      "PrepareOpportunityPursuitHandoffResponse",
      [
        '"makerCheckerRequired": zod.literal(true)',
        '"pursuitActivated": zod.literal(false)',
        '"limit": zod.literal(100)',
      ],
    ],
    [
      "ConfirmOpportunityPursuitHandoffBody",
      ['"officialSourceReopened": zod.literal(true)'],
    ],
    [
      "GetEvidenceRenewalSnapshotResponse",
      [
        '"limit": zod.literal(100)',
        '"truncated": zod.literal(false)',
        '"externalMessagingConnected": zod.literal(false)',
        '"externalDeliveryReceipt": zod.null()',
      ],
    ],
    [
      "ListEvidenceRenewalAuthoritiesResponse",
      ['"limit": zod.literal(100)', '"truncated": zod.literal(false)'],
    ],
    [
      "CreateEvidenceRenewalPlanResponse",
      ['"externalMessageSent": zod.literal(false)'],
    ],
    [
      "RecordManualOpportunitySourceBody",
      ['"sourceKind": zod.literal("manual_url")'],
    ],
    [
      "GetReconciledCommunicationsResponse",
      [
        '"deliveryRequiresVerifiedProviderReceipt": zod.literal(true)',
        '"autonomousDispatch": zod.literal(false)',
      ],
    ],
    [
      "ListProjectCommunicationReferencesResponse",
      ['"channel": zod.literal("email")', '"limit": zod.literal(100)'],
    ],
    [
      "GetCommercialRetainerManifestResponse",
      [
        '"openApiPublished": zod.literal(true)',
        '"automaticPricingAllowed": zod.literal(false)',
      ],
    ],
    [
      "GetPartnerConsortiumRoomResponse",
      [
        '"legalAgreementGeneration": zod.literal(false)',
        '"autonomousExternalAction": zod.literal(false)',
      ],
    ],
    [
      "ListConsortiumRoomParticipantsResponse",
      ['"limit": zod.literal(100)', '"truncated": zod.literal(false)'],
    ],
    [
      "GetAiShadowProgrammeResponse",
      [
        '"rawOutputPersistenceAllowed": zod.literal(false)',
        '"productionActivationGranted": zod.literal(false)',
      ],
    ],
    [
      "GetPrivacyOperationsResponse",
      [
        '"legalDecisionAutomated": zod.literal(false)',
        '"rawSubjectPiiIncluded": zod.literal(false)',
      ],
    ],
    [
      "ListPrivacyOperationsAssigneesResponse",
      ['"limit": zod.literal(100)', '"truncated": zod.literal(false)'],
    ],
    [
      "GetClaimsDeskResponse",
      [
        '"legalConclusionAutomated": zod.literal(false)',
        '"noticeDispatched": zod.literal(false)',
        '"paymentMutated": zod.literal(false)',
      ],
    ],
  ];

  for (const [name, literals] of exactLiterals) {
    const block = generatedBlock(zod, `export const ${name}`);
    for (const literal of literals) {
      assert.ok(block.includes(literal), `${name} widened ${literal}`);
    }
  }
});

test("opportunity handoff publishes its exact CAS, body and receipt boundary", () => {
  const spec = readFileSync(specPath, "utf8");
  const confirmation = schemaBlock(
    spec,
    "OpportunityPursuitHandoffConfirmation",
  );
  for (const property of [
    "expectedCandidateVersion",
    "expectedSourceReceiptSha256",
    "expectedTenderVersion",
    "expectedConflictBoundarySha256",
    "clientId",
    "expectedClientVersion",
    "tenderLotId",
    "expectedTenderLotVersion",
    "confirmedLotReference",
    "reviewerUserId",
    "officialSourceReopened",
    "confirmedBuyer",
    "confirmedReference",
    "confirmedSubmissionDeadline",
    "confirmationNote",
  ]) {
    assert.match(confirmation, new RegExp(`${property}:`, "u"));
  }
  assert.match(
    confirmation,
    /tenderLotId: \{ type: "null" \}[\s\S]*?expectedTenderLotVersion: \{ type: "null" \}[\s\S]*?confirmedLotReference: \{ type: "null" \}/u,
  );
  const receipt = schemaBlock(spec, "OpportunityPursuitHandoffReceipt");
  for (const property of [
    "clientVersion",
    "tenderLotVersion",
    "confirmedLotReference",
    "conflictBoundarySha256",
    "requestSha256",
    "receiptSha256",
  ]) {
    assert.match(receipt, new RegExp(`${property}:`, "u"));
  }
  assert.match(
    spec,
    /confirmOpportunityPursuitHandoff[\s\S]*?OpportunityHandoffIdempotencyKey[\s\S]*?x-bidbox-request-body-max-bytes: 16384/u,
  );
  assert.match(
    schemaBlock(spec, "OpportunityPursuitHandoffAuthority"),
    /createdPursuitState: \{ type: string, const: intake \}[\s\S]*?pursuitActivated: \{ type: boolean, const: false \}/u,
  );
});

test("evidence renewal publishes exact ledger, concurrency and no-delivery truth", () => {
  const spec = readFileSync(specPath, "utf8");
  for (const operationId of [
    "createEvidenceRenewalPlan",
    "stageEvidenceRenewalReplacement",
    "reviewEvidenceRenewalReplacement",
  ]) {
    const operation = [...parseOperations(spec).values()].find(
      (candidate) => candidate.operationId === operationId,
    );
    assert.ok(operation, `missing ${operationId}`);
    assert.equal(operation.privateNoStore, true);
    assert.equal(operation.varyOrganisation, true);
    assert.equal(operation.etag, true);
  }
  for (const operationId of [
    "stageEvidenceRenewalReplacement",
    "reviewEvidenceRenewalReplacement",
  ]) {
    const marker = `operationId: ${operationId}`;
    const start = spec.indexOf(marker);
    assert.ok(start >= 0);
    const block = spec.slice(start, spec.indexOf("\n  /", start));
    assert.match(block, /components\/parameters\/IfMatchVersion/u);
    assert.match(block, /x-bidbox-request-body-max-bytes: 65536/u);
    assert.match(block, /^        "428":/mu);
  }
  const plan = schemaBlock(spec, "EvidenceRenewalPlan");
  for (const contract of [
    "internalReminder:",
    "stagedReplacement:",
    "promotionReceiptSha256:",
    "externalMessageSent: { type: boolean, const: false }",
  ]) {
    assert.ok(plan.includes(contract), `renewal plan omits ${contract}`);
  }
  const reminder = schemaBlock(spec, "EvidenceRenewalInternalReminder");
  assert.match(
    reminder,
    /channel: \{ type: string, const: bidbox_evidence_renewal_register \}/u,
  );
  assert.match(reminder, /externalDeliveryReceipt: \{ type: "null" \}/u);
  const staged = schemaBlock(spec, "EvidenceRenewalStagedReplacement");
  for (const contract of [
    "documentVersionId",
    "documentVersionNumber",
    "expectedVaultItemVersion",
  ]) {
    assert.match(staged, new RegExp(`${contract}:`, "u"));
  }
  assert.doesNotMatch(spec, /vault_item_versions/u);
  const review = schemaBlock(spec, "EvidenceRenewalReviewDraft");
  assert.match(
    review,
    /decision: \{ type: string, const: approve \}[\s\S]*?reasonCode: \{ type: string, const: replacement_verified \}/u,
  );
  assert.match(
    review,
    /decision: \{ type: string, const: reject \}[\s\S]*?incorrect_document[\s\S]*?expiry_unacceptable[\s\S]*?quality_issue/u,
  );
  const source = readFileSync(
    resolve(routesRoot, "evidenceRenewal.ts"),
    "utf8",
  );
  assert.match(
    source,
    /EVIDENCE_RENEWAL_BOUNDS\.requestBodyBytes,[\s\S]*?"evidence-renewal"/u,
  );
});

test("project export publishes a mutation-safe exact-confirmation contract", () => {
  const spec = readFileSync(specPath, "utf8");
  const client = readFileSync(generatedClientPath, "utf8");
  const zod = readFileSync(generatedZodPath, "utf8");
  const pathStart = spec.indexOf("\n  /projects/{id}/export:\n");
  const pathEnd = spec.indexOf("\n  /", pathStart + 1);
  assert.ok(pathStart >= 0);
  assert.ok(pathEnd > pathStart);
  const operation = spec.slice(pathStart, pathEnd);
  const clientOperation = generatedBlock(
    client,
    "export const exportProject = async",
  );
  const zodHeader = generatedBlock(zod, "export const ExportProjectHeader");
  const zodBody = generatedBlock(zod, "export const ExportProjectBody");

  assert.match(operation, /^    post:$/mu);
  assert.doesNotMatch(operation, /^    get:$/mu);
  assert.match(
    operation,
    /name: Idempotency-Key[\s\S]*?required: true[\s\S]*?format: uuid/u,
  );
  assert.match(
    operation,
    /name: If-Match[\s\S]*?required: true[\s\S]*?pattern: '\^"\[a-f0-9\]\{64\}"\$'/u,
  );
  assert.match(
    operation,
    /\$ref: "#\/components\/schemas\/ProjectExportRequest"/u,
  );
  assert.match(operation, /^        "409":/mu);

  assert.match(clientOperation, /projectExportRequest: ProjectExportRequest/u);
  assert.match(clientOperation, /idempotencyKey: string/u);
  assert.match(clientOperation, /ifMatch: string/u);
  assert.match(clientOperation, /method: 'POST'/u);
  assert.match(clientOperation, /'Idempotency-Key': idempotencyKey/u);
  assert.match(clientOperation, /'If-Match': ifMatch/u);
  assert.match(
    clientOperation,
    /body: JSON\.stringify\(projectExportRequest\)/u,
  );

  assert.match(zodHeader, /"Idempotency-Key": zod\.string\(\)\.uuid\(\)/u);
  assert.match(zodHeader, /"If-Match": zod\.string\(\)\.regex/u);
  for (const field of [
    "reportId",
    "reportVersion",
    "packageVersionId",
    "packageVersionNumber",
    "packageManifestSha256",
    "packageSourceSnapshotSha256",
  ]) {
    assert.match(zodBody, new RegExp(`"${field}":`, "u"));
  }
});

test("the existing Pursuit Operations and Growth generated contract is preserved", () => {
  const spec = readFileSync(specPath, "utf8");
  const client = readFileSync(generatedClientPath, "utf8");
  for (const operationId of PRESERVED_OPERATIONS_GROWTH_OPERATION_IDS) {
    assert.equal(
      spec.split(`operationId: ${operationId}`).length - 1,
      1,
      `OpenAPI drifted for ${operationId}`,
    );
    assert.ok(
      client.includes(`export const ${operationId}`),
      `generated client drifted for ${operationId}`,
    );
  }
});

test("untrusted durable-worker controls remain unmounted and unpublished", () => {
  const spec = readFileSync(specPath, "utf8");
  const client = readFileSync(generatedClientPath, "utf8");
  const zod = readFileSync(generatedZodPath, "utf8");
  const index = readFileSync(resolve(routesRoot, "index.ts"), "utf8");

  for (const denied of EXCLUDED_CONTROL_PLANE_PATHS) {
    assert.ok(!spec.includes(denied), `OpenAPI published ${denied}`);
    assert.ok(!client.includes(denied), `React client published ${denied}`);
    assert.ok(!zod.includes(denied), `Zod client published ${denied}`);
    assert.ok(!index.includes(denied), `route index mounted ${denied}`);
  }
  assert.ok(!index.includes("durableWorkerFoundationRouter"));
  assert.ok(!index.includes("createDurableWorkerFoundationRouter"));
});
