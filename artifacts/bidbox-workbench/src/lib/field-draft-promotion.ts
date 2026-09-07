import {
  requireRecord,
  SHA256_PATTERN as SHA256,
  UUID_PATTERN as UUID,
} from "./closed-contract";

export const FIELD_DRAFT_PROMOTION_SCHEMA =
  "valo.encrypted-field-promotion/v1" as const;
export const FIELD_DRAFT_PROMOTION_RECEIPT_SCHEMA =
  "valo.field-draft-promotion-receipt/v1" as const;
export const FIELD_DRAFT_PROMOTION_FIELDS = [
  "title",
  "note",
  "checklist",
] as const;

export type FieldDraftPromotionField =
  (typeof FIELD_DRAFT_PROMOTION_FIELDS)[number];

export interface FieldDraftPromotionTarget {
  id: string;
  organisationId: string;
  projectId: string;
  version: number;
  title: string;
  description: string;
  status:
    | "backlog"
    | "ready"
    | "in_progress"
    | "blocked"
    | "in_review"
    | "done"
    | "cancelled";
  approvalStatus: "not_required" | "pending" | "approved" | "rejected";
  commentCount: number;
  compatible: boolean;
  promotionReceipts: StoredFieldDraftPromotionReceipt[];
}

export interface PromotableFieldDraft {
  id: string;
  version: number;
  organisationId: string;
  actorUserId: string;
  projectId: string | null;
  kind: "site_visit_note" | "delivery_receipt_note" | "checklist_progress";
  title: string;
  note: string;
  checklist: Array<{ id: string; label: string; completed: boolean }>;
  updatedAt: string;
}

export interface FieldDraftPromotionCommand {
  schema: typeof FIELD_DRAFT_PROMOTION_SCHEMA;
  draft: {
    id: string;
    version: number;
    organisationId: string;
    actorUserId: string;
    projectId: string;
    kind: PromotableFieldDraft["kind"];
    updatedAt: string;
  };
  expectedTargetVersion: number;
  selectedFields: FieldDraftPromotionField[];
  values: {
    title?: string;
    note?: string;
    checklist?: Array<{ id: string; label: string; completed: boolean }>;
  };
}

export interface StoredFieldDraftPromotionReceipt {
  schema: typeof FIELD_DRAFT_PROMOTION_RECEIPT_SCHEMA;
  organisationId: string;
  projectId: string;
  targetRecordId: string;
  targetKind: "work_item";
  targetVersion: number;
  draftId: string;
  draftVersion: number;
  promotedByUserId: string;
  selectedFields: FieldDraftPromotionField[];
  idempotencyKey: string;
  requestSha256: string;
  receiptSha256: string;
  promotedAt: string;
  authoritativeEvidenceCreated: false;
  localDraftDeleted: false;
}

export interface FieldDraftPromotionReceipt extends StoredFieldDraftPromotionReceipt {
  replayed: boolean;
}

export interface FieldDraftPromotionDiff {
  field: FieldDraftPromotionField;
  label: string;
  before: string;
  after: string;
  effect: "replace" | "append";
}

export class FieldDraftPromotionError extends Error {
  readonly name = "FieldDraftPromotionError";
  constructor(
    readonly code:
      | "invalid_target"
      | "scope_changed"
      | "incompatible_target"
      | "invalid_selection"
      | "receipt_invalid",
  ) {
    super("Field-draft promotion validation failed");
  }
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

const fail = (code: FieldDraftPromotionError["code"]): never => {
  throw new FieldDraftPromotionError(code);
};

function object(value: unknown): Record<string, unknown> {
  return requireRecord(value, () => fail("invalid_target"));
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const keys = Object.keys(value);
  if (
    required.some((key) => !keys.includes(key)) ||
    keys.some((key) => !required.includes(key) && !optional.includes(key))
  ) {
    fail("invalid_target");
  }
}

function text(value: unknown, maximum: number, allowEmpty = false): string {
  if (typeof value !== "string") {
    fail("invalid_target");
  }
  const parsed = value as string;
  if (
    parsed !== parsed.trim() ||
    (!allowEmpty && parsed.length === 0) ||
    parsed.length > maximum ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\ud800-\udfff]/u.test(parsed)
  ) {
    fail("invalid_target");
  }
  return parsed;
}

