#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import {
  ASSESSMENT_ID,
  BOUNDARY_ID,
  EXPECTED_POLICY_CATALOG_SHA256,
  EXPECTED_RLS_TABLE_CATALOG_SHA256,
  LEGACY_COLUMN_FINGERPRINT_ALGORITHM,
  LEGACY_LINEAGE_CANONICAL,
  LEGACY_LINEAGE_PRODUCTION_PUSH_MANAGED,
  ORGANISATION_ID,
  SOURCE_COMMIT,
  SOURCE_DIGEST_ALGORITHM,
  auditHash,
  legacyColumnFingerprint,
  legacyColumnsForLineage,
  sha256,
} from "./run-legacy-bridge.mjs";

const { Client } = pg;
const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(here, "../../..");
const migrationPaths = [
  resolve(repositoryRoot, "lib/db/migrations/0000_tense_vapor.sql"),
  resolve(repositoryRoot, "lib/db/migrations/0001_tenant_rls.sql"),
  resolve(
    repositoryRoot,
    "lib/db/migrations/0002_audit_integrity_boundary.sql",
  ),
  resolve(repositoryRoot, "lib/db/migrations/0003_zippy_skrulls.sql"),
  resolve(repositoryRoot, "lib/db/migrations/0004_dizzy_virginia_dare.sql"),
  resolve(repositoryRoot, "lib/db/migrations/0005_tranquil_jack_power.sql"),
  resolve(repositoryRoot, "lib/db/migrations/0006_lead_operations_queue.sql"),
  resolve(
    repositoryRoot,
    "lib/db/migrations/0007_storage_lifecycle_indexes.sql",
  ),
  resolve(repositoryRoot, "lib/db/migrations/0008_production_assurance.sql"),
  resolve(repositoryRoot, "lib/db/migrations/0009_ai_retrieval_registry.sql"),
  resolve(
    repositoryRoot,
    "lib/db/migrations/0010_tender_context_and_addendum.sql",
  ),
  resolve(repositoryRoot, "lib/db/migrations/0011_retention_completion.sql"),
  resolve(
    repositoryRoot,
    "lib/db/migrations/0012_delivery_source_release_boundary.sql",
  ),
  resolve(
    repositoryRoot,
    "lib/db/migrations/0013_delivery_guard_least_privilege.sql",
  ),
];
const bridgeSqlPath = resolve(
  repositoryRoot,
  "scripts/migrations/replit-legacy-v1-to-v2.5.sql",
);
const bridgeRunnerPath = resolve(here, "run-legacy-bridge.mjs");
const drizzleBinPath = resolve(here, "../node_modules/drizzle-kit/bin.cjs");
const dbPackagePath = resolve(here, "..");
const DELIVERY_SOURCE_RELEASE_BOUNDARY_TABLES = Object.freeze([
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
]);

const EXPECTED_FORCE_RLS_TABLE_NAMES_SHA256 =
  "65fe2a1cdbca0878f9aaca6c61c362df25b477a289dac8488901c9659b29395d";
const TENDER_CONTEXT_TABLES = [
  "addendum_impact_assessments",
  "addendum_impact_items",
  "document_version_snapshots",
  "tender_context_artifacts",
  "tender_context_requirements",
  "tender_context_versions",
  "tender_eligibility_passports",
];
const RETENTION_COMPLETION_TABLES = ["retention_action_storage_events"];
const PLATFORM_ADMIN_ID = "synthetic-ci-platform-admin";
const CI_LINEAGE_ENV = "VALO_BRIDGE_CI_LINEAGE";
const FIXED_TIME = "2026-01-15T12:00:00.000Z";
const HISTORICAL_DELETED_PROJECT_ID = "30000000-0000-4000-8000-000000000099";
const STORAGE_BACKFILL_FIXTURES = Object.freeze([
  {
    id: "56414c4f-0000-5000-8000-000000009101",
    status: "retry_wait",
    attempts: 2,
    expectedCycleAttempts: 2,
    terminal: false,
  },
  {
    id: "56414c4f-0000-5000-8000-000000009102",
    status: "completed",
    attempts: 7,
    expectedCycleAttempts: 5,
    terminal: true,
  },
  {
    id: "56414c4f-0000-5000-8000-000000009103",
    status: "cancelled",
    attempts: 1,
    expectedCycleAttempts: 1,
    terminal: true,
  },
  {
    id: "56414c4f-0000-5000-8000-000000009104",
    status: "dead_letter",
    attempts: 2,
    expectedCycleAttempts: 5,
    terminal: true,
  },
]);
const LEGACY_TABLES = [
  "app_config",
  "audit_events",
  "boq_checks",
  "capability_items",
  "clients",
  "conflict_records",
  "defects",
  "documents",
  "evidence_items",
  "llm_runs",
  "notification_events",
  "projects",
  "reports",
  "requirements",
  "retention_requests",
  "sbd_annotations",
  "sbd_templates",
  "users",
  "vault_items",
].sort();

const IDS = Object.freeze({
  admin: "10000000-0000-4000-8000-000000000001",
  tenantAdminA: "10000000-0000-4000-8000-000000000002",
  tenantAdminB: "10000000-0000-4000-8000-000000000003",
  client: "20000000-0000-4000-8000-000000000001",
  project: "30000000-0000-4000-8000-000000000001",
  document: "40000000-0000-4000-8000-000000000001",
  requirement: "50000000-0000-4000-8000-000000000001",
  evidence: "60000000-0000-4000-8000-000000000001",
  defect: "70000000-0000-4000-8000-000000000001",
  boq: "80000000-0000-4000-8000-000000000001",
  vault: "90000000-0000-4000-8000-000000000001",
  capability: "a0000000-0000-4000-8000-000000000001",
  conflict: "b0000000-0000-4000-8000-000000000001",
  notification: "c0000000-0000-4000-8000-000000000001",
  retention: "d0000000-0000-4000-8000-000000000001",
  template: "e0000000-0000-4000-8000-000000000001",
  annotation: "e0000000-0000-4000-8000-000000000002",
  report: "f0000000-0000-4000-8000-000000000001",
  llmRun: "f0000000-0000-4000-8000-000000000002",
  retentionAction: "d0000000-0000-4000-8000-000000000002",
  deletionCertificate: "d0000000-0000-4000-8000-000000000003",
});

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

function runtimeFixtureId(ordinal) {
  assert(Number.isSafeInteger(ordinal) && ordinal >= 1000 && ordinal < 10000);
  return `56414c4f-0000-5000-8000-${String(ordinal).padStart(12, "0")}`;
}

function databaseName(databaseUrl) {
  const name = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  assert(name, "DATABASE_URL must include a database name");
  return name;
}

function withDatabase(databaseUrl, name, credentials) {
  const result = new URL(databaseUrl);
  result.pathname = `/${encodeURIComponent(name)}`;
  if (credentials) {
    result.username = encodeURIComponent(credentials.username);
    result.password = encodeURIComponent(credentials.password);
  }
  return result.toString();
}

function postgresEnvironment(databaseUrl) {
  const url = new URL(databaseUrl);
  const sslmode = url.searchParams.get("sslmode");
  return {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: databaseName(databaseUrl),
    ...(sslmode ? { PGSSLMODE: sslmode } : {}),
  };
}

async function connectUtc(databaseUrl) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  await client.query("SET TIME ZONE 'UTC'");
  return client;
}

async function passwordAuthenticationRejected(databaseUrl) {
  const client = new Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    return false;
  } catch (error) {
    assert.equal(
      error?.code,
      "28P01",
      "password-authentication probes may fail only with invalid_password",
    );
    return true;
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function runCommand(command, args, options = {}) {
  const result = await new Promise((resolveResult, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code, signal) =>
      resolveResult({ code, signal, stdout, stderr }),
    );
  });
  if (!options.allowFailure && result.code !== 0) {
    const diagnostic = `${result.stderr}\n${result.stdout}`.trim().slice(-4000);
    throw new Error(
      `${basename(command)} exited ${result.code ?? result.signal}: ${diagnostic}`,
    );
  }
  return result;
}

function extractLegacyShape(bridgeSql) {
  const start = bridgeSql.indexOf(
    "INSERT INTO _valo_expected_legacy_columns VALUES",
  );
  const end = bridgeSql.indexOf("DO $preflight$", start);
  assert(start >= 0 && end > start, "legacy column fingerprint is absent");
  const result = new Map();
  for (const match of bridgeSql
    .slice(start, end)
    .matchAll(/\('([^']+)',\s*ARRAY\[([^\]]+)\]\)/g)) {
    result.set(
      match[1],
      [...match[2].matchAll(/'([^']+)'/g)].map((entry) => entry[1]),
    );
  }
  assert.deepEqual([...result.keys()].sort(), LEGACY_TABLES);
  return result;
}

function legacyDdl(migration0000, legacyShape) {
  const tableDefinitions = new Map();
  for (const match of migration0000.matchAll(
    /^CREATE TABLE "([^"]+)" \(\r?\n([\s\S]*?)\r?\n\);/gm,
  )) {
    tableDefinitions.set(match[1], match[2]);
  }
  const statements = [];
  for (const table of LEGACY_TABLES) {
    const body = tableDefinitions.get(table);
    assert(body, `0000 definition is absent for ${table}`);
    const definitions = new Map();
    for (const line of body.split(/\r?\n/)) {
      const column = line.match(/^\s*"([^"]+)"\s+/)?.[1];
      if (column) definitions.set(column, line.trim().replace(/,$/, ""));
    }
    const columns = legacyShape.get(table);
    const selected = columns.map((column) => {
      const definition = definitions.get(column);
      assert(
        definition,
        `0000 column definition is absent for ${table}.${column}`,
      );
      return `  ${definition}`;
    });
    const tableConstraints = body
      .split(/\r?\n/)
      .map((line) => line.trim().replace(/,$/, ""))
      .filter((line) => line.startsWith("CONSTRAINT "))
      .filter((line) => {
        const referencedColumns = [...line.matchAll(/"([^"]+)"/g)]
          .map((match) => match[1])
          .slice(1);
        return referencedColumns.every((column) => columns.includes(column));
      })
      .map((line) => `  ${line}`);
    statements.push(
      `CREATE TABLE public.${quoteIdentifier(table)} (\n${[
        ...selected,
        ...tableConstraints,
      ].join(",\n")}\n)`,
    );
  }

  const foreignKeys = [];
  for (const match of migration0000.matchAll(
    /^ALTER TABLE "([^"]+)" ADD CONSTRAINT "([^"]+)" FOREIGN KEY \(([^)]+)\) REFERENCES "public"\."([^"]+)"\(([^)]+)\) ([^;]+);--> statement-breakpoint$/gm,
  )) {
    const [, table, , localList, referencedTable, referencedList] = match;
    if (!legacyShape.has(table) || !legacyShape.has(referencedTable)) continue;
    const localColumns = [...localList.matchAll(/"([^"]+)"/g)].map(
      (entry) => entry[1],
    );
    const referencedColumns = [...referencedList.matchAll(/"([^"]+)"/g)].map(
      (entry) => entry[1],
    );
    if (
      localColumns.every((column) => legacyShape.get(table).includes(column)) &&
      referencedColumns.every((column) =>
        legacyShape.get(referencedTable).includes(column),
      )
    ) {
      foreignKeys.push(match[0].replace(";--> statement-breakpoint", ";"));
    }
  }

  const indexes = [];
  for (const match of migration0000.matchAll(
    /^CREATE (?:UNIQUE )?INDEX "[^"]+" ON "([^"]+)" [^;]+;--> statement-breakpoint$/gm,
  )) {
    const table = match[1];
    if (!legacyShape.has(table)) continue;
    const afterTable = match[0].slice(
      match[0].indexOf(`ON "${table}"`) + table.length + 5,
    );
    const referencedColumns = [...afterTable.matchAll(/"([^"]+)"/g)]
      .map((entry) => entry[1])
      .filter((identifier) => identifier !== table);
    if (
      referencedColumns.every((column) =>
        legacyShape.get(table).includes(column),
      )
    ) {
      indexes.push(match[0].replace(";--> statement-breakpoint", ";"));
    }
  }
  assert(
    foreignKeys.length >= 30,
    "legacy FK graph extraction is unexpectedly sparse",
  );
  assert(indexes.length >= 2, "legacy index extraction is unexpectedly sparse");
  return `${statements.join(";\n")};\n${foreignKeys.join("\n")}\n${indexes.join("\n")}`;
}

async function insertRow(client, table, row) {
  const columns = Object.keys(row);
  const parameters = columns.map((_, index) => `$${index + 1}`).join(", ");
  await client.query(
    `INSERT INTO public.${quoteIdentifier(table)} (${columns
      .map(quoteIdentifier)
      .join(", ")}) VALUES (${parameters})`,
    Object.values(row),
  );
}

function legacyFixtureRow(legacyShape, table, row) {
  const columns = legacyShape.get(table);
  assert(Array.isArray(columns), `legacy fixture shape is absent for ${table}`);
  return Object.fromEntries(
    Object.entries(row).filter(([column]) => columns.includes(column)),
  );
}

