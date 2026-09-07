import { beforeEach, describe, expect, it } from "vitest";
import type { ClientActionUploadBinding } from "./client-action-upload-contract";
import {
  clientActionUploadRecoveryScope,
  clientActionUploadRecoveryStorageKey,
  readClientActionUploadRecovery,
  writeClientActionUploadRecovery,
} from "./client-action-upload-recovery";

const binding: ClientActionUploadBinding = {
  organisationId: "11111111-1111-4111-8111-111111111111",
  projectId: "22222222-2222-4222-8222-222222222222",
  recordId: "33333333-3333-4333-8333-333333333333",
  slotId: "44444444-4444-4444-8444-444444444444",
  intentId: "55555555-5555-4555-8555-555555555555",
  expectedRecordVersion: 3,
  filename: "proof.pdf",
  contentType: "application/pdf",
  sizeBytes: 3,
  declaredSha256: "a".repeat(64),
  acceptedContentTypes: ["application/pdf"],
};
const membershipId = "66666666-6666-4666-8666-666666666666";
const actorUserId = "77777777-7777-4777-8777-777777777777";
const idempotencyKey = "client-upload:88888888-8888-4888-8888-888888888888";

describe("Client Action upload recovery marker", () => {
  beforeEach(() => sessionStorage.clear());

  it("persists only closed safe retry material for the exact complete scope", () => {
    const scope = clientActionUploadRecoveryScope({
      binding,
      membershipId,
      actorUserId,
    });
    writeClientActionUploadRecovery(sessionStorage, {
      schema: "valo.client-action-upload-recovery/v1",
      scope,
      idempotencyKey,
      leaseId: "99999999-9999-4999-8999-999999999999",
      expiresAt: "2026-08-13T12:15:00.000Z",
      lateRewriteClosure: "bounded-cushion-and-post-expiry-reconcile",
    });

    const serialized = sessionStorage.getItem(
      clientActionUploadRecoveryStorageKey(scope),
    );
    expect(serialized).not.toMatch(
      /uploadUrl|objectPath|filename|sha256|bytes/u,
    );
    expect(readClientActionUploadRecovery(sessionStorage, scope)).toMatchObject(
      {
        idempotencyKey,
        leaseId: "99999999-9999-4999-8999-999999999999",
      },
    );
  });

  it("does not expose tenant A recovery to tenant B", () => {
    const tenantA = clientActionUploadRecoveryScope({
      binding,
      membershipId,
      actorUserId,
    });
    const tenantB = {
      ...tenantA,
      organisationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    };
    writeClientActionUploadRecovery(sessionStorage, {
      schema: "valo.client-action-upload-recovery/v1",
      scope: tenantA,
      idempotencyKey,
      leaseId: null,
      expiresAt: null,
      lateRewriteClosure: null,
    });
    expect(readClientActionUploadRecovery(sessionStorage, tenantB)).toBeNull();
    expect(
      readClientActionUploadRecovery(sessionStorage, tenantA),
    ).not.toBeNull();
  });

  it("removes corrupt or additional-field markers instead of recovering them", () => {
    const scope = clientActionUploadRecoveryScope({
      binding,
      membershipId,
      actorUserId,
    });
    const key = clientActionUploadRecoveryStorageKey(scope);
    sessionStorage.setItem(
      key,
      JSON.stringify({
        schema: "valo.client-action-upload-recovery/v1",
        scope,
        idempotencyKey,
        leaseId: null,
        expiresAt: null,
        lateRewriteClosure: null,
        signedUrl: "https://must-not-persist.invalid",
      }),
    );
    expect(readClientActionUploadRecovery(sessionStorage, scope)).toBeNull();
    expect(sessionStorage.getItem(key)).toBeNull();
  });

  it("enforces the marker limit as UTF-8 bytes", () => {
    const scope = clientActionUploadRecoveryScope({
      binding,
      membershipId,
      actorUserId,
    });
    expect(() =>
      writeClientActionUploadRecovery(sessionStorage, {
        schema: "valo.client-action-upload-recovery/v1",
        scope,
        idempotencyKey: "\u{1f600}".repeat(128),
        leaseId: null,
        expiresAt: null,
        lateRewriteClosure: null,
      }),
    ).toThrow(/Invalid client-upload recovery marker/u);
  });
});
