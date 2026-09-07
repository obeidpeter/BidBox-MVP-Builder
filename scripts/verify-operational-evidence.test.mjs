import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  readPinnedEvidence,
  verifyAuditAnchorEvidenceDocument,
  verifyBackupEvidenceDocument,
} from "./verify-operational-evidence.mjs";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const ORGANISATION_ID = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-08-13T12:00:00.000Z");

function backupEvidence() {
  return {
    backup: {
      backupId: "provider-backup-2026-08-13-01",
      completedAt: "2026-08-13T10:30:00.000Z",
      databaseArtifactSha256: HASH_A,
      encrypted: true,
      objectInventorySha256: HASH_B,
      provider: "approved-backup-provider",
      providerReceiptReference: "immutable/backup/2026-08-13-01",
      providerReceiptSha256: HASH_A,
      providerStatus: "completed",
      restoreDrill: {
        completedAt: "2026-08-01T08:00:00.000Z",
        reportSha256: HASH_B,
        status: "passed",
      },
      sourceCommit: "c".repeat(40),
      startedAt: "2026-08-13T10:00:00.000Z",
    },
    capturedAt: "2026-08-13T10:31:00.000Z",
    environment: "production",
    schema: "valo.backup-evidence/v1",
  };
}

function anchorEvidence() {
  return {
    retainedOrganisationCount: 1,
    retainedOrganisationSetSha256: createHash("sha256")
      .update(`${ORGANISATION_ID}\n`)
      .digest("hex"),
    capturedAt: "2026-08-13T11:01:00.000Z",
    environment: "production",
    provider: "approved-immutable-provider",
    records: [
      {
        anchor: {
          anchoredAt: "2026-08-13T11:00:00.000Z",
          chainHeadHash: HASH_A,
          firstSequence: 1,
          immutableObjectReference: "immutable/audit/tenant-01/42",
          lastSequence: 42,
          receiptHash: HASH_B,
          receiptSignatureVerified: true,
          verificationStatus: "verified",
          verifiedAt: "2026-08-13T11:00:30.000Z",
        },
        databaseHead: { hash: HASH_A, sequence: 42 },
        organisationId: ORGANISATION_ID,
      },
    ],
    schema: "valo.audit-anchor-evidence/v1",
    sourceCommit: "c".repeat(40),
  };
}

test("accepts only fresh encrypted backup and restore evidence", () => {
  const result = verifyBackupEvidenceDocument(backupEvidence(), {
    expectedSourceCommit: "c".repeat(40),
    now: NOW,
    restoreDrillMaxAgeDays: 30,
    rpoHours: 4,
  });
  assert.equal(result.signals["bidbox.backup.verification_failures"], 0);
  assert.equal(result.signals["bidbox.backup.age_hours"], 1.5);
  assert.throws(
    () =>
      verifyBackupEvidenceDocument(backupEvidence(), {
        expectedEnvironment: "staging",
        expectedSourceCommit: "c".repeat(40),
        now: NOW,
        restoreDrillMaxAgeDays: 30,
        rpoHours: 4,
      }),
    /BACKUP_EVIDENCE_ENVIRONMENT_MISMATCH/u,
  );

  assert.throws(
    () =>
      verifyBackupEvidenceDocument(backupEvidence(), {
        now: new Date("2026-08-14T12:00:00.000Z"),
        expectedSourceCommit: "c".repeat(40),
        restoreDrillMaxAgeDays: 30,
        rpoHours: 4,
      }),
    /BACKUP_RPO_EXCEEDED/u,
  );

  assert.throws(
    () =>
      verifyBackupEvidenceDocument(backupEvidence(), {
        expectedSourceCommit: "d".repeat(40),
        now: NOW,
        restoreDrillMaxAgeDays: 30,
        rpoHours: 4,
      }),
    /BACKUP_SOURCE_COMMIT_MISMATCH/u,
  );

  const impossibleDate = backupEvidence();
  impossibleDate.capturedAt = "2026-02-30T10:31:00.000Z";
  assert.throws(
    () =>
      verifyBackupEvidenceDocument(impossibleDate, {
        expectedSourceCommit: "c".repeat(40),
        now: NOW,
        restoreDrillMaxAgeDays: 30,
        rpoHours: 4,
      }),
    /BACKUP_CAPTURED_AT_INVALID/u,
  );
});

