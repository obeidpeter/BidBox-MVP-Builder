import assert from "node:assert/strict";
import test from "node:test";
import { AI_PROMPT_REGISTRY, canonicalJson, sha256 } from "./aiPromptRegistry";

process.env.DATABASE_URL ??=
  "postgresql://test:test@database.test.invalid:5432/bidbox_test";

const {
  configuredAiExpectedVersions,
  configuredAiReleaseGateStatus,
  configuredAiReleaseRuntimeMismatchCodes,
  configuredAiRuntime,
} = await import("./aiRuntime");
const { attestDeployedRetrievalRegistry } =
  await import("./aiRetrievalRegistry");
const { db } = await import("@workspace/db");
const { sql } = await import("drizzle-orm");

const databaseAvailable = await (async () => {
  try {
    await db.execute(sql`SELECT 1`);
    return true;
  } catch {
    return false;
  }
})();

/**
 * Serialises reads of the live registry attestation against the state
 * transitions performed by aiRetrievalRegistry.test.ts, so parallel test
 * processes never observe a mid-transition registry. Without a reachable
 * database the attestation is statically fail-closed and needs no lock.
 */
async function withRegistryStateLock<T>(work: () => Promise<T>): Promise<T> {
  if (!databaseAvailable) return work();
  return db.transaction(async (mutex) => {
    await mutex.execute(
      sql`SELECT pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtext('bidbox_ai_retrieval_registry_state')
      )`,
    );
    return work();
  });
}

test("production runtime is disabled without explicit activation and approvals", async () => {
  const runtime = configuredAiRuntime({ NODE_ENV: "production" });
  assert.equal(runtime.globalKillSwitchEngaged, true);
  assert.equal(runtime.modelConfiguration.configurationVersion, "");
  assert.equal(runtime.modelConfiguration.status, "draft");
  assert.equal(runtime.modelConfiguration.evaluationApproved, false);
  assert.equal(runtime.budget, null);
  assert.equal(runtime.providerPolicy.requiredRegion, "");
  assert.equal(runtime.providerPolicy.maxRetentionDays, -1);
  // Retrieval and index identities come only from the live deployed-registry
  // attestation, so the expectation is derived from that attestation rather
  // than assuming a particular database state.
  const { registry, versions, gateStatus } = await withRegistryStateLock(
    async () => ({
      registry: await attestDeployedRetrievalRegistry(),
      versions: await configuredAiExpectedVersions(runtime, {}),
      gateStatus: await configuredAiReleaseGateStatus(runtime, {}),
    }),
  );
  assert.deepEqual(versions, {
    model: "gpt-5.4",
    modelConfiguration: "",
    prompt: "ai-foundation-v1",
    promptRegistry: versions.promptRegistry,
    schema: versions.schema,
    retrieval: registry.available ? registry.retrievalVersion : "",
    index: registry.available ? registry.indexVersion : "",
  });
  assert.match(versions.schema, /^[a-f0-9]{64}$/);
  assert.match(versions.promptRegistry, /^[a-f0-9]{64}$/);
  assert.equal(
    versions.promptRegistry,
    sha256(
      canonicalJson(
        Object.fromEntries(
          Object.entries(AI_PROMPT_REGISTRY).map(([capability, definition]) => [
            capability,
            {
              promptVersion: definition.promptVersion,
              promptHash: definition.promptHash,
            },
          ]),
        ),
      ),
    ),
  );
  assert.equal(
    versions.schema,
    sha256(
      canonicalJson(
        Object.fromEntries(
          Object.entries(AI_PROMPT_REGISTRY).map(([capability, definition]) => [
            capability,
            {
              schemaVersion: definition.schemaVersion,
              schemaHash: definition.schemaHash,
            },
          ]),
        ),
      ),
    ),
  );
  assert.deepEqual(gateStatus, {
    applicable: true,
    allowed: false,
    blockerCodes: registry.available
      ? ["release_evidence_missing"]
      : ["release_evidence_missing", "retrieval_registry_unavailable"],
  });
});

