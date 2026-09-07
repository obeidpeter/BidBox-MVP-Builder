import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import {
  EXPECTED_REPLIT_INTAKE_SECURITY,
  EXPECTED_REPLIT_MIGRATIONS,
  runReplitIntakeMigrations,
  shouldApplyReplitMigrations,
  validateLocalReplitMigrationManifest,
  validateReplitIntakeCatalog,
  validateReplitIntakeSchemaState,
  validateReplitMigrationEnvironment,
  validateReplitMigrationJournal,
  validateReplitMigrationSearchPath,
  withReplitMigrationSearchPath,
} from "./replit-intake-migrations.mjs";

const { Pool } = pg;
const migrationsDirectory = resolve(import.meta.dirname, "../migrations");
const leadOperationsMigration = readFileSync(
  resolve(migrationsDirectory, "0006_lead_operations_queue.sql"),
  "utf8",
);
const storageLifecycleMigration = readFileSync(
  resolve(migrationsDirectory, "0007_storage_lifecycle_indexes.sql"),
  "utf8",
);
const productionAssuranceMigration = readFileSync(
  resolve(migrationsDirectory, "0008_production_assurance.sql"),
  "utf8",
);
const tenderContextMigration = readFileSync(
  resolve(migrationsDirectory, "0010_tender_context_and_addendum.sql"),
  "utf8",
);
const retentionCompletionMigration = readFileSync(
  resolve(migrationsDirectory, "0011_retention_completion.sql"),
  "utf8",
);
const deliverySourceReleaseBoundaryMigration = readFileSync(
  resolve(migrationsDirectory, "0012_delivery_source_release_boundary.sql"),
  "utf8",
);
const replitMigrationRunner = readFileSync(
  resolve(import.meta.dirname, "replit-intake-migrations.mjs"),
  "utf8",
);

async function createMigrationPrefix(count) {
  const prefixDirectory = await mkdtemp(
    join(tmpdir(), "bidbox-replit-migration-prefix-"),
  );
  const metaDirectory = join(prefixDirectory, "meta");
  await mkdir(metaDirectory);
  const journal = JSON.parse(
    await readFile(resolve(migrationsDirectory, "meta/_journal.json"), "utf8"),
  );
  journal.entries = journal.entries.slice(0, count);
  await writeFile(
    join(metaDirectory, "_journal.json"),
    `${JSON.stringify(journal, null, 2)}\n`,
    "utf8",
  );
  await Promise.all(
    EXPECTED_REPLIT_MIGRATIONS.slice(0, count).map(({ tag }) =>
      copyFile(
        resolve(migrationsDirectory, `${tag}.sql`),
        join(prefixDirectory, `${tag}.sql`),
      ),
    ),
  );
  return prefixDirectory;
}

const journalRows = (count) =>
  EXPECTED_REPLIT_MIGRATIONS.slice(0, count).map((migration) => ({
    id: migration.id,
    hash: migration.hash,
    createdAt: migration.createdAt,
  }));

test("accepts only the exact approved baseline, upgrade, and complete journal states", () => {
  assert.equal(validateReplitMigrationJournal(journalRows(3)), "pending");
  assert.equal(
    validateReplitMigrationJournal(journalRows(6)),
    "upgrade_pending",
  );
  assert.equal(
    validateReplitMigrationJournal(journalRows(7)),
    "storage_upgrade_pending",
  );
  assert.equal(
    validateReplitMigrationJournal(journalRows(8)),
    "assurance_upgrade_pending",
  );
  assert.equal(
    validateReplitMigrationJournal(journalRows(9)),
    "registry_upgrade_pending",
  );
  assert.equal(
    validateReplitMigrationJournal(journalRows(10)),
    "tender_context_upgrade_pending",
  );
  assert.equal(
    validateReplitMigrationJournal(journalRows(11)),
    "retention_completion_upgrade_pending",
  );
  assert.equal(
    validateReplitMigrationJournal(journalRows(12)),
    "delivery_source_release_boundary_upgrade_pending",
  );
  assert.equal(
    validateReplitMigrationJournal(journalRows(13)),
    "delivery_guard_least_privilege_upgrade_pending",
  );
  assert.equal(
    validateReplitMigrationJournal(journalRows(14)),
    "already_applied",
  );
  for (const rejectedRows of [
    journalRows(0),
    journalRows(1),
    journalRows(2),
    journalRows(4),
    journalRows(5),
    [...journalRows(14), { id: 15, hash: "0".repeat(64), createdAt: "0" }],
  ]) {
    assert.throws(
      () => validateReplitMigrationJournal(rejectedRows),
      /not an approved prefix through 0013/,
    );
  }
  assert.throws(
    () =>
      validateReplitMigrationJournal([
        ...journalRows(2),
        { ...journalRows(3)[2], hash: "0".repeat(64) },
      ]),
    /entry 3 is drifted/,
  );
});

test("binds journal state to the presence of the intake schema", () => {
  assert.doesNotThrow(() => validateReplitIntakeSchemaState("pending", null));
  assert.doesNotThrow(() =>
    validateReplitIntakeSchemaState("upgrade_pending", "valo_intake"),
  );
  assert.doesNotThrow(() =>
    validateReplitIntakeSchemaState("storage_upgrade_pending", "valo_intake"),
  );
  assert.doesNotThrow(() =>
    validateReplitIntakeSchemaState("assurance_upgrade_pending", "valo_intake"),
  );
  assert.doesNotThrow(() =>
    validateReplitIntakeSchemaState("registry_upgrade_pending", "valo_intake"),
  );
  assert.doesNotThrow(() =>
    validateReplitIntakeSchemaState(
      "tender_context_upgrade_pending",
      "valo_intake",
    ),
  );
  assert.doesNotThrow(() =>
    validateReplitIntakeSchemaState(
      "retention_completion_upgrade_pending",
      "valo_intake",
    ),
  );
  assert.doesNotThrow(() =>
    validateReplitIntakeSchemaState(
      "delivery_source_release_boundary_upgrade_pending",
      "valo_intake",
    ),
  );
  assert.doesNotThrow(() =>
    validateReplitIntakeSchemaState(
      "delivery_guard_least_privilege_upgrade_pending",
      "valo_intake",
    ),
  );
  assert.doesNotThrow(() =>
    validateReplitIntakeSchemaState("already_applied", "valo_intake"),
  );
  assert.throws(
    () => validateReplitIntakeSchemaState("pending", "valo_intake"),
    /exists before/,
  );
  assert.throws(
    () => validateReplitIntakeSchemaState("upgrade_pending", null),
    /absent after/,
  );
  assert.throws(
    () => validateReplitIntakeSchemaState("storage_upgrade_pending", null),
    /absent after/,
  );
  assert.throws(
    () => validateReplitIntakeSchemaState("already_applied", null),
    /absent after/,
  );
});

