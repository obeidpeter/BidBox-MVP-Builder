import {
  pgTable,
  pgSchema,
  text,
  integer,
  bigint as pgBigint,
  bigserial,
  boolean,
  doublePrecision,
  date,
  timestamp,
  uuid,
  foreignKey,
  check,
  index,
  primaryKey,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).defaultNow().notNull();

const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true }).defaultNow().notNull();

const optimisticVersion = () => integer("version").notNull().default(1);

/**
 * Public first-contact records are deliberately kept outside the tenant data
 * schema. They exist before an organisation or authenticated identity does and
 * are reachable only through the bounded public-intake route.
 */
export const bidboxIntake = pgSchema("valo_intake");

export const bidAutopsyRequests = bidboxIntake.table(
  "bid_autopsy_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    idempotencyKeyHash: text("idempotency_key_hash").notNull(),
    payloadFingerprint: text("payload_fingerprint").notNull(),
    contactName: text("contact_name").notNull(),
    companyName: text("company_name").notNull(),
    businessEmail: text("business_email").notNull(),
    businessTelephone: text("business_telephone").notNull(),
    tenderCategory: text("tender_category").notNull(),
    bidStage: text("bid_stage").notNull(),
    tenderDeadline: date("tender_deadline"),
    preferredContactMethod: text("preferred_contact_method").notNull(),
    privacyNoticeVersion: text("privacy_notice_version").notNull(),
    destination: text("destination").notNull().default("database"),
    deliveryStatus: text("delivery_status").notNull().default("stored"),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    retentionUntil: timestamp("retention_until", {
      withTimezone: true,
    }).notNull(),
  },
  (t) => [
    uniqueIndex("bid_autopsy_requests_idempotency_unique").on(
      t.idempotencyKeyHash,
    ),
    index("bid_autopsy_requests_delivery_received_idx").on(
      t.deliveryStatus,
      t.receivedAt,
    ),
  ],
);

/**
 * Shared, privacy-minimised fixed-window abuse control for public intake.
 * `clientKeyHash` is an application-side HMAC; raw client addresses never
 * enter the database. Expired buckets are removed by the bounded consume
 * function and the application runtime receives no direct table privileges.
 */
export const bidAutopsyRateLimits = bidboxIntake.table(
  "bid_autopsy_rate_limits",
  {
    clientKeyHash: text("client_key_hash").primaryKey(),
    requestCount: integer("request_count").notNull(),
    windowStartedAt: timestamp("window_started_at", {
      withTimezone: true,
    }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("bid_autopsy_rate_limits_expires_idx").on(t.expiresAt)],
);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  clerkUserId: text("clerk_user_id").notNull().unique(),
  email: text("email").notNull(),
  name: text("name"),
  role: text("role").notNull().default("none"),
  status: text("status").notNull().default("active"),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  version: optimisticVersion(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * A hard tenant boundary. `type` is one of client | valo | consultancy_partner.
 * The database columns deliberately use organisation (not account/workspace)
 * consistently so access checks do not need ambiguous identifier translation.
 */
export const organisations = pgTable("organisations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  type: text("type").notNull().default("client"),
  status: text("status").notNull().default("active"),
  countryCode: text("country_code").notNull().default("NG"),
  createdBy: uuid("created_by").references(() => users.id, {
    onDelete: "set null",
  }),
  version: optimisticVersion(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** One membership per person and organisation; roles are separate grants. */
export const organisationMemberships = pgTable(
  "organisation_memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("active"),
    accessStartsAt: timestamp("access_starts_at", { withTimezone: true }),
    accessExpiresAt: timestamp("access_expires_at", { withTimezone: true }),
    delegatedByMembershipId: uuid("delegated_by_membership_id"),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      columns: [t.delegatedByMembershipId],
      foreignColumns: [t.id],
      name: "organisation_memberships_delegated_by_fk",
    }).onDelete("set null"),
    uniqueIndex("organisation_memberships_org_user_unique").on(
      t.organisationId,
      t.userId,
    ),
    index("organisation_memberships_user_status_idx").on(t.userId, t.status),
  ],
);

/**
 * Role grants are independently expirable/revocable. This supports temporary
 * reviewer access and segregation of duties without mutating identity rows.
 */
export const roleGrants = pgTable(
  "role_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => organisationMemberships.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    grantedByMembershipId: uuid("granted_by_membership_id").references(
      () => organisationMemberships.id,
      { onDelete: "set null" },
    ),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revocationReason: text("revocation_reason"),
    createdAt: createdAt(),
  },
  (t) => [
    index("role_grants_membership_active_idx").on(t.membershipId, t.revokedAt),
  ],
);

export const partnerRelationships = pgTable(
  "partner_relationships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    partnerOrganisationId: uuid("partner_organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    clientOrganisationId: uuid("client_organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"),
    clientOwnershipRule: text("client_ownership_rule")
      .notNull()
      .default("client_retained"),
    qaResponsibility: text("qa_responsibility"),
    coSigningRequired: boolean("co_signing_required").notNull().default(false),
    accessStartsAt: timestamp("access_starts_at", { withTimezone: true }),
    accessExpiresAt: timestamp("access_expires_at", { withTimezone: true }),
    approvedByMembershipId: uuid("approved_by_membership_id").references(
      () => organisationMemberships.id,
      { onDelete: "set null" },
    ),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("partner_relationships_partner_client_unique").on(
      t.partnerOrganisationId,
      t.clientOrganisationId,
    ),
  ],
);

/** Emergency access is explicit, short-lived, two-person approved and auditable. */
export const breakGlassSessions = pgTable(
  "break_glass_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    targetOrganisationId: uuid("target_organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    requestedByUserId: uuid("requested_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    approvedByUserId: uuid("approved_by_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    reason: text("reason").notNull(),
    incidentReference: text("incident_reference").notNull(),
    requestedPermissions: text("requested_permissions").notNull(),
    status: text("status").notNull().default("pending"),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedByUserId: uuid("revoked_by_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("break_glass_target_status_expiry_idx").on(
      t.targetOrganisationId,
      t.status,
      t.expiresAt,
    ),
  ],
);

/** Global defaults plus tenant overrides; later-stage flags default disabled. */
export const featureFlags = pgTable(
  "feature_flags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id").references(() => organisations.id, {
      onDelete: "cascade",
    }),
    key: text("key").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    configuration: text("configuration"),
    commercialGate: text("commercial_gate"),
    updatedByUserId: uuid("updated_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("feature_flags_tenant_key_unique")
      .on(t.organisationId, t.key)
      .where(sql`${t.organisationId} is not null`),
    uniqueIndex("feature_flags_global_key_unique")
      .on(t.key)
      .where(sql`${t.organisationId} is null`),
  ],
);

export const clients = pgTable(
  "clients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id").references(() => organisations.id, {
      onDelete: "restrict",
    }),
    name: text("name").notNull(),
    sector: text("sector"),
    segment: text("segment"),
    contactName: text("contact_name"),
    contactEmail: text("contact_email"),
    ndaStatus: text("nda_status").notNull().default("pending"),
    notes: text("notes"),
    // Gate 0 founder metric (Build Brief §17): decision-maker conversations are
    // counted against the >=8 threshold, kept distinct from junior bid staff.
    decisionMakerConversations: integer("decision_maker_conversations")
      .notNull()
      .default(0),
    juniorConversations: integer("junior_conversations").notNull().default(0),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("clients_org_created_idx").on(t.organisationId, t.createdAt)],
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id").references(() => organisations.id, {
      onDelete: "restrict",
    }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    tenderTitle: text("tender_title").notNull(),
    issuingEntity: text("issuing_entity"),
    tenderRef: text("tender_ref"),
    lot: text("lot"),
    deadline: text("deadline"),
    valueBand: text("value_band"),
    segment: text("segment"),
    submissionStatus: text("submission_status"),
    status: text("status").notNull().default("intake"),
    // Set exactly once when the project first enters a concluded state. The
    // retention clock must never fall back to creation/update time because
    // neither is evidence of when delivery actually concluded.
    concludedAt: timestamp("concluded_at", { withTimezone: true }),
    reviewerId: uuid("reviewer_id").references(() => users.id, {
      onDelete: "set null",
    }),
    slaClass: text("sla_class").notNull().default("standard"),
    paymentStatus: text("payment_status").notNull().default("not_required"),
    paymentConfirmedByFounder: boolean("payment_confirmed_by_founder")
      .notNull()
      .default(false),
    paymentConfirmedByAdvisor: boolean("payment_confirmed_by_advisor")
      .notNull()
      .default(false),
    paymentConfirmedAt: timestamp("payment_confirmed_at", {
      withTimezone: true,
    }),
    // Dual-confirmation identity stamps (FR-BIL-01): the payment gate requires
    // two *distinct* people, so each leg records who confirmed it, derived
    // server-side from the session — never accepted from the client.
    paymentFounderConfirmedBy: uuid("payment_founder_confirmed_by").references(
      () => users.id,
      { onDelete: "set null" },
    ),
    paymentFounderConfirmedByName: text("payment_founder_confirmed_by_name"),
    paymentFounderConfirmedAt: timestamp("payment_founder_confirmed_at", {
      withTimezone: true,
    }),
    paymentAdvisorConfirmedBy: uuid("payment_advisor_confirmed_by").references(
      () => users.id,
      { onDelete: "set null" },
    ),
    paymentAdvisorConfirmedByName: text("payment_advisor_confirmed_by_name"),
    paymentAdvisorConfirmedAt: timestamp("payment_advisor_confirmed_at", {
      withTimezone: true,
    }),
    conflictStatus: text("conflict_status").notNull().default("clear"),
    conflictDecision: text("conflict_decision"),
    conflictRationale: text("conflict_rationale"),
    physicalArchiveInstruction: text("physical_archive_instruction"),
    redactionScope: text("redaction_scope"),
    restrictedMode: boolean("restricted_mode").notNull().default(false),
    riskScore: doublePrecision("risk_score"),
    riskBand: text("risk_band"),
    riskOverrideBand: text("risk_override_band"),
    riskOverrideNote: text("risk_override_note"),
    riskOverrideBy: text("risk_override_by"),
    outcome: text("outcome").notNull().default("none"),
    // Gate 0 mandate-quality metric (Build Brief §17): distinguishes autopsy-only
    // revenue from a real assisted-bid/retainer mandate so ">=1 quality mandate"
    // is visible. none | autopsy_only | assisted_bid | retainer.
    mandateQuality: text("mandate_quality").notNull().default("none"),
    scope: text("scope"),
    limitations: text("limitations"),
    responsivenessReview: text("responsiveness_review"),
    responsivenessSuggested: boolean("responsiveness_suggested")
      .notNull()
      .default(false),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("projects_org_created_idx").on(t.organisationId, t.createdAt),
    index("projects_org_client_idx").on(t.organisationId, t.clientId),
    index("projects_org_tender_lot_idx").on(
      t.organisationId,
      t.tenderRef,
      t.lot,
    ),
  ],
);

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id").references(() => organisations.id, {
      onDelete: "restrict",
    }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    type: text("type").notNull().default("other"),
    filename: text("filename").notNull(),
    objectPath: text("object_path").notNull(),
    contentType: text("content_type"),
    size: integer("size"),
    // SHA-256 of the stored object, computed server-side at intake (FR-INT-02).
    // Null only for legacy rows or when the object could not be read at intake.
    sha256: text("sha256"),
    source: text("source"),
    dateReceived: text("date_received"),
    redactionStatus: text("redaction_status").notNull().default("excluded"),
    uploadedBy: uuid("uploaded_by").references(() => users.id, {
      onDelete: "set null",
    }),
    contentText: text("content_text"),
    extractedChars: integer("extracted_chars"),
    extractionStatus: text("extraction_status").default("pending"),
    // Extraction telemetry (FR-OCR-01/02): how the text was obtained, a coarse
    // deterministic confidence heuristic, and per-document notes that feed the
    // OCR evaluation set the roadmap requires.
    extractionMethod: text("extraction_method"),
    extractionConfidence: doublePrecision("extraction_confidence"),
    extractionNotes: text("extraction_notes"),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("documents_org_project_idx").on(t.organisationId, t.projectId),
    index("documents_org_object_path_idx").on(t.organisationId, t.objectPath),
  ],
);

