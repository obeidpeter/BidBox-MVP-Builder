import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

process.env.DATABASE_URL ??=
  "postgresql://test:test@database.test.invalid:5432/bidbox_test";

const {
  AI_RETRIEVAL_REGISTRY_REQUIREMENTS,
  RETRIEVAL_REGISTRY_BLOCKER,
  attestDeployedRetrievalRegistry,
  expectedRegistryEntries,
  registerDeployedRetrievalRegistry,
} = await import("./aiRetrievalRegistry");
const { sha256 } = await import("./aiPromptRegistry");
const { aiRetrievalRegistry, db } = await import("@workspace/db");
const { eq, sql } = await import("drizzle-orm");

const registrySource = readFileSync(
  new URL("./aiRetrievalRegistry.ts", import.meta.url),
  "utf8",
);
const runtimeSource = readFileSync(
  new URL("./aiRuntime.ts", import.meta.url),
  "utf8",
);

const databaseAvailable = await (async () => {
  try {
    await db.execute(sql`SELECT 1`);
    return true;
  } catch {
    return false;
  }
})();

/**
 * Serialises registry-state mutations against the other test files that read
 * the live attestation (aiRuntime.test.ts), so parallel test processes never
 * observe a mid-transition registry.
 */
async function withRegistryStateLock<T>(work: () => Promise<T>): Promise<T> {
  return db.transaction(async (mutex) => {
    await mutex.execute(
      sql`SELECT pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtext('valo_ai_retrieval_registry_state')
      )`,
    );
    return work();
  });
}

describe("deployed retrieval registry", () => {
  test("names every deployment demand with substantive descriptions", () => {
    assert.deepEqual(
      AI_RETRIEVAL_REGISTRY_REQUIREMENTS.map((requirement) => requirement.code),
      [
        "registry_deployment_absent",
        "tenant_isolation_unattested",
        "content_digest_attestation_absent",
        "version_identity_recomputation_absent",
      ],
    );
    for (const requirement of AI_RETRIEVAL_REGISTRY_REQUIREMENTS) {
      assert.ok(
        requirement.description.length > 40,
        `${requirement.code} needs a substantive description`,
      );
    }
  });

  test("the attestation reads no environment, file, or network input", () => {
    assert.doesNotMatch(
      registrySource,
      /process\.env|readFile|readFileSync|fetch\(|require\(/u,
      "Availability must never be assertable from outside the code",
    );
  });

  test("the runtime consumes only the attestation for retrieval identity", () => {
    assert.match(runtimeSource, /attestDeployedRetrievalRegistry\(\)/u);
    assert.doesNotMatch(
      runtimeSource,
      /DEPLOYED_RETRIEVAL_REGISTRY_AVAILABLE|VALO_AI_RETRIEVAL_VERSION|VALO_AI_INDEX_VERSION/u,
      "No boolean constant or operator label may reappear beside the attestation",
    );
  });

  test("derives version identities from content digests, never labels", () => {
    const entries = expectedRegistryEntries();
    assert.deepEqual(
      entries.map((entry) => entry.component),
      ["retrieval", "index"],
    );
    for (const entry of entries) {
      assert.match(entry.contentSha256, /^[a-f0-9]{64}$/);
      assert.equal(sha256(entry.canonicalDefinition), entry.contentSha256);
      const definition = JSON.parse(entry.canonicalDefinition) as {
        family: string;
      };
      assert.equal(
        entry.version,
        `${definition.family}.v1.${entry.contentSha256.slice(0, 16)}`,
        "the version string must be derived from the content digest",
      );
    }
    assert.notEqual(entries[0]?.version, entries[1]?.version);
  });

  test(
    "attests unavailable before registration and available after",
    { skip: !databaseAvailable },
    async () => {
      await withRegistryStateLock(async () => {
        await db.delete(aiRetrievalRegistry);
        const before = await attestDeployedRetrievalRegistry();
        assert.equal(before.available, false);
        if (before.available) return;
        assert.equal(before.blocker, RETRIEVAL_REGISTRY_BLOCKER);
        assert.ok(
          before.unmetRequirements.some(
            (requirement) => requirement.code === "registry_deployment_absent",
          ),
        );

        const first = await registerDeployedRetrievalRegistry();
        assert.equal(first.changed, true);
        const after = await attestDeployedRetrievalRegistry();
        assert.equal(after.available, true);
        if (!after.available) return;
        assert.equal(after.retrievalVersion, first.retrievalVersion);
        assert.equal(after.indexVersion, first.indexVersion);
        assert.match(after.attestationSha256, /^[a-f0-9]{64}$/);

        const second = await registerDeployedRetrievalRegistry();
        assert.equal(second.changed, false, "registration must be idempotent");
        const activeRows = await db
          .select()
          .from(aiRetrievalRegistry)
          .where(eq(aiRetrievalRegistry.status, "active"));
        assert.equal(activeRows.length, 2);
      });
    },
  );

  test(
    "a drifted or relabelled registry row fails the attestation closed",
    { skip: !databaseAvailable },
    async () => {
      await withRegistryStateLock(async () => {
        await db.delete(aiRetrievalRegistry);
        await registerDeployedRetrievalRegistry();
        await db
          .update(aiRetrievalRegistry)
          .set({ version: "operator-authored-label.v1.0000000000000000" })
          .where(eq(aiRetrievalRegistry.component, "retrieval"));
        const tampered = await attestDeployedRetrievalRegistry();
        assert.equal(tampered.available, false);
        if (tampered.available) return;
        assert.ok(
          tampered.unmetRequirements.some(
            (requirement) =>
              requirement.code === "content_digest_attestation_absent",
          ),
          "a relabelled row must fail the content-digest attestation",
        );

        // Re-registration heals the drift by superseding, never deleting.
        const healed = await registerDeployedRetrievalRegistry();
        assert.equal(healed.changed, true);
        const restored = await attestDeployedRetrievalRegistry();
        assert.equal(restored.available, true);
        const lineage = await db
          .select()
          .from(aiRetrievalRegistry)
          .where(eq(aiRetrievalRegistry.component, "retrieval"));
        assert.ok(
          lineage.length >= 2,
          "the superseded identity must remain in the deployment lineage",
        );
        assert.equal(
          lineage.filter((row) => row.status === "active").length,
          1,
        );
        assert.ok(
          lineage.every(
            (row) => (row.status === "active") === (row.supersededAt === null),
          ),
        );
      });
    },
  );
});
