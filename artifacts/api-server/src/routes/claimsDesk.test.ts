import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, before, describe, test } from "node:test";
import express from "express";
import type { Permission } from "../lib/permissions";
import type {
  ClaimsDeskRecord,
  ClaimsDeskRepository,
} from "../lib/claimsDesk/contracts";
import type { CurrentDirectAuthority } from "../lib/directMembershipAuthority";
import type { AccessContext } from "../middlewares/tenancy";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??=
  "postgresql://bidbox_test:bidbox_test@127.0.0.1:1/bidbox_claims_test";

const { createClaimsDeskRouter } = await import("./claimsDesk");

const ORG = "10000000-0000-4000-8000-000000000001";
const PROJECT = "20000000-0000-4000-8000-000000000002";
const RECORD = "30000000-0000-4000-8000-000000000003";
const ACTOR = "40000000-0000-4000-8000-000000000004";
const MEMBER = "50000000-0000-4000-8000-000000000005";
const DOC = "60000000-0000-4000-8000-000000000006";
const SHA = "a".repeat(64);
const NOW = new Date("2026-08-11T12:00:00.000Z");

function access(
  permissions: readonly Permission[],
  source: AccessContext["source"] = "membership",
): AccessContext {
  return {
    organisationId: ORG,
    membershipId: source === "membership" ? MEMBER : null,
    membershipOrganisationId: source === "membership" ? ORG : null,
    source,
    roles: ["client_administrator"],
    permissions: new Set(permissions),
    breakGlassSessionId: source === "break_glass" ? "session" : null,
    partnerRelationshipId: source === "partner" ? "relationship" : null,
    partnerCoSigningRequired: false,
  };
}

function record(version = 1): ClaimsDeskRecord {
  return {
    id: RECORD,
    organisationId: ORG,
    projectId: PROJECT,
    recordType: "claim",
    reference: "CLM-1",
    eventDate: "2026-08-01",
    dueAt: null,
    amountMinor: 10_000,
    currency: "NGN",
    documentBindings: [{ documentId: DOC, sha256: SHA }],
    status: version === 1 ? "registered" : "under_review",
    assessmentCode: null,
    pendingMakerUserId: null,
    version,
    createdByUserId: ACTOR,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    latestReceiptSha256: SHA,
    reasonHistory: [],
  };
}

