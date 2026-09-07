#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  chmod,
  lstat,
  open,
  readdir,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import {
  KNOWN_DISCONTINUITY_SEQUENCES,
  LEGACY_TABLES,
  LOCK_LEGACY_TABLES,
  ORGANISATION_ID,
  PAYLOAD_HASH_VERIFIED_SEQUENCES,
  SOURCE_COMMIT,
  SOURCE_DIGEST_ALGORITHM,
  checkArtifact,
  classifyTarget,
  detectLegacyLineage,
  legacyCatalogDigest,
  parseRestoreManifest,
  sha256,
  sourceEvidence,
  tableDigest,
} from "./run-legacy-bridge.mjs";

const { Client } = pg;
const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(here, "../../..");
const CAPTURE_FLAG = "--capture-authoritative-evidence";
const QUIESCENCE_ACK = "APPLICATION_WRITERS_STOPPED_AND_RESTORE_ISOLATED";
const RESTORE_ACK = "BOUND_CUSTOM_DUMP_PG_RESTORE_EXIT_STATUS_0";
const AUDIT_FILE_NAME = "valo-legacy-audit.ndjson";
const MANIFEST_FILE_NAME = "valo-legacy-restore-manifest.json";
const SIDECAR_FILE_NAME = `${MANIFEST_FILE_NAME}.sha256`;
const MAX_COMMAND_OUTPUT_BYTES = 16 * 1024 * 1024;
let evidenceCaptureStage = "startup";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function acknowledgedRestoreExitStatus() {
  assert.equal(
    required("VALO_BRIDGE_EVIDENCE_RESTORE_ACK"),
    RESTORE_ACK,
    "successful restore acknowledgement is absent",
  );
  return 0;
}

function databaseUrlIdentity(raw) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("database URL is malformed");
  }
  assert(
    ["postgres:", "postgresql:"].includes(parsed.protocol),
    "database URL must use PostgreSQL",
  );
  assert(!parsed.hash, "database URL must not contain a fragment");
  assert(parsed.username, "database URL must contain a username");
  assert(
    parsed.pathname.startsWith("/") &&
      parsed.pathname.length > 1 &&
      !parsed.pathname.slice(1).includes("/"),
    "database URL must name exactly one database",
  );
  let database;
  try {
    database = decodeURIComponent(parsed.pathname.slice(1));
  } catch {
    throw new Error("database name is malformed");
  }
  assert(database.length > 0, "database URL must name a database");
  const effectivePort = parsed.port || "5432";
  return {
    database,
    target: `${parsed.protocol}//${parsed.hostname.toLowerCase()}:${effectivePort}/${database}`,
  };
}

function assertDistinctRestore(sourceRaw, restoredRaw) {
  const source = databaseUrlIdentity(sourceRaw);
  const restored = databaseUrlIdentity(restoredRaw);
  assert.equal(
    restored.database,
    source.database,
    "source and restored URLs must use the same database name",
  );
  assert.notEqual(
    restored.target,
    source.target,
    "restored URL must identify an isolated database endpoint",
  );
  return source.database;
}

function pathIsWithin(root, candidate) {
  const child = relative(root, candidate);
  return (
    child === "" ||
    (!isAbsolute(child) && child !== ".." && !child.startsWith(`..${sep}`))
  );
}

function assertOutsideRepository(candidate, label) {
  assert(
    !pathIsWithin(repositoryRoot, candidate),
    `${label} must be outside the repository`,
  );
}

async function privateRegularFile(input, label) {
  const absolute = resolve(input);
  const linkMetadata = await lstat(absolute);
  assert(
    !linkMetadata.isSymbolicLink(),
    `${label} must not be a symbolic link`,
  );
  assert(linkMetadata.isFile(), `${label} must be a regular file`);
  const canonical = await realpath(absolute);
  assertOutsideRepository(canonical, label);
  if (process.platform !== "win32") {
    assert.equal(
      linkMetadata.mode & 0o077,
      0,
      `${label} must not be group/world-readable`,
    );
  }
  return canonical;
}

async function privateOutputDirectory(input) {
  const absolute = resolve(input);
  const linkMetadata = await lstat(absolute);
  assert(
    !linkMetadata.isSymbolicLink(),
    "evidence directory must not be a symbolic link",
  );
  assert(linkMetadata.isDirectory(), "evidence directory must exist");
  const canonical = await realpath(absolute);
  assertOutsideRepository(canonical, "evidence directory");
  if (process.platform !== "win32") {
    assert.equal(
      linkMetadata.mode & 0o077,
      0,
      "evidence directory must not be group/world-accessible",
    );
  }
  return canonical;
}

