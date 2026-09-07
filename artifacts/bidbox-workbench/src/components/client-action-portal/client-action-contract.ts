import {
  requireRecord,
  SHA256_PATTERN as SHA,
  UUID_PATTERN as ID,
} from "@/lib/closed-contract";

export type ClientActionPurpose =
  | "tender_evidence"
  | "credential_refresh"
  | "clarification_support"
  | "delivery_evidence";

export interface ClientEvidenceAttempt {
  id: string;
  intent: {
    id: string;
    filename: string;
    contentType: string;
    sizeBytes: number;
    declaredSha256: string;
    recordedByUserId: string;
    recordedAt: string;
  };
  document: {
    documentId: string;
    sha256: string;
    attachedByUserId: string;
    attachedAt: string;
  } | null;
  review: {
    decision: "accepted" | "correction_required";
    reason: string;
    reviewedByUserId: string;
    reviewedAt: string;
  } | null;
  correctionAcknowledgement: {
    statement: string;
    acknowledgedByUserId: string;
    acknowledgedAt: string;
  } | null;
}

export interface ClientEvidenceRequest {
  id: string;
  kind: "evidence_request";
  version: number;
  createdByUserId: string;
  recipientUserId: string;
  purpose: ClientActionPurpose;
  purposeStatement: string;
  dueAt: string | null;
  status:
    | "open"
    | "acknowledged"
    | "in_progress"
    | "submitted"
    | "changes_required"
    | "completed";
  requestAcknowledgement: {
    statement: string;
    acknowledgedByUserId: string;
    acknowledgedAt: string;
  } | null;
  slots: Array<{
    id: string;
    label: string;
    required: boolean;
    acceptedContentTypes: string[];
    attempts: ClientEvidenceAttempt[];
  }>;
  completionReceiptSha256: string | null;
  externalMessageSentByValo: false;
}

export interface ClientPackageDelivery {
  id: string;
  kind: "package_delivery";
  version: number;
  createdByUserId: string;
  recipientUserId: string;
  packageVersionId: string;
  manifestSha256: string;
  releaseReceiptSha256: string;
  status: "available_for_acknowledgement" | "acknowledged";
  deliveryMode: "metadata_record_only";
  acknowledgement: {
    statement: string;
    acknowledgedByUserId: string;
    acknowledgedAt: string;
    receiptSha256: string;
  } | null;
  externalDeliveryPerformedByValo: false;
}

export interface ClientActionSnapshot {
  organisationId: string;
  projectId: string;
  records: Array<ClientEvidenceRequest | ClientPackageDelivery>;
  authority: {
    externalMessaging: false;
    rawUpload: false;
    packageTransfer: false;
    uploadIntentOnly: true;
  };
}

export interface ClientActionAuthorityOption {
  userId: string;
  name: string;
}

export interface ClientActionAuthorityDirectory {
  organisationId: string;
  projectId: string;
  items: ClientActionAuthorityOption[];
  limit: 100;
  truncated: false;
}

function record(value: unknown): Record<string, unknown> {
  return requireRecord(value, () => {
    throw new Error("Invalid client-action response");
  });
}

function string(value: unknown, maximum = 1_000): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new Error("Invalid client-action response");
  }
  return value;
}

function identifier(value: unknown): string {
  const candidate = string(value, 64);
  if (!ID.test(candidate)) throw new Error("Invalid client-action response");
  return candidate;
}

function integer(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error("Invalid client-action response");
  }
  return value as number;
}

function digest(value: unknown): string {
  const candidate = string(value, 64);
  if (!SHA.test(candidate)) throw new Error("Invalid client-action response");
  return candidate;
}

function nullableDigest(value: unknown): string | null {
  return value === null ? null : digest(value);
}

