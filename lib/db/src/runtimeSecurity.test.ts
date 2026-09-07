import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import {
  assertAuthenticatedRateLimitFunctionAttestation,
  assertDeliveryGuardFunctionAttestation,
  assertDeliveryGuardTriggerAttestation,
  assertIntakeFunctionAttestation,
  assertTenantGraphAttestation,
  assertRuntimePolicyAttestation,
  EXPECTED_PUBLIC_SECURITY_TRIGGER_COUNT,
  isProductionRuntime,
  selectDatabaseConnectionString,
} from "./runtimeSecurity";
import { INTAKE_FUNCTION_MANIFEST } from "./intakeFunctionManifest";

const SPECIAL_TENANT_TRIGGERS = [
  [
    "audit_events.audit_events_append_only:reject_active_audit_mutation",
    27,
    "",
  ],
  [
    "break_glass_sessions.tenant_break_glass_target_immutable:reject_tenant_identity_reassignment",
    19,
    "target_organisation_id",
  ],
  [
    "break_glass_sessions.tenant_control_break_glass_context:enforce_control_plane_tenant_context",
    23,
    "",
  ],
  [
    "addendum_impact_assessments.addendum_impact_assessment_content_immutable:reject_versioned_record_content_mutation",
    19,
    "id,organisation_id,project_id,baseline_document_version_id,revision_document_version_id,radar_id,assessment_id,source_manifest_sha256,impact_manifest_sha256,assessment_snapshot,created_at",
  ],
  [
    "addendum_impact_assessments.addendum_impact_assessment_state_transition:enforce_governed_state_transition",
    23,
    "",
  ],
  [
    "addendum_impact_items.addendum_impact_item_content_immutable:reject_versioned_record_content_mutation",
    19,
    "id,organisation_id,assessment_id,change_id,category,kind,before_text,after_text,citation_data,field_external_id,affected_object_type,affected_object_id,affected_object_version,proposed_action,created_at",
  ],
  [
    "addendum_impact_items.addendum_impact_item_state_transition:enforce_governed_state_transition",
    23,
    "",
  ],
  [
    "document_versions.document_version_content_immutable:reject_versioned_record_content_mutation",
    19,
    "id,organisation_id,document_id,version_number,supersedes_version_id,object_path,sha256,detected_mime,detected_format,size_bytes,integrity_manifest,uploaded_by,created_at",
  ],
  [
    "document_version_snapshots.document_version_snapshot_content_immutable:reject_versioned_record_content_mutation",
    19,
    "id,organisation_id,document_version_id,document_version_sha256,captured_redaction_status,canonical_text,canonical_text_sha256,structured_snapshot,structured_snapshot_sha256,extraction_method,parser_version,captured_by_user_id,captured_by_name,created_at",
  ],
  [
    "document_version_snapshots.document_version_snapshot_state_transition:enforce_governed_state_transition",
    23,
    "",
  ],
  [
    "deletion_certificates.deletion_certificate_completion_guard:enforce_retention_completion_transition",
    31,
    "",
  ],
  [
    "invoice_lines.tenant_derived_invoice_order:enforce_derived_tenant_relationship",
    23,
    "invoice_id,order_id",
  ],
  [
    "legacy_audit_events.legacy_audit_events_immutable:reject_legacy_audit_mutation",
    27,
    "",
  ],
  [
    "legacy_audit_integrity_assessments.legacy_audit_assessments_immutable:reject_legacy_audit_mutation",
    27,
    "",
  ],
  [
    "orders.tenant_derived_price_book_entry:enforce_derived_tenant_relationship",
    23,
    "organisation_id,price_book_entry_id",
  ],
  [
    "organisations.tenant_control_organisation_context:enforce_control_plane_tenant_context",
    7,
    "",
  ],
  [
    "organisation_memberships.tenant_membership_organisation_immutable:reject_tenant_identity_reassignment",
    19,
    "organisation_id",
  ],
  [
    "organisation_memberships.tenant_control_membership_context:enforce_control_plane_tenant_context",
    23,
    "",
  ],
  [
    "partner_relationships.tenant_derived_partner_approver:enforce_derived_tenant_relationship",
    23,
    "approved_by_membership_id,status",
  ],
  [
    "partner_relationships.tenant_partner_parties_immutable:reject_tenant_identity_reassignment",
    19,
    "partner_organisation_id,client_organisation_id",
  ],
  [
    "partner_relationships.tenant_control_partner_context:enforce_control_plane_tenant_context",
    23,
    "",
  ],
  [
    "partner_revenue_share_entries.tenant_derived_partner_revenue:enforce_derived_tenant_relationship",
    23,
    "partner_organisation_id,client_organisation_id,order_id",
  ],
  [
    "role_grants.tenant_derived_role_grant:enforce_derived_tenant_relationship",
    7,
    "",
  ],
  [
    "role_grants.tenant_role_grant_identity_immutable:reject_tenant_identity_reassignment",
    19,
    "membership_id,granted_by_membership_id",
  ],
  [
    "role_grants.tenant_control_role_grant_context:enforce_control_plane_tenant_context",
    23,
    "",
  ],
  [
    "retention_actions.retention_action_completion_guard:enforce_retention_completion_transition",
    31,
    "",
  ],
  [
    "retention_requests.retention_request_completion_guard:enforce_retention_completion_transition",
    31,
    "",
  ],
  [
    "retention_action_storage_events.retention_action_storage_event_completion_guard:enforce_retention_completion_transition",
    31,
    "",
  ],
  [
    "subscriptions.tenant_derived_price_book_entry:enforce_derived_tenant_relationship",
    23,
    "organisation_id,price_book_entry_id",
  ],
  [
    "tender_context_artifacts.tender_context_artifact_immutable:reject_versioned_record_content_mutation",
    19,
    "",
  ],
  [
    "tender_context_requirements.tender_context_requirement_immutable:reject_versioned_record_content_mutation",
    19,
    "",
  ],
  [
    "tender_context_versions.tender_context_version_content_immutable:reject_versioned_record_content_mutation",
    19,
    "id,organisation_id,project_id,version_number,supersedes_context_version_id,primary_document_version_id,jurisdiction_rule_pack_id,legal_entity_name,submission_date,jurisdiction,entity_scopes,category_scopes,source_manifest,source_manifest_sha256,context_snapshot,context_sha256,rule_advisories,created_by_user_id,created_at",
  ],
  [
    "tender_context_versions.tender_context_version_state_transition:enforce_governed_state_transition",
    23,
    "",
  ],
  [
    "tender_eligibility_passports.tender_eligibility_passport_content_immutable:reject_versioned_record_content_mutation",
    19,
    "id,organisation_id,project_id,tender_context_version_id,passport_id,source_manifest_sha256,result_snapshot,result_snapshot_sha256,result_status,created_by_user_id,created_at",
  ],
  [
    "tender_eligibility_passports.tender_eligibility_passport_state_transition:enforce_governed_state_transition",
    23,
    "",
  ],
].map(([trigger_contract, trigger_type, update_columns]) => ({
  trigger_contract: String(trigger_contract),
  enabled: true,
  trigger_type: Number(trigger_type),
  update_columns: String(update_columns),
  trigger_args_hex: "",
  when_clause: null,
}));
const migration = readFileSync(
  new URL("../migrations/0002_audit_integrity_boundary.sql", import.meta.url),
  "utf8",
);
const tenantRlsMigration = readFileSync(
  new URL("../migrations/0001_tenant_rls.sql", import.meta.url),
  "utf8",
);
const runtimeSecuritySource = readFileSync(
  new URL("./runtimeSecurity.ts", import.meta.url),
  "utf8",
);
const intakeLimiterMigration = readFileSync(
  new URL("../migrations/0004_dizzy_virginia_dare.sql", import.meta.url),
  "utf8",
);
const intakeRetentionMigration = readFileSync(
  new URL("../migrations/0005_tranquil_jack_power.sql", import.meta.url),
  "utf8",
);
const intakeOperationsMigration = readFileSync(
  new URL("../migrations/0006_lead_operations_queue.sql", import.meta.url),
  "utf8",
);
const productionAssuranceMigration = readFileSync(
  new URL("../migrations/0008_production_assurance.sql", import.meta.url),
  "utf8",
);
const tenderContextMigration = readFileSync(
  new URL(
    "../migrations/0010_tender_context_and_addendum.sql",
    import.meta.url,
  ),
  "utf8",
);
const retentionCompletionMigration = readFileSync(
  new URL("../migrations/0011_retention_completion.sql", import.meta.url),
  "utf8",
);
const deliverySourceReleaseBoundaryMigration = readFileSync(
  new URL(
    "../migrations/0012_delivery_source_release_boundary.sql",
    import.meta.url,
  ),
  "utf8",
);