async function pgRestoreBinary(input) {
  assert(isAbsolute(input), "VALO_BRIDGE_PG_RESTORE_PATH must be absolute");
  const canonical = await realpath(input);
  const metadata = await stat(canonical);
  assert(metadata.isFile(), "pg_restore must be a regular file");
  if (process.platform !== "win32") {
    assert(metadata.mode & 0o111, "pg_restore must be executable");
  }
  return canonical;
}

async function sha256File(path) {
  const digest = createHash("sha256");
  await new Promise((accept, reject) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => digest.update(chunk));
    stream.on("error", reject);
    stream.on("end", accept);
  });
  return digest.digest("hex");
}

async function assertCustomDump(path) {
  const handle = await open(path, "r");
  try {
    const header = Buffer.alloc(5);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    assert.equal(bytesRead, header.length, "backup is truncated");
    assert.equal(
      header.toString("ascii"),
      "PGDMP",
      "backup is not custom format",
    );
  } finally {
    await handle.close();
  }
}

async function backupIdentity(path) {
  const metadata = await stat(path, { bigint: true });
  assert(metadata.isFile(), "source backup must remain a regular file");
  return {
    device: metadata.dev.toString(),
    inode: metadata.ino.toString(),
    size: metadata.size.toString(),
    modifiedAtNanoseconds: metadata.mtimeNs.toString(),
    changedAtNanoseconds: metadata.ctimeNs.toString(),
  };
}

function assertStableBackupSnapshot(
  identityBefore,
  identityAfter,
  hashBefore,
  hashAfter,
) {
  assert.deepEqual(
    identityAfter,
    identityBefore,
    "source backup identity changed during validation",
  );
  assert.equal(
    hashAfter,
    hashBefore,
    "source backup bytes changed during validation",
  );
  return hashBefore;
}

function runBounded(command, args) {
  return new Promise((accept, reject) => {
    const child = spawn(command, args, {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderrBytes = 0;
    let failedForSize = false;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (Buffer.byteLength(stdout) > MAX_COMMAND_OUTPUT_BYTES) {
        failedForSize = true;
        child.kill();
      }
    });
    child.stderr.on("data", (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes > MAX_COMMAND_OUTPUT_BYTES) {
        failedForSize = true;
        child.kill();
      }
    });
    child.on("error", reject);
    child.on("close", (status) => {
      if (failedForSize) {
        reject(new Error("pg_restore output exceeded the safety limit"));
      } else if (status !== 0) {
        reject(new Error("pg_restore verification failed"));
      } else {
        accept(stdout);
      }
    });
  });
}

function restoreListInventory(list) {
  const tables = [];
  const tableData = [];
  let auditSequence = false;
  for (const line of list.split(/\r?\n/)) {
    const descriptor = line.match(
      /^\s*\d+;\s+\d+\s+\d+\s+(TABLE(?:\s+DATA)?)(?:\s+.*)?$/,
    );
    if (descriptor) {
      const expected = line.match(
        /^\s*\d+;\s+\d+\s+\d+\s+(TABLE(?:\s+DATA)?)\s+public\s+([a-z0-9_]+)\s+\S+\s*$/,
      );
      assert(expected, "unexpected dump table descriptor");
      if (expected[1] === "TABLE DATA") tableData.push(expected[2]);
      else tables.push(expected[2]);
    }
    if (
      /;\s+\d+\s+\d+\s+SEQUENCE SET public audit_events_row_no_seq\s/.test(line)
    ) {
      auditSequence = true;
    }
  }
  assert.deepEqual(tables.sort(), LEGACY_TABLES, "dump table inventory");
  assert.deepEqual(
    tableData.sort(),
    LEGACY_TABLES,
    "dump table-data inventory",
  );
  assert.equal(auditSequence, true, "dump audit sequence inventory");
  return true;
}

async function verifyRestoreList(binary, backupPath) {
  const version = await runBounded(binary, ["--version"]);
  assert.match(version.trim(), /^pg_restore \(PostgreSQL\) 16(?:\.|$)/);
  const list = await runBounded(binary, ["--list", backupPath]);
  restoreListInventory(list);
}

async function verifyStableBackup(binary, backupPath) {
  const identityBefore = await backupIdentity(backupPath);
  await assertCustomDump(backupPath);
  const hashBefore = await sha256File(backupPath);
  await verifyRestoreList(binary, backupPath);
  const hashAfter = await sha256File(backupPath);
  await assertCustomDump(backupPath);
  const identityAfter = await backupIdentity(backupPath);
  return assertStableBackupSnapshot(
    identityBefore,
    identityAfter,
    hashBefore,
    hashAfter,
  );
}