function id(value: unknown): string {
  const parsed = text(value, 128);
  return ID.test(parsed) ? parsed : fail("invalid_target");
}

function uuid(value: unknown): string {
  const parsed = text(value, 36);
  return UUID.test(parsed) ? parsed : fail("invalid_target");
}

function integer(value: unknown, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    fail("invalid_target");
  }
  return value as number;
}

function instant(value: unknown): string {
  if (typeof value !== "string") {
    fail("invalid_target");
  }
  const parsed = value as string;
  if (!Number.isFinite(Date.parse(parsed))) {
    fail("invalid_target");
  }
  return new Date(parsed).toISOString();
}

function nullableText(value: unknown, maximum: number): string {
  return value === null ? "" : text(value, maximum);
}

function nullableId(value: unknown): string | null {
  return value === null ? null : id(value);
}

function nullableInstant(value: unknown): string | null {
  return value === null ? null : instant(value);
}

function parseFieldList(value: unknown): FieldDraftPromotionField[] {
  if (!Array.isArray(value)) {
    fail("invalid_target");
  }
  const entries = value as unknown[];
  if (entries.length < 1 || entries.length > 3) {
    fail("invalid_target");
  }
  const parsed = entries.map((entry) =>
    typeof entry === "string" &&
    FIELD_DRAFT_PROMOTION_FIELDS.includes(entry as FieldDraftPromotionField)
      ? (entry as FieldDraftPromotionField)
      : fail("invalid_target"),
  );
  const canonical = FIELD_DRAFT_PROMOTION_FIELDS.filter((field) =>
    parsed.includes(field),
  );
  if (
    new Set(parsed).size !== parsed.length ||
    canonical.some((field, index) => field !== parsed[index])
  ) {
    fail("invalid_target");
  }
  return parsed;
}

function parseStoredReceipt(value: unknown): StoredFieldDraftPromotionReceipt {
  const receipt = object(value);
  exactKeys(receipt, [
    "schema",
    "organisationId",
    "projectId",
    "targetRecordId",
    "targetKind",
    "targetVersion",
    "draftId",
    "draftVersion",
    "promotedByUserId",
    "selectedFields",
    "idempotencyKey",
    "requestSha256",
    "receiptSha256",
    "promotedAt",
    "authoritativeEvidenceCreated",
    "localDraftDeleted",
  ]);
  if (
    receipt.schema !== FIELD_DRAFT_PROMOTION_RECEIPT_SCHEMA ||
    receipt.targetKind !== "work_item" ||
    receipt.authoritativeEvidenceCreated !== false ||
    receipt.localDraftDeleted !== false ||
    typeof receipt.requestSha256 !== "string" ||
    !SHA256.test(receipt.requestSha256) ||
    typeof receipt.receiptSha256 !== "string" ||
    !SHA256.test(receipt.receiptSha256)
  ) {
    fail("invalid_target");
  }
  const requestSha256 = receipt.requestSha256 as string;
  const receiptSha256 = receipt.receiptSha256 as string;
  if (typeof requestSha256 !== "string" || typeof receiptSha256 !== "string") {
    fail("invalid_target");
  }
  return {
    schema: FIELD_DRAFT_PROMOTION_RECEIPT_SCHEMA,
    organisationId: uuid(receipt.organisationId),
    projectId: uuid(receipt.projectId),
    targetRecordId: id(receipt.targetRecordId),
    targetKind: "work_item",
    targetVersion: integer(receipt.targetVersion, 2),
    draftId: uuid(receipt.draftId),
    draftVersion: integer(receipt.draftVersion, 1),
    promotedByUserId: id(receipt.promotedByUserId),
    selectedFields: parseFieldList(receipt.selectedFields),
    idempotencyKey: uuid(receipt.idempotencyKey),
    requestSha256,
    receiptSha256,
    promotedAt: instant(receipt.promotedAt),
    authoritativeEvidenceCreated: false,
    localDraftDeleted: false,
  };
}

function assertIdentifiers(value: unknown, maximum: number): void {
  if (!Array.isArray(value)) fail("invalid_target");
  const entries = value as unknown[];
  if (entries.length > maximum) fail("invalid_target");
  const parsed = entries.map(id);
  if (new Set(parsed).size !== parsed.length) fail("invalid_target");
}

