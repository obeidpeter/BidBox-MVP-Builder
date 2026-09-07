import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, before, describe, test } from "node:test";
import express from "express";
import type { OrganisationRole, Permission } from "../lib/permissions";
import type { AccessContext } from "../middlewares/tenancy";
import type {
  ProductionAcceptanceEvidenceRecord,
  ProductionAcceptanceRepository,
} from "../lib/productionAcceptance/contracts";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??=
  "postgresql://bidbox_test:bidbox_test@127.0.0.1:1/bidbox_acceptance_test";

const { createProductionAcceptanceRouter } =
  await import("./productionAcceptance");

const ORGANISATION_ID = "11111111-1111-4111-8111-111111111111";
const VERIFIER_USER_ID = "22222222-2222-4222-8222-222222222222";
const OWNER_USER_ID = "33333333-3333-4333-8333-333333333333";
const RELEASE_SHA = "a".repeat(64);
const NOW = new Date("2026-08-11T10:00:00.000Z");

function access(
  roles: readonly OrganisationRole[],
  permissions: readonly Permission[],
  source: AccessContext["source"] = "membership",
): AccessContext {
  return {
    organisationId: ORGANISATION_ID,
    membershipId:
      source === "membership" ? "44444444-4444-4444-8444-444444444444" : null,
    membershipOrganisationId: source === "membership" ? ORGANISATION_ID : null,
    source,
    roles,
    permissions: new Set(permissions),
    breakGlassSessionId:
      source === "break_glass" ? "55555555-5555-4555-8555-555555555555" : null,
    partnerRelationshipId:
      source === "partner" ? "66666666-6666-4666-8666-666666666666" : null,
    partnerCoSigningRequired: false,
  };
}

function evidenceBody(overrides: Record<string, unknown> = {}) {
  return {
    category: "migration",
    outcome: "passed",
    environment: "recovery_rehearsal",
    releaseSha256: RELEASE_SHA,
    ownerUserId: OWNER_USER_ID,
    observedAt: "2026-08-11T09:00:00.000Z",
    expiresAt: "2026-08-25T09:00:00.000Z",
    evidenceReference: "private/migration/rehearsal-42",
    artifactSha256: "b".repeat(64),
    summary: "PostgreSQL 16 migration rehearsal completed on synthetic data.",
    idempotencyKey: "acceptance-migration-0001",
    ...overrides,
  };
}

