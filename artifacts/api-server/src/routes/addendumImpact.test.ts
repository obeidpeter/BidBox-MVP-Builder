import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, before, describe, test } from "node:test";
import express from "express";
import type { ErrorRequestHandler } from "express";
import type { Permission } from "../lib/permissions";
import type { AddendumImpactRepository } from "../lib/intelligence/addendumImpactContracts";
import type { AccessContext } from "../middlewares/tenancy";
import type { AddendumImpactRouterOptions } from "./addendumImpact";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??=
  "postgresql://bidbox_test:bidbox_test@127.0.0.1:1/bidbox_addendum_test";

const { createAddendumImpactRouter } = await import("./addendumImpact");

const ORGANISATION_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const ACTOR_ID = "33333333-3333-4333-8333-333333333333";

const READ: Permission[] = [
  "project:read",
  "document:read",
  "requirement:read",
  "draft:read",
  "package:read",
  "report:read",
];
const REVIEW: Permission[] = [...READ, "intelligence:review"];
const APPLY: Permission[] = [
  ...READ,
  "project:update",
  "requirement:review",
  "package:generate",
  "report:generate",
];

function access(
  permissions: readonly Permission[],
  source: AccessContext["source"] = "membership",
): AccessContext {
  return {
    organisationId: ORGANISATION_ID,
    membershipId:
      source === "membership" ? "44444444-4444-4444-8444-444444444444" : null,
    membershipOrganisationId: source === "membership" ? ORGANISATION_ID : null,
    source,
    roles: source === "membership" ? ["bid_manager"] : [],
    permissions: new Set(permissions),
    breakGlassSessionId: null,
    partnerRelationshipId:
      source === "partner" ? "55555555-5555-4555-8555-555555555555" : null,
    partnerCoSigningRequired: false,
  };
}

