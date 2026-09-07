import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, before, describe, test } from "node:test";
import express, { type ErrorRequestHandler } from "express";
import type { Permission } from "../lib/permissions";
import type { AccessContext } from "../middlewares/tenancy";
import type { DocumentVersionSnapshotRouterOptions } from "./documentVersionSnapshots";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??=
  "postgresql://bidbox_test:bidbox_test@127.0.0.1:1/bidbox_document_snapshot_test";

const { createDocumentVersionSnapshotRouter } =
  await import("./documentVersionSnapshots");

const ORGANISATION_ID = "11111111-1111-4111-8111-111111111111";
const DOCUMENT_ID = "22222222-2222-4222-8222-222222222222";
const DOCUMENT_VERSION_ID = "33333333-3333-7333-8333-333333333333";
const SNAPSHOT_ID = "44444444-4444-8444-8444-444444444444";
const ACTOR_ID = "55555555-5555-4555-8555-555555555555";
const MEMBERSHIP_ID = "66666666-6666-4666-8666-666666666666";

const READ = ["document:read"] as const satisfies readonly Permission[];
const CAPTURE = [
  "document:read",
  "requirement:write",
] as const satisfies readonly Permission[];
const REVIEW = [
  "document:read",
  "intelligence:review",
] as const satisfies readonly Permission[];
const FULL = [
  "document:read",
  "requirement:write",
  "intelligence:review",
] as const satisfies readonly Permission[];

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
      source === "break_glass" ? "77777777-7777-4777-8777-777777777777" : null,
    partnerRelationshipId:
      source === "partner" ? "88888888-8888-4888-8888-888888888888" : null,
    partnerCoSigningRequired: false,
  };
}

describe("document-version snapshot route authority", () => {
  let server: Server;
  let origin: string;
  let currentAccess = access(READ);
  let currentActor: { id: string; name: string | null } | undefined = {
    id: ACTOR_ID,
    name: "Ada Bid Manager",
  };
  let directAuthority = true;
  const calls = { read: 0, capture: 0, review: 0 };

  before(async () => {
    const repository = {
      readCurrent: async () => {
        calls.read += 1;
        return { documentId: DOCUMENT_ID };
      },
      capture: async () => {
        calls.capture += 1;
        return { outcome: "created", value: { receipt: "capture" } };
      },
      review: async () => {
        calls.review += 1;
        return { outcome: "updated", value: { receipt: "review" } };
      },
    } as unknown as NonNullable<
      DocumentVersionSnapshotRouterOptions["repository"]
    >;
    const app = express();
    app.use(express.json());
    app.use(
      createDocumentVersionSnapshotRouter({
        repository,
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

  test("membership and partner readers receive only private responses", async () => {
    for (const source of ["membership", "partner"] as const) {
      currentAccess = access(READ, source);
      const response = await fetch(
        `${origin}/documents/${DOCUMENT_ID}/version-snapshot`,
      );
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      assert.match(
        response.headers.get("vary") ?? "",
        /X-BidBox-Organisation-Id/u,
      );
    }
    currentAccess = access(READ, "break_glass");
    assert.equal(
      (await fetch(`${origin}/documents/${DOCUMENT_ID}/version-snapshot`))
        .status,
      403,
    );
    assert.equal(calls.read, 2);
  });

  test("capture and review use separate live direct-member permissions", async () => {
    currentAccess = access(CAPTURE);
    const captured = await fetch(
      `${origin}/documents/${DOCUMENT_ID}/version-snapshots`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          documentVersionId: DOCUMENT_VERSION_ID,
          structuredSnapshot: null,
        }),
      },
    );
    assert.equal(captured.status, 201);
    assert.deepEqual(await captured.json(), { receipt: "capture" });
    assert.equal(
      (
        await fetch(
          `${origin}/documents/${DOCUMENT_ID}/version-snapshots/${SNAPSHOT_ID}/review`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "if-match": '"1"',
            },
            body: JSON.stringify({ decision: "verified" }),
          },
        )
      ).status,
      403,
    );

    currentAccess = access(REVIEW);
    assert.equal(
      (
        await fetch(`${origin}/documents/${DOCUMENT_ID}/version-snapshots`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            documentVersionId: DOCUMENT_VERSION_ID,
            structuredSnapshot: null,
          }),
        })
      ).status,
      403,
    );
    const reviewed = await fetch(
      `${origin}/documents/${DOCUMENT_ID}/version-snapshots/${SNAPSHOT_ID}/review`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "if-match": 'W/"1"',
        },
        body: JSON.stringify({ decision: "verified" }),
      },
    );
    assert.equal(reviewed.status, 200);
    assert.deepEqual(await reviewed.json(), { receipt: "review" });
  });

  test("partner, stale authority, unnamed actors and invalid bodies fail before writes", async () => {
    const before = { ...calls };
    currentAccess = access(FULL, "partner");
    let response = await fetch(
      `${origin}/documents/${DOCUMENT_ID}/version-snapshots`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          documentVersionId: DOCUMENT_VERSION_ID,
          structuredSnapshot: null,
        }),
      },
    );
    assert.equal(response.status, 403);

    currentAccess = access(FULL);
    directAuthority = false;
    response = await fetch(
      `${origin}/documents/${DOCUMENT_ID}/version-snapshots`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          documentVersionId: DOCUMENT_VERSION_ID,
          structuredSnapshot: null,
        }),
      },
    );
    assert.equal(response.status, 403);
    directAuthority = true;

    currentActor = { id: ACTOR_ID, name: "" };
    response = await fetch(
      `${origin}/documents/${DOCUMENT_ID}/version-snapshots`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          documentVersionId: DOCUMENT_VERSION_ID,
          structuredSnapshot: null,
        }),
      },
    );
    assert.equal(response.status, 403);
    currentActor = { id: ACTOR_ID, name: "Ada Bid Manager" };

    response = await fetch(
      `${origin}/documents/${DOCUMENT_ID}/version-snapshots`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          documentVersionId: DOCUMENT_VERSION_ID,
          structuredSnapshot: null,
          verifiedByName: "client supplied",
        }),
      },
    );
    assert.equal(response.status, 400);
    response = await fetch(
      `${origin}/documents/${DOCUMENT_ID}/version-snapshots/${SNAPSHOT_ID}/review`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision: "verified" }),
      },
    );
    assert.equal(response.status, 400);
    assert.deepEqual(calls, before);
  });
});