test("pins the post-0012 public security trigger inventory", () => {
  const deliverySourceGuards =
    deliverySourceReleaseBoundaryMigration.match(
      /^CREATE TRIGGER delivery_source_project_guard$/gmu,
    )?.length ?? 0;
  const projectDeleteGuards =
    deliverySourceReleaseBoundaryMigration.match(
      /^CREATE TRIGGER delivery_project_delete_guard$/gmu,
    )?.length ?? 0;

  assert.equal(deliverySourceGuards, 14);
  assert.equal(projectDeleteGuards, 1);
  assert.equal(
    EXPECTED_PUBLIC_SECURITY_TRIGGER_COUNT,
    153 + deliverySourceGuards + projectDeleteGuards,
  );
  assert.match(
    runtimeSecuritySource,
    /public_security_trigger_count !==\s*EXPECTED_PUBLIC_SECURITY_TRIGGER_COUNT/u,
  );
});

function productionAssuranceFunctionProofs() {
  const contracts = [
    {
      functionName: "consume_authenticated_actor_rate_limit",
      securityDefiner: true,
      argumentCount: 3,
      argumentTypes: "text, integer, integer",
      identityArguments:
        "p_bucket_key_sha256 text, p_window_seconds integer, p_max_requests integer",
      returnType: "record",
      functionResult:
        "TABLE(allowed boolean, remaining integer, reset_at timestamp with time zone)",
      returnsSet: true,
      runtimeCanExecute: true,
    },
    {
      functionName: "purge_expired_authenticated_rate_limit_buckets",
      securityDefiner: false,
      argumentCount: 0,
      argumentTypes: "",
      identityArguments: "",
      returnType: "bigint",
      functionResult: "bigint",
      returnsSet: false,
      runtimeCanExecute: false,
    },
  ] as const;
  return contracts.map((contract) => {
    const start = productionAssuranceMigration.indexOf(
      `CREATE FUNCTION valo_security.${contract.functionName}(`,
    );
    const sourceStart = productionAssuranceMigration.indexOf(
      "AS $function$",
      start,
    );
    const sourceEnd = productionAssuranceMigration.indexOf(
      "$function$;",
      sourceStart,
    );
    assert.ok(start >= 0 && sourceStart > start && sourceEnd > sourceStart);
    return {
      function_name: contract.functionName,
      language_name: "plpgsql",
      function_kind: "f",
      security_definer: contract.securityDefiner,
      leakproof: false,
      strict: false,
      volatility: "v",
      parallel_safety: "u",
      function_config: "search_path=pg_catalog",
      returns_trigger: false,
      argument_count: contract.argumentCount,
      argument_types: contract.argumentTypes,
      identity_arguments: contract.identityArguments,
      return_type: contract.returnType,
      function_result: contract.functionResult,
      returns_set: contract.returnsSet,
      owner_name: "synthetic_migration_owner",
      owner_is_schema_owner: true,
      runtime_can_execute: contract.runtimeCanExecute,
      function_source: productionAssuranceMigration.slice(
        sourceStart + "AS $function$".length,
        sourceEnd,
      ),
    };
  });
}

function intakeFunctionSource(migration: string, functionName: string): string {
  const match = migration.match(
    new RegExp(
      `CREATE(?: OR REPLACE)? FUNCTION "valo_intake"\\."${functionName}"\\([\\s\\S]*?AS \\$function\\$\\r?\\n([\\s\\S]*?)\\r?\\n\\$function\\$;`,
    ),
  );
  assert.ok(match?.[1], `missing ${functionName} migration body`);
  return match[1];
}

