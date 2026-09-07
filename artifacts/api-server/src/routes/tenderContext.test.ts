import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, before, describe, test } from "node:test";
import express, { type ErrorRequestHandler } from "express";
import type { Permission } from "../lib/permissions";
import type { AccessContext } from "../middlewares/tenancy";
import type { TenderContextRouterOptions } from "./tenderContext";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??=
  "postgresql://bidbox_test:bidbox_test@127.0.0.1:1/bidbox_tender_context_test";

const { createTenderContextRouter } = await import("./tenderContext");
const { parseTenderContextVersionDraft } =
  await import("../lib/intelligence/tenderContextService");

const ORGANISATION_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const ACTOR_ID = "33333333-3333-4333-8333-333333333333";
const MEMBERSHIP_ID = "44444444-4444-4444-8444-444444444444";
const CONTEXT_ID = "55555555-5555-4555-8555-555555555555";
const PASSPORT_ID = "66666666-6666-4666-8666-666666666666";
const DOCUMENT_VERSION_ID = "77777777-7777-4777-8777-777777777777";
const RULE_PACK_ID = "88888888-8888-4888-8888-888888888888";
const REQUIREMENT_ID = "99999999-9999-4999-8999-999999999999";
const CITATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const READ: Permission[] = [
  "project:read",
  "document:read",
  "requirement:read",
  "evidence:read",
  "rule_pack:read",
];
const PROPOSE: Permission[] = [...READ, "requirement:write"];
const REVIEW: Permission[] = [...READ, "intelligence:review"];
const FULL: Permission[] = [...PROPOSE, "intelligence:review"];

const CONTEXT_BODY = {
  primaryDocumentVersionId: DOCUMENT_VERSION_ID,
  jurisdictionRulePackId: RULE_PACK_ID,
  legalEntityName: "Ada Infrastructure Limited",
  submissionDate: "2026-09-30",
  jurisdiction: "NG",
  entityScopes: ["federal"],
  categoryScopes: ["works"],
  requirements: [
    {
      requirementId: REQUIREMENT_ID,
      requirementCitationId: CITATION_ID,
      evidenceKind: "cac_certificate",
      mandatory: true,
      requiresCurrentOnSubmissionDate: true,
      requiresExactLegalEntityMatch: true,
    },
  ],
  artifacts: [],
};

function access(
  permissions: readonly Permission[],
  source: AccessContext["source"] = "membership",
): AccessContext {
  return {
    organisationId: ORGANISATION_ID,
    membershipId: source === "membership" ? MEMBERSHIP_ID : null,
    membershipOrganisationId: source === "membership" ? ORGANISATION_ID : null,
    source,
    roles: source === "membership" ? ["bid_manager"] : [],
    permissions: new Set(permissions),
    breakGlassSessionId:
      source === "break_glass" ? "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" : null,
    partnerRelationshipId:
      source === "partner" ? "cccccccc-cccc-4ccc-8ccc-cccccccccccc" : null,
    partnerCoSigningRequired: false,
  };
}