async function startReceiptServer(options: {
  readonly events: string[];
  readonly commit: () => Promise<void>;
}) {
  let operation = "";
  const repository = {
    readCurrent: async () => null,
    capture: async () => {
      operation = "capture";
      options.events.push("repository:capture");
      return { outcome: "created", value: { receipt: operation } };
    },
    review: async () => {
      operation = "review";
      options.events.push("repository:review");
      return { outcome: "updated", value: { receipt: operation } };
    },
  } as unknown as NonNullable<
    DocumentVersionSnapshotRouterOptions["repository"]
  >;
  const app = express();
  app.use(express.json());
  app.use(
    createDocumentVersionSnapshotRouter({
      repository,
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
    operation: "capture",
    path: `/documents/${DOCUMENT_ID}/version-snapshots`,
    body: {
      documentVersionId: DOCUMENT_VERSION_ID,
      structuredSnapshot: null,
    },
    headers: {},
    status: 201,
  },
  {
    operation: "review",
    path: `/documents/${DOCUMENT_ID}/version-snapshots/${SNAPSHOT_ID}/review`,
    body: { decision: "verified" },
    headers: { "if-match": '"1"' },
    status: 200,
  },
] as const;

for (const commitFails of [false, true]) {
  test(
    commitFails
      ? "commit failure suppresses every snapshot write receipt"
      : "snapshot write receipts are exposed only after commit",
    async (t) => {
      const events: string[] = [];
      const { server, origin } = await startReceiptServer({
        events,
        commit: async () => {
          if (commitFails) throw new Error("database commit failed");
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
        assert.equal(response.status, commitFails ? 500 : request.status);
        assert.deepEqual(
          await response.json(),
          commitFails
            ? { error: "commit failed" }
            : { receipt: request.operation },
        );
      }
      assert.deepEqual(
        events,
        WRITE_REQUESTS.flatMap(({ operation }) => [
          `repository:${operation}`,
          `commit:${operation}`,
        ]),
      );
    },
  );
}
