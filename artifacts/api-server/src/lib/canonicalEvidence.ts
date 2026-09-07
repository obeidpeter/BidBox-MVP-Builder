import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

export const CANONICAL_EVIDENCE_DEFAULT_LIMIT = 50;
export const CANONICAL_EVIDENCE_MAX_LIMIT = 100;

import {
  SHA256_HEX_PATTERN as SHA256_PATTERN,
  UUID_PATTERN,
} from "./identifierPatterns";

export interface CanonicalEvidenceOption {
  documentId: string;
  projectId: string;
  filename: string;
  projectTitle: string;
  sha256: string;
  versionNumber: number;
  detectedMime: string;
  sizeBytes: number;
  /** True for every returned option eligible for the optional Privacy picker. */
  privacyEligible: boolean;
}

export interface CanonicalEvidenceScope {
  organisationId: string;
  projectId?: string;
}

export class CanonicalEvidenceUnavailableError extends Error {
  constructor() {
    super("Canonical evidence options are unavailable");
    this.name = "CanonicalEvidenceUnavailableError";
  }
}

/**
 * Serialises canonical-evidence validation with document registration for one
 * tenant-scoped digest. The surrounding tenant transaction owns the lock.
 */
export async function lockCanonicalEvidenceDigest(
  organisationId: string,
  sha256: string,
): Promise<void> {
  if (!UUID_PATTERN.test(organisationId) || !SHA256_PATTERN.test(sha256)) {
    throw new CanonicalEvidenceUnavailableError();
  }
  await db.execute(sql`
    SELECT pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        ${`bidbox:canonical-evidence:${organisationId}:${sha256}`},
        0
      )
    )
  `);
}

function validOption(option: CanonicalEvidenceOption): boolean {
  return (
    UUID_PATTERN.test(option.documentId) &&
    UUID_PATTERN.test(option.projectId) &&
    option.filename.length > 0 &&
    option.filename.length <= 512 &&
    option.projectTitle.length > 0 &&
    option.projectTitle.length <= 1_024 &&
    SHA256_PATTERN.test(option.sha256) &&
    Number.isSafeInteger(option.versionNumber) &&
    option.versionNumber > 0 &&
    option.detectedMime.length > 0 &&
    option.detectedMime.length <= 256 &&
    Number.isSafeInteger(option.sizeBytes) &&
    option.sizeBytes >= 0 &&
    typeof option.privacyEligible === "boolean"
  );
}

/** Lists current, clean canonical versions only. Callers still revalidate on write. */
export async function listCanonicalEvidenceOptions(
  scope: CanonicalEvidenceScope,
  limit: number,
): Promise<{ items: CanonicalEvidenceOption[]; truncated: boolean }> {
  const result = await db.execute(sql`
    SELECT
      document.id::text AS "documentId",
      document.project_id::text AS "projectId",
      document.filename AS filename,
      project.tender_title AS "projectTitle",
      current_version.sha256 AS sha256,
      current_version.version_number AS "versionNumber",
      current_version.detected_mime AS "detectedMime",
      current_version.size_bytes AS "sizeBytes",
      TRUE AS "privacyEligible"
    FROM documents AS document
    JOIN projects AS project
      ON project.id = document.project_id
     AND project.organisation_id = document.organisation_id
    JOIN document_versions AS current_version
      ON current_version.document_id = document.id
     AND current_version.organisation_id = document.organisation_id
    WHERE document.organisation_id = ${scope.organisationId}::uuid
      AND (${scope.projectId ?? null}::uuid IS NULL OR document.project_id = ${scope.projectId ?? null}::uuid)
      AND document.sha256 = current_version.sha256
      AND current_version.malware_status = 'clean'
      AND current_version.quarantine_status = 'cleared'
      AND coalesce(document.extraction_status, 'pending') <> 'quarantined'
      AND NOT EXISTS (
        SELECT 1
        FROM document_versions AS later_version
        WHERE later_version.organisation_id = current_version.organisation_id
          AND later_version.document_id = current_version.document_id
          AND later_version.version_number > current_version.version_number
      )
    ORDER BY document.updated_at DESC, document.id DESC
    LIMIT ${limit + 1}
  `);
  const eligible = result.rows.map((raw): CanonicalEvidenceOption => {
    const row = raw as Record<string, unknown>;
    const sizeBytes = Number(row.sizeBytes);
    const versionNumber = Number(row.versionNumber);
    const option: CanonicalEvidenceOption = {
      documentId: String(row.documentId ?? ""),
      projectId: String(row.projectId ?? ""),
      filename: String(row.filename ?? ""),
      projectTitle: String(row.projectTitle ?? ""),
      sha256: String(row.sha256 ?? ""),
      versionNumber,
      detectedMime: String(row.detectedMime ?? ""),
      sizeBytes,
      privacyEligible: row.privacyEligible === true,
    };
    if (!validOption(option)) throw new CanonicalEvidenceUnavailableError();
    return option;
  });
  return {
    items: eligible.slice(0, limit),
    truncated: eligible.length > limit,
  };
}
