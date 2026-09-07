import {
  assertExactKeys,
  requireRecord,
  SHA256_PATTERN as SHA256,
  UUID_PATTERN as UUID,
} from "@/lib/closed-contract";

export type CommunicationChannel = "email" | "whatsapp_business";
export type CommunicationTemplateId =
  | "deadline_reminder_v1"
  | "evidence_request_ready_v1"
  | "evidence_correction_required_v1"
  | "package_ready_v1";
export type CommunicationEventStatus =
  | "queued"
  | "prepared"
  | "accepted_pending_receipt"
  | "retry_wait"
  | "reconciliation_required"
  | "delivered"
  | "dead_letter";
export type CommunicationAttemptStatus =
  | "prepared"
  | "provider_disconnected"
  | "policy_blocked"
  | "provider_rejected"
  | "outcome_unknown"
  | "accepted_pending_receipt"
  | "receipt_verified_delivered"
  | "receipt_verified_failed";

export type CommunicationTemplateContext =
  | { kind: "deadline"; deadlineAt: string }
  | { kind: "evidence_request"; requestId: string; dueAt: string | null }
  | {
      kind: "evidence_correction";
      requestId: string;
      correctionSequence: number;
    }
  | {
      kind: "released_package";
      packageVersionId: string;
      manifestSha256: string;
    };

export interface CommunicationAttempt {
  id: string;
  attemptNumber: number;
  provider: string;
  idempotencyKey: string;
  status: CommunicationAttemptStatus;
  providerMessageId: string | null;
  receiptSha256: string | null;
  responseCode: string | null;
  attemptedAt: string;
  nextAttemptAt: string | null;
}

export interface CommunicationEvent {
  id: string;
  organisationId: string;
  projectId: string;
  channel: CommunicationChannel;
  templateId: CommunicationTemplateId;
  recipientUserId: string;
  consentEvidenceSha256: string;
  context: CommunicationTemplateContext;
  status: CommunicationEventStatus;
  requestedByUserId: string;
  requestedAt: string;
  deadlineAt: string;
  maxAttempts: number;
  version: number;
  attempts: CommunicationAttempt[];
  deliveryAuthority: "verified_provider_receipt_only";
  arbitraryBodyAccepted: false;
  rawRecipientPersisted: false;
}

export interface CommunicationSnapshot {
  organisationId: string;
  projectId: string;
  events: CommunicationEvent[];
  policy: {
    approvedTemplatesOnly: true;
    arbitraryBodyAccepted: false;
    arbitraryRecipientAccepted: false;
    deliveryRequiresVerifiedProviderReceipt: true;
    autonomousDispatch: false;
    providersConnected: boolean;
  };
}

export interface CommunicationRecipientReference {
  userId: string;
  name: string;
  channel: "email";
  consentEvidenceSha256: string;
}

export interface CommunicationContextReference {
  id: string;
  recipientUserId: string | null;
  label: string;
  templateId: CommunicationTemplateId;
  context: CommunicationTemplateContext;
}

export interface CommunicationReferenceSet {
  organisationId: string;
  projectId: string;
  recipients: CommunicationRecipientReference[];
  contexts: CommunicationContextReference[];
  limit: 100;
  truncated: boolean;
}

export type CommunicationMutation =
  | { kind: "queue"; path: "intents"; body: Record<string, unknown> }
  | {
      kind: "attempt";
      path: `intents/${string}/attempts`;
      body: { expectedVersion: number };
    }
  | {
      kind: "reconcile";
      path: `intents/${string}/reconciliations`;
      body: {
        expectedVersion: number;
        attemptId: string;
        receiptReference: string;
      };
    };

const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u;
const CHANNELS: readonly CommunicationChannel[] = [
  "email",
  "whatsapp_business",
];
const TEMPLATES: readonly CommunicationTemplateId[] = [
  "deadline_reminder_v1",
  "evidence_request_ready_v1",
  "evidence_correction_required_v1",
  "package_ready_v1",
];
const EVENT_STATUSES: readonly CommunicationEventStatus[] = [
  "queued",
  "prepared",
  "accepted_pending_receipt",
  "retry_wait",
  "reconciliation_required",
  "delivered",
  "dead_letter",
];
const ATTEMPT_STATUSES: readonly CommunicationAttemptStatus[] = [
  "prepared",
  "provider_disconnected",
  "policy_blocked",
  "provider_rejected",
  "outcome_unknown",
  "accepted_pending_receipt",
  "receipt_verified_delivered",
  "receipt_verified_failed",
];