function migrationIntakeFunctions() {
  const common = {
    language_name: "plpgsql",
    function_kind: "f",
    security_definer: true,
    leakproof: false,
    strict: false,
    volatility: "v",
    parallel_safety: "u",
    function_config: "search_path=pg_catalog",
    returns_trigger: false,
    owner_name: "database_owner",
    owner_is_schema_owner: true,
    public_can_execute: false,
  };
  const migrationsByFunction = new Map([
    ["consume_bid_autopsy_rate_limit", intakeLimiterMigration],
    ["get_bid_autopsy_contact_handoff", intakeOperationsMigration],
    ["list_bid_autopsy_work_queue", intakeOperationsMigration],
    ["purge_expired_bid_autopsy_rate_limits", intakeRetentionMigration],
    ["purge_expired_bid_autopsy_requests", intakeRetentionMigration],
    ["store_bid_autopsy_request", intakeRetentionMigration],
    ["transition_bid_autopsy_work_queue", intakeOperationsMigration],
  ]);

  return [...INTAKE_FUNCTION_MANIFEST].map(([functionName, expected]) => {
    const functionMigration = migrationsByFunction.get(functionName);
    assert.ok(functionMigration, `missing migration for ${functionName}`);
    return {
      ...common,
      function_name: functionName,
      argument_count: expected.argumentCount,
      argument_types: expected.argumentTypes,
      identity_arguments: expected.identityArguments,
      return_type: expected.returnType,
      function_result: expected.functionResult,
      returns_set: expected.returnsSet,
      runtime_can_execute: expected.runtimeCanExecute,
      function_source: intakeFunctionSource(functionMigration, functionName),
    };
  });
}

function migrationTenantEdges() {
  const start = migration.indexOf(
    "CREATE OR REPLACE FUNCTION valo_security.expected_tenant_parent_edges()",
  );
  const end = migration.indexOf("$function$;", start);
  assert(start >= 0 && end > start);
  const extensionStart = tenderContextMigration.indexOf(
    "CREATE FUNCTION valo_security.expected_tenant_parent_edges()",
  );
  const extensionEnd = tenderContextMigration.indexOf(
    "$function$;",
    extensionStart,
  );
  assert(extensionStart >= 0 && extensionEnd > extensionStart);
  const retentionExtensionStart = retentionCompletionMigration.indexOf(
    "CREATE FUNCTION valo_security.expected_tenant_parent_edges()",
  );
  const retentionExtensionEnd = retentionCompletionMigration.indexOf(
    "$function$;",
    retentionExtensionStart,
  );
  assert(
    retentionExtensionStart >= 0 &&
      retentionExtensionEnd > retentionExtensionStart,
  );
  return [
    ...migration
      .slice(start, end)
      .matchAll(/\('([^']+)','([^']+)','([^']+)','([^']+)',(true|false)\)/g),
    ...tenderContextMigration
      .slice(extensionStart, extensionEnd)
      .matchAll(/\('([^']+)','([^']+)','([^']+)','([^']+)',(true|false)\)/g),
    ...retentionCompletionMigration
      .slice(retentionExtensionStart, retentionExtensionEnd)
      .matchAll(/\('([^']+)','([^']+)','([^']+)','([^']+)',(true|false)\)/g),
  ].map((match) => ({
    child_table: match[1]!,
    child_column: match[2]!,
    parent_table: match[3]!,
    parent_column: match[4]!,
    allow_global_parent: match[5] === "true",
    guarded: true,
    guard_enabled: true,
    trigger_type: 23,
    update_columns: `organisation_id,${match[2]!}`,
    trigger_args_hex: Buffer.from(
      `${match[3]!}\0${match[4]!}\0${match[2]!}\0${match[5] === "true" ? "true" : "false"}\0`,
      "utf8",
    ).toString("hex"),
    when_clause: null,
  }));
}

function migrationTenantGuardFunctions() {
  const contracts = [
    ["current_organisation_id", "sql", "s", "s", false, 0, "", "uuid"],
    [
      "enforce_control_plane_tenant_context",
      "plpgsql",
      "v",
      "u",
      true,
      0,
      "",
      "trigger",
    ],
    [
      "enforce_derived_tenant_relationship",
      "plpgsql",
      "v",
      "u",
      true,
      0,
      "",
      "trigger",
    ],
    [
      "enforce_governed_state_transition",
      "plpgsql",
      "v",
      "u",
      true,
      0,
      "",
      "trigger",
    ],
    [
      "enforce_retention_completion_transition",
      "plpgsql",
      "v",
      "u",
      true,
      0,
      "",
      "trigger",
    ],
    [
      "purge_retention_project",
      "plpgsql",
      "v",
      "u",
      false,
      6,
      "uuid,uuid,uuid,uuid,text,integer",
      "record",
    ],
    ["enforce_tenant_parent", "plpgsql", "v", "u", true, 0, "", "trigger"],
    ["expected_tenant_parent_edges", "sql", "i", "u", false, 0, "", "record"],
    [
      "expected_tenant_parent_edges_v10",
      "sql",
      "i",
      "u",
      false,
      0,
      "",
      "record",
    ],
    [
      "expected_tenant_parent_edges_v25",
      "sql",
      "i",
      "u",
      false,
      0,
      "",
      "record",
    ],
    [
      "reject_versioned_record_content_mutation",
      "plpgsql",
      "v",
      "u",
      true,
      0,
      "",
      "trigger",
    ],
    [
      "reject_tenant_identity_reassignment",
      "plpgsql",
      "v",
      "u",
      true,
      0,
      "",
      "trigger",
    ],
    [
      "reject_active_audit_mutation",
      "plpgsql",
      "v",
      "u",
      true,
      0,
      "",
      "trigger",
    ],
    [
      "reject_legacy_audit_mutation",
      "plpgsql",
      "v",
      "u",
      true,
      0,
      "",
      "trigger",
    ],
    [
      "set_current_organisation_id",
      "plpgsql",
      "v",
      "u",
      false,
      1,
      "uuid",
      "void",
    ],
  ] as const;
  return contracts.map(
    ([
      function_name,
      language_name,
      volatility,
      parallel_safety,
      returns_trigger,
      argument_count,
      argument_types,
      return_type,
    ]) => {
      const sourceMigration = function_name.endsWith("organisation_id")
        ? tenantRlsMigration
        : function_name === "expected_tenant_parent_edges" ||
            function_name === "enforce_retention_completion_transition" ||
            function_name === "purge_retention_project"
          ? retentionCompletionMigration
          : function_name === "expected_tenant_parent_edges_v10" ||
              function_name === "enforce_governed_state_transition" ||
              function_name === "reject_versioned_record_content_mutation"
            ? tenderContextMigration
            : migration;
      const sourceFunctionName =
        function_name === "expected_tenant_parent_edges_v25"
          ? "expected_tenant_parent_edges"
          : function_name === "expected_tenant_parent_edges_v10"
            ? "expected_tenant_parent_edges"
            : function_name;
      const start = sourceMigration.indexOf(
        `CREATE OR REPLACE FUNCTION valo_security.${sourceFunctionName}()`,
      );
      const signatureStart =
        start >= 0
          ? start
          : Math.max(
              sourceMigration.indexOf(
                `CREATE OR REPLACE FUNCTION valo_security.${sourceFunctionName}(`,
              ),
              sourceMigration.indexOf(
                `CREATE FUNCTION valo_security.${sourceFunctionName}(`,
              ),
            );
      const sourceStart = sourceMigration.indexOf(
        "AS $function$",
        signatureStart,
      );
      const sourceEnd = sourceMigration.indexOf("$function$;", sourceStart);
      assert(
        signatureStart >= 0 &&
          sourceStart > signatureStart &&
          sourceEnd > sourceStart,
      );
      return {
        function_name,
        language_name,
        function_kind: "f",
        security_definer: function_name === "purge_retention_project",
        leakproof: false,
        strict: false,
        volatility,
        parallel_safety,
        function_config: "search_path=pg_catalog",
        returns_trigger,
        argument_count,
        argument_types,
        identity_arguments:
          function_name === "set_current_organisation_id"
            ? "p_organisation_id uuid"
            : function_name === "purge_retention_project"
              ? "p_organisation_id uuid, p_retention_request_id uuid, p_retention_action_id uuid, p_subject_project_id uuid, p_source_manifest_sha256 text, p_expected_action_version integer"
              : "",
        return_type,
        function_result: function_name.startsWith(
          "expected_tenant_parent_edges",
        )
          ? "TABLE(child_table text, child_column text, parent_table text, parent_column text, allow_global_parent boolean)"
          : function_name === "purge_retention_project"
            ? "TABLE(deleted_project_rows integer, deleted_document_version_snapshot_rows integer, detached_legal_hold_rows integer, detached_order_rows integer, detached_entitlement_usage_rows integer, purge_receipt_sha256 text, post_purge_action_version integer)"
            : return_type,
        returns_set:
          function_name.startsWith("expected_tenant_parent_edges") ||
          function_name === "purge_retention_project",
        owner_name: "synthetic_migration_owner",
        owner_is_schema_owner: true,
        public_can_execute: false,
        runtime_can_execute: [
          "current_organisation_id",
          "set_current_organisation_id",
        ].includes(function_name),
        function_source: sourceMigration.slice(
          sourceStart + "AS $function$".length,
          sourceEnd,
        ),
      };
    },
  );
}