function parseAttempt(value: unknown): ClientEvidenceAttempt {
  const item = record(value);
  const intent = record(item.intent);
  const document = item.document === null ? null : record(item.document);
  const review = item.review === null ? null : record(item.review);
  const acknowledgement =
    item.correctionAcknowledgement === null
      ? null
      : record(item.correctionAcknowledgement);
  if (
    !["accepted", "correction_required"].includes(String(review?.decision)) &&
    review !== null
  ) {
    throw new Error("Invalid client-action response");
  }
  return {
    id: identifier(item.id),
    intent: {
      id: identifier(intent.id),
      filename: string(intent.filename, 255),
      contentType: string(intent.contentType, 192),
      sizeBytes: integer(intent.sizeBytes),
      declaredSha256: digest(intent.declaredSha256),
      recordedByUserId: identifier(intent.recordedByUserId),
      recordedAt: string(intent.recordedAt, 64),
    },
    document: document
      ? {
          documentId: identifier(document.documentId),
          sha256: digest(document.sha256),
          attachedByUserId: identifier(document.attachedByUserId),
          attachedAt: string(document.attachedAt, 64),
        }
      : null,
    review: review
      ? {
          decision: review.decision as "accepted" | "correction_required",
          reason: string(review.reason),
          reviewedByUserId: identifier(review.reviewedByUserId),
          reviewedAt: string(review.reviewedAt, 64),
        }
      : null,
    correctionAcknowledgement: acknowledgement
      ? {
          statement: string(acknowledgement.statement),
          acknowledgedByUserId: identifier(
            acknowledgement.acknowledgedByUserId,
          ),
          acknowledgedAt: string(acknowledgement.acknowledgedAt, 64),
        }
      : null,
  };
}

function parseEvidence(value: Record<string, unknown>): ClientEvidenceRequest {
  if (
    ![
      "tender_evidence",
      "credential_refresh",
      "clarification_support",
      "delivery_evidence",
    ].includes(String(value.purpose)) ||
    ![
      "open",
      "acknowledged",
      "in_progress",
      "submitted",
      "changes_required",
      "completed",
    ].includes(String(value.status)) ||
    value.externalMessageSentByValo !== false ||
    !Array.isArray(value.slots) ||
    value.slots.length < 1 ||
    value.slots.length > 20
  ) {
    throw new Error("Invalid client-action response");
  }
  const requestAcknowledgement =
    value.requestAcknowledgement === null
      ? null
      : record(value.requestAcknowledgement);
  return {
    id: identifier(value.id),
    kind: "evidence_request",
    version: integer(value.version),
    createdByUserId: identifier(value.createdByUserId),
    recipientUserId: identifier(value.recipientUserId),
    purpose: value.purpose as ClientActionPurpose,
    purposeStatement: string(value.purposeStatement),
    dueAt: value.dueAt === null ? null : string(value.dueAt, 64),
    status: value.status as ClientEvidenceRequest["status"],
    requestAcknowledgement: requestAcknowledgement
      ? {
          statement: string(requestAcknowledgement.statement),
          acknowledgedByUserId: identifier(
            requestAcknowledgement.acknowledgedByUserId,
          ),
          acknowledgedAt: string(requestAcknowledgement.acknowledgedAt, 64),
        }
      : null,
    slots: value.slots.map((entry) => {
      const slot = record(entry);
      if (
        typeof slot.required !== "boolean" ||
        !Array.isArray(slot.acceptedContentTypes) ||
        slot.acceptedContentTypes.length > 8 ||
        !Array.isArray(slot.attempts) ||
        slot.attempts.length > 10
      ) {
        throw new Error("Invalid client-action response");
      }
      return {
        id: identifier(slot.id),
        label: string(slot.label, 160),
        required: slot.required,
        acceptedContentTypes: slot.acceptedContentTypes.map((entry) =>
          string(entry, 192),
        ),
        attempts: slot.attempts.map(parseAttempt),
      };
    }),
    completionReceiptSha256: nullableDigest(value.completionReceiptSha256),
    externalMessageSentByValo: false,
  };
}