test("operator-authored retrieval labels cannot influence registry identity", async () => {
  const runtime = configuredAiRuntime({ NODE_ENV: "production" });
  const variables = {
    VALO_AI_RETRIEVAL_VERSION: "invented-retrieval-v99",
    VALO_AI_INDEX_VERSION: "invented-index-v99",
  };
  await withRegistryStateLock(async () => {
    const labelled = await configuredAiExpectedVersions(runtime, variables);
    assert.deepEqual(labelled, await configuredAiExpectedVersions(runtime, {}));
    assert.notEqual(labelled.retrieval, "invented-retrieval-v99");
    assert.notEqual(labelled.index, "invented-index-v99");
    const registry = await attestDeployedRetrievalRegistry();
    const status = await configuredAiReleaseGateStatus(runtime, variables);
    assert.equal(
      status.blockerCodes.includes("retrieval_registry_unavailable"),
      !registry.available,
      "the registry blocker must reflect only the live attestation, never labels",
    );
  });
});

test("runtime accepts only complete, integer, explicitly approved budget evidence", () => {
  const complete = configuredAiRuntime({
    NODE_ENV: "production",
    VALO_AI_GLOBAL_ENABLED: "true",
    VALO_AI_MODEL_ID: "approved-model",
    VALO_AI_MODEL_CONFIGURATION_VERSION: "model-config-v4",
    VALO_AI_MODEL_STATUS: "promoted",
    VALO_AI_MODEL_EVALUATION_APPROVED: "true",
    VALO_AI_BUDGET_APPROVED: "true",
    VALO_AI_BUDGET_CURRENCY: "NGN",
    VALO_AI_APPROVED_BUDGET_REMAINING_MINOR: "200000",
    VALO_AI_INPUT_COST_MINOR_PER_1K_TOKENS: "12",
    VALO_AI_OUTPUT_COST_MINOR_PER_1K_TOKENS: "30",
    VALO_AI_RATE_CARD_VERSION: "rate-card-2026-08",
    VALO_AI_REQUIRED_REGION: "ng",
    VALO_AI_REQUIRE_ZERO_RETENTION: "true",
    VALO_AI_MAX_RETENTION_DAYS: "0",
  });
  assert.equal(complete.globalKillSwitchEngaged, false);
  assert.deepEqual(complete.budget, {
    approved: true,
    currency: "NGN",
    remainingMinor: 200000,
    inputCostMinorPerThousandTokens: 12,
    outputCostMinorPerThousandTokens: 30,
    rateCardVersion: "rate-card-2026-08",
  });
  assert.deepEqual(complete.providerPolicy, {
    requiredRegion: "ng",
    requireZeroRetention: true,
    maxRetentionDays: 0,
  });
  assert.deepEqual(complete.modelConfiguration, {
    model: "approved-model",
    configurationVersion: "model-config-v4",
    status: "promoted",
    evaluationApproved: true,
  });

  const malformed = configuredAiRuntime({
    NODE_ENV: "test",
    VALO_AI_BUDGET_APPROVED: "true",
    VALO_AI_BUDGET_CURRENCY: "NGN",
    VALO_AI_APPROVED_BUDGET_REMAINING_MINOR: "1.5",
    VALO_AI_INPUT_COST_MINOR_PER_1K_TOKENS: "12",
    VALO_AI_OUTPUT_COST_MINOR_PER_1K_TOKENS: "30",
    VALO_AI_RATE_CARD_VERSION: "rate-card",
  });
  assert.equal(malformed.budget, null);
  const zeroRate = configuredAiRuntime({
    NODE_ENV: "test",
    VALO_AI_BUDGET_APPROVED: "true",
    VALO_AI_BUDGET_CURRENCY: "NGN",
    VALO_AI_APPROVED_BUDGET_REMAINING_MINOR: "1000",
    VALO_AI_INPUT_COST_MINOR_PER_1K_TOKENS: "0",
    VALO_AI_OUTPUT_COST_MINOR_PER_1K_TOKENS: "30",
    VALO_AI_RATE_CARD_VERSION: "rate-card",
  });
  assert.equal(zeroRate.budget, null);
  for (const currency of [undefined, "", "USD", "ngn"]) {
    const variables: NodeJS.ProcessEnv = {
      NODE_ENV: "test",
      VALO_AI_BUDGET_APPROVED: "true",
      VALO_AI_APPROVED_BUDGET_REMAINING_MINOR: "1000",
      VALO_AI_INPUT_COST_MINOR_PER_1K_TOKENS: "12",
      VALO_AI_OUTPUT_COST_MINOR_PER_1K_TOKENS: "30",
      VALO_AI_RATE_CARD_VERSION: "rate-card",
    };
    if (currency !== undefined) variables.VALO_AI_BUDGET_CURRENCY = currency;
    assert.equal(configuredAiRuntime(variables).budget, null);
  }
});