export const requirements = pgTable("requirements", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id").references(() => organisations.id, {
    onDelete: "restrict",
  }),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  sourceDocId: uuid("source_doc_id").references(() => documents.id, {
    onDelete: "set null",
  }),
  pageRef: text("page_ref"),
  clauseRef: text("clause_ref"),
  text: text("text").notNull(),
  category: text("category").notNull().default("other"),
  expectedEvidence: text("expected_evidence"),
  isMandatory: boolean("is_mandatory").notNull().default(true),
  confidence: text("confidence"),
  reviewStatus: text("review_status").notNull().default("suggested"),
  reviewerNotes: text("reviewer_notes"),
  // Gate 0 Technical Scorecard fields (FR-EXT-03/04): who surfaced the row
  // ("engine" | "manual"; null = legacy), the frozen engine proposal so edits
  // stay diffable, and the server-derived reviewer stamp on review actions.
  origin: text("origin"),
  engineText: text("engine_text"),
  // Citations folded in from rows merged away by a reviewer (JSON array of
  // {sourceDocId, sourceDocName, pageRef, clauseRef, text}). The survivor keeps
  // its own primary citation in the native columns above; this preserves the
  // originals' page/clause refs so no provenance is lost on merge.
  mergedCitations: text("merged_citations"),
  reviewedBy: uuid("reviewed_by").references(() => users.id, {
    onDelete: "set null",
  }),
  reviewedByName: text("reviewed_by_name"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  version: optimisticVersion(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const evidenceItems = pgTable("evidence_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id").references(() => organisations.id, {
    onDelete: "restrict",
  }),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  requirementId: uuid("requirement_id")
    .notNull()
    .references(() => requirements.id, { onDelete: "cascade" }),
  documentId: uuid("document_id").references(() => documents.id, {
    onDelete: "set null",
  }),
  evidenceStatus: text("evidence_status").notNull().default("pending"),
  excerpt: text("excerpt"),
  notes: text("notes"),
  suggested: boolean("suggested").notNull().default(false),
  confirmedBy: uuid("confirmed_by").references(() => users.id, {
    onDelete: "set null",
  }),
  version: optimisticVersion(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const defects = pgTable("defects", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id").references(() => organisations.id, {
    onDelete: "restrict",
  }),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  requirementId: uuid("requirement_id").references(() => requirements.id, {
    onDelete: "set null",
  }),
  type: text("type").notNull(),
  severity: text("severity").notNull(),
  description: text("description").notNull(),
  evidenceSnapshot: text("evidence_snapshot"),
  remediation: text("remediation"),
  owner: text("owner"),
  status: text("status").notNull().default("open"),
  suggested: boolean("suggested").notNull().default(false),
  version: optimisticVersion(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const boqChecks = pgTable("boq_checks", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id").references(() => organisations.id, {
    onDelete: "restrict",
  }),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  sourceDocId: uuid("source_doc_id").references(() => documents.id, {
    onDelete: "set null",
  }),
  lineRef: text("line_ref"),
  description: text("description"),
  quantity: doublePrecision("quantity"),
  unitRate: doublePrecision("unit_rate"),
  extension: doublePrecision("extension"),
  computedExtension: doublePrecision("computed_extension"),
  quantityRaw: text("quantity_raw"),
  unitRateKobo: pgBigint("unit_rate_kobo", { mode: "number" }),
  extensionKobo: pgBigint("extension_kobo", { mode: "number" }),
  computedExtensionKobo: pgBigint("computed_extension_kobo", {
    mode: "number",
  }),
  checkType: text("check_type").notNull(),
  finding: text("finding").notNull(),
  severity: text("severity").notNull().default("scoring_risk"),
  status: text("status").notNull().default("flagged"),
  version: optimisticVersion(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const vaultItems = pgTable(
  "vault_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id").references(() => organisations.id, {
      onDelete: "restrict",
    }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    artefactType: text("artefact_type").notNull(),
    issuer: text("issuer"),
    issueDate: text("issue_date"),
    expiryDate: text("expiry_date"),
    renewalLeadDays: integer("renewal_lead_days"),
    status: text("status").notNull().default("active"),
    objectPath: text("object_path"),
    sha256: text("sha256"),
    sourceDocumentId: uuid("source_document_id").references(
      () => documents.id,
      {
        onDelete: "set null",
      },
    ),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("vault_items_org_object_path_idx").on(t.organisationId, t.objectPath),
  ],
);

export const capabilityItems = pgTable("capability_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id").references(() => organisations.id, {
    onDelete: "restrict",
  }),
  clientId: uuid("client_id")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" }),
  claimType: text("claim_type").notNull(),
  description: text("description"),
  evidenceDocId: uuid("evidence_doc_id").references(() => documents.id, {
    onDelete: "set null",
  }),
  approvedStatus: text("approved_status").notNull().default("pending"),
  verifierId: uuid("verifier_id").references(() => users.id, {
    onDelete: "set null",
  }),
  verifierName: text("verifier_name"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  version: optimisticVersion(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const conflictRecords = pgTable("conflict_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id").references(() => organisations.id, {
    onDelete: "restrict",
  }),
  clientId: uuid("client_id").references(() => clients.id, {
    onDelete: "set null",
  }),
  projectId: uuid("project_id").references(() => projects.id, {
    onDelete: "cascade",
  }),
  tenderRef: text("tender_ref"),
  lot: text("lot"),
  matchedProjectId: uuid("matched_project_id").references(() => projects.id, {
    onDelete: "set null",
  }),
  status: text("status").notNull().default("blocked"),
  decision: text("decision"),
  rationale: text("rationale"),
  decidedBy: uuid("decided_by").references(() => users.id, {
    onDelete: "set null",
  }),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  version: optimisticVersion(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const notificationEvents = pgTable(
  "notification_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id").references(() => organisations.id, {
      onDelete: "restrict",
    }),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    clientId: uuid("client_id").references(() => clients.id, {
      onDelete: "cascade",
    }),
    vaultItemId: uuid("vault_item_id").references(() => vaultItems.id, {
      onDelete: "cascade",
    }),
    channel: text("channel").notNull().default("manual"),
    template: text("template").notNull(),
    recipient: text("recipient"),
    payload: text("payload"),
    status: text("status").notNull().default("queued"),
    availableAt: timestamp("available_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Internal storage deletion intents use these bounded-cycle controls.
    // Other notification channels retain the zero/null defaults.
    storageReplayCount: integer("storage_replay_count").notNull().default(0),
    storageCycleAttempts: integer("storage_cycle_attempts")
      .notNull()
      .default(0),
    storageTerminalAt: timestamp("storage_terminal_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("notification_events_storage_reconcile_idx")
      .on(t.organisationId, t.availableAt, t.createdAt, t.id)
      .where(
        sql`${t.channel} = 'internal_storage' AND ${t.template} = 'valo.storage-deletion-intent/v1' AND ${t.status} IN ('queued', 'retry_wait')`,
      ),
    index("notification_events_storage_terminal_retention_idx")
      .on(t.organisationId, t.storageTerminalAt, t.id)
      .where(
        sql`${t.channel} = 'internal_storage' AND ${t.template} = 'valo.storage-deletion-intent/v1' AND ${t.status} IN ('completed', 'cancelled') AND ${t.storageTerminalAt} IS NOT NULL`,
      ),
    check(
      "notification_events_storage_replay_count_bound",
      sql`${t.storageReplayCount} BETWEEN 0 AND 3`,
    ),
    check(
      "notification_events_storage_cycle_attempts_bound",
      sql`${t.storageCycleAttempts} BETWEEN 0 AND 5`,
    ),
  ],
);

/**
 * Shared post-authentication fixed-window limiter. The opaque key is a SHA-256
 * digest over the bounded policy dimensions; no raw identity or address is
 * persisted. Every consume/cleanup query runs in the caller's tenant tx.
 */
export const authenticatedRateLimitBuckets = pgTable(
  "authenticated_rate_limit_buckets",
  {
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    bucketKeySha256: text("bucket_key_sha256").notNull(),
    windowStartedAt: timestamp("window_started_at", {
      withTimezone: true,
    }).notNull(),
    requestCount: integer("request_count").notNull().default(1),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({
      name: "authenticated_rate_limit_buckets_pk",
      columns: [t.organisationId, t.bucketKeySha256, t.windowStartedAt],
    }),
    index("authenticated_rate_limit_buckets_expiry_idx").on(
      t.expiresAt,
      t.organisationId,
    ),
    check(
      "authenticated_rate_limit_buckets_key_sha256_check",
      sql`${t.bucketKeySha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "authenticated_rate_limit_buckets_request_count_check",
      sql`${t.requestCount} BETWEEN 1 AND 1000000`,
    ),
    check(
      "authenticated_rate_limit_buckets_window_check",
      sql`${t.expiresAt} > ${t.windowStartedAt}`,
    ),
  ],
);

export const retentionRequests = pgTable(
  "retention_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id").references(() => organisations.id, {
      onDelete: "restrict",
    }),
    // The live FK is detached by the project cascade, while the immutable
    // subject UUID below keeps the request and its control evidence addressable.
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    subjectProjectId: uuid("subject_project_id").notNull(),
    requestedBy: uuid("requested_by").references(() => users.id, {
      onDelete: "restrict",
    }),
    requestedByName: text("requested_by_name").notNull(),
    reason: text("reason"),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    certificateText: text("certificate_text"),
    status: text("status").notNull().default("pending"),
    completionProtocolVersion: integer("completion_protocol_version")
      .notNull()
      .default(1),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  // At most one OPEN request per project: the manual endpoint and the retention
  // scheduler both dedup in code, but this partial unique index is the last-line
  // guarantee that concurrent runs can never create duplicate pending requests.
  (t) => [
    uniqueIndex("retention_requests_one_pending_per_project")
      .on(t.subjectProjectId)
      .where(sql`${t.status} = 'pending'`),
    index("retention_requests_org_subject_idx").on(
      t.organisationId,
      t.subjectProjectId,
      t.createdAt,
    ),
    check(
      "retention_requests_completion_state_check",
      sql`${t.completionProtocolVersion} = 0 or (${t.completionProtocolVersion} = 1 and ((${t.status} in ('pending', 'reconciling') and ${t.completedAt} is null and ${t.certificateText} is null) or (${t.status} = 'completed' and ${t.completedAt} is not null and ${t.certificateText} is not null and length(btrim(${t.certificateText})) between 1 and 512) or (${t.status} = 'blocked' and ${t.completedAt} is not null and ${t.certificateText} is null)))`,
    ),
  ],
);

// Global, admin-configurable settings (single-row table). Holds the scoring
// parameters the deterministic risk engine reads at runtime, report-template
// details, and retention defaults. The `id` is pinned to a fixed value so
// there is exactly one active configuration; historic reports keep their own
// engine-version stamp and are never rewritten when this changes.
export const appConfig = pgTable("app_config", {
  id: text("id").primaryKey().default("singleton"),
  severityWeightFatal: integer("severity_weight_fatal").notNull().default(40),
  severityWeightLikelyFatal: integer("severity_weight_likely_fatal")
    .notNull()
    .default(25),
  severityWeightScoringRisk: integer("severity_weight_scoring_risk")
    .notNull()
    .default(10),
  severityWeightCosmetic: integer("severity_weight_cosmetic")
    .notNull()
    .default(3),
  missingEvidenceWeight: integer("missing_evidence_weight")
    .notNull()
    .default(5),
  bandMediumCutoff: integer("band_medium_cutoff").notNull().default(15),
  bandHighCutoff: integer("band_high_cutoff").notNull().default(40),
  bandCriticalCutoff: integer("band_critical_cutoff").notNull().default(70),
  firmName: text("firm_name").notNull().default("VALO"),
  confidentialityLegend: text("confidentiality_legend")
    .notNull()
    .default(
      "CONFIDENTIAL — Prepared for internal review. Not for external distribution.",
    ),
  retentionDefaultDays: integer("retention_default_days").notNull().default(14),
  storageLifecycleCursorOrganisationId: uuid(
    "storage_lifecycle_cursor_organisation_id",
  ),
  storageLifecycleLeaseOwner: text("storage_lifecycle_lease_owner"),
  storageLifecycleLeaseExpiresAt: timestamp(
    "storage_lifecycle_lease_expires_at",
    { withTimezone: true },
  ),
  storageLifecycleCycleIncomplete: boolean("storage_lifecycle_cycle_incomplete")
    .notNull()
    .default(false),
  retentionScanCursorOrganisationId: uuid(
    "retention_scan_cursor_organisation_id",
  ),
  retentionScanLeaseOwner: text("retention_scan_lease_owner"),
  retentionScanLeaseExpiresAt: timestamp("retention_scan_lease_expires_at", {
    withTimezone: true,
  }),
  retentionScanCycleIncomplete: boolean("retention_scan_cycle_incomplete")
    .notNull()
    .default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedBy: uuid("updated_by").references(() => users.id, {
    onDelete: "set null",
  }),
});

// Global, deployment-scoped AI retrieval/index registry. Each row records the
// content-addressed identity (canonical definition plus its SHA-256) of the
// deployed retrieval pipeline or corpus-index definition. Version strings are
// derived from the content digest by code, never authored by an operator, and
// the release-gate attestation recomputes and cross-checks them live on every
// evaluation. Rows are superseded, never deleted, so the registry keeps the
// full deployment lineage. Holds no tenant data; tenant isolation of the
// retrieval corpus itself is attested against the FORCE-RLS source tables.
export const aiRetrievalRegistry = pgTable(
  "ai_retrieval_registry",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    component: text("component").notNull(),
    version: text("version").notNull(),
    contentSha256: text("content_sha256").notNull(),
    canonicalDefinition: text("canonical_definition").notNull(),
    status: text("status").notNull().default("active"),
    registeredAt: timestamp("registered_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("ai_retrieval_registry_active_component_idx")
      .on(t.component)
      .where(sql`${t.status} = 'active'`),
    check(
      "ai_retrieval_registry_component_check",
      sql`${t.component} IN ('retrieval', 'index')`,
    ),
    check(
      "ai_retrieval_registry_status_check",
      sql`${t.status} IN ('active', 'superseded')`,
    ),
    check(
      "ai_retrieval_registry_content_sha256_check",
      sql`${t.contentSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "ai_retrieval_registry_version_check",
      sql`${t.version} ~ '^[A-Za-z0-9][A-Za-z0-9./_-]{0,199}$'`,
    ),
    check(
      "ai_retrieval_registry_superseded_check",
      sql`(${t.status} = 'active') = (${t.supersededAt} IS NULL)`,
    ),
  ],
);

export const sbdTemplates = pgTable("sbd_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id").references(() => organisations.id, {
    onDelete: "restrict",
  }),
  code: text("code").notNull(),
  title: text("title").notNull(),
  category: text("category").notNull().default("goods"),
  version: integer("version").notNull().default(1),
  status: text("status").notNull().default("draft"),
  issuingCircular: text("issuing_circular"),
  summary: text("summary"),
  optimisticLockVersion: integer("optimistic_lock_version")
    .notNull()
    .default(1),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const sbdAnnotations = pgTable("sbd_annotations", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id").references(() => organisations.id, {
    onDelete: "restrict",
  }),
  templateId: uuid("template_id")
    .notNull()
    .references(() => sbdTemplates.id, { onDelete: "cascade" }),
  agency: text("agency"),
  section: text("section"),
  kind: text("kind").notNull().default("format"),
  quirk: text("quirk").notNull(),
  version: optimisticVersion(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const reports = pgTable(
  "reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id").references(() => organisations.id, {
      onDelete: "restrict",
    }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    version: integer("version").notNull().default(1),
    status: text("status").notNull().default("draft"),
    docxPath: text("docx_path"),
    pdfPath: text("pdf_path"),
    reviewerId: uuid("reviewer_id").references(() => users.id, {
      onDelete: "set null",
    }),
    reviewerName: text("reviewer_name"),
    attestation: text("attestation"),
    engineVersion: text("engine_version"),
    // Full provenance stamp (NFR-AUD-01): which prompt pack, model, and defect
    // taxonomy were in service when this report version was generated.
    promptPackVersion: text("prompt_pack_version"),
    modelId: text("model_id"),
    taxonomyVersion: text("taxonomy_version"),
    signedOffAt: timestamp("signed_off_at", { withTimezone: true }),
    generatedBy: uuid("generated_by").references(() => users.id, {
      onDelete: "set null",
    }),
    optimisticLockVersion: integer("optimistic_lock_version")
      .notNull()
      .default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("reports_project_version_unique").on(t.projectId, t.version),
    index("reports_org_docx_path_idx").on(t.organisationId, t.docxPath),
    index("reports_org_pdf_path_idx").on(t.organisationId, t.pdfPath),
  ],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    // Historical actor identity is a hash-covered snapshot. It deliberately
    // has no users FK: deleting an identity must never rewrite an audit row.
    userId: uuid("user_id"),
    userName: text("user_name"),
    projectId: uuid("project_id"),
    eventType: text("event_type").notNull(),
    objectType: text("object_type"),
    objectId: text("object_id"),
    details: text("details"),
    // Tamper-evident hash chain (FR-WFM-02). `seq` is a contiguous 1-based
    // position assigned under an advisory lock; `hash` = SHA-256 over the
    // previous event's hash plus this event's canonical payload. Every active
    // row is chained; preserved v1 evidence lives only in legacyAuditEvents.
    // The unique index is a backstop: if serialisation ever fails, the fork
    // errors out instead of silently corrupting the chain.
    seq: integer("seq").notNull(),
    prevHash: text("prev_hash").notNull(),
    hash: text("hash").notNull(),
    // The active chain is always v2 and binds the organisation ID. Legacy v1
    // bytes live only in legacy_audit_events with an explicit assessment.
    hashVersion: integer("hash_version").notNull().default(2),
    // DB-assigned monotonic ordinal (cannot be backdated by a plain INSERT the
    // way created_at can); the verifier uses it to spot unchained rows written
    // after the chain started.
    rowNo: bigserial("row_no", { mode: "number" }).notNull(),
    createdAt: createdAt(),
  },
  // RLS exposes one organisation at a time, so each tenant owns an independent
  // contiguous chain beginning at seq=1. The tenant key is therefore part of
  // the uniqueness boundary; a global seq constraint makes tenant #2 collide.
  (t) => [
    check("audit_events_hash_version_check", sql`${t.hashVersion} = 2`),
    check("audit_events_seq_positive_check", sql`${t.seq} > 0`),
    check(
      "audit_events_prev_hash_format_check",
      sql`${t.prevHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check("audit_events_hash_format_check", sql`${t.hash} ~ '^[0-9a-f]{64}$'`),
    uniqueIndex("audit_events_organisation_seq_unique").on(
      t.organisationId,
      t.seq,
    ),
  ],
);

/**
 * One immutable assessment of a migrated legacy audit stream. The active v2
 * chain does not claim continuity across a known legacy payload mutation.
 */
export const legacyAuditIntegrityAssessments = pgTable(
  "legacy_audit_integrity_assessments",
  {
    id: uuid("id").primaryKey(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    sourceCommit: text("source_commit").notNull(),
    sourceEventCount: integer("source_event_count").notNull(),
    verifiedRanges: text("verified_ranges").notNull(),
    discontinuityRanges: text("discontinuity_ranges").notNull(),
    finding: text("finding").notNull(),
    probableCause: text("probable_cause"),
    externalHeadSeq: integer("external_head_seq").notNull(),
    externalHeadHash: text("external_head_hash").notNull(),
    sourceBackupSha256: text("source_backup_sha256").notNull(),
    sourceAuditExportSha256: text("source_audit_export_sha256").notNull(),
    rehearsalEvidenceSha256: text("rehearsal_evidence_sha256").notNull(),
    archiveDigest: text("archive_digest").notNull(),
    assessedAt: timestamp("assessed_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("legacy_audit_assessments_org_digest_unique").on(
      t.organisationId,
      t.archiveDigest,
    ),
  ],
);

/** Byte-preserving, read-only archive of the pre-tenancy audit relation. */
export const legacyAuditEvents = pgTable(
  "legacy_audit_events",
  {
    id: uuid("id").primaryKey(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    assessmentId: uuid("assessment_id")
      .notNull()
      .references(() => legacyAuditIntegrityAssessments.id, {
        onDelete: "restrict",
      }),
    // These UUIDs are historical values only; no mutable parent FKs exist.
    userId: uuid("user_id"),
    userName: text("user_name"),
    projectId: uuid("project_id"),
    eventType: text("event_type").notNull(),
    objectType: text("object_type"),
    objectId: text("object_id"),
    details: text("details"),
    seq: integer("seq").notNull(),
    prevHash: text("prev_hash").notNull(),
    hash: text("hash").notNull(),
    rowNo: pgBigint("row_no", { mode: "number" }).notNull(),
    integrityStatus: text("integrity_status").notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    check(
      "legacy_audit_events_integrity_status_check",
      sql`${t.integrityStatus} in ('payload_hash_verified', 'known_discontinuity')`,
    ),
    uniqueIndex("legacy_audit_events_org_seq_unique").on(
      t.organisationId,
      t.seq,
    ),
    uniqueIndex("legacy_audit_events_org_row_no_unique").on(
      t.organisationId,
      t.rowNo,
    ),
  ],
);

export const llmRuns = pgTable("llm_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id").references(() => organisations.id, {
    onDelete: "restrict",
  }),
  projectId: uuid("project_id").references(() => projects.id, {
    onDelete: "cascade",
  }),
  task: text("task").notNull(),
  model: text("model"),
  promptVersion: text("prompt_version"),
  inputHash: text("input_hash"),
  outputSummary: text("output_summary"),
  // Cost telemetry (FR-ANL-03): raw token counts per call, rolled up to
  // per-engagement cost records against the BP unit assumption.
  promptTokens: integer("prompt_tokens"),
  completionTokens: integer("completion_tokens"),
  error: text("error"),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------
// v1.0-v2.5 governed platform domains. These tables deliberately keep tenant
// identity on every mutable record, exact money in integer minor units, and
// immutable version/provenance references at release boundaries.
// ---------------------------------------------------------------------------

export const ndaRecords = pgTable(
  "nda_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    clientId: uuid("client_id").references(() => clients.id, {
      onDelete: "cascade",
    }),
    documentVersion: text("document_version").notNull(),
    status: text("status").notNull().default("pending"),
    signerName: text("signer_name"),
    signerAuthority: text("signer_authority"),
    signedAt: timestamp("signed_at", { withTimezone: true }),
    documentHash: text("document_hash"),
    signatureEvidence: text("signature_evidence"),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("nda_records_org_client_status_idx").on(
      t.organisationId,
      t.clientId,
      t.status,
    ),
  ],
);

export const privacyRecords = pgTable(
  "privacy_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    recordType: text("record_type").notNull(),
    controllerProcessorRole: text("controller_processor_role").notNull(),
    purpose: text("purpose").notNull(),
    lawfulBasis: text("lawful_basis").notNull(),
    dataCategories: text("data_categories").notNull(),
    subjectCategories: text("subject_categories").notNull(),
    noticeVersion: text("notice_version"),
    retentionSchedule: text("retention_schedule").notNull(),
    dpiaStatus: text("dpia_status").notNull().default("not_required"),
    dcpmiDesignation: text("dcpmi_designation"),
    designationConfirmedBy: text("designation_confirmed_by"),
    legalReviewStatus: text("legal_review_status").notNull().default("pending"),
    effectiveFrom: timestamp("effective_from", {
      withTimezone: true,
    }).notNull(),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("privacy_records_org_type_effective_idx").on(
      t.organisationId,
      t.recordType,
      t.effectiveFrom,
    ),
  ],
);

export const consentRecords = pgTable(
  "consent_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    privacyRecordId: uuid("privacy_record_id").references(
      () => privacyRecords.id,
      { onDelete: "restrict" },
    ),
    subjectReference: text("subject_reference").notNull(),
    purpose: text("purpose").notNull(),
    noticeVersion: text("notice_version").notNull(),
    affirmativeAction: text("affirmative_action").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
    evidenceHash: text("evidence_hash").notNull(),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("consent_records_org_subject_idx").on(
      t.organisationId,
      t.subjectReference,
    ),
  ],
);

export const dataSubjectRequests = pgTable(
  "data_subject_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    requestType: text("request_type").notNull(),
    requesterReference: text("requester_reference").notNull(),
    identityVerificationStatus: text("identity_verification_status")
      .notNull()
      .default("pending"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("received"),
    assignedToUserId: uuid("assigned_to_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    responseEvidence: text("response_evidence"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("dsr_org_status_due_idx").on(t.organisationId, t.status, t.dueAt),
  ],
);

export const legalHolds = pgTable(
  "legal_holds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "restrict",
    }),
    scope: text("scope").notNull(),
    reason: text("reason").notNull(),
    status: text("status").notNull().default("active"),
    placedByUserId: uuid("placed_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    releasedByUserId: uuid("released_by_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("legal_holds_org_project_status_idx").on(
      t.organisationId,
      t.projectId,
      t.status,
    ),
  ],
);

export const subprocessors = pgTable(
  "subprocessors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    legalName: text("legal_name").notNull(),
    service: text("service").notNull(),
    countryCode: text("country_code").notNull(),
    dpaStatus: text("dpa_status").notNull().default("pending"),
    securityReviewStatus: text("security_review_status")
      .notNull()
      .default("pending"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    nextReviewAt: timestamp("next_review_at", { withTimezone: true }),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("subprocessors_org_name_service_unique").on(
      t.organisationId,
      t.legalName,
      t.service,
    ),
  ],
);

export const crossBorderTransfers = pgTable(
  "cross_border_transfers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    subprocessorId: uuid("subprocessor_id").references(() => subprocessors.id, {
      onDelete: "restrict",
    }),
    exporterRole: text("exporter_role").notNull(),
    importerRole: text("importer_role").notNull(),
    originCountry: text("origin_country").notNull(),
    destinationCountry: text("destination_country").notNull(),
    dataCategories: text("data_categories").notNull(),
    purpose: text("purpose").notNull(),
    transferBasis: text("transfer_basis").notNull(),
    approvalEvidence: text("approval_evidence"),
    legalReviewStatus: text("legal_review_status").notNull().default("pending"),
    nextReviewAt: timestamp("next_review_at", { withTimezone: true }).notNull(),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("cross_border_transfers_org_review_idx").on(
      t.organisationId,
      t.nextReviewAt,
    ),
  ],
);

export const tenders = pgTable(
  "tenders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    reference: text("reference").notNull(),
    title: text("title").notNull(),
    procuringEntity: text("procuring_entity").notNull(),
    jurisdiction: text("jurisdiction").notNull().default("NG"),
    fundingSource: text("funding_source"),
    procurementCategory: text("procurement_category"),
    sourceType: text("source_type").notNull(),
    sourceLicenceReference: text("source_licence_reference"),
    submissionDeadline: timestamp("submission_deadline", {
      withTimezone: true,
    }),
    status: text("status").notNull().default("identified"),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("tenders_org_reference_unique").on(
      t.organisationId,
      t.reference,
    ),
  ],
);

export const tenderLots = pgTable(
  "tender_lots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    tenderId: uuid("tender_id")
      .notNull()
      .references(() => tenders.id, { onDelete: "cascade" }),
    lotReference: text("lot_reference").notNull(),
    title: text("title"),
    submissionDeadline: timestamp("submission_deadline", {
      withTimezone: true,
    }),
    status: text("status").notNull().default("active"),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("tender_lots_tender_reference_unique").on(
      t.tenderId,
      t.lotReference,
    ),
  ],
);

export const engagementTenderLots = pgTable(
  "engagement_tender_lots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    tenderId: uuid("tender_id")
      .notNull()
      .references(() => tenders.id, { onDelete: "restrict" }),
    tenderLotId: uuid("tender_lot_id")
      .notNull()
      .references(() => tenderLots.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("engagement_tender_lots_project_lot_unique").on(
      t.projectId,
      t.tenderLotId,
    ),
  ],
);

export const uploadSessions = pgTable(
  "upload_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    expectedBytes: pgBigint("expected_bytes", { mode: "number" }).notNull(),
    receivedBytes: pgBigint("received_bytes", { mode: "number" })
      .notNull()
      .default(0),
    expectedSha256: text("expected_sha256"),
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status").notNull().default("open"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("upload_sessions_org_idempotency_unique").on(
      t.organisationId,
      t.idempotencyKey,
    ),
    index("upload_sessions_cleanup_project_expiry_idx")
      .on(t.organisationId, t.projectId, t.expiresAt, t.id)
      .where(
        sql`${t.status} IN ('open', 'completed', 'rejected', 'quarantined', 'cleanup_unconfirmed')`,
      ),
    index("upload_sessions_cleanup_expiry_idx")
      .on(t.organisationId, t.expiresAt, t.id)
      .where(
        sql`${t.status} IN ('open', 'completed', 'rejected', 'quarantined', 'cleanup_unconfirmed')`,
      ),
  ],
);

export const documentVersions = pgTable(
  "document_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    supersedesVersionId: uuid("supersedes_version_id"),
    objectPath: text("object_path").notNull(),
    sha256: text("sha256").notNull(),
    detectedMime: text("detected_mime").notNull(),
    detectedFormat: text("detected_format").notNull(),
    sizeBytes: pgBigint("size_bytes", { mode: "number" }).notNull(),
    pageCount: integer("page_count"),
    malwareStatus: text("malware_status").notNull().default("pending"),
    quarantineStatus: text("quarantine_status")
      .notNull()
      .default("quarantined"),
    integrityManifest: text("integrity_manifest").notNull(),
    addendumStatus: text("addendum_status").notNull().default("not_assessed"),
    uploadedBy: uuid("uploaded_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("document_versions_document_number_unique").on(
      t.documentId,
      t.versionNumber,
    ),
    uniqueIndex("document_versions_org_hash_unique").on(
      t.organisationId,
      t.sha256,
    ),
    index("document_versions_org_object_path_idx").on(
      t.organisationId,
      t.objectPath,
    ),
  ],
);

export const processingJobs = pgTable(
  "processing_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    documentVersionId: uuid("document_version_id").references(
      () => documentVersions.id,
      { onDelete: "cascade" },
    ),
    jobType: text("job_type").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status").notNull().default("queued"),
    priority: integer("priority").notNull().default(100),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    availableAt: timestamp("available_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    lastErrorSummary: text("last_error_summary"),
    progressPercent: integer("progress_percent").notNull().default(0),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("processing_jobs_org_idempotency_unique").on(
      t.organisationId,
      t.idempotencyKey,
    ),
    index("processing_jobs_status_available_priority_idx").on(
      t.status,
      t.availableAt,
      t.priority,
    ),
  ],
);

export const modelConfigurations = pgTable(
  "model_configurations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    task: text("task").notNull(),
    configurationVersion: integer("configuration_version").notNull(),
    configuration: text("configuration").notNull(),
    status: text("status").notNull().default("draft"),
    evaluationRunId: uuid("evaluation_run_id"),
    promotedByUserId: uuid("promoted_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    promotedAt: timestamp("promoted_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("model_configs_scope_task_version_unique").on(
      t.organisationId,
      t.task,
      t.configurationVersion,
    ),
  ],
);

export const promptConfigurations = pgTable(
  "prompt_configurations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id").references(() => organisations.id, {
      onDelete: "restrict",
    }),
    task: text("task").notNull(),
    promptVersion: integer("prompt_version").notNull(),
    templateHash: text("template_hash").notNull(),
    schemaVersion: text("schema_version").notNull(),
    status: text("status").notNull().default("draft"),
    evaluationRunId: uuid("evaluation_run_id"),
    promotedByUserId: uuid("promoted_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    promotedAt: timestamp("promoted_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("prompt_configs_scope_task_version_unique").on(
      t.organisationId,
      t.task,
      t.promptVersion,
    ),
  ],
);

export const processingRuns = pgTable(
  "processing_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    jobId: uuid("job_id")
      .notNull()
      .references(() => processingJobs.id, { onDelete: "cascade" }),
    runType: text("run_type").notNull(),
    provider: text("provider").notNull(),
    modelConfigurationId: uuid("model_configuration_id").references(
      () => modelConfigurations.id,
      { onDelete: "restrict" },
    ),
    promptConfigurationId: uuid("prompt_configuration_id").references(
      () => promptConfigurations.id,
      { onDelete: "restrict" },
    ),
    inputHash: text("input_hash").notNull(),
    outputHash: text("output_hash"),
    status: text("status").notNull().default("running"),
    latencyMs: integer("latency_ms"),
    costMinor: pgBigint("cost_minor", { mode: "bigint" }),
    costCurrency: text("cost_currency"),
    promptTokens: integer("prompt_tokens"),
    completionTokens: integer("completion_tokens"),
    confidenceCalibrationVersion: text("confidence_calibration_version"),
    errorCode: text("error_code"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [index("processing_runs_org_job_idx").on(t.organisationId, t.jobId)],
);

export const requirementCitations = pgTable(
  "requirement_citations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    requirementId: uuid("requirement_id")
      .notNull()
      .references(() => requirements.id, { onDelete: "cascade" }),
    documentVersionId: uuid("document_version_id")
      .notNull()
      .references(() => documentVersions.id, { onDelete: "restrict" }),
    pageNumber: integer("page_number"),
    paragraphRef: text("paragraph_ref"),
    tableRef: text("table_ref"),
    coordinateJson: text("coordinate_json"),
    sourceSnippet: text("source_snippet").notNull(),
    sourceSnippetHash: text("source_snippet_hash").notNull(),
    verificationStatus: text("verification_status")
      .notNull()
      .default("pending"),
    verifiedByUserId: uuid("verified_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("requirement_citations_requirement_idx").on(
      t.requirementId,
      t.verificationStatus,
    ),
  ],
);

export const workTasks = pgTable(
  "work_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    requirementId: uuid("requirement_id").references(() => requirements.id, {
      onDelete: "cascade",
    }),
    title: text("title").notNull(),
    description: text("description"),
    ownerMembershipId: uuid("owner_membership_id").references(
      () => organisationMemberships.id,
      { onDelete: "set null" },
    ),
    dueAt: timestamp("due_at", { withTimezone: true }),
    priority: text("priority").notNull().default("normal"),
    status: text("status").notNull().default("open"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("work_tasks_org_owner_status_due_idx").on(
      t.organisationId,
      t.ownerMembershipId,
      t.status,
      t.dueAt,
    ),
  ],
);

export const comments = pgTable(
  "comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    objectType: text("object_type").notNull(),
    objectId: uuid("object_id").notNull(),
    body: text("body").notNull(),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedByUserId: uuid("resolved_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("comments_org_object_idx").on(
      t.organisationId,
      t.objectType,
      t.objectId,
    ),
  ],
);

export const reviews = pgTable(
  "reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    reviewType: text("review_type").notNull(),
    objectType: text("object_type").notNull(),
    objectId: uuid("object_id").notNull(),
    reviewerUserId: uuid("reviewer_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    status: text("status").notNull().default("pending"),
    findings: text("findings"),
    sourceVersion: integer("source_version").notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("reviews_org_type_status_idx").on(
      t.organisationId,
      t.reviewType,
      t.status,
    ),
  ],
);

export const approvals = pgTable(
  "approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    approvalType: text("approval_type").notNull(),
    objectType: text("object_type").notNull(),
    objectId: uuid("object_id").notNull(),
    requestedByUserId: uuid("requested_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    decidedByUserId: uuid("decided_by_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    decision: text("decision").notNull().default("pending"),
    reason: text("reason"),
    evidenceSnapshotHash: text("evidence_snapshot_hash"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("approvals_org_type_decision_idx").on(
      t.organisationId,
      t.approvalType,
      t.decision,
    ),
  ],
);

export const defectDecisions = pgTable(
  "defect_decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    defectId: uuid("defect_id")
      .notNull()
      .references(() => defects.id, { onDelete: "restrict" }),
    action: text("action").notNull(),
    fromSeverity: text("from_severity").notNull(),
    proposedSeverity: text("proposed_severity"),
    reason: text("reason").notNull(),
    evidenceIds: text("evidence_ids").notNull(),
    initiatedByUserId: uuid("initiated_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    approvedByUserId: uuid("approved_by_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    status: text("status").notNull().default("pending"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("defect_decisions_defect_status_idx").on(t.defectId, t.status)],
);

export const vaultItemVersions = pgTable(
  "vault_item_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    vaultItemId: uuid("vault_item_id")
      .notNull()
      .references(() => vaultItems.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    documentVersionId: uuid("document_version_id")
      .notNull()
      .references(() => documentVersions.id, { onDelete: "restrict" }),
    issueDate: timestamp("issue_date", { withTimezone: true }),
    expiryDate: timestamp("expiry_date", { withTimezone: true }),
    issuingAuthority: text("issuing_authority"),
    verificationState: text("verification_state")
      .notNull()
      .default("unverified"),
    restrictions: text("restrictions"),
    approvedByUserId: uuid("approved_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("vault_item_versions_item_number_unique").on(
      t.vaultItemId,
      t.versionNumber,
    ),
  ],
);

export const vaultUsage = pgTable(
  "vault_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    vaultItemVersionId: uuid("vault_item_version_id")
      .notNull()
      .references(() => vaultItemVersions.id, { onDelete: "restrict" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    purpose: text("purpose").notNull(),
    usedByUserId: uuid("used_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    usedAt: timestamp("used_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("vault_usage_org_project_idx").on(t.organisationId, t.projectId),
  ],
);

export const capabilityVersions = pgTable(
  "capability_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    capabilityItemId: uuid("capability_item_id")
      .notNull()
      .references(() => capabilityItems.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    approvedClaim: text("approved_claim").notNull(),
    validFrom: timestamp("valid_from", { withTimezone: true }),
    validUntil: timestamp("valid_until", { withTimezone: true }),
    restrictions: text("restrictions"),
    approvalState: text("approval_state").notNull().default("draft"),
    reviewerUserId: uuid("reviewer_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("capability_versions_item_number_unique").on(
      t.capabilityItemId,
      t.versionNumber,
    ),
  ],
);

export const capabilityEvidenceLinks = pgTable(
  "capability_evidence_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    capabilityVersionId: uuid("capability_version_id")
      .notNull()
      .references(() => capabilityVersions.id, { onDelete: "cascade" }),
    vaultItemVersionId: uuid("vault_item_version_id").references(
      () => vaultItemVersions.id,
      { onDelete: "restrict" },
    ),
    documentVersionId: uuid("document_version_id").references(
      () => documentVersions.id,
      { onDelete: "restrict" },
    ),
    citation: text("citation").notNull(),
    evidenceHash: text("evidence_hash").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("capability_evidence_links_version_idx").on(t.capabilityVersionId),
  ],
);

export const capabilityUsage = pgTable(
  "capability_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    capabilityVersionId: uuid("capability_version_id")
      .notNull()
      .references(() => capabilityVersions.id, { onDelete: "restrict" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    draftClaimId: uuid("draft_claim_id"),
    usedByUserId: uuid("used_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    usedAt: timestamp("used_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("capability_usage_org_project_idx").on(t.organisationId, t.projectId),
  ],
);

export const boqRuns = pgTable(
  "boq_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    documentVersionId: uuid("document_version_id")
      .notNull()
      .references(() => documentVersions.id, { onDelete: "restrict" }),
    rulePackId: text("rule_pack_id").notNull(),
    verifierVersion: text("verifier_version").notNull(),
    workbookManifest: text("workbook_manifest").notNull(),
    status: text("status").notNull().default("running"),
    exceptionCount: integer("exception_count").notNull().default(0),
    startedByUserId: uuid("started_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    version: optimisticVersion(),
  },
  (t) => [
    index("boq_runs_org_project_status_idx").on(
      t.organisationId,
      t.projectId,
      t.status,
    ),
  ],
);

export const boqExceptions = pgTable(
  "boq_exceptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    boqRunId: uuid("boq_run_id")
      .notNull()
      .references(() => boqRuns.id, { onDelete: "cascade" }),
    lotReference: text("lot_reference"),
    sheetName: text("sheet_name"),
    cellReference: text("cell_reference"),
    exceptionCode: text("exception_code").notNull(),
    severity: text("severity").notNull(),
    expectedMinor: pgBigint("expected_minor", { mode: "bigint" }),
    actualMinor: pgBigint("actual_minor", { mode: "bigint" }),
    currency: text("currency"),
    finding: text("finding").notNull(),
    status: text("status").notNull().default("open"),
    resolutionReason: text("resolution_reason"),
    resolvedByUserId: uuid("resolved_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("boq_exceptions_run_status_idx").on(t.boqRunId, t.status)],
);

export const drafts = pgTable(
  "drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    sectionKey: text("section_key").notNull(),
    title: text("title").notNull(),
    status: text("status").notNull().default("draft"),
    currentVersionNumber: integer("current_version_number")
      .notNull()
      .default(0),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("drafts_project_section_unique").on(t.projectId, t.sectionKey),
  ],
);

export const draftVersions = pgTable(
  "draft_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    draftId: uuid("draft_id")
      .notNull()
      .references(() => drafts.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    content: text("content").notNull(),
    contentHash: text("content_hash").notNull(),
    sourceRequirementVersionSnapshot: text(
      "source_requirement_version_snapshot",
    ).notNull(),
    authorType: text("author_type").notNull(),
    authorUserId: uuid("author_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    modelRunId: uuid("model_run_id").references(() => processingRuns.id, {
      onDelete: "restrict",
    }),
    changeSummary: text("change_summary"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("draft_versions_draft_number_unique").on(
      t.draftId,
      t.versionNumber,
    ),
  ],
);

export const draftClaims = pgTable(
  "draft_claims",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    draftVersionId: uuid("draft_version_id")
      .notNull()
      .references(() => draftVersions.id, { onDelete: "cascade" }),
    claimKey: text("claim_key").notNull(),
    claimText: text("claim_text").notNull(),
    claimKind: text("claim_kind").notNull(),
    startOffset: integer("start_offset"),
    endOffset: integer("end_offset"),
    groundingStatus: text("grounding_status").notNull().default("unverified"),
    reviewerUserId: uuid("reviewer_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("draft_claims_version_key_unique").on(
      t.draftVersionId,
      t.claimKey,
    ),
  ],
);

export const claimEvidenceLinks = pgTable(
  "claim_evidence_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    draftClaimId: uuid("draft_claim_id")
      .notNull()
      .references(() => draftClaims.id, { onDelete: "cascade" }),
    capabilityVersionId: uuid("capability_version_id").references(
      () => capabilityVersions.id,
      { onDelete: "restrict" },
    ),
    vaultItemVersionId: uuid("vault_item_version_id").references(
      () => vaultItemVersions.id,
      { onDelete: "restrict" },
    ),
    documentVersionId: uuid("document_version_id").references(
      () => documentVersions.id,
      { onDelete: "restrict" },
    ),
    evidenceCitation: text("evidence_citation").notNull(),
    evidenceHash: text("evidence_hash").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("claim_evidence_links_claim_idx").on(t.draftClaimId)],
);

export const redTeamRuns = pgTable(
  "red_team_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    sourceSnapshotHash: text("source_snapshot_hash").notNull(),
    policyVersion: text("policy_version").notNull(),
    status: text("status").notNull().default("running"),
    initiatedByUserId: uuid("initiated_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    approvedByUserId: uuid("approved_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("red_team_runs_org_project_status_idx").on(
      t.organisationId,
      t.projectId,
      t.status,
    ),
  ],
);

export const redTeamFindings = pgTable(
  "red_team_findings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    redTeamRunId: uuid("red_team_run_id")
      .notNull()
      .references(() => redTeamRuns.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    severity: text("severity").notNull(),
    objectType: text("object_type"),
    objectId: uuid("object_id"),
    finding: text("finding").notNull(),
    status: text("status").notNull().default("open"),
    resolution: text("resolution"),
    resolvedByUserId: uuid("resolved_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("red_team_findings_run_status_idx").on(t.redTeamRunId, t.status),
  ],
);

export const packages = pgTable(
  "packages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    packageType: text("package_type").notNull(),
    status: text("status").notNull().default("draft"),
    currentVersionNumber: integer("current_version_number")
      .notNull()
      .default(0),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("packages_org_project_status_idx").on(
      t.organisationId,
      t.projectId,
      t.status,
    ),
  ],
);

export const packageVersions = pgTable(
  "package_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    packageId: uuid("package_id")
      .notNull()
      .references(() => packages.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    sourceSnapshotHash: text("source_snapshot_hash").notNull(),
    manifestHash: text("manifest_hash").notNull(),
    docxObjectPath: text("docx_object_path"),
    docxSha256: text("docx_sha256"),
    pdfObjectPath: text("pdf_object_path"),
    pdfSha256: text("pdf_sha256"),
    zipObjectPath: text("zip_object_path"),
    zipSha256: text("zip_sha256"),
    renderQaStatus: text("render_qa_status").notNull().default("pending"),
    readinessSnapshot: text("readiness_snapshot").notNull(),
    generatedByUserId: uuid("generated_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("package_versions_package_number_unique").on(
      t.packageId,
      t.versionNumber,
    ),
    index("package_versions_org_docx_path_idx").on(
      t.organisationId,
      t.docxObjectPath,
    ),
    index("package_versions_org_pdf_path_idx").on(
      t.organisationId,
      t.pdfObjectPath,
    ),
    index("package_versions_org_zip_path_idx").on(
      t.organisationId,
      t.zipObjectPath,
    ),
  ],
);

export const packageManifestItems = pgTable(
  "package_manifest_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    packageVersionId: uuid("package_version_id")
      .notNull()
      .references(() => packageVersions.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    itemType: text("item_type").notNull(),
    sourceObjectId: uuid("source_object_id"),
    sourceVersion: integer("source_version"),
    filename: text("filename").notNull(),
    sha256: text("sha256").notNull(),
    sizeBytes: pgBigint("size_bytes", { mode: "number" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("package_manifest_items_version_ordinal_unique").on(
      t.packageVersionId,
      t.ordinal,
    ),
  ],
);

export const packageSignoffs = pgTable(
  "package_signoffs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    packageVersionId: uuid("package_version_id")
      .notNull()
      .references(() => packageVersions.id, { onDelete: "restrict" }),
    signerUserId: uuid("signer_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    signerRole: text("signer_role").notNull(),
    signerAuthority: text("signer_authority").notNull(),
    intentStatement: text("intent_statement").notNull(),
    documentHash: text("document_hash").notNull(),
    trustedTimestamp: timestamp("trusted_timestamp", {
      withTimezone: true,
    }).notNull(),
    mfaEvidence: text("mfa_evidence").notNull(),
    deviceEventEvidence: text("device_event_evidence").notNull(),
    certificateVerification: text("certificate_verification"),
    auditEventId: uuid("audit_event_id")
      .notNull()
      .references(() => auditEvents.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("package_signoffs_version_signer_unique").on(
      t.packageVersionId,
      t.signerUserId,
    ),
  ],
);

export const exportDeliveries = pgTable(
  "export_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    packageVersionId: uuid("package_version_id")
      .notNull()
      .references(() => packageVersions.id, { onDelete: "restrict" }),
    deliveryChannel: text("delivery_channel").notNull(),
    recipientReference: text("recipient_reference"),
    signedUrlExpiresAt: timestamp("signed_url_expires_at", {
      withTimezone: true,
    }),
    deliveryReceiptHash: text("delivery_receipt_hash"),
    status: text("status").notNull().default("pending"),
    exportedByUserId: uuid("exported_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    exportedAt: timestamp("exported_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    version: optimisticVersion(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("export_deliveries_org_status_idx").on(t.organisationId, t.status),
  ],
);

export const priceBooks = pgTable(
  "price_books",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id").references(() => organisations.id, {
      onDelete: "restrict",
    }),
    name: text("name").notNull(),
    versionNumber: integer("version_number").notNull(),
    status: text("status").notNull().default("draft"),
    effectiveFrom: timestamp("effective_from", {
      withTimezone: true,
    }).notNull(),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    approvedByUserId: uuid("approved_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("price_books_scope_name_version_unique").on(
      t.organisationId,
      t.name,
      t.versionNumber,
    ),
  ],
);

export const priceBookEntries = pgTable(
  "price_book_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    priceBookId: uuid("price_book_id")
      .notNull()
      .references(() => priceBooks.id, { onDelete: "cascade" }),
    productCode: text("product_code").notNull(),
    productKind: text("product_kind").notNull(),
    currency: text("currency").notNull(),
    amountMinor: pgBigint("amount_minor", { mode: "bigint" }).notNull(),
    minorUnitDigits: integer("minor_unit_digits").notNull().default(2),
    billingCadence: text("billing_cadence"),
    usageConfiguration: text("usage_configuration"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("price_book_entries_book_product_unique").on(
      t.priceBookId,
      t.productCode,
    ),
  ],
);

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "restrict",
    }),
    priceBookEntryId: uuid("price_book_entry_id")
      .notNull()
      .references(() => priceBookEntries.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull().default(1),
    unitAmountMinor: pgBigint("unit_amount_minor", {
      mode: "bigint",
    }).notNull(),
    totalAmountMinor: pgBigint("total_amount_minor", {
      mode: "bigint",
    }).notNull(),
    currency: text("currency").notNull(),
    status: text("status").notNull().default("pending"),
    idempotencyKey: text("idempotency_key").notNull(),
    placedByUserId: uuid("placed_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("orders_org_idempotency_unique").on(
      t.organisationId,
      t.idempotencyKey,
    ),
  ],
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    priceBookEntryId: uuid("price_book_entry_id")
      .notNull()
      .references(() => priceBookEntries.id, { onDelete: "restrict" }),
    status: text("status").notNull().default("pending"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    currentPeriodEndsAt: timestamp("current_period_ends_at", {
      withTimezone: true,
    }),
    cancelsAt: timestamp("cancels_at", { withTimezone: true }),
    providerReference: text("provider_reference"),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("subscriptions_org_status_idx").on(t.organisationId, t.status)],
);

export const entitlements = pgTable(
  "entitlements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    orderId: uuid("order_id").references(() => orders.id, {
      onDelete: "restrict",
    }),
    subscriptionId: uuid("subscription_id").references(() => subscriptions.id, {
      onDelete: "restrict",
    }),
    productKind: text("product_kind").notNull(),
    status: text("status").notNull().default("pending"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    usageLimit: integer("usage_limit"),
    usageConsumed: integer("usage_consumed").notNull().default(0),
    paymentState: text("payment_state").notNull().default("pending"),
    featureFlagKey: text("feature_flag_key"),
    rulesVersion: text("rules_version").notNull(),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("entitlements_org_kind_status_idx").on(
      t.organisationId,
      t.productKind,
      t.status,
    ),
  ],
);

export const entitlementUsage = pgTable(
  "entitlement_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    entitlementId: uuid("entitlement_id")
      .notNull()
      .references(() => entitlements.id, { onDelete: "restrict" }),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    units: integer("units").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    consumedAt: timestamp("consumed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("entitlement_usage_entitlement_key_unique").on(
      t.entitlementId,
      t.idempotencyKey,
    ),
  ],
);

export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    invoiceNumber: text("invoice_number").notNull(),
    currency: text("currency").notNull(),
    netAmountMinor: pgBigint("net_amount_minor", { mode: "bigint" }).notNull(),
    vatRateBasisPoints: integer("vat_rate_basis_points").notNull(),
    vatAmountMinor: pgBigint("vat_amount_minor", { mode: "bigint" }).notNull(),
    grossAmountMinor: pgBigint("gross_amount_minor", {
      mode: "bigint",
    }).notNull(),
    whtRateBasisPoints: integer("wht_rate_basis_points"),
    whtAmountMinor: pgBigint("wht_amount_minor", { mode: "bigint" }),
    netPayableMinor: pgBigint("net_payable_minor", {
      mode: "bigint",
    }).notNull(),
    taxRuleId: text("tax_rule_id").notNull(),
    taxPointAt: timestamp("tax_point_at", { withTimezone: true }).notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }),
    status: text("status").notNull().default("draft"),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("invoices_org_number_unique").on(
      t.organisationId,
      t.invoiceNumber,
    ),
  ],
);

export const invoiceLines = pgTable("invoice_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  invoiceId: uuid("invoice_id")
    .notNull()
    .references(() => invoices.id, { onDelete: "cascade" }),
  orderId: uuid("order_id").references(() => orders.id, {
    onDelete: "restrict",
  }),
  description: text("description").notNull(),
  quantity: integer("quantity").notNull(),
  unitAmountMinor: pgBigint("unit_amount_minor", { mode: "bigint" }).notNull(),
  lineAmountMinor: pgBigint("line_amount_minor", { mode: "bigint" }).notNull(),
  createdAt: createdAt(),
});

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    invoiceId: uuid("invoice_id").references(() => invoices.id, {
      onDelete: "restrict",
    }),
    provider: text("provider").notNull(),
    providerReference: text("provider_reference").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    amountMinor: pgBigint("amount_minor", { mode: "bigint" }).notNull(),
    currency: text("currency").notNull(),
    status: text("status").notNull().default("pending"),
    reconciliationStatus: text("reconciliation_status")
      .notNull()
      .default("pending"),
    providerEventHash: text("provider_event_hash"),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("payments_provider_reference_unique").on(
      t.provider,
      t.providerReference,
    ),
    uniqueIndex("payments_org_idempotency_unique").on(
      t.organisationId,
      t.idempotencyKey,
    ),
  ],
);

export const integrationConfigurations = pgTable(
  "integration_configurations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id").references(() => organisations.id, {
      onDelete: "restrict",
    }),
    adapterType: text("adapter_type").notNull(),
    provider: text("provider").notNull(),
    environment: text("environment").notNull(),
    secretReference: text("secret_reference"),
    configuration: text("configuration").notNull(),
    productionApproved: boolean("production_approved").notNull().default(false),
    status: text("status").notNull().default("disabled"),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("integration_configs_scope_type_provider_unique").on(
      t.organisationId,
      t.adapterType,
      t.provider,
    ),
  ],
);

export const integrationReceipts = pgTable(
  "integration_receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id").references(() => organisations.id, {
      onDelete: "restrict",
    }),
    adapterType: text("adapter_type").notNull(),
    providerEventId: text("provider_event_id").notNull(),
    payloadHash: text("payload_hash").notNull(),
    signatureStatus: text("signature_status").notNull(),
    processingStatus: text("processing_status").notNull().default("received"),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("integration_receipts_type_event_unique").on(
      t.adapterType,
      t.providerEventId,
    ),
  ],
);

export const notificationAttempts = pgTable(
  "notification_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    notificationEventId: uuid("notification_event_id")
      .notNull()
      .references(() => notificationEvents.id, { onDelete: "cascade" }),
    attemptNumber: integer("attempt_number").notNull(),
    provider: text("provider").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status").notNull(),
    responseCode: text("response_code"),
    responseSummary: text("response_summary"),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    attemptedAt: timestamp("attempted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("notification_attempt_event_number_unique").on(
      t.notificationEventId,
      t.attemptNumber,
    ),
    uniqueIndex("notification_attempt_idempotency_unique").on(t.idempotencyKey),
  ],
);

export const retentionActions = pgTable(
  "retention_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    retentionRequestId: uuid("retention_request_id").references(
      () => retentionRequests.id,
      { onDelete: "restrict" },
    ),
    legalHoldId: uuid("legal_hold_id").references(() => legalHolds.id, {
      onDelete: "restrict",
    }),
    objectType: text("object_type").notNull(),
    objectId: uuid("object_id").notNull(),
    action: text("action").notNull(),
    // Historical subject identity is deliberately not a project FK: the action
    // and certificate must survive deletion of the governed project graph.
    subjectProjectId: uuid("subject_project_id"),
    status: text("status").notNull().default("pending"),
    // Existing privacy-operation rows remain protocol zero. The durable
    // detach/reconcile/certify workflow opts in explicitly at insert time.
    completionProtocolVersion: integer("completion_protocol_version")
      .notNull()
      .default(0),
    evidence: text("evidence"),
    sourceManifest: text("source_manifest"),
    sourceManifestSha256: text("source_manifest_sha256"),
    purgeReceipt: text("purge_receipt"),
    purgeReceiptSha256: text("purge_receipt_sha256"),
    purgedAt: timestamp("purged_at", { withTimezone: true }),
    reconciliationManifest: text("reconciliation_manifest"),
    reconciliationManifestSha256: text("reconciliation_manifest_sha256"),
    preparedByUserId: uuid("prepared_by_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    preparedByName: text("prepared_by_name"),
    preparedAt: timestamp("prepared_at", { withTimezone: true }),
    checkedByUserId: uuid("checked_by_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    checkedByName: text("checked_by_name"),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    executedByUserId: uuid("executed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    executedByName: text("executed_by_name"),
    executedAt: timestamp("executed_at", { withTimezone: true }),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("retention_actions_org_status_idx").on(t.organisationId, t.status),
    uniqueIndex("retention_actions_one_completion_per_request")
      .on(t.retentionRequestId)
      .where(sql`${t.completionProtocolVersion} = 1`),
    check(
      "retention_actions_source_manifest_pair_check",
      sql`(${t.sourceManifest} is null and ${t.sourceManifestSha256} is null) or (${t.sourceManifest} is not null and ${t.sourceManifestSha256} ~ '^[0-9a-f]{64}$')`,
    ),
    check(
      "retention_actions_reconciliation_manifest_pair_check",
      sql`(${t.reconciliationManifest} is null and ${t.reconciliationManifestSha256} is null) or (${t.reconciliationManifest} is not null and ${t.reconciliationManifestSha256} ~ '^[0-9a-f]{64}$')`,
    ),
    check(
      "retention_actions_purge_receipt_stamp_check",
      sql`(${t.purgeReceipt} is null and ${t.purgeReceiptSha256} is null and ${t.purgedAt} is null) or (${t.completionProtocolVersion} = 1 and ${t.purgeReceipt} is not null and ${t.purgeReceiptSha256} ~ '^[0-9a-f]{64}$' and ${t.purgedAt} is not null)`,
    ),
    check(
      "retention_actions_preparer_stamp_check",
      sql`(${t.preparedByUserId} is null and ${t.preparedByName} is null and ${t.preparedAt} is null) or (${t.preparedByUserId} is not null and ${t.preparedByName} is not null and length(btrim(${t.preparedByName})) between 1 and 256 and ${t.preparedAt} is not null)`,
    ),
    check(
      "retention_actions_executor_name_check",
      sql`${t.executedByName} is null or length(btrim(${t.executedByName})) between 1 and 256`,
    ),
    check(
      "retention_actions_checker_stamp_check",
      sql`(${t.checkedByUserId} is null and ${t.checkedByName} is null and ${t.checkedAt} is null) or (${t.checkedByUserId} is not null and ${t.checkedByName} is not null and length(btrim(${t.checkedByName})) between 1 and 256 and ${t.checkedAt} is not null and ${t.checkedByUserId} <> ${t.preparedByUserId})`,
    ),
    check(
      "retention_actions_completion_state_check",
      sql`(${t.completionProtocolVersion} = 0 and ${t.status} not in ('detached', 'reconciled', 'certified') and ${t.sourceManifest} is null and ${t.reconciliationManifest} is null and ${t.preparedAt} is null and ${t.checkedAt} is null) or (${t.completionProtocolVersion} = 1 and ((${t.status} = 'pending' and ${t.sourceManifest} is null and ${t.executedByName} is null and ${t.reconciliationManifest} is null and ${t.preparedAt} is null and ${t.checkedAt} is null) or (${t.status} = 'detached' and ${t.subjectProjectId} is not null and ${t.sourceManifest} is not null and ${t.executedByName} is not null and ${t.preparedAt} is null and ${t.reconciliationManifest} is null and ${t.checkedAt} is null) or (${t.status} = 'reconciled' and ${t.subjectProjectId} is not null and ${t.sourceManifest} is not null and ${t.executedByName} is not null and ${t.preparedAt} is not null and ${t.reconciliationManifest} is not null and ${t.checkedAt} is null) or (${t.status} = 'certified' and ${t.subjectProjectId} is not null and ${t.sourceManifest} is not null and ${t.executedByName} is not null and ${t.preparedAt} is not null and ${t.reconciliationManifest} is not null and ${t.checkedAt} is not null) or ${t.status} = 'blocked'))`,
    ),
  ],
);

/**
 * Tamper-evident binding between a retention completion and the exact durable
 * storage lifecycle intent. Raw object paths are intentionally not duplicated.
 */
export const retentionActionStorageEvents = pgTable(
  "retention_action_storage_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    retentionActionId: uuid("retention_action_id")
      .notNull()
      .references(() => retentionActions.id, { onDelete: "restrict" }),
    storageEventId: uuid("storage_event_id")
      .notNull()
      .references(() => notificationEvents.id, { onDelete: "restrict" }),
    requestSha256: text("request_sha256").notNull(),
    objectPathSha256: text("object_path_sha256").notNull(),
    boundEventVersion: integer("bound_event_version").notNull(),
    terminalDisposition: text("terminal_disposition"),
    terminalEventVersion: integer("terminal_event_version"),
    terminalAt: timestamp("terminal_at", { withTimezone: true }),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("retention_action_storage_events_action_event_unique").on(
      t.retentionActionId,
      t.storageEventId,
    ),
    uniqueIndex("retention_action_storage_events_action_path_unique").on(
      t.retentionActionId,
      t.objectPathSha256,
    ),
    index("retention_action_storage_events_org_terminal_idx").on(
      t.organisationId,
      t.retentionActionId,
      t.terminalAt,
      t.id,
    ),
    check(
      "retention_action_storage_events_request_hash_check",
      sql`${t.requestSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "retention_action_storage_events_path_hash_check",
      sql`${t.objectPathSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "retention_action_storage_events_bound_version_check",
      sql`${t.boundEventVersion} >= 1`,
    ),
    check(
      "retention_action_storage_events_terminal_check",
      sql`(${t.terminalDisposition} is null and ${t.terminalEventVersion} is null and ${t.terminalAt} is null) or (${t.terminalDisposition} in ('deleted', 'already_absent', 'cancelled_referenced', 'accepted_unresolved') and ${t.terminalEventVersion} >= ${t.boundEventVersion} and ${t.terminalAt} is not null)`,
    ),
  ],
);

export const deletionCertificates = pgTable(
  "deletion_certificates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    retentionActionId: uuid("retention_action_id")
      .notNull()
      .references(() => retentionActions.id, { onDelete: "restrict" }),
    certificateNumber: text("certificate_number").notNull(),
    scopeManifestHash: text("scope_manifest_hash").notNull(),
    certificateManifest: text("certificate_manifest"),
    certificateManifestSha256: text("certificate_manifest_sha256"),
    method: text("method").notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }).notNull(),
    exceptions: text("exceptions"),
    signedByUserId: uuid("signed_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    signedByName: text("signed_by_name").notNull(),
    signatureEvidence: text("signature_evidence").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("deletion_certificates_org_number_unique").on(
      t.organisationId,
      t.certificateNumber,
    ),
    uniqueIndex("deletion_certificates_retention_action_unique")
      .on(t.retentionActionId)
      .where(sql`${t.certificateManifest} is not null`),
    check(
      "deletion_certificates_scope_hash_check",
      sql`${t.scopeManifestHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "deletion_certificates_manifest_pair_check",
      sql`(${t.certificateManifest} is null and ${t.certificateManifestSha256} is null) or (${t.certificateManifest} is not null and ${t.certificateManifestSha256} ~ '^[0-9a-f]{64}$')`,
    ),
    check(
      "deletion_certificates_signer_name_check",
      sql`length(btrim(${t.signedByName})) between 1 and 256`,
    ),
  ],
);

export const evaluationCases = pgTable(
  "evaluation_cases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id").references(() => organisations.id, {
      onDelete: "restrict",
    }),
    corpusVersion: text("corpus_version").notNull(),
    split: text("split").notNull(),
    task: text("task").notNull(),
    fixtureReference: text("fixture_reference").notNull(),
    labelHash: text("label_hash").notNull(),
    fatalLabelCount: integer("fatal_label_count").notNull().default(0),
    likelyFatalLabelCount: integer("likely_fatal_label_count")
      .notNull()
      .default(0),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("evaluation_cases_corpus_fixture_unique").on(
      t.corpusVersion,
      t.fixtureReference,
    ),
  ],
);

export const evaluationRuns = pgTable(
  "evaluation_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id").references(() => organisations.id, {
      onDelete: "restrict",
    }),
    task: text("task").notNull(),
    corpusVersion: text("corpus_version").notNull(),
    modelConfigurationId: uuid("model_configuration_id").references(
      () => modelConfigurations.id,
      { onDelete: "restrict" },
    ),
    promptConfigurationId: uuid("prompt_configuration_id").references(
      () => promptConfigurations.id,
      { onDelete: "restrict" },
    ),
    status: text("status").notNull().default("running"),
    sampleSize: integer("sample_size").notNull().default(0),
    metrics: text("metrics"),
    limitations: text("limitations"),
    releaseDecision: text("release_decision").notNull().default("pending"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [index("evaluation_runs_task_status_idx").on(t.task, t.status)],
);

export const evaluationResults = pgTable(
  "evaluation_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    evaluationRunId: uuid("evaluation_run_id")
      .notNull()
      .references(() => evaluationRuns.id, { onDelete: "cascade" }),
    evaluationCaseId: uuid("evaluation_case_id")
      .notNull()
      .references(() => evaluationCases.id, { onDelete: "restrict" }),
    passed: boolean("passed").notNull(),
    resultMetrics: text("result_metrics").notNull(),
    outputHash: text("output_hash"),
    errorCode: text("error_code"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("evaluation_results_run_case_unique").on(
      t.evaluationRunId,
      t.evaluationCaseId,
    ),
  ],
);

export const jurisdictionRulePacks = pgTable(
  "jurisdiction_rule_packs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    packKey: text("pack_key").notNull(),
    version: text("version").notNull(),
    jurisdiction: text("jurisdiction").notNull(),
    sourceManifestHash: text("source_manifest_hash").notNull(),
    advisoryOnly: boolean("advisory_only").notNull().default(true),
    status: text("status").notNull().default("draft"),
    approvedByUserId: uuid("approved_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("jurisdiction_rule_packs_key_version_unique").on(
      t.packKey,
      t.version,
    ),
  ],
);

export const jurisdictionRules = pgTable(
  "jurisdiction_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    rulePackId: uuid("rule_pack_id")
      .notNull()
      .references(() => jurisdictionRulePacks.id, { onDelete: "cascade" }),
    ruleKey: text("rule_key").notNull(),
    domain: text("domain").notNull(),
    instrument: text("instrument").notNull(),
    sourceUrls: text("source_urls").notNull(),
    jurisdiction: text("jurisdiction").notNull(),
    entityScope: text("entity_scope").notNull(),
    categoryScope: text("category_scope").notNull(),
    effectiveFrom: timestamp("effective_from", {
      withTimezone: true,
    }).notNull(),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    monetaryBands: text("monetary_bands"),
    approvalOwner: text("approval_owner"),
    evidenceRequirements: text("evidence_requirements").notNull(),
    severity: text("severity").notNull(),
    legalReviewStatus: text("legal_review_status").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    supersedes: text("supersedes"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("jurisdiction_rules_pack_key_unique").on(
      t.rulePackId,
      t.ruleKey,
    ),
  ],
);

/**
 * Immutable, version-bound extraction material. `documents.content_text` is a
 * convenient current projection and can change after reprocessing; grounded
 * tender and addendum decisions must instead cite this exact snapshot.
 */
export const documentVersionSnapshots = pgTable(
  "document_version_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    documentVersionId: uuid("document_version_id")
      .notNull()
      .references(() => documentVersions.id, { onDelete: "restrict" }),
    documentVersionSha256: text("document_version_sha256").notNull(),
    capturedRedactionStatus: text("captured_redaction_status").notNull(),
    canonicalText: text("canonical_text").notNull(),
    canonicalTextSha256: text("canonical_text_sha256").notNull(),
    structuredSnapshot: text("structured_snapshot"),
    structuredSnapshotSha256: text("structured_snapshot_sha256"),
    extractionMethod: text("extraction_method").notNull(),
    parserVersion: text("parser_version").notNull(),
    status: text("status").notNull().default("captured"),
    capturedByUserId: uuid("captured_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    capturedByName: text("captured_by_name").notNull(),
    verifiedByUserId: uuid("verified_by_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    verifiedByName: text("verified_by_name"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("document_version_snapshots_version_unique").on(
      t.documentVersionId,
    ),
    index("document_version_snapshots_org_created_idx").on(
      t.organisationId,
      t.createdAt,
      t.id,
    ),
    check(
      "document_version_snapshots_version_sha256_check",
      sql`${t.documentVersionSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "document_version_snapshots_text_sha256_check",
      sql`${t.canonicalTextSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "document_version_snapshots_structured_pair_check",
      sql`(${t.structuredSnapshot} IS NULL) = (${t.structuredSnapshotSha256} IS NULL)`,
    ),
    check(
      "document_version_snapshots_structured_sha256_check",
      sql`${t.structuredSnapshotSha256} IS NULL OR ${t.structuredSnapshotSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "document_version_snapshots_status_check",
      sql`${t.status} IN ('captured', 'verified', 'rejected')`,
    ),
    check(
      "document_version_snapshots_redaction_status_check",
      sql`${t.capturedRedactionStatus} IN ('included', 'redacted')`,
    ),
    check(
      "document_version_snapshots_review_stamp_check",
      sql`(${t.status} = 'captured' AND ${t.verifiedByUserId} IS NULL AND ${t.verifiedByName} IS NULL AND ${t.verifiedAt} IS NULL) OR (${t.status} IN ('verified', 'rejected') AND ${t.verifiedByUserId} IS NOT NULL AND ${t.verifiedByUserId} <> ${t.capturedByUserId} AND ${t.verifiedByName} IS NOT NULL AND ${t.verifiedAt} IS NOT NULL)`,
    ),
    check(
      "document_version_snapshots_content_bounds_check",
      sql`char_length(${t.canonicalText}) BETWEEN 1 AND 2000000 AND (${t.structuredSnapshot} IS NULL OR char_length(${t.structuredSnapshot}) BETWEEN 1 AND 256000) AND char_length(${t.extractionMethod}) BETWEEN 1 AND 120 AND char_length(${t.parserVersion}) BETWEEN 1 AND 120`,
    ),
    check(
      "document_version_snapshots_reviewer_name_bounds_check",
      sql`char_length(${t.capturedByName}) BETWEEN 1 AND 200 AND (${t.verifiedByName} IS NULL OR char_length(${t.verifiedByName}) BETWEEN 1 AND 200)`,
    ),
  ],
);

/**
 * A tender context is a versioned, project-specific interpretation of exact
 * tender material. It is never a universal Nigeria eligibility checklist and
 * remains advisory until a named reviewer decides this exact version.
 */
export const tenderContextVersions = pgTable(
  "tender_context_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    supersedesContextVersionId: uuid("supersedes_context_version_id"),
    primaryDocumentVersionId: uuid("primary_document_version_id")
      .notNull()
      .references(() => documentVersions.id, { onDelete: "restrict" }),
    jurisdictionRulePackId: uuid("jurisdiction_rule_pack_id")
      .notNull()
      .references(() => jurisdictionRulePacks.id, { onDelete: "restrict" }),
    legalEntityName: text("legal_entity_name").notNull(),
    submissionDate: date("submission_date").notNull(),
    jurisdiction: text("jurisdiction").notNull(),
    entityScopes: text("entity_scopes").notNull(),
    categoryScopes: text("category_scopes").notNull(),
    sourceManifest: text("source_manifest").notNull(),
    sourceManifestSha256: text("source_manifest_sha256").notNull(),
    contextSnapshot: text("context_snapshot").notNull(),
    contextSha256: text("context_sha256").notNull(),
    ruleAdvisories: text("rule_advisories").notNull(),
    status: text("status").notNull().default("pending_review"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    reviewedByUserId: uuid("reviewed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    reviewedByName: text("reviewed_by_name"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewNote: text("review_note"),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      columns: [t.supersedesContextVersionId],
      foreignColumns: [t.id],
      name: "tender_context_versions_supersedes_fk",
    }).onDelete("restrict"),
    uniqueIndex("tender_context_versions_project_number_unique").on(
      t.projectId,
      t.versionNumber,
    ),
    uniqueIndex("tender_context_versions_org_project_hash_unique").on(
      t.organisationId,
      t.projectId,
      t.contextSha256,
    ),
    index("tender_context_versions_org_project_created_idx").on(
      t.organisationId,
      t.projectId,
      t.createdAt,
      t.id,
    ),
    check(
      "tender_context_versions_source_sha256_check",
      sql`${t.sourceManifestSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "tender_context_versions_context_sha256_check",
      sql`${t.contextSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "tender_context_versions_status_check",
      sql`${t.status} IN ('pending_review', 'accepted', 'needs_changes', 'rejected', 'superseded')`,
    ),
    check(
      "tender_context_versions_review_stamp_check",
      sql`(${t.status} = 'pending_review' AND ${t.reviewedByUserId} IS NULL AND ${t.reviewedByName} IS NULL AND ${t.reviewedAt} IS NULL) OR (${t.status} IN ('accepted', 'needs_changes', 'rejected') AND ${t.reviewedByUserId} IS NOT NULL AND ${t.reviewedByName} IS NOT NULL AND ${t.reviewedAt} IS NOT NULL) OR (${t.status} = 'superseded')`,
    ),
    check(
      "tender_context_versions_bounds_check",
      sql`${t.versionNumber} > 0 AND char_length(${t.legalEntityName}) BETWEEN 1 AND 300 AND char_length(${t.jurisdiction}) BETWEEN 2 AND 32 AND char_length(${t.entityScopes}) BETWEEN 2 AND 10000 AND char_length(${t.categoryScopes}) BETWEEN 2 AND 10000 AND char_length(${t.sourceManifest}) BETWEEN 2 AND 200000 AND char_length(${t.contextSnapshot}) BETWEEN 2 AND 500000 AND char_length(${t.ruleAdvisories}) BETWEEN 2 AND 200000 AND (${t.reviewedByName} IS NULL OR char_length(${t.reviewedByName}) BETWEEN 1 AND 200) AND (${t.reviewNote} IS NULL OR char_length(${t.reviewNote}) BETWEEN 1 AND 5000)`,
    ),
  ],
);

export const tenderContextRequirements = pgTable(
  "tender_context_requirements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    tenderContextVersionId: uuid("tender_context_version_id")
      .notNull()
      .references(() => tenderContextVersions.id, { onDelete: "cascade" }),
    requirementId: uuid("requirement_id")
      .notNull()
      .references(() => requirements.id, { onDelete: "restrict" }),
    requirementCitationId: uuid("requirement_citation_id")
      .notNull()
      .references(() => requirementCitations.id, { onDelete: "restrict" }),
    evidenceKind: text("evidence_kind").notNull(),
    mandatory: boolean("mandatory").notNull(),
    requiresCurrentOnSubmissionDate: boolean(
      "requires_current_on_submission_date",
    ).notNull(),
    requiresExactLegalEntityMatch: boolean(
      "requires_exact_legal_entity_match",
    ).notNull(),
    bindingSha256: text("binding_sha256").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("tender_context_requirements_context_requirement_unique").on(
      t.tenderContextVersionId,
      t.requirementId,
    ),
    index("tender_context_requirements_org_project_idx").on(
      t.organisationId,
      t.projectId,
      t.tenderContextVersionId,
    ),
    check(
      "tender_context_requirements_binding_sha256_check",
      sql`${t.bindingSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "tender_context_requirements_evidence_kind_bounds_check",
      sql`char_length(${t.evidenceKind}) BETWEEN 1 AND 120`,
    ),
  ],
);

export const tenderContextArtifacts = pgTable(
  "tender_context_artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    tenderContextVersionId: uuid("tender_context_version_id")
      .notNull()
      .references(() => tenderContextVersions.id, { onDelete: "cascade" }),
    vaultItemVersionId: uuid("vault_item_version_id")
      .notNull()
      .references(() => vaultItemVersions.id, { onDelete: "restrict" }),
    documentVersionId: uuid("document_version_id")
      .notNull()
      .references(() => documentVersions.id, { onDelete: "restrict" }),
    evidenceKind: text("evidence_kind").notNull(),
    legalEntityName: text("legal_entity_name"),
    citationStartOffset: integer("citation_start_offset").notNull(),
    citationEndOffset: integer("citation_end_offset").notNull(),
    citationQuote: text("citation_quote").notNull(),
    citationQuoteSha256: text("citation_quote_sha256").notNull(),
    bindingSha256: text("binding_sha256").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("tender_context_artifacts_context_vault_kind_unique").on(
      t.tenderContextVersionId,
      t.vaultItemVersionId,
      t.evidenceKind,
    ),
    index("tender_context_artifacts_org_project_idx").on(
      t.organisationId,
      t.projectId,
      t.tenderContextVersionId,
    ),
    check(
      "tender_context_artifacts_offsets_check",
      sql`${t.citationStartOffset} >= 0 AND ${t.citationEndOffset} > ${t.citationStartOffset}`,
    ),
    check(
      "tender_context_artifacts_quote_sha256_check",
      sql`${t.citationQuoteSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "tender_context_artifacts_binding_sha256_check",
      sql`${t.bindingSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "tender_context_artifacts_bounds_check",
      sql`char_length(${t.evidenceKind}) BETWEEN 1 AND 120 AND (${t.legalEntityName} IS NULL OR char_length(${t.legalEntityName}) BETWEEN 1 AND 300) AND char_length(${t.citationQuote}) BETWEEN 1 AND 20000 AND ${t.citationEndOffset} <= 5000000`,
    ),
  ],
);

/** A content-addressed, tender-specific eligibility decision-support record. */
export const tenderEligibilityPassports = pgTable(
  "tender_eligibility_passports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    tenderContextVersionId: uuid("tender_context_version_id")
      .notNull()
      .references(() => tenderContextVersions.id, { onDelete: "restrict" }),
    passportId: text("passport_id").notNull(),
    sourceManifestSha256: text("source_manifest_sha256").notNull(),
    resultSnapshot: text("result_snapshot").notNull(),
    resultSnapshotSha256: text("result_snapshot_sha256").notNull(),
    resultStatus: text("result_status").notNull(),
    reviewState: text("review_state").notNull().default("pending_review"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    reviewedByUserId: uuid("reviewed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    reviewedByName: text("reviewed_by_name"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewNote: text("review_note"),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("tender_eligibility_passports_org_project_passport_unique").on(
      t.organisationId,
      t.projectId,
      t.passportId,
    ),
    index("tender_eligibility_passports_org_project_created_idx").on(
      t.organisationId,
      t.projectId,
      t.createdAt,
      t.id,
    ),
    check(
      "tender_eligibility_passports_source_sha256_check",
      sql`${t.sourceManifestSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "tender_eligibility_passports_result_sha256_check",
      sql`${t.resultSnapshotSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "tender_eligibility_passports_result_status_check",
      sql`${t.resultStatus} IN ('blocked', 'incomplete', 'review_required', 'ready_for_human_tender_review')`,
    ),
    check(
      "tender_eligibility_passports_review_state_check",
      sql`${t.reviewState} IN ('pending_review', 'accepted', 'needs_changes', 'rejected')`,
    ),
    check(
      "tender_eligibility_passports_review_stamp_check",
      sql`(${t.reviewState} = 'pending_review' AND ${t.reviewedByUserId} IS NULL AND ${t.reviewedByName} IS NULL AND ${t.reviewedAt} IS NULL) OR (${t.reviewState} IN ('accepted', 'needs_changes', 'rejected') AND ${t.reviewedByUserId} IS NOT NULL AND ${t.reviewedByName} IS NOT NULL AND ${t.reviewedAt} IS NOT NULL)`,
    ),
    check(
      "tender_eligibility_passports_bounds_check",
      sql`char_length(${t.passportId}) BETWEEN 1 AND 128 AND ${t.passportId} ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' AND char_length(${t.resultSnapshot}) BETWEEN 2 AND 1000000 AND (${t.reviewedByName} IS NULL OR char_length(${t.reviewedByName}) BETWEEN 1 AND 200) AND (${t.reviewNote} IS NULL OR char_length(${t.reviewNote}) BETWEEN 1 AND 5000)`,
    ),
  ],
);

/** Exact addendum-to-baseline comparison, pending named-human disposition. */
export const addendumImpactAssessments = pgTable(
  "addendum_impact_assessments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    baselineDocumentVersionId: uuid("baseline_document_version_id")
      .notNull()
      .references(() => documentVersions.id, { onDelete: "restrict" }),
    revisionDocumentVersionId: uuid("revision_document_version_id")
      .notNull()
      .references(() => documentVersions.id, { onDelete: "restrict" }),
    radarId: text("radar_id").notNull(),
    assessmentId: text("assessment_id").notNull(),
    sourceManifestSha256: text("source_manifest_sha256").notNull(),
    impactManifestSha256: text("impact_manifest_sha256").notNull(),
    assessmentSnapshot: text("assessment_snapshot").notNull(),
    reviewState: text("review_state").notNull().default("pending_review"),
    reviewedByUserId: uuid("reviewed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    reviewedByName: text("reviewed_by_name"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewNote: text("review_note"),
    appliedState: text("applied_state").notNull().default("not_applied"),
    appliedByUserId: uuid("applied_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    appliedByName: text("applied_by_name"),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    applyNote: text("apply_note"),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("addendum_impact_assessments_revision_unique").on(
      t.organisationId,
      t.projectId,
      t.baselineDocumentVersionId,
      t.revisionDocumentVersionId,
      t.assessmentId,
    ),
    index("addendum_impact_assessments_org_project_radar_history_idx").on(
      t.organisationId,
      t.projectId,
      t.radarId,
      t.createdAt,
      t.id,
    ),
    check(
      "addendum_impact_assessments_distinct_versions_check",
      sql`${t.baselineDocumentVersionId} <> ${t.revisionDocumentVersionId}`,
    ),
    check(
      "addendum_impact_assessments_source_sha256_check",
      sql`${t.sourceManifestSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "addendum_impact_assessments_impact_sha256_check",
      sql`${t.impactManifestSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "addendum_impact_assessments_review_state_check",
      sql`${t.reviewState} IN ('pending_review', 'accepted', 'needs_changes', 'rejected')`,
    ),
    check(
      "addendum_impact_assessments_review_stamp_check",
      sql`(${t.reviewState} = 'pending_review' AND ${t.reviewedByUserId} IS NULL AND ${t.reviewedByName} IS NULL AND ${t.reviewedAt} IS NULL) OR (${t.reviewState} IN ('accepted', 'needs_changes', 'rejected') AND ${t.reviewedByUserId} IS NOT NULL AND ${t.reviewedByName} IS NOT NULL AND ${t.reviewedAt} IS NOT NULL)`,
    ),
    check(
      "addendum_impact_assessments_applied_state_check",
      sql`${t.appliedState} IN ('not_applied', 'applied', 'application_rejected')`,
    ),
    check(
      "addendum_impact_assessments_applied_stamp_check",
      sql`(${t.appliedState} = 'not_applied' AND ${t.appliedByUserId} IS NULL AND ${t.appliedByName} IS NULL AND ${t.appliedAt} IS NULL) OR (${t.appliedState} IN ('applied', 'application_rejected') AND ${t.appliedByUserId} IS NOT NULL AND ${t.appliedByName} IS NOT NULL AND ${t.appliedAt} IS NOT NULL)`,
    ),
    check(
      "addendum_impact_assessments_bounds_check",
      sql`char_length(${t.radarId}) BETWEEN 1 AND 128 AND ${t.radarId} ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' AND char_length(${t.assessmentId}) BETWEEN 1 AND 128 AND ${t.assessmentId} ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' AND char_length(${t.assessmentSnapshot}) BETWEEN 2 AND 1000000 AND (${t.reviewedByName} IS NULL OR char_length(${t.reviewedByName}) BETWEEN 1 AND 200) AND (${t.appliedByName} IS NULL OR char_length(${t.appliedByName}) BETWEEN 1 AND 200) AND (${t.reviewNote} IS NULL OR char_length(${t.reviewNote}) BETWEEN 1 AND 5000) AND (${t.applyNote} IS NULL OR char_length(${t.applyNote}) BETWEEN 1 AND 5000)`,
    ),
  ],
);

export const addendumImpactItems = pgTable(
  "addendum_impact_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    assessmentId: uuid("assessment_id")
      .notNull()
      .references(() => addendumImpactAssessments.id, { onDelete: "cascade" }),
    changeId: text("change_id").notNull(),
    category: text("category").notNull(),
    kind: text("kind").notNull(),
    beforeText: text("before_text"),
    afterText: text("after_text"),
    citationData: text("citation_data").notNull(),
    fieldExternalId: text("field_external_id"),
    affectedObjectType: text("affected_object_type"),
    affectedObjectId: text("affected_object_id"),
    affectedObjectVersion: integer("affected_object_version"),
    proposedAction: text("proposed_action").notNull(),
    reviewState: text("review_state").notNull().default("pending_review"),
    reviewedByUserId: uuid("reviewed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    reviewedByName: text("reviewed_by_name"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewNote: text("review_note"),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("addendum_impact_items_target_unique")
      .on(t.assessmentId, t.changeId, t.affectedObjectType, t.affectedObjectId)
      .where(sql`${t.affectedObjectType} IS NOT NULL`),
    uniqueIndex("addendum_impact_items_no_target_unique")
      .on(t.assessmentId, t.changeId)
      .where(sql`${t.affectedObjectType} IS NULL`),
    index("addendum_impact_items_org_assessment_idx").on(
      t.organisationId,
      t.assessmentId,
      t.createdAt,
      t.id,
    ),
    check(
      "addendum_impact_items_text_bounds_check",
      sql`coalesce(char_length(${t.beforeText}), 0) <= 20000 AND coalesce(char_length(${t.afterText}), 0) <= 20000 AND char_length(${t.citationData}) <= 40000 AND char_length(${t.proposedAction}) <= 5000`,
    ),
    check(
      "addendum_impact_items_affected_object_tuple_check",
      sql`(${t.affectedObjectType} IS NULL AND ${t.affectedObjectId} IS NULL AND ${t.affectedObjectVersion} IS NULL) OR (${t.affectedObjectType} IS NOT NULL AND ${t.affectedObjectId} IS NOT NULL AND ${t.affectedObjectVersion} IS NOT NULL AND ${t.affectedObjectVersion} > 0)`,
    ),
    check(
      "addendum_impact_items_review_state_check",
      sql`${t.reviewState} IN ('pending_review', 'accepted', 'needs_changes', 'rejected')`,
    ),
    check(
      "addendum_impact_items_review_stamp_check",
      sql`(${t.reviewState} = 'pending_review' AND ${t.reviewedByUserId} IS NULL AND ${t.reviewedByName} IS NULL AND ${t.reviewedAt} IS NULL) OR (${t.reviewState} IN ('accepted', 'needs_changes', 'rejected') AND ${t.reviewedByUserId} IS NOT NULL AND ${t.reviewedByName} IS NOT NULL AND ${t.reviewedAt} IS NOT NULL)`,
    ),
    check(
      "addendum_impact_items_identifier_bounds_check",
      sql`char_length(${t.changeId}) BETWEEN 1 AND 128 AND char_length(${t.category}) BETWEEN 1 AND 120 AND char_length(${t.kind}) BETWEEN 1 AND 120 AND (${t.fieldExternalId} IS NULL OR char_length(${t.fieldExternalId}) BETWEEN 1 AND 128) AND (${t.affectedObjectType} IS NULL OR char_length(${t.affectedObjectType}) BETWEEN 1 AND 120) AND (${t.affectedObjectId} IS NULL OR char_length(${t.affectedObjectId}) BETWEEN 1 AND 128) AND char_length(${t.citationData}) BETWEEN 2 AND 40000 AND char_length(${t.proposedAction}) BETWEEN 1 AND 5000 AND (coalesce(char_length(${t.beforeText}), 0) > 0 OR coalesce(char_length(${t.afterText}), 0) > 0) AND (${t.reviewedByName} IS NULL OR char_length(${t.reviewedByName}) BETWEEN 1 AND 200) AND (${t.reviewNote} IS NULL OR char_length(${t.reviewNote}) BETWEEN 1 AND 5000)`,
    ),
  ],
);

export const ruleEvaluations = pgTable(
  "rule_evaluations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    jurisdictionRuleId: uuid("jurisdiction_rule_id")
      .notNull()
      .references(() => jurisdictionRules.id, { onDelete: "restrict" }),
    inputSnapshotHash: text("input_snapshot_hash").notNull(),
    result: text("result").notNull(),
    advisoryMessage: text("advisory_message").notNull(),
    evidenceSnapshot: text("evidence_snapshot"),
    evaluatedAt: timestamp("evaluated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("rule_evaluations_org_project_idx").on(t.organisationId, t.projectId),
  ],
);

export const ruleOverrides = pgTable(
  "rule_overrides",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    ruleEvaluationId: uuid("rule_evaluation_id")
      .notNull()
      .references(() => ruleEvaluations.id, { onDelete: "restrict" }),
    reason: text("reason").notNull(),
    evidence: text("evidence").notNull(),
    requestedByUserId: uuid("requested_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    approvedByUserId: uuid("approved_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("rule_overrides_evaluation_unique").on(t.ruleEvaluationId),
  ],
);

export const partnerBranding = pgTable(
  "partner_branding",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    partnerOrganisationId: uuid("partner_organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    brandName: text("brand_name").notNull(),
    logoObjectPath: text("logo_object_path"),
    primaryColour: text("primary_colour"),
    secondaryColour: text("secondary_colour"),
    footerText: text("footer_text"),
    status: text("status").notNull().default("draft"),
    approvedByUserId: uuid("approved_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("partner_branding_partner_unique").on(t.partnerOrganisationId),
  ],
);

export const partnerRevenueShareEntries = pgTable(
  "partner_revenue_share_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    partnerOrganisationId: uuid("partner_organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    clientOrganisationId: uuid("client_organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    currency: text("currency").notNull(),
    grossRevenueMinor: pgBigint("gross_revenue_minor", {
      mode: "bigint",
    }).notNull(),
    shareRateBasisPoints: integer("share_rate_basis_points").notNull(),
    shareAmountMinor: pgBigint("share_amount_minor", {
      mode: "bigint",
    }).notNull(),
    ruleVersion: text("rule_version").notNull(),
    status: text("status").notNull().default("pending"),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("partner_revenue_share_partner_period_idx").on(
      t.partnerOrganisationId,
      t.periodStart,
      t.periodEnd,
    ),
  ],
);

export const benchmarkConsents = pgTable(
  "benchmark_consents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    consentRecordId: uuid("consent_record_id")
      .notNull()
      .references(() => consentRecords.id, { onDelete: "restrict" }),
    scope: text("scope").notNull(),
    status: text("status").notNull().default("active"),
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("benchmark_consents_org_status_idx").on(t.organisationId, t.status),
  ],
);

export const benchmarkCohorts = pgTable(
  "benchmark_cohorts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cohortKey: text("cohort_key").notNull(),
    definitionVersion: integer("definition_version").notNull(),
    definition: text("definition").notNull(),
    minimumCohortSize: integer("minimum_cohort_size").notNull(),
    differencingControls: text("differencing_controls").notNull(),
    suppressionPolicy: text("suppression_policy").notNull(),
    status: text("status").notNull().default("draft"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("benchmark_cohorts_key_version_unique").on(
      t.cohortKey,
      t.definitionVersion,
    ),
  ],
);

export const benchmarkReleases = pgTable(
  "benchmark_releases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cohortId: uuid("cohort_id")
      .notNull()
      .references(() => benchmarkCohorts.id, { onDelete: "restrict" }),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    consentSnapshotHash: text("consent_snapshot_hash").notNull(),
    contributingOrganisationCount: integer(
      "contributing_organisation_count",
    ).notNull(),
    suppressed: boolean("suppressed").notNull().default(true),
    aggregatePayload: text("aggregate_payload"),
    disclosureReview: text("disclosure_review").notNull(),
    approvedByUserId: uuid("approved_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("benchmark_releases_cohort_period_unique").on(
      t.cohortId,
      t.periodStart,
      t.periodEnd,
    ),
  ],
);

export const outcomes = pgTable(
  "outcomes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    outcome: text("outcome").notNull(),
    capturedByUserId: uuid("captured_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    capturedAt: timestamp("captured_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    clientConfirmed: boolean("client_confirmed").notNull().default(false),
    debriefReference: text("debrief_reference"),
    reasons: text("reasons"),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("outcomes_project_unique").on(t.projectId)],
);

export const renewalMonitors = pgTable(
  "renewal_monitors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    vaultItemVersionId: uuid("vault_item_version_id")
      .notNull()
      .references(() => vaultItemVersions.id, { onDelete: "cascade" }),
    nextNotificationAt: timestamp("next_notification_at", {
      withTimezone: true,
    }).notNull(),
    cadenceDays: integer("cadence_days").notNull(),
    status: text("status").notNull().default("active"),
    lastNotificationEventId: uuid("last_notification_event_id").references(
      () => notificationEvents.id,
      { onDelete: "set null" },
    ),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("renewal_monitors_status_next_idx").on(
      t.status,
      t.nextNotificationAt,
    ),
  ],
);

export const auditAnchors = pgTable(
  "audit_anchors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    firstSequence: integer("first_sequence").notNull(),
    lastSequence: integer("last_sequence").notNull(),
    chainHeadHash: text("chain_head_hash").notNull(),
    provider: text("provider").notNull(),
    immutableObjectReference: text("immutable_object_reference").notNull(),
    receiptHash: text("receipt_hash").notNull(),
    receiptSignature: text("receipt_signature"),
    anchoredAt: timestamp("anchored_at", { withTimezone: true }).notNull(),
    verificationStatus: text("verification_status")
      .notNull()
      .default("pending"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("audit_anchors_provider_reference_unique").on(
      t.provider,
      t.immutableObjectReference,
    ),
    index("audit_anchors_organisation_sequence_idx").on(
      t.organisationId,
      t.lastSequence,
    ),
  ],
);