async function beginLockedSnapshot(client) {
  await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ");
  await client.query("SET LOCAL lock_timeout='1s'");
  await client.query("SET LOCAL statement_timeout='10min'");
  await client.query("SET LOCAL idle_in_transaction_session_timeout='10min'");
  await client.query("SET LOCAL search_path=pg_catalog,public");
  await client.query("SET LOCAL TIME ZONE 'UTC'");
  await client.query(LOCK_LEGACY_TABLES);
}

async function databaseHeader(client, expectedDatabase) {
  const result = await client.query(`SELECT current_database() AS database,
    current_setting('server_version_num')::integer AS server_version_num`);
  assert.equal(result.rows[0]?.database, expectedDatabase);
  const postgresMajor = Math.trunc(result.rows[0].server_version_num / 10_000);
  assert.equal(postgresMajor, 16, "evidence requires PostgreSQL 16");
  assert.equal(await classifyTarget(client), "legacy");
  return postgresMajor;
}

async function digestTables(client, legacyColumns, sourceLabel) {
  const digests = {};
  for (const table of LEGACY_TABLES) {
    evidenceCaptureStage = `database_table_${sourceLabel}_${table}`;
    digests[table] = await tableDigest(
      client,
      "legacy",
      table,
      legacyColumns.get(table),
    );
  }
  return digests;
}

async function auditSequenceState(client) {
  const result = await client.query(
    "SELECT last_value::integer, is_called FROM public.audit_events_row_no_seq",
  );
  assert.equal(result.rowCount, 1);
  return result.rows[0];
}

function summarizeAudit(evidence, sequenceState) {
  const sequences = evidence.rows.map((row) => row.seq);
  assert.deepEqual(
    sequences,
    Array.from({ length: sequences.length }, (_, index) => index + 1),
    "audit sequences must be unique and contiguous from one",
  );
  const verified = sequences.filter(
    (sequence) => !evidence.mismatchSequences.includes(sequence),
  );
  assert.deepEqual(verified, PAYLOAD_HASH_VERIFIED_SEQUENCES);
  assert.deepEqual(evidence.mismatchSequences, KNOWN_DISCONTINUITY_SEQUENCES);
  const head = evidence.rows.at(-1);
  assert(head, "audit evidence is empty");
  return {
    eventCount: sequences.length,
    minSeq: sequences[0],
    maxSeq: sequences.at(-1),
    distinctSeq: new Set(sequences).size,
    rowNoSequenceLastValue: sequenceState.last_value,
    rowNoSequenceIsCalled: sequenceState.is_called,
    linksContiguous: true,
    payloadHashVerifiedSequences: PAYLOAD_HASH_VERIFIED_SEQUENCES,
    knownDiscontinuitySequences: KNOWN_DISCONTINUITY_SEQUENCES,
    externalHead: {
      seq: head.seq,
      hash: head.hash,
      prevHash: head.prev_hash,
    },
  };
}

