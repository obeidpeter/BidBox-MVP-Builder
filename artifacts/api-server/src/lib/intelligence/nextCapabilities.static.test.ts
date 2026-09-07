import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { INTELLIGENCE_CAPABILITY_IDS } from "./snapshot";

const openApi = readFileSync(
  new URL("../../../../../lib/api-spec/openapi.yaml", import.meta.url),
  "utf8",
);
const generated = readFileSync(
  new URL(
    "../../../../../lib/api-client-react/src/generated/api.schemas.ts",
    import.meta.url,
  ),
  "utf8",
);
const generatedReactApi = readFileSync(
  new URL(
    "../../../../../lib/api-client-react/src/generated/api.ts",
    import.meta.url,
  ),
  "utf8",
);
const generatedZodApi = readFileSync(
  new URL("../../../../../lib/api-zod/src/generated/api.ts", import.meta.url),
  "utf8",
);
const generatedZodType = readFileSync(
  new URL(
    "../../../../../lib/api-zod/src/generated/types/intelligenceCapabilitySnapshotId.ts",
    import.meta.url,
  ),
  "utf8",
);
const uiContract = readFileSync(
  new URL(
    "../../../../bidbox-workbench/src/components/intelligence/intelligence-contract.ts",
    import.meta.url,
  ),
  "utf8",
);
const barrel = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

const ADVANCED_CAPABILITIES = [
  ["evaluation_score_planner", "evaluationScorePlanner", 1],
  ["bid_security_integrity", "bidSecurityIntegrity", 1],
  ["regulatory_watchtower", "regulatoryWatchtower", 1],
  ["consortium_responsibility", "consortiumResponsibility", 2],
  ["portal_submission_rehearsal", "portalSubmissionRehearsal", 1],
  ["commercial_exposure", "commercialExposure", 1],
  ["nigerian_content_composer", "nigerianContentComposer", 2],
  ["personnel_tailoring", "personnelTailoring", 2],
  ["contract_deviation", "contractDeviation", 1],
  ["critical_path_simulator", "criticalPathSimulator", 1],
  ["integrity_sentinel", "integritySentinel", 1],
  ["outcome_learning", "outcomeLearning", 2],
] as const;

const EXPECTED_CAPABILITIES = [
  "evidence_graph",
  "addendum_radar",
  "eligibility_passport",
  "grounded_copilot",
  "opportunity_radar",
  "response_studio",
  "submission_preflight",
  "clarification_assistant",
  "boq_sanity",
  "award_handoff",
  ...ADVANCED_CAPABILITIES.map(([id]) => id),
] as const;

function requireMatch(source: string, pattern: RegExp, label: string): string {
  const match = source.match(pattern)?.[1];
  assert.ok(match, `${label} block must be present`);
  return match;
}

function quotedValues(block: string): string[] {
  return [...block.matchAll(/["']([a-z][a-z0-9_]*)["']/gu)].map(
    (match) => match[1]!,
  );
}

test("all twenty-two capability IDs have exact, unique and ordered contract parity", () => {
  assert.deepEqual(INTELLIGENCE_CAPABILITY_IDS, EXPECTED_CAPABILITIES);
  assert.equal(new Set(INTELLIGENCE_CAPABILITY_IDS).size, 22);
  assert.match(
    requireMatch(
      openApi,
      /IntelligenceCentreSnapshot:\s*([\s\S]*?)\n\s+IntelligenceProjectSummary:/u,
      "OpenAPI Intelligence Centre snapshot",
    ),
    /capabilities:\s*[\s\S]*?minItems: 22\s*[\s\S]*?maxItems: 22/u,
  );
  assert.match(generatedReactApi, /projections for twenty-two/u);
  assert.match(generatedZodApi, /projections for twenty-two/u);
  assert.doesNotMatch(generatedReactApi, /projections for the ten/u);
  assert.doesNotMatch(generatedZodApi, /projections for the ten/u);

  const openApiIds = requireMatch(
    openApi,
    /IntelligenceCapabilitySnapshot:\s*[\s\S]*?\n\s+id:\s*[\s\S]*?\n\s+enum:\s*([\s\S]*?)\n\s+state:/u,
    "OpenAPI capability enum",
  )
    .split(/\r?\n/u)
    .map((line) => line.match(/^\s*-\s+([a-z][a-z0-9_]*)\s*$/u)?.[1])
    .filter((id): id is string => Boolean(id));
  const reactIds = requireMatch(
    generated,
    /export const IntelligenceCapabilitySnapshotId = \{([\s\S]*?)\} as const;/u,
    "React capability enum",
  )
    .split(/\r?\n/u)
    .map((line) => line.match(/^\s*([a-z][a-z0-9_]*):/u)?.[1])
    .filter((id): id is string => Boolean(id));
  const zodIds = requireMatch(
    generatedZodType,
    /export const IntelligenceCapabilitySnapshotId = \{([\s\S]*?)\} as const;/u,
    "Zod capability enum",
  )
    .split(/\r?\n/u)
    .map((line) => line.match(/^\s*([a-z][a-z0-9_]*):/u)?.[1])
    .filter((id): id is string => Boolean(id));
  const zodResponseIds = quotedValues(
    requireMatch(
      generatedZodApi,
      /export const GetProjectIntelligenceResponse = zod\.object\(\{[\s\S]*?"capabilities": zod\.array\(zod\.object\(\{[\s\S]*?"id": zod\.enum\(\[([\s\S]*?)\]\)/u,
      "Zod response capability enum",
    ),
  );
  const uiTypeIds = quotedValues(
    requireMatch(
      uiContract,
      /export type IntelligenceCapabilityId =([\s\S]*?);/u,
      "UI capability union",
    ),
  );
  const uiCatalogIds = [
    ...requireMatch(
      uiContract,
      /INTELLIGENCE_CAPABILITY_CATALOG:[\s\S]*?=\s*\[([\s\S]*?)\]\s+as const;/u,
      "UI capability catalog",
    ).matchAll(/\bid:\s*"([a-z][a-z0-9_]*)"/gu),
  ].map((match) => match[1]!);

  for (const actual of [
    openApiIds,
    reactIds,
    zodIds,
    zodResponseIds,
    uiTypeIds,
    uiCatalogIds,
  ]) {
    assert.deepEqual(actual, EXPECTED_CAPABILITIES);
    assert.equal(new Set(actual).size, EXPECTED_CAPABILITIES.length);
  }
});

test("every advanced engine is exported and its safety ceiling matches the UI", () => {
  for (const [id, moduleName, targetLevel] of ADVANCED_CAPABILITIES) {
    assert.match(barrel, new RegExp(`export \\* from "\\./${moduleName}"`));
    const moduleSource = readFileSync(
      new URL(`./${moduleName}.ts`, import.meta.url),
      "utf8",
    );
    assert.match(
      moduleSource,
      targetLevel === 2
        ? /safety:\s*nextCapabilitySafety\(2\)/u
        : /safety:\s*nextCapabilitySafety\(\)/u,
    );
    assert.match(
      uiContract,
      new RegExp(`id: "${id}"[\\s\\S]{0,500}?level: ${targetLevel}`),
    );
  }
});