export function adaptFieldDraftPromotionTarget(
  value: unknown,
  scope: { organisationId: string; projectId: string },
): FieldDraftPromotionTarget {
  const target = object(value);
  exactKeys(
    target,
    [
      "id",
      "kind",
      "organisationId",
      "projectId",
      "version",
      "createdByUserId",
      "updatedByUserId",
      "createdAt",
      "updatedAt",
      "title",
      "description",
      "ownerUserId",
      "dueAt",
      "priority",
      "status",
      "links",
      "dependsOnIds",
      "comments",
      "approval",
      "statusReasonHistory",
    ],
    ["fieldPromotionReceipts"],
  );
  if (target.kind !== "work_item") fail("invalid_target");
  const organisationId = uuid(target.organisationId);
  const projectId = uuid(target.projectId);
  if (
    organisationId !== scope.organisationId ||
    projectId !== scope.projectId
  ) {
    fail("scope_changed");
  }
  id(target.createdByUserId);
  id(target.updatedByUserId);
  instant(target.createdAt);
  instant(target.updatedAt);
  nullableId(target.ownerUserId);
  nullableInstant(target.dueAt);
  if (
    !(["low", "normal", "high", "critical"] as const).includes(
      target.priority as "low",
    )
  ) {
    fail("invalid_target");
  }
  const status = target.status;
  if (
    !(
      [
        "backlog",
        "ready",
        "in_progress",
        "blocked",
        "in_review",
        "done",
        "cancelled",
      ] as const
    ).includes(status as "backlog")
  ) {
    fail("invalid_target");
  }
  const links = object(target.links);
  exactKeys(links, ["requirementIds", "evidenceItemIds", "packageIds"]);
  assertIdentifiers(links.requirementIds, 100);
  assertIdentifiers(links.evidenceItemIds, 100);
  assertIdentifiers(links.packageIds, 100);
  assertIdentifiers(target.dependsOnIds, 50);

  if (!Array.isArray(target.comments)) {
    fail("invalid_target");
  }
  const comments = target.comments as unknown[];
  if (comments.length > 100) {
    fail("invalid_target");
  }
  for (const entry of comments) {
    const comment = object(entry);
    exactKeys(comment, ["id", "body", "authorUserId", "createdAt"]);
    id(comment.id);
    text(comment.body, 2_048);
    id(comment.authorUserId);
    instant(comment.createdAt);
  }
  const approval = object(target.approval);
  exactKeys(approval, ["status", "decidedByUserId", "decidedAt", "reason"]);
  if (
    !(["not_required", "pending", "approved", "rejected"] as const).includes(
      approval.status as "not_required",
    )
  ) {
    fail("invalid_target");
  }
  nullableId(approval.decidedByUserId);
  nullableInstant(approval.decidedAt);
  if (approval.reason !== null) text(approval.reason, 4_096);
  if (!Array.isArray(target.statusReasonHistory)) {
    fail("invalid_target");
  }
  const statusReasonHistory = target.statusReasonHistory as unknown[];
  if (statusReasonHistory.length > 100) {
    fail("invalid_target");
  }
  for (const entry of statusReasonHistory) {
    const reason = object(entry);
    exactKeys(reason, [
      "id",
      "fromStatus",
      "toStatus",
      "reason",
      "recordedByUserId",
      "recordedAt",
    ]);
    id(reason.id);
    text(reason.fromStatus, 64);
    text(reason.toStatus, 64);
    text(reason.reason, 1_024);
    id(reason.recordedByUserId);
    instant(reason.recordedAt);
  }
  const receipts =
    target.fieldPromotionReceipts === undefined
      ? []
      : Array.isArray(target.fieldPromotionReceipts) &&
          target.fieldPromotionReceipts.length <= 25
        ? target.fieldPromotionReceipts.map(parseStoredReceipt)
        : fail("invalid_target");
  if (
    new Set(receipts.map(({ idempotencyKey }) => idempotencyKey)).size !==
    receipts.length
  ) {
    fail("invalid_target");
  }
  if (
    new Set(
      receipts.map(
        ({ organisationId, projectId, draftId, draftVersion }) =>
          `${organisationId}\u0000${projectId}\u0000${draftId}\u0000${draftVersion}`,
      ),
    ).size !== receipts.length
  ) {
    fail("invalid_target");
  }
  const typedStatus = status as FieldDraftPromotionTarget["status"];
  const approvalStatus =
    approval.status as FieldDraftPromotionTarget["approvalStatus"];
  return {
    id: id(target.id),
    organisationId,
    projectId,
    version: integer(target.version, 1),
    title: text(target.title, 4_096),
    description: nullableText(target.description, 4_096),
    status: typedStatus,
    approvalStatus,
    commentCount: comments.length,
    compatible:
      !["done", "cancelled"].includes(typedStatus) &&
      approvalStatus !== "approved" &&
      receipts.length < 25,
    promotionReceipts: receipts,
  };
}