describe("production database selection", () => {
  test("uses DATABASE_URL only outside production", () => {
    assert.equal(
      selectDatabaseConnectionString({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://owner:secret@example.test/bidbox",
      }),
      "postgresql://owner:secret@example.test/bidbox",
    );
  });

  test("requires the dedicated runtime URL in production", () => {
    assert.throws(
      () =>
        selectDatabaseConnectionString({
          NODE_ENV: "production",
          DATABASE_URL: "postgresql://owner:secret@example.test/bidbox",
        }),
      /VALO_RUNTIME_DATABASE_URL is required/,
    );
  });

  test("rejects a Replit deployment without NODE_ENV=production", () => {
    assert.throws(
      () =>
        selectDatabaseConnectionString({
          REPLIT_DEPLOYMENT: "1",
          DATABASE_URL: "postgresql://owner:secret@example.test/bidbox",
          VALO_RUNTIME_DATABASE_URL:
            "postgresql://valo_app_runtime:runtime@example.test/bidbox",
        }),
      /require NODE_ENV=production/,
    );
  });

  test("recognises a correctly configured Replit deployment", () => {
    const environment = {
      NODE_ENV: "production",
      REPLIT_DEPLOYMENT: "1",
      DATABASE_URL: "postgresql://owner:secret@example.test/bidbox",
      VALO_RUNTIME_DATABASE_URL:
        "postgresql://valo_app_runtime:runtime@example.test/bidbox",
    };
    assert.equal(isProductionRuntime(environment), true);
    assert.equal(
      selectDatabaseConnectionString(environment),
      environment.VALO_RUNTIME_DATABASE_URL,
    );
  });

  test("rejects a malformed production URL without echoing it", () => {
    assert.throws(
      () =>
        selectDatabaseConnectionString({
          NODE_ENV: "production",
          DATABASE_URL: "not a postgres URL with secret-owner-value",
          VALO_RUNTIME_DATABASE_URL:
            "postgresql://valo_app_runtime:runtime@example.test/bidbox",
        }),
      (error: unknown) =>
        error instanceof Error &&
        error.message === "production database URL is malformed" &&
        !error.message.includes("secret-owner-value"),
    );
  });

  test("rejects a runtime URL for a different database target", () => {
    assert.throws(
      () =>
        selectDatabaseConnectionString({
          NODE_ENV: "production",
          DATABASE_URL: "postgresql://owner:secret@example.test/bidbox",
          VALO_RUNTIME_DATABASE_URL:
            "postgresql://valo_app_runtime:runtime@example.test/other",
        }),
      /must preserve the managed target and TLS parameters/,
    );
  });

  test("requires runtime TLS parameters to match the managed URL", () => {
    assert.throws(
      () =>
        selectDatabaseConnectionString({
          NODE_ENV: "production",
          DATABASE_URL:
            "postgresql://owner:secret@example.test/bidbox?sslmode=require&channel_binding=require",
          VALO_RUNTIME_DATABASE_URL:
            "postgresql://valo_app_runtime:runtime@example.test/bidbox?sslmode=disable&channel_binding=require",
        }),
      /must preserve the managed target and TLS parameters/,
    );
  });

  test("rejects credentials in query parameters", () => {
    assert.throws(
      () =>
        selectDatabaseConnectionString({
          NODE_ENV: "production",
          DATABASE_URL:
            "postgresql://owner:secret@example.test/bidbox?sslmode=require&user=owner",
          VALO_RUNTIME_DATABASE_URL:
            "postgresql://valo_app_runtime:runtime@example.test/bidbox?sslmode=require&user=owner",
        }),
      /credentials must be carried only in URL userinfo/,
    );
  });
});

