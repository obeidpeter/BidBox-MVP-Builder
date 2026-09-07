import {
  requireRecord,
  SHA256_PATTERN as SHA,
  UUID_PATTERN as UUID,
} from "@/lib/closed-contract";

export type ConsortiumParty = "client" | "partner";
export type ConsortiumReasonCode =
  | "ownership_mismatch"
  | "scope_unclear"
  | "deadline_unworkable"
  | "quality_control_gap"
  | "evidence_not_sufficient"
  | "offline_discussion_required";

export interface ConsortiumAcceptance {
  party: ConsortiumParty;
  decision: "accepted" | "changes_requested";
  reasonCode: ConsortiumReasonCode | null;
  decidedByUserId: string;
  decidedAt: string;
}

export interface ConsortiumResponsibility {
  id: string;
  iteration: number;
  workstreamLabel: string;
  responsibleParty: ConsortiumParty;
  accountableParty: ConsortiumParty;
  ownerUserId: string;
  dueAt: string | null;
  status: "proposed" | "changes_requested" | "active";
  requiredAcceptance: "both_parties";
  acceptances: {
    client: ConsortiumAcceptance | null;
    partner: ConsortiumAcceptance | null;
  };
  createdByUserId: string;
  createdAt: string;
  updatedByUserId: string;
  updatedAt: string;
}

export interface ConsortiumQaItem {
  id: string;
  code:
    | "evidence_quality_review"
    | "requirement_coverage_review"
    | "client_release_readiness"
    | "partner_cosign";
  required: boolean;
  preparerParty: ConsortiumParty;
  checkerParty: ConsortiumParty;
  ownerUserId: string;
  status: "open" | "ready_for_check" | "checked";
  evidenceSha256: string | null;
  preparedByUserId: string | null;
  preparedAt: string | null;
  lastDecision: {
    decision: "checked" | "rejected";
    reasonCode: ConsortiumReasonCode | null;
    decidedByUserId: string;
    decidedAt: string;
  } | null;
}

export interface ConsortiumAuditReceipt {
  id: string;
  sequence: number;
  action:
    | "room_created"
    | "responsibility_added"
    | "responsibility_revised"
    | "responsibility_decided"
    | "qa_prepared"
    | "qa_decided";
  objectId: string;
  actorUserId: string;
  actorParty: ConsortiumParty;
  priorVersion: number;
  nextVersion: number;
  factsSha256: string;
  previousReceiptSha256: string | null;
  receiptSha256: string;
  occurredAt: string;
}

export interface PartnerConsortiumRoom {
  id: string;
  organisationId: string;
  projectId: string;
  relationshipId: string;
  clientOrganisationId: string;
  partnerOrganisationId: string;
  clientCoordinatorUserId: string;
  partnerCoordinatorUserId: string;
  coSigningRequired: boolean;
  status: "draft" | "active" | "qa_in_progress" | "ready_for_client_release";
  version: number;
  responsibilities: ConsortiumResponsibility[];
  qaChecklist: ConsortiumQaItem[];
  auditReceipts: ConsortiumAuditReceipt[];
  createdByUserId: string;
  updatedByUserId: string;
  createdAt: string;
  updatedAt: string;
  retention: {
    namespace: "valo.partner-consortium-room/v1";
    class: "project_coordination";
    owner: "client_organisation";
    trigger: "owning_project_retention_policy";
    independentDeletionAllowed: false;
  };
  authorityBoundaries: {
    legalAgreementGeneration: false;
    revenueSettlement: false;
    messaging: false;
    crossClientLearning: false;
    autonomousExternalAction: false;
  };
}

export interface ConsortiumSnapshot {
  organisationId: string;
  projectId: string;
  relationshipId: string;
  actorParty: ConsortiumParty;
  room: PartnerConsortiumRoom;
  relationship: {
    version: number;
    coSigningRequired: boolean;
    qaResponsibilitySha256: string | null;
  };
}

export interface ConsortiumParticipantOption {
  userId: string;
  name: string;
  party: ConsortiumParty;
}

export interface ConsortiumParticipantDirectory {
  organisationId: string;
  projectId: string;
  relationshipId: string;
  items: ConsortiumParticipantOption[];
  limit: 100;
  truncated: false;
}

export interface ConsortiumMutation {
  kind:
    | "initialize"
    | "responsibility"
    | "revision"
    | "responsibility_decision"
    | "qa_preparation"
    | "qa_decision";
  path: string;
  body: Record<string, unknown>;
}

const PARTIES: readonly ConsortiumParty[] = ["client", "partner"];
const REASONS: readonly ConsortiumReasonCode[] = [
  "ownership_mismatch",
  "scope_unclear",
  "deadline_unworkable",
  "quality_control_gap",
  "evidence_not_sufficient",
  "offline_discussion_required",
];
const QA_CODES: readonly ConsortiumQaItem["code"][] = [
  "evidence_quality_review",
  "requirement_coverage_review",
  "client_release_readiness",
  "partner_cosign",
];

