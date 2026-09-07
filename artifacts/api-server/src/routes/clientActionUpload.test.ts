import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import express, { type Request } from "express";
import type { AccessContext } from "../middlewares/tenancy";
import {
  GovernedClientUploadError,
  GovernedClientUploadService,
  type GovernedClientUploadRepository,
  type GovernedClientUploadScope,
} from "../lib/storageLifecycle/clientUpload";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??=
  "postgresql://bidbox_test:bidbox_test@127.0.0.1:1/bidbox_client_upload_route_test";

const { createClientActionUploadRouter } = await import("./clientActionUpload");

const ORG = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const ACTOR = "33333333-3333-4333-8333-333333333333";
const MEMBERSHIP = "44444444-4444-4444-8444-444444444444";
const RECORD = "55555555-5555-4555-8555-555555555555";
const SLOT = "66666666-6666-4666-8666-666666666666";
const INTENT = "77777777-7777-4777-8777-777777777777";
const LEASE = "88888888-8888-4888-8888-888888888888";

function access(source: AccessContext["source"]): AccessContext {
  return {
    organisationId: ORG,
    membershipId: source === "membership" ? MEMBERSHIP : null,
    membershipOrganisationId: source === "membership" ? ORG : null,
    source,
    roles: ["contributor"],
    permissions: new Set(["document:upload"]),
    breakGlassSessionId: source === "break_glass" ? MEMBERSHIP : null,
    partnerRelationshipId: source === "partner" ? MEMBERSHIP : null,
    partnerCoSigningRequired: source === "partner",
  };
}