test("applies migrations for every approved incomplete journal state", () => {
  assert.equal(shouldApplyReplitMigrations("pending"), true);
  assert.equal(shouldApplyReplitMigrations("upgrade_pending"), true);
  assert.equal(shouldApplyReplitMigrations("storage_upgrade_pending"), true);
  assert.equal(shouldApplyReplitMigrations("assurance_upgrade_pending"), true);
  assert.equal(shouldApplyReplitMigrations("registry_upgrade_pending"), true);
  assert.equal(
    shouldApplyReplitMigrations("tender_context_upgrade_pending"),
    true,
  );
  assert.equal(
    shouldApplyReplitMigrations("retention_completion_upgrade_pending"),
    true,
  );
  assert.equal(
    shouldApplyReplitMigrations(
      "delivery_source_release_boundary_upgrade_pending",
    ),
    true,
  );
  assert.equal(
    shouldApplyReplitMigrations(
      "delivery_guard_least_privilege_upgrade_pending",
    ),
    true,
  );
  assert.equal(shouldApplyReplitMigrations("already_applied"), false);
});

test("pins tender-context isolation, immutability and least privilege", () => {
  for (const table of [
    "addendum_impact_assessments",
    "addendum_impact_items",
    "document_version_snapshots",
    "tender_context_artifacts",
    "tender_context_requirements",
    "tender_context_versions",
    "tender_eligibility_passports",
  ]) {
    assert.match(tenderContextMigration, new RegExp(`'${table}'`, "u"));
  }
  assert.match(
    tenderContextMigration,
    /FORCE ROW LEVEL SECURITY[\s\S]*CREATE POLICY tenant_isolation/u,
  );
  assert.match(
    tenderContextMigration,
    /reject_versioned_record_content_mutation[\s\S]*document_version_snapshot_content_immutable[\s\S]*tender_context_version_content_immutable[\s\S]*tender_eligibility_passport_content_immutable[\s\S]*addendum_impact_assessment_content_immutable[\s\S]*addendum_impact_item_content_immutable/u,
  );
  assert.match(
    tenderContextMigration,
    /GRANT SELECT, INSERT ON TABLE[\s\S]*tender_context_artifacts[\s\S]*tender_context_requirements/u,
  );
  assert.match(
    tenderContextMigration,
    /REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE/u,
  );
  assert.match(
    tenderContextMigration,
    /addendum_impact_assessments_revision_unique"[\s\S]*"baseline_document_version_id"[\s\S]*"revision_document_version_id", "assessment_id"/u,
  );
  assert.match(
    tenderContextMigration,
    /addendum_impact_assessments_impact_sha256_check"\s+CHECK \("impact_manifest_sha256" ~ '\^\[0-9a-f\]\{64\}\$'\)/u,
  );
  assert.match(
    tenderContextMigration,
    /BEFORE UPDATE OF[\s\S]*radar_id,[\s\S]*assessment_id, source_manifest_sha256, impact_manifest_sha256,[\s\S]*assessment_snapshot, created_at/u,
  );
});