function fail(): never {
  throw new Error("Invalid partner consortium room response");
}

function record(value: unknown): Record<string, unknown> {
  return requireRecord(value, fail);
}

function text(value: unknown, maximum = 1_000): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maximum ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    fail();
  }
  return value;
}

function id(value: unknown): string {
  const candidate = text(value, 64);
  if (!UUID.test(candidate)) fail();
  return candidate;
}

function sha(value: unknown): string {
  const candidate = text(value, 64);
  if (!SHA.test(candidate)) fail();
  return candidate;
}

function nullableSha(value: unknown): string | null {
  return value === null ? null : sha(value);
}

function instant(value: unknown): string {
  const candidate = text(value, 64);
  if (!Number.isFinite(Date.parse(candidate))) fail();
  return candidate;
}

function nullableInstant(value: unknown): string | null {
  return value === null ? null : instant(value);
}

function integer(value: unknown, minimum = 1, maximum = 500): number {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < minimum ||
    Number(value) > maximum
  ) {
    fail();
  }
  return Number(value);
}

function party(value: unknown): ConsortiumParty {
  if (!PARTIES.includes(value as ConsortiumParty)) fail();
  return value as ConsortiumParty;
}

function reason(value: unknown): ConsortiumReasonCode | null {
  if (value === null) return null;
  if (!REASONS.includes(value as ConsortiumReasonCode)) fail();
  return value as ConsortiumReasonCode;
}

function acceptance(
  value: unknown,
  expectedParty: ConsortiumParty,
): ConsortiumAcceptance | null {
  if (value === null) return null;
  const item = record(value);
  if (
    item.party !== expectedParty ||
    (item.decision !== "accepted" && item.decision !== "changes_requested")
  ) {
    fail();
  }
  const reasonCode = reason(item.reasonCode);
  if (
    (item.decision === "accepted" && reasonCode !== null) ||
    (item.decision === "changes_requested" && reasonCode === null)
  ) {
    fail();
  }
  return {
    party: expectedParty,
    decision: item.decision,
    reasonCode,
    decidedByUserId: id(item.decidedByUserId),
    decidedAt: instant(item.decidedAt),
  };
}

function responsibility(value: unknown): ConsortiumResponsibility {
  const item = record(value);
  const acceptances = record(item.acceptances);
  if (
    (item.status !== "proposed" &&
      item.status !== "changes_requested" &&
      item.status !== "active") ||
    item.requiredAcceptance !== "both_parties"
  ) {
    fail();
  }
  const clientAcceptance = acceptance(acceptances.client, "client");
  const partnerAcceptance = acceptance(acceptances.partner, "partner");
  const createdByUserId = id(item.createdByUserId);
  if (
    clientAcceptance?.decidedByUserId === createdByUserId ||
    partnerAcceptance?.decidedByUserId === createdByUserId ||
    (item.status === "active") !==
      (clientAcceptance?.decision === "accepted" &&
        partnerAcceptance?.decision === "accepted") ||
    (item.status === "changes_requested" &&
      clientAcceptance?.decision !== "changes_requested" &&
      partnerAcceptance?.decision !== "changes_requested")
  ) {
    fail();
  }
  return {
    id: id(item.id),
    iteration: integer(item.iteration, 1, 500),
    workstreamLabel: text(item.workstreamLabel, 160),
    responsibleParty: party(item.responsibleParty),
    accountableParty: party(item.accountableParty),
    ownerUserId: id(item.ownerUserId),
    dueAt: nullableInstant(item.dueAt),
    status: item.status,
    requiredAcceptance: "both_parties",
    acceptances: {
      client: clientAcceptance,
      partner: partnerAcceptance,
    },
    createdByUserId,
    createdAt: instant(item.createdAt),
    updatedByUserId: id(item.updatedByUserId),
    updatedAt: instant(item.updatedAt),
  };
}

