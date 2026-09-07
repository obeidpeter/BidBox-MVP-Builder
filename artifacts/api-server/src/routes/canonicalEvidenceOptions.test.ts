import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, before, describe, test } from "node:test";
import express from "express";
import type { CurrentDirectAuthority } from "../lib/directMembershipAuthority";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??=
  "postgresql://bidbox_test:bidbox_test@127.0.0.1:1/bidbox_evidence_options_test";

const { createCanonicalEvidenceOptionsRouter } =
  await import("./canonicalEvidenceOptions");

const ORGANISATION_ID = "10000000-0000-4000-8000-000000000001";
const PROJECT_ID = "20000000-0000-4000-8000-000000000002";
const authority: CurrentDirectAuthority = {
  organisationId: ORGANISATION_ID,
  actorUserId: "30000000-0000-4000-8000-000000000003",
  membershipId: "40000000-0000-4000-8000-000000000004",
  roles: ["contributor"],
  permissions: new Set(["document:read"]),
};

describe("canonical evidence option route", () => {
  let server: Server;
  let origin = "";
  let currentAuthority: CurrentDirectAuthority | null = authority;
  const requested: Array<{ projectId?: string; limit: number }> = [];

  before(async () => {
    const app = express();
    app.use(
      "/api",
      createCanonicalEvidenceOptionsRouter({
        resolveAuthority: async () => currentAuthority,
        listOptions: async (scope, limit) => {
          requested.push({ projectId: scope.projectId, limit });
          return { items: [], truncated: false };
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

  test("returns only a bounded private requested project scope", async () => {
    const response = await fetch(
      `${origin}/api/canonical-evidence-options?projectId=${PROJECT_ID}&limit=25`,
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(requested.at(-1), { projectId: PROJECT_ID, limit: 25 });
    const body = (await response.json()) as Record<string, unknown>;
    assert.equal(body.organisationId, ORGANISATION_ID);
    assert.equal(body.projectId, PROJECT_ID);
  });

  test("fails closed for invalid scope or stale authority", async () => {
    assert.equal(
      (await fetch(`${origin}/api/canonical-evidence-options?projectId=bad`))
        .status,
      400,
    );
    currentAuthority = null;
    assert.equal(
      (await fetch(`${origin}/api/canonical-evidence-options`)).status,
      403,
    );
  });
});