describe("production tenant graph attestation", () => {
  test("accepts only the pinned 118-edge and special-trigger contract", () => {
    assert.doesNotThrow(() =>
      assertTenantGraphAttestation({
        directEdges: migrationTenantEdges(),
        specialTriggers: SPECIAL_TENANT_TRIGGERS,
        functionProofs: migrationTenantGuardFunctions(),
        compositeTenantEdges: 0,
        immutableArchiveExceptions: 1,
        tenantParentTriggerCount: 118,
      }),
    );
  });

  test("fails closed when a direct or special guard is absent", () => {
    const directEdges = migrationTenantEdges();
    directEdges[0]!.guarded = false;
    assert.throws(
      () =>
        assertTenantGraphAttestation({
          directEdges,
          specialTriggers: SPECIAL_TENANT_TRIGGERS.slice(1),
          functionProofs: migrationTenantGuardFunctions(),
          compositeTenantEdges: 0,
          immutableArchiveExceptions: 1,
          tenantParentTriggerCount: 118,
        }),
      /tenant-parent graph|derived tenant guards/,
    );
  });

  test("fails closed when a trigger is made inert with a WHEN clause", () => {
    const directEdges = migrationTenantEdges().map((edge, index) => ({
      ...edge,
      when_clause: index === 0 ? "false" : null,
    }));
    assert.throws(
      () =>
        assertTenantGraphAttestation({
          directEdges,
          specialTriggers: SPECIAL_TENANT_TRIGGERS,
          functionProofs: migrationTenantGuardFunctions(),
          compositeTenantEdges: 0,
          immutableArchiveExceptions: 1,
          tenantParentTriggerCount: 118,
        }),
      /tenant-parent graph/,
    );

    const specialTriggers = SPECIAL_TENANT_TRIGGERS.map((trigger, index) => ({
      ...trigger,
      when_clause: index === 0 ? "false" : null,
    }));
    assert.throws(
      () =>
        assertTenantGraphAttestation({
          directEdges: migrationTenantEdges(),
          specialTriggers,
          functionProofs: migrationTenantGuardFunctions(),
          compositeTenantEdges: 0,
          immutableArchiveExceptions: 1,
          tenantParentTriggerCount: 118,
        }),
      /derived tenant guards/,
    );
  });

  test("fails closed when a guard function becomes a RETURN NEW stub", () => {
    const functionProofs = migrationTenantGuardFunctions();
    functionProofs.find(
      (proof) => proof.function_name === "enforce_tenant_parent",
    )!.function_source = "BEGIN\n  RETURN NEW;\nEND;";
    assert.throws(
      () =>
        assertTenantGraphAttestation({
          directEdges: migrationTenantEdges(),
          specialTriggers: SPECIAL_TENANT_TRIGGERS,
          functionProofs,
          compositeTenantEdges: 0,
          immutableArchiveExceptions: 1,
          tenantParentTriggerCount: 118,
        }),
      /guard functions are semantically drifted/,
    );
  });

  test("fails closed when a tenant-context helper drifts", () => {
    const functionProofs = migrationTenantGuardFunctions();
    functionProofs.find(
      (proof) => proof.function_name === "current_organisation_id",
    )!.function_source = "SELECT NULL::uuid";
    assert.throws(
      () =>
        assertTenantGraphAttestation({
          directEdges: migrationTenantEdges(),
          specialTriggers: SPECIAL_TENANT_TRIGGERS,
          functionProofs,
          compositeTenantEdges: 0,
          immutableArchiveExceptions: 1,
          tenantParentTriggerCount: 118,
        }),
      /guard functions are semantically drifted/,
    );

    const strictSetterProofs = migrationTenantGuardFunctions();
    strictSetterProofs.find(
      (proof) => proof.function_name === "set_current_organisation_id",
    )!.strict = true;
    assert.throws(
      () =>
        assertTenantGraphAttestation({
          directEdges: migrationTenantEdges(),
          specialTriggers: SPECIAL_TENANT_TRIGGERS,
          functionProofs: strictSetterProofs,
          compositeTenantEdges: 0,
          immutableArchiveExceptions: 1,
          tenantParentTriggerCount: 118,
        }),
      /guard functions are semantically drifted/,
    );
  });
});