async function seedLegacyFixture(client, legacyShape) {
  await insertRow(client, "users", {
    id: IDS.admin,
    clerk_user_id: PLATFORM_ADMIN_ID,
    email: "platform-admin@synthetic.invalid",
    name: "Synthetic platform administrator",
    role: "admin",
    status: "active",
    last_login_at: FIXED_TIME,
    created_at: FIXED_TIME,
  });
  await insertRow(client, "users", {
    id: IDS.tenantAdminA,
    clerk_user_id: "synthetic-ci-tenant-admin-a",
    email: "tenant-admin-a@synthetic.invalid",
    name: "Synthetic tenant administrator A",
    role: "admin",
    status: "active",
    last_login_at: null,
    created_at: FIXED_TIME,
  });
  await insertRow(client, "users", {
    id: IDS.tenantAdminB,
    clerk_user_id: "synthetic-ci-tenant-admin-b",
    email: "tenant-admin-b@synthetic.invalid",
    name: "Synthetic tenant administrator B",
    role: "admin",
    status: "active",
    last_login_at: null,
    created_at: FIXED_TIME,
  });
  await insertRow(client, "clients", {
    id: IDS.client,
    name: "Synthetic Client Alpha",
    sector: "fixture-sector",
    segment: "enterprise",
    contact_name: null,
    contact_email: null,
    nda_status: "signed",
    notes: "Non-PII CI bridge fixture",
    decision_maker_conversations: 2,
    junior_conversations: 1,
    created_at: FIXED_TIME,
  });
  await insertRow(client, "projects", {
    id: IDS.project,
    client_id: IDS.client,
    tender_title: "Synthetic infrastructure tender",
    issuing_entity: "Synthetic Issuer",
    tender_ref: "CI-REF-001",
    lot: "LOT-CI",
    deadline: "2026-06-30",
    value_band: "fixture",
    segment: "enterprise",
    submission_status: "draft",
    status: "review",
    reviewer_id: IDS.tenantAdminA,
    sla_class: "standard",
    payment_status: "not_required",
    payment_confirmed_by_founder: false,
    payment_confirmed_by_advisor: false,
    conflict_status: "clear",
    restricted_mode: false,
    risk_score: 12.5,
    risk_band: "medium",
    outcome: "none",
    mandate_quality: "none",
    scope: "Synthetic fixture scope",
    limitations: "Synthetic fixture only",
    responsiveness_suggested: false,
    created_at: FIXED_TIME,
  });
  await insertRow(
    client,
    "documents",
    legacyFixtureRow(legacyShape, "documents", {
      id: IDS.document,
      project_id: IDS.project,
      type: "tender",
      filename: "synthetic-tender.txt",
      object_path: "fixtures/synthetic-tender.txt",
      content_type: "text/plain",
      size: 29,
      sha256: sha256("synthetic tender fixture"),
      source: "ci-fixture",
      date_received: "2026-01-15",
      redaction_status: "excluded",
      uploaded_by: IDS.admin,
      content_text: "Synthetic content without personal data.",
      extracted_chars: 40,
      extraction_status: "complete",
      extraction_method: "fixture",
      extraction_confidence: 1,
      extraction_notes: "Deterministic CI fixture",
      created_at: FIXED_TIME,
    }),
  );
  await insertRow(client, "requirements", {
    id: IDS.requirement,
    project_id: IDS.project,
    source_doc_id: IDS.document,
    page_ref: "1",
    clause_ref: "CI.1",
    text: "Provide synthetic evidence.",
    category: "technical",
    expected_evidence: "Synthetic document",
    is_mandatory: true,
    confidence: "high",
    review_status: "confirmed",
    reviewer_notes: "CI fixture",
    origin: "fixture",
    engine_text: "Provide synthetic evidence.",
    merged_citations: "[]",
    reviewed_by: IDS.tenantAdminA,
    reviewed_by_name: "Synthetic tenant administrator A",
    reviewed_at: FIXED_TIME,
    created_at: FIXED_TIME,
  });
  await insertRow(client, "evidence_items", {
    id: IDS.evidence,
    project_id: IDS.project,
    requirement_id: IDS.requirement,
    document_id: IDS.document,
    evidence_status: "confirmed",
    excerpt: "Synthetic evidence excerpt",
    notes: "CI fixture",
    suggested: false,
    confirmed_by: IDS.tenantAdminA,
    created_at: FIXED_TIME,
  });
  await insertRow(client, "defects", {
    id: IDS.defect,
    project_id: IDS.project,
    requirement_id: IDS.requirement,
    type: "completeness",
    severity: "cosmetic",
    description: "Synthetic defect",
    evidence_snapshot: "Synthetic snapshot",
    remediation: "Synthetic remediation",
    owner: "fixture-team",
    status: "open",
    suggested: false,
    created_at: FIXED_TIME,
  });
  await insertRow(client, "boq_checks", {
    id: IDS.boq,
    project_id: IDS.project,
    source_doc_id: IDS.document,
    line_ref: "CI-1",
    description: "Synthetic line item",
    quantity: 2,
    unit_rate: 3.5,
    extension: 7,
    computed_extension: 7,
    quantity_raw: "2",
    unit_rate_kobo: 350,
    extension_kobo: 700,
    computed_extension_kobo: 700,
    check_type: "arithmetic",
    finding: "Synthetic fixture matches",
    severity: "cosmetic",
    status: "resolved",
    created_at: FIXED_TIME,
  });
  await insertRow(client, "vault_items", {
    id: IDS.vault,
    client_id: IDS.client,
    artefact_type: "synthetic-certificate",
    issuer: "Synthetic Issuer",
    issue_date: "2026-01-01",
    expiry_date: "2027-01-01",
    renewal_lead_days: 30,
    status: "active",
    object_path: "fixtures/synthetic-certificate.txt",
    sha256: sha256("synthetic certificate fixture"),
    source_document_id: IDS.document,
    created_at: FIXED_TIME,
  });
  await insertRow(client, "capability_items", {
    id: IDS.capability,
    client_id: IDS.client,
    claim_type: "synthetic-capability",
    description: "Synthetic capability statement",
    evidence_doc_id: IDS.document,
    approved_status: "approved",
    verifier_id: IDS.tenantAdminA,
    verifier_name: "Synthetic tenant administrator A",
    verified_at: FIXED_TIME,
    created_at: FIXED_TIME,
  });
  await insertRow(client, "conflict_records", {
    id: IDS.conflict,
    client_id: IDS.client,
    project_id: IDS.project,
    tender_ref: "CI-REF-001",
    lot: "LOT-CI",
    matched_project_id: null,
    status: "cleared",
    decision: "clear",
    rationale: "Synthetic fixture",
    decided_by: IDS.admin,
    decided_at: FIXED_TIME,
    created_at: FIXED_TIME,
  });
  await insertRow(client, "notification_events", {
    id: IDS.notification,
    project_id: IDS.project,
    client_id: IDS.client,
    vault_item_id: IDS.vault,
    channel: "manual",
    template: "synthetic-template",
    recipient: "synthetic-destination",
    payload: "{}",
    status: "sent",
    created_by: IDS.admin,
    created_at: FIXED_TIME,
  });
  await insertRow(client, "retention_requests", {
    id: IDS.retention,
    project_id: IDS.project,
    requested_by: IDS.admin,
    reason: "Synthetic retention proof",
    due_at: "2026-02-15T12:00:00.000Z",
    completed_at: null,
    certificate_text: null,
    status: "pending",
    created_at: FIXED_TIME,
  });
  await insertRow(client, "sbd_templates", {
    id: IDS.template,
    code: "SYN-CI-001",
    title: "Synthetic bidding template",
    category: "goods",
    version: 1,
    status: "active",
    issuing_circular: "Synthetic circular",
    summary: "Non-production CI fixture",
    created_at: FIXED_TIME,
  });
  await insertRow(client, "sbd_annotations", {
    id: IDS.annotation,
    template_id: IDS.template,
    agency: "Synthetic Agency",
    section: "CI",
    kind: "format",
    quirk: "Synthetic annotation",
    created_at: FIXED_TIME,
  });
  await insertRow(
    client,
    "reports",
    legacyFixtureRow(legacyShape, "reports", {
      id: IDS.report,
      project_id: IDS.project,
      version: 1,
      status: "draft",
      docx_path: "fixtures/synthetic.docx",
      pdf_path: "fixtures/synthetic.pdf",
      reviewer_id: IDS.tenantAdminA,
      reviewer_name: "Synthetic tenant administrator A",
      attestation: "Synthetic attestation",
      engine_version: "ci",
      prompt_pack_version: "ci",
      model_id: "synthetic-model",
      taxonomy_version: "ci",
      signed_off_at: null,
      generated_by: IDS.admin,
      created_at: FIXED_TIME,
    }),
  );
  await insertRow(
    client,
    "llm_runs",
    legacyFixtureRow(legacyShape, "llm_runs", {
      id: IDS.llmRun,
      project_id: IDS.project,
      task: "synthetic-evaluation",
      model: "synthetic-model",
      prompt_version: "ci",
      input_hash: sha256("synthetic input"),
      output_summary: "Synthetic output",
      prompt_tokens: 10,
      completion_tokens: 5,
      error: null,
      created_at: FIXED_TIME,
    }),
  );
  await insertRow(client, "app_config", {
    id: "singleton",
    severity_weight_fatal: 40,
    severity_weight_likely_fatal: 25,
    severity_weight_scoring_risk: 10,
    severity_weight_cosmetic: 3,
    missing_evidence_weight: 5,
    band_medium_cutoff: 15,
    band_high_cutoff: 40,
    band_critical_cutoff: 70,
    firm_name: "Synthetic BidBox Fixture",
    confidentiality_legend: "Synthetic fixture; not production data.",
    retention_default_days: 14,
    updated_at: FIXED_TIME,
    updated_by: IDS.admin,
  });

  let previousHash = "0".repeat(64);
  const events = [];
  for (let seq = 1; seq <= 28; seq += 1) {
    const knownDiscontinuity = seq >= 8 && seq <= 26;
    const createdAt = new Date(Date.UTC(2026, 0, 1, 0, 0, seq)).toISOString();
    const payload = {
      seq,
      userId: knownDiscontinuity ? null : IDS.admin,
      userName: "Synthetic CI actor",
      projectId: knownDiscontinuity
        ? HISTORICAL_DELETED_PROJECT_ID
        : IDS.project,
      eventType: knownDiscontinuity ? "project.export_denied" : "fixture.event",
      objectType: "synthetic_fixture",
      objectId: `fixture-${seq}`,
      details: JSON.stringify({ fixture: true, sequence: seq }),
      createdAt,
    };
    const hash = knownDiscontinuity
      ? sha256(`intentional-known-discontinuity\n${previousHash}\n${seq}`)
      : auditHash(previousHash, payload, 1);
    const rowNo = seq === 1 ? 49 : seq === 28 ? 560 : seq + 48;
    const row = {
      id: `a1000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
      user_id: payload.userId,
      user_name: payload.userName,
      project_id: payload.projectId,
      event_type: payload.eventType,
      object_type: payload.objectType,
      object_id: payload.objectId,
      details: payload.details,
      seq,
      prev_hash: previousHash,
      hash,
      row_no: rowNo,
      created_at: createdAt,
    };
    await insertRow(client, "audit_events", row);
    events.push(row);
    previousHash = hash;
  }
  await client.query(
    "SELECT setval('public.audit_events_row_no_seq', 560, true)",
  );
  return events;
}

async function tableDigest(client, relation, columns) {
  const result = await client.query(`
    SELECT count(*)::integer AS row_count,
      COALESCE(string_agg(row_json, E'\\n' ORDER BY row_json) || E'\\n', '')
        AS content
    FROM (
      SELECT row_to_json(source_row)::text AS row_json
      FROM (SELECT ${columns} FROM ${relation}) AS source_row
    ) AS rows
  `);
  return {
    rowCount: result.rows[0].row_count,
    sha256: sha256(result.rows[0].content),
  };
}

async function legacyDigests(client, legacyShape, complete = false) {
  const result = {};
  for (const table of LEGACY_TABLES) {
    let relation = `public.${quoteIdentifier(table)}`;
    let projection = legacyShape.get(table).map(quoteIdentifier).join(", ");
    if (complete && table === "audit_events") {
      relation = "public.legacy_audit_events";
    } else if (complete && table === "users") {
      relation = "public.users AS identity";
      projection = legacyShape
        .get(table)
        .map((column) => {
          if (column !== "role") {
            return `identity.${quoteIdentifier(column)} AS ${quoteIdentifier(column)}`;
          }
          return `CASE (
            SELECT grant_record.role
            FROM public.organisation_memberships AS membership
            JOIN public.role_grants AS grant_record
              ON grant_record.membership_id=membership.id
            WHERE membership.organisation_id='${ORGANISATION_ID}'::uuid
              AND membership.user_id=identity.id
            ORDER BY grant_record.created_at
            LIMIT 1
          )
            WHEN 'valo_operations_administrator' THEN 'admin'
            WHEN 'valo_quality_adviser' THEN 'reviewer'
            WHEN 'valo_analyst' THEN 'analyst'
            ELSE identity.role
          END AS role`;
        })
        .join(", ");
    }
    result[table] = await tableDigest(client, relation, projection);
  }
  return result;
}

async function auditExport(client, relation = "public.audit_events") {
  const result = await client.query(`
    SELECT string_agg(row_to_json(source_row)::text, E'\\n' ORDER BY source_row.seq)
             || E'\\n' AS content
    FROM (
      SELECT id, user_id, user_name, project_id, event_type, object_type,
        object_id, details, seq, prev_hash, hash, row_no, created_at
      FROM ${relation}
      ORDER BY seq
    ) AS source_row
  `);
  return result.rows[0]?.content ?? "";
}

async function legacyRollbackSnapshot(client, legacyShape) {
  // A pg Client owns one wire-protocol connection. Keep catalog reads ordered
  // so the rollback proof does not rely on deprecated concurrent query queuing.
  const relations = await client.query(
    `SELECT c.relname, c.relkind,c.relowner::regrole::text AS owner,
          c.relrowsecurity,c.relforcerowsecurity
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind IN ('r','p','S','v','m','f')
        ORDER BY c.relkind,c.relname`,
  );
  const columns = await client.query(
    `SELECT table_name,column_name,ordinal_position,data_type,udt_name,
          is_nullable,column_default
        FROM information_schema.columns WHERE table_schema='public'
        ORDER BY table_name,ordinal_position`,
  );
  const constraints = await client.query(
    `SELECT c.conrelid::regclass::text AS relation,c.conname,c.contype,
          pg_get_constraintdef(c.oid,true) AS definition
        FROM pg_catalog.pg_constraint c
        JOIN pg_catalog.pg_namespace n ON n.oid=c.connamespace
        WHERE n.nspname='public' ORDER BY relation,c.conname`,
  );
  const indexes = await client.query(
    `SELECT schemaname,tablename,indexname,indexdef
        FROM pg_catalog.pg_indexes WHERE schemaname='public'
        ORDER BY tablename,indexname`,
  );
  const triggers = await client.query(
    `SELECT t.tgrelid::regclass::text AS relation,t.tgname,
          pg_get_triggerdef(t.oid,true) AS definition
        FROM pg_catalog.pg_trigger t WHERE NOT t.tgisinternal
        ORDER BY relation,t.tgname`,
  );
  const policies = await client.query(
    `SELECT schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check
        FROM pg_catalog.pg_policies WHERE schemaname='public'
        ORDER BY tablename,policyname`,
  );
  const sequence = await client.query(`SELECT last_value::text,is_called
        FROM public.audit_events_row_no_seq`);
  return {
    relations: relations.rows,
    columns: columns.rows,
    constraints: constraints.rows,
    indexes: indexes.rows,
    triggers: triggers.rows,
    policies: policies.rows,
    sequence: sequence.rows[0],
    digests: await legacyDigests(client, legacyShape),
  };
}

async function allPublicDataDigests(client) {
  const tables = await client.query(`
    SELECT c.relname
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p')
    ORDER BY c.relname
  `);
  const result = {};
  for (const { relname } of tables.rows) {
    const digest = await client.query(`
      SELECT count(*)::integer AS row_count,
        COALESCE(string_agg(row_json, E'\\n' ORDER BY row_json)
          || E'\\n', '') AS content
      FROM (
        SELECT row_to_json(source_row)::text AS row_json
        FROM (SELECT * FROM public.${quoteIdentifier(relname)}) AS source_row
      ) AS rows
    `);
    result[relname] = {
      rowCount: digest.rows[0].row_count,
      sha256: sha256(digest.rows[0].content),
    };
  }
  return result;
}

async function normalizedCatalog(client) {
  const sections = {
    relations: `SELECT n.nspname AS schema_name,c.relname,c.relkind,
        c.relrowsecurity,c.relforcerowsecurity
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname IN ('public','valo_security','drizzle')
        AND c.relkind IN ('r','p','S','v','m','f')
      ORDER BY schema_name,c.relkind,c.relname`,
    columns: `SELECT n.nspname AS schema_name,c.relname,a.attname,a.attnum,
        pg_catalog.format_type(a.atttypid,a.atttypmod) AS data_type,
        a.attnotnull,a.attidentity,a.attgenerated,
        pg_catalog.pg_get_expr(d.adbin,d.adrelid,true) AS default_expression
      FROM pg_catalog.pg_attribute a
      JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      LEFT JOIN pg_catalog.pg_attrdef d
        ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE n.nspname IN ('public','valo_security','drizzle')
        AND c.relkind IN ('r','p','v','m','f') AND a.attnum>0 AND NOT a.attisdropped
      ORDER BY schema_name,c.relname,a.attnum`,
    rls: `SELECT n.nspname AS schema_name,c.relname,c.relrowsecurity,c.relforcerowsecurity
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('r','p')
      ORDER BY c.relname`,
    policies: `SELECT schemaname,tablename,policyname,permissive,roles::text,cmd,qual,with_check
      FROM pg_catalog.pg_policies WHERE schemaname='public'
      ORDER BY tablename,policyname`,
    constraints: `SELECT n.nspname AS schema_name,rel.relname,c.conname,c.contype,
        pg_catalog.pg_get_constraintdef(c.oid,true) AS definition
      FROM pg_catalog.pg_constraint c
      JOIN pg_catalog.pg_class rel ON rel.oid=c.conrelid
      JOIN pg_catalog.pg_namespace n ON n.oid=rel.relnamespace
      WHERE n.nspname IN ('public','drizzle')
      ORDER BY schema_name,rel.relname,c.conname`,
    indexes: `SELECT schemaname,tablename,indexname,indexdef
      FROM pg_catalog.pg_indexes
      WHERE schemaname IN ('public','drizzle')
      ORDER BY schemaname,tablename,indexname`,
    functions: `SELECT n.nspname AS schema_name,p.proname,
        pg_catalog.pg_get_function_identity_arguments(p.oid) AS arguments,
        pg_catalog.pg_get_function_result(p.oid) AS result,
        p.provolatile,p.prosecdef,p.prokind,p.proconfig::text,
        pg_catalog.pg_get_functiondef(p.oid) AS definition
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname IN ('public','valo_security')
      ORDER BY schema_name,p.proname,arguments`,
    triggers: `SELECT n.nspname AS schema_name,c.relname,t.tgname,t.tgenabled,
        pg_catalog.pg_get_triggerdef(t.oid,true) AS definition
      FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname IN ('public','drizzle') AND NOT t.tgisinternal
      ORDER BY schema_name,c.relname,t.tgname`,
    grants: `WITH grants AS (
        SELECT 'schema'::text AS object_type,n.nspname AS schema_name,
          n.nspname AS object_name,n.nspowner AS owner_oid,
          x.grantor,x.grantee,x.privilege_type,x.is_grantable
        FROM pg_catalog.pg_namespace n
        CROSS JOIN LATERAL pg_catalog.aclexplode(
          COALESCE(n.nspacl,pg_catalog.acldefault('n',n.nspowner))) x
        WHERE n.nspname IN ('public','valo_security','drizzle')
        UNION ALL
        SELECT CASE c.relkind WHEN 'S' THEN 'sequence' ELSE 'relation' END,
          n.nspname,c.relname,c.relowner,x.grantor,x.grantee,
          x.privilege_type,x.is_grantable
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
        CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(c.relacl,
          pg_catalog.acldefault(CASE WHEN c.relkind='S' THEN 's'::"char" ELSE 'r'::"char" END,c.relowner))) x
        WHERE n.nspname IN ('public','drizzle') AND c.relkind IN ('r','p','S','v','m','f')
        UNION ALL
        SELECT 'function',n.nspname,p.proname || '(' ||
          pg_catalog.pg_get_function_identity_arguments(p.oid) || ')',p.proowner,
          x.grantor,x.grantee,x.privilege_type,x.is_grantable
        FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
        CROSS JOIN LATERAL pg_catalog.aclexplode(
          COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) x
        WHERE n.nspname IN ('public','valo_security')
      )
      SELECT object_type,schema_name,object_name,
        CASE WHEN grantor_role.rolname IS NULL THEN 'PUBLIC' ELSE grantor_role.rolname END AS grantor,
        CASE WHEN grantee_role.rolname IS NULL THEN 'PUBLIC' ELSE grantee_role.rolname END AS grantee,
        privilege_type,is_grantable
      FROM grants
      LEFT JOIN pg_catalog.pg_roles grantor_role ON grantor_role.oid=grants.grantor
      LEFT JOIN pg_catalog.pg_roles grantee_role ON grantee_role.oid=grants.grantee
      WHERE COALESCE(grantee_role.rolname,'PUBLIC') <> 'valo_app_runtime'
      ORDER BY object_type,schema_name,object_name,grantee,privilege_type`,
  };
  const result = {};
  for (const [name, query] of Object.entries(sections)) {
    result[name] = (await client.query(query)).rows;
  }
  return result;
}

async function readDeliverySourceReleaseBoundaryExpectation(client) {
  const deliverySourceReleaseBoundaryInventory = await client.query(`
    SELECT
      (SELECT count(*)::integer
       FROM pg_catalog.pg_proc AS routine
       JOIN pg_catalog.pg_namespace AS namespace
         ON namespace.oid=routine.pronamespace
       WHERE namespace.nspname='public'
         AND routine.proname IN (
           'valo_delivery_source_project_id',
           'valo_assert_delivery_project_mutable',
           'valo_guard_delivery_project_delete',
           'valo_guard_delivery_source_mutation'
         )) AS function_count,
      (SELECT count(*)::integer
       FROM pg_catalog.pg_trigger AS guard
       JOIN pg_catalog.pg_class AS relation ON relation.oid=guard.tgrelid
       JOIN pg_catalog.pg_namespace AS relation_namespace
         ON relation_namespace.oid=relation.relnamespace
       JOIN pg_catalog.pg_proc AS routine ON routine.oid=guard.tgfoid
       JOIN pg_catalog.pg_namespace AS routine_namespace
         ON routine_namespace.oid=routine.pronamespace
       WHERE relation_namespace.nspname='public'
         AND routine_namespace.nspname='public'
         AND routine.proname='valo_guard_delivery_source_mutation'
         AND guard.tgname='delivery_source_project_guard'
         AND NOT guard.tgisinternal) AS trigger_count,
      COALESCE((
        SELECT pg_catalog.array_agg(
          relation.relname::text
          ORDER BY relation.relname::text COLLATE "C"
        )
        FROM pg_catalog.pg_trigger AS guard
        JOIN pg_catalog.pg_class AS relation ON relation.oid=guard.tgrelid
        JOIN pg_catalog.pg_namespace AS relation_namespace
          ON relation_namespace.oid=relation.relnamespace
        JOIN pg_catalog.pg_proc AS routine ON routine.oid=guard.tgfoid
        JOIN pg_catalog.pg_namespace AS routine_namespace
          ON routine_namespace.oid=routine.pronamespace
        WHERE relation_namespace.nspname='public'
          AND routine_namespace.nspname='public'
          AND routine.proname='valo_guard_delivery_source_mutation'
          AND guard.tgname='delivery_source_project_guard'
          AND NOT guard.tgisinternal
      ), ARRAY[]::text[]) AS trigger_tables,
      COALESCE((
        SELECT pg_catalog.bool_and(
          guard.tgenabled='O'
          AND guard.tgtype=31
          AND guard.tgnargs=0
          AND guard.tgattr::text=''
          AND guard.tgqual IS NULL
        )
        FROM pg_catalog.pg_trigger AS guard
        JOIN pg_catalog.pg_class AS relation ON relation.oid=guard.tgrelid
        JOIN pg_catalog.pg_namespace AS relation_namespace
          ON relation_namespace.oid=relation.relnamespace
        JOIN pg_catalog.pg_proc AS routine ON routine.oid=guard.tgfoid
        JOIN pg_catalog.pg_namespace AS routine_namespace
          ON routine_namespace.oid=routine.pronamespace
        WHERE relation_namespace.nspname='public'
          AND routine_namespace.nspname='public'
          AND routine.proname='valo_guard_delivery_source_mutation'
          AND guard.tgname='delivery_source_project_guard'
          AND NOT guard.tgisinternal
      ), false) AS trigger_contract_exact,
      (SELECT count(*)::integer
       FROM pg_catalog.pg_trigger AS guard
       JOIN pg_catalog.pg_class AS relation ON relation.oid=guard.tgrelid
       JOIN pg_catalog.pg_namespace AS relation_namespace
         ON relation_namespace.oid=relation.relnamespace
       JOIN pg_catalog.pg_proc AS routine ON routine.oid=guard.tgfoid
       JOIN pg_catalog.pg_namespace AS routine_namespace
         ON routine_namespace.oid=routine.pronamespace
       WHERE relation_namespace.nspname='public'
         AND relation.relname='projects'
         AND routine_namespace.nspname='public'
         AND routine.proname='valo_guard_delivery_project_delete'
         AND guard.tgname='delivery_project_delete_guard'
         AND NOT guard.tgisinternal) AS project_delete_trigger_count,
      COALESCE((
        SELECT pg_catalog.bool_and(
          guard.tgenabled='O'
          AND guard.tgtype=11
          AND guard.tgnargs=0
          AND guard.tgattr::text=''
          AND guard.tgqual IS NULL
        )
        FROM pg_catalog.pg_trigger AS guard
        JOIN pg_catalog.pg_class AS relation ON relation.oid=guard.tgrelid
        JOIN pg_catalog.pg_namespace AS relation_namespace
          ON relation_namespace.oid=relation.relnamespace
        JOIN pg_catalog.pg_proc AS routine ON routine.oid=guard.tgfoid
        JOIN pg_catalog.pg_namespace AS routine_namespace
          ON routine_namespace.oid=routine.pronamespace
        WHERE relation_namespace.nspname='public'
          AND relation.relname='projects'
          AND routine_namespace.nspname='public'
          AND routine.proname='valo_guard_delivery_project_delete'
          AND guard.tgname='delivery_project_delete_guard'
          AND NOT guard.tgisinternal
      ), false) AS project_delete_trigger_contract_exact
  `);
  const deliverySourceReleaseBoundaryExpected =
    deliverySourceReleaseBoundaryInventory.rows[0]?.function_count === 4;
  assert.deepEqual(
    deliverySourceReleaseBoundaryInventory.rows[0],
    deliverySourceReleaseBoundaryExpected
      ? {
          function_count: 4,
          trigger_count: 14,
          trigger_tables: DELIVERY_SOURCE_RELEASE_BOUNDARY_TABLES,
          trigger_contract_exact: true,
          project_delete_trigger_count: 1,
          project_delete_trigger_contract_exact: true,
        }
      : {
          function_count: 0,
          trigger_count: 0,
          trigger_tables: [],
          trigger_contract_exact: false,
          project_delete_trigger_count: 0,
          project_delete_trigger_contract_exact: false,
        },
    "the 0012 delivery-source release boundary must be wholly present or absent",
  );
  return deliverySourceReleaseBoundaryExpected;
}

async function assertRuntimeContract(
  client,
  {
    productionAssuranceExpected,
    retrievalRegistryExpected,
    tenderContextExpected,
    retentionCompletionExpected,
  },
) {
  assert.equal(
    typeof productionAssuranceExpected,
    "boolean",
    "the runtime contract catalog variant must be explicit",
  );
  assert.equal(
    typeof retrievalRegistryExpected,
    "boolean",
    "the runtime contract registry variant must be explicit",
  );
  assert.equal(
    typeof tenderContextExpected,
    "boolean",
    "the runtime contract tender-context variant must be explicit",
  );
  assert(
    !retrievalRegistryExpected || productionAssuranceExpected,
    "the 0009 registry variant requires the 0008 production-assurance catalog",
  );
  assert(
    !tenderContextExpected || retrievalRegistryExpected,
    "the 0010 tender-context variant requires the 0009 registry catalog",
  );
  assert.equal(
    typeof retentionCompletionExpected,
    "boolean",
    "the runtime contract retention-completion variant must be explicit",
  );
  assert(
    !retentionCompletionExpected || tenderContextExpected,
    "the 0011 retention-completion variant requires the 0010 tender-context catalog",
  );
  const deliverySourceReleaseBoundaryExpected =
    await readDeliverySourceReleaseBoundaryExpectation(client);
  const role =
    await client.query(`SELECT rolsuper,rolinherit,rolcreaterole,rolcreatedb,
      rolcanlogin,rolreplication,rolbypassrls,rolconnlimit,
      rolvaliduntil::text AS rolvaliduntil,
      COALESCE(cardinality(roles.rolconfig),0)::integer AS role_settings,
      (SELECT count(*)::integer FROM pg_catalog.pg_db_role_setting
        WHERE setrole=roles.oid) AS database_role_settings,
      (SELECT count(*)::integer FROM pg_catalog.pg_auth_members
        WHERE member=roles.oid) AS memberships,
      has_database_privilege(roles.rolname,current_database(),'CREATE')
        AS can_create_database_objects,
      has_schema_privilege(roles.rolname,'public','CREATE')
        AS can_create_public_objects,
      has_schema_privilege(roles.rolname,'valo_security','CREATE')
        AS can_create_valo_security_objects,
      has_schema_privilege(roles.rolname,'drizzle','CREATE')
        AS can_create_drizzle_objects,
      has_schema_privilege(roles.rolname,'public','USAGE')
        AS can_use_public_schema,
      has_schema_privilege(roles.rolname,'valo_security','USAGE')
        AS can_use_valo_security_schema,
      has_schema_privilege(roles.rolname,'drizzle','USAGE')
        AS can_use_drizzle_schema,
      (SELECT count(*)::integer FROM pg_catalog.pg_database database_record
       WHERE database_record.datname=current_database()
         AND database_record.datdba=roles.oid) AS owned_database,
      (SELECT count(*)::integer FROM pg_catalog.pg_namespace namespace
       WHERE namespace.nspname !~ '^pg_'
         AND namespace.nspname<>'information_schema'
         AND namespace.nspowner=roles.oid) AS owned_schemas,
      (SELECT count(*)::integer FROM pg_catalog.pg_namespace namespace
       WHERE namespace.nspname !~ '^pg_'
         AND namespace.nspname<>'information_schema'
         AND has_schema_privilege(roles.rolname,namespace.oid,'CREATE'))
        AS creatable_schemas,
      (SELECT count(*)::integer FROM pg_catalog.pg_class relation
       JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
       WHERE namespace.nspname !~ '^pg_'
         AND namespace.nspname<>'information_schema'
         AND relation.relowner=roles.oid) AS owned_relations,
      (SELECT count(*)::integer FROM pg_catalog.pg_proc routine
       JOIN pg_catalog.pg_namespace namespace ON namespace.oid=routine.pronamespace
       WHERE namespace.nspname !~ '^pg_'
         AND namespace.nspname<>'information_schema'
         AND routine.proowner=roles.oid) AS owned_functions,
      (SELECT count(*)::integer FROM pg_catalog.pg_type type_record
       JOIN pg_catalog.pg_namespace namespace ON namespace.oid=type_record.typnamespace
       WHERE namespace.nspname !~ '^pg_'
         AND namespace.nspname<>'information_schema'
         AND type_record.typowner=roles.oid) AS owned_types
    FROM pg_catalog.pg_roles roles WHERE rolname='valo_app_runtime'`);
  assert.deepEqual(role.rows[0], {
    rolsuper: false,
    rolinherit: true,
    rolcreaterole: false,
    rolcreatedb: false,
    rolcanlogin: true,
    rolreplication: false,
    rolbypassrls: false,
    rolconnlimit: -1,
    rolvaliduntil: "infinity",
    role_settings: 0,
    database_role_settings: 0,
    memberships: 0,
    can_create_database_objects: false,
    can_create_public_objects: false,
    can_create_valo_security_objects: false,
    can_create_drizzle_objects: false,
    can_use_public_schema: true,
    can_use_valo_security_schema: true,
    can_use_drizzle_schema: false,
    owned_database: 0,
    owned_schemas: 0,
    creatable_schemas: 0,
    owned_relations: 0,
    owned_functions: 0,
    owned_types: 0,
  });
  const tableGrants = await client.query(`
    SELECT c.relname,
      has_table_privilege('valo_app_runtime',c.oid,'SELECT') AS can_select,
      has_table_privilege('valo_app_runtime',c.oid,'INSERT') AS can_insert,
      has_table_privilege('valo_app_runtime',c.oid,'UPDATE') AS can_update,
      has_table_privilege('valo_app_runtime',c.oid,'DELETE') AS can_delete,
      has_table_privilege('valo_app_runtime',c.oid,'TRUNCATE') AS can_truncate,
      has_table_privilege('valo_app_runtime',c.oid,'REFERENCES') AS can_references,
      has_table_privilege('valo_app_runtime',c.oid,'TRIGGER') AS can_trigger
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY c.relname
  `);
  assert.equal(
    tableGrants.rows.length,
    (productionAssuranceExpected ? 97 : 96) +
      (retrievalRegistryExpected ? 1 : 0) +
      (tenderContextExpected ? 7 : 0) +
      (retentionCompletionExpected ? 1 : 0),
    productionAssuranceExpected
      ? "the post-0008 runtime contract must cover the authenticated rate-limit table"
      : "the pre-0008 runtime contract must not contain the authenticated rate-limit table",
  );
  assert.deepEqual(
    tableGrants.rows.find((grant) => grant.relname === "ai_retrieval_registry"),
    retrievalRegistryExpected
      ? {
          relname: "ai_retrieval_registry",
          can_select: true,
          can_insert: true,
          can_update: true,
          can_delete: false,
          can_truncate: false,
          can_references: false,
          can_trigger: false,
        }
      : undefined,
    "the retrieval registry table must have its exact variant-bound runtime contract",
  );
  assert.deepEqual(
    tableGrants.rows.find(
      (grant) => grant.relname === "authenticated_rate_limit_buckets",
    ),
    productionAssuranceExpected
      ? {
          relname: "authenticated_rate_limit_buckets",
          can_select: true,
          can_insert: true,
          can_update: true,
          can_delete: false,
          can_truncate: false,
          can_references: false,
          can_trigger: false,
        }
      : undefined,
    "the authenticated rate-limit table must have its exact variant-bound runtime contract",
  );
  assert.deepEqual(
    tableGrants.rows.find(
      (grant) => grant.relname === "retention_action_storage_events",
    ),
    retentionCompletionExpected
      ? {
          relname: "retention_action_storage_events",
          can_select: true,
          can_insert: true,
          can_update: true,
          can_delete: false,
          can_truncate: false,
          can_references: false,
          can_trigger: false,
        }
      : undefined,
    "the retention binding table must have its exact variant-bound runtime contract",
  );
  const noInsert = new Set([
    "audit_events",
    "jurisdiction_rule_packs",
    "jurisdiction_rules",
    "legacy_audit_events",
    "legacy_audit_integrity_assessments",
  ]);
  const noUpdate = new Set([
    ...noInsert,
    "document_versions",
    "organisations",
    "role_grants",
    "tender_context_artifacts",
    "tender_context_requirements",
    ...(retentionCompletionExpected ? ["deletion_certificates"] : []),
  ]);
  const noDelete = new Set([
    ...noInsert,
    "ai_retrieval_registry",
    "authenticated_rate_limit_buckets",
    "break_glass_sessions",
    "addendum_impact_assessments",
    "addendum_impact_items",
    "document_version_snapshots",
    "organisation_memberships",
    "organisations",
    "partner_relationships",
    "role_grants",
    "tender_context_artifacts",
    "tender_context_requirements",
    "tender_context_versions",
    "tender_eligibility_passports",
    "users",
    ...(deliverySourceReleaseBoundaryExpected ? ["clients"] : []),
    ...(retentionCompletionExpected
      ? [
          "deletion_certificates",
          "projects",
          "retention_actions",
          "retention_action_storage_events",
          "retention_requests",
        ]
      : []),
  ]);
  for (const grant of tableGrants.rows) {
    assert.deepEqual(
      [
        grant.can_select,
        grant.can_insert,
        grant.can_update,
        grant.can_delete,
        grant.can_truncate,
        grant.can_references,
        grant.can_trigger,
      ],
      [
        true,
        !noInsert.has(grant.relname),
        !noUpdate.has(grant.relname),
        !noDelete.has(grant.relname),
        false,
        false,
        false,
      ],
      `${grant.relname} exact runtime table grant`,
    );
  }
  const auditInsertColumns = new Set([
    "id",
    "organisation_id",
    "user_id",
    "user_name",
    "project_id",
    "event_type",
    "object_type",
    "object_id",
    "details",
    "seq",
    "prev_hash",
    "hash",
    "hash_version",
    "created_at",
  ]);
  const columnGrants = await client.query(`
    SELECT relation.relname,attribute.attname,
      has_column_privilege(
        'valo_app_runtime',relation.oid,attribute.attnum,'SELECT'
      ) AS can_select,
      has_column_privilege(
        'valo_app_runtime',relation.oid,attribute.attnum,'INSERT'
      ) AS can_insert,
      has_column_privilege(
        'valo_app_runtime',relation.oid,attribute.attnum,'UPDATE'
      ) AS can_update,
      has_column_privilege(
        'valo_app_runtime',relation.oid,attribute.attnum,'REFERENCES'
      ) AS can_references
    FROM pg_catalog.pg_class relation
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
    JOIN pg_catalog.pg_attribute attribute
      ON attribute.attrelid=relation.oid
     AND attribute.attnum>0
     AND NOT attribute.attisdropped
    WHERE namespace.nspname='public' AND relation.relkind IN ('r','p')
    ORDER BY relation.relname,attribute.attnum
  `);
  assert(columnGrants.rows.length > tableGrants.rows.length);
  for (const grant of columnGrants.rows) {
    const expectedInsert =
      grant.relname === "audit_events"
        ? auditInsertColumns.has(grant.attname)
        : !noInsert.has(grant.relname);
    assert.deepEqual(
      [
        grant.can_select,
        grant.can_insert,
        grant.can_update,
        grant.can_references,
      ],
      [true, expectedInsert, !noUpdate.has(grant.relname), false],
      `${grant.relname}.${grant.attname} exact runtime column grant`,
    );
  }
  const sequences = await client.query(`
    SELECT c.relname,
      has_sequence_privilege('valo_app_runtime',c.oid,'USAGE') AS can_use,
      has_sequence_privilege('valo_app_runtime',c.oid,'SELECT') AS can_select,
      has_sequence_privilege('valo_app_runtime',c.oid,'UPDATE') AS can_update
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='S' ORDER BY c.relname
  `);
  assert.deepEqual(sequences.rows, [
    {
      relname: "audit_events_row_no_seq",
      can_use: true,
      can_select: true,
      can_update: false,
    },
  ]);
}

async function expectInsufficientPrivilege(
  client,
  savepoint,
  query,
  parameters,
  label,
) {
  await client.query(`SAVEPOINT ${quoteIdentifier(savepoint)}`);
  let denied = false;
  try {
    await client.query(query, parameters);
  } catch (error) {
    denied = error?.code === "42501";
  }
  await client.query(`ROLLBACK TO SAVEPOINT ${quoteIdentifier(savepoint)}`);
  await client.query(`RELEASE SAVEPOINT ${quoteIdentifier(savepoint)}`);
  assert.equal(denied, true, label);
}

async function assertTenantGuardCatalogInSnapshot(
  client,
  {
    runtimeRoleExpected,
    productionAssuranceExpected,
    retrievalRegistryExpected,
    tenderContextExpected,
    retentionCompletionExpected,
  },
) {
  assert.equal(
    typeof tenderContextExpected,
    "boolean",
    "the tenant-guard tender-context catalog variant must be explicit",
  );
  assert(
    !tenderContextExpected || retrievalRegistryExpected,
    "the 0010 tender-context variant requires the 0009 registry catalog",
  );
  assert.equal(
    typeof retentionCompletionExpected,
    "boolean",
    "the tenant-guard retention-completion catalog variant must be explicit",
  );
  assert(
    !retentionCompletionExpected || tenderContextExpected,
    "the 0011 retention-completion variant requires the 0010 tender-context catalog",
  );
  const deliverySourceReleaseBoundaryExpected =
    await readDeliverySourceReleaseBoundaryExpectation(client);
  const runtimeRole = await client.query(
    "SELECT oid FROM pg_catalog.pg_roles WHERE rolname='valo_app_runtime'",
  );
  assert.equal(
    runtimeRole.rowCount,
    runtimeRoleExpected ? 1 : 0,
    runtimeRoleExpected
      ? "the bridged catalog must have the fixed runtime login"
      : "the migration-only catalog must not depend on a pre-provisioned runtime login",
  );
  const runtimeRoleOid = runtimeRole.rows[0]?.oid ?? null;
  const expectedRuntimeExecute = (allowed) =>
    runtimeRoleOid === null ? null : allowed;
  const expectedDirect = await client.query(
    `SELECT child_table,child_column,parent_table,parent_column,
       allow_global_parent
     FROM valo_security.expected_tenant_parent_edges()
     ORDER BY child_table,child_column,parent_table,parent_column`,
  );
  assert.equal(
    expectedDirect.rowCount,
    retentionCompletionExpected ? 118 : tenderContextExpected ? 116 : 98,
    retentionCompletionExpected
      ? "the pinned 0011 tenant-parent manifest must contain exactly 118 edges"
      : tenderContextExpected
        ? "the pinned 0010 tenant-parent manifest must contain exactly 116 edges"
        : "the pinned v2.5 tenant-parent manifest must contain exactly 98 edges",
  );
  assert.equal(
    expectedDirect.rows.filter((edge) => edge.allow_global_parent).length,
    2,
    "exactly two prompt-configuration edges may use a global parent",
  );
  assert.equal(
    sha256(
      expectedDirect.rows
        .map(
          (edge) =>
            `${edge.child_table}.${edge.child_column}->${edge.parent_table}.${edge.parent_column}|${edge.allow_global_parent ? "global" : "strict"}`,
        )
        .sort()
        .join("\n"),
    ),
    retentionCompletionExpected
      ? "620cbf5d64521211dd59e8bc19128d9661b67eec8eb497eb200c8695a693c2bd"
      : tenderContextExpected
        ? "dd59282e6bc150c791a36e96188d767871580a3b5d2ad02074c7b68eec323430"
        : "0240790c357b1461feb2f48d1a1930750e4a09dbaf2502b1260b35c4fe706172",
    "the dynamic direct-edge manifest must match the independently pinned catalog digest",
  );

  const actualDirect = await client.query(
    `SELECT relation.relname::text AS child_table,
       trigger_record.tgname::text AS trigger_name,
       routine.proname::text AS function_name,
       trigger_record.tgenabled='O' AS enabled,
       trigger_record.tgtype::integer AS trigger_type,
       (
         SELECT pg_catalog.string_agg(attribute.attname,',' ORDER BY selected.ordinality)
         FROM pg_catalog.unnest(trigger_record.tgattr::smallint[]) WITH ORDINALITY
           AS selected(attnum,ordinality)
         JOIN pg_catalog.pg_attribute AS attribute
           ON attribute.attrelid=trigger_record.tgrelid
          AND attribute.attnum=selected.attnum
       ) AS update_columns,
       pg_catalog.encode(trigger_record.tgargs,'hex') AS trigger_args_hex,
       pg_catalog.pg_get_expr(trigger_record.tgqual,trigger_record.tgrelid)
         AS when_clause
     FROM pg_catalog.pg_trigger AS trigger_record
     JOIN pg_catalog.pg_class AS relation
       ON relation.oid=trigger_record.tgrelid
     JOIN pg_catalog.pg_namespace AS relation_namespace
       ON relation_namespace.oid=relation.relnamespace
     JOIN pg_catalog.pg_proc AS routine
       ON routine.oid=trigger_record.tgfoid
     JOIN pg_catalog.pg_namespace AS routine_namespace
       ON routine_namespace.oid=routine.pronamespace
     WHERE NOT trigger_record.tgisinternal
       AND relation_namespace.nspname='public'
       AND routine_namespace.nspname='valo_security'
       AND routine.proname='enforce_tenant_parent'
     ORDER BY relation.relname,trigger_record.tgname`,
  );
  const compareDirectGuards = (left, right) => {
    const leftKey = `${left.child_table}\0${left.trigger_name}`;
    const rightKey = `${right.child_table}\0${right.trigger_name}`;
    return leftKey === rightKey ? 0 : leftKey < rightKey ? -1 : 1;
  };
  const expectedDirectMap = expectedDirect.rows
    .map((edge) => ({
      child_table: edge.child_table,
      trigger_name: `tenant_parent_${edge.child_column}`.slice(0, 63),
      function_name: "enforce_tenant_parent",
      enabled: true,
      trigger_type: 23,
      update_columns: `organisation_id,${edge.child_column}`,
      trigger_args_hex: Buffer.from(
        `${edge.parent_table}\0${edge.parent_column}\0${edge.child_column}\0${String(edge.allow_global_parent)}\0`,
        "utf8",
      ).toString("hex"),
      when_clause: null,
    }))
    .sort(compareDirectGuards);
  const actualDirectMap = actualDirect.rows
    .map((trigger) => ({
      child_table: trigger.child_table,
      trigger_name: trigger.trigger_name,
      function_name: trigger.function_name,
      enabled: trigger.enabled,
      trigger_type: trigger.trigger_type,
      update_columns: trigger.update_columns,
      trigger_args_hex: trigger.trigger_args_hex,
      when_clause: trigger.when_clause,
    }))
    .sort(compareDirectGuards);
  assert.deepEqual(
    actualDirectMap,
    expectedDirectMap,
    "every pinned direct tenant-parent edge must have its exact trigger and arguments",
  );
  assert.equal(
    Number(
      (
        await client.query(`SELECT count(*)
          FROM pg_catalog.pg_trigger AS guard
          WHERE guard.tgfoid=
            'valo_security.enforce_tenant_parent()'::pg_catalog.regprocedure
            AND NOT guard.tgisinternal`)
      ).rows[0].count,
    ),
    retentionCompletionExpected ? 118 : tenderContextExpected ? 116 : 98,
    "no extra or missing enforce_tenant_parent trigger may exist",
  );

  const specialGuards = await client.query(
    `SELECT relation.relname::text AS table_name,
       trigger_record.tgname::text AS trigger_name,
       routine.proname::text AS function_name,
       trigger_record.tgenabled='O' AS enabled,
       trigger_record.tgtype::integer AS trigger_type,
       COALESCE((
         SELECT pg_catalog.string_agg(attribute.attname,',' ORDER BY selected.ordinality)
         FROM pg_catalog.unnest(trigger_record.tgattr::smallint[]) WITH ORDINALITY
           AS selected(attnum,ordinality)
         JOIN pg_catalog.pg_attribute AS attribute
           ON attribute.attrelid=trigger_record.tgrelid
          AND attribute.attnum=selected.attnum
       ),'') AS update_columns,
       pg_catalog.encode(trigger_record.tgargs,'hex') AS trigger_args_hex,
       pg_catalog.pg_get_expr(trigger_record.tgqual,trigger_record.tgrelid)
         AS when_clause
     FROM pg_catalog.pg_trigger AS trigger_record
     JOIN pg_catalog.pg_class AS relation
       ON relation.oid=trigger_record.tgrelid
     JOIN pg_catalog.pg_namespace AS relation_namespace
       ON relation_namespace.oid=relation.relnamespace
     JOIN pg_catalog.pg_proc AS routine
       ON routine.oid=trigger_record.tgfoid
     JOIN pg_catalog.pg_namespace AS routine_namespace
       ON routine_namespace.oid=routine.pronamespace
     WHERE NOT trigger_record.tgisinternal
       AND relation_namespace.nspname='public'
        AND routine_namespace.nspname='valo_security'
        AND routine.proname IN (
          'enforce_control_plane_tenant_context',
           'enforce_derived_tenant_relationship',
           'enforce_governed_state_transition',
           'enforce_retention_completion_transition',
           'reject_active_audit_mutation',
           'reject_legacy_audit_mutation',
           'reject_tenant_identity_reassignment',
           'reject_versioned_record_content_mutation'
       )
     ORDER BY relation.relname,trigger_record.tgname`,
  );
  const expectedSpecialGuards = [
    ...(retentionCompletionExpected
      ? [
          [
            "deletion_certificates",
            "deletion_certificate_completion_guard",
            "enforce_retention_completion_transition",
            31,
            "",
          ],
          [
            "retention_actions",
            "retention_action_completion_guard",
            "enforce_retention_completion_transition",
            31,
            "",
          ],
          [
            "retention_action_storage_events",
            "retention_action_storage_event_completion_guard",
            "enforce_retention_completion_transition",
            31,
            "",
          ],
          [
            "retention_requests",
            "retention_request_completion_guard",
            "enforce_retention_completion_transition",
            31,
            "",
          ],
        ]
      : []),
    ...(tenderContextExpected
      ? [
          [
            "addendum_impact_assessments",
            "addendum_impact_assessment_content_immutable",
            "reject_versioned_record_content_mutation",
            19,
            "id,organisation_id,project_id,baseline_document_version_id,revision_document_version_id,radar_id,assessment_id,source_manifest_sha256,impact_manifest_sha256,assessment_snapshot,created_at",
          ],
          [
            "addendum_impact_assessments",
            "addendum_impact_assessment_state_transition",
            "enforce_governed_state_transition",
            23,
            "",
          ],
          [
            "addendum_impact_items",
            "addendum_impact_item_content_immutable",
            "reject_versioned_record_content_mutation",
            19,
            "id,organisation_id,assessment_id,change_id,category,kind,before_text,after_text,citation_data,field_external_id,affected_object_type,affected_object_id,affected_object_version,proposed_action,created_at",
          ],
          [
            "addendum_impact_items",
            "addendum_impact_item_state_transition",
            "enforce_governed_state_transition",
            23,
            "",
          ],
          [
            "document_versions",
            "document_version_content_immutable",
            "reject_versioned_record_content_mutation",
            19,
            "id,organisation_id,document_id,version_number,supersedes_version_id,object_path,sha256,detected_mime,detected_format,size_bytes,integrity_manifest,uploaded_by,created_at",
          ],
          [
            "document_version_snapshots",
            "document_version_snapshot_content_immutable",
            "reject_versioned_record_content_mutation",
            19,
            "id,organisation_id,document_version_id,document_version_sha256,captured_redaction_status,canonical_text,canonical_text_sha256,structured_snapshot,structured_snapshot_sha256,extraction_method,parser_version,captured_by_user_id,captured_by_name,created_at",
          ],
          [
            "document_version_snapshots",
            "document_version_snapshot_state_transition",
            "enforce_governed_state_transition",
            23,
            "",
          ],
          [
            "tender_context_artifacts",
            "tender_context_artifact_immutable",
            "reject_versioned_record_content_mutation",
            19,
            "",
          ],
          [
            "tender_context_requirements",
            "tender_context_requirement_immutable",
            "reject_versioned_record_content_mutation",
            19,
            "",
          ],
          [
            "tender_context_versions",
            "tender_context_version_content_immutable",
            "reject_versioned_record_content_mutation",
            19,
            "id,organisation_id,project_id,version_number,supersedes_context_version_id,primary_document_version_id,jurisdiction_rule_pack_id,legal_entity_name,submission_date,jurisdiction,entity_scopes,category_scopes,source_manifest,source_manifest_sha256,context_snapshot,context_sha256,rule_advisories,created_by_user_id,created_at",
          ],
          [
            "tender_context_versions",
            "tender_context_version_state_transition",
            "enforce_governed_state_transition",
            23,
            "",
          ],
          [
            "tender_eligibility_passports",
            "tender_eligibility_passport_content_immutable",
            "reject_versioned_record_content_mutation",
            19,
            "id,organisation_id,project_id,tender_context_version_id,passport_id,source_manifest_sha256,result_snapshot,result_snapshot_sha256,result_status,created_by_user_id,created_at",
          ],
          [
            "tender_eligibility_passports",
            "tender_eligibility_passport_state_transition",
            "enforce_governed_state_transition",
            23,
            "",
          ],
        ]
      : []),
    [
      "audit_events",
      "audit_events_append_only",
      "reject_active_audit_mutation",
      27,
      "",
    ],
    [
      "break_glass_sessions",
      "tenant_break_glass_target_immutable",
      "reject_tenant_identity_reassignment",
      19,
      "target_organisation_id",
    ],
    [
      "break_glass_sessions",
      "tenant_control_break_glass_context",
      "enforce_control_plane_tenant_context",
      23,
      "",
    ],
    [
      "invoice_lines",
      "tenant_derived_invoice_order",
      "enforce_derived_tenant_relationship",
      23,
      "invoice_id,order_id",
    ],
    [
      "legacy_audit_events",
      "legacy_audit_events_immutable",
      "reject_legacy_audit_mutation",
      27,
      "",
    ],
    [
      "legacy_audit_integrity_assessments",
      "legacy_audit_assessments_immutable",
      "reject_legacy_audit_mutation",
      27,
      "",
    ],
    [
      "orders",
      "tenant_derived_price_book_entry",
      "enforce_derived_tenant_relationship",
      23,
      "organisation_id,price_book_entry_id",
    ],
    [
      "organisation_memberships",
      "tenant_control_membership_context",
      "enforce_control_plane_tenant_context",
      23,
      "",
    ],
    [
      "organisation_memberships",
      "tenant_membership_organisation_immutable",
      "reject_tenant_identity_reassignment",
      19,
      "organisation_id",
    ],
    [
      "organisations",
      "tenant_control_organisation_context",
      "enforce_control_plane_tenant_context",
      7,
      "",
    ],
    [
      "partner_relationships",
      "tenant_control_partner_context",
      "enforce_control_plane_tenant_context",
      23,
      "",
    ],
    [
      "partner_relationships",
      "tenant_derived_partner_approver",
      "enforce_derived_tenant_relationship",
      23,
      "approved_by_membership_id,status",
    ],
    [
      "partner_relationships",
      "tenant_partner_parties_immutable",
      "reject_tenant_identity_reassignment",
      19,
      "partner_organisation_id,client_organisation_id",
    ],
    [
      "partner_revenue_share_entries",
      "tenant_derived_partner_revenue",
      "enforce_derived_tenant_relationship",
      23,
      "partner_organisation_id,client_organisation_id,order_id",
    ],
    [
      "role_grants",
      "tenant_control_role_grant_context",
      "enforce_control_plane_tenant_context",
      23,
      "",
    ],
    [
      "role_grants",
      "tenant_derived_role_grant",
      "enforce_derived_tenant_relationship",
      7,
      "",
    ],
    [
      "role_grants",
      "tenant_role_grant_identity_immutable",
      "reject_tenant_identity_reassignment",
      19,
      "membership_id,granted_by_membership_id",
    ],
    [
      "subscriptions",
      "tenant_derived_price_book_entry",
      "enforce_derived_tenant_relationship",
      23,
      "organisation_id,price_book_entry_id",
    ],
  ]
    .map(
      ([
        table_name,
        trigger_name,
        function_name,
        trigger_type,
        update_columns,
      ]) => ({
        table_name,
        trigger_name,
        function_name,
        enabled: true,
        trigger_type,
        update_columns,
        trigger_args_hex: "",
        when_clause: null,
      }),
    )
    .sort((left, right) => {
      const leftKey = `${left.table_name}\0${left.trigger_name}`;
      const rightKey = `${right.table_name}\0${right.trigger_name}`;
      return leftKey === rightKey ? 0 : leftKey < rightKey ? -1 : 1;
    });
  assert.deepEqual(specialGuards.rows, expectedSpecialGuards);
  assert.equal(
    Number(
      (
        await client.query(`SELECT count(*)
          FROM pg_catalog.pg_trigger AS guard
          JOIN pg_catalog.pg_class AS relation ON relation.oid=guard.tgrelid
          JOIN pg_catalog.pg_namespace AS namespace
            ON namespace.oid=relation.relnamespace
          WHERE namespace.nspname='public' AND NOT guard.tgisinternal`)
      ).rows[0].count,
    ),
    (retentionCompletionExpected ? 153 : tenderContextExpected ? 147 : 116) +
      (deliverySourceReleaseBoundaryExpected ? 15 : 0),
    "the public security-trigger inventory must be exact",
  );

  const functionProofs = await client.query(
    `SELECT routine.proname::text AS function_name,
       language.lanname::text AS language_name,
       routine.prokind::text AS function_kind,
       routine.prosecdef AS security_definer,
       routine.proleakproof AS leakproof,
       routine.proisstrict AS strict,
       routine.provolatile::text AS volatility,
       routine.proparallel::text AS parallel_safety,
       COALESCE(pg_catalog.array_to_string(routine.proconfig,','),'')
         AS function_config,
       routine.prorettype='pg_catalog.trigger'::pg_catalog.regtype
         AS returns_trigger,
       routine.pronargs::integer AS argument_count,
       COALESCE((
         SELECT pg_catalog.string_agg(
           pg_catalog.format_type(argument_type.type_oid,NULL),
           ',' ORDER BY argument_type.ordinality
         )
         FROM pg_catalog.unnest(routine.proargtypes::oid[])
           WITH ORDINALITY AS argument_type(type_oid,ordinality)
       ),'') AS argument_types,
       pg_catalog.pg_get_function_identity_arguments(routine.oid)
         AS identity_arguments,
       pg_catalog.format_type(routine.prorettype,NULL) AS return_type,
       pg_catalog.pg_get_function_result(routine.oid) AS function_result,
       routine.proretset AS returns_set,
       pg_catalog.pg_get_userbyid(routine.proowner)='valo_app_runtime'
         AS owner_is_runtime,
       CASE WHEN $1::pg_catalog.oid IS NULL THEN NULL
         ELSE pg_catalog.has_function_privilege(
           $1::pg_catalog.oid,routine.oid,'EXECUTE'
         )
       END AS runtime_can_execute,
       EXISTS (
         SELECT 1
         FROM pg_catalog.aclexplode(COALESCE(
           routine.proacl,
           pg_catalog.acldefault('f',routine.proowner)
         )) AS function_acl
         WHERE function_acl.grantee=0
           AND function_acl.privilege_type='EXECUTE'
       ) AS public_can_execute,
       routine.prosrc AS function_source
     FROM pg_catalog.pg_proc AS routine
     JOIN pg_catalog.pg_namespace AS routine_namespace
       ON routine_namespace.oid=routine.pronamespace
     JOIN pg_catalog.pg_language AS language ON language.oid=routine.prolang
     WHERE routine_namespace.nspname='valo_security'
       AND routine.proname IN (
         'current_organisation_id',
         'enforce_control_plane_tenant_context',
          'enforce_derived_tenant_relationship',
          'enforce_governed_state_transition',
          'enforce_retention_completion_transition',
          'enforce_tenant_parent',
          'expected_tenant_parent_edges',
          'expected_tenant_parent_edges_v10',
          'expected_tenant_parent_edges_v25',
          'purge_retention_project',
          'reject_active_audit_mutation',
          'reject_legacy_audit_mutation',
          'reject_tenant_identity_reassignment',
          'reject_versioned_record_content_mutation',
          'set_current_organisation_id'
       )
     ORDER BY function_name`,
    [runtimeRoleOid],
  );
  const normalizedFunctionProofs = functionProofs.rows.map(
    ({ function_source, ...proof }) => ({
      ...proof,
      source_sha256: sha256(function_source.replaceAll("\r\n", "\n").trim()),
    }),
  );
  assert.deepEqual(normalizedFunctionProofs, [
    {
      function_name: "current_organisation_id",
      language_name: "sql",
      function_kind: "f",
      security_definer: false,
      leakproof: false,
      strict: false,
      volatility: "s",
      parallel_safety: "s",
      function_config: "search_path=pg_catalog",
      returns_trigger: false,
      argument_count: 0,
      argument_types: "",
      identity_arguments: "",
      return_type: "uuid",
      function_result: "uuid",
      returns_set: false,
      owner_is_runtime: false,
      runtime_can_execute: expectedRuntimeExecute(true),
      public_can_execute: true,
      source_sha256:
        "14ef09278baa44a810e11c0e51bd46219f617a34a46c5b41786960d0fccd6be9",
    },
    {
      function_name: "enforce_control_plane_tenant_context",
      language_name: "plpgsql",
      function_kind: "f",
      security_definer: false,
      leakproof: false,
      strict: false,
      volatility: "v",
      parallel_safety: "u",
      function_config: "search_path=pg_catalog",
      returns_trigger: true,
      argument_count: 0,
      argument_types: "",
      identity_arguments: "",
      return_type: "trigger",
      function_result: "trigger",
      returns_set: false,
      owner_is_runtime: false,
      runtime_can_execute: expectedRuntimeExecute(false),
      public_can_execute: false,
      source_sha256:
        "4730f140c8ceae6c51cf420fc08d0543a162d88ca25c3dfe85c8a1379bed7345",
    },
    {
      function_name: "enforce_derived_tenant_relationship",
      language_name: "plpgsql",
      function_kind: "f",
      security_definer: false,
      leakproof: false,
      strict: false,
      volatility: "v",
      parallel_safety: "u",
      function_config: "search_path=pg_catalog",
      returns_trigger: true,
      argument_count: 0,
      argument_types: "",
      identity_arguments: "",
      return_type: "trigger",
      function_result: "trigger",
      returns_set: false,
      owner_is_runtime: false,
      runtime_can_execute: expectedRuntimeExecute(false),
      public_can_execute: false,
      source_sha256:
        "fb56a447849fcc09a0e9a7fa240bc47c6826b8ab6112b3b4ec5448ca3fe554b7",
    },
    ...(tenderContextExpected
      ? [
          {
            function_name: "enforce_governed_state_transition",
            language_name: "plpgsql",
            function_kind: "f",
            security_definer: false,
            leakproof: false,
            strict: false,
            volatility: "v",
            parallel_safety: "u",
            function_config: "search_path=pg_catalog",
            returns_trigger: true,
            argument_count: 0,
            argument_types: "",
            identity_arguments: "",
            return_type: "trigger",
            function_result: "trigger",
            returns_set: false,
            owner_is_runtime: false,
            runtime_can_execute: expectedRuntimeExecute(false),
            public_can_execute: false,
            source_sha256:
              "fc3ca21f64494b959a808a781d490d04306c9acb6fcb7604692c4f3418848ce2",
          },
        ]
      : []),
    ...(retentionCompletionExpected
      ? [
          {
            function_name: "enforce_retention_completion_transition",
            language_name: "plpgsql",
            function_kind: "f",
            security_definer: false,
            leakproof: false,
            strict: false,
            volatility: "v",
            parallel_safety: "u",
            function_config: "search_path=pg_catalog",
            returns_trigger: true,
            argument_count: 0,
            argument_types: "",
            identity_arguments: "",
            return_type: "trigger",
            function_result: "trigger",
            returns_set: false,
            owner_is_runtime: false,
            runtime_can_execute: expectedRuntimeExecute(false),
            public_can_execute: false,
            source_sha256:
              "61009cea8a4bbbe066a3be5682fb1155503d11deff956bdb3691cac9ccb444c5",
          },
        ]
      : []),
    {
      function_name: "enforce_tenant_parent",
      language_name: "plpgsql",
      function_kind: "f",
      security_definer: false,
      leakproof: false,
      strict: false,
      volatility: "v",
      parallel_safety: "u",
      function_config: "search_path=pg_catalog",
      returns_trigger: true,
      argument_count: 0,
      argument_types: "",
      identity_arguments: "",
      return_type: "trigger",
      function_result: "trigger",
      returns_set: false,
      owner_is_runtime: false,
      runtime_can_execute: expectedRuntimeExecute(false),
      public_can_execute: false,
      source_sha256:
        "36feb19977974453f49460dcca3c1f41204ebaae57294439508b861499832b26",
    },
    {
      function_name: "expected_tenant_parent_edges",
      language_name: "sql",
      function_kind: "f",
      security_definer: false,
      leakproof: false,
      strict: false,
      volatility: "i",
      parallel_safety: "u",
      function_config: "search_path=pg_catalog",
      returns_trigger: false,
      argument_count: 0,
      argument_types: "",
      identity_arguments: "",
      return_type: "record",
      function_result:
        "TABLE(child_table text, child_column text, parent_table text, parent_column text, allow_global_parent boolean)",
      returns_set: true,
      owner_is_runtime: false,
      runtime_can_execute: expectedRuntimeExecute(false),
      public_can_execute: false,
      source_sha256: retentionCompletionExpected
        ? "60114030c0143b63cdc870d34d2436f591d5f87a67a4d9dc1c810a2aa385b775"
        : tenderContextExpected
          ? "9a7fe7e15ae45587b7326d1d648585714ee690da0f860816da1dece2201b5768"
          : "bdc81a7d7148b2c016226525c3907ab30c975c59cea4e51839dad4baff842f70",
    },
    ...(retentionCompletionExpected
      ? [
          {
            function_name: "expected_tenant_parent_edges_v10",
            language_name: "sql",
            function_kind: "f",
            security_definer: false,
            leakproof: false,
            strict: false,
            volatility: "i",
            parallel_safety: "u",
            function_config: "search_path=pg_catalog",
            returns_trigger: false,
            argument_count: 0,
            argument_types: "",
            identity_arguments: "",
            return_type: "record",
            function_result:
              "TABLE(child_table text, child_column text, parent_table text, parent_column text, allow_global_parent boolean)",
            returns_set: true,
            owner_is_runtime: false,
            runtime_can_execute: expectedRuntimeExecute(false),
            public_can_execute: false,
            source_sha256:
              "9a7fe7e15ae45587b7326d1d648585714ee690da0f860816da1dece2201b5768",
          },
        ]
      : []),
    ...(tenderContextExpected
      ? [
          {
            function_name: "expected_tenant_parent_edges_v25",
            language_name: "sql",
            function_kind: "f",
            security_definer: false,
            leakproof: false,
            strict: false,
            volatility: "i",
            parallel_safety: "u",
            function_config: "search_path=pg_catalog",
            returns_trigger: false,
            argument_count: 0,
            argument_types: "",
            identity_arguments: "",
            return_type: "record",
            function_result:
              "TABLE(child_table text, child_column text, parent_table text, parent_column text, allow_global_parent boolean)",
            returns_set: true,
            owner_is_runtime: false,
            runtime_can_execute: expectedRuntimeExecute(false),
            public_can_execute: false,
            source_sha256:
              "bdc81a7d7148b2c016226525c3907ab30c975c59cea4e51839dad4baff842f70",
          },
        ]
      : []),
    ...(retentionCompletionExpected
      ? [
          {
            function_name: "purge_retention_project",
            language_name: "plpgsql",
            function_kind: "f",
            security_definer: true,
            leakproof: false,
            strict: false,
            volatility: "v",
            parallel_safety: "u",
            function_config: "search_path=pg_catalog",
            returns_trigger: false,
            argument_count: 6,
            argument_types: "uuid,uuid,uuid,uuid,text,integer",
            identity_arguments:
              "p_organisation_id uuid, p_retention_request_id uuid, p_retention_action_id uuid, p_subject_project_id uuid, p_source_manifest_sha256 text, p_expected_action_version integer",
            return_type: "record",
            function_result:
              "TABLE(deleted_project_rows integer, deleted_document_version_snapshot_rows integer, detached_legal_hold_rows integer, detached_order_rows integer, detached_entitlement_usage_rows integer, purge_receipt_sha256 text, post_purge_action_version integer)",
            returns_set: true,
            owner_is_runtime: false,
            runtime_can_execute: expectedRuntimeExecute(false),
            public_can_execute: false,
            source_sha256:
              "ccbb687b1cb2dd9472204fe61b7781eda749fa22671d6859963954c3ca85a8fa",
          },
        ]
      : []),
    {
      function_name: "reject_active_audit_mutation",
      language_name: "plpgsql",
      function_kind: "f",
      security_definer: false,
      leakproof: false,
      strict: false,
      volatility: "v",
      parallel_safety: "u",
      function_config: "search_path=pg_catalog",
      returns_trigger: true,
      argument_count: 0,
      argument_types: "",
      identity_arguments: "",
      return_type: "trigger",
      function_result: "trigger",
      returns_set: false,
      owner_is_runtime: false,
      runtime_can_execute: expectedRuntimeExecute(false),
      public_can_execute: false,
      source_sha256:
        "496ccf2ad11c615af5c4bfd52b8566e3b10f94cf05919eec61588c834b380241",
    },
    {
      function_name: "reject_legacy_audit_mutation",
      language_name: "plpgsql",
      function_kind: "f",
      security_definer: false,
      leakproof: false,
      strict: false,
      volatility: "v",
      parallel_safety: "u",
      function_config: "search_path=pg_catalog",
      returns_trigger: true,
      argument_count: 0,
      argument_types: "",
      identity_arguments: "",
      return_type: "trigger",
      function_result: "trigger",
      returns_set: false,
      owner_is_runtime: false,
      runtime_can_execute: expectedRuntimeExecute(false),
      public_can_execute: false,
      source_sha256:
        "7503978cb1f4568b2eb16020769f4eb2e9444daf843c9c28c24d8c7ffda59321",
    },
    {
      function_name: "reject_tenant_identity_reassignment",
      language_name: "plpgsql",
      function_kind: "f",
      security_definer: false,
      leakproof: false,
      strict: false,
      volatility: "v",
      parallel_safety: "u",
      function_config: "search_path=pg_catalog",
      returns_trigger: true,
      argument_count: 0,
      argument_types: "",
      identity_arguments: "",
      return_type: "trigger",
      function_result: "trigger",
      returns_set: false,
      owner_is_runtime: false,
      runtime_can_execute: expectedRuntimeExecute(false),
      public_can_execute: false,
      source_sha256:
        "f574951920d2182028bded7bdca95912f4d775f1abab2adc621f447614217793",
    },
    ...(tenderContextExpected
      ? [
          {
            function_name: "reject_versioned_record_content_mutation",
            language_name: "plpgsql",
            function_kind: "f",
            security_definer: false,
            leakproof: false,
            strict: false,
            volatility: "v",
            parallel_safety: "u",
            function_config: "search_path=pg_catalog",
            returns_trigger: true,
            argument_count: 0,
            argument_types: "",
            identity_arguments: "",
            return_type: "trigger",
            function_result: "trigger",
            returns_set: false,
            owner_is_runtime: false,
            runtime_can_execute: expectedRuntimeExecute(false),
            public_can_execute: false,
            source_sha256:
              "ef751ed465bb43c61792f37d58ba9f4c8eb60f7bdbb33d1c7f5d4bec72bf028e",
          },
        ]
      : []),
    {
      function_name: "set_current_organisation_id",
      language_name: "plpgsql",
      function_kind: "f",
      security_definer: false,
      leakproof: false,
      strict: false,
      volatility: "v",
      parallel_safety: "u",
      function_config: "search_path=pg_catalog",
      returns_trigger: false,
      argument_count: 1,
      argument_types: "uuid",
      identity_arguments: "p_organisation_id uuid",
      return_type: "void",
      function_result: "void",
      returns_set: false,
      owner_is_runtime: false,
      runtime_can_execute: expectedRuntimeExecute(true),
      public_can_execute: true,
      source_sha256:
        "3019b61a9be108a48506120795cb13f88ed30dd6f745f4772b11973d2764b84e",
    },
  ]);

  const serverVersion = Number(
    (await client.query("SHOW server_version_num")).rows[0].server_version_num,
  );
  assert.equal(Math.trunc(serverVersion / 10_000), 16);
  const rlsCatalog = await client.query(`
    SELECT relation.relname::text AS table_name,
      relation.relrowsecurity AS enabled,
      relation.relforcerowsecurity AS forced
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid=relation.relnamespace
    WHERE namespace.nspname='public' AND relation.relkind IN ('r','p')
    ORDER BY table_name
  `);
  assert.equal(
    rlsCatalog.rows.length,
    (productionAssuranceExpected ? 97 : 96) +
      (retrievalRegistryExpected ? 1 : 0) +
      (tenderContextExpected ? 7 : 0) +
      (retentionCompletionExpected ? 1 : 0),
    productionAssuranceExpected
      ? "the post-0008 catalog must include the authenticated rate-limit table"
      : "the pre-0008 catalog must not include the authenticated rate-limit table",
  );
  assert.deepEqual(
    rlsCatalog.rows.find((row) => row.table_name === "ai_retrieval_registry"),
    retrievalRegistryExpected
      ? {
          table_name: "ai_retrieval_registry",
          enabled: false,
          forced: false,
        }
      : undefined,
    "the retrieval registry table must stay a global, non-RLS control-plane table",
  );
  assert.deepEqual(
    rlsCatalog.rows.find(
      (row) => row.table_name === "authenticated_rate_limit_buckets",
    ),
    productionAssuranceExpected
      ? {
          table_name: "authenticated_rate_limit_buckets",
          enabled: true,
          forced: true,
        }
      : undefined,
  );
  assert.deepEqual(
    rlsCatalog.rows.filter((row) =>
      TENDER_CONTEXT_TABLES.includes(row.table_name),
    ),
    tenderContextExpected
      ? TENDER_CONTEXT_TABLES.map((table_name) => ({
          table_name,
          enabled: true,
          forced: true,
        }))
      : [],
    "all 0010 tenant tables must have exact FORCE RLS state",
  );
  assert.deepEqual(
    rlsCatalog.rows.filter((row) =>
      RETENTION_COMPLETION_TABLES.includes(row.table_name),
    ),
    retentionCompletionExpected
      ? RETENTION_COMPLETION_TABLES.map((table_name) => ({
          table_name,
          enabled: true,
          forced: true,
        }))
      : [],
    "the 0011 retention binding table must have exact FORCE RLS state",
  );
  const pinnedRlsCatalogRows = rlsCatalog.rows.filter(
    (row) =>
      row.table_name !== "authenticated_rate_limit_buckets" &&
      row.table_name !== "ai_retrieval_registry" &&
      !TENDER_CONTEXT_TABLES.includes(row.table_name) &&
      !RETENTION_COMPLETION_TABLES.includes(row.table_name),
  );
  assert.equal(
    sha256(
      pinnedRlsCatalogRows
        .map((row) => JSON.stringify([row.table_name, row.enabled, row.forced]))
        .sort()
        .join("\n"),
    ),
    EXPECTED_RLS_TABLE_CATALOG_SHA256,
  );
  assert.equal(
    sha256(
      pinnedRlsCatalogRows
        .filter((row) => row.enabled && row.forced)
        .map((row) => row.table_name)
        .sort()
        .join("\n"),
    ),
    EXPECTED_FORCE_RLS_TABLE_NAMES_SHA256,
  );
  const policies = await client.query(`
    SELECT relation.relname::text AS table_name,
      policy.polname::text AS policy_name,
      policy.polpermissive AS permissive,
      policy.polcmd::text AS command,
      ARRAY(
        SELECT CASE
          WHEN selected_role.role_oid=0 THEN 'PUBLIC'
          ELSE role.rolname::text
        END
        FROM pg_catalog.unnest(policy.polroles) AS selected_role(role_oid)
        LEFT JOIN pg_catalog.pg_roles AS role
          ON role.oid=selected_role.role_oid
        ORDER BY 1
      ) AS role_names,
      COALESCE(
        pg_catalog.pg_get_expr(policy.polqual,policy.polrelid,false),''
      ) AS using_expression,
      COALESCE(
        pg_catalog.pg_get_expr(policy.polwithcheck,policy.polrelid,false),''
      ) AS check_expression
    FROM pg_catalog.pg_policy AS policy
    JOIN pg_catalog.pg_class AS relation ON relation.oid=policy.polrelid
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid=relation.relnamespace
    WHERE namespace.nspname='public'
    ORDER BY table_name,policy_name
  `);
  assert.equal(
    policies.rows.length,
    (productionAssuranceExpected ? 105 : 104) +
      (tenderContextExpected ? 7 : 0) +
      (retentionCompletionExpected ? 1 : 0),
    productionAssuranceExpected
      ? "the post-0008 catalog must include the authenticated rate-limit policy"
      : "the pre-0008 catalog must not include the authenticated rate-limit policy",
  );
  assert.deepEqual(
    policies.rows.find(
      (policy) => policy.table_name === "authenticated_rate_limit_buckets",
    ),
    productionAssuranceExpected
      ? {
          table_name: "authenticated_rate_limit_buckets",
          policy_name: "tenant_isolation",
          permissive: true,
          command: "*",
          role_names: ["PUBLIC"],
          using_expression:
            "(organisation_id = valo_security.current_organisation_id())",
          check_expression:
            "(organisation_id = valo_security.current_organisation_id())",
        }
      : undefined,
  );
  const expectedTenantPolicy = (table_name) => ({
    table_name,
    policy_name: "tenant_isolation",
    permissive: true,
    command: "*",
    role_names: ["PUBLIC"],
    using_expression:
      "(organisation_id = valo_security.current_organisation_id())",
    check_expression:
      "(organisation_id = valo_security.current_organisation_id())",
  });
  assert.deepEqual(
    policies.rows.filter((policy) =>
      TENDER_CONTEXT_TABLES.includes(policy.table_name),
    ),
    tenderContextExpected
      ? TENDER_CONTEXT_TABLES.map(expectedTenantPolicy)
      : [],
    "all 0010 tenant tables must have the exact tenant-isolation policy",
  );
  assert.deepEqual(
    policies.rows.filter((policy) =>
      RETENTION_COMPLETION_TABLES.includes(policy.table_name),
    ),
    retentionCompletionExpected
      ? RETENTION_COMPLETION_TABLES.map(expectedTenantPolicy)
      : [],
    "the 0011 binding table must have the exact tenant-isolation policy",
  );
  assert.equal(
    sha256(
      policies.rows
        .filter(
          (policy) =>
            policy.table_name !== "authenticated_rate_limit_buckets" &&
            !TENDER_CONTEXT_TABLES.includes(policy.table_name) &&
            !RETENTION_COMPLETION_TABLES.includes(policy.table_name),
        )
        .map((policy) =>
          JSON.stringify([
            policy.table_name,
            policy.policy_name,
            policy.permissive,
            policy.command,
            policy.role_names,
            policy.using_expression,
            policy.check_expression,
          ]),
        )
        .sort()
        .join("\n"),
    ),
    EXPECTED_POLICY_CATALOG_SHA256,
  );
}

async function assertTenantGuardCatalog(
  client,
  {
    runtimeRoleExpected = true,
    productionAssuranceExpected = true,
    retrievalRegistryExpected = true,
    tenderContextExpected = true,
    retentionCompletionExpected = true,
  } = {},
) {
  await client.query(
    "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
  );
  try {
    await client.query("SET LOCAL search_path=pg_catalog");
    await assertTenantGuardCatalogInSnapshot(client, {
      runtimeRoleExpected,
      productionAssuranceExpected,
      retrievalRegistryExpected,
      tenderContextExpected,
      retentionCompletionExpected,
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

const RUNTIME_GLOBAL_IDS = Object.freeze({
  prompt: runtimeFixtureId(2001),
  priceBook: runtimeFixtureId(2002),
  priceBookEntry: runtimeFixtureId(2003),
});

async function seedGlobalRuntimeControls(owner) {
  assert.equal(
    (
      await owner.query(
        `INSERT INTO public.prompt_configurations
      (id,organisation_id,task,prompt_version,template_hash,schema_version,status)
     VALUES ($1::uuid,NULL,'synthetic-global-prompt',1,$2,'fixture-v1','active')`,
        [RUNTIME_GLOBAL_IDS.prompt, "a".repeat(64)],
      )
    ).rowCount,
    1,
  );
  assert.equal(
    (
      await owner.query(
        `INSERT INTO public.price_books
      (id,organisation_id,name,version_number,status,effective_from)
     VALUES ($1::uuid,NULL,'Synthetic global price book',1,'active',$2::timestamptz)`,
        [RUNTIME_GLOBAL_IDS.priceBook, FIXED_TIME],
      )
    ).rowCount,
    1,
  );
  assert.equal(
    (
      await owner.query(
        `INSERT INTO public.price_book_entries
      (id,price_book_id,product_code,product_kind,currency,amount_minor)
     VALUES ($1::uuid,$2::uuid,'SYNTHETIC-GLOBAL','one_off','NGN',1000)`,
        [RUNTIME_GLOBAL_IDS.priceBookEntry, RUNTIME_GLOBAL_IDS.priceBook],
      )
    ).rowCount,
    1,
  );
}

async function removeGlobalRuntimeControls(owner, expectPresent) {
  const entry = await owner.query(
    "DELETE FROM public.price_book_entries WHERE id=$1::uuid",
    [RUNTIME_GLOBAL_IDS.priceBookEntry],
  );
  const book = await owner.query(
    "DELETE FROM public.price_books WHERE id=$1::uuid",
    [RUNTIME_GLOBAL_IDS.priceBook],
  );
  const prompt = await owner.query(
    "DELETE FROM public.prompt_configurations WHERE id=$1::uuid",
    [RUNTIME_GLOBAL_IDS.prompt],
  );
  if (expectPresent) {
    assert.deepEqual(
      [entry.rowCount, book.rowCount, prompt.rowCount],
      [1, 1, 1],
      "runtime matrix global controls must be removed exactly once",
    );
  }
}

async function assertRuntimeTenantRelationshipMatrix(
  runtime,
  { tenantB, projectB, requirementB },
) {
  const fixture = Object.freeze({
    documentB: runtimeFixtureId(1001),
    evidenceA: runtimeFixtureId(1002),
    evidenceB: runtimeFixtureId(1003),
    deniedEvidenceAProject: runtimeFixtureId(1004),
    deniedEvidenceARequirement: runtimeFixtureId(1005),
    deniedEvidenceADocument: runtimeFixtureId(1006),
    deniedEvidenceBProject: runtimeFixtureId(1007),
    deniedEvidenceBRequirement: runtimeFixtureId(1008),
    deniedEvidenceBDocument: runtimeFixtureId(1009),
    promptA: runtimeFixtureId(1010),
    promptB: runtimeFixtureId(1011),
    evaluationASame: runtimeFixtureId(1012),
    evaluationAGlobal: runtimeFixtureId(1013),
    evaluationBSame: runtimeFixtureId(1014),
    evaluationBGlobal: runtimeFixtureId(1015),
    deniedEvaluationA: runtimeFixtureId(1016),
    deniedEvaluationB: runtimeFixtureId(1017),
    priceBookA: runtimeFixtureId(1020),
    priceBookEntryA: runtimeFixtureId(1021),
    priceBookB: runtimeFixtureId(1022),
    priceBookEntryB: runtimeFixtureId(1023),
    orderA: runtimeFixtureId(1024),
    orderAGlobal: runtimeFixtureId(1025),
    orderB: runtimeFixtureId(1026),
    orderBGlobal: runtimeFixtureId(1027),
    deniedOrderA: runtimeFixtureId(1028),
    deniedOrderB: runtimeFixtureId(1029),
    subscriptionA: runtimeFixtureId(1030),
    subscriptionAGlobal: runtimeFixtureId(1031),
    subscriptionB: runtimeFixtureId(1032),
    subscriptionBGlobal: runtimeFixtureId(1033),
    deniedSubscriptionA: runtimeFixtureId(1034),
    deniedSubscriptionB: runtimeFixtureId(1035),
    invoiceA: runtimeFixtureId(1040),
    invoiceB: runtimeFixtureId(1041),
    invoiceLineA: runtimeFixtureId(1042),
    invoiceLineB: runtimeFixtureId(1043),
    deniedInvoiceLineA: runtimeFixtureId(1044),
    deniedInvoiceLineB: runtimeFixtureId(1045),
    userA: runtimeFixtureId(1050),
    userADenied: runtimeFixtureId(1051),
    userB: runtimeFixtureId(1052),
    userBDelegated: runtimeFixtureId(1053),
    userBDenied: runtimeFixtureId(1054),
    membershipA: runtimeFixtureId(1055),
    membershipB: runtimeFixtureId(1056),
    membershipBDelegated: runtimeFixtureId(1057),
    deniedMembershipA: runtimeFixtureId(1058),
    deniedMembershipB: runtimeFixtureId(1059),
    roleGrantA: runtimeFixtureId(1060),
    roleGrantB: runtimeFixtureId(1061),
    deniedRoleGrantA: runtimeFixtureId(1062),
    deniedRoleGrantB: runtimeFixtureId(1063),
    relationshipAB: runtimeFixtureId(1070),
    relationshipBA: runtimeFixtureId(1071),
    revenueAB: runtimeFixtureId(1072),
    revenueBA: runtimeFixtureId(1073),
    deniedRevenueAB: runtimeFixtureId(1074),
    deniedRevenueBA: runtimeFixtureId(1075),
    deniedRevenueABRelationship: runtimeFixtureId(1076),
    foreignMembershipA: runtimeFixtureId(1077),
    foreignRoleGrantA: runtimeFixtureId(1078),
    breakGlassB: runtimeFixtureId(1079),
    deniedBreakGlassA: runtimeFixtureId(1080),
    deniedOrganisation: runtimeFixtureId(1081),
  });

  assert.equal(
    (
      await runtime.query(
        `INSERT INTO public.users
          (id,clerk_user_id,email,name,role,status)
         VALUES
          ($1::uuid,'synthetic-matrix-user-a','matrix-user-a@synthetic.invalid','Synthetic matrix user A','none','active'),
          ($2::uuid,'synthetic-matrix-user-a-denied','matrix-user-a-denied@synthetic.invalid','Synthetic denied user A','none','active'),
          ($3::uuid,'synthetic-matrix-user-b','matrix-user-b@synthetic.invalid','Synthetic matrix user B','none','active'),
          ($4::uuid,'synthetic-matrix-user-b-delegated','matrix-user-b-delegated@synthetic.invalid','Synthetic delegated user B','none','active'),
          ($5::uuid,'synthetic-matrix-user-b-denied','matrix-user-b-denied@synthetic.invalid','Synthetic denied user B','none','active')`,
        [
          fixture.userA,
          fixture.userADenied,
          fixture.userB,
          fixture.userBDelegated,
          fixture.userBDenied,
        ],
      )
    ).rowCount,
    5,
  );

  await runtime.query(
    "SELECT valo_security.set_current_organisation_id($1::uuid)",
    [ORGANISATION_ID],
  );
  assert.equal(
    (
      await runtime.query(
        `INSERT INTO public.organisation_memberships
          (id,organisation_id,user_id,status,delegated_by_membership_id)
         VALUES ($1::uuid,$2::uuid,$3::uuid,'active',$4::uuid)`,
        [fixture.membershipA, ORGANISATION_ID, fixture.userA, IDS.admin],
      )
    ).rowCount,
    1,
  );
  assert.equal(
    (
      await runtime.query(
        `INSERT INTO public.role_grants
          (id,membership_id,role,granted_by_membership_id)
         VALUES ($1::uuid,$2::uuid,'valo_analyst',$3::uuid)`,
        [fixture.roleGrantA, fixture.membershipA, IDS.admin],
      )
    ).rowCount,
    1,
  );
  await runtime.query(
    `INSERT INTO public.prompt_configurations
      (id,organisation_id,task,prompt_version,template_hash,schema_version,status)
     VALUES ($1::uuid,$2::uuid,'synthetic-tenant-a-prompt',1,$3,'fixture-v1','active')`,
    [fixture.promptA, ORGANISATION_ID, "b".repeat(64)],
  );
  assert.equal(
    (
      await runtime.query(
        `INSERT INTO public.evaluation_runs
          (id,organisation_id,task,corpus_version,prompt_configuration_id)
         VALUES
          ($1::uuid,$2::uuid,'synthetic-a-same','fixture-v1',$3::uuid),
          ($4::uuid,$2::uuid,'synthetic-a-global','fixture-v1',$5::uuid)`,
        [
          fixture.evaluationASame,
          ORGANISATION_ID,
          fixture.promptA,
          fixture.evaluationAGlobal,
          RUNTIME_GLOBAL_IDS.prompt,
        ],
      )
    ).rowCount,
    2,
    "tenant A must use both same-tenant and global prompt configurations",
  );
  await runtime.query(
    `INSERT INTO public.price_books
      (id,organisation_id,name,version_number,status,effective_from)
     VALUES ($1::uuid,$2::uuid,'Synthetic tenant A price book',1,'active',$3::timestamptz)`,
    [fixture.priceBookA, ORGANISATION_ID, FIXED_TIME],
  );
  await runtime.query(
    `INSERT INTO public.price_book_entries
      (id,price_book_id,product_code,product_kind,currency,amount_minor)
     VALUES ($1::uuid,$2::uuid,'SYNTHETIC-A','one_off','NGN',1200)`,
    [fixture.priceBookEntryA, fixture.priceBookA],
  );
  assert.equal(
    (
      await runtime.query(
        `INSERT INTO public.orders
          (id,organisation_id,project_id,price_book_entry_id,unit_amount_minor,
           total_amount_minor,currency,idempotency_key,placed_by_user_id)
         VALUES
          ($1::uuid,$2::uuid,$3::uuid,$4::uuid,1200,1200,'NGN','synthetic-order-a',$5::uuid),
          ($6::uuid,$2::uuid,$3::uuid,$7::uuid,1000,1000,'NGN','synthetic-order-a-global',$5::uuid)`,
        [
          fixture.orderA,
          ORGANISATION_ID,
          IDS.project,
          fixture.priceBookEntryA,
          IDS.admin,
          fixture.orderAGlobal,
          RUNTIME_GLOBAL_IDS.priceBookEntry,
        ],
      )
    ).rowCount,
    2,
    "tenant A must order from both same-tenant and global price books",
  );
  assert.equal(
    (
      await runtime.query(
        `INSERT INTO public.subscriptions
          (id,organisation_id,price_book_entry_id,status,starts_at)
         VALUES
          ($1::uuid,$2::uuid,$3::uuid,'active',$4::timestamptz),
          ($5::uuid,$2::uuid,$6::uuid,'active',$4::timestamptz)`,
        [
          fixture.subscriptionA,
          ORGANISATION_ID,
          fixture.priceBookEntryA,
          FIXED_TIME,
          fixture.subscriptionAGlobal,
          RUNTIME_GLOBAL_IDS.priceBookEntry,
        ],
      )
    ).rowCount,
    2,
  );
  await runtime.query(
    `INSERT INTO public.invoices
      (id,organisation_id,invoice_number,currency,net_amount_minor,
       vat_rate_basis_points,vat_amount_minor,gross_amount_minor,
       net_payable_minor,tax_rule_id,tax_point_at)
     VALUES ($1::uuid,$2::uuid,'SYNTHETIC-A-1','NGN',1200,0,0,1200,1200,
       'synthetic-tax',$3::timestamptz)`,
    [fixture.invoiceA, ORGANISATION_ID, FIXED_TIME],
  );
  await runtime.query(
    `INSERT INTO public.invoice_lines
      (id,invoice_id,order_id,description,quantity,unit_amount_minor,line_amount_minor)
     VALUES ($1::uuid,$2::uuid,$3::uuid,'Synthetic tenant A line',1,1200,1200)`,
    [fixture.invoiceLineA, fixture.invoiceA, fixture.orderA],
  );
  await runtime.query(
    `INSERT INTO public.evidence_items
      (id,organisation_id,project_id,requirement_id,document_id,evidence_status)
     VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,'confirmed')`,
    [
      fixture.evidenceA,
      ORGANISATION_ID,
      IDS.project,
      IDS.requirement,
      IDS.document,
    ],
  );

  await runtime.query(
    "SELECT valo_security.set_current_organisation_id($1::uuid)",
    [tenantB],
  );
  assert.equal(
    (
      await runtime.query(
        `INSERT INTO public.organisation_memberships
          (id,organisation_id,user_id,status,delegated_by_membership_id)
         VALUES
          ($1::uuid,$2::uuid,$3::uuid,'active',NULL),
          ($4::uuid,$2::uuid,$5::uuid,'active',$1::uuid)`,
        [
          fixture.membershipB,
          tenantB,
          fixture.userB,
          fixture.membershipBDelegated,
          fixture.userBDelegated,
        ],
      )
    ).rowCount,
    2,
    "same-tenant membership delegation must succeed",
  );
  await runtime.query(
    `INSERT INTO public.role_grants
      (id,membership_id,role,granted_by_membership_id)
     VALUES ($1::uuid,$2::uuid,'valo_analyst',$3::uuid)`,
    [fixture.roleGrantB, fixture.membershipBDelegated, fixture.membershipB],
  );
  await runtime.query(
    `INSERT INTO public.break_glass_sessions
      (id,target_organisation_id,requested_by_user_id,reason,
       incident_reference,requested_permissions,status,expires_at)
     VALUES ($1::uuid,$2::uuid,$3::uuid,
       'Synthetic break-glass request for tenant-context verification',
       'SYNTHETIC-BG-B','["audit:read"]','pending',$4::timestamptz)`,
    [fixture.breakGlassB, tenantB, fixture.userB, "2026-02-15T12:00:00.000Z"],
  );
  assert.equal(
    (
      await runtime.query(
        "UPDATE public.organisation_memberships SET status=status WHERE id=$1::uuid",
        [fixture.membershipB],
      )
    ).rowCount,
    1,
    "tenant B must update its own membership",
  );
  assert.equal(
    (
      await runtime.query(
        "UPDATE public.break_glass_sessions SET status=status WHERE id=$1::uuid",
        [fixture.breakGlassB],
      )
    ).rowCount,
    1,
    "tenant B must update its own break-glass session",
  );
  await runtime.query(
    `INSERT INTO public.documents
      (id,organisation_id,project_id,type,filename,object_path)
     VALUES ($1::uuid,$2::uuid,$3::uuid,'other','synthetic-b.txt','synthetic/b.txt')`,
    [fixture.documentB, tenantB, projectB],
  );
  await runtime.query(
    `INSERT INTO public.evidence_items
      (id,organisation_id,project_id,requirement_id,document_id,evidence_status)
     VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,'confirmed')`,
    [fixture.evidenceB, tenantB, projectB, requirementB, fixture.documentB],
  );
  await runtime.query(
    `INSERT INTO public.prompt_configurations
      (id,organisation_id,task,prompt_version,template_hash,schema_version,status)
     VALUES ($1::uuid,$2::uuid,'synthetic-tenant-b-prompt',1,$3,'fixture-v1','active')`,
    [fixture.promptB, tenantB, "c".repeat(64)],
  );
  assert.equal(
    (
      await runtime.query(
        `INSERT INTO public.evaluation_runs
          (id,organisation_id,task,corpus_version,prompt_configuration_id)
         VALUES
          ($1::uuid,$2::uuid,'synthetic-b-same','fixture-v1',$3::uuid),
          ($4::uuid,$2::uuid,'synthetic-b-global','fixture-v1',$5::uuid)`,
        [
          fixture.evaluationBSame,
          tenantB,
          fixture.promptB,
          fixture.evaluationBGlobal,
          RUNTIME_GLOBAL_IDS.prompt,
        ],
      )
    ).rowCount,
    2,
    "tenant B must use both same-tenant and global prompt configurations",
  );
  await runtime.query(
    `INSERT INTO public.price_books
      (id,organisation_id,name,version_number,status,effective_from)
     VALUES ($1::uuid,$2::uuid,'Synthetic tenant B price book',1,'active',$3::timestamptz)`,
    [fixture.priceBookB, tenantB, FIXED_TIME],
  );
  await runtime.query(
    `INSERT INTO public.price_book_entries
      (id,price_book_id,product_code,product_kind,currency,amount_minor)
     VALUES ($1::uuid,$2::uuid,'SYNTHETIC-B','one_off','NGN',1300)`,
    [fixture.priceBookEntryB, fixture.priceBookB],
  );
  assert.equal(
    (
      await runtime.query(
        `INSERT INTO public.orders
          (id,organisation_id,project_id,price_book_entry_id,unit_amount_minor,
           total_amount_minor,currency,idempotency_key,placed_by_user_id)
         VALUES
          ($1::uuid,$2::uuid,$3::uuid,$4::uuid,1300,1300,'NGN','synthetic-order-b',$5::uuid),
          ($6::uuid,$2::uuid,$3::uuid,$7::uuid,1000,1000,'NGN','synthetic-order-b-global',$5::uuid)`,
        [
          fixture.orderB,
          tenantB,
          projectB,
          fixture.priceBookEntryB,
          fixture.userB,
          fixture.orderBGlobal,
          RUNTIME_GLOBAL_IDS.priceBookEntry,
        ],
      )
    ).rowCount,
    2,
    "tenant B must order from both same-tenant and global price books",
  );
  assert.equal(
    (
      await runtime.query(
        `INSERT INTO public.subscriptions
          (id,organisation_id,price_book_entry_id,status,starts_at)
         VALUES
          ($1::uuid,$2::uuid,$3::uuid,'active',$4::timestamptz),
          ($5::uuid,$2::uuid,$6::uuid,'active',$4::timestamptz)`,
        [
          fixture.subscriptionB,
          tenantB,
          fixture.priceBookEntryB,
          FIXED_TIME,
          fixture.subscriptionBGlobal,
          RUNTIME_GLOBAL_IDS.priceBookEntry,
        ],
      )
    ).rowCount,
    2,
  );
  await runtime.query(
    `INSERT INTO public.invoices
      (id,organisation_id,invoice_number,currency,net_amount_minor,
       vat_rate_basis_points,vat_amount_minor,gross_amount_minor,
       net_payable_minor,tax_rule_id,tax_point_at)
     VALUES ($1::uuid,$2::uuid,'SYNTHETIC-B-1','NGN',1300,0,0,1300,1300,
       'synthetic-tax',$3::timestamptz)`,
    [fixture.invoiceB, tenantB, FIXED_TIME],
  );
  await runtime.query(
    `INSERT INTO public.invoice_lines
      (id,invoice_id,order_id,description,quantity,unit_amount_minor,line_amount_minor)
     VALUES ($1::uuid,$2::uuid,$3::uuid,'Synthetic tenant B line',1,1300,1300)`,
    [fixture.invoiceLineB, fixture.invoiceB, fixture.orderB],
  );

  await expectInsufficientPrivilege(
    runtime,
    "b_creates_unselected_organisation",
    `INSERT INTO public.organisations (id,name,slug,type,status,country_code)
     VALUES ($1::uuid,'Denied foreign organisation','denied-foreign-organisation',
       'client','active','NG')`,
    [fixture.deniedOrganisation],
    "tenant B must not create an organisation outside its selected context",
  );
  await expectInsufficientPrivilege(
    runtime,
    "b_creates_consistent_a_membership",
    `INSERT INTO public.organisation_memberships
      (id,organisation_id,user_id,status,delegated_by_membership_id)
     VALUES ($1::uuid,$2::uuid,$3::uuid,'active',$4::uuid)`,
    [
      fixture.foreignMembershipA,
      ORGANISATION_ID,
      fixture.userADenied,
      IDS.admin,
    ],
    "tenant B must not create an internally consistent tenant-A membership",
  );
  await expectInsufficientPrivilege(
    runtime,
    "b_creates_consistent_a_role",
    `INSERT INTO public.role_grants
      (id,membership_id,role,granted_by_membership_id)
     VALUES ($1::uuid,$2::uuid,'valo_analyst',$3::uuid)`,
    [fixture.foreignRoleGrantA, fixture.membershipA, IDS.admin],
    "tenant B must not create an internally consistent tenant-A role grant",
  );
  await expectInsufficientPrivilege(
    runtime,
    "b_updates_a_membership",
    "UPDATE public.organisation_memberships SET status=status WHERE id=$1::uuid",
    [fixture.membershipA],
    "tenant B must not update a tenant-A membership",
  );
  await expectInsufficientPrivilege(
    runtime,
    "b_updates_a_organisation",
    "UPDATE public.organisations SET status=status WHERE id=$1::uuid",
    [ORGANISATION_ID],
    "runtime organisation UPDATE must be revoked",
  );
  await expectInsufficientPrivilege(
    runtime,
    "b_deletes_a_organisation",
    "DELETE FROM public.organisations WHERE id=$1::uuid",
    [ORGANISATION_ID],
    "runtime organisation DELETE and cascade paths must be revoked",
  );
  await expectInsufficientPrivilege(
    runtime,
    "b_deletes_own_membership",
    "DELETE FROM public.organisation_memberships WHERE id=$1::uuid",
    [fixture.membershipB],
    "runtime membership DELETE must be revoked",
  );
  await expectInsufficientPrivilege(
    runtime,
    "b_deletes_user_with_membership",
    "DELETE FROM public.users WHERE id=$1::uuid",
    [fixture.userB],
    "runtime user DELETE and membership/role-grant cascade paths must be revoked",
  );
  await expectInsufficientPrivilege(
    runtime,
    "b_updates_own_role",
    "UPDATE public.role_grants SET role=role WHERE id=$1::uuid",
    [fixture.roleGrantB],
    "runtime role-grant UPDATE must be revoked",
  );
  await expectInsufficientPrivilege(
    runtime,
    "b_deletes_own_role",
    "DELETE FROM public.role_grants WHERE id=$1::uuid",
    [fixture.roleGrantB],
    "runtime role-grant DELETE must be revoked",
  );
  await expectInsufficientPrivilege(
    runtime,
    "b_creates_a_break_glass",
    `INSERT INTO public.break_glass_sessions
      (id,target_organisation_id,requested_by_user_id,reason,
       incident_reference,requested_permissions,status,expires_at)
     VALUES ($1::uuid,$2::uuid,$3::uuid,
       'Denied foreign break-glass request for tenant-context verification',
       'DENIED-BG-A','["audit:read"]','pending',$4::timestamptz)`,
    [
      fixture.deniedBreakGlassA,
      ORGANISATION_ID,
      fixture.userB,
      "2026-02-15T12:00:00.000Z",
    ],
    "tenant B must not create a tenant-A break-glass session",
  );
  await expectInsufficientPrivilege(
    runtime,
    "b_deletes_break_glass",
    "DELETE FROM public.break_glass_sessions WHERE id=$1::uuid",
    [fixture.breakGlassB],
    "runtime break-glass DELETE must be revoked",
  );

  await expectInsufficientPrivilege(
    runtime,
    "b_prompt_a",
    `INSERT INTO public.evaluation_runs
      (id,organisation_id,task,corpus_version,prompt_configuration_id)
     VALUES ($1::uuid,$2::uuid,'denied-b-prompt-a','fixture-v1',$3::uuid)`,
    [fixture.deniedEvaluationB, tenantB, fixture.promptA],
    "tenant B must not use tenant A's prompt configuration",
  );
  await expectInsufficientPrivilege(
    runtime,
    "b_price_a_order",
    `INSERT INTO public.orders
      (id,organisation_id,project_id,price_book_entry_id,unit_amount_minor,
       total_amount_minor,currency,idempotency_key,placed_by_user_id)
     VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,1200,1200,'NGN',
       'denied-b-price-a',$5::uuid)`,
    [
      fixture.deniedOrderB,
      tenantB,
      projectB,
      fixture.priceBookEntryA,
      fixture.userB,
    ],
    "tenant B must not order from tenant A's price book",
  );
  await expectInsufficientPrivilege(
    runtime,
    "b_price_a_subscription",
    `INSERT INTO public.subscriptions
      (id,organisation_id,price_book_entry_id,status,starts_at)
     VALUES ($1::uuid,$2::uuid,$3::uuid,'active',$4::timestamptz)`,
    [fixture.deniedSubscriptionB, tenantB, fixture.priceBookEntryA, FIXED_TIME],
    "tenant B must not subscribe through tenant A's price book",
  );
  for (const [savepoint, id, projectId, requirementId, documentId, label] of [
    [
      "b_evidence_a_project",
      fixture.deniedEvidenceBProject,
      IDS.project,
      requirementB,
      fixture.documentB,
      "tenant B evidence must reject tenant A's project",
    ],
    [
      "b_evidence_a_requirement",
      fixture.deniedEvidenceBRequirement,
      projectB,
      IDS.requirement,
      fixture.documentB,
      "tenant B evidence must reject tenant A's requirement",
    ],
    [
      "b_evidence_a_document",
      fixture.deniedEvidenceBDocument,
      projectB,
      requirementB,
      IDS.document,
      "tenant B evidence must reject tenant A's document",
    ],
  ]) {
    await expectInsufficientPrivilege(
      runtime,
      savepoint,
      `INSERT INTO public.evidence_items
        (id,organisation_id,project_id,requirement_id,document_id)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid)`,
      [id, tenantB, projectId, requirementId, documentId],
      label,
    );
  }
  await expectInsufficientPrivilege(
    runtime,
    "b_delegated_by_a",
    `INSERT INTO public.organisation_memberships
      (id,organisation_id,user_id,status,delegated_by_membership_id)
     VALUES ($1::uuid,$2::uuid,$3::uuid,'active',$4::uuid)`,
    [
      fixture.deniedMembershipB,
      tenantB,
      fixture.userBDenied,
      fixture.membershipA,
    ],
    "tenant B membership must not be delegated by tenant A",
  );
  await expectInsufficientPrivilege(
    runtime,
    "b_granted_by_a",
    `INSERT INTO public.role_grants
      (id,membership_id,role,granted_by_membership_id)
     VALUES ($1::uuid,$2::uuid,'valo_analyst',$3::uuid)`,
    [fixture.deniedRoleGrantB, fixture.membershipB, fixture.membershipA],
    "tenant B role must not be granted by tenant A",
  );
  await expectInsufficientPrivilege(
    runtime,
    "b_membership_moves_a",
    "UPDATE public.organisation_memberships SET organisation_id=$1::uuid WHERE id=$2::uuid",
    [ORGANISATION_ID, fixture.membershipB],
    "tenant B membership organisation must be immutable",
  );
  await expectInsufficientPrivilege(
    runtime,
    "b_role_identity_moves_a",
    "UPDATE public.role_grants SET granted_by_membership_id=$1::uuid WHERE id=$2::uuid",
    [fixture.membershipA, fixture.roleGrantB],
    "tenant B role-grant identity must be immutable",
  );
  await expectInsufficientPrivilege(
    runtime,
    "b_invoice_a_order",
    `INSERT INTO public.invoice_lines
      (id,invoice_id,order_id,description,quantity,unit_amount_minor,line_amount_minor)
     VALUES ($1::uuid,$2::uuid,$3::uuid,'Denied cross-tenant line',1,1200,1200)`,
    [fixture.deniedInvoiceLineB, fixture.invoiceB, fixture.orderA],
    "tenant B invoice must not reference tenant A's order",
  );
  await expectInsufficientPrivilege(
    runtime,
    "b_inserts_consistent_a_partner_request",
    `INSERT INTO public.partner_relationships
      (id,partner_organisation_id,client_organisation_id,status,approved_by_membership_id)
     VALUES ($1::uuid,$2::uuid,$3::uuid,'pending',NULL)`,
    [fixture.relationshipAB, ORGANISATION_ID, tenantB],
    "client B must not create partner A's otherwise-valid pending request",
  );
  await expectInsufficientPrivilege(
    runtime,
    "ab_active_null_approver",
    `INSERT INTO public.partner_relationships
      (id,partner_organisation_id,client_organisation_id,status,approved_by_membership_id)
     VALUES ($1::uuid,$2::uuid,$3::uuid,'active',NULL)`,
    [fixture.relationshipAB, ORGANISATION_ID, tenantB],
    "an active partner relationship must have an approving client membership",
  );
  await expectInsufficientPrivilege(
    runtime,
    "ab_approver_a",
    `INSERT INTO public.partner_relationships
      (id,partner_organisation_id,client_organisation_id,status,approved_by_membership_id)
     VALUES ($1::uuid,$2::uuid,$3::uuid,'active',$4::uuid)`,
    [fixture.relationshipAB, ORGANISATION_ID, tenantB, fixture.membershipA],
    "an A-to-B partner relationship must be approved by client B",
  );
  await runtime.query(
    "SELECT valo_security.set_current_organisation_id($1::uuid)",
    [ORGANISATION_ID],
  );
  await runtime.query(
    `INSERT INTO public.partner_relationships
      (id,partner_organisation_id,client_organisation_id,status,approved_by_membership_id)
     VALUES ($1::uuid,$2::uuid,$3::uuid,'pending',NULL)`,
    [fixture.relationshipAB, ORGANISATION_ID, tenantB],
  );
  await expectInsufficientPrivilege(
    runtime,
    "a_updates_client_b_relationship",
    "UPDATE public.partner_relationships SET status=status WHERE id=$1::uuid",
    [fixture.relationshipAB],
    "partner A must not perform client B's relationship lifecycle update",
  );
  await expectInsufficientPrivilege(
    runtime,
    "a_updates_b_break_glass",
    "UPDATE public.break_glass_sessions SET status=status WHERE id=$1::uuid",
    [fixture.breakGlassB],
    "tenant A must not update tenant B's break-glass session",
  );
  await expectInsufficientPrivilege(
    runtime,
    "a_moves_b_break_glass",
    `UPDATE public.break_glass_sessions
     SET target_organisation_id=$1::uuid WHERE id=$2::uuid`,
    [ORGANISATION_ID, fixture.breakGlassB],
    "break-glass target organisation must be immutable",
  );
  await expectInsufficientPrivilege(
    runtime,
    "ab_active_insert_by_partner",
    `INSERT INTO public.partner_relationships
      (id,partner_organisation_id,client_organisation_id,status,approved_by_membership_id,access_starts_at)
     VALUES ($1::uuid,$2::uuid,$3::uuid,'active',$4::uuid,$5::timestamptz)`,
    [
      fixture.relationshipAB,
      ORGANISATION_ID,
      tenantB,
      fixture.membershipB,
      FIXED_TIME,
    ],
    "a partner request cannot self-activate with a known client approver",
  );
  await runtime.query(
    "SELECT valo_security.set_current_organisation_id($1::uuid)",
    [tenantB],
  );
  await expectInsufficientPrivilege(
    runtime,
    "ab_inactive_revenue",
    `INSERT INTO public.partner_revenue_share_entries
      (id,partner_organisation_id,client_organisation_id,order_id,currency,
       gross_revenue_minor,share_rate_basis_points,share_amount_minor,
       rule_version,status,period_start,period_end)
     VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,'NGN',1300,1000,130,
       'fixture-v1','pending',$5::timestamptz,$6::timestamptz)`,
    [
      fixture.deniedRevenueABRelationship,
      ORGANISATION_ID,
      tenantB,
      fixture.orderB,
      FIXED_TIME,
      "2026-02-15T12:00:00.000Z",
    ],
    "partner revenue must require an active exact partner/client relationship",
  );
  await expectInsufficientPrivilege(
    runtime,
    "ab_activate_null_approver",
    "UPDATE public.partner_relationships SET status='active' WHERE id=$1::uuid",
    [fixture.relationshipAB],
    "a pending partner relationship cannot become active without a client approver",
  );
  assert.equal(
    (
      await runtime.query(
        `UPDATE public.partner_relationships
         SET status='active',approved_by_membership_id=$1::uuid
         WHERE id=$2::uuid`,
        [fixture.membershipB, fixture.relationshipAB],
      )
    ).rowCount,
    1,
    "client approval must activate the exact partner relationship",
  );
  await expectInsufficientPrivilege(
    runtime,
    "b_deletes_partner_relationship",
    "DELETE FROM public.partner_relationships WHERE id=$1::uuid",
    [fixture.relationshipAB],
    "runtime partner-relationship DELETE must be revoked",
  );
  await expectInsufficientPrivilege(
    runtime,
    "ab_partner_parties_move",
    `UPDATE public.partner_relationships
     SET client_organisation_id=$1::uuid WHERE id=$2::uuid`,
    [ORGANISATION_ID, fixture.relationshipAB],
    "partner and client identities must be immutable",
  );
  await expectInsufficientPrivilege(
    runtime,
    "ab_revenue_a_order",
    `INSERT INTO public.partner_revenue_share_entries
      (id,partner_organisation_id,client_organisation_id,order_id,currency,
       gross_revenue_minor,share_rate_basis_points,share_amount_minor,
       rule_version,status,period_start,period_end)
     VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,'NGN',1200,1000,120,
       'fixture-v1','pending',$5::timestamptz,$6::timestamptz)`,
    [
      fixture.deniedRevenueAB,
      ORGANISATION_ID,
      tenantB,
      fixture.orderA,
      FIXED_TIME,
      "2026-02-15T12:00:00.000Z",
    ],
    "A-to-B partner revenue must reference a client-B order",
  );
  await runtime.query(
    `INSERT INTO public.partner_revenue_share_entries
      (id,partner_organisation_id,client_organisation_id,order_id,currency,
       gross_revenue_minor,share_rate_basis_points,share_amount_minor,
       rule_version,status,period_start,period_end)
     VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,'NGN',1300,1000,130,
       'fixture-v1','pending',$5::timestamptz,$6::timestamptz)`,
    [
      fixture.revenueAB,
      ORGANISATION_ID,
      tenantB,
      fixture.orderB,
      FIXED_TIME,
      "2026-02-15T12:00:00.000Z",
    ],
  );

  await runtime.query(
    "SELECT valo_security.set_current_organisation_id($1::uuid)",
    [ORGANISATION_ID],
  );
  await expectInsufficientPrivilege(
    runtime,
    "a_prompt_b",
    `INSERT INTO public.evaluation_runs
      (id,organisation_id,task,corpus_version,prompt_configuration_id)
     VALUES ($1::uuid,$2::uuid,'denied-a-prompt-b','fixture-v1',$3::uuid)`,
    [fixture.deniedEvaluationA, ORGANISATION_ID, fixture.promptB],
    "tenant A must not use tenant B's prompt configuration",
  );
  await expectInsufficientPrivilege(
    runtime,
    "a_price_b_order",
    `INSERT INTO public.orders
      (id,organisation_id,project_id,price_book_entry_id,unit_amount_minor,
       total_amount_minor,currency,idempotency_key,placed_by_user_id)
     VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,1300,1300,'NGN',
       'denied-a-price-b',$5::uuid)`,
    [
      fixture.deniedOrderA,
      ORGANISATION_ID,
      IDS.project,
      fixture.priceBookEntryB,
      IDS.admin,
    ],
    "tenant A must not order from tenant B's price book",
  );
  await expectInsufficientPrivilege(
    runtime,
    "a_price_b_subscription",
    `INSERT INTO public.subscriptions
      (id,organisation_id,price_book_entry_id,status,starts_at)
     VALUES ($1::uuid,$2::uuid,$3::uuid,'active',$4::timestamptz)`,
    [
      fixture.deniedSubscriptionA,
      ORGANISATION_ID,
      fixture.priceBookEntryB,
      FIXED_TIME,
    ],
    "tenant A must not subscribe through tenant B's price book",
  );
  for (const [savepoint, id, projectId, requirementId, documentId, label] of [
    [
      "a_evidence_b_project",
      fixture.deniedEvidenceAProject,
      projectB,
      IDS.requirement,
      IDS.document,
      "tenant A evidence must reject tenant B's project",
    ],
    [
      "a_evidence_b_requirement",
      fixture.deniedEvidenceARequirement,
      IDS.project,
      requirementB,
      IDS.document,
      "tenant A evidence must reject tenant B's requirement",
    ],
    [
      "a_evidence_b_document",
      fixture.deniedEvidenceADocument,
      IDS.project,
      IDS.requirement,
      fixture.documentB,
      "tenant A evidence must reject tenant B's document",
    ],
  ]) {
    await expectInsufficientPrivilege(
      runtime,
      savepoint,
      `INSERT INTO public.evidence_items
        (id,organisation_id,project_id,requirement_id,document_id)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid)`,
      [id, ORGANISATION_ID, projectId, requirementId, documentId],
      label,
    );
  }
  await expectInsufficientPrivilege(
    runtime,
    "a_delegated_by_b",
    `INSERT INTO public.organisation_memberships
      (id,organisation_id,user_id,status,delegated_by_membership_id)
     VALUES ($1::uuid,$2::uuid,$3::uuid,'active',$4::uuid)`,
    [
      fixture.deniedMembershipA,
      ORGANISATION_ID,
      fixture.userADenied,
      fixture.membershipB,
    ],
    "tenant A membership must not be delegated by tenant B",
  );
  await expectInsufficientPrivilege(
    runtime,
    "a_granted_by_b",
    `INSERT INTO public.role_grants
      (id,membership_id,role,granted_by_membership_id)
     VALUES ($1::uuid,$2::uuid,'valo_analyst',$3::uuid)`,
    [fixture.deniedRoleGrantA, fixture.membershipA, fixture.membershipB],
    "tenant A role must not be granted by tenant B",
  );
  await expectInsufficientPrivilege(
    runtime,
    "a_membership_moves_b",
    "UPDATE public.organisation_memberships SET organisation_id=$1::uuid WHERE id=$2::uuid",
    [tenantB, fixture.membershipA],
    "tenant A membership organisation must be immutable",
  );
  await expectInsufficientPrivilege(
    runtime,
    "a_role_identity_moves_b",
    "UPDATE public.role_grants SET granted_by_membership_id=$1::uuid WHERE id=$2::uuid",
    [fixture.membershipB, fixture.roleGrantA],
    "tenant A role-grant identity must be immutable",
  );
  await expectInsufficientPrivilege(
    runtime,
    "a_invoice_b_order",
    `INSERT INTO public.invoice_lines
      (id,invoice_id,order_id,description,quantity,unit_amount_minor,line_amount_minor)
     VALUES ($1::uuid,$2::uuid,$3::uuid,'Denied reverse cross-tenant line',1,1300,1300)`,
    [fixture.deniedInvoiceLineA, fixture.invoiceA, fixture.orderB],
    "tenant A invoice must not reference tenant B's order",
  );
  await expectInsufficientPrivilege(
    runtime,
    "ba_approver_b",
    `INSERT INTO public.partner_relationships
      (id,partner_organisation_id,client_organisation_id,status,approved_by_membership_id)
     VALUES ($1::uuid,$2::uuid,$3::uuid,'active',$4::uuid)`,
    [fixture.relationshipBA, tenantB, ORGANISATION_ID, fixture.membershipB],
    "a B-to-A partner relationship must be approved by client A",
  );
  await runtime.query(
    "SELECT valo_security.set_current_organisation_id($1::uuid)",
    [tenantB],
  );
  await runtime.query(
    `INSERT INTO public.partner_relationships
      (id,partner_organisation_id,client_organisation_id,status,approved_by_membership_id)
     VALUES ($1::uuid,$2::uuid,$3::uuid,'pending',NULL)`,
    [fixture.relationshipBA, tenantB, ORGANISATION_ID],
  );
  await runtime.query(
    "SELECT valo_security.set_current_organisation_id($1::uuid)",
    [ORGANISATION_ID],
  );
  assert.equal(
    (
      await runtime.query(
        `UPDATE public.partner_relationships
         SET status='active',approved_by_membership_id=$1::uuid
         WHERE id=$2::uuid`,
        [fixture.membershipA, fixture.relationshipBA],
      )
    ).rowCount,
    1,
    "client A must approve the pending B-to-A request",
  );
  await expectInsufficientPrivilege(
    runtime,
    "ba_revenue_b_order",
    `INSERT INTO public.partner_revenue_share_entries
      (id,partner_organisation_id,client_organisation_id,order_id,currency,
       gross_revenue_minor,share_rate_basis_points,share_amount_minor,
       rule_version,status,period_start,period_end)
     VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,'NGN',1300,1000,130,
       'fixture-v1','pending',$5::timestamptz,$6::timestamptz)`,
    [
      fixture.deniedRevenueBA,
      tenantB,
      ORGANISATION_ID,
      fixture.orderB,
      FIXED_TIME,
      "2026-02-15T12:00:00.000Z",
    ],
    "B-to-A partner revenue must reference a client-A order",
  );
  await runtime.query(
    `INSERT INTO public.partner_revenue_share_entries
      (id,partner_organisation_id,client_organisation_id,order_id,currency,
       gross_revenue_minor,share_rate_basis_points,share_amount_minor,
       rule_version,status,period_start,period_end)
     VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,'NGN',1200,1000,120,
       'fixture-v1','pending',$5::timestamptz,$6::timestamptz)`,
    [
      fixture.revenueBA,
      tenantB,
      ORGANISATION_ID,
      fixture.orderA,
      FIXED_TIME,
      "2026-02-15T12:00:00.000Z",
    ],
  );
}

async function assertRuntimeParentIsolation(runtimeUrl, ownerUrl) {
  const tenantB = "56414c4f-0000-5000-8000-000000000095";
  const clientB = "56414c4f-0000-5000-8000-000000000094";
  const projectB = "56414c4f-0000-5000-8000-000000000093";
  const requirementB = "56414c4f-0000-5000-8000-000000000092";
  const deniedRow = "56414c4f-0000-5000-8000-000000000091";
  const deniedParentRowA = "56414c4f-0000-5000-8000-000000000089";
  const deniedParentRowB = "56414c4f-0000-5000-8000-000000000088";
  const owner = await connectUtc(ownerUrl);
  let globalControlsSeeded = false;
  try {
    await seedGlobalRuntimeControls(owner);
    globalControlsSeeded = true;
    const runtime = await connectUtc(runtimeUrl);
    try {
      await runtime.query("BEGIN");
      const runtimeSession = (
        await runtime.query(`SELECT current_user AS role_name,
          session_user AS session_role_name,
          current_setting('session_replication_role') AS replication_role,
          current_setting('row_security') AS row_security,
          current_setting('server_version_num')::integer AS server_version_number,
          pg_catalog.current_schemas(false)::pg_catalog.text[]
            AS explicit_schemas,
          pg_catalog.current_schemas(true)::pg_catalog.text[]
            AS implicit_schemas`)
      ).rows[0];
      assert.deepEqual(
        {
          role_name: runtimeSession.role_name,
          session_role_name: runtimeSession.session_role_name,
          replication_role: runtimeSession.replication_role,
          row_security: runtimeSession.row_security,
          explicit_schemas: runtimeSession.explicit_schemas,
          implicit_schemas: runtimeSession.implicit_schemas,
        },
        {
          role_name: "valo_app_runtime",
          session_role_name: "valo_app_runtime",
          replication_role: "origin",
          row_security: "on",
          explicit_schemas: ["public"],
          implicit_schemas: ["pg_catalog", "public"],
        },
      );
      assert.equal(
        Math.trunc(Number(runtimeSession.server_version_number) / 10_000),
        16,
      );
      await runtime.query(
        "SELECT valo_security.set_current_organisation_id($1::uuid)",
        [tenantB],
      );
      await runtime.query(
        `INSERT INTO public.organisations
        (id,name,slug,type,status,country_code)
       VALUES ($1::uuid,'Synthetic tenant B','synthetic-tenant-b','client','active','NG')`,
        [tenantB],
      );
      await runtime.query(
        "INSERT INTO public.clients (id,organisation_id,name) VALUES ($1::uuid,$2::uuid,'Synthetic tenant B client')",
        [clientB, tenantB],
      );
      await runtime.query(
        `INSERT INTO public.projects
        (id,organisation_id,client_id,tender_title)
       VALUES ($1::uuid,$2::uuid,$3::uuid,'Synthetic tenant B project')`,
        [projectB, tenantB, clientB],
      );
      await runtime.query(
        `INSERT INTO public.requirements
        (id,organisation_id,project_id,text)
       VALUES ($1::uuid,$2::uuid,$3::uuid,'Synthetic tenant B requirement')`,
        [requirementB, tenantB, projectB],
      );
      assert.equal(
        (
          await runtime.query(
            "UPDATE public.requirements SET reviewer_notes='tenant-b-positive' WHERE id=$1::uuid",
            [requirementB],
          )
        ).rowCount,
        1,
      );
      assert.equal(
        Number(
          (
            await runtime.query(
              "SELECT count(*) FROM public.requirements WHERE id=$1::uuid",
              [IDS.requirement],
            )
          ).rows[0].count,
        ),
        0,
        "tenant B must not read tenant A project child",
      );
      assert.equal(
        (
          await runtime.query(
            "UPDATE public.requirements SET reviewer_notes=reviewer_notes WHERE id=$1::uuid",
            [IDS.requirement],
          )
        ).rowCount,
        0,
        "tenant B must not update tenant A project child",
      );
      assert.equal(
        (
          await runtime.query(
            "DELETE FROM public.requirements WHERE id=$1::uuid",
            [IDS.requirement],
          )
        ).rowCount,
        0,
        "tenant B must not delete tenant A project child",
      );
      await expectInsufficientPrivilege(
        runtime,
        "b_claims_a_child",
        `INSERT INTO public.requirements (id,organisation_id,project_id,text)
       VALUES ($1::uuid,$2::uuid,$3::uuid,'Denied cross-tenant child')`,
        [deniedRow, ORGANISATION_ID, IDS.project],
        "tenant B must not insert a project child claiming tenant A",
      );
      await expectInsufficientPrivilege(
        runtime,
        "b_uses_a_project_parent",
        `INSERT INTO public.requirements (id,organisation_id,project_id,text)
       VALUES ($1::uuid,$2::uuid,$3::uuid,'Denied mismatched project parent')`,
        [deniedParentRowB, tenantB, IDS.project],
        "tenant B must not attach its child row to tenant A's project",
      );

      await runtime.query(
        "SELECT valo_security.set_current_organisation_id($1::uuid)",
        [ORGANISATION_ID],
      );
      assert.equal(
        Number(
          (
            await runtime.query(
              "SELECT count(*) FROM public.requirements WHERE id=$1::uuid",
              [IDS.requirement],
            )
          ).rows[0].count,
        ),
        1,
        "tenant A must read its project child",
      );
      assert.equal(
        (
          await runtime.query(
            "UPDATE public.requirements SET reviewer_notes=reviewer_notes WHERE id=$1::uuid",
            [IDS.requirement],
          )
        ).rowCount,
        1,
        "tenant A must update its project child",
      );
      assert.equal(
        Number(
          (
            await runtime.query(
              "SELECT count(*) FROM public.requirements WHERE id=$1::uuid",
              [requirementB],
            )
          ).rows[0].count,
        ),
        0,
        "tenant A must not read tenant B project child",
      );
      assert.equal(
        (
          await runtime.query(
            "UPDATE public.requirements SET reviewer_notes=reviewer_notes WHERE id=$1::uuid",
            [requirementB],
          )
        ).rowCount,
        0,
        "tenant A must not update tenant B project child",
      );
      assert.equal(
        (
          await runtime.query(
            "DELETE FROM public.requirements WHERE id=$1::uuid",
            [requirementB],
          )
        ).rowCount,
        0,
        "tenant A must not delete tenant B project child",
      );
      await expectInsufficientPrivilege(
        runtime,
        "a_claims_b_child",
        `INSERT INTO public.requirements (id,organisation_id,project_id,text)
       VALUES ($1::uuid,$2::uuid,$3::uuid,'Denied reverse child')`,
        [deniedRow, tenantB, projectB],
        "tenant A must not insert a project child claiming tenant B",
      );
      await expectInsufficientPrivilege(
        runtime,
        "a_uses_b_project_parent",
        `INSERT INTO public.requirements (id,organisation_id,project_id,text)
       VALUES ($1::uuid,$2::uuid,$3::uuid,'Denied reverse project parent')`,
        [deniedParentRowA, ORGANISATION_ID, projectB],
        "tenant A must not attach its child row to tenant B's project",
      );
      await expectInsufficientPrivilege(
        runtime,
        "a_moves_child_to_b",
        "UPDATE public.requirements SET organisation_id=$1::uuid WHERE id=$2::uuid",
        [tenantB, IDS.requirement],
        "tenant A must not move a visible project child into tenant B",
      );
      await assertRuntimeTenantRelationshipMatrix(runtime, {
        tenantB,
        projectB,
        requirementB,
      });
      await expectInsufficientPrivilege(
        runtime,
        "explicit_audit_ordinal",
        `INSERT INTO public.audit_events
        (id,organisation_id,event_type,seq,prev_hash,hash,hash_version,row_no,created_at)
       VALUES ($1::uuid,$2::uuid,'fixture.denied',2,$3,$3,2,999,now())`,
        [deniedRow, ORGANISATION_ID, "0".repeat(64)],
        "runtime must not explicitly assign an audit row_no",
      );
      const activeHead = await runtime.query(
        "SELECT seq,hash FROM public.audit_events ORDER BY seq DESC LIMIT 1",
      );
      assert.equal(activeHead.rowCount, 1);
      const auditCreatedAt = new Date().toISOString();
      const auditDetails = JSON.stringify({
        fixture: "runtime-writer-positive",
      });
      const auditSequence = activeHead.rows[0].seq + 1;
      const runtimeAuditHash = auditHash(
        activeHead.rows[0].hash,
        {
          seq: auditSequence,
          organisationId: ORGANISATION_ID,
          userId: null,
          userName: "Synthetic runtime audit writer",
          projectId: IDS.project,
          eventType: "fixture.runtime_audit_write",
          objectType: "synthetic_fixture",
          objectId: IDS.project,
          details: auditDetails,
          createdAt: auditCreatedAt,
        },
        2,
      );
      const insertedAudit = await runtime.query(
        `INSERT INTO public.audit_events
        (organisation_id,user_id,user_name,project_id,event_type,object_type,
         object_id,details,seq,prev_hash,hash,hash_version,created_at)
       VALUES ($1::uuid,NULL,'Synthetic runtime audit writer',$2::uuid,
         'fixture.runtime_audit_write','synthetic_fixture',$2::text,$3,$4,$5,$6,2,$7::timestamptz)
       RETURNING row_no::integer`,
        [
          ORGANISATION_ID,
          IDS.project,
          auditDetails,
          auditSequence,
          activeHead.rows[0].hash,
          runtimeAuditHash,
          auditCreatedAt,
        ],
      );
      assert.equal(insertedAudit.rowCount, 1);
      assert(
        insertedAudit.rows[0].row_no > 561,
        "runtime audit writer must receive a server-generated row_no",
      );

      await runtime.query(
        "SELECT valo_security.set_current_organisation_id($1::uuid)",
        [tenantB],
      );
      assert.equal(
        (
          await runtime.query(
            "DELETE FROM public.requirements WHERE id=$1::uuid",
            [requirementB],
          )
        ).rowCount,
        1,
        "tenant B must delete its own rollback-only project child",
      );
      await runtime.query("ROLLBACK");
    } catch (error) {
      await runtime.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      await runtime.end();
    }
  } finally {
    try {
      await removeGlobalRuntimeControls(owner, globalControlsSeeded);
      const resetSequence = await owner.query(
        `SELECT setval(
           'public.audit_events_row_no_seq',
           (SELECT max(row_no) FROM public.audit_events),
           true
         )::text AS last_value`,
      );
      assert.deepEqual(resetSequence.rows[0], { last_value: "561" });
      const sequenceState = await owner.query(
        "SELECT last_value::text,is_called FROM public.audit_events_row_no_seq",
      );
      assert.deepEqual(sequenceState.rows[0], {
        last_value: "561",
        is_called: true,
      });
    } finally {
      await owner.end();
    }
  }
}

async function createDatabase(admin, name, owner) {
  assert(
    /^valo_bridge_ci_[a-z0-9_]+$/.test(name),
    `unsafe CI database name ${name}`,
  );
  const ownerClause = owner ? ` OWNER ${quoteIdentifier(owner)}` : "";
  await admin.query(`CREATE DATABASE ${quoteIdentifier(name)}${ownerClause}`);
}

async function dropDatabase(admin, name) {
  if (!/^valo_bridge_ci_[a-z0-9_]+$/.test(name)) return;
  await admin.query(
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()",
    [name],
  );
  await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(name)}`);
}

