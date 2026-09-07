import { createHash } from "node:crypto";
import { lstat, open } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SHA256 = /^[0-9a-f]{64}$/u;
const COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SAFE_REFERENCE = /^[^\u0000-\u001f\u007f\ud800-\udfff]{1,512}$/u;
const MAX_EVIDENCE_BYTES = 1_000_000;

export class OperationalEvidenceError extends Error {
  constructor(code) {
    super(code);
    this.name = "OperationalEvidenceError";
  }
}

function fail(code) {
  throw new OperationalEvidenceError(code);
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, keys, code) {
  if (
    !isPlainObject(value) ||
    Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")
  ) {
    fail(code);
  }
}

function timestamp(value, code) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)
  ) {
    fail(code);
  }
  const parsed = new Date(value);
  const normalized = value.includes(".") ? value : `${value.slice(0, -1)}.000Z`;
  if (
    !Number.isFinite(parsed.valueOf()) ||
    parsed.toISOString() !== normalized
  ) {
    fail(code);
  }
  return parsed;
}

function positiveNumber(value, minimum, maximum, code) {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    fail(code);
  }
  return parsed;
}

function safeReference(value, code) {
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    !SAFE_REFERENCE.test(value)
  ) {
    fail(code);
  }
  return value;
}

function sha256(value, code) {
  if (typeof value !== "string" || !SHA256.test(value)) fail(code);
  return value;
}

function assertEvidenceClock(capturedAt, now) {
  if (capturedAt.valueOf() > now.valueOf() + 5 * 60_000) {
    fail("EVIDENCE_CAPTURED_IN_FUTURE");
  }
}

export function verifyBackupEvidenceDocument(document, options) {
  exactKeys(
    document,
    ["backup", "capturedAt", "environment", "schema"],
    "BACKUP_EVIDENCE_SHAPE_INVALID",
  );
  if (document.schema !== "valo.backup-evidence/v1") {
    fail("BACKUP_EVIDENCE_SCHEMA_INVALID");
  }
  if (!["production", "staging"].includes(document.environment)) {
    fail("BACKUP_EVIDENCE_ENVIRONMENT_INVALID");
  }
  if (
    options?.expectedEnvironment &&
    document.environment !== options.expectedEnvironment
  ) {
    fail("BACKUP_EVIDENCE_ENVIRONMENT_MISMATCH");
  }
  const now = options?.now ?? new Date();
  const capturedAt = timestamp(
    document.capturedAt,
    "BACKUP_CAPTURED_AT_INVALID",
  );
  assertEvidenceClock(capturedAt, now);
  const backup = document.backup;
  exactKeys(
    backup,
    [
      "backupId",
      "completedAt",
      "databaseArtifactSha256",
      "encrypted",
      "objectInventorySha256",
      "provider",
      "providerReceiptReference",
      "providerReceiptSha256",
      "providerStatus",
      "restoreDrill",
      "sourceCommit",
      "startedAt",
    ],
    "BACKUP_RECORD_SHAPE_INVALID",
  );
  safeReference(backup.backupId, "BACKUP_ID_INVALID");
  safeReference(backup.provider, "BACKUP_PROVIDER_INVALID");
  if (
    typeof backup.sourceCommit !== "string" ||
    !COMMIT.test(backup.sourceCommit)
  ) {
    fail("BACKUP_SOURCE_COMMIT_INVALID");
  }
  if (
    typeof options?.expectedSourceCommit !== "string" ||
    !COMMIT.test(options.expectedSourceCommit)
  ) {
    fail("BACKUP_EXPECTED_SOURCE_COMMIT_INVALID");
  }
  if (backup.sourceCommit !== options.expectedSourceCommit) {
    fail("BACKUP_SOURCE_COMMIT_MISMATCH");
  }
  if (backup.encrypted !== true || backup.providerStatus !== "completed") {
    fail("BACKUP_PROVIDER_COMPLETION_UNVERIFIED");
  }
  sha256(backup.databaseArtifactSha256, "BACKUP_DATABASE_DIGEST_INVALID");
  sha256(backup.objectInventorySha256, "BACKUP_OBJECT_DIGEST_INVALID");
  safeReference(
    backup.providerReceiptReference,
    "BACKUP_RECEIPT_REFERENCE_INVALID",
  );
  sha256(backup.providerReceiptSha256, "BACKUP_RECEIPT_DIGEST_INVALID");
  const startedAt = timestamp(backup.startedAt, "BACKUP_STARTED_AT_INVALID");
  const completedAt = timestamp(
    backup.completedAt,
    "BACKUP_COMPLETED_AT_INVALID",
  );
  if (
    completedAt < startedAt ||
    completedAt > capturedAt ||
    completedAt > now
  ) {
    fail("BACKUP_TIMELINE_INVALID");
  }
  exactKeys(
    backup.restoreDrill,
    ["completedAt", "reportSha256", "status"],
    "RESTORE_DRILL_SHAPE_INVALID",
  );
  if (backup.restoreDrill.status !== "passed") {
    fail("RESTORE_DRILL_NOT_PASSED");
  }
  const restoreCompletedAt = timestamp(
    backup.restoreDrill.completedAt,
    "RESTORE_DRILL_COMPLETED_AT_INVALID",
  );
  sha256(backup.restoreDrill.reportSha256, "RESTORE_DRILL_DIGEST_INVALID");
  if (restoreCompletedAt > capturedAt || restoreCompletedAt > now) {
    fail("RESTORE_DRILL_TIMELINE_INVALID");
  }
  const rpoHours = positiveNumber(
    options?.rpoHours,
    0.25,
    168,
    "BACKUP_RPO_INVALID",
  );
  const restoreDrillMaxAgeDays = positiveNumber(
    options?.restoreDrillMaxAgeDays,
    1,
    366,
    "RESTORE_DRILL_MAX_AGE_INVALID",
  );
  const ageHours = (now.valueOf() - completedAt.valueOf()) / 3_600_000;
  const restoreAgeDays =
    (now.valueOf() - restoreCompletedAt.valueOf()) / 86_400_000;
  if (ageHours > rpoHours) fail("BACKUP_RPO_EXCEEDED");
  if (restoreAgeDays > restoreDrillMaxAgeDays) {
    fail("RESTORE_DRILL_STALE");
  }
  return {
    event: "bidbox.backup.evidence_verified",
    signals: {
      "bidbox.backup.age_hours": ageHours,
      "bidbox.backup.last_success_unixtime_seconds": Math.floor(
        now.valueOf() / 1_000,
      ),
      "bidbox.backup.verification_failures": 0,
    },
  };
}

