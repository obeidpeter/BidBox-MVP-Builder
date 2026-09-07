import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  ConsortiumRoomInitializer,
  PartnerConsortiumWorkspace,
} from "./partner-consortium-workspace";
import type {
  ConsortiumParticipantOption,
  ConsortiumSnapshot,
} from "./partner-consortium-contract";

const CLIENT = "11111111-1111-4111-8111-111111111111";
const PARTNER = "22222222-2222-4222-8222-222222222222";
const PROJECT = "33333333-3333-4333-8333-333333333333";
const RELATIONSHIP = "44444444-4444-4444-8444-444444444444";
const ACTOR = "55555555-5555-4555-8555-555555555555";
const MAKER = "66666666-6666-4666-8666-666666666666";
const RESPONSIBILITY = "77777777-7777-4777-8777-777777777777";
const ROOM = "88888888-8888-4888-8888-888888888888";
const RECEIPT = "99999999-9999-4999-8999-999999999999";
const participants: readonly ConsortiumParticipantOption[] = [
  { userId: ACTOR, name: "Client Coordinator", party: "client" },
  { userId: MAKER, name: "Partner Coordinator", party: "partner" },
];

function snapshot(): ConsortiumSnapshot {
  const qaCodes = [
    "evidence_quality_review",
    "requirement_coverage_review",
    "client_release_readiness",
    "partner_cosign",
  ] as const;
  return {
    organisationId: CLIENT,
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
      organisationId: CLIENT,
      projectId: PROJECT,
      relationshipId: RELATIONSHIP,
      clientOrganisationId: CLIENT,
      partnerOrganisationId: PARTNER,
      clientCoordinatorUserId: ACTOR,
      partnerCoordinatorUserId: MAKER,
      coSigningRequired: false,
      status: "draft",
      version: 2,
      responsibilities: [
        {
          id: RESPONSIBILITY,
          iteration: 1,
          workstreamLabel: "Technical response",
          responsibleParty: "partner",
          accountableParty: "client",
          ownerUserId: MAKER,
          dueAt: null,
          status: "proposed",
          requiredAcceptance: "both_parties",
          acceptances: { client: null, partner: null },
          createdByUserId: MAKER,
          createdAt: "2026-08-11T10:00:00.000Z",
          updatedByUserId: MAKER,
          updatedAt: "2026-08-11T10:00:00.000Z",
        },
      ],
      qaChecklist: qaCodes.map((code, index) => ({
        id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        code,
        required: code !== "partner_cosign",
        preparerParty: code === "partner_cosign" ? "client" : "partner",
        checkerParty: code === "partner_cosign" ? "partner" : "client",
        ownerUserId: code === "partner_cosign" ? ACTOR : MAKER,
        status: "open",
        evidenceSha256: null,
        preparedByUserId: null,
        preparedAt: null,
        lastDecision: null,
      })),
      auditReceipts: [
        {
          id: RECEIPT,
          sequence: 1,
          action: "room_created",
          objectId: ROOM,
          actorUserId: ACTOR,
          actorParty: "client",
          priorVersion: 0,
          nextVersion: 1,
          factsSha256: "a".repeat(64),
          previousReceiptSha256: null,
          receiptSha256: "b".repeat(64),
          occurredAt: "2026-08-11T10:00:00.000Z",
        },
        {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          sequence: 2,
          action: "responsibility_added",
          objectId: RESPONSIBILITY,
          actorUserId: MAKER,
          actorParty: "partner",
          priorVersion: 1,
          nextVersion: 2,
          factsSha256: "c".repeat(64),
          previousReceiptSha256: "b".repeat(64),
          receiptSha256: "d".repeat(64),
          occurredAt: "2026-08-11T10:01:00.000Z",
        },
      ],
      createdByUserId: ACTOR,
      updatedByUserId: MAKER,
      createdAt: "2026-08-11T10:00:00.000Z",
      updatedAt: "2026-08-11T10:01:00.000Z",
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

describe("PartnerConsortiumWorkspace", () => {
  it("shows the bounded authority and emits a bilateral version-bound acceptance", () => {
    const onMutate = vi.fn();
    render(
      <PartnerConsortiumWorkspace
        snapshot={snapshot()}
        participants={participants}
        actorUserId={ACTOR}
        canWrite
        pending={false}
        onMutate={onMutate}
      />,
    );
    expect(
      screen.getByText(
        /no agreement generation, settlement, messaging, learning/i,
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /accept for client/i }));
    expect(onMutate).toHaveBeenCalledWith({
      kind: "responsibility_decision",
      path: `responsibilities/${RESPONSIBILITY}/decisions`,
      body: { expectedVersion: 2, decision: "accepted" },
    });
  });

  it("initializes only named coordinators and exposes no agreement or messaging field", () => {
    const onMutate = vi.fn();
    render(
      <ConsortiumRoomInitializer
        participants={participants}
        pending={false}
        onMutate={onMutate}
      />,
    );
    expect(screen.queryByLabelText(/message/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/agreement/i)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^client coordinator$/i), {
      target: { value: ACTOR },
    });
    fireEvent.change(screen.getByLabelText(/^partner coordinator$/i), {
      target: { value: MAKER },
    });
    fireEvent.click(screen.getByRole("button", { name: /set up room/i }));
    expect(onMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "initialize",
        path: "",
        body: expect.objectContaining({
          clientCoordinatorUserId: ACTOR,
          partnerCoordinatorUserId: MAKER,
        }),
      }),
    );
  });
});