async function runBridge(environment, allowFailure = false) {
  return runCommand(process.execPath, [bridgeRunnerPath, "--execute"], {
    env: {
      ...process.env,
      ...environment,
      CI: "true",
    },
    allowFailure,
  });
}

async function catalogEvidence(databaseUrl) {
  const result = await runCommand(
    process.execPath,
    [bridgeRunnerPath, "--catalog-evidence"],
    { env: { ...process.env, DATABASE_URL: databaseUrl } },
  );
  const stdout = result.stdout.trim();
  assert(stdout.startsWith("{") && stdout.endsWith("}"));
  return JSON.parse(stdout);
}

async function applyMigrations(databaseUrl) {
  await runCommand(
    process.execPath,
    [drizzleBinPath, "migrate", "--config", "./drizzle.config.ts"],
    {
      cwd: dbPackagePath,
      env: { ...process.env, DATABASE_URL: databaseUrl },
    },
  );
}

async function seedLegacyStorageBackfillFixtures(databaseUrl) {
  const client = await connectUtc(databaseUrl);
  try {
    await client.query("BEGIN");
    for (const fixture of STORAGE_BACKFILL_FIXTURES) {
      await client.query(
        `INSERT INTO public.notification_events (
          id, organisation_id, project_id, channel, template, status,
          version, created_at, updated_at
        ) VALUES ($1::uuid,$2::uuid,$3::uuid,'internal_storage',
          'valo.storage-deletion-intent/v1',$4,1,$5::timestamptz,$5::timestamptz)`,
        [fixture.id, ORGANISATION_ID, IDS.project, fixture.status, FIXED_TIME],
      );
      for (let attempt = 1; attempt <= fixture.attempts; attempt += 1) {
        await client.query(
          `INSERT INTO public.notification_attempts (
            organisation_id, notification_event_id, attempt_number, provider,
            idempotency_key, status, attempted_at
          ) VALUES ($1::uuid,$2::uuid,$3,'valo-object-storage',$4,$5,$6::timestamptz)`,
          [
            ORGANISATION_ID,
            fixture.id,
            attempt,
            `bridge-storage-backfill:${fixture.id}:${attempt}`,
            fixture.status === "dead_letter" && attempt === fixture.attempts
              ? "dead_letter"
              : "completed",
            FIXED_TIME,
          ],
        );
      }
    }
    await client.query(
      `INSERT INTO public.retention_actions (
        id, organisation_id, retention_request_id, object_type, object_id,
        action, status, evidence, executed_by_user_id, executed_at,
        version, created_at, updated_at
      ) VALUES (
        $1::uuid,$2::uuid,$3::uuid,'project',$4::uuid,'delete','completed',
        'Synthetic pre-0011 completion evidence',$5::uuid,$6::timestamptz,
        1,$6::timestamptz,$6::timestamptz
      )`,
      [
        IDS.retentionAction,
        ORGANISATION_ID,
        IDS.retention,
        IDS.project,
        IDS.admin,
        FIXED_TIME,
      ],
    );
    await client.query(
      `INSERT INTO public.deletion_certificates (
        id, organisation_id, retention_action_id, certificate_number,
        scope_manifest_hash, method, completed_at, signed_by_user_id,
        signature_evidence, created_at
      ) VALUES (
        $1::uuid,$2::uuid,$3::uuid,'LEGACY-CI-001',$4,
        'legacy-manual',$5::timestamptz,$6::uuid,
        'Synthetic pre-0011 signature evidence',$5::timestamptz
      )`,
      [
        IDS.deletionCertificate,
        ORGANISATION_ID,
        IDS.retentionAction,
        sha256("synthetic pre-0011 retention scope"),
        FIXED_TIME,
        IDS.admin,
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

async function expectRetentionEvidenceImmutable(client, savepoint, query) {
  await client.query(`SAVEPOINT ${quoteIdentifier(savepoint)}`);
  let rejected = false;
  try {
    await client.query(query);
  } catch (error) {
    rejected = error?.code === "55000";
  }
  await client.query(`ROLLBACK TO SAVEPOINT ${quoteIdentifier(savepoint)}`);
  await client.query(`RELEASE SAVEPOINT ${quoteIdentifier(savepoint)}`);
  assert.equal(
    rejected,
    true,
    `${savepoint} must fail closed with SQLSTATE 55000`,
  );
}

async function assertAndRemoveLegacyStorageBackfillFixtures(client) {
  const fixtureIds = STORAGE_BACKFILL_FIXTURES.map(({ id }) => id);
  const result = await client.query(
    `SELECT event.id::text,event.status,event.storage_cycle_attempts,
      event.storage_terminal_at IS NOT DISTINCT FROM event.updated_at
        AS terminal_matches_updated_at,
      event.storage_terminal_at IS NULL AS terminal_is_null,
      count(attempt.id)::integer AS retained_attempts
    FROM public.notification_events AS event
    LEFT JOIN public.notification_attempts AS attempt
      ON attempt.notification_event_id=event.id
    WHERE event.id=ANY($1::uuid[])
    GROUP BY event.id,event.status,event.storage_cycle_attempts,
      event.storage_terminal_at,event.updated_at
    ORDER BY event.id`,
    [fixtureIds],
  );
  assert.deepEqual(
    result.rows,
    STORAGE_BACKFILL_FIXTURES.map((fixture) => ({
      id: fixture.id,
      status: fixture.status,
      storage_cycle_attempts: fixture.expectedCycleAttempts,
      terminal_matches_updated_at: fixture.terminal,
      terminal_is_null: !fixture.terminal,
      retained_attempts: fixture.attempts,
    })),
    "0008 must derive populated legacy cycle attempts and terminal anchors",
  );
  const retentionBackfill = await client.query(
    `SELECT
      request.completion_protocol_version AS request_protocol,
      request.subject_project_id::text AS request_subject_project_id,
      request.requested_by_name,
      action.completion_protocol_version AS action_protocol,
      action.subject_project_id::text AS action_subject_project_id,
      action.executed_by_name,
      action.source_manifest IS NULL AS action_source_manifest_is_null,
      action.reconciliation_manifest IS NULL
        AS action_reconciliation_manifest_is_null,
      action.purge_receipt IS NULL AS action_purge_receipt_is_null,
      action.prepared_at IS NULL AS action_prepared_at_is_null,
      action.checked_at IS NULL AS action_checked_at_is_null,
      certificate.signed_by_name,
      certificate.certificate_manifest IS NULL
        AS certificate_manifest_is_null,
      certificate.certificate_manifest_sha256 IS NULL
        AS certificate_manifest_sha256_is_null
    FROM public.retention_requests AS request
    JOIN public.retention_actions AS action
      ON action.retention_request_id=request.id
    JOIN public.deletion_certificates AS certificate
      ON certificate.retention_action_id=action.id
    WHERE request.id=$1::uuid
      AND action.id=$2::uuid
      AND certificate.id=$3::uuid`,
    [IDS.retention, IDS.retentionAction, IDS.deletionCertificate],
  );
  assert.deepEqual(retentionBackfill.rows, [
    {
      request_protocol: 0,
      request_subject_project_id: IDS.project,
      requested_by_name: "Synthetic platform administrator",
      action_protocol: 0,
      action_subject_project_id: IDS.project,
      executed_by_name: "Synthetic platform administrator",
      action_source_manifest_is_null: true,
      action_reconciliation_manifest_is_null: true,
      action_purge_receipt_is_null: true,
      action_prepared_at_is_null: true,
      action_checked_at_is_null: true,
      signed_by_name: "Synthetic platform administrator",
      certificate_manifest_is_null: true,
      certificate_manifest_sha256_is_null: true,
    },
  ]);
  await client.query("BEGIN");
  try {
    await expectRetentionEvidenceImmutable(
      client,
      "legacy_request_update",
      `UPDATE public.retention_requests SET reason=reason WHERE id='${IDS.retention}'::uuid`,
    );
    await expectRetentionEvidenceImmutable(
      client,
      "legacy_request_delete",
      `DELETE FROM public.retention_requests WHERE id='${IDS.retention}'::uuid`,
    );
    await expectRetentionEvidenceImmutable(
      client,
      "legacy_action_update",
      `UPDATE public.retention_actions SET evidence=evidence WHERE id='${IDS.retentionAction}'::uuid`,
    );
    await expectRetentionEvidenceImmutable(
      client,
      "legacy_action_delete",
      `DELETE FROM public.retention_actions WHERE id='${IDS.retentionAction}'::uuid`,
    );
    await expectRetentionEvidenceImmutable(
      client,
      "legacy_certificate_update",
      `UPDATE public.deletion_certificates SET exceptions=exceptions WHERE id='${IDS.deletionCertificate}'::uuid`,
    );
    await expectRetentionEvidenceImmutable(
      client,
      "legacy_certificate_delete",
      `DELETE FROM public.deletion_certificates WHERE id='${IDS.deletionCertificate}'::uuid`,
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
  await client.query(
    "DELETE FROM public.notification_events WHERE id=ANY($1::uuid[])",
    [fixtureIds],
  );
  const remainingAttempts = await client.query(
    "SELECT count(*)::integer AS count FROM public.notification_attempts WHERE notification_event_id=ANY($1::uuid[])",
    [fixtureIds],
  );
  assert.equal(
    remainingAttempts.rows[0]?.count,
    0,
    "storage backfill rehearsal cleanup must cascade attempt fixtures",
  );
}

async function applySqlMigration(client, migrationSql) {
  await client.query("BEGIN");
  try {
    await client.query(migrationSql);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

async function inTenantTransaction(client, organisationId, work) {
  await client.query("BEGIN");
  try {
    await client.query(
      "SELECT valo_security.set_current_organisation_id($1::uuid)",
      [organisationId],
    );
    await work();
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

async function incrementalPreflightDataSnapshot(client, organisationIds) {
  const snapshot = {};
  for (const organisationId of organisationIds) {
    await inTenantTransaction(client, organisationId, async () => {
      const state = await client.query(`SELECT
        (SELECT COALESCE(jsonb_agg(to_jsonb(item) ORDER BY item.id),'[]'::jsonb)
          FROM public.organisations AS item) AS organisations,
        (SELECT COALESCE(jsonb_agg(to_jsonb(item) ORDER BY item.id),'[]'::jsonb)
          FROM public.users AS item) AS users,
        (SELECT COALESCE(jsonb_agg(to_jsonb(item) ORDER BY item.id),'[]'::jsonb)
          FROM public.clients AS item) AS clients,
        (SELECT COALESCE(jsonb_agg(to_jsonb(item) ORDER BY item.id),'[]'::jsonb)
          FROM public.projects AS item) AS projects,
        (SELECT COALESCE(jsonb_agg(to_jsonb(item) ORDER BY item.id),'[]'::jsonb)
          FROM public.requirements AS item) AS requirements,
        (SELECT COALESCE(jsonb_agg(to_jsonb(item) ORDER BY item.id),'[]'::jsonb)
          FROM public.price_books AS item) AS price_books,
        (SELECT COALESCE(jsonb_agg(to_jsonb(item) ORDER BY item.id),'[]'::jsonb)
          FROM public.price_book_entries AS item) AS price_book_entries,
        (SELECT COALESCE(jsonb_agg(to_jsonb(item) ORDER BY item.id),'[]'::jsonb)
          FROM public.orders AS item) AS orders,
        (SELECT COALESCE(jsonb_agg(to_jsonb(item) ORDER BY item.id),'[]'::jsonb)
          FROM public.invoices AS item) AS invoices,
        (SELECT COALESCE(jsonb_agg(to_jsonb(item) ORDER BY item.id),'[]'::jsonb)
          FROM public.invoice_lines AS item) AS invoice_lines,
        (SELECT COALESCE(jsonb_agg(to_jsonb(item) ORDER BY item.id),'[]'::jsonb)
          FROM public.audit_events AS item) AS audit_events`);
      snapshot[organisationId] = state.rows[0];
    });
  }
  return snapshot;
}

async function expectMigrationPreflightRollback(
  client,
  migrationSql,
  expectedMessage,
  organisationIds,
) {
  const catalogBefore = await normalizedCatalog(client);
  const dataBefore = await incrementalPreflightDataSnapshot(
    client,
    organisationIds,
  );
  await client.query("BEGIN");
  let failure;
  try {
    await client.query(migrationSql);
  } catch (error) {
    failure = error;
  }
  await client.query("ROLLBACK");
  assert(failure, `0002 must reject ${expectedMessage}`);
  assert.equal(failure.code, "P0001");
  assert.match(failure.message, expectedMessage);
  assert.deepEqual(
    await normalizedCatalog(client),
    catalogBefore,
    "failed 0002 preflight must roll back every catalog change",
  );
  assert.deepEqual(
    await incrementalPreflightDataSnapshot(client, organisationIds),
    dataBefore,
    "failed 0002 preflight must roll back every data change",
  );
  assert.equal(
    (
      await client.query(
        "SELECT to_regprocedure('valo_security.expected_tenant_parent_edges()') IS NULL AS absent",
      )
    ).rows[0].absent,
    true,
    "failed 0002 preflight must not leak its tenant graph contract",
  );
}

async function assertIncrementalTenantPreflight(
  databaseUrl,
  migration0000,
  migration0001,
  migration0002,
) {
  const fixture = Object.freeze({
    organisationA: runtimeFixtureId(3001),
    organisationB: runtimeFixtureId(3002),
    user: runtimeFixtureId(3003),
    clientA: runtimeFixtureId(3004),
    clientB: runtimeFixtureId(3005),
    projectA: runtimeFixtureId(3006),
    projectB: runtimeFixtureId(3007),
    requirementA: runtimeFixtureId(3008),
    priceBookA: runtimeFixtureId(3009),
    priceBookB: runtimeFixtureId(3010),
    priceBookEntryA: runtimeFixtureId(3011),
    priceBookEntryB: runtimeFixtureId(3012),
    orderA: runtimeFixtureId(3013),
    orderB: runtimeFixtureId(3014),
    invoiceA: runtimeFixtureId(3015),
    invoiceLineA: runtimeFixtureId(3016),
  });
  const client = await connectUtc(databaseUrl);
  try {
    await applySqlMigration(client, migration0000);
    await applySqlMigration(client, migration0001);
    await client.query(
      `INSERT INTO public.organisations
        (id,name,slug,type,status,country_code)
       VALUES
        ($1::uuid,'Incremental tenant A','incremental-tenant-a','client','active','NG'),
        ($2::uuid,'Incremental tenant B','incremental-tenant-b','client','active','NG')`,
      [fixture.organisationA, fixture.organisationB],
    );
    await client.query(
      `INSERT INTO public.users
        (id,clerk_user_id,email,name,role,status)
       VALUES ($1::uuid,'synthetic-incremental-user',
         'incremental-user@synthetic.invalid','Synthetic incremental user','none','active')`,
      [fixture.user],
    );
    await inTenantTransaction(client, fixture.organisationB, async () => {
      await client.query(
        "INSERT INTO public.clients (id,organisation_id,name) VALUES ($1::uuid,$2::uuid,'Incremental client B')",
        [fixture.clientB, fixture.organisationB],
      );
      await client.query(
        `INSERT INTO public.projects
          (id,organisation_id,client_id,tender_title)
         VALUES ($1::uuid,$2::uuid,$3::uuid,'Incremental project B')`,
        [fixture.projectB, fixture.organisationB, fixture.clientB],
      );
    });
    await inTenantTransaction(client, fixture.organisationA, async () => {
      await client.query(
        "INSERT INTO public.clients (id,organisation_id,name) VALUES ($1::uuid,$2::uuid,'Incremental client A')",
        [fixture.clientA, fixture.organisationA],
      );
      await client.query(
        `INSERT INTO public.projects
          (id,organisation_id,client_id,tender_title)
         VALUES ($1::uuid,$2::uuid,$3::uuid,'Incremental project A')`,
        [fixture.projectA, fixture.organisationA, fixture.clientA],
      );
      await client.query(
        `INSERT INTO public.requirements
          (id,organisation_id,project_id,text)
         VALUES ($1::uuid,$2::uuid,$3::uuid,'Cross-tenant incremental requirement')`,
        [fixture.requirementA, fixture.organisationA, fixture.projectB],
      );
    });

    await expectMigrationPreflightRollback(
      client,
      migration0002,
      /existing tenant parent mismatch: requirements\.project_id -> projects/,
      [fixture.organisationA, fixture.organisationB],
    );
    await inTenantTransaction(client, fixture.organisationA, async () => {
      assert.equal(
        (
          await client.query(
            "UPDATE public.requirements SET project_id=$1::uuid WHERE id=$2::uuid",
            [fixture.projectA, fixture.requirementA],
          )
        ).rowCount,
        1,
      );
    });

    await inTenantTransaction(client, fixture.organisationB, async () => {
      await client.query(
        `INSERT INTO public.price_books
          (id,organisation_id,name,version_number,status,effective_from)
         VALUES ($1::uuid,$2::uuid,'Incremental price book B',1,'active',$3::timestamptz)`,
        [fixture.priceBookB, fixture.organisationB, FIXED_TIME],
      );
      await client.query(
        `INSERT INTO public.price_book_entries
          (id,price_book_id,product_code,product_kind,currency,amount_minor)
         VALUES ($1::uuid,$2::uuid,'INCREMENTAL-B','one_off','NGN',1300)`,
        [fixture.priceBookEntryB, fixture.priceBookB],
      );
      await client.query(
        `INSERT INTO public.orders
          (id,organisation_id,project_id,price_book_entry_id,unit_amount_minor,
           total_amount_minor,currency,idempotency_key,placed_by_user_id)
         VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,1300,1300,'NGN',
           'incremental-order-b',$5::uuid)`,
        [
          fixture.orderB,
          fixture.organisationB,
          fixture.projectB,
          fixture.priceBookEntryB,
          fixture.user,
        ],
      );
    });
    await inTenantTransaction(client, fixture.organisationA, async () => {
      await client.query(
        `INSERT INTO public.price_books
          (id,organisation_id,name,version_number,status,effective_from)
         VALUES ($1::uuid,$2::uuid,'Incremental price book A',1,'active',$3::timestamptz)`,
        [fixture.priceBookA, fixture.organisationA, FIXED_TIME],
      );
      await client.query(
        `INSERT INTO public.price_book_entries
          (id,price_book_id,product_code,product_kind,currency,amount_minor)
         VALUES ($1::uuid,$2::uuid,'INCREMENTAL-A','one_off','NGN',1200)`,
        [fixture.priceBookEntryA, fixture.priceBookA],
      );
      await client.query(
        `INSERT INTO public.orders
          (id,organisation_id,project_id,price_book_entry_id,unit_amount_minor,
           total_amount_minor,currency,idempotency_key,placed_by_user_id)
         VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,1200,1200,'NGN',
           'incremental-order-a',$5::uuid)`,
        [
          fixture.orderA,
          fixture.organisationA,
          fixture.projectA,
          fixture.priceBookEntryA,
          fixture.user,
        ],
      );
      await client.query(
        `INSERT INTO public.invoices
          (id,organisation_id,invoice_number,currency,net_amount_minor,
           vat_rate_basis_points,vat_amount_minor,gross_amount_minor,
           net_payable_minor,tax_rule_id,tax_point_at)
         VALUES ($1::uuid,$2::uuid,'INCREMENTAL-A-1','NGN',1200,0,0,1200,
           1200,'synthetic-tax',$3::timestamptz)`,
        [fixture.invoiceA, fixture.organisationA, FIXED_TIME],
      );
      await client.query(
        `INSERT INTO public.invoice_lines
          (id,invoice_id,order_id,description,quantity,unit_amount_minor,line_amount_minor)
         VALUES ($1::uuid,$2::uuid,$3::uuid,'Cross-tenant incremental line',1,1300,1300)`,
        [fixture.invoiceLineA, fixture.invoiceA, fixture.orderB],
      );
    });

    await expectMigrationPreflightRollback(
      client,
      migration0002,
      /existing derived tenant relationship mismatch/,
      [fixture.organisationA, fixture.organisationB],
    );
    await inTenantTransaction(client, fixture.organisationA, async () => {
      assert.equal(
        (
          await client.query(
            "UPDATE public.invoice_lines SET order_id=$1::uuid WHERE id=$2::uuid",
            [fixture.orderA, fixture.invoiceLineA],
          )
        ).rowCount,
        1,
      );
    });

    await applySqlMigration(client, migration0002);
    await assertTenantGuardCatalog(client, {
      runtimeRoleExpected: false,
      productionAssuranceExpected: false,
      retrievalRegistryExpected: false,
      tenderContextExpected: false,
      retentionCompletionExpected: false,
    });
    await inTenantTransaction(client, fixture.organisationA, async () => {
      const preserved = await client.query(
        `SELECT
          (SELECT project_id FROM public.requirements WHERE id=$1::uuid) AS requirement_project,
          (SELECT order_id FROM public.invoice_lines WHERE id=$2::uuid) AS invoice_order`,
        [fixture.requirementA, fixture.invoiceLineA],
      );
      assert.deepEqual(preserved.rows[0], {
        requirement_project: fixture.projectA,
        invoice_order: fixture.orderA,
      });
    });
  } finally {
    await client.end();
  }
  console.log(
    "legacy bridge CI: NOBYPASS incremental 0002 rejects direct and derived cross-tenant history before accepting repaired rows",
  );
}

async function main() {
  assert.equal(
    process.env.CI,
    "true",
    "legacy bridge rehearsal is intentionally restricted to disposable CI PostgreSQL",
  );
  const requestedLineage = process.env[CI_LINEAGE_ENV];
  if (!requestedLineage) {
    for (const lineageId of [
      LEGACY_LINEAGE_CANONICAL,
      LEGACY_LINEAGE_PRODUCTION_PUSH_MANAGED,
    ]) {
      const result = await runCommand(
        process.execPath,
        [fileURLToPath(import.meta.url)],
        {
          env: { ...process.env, [CI_LINEAGE_ENV]: lineageId },
        },
      );
      if (result.stdout.trim()) console.log(result.stdout.trim());
      if (result.stderr.trim()) console.error(result.stderr.trim());
    }
    console.log(
      "legacy bridge CI: canonical and pinned Replit lineages both passed",
    );
    return;
  }
  assert(
    [LEGACY_LINEAGE_CANONICAL, LEGACY_LINEAGE_PRODUCTION_PUSH_MANAGED].includes(
      requestedLineage,
    ),
    "CI legacy lineage is not pinned",
  );
  const baseUrl = process.env.DATABASE_URL;
  assert(baseUrl, "DATABASE_URL is required");
  const parsedBase = new URL(baseUrl);
  assert(
    ["localhost", "127.0.0.1", "::1"].includes(parsedBase.hostname),
    "legacy bridge rehearsal requires local disposable PostgreSQL",
  );

  const suffix = `${process.pid}_${randomBytes(3).toString("hex")}`;
  const sourceDatabase = `valo_bridge_ci_source_${suffix}`;
  const bridgeDatabase = `valo_bridge_ci_target_${suffix}`;
  const freshDatabase = `valo_bridge_ci_fresh_${suffix}`;
  const incrementalDatabase = `valo_bridge_ci_incremental_${suffix}`;
  const migratorRole = `valo_bridge_ci_migrator_${suffix}`;
  const migratorPassword = randomBytes(32).toString("hex");
  const databases = [
    sourceDatabase,
    bridgeDatabase,
    freshDatabase,
    incrementalDatabase,
  ];
  const sourceUrl = withDatabase(baseUrl, sourceDatabase, {
    username: migratorRole,
    password: migratorPassword,
  });
  const bridgeUrl = withDatabase(baseUrl, bridgeDatabase);
  const bridgeMigratorUrl = withDatabase(baseUrl, bridgeDatabase, {
    username: migratorRole,
    password: migratorPassword,
  });
  const freshUrl = withDatabase(baseUrl, freshDatabase);
  const freshMigratorUrl = withDatabase(baseUrl, freshDatabase, {
    username: migratorRole,
    password: migratorPassword,
  });
  const incrementalMigratorUrl = withDatabase(baseUrl, incrementalDatabase, {
    username: migratorRole,
    password: migratorPassword,
  });
  const runtimePasswordA = randomBytes(32).toString("hex");
  const runtimePasswordB = randomBytes(32).toString("hex");
  const runtimeUrlA = withDatabase(baseUrl, bridgeDatabase, {
    username: "valo_app_runtime",
    password: runtimePasswordA,
  });
  const runtimeUrlB = withDatabase(baseUrl, bridgeDatabase, {
    username: "valo_app_runtime",
    password: runtimePasswordB,
  });
  const evidenceDirectory = await mkdtemp(
    resolve(tmpdir(), "bidbox-bridge-ci-evidence-"),
  );
  await chmod(evidenceDirectory, 0o700);
  const backupPath = resolve(evidenceDirectory, "synthetic-legacy.dump");
  const auditExportPath = resolve(evidenceDirectory, "synthetic-audit.ndjson");
  const manifestPath = resolve(
    evidenceDirectory,
    "synthetic-restore-manifest.json",
  );

  const [migrationFiles, bridgeSql] = await Promise.all([
    Promise.all(migrationPaths.map((path) => readFile(path, "utf8"))),
    readFile(bridgeSqlPath, "utf8"),
  ]);
  const [migration0000, migration0001, migration0002] = migrationFiles;
  const expectedJournal = [
    1786221409612, 1786221441937, 1786251600000, 1786338364994, 1786339089360,
    1786339224638, 1786425600000, 1786622400000, 1786708800000, 1786752000000,
    1787385600000, 1787472000000, 1787558400000, 1787644800000,
  ].map((createdAt, index) => ({
    created_at: String(createdAt),
    hash: sha256(migrationFiles[index]),
  }));
  const canonicalLegacyShape = extractLegacyShape(bridgeSql);
  const legacyShape = legacyColumnsForLineage(
    canonicalLegacyShape,
    requestedLineage,
  );
  const admin = await connectUtc(baseUrl);
  try {
    const capabilities =
      await admin.query(`SELECT r.rolsuper,r.rolcreatedb,r.rolcreaterole,
        EXISTS (SELECT 1 FROM pg_roles WHERE rolname='valo_app_runtime') AS runtime_exists
      FROM pg_roles r WHERE r.rolname=current_user`);
    assert.equal(
      capabilities.rows[0]?.rolsuper,
      true,
      "CI administrator needs SUPERUSER to attest SCRAM password rotation",
    );
    assert.equal(
      capabilities.rows[0]?.rolcreatedb,
      true,
      "CI owner needs CREATEDB",
    );
    assert.equal(
      capabilities.rows[0]?.rolcreaterole,
      true,
      "CI owner needs CREATEROLE",
    );
    assert.equal(
      capabilities.rows[0]?.runtime_exists,
      false,
      "disposable CI cluster must not begin with valo_app_runtime",
    );
    assert(
      /^valo_bridge_ci_migrator_[a-z0-9_]+$/.test(migratorRole),
      "unsafe CI migrator role",
    );
    await admin.query(
      `CREATE ROLE ${quoteIdentifier(migratorRole)} LOGIN PASSWORD '${migratorPassword}'
        NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS`,
    );
    await createDatabase(admin, sourceDatabase, migratorRole);
    await createDatabase(admin, bridgeDatabase, migratorRole);
    await createDatabase(admin, freshDatabase, migratorRole);
    await createDatabase(admin, incrementalDatabase, migratorRole);

    await assertIncrementalTenantPreflight(
      incrementalMigratorUrl,
      migration0000,
      migration0001,
      migration0002,
    );

    const source = await connectUtc(sourceUrl);
    let sourceDigests;
    let sourceAuditExport;
    let events;
    let postgresMajor;
    try {
      await source.query(legacyDdl(migration0000, legacyShape));
      events = await seedLegacyFixture(source, legacyShape);
      sourceDigests = await legacyDigests(source, legacyShape);
      sourceAuditExport = await auditExport(source);
      postgresMajor = Number(
        (await source.query("SHOW server_version_num")).rows[0]
          .server_version_num,
      );
      postgresMajor = Math.floor(postgresMajor / 10000);
    } finally {
      await source.end();
    }
    const sourceCatalogEvidence = await catalogEvidence(sourceUrl);

    assert.deepEqual(Object.keys(sourceDigests).sort(), LEGACY_TABLES);
    assert.equal(sourceDigests.audit_events.rowCount, 28);
    for (const table of LEGACY_TABLES) {
      assert(
        sourceDigests[table].rowCount > 0,
        `${table} must contain a synthetic fixture row`,
      );
    }
    assert.equal(sourceDigests.users.rowCount, 3);

    await runCommand(
      "pg_dump",
      [
        "--format=custom",
        "--no-owner",
        "--no-privileges",
        "--file",
        backupPath,
      ],
      { env: postgresEnvironment(sourceUrl) },
    );
    await chmod(backupPath, 0o600);
    const restoreList = await runCommand("pg_restore", ["--list", backupPath]);
    assert.match(restoreList.stdout, /TABLE DATA public audit_events/);
    await runCommand(
      "pg_restore",
      [
        "--exit-on-error",
        "--no-owner",
        "--no-privileges",
        "--dbname",
        bridgeDatabase,
        backupPath,
      ],
      { env: postgresEnvironment(bridgeMigratorUrl) },
    );

    const restored = await connectUtc(bridgeUrl);
    let restoredDigests;
    try {
      restoredDigests = await legacyDigests(restored, legacyShape);
      assert.deepEqual(restoredDigests, sourceDigests);
      assert.equal(await auditExport(restored), sourceAuditExport);
    } finally {
      await restored.end();
    }
    const restoredCatalogEvidence = await catalogEvidence(bridgeMigratorUrl);
    assert.deepEqual(
      restoredCatalogEvidence,
      sourceCatalogEvidence,
      "custom-format restore must preserve the authenticated legacy catalog",
    );

    await writeFile(auditExportPath, sourceAuditExport, { mode: 0o600 });
    const backupBytes = await readFile(backupPath);
    const auditBytes = await readFile(auditExportPath);
    const head = events.at(-1);
    const legacyLineage = {
      id: requestedLineage,
      columnFingerprintAlgorithm: LEGACY_COLUMN_FINGERPRINT_ALGORITHM,
      columnFingerprintSha256: legacyColumnFingerprint(legacyShape),
    };
    const manifest = {
      format: "valo.restore-rehearsal.v3",
      capturedAt: new Date().toISOString(),
      sourceCommit: SOURCE_COMMIT,
      target: {
        database: bridgeDatabase,
        organisationId: ORGANISATION_ID,
        organisationName: "Valo Nigeria",
        organisationSlug: "valo-nigeria",
      },
      backup: {
        fileName: basename(backupPath),
        sha256: sha256(backupBytes),
        pgRestoreListVerified: true,
        scratchRestoreExitStatus: 0,
        postgresMajor,
      },
      auditExport: {
        fileName: basename(auditExportPath),
        sha256: sha256(auditBytes),
      },
      rowCounts: Object.fromEntries(
        LEGACY_TABLES.map((table) => [table, sourceDigests[table].rowCount]),
      ),
      audit: {
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
        externalHead: {
          seq: 28,
          hash: head.hash,
          prevHash: head.prev_hash,
        },
      },
      componentManifestSha256: sha256(
        JSON.stringify({
          fixture: "synthetic-v1",
          legacyLineage,
          tableDigests: sourceDigests,
        }),
      ),
      tableDigestAlgorithm: SOURCE_DIGEST_ALGORITHM,
      tableDigests: sourceDigests,
      allTableDigestsMatchProduction: true,
      legacyCatalog: restoredCatalogEvidence,
      legacyLineage,
    };
    const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
    await writeFile(manifestPath, manifestBytes, { mode: 0o600 });
    await Promise.all(
      [backupPath, auditExportPath, manifestPath].map((path) =>
        chmod(path, 0o600),
      ),
    );
    const manifestSha256 = sha256(manifestBytes);
    const bridgeEnvironment = {
      DATABASE_URL: bridgeMigratorUrl,
      VALO_RUNTIME_DATABASE_URL: runtimeUrlA,
      VALO_BRIDGE_APPLICATION_QUIESCED_ACK:
        "RESTORE_VERIFIED_AND_APPLICATION_QUIESCED",
      VALO_BRIDGE_PLATFORM_ADMIN_CLERK_USER_ID: PLATFORM_ADMIN_ID,
      VALO_BRIDGE_SOURCE_BACKUP_PATH: backupPath,
      VALO_BRIDGE_SOURCE_AUDIT_EXPORT_PATH: auditExportPath,
      VALO_BRIDGE_REHEARSAL_MANIFEST_PATH: manifestPath,
      VALO_BRIDGE_EXPECTED_REHEARSAL_MANIFEST_SHA256: manifestSha256,
    };
    const rollbackRuntimeUrl = withDatabase(bridgeMigratorUrl, bridgeDatabase, {
      username: "valo_app_runtime",
      password: runtimePasswordA,
    });
    const rollbackEnvironment = {
      ...bridgeEnvironment,
      DATABASE_URL: bridgeMigratorUrl,
      VALO_RUNTIME_DATABASE_URL: rollbackRuntimeUrl,
    };

    const beforeFailure = await connectUtc(bridgeUrl);
    const rollbackBaseline = await legacyRollbackSnapshot(
      beforeFailure,
      legacyShape,
    );
    assert.equal(
      rollbackBaseline.relations.filter((relation) => relation.relkind === "r")
        .length,
      19,
    );
    assert.equal(
      rollbackBaseline.relations.filter((relation) => relation.relkind === "S")
        .length,
      1,
    );
    assert(
      rollbackBaseline.relations.every(
        (relation) => relation.owner === migratorRole,
      ),
      "restored tables, indexes and sequence must be owned by the restricted migrator",
    );
    assert.equal(
      rollbackBaseline.constraints.filter(
        (constraint) => constraint.contype === "f",
      ).length,
      39,
      "legacy fixture must restore the complete applicable FK graph",
    );
    assert.equal(rollbackBaseline.constraints.length, 59);
    assert.equal(rollbackBaseline.indexes.length, 22);
    assert.deepEqual(rollbackBaseline.triggers, []);
    assert.deepEqual(rollbackBaseline.policies, []);
    await beforeFailure.end();
    const failed = await runBridge(rollbackEnvironment, true);
    assert.notEqual(failed.code, 0, "restricted migrator must fail the runner");
    assert.match(
      `${failed.stderr}\n${failed.stdout}`,
      /permission denied to create role|must have CREATEROLE/i,
    );
    const afterFailure = await connectUtc(bridgeUrl);
    try {
      assert.deepEqual(
        await legacyRollbackSnapshot(afterFailure, legacyShape),
        rollbackBaseline,
        "natural late CREATE ROLE failure must leave the legacy database unchanged",
      );
      assert.equal(
        (
          await afterFailure.query(
            "SELECT count(*)::integer AS count FROM pg_roles WHERE rolname='valo_app_runtime'",
          )
        ).rows[0].count,
        0,
        "natural late CREATE ROLE failure must roll back runtime role creation",
      );
      const leakedArtifacts = await afterFailure.query(`SELECT
          to_regnamespace('valo_security') IS NOT NULL AS security_schema,
          to_regnamespace('valo_legacy_bridge_archive') IS NOT NULL AS archive_schema,
          to_regnamespace('drizzle') IS NOT NULL AS journal_schema,
          to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS journal_table`);
      assert.deepEqual(leakedArtifacts.rows[0], {
        security_schema: false,
        archive_schema: false,
        journal_schema: false,
        journal_table: false,
      });
    } finally {
      await afterFailure.end();
    }
    console.log(
      "legacy bridge CI: natural late CREATE ROLE failure rolled back with zero drift",
    );

    await admin.query(`ALTER ROLE ${quoteIdentifier(migratorRole)} CREATEROLE`);
    const succeeded = await runBridge(bridgeEnvironment);
    assert.match(succeeded.stdout, /runtime RLS proof passed/);
    const runtimeAdministration = await admin.query(
      `SELECT membership.admin_option
       FROM pg_catalog.pg_auth_members AS membership
       JOIN pg_catalog.pg_roles AS runtime_role
         ON runtime_role.oid=membership.roleid
       JOIN pg_catalog.pg_roles AS migrator_role
         ON migrator_role.oid=membership.member
       WHERE runtime_role.rolname='valo_app_runtime'
         AND migrator_role.rolname=$1`,
      [migratorRole],
    );
    assert.deepEqual(
      runtimeAdministration.rows,
      [{ admin_option: true }],
      "PG16 must give the creating migrator ADMIN OPTION for safe role rotation",
    );
    const runtimeVerifierA = (
      await admin.query(
        "SELECT rolpassword FROM pg_catalog.pg_authid WHERE rolname='valo_app_runtime'",
      )
    ).rows[0]?.rolpassword;
    assert(
      typeof runtimeVerifierA === "string" &&
        runtimeVerifierA.startsWith("SCRAM-SHA-256$"),
      "the first runtime password must be stored as a SCRAM verifier",
    );
    const invalidRuntimeUrl = withDatabase(baseUrl, bridgeDatabase, {
      username: "valo_app_runtime",
      password: randomBytes(32).toString("hex"),
    });
    const passwordAuthenticationEnforced =
      await passwordAuthenticationRejected(invalidRuntimeUrl);
    const bridged = await connectUtc(bridgeUrl);
    let catalogBeforeNoOp;
    let dataBeforeNoOp;
    try {
      assert.deepEqual(
        await legacyDigests(bridged, legacyShape, true),
        sourceDigests,
        "bridge must preserve every legacy ID and projected value",
      );
      if (requestedLineage === LEGACY_LINEAGE_PRODUCTION_PUSH_MANAGED) {
        const nullableAdditions = await bridged.query(
          `SELECT
             document.sha256,
             document.extraction_method,
             document.extraction_confidence,
             document.extraction_notes,
             llm.prompt_tokens,
             llm.completion_tokens,
             report.taxonomy_version
           FROM public.documents AS document
           CROSS JOIN public.llm_runs AS llm
           CROSS JOIN public.reports AS report
           WHERE document.id=$1::uuid
             AND llm.id=$2::uuid
             AND report.id=$3::uuid`,
          [IDS.document, IDS.llmRun, IDS.report],
        );
        assert.deepEqual(nullableAdditions.rows, [
          {
            sha256: sha256("synthetic tender fixture"),
            extraction_method: null,
            extraction_confidence: null,
            extraction_notes: null,
            prompt_tokens: null,
            completion_tokens: null,
            taxonomy_version: null,
          },
        ]);
      }
      const auditBoundary = await bridged.query(
        `SELECT
          assessment.source_event_count,
          assessment.verified_ranges,
          assessment.discontinuity_ranges,
          assessment.external_head_seq,
          assessment.external_head_hash,
          assessment.source_backup_sha256,
          assessment.source_audit_export_sha256,
          assessment.rehearsal_evidence_sha256,
          assessment.archive_digest,
          boundary.organisation_id::text AS organisation_id,
          boundary.user_id::text AS user_id,
          boundary.user_name,
          boundary.project_id::text AS project_id,
          boundary.event_type,
          boundary.object_type,
          boundary.object_id,
          boundary.details,
          boundary.seq,
          boundary.prev_hash,
          boundary.hash,
          boundary.hash_version,
          boundary.row_no::integer AS boundary_row_no,
          to_char(boundary.created_at AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS boundary_created_at,
          (SELECT count(*)::integer FROM public.legacy_audit_events) AS archived,
          (SELECT count(*)::integer FROM public.legacy_audit_events
            WHERE integrity_status='known_discontinuity') AS known,
          (SELECT count(*)::integer FROM public.legacy_audit_events
            WHERE integrity_status='payload_hash_verified') AS verified,
          (SELECT count(*)::integer FROM public.legacy_audit_events
            WHERE project_id=$3::uuid) AS preserved_deleted_project_refs,
          (SELECT min(seq)::integer FROM public.legacy_audit_events) AS min_seq,
          (SELECT max(seq)::integer FROM public.legacy_audit_events) AS max_seq,
          (SELECT count(*)::integer FROM (
            SELECT prev_hash,
              lag(hash,1,repeat('0',64)) OVER (ORDER BY seq) AS expected_prev
            FROM public.legacy_audit_events
          ) chain WHERE prev_hash<>expected_prev) AS broken_links,
          (SELECT hash FROM public.legacy_audit_events ORDER BY seq DESC LIMIT 1)
            AS archived_head_hash,
          (SELECT prev_hash FROM public.legacy_audit_events ORDER BY seq DESC LIMIT 1)
            AS archived_head_prev_hash,
          (SELECT count(*)::integer FROM public.audit_events) AS active,
          (SELECT count(*)::integer FROM public.legacy_audit_integrity_assessments)
            AS assessments,
          (SELECT count(*)::integer FROM drizzle.__drizzle_migrations)
            AS journal_entries
        FROM public.legacy_audit_integrity_assessments assessment
        JOIN public.audit_events boundary
          ON boundary.id=$1::uuid AND assessment.id=$2::uuid`,
        [BOUNDARY_ID, ASSESSMENT_ID, HISTORICAL_DELETED_PROJECT_ID],
      );
      assert.equal(auditBoundary.rowCount, 1);
      const boundary = auditBoundary.rows[0];
      assert.deepEqual(
        {
          source_event_count: boundary.source_event_count,
          verified_ranges: boundary.verified_ranges,
          discontinuity_ranges: boundary.discontinuity_ranges,
          external_head_seq: boundary.external_head_seq,
          external_head_hash: boundary.external_head_hash,
          source_backup_sha256: boundary.source_backup_sha256,
          source_audit_export_sha256: boundary.source_audit_export_sha256,
          rehearsal_evidence_sha256: boundary.rehearsal_evidence_sha256,
          archive_digest: boundary.archive_digest,
          organisation_id: boundary.organisation_id,
          user_id: boundary.user_id,
          user_name: boundary.user_name,
          project_id: boundary.project_id,
          event_type: boundary.event_type,
          object_type: boundary.object_type,
          object_id: boundary.object_id,
          seq: boundary.seq,
          prev_hash: boundary.prev_hash,
          hash_version: boundary.hash_version,
          boundary_row_no: boundary.boundary_row_no,
          archived: boundary.archived,
          known: boundary.known,
          verified: boundary.verified,
          preserved_deleted_project_refs:
            boundary.preserved_deleted_project_refs,
          min_seq: boundary.min_seq,
          max_seq: boundary.max_seq,
          broken_links: boundary.broken_links,
          archived_head_hash: boundary.archived_head_hash,
          archived_head_prev_hash: boundary.archived_head_prev_hash,
          active: boundary.active,
          assessments: boundary.assessments,
          journal_entries: boundary.journal_entries,
        },
        {
          source_event_count: 28,
          verified_ranges: "1-7,27-28",
          discontinuity_ranges: "8-26",
          external_head_seq: 28,
          external_head_hash: head.hash,
          source_backup_sha256: sha256(backupBytes),
          source_audit_export_sha256: sha256(auditBytes),
          rehearsal_evidence_sha256: manifestSha256,
          archive_digest: sha256(auditBytes),
          organisation_id: ORGANISATION_ID,
          user_id: null,
          user_name: "Valo migration bridge",
          project_id: null,
          event_type: "audit.legacy_boundary_registered",
          object_type: "legacy_audit_integrity_assessment",
          object_id: ASSESSMENT_ID,
          seq: 1,
          prev_hash: "0".repeat(64),
          hash_version: 2,
          boundary_row_no: 561,
          archived: 28,
          known: 19,
          verified: 9,
          preserved_deleted_project_refs: 19,
          min_seq: 1,
          max_seq: 28,
          broken_links: 0,
          archived_head_hash: head.hash,
          archived_head_prev_hash: head.prev_hash,
          active: 1,
          assessments: 1,
          journal_entries: 3,
        },
      );
      assert.equal(
        boundary.hash,
        auditHash(
          boundary.prev_hash,
          {
            seq: boundary.seq,
            organisationId: boundary.organisation_id,
            userId: boundary.user_id,
            userName: boundary.user_name,
            projectId: boundary.project_id,
            eventType: boundary.event_type,
            objectType: boundary.object_type,
            objectId: boundary.object_id,
            details: boundary.details,
            createdAt: boundary.boundary_created_at,
          },
          2,
        ),
        "active v2 genesis boundary hash must recompute",
      );
      const tenantState = await bridged.query(
        `SELECT
          (SELECT count(*)::integer FROM public.users
            WHERE role='restricted_platform_administrator') AS platform_admins,
          (SELECT count(*)::integer FROM public.users WHERE role='none') AS tenant_only_admins,
          (SELECT count(*)::integer FROM public.organisation_memberships
            WHERE organisation_id=$1::uuid AND status='active') AS memberships,
          (SELECT count(*)::integer FROM public.role_grants grant_record
            JOIN public.organisation_memberships membership
              ON membership.id=grant_record.membership_id
            WHERE membership.organisation_id=$1::uuid
              AND grant_record.role='valo_operations_administrator') AS operations_grants,
          (SELECT count(*)::integer FROM pg_catalog.pg_class c
            JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
            WHERE n.nspname='public' AND c.relkind IN ('r','p')) AS tables,
          (SELECT count(*)::integer FROM pg_catalog.pg_class c
            JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
            WHERE n.nspname='public' AND c.relkind IN ('r','p')
              AND c.relrowsecurity AND c.relforcerowsecurity) AS force_rls,
          (SELECT count(*)::integer FROM pg_catalog.pg_policies
            WHERE schemaname='public') AS policies,
          (SELECT count(*)::integer
            FROM pg_catalog.pg_trigger trigger_record
            JOIN pg_catalog.pg_class relation
              ON relation.oid=trigger_record.tgrelid
            JOIN pg_catalog.pg_namespace relation_namespace
              ON relation_namespace.oid=relation.relnamespace
            JOIN pg_catalog.pg_proc routine
              ON routine.oid=trigger_record.tgfoid
            JOIN pg_catalog.pg_namespace routine_namespace
              ON routine_namespace.oid=routine.pronamespace
            WHERE relation_namespace.nspname='public'
              AND relation.relname='requirements'
              AND trigger_record.tgname='tenant_parent_project_id'
              AND NOT trigger_record.tgisinternal
              AND routine_namespace.nspname='valo_security'
              AND routine.proname='enforce_tenant_parent')
            AS requirement_parent_triggers`,
        [ORGANISATION_ID],
      );
      assert.deepEqual(tenantState.rows[0], {
        platform_admins: 1,
        tenant_only_admins: 2,
        memberships: 3,
        operations_grants: 3,
        tables: 96,
        force_rls: 85,
        policies: 104,
        requirement_parent_triggers: 1,
      });
      assert.equal(
        await auditExport(bridged, "public.legacy_audit_events"),
        sourceAuditExport,
      );
      await assertRuntimeContract(bridged, {
        productionAssuranceExpected: false,
        retrievalRegistryExpected: false,
        tenderContextExpected: false,
        retentionCompletionExpected: false,
      });
      await assertTenantGuardCatalog(bridged, {
        productionAssuranceExpected: false,
        retrievalRegistryExpected: false,
        tenderContextExpected: false,
        retentionCompletionExpected: false,
      });
    } finally {
      await bridged.end();
    }
    await assertRuntimeParentIsolation(runtimeUrlA, bridgeUrl);
    console.log(
      "legacy bridge CI: 19-table values, 28-row archive, boundary 561, runtime bidirectional RLS and tenant relationship matrix passed",
    );

    await seedLegacyStorageBackfillFixtures(bridgeUrl);
    await applyMigrations(bridgeMigratorUrl);
    const afterNoOp = await connectUtc(bridgeUrl);
    try {
      // The bridge adopts 0000-0002 while materialising the pre-existing
      // target catalog. Later source migrations may be genuinely additive;
      // capture their resulting catalog as the completed-target baseline that
      // the idempotent bridge rerun and fresh-schema path must both match.
      await assertAndRemoveLegacyStorageBackfillFixtures(afterNoOp);
      catalogBeforeNoOp = await normalizedCatalog(afterNoOp);
      assert.deepEqual(
        await legacyDigests(afterNoOp, legacyShape, true),
        sourceDigests,
        "additive source migrations must preserve every legacy ID and projected value",
      );
      assert.equal(
        await auditExport(afterNoOp, "public.legacy_audit_events"),
        sourceAuditExport,
        "additive source migrations must preserve the archived audit export",
      );
      dataBeforeNoOp = await allPublicDataDigests(afterNoOp);
      const journal = await afterNoOp.query(
        "SELECT created_at::text,hash FROM drizzle.__drizzle_migrations ORDER BY created_at",
      );
      assert.deepEqual(journal.rows, expectedJournal);
      await assertRuntimeContract(afterNoOp, {
        productionAssuranceExpected: true,
        retrievalRegistryExpected: true,
        tenderContextExpected: true,
        retentionCompletionExpected: true,
      });
    } finally {
      await afterNoOp.end();
    }
    console.log(
      "legacy bridge CI: adopted v2.5 journal plus additive source migrations reconciled without legacy-data drift",
    );

    const rotatedBridgeEnvironment = {
      ...bridgeEnvironment,
      VALO_RUNTIME_DATABASE_URL: runtimeUrlB,
    };
    const idempotent = await runBridge(rotatedBridgeEnvironment);
    assert.match(idempotent.stdout, /runtime RLS proof passed/);
    const rotatedRuntime = await connectUtc(runtimeUrlB);
    try {
      assert.deepEqual(
        (
          await rotatedRuntime.query(
            "SELECT current_user AS current_role,session_user AS session_role",
          )
        ).rows[0],
        {
          current_role: "valo_app_runtime",
          session_role: "valo_app_runtime",
        },
      );
    } finally {
      await rotatedRuntime.end();
    }
    assert.equal(
      await passwordAuthenticationRejected(runtimeUrlA),
      passwordAuthenticationEnforced,
      passwordAuthenticationEnforced
        ? "the completed-target rotation must invalidate runtime password A"
        : "a trust-authenticated rehearsal cannot distinguish old passwords at connection time",
    );
    const runtimeVerifierB = (
      await admin.query(
        "SELECT rolpassword FROM pg_catalog.pg_authid WHERE rolname='valo_app_runtime'",
      )
    ).rows[0]?.rolpassword;
    assert(
      typeof runtimeVerifierB === "string" &&
        runtimeVerifierB.startsWith("SCRAM-SHA-256$"),
      "the rotated runtime password must be stored as a SCRAM verifier",
    );
    assert.notEqual(
      sha256(runtimeVerifierB),
      sha256(runtimeVerifierA),
      "completed-target rerun must rotate the SCRAM verifier",
    );
    const afterRerun = await connectUtc(bridgeUrl);
    let bridgeCatalog;
    try {
      await assertRuntimeContract(afterRerun, {
        productionAssuranceExpected: true,
        retrievalRegistryExpected: true,
        tenderContextExpected: true,
        retentionCompletionExpected: true,
      });
      await assertTenantGuardCatalog(afterRerun);
      assert.deepEqual(await normalizedCatalog(afterRerun), catalogBeforeNoOp);
      assert.deepEqual(await allPublicDataDigests(afterRerun), dataBeforeNoOp);
      assert.deepEqual(
        await legacyDigests(afterRerun, legacyShape, true),
        sourceDigests,
      );
      bridgeCatalog = await normalizedCatalog(afterRerun);
    } finally {
      await afterRerun.end();
    }
    console.log("legacy bridge CI: completed-target rerun is idempotent");

    await applyMigrations(freshMigratorUrl);
    const fresh = await connectUtc(freshUrl);
    try {
      // Fresh migrations promise the structural/security catalog, not the
      // bridge runner's complete runtime-role grant reconciliation.
      await assertTenantGuardCatalog(fresh);
      const freshCatalog = await normalizedCatalog(fresh);
      for (const section of Object.keys(bridgeCatalog)) {
        assert.deepEqual(
          bridgeCatalog[section],
          freshCatalog[section],
          `bridge/fresh normalized ${section} catalog mismatch`,
        );
      }
      console.log(
        `legacy bridge CI: fresh catalog parity passed (${bridgeCatalog.relations.length} relations, ${bridgeCatalog.policies.length} policies, ${bridgeCatalog.constraints.length} constraints, ${bridgeCatalog.indexes.length} indexes, ${bridgeCatalog.functions.length} functions, ${bridgeCatalog.triggers.length} triggers, ${bridgeCatalog.grants.length} non-runtime grants)`,
      );
    } finally {
      await fresh.end();
    }
  } finally {
    for (const name of databases.reverse()) {
      await dropDatabase(admin, name).catch(() => undefined);
    }
    await admin
      .query("DROP ROLE IF EXISTS valo_app_runtime")
      .catch(() => undefined);
    await admin
      .query(`DROP ROLE IF EXISTS ${quoteIdentifier(migratorRole)}`)
      .catch(() => undefined);
    await admin.end();
    await rm(evidenceDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(
    "legacy bridge CI rehearsal failed:",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