async function collectLockedEvidence(
  sourceUrl,
  restoredUrl,
  expectedDatabase,
  canonicalLegacyColumns,
) {
  const source = new Client({
    connectionString: sourceUrl,
    application_name: "bidbox_legacy_evidence_capture",
  });
  const restored = new Client({
    connectionString: restoredUrl,
    application_name: "bidbox_legacy_restore_verifier",
  });
  let sourceConnected = false;
  let restoredConnected = false;
  try {
    evidenceCaptureStage = "database_connect";
    await source.connect();
    sourceConnected = true;
    await restored.connect();
    restoredConnected = true;
    evidenceCaptureStage = "database_lock";
    await beginLockedSnapshot(source);
    await beginLockedSnapshot(restored);

    evidenceCaptureStage = "database_header";
    const sourceMajor = await databaseHeader(source, expectedDatabase);
    assert.equal(
      await databaseHeader(restored, expectedDatabase),
      sourceMajor,
      "source and restore PostgreSQL major mismatch",
    );
    evidenceCaptureStage = "database_lineage";
    const sourceLineage = await detectLegacyLineage(
      source,
      canonicalLegacyColumns,
    );
    const restoredLineage = await detectLegacyLineage(
      restored,
      canonicalLegacyColumns,
    );
    assert.deepEqual(
      restoredLineage,
      sourceLineage,
      "restored legacy column lineage mismatch",
    );
    evidenceCaptureStage = "database_catalog";
    const sourceCatalog = await legacyCatalogDigest(source);
    const restoredCatalog = await legacyCatalogDigest(restored);
    assert.deepEqual(
      restoredCatalog,
      sourceCatalog,
      "restored legacy catalog mismatch",
    );
    evidenceCaptureStage = "database_audit";
    const sourceAudit = await sourceEvidence(
      source,
      "legacy",
      KNOWN_DISCONTINUITY_SEQUENCES,
    );
    const restoredAudit = await sourceEvidence(
      restored,
      "legacy",
      KNOWN_DISCONTINUITY_SEQUENCES,
    );
    assert.equal(
      restoredAudit.auditExportContent,
      sourceAudit.auditExportContent,
      "restored audit bytes mismatch",
    );
    evidenceCaptureStage = "database_tables";
    const sourceDigests = await digestTables(
      source,
      sourceLineage.columns,
      "source",
    );
    const restoredDigests = await digestTables(
      restored,
      restoredLineage.columns,
      "restore",
    );
    const mismatchedTables = LEGACY_TABLES.filter(
      (table) =>
        restoredDigests[table].rowCount !== sourceDigests[table].rowCount ||
        restoredDigests[table].sha256 !== sourceDigests[table].sha256,
    );
    if (mismatchedTables.length > 0) {
      evidenceCaptureStage = `database_tables_${mismatchedTables.join("_")}`;
      assert.fail("restored table mismatch");
    }
    evidenceCaptureStage = "database_sequence";
    const sourceSequence = await auditSequenceState(source);
    assert.deepEqual(
      await auditSequenceState(restored),
      sourceSequence,
      "restored audit sequence mismatch",
    );
    return {
      auditContent: sourceAudit.auditExportContent,
      audit: summarizeAudit(sourceAudit, sourceSequence),
      catalog: sourceCatalog,
      legacyLineage: {
        id: sourceLineage.id,
        columnFingerprintAlgorithm: sourceLineage.columnFingerprintAlgorithm,
        columnFingerprintSha256: sourceLineage.columnFingerprintSha256,
      },
      postgresMajor: sourceMajor,
      tableDigests: sourceDigests,
    };
  } finally {
    if (restoredConnected) {
      await restored.query("ROLLBACK").catch(() => undefined);
      await restored.end().catch(() => undefined);
    }
    if (sourceConnected) {
      await source.query("ROLLBACK").catch(() => undefined);
      await source.end().catch(() => undefined);
    }
  }
}

function buildManifest({
  capturedAt,
  database,
  backupFileName,
  backupSha256,
  auditFileName,
  auditSha256,
  postgresMajor,
  restoreExitStatus,
  tableDigests,
  audit,
  catalog,
  legacyLineage,
}) {
  assert.equal(restoreExitStatus, 0, "restore exit status must be zero");
  const rowCounts = Object.fromEntries(
    LEGACY_TABLES.map((table) => [table, tableDigests[table].rowCount]),
  );
  const componentManifestSha256 = sha256(
    JSON.stringify({
      format: "valo.restore-components.v1",
      sourceCommit: SOURCE_COMMIT,
      backupSha256,
      auditSha256,
      rowCounts,
      audit,
      tableDigests,
      legacyCatalog: catalog,
      legacyLineage,
    }),
  );
  return {
    format: "valo.restore-rehearsal.v3",
    capturedAt,
    sourceCommit: SOURCE_COMMIT,
    target: {
      database,
      organisationId: ORGANISATION_ID,
      organisationName: "Valo Nigeria",
      organisationSlug: "valo-nigeria",
    },
    backup: {
      fileName: backupFileName,
      sha256: backupSha256,
      pgRestoreListVerified: true,
      scratchRestoreExitStatus: restoreExitStatus,
      postgresMajor,
    },
    auditExport: {
      fileName: auditFileName,
      sha256: auditSha256,
    },
    rowCounts,
    audit,
    legacyLineage,
    componentManifestSha256,
    tableDigestAlgorithm: SOURCE_DIGEST_ALGORITHM,
    tableDigests,
    allTableDigestsMatchProduction: true,
    legacyCatalog: catalog,
  };
}

async function assertEmptyDirectory(path) {
  assert.deepEqual(
    await readdir(path),
    [],
    "evidence output directory must be empty",
  );
}

async function assertFinalDirectory(path) {
  assert.deepEqual(
    (await readdir(path)).sort(),
    [AUDIT_FILE_NAME, MANIFEST_FILE_NAME, SIDECAR_FILE_NAME].sort(),
    "evidence output directory contains an unexpected entry",
  );
}