test("pins retention completion persistence and least privilege", () => {
  assert.doesNotMatch(
    retentionCompletionMigration,
    /ALTER TABLE public\.users (?:NO )?FORCE ROW LEVEL SECURITY/u,
  );
  assert.match(
    retentionCompletionMigration,
    /ALTER TABLE public\.retention_requests NO FORCE ROW LEVEL SECURITY[\s\S]*UPDATE public\.retention_requests AS request[\s\S]*ALTER TABLE public\.retention_requests FORCE ROW LEVEL SECURITY/u,
  );
  assert.match(
    retentionCompletionMigration,
    /ALTER TABLE public\.retention_actions NO FORCE ROW LEVEL SECURITY[\s\S]*ALTER TABLE public\.retention_requests NO FORCE ROW LEVEL SECURITY[\s\S]*UPDATE public\.retention_actions AS action[\s\S]*ALTER TABLE public\.retention_requests FORCE ROW LEVEL SECURITY[\s\S]*ALTER TABLE public\.retention_actions FORCE ROW LEVEL SECURITY/u,
  );
  assert.match(
    retentionCompletionMigration,
    /UPDATE public\.retention_actions AS action[\s\S]*SET executed_by_name = COALESCE[\s\S]*Legacy retention executor unavailable[\s\S]*WHERE executed_at IS NOT NULL AND executed_by_name IS NULL/u,
  );
  assert.match(
    retentionCompletionMigration,
    /ALTER TABLE public\.deletion_certificates NO FORCE ROW LEVEL SECURITY[\s\S]*UPDATE public\.deletion_certificates AS certificate[\s\S]*ALTER TABLE public\.deletion_certificates FORCE ROW LEVEL SECURITY/u,
  );
  assert.match(
    retentionCompletionMigration,
    /ALTER COLUMN project_id DROP NOT NULL[\s\S]*ON DELETE SET NULL/u,
  );
  assert.doesNotMatch(
    retentionCompletionMigration,
    /UPDATE public\.retention_requests[\s\S]{0,500}SET completion_protocol_version = 1/u,
  );
  assert.match(
    retentionCompletionMigration,
    /Legacy retention requester unavailable[\s\S]*ALTER COLUMN completion_protocol_version SET DEFAULT 1/u,
  );
  assert.match(
    retentionCompletionMigration,
    /CREATE TABLE public\.retention_action_storage_events[\s\S]*request_sha256 text NOT NULL[\s\S]*object_path_sha256 text NOT NULL/u,
  );
  assert.match(
    retentionCompletionMigration,
    /terminal_disposition IN \([\s\S]*'deleted'[\s\S]*'already_absent'[\s\S]*'cancelled_referenced'[\s\S]*'accepted_unresolved'/u,
  );
  assert.match(
    retentionCompletionMigration,
    /enforce_retention_completion_transition[\s\S]*NEW\.version <> OLD\.version \+ 1[\s\S]*retention action transition is not monotonic/u,
  );
  assert.match(
    retentionCompletionMigration,
    /legacy retention request evidence is read-only[\s\S]*legacy retention action evidence is read-only/u,
  );
  assert.match(
    retentionCompletionMigration,
    /NEW\.signed_by_user_id IS DISTINCT FROM action_checked_by_user_id[\s\S]*NEW\.certificate_manifest IS NULL[\s\S]*deletion certificate does not match certified retention evidence/u,
  );
  assert.match(
    retentionCompletionMigration,
    /FORCE ROW LEVEL SECURITY[\s\S]*CREATE POLICY tenant_isolation/u,
  );
  assert.match(
    retentionCompletionMigration,
    /REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE[\s\S]*retention_action_storage_events[\s\S]*REVOKE UPDATE ON TABLE public\.deletion_certificates/u,
  );
  assert.match(
    retentionCompletionMigration,
    /completion_protocol_version = 1[\s\S]*binding\.terminal_disposition NOT IN \('deleted', 'already_absent'\)/u,
  );
  assert.match(
    retentionCompletionMigration,
    /CREATE FUNCTION valo_security\.purge_retention_project\([\s\S]*SECURITY DEFINER[\s\S]*source manifest digest does not match its bytes[\s\S]*retention project inventory changed/u,
  );
  assert.match(
    retentionCompletionMigration,
    /purge_receipt text[\s\S]*only the owner-held purge may stamp purge evidence[\s\S]*UPDATE public\.retention_actions AS action[\s\S]*purge_receipt = purge_receipt_text/u,
  );
  assert.match(
    retentionCompletionMigration,
    /source_manifest_json[\s\S]*root_key\.value NOT IN \([\s\S]*nested_key\.value NOT IN \([\s\S]*purge_receipt_json[\s\S]*reconciliation_manifest_json->>'purgeReceiptSha256'[\s\S]*certificate_manifest_json->>'purgeReceiptSha256'/u,
  );
  assert.match(
    retentionCompletionMigration,
    /NEW\.requested_by IS NULL[\s\S]*Valo retention scheduler[\s\S]*actor\.id = NEW\.requested_by[\s\S]*retention request lacks current named tenant authority/u,
  );
  assert.match(
    retentionCompletionMigration,
    /event_payload IS DISTINCT FROM[\s\S]*"aggregateId"[\s\S]*"requestSha256"[\s\S]*"schema"/u,
  );
  assert.match(
    retentionCompletionMigration,
    /SELECT DISTINCT 'invoices'[\s\S]*SELECT DISTINCT 'payments'[\s\S]*SELECT DISTINCT 'vault_items'[\s\S]*SELECT 'audit_events'/u,
  );
  for (const category of [
    "addendum_impact_items",
    "boq_exceptions",
    "claim_evidence_links",
    "conflict_records",
    "draft_versions",
    "draft_claims",
    "notification_events",
    "notification_attempts",
    "package_manifest_items",
    "processing_runs",
    "red_team_findings",
    "requirement_citations",
  ]) {
    assert.match(retentionCompletionMigration, new RegExp(`'${category}'`));
  }
  assert.match(
    retentionCompletionMigration,
    /FOR UPDATE OF retained_order[\s\S]*FOR UPDATE OF invoice[\s\S]*FOR UPDATE OF payment[\s\S]*verified_manual/u,
  );
  assert.match(
    retentionCompletionMigration,
    /FOR UPDATE OF document[\s\S]*FOR UPDATE OF version[\s\S]*FOR UPDATE OF package_row[\s\S]*FOR UPDATE OF version[\s\S]*FOR UPDATE OF task/u,
  );
  assert.match(
    retentionCompletionMigration,
    /FROM public\.evidence_items AS evidence[\s\S]*FROM public\.boq_checks AS check_row[\s\S]*FROM public\.llm_runs AS run[\s\S]*FROM public\.engagement_tender_lots AS engagement[\s\S]*FROM public\.comments AS comment[\s\S]*FROM public\.reviews AS review[\s\S]*FROM public\.approvals AS approval[\s\S]*FROM public\.vault_usage AS usage[\s\S]*FROM public\.capability_usage AS usage[\s\S]*FROM public\.rule_evaluations AS evaluation[\s\S]*FROM public\.outcomes AS outcome/u,
  );
  assert.match(
    retentionCompletionMigration,
    /LOCK TABLE public\.vault_items, public\.audit_events[\s\S]*IN SHARE ROW EXCLUSIVE MODE[\s\S]*matched_project_id = p_subject_project_id[\s\S]*other_request\.id <> p_retention_request_id[\s\S]*external_requirement[\s\S]*external_passport[\s\S]*DELETE FROM public\.tender_eligibility_passports[\s\S]*DELETE FROM public\.claim_evidence_links[\s\S]*tender context lineage cannot be safely purged/u,
  );
  assert.match(
    retentionCompletionMigration,
    /external_citation[\s\S]*external_job\.document_version_id[\s\S]*successor\.supersedes_context_version_id[\s\S]*external_task\.requirement_id[\s\S]*external_artifact\.tender_context_version_id[\s\S]*external_binding\.tender_context_version_id/u,
  );
  assert.match(
    retentionCompletionMigration,
    /live_storage[\s\S]*claimed_storage[\s\S]*bound_storage[\s\S]*manifest_binding_drifted/u,
  );
  assert.match(
    retentionCompletionMigration,
    /REVOKE EXECUTE ON FUNCTION valo_security\.purge_retention_project\([\s\S]*FROM valo_app_runtime/u,
  );
});

test("pins the delivery-source and project-delete release boundary", () => {
  const guardedTables = [
    "boq_checks",
    "claim_evidence_links",
    "defects",
    "document_version_snapshots",
    "document_versions",
    "documents",
    "draft_claims",
    "draft_versions",
    "drafts",
    "evidence_items",
    "red_team_findings",
    "red_team_runs",
    "requirements",
    "reviews",
  ];
  assert.deepEqual(
    [
      ...deliverySourceReleaseBoundaryMigration.matchAll(
        /CREATE TRIGGER delivery_source_project_guard\s+BEFORE INSERT OR UPDATE OR DELETE ON public\.([a-z0-9_]+)/gu,
      ),
    ]
      .map((match) => match[1])
      .sort(),
    guardedTables,
  );
  assert.match(
    deliverySourceReleaseBoundaryMigration,
    /WHEN 'red_team_findings' THEN[\s\S]*FROM public\.red_team_runs AS run/u,
  );
  assert.match(
    deliverySourceReleaseBoundaryMigration,
    /CREATE OR REPLACE FUNCTION public\.valo_guard_delivery_project_delete\(\)[\s\S]*routine\.prosecdef[\s\S]*CURRENT_USER::name IS DISTINCT FROM retention_purge_owner/u,
  );
  assert.match(
    deliverySourceReleaseBoundaryMigration,
    /CREATE OR REPLACE FUNCTION public\.valo_assert_delivery_project_mutable\(\s*source_project_id uuid,\s*allow_terminal_delete boolean DEFAULT false\s*\)/u,
  );
  assert.match(
    deliverySourceReleaseBoundaryMigration,
    /CREATE TRIGGER delivery_project_delete_guard\s+BEFORE DELETE ON public\.projects\s+FOR EACH ROW EXECUTE FUNCTION public\.valo_guard_delivery_project_delete\(\);/u,
  );
  assert.match(
    deliverySourceReleaseBoundaryMigration,
    /REVOKE DELETE ON TABLE public\.clients, public\.projects[\s\S]*FROM valo_app_runtime/u,
  );
});

test("pins production-assurance retention, limiter and RLS controls", () => {
  assert.match(
    productionAssuranceMigration,
    /CREATE TABLE "authenticated_rate_limit_buckets"/u,
  );
  assert.match(
    productionAssuranceMigration,
    /ALTER TABLE "authenticated_rate_limit_buckets" FORCE ROW LEVEL SECURITY/u,
  );
  assert.match(
    productionAssuranceMigration,
    /CREATE POLICY "tenant_isolation"[\s\S]*valo_security\.current_organisation_id/u,
  );
  assert.match(
    productionAssuranceMigration,
    /purge_expired_authenticated_rate_limit_buckets[\s\S]*LIMIT 1000[\s\S]*FOR UPDATE SKIP LOCKED/u,
  );
  assert.match(
    productionAssuranceMigration,
    /REVOKE ALL ON FUNCTION[\s\S]*purge_expired_authenticated_rate_limit_buckets/u,
  );
  assert.match(productionAssuranceMigration, /"concluded_at"/u);
  assert.match(productionAssuranceMigration, /"storage_terminal_at"/u);
  assert.match(
    productionAssuranceMigration,
    /"retention_scan_cycle_incomplete" boolean NOT NULL DEFAULT false/u,
  );
  assert.match(
    productionAssuranceMigration,
    /"storage_lifecycle_cycle_incomplete" boolean NOT NULL DEFAULT false/u,
  );
  assert.doesNotMatch(
    productionAssuranceMigration,
    /DROP\s+(?:TABLE|COLUMN)/iu,
  );
});

test("backfills populated legacy storage attempt cycles without losing unresolved locators", () => {
  assert.match(
    productionAssuranceMigration,
    /ALTER TABLE "notification_events" NO FORCE ROW LEVEL SECURITY[\s\S]*ALTER TABLE "notification_attempts" NO FORCE ROW LEVEL SECURITY[\s\S]*LEFT JOIN "notification_attempts" AS "attempt"[\s\S]*ALTER TABLE "notification_attempts" FORCE ROW LEVEL SECURITY[\s\S]*ALTER TABLE "notification_events" FORCE ROW LEVEL SECURITY/u,
  );
  assert.match(
    productionAssuranceMigration,
    /count\("attempt"\."id"\)::integer AS "attempt_count"[\s\S]*LEFT JOIN "notification_attempts" AS "attempt"/u,
  );
  assert.match(
    productionAssuranceMigration,
    /WHEN "event"\."status" = 'dead_letter' THEN 5[\s\S]*ELSE least\(5, "counts"\."attempt_count"\)/u,
  );
  assert.match(
    productionAssuranceMigration,
    /"event"\."status" IN \([\s\S]*'retry_wait', 'completed', 'cancelled', 'dead_letter'[\s\S]*\)/u,
  );
  const terminalIndex = productionAssuranceMigration.match(
    /CREATE INDEX "notification_events_storage_terminal_retention_idx"[\s\S]*?;\s*--> statement-breakpoint/u,
  )?.[0];
  assert.ok(terminalIndex, "missing storage terminal retention index");
  assert.match(terminalIndex, /"status" IN \('completed', 'cancelled'\)/u);
  assert.doesNotMatch(terminalIndex, /dead_letter|resolved/u);
});

test("adds a durable cursor and bounded partial indexes for storage lifecycle scans", () => {
  assert.match(
    storageLifecycleMigration,
    /ALTER TABLE "app_config"[\s\S]*ADD COLUMN "storage_lifecycle_cursor_organisation_id" uuid[\s\S]*ADD COLUMN "storage_lifecycle_lease_owner" text[\s\S]*ADD COLUMN "storage_lifecycle_lease_expires_at" timestamp with time zone/u,
  );
  assert.match(
    storageLifecycleMigration,
    /ALTER TABLE "notification_events"[\s\S]*ADD COLUMN "available_at" timestamp with time zone NOT NULL DEFAULT now\(\)[\s\S]*notification_events_storage_reconcile_idx[\s\S]*organisation_id[\s\S]*available_at[\s\S]*created_at[\s\S]*WHERE "channel" = 'internal_storage'[\s\S]*"status" IN \('queued', 'retry_wait'\)/u,
  );
  assert.match(
    storageLifecycleMigration,
    /upload_sessions_cleanup_project_expiry_idx[\s\S]*organisation_id[\s\S]*project_id[\s\S]*expires_at[\s\S]*WHERE "status" IN \('open', 'completed', 'rejected', 'quarantined', 'cleanup_unconfirmed'\)/u,
  );
  assert.match(
    storageLifecycleMigration,
    /upload_sessions_cleanup_expiry_idx[\s\S]*organisation_id[\s\S]*expires_at[\s\S]*WHERE "status" IN \('open', 'completed', 'rejected', 'quarantined', 'cleanup_unconfirmed'\)/u,
  );
  for (const indexName of [
    "documents_org_object_path_idx",
    "document_versions_org_object_path_idx",
    "vault_items_org_object_path_idx",
    "reports_org_docx_path_idx",
    "reports_org_pdf_path_idx",
    "package_versions_org_docx_path_idx",
    "package_versions_org_pdf_path_idx",
    "package_versions_org_zip_path_idx",
  ]) {
    assert.match(storageLifecycleMigration, new RegExp(indexName, "u"));
  }
  assert.doesNotMatch(storageLifecycleMigration, /DROP|DELETE|UPDATE/iu);
});

test("keeps the bounded work queue active-only and contact-data free", () => {
  const listFunction = leadOperationsMigration.match(
    /CREATE FUNCTION "valo_intake"\."list_bid_autopsy_work_queue"[\s\S]*?\$function\$;/,
  )?.[0];
  assert.ok(listFunction, "missing lead operations queue function");
  assert.match(listFunction, /stored\.delivery_status <> 'closed'/);
  assert.doesNotMatch(
    listFunction,
    /stored\.(?:contact_name|business_email|business_telephone)/,
  );
  assert.doesNotMatch(listFunction, /preferred_contact_method/);
});

test("limits contact handoff to one retained active lead and preferred channel", () => {
  const handoffFunction = leadOperationsMigration.match(
    /CREATE FUNCTION "valo_intake"\."get_bid_autopsy_contact_handoff"[\s\S]*?\$function\$;/,
  )?.[0];
  assert.ok(handoffFunction, "missing single-record contact handoff function");
  assert.match(handoffFunction, /stored\.id = p_request_id/u);
  assert.match(handoffFunction, /stored\.delivery_status <> 'closed'/u);
  assert.match(
    handoffFunction,
    /stored\.retention_until > pg_catalog\.statement_timestamp\(\)/u,
  );
  assert.match(
    handoffFunction,
    /CASE stored\.preferred_contact_method[\s\S]*?WHEN 'email'[\s\S]*?WHEN 'telephone'/u,
  );
  assert.doesNotMatch(handoffFunction, /\bLIMIT\s+[2-9]/iu);
});

test("requires the exact structural and security intake catalog", () => {
  const expectedTables = {
    format: "valo.intake-table-catalog.v1",
    relations: Array.from({ length: 2 }, (_, index) => [
      `relation_${index}`,
      "r",
    ]),
    columns: Array.from({ length: 20 }, (_, index) => [
      "bid_autopsy_requests",
      index + 1,
      `column_${index}`,
      "text",
      true,
      null,
    ]),
    constraints: Array.from({ length: 18 }, (_, index) => [
      "bid_autopsy_requests",
      `constraint_${index}`,
      "c",
    ]),
    indexes: Array.from({ length: 5 }, (_, index) => [
      "bid_autopsy_requests",
      `index_${index}`,
      "btree",
      index === 0,
    ]),
    triggers: [],
    rules: [],
    inheritance: [],
    policies: [],
  };
  const validCatalog = () => ({
    tables: structuredClone(expectedTables),
    referenceTables: structuredClone(expectedTables),
    security: structuredClone(EXPECTED_REPLIT_INTAKE_SECURITY),
  });
  assert.doesNotThrow(() => validateReplitIntakeCatalog(validCatalog()));
  assert.throws(
    () =>
      validateReplitIntakeCatalog({
        security: structuredClone(EXPECTED_REPLIT_INTAKE_SECURITY),
      }),
    /catalog is incomplete or drifted/,
  );

  const columnDefaultDrift = validCatalog();
  columnDefaultDrift.tables.columns[0][5] = "gen_random_uuid()";
  assert.throws(
    () => validateReplitIntakeCatalog(columnDefaultDrift),
    /catalog is incomplete or drifted/,
  );

  const constraintDrift = validCatalog();
  constraintDrift.tables.constraints[0][2] = "p";
  assert.throws(
    () => validateReplitIntakeCatalog(constraintDrift),
    /catalog is incomplete or drifted/,
  );

  const droppedUniqueIndex = validCatalog();
  droppedUniqueIndex.tables.indexes = [];
  assert.throws(
    () => validateReplitIntakeCatalog(droppedUniqueIndex),
    /catalog is incomplete or drifted/,
  );

  const indexUniquenessDrift = validCatalog();
  indexUniquenessDrift.tables.indexes[0][3] = false;
  assert.throws(
    () => validateReplitIntakeCatalog(indexUniquenessDrift),
    /catalog is incomplete or drifted/,
  );

  const rewriteRuleDrift = validCatalog();
  rewriteRuleDrift.tables.rules.push([
    "bid_autopsy_requests",
    "exfiltrate_insert",
    "2",
  ]);
  assert.throws(
    () => validateReplitIntakeCatalog(rewriteRuleDrift),
    /catalog is incomplete or drifted/,
  );

  const inheritanceDrift = validCatalog();
  inheritanceDrift.tables.inheritance.push([
    "valo_intake",
    "bid_autopsy_requests",
    "public",
    "public_readable_parent",
    1,
  ]);
  assert.throws(
    () => validateReplitIntakeCatalog(inheritanceDrift),
    /catalog is incomplete or drifted/,
  );

  const ownerDrift = validCatalog();
  ownerDrift.security.schema[0] = false;
  assert.throws(
    () => validateReplitIntakeCatalog(ownerDrift),
    /catalog is incomplete or drifted/,
  );

  const aclDrift = validCatalog();
  aclDrift.security.columnGrants.push([
    "bid_autopsy_requests",
    "business_email",
    "$OWNER",
    "unexpected_role",
    "SELECT",
    false,
  ]);
  assert.throws(
    () => validateReplitIntakeCatalog(aclDrift),
    /catalog is incomplete or drifted/,
  );

  const functionBodyDrift = validCatalog();
  functionBodyDrift.security.functions[0][19] = "0".repeat(64);
  assert.throws(
    () => validateReplitIntakeCatalog(functionBodyDrift),
    /catalog is incomplete or drifted/,
  );

  const functionSecurityDrift = validCatalog();
  functionSecurityDrift.security.functions[0][9] = false;
  assert.throws(
    () => validateReplitIntakeCatalog(functionSecurityDrift),
    /catalog is incomplete or drifted/,
  );

  const functionDefaultDrift = validCatalog();
  functionDefaultDrift.security.functions[0][17] = 1;
  assert.throws(
    () => validateReplitIntakeCatalog(functionDefaultDrift),
    /catalog is incomplete or drifted/,
  );

  const functionVariadicDrift = validCatalog();
  functionVariadicDrift.security.functions[0][18] = false;
  assert.throws(
    () => validateReplitIntakeCatalog(functionVariadicDrift),
    /catalog is incomplete or drifted/,
  );
});

test("restricts execution to Replit production with separated same-target roles", () => {
  const environment = {
    NODE_ENV: "production",
    REPLIT_DEPLOYMENT: "1",
    DATABASE_URL:
      "postgresql://owner:owner-secret@db.example.test/bidbox?sslmode=require",
    VALO_RUNTIME_DATABASE_URL:
      "postgresql://valo_app_runtime:runtime-secret@db.example.test/bidbox?sslmode=require",
  };
  assert.equal(
    validateReplitMigrationEnvironment(environment),
    environment.DATABASE_URL,
  );
  assert.throws(
    () =>
      validateReplitMigrationEnvironment({
        ...environment,
        REPLIT_DEPLOYMENT: "0",
      }),
    /restricted to Replit production/,
  );
  assert.throws(
    () =>
      validateReplitMigrationEnvironment({
        ...environment,
        NODE_ENV: "development",
      }),
    /restricted to Replit production/,
  );
  assert.throws(
    () =>
      validateReplitMigrationEnvironment({
        ...environment,
        VALO_RUNTIME_DATABASE_URL: environment.DATABASE_URL,
      }),
    /identity and credential must differ/,
  );
  assert.throws(
    () =>
      validateReplitMigrationEnvironment({
        ...environment,
        DATABASE_URL:
          "postgresql://%76alo_app_runtime:another-owner-secret@db.example.test/bidbox?sslmode=require",
      }),
    /identity and credential must differ/,
  );
  assert.throws(
    () =>
      validateReplitMigrationEnvironment({
        ...environment,
        DATABASE_URL:
          "postgresql://owner:owner%2Dsecret@db.example.test/bidbox?sslmode=require",
        VALO_RUNTIME_DATABASE_URL:
          "postgresql://owner:owner-secret@db.example.test/bidbox?sslmode=require",
      }),
    /identity and credential must differ/,
  );
  assert.throws(
    () =>
      validateReplitMigrationEnvironment({
        ...environment,
        DATABASE_URL:
          "postgresql://valo_app_runtime:another-owner-secret@db.example.test/bidbox?sslmode=require",
      }),
    /identity and credential must differ/,
  );
  assert.throws(
    () =>
      validateReplitMigrationEnvironment({
        ...environment,
        VALO_RUNTIME_DATABASE_URL:
          "postgresql://other_runtime:runtime-secret@db.example.test/bidbox?sslmode=require",
      }),
    /fixed runtime role/,
  );
  assert.throws(
    () =>
      validateReplitMigrationEnvironment({
        ...environment,
        DATABASE_URL:
          "postgresql://owner:runtime-secret@db.example.test/bidbox?sslmode=require",
      }),
    /identity and credential must differ/,
  );
  assert.throws(
    () =>
      validateReplitMigrationEnvironment({
        ...environment,
        VALO_RUNTIME_DATABASE_URL:
          "postgresql://valo_app_runtime:runtime-secret@other.example.test/bidbox?sslmode=require",
      }),
    /must target the same database/,
  );
  assert.throws(
    () =>
      validateReplitMigrationEnvironment({
        ...environment,
        DATABASE_URL:
          "postgresql://db.example.test/bidbox?sslmode=require&password=owner-secret",
      }),
    /credentials only in URL userinfo/,
  );
});

test("source migration journal and SQL hashes remain frozen", async () => {
  await assert.doesNotReject(validateLocalReplitMigrationManifest());
});

test("scopes public name resolution to migration execution", async () => {
  const operations = [];
  const client = {
    query: async (statement) => {
      operations.push(statement);
      return statement.includes("current_schema")
        ? {
            rows: [
              {
                configuredPath: "public, pg_temp",
                currentSchema: "public",
                lookupPath: ["pg_catalog", "public"],
              },
            ],
          }
        : { rows: [] };
    },
  };
  const outcome = await withReplitMigrationSearchPath(client, async () => {
    operations.push("migrate");
    return "applied";
  });
  assert.equal(outcome, "applied");
  assert.equal(operations[0], "SET search_path = public, pg_temp");
  assert.match(operations[1], /current_schema/u);
  assert.equal(operations[2], "migrate");
  assert.equal(operations[3], "SET search_path = pg_catalog");
});

test("restores the hardened catalog path when migration fails", async () => {
  const operations = [];
  const expected = new Error("synthetic migration failure");
  const client = {
    query: async (statement) => {
      operations.push(statement);
      return statement.includes("current_schema")
        ? {
            rows: [
              {
                configuredPath: "public, pg_temp",
                currentSchema: "public",
                lookupPath: ["pg_catalog", "public", "pg_temp_3"],
              },
            ],
          }
        : { rows: [] };
    },
  };
  await assert.rejects(
    () =>
      withReplitMigrationSearchPath(client, async () => {
        operations.push("migrate");
        throw expected;
      }),
    (error) => error === expected,
  );
  assert.equal(operations[0], "SET search_path = public, pg_temp");
  assert.match(operations[1], /current_schema/u);
  assert.equal(operations[2], "migrate");
  assert.equal(operations[3], "SET search_path = pg_catalog");
});

test("rejects a migration path that could create outside public", () => {
  assert.throws(
    () =>
      validateReplitMigrationSearchPath({
        configuredPath: "public, pg_temp",
        currentSchema: "pg_catalog",
        lookupPath: ["pg_catalog", "public"],
      }),
    /migration search path is not the approved catalog\/public boundary/u,
  );
  assert.throws(
    () =>
      validateReplitMigrationSearchPath({
        configuredPath: "public, pg_temp",
        currentSchema: "public",
        lookupPath: ["pg_catalog", "pg_temp_3", "public"],
      }),
    /migration search path is not the approved catalog\/public boundary/u,
  );
  assert.throws(
    () =>
      validateReplitMigrationSearchPath({
        configuredPath: '"$user", public',
        currentSchema: "public",
        lookupPath: ["pg_catalog", "public"],
      }),
    /migration search path is not the approved catalog\/public boundary/u,
  );
});

test("keeps catalog-only postchecks after the scoped migration path", () => {
  assert.match(
    replitMigrationRunner,
    /export async function withReplitMigrationSearchPath[\s\S]*SET search_path = public, pg_temp[\s\S]*current_setting\('search_path'\)[\s\S]*current_schema[\s\S]*current_schemas\(true\)[\s\S]*finally[\s\S]*SET search_path = pg_catalog/u,
  );
  assert.match(
    replitMigrationRunner,
    /await withReplitMigrationSearchPath\(lockClient,[\s\S]*migrate\(drizzle\(lockClient\)[\s\S]*\);\s*\}\s*const afterRows/u,
  );
});

test(
  "applies 0007-0013 and proves the complete delivery guard catalog",
  { timeout: 180_000 },
  async (context) => {
    const baseDatabaseUrl = process.env.DATABASE_URL?.trim();
    if (!baseDatabaseUrl) {
      context.skip("DATABASE_URL is absent");
      return;
    }

    const parsedBaseUrl = new URL(baseDatabaseUrl);
    assert.ok(
      ["postgres:", "postgresql:"].includes(parsedBaseUrl.protocol),
      "integration DATABASE_URL must use PostgreSQL",
    );
    assert.ok(
      parsedBaseUrl.username && parsedBaseUrl.password,
      "integration DATABASE_URL must include userinfo credentials",
    );
    assert.notEqual(
      decodeURIComponent(parsedBaseUrl.username),
      "valo_app_runtime",
      "integration DATABASE_URL must use an owner identity",
    );

    const databaseName = `bidbox_replit_intake_${randomBytes(10).toString("hex")}`;
    const runtimePassword = randomBytes(24).toString("hex");
    const quotedDatabaseName = `"${databaseName}"`;
    const ownerDatabaseUrl = new URL(parsedBaseUrl);
    ownerDatabaseUrl.pathname = `/${databaseName}`;
    const runtimeDatabaseUrl = new URL(ownerDatabaseUrl);
    runtimeDatabaseUrl.username = "valo_app_runtime";
    runtimeDatabaseUrl.password = runtimePassword;

    const adminPool = new Pool({
      connectionString: parsedBaseUrl.href,
      max: 1,
      connectionTimeoutMillis: 10_000,
    });
    let databaseCreated = false;
    let runtimeRoleCreated = false;
    let migrationPrefix;

    try {
      const role = await adminPool.query(
        "SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='valo_app_runtime'",
      );
      if (role.rowCount === 0) {
        await adminPool.query("CREATE ROLE valo_app_runtime NOLOGIN");
        runtimeRoleCreated = true;
      }

      await adminPool.query(`CREATE DATABASE ${quotedDatabaseName}`);
      databaseCreated = true;
      migrationPrefix = await createMigrationPrefix(7);

      const migrationPool = new Pool({
        connectionString: ownerDatabaseUrl.href,
        max: 1,
        connectionTimeoutMillis: 10_000,
      });
      try {
        await migrate(drizzle(migrationPool), {
          migrationsFolder: migrationPrefix,
        });
      } finally {
        await migrationPool.end();
      }

      const environment = {
        NODE_ENV: "production",
        REPLIT_DEPLOYMENT: "1",
        DATABASE_URL: ownerDatabaseUrl.href,
        VALO_RUNTIME_DATABASE_URL: runtimeDatabaseUrl.href,
      };
      assert.equal(
        await runReplitIntakeMigrations(environment),
        "0007-0013 applied",
      );
      assert.equal(
        await runReplitIntakeMigrations(environment),
        "already current",
      );

      const driftPool = new Pool({
        connectionString: ownerDatabaseUrl.href,
        max: 1,
        connectionTimeoutMillis: 10_000,
      });
      try {
        const actorLimitColumnAclDefaults = await driftPool.query(`
          SELECT count(*)::integer AS "columnCount",
            count(*) FILTER (WHERE actor_limit_column.attacl IS NULL)::integer
              AS "nullAclCount"
          FROM pg_catalog.pg_attribute AS actor_limit_column
          WHERE actor_limit_column.attrelid =
              'valo_security.authenticated_actor_rate_limit_buckets'::pg_catalog.regclass
            AND actor_limit_column.attnum > 0
            AND NOT actor_limit_column.attisdropped
        `);
        assert.deepEqual(actorLimitColumnAclDefaults.rows, [
          { columnCount: 4, nullAclCount: 4 },
        ]);

        const actorLimitColumnAcls = await driftPool.query(`
          SELECT count(*)::integer AS "publicPrivilegeCount"
          FROM pg_catalog.pg_attribute AS actor_limit_column
          CROSS JOIN LATERAL pg_catalog.aclexplode(
            actor_limit_column.attacl
          ) AS actor_limit_acl
          WHERE actor_limit_column.attrelid =
              'valo_security.authenticated_actor_rate_limit_buckets'::pg_catalog.regclass
            AND actor_limit_column.attnum > 0
            AND NOT actor_limit_column.attisdropped
            AND actor_limit_acl.grantee = 0
            AND actor_limit_acl.privilege_type IN (
              'SELECT','INSERT','UPDATE','REFERENCES'
            )
        `);
        assert.deepEqual(actorLimitColumnAcls.rows, [
          { publicPrivilegeCount: 0 },
        ]);

        const actorLimitFunctionShapes = await driftPool.query(`
          SELECT routine.proname AS "functionName",
            routine.proretset AS "returnsSet"
          FROM pg_catalog.pg_proc AS routine
          JOIN pg_catalog.pg_namespace AS namespace
            ON namespace.oid = routine.pronamespace
          WHERE namespace.nspname = 'valo_security'
            AND routine.proname IN (
              'consume_authenticated_actor_rate_limit',
              'purge_expired_authenticated_rate_limit_buckets'
            )
          ORDER BY routine.proname
        `);
        assert.deepEqual(actorLimitFunctionShapes.rows, [
          {
            functionName: "consume_authenticated_actor_rate_limit",
            returnsSet: true,
          },
          {
            functionName: "purge_expired_authenticated_rate_limit_buckets",
            returnsSet: false,
          },
        ]);

        const transitionCatalog = await driftPool.query(`
          SELECT pg_catalog.format_type(routine.prorettype, NULL) AS return_type,
            pg_catalog.pg_get_function_result(routine.oid) AS function_result,
            routine.proretset AS returns_set
          FROM pg_catalog.pg_proc AS routine
          JOIN pg_catalog.pg_namespace AS namespace
            ON namespace.oid = routine.pronamespace
          WHERE namespace.nspname = 'valo_intake'
            AND routine.proname = 'transition_bid_autopsy_work_queue'
            AND pg_catalog.oidvectortypes(routine.proargtypes) = 'uuid, text, text'
        `);
        // A one-OUT-column RETURNS TABLE routine exposes the scalar OUT type
        // through prorettype while pg_get_function_result retains TABLE(...).
        assert.deepEqual(transitionCatalog.rows, [
          {
            return_type: "uuid",
            function_result: "TABLE(request_id uuid)",
            returns_set: true,
          },
        ]);

        const deliveryGuardTriggers = await driftPool.query(`
          SELECT relation.relname::text AS "tableName",
            guard.tgname::text AS "triggerName",
            guard.tgenabled::text AS "triggerEnabled",
            guard.tgtype::integer AS "triggerType",
            COALESCE((
              SELECT pg_catalog.string_agg(
                attribute.attname,',' ORDER BY selected.ordinality
              )
              FROM pg_catalog.unnest(guard.tgattr::smallint[])
                WITH ORDINALITY AS selected(attnum,ordinality)
              JOIN pg_catalog.pg_attribute AS attribute
                ON attribute.attrelid=guard.tgrelid
               AND attribute.attnum=selected.attnum
            ),'') AS "updateColumns",
            pg_catalog.encode(guard.tgargs,'hex') AS "triggerArgsHex",
            pg_catalog.pg_get_expr(guard.tgqual,guard.tgrelid,false)
              AS "whenClause",
            guard.tgisinternal AS "isInternal",
            function_namespace.nspname::text AS "functionSchema",
            guard_function.proname::text AS "functionName",
            guard.tgfoid=(CASE
              WHEN guard.tgname='delivery_project_delete_guard'
                THEN pg_catalog.to_regprocedure(
                  'public.valo_guard_delivery_project_delete()'
                )
              ELSE pg_catalog.to_regprocedure(
                'public.valo_guard_delivery_source_mutation()'
              )
            END) AS "functionOidMatches"
          FROM pg_catalog.pg_trigger AS guard
          JOIN pg_catalog.pg_class AS relation ON relation.oid=guard.tgrelid
          JOIN pg_catalog.pg_namespace AS relation_namespace
            ON relation_namespace.oid=relation.relnamespace
          JOIN pg_catalog.pg_proc AS guard_function
            ON guard_function.oid=guard.tgfoid
          JOIN pg_catalog.pg_namespace AS function_namespace
            ON function_namespace.oid=guard_function.pronamespace
          WHERE relation_namespace.nspname='public'
            AND guard.tgname IN (
              'delivery_project_delete_guard',
              'delivery_source_project_guard'
            )
          ORDER BY "tableName","triggerName"
        `);
        const sourceGuardTables = [
          "boq_checks",
          "claim_evidence_links",
          "defects",
          "document_version_snapshots",
          "document_versions",
          "documents",
          "draft_claims",
          "draft_versions",
          "drafts",
          "evidence_items",
          "red_team_findings",
          "red_team_runs",
          "requirements",
          "reviews",
        ];
        assert.deepEqual(
          [...deliveryGuardTriggers.rows].sort((left, right) =>
            `${left.tableName}.${left.triggerName}`.localeCompare(
              `${right.tableName}.${right.triggerName}`,
            ),
          ),
          [
            ...sourceGuardTables.map((tableName) => ({
              tableName,
              triggerName: "delivery_source_project_guard",
              triggerEnabled: "O",
              triggerType: 31,
              updateColumns: "",
              triggerArgsHex: "",
              whenClause: null,
              isInternal: false,
              functionSchema: "public",
              functionName: "valo_guard_delivery_source_mutation",
              functionOidMatches: true,
            })),
            {
              tableName: "projects",
              triggerName: "delivery_project_delete_guard",
              triggerEnabled: "O",
              triggerType: 11,
              updateColumns: "",
              triggerArgsHex: "",
              whenClause: null,
              isInternal: false,
              functionSchema: "public",
              functionName: "valo_guard_delivery_project_delete",
              functionOidMatches: true,
            },
          ].sort((left, right) =>
            `${left.tableName}.${left.triggerName}`.localeCompare(
              `${right.tableName}.${right.triggerName}`,
            ),
          ),
        );

        const deliveryGuardFunctions = await driftPool.query(`
          SELECT routine.proname::text AS "functionName",
            language.lanname::text AS "languageName",
            routine.prokind::text AS "functionKind",
            routine.prosecdef AS "securityDefiner",
            routine.proleakproof AS leakproof,
            routine.proisstrict AS strict,
            routine.provolatile::text AS volatility,
            routine.proparallel::text AS "parallelSafety",
            COALESCE(pg_catalog.array_to_string(routine.proconfig,','),'')
              AS "functionConfig",
            routine.prorettype='pg_catalog.trigger'::pg_catalog.regtype
              AS "returnsTrigger",
            routine.pronargs::integer AS "argumentCount",
            COALESCE((
              SELECT pg_catalog.string_agg(
                pg_catalog.format_type(argument_type.type_oid,NULL),
                ',' ORDER BY argument_type.ordinality
              )
              FROM pg_catalog.unnest(routine.proargtypes::oid[])
                WITH ORDINALITY AS argument_type(type_oid,ordinality)
            ), '') AS "argumentTypes",
            pg_catalog.pg_get_function_identity_arguments(routine.oid)
              AS "identityArguments",
            pg_catalog.pg_get_function_arguments(routine.oid)
              AS "functionArguments",
            routine.pronargdefaults::integer AS "argumentDefaultCount",
            pg_catalog.format_type(routine.prorettype,NULL) AS "returnType",
            pg_catalog.pg_get_function_result(routine.oid) AS "functionResult",
            routine.proretset AS "returnsSet",
            pg_catalog.pg_get_userbyid(routine.proowner) AS "ownerName",
            routine.proowner=(
              SELECT database_record.datdba
              FROM pg_catalog.pg_database AS database_record
              WHERE database_record.datname=pg_catalog.current_database()
            ) AS "ownerIsDatabaseOwner",
            routine.proowner=(
              SELECT retention_purge.proowner
              FROM pg_catalog.pg_proc AS retention_purge
              WHERE retention_purge.oid=pg_catalog.to_regprocedure(
                'valo_security.purge_retention_project(uuid,uuid,uuid,uuid,text,integer)'
              )
                AND retention_purge.prosecdef
            ) AS "ownerIsSecurityOwner",
            pg_catalog.has_function_privilege(
              runtime_role.oid,routine.oid,'EXECUTE'
            ) AS "runtimeCanExecute",
            EXISTS (
              SELECT 1
              FROM pg_catalog.aclexplode(COALESCE(
                routine.proacl,
                pg_catalog.acldefault('f',routine.proowner)
              )) AS function_acl
              WHERE function_acl.grantee=0
                AND function_acl.privilege_type='EXECUTE'
            ) AS "publicCanExecute",
            ARRAY(
              SELECT pg_catalog.format(
                '%s>%s:%s:%s',
                CASE WHEN function_acl.grantor=routine.proowner THEN '$OWNER'
                  ELSE '$ROLE:' ||
                    pg_catalog.pg_get_userbyid(function_acl.grantor)
                END,
                CASE WHEN function_acl.grantee=0 THEN '$PUBLIC'
                  WHEN function_acl.grantee=routine.proowner THEN '$OWNER'
                  ELSE '$ROLE:' ||
                    pg_catalog.pg_get_userbyid(function_acl.grantee)
                END,
                function_acl.privilege_type,
                function_acl.is_grantable
              )
              FROM pg_catalog.aclexplode(COALESCE(
                routine.proacl,
                pg_catalog.acldefault('f',routine.proowner)
              )) AS function_acl
              ORDER BY function_acl.grantor,function_acl.grantee,
                function_acl.privilege_type,function_acl.is_grantable
            ) AS "executeAcl",
            routine.prosrc AS "functionSource"
          FROM pg_catalog.pg_proc AS routine
          JOIN pg_catalog.pg_namespace AS namespace
            ON namespace.oid=routine.pronamespace
          JOIN pg_catalog.pg_language AS language
            ON language.oid=routine.prolang
          CROSS JOIN (
            SELECT role.oid
            FROM pg_catalog.pg_roles AS role
            WHERE role.rolname='valo_app_runtime'
          ) AS runtime_role
          WHERE namespace.nspname='public'
            AND routine.proname IN (
              'valo_assert_delivery_project_mutable',
              'valo_delivery_source_project_id',
              'valo_guard_delivery_project_delete',
              'valo_guard_delivery_source_mutation'
            )
          ORDER BY "functionName"
        `);
        const ownerOnlyAcl = ["$OWNER>$OWNER:EXECUTE:f"];
        const helperAcl = [
          ...ownerOnlyAcl,
          "$OWNER>$ROLE:valo_app_runtime:EXECUTE:f",
        ];
        const ownerName = decodeURIComponent(ownerDatabaseUrl.username);
        assert.deepEqual(
          deliveryGuardFunctions.rows.map(
            ({ functionSource, executeAcl, ...row }) => ({
              ...row,
              executeAcl: [...executeAcl].sort(),
              sourceSha256: createHash("sha256")
                .update(functionSource.replaceAll("\r\n", "\n").trim())
                .digest("hex"),
            }),
          ),
          [
            {
              functionName: "valo_assert_delivery_project_mutable",
              languageName: "plpgsql",
              functionKind: "f",
              securityDefiner: false,
              leakproof: false,
              strict: false,
              volatility: "v",
              parallelSafety: "u",
              functionConfig: "search_path=pg_catalog, public",
              returnsTrigger: false,
              argumentCount: 2,
              argumentTypes: "uuid,boolean",
              identityArguments:
                "source_project_id uuid, allow_terminal_delete boolean",
              functionArguments:
                "source_project_id uuid, allow_terminal_delete boolean DEFAULT false",
              argumentDefaultCount: 1,
              returnType: "void",
              functionResult: "void",
              returnsSet: false,
              ownerName,
              ownerIsDatabaseOwner: true,
              ownerIsSecurityOwner: true,
              runtimeCanExecute: true,
              publicCanExecute: false,
              executeAcl: helperAcl,
              sourceSha256:
                "801194e9255d427a046c45b2fb19f8c2e614c2741f17bb916260aab21d845a03",
            },
            {
              functionName: "valo_delivery_source_project_id",
              languageName: "plpgsql",
              functionKind: "f",
              securityDefiner: false,
              leakproof: false,
              strict: false,
              volatility: "s",
              parallelSafety: "u",
              functionConfig: "search_path=pg_catalog, public",
              returnsTrigger: false,
              argumentCount: 2,
              argumentTypes: "name,jsonb",
              identityArguments: "source_table name, source_row jsonb",
              functionArguments: "source_table name, source_row jsonb",
              argumentDefaultCount: 0,
              returnType: "uuid",
              functionResult: "uuid",
              returnsSet: false,
              ownerName,
              ownerIsDatabaseOwner: true,
              ownerIsSecurityOwner: true,
              runtimeCanExecute: true,
              publicCanExecute: false,
              executeAcl: helperAcl,
              sourceSha256:
                "55426212117c41dadee7bdcd167e42540b14232fe1082b31078d8ea12899e718",
            },
            {
              functionName: "valo_guard_delivery_project_delete",
              languageName: "plpgsql",
              functionKind: "f",
              securityDefiner: false,
              leakproof: false,
              strict: false,
              volatility: "v",
              parallelSafety: "u",
              functionConfig: "search_path=pg_catalog, public",
              returnsTrigger: true,
              argumentCount: 0,
              argumentTypes: "",
              identityArguments: "",
              functionArguments: "",
              argumentDefaultCount: 0,
              returnType: "trigger",
              functionResult: "trigger",
              returnsSet: false,
              ownerName,
              ownerIsDatabaseOwner: true,
              ownerIsSecurityOwner: true,
              runtimeCanExecute: false,
              publicCanExecute: false,
              executeAcl: ownerOnlyAcl,
              sourceSha256:
                "a8767b19436393b9ce44077499a16f6899b4400d3b69757dd997b12c49a24b79",
            },
            {
              functionName: "valo_guard_delivery_source_mutation",
              languageName: "plpgsql",
              functionKind: "f",
              securityDefiner: false,
              leakproof: false,
              strict: false,
              volatility: "v",
              parallelSafety: "u",
              functionConfig: "search_path=pg_catalog, public",
              returnsTrigger: true,
              argumentCount: 0,
              argumentTypes: "",
              identityArguments: "",
              functionArguments: "",
              argumentDefaultCount: 0,
              returnType: "trigger",
              functionResult: "trigger",
              returnsSet: false,
              ownerName,
              ownerIsDatabaseOwner: true,
              ownerIsSecurityOwner: true,
              runtimeCanExecute: false,
              publicCanExecute: false,
              executeAcl: ownerOnlyAcl,
              sourceSha256:
                "ac6770b6382e6f74a793d8901dde97f6a0a7212e75b600ade35ab3a61415d6eb",
            },
          ],
        );

        await driftPool.query(
          "DROP INDEX valo_intake.bid_autopsy_requests_idempotency_unique",
        );
      } finally {
        await driftPool.end();
      }
      await assert.rejects(
        () => runReplitIntakeMigrations(environment),
        /object catalog is incomplete or drifted/,
      );
    } finally {
      try {
        if (migrationPrefix) {
          await rm(migrationPrefix, { recursive: true, force: true });
        }
        if (databaseCreated) {
          await adminPool.query(
            `DROP DATABASE IF EXISTS ${quotedDatabaseName} WITH (FORCE)`,
          );
        }
      } finally {
        try {
          if (runtimeRoleCreated) {
            await adminPool.query("DROP ROLE IF EXISTS valo_app_runtime");
          }
        } finally {
          await adminPool.end();
        }
      }
    }
  },
);