function fail(): never {
  throw new Error("Invalid communications response");
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
  if (!SHA256.test(candidate)) fail();
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

function integer(value: unknown, maximum = Number.MAX_SAFE_INTEGER): number {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < 1 ||
    Number(value) > maximum
  ) {
    fail();
  }
  return Number(value);
}

function reference(value: unknown, maximum: number): string {
  const candidate = text(value, maximum);
  if (!REFERENCE.test(candidate)) fail();
  return candidate;
}

function nullableReference(value: unknown, maximum: number): string | null {
  return value === null ? null : reference(value, maximum);
}

function parseContext(
  value: unknown,
  templateId: CommunicationTemplateId,
): CommunicationTemplateContext {
  const context = record(value);
  if (templateId === "deadline_reminder_v1" && context.kind === "deadline") {
    return { kind: "deadline", deadlineAt: instant(context.deadlineAt) };
  }
  if (
    templateId === "evidence_request_ready_v1" &&
    context.kind === "evidence_request"
  ) {
    return {
      kind: "evidence_request",
      requestId: id(context.requestId),
      dueAt: nullableInstant(context.dueAt),
    };
  }
  if (
    templateId === "evidence_correction_required_v1" &&
    context.kind === "evidence_correction"
  ) {
    return {
      kind: "evidence_correction",
      requestId: id(context.requestId),
      correctionSequence: integer(context.correctionSequence, 5),
    };
  }
  if (
    templateId === "package_ready_v1" &&
    context.kind === "released_package"
  ) {
    return {
      kind: "released_package",
      packageVersionId: id(context.packageVersionId),
      manifestSha256: sha(context.manifestSha256),
    };
  }
  return fail();
}

function parseAttempt(
  value: unknown,
  expectedNumber: number,
): CommunicationAttempt {
  const attempt = record(value);
  if (
    !ATTEMPT_STATUSES.includes(attempt.status as CommunicationAttemptStatus)
  ) {
    fail();
  }
  const attemptNumber = integer(attempt.attemptNumber, 5);
  if (attemptNumber !== expectedNumber) fail();
  return {
    id: id(attempt.id),
    attemptNumber,
    provider: reference(attempt.provider, 256),
    idempotencyKey: sha(attempt.idempotencyKey),
    status: attempt.status as CommunicationAttemptStatus,
    providerMessageId: nullableReference(attempt.providerMessageId, 256),
    receiptSha256: nullableSha(attempt.receiptSha256),
    responseCode: nullableReference(attempt.responseCode, 96),
    attemptedAt: instant(attempt.attemptedAt),
    nextAttemptAt: nullableInstant(attempt.nextAttemptAt),
  };
}

function parseEvent(
  value: unknown,
  expectedOrganisationId: string,
  expectedProjectId: string,
): CommunicationEvent {
  const event = record(value);
  if (
    "recipient" in event ||
    "body" in event ||
    "payload" in event ||
    !CHANNELS.includes(event.channel as CommunicationChannel) ||
    !TEMPLATES.includes(event.templateId as CommunicationTemplateId) ||
    !EVENT_STATUSES.includes(event.status as CommunicationEventStatus) ||
    !Array.isArray(event.attempts) ||
    event.attempts.length > 5 ||
    event.deliveryAuthority !== "verified_provider_receipt_only" ||
    event.arbitraryBodyAccepted !== false ||
    event.rawRecipientPersisted !== false
  ) {
    fail();
  }
  const organisationId = id(event.organisationId);
  const projectId = id(event.projectId);
  if (
    organisationId !== expectedOrganisationId ||
    projectId !== expectedProjectId
  ) {
    fail();
  }
  const templateId = event.templateId as CommunicationTemplateId;
  return {
    id: id(event.id),
    organisationId,
    projectId,
    channel: event.channel as CommunicationChannel,
    templateId,
    recipientUserId: id(event.recipientUserId),
    consentEvidenceSha256: sha(event.consentEvidenceSha256),
    context: parseContext(event.context, templateId),
    status: event.status as CommunicationEventStatus,
    requestedByUserId: id(event.requestedByUserId),
    requestedAt: instant(event.requestedAt),
    deadlineAt: instant(event.deadlineAt),
    maxAttempts: integer(event.maxAttempts, 5),
    version: integer(event.version),
    attempts: event.attempts.map((attempt, index) =>
      parseAttempt(attempt, index + 1),
    ),
    deliveryAuthority: "verified_provider_receipt_only",
    arbitraryBodyAccepted: false,
    rawRecipientPersisted: false,
  };
}