export function buildFieldDraftPromotionCommand(
  draft: PromotableFieldDraft,
  target: FieldDraftPromotionTarget,
  selectedFields: readonly FieldDraftPromotionField[],
  scope: { organisationId: string; actorUserId: string; projectId: string },
): { command: FieldDraftPromotionCommand; diff: FieldDraftPromotionDiff[] } {
  if (
    draft.organisationId !== scope.organisationId ||
    draft.actorUserId !== scope.actorUserId ||
    draft.projectId !== scope.projectId ||
    target.organisationId !== scope.organisationId ||
    target.projectId !== scope.projectId
  ) {
    fail("scope_changed");
  }
  if (!target.compatible) fail("incompatible_target");
  const fields = parseFieldList([...selectedFields]);
  if (
    fields.includes("checklist") &&
    target.commentCount + draft.checklist.length > 100
  ) {
    fail("incompatible_target");
  }
  const values: FieldDraftPromotionCommand["values"] = {
    ...(fields.includes("title") ? { title: draft.title } : {}),
    ...(fields.includes("note") ? { note: draft.note } : {}),
    ...(fields.includes("checklist")
      ? { checklist: draft.checklist.map((item) => ({ ...item })) }
      : {}),
  };
  const changes =
    (fields.includes("title") && draft.title !== target.title) ||
    (fields.includes("note") && draft.note !== target.description) ||
    (fields.includes("checklist") && draft.checklist.length > 0);
  if (!changes) fail("invalid_selection");
  const diff: FieldDraftPromotionDiff[] = fields.map((field) => {
    if (field === "title") {
      return {
        field,
        label: "Work-item title",
        before: target.title,
        after: draft.title,
        effect: "replace",
      };
    }
    if (field === "note") {
      return {
        field,
        label: "Work-item description",
        before: target.description || "No description recorded",
        after: draft.note || "Clear the current description",
        effect: "replace",
      };
    }
    return {
      field,
      label: "Reviewed checklist notes",
      before: `${target.commentCount} existing work-item comment(s)`,
      after: `${draft.checklist.length} checklist item(s) appended as named-human comments`,
      effect: "append",
    };
  });
  return {
    command: {
      schema: FIELD_DRAFT_PROMOTION_SCHEMA,
      draft: {
        id: draft.id,
        version: draft.version,
        organisationId: draft.organisationId,
        actorUserId: draft.actorUserId,
        projectId: scope.projectId,
        kind: draft.kind,
        updatedAt: draft.updatedAt,
      },
      expectedTargetVersion: target.version,
      selectedFields: fields,
      values,
    },
    diff,
  };
}

export function adaptFieldDraftPromotionReceipt(
  value: unknown,
): FieldDraftPromotionReceipt {
  const raw = object(value);
  exactKeys(raw, [
    "schema",
    "organisationId",
    "projectId",
    "targetRecordId",
    "targetKind",
    "targetVersion",
    "draftId",
    "draftVersion",
    "promotedByUserId",
    "selectedFields",
    "idempotencyKey",
    "requestSha256",
    "receiptSha256",
    "promotedAt",
    "authoritativeEvidenceCreated",
    "localDraftDeleted",
    "replayed",
  ]);
  const replayed = raw.replayed;
  if (typeof replayed !== "boolean") fail("receipt_invalid");
  const { replayed: _replayed, ...stored } = raw;
  return { ...parseStoredReceipt(stored), replayed: replayed as boolean };
}

