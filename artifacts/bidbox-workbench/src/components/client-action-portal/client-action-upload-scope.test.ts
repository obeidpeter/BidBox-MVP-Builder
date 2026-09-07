import { describe, expect, it } from "vitest";
import type { ClientActionSnapshot } from "./client-action-contract";
import type { ClientActionUploadBinding } from "./client-action-upload-contract";
import { assertClientActionUploadTargetCurrent } from "./client-action-upload-scope";

const USER = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";
const PROJECT = "33333333-3333-4333-8333-333333333333";
const RECORD = "44444444-4444-4444-8444-444444444444";
const SLOT = "55555555-5555-4555-8555-555555555555";
const ATTEMPT = "66666666-6666-4666-8666-666666666666";
const INTENT = "77777777-7777-4777-8777-777777777777";
const SHA = "a".repeat(64);

const binding: ClientActionUploadBinding = {
  organisationId: ORG,
  projectId: PROJECT,
  recordId: RECORD,
  slotId: SLOT,
  intentId: INTENT,
  expectedRecordVersion: 7,
  filename: "proof.pdf",
  contentType: "application/pdf",
  sizeBytes: 3,
  declaredSha256: SHA,
  acceptedContentTypes: ["application/pdf"],
};

function snapshot(): ClientActionSnapshot {
  return {
    organisationId: ORG,
    projectId: PROJECT,
    authority: {
      externalMessaging: false,
      rawUpload: false,
      packageTransfer: false,
      uploadIntentOnly: true,
    },
    records: [
      {
        id: RECORD,
        kind: "evidence_request",
        version: 7,
        createdByUserId: "88888888-8888-4888-8888-888888888888",
        recipientUserId: USER,
        purpose: "tender_evidence",
        purposeStatement: "Provide proof.",
        dueAt: null,
        status: "in_progress",
        requestAcknowledgement: {
          statement: "Acknowledged.",
          acknowledgedByUserId: USER,
          acknowledgedAt: "2026-08-13T09:00:00.000Z",
        },
        slots: [
          {
            id: SLOT,
            label: "Proof",
            required: true,
            acceptedContentTypes: ["application/pdf"],
            attempts: [
              {
                id: ATTEMPT,
                intent: {
                  id: INTENT,
                  filename: binding.filename,
                  contentType: binding.contentType,
                  sizeBytes: binding.sizeBytes,
                  declaredSha256: SHA,
                  recordedByUserId: USER,
                  recordedAt: "2026-08-13T09:01:00.000Z",
                },
                document: null,
                review: null,
                correctionAcknowledgement: null,
              },
            ],
          },
        ],
        completionReceiptSha256: null,
        externalMessageSentByValo: false,
      },
    ],
  };
}

describe("Client Action upload target scope", () => {
  it("accepts the exact current recipient, record, slot, version, and latest intent", () => {
    expect(() =>
      assertClientActionUploadTargetCurrent(snapshot(), binding, USER),
    ).not.toThrow();
  });

  it("rejects a binding from a second tenant before file transfer", () => {
    expect(() =>
      assertClientActionUploadTargetCurrent(
        snapshot(),
        {
          ...binding,
          organisationId: "99999999-9999-4999-8999-999999999999",
        },
        USER,
      ),
    ).toThrow(/no longer current/u);
  });

  it("rejects stale record versions and replaced latest intents", () => {
    const changed = snapshot();
    const request = changed.records[0];
    if (request?.kind !== "evidence_request") throw new Error("bad fixture");
    request.version = 8;
    request.slots[0]!.attempts.push({
      ...request.slots[0]!.attempts[0]!,
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      intent: {
        ...request.slots[0]!.attempts[0]!.intent,
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      },
    });
    expect(() =>
      assertClientActionUploadTargetCurrent(changed, binding, USER),
    ).toThrow(/no longer current/u);
  });
});