describe("production acceptance route factory", () => {
  let server: Server;
  let origin: string;
  let currentAccess = access(
    ["valo_operations_administrator"],
    ["audit:read", "configuration:manage"],
  );
  let currentActor = VERIFIER_USER_ID;
  let currentNow = NOW;

  before(async () => {
    const evidence: ProductionAcceptanceEvidenceRecord[] = [];
    const byIdempotencyKey = new Map<
      string,
      { requestDigest: string; record: ProductionAcceptanceEvidenceRecord }
    >();
    const repository: ProductionAcceptanceRepository = {
      listAuthorities: async () => [
        { userId: OWNER_USER_ID, name: "Migration Owner" },
      ],
      listEvidence: async (scope, limit) =>
        evidence
          .filter(
            ({ organisationId }) => organisationId === scope.organisationId,
          )
          .slice(0, limit),
      appendEvidence: async (scope, idempotencyKey, requestDigest, record) => {
        const existing = byIdempotencyKey.get(idempotencyKey);
        if (existing) {
          return existing.requestDigest === requestDigest
            ? { outcome: "replayed", record: existing.record }
            : { outcome: "idempotency_conflict" };
        }
        assert.equal(record.organisationId, scope.organisationId);
        byIdempotencyKey.set(idempotencyKey, { requestDigest, record });
        evidence.push(record);
        return { outcome: "appended", record };
      },
    };

    const app = express();
    app.use(express.json());
    app.use(
      "/api",
      createProductionAcceptanceRouter({
        repository,
        now: () => currentNow,
        currentReleaseSha256: () => RELEASE_SHA,
        resolveAccess: () => currentAccess,
        resolveActorUserId: () => currentActor,
      }),
    );
    server = createServer(app);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    assert(address && typeof address !== "string");
    origin = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  test("returns a private fail-closed snapshot for authorised internal readers", async () => {
    const response = await fetch(`${origin}/api/production-acceptance`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.match(
      response.headers.get("vary") ?? "",
      /X-BidBox-Organisation-Id/u,
    );
    const body = (await response.json()) as {
      recommendedDecision: string;
      deploymentAuthorized: boolean;
      blockers: unknown[];
    };
    assert.equal(body.recommendedDecision, "no_go");
    assert.equal(body.deploymentAuthorized, false);
    assert.equal(body.blockers.length, 7);
  });

  test("lists only bounded named owner candidates for authorised recorders", async () => {
    const response = await fetch(
      `${origin}/api/production-acceptance/authorities`,
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await response.json(), {
      organisationId: ORGANISATION_ID,
      items: [{ userId: OWNER_USER_ID, name: "Migration Owner" }],
      limit: 100,
      truncated: false,
    });
  });

  test("denies partner-derived access and permission-only role spoofing", async () => {
    currentAccess = access(
      ["valo_operations_administrator"],
      ["audit:read", "configuration:manage"],
      "partner",
    );
    assert.equal(
      (await fetch(`${origin}/api/production-acceptance`)).status,
      403,
    );
    currentAccess = access(
      ["read_only_auditor"],
      ["audit:read", "configuration:manage"],
    );
    assert.equal(
      (await fetch(`${origin}/api/production-acceptance`)).status,
      403,
    );
    currentAccess = access(
      ["valo_operations_administrator"],
      ["audit:read", "configuration:manage"],
    );
  });

  test("appends, exactly replays and detects idempotency conflicts", async () => {
    const first = await fetch(`${origin}/api/production-acceptance/evidence`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(evidenceBody()),
    });
    assert.equal(first.status, 201);
    const firstBody = (await first.json()) as {
      record: { evidenceDigest: string; ownerUserId: string };
      replayed: boolean;
      deploymentAuthorized: boolean;
    };
    assert.match(firstBody.record.evidenceDigest, /^[a-f0-9]{64}$/u);
    assert.equal(firstBody.record.ownerUserId, OWNER_USER_ID);
    assert.equal(firstBody.replayed, false);
    assert.equal(firstBody.deploymentAuthorized, false);

    currentNow = new Date(NOW.getTime() + 60_000);
    const replay = await fetch(`${origin}/api/production-acceptance/evidence`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(evidenceBody()),
    });
    assert.equal(replay.status, 200);
    const replayBody = (await replay.json()) as {
      record: { evidenceDigest: string };
      replayed: boolean;
    };
    assert.equal(replayBody.replayed, true);
    assert.equal(
      replayBody.record.evidenceDigest,
      firstBody.record.evidenceDigest,
    );

    const conflict = await fetch(
      `${origin}/api/production-acceptance/evidence`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          evidenceBody({ summary: "Different evidence under the same key." }),
        ),
      },
    );
    assert.equal(conflict.status, 409);
  });

  test("requires an independent verifier and exact current release binding", async () => {
    const malformedOwner = await fetch(
      `${origin}/api/production-acceptance/evidence`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          evidenceBody({
            ownerUserId: "not-a-user-id",
            idempotencyKey: "acceptance-migration-invalid-owner",
          }),
        ),
      },
    );
    assert.equal(malformedOwner.status, 400);

    const samePerson = await fetch(
      `${origin}/api/production-acceptance/evidence`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          evidenceBody({
            ownerUserId: currentActor,
            idempotencyKey: "acceptance-migration-0002",
          }),
        ),
      },
    );
    assert.equal(samePerson.status, 400);
    assert.equal(
      ((await samePerson.json()) as { code: string }).code,
      "OWNER_VERIFIER_CONFLICT",
    );

    const staleRelease = await fetch(
      `${origin}/api/production-acceptance/evidence`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          evidenceBody({
            releaseSha256: "c".repeat(64),
            idempotencyKey: "acceptance-migration-0003",
          }),
        ),
      },
    );
    assert.equal(staleRelease.status, 409);
  });

  test("exposes no destructive recovery method", async () => {
    for (const method of ["DELETE", "PATCH", "PUT"]) {
      const response = await fetch(`${origin}/api/production-acceptance`, {
        method,
      });
      assert.equal(response.status, 404);
    }
  });
});
