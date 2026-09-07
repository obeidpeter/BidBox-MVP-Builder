import assert from "node:assert/strict";
import test from "node:test";
import type { AccessContext } from "../accessContext";
import {
  GovernedClientUploadError,
  GovernedClientUploadService,
  type GovernedClientUploadRepository,
  type GovernedClientUploadScope,
} from "./clientUpload";
import { createClientUploadLeaseEnvelope } from "./contracts";

process.env.DATABASE_URL ??=
  "postgresql://bidbox_test:bidbox_test@127.0.0.1:1/bidbox_client_upload_test";

const { clientUploadLeaseId } = await import("./clientUploadRepository");

const ORG = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const ACTOR = "33333333-3333-4333-8333-333333333333";
const MEMBERSHIP = "44444444-4444-4444-8444-444444444444";
const RECORD = "55555555-5555-4555-8555-555555555555";
const SLOT = "66666666-6666-4666-8666-666666666666";
const INTENT = "77777777-7777-4777-8777-777777777777";

function scope(): GovernedClientUploadScope {
  const accessContext: AccessContext = {
    organisationId: ORG,
    membershipId: MEMBERSHIP,
    membershipOrganisationId: ORG,
    source: "membership",
    roles: ["contributor"],
    permissions: new Set(["document:upload"]),
    breakGlassSessionId: null,
    partnerRelationshipId: null,
    partnerCoSigningRequired: false,
  };
  return {
    organisationId: ORG,
    projectId: PROJECT,
    accessContext,
    actor: {
      id: ACTOR,
      clerkUserId: "client-upload-test",
      email: "client@example.test",
      name: "Named Client",
      role: "none",
      status: "active",
      lastLoginAt: null,
      version: 1,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    },
  };
}

test("service accepts only an exact metadata command and normalizes identities", async () => {
  let received: unknown;
  const repository: GovernedClientUploadRepository = {
    async issueLease(_scope, command) {
      received = command;
      return {} as never;
    },
    async finalize() {
      throw new Error("unexpected finalize");
    },
  };
  const service = new GovernedClientUploadService(repository, async () => true);
  await service.issueLease({
    scope: scope(),
    recordId: RECORD.toUpperCase(),
    slotId: SLOT.toUpperCase(),
    idempotencyKey: "client-upload-key-0001",
    body: { expectedVersion: 4, intentId: INTENT.toUpperCase() },
  });
  assert.deepEqual(received, {
    recordId: RECORD,
    slotId: SLOT,
    intentId: INTENT,
    expectedRecordVersion: 4,
    idempotencyKey: "client-upload-key-0001",
  });

  assert.throws(
    () =>
      service.issueLease({
        scope: scope(),
        recordId: RECORD,
        slotId: SLOT,
        idempotencyKey: "client-upload-key-0001",
        body: {
          expectedVersion: 4,
          intentId: INTENT,
          rawFile: "never accepted",
        },
      }),
    (error: unknown) =>
      error instanceof GovernedClientUploadError &&
      error.code === "invalid_request",
  );
});

test("finalization requires the same stable idempotency binding", async () => {
  let received: unknown;
  const repository: GovernedClientUploadRepository = {
    async issueLease() {
      throw new Error("unexpected issue");
    },
    async finalize(_scope, command) {
      received = command;
      return {} as never;
    },
  };
  const service = new GovernedClientUploadService(repository);
  const envelope = createClientUploadLeaseEnvelope({
    idempotencyKey: "client-upload-key-0002",
    actorUserId: ACTOR,
    recordId: RECORD,
    recordVersion: 4,
    slotId: SLOT,
    intentId: INTENT,
    contentType: "application/pdf",
  });
  const leaseId = clientUploadLeaseId(ORG, envelope.idempotencyKeySha256);
  await service.finalize({
    scope: scope(),
    recordId: RECORD,
    slotId: SLOT,
    leaseId,
    idempotencyKey: "client-upload-key-0002",
    body: { expectedVersion: 4, intentId: INTENT },
  });
  assert.deepEqual(received, {
    recordId: RECORD,
    slotId: SLOT,
    leaseId,
    intentId: INTENT,
    expectedRecordVersion: 4,
    idempotencyKey: "client-upload-key-0002",
  });
  assert.equal(
    clientUploadLeaseId(ORG, envelope.idempotencyKeySha256),
    leaseId,
  );
  assert.notEqual(
    clientUploadLeaseId(
      "88888888-8888-4888-8888-888888888888",
      envelope.idempotencyKeySha256,
    ),
    leaseId,
  );
});

test("short or padded idempotency keys fail before repository work", async () => {
  const service = new GovernedClientUploadService({
    async issueLease() {
      throw new Error("repository must not run");
    },
    async finalize() {
      throw new Error("repository must not run");
    },
  });
  for (const key of [undefined, "short", " client-upload-key-0003"] as const) {
    assert.throws(
      () =>
        service.issueLease({
          scope: scope(),
          recordId: RECORD,
          slotId: SLOT,
          idempotencyKey: key,
          body: { expectedVersion: 4, intentId: INTENT },
        }),
      GovernedClientUploadError,
    );
  }
});

test("lease issuance is fail-closed without an explicit operational activation", async () => {
  let repositoryCalled = false;
  const service = new GovernedClientUploadService({
    async issueLease() {
      repositoryCalled = true;
      return {} as never;
    },
    async finalize() {
      throw new Error("unexpected finalize");
    },
  });
  await assert.rejects(
    service.issueLease({
      scope: scope(),
      recordId: RECORD,
      slotId: SLOT,
      idempotencyKey: "client-upload-key-gated-0004",
      body: { expectedVersion: 4, intentId: INTENT },
    }),
    (error: unknown) =>
      error instanceof GovernedClientUploadError &&
      error.code === "unavailable" &&
      error.details?.activation === "blocked" &&
      error.details?.sideEffectsApplied === false,
  );
  assert.equal(repositoryCalled, false);
});
