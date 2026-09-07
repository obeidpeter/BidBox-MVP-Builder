import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";
import {
  LEGACY_CATALOG_DIGEST_ALGORITHM,
  LEGACY_COLUMN_FINGERPRINT_ALGORITHM,
  LEGACY_LINEAGE_CANONICAL,
  LEGACY_LINEAGE_PRODUCTION_PUSH_MANAGED,
  LEGACY_TABLES,
  ORGANISATION_ID,
  SOURCE_COMMIT,
  SOURCE_DIGEST_ALGORITHM,
  checkArtifact,
  classifyLegacyColumnMap,
  legacyColumnFingerprint,
  legacyColumnsForLineage,
  parseRestoreManifest,
  sha256,
} from "./run-legacy-bridge.mjs";
import {
  MANIFEST_FILE_NAME,
  assertEmptyDirectory,
  assertDistinctRestore,
  assertStableBackupSnapshot,
  buildManifest,
  databaseUrlIdentity,
  manifestSidecar,
  pathIsWithin,
  restoreListInventory,
} from "./capture-legacy-evidence.mjs";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

test("database URLs bind an isolated endpoint with the same database name", () => {
  assert.equal(
    assertDistinctRestore(
      "postgresql://owner:source-secret@source.invalid/bidbox?sslmode=require",
      "postgresql://owner:restore-secret@restore.invalid/bidbox?sslmode=require",
    ),
    "bidbox",
  );
  assert.deepEqual(
    databaseUrlIdentity("postgres://owner:secret@source.invalid:5440/bidbox"),
    {
      database: "bidbox",
      target: "postgres://source.invalid:5440/bidbox",
    },
  );
  assert.throws(() =>
    assertDistinctRestore(
      "postgres://owner:one@source.invalid/bidbox",
      "postgres://owner:two@source.invalid/bidbox",
    ),
  );
  assert.throws(() =>
    assertDistinctRestore(
      "postgres://owner:one@source.invalid/bidbox",
      "postgres://owner:two@restore.invalid/other",
    ),
  );
});

test("custom restore inventory requires exactly the frozen legacy relations", () => {
  const tableLines = LEGACY_TABLES.map(
    (table, index) =>
      `${index + 1}; 1259 ${20_000 + index} TABLE public ${table} owner`,
  );
  const dataLines = LEGACY_TABLES.map(
    (table, index) =>
      `${index + 101}; 0 ${20_000 + index} TABLE DATA public ${table} owner`,
  );
  const list = [
    ...tableLines,
    ...dataLines,
    "999; 0 0 SEQUENCE SET public audit_events_row_no_seq owner",
  ].join("\n");
  assert.equal(restoreListInventory(list), true);
  assert.throws(() =>
    restoreListInventory(
      list.replace(/.*TABLE DATA public vault_items owner\n?/, ""),
    ),
  );
  assert.throws(() =>
    restoreListInventory(
      `${list}\n1000; 1259 30000 TABLE public unexpected owner`,
    ),
  );
  for (const descriptor of [
    '1001; 1259 30001 TABLE public "quoted_name" owner',
    "1002; 1259 30002 TABLE public MixedCase owner",
    '1003; 0 30003 TABLE DATA public "name with spaces" owner',
    "1004; 0 30004 TABLE DATA private hidden owner",
    tableLines[0],
  ]) {
    assert.throws(() => restoreListInventory(`${list}\n${descriptor}`));
  }
});

test("backup identity and digest must both remain stable", () => {
  const identity = {
    device: "1",
    inode: "2",
    size: "3",
    modifiedAtNanoseconds: "4",
    changedAtNanoseconds: "5",
  };
  assert.equal(
    assertStableBackupSnapshot(identity, { ...identity }, HASH_A, HASH_A),
    HASH_A,
  );
  assert.throws(() =>
    assertStableBackupSnapshot(
      identity,
      { ...identity, size: "4" },
      HASH_A,
      HASH_A,
    ),
  );
  assert.throws(() =>
    assertStableBackupSnapshot(identity, { ...identity }, HASH_A, HASH_B),
  );
});

