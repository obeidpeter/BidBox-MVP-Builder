import { describe, expect, it } from "vitest";
import {
  EVIDENCE_RENEWAL_AUTHORITY_NOTE,
  adaptEvidenceRenewalAuthorities,
  adaptEvidenceRenewalMutation,
  adaptEvidenceRenewalSnapshot,
} from "./evidence-renewal";

const ORGANISATION_ID = "10000000-0000-4000-8000-000000000001";
const PROJECT_ID = "20000000-0000-4000-8000-000000000002";
const PLAN_ID = "30000000-0000-4000-8000-000000000003";
const VAULT_ITEM_ID = "40000000-0000-4000-8000-000000000004";
const OWNER_ID = "50000000-0000-4000-8000-000000000005";
const VERIFIER_ID = "60000000-0000-4000-8000-000000000006";
const SHA = "a".repeat(64);

function plan() {
  return {
    id: PLAN_ID,
    organisationId: ORGANISATION_ID,
    projectId: PROJECT_ID,
    vaultItemId: VAULT_ITEM_ID,
    artefactType: "Tax clearance certificate",
    owner: { userId: OWNER_ID, name: "Owner Ada", current: true },
    verifier: {
      userId: VERIFIER_ID,
      name: "Verifier Tayo",
      current: true,
    },
    targetDate: "2026-09-01",
    internalReminder: {
      channel: "valo_evidence_renewal_register",
      assignedOwnerUserId: OWNER_ID,
      dueAt: "2026-09-01T16:00:00.000Z",
      status: "open",
      recordedReceiptSha256: SHA,
      resolvedReceiptSha256: null,
      externalDeliveryReceipt: null,
    },
    affectedPursuits: [
      { projectId: PROJECT_ID, title: "Pursuit Alpha", impact: "blocked" },
    ],
    status: "planned",
    version: 1,
    stagedReplacement: null,
    reviewReasonCode: null,
    createdByUserId: OWNER_ID,
    createdAt: "2026-08-13T08:00:00.000Z",
    updatedAt: "2026-08-13T08:00:00.000Z",
    latestReceiptSha256: SHA,
    promotionReceiptSha256: null,
    receipts: [
      {
        version: 1,
        kind: "plan_created",
        occurredAt: "2026-08-13T08:00:00.000Z",
        actorUserId: OWNER_ID,
        sha256: SHA,
      },
    ],
    externalMessageSent: false,
  };
}

function snapshot() {
  return {
    organisationId: ORGANISATION_ID,
    projectId: PROJECT_ID,
    generatedAt: "2026-08-13T08:00:00.000Z",
    items: [plan()],
    limit: 100,
    truncated: false,
    externalMessagingConnected: false,
    authorityNote: EVIDENCE_RENEWAL_AUTHORITY_NOTE,
  };
}

describe("evidence-renewal strict adapters", () => {
  it("accepts an exact tenant/project snapshot and explicit messaging falsehood", () => {
    const adapted = adaptEvidenceRenewalSnapshot(
      snapshot(),
      ORGANISATION_ID,
      PROJECT_ID,
    );
    expect(adapted.items[0]?.owner.name).toBe("Owner Ada");
    expect(adapted.items[0]?.internalReminder.status).toBe("open");
    expect(adapted.externalMessagingConnected).toBe(false);
  });

  it("rejects scope changes, unknown fields and inconsistent state", () => {
    expect(() =>
      adaptEvidenceRenewalSnapshot(snapshot(), ORGANISATION_ID, PLAN_ID),
    ).toThrow(/snapshot/u);
    expect(() =>
      adaptEvidenceRenewalSnapshot(
        { ...snapshot(), messageDelivered: true },
        ORGANISATION_ID,
        PROJECT_ID,
      ),
    ).toThrow(/snapshot/u);
    const inconsistent = snapshot();
    inconsistent.items[0]!.status = "promoted";
    expect(() =>
      adaptEvidenceRenewalSnapshot(inconsistent, ORGANISATION_ID, PROJECT_ID),
    ).toThrow(/state/u);
    const fakeDeliveryReceipt = snapshot();
    fakeDeliveryReceipt.items[0]!.internalReminder.externalDeliveryReceipt =
      "claimed" as never;
    expect(() =>
      adaptEvidenceRenewalSnapshot(
        fakeDeliveryReceipt,
        ORGANISATION_ID,
        PROJECT_ID,
      ),
    ).toThrow(/reminder/u);
  });

  it("requires unique exact direct-authority options", () => {
    const payload = {
      organisationId: ORGANISATION_ID,
      owners: [{ userId: OWNER_ID, name: "Owner Ada" }],
      verifiers: [{ userId: VERIFIER_ID, name: "Verifier Tayo" }],
      limit: 100,
      truncated: false,
    };
    expect(
      adaptEvidenceRenewalAuthorities(payload, ORGANISATION_ID).verifiers,
    ).toHaveLength(1);
    expect(() =>
      adaptEvidenceRenewalAuthorities(
        { ...payload, owners: [...payload.owners, ...payload.owners] },
        ORGANISATION_ID,
      ),
    ).toThrow(/authority option/u);
  });

  it("accepts only mutation envelopes that deny external delivery", () => {
    const mutation = {
      outcome: "created",
      plan: plan(),
      replayed: false,
      externalMessageSent: false,
      authorityNote: EVIDENCE_RENEWAL_AUTHORITY_NOTE,
    };
    expect(
      adaptEvidenceRenewalMutation(mutation, ORGANISATION_ID, PROJECT_ID).id,
    ).toBe(PLAN_ID);
    expect(() =>
      adaptEvidenceRenewalMutation(
        { ...mutation, externalMessageSent: true },
        ORGANISATION_ID,
        PROJECT_ID,
      ),
    ).toThrow(/mutation/u);
  });
});
