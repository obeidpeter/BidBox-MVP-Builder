import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./intelligence.ts", import.meta.url),
  "utf8",
).replace(/\r\n?/gu, "\n");
const snapshotRouteStart = source.indexOf(
  'router.get(\n  "/projects/:id/intelligence"',
);
const evidenceRouteStart = source.indexOf(
  'router.post(\n  "/projects/:id/intelligence/evidence-search"',
);
const snapshotRouteSource = source.slice(
  snapshotRouteStart,
  evidenceRouteStart,
);
const snapshotSource = readFileSync(
  new URL("../lib/intelligence/snapshot.ts", import.meta.url),
  "utf8",
);
const sourceBindingSource = readFileSync(
  new URL(
    "../lib/intelligence/intelligenceSourceBindingStore.ts",
    import.meta.url,
  ),
  "utf8",
);
const routes = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
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
const reactSchemas = readFileSync(
  new URL(
    "../../../../lib/api-client-react/src/generated/api.schemas.ts",
    import.meta.url,
  ),
  "utf8",
);
const zodClient = readFileSync(
  new URL("../../../../lib/api-zod/src/generated/api.ts", import.meta.url),
  "utf8",
);
const protectedRoutes = readFileSync(
  new URL(
    "../../../bidbox-workbench/src/protected-routes.tsx",
    import.meta.url,
  ),
  "utf8",
);
const platformAccess = readFileSync(
  new URL(
    "../../../bidbox-workbench/src/lib/platform-access.ts",
    import.meta.url,
  ),
  "utf8",
);