test("development is not globally enabled when the emergency switch is set", async () => {
  const runtime = configuredAiRuntime({
    NODE_ENV: "development",
    VALO_AI_KILL_SWITCH: "true",
  });
  assert.equal(runtime.globalKillSwitchEngaged, true);
  assert.deepEqual(await configuredAiReleaseGateStatus(runtime, {}), {
    applicable: false,
    allowed: false,
    blockerCodes: [],
  });
});

test("unknown or missing NODE_ENV fails closed as production", async () => {
  for (const value of [undefined, "prodution", "staging"]) {
    const runtime = configuredAiRuntime(
      value === undefined ? {} : { NODE_ENV: value },
    );
    assert.equal(runtime.environment, "production");
    assert.equal(runtime.globalKillSwitchEngaged, true);
    assert.equal(
      (await configuredAiReleaseGateStatus(runtime, {})).applicable,
      true,
    );
  }
});

test("release decisions must match the configured provider and rate card", () => {
  const variables = {
    NODE_ENV: "production",
    VALO_AI_BUDGET_APPROVED: "true",
    VALO_AI_BUDGET_CURRENCY: "NGN",
    VALO_AI_APPROVED_BUDGET_REMAINING_MINOR: "500000",
    VALO_AI_INPUT_COST_MINOR_PER_1K_TOKENS: "12",
    VALO_AI_OUTPUT_COST_MINOR_PER_1K_TOKENS: "30",
    VALO_AI_RATE_CARD_VERSION: "rate-card-v1",
    VALO_AI_REQUIRED_REGION: "ng",
    VALO_AI_REQUIRE_ZERO_RETENTION: "true",
    VALO_AI_MAX_RETENTION_DAYS: "0",
    AI_INTEGRATIONS_OPENAI_BASE_URL: "https://approved.example.invalid/v1",
    OPENAI_ADAPTER_APPROVED_BASE_URL: "https://approved.example.invalid/v1",
    OPENAI_ADAPTER_NO_TRAINING_VERIFIED: "true",
    OPENAI_ADAPTER_DPA_APPROVED: "true",
    OPENAI_ADAPTER_RETENTION_MODE: "zero",
    OPENAI_ADAPTER_APPROVED_REGIONS: "ng",
    OPENAI_ADAPTER_GOVERNANCE_EVIDENCE_VERSION: "governance-v1",
  } satisfies NodeJS.ProcessEnv;
  const runtime = configuredAiRuntime(variables);
  const evidence = {
    provider: {
      approved: true,
      provider: "openai",
      region: "ng",
      modelAllowlist: [runtime.modelConfiguration.model],
      trainingUseDisabled: true,
      retentionDays: 0,
      approvalReference: "provider-approval-v1",
    },
    budget: {
      approved: true,
      currency: "NGN",
      maxCostPerRunMinor: 500_000,
      maxMonthlyCostMinor: 1_000_000,
      maxInputTokens: 60_000_000,
      maxOutputTokens: 8_192,
      maxLatencyMs: 60_000,
      rateCardVersion: "rate-card-v1",
      inputCostMinorPerThousandTokens: 12,
      outputCostMinorPerThousandTokens: 30,
      approvalReference: "budget-approval-v1",
    },
  };
  assert.deepEqual(
    configuredAiReleaseRuntimeMismatchCodes(runtime, evidence, variables),
    [],
  );
  assert.deepEqual(
    configuredAiReleaseRuntimeMismatchCodes(
      runtime,
      {
        ...evidence,
        provider: { ...evidence.provider, provider: "unapproved-proxy" },
        budget: { ...evidence.budget, rateCardVersion: "stale-rate-card" },
      },
      variables,
    ),
    ["provider_runtime_mismatch", "budget_runtime_mismatch"],
  );
});