test("requires backup evidence to be bound to an independent source commit", () => {
  assert.throws(
    () =>
      verifyBackupEvidenceDocument(backupEvidence(), {
        now: NOW,
        restoreDrillMaxAgeDays: 30,
        rpoHours: 4,
      }),
    /BACKUP_EXPECTED_SOURCE_COMMIT_INVALID/u,
  );
});

test("requires every retained tenant and an exact database-to-anchor head match", () => {
  const expectedOrganisationSetSha256 =
    anchorEvidence().retainedOrganisationSetSha256;
  const result = verifyAuditAnchorEvidenceDocument(anchorEvidence(), {
    expectedOrganisationCount: 1,
    expectedOrganisationSetSha256,
    expectedSourceCommit: "c".repeat(40),
    maxAgeHours: 2,
    now: NOW,
  });
  assert.equal(result.tenantsVerified, 1);
  assert.equal(result.signals["bidbox.audit.anchor_cycle_complete"], 1);
  assert.equal(result.signals["bidbox.audit.anchor_failures"], 0);

  const mismatch = anchorEvidence();
  mismatch.records[0].databaseHead.hash = HASH_B;
  assert.throws(
    () =>
      verifyAuditAnchorEvidenceDocument(mismatch, {
        expectedOrganisationCount: 1,
        expectedOrganisationSetSha256,
        expectedSourceCommit: "c".repeat(40),
        maxAgeHours: 2,
        now: NOW,
      }),
    /ANCHOR_CHAIN_HEAD_MISMATCH/u,
  );

  assert.throws(
    () =>
      verifyAuditAnchorEvidenceDocument(anchorEvidence(), {
        expectedOrganisationCount: 2,
        expectedOrganisationSetSha256,
        expectedSourceCommit: "c".repeat(40),
        maxAgeHours: 2,
        now: NOW,
      }),
    /ANCHOR_EXPECTED_ORGANISATION_SET_MISMATCH/u,
  );
  assert.throws(
    () =>
      verifyAuditAnchorEvidenceDocument(anchorEvidence(), {
        expectedOrganisationCount: 1,
        expectedOrganisationSetSha256: HASH_B,
        expectedSourceCommit: "c".repeat(40),
        maxAgeHours: 2,
        now: NOW,
      }),
    /ANCHOR_EXPECTED_ORGANISATION_SET_MISMATCH/u,
  );
  assert.throws(
    () =>
      verifyAuditAnchorEvidenceDocument(anchorEvidence(), {
        expectedOrganisationCount: undefined,
        expectedOrganisationSetSha256: undefined,
        expectedSourceCommit: "c".repeat(40),
        maxAgeHours: 2,
        now: NOW,
      }),
    /ANCHOR_EXPECTED_ORGANISATION_SET_DIGEST_INVALID/u,
  );

  const impossibleDate = anchorEvidence();
  impossibleDate.records[0].anchor.anchoredAt = "2026-02-30T11:00:00.000Z";
  assert.throws(
    () =>
      verifyAuditAnchorEvidenceDocument(impossibleDate, {
        expectedOrganisationCount: 1,
        expectedOrganisationSetSha256,
        expectedSourceCommit: "c".repeat(40),
        maxAgeHours: 2,
        now: NOW,
      }),
    /ANCHOR_TIME_INVALID/u,
  );

  assert.throws(
    () =>
      verifyAuditAnchorEvidenceDocument(anchorEvidence(), {
        expectedOrganisationCount: 1,
        expectedOrganisationSetSha256,
        expectedSourceCommit: "d".repeat(40),
        maxAgeHours: 2,
        now: NOW,
      }),
    /ANCHOR_SOURCE_COMMIT_MISMATCH/u,
  );
});

test("accepts a bounded regular evidence file only when independently pinned", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bidbox-ops-evidence-"));
  try {
    const path = join(directory, "backup.json");
    const source = JSON.stringify(backupEvidence());
    await writeFile(path, source, "utf8");
    const digest = createHash("sha256").update(source).digest("hex");
    assert.deepEqual(await readPinnedEvidence(path, digest), backupEvidence());
    await assert.rejects(
      readPinnedEvidence(path, HASH_A),
      /EVIDENCE_DIGEST_MISMATCH/u,
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
