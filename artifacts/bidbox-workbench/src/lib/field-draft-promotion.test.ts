import { describe, expect, it } from "vitest";
import {
  FIELD_DRAFT_PROMOTION_RECEIPT_SCHEMA,
  adaptFieldDraftPromotionReceipt,
  adaptFieldDraftPromotionTarget,
  buildFieldDraftPromotionCommand,
  recoverVerifiedFieldDraftPromotionReceipt,
  verifyFieldDraftPromotionReceipt,
  type FieldDraftPromotionCommand,
  type FieldDraftPromotionReceipt,
  type PromotableFieldDraft,
} from "./field-draft-promotion";

const ORGANISATION_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const ACTOR_ID = "33333333-3333-4333-8333-333333333333";
const DRAFT_ID = "44444444-4444-4444-8444-444444444444";
const TARGET_ID = "55555555-5555-4555-8555-555555555555";
const IDEMPOTENCY_KEY = "66666666-6666-4666-8666-666666666666";

const draft: PromotableFieldDraft = {
  id: DRAFT_ID,
  version: 2,
  organisationId: ORGANISATION_ID,
  actorUserId: ACTOR_ID,
  projectId: PROJECT_ID,
  kind: "site_visit_note",
  title: "Reviewed site visit",
  note: "The named operator reviewed this note after reconnecting.",
  checklist: [{ id: "arrival", label: "Arrival logged", completed: true }],
  updatedAt: "2026-08-13T08:55:00.000Z",
};

function rawTarget(overrides: Record<string, unknown> = {}) {
  return {
    id: TARGET_ID,
    kind: "work_item",
    organisationId: ORGANISATION_ID,
    projectId: PROJECT_ID,
    version: 4,
    createdByUserId: ACTOR_ID,
    updatedByUserId: ACTOR_ID,
    createdAt: "2026-08-13T08:00:00.000Z",
    updatedAt: "2026-08-13T08:30:00.000Z",
    title: "Original target",
    description: "Original description",
    ownerUserId: ACTOR_ID,
    dueAt: null,
    priority: "normal",
    status: "in_progress",
    links: { requirementIds: [], evidenceItemIds: [], packageIds: [] },
    dependsOnIds: [],
    comments: [],
    approval: {
      status: "not_required",
      decidedByUserId: null,
      decidedAt: null,
      reason: null,
    },
    statusReasonHistory: [],
    ...overrides,
  };
}

const hex = (value: ArrayBuffer) =>
  [...new Uint8Array(value)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

async function sha(value: unknown) {
  return hex(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(JSON.stringify(value)),
    ),
  );
}

async function receiptFor(
  command: FieldDraftPromotionCommand,
): Promise<FieldDraftPromotionReceipt> {
  const requestSha256 = await sha({
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
    targetRecordId: TARGET_ID,
    expectedTargetVersion: command.expectedTargetVersion,
    selectedFields: command.selectedFields,
    values: {
      title: command.values.title,
      note: command.values.note,
      checklist: command.values.checklist,
    },
    idempotencyKey: IDEMPOTENCY_KEY,
  });
  const material = {
    schema: FIELD_DRAFT_PROMOTION_RECEIPT_SCHEMA,
    organisationId: ORGANISATION_ID,
    projectId: PROJECT_ID,
    targetRecordId: TARGET_ID,
    targetKind: "work_item" as const,
    targetVersion: command.expectedTargetVersion + 1,
    draftId: DRAFT_ID,
    draftVersion: draft.version,
    promotedByUserId: ACTOR_ID,
    selectedFields: command.selectedFields,
    idempotencyKey: IDEMPOTENCY_KEY,
    requestSha256,
    promotedAt: "2026-08-13T09:00:00.000Z",
    authoritativeEvidenceCreated: false as const,
    localDraftDeleted: false as const,
  };
  return {
    ...material,
    receiptSha256: await sha(material),
    replayed: false,
  };
}