test("evidence output directory must contain zero entries", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "bidbox-evidence-test-"));
  try {
    await assertEmptyDirectory(directory);
    await writeFile(resolve(directory, ".hidden"), "not empty");
    await assert.rejects(assertEmptyDirectory(directory));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("generated manifest is the exact v3 bridge input contract", () => {
  const tableDigests = Object.fromEntries(
    LEGACY_TABLES.map((table) => [
      table,
      { rowCount: table === "audit_events" ? 28 : 1, sha256: HASH_A },
    ]),
  );
  const audit = {
    eventCount: 28,
    minSeq: 1,
    maxSeq: 28,
    distinctSeq: 28,
    rowNoSequenceLastValue: 560,
    rowNoSequenceIsCalled: true,
    linksContiguous: true,
    payloadHashVerifiedSequences: [1, 2, 3, 4, 5, 6, 7, 27, 28],
    knownDiscontinuitySequences: Array.from(
      { length: 19 },
      (_, index) => index + 8,
    ),
    externalHead: { seq: 28, hash: HASH_A, prevHash: HASH_B },
  };
  const manifest = buildManifest({
    capturedAt: "2026-08-09T00:00:00.000Z",
    database: "bidbox",
    backupFileName: "source.dump",
    backupSha256: HASH_A,
    auditFileName: "valo-legacy-audit.ndjson",
    auditSha256: HASH_B,
    postgresMajor: 16,
    restoreExitStatus: 0,
    tableDigests,
    audit,
    catalog: {
      algorithm: LEGACY_CATALOG_DIGEST_ALGORITHM,
      sha256: HASH_C,
    },
    legacyLineage: {
      id: LEGACY_LINEAGE_CANONICAL,
      columnFingerprintAlgorithm: LEGACY_COLUMN_FINGERPRINT_ALGORITHM,
      columnFingerprintSha256: HASH_C,
    },
  });
  assert.equal(manifest.sourceCommit, SOURCE_COMMIT);
  assert.equal(manifest.target.organisationId, ORGANISATION_ID);
  assert.equal(manifest.tableDigestAlgorithm, SOURCE_DIGEST_ALGORITHM);
  const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  assert.deepEqual(parseRestoreManifest(bytes, sha256(bytes)), manifest);
  assert.equal(
    manifestSidecar(sha256(bytes)),
    `${sha256(bytes)}  ${MANIFEST_FILE_NAME}\n`,
  );
});

test("legacy columns classify only the two pinned full fingerprints", async () => {
  const artifact = await checkArtifact();
  const canonical = legacyColumnsForLineage(
    artifact.legacyColumns,
    LEGACY_LINEAGE_CANONICAL,
  );
  const pushManaged = legacyColumnsForLineage(
    artifact.legacyColumns,
    LEGACY_LINEAGE_PRODUCTION_PUSH_MANAGED,
  );
  assert.deepEqual(classifyLegacyColumnMap(canonical, artifact.legacyColumns), {
    id: LEGACY_LINEAGE_CANONICAL,
    columnFingerprintAlgorithm: LEGACY_COLUMN_FINGERPRINT_ALGORITHM,
    columnFingerprintSha256: legacyColumnFingerprint(canonical),
  });
  assert.deepEqual(
    classifyLegacyColumnMap(pushManaged, artifact.legacyColumns),
    {
      id: LEGACY_LINEAGE_PRODUCTION_PUSH_MANAGED,
      columnFingerprintAlgorithm: LEGACY_COLUMN_FINGERPRINT_ALGORITHM,
      columnFingerprintSha256: legacyColumnFingerprint(pushManaged),
    },
  );

  const arbitraryIntersection = new Map(
    [...pushManaged].map(([table, columns]) => [table, [...columns]]),
  );
  arbitraryIntersection.set(
    "documents",
    arbitraryIntersection
      .get("documents")
      .filter((column) => column !== "content_text"),
  );
  assert.throws(() =>
    classifyLegacyColumnMap(arbitraryIntersection, artifact.legacyColumns),
  );

  const reordered = new Map(
    [...pushManaged].map(([table, columns]) => [table, [...columns]]),
  );
  reordered.set("documents", [...reordered.get("documents")].reverse());
  assert.throws(() =>
    classifyLegacyColumnMap(reordered, artifact.legacyColumns),
  );
});

test("repository containment check rejects the root and descendants", () => {
  const root = resolve("C:/workspace/repository");
  assert.equal(pathIsWithin(root, root), true);
  assert.equal(pathIsWithin(root, resolve(root, "private/evidence")), true);
  assert.equal(pathIsWithin(root, resolve(root, "../private-evidence")), false);
});
