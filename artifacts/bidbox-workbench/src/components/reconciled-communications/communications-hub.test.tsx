import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CommunicationsHub } from "./communications-hub";
import type {
  CommunicationReferenceSet,
  CommunicationSnapshot,
} from "./communications-contract";

const EVENT_ID = "33333333-3333-4333-8333-333333333333";
const ATTEMPT_ID = "55555555-5555-4555-8555-555555555555";
const REFERENCES: CommunicationReferenceSet = {
  organisationId: "11111111-1111-4111-8111-111111111111",
  projectId: "22222222-2222-4222-8222-222222222222",
  recipients: [
    {
      userId: "44444444-4444-4444-8444-444444444444",
      name: "Ada Reviewer",
      channel: "email",
      consentEvidenceSha256: "a".repeat(64),
    },
  ],
  contexts: [
    {
      id: "evidence-request:66666666-6666-4666-8666-666666666666",
      recipientUserId: "44444444-4444-4444-8444-444444444444",
      label: "Evidence request",
      templateId: "evidence_request_ready_v1",
      context: {
        kind: "evidence_request",
        requestId: "66666666-6666-4666-8666-666666666666",
        dueAt: null,
      },
    },
  ],
  limit: 100,
  truncated: false,
};

function snapshot(
  status: "queued" | "accepted_pending_receipt",
): CommunicationSnapshot {
  return {
    organisationId: "11111111-1111-4111-8111-111111111111",
    projectId: "22222222-2222-4222-8222-222222222222",
    policy: {
      approvedTemplatesOnly: true,
      arbitraryBodyAccepted: false,
      arbitraryRecipientAccepted: false,
      deliveryRequiresVerifiedProviderReceipt: true,
      autonomousDispatch: false,
      providersConnected: status === "accepted_pending_receipt",
    },
    events: [
      {
        id: EVENT_ID,
        organisationId: "11111111-1111-4111-8111-111111111111",
        projectId: "22222222-2222-4222-8222-222222222222",
        channel: "email",
        templateId: "evidence_request_ready_v1",
        recipientUserId: "44444444-4444-4444-8444-444444444444",
        consentEvidenceSha256: "a".repeat(64),
        context: {
          kind: "evidence_request",
          requestId: "66666666-6666-4666-8666-666666666666",
          dueAt: null,
        },
        status,
        requestedByUserId: "77777777-7777-4777-8777-777777777777",
        requestedAt: "2026-08-11T10:00:00.000Z",
        deadlineAt: "2026-08-20T10:00:00.000Z",
        maxAttempts: 3,
        version: status === "queued" ? 1 : 3,
        attempts:
          status === "queued"
            ? []
            : [
                {
                  id: ATTEMPT_ID,
                  attemptNumber: 1,
                  provider: "approved-provider",
                  idempotencyKey: "b".repeat(64),
                  status: "accepted_pending_receipt",
                  providerMessageId: "provider-message-1",
                  receiptSha256: null,
                  responseCode: "accepted_not_delivered",
                  attemptedAt: "2026-08-11T10:01:00.000Z",
                  nextAttemptAt: null,
                },
              ],
        deliveryAuthority: "verified_provider_receipt_only",
        arbitraryBodyAccepted: false,
        rawRecipientPersisted: false,
      },
    ],
  };
}

describe("CommunicationsHub", () => {
  it("shows no content/recipient bypass and emits a version-bound human attempt", () => {
    const onMutate = vi.fn();
    render(
      <CommunicationsHub
        snapshot={snapshot("queued")}
        references={REFERENCES}
        referencesLoading={false}
        canManage
        pending={false}
        onMutate={onMutate}
      />,
    );
    expect(
      screen.getByText(
        /free-text content and raw recipient addresses cannot enter the communication record/i,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/message body/i)).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText(/recipient valo user id/i),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText(/consent evidence sha/i),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /record delivery attempt/i }),
    );
    expect(onMutate).toHaveBeenCalledWith({
      kind: "attempt",
      path: `intents/${EVENT_ID}/attempts`,
      body: { expectedVersion: 1 },
    });
  });

  it("queues only a server-issued recipient and canonical context choice", () => {
    const onMutate = vi.fn();
    render(
      <CommunicationsHub
        snapshot={snapshot("queued")}
        references={REFERENCES}
        referencesLoading={false}
        canManage
        pending={false}
        onMutate={onMutate}
      />,
    );
    fireEvent.change(screen.getByLabelText(/consented recipient/i), {
      target: { value: REFERENCES.recipients[0]!.userId },
    });
    fireEvent.change(screen.getByLabelText(/approved template and project/i), {
      target: { value: REFERENCES.contexts[0]!.id },
    });
    fireEvent.change(screen.getByLabelText(/delivery attempt deadline/i), {
      target: { value: "2026-08-20T10:00" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /create message plan/i }),
    );
    expect(onMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "queue",
        path: "intents",
        body: expect.objectContaining({
          channel: "email",
          recipientUserId: REFERENCES.recipients[0]!.userId,
          consentEvidenceSha256:
            REFERENCES.recipients[0]!.consentEvidenceSha256,
          context: REFERENCES.contexts[0]!.context,
        }),
      }),
    );
  });

  it("labels provider acceptance as pending and binds receipt reconciliation to the attempt", () => {
    const onMutate = vi.fn();
    render(
      <CommunicationsHub
        snapshot={snapshot("accepted_pending_receipt")}
        references={REFERENCES}
        referencesLoading={false}
        canManage
        pending={false}
        onMutate={onMutate}
      />,
    );
    expect(
      screen.getByText(/provider acceptance is not delivery/i),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/receipt reference/i), {
      target: { value: "receipt-ref-001" },
    });
    fireEvent.click(screen.getByRole("button", { name: /verify receipt/i }));
    expect(onMutate).toHaveBeenCalledWith({
      kind: "reconcile",
      path: `intents/${EVENT_ID}/reconciliations`,
      body: {
        expectedVersion: 3,
        attemptId: ATTEMPT_ID,
        receiptReference: "receipt-ref-001",
      },
    });
  });
});