const DELIVERY_SOURCE_GUARD_TABLES = [
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

function deliveryGuardTriggerProofs() {
  return [
    ...DELIVERY_SOURCE_GUARD_TABLES.map((tableName) => ({
      relation_schema: "public",
      table_name: tableName,
      trigger_name: "delivery_source_project_guard",
      trigger_enabled: "O",
      trigger_type: 31,
      update_columns: "",
      trigger_args_hex: "",
      when_clause: null,
      is_internal: false,
      function_schema: "public",
      function_name: "valo_guard_delivery_source_mutation",
      function_identity_arguments: "",
      function_oid_matches: true,
    })),
    {
      relation_schema: "public",
      table_name: "projects",
      trigger_name: "delivery_project_delete_guard",
      trigger_enabled: "O",
      trigger_type: 11,
      update_columns: "",
      trigger_args_hex: "",
      when_clause: null,
      is_internal: false,
      function_schema: "public",
      function_name: "valo_guard_delivery_project_delete",
      function_identity_arguments: "",
      function_oid_matches: true,
    },
  ];
}

describe("production delivery guard trigger attestation", () => {
  test("compares trigger and expected function OIDs inside PostgreSQL", () => {
    const source = readFileSync(
      new URL("./runtimeSecurity.ts", import.meta.url),
      "utf8",
    );
    assert.match(
      source,
      /guard\.tgfoid=\(CASE[\s\S]*END\) AS function_oid_matches/u,
    );
  });

  test("accepts exactly the 14 source guards and project delete guard", () => {
    assert.doesNotThrow(() =>
      assertDeliveryGuardTriggerAttestation(deliveryGuardTriggerProofs()),
    );
  });

  test("rejects a missing, extra, or misplaced delivery guard", () => {
    const proofs = deliveryGuardTriggerProofs();
    assert.throws(
      () => assertDeliveryGuardTriggerAttestation(proofs.slice(1)),
      /delivery guard triggers are incomplete or drifted/,
    );
    assert.throws(
      () =>
        assertDeliveryGuardTriggerAttestation([
          ...proofs,
          { ...proofs[0]!, table_name: "unexpected_source" },
        ]),
      /delivery guard triggers are incomplete or drifted/,
    );
    assert.throws(
      () =>
        assertDeliveryGuardTriggerAttestation(
          proofs.map((proof, index) =>
            index === 0 ? { ...proof, table_name: "drafts" } : proof,
          ),
        ),
      /delivery guard triggers are incomplete or drifted/,
    );
  });

  test("rejects a disabled or rebound delivery guard", () => {
    for (const override of [
      { trigger_enabled: "D" },
      { function_oid_matches: false },
      { function_name: "valo_guard_delivery_project_delete" },
    ]) {
      assert.throws(
        () =>
          assertDeliveryGuardTriggerAttestation(
            deliveryGuardTriggerProofs().map((proof, index) =>
              index === 0 ? { ...proof, ...override } : proof,
            ),
          ),
        /delivery guard triggers are incomplete or drifted/,
      );
    }
  });

  test("rejects event, argument, column, or predicate drift", () => {
    for (const override of [
      { trigger_type: 23 },
      { trigger_args_hex: "74616d7065726564" },
      { update_columns: "status" },
      { when_clause: "(status IS NOT NULL)" },
      { is_internal: true },
    ]) {
      assert.throws(
        () =>
          assertDeliveryGuardTriggerAttestation(
            deliveryGuardTriggerProofs().map((proof, index) =>
              index === 0 ? { ...proof, ...override } : proof,
            ),
          ),
        /delivery guard triggers are incomplete or drifted/,
      );
    }
  });
});

function deliveryGuardFunctionProofs() {
  return [
    ["valo_assert_delivery_project_mutable", "v", false, true],
    ["valo_delivery_source_project_id", "s", false, true],
    ["valo_guard_delivery_project_delete", "v", true, false],
    ["valo_guard_delivery_source_mutation", "v", true, false],
  ].map(([functionName, volatility, returnsTrigger, runtimeCanExecute]) => {
    const definitionStart = deliverySourceReleaseBoundaryMigration.indexOf(
      `CREATE OR REPLACE FUNCTION public.${functionName as string}`,
    );
    const sourceStart = deliverySourceReleaseBoundaryMigration.indexOf(
      "AS $$",
      definitionStart,
    );
    const sourceEnd = deliverySourceReleaseBoundaryMigration.indexOf(
      "$$;",
      sourceStart,
    );
    assert.ok(
      definitionStart >= 0 &&
        sourceStart > definitionStart &&
        sourceEnd > sourceStart,
      `0012 must define public.${functionName as string}`,
    );
    const isHelper = runtimeCanExecute === true;
    return {
      function_name: functionName as string,
      language_name: "plpgsql",
      function_kind: "f",
      security_definer: false,
      leakproof: false,
      strict: false,
      volatility: volatility as string,
      parallel_safety: "u",
      function_config: "search_path=pg_catalog, public",
      returns_trigger: returnsTrigger as boolean,
      argument_count: isHelper ? 2 : 0,
      argument_types: isHelper
        ? functionName === "valo_delivery_source_project_id"
          ? "name,jsonb"
          : "uuid,boolean"
        : "",
      identity_arguments: isHelper
        ? functionName === "valo_delivery_source_project_id"
          ? "source_table name, source_row jsonb"
          : "source_project_id uuid, allow_terminal_delete boolean"
        : "",
      function_arguments: isHelper
        ? functionName === "valo_delivery_source_project_id"
          ? "source_table name, source_row jsonb"
          : "source_project_id uuid, allow_terminal_delete boolean DEFAULT false"
        : "",
      argument_default_count:
        functionName === "valo_assert_delivery_project_mutable" ? 1 : 0,
      return_type: returnsTrigger
        ? "trigger"
        : functionName === "valo_delivery_source_project_id"
          ? "uuid"
          : "void",
      function_result: returnsTrigger
        ? "trigger"
        : functionName === "valo_delivery_source_project_id"
          ? "uuid"
          : "void",
      returns_set: false,
      owner_name: "synthetic_migration_owner",
      owner_is_database_owner: true,
      owner_is_security_owner: true,
      runtime_can_execute: runtimeCanExecute as boolean,
      public_can_execute: false,
      execute_acl: [
        "$OWNER>$OWNER:EXECUTE:f",
        ...(runtimeCanExecute
          ? ["$OWNER>$ROLE:valo_app_runtime:EXECUTE:f"]
          : []),
      ],
      function_source: deliverySourceReleaseBoundaryMigration.slice(
        sourceStart + "AS $$".length,
        sourceEnd,
      ),
    };
  });
}

describe("production delivery guard function attestation", () => {
  test("accepts the exact 0012 functions under the 0013 privilege posture", () => {
    assert.doesNotThrow(() =>
      assertDeliveryGuardFunctionAttestation(deliveryGuardFunctionProofs()),
    );
  });

  test("matches PostgreSQL's f/t ACL boolean representation", () => {
    assert.match(
      runtimeSecuritySource,
      /SELECT pg_catalog\.format\(\s*'%s>%s:%s:%s',[\s\S]*?function_acl\.is_grantable\s*\)[\s\S]*?\) AS execute_acl/u,
      "the catalog proof must format PostgreSQL is_grantable directly",
    );
    assert.match(
      runtimeSecuritySource,
      /"\$OWNER>\$OWNER:EXECUTE:f"/u,
      "the canonical ACL must use PostgreSQL's text form for false",
    );
    assert.doesNotMatch(
      runtimeSecuritySource,
      /"\$OWNER>\$OWNER:EXECUTE:false"/u,
    );

    const proofs = deliveryGuardFunctionProofs();
    assert.ok(
      proofs
        .flatMap((proof) => proof.execute_acl)
        .every((grant) => grant.endsWith(":f")),
    );
    assert.doesNotThrow(() => assertDeliveryGuardFunctionAttestation(proofs));
    assert.throws(
      () =>
        assertDeliveryGuardFunctionAttestation(
          proofs.map((proof) => ({
            ...proof,
            execute_acl: proof.execute_acl.map((grant) =>
              grant.replace(/:f$/u, ":false"),
            ),
          })),
        ),
      /delivery guard functions are semantically drifted/,
    );
  });

  test("rejects a missing, extra, or drifted function", () => {
    const proofs = deliveryGuardFunctionProofs();
    assert.throws(
      () => assertDeliveryGuardFunctionAttestation(proofs.slice(1)),
      /delivery guard functions are semantically drifted/,
    );
    assert.throws(
      () =>
        assertDeliveryGuardFunctionAttestation([
          ...proofs,
          { ...proofs[0], function_name: "bidbox_extra_guard" },
        ]),
      /delivery guard functions are semantically drifted/,
    );
    assert.throws(
      () =>
        assertDeliveryGuardFunctionAttestation(
          proofs.map((proof) => ({
            ...proof,
            function_source: `${proof.function_source}\n-- drifted`,
          })),
        ),
      /delivery guard functions are semantically drifted/,
    );
  });

  test("rejects missing or changed helper default semantics", () => {
    for (const override of [
      { argument_default_count: 0 },
      {
        function_arguments:
          "source_project_id uuid, allow_terminal_delete boolean",
      },
      {
        function_arguments:
          "source_project_id uuid, allow_terminal_delete boolean DEFAULT true",
      },
    ]) {
      assert.throws(
        () =>
          assertDeliveryGuardFunctionAttestation(
            deliveryGuardFunctionProofs().map((proof, index) =>
              index === 0 ? { ...proof, ...override } : proof,
            ),
          ),
        /delivery guard functions are semantically drifted/,
      );
    }
  });

  test("rejects a PUBLIC-executable or SECURITY DEFINER guard", () => {
    for (const override of [
      { public_can_execute: true },
      { security_definer: true },
      { function_config: "search_path=pg_catalog" },
      { owner_name: "valo_app_runtime" },
      { owner_is_database_owner: false },
      { owner_is_security_owner: false },
    ]) {
      assert.throws(
        () =>
          assertDeliveryGuardFunctionAttestation(
            deliveryGuardFunctionProofs().map((proof) => ({
              ...proof,
              ...override,
            })),
          ),
        /delivery guard functions are semantically drifted/,
      );
    }
  });

  test("rejects trigger entry points the runtime can execute", () => {
    assert.throws(
      () =>
        assertDeliveryGuardFunctionAttestation(
          deliveryGuardFunctionProofs().map((proof) => ({
            ...proof,
            runtime_can_execute: true,
          })),
        ),
      /delivery guard functions are semantically drifted/,
    );
  });

  test("rejects arbitrary grantees, grant options, or a non-canonical runtime grant", () => {
    const arbitraryGrantProofs = deliveryGuardFunctionProofs();
    arbitraryGrantProofs[0]!.execute_acl.push(
      "$OWNER>$ROLE:untrusted_role:EXECUTE:f",
    );
    assert.throws(
      () => assertDeliveryGuardFunctionAttestation(arbitraryGrantProofs),
      /delivery guard functions are semantically drifted/,
    );

    const grantOptionProofs = deliveryGuardFunctionProofs();
    grantOptionProofs[0]!.execute_acl = [
      "$OWNER>$OWNER:EXECUTE:f",
      "$OWNER>$ROLE:valo_app_runtime:EXECUTE:t",
    ];
    assert.throws(
      () => assertDeliveryGuardFunctionAttestation(grantOptionProofs),
      /delivery guard functions are semantically drifted/,
    );

    const inheritedRuntimeGrantProofs = deliveryGuardFunctionProofs();
    inheritedRuntimeGrantProofs[0]!.execute_acl = ["$OWNER>$OWNER:EXECUTE:f"];
    assert.throws(
      () => assertDeliveryGuardFunctionAttestation(inheritedRuntimeGrantProofs),
      /delivery guard functions are semantically drifted/,
    );

    const triggerEntryGrantProofs = deliveryGuardFunctionProofs();
    triggerEntryGrantProofs[2]!.execute_acl.push(
      "$OWNER>$ROLE:valo_app_runtime:EXECUTE:f",
    );
    assert.throws(
      () => assertDeliveryGuardFunctionAttestation(triggerEntryGrantProofs),
      /delivery guard functions are semantically drifted/,
    );
  });
});

