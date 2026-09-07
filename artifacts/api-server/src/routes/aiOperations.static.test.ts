import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./aiOperations.ts", import.meta.url),
  "utf8",
);
const consoleSource = readFileSync(
  new URL(
    "../../../bidbox-workbench/src/pages/operations-console.tsx",
    import.meta.url,
  ),
  "utf8",
);
const openApiSource = readFileSync(
  new URL("../../../../lib/api-spec/openapi.yaml", import.meta.url),
  "utf8",
);

test("AI operations is permission-checked and scopes both telemetry queries to the active tenant", () => {
  assert.match(source, /requireInternalAiOperations/);
  assert.match(source, /context\?\.source === "membership"/);
  assert.match(source, /context\.permissions\.has\("evaluation:read"\)/);
  assert.doesNotMatch(source, /requirePermissionOrLegacy/);
  assert.match(source, /getOrganisationId\(req\)/);
  assert.equal(
    (source.match(/eq\([^,]+\.organisationId, organisationId\)/g) ?? []).length,
    2,
  );
});

test("AI operations exposes only sanitised run telemetry", () => {
  assert.match(source, /AI_LEGACY_ERROR_REDACTED/);
  assert.match(source, /safeErrorCodes\.has\(run\.error\)/);
  assert.doesNotMatch(source, /outputSummary:\s*llmRuns\.outputSummary/);
  assert.doesNotMatch(source, /inputHash:\s*llmRuns\.inputHash/);
  assert.doesNotMatch(source, /providerRequestId/);
  assert.doesNotMatch(source, /metrics:\s*evaluationRuns\.metrics/);
  assert.doesNotMatch(source, /limitations:\s*evaluationRuns\.limitations/);
});

test("AI operations preserves the production release gate and default-off controls", () => {
  assert.match(source, /configuredAiReleaseGateStatus\(runtime\)/);
  assert.match(source, /AI_RELEASE_GATE_DENIED/);
  assert.match(source, /AI_BUDGET_EXCEEDED/);
  assert.match(source, /AI_BUDGET_CURRENCY_MISMATCH/);
  assert.match(source, /aiOperationsBudgetBlocker\(runtime\.budget\)/);
  assert.match(source, /maximumCapabilityReservationMinor/);
  assert.match(source, /budgetReservationFits/);
  assert.match(source, /runtime\.globalKillSwitchEngaged/);
  assert.match(source, /productionCapabilityEnvironmentKey/);
  assert.match(source, /`ai_\$\{policy\.id\}`/);
  assert.match(source, /restrictedModeEligible === true/);
  assert.match(source, /restrictedModeSupported/);
  assert.match(source, /adapter\.descriptor\.mode !== "production"/);
  assert.match(source, /adapter\.descriptor\.productionApproved !== true/);
  assert.match(
    source,
    /activationGatesOpen && executionBlockers\.length === 0/,
  );
});

test("the operations console uses the generated hook and distinguishes unavailable from empty telemetry", () => {
  assert.match(consoleSource, /useGetAiOperations\(\)/);
  assert.match(consoleSource, /AI service status could not be loaded/);
  assert.match(consoleSource, /No AI runs are recorded for this organisation/);
  assert.match(
    consoleSource,
    /No evaluation runs are recorded for this organisation/,
  );
  assert.match(consoleSource, /releaseGate\.expectedVersions/);
  assert.doesNotMatch(consoleSource, /capability\.promptHash/);
  assert.doesNotMatch(consoleSource, /capability\.schemaHash/);
});

test("OpenAPI assigns bounded AI errors only to the four directly surfaced model workflows", () => {
  assert.match(openApiSource, /^  \/ai\/operations:/m);
  assert.equal(
    (openApiSource.match(/responses\/AiInputRejected/g) ?? []).length,
    4,
  );
  for (const path of [
    "extract-requirements",
    "map-evidence",
    "suggest-defects",
    "responsiveness-review",
  ]) {
    const pathStart = openApiSource.indexOf(`/projects/{id}/${path}:`);
    assert.ok(pathStart >= 0, `missing ${path} OpenAPI path`);
    const nextPath = openApiSource.indexOf("\n  /", pathStart + 1);
    const operation = openApiSource.slice(
      pathStart,
      nextPath < 0 ? undefined : nextPath,
    );
    for (const status of ['"422"', '"429"', '"502"', '"503"']) {
      assert.match(operation, new RegExp(status));
    }
    for (const status of [
      '"400"',
      '"401"',
      '"403"',
      '"404"',
      '"409"',
      '"500"',
    ]) {
      assert.match(operation, new RegExp(status));
    }
  }
  assert.match(
    openApiSource,
    /required: \[applicable, allowed, blockerCodes, expectedVersions\]/,
  );
  assert.match(openApiSource, /restrictedModeSupported/);
  assert.match(openApiSource, /AI_BUDGET_EXCEEDED/);
  assert.match(openApiSource, /AI_BUDGET_CURRENCY_MISMATCH/);
});