export function verifyAuditAnchorEvidenceDocument(document, options) {
  exactKeys(
    document,
    [
      "retainedOrganisationCount",
      "retainedOrganisationSetSha256",
      "capturedAt",
      "environment",
      "provider",
      "records",
      "schema",
      "sourceCommit",
    ],
    "ANCHOR_EVIDENCE_SHAPE_INVALID",
  );
  if (document.schema !== "valo.audit-anchor-evidence/v1") {
    fail("ANCHOR_EVIDENCE_SCHEMA_INVALID");
  }
  if (!["production", "staging"].includes(document.environment)) {
    fail("ANCHOR_EVIDENCE_ENVIRONMENT_INVALID");
  }
  if (
    options?.expectedEnvironment &&
    document.environment !== options.expectedEnvironment
  ) {
    fail("ANCHOR_EVIDENCE_ENVIRONMENT_MISMATCH");
  }
  const now = options?.now ?? new Date();
  const capturedAt = timestamp(
    document.capturedAt,
    "ANCHOR_CAPTURED_AT_INVALID",
  );
  assertEvidenceClock(capturedAt, now);
  safeReference(document.provider, "ANCHOR_PROVIDER_INVALID");
  if (
    typeof document.sourceCommit !== "string" ||
    !COMMIT.test(document.sourceCommit)
  ) {
    fail("ANCHOR_SOURCE_COMMIT_INVALID");
  }
  if (
    typeof options?.expectedSourceCommit !== "string" ||
    !COMMIT.test(options.expectedSourceCommit)
  ) {
    fail("ANCHOR_EXPECTED_SOURCE_COMMIT_INVALID");
  }
  if (document.sourceCommit !== options.expectedSourceCommit) {
    fail("ANCHOR_SOURCE_COMMIT_MISMATCH");
  }
  sha256(
    document.retainedOrganisationSetSha256,
    "ANCHOR_ORGANISATION_SET_DIGEST_INVALID",
  );
  const expectedOrganisationSetSha256 = sha256(
    options?.expectedOrganisationSetSha256,
    "ANCHOR_EXPECTED_ORGANISATION_SET_DIGEST_INVALID",
  );
  const expectedOrganisationCount = positiveNumber(
    options?.expectedOrganisationCount,
    1,
    5_000,
    "ANCHOR_EXPECTED_ORGANISATION_COUNT_INVALID",
  );
  if (!Number.isSafeInteger(expectedOrganisationCount)) {
    fail("ANCHOR_EXPECTED_ORGANISATION_COUNT_INVALID");
  }
  if (
    !Number.isSafeInteger(document.retainedOrganisationCount) ||
    document.retainedOrganisationCount < 1 ||
    document.retainedOrganisationCount > 5_000 ||
    !Array.isArray(document.records) ||
    document.records.length !== document.retainedOrganisationCount
  ) {
    fail("ANCHOR_TENANT_CYCLE_INCOMPLETE");
  }
  if (
    document.retainedOrganisationCount !== expectedOrganisationCount ||
    document.retainedOrganisationSetSha256 !== expectedOrganisationSetSha256
  ) {
    fail("ANCHOR_EXPECTED_ORGANISATION_SET_MISMATCH");
  }
  const organisationIds = new Set();
  let oldestAnchorAt = capturedAt;
  for (const record of document.records) {
    exactKeys(
      record,
      ["anchor", "databaseHead", "organisationId"],
      "ANCHOR_RECORD_SHAPE_INVALID",
    );
    if (
      !UUID.test(record.organisationId) ||
      organisationIds.has(record.organisationId)
    ) {
      fail("ANCHOR_ORGANISATION_INVALID");
    }
    organisationIds.add(record.organisationId);
    exactKeys(
      record.databaseHead,
      ["hash", "sequence"],
      "ANCHOR_DATABASE_HEAD_SHAPE_INVALID",
    );
    exactKeys(
      record.anchor,
      [
        "anchoredAt",
        "chainHeadHash",
        "firstSequence",
        "immutableObjectReference",
        "lastSequence",
        "receiptHash",
        "receiptSignatureVerified",
        "verificationStatus",
        "verifiedAt",
      ],
      "ANCHOR_RECEIPT_SHAPE_INVALID",
    );
    const { anchor, databaseHead } = record;
    if (
      !Number.isSafeInteger(databaseHead.sequence) ||
      databaseHead.sequence < 1 ||
      !Number.isSafeInteger(anchor.firstSequence) ||
      !Number.isSafeInteger(anchor.lastSequence) ||
      anchor.firstSequence < 1 ||
      anchor.lastSequence < anchor.firstSequence ||
      databaseHead.sequence !== anchor.lastSequence
    ) {
      fail("ANCHOR_SEQUENCE_MISMATCH");
    }
    sha256(databaseHead.hash, "ANCHOR_DATABASE_HEAD_HASH_INVALID");
    sha256(anchor.chainHeadHash, "ANCHOR_CHAIN_HEAD_HASH_INVALID");
    if (databaseHead.hash !== anchor.chainHeadHash) {
      fail("ANCHOR_CHAIN_HEAD_MISMATCH");
    }
    safeReference(
      anchor.immutableObjectReference,
      "ANCHOR_OBJECT_REFERENCE_INVALID",
    );
    sha256(anchor.receiptHash, "ANCHOR_RECEIPT_HASH_INVALID");
    if (
      anchor.receiptSignatureVerified !== true ||
      anchor.verificationStatus !== "verified"
    ) {
      fail("ANCHOR_PROVIDER_VERIFICATION_FAILED");
    }
    const anchoredAt = timestamp(anchor.anchoredAt, "ANCHOR_TIME_INVALID");
    const verifiedAt = timestamp(
      anchor.verifiedAt,
      "ANCHOR_VERIFIED_AT_INVALID",
    );
    if (
      verifiedAt < anchoredAt ||
      verifiedAt > capturedAt ||
      verifiedAt > now
    ) {
      fail("ANCHOR_TIMELINE_INVALID");
    }
    if (anchoredAt < oldestAnchorAt) oldestAnchorAt = anchoredAt;
  }
  const sortedIds = [...organisationIds].sort().join("\n") + "\n";
  const organisationSetDigest = createHash("sha256")
    .update(sortedIds)
    .digest("hex");
  if (organisationSetDigest !== document.retainedOrganisationSetSha256) {
    fail("ANCHOR_ORGANISATION_SET_MISMATCH");
  }
  if (organisationSetDigest !== expectedOrganisationSetSha256) {
    fail("ANCHOR_EXPECTED_ORGANISATION_SET_MISMATCH");
  }
  const maxAgeHours = positiveNumber(
    options?.maxAgeHours,
    0.25,
    168,
    "ANCHOR_MAX_AGE_INVALID",
  );
  const ageSeconds = Math.max(
    0,
    (now.valueOf() - oldestAnchorAt.valueOf()) / 1_000,
  );
  if (ageSeconds > maxAgeHours * 3_600) fail("ANCHOR_EVIDENCE_STALE");
  return {
    event: "bidbox.audit.anchor_evidence_verified",
    signals: {
      "bidbox.audit.anchor_age_seconds": ageSeconds,
      "bidbox.audit.anchor_cycle_complete": 1,
      "bidbox.audit.anchor_failures": 0,
      "bidbox.audit.anchor_last_success_unixtime_seconds": Math.floor(
        now.valueOf() / 1_000,
      ),
    },
    tenantsVerified: document.records.length,
  };
}