function parseDelivery(value: Record<string, unknown>): ClientPackageDelivery {
  if (
    !["available_for_acknowledgement", "acknowledged"].includes(
      String(value.status),
    ) ||
    value.deliveryMode !== "metadata_record_only" ||
    value.externalDeliveryPerformedByValo !== false
  ) {
    throw new Error("Invalid client-action response");
  }
  const acknowledgement =
    value.acknowledgement === null ? null : record(value.acknowledgement);
  return {
    id: identifier(value.id),
    kind: "package_delivery",
    version: integer(value.version),
    createdByUserId: identifier(value.createdByUserId),
    recipientUserId: identifier(value.recipientUserId),
    packageVersionId: identifier(value.packageVersionId),
    manifestSha256: digest(value.manifestSha256),
    releaseReceiptSha256: digest(value.releaseReceiptSha256),
    status: value.status as ClientPackageDelivery["status"],
    deliveryMode: "metadata_record_only",
    acknowledgement: acknowledgement
      ? {
          statement: string(acknowledgement.statement),
          acknowledgedByUserId: identifier(
            acknowledgement.acknowledgedByUserId,
          ),
          acknowledgedAt: string(acknowledgement.acknowledgedAt, 64),
          receiptSha256: digest(acknowledgement.receiptSha256),
        }
      : null,
    externalDeliveryPerformedByValo: false,
  };
}

export function adaptClientActionSnapshot(
  value: unknown,
  expectedProjectId: string,
  expectedOrganisationId?: string,
): ClientActionSnapshot {
  const snapshot = record(value);
  const authority = record(snapshot.authority);
  if (
    !Array.isArray(snapshot.records) ||
    snapshot.records.length > 200 ||
    authority.externalMessaging !== false ||
    authority.rawUpload !== false ||
    authority.packageTransfer !== false ||
    authority.uploadIntentOnly !== true
  ) {
    throw new Error("Invalid client-action response");
  }
  const projectId = identifier(snapshot.projectId);
  const organisationId = identifier(snapshot.organisationId);
  if (
    projectId !== expectedProjectId ||
    (expectedOrganisationId !== undefined &&
      organisationId !== expectedOrganisationId)
  ) {
    throw new Error("Invalid client-action response");
  }
  return {
    organisationId,
    projectId,
    records: snapshot.records.map((entry) => {
      const item = record(entry);
      if (item.kind === "evidence_request") return parseEvidence(item);
      if (item.kind === "package_delivery") return parseDelivery(item);
      throw new Error("Invalid client-action response");
    }),
    authority: {
      externalMessaging: false,
      rawUpload: false,
      packageTransfer: false,
      uploadIntentOnly: true,
    },
  };
}

export function adaptClientActionAuthorities(
  value: unknown,
  expectedOrganisationId: string,
  expectedProjectId: string,
  currentUserId: string,
): ClientActionAuthorityDirectory {
  const directory = record(value);
  if (
    Object.keys(directory).length !== 5 ||
    directory.organisationId !== expectedOrganisationId ||
    directory.projectId !== expectedProjectId ||
    directory.limit !== 100 ||
    directory.truncated !== false ||
    !Array.isArray(directory.items) ||
    directory.items.length > 100
  ) {
    throw new Error("Invalid client-action authority response");
  }
  const seen = new Set<string>();
  const items = directory.items.map((entry) => {
    const option = record(entry);
    if (Object.keys(option).length !== 2) {
      throw new Error("Invalid client-action authority response");
    }
    const userId = identifier(option.userId);
    const name = string(option.name, 512);
    if (
      userId === currentUserId ||
      seen.has(userId) ||
      name !== name.trim() ||
      /[\u0000-\u001f\u007f\ud800-\udfff]/u.test(name)
    ) {
      throw new Error("Invalid client-action authority response");
    }
    seen.add(userId);
    return { userId, name };
  });
  return {
    organisationId: expectedOrganisationId,
    projectId: expectedProjectId,
    items,
    limit: 100,
    truncated: false,
  };
}
