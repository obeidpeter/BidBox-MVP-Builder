import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import express, { type ErrorRequestHandler, type Request } from "express";
import type { AccessContext } from "../middlewares/tenancy";
import {
  RetentionCompletionError,
  type RetentionActionStatus,
  type RetentionCompletionRepository,
  type RetentionCompletionSnapshot,
  type RetentionRequestView,
} from "../lib/retentionCompletion/contracts";
import { RetentionCompletionService } from "../lib/retentionCompletion/service";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??=
  "postgresql://bidbox_test:bidbox_test@127.0.0.1:1/bidbox_retention_completion_route_test";

const { createRetentionCompletionRouter } =
  await import("./retentionCompletion");

const id = (digit: string) =>
  `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`;
const organisationId = id("1");
const actorUserId = id("2");
const membershipId = id("3");
const requestId = id("4");
const projectId = id("5");
const actionId = id("6");

function requestView(): RetentionRequestView {
  return {
    id: requestId,
    projectId: projectId,
    subjectProjectId: projectId,
    requestedByUserId: actorUserId,
    requestedByName: "Retention Operator",
    reason: "window elapsed",
    dueAt: "2026-08-01T00:00:00.000Z",
    completedAt: null,
    status: "pending",
    completionProtocolVersion: 1,
    version: 1,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
}

function snapshot(status: RetentionActionStatus): RetentionCompletionSnapshot {
  const request = requestView();
  request.projectId = status === "pending" ? projectId : null;
  request.status = status === "certified" ? "completed" : "reconciling";
  request.version = status === "certified" ? 3 : 2;
  return {
    request,
    action: {
      id: actionId,
      retentionRequestId: requestId,
      subjectProjectId: projectId,
      status,
      version: status === "detached" ? 3 : status === "reconciled" ? 4 : 5,
      sourceManifest: {},
      sourceManifestSha256: "a".repeat(64),
      purgeReceipt: {},
      purgeReceiptSha256: "c".repeat(64),
      purgedAt: "2026-08-22T11:30:00.000Z",
      reconciliationManifest: status === "detached" ? null : {},
      reconciliationManifestSha256:
        status === "detached" ? null : "b".repeat(64),
      preparedByUserId: status === "detached" ? null : actorUserId,
      preparedByName: status === "detached" ? null : "Retention Maker",
      preparedAt: status === "detached" ? null : "2026-08-22T12:00:00.000Z",
      checkedByUserId: status === "certified" ? id("7") : null,
      checkedByName: status === "certified" ? "Retention Checker" : null,
      checkedAt: status === "certified" ? "2026-08-22T12:05:00.000Z" : null,
      createdAt: "2026-08-22T11:00:00.000Z",
      updatedAt: "2026-08-22T12:00:00.000Z",
    },
    blockers: [],
    objectReconciliation: {
      expected: 0,
      detached: 0,
      reconciled: 0,
      pending: 0,
      deadLetters: 0,
    },
    objectBindings: [],
    retainedCategories: [],
    certificate: null,
    permissions: {
      canStart: false,
      canReconcile: status === "detached",
      canCertify: status === "reconciled",
    },
    generatedAt: "2026-08-22T12:00:00.000Z",
  };
}

test("retention routes enforce CAS/idempotency controls and expose three phases", async () => {
  const calls: string[] = [];
  let detachResultStatus: RetentionActionStatus = "detached";
  let reconcileResultStatus: RetentionActionStatus = "reconciled";
  const service = {
    async readiness() {
      return {
        activated: true,
        manifestValid: true,
        environmentOptIn: true,
        workflow: "durable_two_phase_detach_reconcile_certify",
        activationBlockers: [],
        evidenceBlockers: [],
        makerCheckerRequired: true,
        checkedAt: "2026-08-22T12:00:00.000Z",
        permissions: {
          canStart: true,
          canReconcile: true,
          canCertify: true,
        },
      };
    },
    async list() {
      return [requestView()];
    },
    async read() {
      return snapshot("detached");
    },
    async detach() {
      calls.push("detach");
      return snapshot(detachResultStatus);
    },
    async reconcile() {
      calls.push("reconcile");
      return snapshot(reconcileResultStatus);
    },
    async certify() {
      calls.push("certify");
      return snapshot("certified");
    },
  } as unknown as RetentionCompletionService;

  let commits = 0;
  let holds = 0;
  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => {
    (request as Request & { accessContext: AccessContext }).accessContext = {
      organisationId,
      membershipId,
      membershipOrganisationId: organisationId,
      source: "membership",
      roles: [],
      permissions: new Set(["retention:manage"]),
      breakGlassSessionId: null,
      partnerRelationshipId: null,
      partnerCoSigningRequired: false,
    };
    next();
  });
  app.use(
    createRetentionCompletionRouter({
      service,
      resolveScope: () => ({
        organisationId,
        actorUserId,
        actorMembershipId: membershipId,
      }),
      holdCritical: () => {
        holds += 1;
        return () => {};
      },
      commitBeforeResponse: async () => {
        commits += 1;
      },
    }),
  );
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no address");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const list = await fetch(`${base}/retention-requests`);
    assert.equal(list.status, 200);
    assert.equal(((await list.json()) as unknown[]).length, 1);
    assert.equal(list.headers.get("cache-control"), "private, no-store");

    const missingCas = await fetch(
      `${base}/retention-requests/${requestId}/complete`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          attestation: "I confirm the governed project detach operation.",
        }),
      },
    );
    assert.equal(missingCas.status, 428);
    assert.deepEqual(calls, []);

    for (const [path, version, resultVersion] of [
      [`retention-requests/${requestId}/complete`, 1, 3],
      [`retention-actions/${actionId}/reconcile`, 3, 4],
      [`retention-actions/${actionId}/certify`, 4, 5],
    ] as const) {
      const response = await fetch(`${base}/${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "If-Match": `"${version}"`,
          "Idempotency-Key": `retention-route-test-${version}-0000`,
        },
        body: JSON.stringify({
          attestation: "I confirm the exact governed evidence manifest.",
        }),
      });
      assert.equal(response.status, path.endsWith("complete") ? 202 : 200);
      assert.equal(response.headers.get("etag"), `"${resultVersion}"`);
    }

    detachResultStatus = "certified";
    reconcileResultStatus = "certified";
    for (const [path, version, expectedStatus] of [
      [`retention-requests/${requestId}/complete`, 1, 202],
      [`retention-actions/${actionId}/reconcile`, 3, 200],
    ] as const) {
      const replay = await fetch(`${base}/${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "If-Match": `"${version}"`,
          "Idempotency-Key": `retention-route-test-${version}-0000`,
        },
        body: JSON.stringify({
          attestation: "I confirm the exact governed evidence manifest.",
        }),
      });
      assert.equal(replay.status, expectedStatus);
      assert.equal(replay.headers.get("etag"), '"5"');
    }

    assert.deepEqual(calls, [
      "detach",
      "reconcile",
      "certify",
      "detach",
      "reconcile",
    ]);
    assert.equal(holds, 5);
    assert.equal(commits, 5);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("inactive mutations return checked readiness without reaching repository mutations", async () => {
  const events: string[] = [];
  let mutationCalls = 0;
  let readinessFailure: "none" | "persistence" | "authority" | "unexpected" =
    "none";
  const unexpectedMutation = async (): Promise<RetentionCompletionSnapshot> => {
    mutationCalls += 1;
    throw new Error("inactive workflow reached a repository mutation");
  };
  const repository: RetentionCompletionRepository = {
    async databaseNow() {
      events.push("databaseNow");
      if (readinessFailure === "persistence") {
        throw new RetentionCompletionError(
          "persistence_unavailable",
          "Retention evidence storage is unavailable.",
        );
      }
      if (readinessFailure === "authority") {
        throw new RetentionCompletionError(
          "not_found_or_not_authorized",
          "Current direct retention authority is required.",
        );
      }
      if (readinessFailure === "unexpected") {
        throw new Error("unexpected database failure");
      }
      return new Date("2026-08-22T12:00:00.000Z");
    },
    async list() {
      throw new Error("unexpected list");
    },
    async read() {
      throw new Error("unexpected read");
    },
    detach: unexpectedMutation,
    reconcile: unexpectedMutation,
    certify: unexpectedMutation,
  };
  const service = new RetentionCompletionService({
    repository,
    environment: {},
  });
  let holds = 0;
  let releases = 0;
  let commits = 0;
  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => {
    (request as Request & { accessContext: AccessContext }).accessContext = {
      organisationId,
      membershipId,
      membershipOrganisationId: organisationId,
      source: "membership",
      roles: [],
      permissions: new Set(["retention:manage"]),
      breakGlassSessionId: null,
      partnerRelationshipId: null,
      partnerCoSigningRequired: false,
    };
    next();
  });
  app.use(
    createRetentionCompletionRouter({
      service,
      resolveScope: () => ({
        organisationId,
        actorUserId,
        actorMembershipId: membershipId,
      }),
      holdCritical: () => {
        holds += 1;
        return (error?: unknown) => {
          releases += 1;
          events.push(error ? "release:error" : "release");
        };
      },
      commitBeforeResponse: async () => {
        commits += 1;
      },
    }),
  );
  const unexpectedErrorHandler: ErrorRequestHandler = (
    _error,
    _request,
    response,
    _next,
  ) => {
    events.push("next:error");
    response.status(500).json({ error: "Internal test failure." });
  };
  app.use(unexpectedErrorHandler);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no address");
  const base = `http://127.0.0.1:${address.port}`;
  const requestOptions = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "If-Match": '"1"',
      "Idempotency-Key": "retention-inactive-route-0001",
    },
    body: JSON.stringify({
      attestation: "I confirm this governed retention operation.",
    }),
  };
  try {
    const inactive = await fetch(
      `${base}/retention-requests/${requestId}/complete`,
      requestOptions,
    );
    assert.equal(inactive.status, 503);
    const inactiveBody = (await inactive.json()) as Record<string, unknown>;
    assert.deepEqual(Object.keys(inactiveBody).sort(), [
      "code",
      "error",
      "readiness",
      "sideEffectsApplied",
    ]);
    assert.equal(inactiveBody.code, "RETENTION_COMPLETION_NOT_ACTIVATED");
    assert.equal(inactiveBody.sideEffectsApplied, false);
    assert.equal(
      (inactiveBody.readiness as { activated: boolean }).activated,
      false,
    );
    assert.deepEqual(events, ["databaseNow", "release"]);

    events.length = 0;
    readinessFailure = "persistence";
    const unavailable = await fetch(
      `${base}/retention-requests/${requestId}/complete`,
      requestOptions,
    );
    assert.equal(unavailable.status, 503);
    const unavailableBody = (await unavailable.json()) as Record<
      string,
      unknown
    >;
    assert.deepEqual(Object.keys(unavailableBody).sort(), [
      "code",
      "error",
      "sideEffectsApplied",
    ]);
    assert.equal(unavailableBody.code, "persistence_unavailable");
    assert.equal(unavailableBody.sideEffectsApplied, false);
    assert.deepEqual(events, ["databaseNow", "release"]);

    events.length = 0;
    readinessFailure = "authority";
    const revoked = await fetch(
      `${base}/retention-requests/${requestId}/complete`,
      requestOptions,
    );
    assert.equal(revoked.status, 404);
    const revokedBody = (await revoked.json()) as Record<string, unknown>;
    assert.deepEqual(Object.keys(revokedBody).sort(), [
      "code",
      "error",
      "sideEffectsApplied",
    ]);
    assert.equal(revokedBody.code, "not_found_or_not_authorized");
    assert.equal(revokedBody.sideEffectsApplied, false);
    assert.deepEqual(events, ["databaseNow", "release"]);

    events.length = 0;
    readinessFailure = "unexpected";
    const unexpected = await fetch(
      `${base}/retention-requests/${requestId}/complete`,
      requestOptions,
    );
    assert.equal(unexpected.status, 500);
    assert.deepEqual(await unexpected.json(), {
      error: "Internal test failure.",
    });
    assert.deepEqual(events, ["databaseNow", "release:error", "next:error"]);
    assert.equal(mutationCalls, 0);
    assert.equal(holds, 4);
    assert.equal(releases, 4);
    assert.equal(commits, 0);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