function qaItem(value: unknown): ConsortiumQaItem {
  const item = record(value);
  if (
    !QA_CODES.includes(item.code as ConsortiumQaItem["code"]) ||
    typeof item.required !== "boolean" ||
    (item.status !== "open" &&
      item.status !== "ready_for_check" &&
      item.status !== "checked")
  ) {
    fail();
  }
  const decision =
    item.lastDecision === null ? null : record(item.lastDecision);
  if (
    decision &&
    decision.decision !== "checked" &&
    decision.decision !== "rejected"
  ) {
    fail();
  }
  const preparerParty = party(item.preparerParty);
  const checkerParty = party(item.checkerParty);
  const ownerUserId = id(item.ownerUserId);
  const evidenceSha256 = nullableSha(item.evidenceSha256);
  const preparedByUserId =
    item.preparedByUserId === null ? null : id(item.preparedByUserId);
  const preparedAt = nullableInstant(item.preparedAt);
  const lastDecision = decision
    ? {
        decision: decision.decision as "checked" | "rejected",
        reasonCode: reason(decision.reasonCode),
        decidedByUserId: id(decision.decidedByUserId),
        decidedAt: instant(decision.decidedAt),
      }
    : null;
  if (
    preparerParty === checkerParty ||
    (lastDecision?.decision === "checked" &&
      lastDecision.reasonCode !== null) ||
    (lastDecision?.decision === "rejected" &&
      lastDecision.reasonCode === null) ||
    (item.status === "open" &&
      (evidenceSha256 !== null ||
        preparedByUserId !== null ||
        preparedAt !== null ||
        lastDecision?.decision === "checked")) ||
    (item.status !== "open" &&
      (!evidenceSha256 ||
        !preparedByUserId ||
        !preparedAt ||
        preparedByUserId !== ownerUserId)) ||
    (item.status === "ready_for_check" && lastDecision !== null) ||
    (item.status === "checked" &&
      (lastDecision?.decision !== "checked" ||
        lastDecision.decidedByUserId === preparedByUserId))
  ) {
    fail();
  }
  return {
    id: id(item.id),
    code: item.code as ConsortiumQaItem["code"],
    required: item.required,
    preparerParty,
    checkerParty,
    ownerUserId,
    status: item.status,
    evidenceSha256,
    preparedByUserId,
    preparedAt,
    lastDecision,
  };
}

function auditReceipt(
  value: unknown,
  expectedSequence: number,
  previousReceiptSha256: string | null,
): ConsortiumAuditReceipt {
  const item = record(value);
  if (
    item.sequence !== expectedSequence ||
    item.priorVersion !== expectedSequence - 1 ||
    item.nextVersion !== expectedSequence ||
    item.previousReceiptSha256 !== previousReceiptSha256 ||
    ![
      "room_created",
      "responsibility_added",
      "responsibility_revised",
      "responsibility_decided",
      "qa_prepared",
      "qa_decided",
    ].includes(String(item.action))
  ) {
    fail();
  }
  return {
    id: id(item.id),
    sequence: expectedSequence,
    action: item.action as ConsortiumAuditReceipt["action"],
    objectId: id(item.objectId),
    actorUserId: id(item.actorUserId),
    actorParty: party(item.actorParty),
    priorVersion: expectedSequence - 1,
    nextVersion: expectedSequence,
    factsSha256: sha(item.factsSha256),
    previousReceiptSha256,
    receiptSha256: sha(item.receiptSha256),
    occurredAt: instant(item.occurredAt),
  };
}

