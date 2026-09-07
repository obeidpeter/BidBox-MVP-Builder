import { describe, expect, it } from "vitest";
import {
  adaptClientActionUploadFinalizationReceipt,
  adaptClientActionUploadLeaseGrant,
  type ClientActionUploadBinding,
} from "./client-action-upload-contract";

const ORG = "11111111-1111-4111-8111-111111111111";
const RECORD = "22222222-2222-4222-8222-222222222222";
const SLOT = "33333333-3333-4333-8333-333333333333";
const INTENT = "44444444-4444-4444-8444-444444444444";
const LEASE = "55555555-5555-4555-8555-555555555555";
const VERSION = "66666666-6666-4666-8666-666666666666";
const SHA = "a".repeat(64);

const binding: ClientActionUploadBinding = {
  organisationId: ORG,
  projectId: "77777777-7777-4777-8777-777777777777",
  recordId: RECORD,
  slotId: SLOT,
  intentId: INTENT,
  expectedRecordVersion: 4,
  filename: "current-certificate.pdf",
  contentType: "application/pdf",
  sizeBytes: 512,
  declaredSha256: SHA,
  acceptedContentTypes: ["application/pdf"],
};

function rawLease() {
  return {
    leaseId: LEASE,
    recordId: RECORD,
    slotId: SLOT,
    intentId: INTENT,
    recordVersion: 4,
    objectPath: `/objects/tenants/${ORG}/uploads/${LEASE}`,
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
}

function rawReceipt() {
  return {
    leaseId: LEASE,
    recordId: RECORD,
    slotId: SLOT,
    intentId: INTENT,
    recordVersion: 5,
    documentId: LEASE,
    documentVersionId: VERSION,
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

describe("governed Client Action upload adapters", () => {
  it("accepts only the exact tenant path and acknowledged lease binding", () => {
    const lease = adaptClientActionUploadLeaseGrant(rawLease(), binding);
    expect(lease.objectPath).toBe(`/objects/tenants/${ORG}/uploads/${LEASE}`);
    expect(lease.rawFileAcceptedByApi).toBe(false);
    expect(lease.externalMessageSentByValo).toBe(false);

    expect(() =>
      adaptClientActionUploadLeaseGrant(
        {
          ...rawLease(),
          objectPath: `/objects/tenants/99999999-9999-4999-8999-999999999999/uploads/${LEASE}`,
        },
        binding,
      ),
    ).toThrow(/Invalid client-upload response/u);
  });

  it("rejects additional fields and unsafe signed URL authority", () => {
    expect(() =>
      adaptClientActionUploadLeaseGrant(
        { ...rawLease(), unexpected: "field" },
        binding,
      ),
    ).toThrow(/Invalid client-upload response/u);
    expect(() =>
      adaptClientActionUploadLeaseGrant(
        { ...rawLease(), uploadUrl: "data:text/plain,bytes" },
        binding,
      ),
    ).toThrow(/Invalid client-upload response/u);
    expect(() =>
      adaptClientActionUploadLeaseGrant(
        { ...rawLease(), lateRewriteClosure: "signed-expiry-only" },
        binding,
      ),
    ).toThrow(/Invalid client-upload response/u);
  });

  it("binds the final receipt to the same lease and next record version", () => {
    const lease = adaptClientActionUploadLeaseGrant(rawLease(), binding);
    const receipt = adaptClientActionUploadFinalizationReceipt(
      rawReceipt(),
      binding,
      lease,
    );
    expect(receipt.recordVersion).toBe(5);
    expect(receipt.receiptSha256).toBe("b".repeat(64));

    expect(() =>
      adaptClientActionUploadFinalizationReceipt(
        { ...rawReceipt(), recordVersion: 4 },
        binding,
        lease,
      ),
    ).toThrow(/Invalid client-upload response/u);
  });
});