test("Intelligence snapshot is tenant-bound, read-only and model-free", () => {
  assert.ok(snapshotRouteStart >= 0 && evidenceRouteStart > snapshotRouteStart);
  assert.match(source, /"\/projects\/:id\/intelligence"/);
  for (const permission of [
    "client:read",
    "project:read",
    "document:read",
    "requirement:read",
    "evidence:read",
    "defect:read",
    "report:read",
    "draft:read",
    "package:read",
    "evaluation:read",
  ]) {
    assert.match(source, new RegExp(`"${permission}"`));
  }
  assert.match(
    source,
    /INTELLIGENCE_READ_PERMISSIONS\.map\(\(permission\)\s*=>\s*requirePermissionOrLegacy\(permission\)/,
  );
  assert.match(source, /loadIntelligenceSourceProjection/);
  assert.match(source, /const snapshot = projection\.snapshot/);
  assert.match(sourceBindingSource, /productionAiEnabled:\s*false/);
  assert.match(source, /Cache-Control", "private, no-store"/);
  assert.doesNotMatch(
    snapshotRouteSource,
    /executeProjectAi|executeAiGatewayRequest/,
  );
  assert.doesNotMatch(snapshotRouteSource, /\.insert\(|\.update\(|\.delete\(/);
  assert.doesNotMatch(snapshotRouteSource, /writeAudit/);
});

test("Intelligence Centre uses bounded source, citation and review projections", () => {
  assert.match(sourceBindingSource, /\.from\(requirementCitations\)/);
  assert.match(sourceBindingSource, /\.innerJoin\(\s*documentVersions/);
  assert.match(sourceBindingSource, /\.innerJoin\(documents/);
  assert.match(sourceBindingSource, /\.leftJoin\(users/);
  assert.match(
    sourceBindingSource,
    /sourceSnippetHash:\s*requirementCitations\.sourceSnippetHash/,
  );
  assert.match(
    sourceBindingSource,
    /verifiedByUserId:\s*requirementCitations\.verifiedByUserId/,
  );
  assert.match(sourceBindingSource, /verifiedByName:\s*users\.name/);
  assert.match(
    sourceBindingSource,
    /verifiedAt:\s*requirementCitations\.verifiedAt/,
  );
  assert.match(
    sourceBindingSource,
    /currentEvidenceApproverIds[\s\S]*verifierAuthority/,
  );
  assert.match(sourceBindingSource, /eq\(documents\.projectId, projectId\)/);
  assert.match(
    sourceBindingSource,
    /eq\(tenders\.reference, project\.tenderRef\)/,
  );
  assert.match(
    sourceBindingSource,
    /eq\(tenders\.organisationId, project\.organisationId\)/,
  );
  assert.match(sourceBindingSource, /sourceDocId:\s*boqChecks\.sourceDocId/);
  assert.match(sourceBindingSource, /version:\s*reports\.version/);
  assert.match(source, /REVIEW_PROJECTION_BOUNDS\.rows \+ 1/);
  assert.match(source, /char_length\(\$\{reviews\.findings\}\)/);
  assert.match(source, /octet_length\(\$\{users\.name\}\)/);
  assert.match(
    source,
    /intelligenceCapabilityFromReviewType[\s\S]*new Set\(reviewCapabilityIds\)/,
  );
  assert.doesNotMatch(snapshotRouteSource, /\.from\(requirementCitations\)/);
  assert.doesNotMatch(snapshotRouteSource, /\.from\(documents\)/);
});

test("public Intelligence citations match the closed OpenAPI DTO and keep proof fields internal", () => {
  const contractStart = openApi.indexOf("    IntelligenceCitation:");
  const contractEnd = openApi.indexOf(
    "    AiModelConfigurationStatus:",
    contractStart,
  );
  const contract = openApi.slice(contractStart, contractEnd);
  const dto = snapshotSource.match(
    /export interface IntelligenceCitationSnapshot \{[\s\S]*?\n\}/,
  )?.[0];

  assert.ok(contractStart >= 0 && contractEnd > contractStart);
  assert.match(contract, /additionalProperties:\s*false/);
  assert.match(contract, /required:\s*\[id, sourceName, locator\]/);
  assert.match(contract, /id:\s*\{ type: string \}/);
  assert.match(contract, /sourceName:\s*\{ type: string \}/);
  assert.match(contract, /locator:\s*\{ type: string \}/);
  assert.match(contract, /excerpt:\s*\{ type: string, maxLength: 280 \}/);
  assert.ok(dto);
  assert.doesNotMatch(
    dto,
    /sourceSnippetHash|sourceVersionSha256|verifiedByUserId|verifiedByName|verifiedAt|malwareStatus|quarantineStatus|lifecycleState/,
  );
});

test("preflight recognizes only signed terminal package states", () => {
  assert.match(
    snapshotSource,
    /FINAL_PACKAGE_STATES = new Set\(\["signed"\]\)/,
  );
  assert.match(snapshotSource, /FINAL_PACKAGE_STATES\.has\(item\.status\)/);
});

test("Intelligence Centre is registered only after tenant middleware", () => {
  const databaseBoundary = routes.indexOf("router.use(attachTenantDatabase)");
  const intelligenceRoute = routes.indexOf("router.use(intelligenceRouter)");
  assert.ok(databaseBoundary >= 0);
  assert.ok(intelligenceRoute > databaseBoundary);
});

test("Intelligence Centre OpenAPI, generated clients and protected UI stay connected", () => {
  const operationStart = openApi.indexOf("  /projects/{id}/intelligence:");
  const operationEnd = openApi.indexOf(
    "  /projects/{id}/intelligence/evidence-search:",
    operationStart,
  );
  const operation = openApi.slice(operationStart, operationEnd);

  assert.ok(operationStart >= 0 && operationEnd > operationStart);
  assert.match(openApi, /^  \/projects\/\{id\}\/intelligence:/m);
  assert.match(openApi, /operationId: getProjectIntelligence/);
  assert.match(
    operation,
    /"409":\s*\n\s*\$ref: "#\/components\/responses\/Conflict"/,
  );
  assert.match(openApi, /minItems: 22[\s\S]*maxItems: 22/);
  assert.match(reactClient, /export function useGetProjectIntelligence/);
  assert.match(
    reactClient,
    /GetProjectIntelligenceQueryError = ErrorType<[^>]*ConflictResponse/,
  );
  assert.match(zodClient, /export const GetProjectIntelligenceResponse/);
  assert.match(protectedRoutes, /path="\/intelligence"/);
  assert.match(
    protectedRoutes,
    /path="\/intelligence"[\s\S]*RequireArea area="pursuit_workbench"/,
  );
  assert.match(platformAccess, /href: "\/intelligence"/);
  assert.match(platformAccess, /label: "Bid insights"/);
});

test("evidence search preserves the no-instruction-authority marker across every contract layer", () => {
  const contractStart = openApi.indexOf("    IntelligenceEvidenceSearchMatch:");
  const contractEnd = openApi.indexOf(
    "    IntelligenceEvidenceSearchResponse:",
    contractStart,
  );
  const contract = openApi.slice(contractStart, contractEnd);

  assert.ok(contractStart >= 0 && contractEnd > contractStart);
  assert.match(
    source,
    /instructionAuthority:\s*match\.source\.instructionAuthority/,
  );
  assert.match(contract, /- instructionAuthority/);
  assert.match(
    contract,
    /instructionAuthority:\s*\n\s*type: string\s*\n\s*enum: \[none\]/,
  );
  assert.match(
    reactSchemas,
    /instructionAuthority: IntelligenceEvidenceSearchMatchInstructionAuthority/,
  );
  assert.match(zodClient, /"instructionAuthority": zod\.enum\(\['none'\]\)/);
});
