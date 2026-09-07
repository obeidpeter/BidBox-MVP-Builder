import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  lockCompatibleAdvisoryKey,
  type StableAdvisoryLockKey,
} from "./compatibleAdvisoryLock";

const dialect = new PgDialect();
const families = [
  [
    "valo.membership-administration:org",
    "bidbox.membership-administration:org",
  ],
  [
    "valo.document-snapshot-series:org:project:source",
    "bidbox.document-snapshot-series:org:project:source",
  ],
  ["valo.tender-context:org:project", "bidbox.tender-context:org:project"],
  [
    "valo:canonical-evidence:org:sha256",
    "bidbox:canonical-evidence:org:sha256",
  ],
  ["valo-worker:org:capability", "bidbox-worker:org:capability"],
] as const satisfies readonly (readonly [StableAdvisoryLockKey, string])[];

test("every shared resource locks the pre-rename identity before its transitional alias", async () => {
  for (const [stable, transitional] of families) {
    const seen: unknown[][] = [];
    await lockCompatibleAdvisoryKey(
      {
        async execute(query) {
          const compiled = dialect.sqlToQuery(query);
          assert.equal(
            compiled.sql.replace(/\s+/gu, " ").trim(),
            "SELECT pg_catalog.pg_advisory_xact_lock( pg_catalog.hashtextextended($1, 0) )",
          );
          seen.push(compiled.params);
        },
      },
      stable,
    );
    assert.deepEqual(seen, [[stable], [transitional]]);
  }
});

test("a wait on either release's lock blocks entry to the protected work", async () => {
  for (const blockedIndex of [0, 1]) {
    let unblock!: () => void;
    let markWaiting!: () => void;
    const released = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    const waiting = new Promise<void>((resolve) => {
      markWaiting = resolve;
    });
    const seen: string[] = [];
    let workStarted = false;
    const operation = lockCompatibleAdvisoryKey(
      {
        async execute(query) {
          seen.push(String(dialect.sqlToQuery(query).params[0]));
          if (seen.length - 1 === blockedIndex) {
            markWaiting();
            await released;
          }
        },
      },
      families[0][0],
    ).then(() => {
      workStarted = true;
    });
    await waiting;
    assert.equal(workStarted, false);
    assert.equal(seen.length, blockedIndex + 1);
    unblock();
    await operation;
    assert.equal(workStarted, true);
    assert.deepEqual(seen, families[0]);
  }
});

test("failure to acquire either release's lock propagates without entering protected work", async () => {
  for (const failingIndex of [0, 1]) {
    let calls = 0;
    const failure = new Error("lock timeout");
    await assert.rejects(
      lockCompatibleAdvisoryKey(
        {
          async execute() {
            if (calls++ === failingIndex) throw failure;
          },
        },
        families[0][0],
      ),
      (error) => error === failure,
    );
    assert.equal(calls, failingIndex + 1);
  }
});

// These templates define a cross-release protocol. A product rename must not
// update this baseline: Valo and the first BidBox release still use these keys.
const sourceContracts = [
  [
    "./directMembershipAuthority.ts",
    [
      "valo.membership-administration:${context.organisationId}",
      "valo.membership-administration:${context.membershipOrganisationId}",
    ],
  ],
  [
    "../routes/organisations.ts",
    ["valo.membership-administration:${organisationId}"],
  ],
  [
    "./projectReviewerAuthority.ts",
    ["valo.membership-administration:${organisationId}"],
  ],
  [
    "./documentVersionSnapshotRepository.ts",
    [
      "valo.membership-administration:${actor.organisationId}",
      "valo.document-snapshot-series:${organisationId}:${projectId}:${sourceId}",
    ],
  ],
  [
    "./evidenceRenewal/repository.ts",
    ["valo.membership-administration:${organisationId}"],
  ],
  [
    "./intelligence/addendumImpactDrizzleRepository.ts",
    [
      "valo.membership-administration:${scope.organisationId}",
      "valo.document-snapshot-series:${scope.organisationId}:${projectId}:${sourceId}",
    ],
  ],
  [
    "./intelligence/tenderContextDrizzleRepository.ts",
    [
      "valo.membership-administration:${scope.organisationId}",
      "valo.tender-context:${scope.organisationId}:${projectId}",
    ],
  ],
  [
    "./opportunityPursuitHandoff/auditRepository.ts",
    ["valo.membership-administration:${organisationId}"],
  ],
  [
    "./opportunitySourceNetwork/auditRepository.ts",
    ["valo.membership-administration:${organisationId}"],
  ],
  [
    "./privacyOperationsCentre/repository.ts",
    ["valo.membership-administration:${organisationId}"],
  ],
  [
    "./canonicalEvidence.ts",
    ["valo:canonical-evidence:${organisationId}:${sha256}"],
  ],
  [
    "./durableWorkerFoundation.ts",
    ["valo-worker:${organisationId}:${capability}"],
  ],
] as const;

test("all resource consumers preserve the historical key and acquire compatible locks", () => {
  for (const [path, templates] of sourceContracts) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.match(source, /await lockCompatibleAdvisoryKey\(/u, path);
    for (const template of templates) {
      assert.ok(
        source.includes("`" + template + "`"),
        `${path}: missing historical key ${template}`,
      );
    }
    assert.doesNotMatch(
      source,
      /`bidbox[.:-](?:membership-administration|document-snapshot-series|tender-context|canonical-evidence|worker):/u,
      path,
    );
  }
});