function user() {
  return {
    id: ACTOR,
    clerkUserId: "client-upload-route-test",
    email: "client@example.test",
    name: "Named Client",
    role: "none",
    status: "active",
    lastLoginAt: null,
    version: 1,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

async function invoke(options: {
  source?: AccessContext["source"];
  finalize?: boolean;
  body?: unknown;
  idempotencyKey?: string;
  repository?: GovernedClientUploadRepository;
  commitBeforeResponse?: (req: Request) => Promise<void>;
}) {
  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => {
    Object.assign(request as Request & Record<string, unknown>, {
      localUser: user(),
      accessContext: access(options.source ?? "membership"),
    });
    next();
  });
  const repository: GovernedClientUploadRepository = options.repository ?? {
    async issueLease() {
      return {
        leaseId: LEASE,
        recordId: RECORD,
        slotId: SLOT,
        intentId: INTENT,
        recordVersion: 4,
        objectPath: `/objects/tenants/${ORG}/uploads/${LEASE}`,
        uploadUrl: "https://storage.example.test/signed",
        filename: "evidence.pdf",
        contentType: "application/pdf",
        sizeBytes: 42,
        declaredSha256: "a".repeat(64),
        expiresAt: "2026-08-13T10:15:00.000Z",
        replayed: false,
        lateRewriteClosure: "bounded-cushion-and-post-expiry-reconcile",
        rawFileAcceptedByApi: false,
        externalMessageSentByValo: false,
      };
    },
    async finalize() {
      return {
        leaseId: LEASE,
        recordId: RECORD,
        slotId: SLOT,
        intentId: INTENT,
        recordVersion: 5,
        documentId: LEASE,
        documentVersionId: "99999999-9999-4999-8999-999999999999",
        filename: "evidence.pdf",
        sha256: "a".repeat(64),
        sizeBytes: 42,
        detectedMime: "application/pdf",
        receiptSha256: "b".repeat(64),
        replayed: false,
        extractionStarted: false,
        rawFileAcceptedByApi: false,
        externalMessageSentByValo: false,
      };
    },
  };
  app.use(
    "/api",
    createClientActionUploadRouter({
      service: new GovernedClientUploadService(repository, async () => true),
      holdCritical: () => () => undefined,
      commitBeforeResponse: options.commitBeforeResponse ?? (async () => {}),
    }),
  );
  app.use(
    (
      error: unknown,
      _request: express.Request,
      response: express.Response,
      _next: express.NextFunction,
    ) => {
      response.status(500).json({
        error: error instanceof Error ? error.message : "route failed",
      });
    },
  );
  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const suffix = options.finalize ? `/${LEASE}/finalize` : "";
  try {
    return await fetch(
      `http://127.0.0.1:${address.port}/api/projects/${PROJECT}/client-actions/evidence-requests/${RECORD}/slots/${SLOT}/upload-leases${suffix}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(options.idempotencyKey
            ? { "idempotency-key": options.idempotencyKey }
            : {}),
        },
        body: JSON.stringify(
          options.body ?? { expectedVersion: 4, intentId: INTENT },
        ),
      },
    );
  } finally {
    server.close();
    await once(server, "close");
  }
}

test("lease route derives a direct scope and returns bounded metadata only", async () => {
  let captured: GovernedClientUploadScope | null = null;
  const response = await invoke({
    idempotencyKey: "client-upload-route-0001",
    repository: {
      async issueLease(scope) {
        captured = scope;
        return {
          leaseId: LEASE,
          recordId: RECORD,
          slotId: SLOT,
          intentId: INTENT,
          recordVersion: 4,
          objectPath: `/objects/tenants/${ORG}/uploads/${LEASE}`,
          uploadUrl: "https://storage.example.test/signed",
          filename: "evidence.pdf",
          contentType: "application/pdf",
          sizeBytes: 42,
          declaredSha256: "a".repeat(64),
          expiresAt: "2026-08-13T10:15:00.000Z",
          replayed: false,
          lateRewriteClosure: "bounded-cushion-and-post-expiry-reconcile",
          rawFileAcceptedByApi: false,
          externalMessageSentByValo: false,
        };
      },
      async finalize() {
        throw new Error("unexpected finalize");
      },
    },
  });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const actual = captured as GovernedClientUploadScope | null;
  assert.ok(actual);
  assert.equal(actual.organisationId, ORG);
  assert.equal(actual.projectId, PROJECT);
  assert.equal(actual.actor.id, ACTOR);
  const body = (await response.json()) as Record<string, unknown>;
  assert.equal(body.rawFileAcceptedByApi, false);
  assert.equal(
    body.lateRewriteClosure,
    "bounded-cushion-and-post-expiry-reconcile",
  );
  assert.equal(body.externalMessageSentByValo, false);
});

test("partner and break-glass entry are denied before repository work", async () => {
  for (const source of ["partner", "break_glass"] as const) {
    const response = await invoke({
      source,
      idempotencyKey: "client-upload-route-0002",
    });
    assert.equal(response.status, 403);
  }
});

test("route rejects raw-file fields and oversized metadata", async () => {
  const raw = await invoke({
    idempotencyKey: "client-upload-route-0003",
    body: {
      expectedVersion: 4,
      intentId: INTENT,
      rawFile: "base64-never-accepted",
    },
  });
  assert.equal(raw.status, 400);

  const oversized = await invoke({
    idempotencyKey: "client-upload-route-0004",
    body: {
      expectedVersion: 4,
      intentId: INTENT,
      padding: "x".repeat(5_000),
    },
  });
  assert.equal(oversized.status, 413);
});

test("finalize forwards only identity metadata and returns a governed receipt", async () => {
  const response = await invoke({
    finalize: true,
    idempotencyKey: "client-upload-route-0005",
  });
  assert.equal(response.status, 201);
  const body = (await response.json()) as Record<string, unknown>;
  assert.equal(body.documentId, LEASE);
  assert.equal(body.extractionStarted, false);
  assert.equal(body.rawFileAcceptedByApi, false);
  assert.equal(body.externalMessageSentByValo, false);
});

test("does not expose a lease until the tenant transaction commit resolves", async () => {
  const calls: string[] = [];
  let releaseCommit!: () => void;
  const commitGate = new Promise<void>((resolve) => {
    releaseCommit = resolve;
  });
  let responseSettled = false;
  const responsePromise = invoke({
    idempotencyKey: "client-upload-route-commit-0001",
    repository: {
      async issueLease() {
        calls.push("lease-created");
        return {
          leaseId: LEASE,
          recordId: RECORD,
          slotId: SLOT,
          intentId: INTENT,
          recordVersion: 4,
          objectPath: `/objects/tenants/${ORG}/uploads/${LEASE}`,
          uploadUrl: "https://storage.example.test/signed",
          filename: "evidence.pdf",
          contentType: "application/pdf",
          sizeBytes: 42,
          declaredSha256: "a".repeat(64),
          expiresAt: "2026-08-13T10:15:00.000Z",
          replayed: false,
          lateRewriteClosure: "bounded-cushion-and-post-expiry-reconcile",
          rawFileAcceptedByApi: false,
          externalMessageSentByValo: false,
        };
      },
      async finalize() {
        throw new Error("unexpected finalize");
      },
    },
    commitBeforeResponse: async () => {
      calls.push("commit-requested");
      await commitGate;
      calls.push("commit-acknowledged");
    },
  }).then((response) => {
    responseSettled = true;
    calls.push("response-received");
    return response;
  });

  while (!calls.includes("commit-requested")) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.equal(responseSettled, false);
  assert.deepEqual(calls, ["lease-created", "commit-requested"]);
  releaseCommit();
  const response = await responsePromise;
  assert.equal(response.status, 201);
  assert.deepEqual(calls, [
    "lease-created",
    "commit-requested",
    "commit-acknowledged",
    "response-received",
  ]);
});

test("returns no signed lease when the tenant commit fails", async () => {
  const response = await invoke({
    idempotencyKey: "client-upload-route-commit-0002",
    commitBeforeResponse: async () => {
      throw new Error("simulated commit failure");
    },
  });
  assert.equal(response.status, 500);
  const body = (await response.json()) as Record<string, unknown>;
  assert.equal(body.error, "simulated commit failure");
  assert.equal(body.uploadUrl, undefined);
});

test("governed terminal errors are not exposed before their cleanup state commits", async () => {
  let releaseCommit!: () => void;
  const commitGate = new Promise<void>((resolve) => {
    releaseCommit = resolve;
  });
  let commitRequested = false;
  let responseSettled = false;
  const responsePromise = invoke({
    idempotencyKey: "client-upload-route-commit-0003",
    repository: {
      async issueLease() {
        throw new GovernedClientUploadError(
          "intake_rejected",
          "Scanner rejected the upload.",
        );
      },
      async finalize() {
        throw new Error("unexpected finalize");
      },
    },
    commitBeforeResponse: async () => {
      commitRequested = true;
      await commitGate;
    },
  }).then((response) => {
    responseSettled = true;
    return response;
  });

  while (!commitRequested) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.equal(responseSettled, false);
  releaseCommit();
  const response = await responsePromise;
  assert.equal(response.status, 422);
  const body = (await response.json()) as Record<string, unknown>;
  assert.equal(body.code, "intake_rejected");
});