describe("production RLS policy attestation", () => {
  test("fails closed outside the pinned PG16 104-policy catalog", () => {
    assert.throws(
      () => assertRuntimePolicyAttestation([], 160_004),
      /RLS policy is drifted|RLS policy catalog is drifted/,
    );
    assert.throws(
      () => assertRuntimePolicyAttestation([], 170_001),
      /RLS policy is drifted|RLS policy catalog is drifted/,
    );
  });
});

describe("production public-intake least privilege attestation", () => {
  test("uses PostgreSQL bound expressions without invalid catalog qualification", () => {
    assert.doesNotMatch(
      intakeLimiterMigration,
      /pg_catalog\.(?:least|greatest)\s*\(/i,
    );
    assert.match(intakeLimiterMigration, /\bLEAST\s*\(/);
    assert.match(intakeLimiterMigration, /\bGREATEST\s*\(/);
  });

  test("pins the complete privileged intake routine catalog", () => {
    const proofs = migrationIntakeFunctions();
    assert.doesNotThrow(() => assertIntakeFunctionAttestation(proofs));

    for (const mutate of [
      (candidate: (typeof proofs)[number]) => {
        candidate.public_can_execute = true;
      },
      (candidate: (typeof proofs)[number]) => {
        candidate.function_source += "\n-- drift";
      },
      (candidate: (typeof proofs)[number]) => {
        candidate.argument_types += ",text";
      },
    ]) {
      const drifted = structuredClone(proofs);
      mutate(drifted[0]!);
      assert.throws(
        () => assertIntakeFunctionAttestation(drifted),
        /intake function catalog is drifted/,
      );
    }

    assert.throws(
      () => assertIntakeFunctionAttestation(proofs.slice(1)),
      /intake function catalog is drifted/,
    );
  });

  test("keeps the runtime manifest aligned with the owner migration gate", async () => {
    const migrationGateUrl = new URL(
      "../scripts/replit-intake-migrations.mjs",
      import.meta.url,
    ).href;
    const migrationGate = (await import(migrationGateUrl)) as {
      EXPECTED_REPLIT_INTAKE_SECURITY: {
        functions: readonly (readonly unknown[])[];
        functionGrants: readonly (readonly unknown[])[];
      };
    };
    const ownerFunctions = new Map(
      migrationGate.EXPECTED_REPLIT_INTAKE_SECURITY.functions.map((entry) => [
        String(entry[0]),
        entry,
      ]),
    );
    const runtimeExecutableFunctions = new Set(
      migrationGate.EXPECTED_REPLIT_INTAKE_SECURITY.functionGrants
        .filter(
          (grant) =>
            grant[2] === "$OWNER" &&
            grant[3] === "$ROLE:valo_app_runtime" &&
            grant[4] === "EXECUTE",
        )
        .map((grant) => String(grant[0])),
    );

    assert.equal(ownerFunctions.size, INTAKE_FUNCTION_MANIFEST.size);
    for (const [functionName, expected] of INTAKE_FUNCTION_MANIFEST) {
      const owner = ownerFunctions.get(functionName);
      assert.ok(owner, `missing owner gate entry for ${functionName}`);
      const ownerArgumentTypes = String(owner[1]).replaceAll(" ", "");
      assert.equal(ownerArgumentTypes, expected.argumentTypes);
      assert.equal(
        ownerArgumentTypes === "" ? 0 : ownerArgumentTypes.split(",").length,
        expected.argumentCount,
      );
      assert.equal(owner[2], expected.identityArguments);
      assert.equal(owner[3], expected.functionResult);
      assert.equal(owner[14], expected.returnsSet);
      assert.equal(owner[19], expected.sourceSha256);
      assert.equal(
        runtimeExecutableFunctions.has(functionName),
        expected.runtimeCanExecute,
      );
    }
  });

  test("pins PostgreSQL's one-column RETURNS TABLE catalog semantics", () => {
    const proofs = migrationIntakeFunctions();
    const transition = proofs.find(
      (proof) => proof.function_name === "transition_bid_autopsy_work_queue",
    );
    assert.ok(transition);

    // PostgreSQL exposes the lone OUT column type through prorettype while
    // retaining the declared TABLE shape through pg_get_function_result().
    assert.equal(transition.return_type, "uuid");
    assert.equal(transition.function_result, "TABLE(request_id uuid)");
    assert.equal(transition.returns_set, true);
    assert.doesNotThrow(() => assertIntakeFunctionAttestation(proofs));

    const drifted = structuredClone(proofs);
    const driftedTransition = drifted.find(
      (proof) => proof.function_name === "transition_bid_autopsy_work_queue",
    );
    assert.ok(driftedTransition);
    driftedTransition.return_type = "record";
    assert.throws(
      () => assertIntakeFunctionAttestation(drifted),
      /intake function catalog is drifted/,
    );
  });

  test("checks every PostgreSQL table privilege class on both intake tables", () => {
    for (const table of ["bid_autopsy_requests", "bid_autopsy_rate_limits"]) {
      for (const privilege of [
        "SELECT",
        "INSERT",
        "UPDATE",
        "DELETE",
        "TRUNCATE",
        "REFERENCES",
        "TRIGGER",
      ]) {
        assert.match(
          runtimeSecuritySource,
          new RegExp(`current_user,'valo_intake\\.${table}','${privilege}'`),
        );
      }
    }
  });

  test("denies runtime execution of both owner-side intake purge functions", () => {
    assert.match(
      runtimeSecuritySource,
      /proof\.can_execute_purge_bid_autopsy_requests\s*\|\|/,
    );
    assert.match(
      runtimeSecuritySource,
      /proof\.can_execute_purge_bid_autopsy_rate_limits\s*\|\|/,
    );
  });

  test("checks column-level grants across both intake tables", () => {
    for (const [table, proof] of [
      ["bid_autopsy_requests", "bid_autopsy_request"],
      ["bid_autopsy_rate_limits", "bid_autopsy_rate_limit"],
    ] as const) {
      assert.match(
        runtimeSecuritySource,
        new RegExp(
          `'valo_intake\\.${table}'::pg_catalog\\.regclass[\\s\\S]*?AS can_access_${proof}_columns`,
        ),
      );
    }
    for (const privilege of ["SELECT", "INSERT", "UPDATE", "REFERENCES"]) {
      assert.match(
        runtimeSecuritySource,
        new RegExp(
          `has_column_privilege\\([\\s\\S]*?intake_column\\.attnum,'${privilege}'`,
        ),
      );
    }
    assert.match(
      runtimeSecuritySource,
      /proof\.can_access_bid_autopsy_request_columns\s*\|\|/,
    );
    assert.match(
      runtimeSecuritySource,
      /proof\.can_access_bid_autopsy_rate_limit_columns\s*\|\|/,
    );
  });
});

describe("production authenticated rate limiter attestation", () => {
  test("handles columns without explicit ACL arrays", () => {
    assert.match(
      runtimeSecuritySource,
      /pg_catalog\.aclexplode\(\s*actor_limit_column\.attacl\s*\)/u,
    );
    assert.doesNotMatch(
      runtimeSecuritySource,
      /COALESCE\(\s*actor_limit_column\.attacl\s*,\s*'\{\}'::pg_catalog\.aclitem\[\]/u,
    );
  });

  test("pins both the global consume and owner purge routines", () => {
    const proofs = productionAssuranceFunctionProofs();
    assert.deepEqual(
      proofs.map((proof) => [proof.function_name, proof.returns_set]),
      [
        ["consume_authenticated_actor_rate_limit", true],
        ["purge_expired_authenticated_rate_limit_buckets", false],
      ],
    );
    assert.doesNotThrow(() =>
      assertAuthenticatedRateLimitFunctionAttestation(proofs),
    );
    for (const mutate of [
      (proof: (typeof proofs)[number]) => {
        proof.function_source += "\n-- drift";
      },
      (proof: (typeof proofs)[number]) => {
        proof.runtime_can_execute = !proof.runtime_can_execute;
      },
      (proof: (typeof proofs)[number]) => {
        proof.security_definer = !proof.security_definer;
      },
      (proof: (typeof proofs)[number]) => {
        proof.owner_is_schema_owner = false;
      },
    ]) {
      const drifted = structuredClone(proofs);
      mutate(drifted[0]!);
      assert.throws(
        () => assertAuthenticatedRateLimitFunctionAttestation(drifted),
        /authenticated rate-limit function catalog is drifted/u,
      );
    }
    for (const proofIndex of proofs.keys()) {
      const drifted = structuredClone(proofs);
      drifted[proofIndex]!.returns_set = !drifted[proofIndex]!.returns_set;
      assert.throws(
        () => assertAuthenticatedRateLimitFunctionAttestation(drifted),
        /authenticated rate-limit function catalog is drifted/u,
      );
    }
    assert.throws(
      () => assertAuthenticatedRateLimitFunctionAttestation(proofs.slice(1)),
      /authenticated rate-limit function catalog is drifted/u,
    );
  });

  test("uses unqualified SQL conditional expressions", () => {
    assert.doesNotMatch(
      productionAssuranceMigration,
      /pg_catalog\.(?:least|greatest|coalesce)\s*\(/iu,
    );
    assert.match(productionAssuranceMigration, /\bleast\s*\(/iu);
    assert.match(productionAssuranceMigration, /\bgreatest\s*\(/iu);
  });
});