export async function readPinnedEvidence(path, expectedSha256) {
  if (!path || !isAbsolute(path)) fail("EVIDENCE_PATH_MUST_BE_ABSOLUTE");
  sha256(expectedSha256, "EVIDENCE_EXPECTED_DIGEST_INVALID");
  const metadata = await lstat(path).catch(() => fail("EVIDENCE_FILE_MISSING"));
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size < 2 ||
    metadata.size > MAX_EVIDENCE_BYTES
  ) {
    fail("EVIDENCE_FILE_UNSAFE");
  }
  const handle = await open(path, "r").catch(() =>
    fail("EVIDENCE_FILE_MISSING"),
  );
  let bytes;
  try {
    const openedMetadata = await handle.stat();
    if (
      !openedMetadata.isFile() ||
      openedMetadata.dev !== metadata.dev ||
      openedMetadata.ino !== metadata.ino ||
      openedMetadata.size !== metadata.size
    ) {
      fail("EVIDENCE_FILE_CHANGED");
    }
    bytes = await handle.readFile();
  } finally {
    await handle.close().catch(() => undefined);
  }
  const actualSha256 = createHash("sha256").update(bytes).digest("hex");
  if (actualSha256 !== expectedSha256) fail("EVIDENCE_DIGEST_MISMATCH");
  let document;
  try {
    document = JSON.parse(bytes.toString("utf8"));
  } catch {
    fail("EVIDENCE_JSON_INVALID");
  }
  return document;
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) fail("EVIDENCE_CONFIGURATION_MISSING");
  return value;
}

