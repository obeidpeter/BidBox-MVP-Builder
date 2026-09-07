import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import express, { type Request } from "express";
import { ClientActionError } from "../lib/clientActionPortal/errors";
import type {
  ClientActionAuthority,
  ClientActionService as ClientActionServiceType,
} from "../lib/clientActionPortal/service";
import type { AccessContext } from "../middlewares/tenancy";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??=
  "postgresql://bidbox_test:bidbox_test@127.0.0.1:1/bidbox_test";

const { createClientActionPortalRouter } = await import("./clientActionPortal");
const { ClientActionService, InMemoryClientActionRepository } =
  await import("../lib/clientActionPortal/service");

const ORGANISATION_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const ACTOR_USER_ID = "33333333-3333-4333-8333-333333333333";
const RECIPIENT_USER_ID = "44444444-4444-4444-8444-444444444444";
const MEMBERSHIP_ID = "55555555-5555-4555-8555-555555555555";

test("lists a private exact-scope name-only client action authority directory", async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const accessContext: AccessContext = {
      organisationId: ORGANISATION_ID,
      membershipId: MEMBERSHIP_ID,
      membershipOrganisationId: ORGANISATION_ID,
      source: "membership",
      roles: ["contributor"],
      permissions: new Set(["project:read", "evidence:write"]),
      breakGlassSessionId: null,
      partnerRelationshipId: null,
      partnerCoSigningRequired: false,
    };
    Object.assign(req as Request & Record<string, unknown>, {
      localUser: { id: ACTOR_USER_ID, role: "contributor" },
      accessContext,
    });
    next();
  });
  app.use(
    "/api",
    createClientActionPortalRouter({
      service: null as unknown as ClientActionServiceType,
      authorityDirectory: {
        list: async (scope, limit) => {
          assert.deepEqual(scope, {
            organisationId: ORGANISATION_ID,
            projectId: PROJECT_ID,
            actorUserId: ACTOR_USER_ID,
          });
          assert.equal(limit, 101);
          return [{ userId: RECIPIENT_USER_ID, name: "Evidence Contributor" }];
        },
      },
    }),
  );
  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/projects/${PROJECT_ID}/client-actions/authorities`,
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await response.json(), {
      organisationId: ORGANISATION_ID,
      projectId: PROJECT_ID,
      items: [{ userId: RECIPIENT_USER_ID, name: "Evidence Contributor" }],
      limit: 100,
      truncated: false,
    });
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("raw evidence-request API rejects a named active read-only recipient", async () => {
  const readOnlyUserId = "66666666-6666-4666-8666-666666666666";
  const repository = new InMemoryClientActionRepository();
  const authority: ClientActionAuthority = {
    async assertProject() {},
    async assertNamedHuman(_scope, userId) {
      if (userId !== ACTOR_USER_ID && userId !== readOnlyUserId) {
        throw new ClientActionError("scope_denied", "Named human denied.");
      }
    },
    async assertEvidenceRequestRecipient() {
      throw new ClientActionError(
        "scope_denied",
        "Evidence request recipient denied.",
      );
    },
    async assertCanonicalDocument() {},
    async assertReleasedPackage() {},
  };
  let sequence = 1;
  const service = new ClientActionService({
    repository,
    authority,
    now: () => new Date("2026-08-11T10:00:00.000Z"),
    idFactory: () =>
      `00000000-0000-4000-8000-${String(sequence++).padStart(12, "0")}`,
  });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const accessContext: AccessContext = {
      organisationId: ORGANISATION_ID,
      membershipId: MEMBERSHIP_ID,
      membershipOrganisationId: ORGANISATION_ID,
      source: "membership",
      roles: ["contributor"],
      permissions: new Set(["project:read", "evidence:write"]),
      breakGlassSessionId: null,
      partnerRelationshipId: null,
      partnerCoSigningRequired: false,
    };
    Object.assign(req as Request & Record<string, unknown>, {
      localUser: { id: ACTOR_USER_ID, role: "contributor" },
      accessContext,
    });
    next();
  });
  app.use("/api", createClientActionPortalRouter({ service }));
  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/projects/${PROJECT_ID}/client-actions/evidence-requests`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          purpose: "tender_evidence",
          purposeStatement:
            "A raw UUID must not bypass document-upload authority.",
          recipientUserId: readOnlyUserId,
          slots: [{ label: "Evidence", required: true }],
        }),
      },
    );
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), {
      error: "Evidence request recipient denied.",
      code: "scope_denied",
    });
    assert.deepEqual(
      await repository.list({
        organisationId: ORGANISATION_ID,
        projectId: PROJECT_ID,
        actorUserId: ACTOR_USER_ID,
      }),
      [],
    );
  } finally {
    server.close();
    await once(server, "close");
  }
});
