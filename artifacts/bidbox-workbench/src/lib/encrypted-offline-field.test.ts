import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ENCRYPTED_FIELD_COMPANION_STATUS,
  isEncryptedFieldDraft,
  isEncryptedFieldDraftExpired,
  isEncryptedFieldDraftForScope,
} from "./encrypted-offline-field";

const draft = {
  schema: "valo.encrypted-field-draft/v1",
  id: "11111111-1111-4111-8111-111111111111",
  organisationId: "22222222-2222-4222-8222-222222222222",
  actorUserId: "33333333-3333-4333-8333-333333333333",
  kind: "site_visit_note",
  projectId: null,
  title: "Attendance receipt observation",
  note: "Draft observation only.",
  checklist: [
    { id: "item-1", label: "Attendance proof collected", completed: false },
  ],
  capturedAt: "2026-08-11T10:00:00.000Z",
  createdAt: "2026-08-11T10:01:00.000Z",
  updatedAt: "2026-08-11T10:01:00.000Z",
  expiresAt: "2026-08-18T10:01:00.000Z",
  version: 1,
  serverSubmitted: false,
  authoritative: false,
} as const;
const source = readFileSync(
  resolve(import.meta.dirname, "encrypted-offline-field.ts"),
  "utf8",
);

describe("encrypted field draft contract", () => {
  it("accepts only bounded draft-only records", () => {
    expect(isEncryptedFieldDraft(draft)).toBe(true);
    expect(isEncryptedFieldDraft({ ...draft, serverSubmitted: true })).toBe(
      false,
    );
    expect(isEncryptedFieldDraft({ ...draft, authoritative: true })).toBe(
      false,
    );
    expect(isEncryptedFieldDraft({ ...draft, note: "x".repeat(4_001) })).toBe(
      false,
    );
  });

  it("keeps protected content and automatic synchronization disabled", () => {
    expect(ENCRYPTED_FIELD_COMPANION_STATUS.keyExtractable).toBe(false);
    expect(
      ENCRYPTED_FIELD_COMPANION_STATUS.serviceWorkerContentCacheAllowed,
    ).toBe(false);
    expect(ENCRYPTED_FIELD_COMPANION_STATUS.tenderCorpusAllowed).toBe(false);
    expect(ENCRYPTED_FIELD_COMPANION_STATUS.approvalAllowed).toBe(false);
    expect(ENCRYPTED_FIELD_COMPANION_STATUS.automaticSyncAllowed).toBe(false);
    expect(ENCRYPTED_FIELD_COMPANION_STATUS.maximumRetentionDays).toBe(7);
    expect(ENCRYPTED_FIELD_COMPANION_STATUS.serverAuthority).toBe(
      "explicit_review_and_promote",
    );
    expect(ENCRYPTED_FIELD_COMPANION_STATUS.localDeletionAfterPromotion).toBe(
      "explicit_only",
    );
  });

  it("accepts only a content-free, scope-bound promotion marker", () => {
    const promoted = {
      ...draft,
      version: 2,
      promotion: {
        schema: "valo.field-draft-promotion-receipt/v1",
        organisationId: draft.organisationId,
        projectId: "44444444-4444-4444-8444-444444444444",
        targetRecordId: "55555555-5555-4555-8555-555555555555",
        targetKind: "work_item",
        targetVersion: 9,
        draftId: draft.id,
        draftVersion: 1,
        promotedByUserId: draft.actorUserId,
        selectedFields: ["title", "note"],
        idempotencyKey: "66666666-6666-4666-8666-666666666666",
        requestSha256: "a".repeat(64),
        receiptSha256: "b".repeat(64),
        promotedAt: "2026-08-11T11:00:00.000Z",
        authoritativeEvidenceCreated: false,
        localDraftDeleted: false,
      },
      projectId: "44444444-4444-4444-8444-444444444444",
    } as const;
    expect(isEncryptedFieldDraft(promoted)).toBe(true);
    expect(
      isEncryptedFieldDraft({
        ...promoted,
        promotion: {
          ...promoted.promotion,
          authoritativeEvidenceCreated: true,
        },
      }),
    ).toBe(false);
    expect(
      isEncryptedFieldDraft({
        ...promoted,
        promotion: {
          ...promoted.promotion,
          promotedByUserId: "77777777-7777-4777-8777-777777777777",
        },
      }),
    ).toBe(false);
    const marker = source.slice(
      source.indexOf("export async function markEncryptedFieldDraftPromoted"),
      source.indexOf("export async function deleteEncryptedFieldDraft"),
    );
    expect(marker).toMatch(/verifyPromotionMarkerDigest/u);
    expect(marker).toMatch(/verifyPromotionRequestDigest/u);
    expect(marker).toMatch(/current\.projectId !== marker\.projectId/u);
    expect(marker).not.toMatch(/\.delete\(/u);
    expect(source).not.toMatch(/console\.(?:log|info|debug)/u);
  });

  it("retains one exact pending mutation identity across reload recovery", () => {
    const projectId = "44444444-4444-4444-8444-444444444444";
    const pending = {
      schema: "valo.encrypted-field-promotion-pending/v1",
      targetRecordId: "work-item-1",
      idempotencyKey: "66666666-6666-4666-8666-666666666666",
      command: {
        schema: "valo.encrypted-field-promotion/v1",
        draft: {
          id: draft.id,
          version: draft.version,
          organisationId: draft.organisationId,
          actorUserId: draft.actorUserId,
          projectId,
          kind: draft.kind,
          updatedAt: draft.updatedAt,
        },
        expectedTargetVersion: 4,
        selectedFields: ["title", "note"],
        values: { title: draft.title, note: draft.note },
      },
      preparedAt: "2026-08-11T11:00:00.000Z",
    } as const;
    const prepared = { ...draft, projectId, pendingPromotion: pending };
    expect(isEncryptedFieldDraft(prepared)).toBe(true);
    const reloaded = JSON.parse(JSON.stringify(prepared)) as unknown;
    expect(isEncryptedFieldDraft(reloaded)).toBe(true);
    if (!isEncryptedFieldDraft(reloaded) || !reloaded.pendingPromotion) {
      throw new Error("Pending promotion did not survive reload validation.");
    }
    expect(reloaded.pendingPromotion.idempotencyKey).toBe(
      pending.idempotencyKey,
    );
    expect(reloaded.pendingPromotion.command).toEqual(pending.command);
    expect(
      isEncryptedFieldDraft({
        ...prepared,
        pendingPromotion: {
          ...pending,
          command: {
            ...pending.command,
            values: { ...pending.command.values, note: "Changed body" },
          },
        },
      }),
    ).toBe(false);
    const prepare = source.slice(
      source.indexOf(
        "export async function prepareEncryptedFieldDraftPromotion",
      ),
      source.indexOf("export async function markEncryptedFieldDraftPromoted"),
    );
    const mark = source.slice(
      source.indexOf("export async function markEncryptedFieldDraftPromoted"),
      source.indexOf("export async function deleteEncryptedFieldDraft"),
    );
    expect(prepare).toMatch(/current\.pendingPromotion/u);
    expect(prepare).toMatch(/idempotencyKey === idempotencyKey/u);
    expect(mark).toMatch(
      /current\.pendingPromotion\.idempotencyKey !== marker\.idempotencyKey/u,
    );
    expect(mark).toMatch(/pendingPromotion: null/u);
  });

  it("binds every draft to one actor and expires it after the bounded TTL", () => {
    expect(
      isEncryptedFieldDraftForScope(
        draft,
        draft.organisationId,
        draft.actorUserId,
      ),
    ).toBe(true);
    expect(
      isEncryptedFieldDraftForScope(
        draft,
        draft.organisationId,
        "44444444-4444-4444-8444-444444444444",
      ),
    ).toBe(false);
    expect(
      isEncryptedFieldDraftExpired(draft, new Date("2026-08-18T10:00:59.000Z")),
    ).toBe(false);
    expect(
      isEncryptedFieldDraftExpired(draft, new Date("2026-08-18T10:01:00.000Z")),
    ).toBe(true);
    expect(source).toMatch(/getOrCreateKey\(database, actorUserId\)/u);
    expect(source).toMatch(/partitionDigest\(organisationId, actorUserId\)/u);
    expect(source).toMatch(
      /filter\(\(draft\) => isEncryptedFieldDraftExpired/u,
    );
    expect(source).toMatch(
      /for \(const id of expiredIds\) store\.delete\(id\)/u,
    );
  });
});