async function main() {
  const kindIndex = process.argv.indexOf("--kind");
  const kind = kindIndex >= 0 ? process.argv[kindIndex + 1] : undefined;
  if (!["backup", "audit-anchor"].includes(kind)) {
    fail("EVIDENCE_KIND_INVALID");
  }
  const prefix = kind === "backup" ? "BACKUP" : "AUDIT_ANCHOR";
  const document = await readPinnedEvidence(
    requiredEnvironment(`VALO_${prefix}_EVIDENCE_FILE`),
    requiredEnvironment(`VALO_${prefix}_EVIDENCE_SHA256`),
  );
  const expectedEnvironment = requiredEnvironment(
    "VALO_OPERATION_EVIDENCE_ENVIRONMENT",
  );
  if (!["production", "staging"].includes(expectedEnvironment)) {
    fail("EVIDENCE_ENVIRONMENT_INVALID");
  }
  const result =
    kind === "backup"
      ? verifyBackupEvidenceDocument(document, {
          expectedEnvironment,
          expectedSourceCommit: requiredEnvironment(
            "VALO_OPERATION_EVIDENCE_SOURCE_SHA",
          ),
          rpoHours: requiredEnvironment("VALO_BACKUP_RPO_HOURS"),
          restoreDrillMaxAgeDays: requiredEnvironment(
            "VALO_RESTORE_DRILL_MAX_AGE_DAYS",
          ),
        })
      : verifyAuditAnchorEvidenceDocument(document, {
          expectedEnvironment,
          expectedSourceCommit: requiredEnvironment(
            "VALO_OPERATION_EVIDENCE_SOURCE_SHA",
          ),
          expectedOrganisationCount: requiredEnvironment(
            "VALO_AUDIT_ANCHOR_EXPECTED_RETAINED_ORGANISATION_COUNT",
          ),
          expectedOrganisationSetSha256: requiredEnvironment(
            "VALO_AUDIT_ANCHOR_EXPECTED_RETAINED_ORGANISATION_SET_SHA256",
          ),
          maxAgeHours: requiredEnvironment("VALO_AUDIT_ANCHOR_MAX_AGE_HOURS"),
        });
  console.log(JSON.stringify(result));
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  try {
    await main();
  } catch (error) {
    const kind = process.argv.includes("backup") ? "backup" : "audit_anchor";
    console.error(
      JSON.stringify({
        error:
          error instanceof OperationalEvidenceError
            ? error.message
            : "OPERATIONAL_EVIDENCE_VERIFICATION_FAILED",
        event: `bidbox.${kind}.evidence_verification_failed`,
        signals:
          kind === "backup"
            ? { "bidbox.backup.verification_failures": 1 }
            : {
                "bidbox.audit.anchor_cycle_complete": 0,
                "bidbox.audit.anchor_failures": 1,
              },
      }),
    );
    process.exitCode = 1;
  }
}