describe("addendum impact route factory", () => {
  let server: Server;
  let origin: string;
  let currentAccess = access(READ);
  let currentActor: { id: string; name: string | null } | undefined = {
    id: ACTOR_ID,
    name: "Ada Bid Manager",
  };
  let loadCalls = 0;
  let reviewCalls = 0;
  let applyCalls = 0;

  before(async () => {
    const repository: AddendumImpactRepository = {
      load: async () => {
        loadCalls += 1;
        return null;
      },
      recordReview: async () => {
        reviewCalls += 1;
        return { outcome: "conflict" };
      },
      findApplicationReplay: async () => null,
      applyReopening: async () => {
        applyCalls += 1;
        return { outcome: "conflict" };
      },
    };
    const app = express();
    app.use(express.json());
    app.use(
      createAddendumImpactRouter({
        repository,
        resolveAccess: () => currentAccess,
        resolveActor: () => currentActor,
        resolveDirectAuthority: async () =>
          currentAccess.source === "membership" &&
          currentAccess.membershipId &&
          currentActor
            ? {
                organisationId: ORGANISATION_ID,
                actorUserId: currentActor.id,
                membershipId: currentAccess.membershipId,
                roles: currentAccess.roles,
                permissions: currentAccess.permissions,
              }
            : null,
        commitBeforeResponse: async () => {},
      }),
    );
    server = createServer(app);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Test server address unavailable");
    }
    origin = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  test("read is private and tenant scoped", async () => {
    currentAccess = access(READ);
    currentActor = { id: ACTOR_ID, name: "Ada Bid Manager" };
    const response = await fetch(
      `${origin}/projects/${PROJECT_ID}/addendum-impact`,
    );
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.match(
      response.headers.get("vary") ?? "",
      /X-BidBox-Organisation-Id/u,
    );
    assert.equal(loadCalls, 1);
  });

  test("unknown query fields fail before repository access", async () => {
    const before = loadCalls;
    const response = await fetch(
      `${origin}/projects/${PROJECT_ID}/addendum-impact?unexpected=true`,
    );
    assert.equal(response.status, 400);
    assert.equal(loadCalls, before);
  });

  test("partner and emergency authority cannot record a review", async () => {
    for (const source of ["partner", "break_glass"] as const) {
      currentAccess = access(REVIEW, source);
      const response = await fetch(
        `${origin}/projects/${PROJECT_ID}/addendum-impact/review`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      assert.equal(response.status, 403);
    }
    assert.equal(reviewCalls, 0);
  });

  test("review and apply payloads reject extra fields before service work", async () => {
    currentAccess = access(REVIEW);
    const reviewResponse = await fetch(
      `${origin}/projects/${PROJECT_ID}/addendum-impact/review`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ unexpected: true }),
      },
    );
    assert.equal(reviewResponse.status, 400);

    currentAccess = access(APPLY);
    const applyResponse = await fetch(
      `${origin}/projects/${PROJECT_ID}/addendum-impact/apply`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ unexpected: true }),
      },
    );
    assert.equal(applyResponse.status, 400);
    assert.equal(reviewCalls, 0);
    assert.equal(applyCalls, 0);
  });

  test("review and apply require both exact document version IDs", async () => {
    const beforeReview = reviewCalls;
    const beforeApply = applyCalls;
    for (const [permissions, path, extra] of [
      [REVIEW, "review", { decision: "accepted" }],
      [APPLY, "apply", { confirmation: "REOPEN AFFECTED WORK" }],
    ] as const) {
      currentAccess = access(permissions);
      const response = await fetch(
        `${origin}/projects/${PROJECT_ID}/addendum-impact/${path}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            assessmentId: "assessment-1",
            radarId: "radar-1",
            expectedImpactManifestSha256: "a".repeat(64),
            expectedAssessmentVersion: 1,
            reason: "Bind this command to exact source versions.",
            ...extra,
          }),
        },
      );
      assert.equal(response.status, 400);
    }
    assert.equal(reviewCalls, beforeReview);
    assert.equal(applyCalls, beforeApply);
  });

  test("a current named actor is mandatory even with permissions", async () => {
    currentAccess = access(APPLY);
    currentActor = { id: ACTOR_ID, name: "" };
    const response = await fetch(
      `${origin}/projects/${PROJECT_ID}/addendum-impact/apply`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    assert.equal(response.status, 403);
    currentActor = { id: ACTOR_ID, name: "Ada Bid Manager" };
  });
});

const VERSION_BOUND_BODY = {
  baselineVersionId: "66666666-6666-4666-8666-666666666666",
  revisionVersionId: "77777777-7777-4777-8777-777777777777",
  assessmentId: "assessment-1",
  radarId: "radar-1",
  expectedImpactManifestSha256: "a".repeat(64),
  expectedAssessmentVersion: 1,
  reason: "Record the exact reviewed addendum plan.",
};

async function startReceiptServer(options: {
  commit: () => Promise<void>;
  events: string[];
}) {
  let operation = "";
  const service = {
    getCentre: async () => ({}),
    review: async () => {
      operation = "review";
      options.events.push("service:review");
      return { receipt: "review" };
    },
    apply: async () => {
      operation = "apply";
      options.events.push("service:apply");
      return { receipt: "apply" };
    },
  } as unknown as NonNullable<AddendumImpactRouterOptions["service"]>;
  const app = express();
  app.use(express.json());
  app.use(
    createAddendumImpactRouter({
      service,
      resolveAccess: () => access([...REVIEW, ...APPLY]),
      resolveActor: () => ({ id: ACTOR_ID, name: "Ada Bid Manager" }),
      resolveDirectAuthority: async () => ({
        organisationId: ORGANISATION_ID,
        actorUserId: ACTOR_ID,
        membershipId: "44444444-4444-4444-8444-444444444444",
        roles: ["bid_manager"],
        permissions: new Set([...REVIEW, ...APPLY]),
      }),
      commitBeforeResponse: async () => {
        options.events.push(`commit:${operation}`);
        await options.commit();
      },
    }),
  );
  const errorHandler: ErrorRequestHandler = (
    _error,
    _request,
    response,
    _next,
  ) => {
    response.status(500).json({ error: "commit failed" });
  };
  app.use(errorHandler);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server address unavailable");
  }
  return {
    server,
    origin: `http://127.0.0.1:${address.port}`,
  };
}

test("review and apply expose receipts only after commit succeeds", async (t) => {
  const events: string[] = [];
  const { server, origin } = await startReceiptServer({
    events,
    commit: async () => {},
  });
  t.after(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );

  const review = await fetch(
    `${origin}/projects/${PROJECT_ID}/addendum-impact/review`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...VERSION_BOUND_BODY,
        decision: "accepted",
      }),
    },
  );
  assert.equal(review.status, 200);
  assert.deepEqual(await review.json(), { receipt: "review" });
  assert.deepEqual(events, ["service:review", "commit:review"]);

  const apply = await fetch(
    `${origin}/projects/${PROJECT_ID}/addendum-impact/apply`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...VERSION_BOUND_BODY,
        confirmation: "REOPEN AFFECTED WORK",
      }),
    },
  );
  assert.equal(apply.status, 200);
  assert.deepEqual(await apply.json(), { receipt: "apply" });
  assert.deepEqual(events, [
    "service:review",
    "commit:review",
    "service:apply",
    "commit:apply",
  ]);
});

test("commit failure suppresses review and apply receipts", async (t) => {
  const events: string[] = [];
  const { server, origin } = await startReceiptServer({
    events,
    commit: async () => {
      throw new Error("database commit failed");
    },
  });
  t.after(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );

  for (const [path, extra] of [
    ["review", { decision: "accepted" }],
    ["apply", { confirmation: "REOPEN AFFECTED WORK" }],
  ] as const) {
    const response = await fetch(
      `${origin}/projects/${PROJECT_ID}/addendum-impact/${path}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...VERSION_BOUND_BODY, ...extra }),
      },
    );
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: "commit failed" });
  }
  assert.deepEqual(events, [
    "service:review",
    "commit:review",
    "service:apply",
    "commit:apply",
  ]);
});