function parseRoom(
  value: unknown,
  expectedOrganisationId: string,
  expectedProjectId: string,
  expectedRelationshipId: string,
): PartnerConsortiumRoom {
  const room = record(value);
  const retention = record(room.retention);
  const boundaries = record(room.authorityBoundaries);
  if (
    !Array.isArray(room.responsibilities) ||
    room.responsibilities.length > 40 ||
    !Array.isArray(room.qaChecklist) ||
    room.qaChecklist.length !== 4 ||
    !Array.isArray(room.auditReceipts) ||
    room.auditReceipts.length < 1 ||
    room.auditReceipts.length > 500 ||
    !["draft", "active", "qa_in_progress", "ready_for_client_release"].includes(
      String(room.status),
    ) ||
    typeof room.coSigningRequired !== "boolean" ||
    retention.namespace !== "valo.partner-consortium-room/v1" ||
    retention.class !== "project_coordination" ||
    retention.owner !== "client_organisation" ||
    retention.trigger !== "owning_project_retention_policy" ||
    retention.independentDeletionAllowed !== false ||
    boundaries.legalAgreementGeneration !== false ||
    boundaries.revenueSettlement !== false ||
    boundaries.messaging !== false ||
    boundaries.crossClientLearning !== false ||
    boundaries.autonomousExternalAction !== false
  ) {
    fail();
  }
  const organisationId = id(room.organisationId);
  const projectId = id(room.projectId);
  const relationshipId = id(room.relationshipId);
  if (
    organisationId !== expectedOrganisationId ||
    projectId !== expectedProjectId ||
    relationshipId !== expectedRelationshipId
  ) {
    fail();
  }
  const version = integer(room.version, 1, 500);
  if (room.auditReceipts.length !== version) fail();
  let previous: string | null = null;
  const auditReceipts = room.auditReceipts.map((entry, index) => {
    const parsed = auditReceipt(entry, index + 1, previous);
    previous = parsed.receiptSha256;
    return parsed;
  });
  const responsibilities = room.responsibilities.map(responsibility);
  const qaChecklist = room.qaChecklist.map(qaItem);
  const qaCodes = qaChecklist.map(({ code }) => code);
  if (
    new Set(qaCodes).size !== QA_CODES.length ||
    !QA_CODES.every((code) => qaCodes.includes(code))
  ) {
    fail();
  }
  const clientCoordinatorUserId = id(room.clientCoordinatorUserId);
  const partnerCoordinatorUserId = id(room.partnerCoordinatorUserId);
  const coSigningRequired = room.coSigningRequired;
  if (
    qaChecklist.some((item) =>
      item.code === "partner_cosign"
        ? item.required !== coSigningRequired ||
          item.preparerParty !== "client" ||
          item.checkerParty !== "partner" ||
          item.ownerUserId !== clientCoordinatorUserId
        : item.required !== true ||
          item.preparerParty !== "partner" ||
          item.checkerParty !== "client" ||
          item.ownerUserId !== partnerCoordinatorUserId,
    )
  ) {
    fail();
  }
  const requiredQa = qaChecklist.filter(({ required }) => required);
  const derivedStatus: PartnerConsortiumRoom["status"] =
    responsibilities.length === 0 ||
    responsibilities.some(({ status }) => status !== "active")
      ? "draft"
      : requiredQa.length > 0 &&
          requiredQa.every(({ status }) => status === "checked")
        ? "ready_for_client_release"
        : requiredQa.some(({ status }) => status !== "open")
          ? "qa_in_progress"
          : "active";
  if (room.status !== derivedStatus) fail();
  return {
    id: id(room.id),
    organisationId,
    projectId,
    relationshipId,
    clientOrganisationId: id(room.clientOrganisationId),
    partnerOrganisationId: id(room.partnerOrganisationId),
    clientCoordinatorUserId,
    partnerCoordinatorUserId,
    coSigningRequired,
    status: room.status as PartnerConsortiumRoom["status"],
    version,
    responsibilities,
    qaChecklist,
    auditReceipts,
    createdByUserId: id(room.createdByUserId),
    updatedByUserId: id(room.updatedByUserId),
    createdAt: instant(room.createdAt),
    updatedAt: instant(room.updatedAt),
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
  };
}

export function adaptConsortiumSnapshot(
  value: unknown,
  expectedOrganisationId: string,
  expectedProjectId: string,
  expectedRelationshipId: string,
): ConsortiumSnapshot {
  const snapshot = record(value);
  const relationship = record(snapshot.relationship);
  const organisationId = id(snapshot.organisationId);
  const projectId = id(snapshot.projectId);
  const relationshipId = id(snapshot.relationshipId);
  if (
    organisationId !== expectedOrganisationId ||
    projectId !== expectedProjectId ||
    relationshipId !== expectedRelationshipId ||
    !PARTIES.includes(snapshot.actorParty as ConsortiumParty) ||
    typeof relationship.coSigningRequired !== "boolean"
  ) {
    fail();
  }
  return {
    organisationId,
    projectId,
    relationshipId,
    actorParty: snapshot.actorParty as ConsortiumParty,
    room: parseRoom(snapshot.room, organisationId, projectId, relationshipId),
    relationship: {
      version: integer(relationship.version),
      coSigningRequired: relationship.coSigningRequired,
      qaResponsibilitySha256: nullableSha(relationship.qaResponsibilitySha256),
    },
  };
}

export function adaptConsortiumParticipants(
  value: unknown,
  expectedOrganisationId: string,
  expectedProjectId: string,
  expectedRelationshipId: string,
): ConsortiumParticipantDirectory {
  const directory = record(value);
  if (
    Object.keys(directory).length !== 6 ||
    directory.organisationId !== expectedOrganisationId ||
    directory.projectId !== expectedProjectId ||
    directory.relationshipId !== expectedRelationshipId ||
    directory.limit !== 100 ||
    directory.truncated !== false ||
    !Array.isArray(directory.items) ||
    directory.items.length > 100
  ) {
    fail();
  }
  const seen = new Set<string>();
  const items = directory.items.map((value) => {
    const item = record(value);
    if (Object.keys(item).length !== 3) fail();
    const userId = id(item.userId);
    const name = text(item.name, 512);
    const participantParty = party(item.party);
    const key = `${participantParty}:${userId}`;
    if (name !== name.trim() || seen.has(key)) fail();
    seen.add(key);
    return { userId, name, party: participantParty };
  });
  return {
    organisationId: expectedOrganisationId,
    projectId: expectedProjectId,
    relationshipId: expectedRelationshipId,
    items,
    limit: 100,
    truncated: false,
  };
}
