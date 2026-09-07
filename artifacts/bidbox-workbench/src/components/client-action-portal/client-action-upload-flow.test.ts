import { describe, expect, it, vi } from "vitest";
import type {
  ClientActionUploadBinding,
  ClientActionUploadLeaseGrant,
} from "./client-action-upload-contract";
import {
  ClientActionUploadFlowError,
  runClientActionUpload,
} from "./client-action-upload-flow";

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "99999999-9999-4999-8999-999999999999";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const RECORD = "33333333-3333-4333-8333-333333333333";
const SLOT = "44444444-4444-4444-8444-444444444444";
const INTENT = "55555555-5555-4555-8555-555555555555";
const LEASE = "66666666-6666-4666-8666-666666666666";
const DOC_VERSION = "77777777-7777-4777-8777-777777777777";
const SHA = "a".repeat(64);

const binding: ClientActionUploadBinding = {
  organisationId: ORG_A,
  projectId: PROJECT,
  recordId: RECORD,
  slotId: SLOT,
  intentId: INTENT,
  expectedRecordVersion: 8,
  filename: "proof.pdf",
  contentType: "application/pdf",
  sizeBytes: 3,
  declaredSha256: SHA,
  acceptedContentTypes: ["application/pdf"],
};

const lease: ClientActionUploadLeaseGrant = {
  leaseId: LEASE,
  recordId: RECORD,
  slotId: SLOT,
  intentId: INTENT,
  recordVersion: 8,
  objectPath: `/objects/tenants/${ORG_A}/uploads/${LEASE}`,
  uploadUrl: "https://storage.example.test/signed?token=private",
  filename: binding.filename,
  contentType: binding.contentType,
  sizeBytes: binding.sizeBytes,
  declaredSha256: SHA,
  expiresAt: "2026-08-13T12:15:00.000Z",
  replayed: false,
  rawFileAcceptedByApi: false,
  externalMessageSentByValo: false,
  lateRewriteClosure: "bounded-cushion-and-post-expiry-reconcile",
};

function file() {
  return new File([new Uint8Array([1, 2, 3])], binding.filename, {
    type: binding.contentType,
  });
}

function receipt() {
  return {
    leaseId: LEASE,
    recordId: RECORD,
    slotId: SLOT,
    intentId: INTENT,
    recordVersion: 9,
    documentId: LEASE,
    documentVersionId: DOC_VERSION,
    filename: binding.filename,
    sha256: SHA,
    sizeBytes: binding.sizeBytes,
    detectedMime: "application/pdf",
    receiptSha256: "b".repeat(64),
    replayed: false,
    extractionStarted: false,
    rawFileAcceptedByApi: false,
    externalMessageSentByValo: false,
  };
}

describe("runClientActionUpload", () => {
  it("sends bytes only through the signed PUT and finalizes the same lease key", async () => {
    const issueLease = vi.fn(async () => lease);
    const putSignedObject = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
    }));
    const finalize = vi.fn(async () => receipt());
    const assertCurrent = vi.fn();
    const progress = vi.fn();

    const result = await runClientActionUpload(
      {
        binding,
        file: file(),
        idempotencyKey: "client-upload:88888888-8888-4888-8888-888888888888",
      },
      {
        assertCurrent,
        issueLease,
        putSignedObject,
        finalize,
        digest: async () => SHA,
        onProgress: progress,
      },
    );

    expect(result.receiptSha256).toBe("b".repeat(64));
    expect(issueLease).toHaveBeenCalledWith(
      expect.objectContaining({
        binding,
        idempotencyKey: "client-upload:88888888-8888-4888-8888-888888888888",
      }),
    );
    expect(putSignedObject).toHaveBeenCalledWith(
      lease.uploadUrl,
      expect.objectContaining({
        method: "PUT",
        body: expect.any(File),
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
      }),
    );
    expect(finalize).toHaveBeenCalledWith(
      expect.objectContaining({
        lease,
        idempotencyKey: "client-upload:88888888-8888-4888-8888-888888888888",
      }),
    );
    expect(assertCurrent.mock.calls.length).toBeGreaterThanOrEqual(5);
    expect(progress).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: "completed" }),
    );
  });

  it("fails closed before PUT when the active tenant changes after lease issue", async () => {
    let activeOrganisationId = ORG_A;
    const putSignedObject = vi.fn();
    const finalize = vi.fn();

    await expect(
      runClientActionUpload(
        {
          binding,
          file: file(),
          idempotencyKey: "client-upload:88888888-8888-4888-8888-888888888888",
        },
        {
          assertCurrent: () => {
            if (activeOrganisationId !== ORG_A) {
              throw new Error(`stale tenant ${ORG_B}`);
            }
          },
          issueLease: async () => {
            activeOrganisationId = ORG_B;
            return lease;
          },
          putSignedObject,
          finalize,
          digest: async () => SHA,
        },
      ),
    ).rejects.toMatchObject({
      retry: "reload_scope",
      serverLeaseMayExist: true,
    } satisfies Partial<ClientActionUploadFlowError>);
    expect(putSignedObject).not.toHaveBeenCalled();
    expect(finalize).not.toHaveBeenCalled();
  });

  it("requests no lease when selected bytes do not match the intent digest", async () => {
    const issueLease = vi.fn();
    await expect(
      runClientActionUpload(
        {
          binding,
          file: file(),
          idempotencyKey: "client-upload:88888888-8888-4888-8888-888888888888",
        },
        {
          assertCurrent: () => undefined,
          issueLease,
          putSignedObject: vi.fn(),
          finalize: vi.fn(),
          digest: async () => "c".repeat(64),
        },
      ),
    ).rejects.toMatchObject({ phase: "checking", retry: "none" });
    expect(issueLease).not.toHaveBeenCalled();
  });

  it("reports the default-off operational gate without implying a server lease", async () => {
    await expect(
      runClientActionUpload(
        {
          binding,
          file: file(),
          idempotencyKey: "client-upload:88888888-8888-4888-8888-888888888888",
        },
        {
          assertCurrent: () => undefined,
          issueLease: async () => {
            throw {
              status: 503,
              data: {
                code: "unavailable",
                activation: "blocked",
                sideEffectsApplied: false,
              },
            };
          },
          putSignedObject: vi.fn(),
          finalize: vi.fn(),
          digest: async () => SHA,
        },
      ),
    ).rejects.toMatchObject({
      phase: "leasing",
      retry: "none",
      serverLeaseMayExist: false,
      message: expect.stringMatching(/uploads are not active/i),
    });
  });
});
