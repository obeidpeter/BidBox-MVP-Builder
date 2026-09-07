import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, before, describe, test } from "node:test";
import express from "express";
import type { CurrentDirectAuthority } from "../lib/directMembershipAuthority";
import type { WorkInboxSnapshot } from "../lib/workInbox/contracts";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??=
  "postgresql://bidbox_test:bidbox_test@127.0.0.1:1/bidbox_work_inbox_test";

const { createWorkInboxRouter } = await import("./workInbox");

const ORGANISATION_ID = "10000000-0000-4000-8000-000000000001";
const ACTOR_ID = "20000000-0000-4000-8000-000000000002";
const authority: CurrentDirectAuthority = {
  organisationId: ORGANISATION_ID,
  actorUserId: ACTOR_ID,
  membershipId: "30000000-0000-4000-8000-000000000003",
  roles: ["bid_manager"],
  permissions: new Set(["project:read", "project:update"]),
};

function snapshot(limit: number): WorkInboxSnapshot {
  return {
    organisationId: ORGANISATION_ID,
    generatedAt: "2026-08-12T12:00:00.000Z",
    businessTimeZone: "Africa/Lagos",
    limit,
    truncated: false,
    restrictedContent: true,
    groups: { overdue: [], today: [], upcoming: [], unscheduled: [] },
  };
}

describe("work-inbox route", () => {
  let server: Server;
  let origin = "";
  let currentAuthority: CurrentDirectAuthority | null = authority;
  const limits: number[] = [];

  before(async () => {
    const app = express();
    app.use(
      "/api",
      createWorkInboxRouter({
        resolveAuthority: async () => currentAuthority,
        readInbox: async (_authority, limit) => {
          limits.push(limit);
          return snapshot(limit);
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

  test("returns a bounded private direct-membership projection", async () => {
    const response = await fetch(`${origin}/api/work-inbox?limit=12`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.match(
      response.headers.get("vary") ?? "",
      /X-BidBox-Organisation-Id/u,
    );
    assert.equal(limits.at(-1), 12);
    const body = (await response.json()) as WorkInboxSnapshot;
    assert.equal(body.organisationId, ORGANISATION_ID);
    assert.deepEqual(Object.keys(body.groups), [
      "overdue",
      "today",
      "upcoming",
      "unscheduled",
    ]);
  });

  test("rejects invalid bounds and absent current direct authority", async () => {
    assert.equal(
      (await fetch(`${origin}/api/work-inbox?limit=101`)).status,
      400,
    );
    currentAuthority = null;
    assert.equal((await fetch(`${origin}/api/work-inbox`)).status, 403);
    currentAuthority = authority;
  });
});