async function writePrivate(path, bytes) {
  await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
  await chmod(path, 0o600);
  const metadata = await stat(path);
  assert(metadata.isFile(), "evidence output is not a regular file");
  if (process.platform !== "win32") {
    assert.equal(metadata.mode & 0o077, 0, "evidence output is not private");
  }
}

function manifestSidecar(manifestSha256) {
  assert.match(manifestSha256, /^[0-9a-f]{64}$/);
  return `${manifestSha256}  ${MANIFEST_FILE_NAME}\n`;
}

async function capture() {
  evidenceCaptureStage = "arguments";
  assert.deepEqual(
    process.argv.slice(2),
    [CAPTURE_FLAG],
    "explicit evidence capture flag is required",
  );
  assert.equal(
    required("VALO_BRIDGE_EVIDENCE_QUIESCED_ACK"),
    QUIESCENCE_ACK,
    "source quiescence acknowledgement is absent",
  );
  evidenceCaptureStage = "inputs";
  const sourceUrl = required("VALO_BRIDGE_EVIDENCE_SOURCE_DATABASE_URL");
  const restoredUrl = required("VALO_BRIDGE_EVIDENCE_RESTORED_DATABASE_URL");
  const database = assertDistinctRestore(sourceUrl, restoredUrl);
  const restoreExitStatus = acknowledgedRestoreExitStatus();
  evidenceCaptureStage = "paths";
  const outputDirectory = await privateOutputDirectory(
    required("VALO_BRIDGE_EVIDENCE_OUTPUT_DIRECTORY"),
  );
  const backupPath = await privateRegularFile(
    required("VALO_BRIDGE_SOURCE_BACKUP_PATH"),
    "source backup",
  );
  const restoreBinary = await pgRestoreBinary(
    required("VALO_BRIDGE_PG_RESTORE_PATH"),
  );
  const auditPath = resolve(outputDirectory, AUDIT_FILE_NAME);
  const manifestPath = resolve(outputDirectory, MANIFEST_FILE_NAME);
  const sidecarPath = resolve(outputDirectory, SIDECAR_FILE_NAME);
  await assertEmptyDirectory(outputDirectory);
  evidenceCaptureStage = "backup_validation";
  const backupSha256 = await verifyStableBackup(restoreBinary, backupPath);
  evidenceCaptureStage = "bridge_artifact";
  const artifact = await checkArtifact();
  evidenceCaptureStage = "database_comparison";
  const evidence = await collectLockedEvidence(
    sourceUrl,
    restoredUrl,
    database,
    artifact.legacyColumns,
  );
  const auditBytes = Buffer.from(evidence.auditContent, "utf8");
  const manifest = buildManifest({
    capturedAt: new Date().toISOString(),
    database,
    backupFileName: basename(backupPath),
    backupSha256,
    auditFileName: AUDIT_FILE_NAME,
    auditSha256: sha256(auditBytes),
    postgresMajor: evidence.postgresMajor,
    restoreExitStatus,
    tableDigests: evidence.tableDigests,
    audit: evidence.audit,
    catalog: evidence.catalog,
    legacyLineage: evidence.legacyLineage,
  });
  evidenceCaptureStage = "manifest_validation";
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  const manifestSha256 = sha256(manifestBytes);
  parseRestoreManifest(manifestBytes, manifestSha256);
  evidenceCaptureStage = "publication";
  await assertEmptyDirectory(outputDirectory);
  await writePrivate(auditPath, auditBytes);
  await writePrivate(manifestPath, manifestBytes);
  await writePrivate(sidecarPath, Buffer.from(manifestSidecar(manifestSha256)));
  await assertFinalDirectory(outputDirectory);
  evidenceCaptureStage = "complete";
  console.log(
    "authoritative legacy evidence and isolated restore verified; private artifacts written",
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  capture().catch(() => {
    console.error(
      `legacy evidence capture failed closed at ${evidenceCaptureStage}; no evidence was approved`,
    );
    process.exitCode = 1;
  });
}

export {
  AUDIT_FILE_NAME,
  MANIFEST_FILE_NAME,
  QUIESCENCE_ACK,
  RESTORE_ACK,
  SIDECAR_FILE_NAME,
  assertEmptyDirectory,
  assertDistinctRestore,
  assertStableBackupSnapshot,
  buildManifest,
  databaseUrlIdentity,
  manifestSidecar,
  pathIsWithin,
  restoreListInventory,
};