describe("tender context route authority", () => {
  let server: Server;
  let origin: string;
  let currentAccess = access(READ);
  let currentActor: { id: string; name: string | null } | undefined = {
    id: ACTOR_ID,
    name: "Ada Bid Manager",
  };
  let directAuthority = true;
  const calls = {
    read: 0,
    createContext: 0,
    reviewContext: 0,
    createPassport: 0,
    reviewPassport: 0,
  };

  before(async () => {
    const service = {
      readCentre: async () => {
        calls.read += 1;
        return { centre: true };
      },
      createContext: async () => {
        calls.createContext += 1;
        return { receipt: "context" };
      },
      reviewContext: async () => {
        calls.reviewContext += 1;
        return { receipt: "context-review" };
      },
      createPassport: async () => {
        calls.createPassport += 1;
        return { receipt: "passport" };
      },
      reviewPassport: async () => {
        calls.reviewPassport += 1;
        return { receipt: "passport-review" };
      },
    } as unknown as NonNullable<TenderContextRouterOptions["service"]>;
    const app = express();
    app.use(express.json());
    app.use(
      createTenderContextRouter({
        service,
        resolveAccess: () => currentAccess,
        resolveActor: () => currentActor,
        resolveDirectAuthority: async () =>
          directAuthority &&
          currentAccess.source === "membership" &&
          currentActor
            ? {
                organisationId: ORGANISATION_ID,
                actorUserId: currentActor.id,
                membershipId: MEMBERSHIP_ID,
                roles: ["bid_manager"],
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

  test("direct members and approved partners may read private records", async () => {
    for (const source of ["membership", "partner"] as const) {
      currentAccess = access(READ, source);
      const response = await fetch(
        `${origin}/projects/${PROJECT_ID}/tender-context`,
      );
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      assert.match(
        response.headers.get("vary") ?? "",
        /X-BidBox-Organisation-Id/u,
      );
    }
    assert.equal(calls.read, 2);
  });

  test("partner and break-glass authority cannot mutate", async () => {
    const before = calls.createContext;
    for (const source of ["partner", "break_glass"] as const) {
      currentAccess = access(FULL, source);
      const response = await fetch(
        `${origin}/projects/${PROJECT_ID}/tender-context/versions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(CONTEXT_BODY),
        },
      );
      assert.equal(response.status, 403);
    }
    assert.equal(calls.createContext, before);
  });

  test("missing permission and stale direct authority deny writes", async () => {
    currentAccess = access(READ);
    let response = await fetch(
      `${origin}/projects/${PROJECT_ID}/tender-context/versions`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(CONTEXT_BODY),
      },
    );
    assert.equal(response.status, 403);

    currentAccess = access(PROPOSE);
    directAuthority = false;
    response = await fetch(
      `${origin}/projects/${PROJECT_ID}/tender-context/versions`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(CONTEXT_BODY),
      },
    );
    assert.equal(response.status, 403);
    directAuthority = true;
  });

  test("proposal and review permissions are deliberately separated", async () => {
    currentAccess = access(PROPOSE);
    const proposed = await fetch(
      `${origin}/projects/${PROJECT_ID}/tender-context/versions`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(CONTEXT_BODY),
      },
    );
    assert.equal(proposed.status, 201);
    const proposalReview = await fetch(
      `${origin}/projects/${PROJECT_ID}/tender-context/versions/${CONTEXT_ID}/review`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "if-match": '"1"',
        },
        body: JSON.stringify({ decision: "accepted", note: "Reviewed." }),
      },
    );
    assert.equal(proposalReview.status, 403);

    currentAccess = access(REVIEW);
    const reviewerProposal = await fetch(
      `${origin}/projects/${PROJECT_ID}/tender-context/versions`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(CONTEXT_BODY),
      },
    );
    assert.equal(reviewerProposal.status, 403);
    const reviewed = await fetch(
      `${origin}/projects/${PROJECT_ID}/tender-context/versions/${CONTEXT_ID}/review`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "if-match": 'W/"1"',
        },
        body: JSON.stringify({ decision: "accepted", note: "Reviewed." }),
      },
    );
    assert.equal(reviewed.status, 200);
  });

  test("strict bodies and If-Match fail before service work", async () => {
    currentAccess = access(FULL);
    const before = { ...calls };
    const invalidCreate = await fetch(
      `${origin}/projects/${PROJECT_ID}/tender-context/versions`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...CONTEXT_BODY,
          reviewerName: "client supplied",
        }),
      },
    );
    assert.equal(invalidCreate.status, 400);

    const missingVersion = await fetch(
      `${origin}/projects/${PROJECT_ID}/tender-context/versions/${CONTEXT_ID}/review`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision: "accepted", note: "Reviewed." }),
      },
    );
    assert.equal(missingVersion.status, 400);

    const passportFields = await fetch(
      `${origin}/projects/${PROJECT_ID}/tender-context/versions/${CONTEXT_ID}/eligibility-passports`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clearance: true }),
      },
    );
    assert.equal(passportFields.status, 400);
    assert.deepEqual(calls, before);
  });

  test("a current named actor is mandatory", async () => {
    currentAccess = access(PROPOSE);
    currentActor = { id: ACTOR_ID, name: "" };
    const response = await fetch(
      `${origin}/projects/${PROJECT_ID}/tender-context/versions`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(CONTEXT_BODY),
      },
    );
    assert.equal(response.status, 403);
    currentActor = { id: ACTOR_ID, name: "Ada Bid Manager" };
  });
});

test("tender context scope lists are trimmed before duplicate checks and hashing", () => {
  assert.equal(
    parseTenderContextVersionDraft({
      ...CONTEXT_BODY,
      entityScopes: ["federal", " federal "],
    }),
    null,
  );
  assert.deepEqual(
    parseTenderContextVersionDraft({
      ...CONTEXT_BODY,
      entityScopes: [" state ", "federal"],
      categoryScopes: [" works "],
    })?.entityScopes,
    ["federal", "state"],
  );
});

async function startReceiptServer(options: {
  readonly commit: () => Promise<void>;
  readonly events: string[];
}) {
  let operation = "";
  const service = {
    readCentre: async () => ({}),
    createContext: async () => {
      operation = "create-context";
      options.events.push("service:create-context");
      return { receipt: operation };
    },
    reviewContext: async () => {
      operation = "review-context";
      options.events.push("service:review-context");
      return { receipt: operation };
    },
    createPassport: async () => {
      operation = "create-passport";
      options.events.push("service:create-passport");
      return { receipt: operation };
    },
    reviewPassport: async () => {
      operation = "review-passport";
      options.events.push("service:review-passport");
      return { receipt: operation };
    },
  } as unknown as NonNullable<TenderContextRouterOptions["service"]>;
  const app = express();
  app.use(express.json());
  app.use(
    createTenderContextRouter({
      service,
      resolveAccess: () => access(FULL),
      resolveActor: () => ({ id: ACTOR_ID, name: "Ada Bid Manager" }),
      resolveDirectAuthority: async () => ({
        organisationId: ORGANISATION_ID,
        actorUserId: ACTOR_ID,
        membershipId: MEMBERSHIP_ID,
        roles: ["bid_manager"],
        permissions: new Set(FULL),
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
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

const WRITE_REQUESTS = [
  {
    operation: "create-context",
    path: `/projects/${PROJECT_ID}/tender-context/versions`,
    body: CONTEXT_BODY,
    headers: {},
    status: 201,
  },
  {
    operation: "review-context",
    path: `/projects/${PROJECT_ID}/tender-context/versions/${CONTEXT_ID}/review`,
    body: { decision: "accepted", note: "Reviewed for this tender." },
    headers: { "if-match": 'W/"1"' },
    status: 200,
  },
  {
    operation: "create-passport",
    path: `/projects/${PROJECT_ID}/tender-context/versions/${CONTEXT_ID}/eligibility-passports`,
    body: {},
    headers: {},
    status: 201,
  },
  {
    operation: "review-passport",
    path: `/projects/${PROJECT_ID}/tender-context/eligibility-passports/${PASSPORT_ID}/review`,
    body: { decision: "accepted", note: "Reviewed for this tender." },
    headers: { "if-match": '"1"' },
    status: 200,
  },
] as const;

test("all authoritative tender receipts are exposed only after commit", async (t) => {
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
  for (const request of WRITE_REQUESTS) {
    const response = await fetch(`${origin}${request.path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...request.headers },
      body: JSON.stringify(request.body),
    });
    assert.equal(response.status, request.status);
    assert.deepEqual(await response.json(), { receipt: request.operation });
  }
  assert.deepEqual(
    events,
    WRITE_REQUESTS.flatMap(({ operation }) => [
      `service:${operation}`,
      `commit:${operation}`,
    ]),
  );
});

test("commit failure suppresses every tender write receipt", async (t) => {
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
  for (const request of WRITE_REQUESTS) {
    const response = await fetch(`${origin}${request.path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...request.headers },
      body: JSON.stringify(request.body),
    });
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: "commit failed" });
  }
  assert.deepEqual(
    events,
    WRITE_REQUESTS.flatMap(({ operation }) => [
      `service:${operation}`,
      `commit:${operation}`,
    ]),
  );
});
