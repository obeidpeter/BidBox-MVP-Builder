import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import express, { type Request } from "express";
import type {
  OpportunityPursuitHandoffDraft,
  OpportunityPursuitHandoffPreparation,
  OpportunityPursuitHandoffResult,
  OpportunityPursuitHandoffScope,
} from "../lib/opportunityPursuitHandoff/contracts";
import type { AccessContext } from "../middlewares/tenancy";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??=
  "postgresql://bidbox_test:bidbox_test@127.0.0.1:1/bidbox_test";

const {
  OPPORTUNITY_PURSUIT_HANDOFF_AUTHORITY,
  OpportunityPursuitHandoffError,
} = await import("../lib/opportunityPursuitHandoff/contracts");
const { createOpportunityPursuitHandoffRouter } =
  await import("./opportunityPursuitHandoff");

const ORGANISATION_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR_ID = "22222222-2222-4222-8222-222222222222";
const MEMBERSHIP_ID = "33333333-3333-4333-8333-333333333333";
const CANDIDATE_ID = "44444444-4444-4444-8444-444444444444";

function access(source: AccessContext["source"] = "membership"): AccessContext {
  return {
    organisationId: ORGANISATION_ID,
    membershipId: source === "membership" ? MEMBERSHIP_ID : null,
    membershipOrganisationId: source === "membership" ? ORGANISATION_ID : null,
    source,
    roles: ["bid_manager"],
    permissions: new Set(["project:create"]),
    breakGlassSessionId: source === "break_glass" ? MEMBERSHIP_ID : null,
    partnerRelationshipId: source === "partner" ? MEMBERSHIP_ID : null,
    partnerCoSigningRequired: source === "partner",
  };
}

function localUser() {
  return {
    id: ACTOR_ID,
    clerkUserId: "clerk-maker",
    email: "maker@example.test",
    name: "Named Maker",
    role: "bid_manager",
    status: "active",
    lastLoginAt: null,
    version: 1,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

async function requestApp(options: {
  source?: AccessContext["source"];
  prepare?: (
    scope: OpportunityPursuitHandoffScope,
    candidateId: string,
  ) => Promise<OpportunityPursuitHandoffPreparation>;
  confirm?: (
    scope: OpportunityPursuitHandoffScope,
    candidateId: string,
    idempotencyKey: string,
    body: OpportunityPursuitHandoffDraft,
  ) => Promise<OpportunityPursuitHandoffResult>;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: unknown;
}) {
  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => {
    Object.assign(request as Request & Record<string, unknown>, {
      localUser: localUser(),
      accessContext: access(options.source),
    });
    next();
  });
  const service = {
    prepare:
      options.prepare ??
      (async () => {
        throw new Error("unexpected prepare");
      }),
    confirm:
      options.confirm ??
      (async () => {
        throw new Error("unexpected confirm");
      }),
  };
  app.use(
    "/api",
    createOpportunityPursuitHandoffRouter({
      service: service as never,
      holdCritical: () => () => {},
    }),
  );
  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const suffix =
    options.method === "POST" ? "/pursuit-handoff/confirm" : "/pursuit-handoff";
  try {
    return await fetch(
      `http://127.0.0.1:${address.port}/api/opportunity-sources/${CANDIDATE_ID}${suffix}`,
      {
        method: options.method ?? "GET",
        headers: {
          ...(options.body === undefined
            ? {}
            : { "content-type": "application/json" }),
          ...options.headers,
        },
        body:
          options.body === undefined ? undefined : JSON.stringify(options.body),
      },
    );
  } finally {
    server.close();
    await once(server, "close");
  }
}

test("prepare derives an exact direct-membership scope and returns no-store", async () => {
  const response = await requestApp({
    prepare: async (scope, candidateId) => {
      assert.deepEqual(scope, {
        organisationId: ORGANISATION_ID,
        actorUserId: ACTOR_ID,
        actorName: "Named Maker",
        actorMembershipId: MEMBERSHIP_ID,
      });
      assert.equal(candidateId, CANDIDATE_ID);
      return {
        state: "completed",
        receipt: {} as never,
        authority: OPPORTUNITY_PURSUIT_HANDOFF_AUTHORITY,
      };
    },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});

test("partner and break-glass contexts cannot enter handoff", async () => {
  for (const source of ["partner", "break_glass"] as const) {
    const response = await requestApp({ source });
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), {
      error: "Direct membership required",
    });
  }
});

test("confirm requires an idempotency key and a closed explicit body", async () => {
  const missing = await requestApp({ method: "POST", body: {} });
  assert.equal(missing.status, 400);
  assert.deepEqual(await missing.json(), {
    error: "A valid Idempotency-Key is required",
  });

  const unknown = await requestApp({
    method: "POST",
    headers: { "idempotency-key": "handoff:2026-08:client-42" },
    body: { unexpected: true },
  });
  assert.equal(unknown.status, 400);
  assert.deepEqual(await unknown.json(), {
    error: "Handoff confirmation is invalid",
  });
});

test("confirmation body is rejected before materialisation exceeds its domain bound", async () => {
  const response = await requestApp({
    method: "POST",
    headers: { "idempotency-key": "handoff:2026-08:client-42" },
    body: { confirmationNote: "x".repeat(17_000) },
  });
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), {
    error: "Request body exceeds the opportunity-handoff bound.",
  });
});

test("known conflict returns 409 and never reports creation", async () => {
  const body = {
    expectedCandidateVersion: 2,
    expectedSourceReceiptSha256: "a".repeat(64),
    expectedTenderVersion: 1,
    expectedConflictBoundarySha256: "b".repeat(64),
    clientId: "55555555-5555-4555-8555-555555555555",
    expectedClientVersion: 1,
    tenderLotId: null,
    expectedTenderLotVersion: null,
    confirmedLotReference: null,
    reviewerUserId: "66666666-6666-4666-8666-666666666666",
    officialSourceReopened: true,
    confirmedBuyer: "Buyer",
    confirmedReference: "NG-42",
    confirmedSubmissionDeadline: null,
    confirmationNote: "Reopened and checked the official source.",
  };
  const response = await requestApp({
    method: "POST",
    headers: { "idempotency-key": "handoff:2026-08:client-42" },
    body,
    confirm: async () => {
      throw new OpportunityPursuitHandoffError(
        "conflict",
        "The conflict boundary changed.",
      );
    },
  });
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: "The conflict boundary changed.",
  });
});