describe("field draft review-and-promote contract", () => {
  it("strictly adapts an exact compatible governed target", () => {
    const target = adaptFieldDraftPromotionTarget(rawTarget(), {
      organisationId: ORGANISATION_ID,
      projectId: PROJECT_ID,
    });
    expect(target.compatible).toBe(true);
    expect(target.version).toBe(4);
    expect(() =>
      adaptFieldDraftPromotionTarget(rawTarget({ unexpected: true }), {
        organisationId: ORGANISATION_ID,
        projectId: PROJECT_ID,
      }),
    ).toThrow();
    expect(() =>
      adaptFieldDraftPromotionTarget(rawTarget(), {
        organisationId: ORGANISATION_ID,
        projectId: "77777777-7777-4777-8777-777777777777",
      }),
    ).toThrow();
  });

  it("builds a field-by-field preview for only selected fields", () => {
    const target = adaptFieldDraftPromotionTarget(rawTarget(), {
      organisationId: ORGANISATION_ID,
      projectId: PROJECT_ID,
    });
    const plan = buildFieldDraftPromotionCommand(
      draft,
      target,
      ["title", "note", "checklist"],
      {
        organisationId: ORGANISATION_ID,
        actorUserId: ACTOR_ID,
        projectId: PROJECT_ID,
      },
    );
    expect(plan.command.expectedTargetVersion).toBe(4);
    expect(plan.diff.map(({ field }) => field)).toEqual([
      "title",
      "note",
      "checklist",
    ]);
    expect(plan.diff[2]?.effect).toBe("append");
    expect(() =>
      buildFieldDraftPromotionCommand(draft, target, ["note", "title"], {
        organisationId: ORGANISATION_ID,
        actorUserId: ACTOR_ID,
        projectId: PROJECT_ID,
      }),
    ).toThrow();
  });

  it("verifies request binding and the content-free receipt digest", async () => {
    const target = adaptFieldDraftPromotionTarget(rawTarget(), {
      organisationId: ORGANISATION_ID,
      projectId: PROJECT_ID,
    });
    const { command } = buildFieldDraftPromotionCommand(
      draft,
      target,
      ["title", "note", "checklist"],
      {
        organisationId: ORGANISATION_ID,
        actorUserId: ACTOR_ID,
        projectId: PROJECT_ID,
      },
    );
    const receipt = await receiptFor(command);
    const adapted = adaptFieldDraftPromotionReceipt(receipt);
    await expect(
      verifyFieldDraftPromotionReceipt(
        adapted,
        command,
        TARGET_ID,
        IDEMPOTENCY_KEY,
      ),
    ).resolves.toMatchObject({
      authoritativeEvidenceCreated: false,
      localDraftDeleted: false,
    });
    await expect(
      verifyFieldDraftPromotionReceipt(
        { ...adapted, receiptSha256: "f".repeat(64) },
        command,
        TARGET_ID,
        IDEMPOTENCY_KEY,
      ),
    ).rejects.toThrow();
  });

  it("recovers an uncertain submission only from a verified matching receipt", async () => {
    const baseTarget = adaptFieldDraftPromotionTarget(rawTarget(), {
      organisationId: ORGANISATION_ID,
      projectId: PROJECT_ID,
    });
    const { command } = buildFieldDraftPromotionCommand(
      draft,
      baseTarget,
      ["title", "note", "checklist"],
      {
        organisationId: ORGANISATION_ID,
        actorUserId: ACTOR_ID,
        projectId: PROJECT_ID,
      },
    );
    const { replayed: _replayed, ...stored } = await receiptFor(command);
    const refreshed = adaptFieldDraftPromotionTarget(
      rawTarget({ version: 5, fieldPromotionReceipts: [stored] }),
      { organisationId: ORGANISATION_ID, projectId: PROJECT_ID },
    );
    await expect(
      recoverVerifiedFieldDraftPromotionReceipt(
        refreshed,
        command,
        IDEMPOTENCY_KEY,
      ),
    ).resolves.toMatchObject({ replayed: true, targetVersion: 5 });
    await expect(
      recoverVerifiedFieldDraftPromotionReceipt(
        refreshed,
        command,
        "88888888-8888-4888-8888-888888888888",
      ),
    ).resolves.toBeNull();
    expect(() =>
      adaptFieldDraftPromotionTarget(
        rawTarget({
          version: 5,
          fieldPromotionReceipts: [
            stored,
            {
              ...stored,
              idempotencyKey: "99999999-9999-4999-8999-999999999999",
              receiptSha256: "f".repeat(64),
            },
          ],
        }),
        { organisationId: ORGANISATION_ID, projectId: PROJECT_ID },
      ),
    ).toThrow();
  });
});