function bytesToHex(value: ArrayBuffer): string {
  return [...new Uint8Array(value)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function digest(value: unknown): Promise<string> {
  if (!globalThis.crypto?.subtle) fail("receipt_invalid");
  return bytesToHex(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(JSON.stringify(value)),
    ),
  );
}

function requestMaterial(
  command: FieldDraftPromotionCommand,
  targetRecordId: string,
  idempotencyKey: string,
) {
  return {
    schema: command.schema,
    draft: {
      id: command.draft.id,
      version: command.draft.version,
      organisationId: command.draft.organisationId,
      actorUserId: command.draft.actorUserId,
      projectId: command.draft.projectId,
      kind: command.draft.kind,
      updatedAt: command.draft.updatedAt,
    },
    targetRecordId,
    expectedTargetVersion: command.expectedTargetVersion,
    selectedFields: command.selectedFields,
    values: {
      ...(command.selectedFields.includes("title")
        ? { title: command.values.title }
        : {}),
      ...(command.selectedFields.includes("note")
        ? { note: command.values.note }
        : {}),
      ...(command.selectedFields.includes("checklist")
        ? { checklist: command.values.checklist }
        : {}),
    },
    idempotencyKey,
  };
}

function receiptMaterial(receipt: StoredFieldDraftPromotionReceipt) {
  return {
    schema: receipt.schema,
    organisationId: receipt.organisationId,
    projectId: receipt.projectId,
    targetRecordId: receipt.targetRecordId,
    targetKind: receipt.targetKind,
    targetVersion: receipt.targetVersion,
    draftId: receipt.draftId,
    draftVersion: receipt.draftVersion,
    promotedByUserId: receipt.promotedByUserId,
    selectedFields: receipt.selectedFields,
    idempotencyKey: receipt.idempotencyKey,
    requestSha256: receipt.requestSha256,
    promotedAt: receipt.promotedAt,
    authoritativeEvidenceCreated: receipt.authoritativeEvidenceCreated,
    localDraftDeleted: receipt.localDraftDeleted,
  };
}

export async function verifyFieldDraftPromotionReceipt(
  receipt: FieldDraftPromotionReceipt,
  command: FieldDraftPromotionCommand,
  targetRecordId: string,
  idempotencyKey: string,
): Promise<FieldDraftPromotionReceipt> {
  const requestSha256 = await digest(
    requestMaterial(command, targetRecordId, idempotencyKey),
  );
  if (
    receipt.schema !== FIELD_DRAFT_PROMOTION_RECEIPT_SCHEMA ||
    receipt.organisationId !== command.draft.organisationId ||
    receipt.projectId !== command.draft.projectId ||
    receipt.targetRecordId !== targetRecordId ||
    receipt.targetKind !== "work_item" ||
    receipt.targetVersion !== command.expectedTargetVersion + 1 ||
    receipt.draftId !== command.draft.id ||
    receipt.draftVersion !== command.draft.version ||
    receipt.promotedByUserId !== command.draft.actorUserId ||
    receipt.idempotencyKey !== idempotencyKey ||
    receipt.requestSha256 !== requestSha256 ||
    receipt.authoritativeEvidenceCreated !== false ||
    receipt.localDraftDeleted !== false ||
    receipt.selectedFields.length !== command.selectedFields.length ||
    receipt.selectedFields.some(
      (field, index) => field !== command.selectedFields[index],
    ) ||
    receipt.receiptSha256 !== (await digest(receiptMaterial(receipt)))
  ) {
    fail("receipt_invalid");
  }
  return receipt;
}

export async function recoverVerifiedFieldDraftPromotionReceipt(
  target: FieldDraftPromotionTarget,
  command: FieldDraftPromotionCommand,
  idempotencyKey: string,
): Promise<FieldDraftPromotionReceipt | null> {
  const stored = target.promotionReceipts.find(
    (receipt) => receipt.idempotencyKey === idempotencyKey,
  );
  if (!stored) return null;
  return verifyFieldDraftPromotionReceipt(
    { ...stored, replayed: true },
    command,
    target.id,
    idempotencyKey,
  );
}
