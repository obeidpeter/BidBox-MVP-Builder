import { describe, expect, it } from "vitest";
import {
  adaptCommunicationReferences,
  adaptCommunicationSnapshot,
} from "./communications-contract";

const ORGANISATION_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const EVENT_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "44444444-4444-4444-8444-444444444444";
const REQUEST_ID = "55555555-5555-4555-8555-555555555555";

function snapshot() {
  return {
    organisationId: ORGANISATION_ID,
    projectId: PROJECT_ID,
    events: [
      {
        id: EVENT_ID,
        organisationId: ORGANISATION_ID,
        projectId: PROJECT_ID,
        channel: "email",
        templateId: "evidence_request_ready_v1",
        recipientUserId: USER_ID,
        consentEvidenceSha256: "a".repeat(64),
        context: {
          kind: "evidence_request",
          requestId: REQUEST_ID,
          dueAt: null,
        },
        status: "queued",
        requestedByUserId: USER_ID,
        requestedAt: "2026-08-11T10:00:00.000Z",
        deadlineAt: "2026-08-20T10:00:00.000Z",
        maxAttempts: 3,
        version: 1,
        attempts: [],
        deliveryAuthority: "verified_provider_receipt_only",
        arbitraryBodyAccepted: false,
        rawRecipientPersisted: false,
      },
    ],
    policy: {
      approvedTemplatesOnly: true,
      arbitraryBodyAccepted: false,
      arbitraryRecipientAccepted: false,
      deliveryRequiresVerifiedProviderReceipt: true,
      autonomousDispatch: false,
      providersConnected: false,
    },
  };
}

describe("adaptCommunicationSnapshot", () => {
  it("accepts a closed, same-scope communication snapshot", () => {
    const adapted = adaptCommunicationSnapshot(
      snapshot(),
      PROJECT_ID,
      ORGANISATION_ID,
    );
    expect(adapted.events[0]?.status).toBe("queued");
    expect(adapted.policy.deliveryRequiresVerifiedProviderReceipt).toBe(true);
  });

  it("fails closed on scope drift, raw recipients, or a delivery-authority downgrade", () => {
    expect(() =>
      adaptCommunicationSnapshot(snapshot(), EVENT_ID, ORGANISATION_ID),
    ).toThrow();
    const rawRecipient = snapshot();
    Object.assign(rawRecipient.events[0]!, {
      recipient: "raw-address@example.test",
    });
    expect(() =>
      adaptCommunicationSnapshot(rawRecipient, PROJECT_ID, ORGANISATION_ID),
    ).toThrow();
    const downgraded = snapshot();
    Object.assign(downgraded.events[0]!, {
      deliveryAuthority: "provider_acceptance",
    });
    expect(() =>
      adaptCommunicationSnapshot(downgraded, PROJECT_ID, ORGANISATION_ID),
    ).toThrow();
  });
});

describe("adaptCommunicationReferences", () => {
  it("accepts bounded named consent and canonical context choices", () => {
    const adapted = adaptCommunicationReferences(
      {
        organisationId: ORGANISATION_ID,
        projectId: PROJECT_ID,
        recipients: [
          {
            userId: USER_ID,
            name: "Ada Reviewer",
            channel: "email",
            consentEvidenceSha256: "a".repeat(64),
          },
        ],
        contexts: [
          {
            id: `evidence-request:${REQUEST_ID}`,
            recipientUserId: USER_ID,
            label: "Evidence request",
            templateId: "evidence_request_ready_v1",
            context: {
              kind: "evidence_request",
              requestId: REQUEST_ID,
              dueAt: null,
            },
          },
        ],
        limit: 100,
        truncated: false,
      },
      PROJECT_ID,
      ORGANISATION_ID,
    );
    expect(adapted.recipients[0]?.name).toBe("Ada Reviewer");
    expect(adapted.contexts[0]?.recipientUserId).toBe(USER_ID);
  });

  it("rejects PII-like extra fields, duplicate identities, and scope drift", () => {
    const response = {
      organisationId: ORGANISATION_ID,
      projectId: PROJECT_ID,
      recipients: [
        {
          userId: USER_ID,
          name: "Ada Reviewer",
          channel: "email",
          consentEvidenceSha256: "a".repeat(64),
          email: "hidden@example.test",
        },
      ],
      contexts: [],
      limit: 100,
      truncated: false,
    };
    expect(() =>
      adaptCommunicationReferences(response, PROJECT_ID, ORGANISATION_ID),
    ).toThrow();
    expect(() =>
      adaptCommunicationReferences(
        { ...response, recipients: [] },
        EVENT_ID,
        ORGANISATION_ID,
      ),
    ).toThrow();
  });
});