describe("Claims Desk route factory", () => {
  let server: Server;
  let origin = "";
  let currentAccess = access(["project:read", "project:update"]);
  let authorityPermissionsOverride: readonly Permission[] | null | undefined;
  let authorityMembershipId = MEMBER;
  const calls: string[] = [];
  const observedMembershipIds: string[] = [];

  before(async () => {
    const repository: ClaimsDeskRepository = {
      readSnapshot: async (scope) => {
        observedMembershipIds.push(scope.actorMembershipId);
        return {
          organisationId: scope.organisationId,
          projectId: scope.projectId,
          projectStatus: "review",
          records: [record()],
          posture: {
            total: 1,
            open: 1,
            overdue: 0,
            dueSoon: 0,
            awaitingChecker: 0,
            terminal: 0,
          },
          truncated: false,
          generatedAt: NOW.toISOString(),
          legalConclusionAutomated: false,
          noticeDispatched: false,
          paymentMutated: false,
          authorityNote: "Human workflow evidence only",
        };
      },
      createRecord: async (scope) => {
        observedMembershipIds.push(scope.actorMembershipId);
        calls.push("create");
        return { outcome: "created", record: record(), replayed: false };
      },
      transitionRecord: async (scope, _id, expectedVersion) => {
        observedMembershipIds.push(scope.actorMembershipId);
        calls.push(`transition:${expectedVersion}`);
        return { outcome: "updated", record: record(2), replayed: false };
      },
    };
    const app = express();
    app.use(express.json());
    app.use(
      "/api",
      createClaimsDeskRouter({
        repository,
        now: () => NOW,
        resolveAccess: () => currentAccess,
        resolveActorUserId: () => ACTOR,
        resolveAuthority: async (
          context,
          actorUserId,
        ): Promise<CurrentDirectAuthority | null> => {
          if (
            !context ||
            !actorUserId ||
            context.source !== "membership" ||
            !context.membershipId ||
            context.membershipOrganisationId !== context.organisationId ||
            authorityPermissionsOverride === null
          ) {
            return null;
          }
          return {
            organisationId: context.organisationId,
            actorUserId,
            membershipId: authorityMembershipId,
            roles: ["client_administrator"],
            permissions: new Set(
              authorityPermissionsOverride ?? context.permissions,
            ),
          };
        },
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

  test("returns a private project-scoped bounded snapshot", async () => {
    const response = await fetch(
      `${origin}/api/projects/${PROJECT}/claims-desk`,
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    const body = (await response.json()) as Record<string, unknown>;
    assert.equal(body.projectId, PROJECT);
    assert.equal(body.legalConclusionAutomated, false);
    assert.equal(body.paymentMutated, false);
  });

  test("requires direct membership and exact read/manage permissions", async () => {
    currentAccess = access(["project:read", "project:update"], "partner");
    assert.equal(
      (await fetch(`${origin}/api/projects/${PROJECT}/claims-desk`)).status,
      403,
    );
    currentAccess = access(["project:update"]);
    assert.equal(
      (await fetch(`${origin}/api/projects/${PROJECT}/claims-desk`)).status,
      403,
    );
    currentAccess = access(["project:read"]);
    assert.equal(
      (
        await fetch(`${origin}/api/projects/${PROJECT}/claims-desk/records`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        })
      ).status,
      403,
    );
    currentAccess = access(["project:read", "project:update"]);
  });

  test("rejects stale grants and scopes repository work to current membership", async () => {
    currentAccess = access(["project:read", "project:update"]);
    authorityPermissionsOverride = [];
    const callsBefore = calls.length;
    assert.equal(
      (await fetch(`${origin}/api/projects/${PROJECT}/claims-desk`)).status,
      403,
    );
    assert.equal(
      (
        await fetch(`${origin}/api/projects/${PROJECT}/claims-desk/records`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        })
      ).status,
      403,
    );
    assert.equal(calls.length, callsBefore);

    authorityPermissionsOverride = ["project:read"];
    authorityMembershipId = "50000000-0000-4000-8000-000000000099";
    assert.equal(
      (await fetch(`${origin}/api/projects/${PROJECT}/claims-desk`)).status,
      200,
    );
    assert.equal(observedMembershipIds.at(-1), authorityMembershipId);
    authorityMembershipId = MEMBER;
    authorityPermissionsOverride = undefined;
  });

  test("accepts closed creation and CAS transition payloads", async () => {
    const creation = await fetch(
      `${origin}/api/projects/${PROJECT}/claims-desk/records`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          recordType: "claim",
          reference: "CLM-1",
          eventDate: "2026-08-01",
          dueAt: null,
          amountMinor: 10_000,
          currency: "NGN",
          documentBindings: [{ documentId: DOC, sha256: SHA }],
          idempotencyKey: "create-claim-0001",
        }),
      },
    );
    assert.equal(creation.status, 201);
    assert.equal(creation.headers.get("etag"), '"1"');

    const missingCas = await fetch(
      `${origin}/api/projects/${PROJECT}/claims-desk/records/${RECORD}/transitions`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    );
    assert.equal(missingCas.status, 428);
    const transition = await fetch(
      `${origin}/api/projects/${PROJECT}/claims-desk/records/${RECORD}/transitions`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "If-Match": '"1"' },
        body: JSON.stringify({
          action: "start_review",
          reasonCode: "evidence_received",
          assessmentCode: null,
          documentBindings: [{ documentId: DOC, sha256: SHA }],
          idempotencyKey: "start-review-0001",
        }),
      },
    );
    assert.equal(transition.status, 200);
    assert.equal(transition.headers.get("etag"), '"2"');
    assert.deepEqual(calls, ["create", "transition:1"]);
  });

  test("does not expose destructive or dispatch methods", async () => {
    assert.equal(
      (
        await fetch(
          `${origin}/api/projects/${PROJECT}/claims-desk/records/${RECORD}`,
          {
            method: "DELETE",
          },
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await fetch(
          `${origin}/api/projects/${PROJECT}/claims-desk/notices/dispatch`,
          {
            method: "POST",
          },
        )
      ).status,
      404,
    );
  });
});