export function adaptCommunicationSnapshot(
  value: unknown,
  expectedProjectId: string,
  expectedOrganisationId: string,
): CommunicationSnapshot {
  const snapshot = record(value);
  const policy = record(snapshot.policy);
  if (
    !Array.isArray(snapshot.events) ||
    snapshot.events.length > 250 ||
    policy.approvedTemplatesOnly !== true ||
    policy.arbitraryBodyAccepted !== false ||
    policy.arbitraryRecipientAccepted !== false ||
    policy.deliveryRequiresVerifiedProviderReceipt !== true ||
    policy.autonomousDispatch !== false ||
    typeof policy.providersConnected !== "boolean"
  ) {
    fail();
  }
  const organisationId = id(snapshot.organisationId);
  const projectId = id(snapshot.projectId);
  if (
    organisationId !== expectedOrganisationId ||
    projectId !== expectedProjectId
  ) {
    fail();
  }
  return {
    organisationId,
    projectId,
    events: snapshot.events.map((event) =>
      parseEvent(event, organisationId, projectId),
    ),
    policy: {
      approvedTemplatesOnly: true,
      arbitraryBodyAccepted: false,
      arbitraryRecipientAccepted: false,
      deliveryRequiresVerifiedProviderReceipt: true,
      autonomousDispatch: false,
      providersConnected: policy.providersConnected,
    },
  };
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  assertExactKeys(value, keys, fail);
}

export function adaptCommunicationReferences(
  value: unknown,
  expectedProjectId: string,
  expectedOrganisationId: string,
): CommunicationReferenceSet {
  const response = record(value);
  exactKeys(response, [
    "organisationId",
    "projectId",
    "recipients",
    "contexts",
    "limit",
    "truncated",
  ]);
  if (
    !Array.isArray(response.recipients) ||
    !Array.isArray(response.contexts) ||
    response.recipients.length > 100 ||
    response.contexts.length > 100 ||
    response.limit !== 100 ||
    typeof response.truncated !== "boolean"
  ) {
    fail();
  }
  const organisationId = id(response.organisationId);
  const projectId = id(response.projectId);
  if (
    organisationId !== expectedOrganisationId ||
    projectId !== expectedProjectId
  ) {
    fail();
  }
  const recipientIds = new Set<string>();
  const recipients = response.recipients.map((value) => {
    const candidate = record(value);
    exactKeys(candidate, [
      "userId",
      "name",
      "channel",
      "consentEvidenceSha256",
    ]);
    const userId = id(candidate.userId);
    if (recipientIds.has(userId) || candidate.channel !== "email") fail();
    recipientIds.add(userId);
    return {
      userId,
      name: text(candidate.name, 512),
      channel: "email" as const,
      consentEvidenceSha256: sha(candidate.consentEvidenceSha256),
    };
  });
  const contextIds = new Set<string>();
  const contexts = response.contexts.map((value) => {
    const candidate = record(value);
    exactKeys(candidate, [
      "id",
      "recipientUserId",
      "label",
      "templateId",
      "context",
    ]);
    if (!TEMPLATES.includes(candidate.templateId as CommunicationTemplateId)) {
      fail();
    }
    const contextId = reference(candidate.id, 160);
    if (contextIds.has(contextId)) fail();
    contextIds.add(contextId);
    const templateId = candidate.templateId as CommunicationTemplateId;
    return {
      id: contextId,
      recipientUserId:
        candidate.recipientUserId === null
          ? null
          : id(candidate.recipientUserId),
      label: text(candidate.label, 160),
      templateId,
      context: parseContext(candidate.context, templateId),
    };
  });
  return {
    organisationId,
    projectId,
    recipients,
    contexts,
    limit: 100,
    truncated: response.truncated,
  };
}
