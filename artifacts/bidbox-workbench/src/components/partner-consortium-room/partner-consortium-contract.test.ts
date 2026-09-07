import { describe, expect, it } from "vitest";
import {
  adaptConsortiumParticipants,
  adaptConsortiumSnapshot,
} from "./partner-consortium-contract";

const ORG = "11111111-1111-4111-8111-111111111111";
const PARTNER = "22222222-2222-4222-8222-222222222222";
const PROJECT = "33333333-3333-4333-8333-333333333333";
const RELATIONSHIP = "44444444-4444-4444-8444-444444444444";
const ROOM = "55555555-5555-4555-8555-555555555555";
const CLIENT_USER = "66666666-6666-4666-8666-666666666666";
const PARTNER_USER = "77777777-7777-4777-8777-777777777777";
const RECEIPT = "88888888-8888-4888-8888-888888888888";

function snapshot() {
  const qa = (code: string, index: number, required = true) => ({
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    code,
    required,
    preparerParty: code === "partner_cosign" ? "client" : "partner",
    checkerParty: code === "partner_cosign" ? "partner" : "client",
    ownerUserId: code === "partner_cosign" ? CLIENT_USER : PARTNER_USER,
    status: "open",
    evidenceSha256: null,
    preparedByUserId: null,
    preparedAt: null,
    lastDecision: null,
  });
  return {
    organisationId: ORG,
    projectId: PROJECT,
    relationshipId: RELATIONSHIP,
    actorParty: "client",
    relationship: {
      version: 2,
      coSigningRequired: false,
      qaResponsibilitySha256: null,
    },
    room: {
      id: ROOM,
      organisationId: ORG,
      projectId: PROJECT,
      relationshipId: RELATIONSHIP,
      clientOrganisationId: ORG,
      partnerOrganisationId: PARTNER,
      clientCoordinatorUserId: CLIENT_USER,
      partnerCoordinatorUserId: PARTNER_USER,
      coSigningRequired: false,
      status: "draft",
      version: 1,
      responsibilities: [],
      qaChecklist: [
        qa("evidence_quality_review", 1),
        qa("requirement_coverage_review", 2),
        qa("client_release_readiness", 3),
        qa("partner_cosign", 4, false),
      ],
      auditReceipts: [
        {
          id: RECEIPT,
          sequence: 1,
          action: "room_created",
          objectId: ROOM,
          actorUserId: CLIENT_USER,
          actorParty: "client",
          priorVersion: 0,
          nextVersion: 1,
          factsSha256: "a".repeat(64),
          previousReceiptSha256: null,
          receiptSha256: "b".repeat(64),
          occurredAt: "2026-08-11T10:00:00.000Z",
        },
      ],
      idempotencyDigest: "c".repeat(64),
      createdByUserId: CLIENT_USER,
      updatedByUserId: CLIENT_USER,
      createdAt: "2026-08-11T10:00:00.000Z",
      updatedAt: "2026-08-11T10:00:00.000Z",
      retention: {
        namespace: "valo.partner-consortium-room/v1",
        class: "project_coordination",
        owner: "client_organisation",
        trigger: "owning_project_retention_policy",
        independentDeletionAllowed: false,
      },
      authorityBoundaries: {
        legalAgreementGeneration: false,
        revenueSettlement: false,
        messaging: false,
        crossClientLearning: false,
        autonomousExternalAction: false,
      },
    },
  };
}

describe("adaptConsortiumSnapshot", () => {
  it("accepts exact scope, project retention, and disabled external authorities", () => {
    const result = adaptConsortiumSnapshot(
      snapshot(),
      ORG,
      PROJECT,
      RELATIONSHIP,
    );
    expect(result.room.version).toBe(1);
    expect(result.room.auditReceipts).toHaveLength(1);
    expect(result.room.retention.independentDeletionAllowed).toBe(false);
    expect(result.room.authorityBoundaries.autonomousExternalAction).toBe(
      false,
    );
  });

  it("fails closed on scope drift, receipt-chain drift, or an authority upgrade", () => {
    expect(() =>
      adaptConsortiumSnapshot(snapshot(), ORG, ROOM, RELATIONSHIP),
    ).toThrow();
    const chainDrift = snapshot();
    chainDrift.room.auditReceipts[0]!.nextVersion = 2;
    expect(() =>
      adaptConsortiumSnapshot(chainDrift, ORG, PROJECT, RELATIONSHIP),
    ).toThrow();
    const upgraded = snapshot();
    upgraded.room.authorityBoundaries.messaging = true;
    expect(() =>
      adaptConsortiumSnapshot(upgraded, ORG, PROJECT, RELATIONSHIP),
    ).toThrow();
  });
});

describe("adaptConsortiumParticipants", () => {
  const directory = () => ({
    organisationId: ORG,
    projectId: PROJECT,
    relationshipId: RELATIONSHIP,
    items: [
      { userId: CLIENT_USER, name: "Client Coordinator", party: "client" },
      { userId: PARTNER_USER, name: "Partner Coordinator", party: "partner" },
    ],
    limit: 100,
    truncated: false,
  });

  it("accepts only the exact bounded name-only relationship directory", () => {
    expect(
      adaptConsortiumParticipants(directory(), ORG, PROJECT, RELATIONSHIP),
    ).toEqual(directory());
  });

  it("rejects tenant drift, duplicate party members, and extra PII fields", () => {
    expect(() =>
      adaptConsortiumParticipants(directory(), PARTNER, PROJECT, RELATIONSHIP),
    ).toThrow();
    const duplicate = directory();
    duplicate.items.push({ ...duplicate.items[0]! });
    expect(() =>
      adaptConsortiumParticipants(duplicate, ORG, PROJECT, RELATIONSHIP),
    ).toThrow();
    const enriched = directory() as ReturnType<typeof directory> & {
      email: string;
    };
    enriched.email = "not-allowed@example.test";
    expect(() =>
      adaptConsortiumParticipants(enriched, ORG, PROJECT, RELATIONSHIP),
    ).toThrow();
  });
});
