import { test, describe, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { createRequire } from "node:module";
import type { Archiver, ArchiverOptions } from "archiver";
import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import JSZip from "jszip";
import { eq, sql } from "drizzle-orm";
import {
  db,
  pool,
  users,
  organisations,
  organisationMemberships,
  roleGrants,
  partnerRelationships,
  featureFlags,
  clients,
  projects,
  documents,
  requirements,
  evidenceItems,
  defects,
  boqChecks,
  auditEvents,
  reports,
  redTeamRuns,
  reviews,
  packages,
  packageVersions,
  packageManifestItems,
  withTenantDatabase,
} from "@workspace/db";
import reportsRouter from "./reports";
import {
  createDbOperationsSuiteGuards,
  createOperationsSuiteRouter,
} from "./operationsSuite";
import type { LocalUser } from "../middlewares/auth";
import {
  enforceTenantResourceBoundary,
  type AccessContext,
} from "../middlewares/tenancy";
import { attachTenantDatabase } from "../middlewares/databaseTenancy";
import {
  normalizeLegacyRole,
  partnerDerivedPermissionsForRoles,
  permissionsForRoles,
} from "../lib/permissions";
import { DrizzleOperationsSuiteStore } from "../lib/operationsSuite/drizzleStore";
import { ObjectStorageService } from "../lib/objectStorage";
import { writeAudit } from "../lib/audit";
import { DOCX_MIME } from "../lib/docx";
import { PDF_MIME } from "../lib/pdf";
import {
  ENGINE_VERSION,
  MODEL_ID,
  PROMPT_PACK_VERSION,
  TAXONOMY_VERSION,
} from "../lib/provenance";
import { computeProjectExportManifestHash } from "../lib/projectExportPackage";
import {
  computeCurrentDeliveryStudioSourceSnapshotHash,
  isAttestedRedTeamApproval,
  loadRedTeamApprovalAttestation,
} from "../lib/deliveryStudio/drizzleRepository";

const nodeRequire = createRequire(import.meta.url);
const { ZipArchive } = nodeRequire("archiver") as {
  ZipArchive: new (options?: ArchiverOptions) => Archiver;
};

/**
 * End-to-end proof that the real exact-confirmation
 * `POST /projects/:id/export` HTTP route can't leak or corrupt findings.
 * Unlike the unit tests in `reports.test.ts` (which only exercise the
 * extracted `review_state` helpers), this test seeds a live database, drives
 * the actual Express handler over HTTP, unzips the streamed archiver response
 * in memory, and asserts the bytes of every CSV. It also covers
 * export-permission auth, idempotency, and the project.status -> "exported"
 * transition, so a refactor that reorders columns, drops a CSV, or breaks the
 * confirmation wiring is caught.
 */

// The middleware-injected user for the current request (swapped per test to
// exercise allowed and denied permissions without a real Clerk session).
let currentUser: LocalUser | null = null;

let server: Server;
let baseUrl: string;

// Seeded identifiers, captured so we can assert per-row review_state.
let clientId: string;
let projectId: string;
let adminId: string;
let generatorId: string;
let organisationId: string;
let adminMembershipId: string;
let adminRoleGrantId: string;
let signedReportId: string;
let draftReportId: string;
let partnerUserId: string;
let partnerOrganisationId: string;
let partnerMembershipId: string;
let partnerRelationshipId: string;
let currentAccessContext: AccessContext | null = null;

// The bytes an object-storage download() is faked to return for the signed
// report's .docx, so we can assert the exact payload lands in the ZIP / stream
// without touching real object storage.
const FAKE_DOCX_BYTES = Buffer.from(
  "PK\u0003\u0004 bidbox signed report .docx payload",
  "utf8",
);
const unavailableObjectPaths = new Set<string>();
let signedReportDownloadBarrier: {
  entered: () => void;
  release: Promise<void>;
} | null = null;
const seeded = {
  reqs: [] as { id: string; reviewStatus: string; expected: string }[],
  evidence: [] as { id: string; suggested: boolean; expected: string }[],
  defects: [] as { id: string; suggested: boolean; expected: string }[],
};

/** Parse a CSV string into headers + row objects, honouring quoted fields. */
function parseCsv(csv: string): {
  headers: string[];
  rows: Record<string, string>[];
} {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (inQuotes) {
      if (c === '"') {
        if (csv[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      record.push(field);
      field = "";
    } else if (c === "\n") {
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else if (c === "\r") {
      // skip
    } else {
      field += c;
    }
  }
  if (field.length > 0 || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  const headers = records[0] ?? [];
  const rows = records
    .slice(1)
    .map((cells) => Object.fromEntries(headers.map((h, i) => [h, cells[i]])));
  return { headers, rows };
}

async function matchingAuditEventCount(
  eventType: string,
  objectId: string,
): Promise<number> {
  const events = await db
    .select({
      eventType: auditEvents.eventType,
      objectId: auditEvents.objectId,
    })
    .from(auditEvents)
    .where(eq(auditEvents.projectId, projectId));

  return events.filter(
    (event) => event.eventType === eventType && event.objectId === objectId,
  ).length;
}

async function waitForAuditEventCount(
  eventType: string,
  objectId: string,
  minimumCount: number,
): Promise<void> {
  const deadline = Date.now() + 2_000;

  while (Date.now() < deadline) {
    if ((await matchingAuditEventCount(eventType, objectId)) >= minimumCount) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  assert.fail(
    `${eventType} audit event for ${objectId} was not committed within 2 seconds`,
  );
}

const membershipAdministrationLockKey = () =>
  `valo.membership-administration:${organisationId}`;

async function waitingAdvisoryLockCount(): Promise<number> {
  const result = await pool.query<{ count: number }>(
    `
      WITH target AS (
        SELECT hashtextextended($1, 0)::bigint AS lock_key
      )
      SELECT count(*)::integer AS count
      FROM pg_catalog.pg_locks AS held
      CROSS JOIN target
      WHERE held.locktype = 'advisory'
        AND held.objsubid = 1
        AND held.classid::bigint = ((target.lock_key >> 32) & 4294967295)
        AND held.objid::bigint = (target.lock_key & 4294967295)
        AND NOT held.granted
    `,
    [membershipAdministrationLockKey()],
  );
  return result.rows[0]?.count ?? 0;
}

async function waitForCondition(
  condition: () => Promise<boolean>,
  failureMessage: string,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(failureMessage);
}

function requestReportSignOff(): Promise<globalThis.Response> {
  return fetch(`${baseUrl}/reports/${signedReportId}/sign-off`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      attestation:
        "I reviewed the release evidence and approve this report for sign-off.",
    }),
  });
}

type ExactExportBody = {
  reportId: string;
  reportVersion: number;
  packageVersionId: string | null;
  packageVersionNumber: number | null;
  packageManifestSha256: string | null;
  packageSourceSnapshotSha256: string | null;
};

type ExactExportConfirmation = {
  projectId: string;
  exportScopeSha256: string;
  body: ExactExportBody;
};

async function readExactExportConfirmation(
  targetProjectId = projectId,
): Promise<ExactExportConfirmation> {
  const [reportsResponse, packageVersionsResponse] = await Promise.all([
    fetch(`${baseUrl}/projects/${targetProjectId}/reports`),
    fetch(`${baseUrl}/projects/${targetProjectId}/package-versions`),
  ]);
  assert.equal(reportsResponse.status, 200);
  assert.equal(packageVersionsResponse.status, 200);

  const reportRows = (await reportsResponse.json()) as Array<{
    id: string;
    version: number;
    status: string;
  }>;
  const latestReport = reportRows[0];
  assert.ok(latestReport, "exact export confirmation requires a latest report");

  const packageProjection = (await packageVersionsResponse.json()) as {
    items: Array<{
      packageVersionId: string;
      versionNumber: number;
      manifestSha256: string;
      sourceSnapshotSha256: string;
    }>;
    exportScopeSha256: string;
  };
  assert.match(packageProjection.exportScopeSha256, /^[a-f0-9]{64}$/u);
  assert.ok(
    packageProjection.items.length <= 1,
    "only the canonical package version may be confirmed",
  );
  const currentPackage = packageProjection.items[0];

  return {
    projectId: targetProjectId,
    exportScopeSha256: packageProjection.exportScopeSha256,
    body: {
      reportId: latestReport.id,
      reportVersion: latestReport.version,
      packageVersionId: currentPackage?.packageVersionId ?? null,
      packageVersionNumber: currentPackage?.versionNumber ?? null,
      packageManifestSha256: currentPackage?.manifestSha256 ?? null,
      packageSourceSnapshotSha256: currentPackage?.sourceSnapshotSha256 ?? null,
    },
  };
}

async function postConfirmedProjectExport(
  options: {
    targetProjectId?: string;
    confirmation?: ExactExportConfirmation;
    idempotencyKey?: string;
    ifMatch?: string;
    body?: unknown;
  } = {},
): Promise<globalThis.Response> {
  const targetProjectId =
    options.targetProjectId ?? options.confirmation?.projectId ?? projectId;
  const confirmation =
    options.confirmation ??
    (await readExactExportConfirmation(targetProjectId));

  return fetch(`${baseUrl}/projects/${targetProjectId}/export`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": options.idempotencyKey ?? randomUUID(),
      "if-match": options.ifMatch ?? `"${confirmation.exportScopeSha256}"`,
    },
    body: JSON.stringify(options.body ?? confirmation.body),
  });
}

async function durableExportState(): Promise<{
  projectStatus: string | undefined;
  projectVersion: number | undefined;
  packageVersionIds: string[];
  releaseEvidenceIds: string[];
}> {
  const [project] = await db
    .select({ status: projects.status, version: projects.version })
    .from(projects)
    .where(eq(projects.id, projectId));
  const packageVersionIds = (
    await db
      .select({ id: packageVersions.id })
      .from(packageVersions)
      .innerJoin(packages, eq(packageVersions.packageId, packages.id))
      .where(eq(packages.projectId, projectId))
  )
    .map((row) => row.id)
    .sort();
  const releaseEvidenceIds = (
    await db
      .select({
        id: auditEvents.id,
        eventType: auditEvents.eventType,
      })
      .from(auditEvents)
      .where(eq(auditEvents.projectId, projectId))
  )
    .filter(
      (event) =>
        event.eventType === "project.exported" ||
        event.eventType.startsWith("package.project_export_version_"),
    )
    .map((event) => event.id)
    .sort();

  return {
    projectStatus: project?.status,
    projectVersion: project?.version,
    packageVersionIds,
    releaseEvidenceIds,
  };
}

async function readExportReceipt(idempotencyKey: string): Promise<{
  packageVersionId: string;
  packageVersionNumber: number;
  packageManifestSha256: string;
  packageSourceSnapshotSha256: string;
}> {
  const receiptObjectId = createHash("sha256")
    .update(`${organisationId}\u0000${idempotencyKey}`, "utf8")
    .digest("hex");
  const receipts = (
    await db
      .select({
        eventType: auditEvents.eventType,
        objectType: auditEvents.objectType,
        objectId: auditEvents.objectId,
        details: auditEvents.details,
      })
      .from(auditEvents)
      .where(eq(auditEvents.projectId, projectId))
  ).filter(
    (event) =>
      event.eventType === "project.exported" &&
      event.objectType === "project_export_request" &&
      event.objectId === receiptObjectId,
  );
  assert.equal(receipts.length, 1);
  const receipt = JSON.parse(receipts[0]!.details ?? "null") as {
    packageVersionId?: string;
    packageVersionNumber?: number;
    packageManifestSha256?: string;
    packageSourceSnapshotSha256?: string;
  } | null;
  assert.equal(typeof receipt?.packageVersionId, "string");
  assert.equal(typeof receipt?.packageVersionNumber, "number");
  assert.equal(typeof receipt?.packageManifestSha256, "string");
  assert.equal(typeof receipt?.packageSourceSnapshotSha256, "string");
  return receipt as {
    packageVersionId: string;
    packageVersionNumber: number;
    packageManifestSha256: string;
    packageSourceSnapshotSha256: string;
  };
}

before(async () => {
  const stamp = new Date().toISOString();
  assert.equal(
    permissionsForRoles(["contributor"]).has("report:export"),
    false,
  );
  assert.equal(
    permissionsForRoles(["client_organisation_owner"]).has("report:export"),
    true,
  );

  const [admin] = await db
    .insert(users)
    .values({
      clerkUserId: `__export_it_admin__${stamp}`,
      email: `admin-${stamp}@export-it.local`,
      name: "Export Admin",
      role: "admin",
      status: "active",
    })
    .returning();
  adminId = admin.id;

  const [generator] = await db
    .insert(users)
    .values({
      clerkUserId: `__export_it_generator__${stamp}`,
      email: `generator-${stamp}@export-it.local`,
      name: "Report Generator",
      role: "analyst",
      status: "active",
    })
    .returning();
  generatorId = generator.id;

  const [organisation] = await db
    .insert(organisations)
    .values({
      name: `__EXPORT_IT_ORG__ ${stamp}`,
      slug: `export-it-${Date.now()}`,
      type: "client",
    })
    .returning();
  organisationId = organisation.id;

  const [adminMembership] = await db
    .insert(organisationMemberships)
    .values({ organisationId, userId: adminId, status: "active" })
    .returning();
  adminMembershipId = adminMembership.id;
  const [adminRoleGrant] = await db
    .insert(roleGrants)
    .values({
      membershipId: adminMembershipId,
      role: "client_organisation_owner",
    })
    .returning();
  adminRoleGrantId = adminRoleGrant.id;

  const [partnerUser] = await db
    .insert(users)
    .values({
      clerkUserId: `__export_it_partner__${stamp}`,
      email: `partner-${stamp}@export-it.local`,
      name: "Export Partner",
      role: "partner_reviewer",
      status: "active",
    })
    .returning();
  partnerUserId = partnerUser.id;
  const [partnerOrganisation] = await db
    .insert(organisations)
    .values({
      name: `__EXPORT_IT_PARTNER__ ${stamp}`,
      slug: `export-it-partner-${Date.now()}`,
      type: "consultancy_partner",
    })
    .returning();
  partnerOrganisationId = partnerOrganisation.id;
  const [partnerMembership] = await db
    .insert(organisationMemberships)
    .values({
      organisationId: partnerOrganisationId,
      userId: partnerUserId,
      status: "active",
    })
    .returning();
  partnerMembershipId = partnerMembership.id;
  await db.insert(roleGrants).values({
    membershipId: partnerMembershipId,
    role: "consultancy_partner_analyst_reviewer",
  });
  const [partnerRelationship] = await db
    .insert(partnerRelationships)
    .values({
      partnerOrganisationId,
      clientOrganisationId: organisationId,
      status: "active",
      accessStartsAt: new Date(),
      approvedByMembershipId: adminMembershipId,
    })
    .returning();
  partnerRelationshipId = partnerRelationship.id;
  await withTenantDatabase(organisationId, () =>
    db.insert(featureFlags).values({
      organisationId,
      key: "partner_edition",
      enabled: true,
      commercialGate: "approved:export-integration-test",
      updatedByUserId: adminId,
    }),
  );

  const [client] = await db
    .insert(clients)
    .values({
      name: `__EXPORT_IT__ ${stamp}`,
      organisationId,
      ndaStatus: "signed",
    })
    .returning();
  clientId = client.id;

  const [project] = await db
    .insert(projects)
    .values({
      clientId: client.id,
      organisationId,
      tenderTitle: "Export Integration VMT-2026-999",
      status: "reporting",
      reviewerId: admin.id,
      paymentStatus: "not_required",
      conflictStatus: "clear",
      physicalArchiveInstruction:
        "Return all hard copies to client within 7 days",
    })
    .returning();
  projectId = project.id;

  const [doc] = await db
    .insert(documents)
    .values({
      organisationId,
      projectId: project.id,
      type: "tender",
      filename: "tender.txt",
      objectPath: "export-it/tender.txt",
      sha256: "a".repeat(64),
      redactionStatus: "included",
      extractionStatus: "extracted",
      contentText: [
        'Quote with, comma and "quotes"',
        "B-BBEE certificate is not applicable for this procurement.",
        "Bid bond evidence is attached.",
      ].join("\n"),
    })
    .returning();

  await db.insert(documents).values({
    organisationId,
    projectId: project.id,
    type: "bid",
    filename: "bid.txt",
    objectPath: "export-it/bid.txt",
    sha256: "b".repeat(64),
    redactionStatus: "included",
    extractionStatus: "extracted",
  });

  // Requirements: reviewed states only; an unreviewed suggestion would block
  // the package before any bytes are streamed.
  const reqRows = await db
    .insert(requirements)
    .values([
      {
        organisationId,
        projectId: project.id,
        sourceDocId: doc.id,
        pageRef: "1",
        text: "Tax clearance certificate",
        reviewStatus: "confirmed",
      },
      {
        organisationId,
        projectId: project.id,
        sourceDocId: doc.id,
        clauseRef: "2.1",
        text: "B-BBEE certificate, with a comma",
        reviewStatus: "edited",
      },
      {
        organisationId,
        projectId: project.id,
        sourceDocId: doc.id,
        pageRef: "3",
        text: "Bid bond",
        reviewStatus: "confirmed",
      },
      {
        organisationId,
        projectId: project.id,
        sourceDocId: doc.id,
        text: "Reference letters",
        reviewStatus: "rejected",
      },
    ])
    .returning();
  seeded.reqs = reqRows.map((r) => ({
    id: r.id,
    reviewStatus: r.reviewStatus,
    expected: r.reviewStatus === "suggested" ? "suggested" : "confirmed",
  }));

  // Evidence is reviewer-confirmed and resolves every mandatory requirement.
  const evRows = await db
    .insert(evidenceItems)
    .values([
      {
        organisationId,
        projectId: project.id,
        requirementId: reqRows[0].id,
        evidenceStatus: "present",
        excerpt: 'Quote with, comma and "quotes"',
        documentId: doc.id,
        suggested: false,
      },
      {
        organisationId,
        projectId: project.id,
        requirementId: reqRows[1].id,
        evidenceStatus: "not_applicable",
        excerpt: "B-BBEE certificate is not applicable for this procurement.",
        documentId: doc.id,
        suggested: false,
      },
      {
        organisationId,
        projectId: project.id,
        requirementId: reqRows[2].id,
        evidenceStatus: "present",
        excerpt: "Bid bond evidence is attached.",
        documentId: doc.id,
        suggested: false,
      },
    ])
    .returning();
  seeded.evidence = evRows.map((e) => ({
    id: e.id,
    suggested: e.suggested,
    expected: e.suggested ? "suggested" : "confirmed",
  }));

  // Defects are reviewer-owned; the fatal item is resolved before release.
  const defRows = await db
    .insert(defects)
    .values([
      {
        organisationId,
        projectId: project.id,
        requirementId: reqRows[1].id,
        type: "missing_document",
        severity: "fatal",
        description: "Missing B-BBEE",
        status: "resolved",
        suggested: false,
      },
      {
        organisationId,
        projectId: project.id,
        requirementId: reqRows[0].id,
        type: "other",
        severity: "scoring_risk",
        description: "Late submission",
        status: "open",
        suggested: false,
      },
    ])
    .returning();
  seeded.defects = defRows.map((d) => ({
    id: d.id,
    suggested: d.suggested,
    expected: d.suggested ? "suggested" : "confirmed",
  }));

  await db.insert(boqChecks).values({
    organisationId,
    projectId: project.id,
    sourceDocId: doc.id,
    lineRef: "1.1",
    description: "Excavation",
    checkType: "extension",
    finding: "Extension mismatch",
    status: "resolved",
  });

  await writeAudit({
    organisationId,
    projectId: project.id,
    eventType: "project.created",
    objectType: "project",
    objectId: project.id,
    details: "seeded audit event",
  });

  const sourceSnapshotHash = await withTenantDatabase(organisationId, () =>
    computeCurrentDeliveryStudioSourceSnapshotHash(organisationId, project.id),
  );
  assert.ok(sourceSnapshotHash, "seeded project must have a current source");

  const approvedAt = new Date();
  const approvalProjectVersion = project.version + 1;
  const approvalAttestation =
    "I independently reviewed the current response source and approve this red-team run for governed export testing.";
  const [redTeamRun] = await db
    .insert(redTeamRuns)
    .values({
      organisationId,
      projectId: project.id,
      sourceSnapshotHash,
      policyVersion: "test-policy-v1",
      status: "approved",
      initiatedByUserId: generatorId,
      approvedByUserId: adminId,
      approvedAt,
      createdAt: approvedAt,
      updatedAt: approvedAt,
    })
    .returning();
  assert.ok(redTeamRun, "seeded red-team run must be stored");

  await db.insert(reviews).values({
    organisationId,
    projectId: project.id,
    reviewType: "delivery_studio_action_receipt",
    objectType: "red_team_run",
    objectId: redTeamRun.id,
    reviewerUserId: adminId,
    status: "completed",
    findings: JSON.stringify({
      schema: "valo.delivery-studio-receipt/v1",
      requestDigest: createHash("sha256")
        .update(
          `approve_red_team:${redTeamRun.id}:${sourceSnapshotHash}`,
          "utf8",
        )
        .digest("hex"),
      action: "approve_red_team",
      projectVersion: approvalProjectVersion,
      sourceSnapshotHash,
      attestation: approvalAttestation,
    }),
    sourceVersion: approvalProjectVersion,
    completedAt: approvedAt,
    createdAt: approvedAt,
    updatedAt: approvedAt,
  });

  const storedAttestation = await withTenantDatabase(organisationId, () =>
    loadRedTeamApprovalAttestation(db, {
      organisationId,
      projectId: project.id,
      runId: redTeamRun.id,
      approvedByUserId: adminId,
      approvedAt,
    }),
  );
  assert.equal(storedAttestation, approvalAttestation);
  assert.equal(
    isAttestedRedTeamApproval({
      runStatus: redTeamRun.status,
      sourceSnapshotMatches:
        redTeamRun.sourceSnapshotHash === sourceSnapshotHash,
      initiatedByUserId: redTeamRun.initiatedByUserId,
      approvedByUserId: redTeamRun.approvedByUserId,
      approvedAt: redTeamRun.approvedAt,
      approvalAttestation: storedAttestation,
      openFindingCount: 0,
    }),
    true,
  );

  await db
    .update(projects)
    .set({
      version: approvalProjectVersion,
      updatedAt: approvedAt,
    })
    .where(eq(projects.id, project.id));

  const [draft] = await db
    .insert(reports)
    .values({
      organisationId,
      projectId: project.id,
      version: 1,
      status: "draft",
      docxPath: "/objects/uploads/draft-report-v1",
      pdfPath: "/objects/uploads/draft-report-v1-pdf",
      generatedBy: generatorId,
      engineVersion: ENGINE_VERSION,
      promptPackVersion: PROMPT_PACK_VERSION,
      modelId: MODEL_ID,
      taxonomyVersion: TAXONOMY_VERSION,
    })
    .returning();
  draftReportId = draft.id;

  const [signed] = await db
    .insert(reports)
    .values({
      organisationId,
      projectId: project.id,
      version: 2,
      status: "draft",
      docxPath: "/objects/uploads/signed-report-v2",
      pdfPath: "/objects/uploads/signed-report-v2-pdf",
      generatedBy: generatorId,
      engineVersion: ENGINE_VERSION,
      promptPackVersion: PROMPT_PACK_VERSION,
      modelId: MODEL_ID,
      taxonomyVersion: TAXONOMY_VERSION,
    })
    .returning();
  signedReportId = signed.id;

  const currentSourceSnapshotHash = await withTenantDatabase(
    organisationId,
    () =>
      computeCurrentDeliveryStudioSourceSnapshotHash(
        organisationId,
        project.id,
      ),
  );
  assert.equal(currentSourceSnapshotHash, sourceSnapshotHash);

  mock.method(
    ObjectStorageService.prototype,
    "getObjectEntityFile",
    async (objectPath: string) => {
      if (unavailableObjectPaths.has(objectPath)) {
        throw new Error("simulated unavailable governed report artefact");
      }
      if (
        objectPath === "/objects/uploads/signed-report-v2" &&
        signedReportDownloadBarrier
      ) {
        const barrier = signedReportDownloadBarrier;
        signedReportDownloadBarrier = null;
        barrier.entered();
        await barrier.release;
      }
      return {
        download: async () => [FAKE_DOCX_BYTES],
      } as unknown as Awaited<
        ReturnType<ObjectStorageService["getObjectEntityFile"]>
      >;
    },
  );

  const app = express();
  app.use(express.json());
  // Stub a direct tenant membership and logger around the real RLS transaction
  // middleware. Route permissions still derive from the selected role.
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as { localUser: LocalUser | null }).localUser = currentUser;
    const role = currentUser ? normalizeLegacyRole(currentUser.role) : null;
    if (currentAccessContext) {
      (req as Request & { accessContext?: AccessContext }).accessContext =
        currentAccessContext;
    } else if (role) {
      (req as Request & { accessContext?: AccessContext }).accessContext = {
        organisationId,
        membershipId:
          currentUser!.id === adminId ? adminMembershipId : currentUser!.id,
        membershipOrganisationId: organisationId,
        source: "membership",
        roles: [role],
        permissions: permissionsForRoles([role]),
        breakGlassSessionId: null,
        partnerRelationshipId: null,
        partnerCoSigningRequired: false,
      };
    }
    (req as unknown as { log: unknown }).log = {
      error() {},
      warn() {},
      info() {},
      debug() {},
    };
    next();
  });
  app.use(attachTenantDatabase);
  app.use(enforceTenantResourceBoundary);
  app.use(reportsRouter);
  const operationsSuiteGuards = createDbOperationsSuiteGuards();
  app.use(
    createOperationsSuiteRouter({
      projectGuard: operationsSuiteGuards.projectGuard,
      references: operationsSuiteGuards.references,
      store: new DrizzleOperationsSuiteStore(),
    }),
  );

  await new Promise<void>((resolve) => {
    server = createServer(app);
    server.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

after(async () => {
  mock.restoreAll();
  if (server)
    await new Promise<void>((resolve) => server.close(() => resolve()));
  if (projectId) {
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT set_config('valo.audit_test_cleanup', 'approved', true)`,
      );
      await tx.delete(auditEvents).where(eq(auditEvents.projectId, projectId));
    });
  }
  if (clientId) await db.delete(clients).where(eq(clients.id, clientId));
  if (partnerUserId) await db.delete(users).where(eq(users.id, partnerUserId));
  if (partnerOrganisationId)
    await db
      .delete(organisations)
      .where(eq(organisations.id, partnerOrganisationId));
  if (adminId) await db.delete(users).where(eq(users.id, adminId));
  if (generatorId) await db.delete(users).where(eq(users.id, generatorId));
  if (organisationId)
    await db.delete(organisations).where(eq(organisations.id, organisationId));
  await pool.end();
});

describe("POST /projects/:id/export exact confirmation (live route)", () => {
  test("a concurrent grant revocation that commits first returns 403 without signing", async () => {
    const revoker = await pool.connect();
    let signOffRequest: Promise<globalThis.Response> | undefined;
    try {
      await revoker.query("BEGIN");
      await revoker.query(
        "SELECT valo_security.set_current_organisation_id($1::uuid)",
        [organisationId],
      );
      await revoker.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [membershipAdministrationLockKey()],
      );
      const revoked = await revoker.query(
        "UPDATE public.role_grants SET revoked_at = clock_timestamp(), revocation_reason = 'concurrency test' WHERE id = $1::uuid",
        [adminRoleGrantId],
      );
      assert.equal(revoked.rowCount, 1);

      const waitingBefore = await waitingAdvisoryLockCount();
      currentUser = {
        id: adminId,
        role: "client_organisation_owner",
        name: "Export Approver",
      } as LocalUser;
      signOffRequest = requestReportSignOff();
      await waitForCondition(
        async () => (await waitingAdvisoryLockCount()) > waitingBefore,
        "sign-off did not wait behind the concurrent grant revocation",
      );
      await revoker.query("COMMIT");

      const response = await signOffRequest;
      assert.equal(response.status, 403);
      assert.match(
        ((await response.json()) as { error: string }).error,
        /authority changed/i,
      );
      const [currentReport] = await db
        .select({ status: reports.status })
        .from(reports)
        .where(eq(reports.id, signedReportId));
      const [currentProject] = await db
        .select({ status: projects.status })
        .from(projects)
        .where(eq(projects.id, projectId));
      assert.equal(currentReport?.status, "draft");
      assert.equal(currentProject?.status, "reporting");
      assert.equal(
        await matchingAuditEventCount("report.signed_off", signedReportId),
        0,
      );
    } finally {
      await revoker.query("ROLLBACK").catch(() => undefined);
      if (signOffRequest) await signOffRequest.catch(() => undefined);
      await db
        .update(roleGrants)
        .set({ revokedAt: null, revocationReason: null })
        .where(eq(roleGrants.id, adminRoleGrantId));
      currentUser = null;
      revoker.release();
    }
  });

  test("sign-off that holds authority first commits before membership revocation", async () => {
    const projectBlocker = await pool.connect();
    const revoker = await pool.connect();
    const lockProbe = await pool.connect();
    let signOffRequest: Promise<globalThis.Response> | undefined;
    let revocationWork: Promise<void> | undefined;
    try {
      await projectBlocker.query("BEGIN");
      await projectBlocker.query(
        "SELECT valo_security.set_current_organisation_id($1::uuid)",
        [organisationId],
      );
      const lockedProject = await projectBlocker.query(
        "SELECT id FROM public.projects WHERE id = $1::uuid FOR UPDATE",
        [projectId],
      );
      assert.equal(lockedProject.rowCount, 1);

      currentUser = {
        id: adminId,
        role: "client_organisation_owner",
        name: "Export Approver",
      } as LocalUser;
      signOffRequest = requestReportSignOff();

      await waitForCondition(async () => {
        const result = await lockProbe.query<{ acquired: boolean }>(
          "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired",
          [membershipAdministrationLockKey()],
        );
        if (!result.rows[0]?.acquired) return true;
        await lockProbe.query(
          "SELECT pg_advisory_unlock(hashtextextended($1, 0))",
          [membershipAdministrationLockKey()],
        );
        return false;
      }, "sign-off did not acquire the membership authority lock");

      const waitingBefore = await waitingAdvisoryLockCount();
      await revoker.query("BEGIN");
      await revoker.query(
        "SELECT valo_security.set_current_organisation_id($1::uuid)",
        [organisationId],
      );
      revocationWork = (async () => {
        await revoker.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
          [membershipAdministrationLockKey()],
        );
        const revoked = await revoker.query(
          "UPDATE public.organisation_memberships SET status = 'suspended', version = version + 1, updated_at = clock_timestamp() WHERE id = $1::uuid",
          [adminMembershipId],
        );
        assert.equal(revoked.rowCount, 1);
        await revoker.query("COMMIT");
      })();
      void revocationWork.catch(() => undefined);
      await waitForCondition(
        async () => (await waitingAdvisoryLockCount()) > waitingBefore,
        "membership revocation did not wait behind report sign-off",
      );

      await projectBlocker.query("COMMIT");
      const response = await signOffRequest;
      assert.equal(response.status, 200);
      assert.equal(
        ((await response.json()) as { status: string }).status,
        "signed_off",
      );
      await revocationWork;

      const [currentReport] = await db
        .select({ status: reports.status })
        .from(reports)
        .where(eq(reports.id, signedReportId));
      const [currentProject] = await db
        .select({ status: projects.status })
        .from(projects)
        .where(eq(projects.id, projectId));
      const [currentMembership] = await db
        .select({ status: organisationMemberships.status })
        .from(organisationMemberships)
        .where(eq(organisationMemberships.id, adminMembershipId));
      assert.equal(currentReport?.status, "signed_off");
      assert.equal(currentProject?.status, "signed_off");
      assert.equal(currentMembership?.status, "suspended");
      assert.equal(
        await matchingAuditEventCount("report.signed_off", signedReportId),
        1,
      );
    } finally {
      await projectBlocker.query("ROLLBACK").catch(() => undefined);
      await revoker.query("ROLLBACK").catch(() => undefined);
      if (signOffRequest) await signOffRequest.catch(() => undefined);
      if (revocationWork) await revocationWork.catch(() => undefined);
      await db
        .update(organisationMemberships)
        .set({ status: "active", updatedAt: new Date() })
        .where(eq(organisationMemberships.id, adminMembershipId));
      currentUser = null;
      lockProbe.release();
      revoker.release();
      projectBlocker.release();
    }
  });

  test("missing or malformed exact confirmation is rejected with 400", async () => {
    currentUser = {
      id: adminId,
      role: "client_organisation_owner",
      name: "Export Approver",
    } as LocalUser;
    try {
      const missing = await fetch(`${baseUrl}/projects/${projectId}/export`, {
        method: "POST",
      });
      assert.equal(missing.status, 400);
      assert.deepEqual(await missing.json(), {
        error: "Invalid exact export confirmation",
      });

      const confirmation = await readExactExportConfirmation();
      const malformed = await postConfirmedProjectExport({
        confirmation,
        idempotencyKey: "not-a-uuid",
        ifMatch: "not-a-quoted-sha256",
      });
      assert.equal(malformed.status, 400);
      assert.deepEqual(await malformed.json(), {
        error: "Invalid exact export confirmation",
      });
    } finally {
      currentUser = null;
    }
  });

  test("a stale confirmed export scope is rejected with 409", async () => {
    currentUser = {
      id: adminId,
      role: "client_organisation_owner",
      name: "Export Approver",
    } as LocalUser;
    try {
      const confirmation = await readExactExportConfirmation();
      const response = await postConfirmedProjectExport({
        confirmation,
        ifMatch: `"${"0".repeat(64)}"`,
      });
      assert.equal(response.status, 409);
      assert.match(
        ((await response.json()) as { error: string }).error,
        /confirmed report, package provenance or source material changed/i,
      );
    } finally {
      currentUser = null;
    }
  });

  test("members without report:export are denied", async () => {
    currentUser = {
      id: adminId,
      role: "client_organisation_owner",
      name: "Export Approver",
    } as LocalUser;
    const confirmation = await readExactExportConfirmation();
    currentUser = { id: generatorId, role: "contributor" } as LocalUser;
    try {
      const res = await postConfirmedProjectExport({ confirmation });
      assert.equal(res.status, 403);
    } finally {
      currentUser = null;
    }
  });

  test("a signed-off project without a physical-archive instruction is denied export (409)", async () => {
    const stamp = new Date().toISOString();
    const [gated] = await db
      .insert(projects)
      .values({
        organisationId,
        clientId,
        tenderTitle: `Export archive-gate ${stamp}`,
        status: "signed_off",
        reviewerId: adminId,
        paymentStatus: "not_required",
        conflictStatus: "clear",
      })
      .returning();
    await db.insert(reports).values({
      organisationId,
      projectId: gated.id,
      version: 1,
      status: "signed_off",
      docxPath: "/objects/uploads/archive-gate-report",
      generatedBy: generatorId,
      reviewerId: adminId,
      reviewerName: "Export Admin",
      signedOffAt: new Date(),
      engineVersion: ENGINE_VERSION,
      promptPackVersion: PROMPT_PACK_VERSION,
      modelId: MODEL_ID,
      taxonomyVersion: TAXONOMY_VERSION,
    });
    try {
      currentUser = {
        id: adminId,
        role: "client_organisation_owner",
        name: "Export Approver",
      } as LocalUser;
      const confirmation = await readExactExportConfirmation(gated.id);
      const res = await postConfirmedProjectExport({ confirmation });
      assert.equal(res.status, 409);
    } finally {
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT set_config('valo.audit_test_cleanup', 'approved', true)`,
        );
        await tx.delete(auditEvents).where(eq(auditEvents.projectId, gated.id));
      });
      await db.delete(projects).where(eq(projects.id, gated.id));
      currentUser = null;
    }
  });

  test("an NDA revocation during artefact preparation denies export before package evidence or ZIP bytes", async () => {
    let markDownloadStarted!: () => void;
    let releaseDownload!: () => void;
    const downloadStarted = new Promise<void>((resolve) => {
      markDownloadStarted = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseDownload = resolve;
    });
    signedReportDownloadBarrier = {
      entered: markDownloadStarted,
      release,
    };
    currentUser = {
      id: adminId,
      role: "client_organisation_owner",
      name: "Export Approver",
    } as LocalUser;
    const confirmation = await readExactExportConfirmation();

    try {
      const responsePromise = postConfirmedProjectExport({ confirmation });
      await Promise.race([
        downloadStarted,
        new Promise<never>((_resolve, reject) =>
          setTimeout(
            () => reject(new Error("export did not reach artefact download")),
            10_000,
          ),
        ),
      ]);

      await db
        .update(clients)
        .set({
          ndaStatus: "declined",
          version: sql`${clients.version} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(clients.id, clientId));
      releaseDownload();

      const response = await responsePromise;
      assert.equal(response.status, 409);
      assert.deepEqual(await response.json(), {
        error:
          "Package export was denied because NDA approval changed. Refresh before retrying.",
        blockers: [
          {
            code: "nda_missing",
            message: "A current signed NDA is required for package export.",
          },
        ],
      });

      const projectPackages = await db
        .select({ id: packages.id })
        .from(packages)
        .where(eq(packages.projectId, projectId));
      assert.deepEqual(projectPackages, []);
      const [unchangedProject] = await db
        .select({ status: projects.status })
        .from(projects)
        .where(eq(projects.id, projectId));
      assert.equal(unchangedProject?.status, "signed_off");
    } finally {
      releaseDownload();
      signedReportDownloadBarrier = null;
      await db
        .update(clients)
        .set({
          ndaStatus: "signed",
          version: sql`${clients.version} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(clients.id, clientId));
      currentUser = null;
    }
  });

  test("a grant revocation during artefact preparation denies export before package evidence or ZIP bytes", async () => {
    let markDownloadStarted!: () => void;
    let releaseDownload!: () => void;
    const downloadStarted = new Promise<void>((resolve) => {
      markDownloadStarted = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseDownload = resolve;
    });
    signedReportDownloadBarrier = {
      entered: markDownloadStarted,
      release,
    };
    currentUser = {
      id: adminId,
      role: "client_organisation_owner",
      name: "Export Approver",
    } as LocalUser;
    const confirmation = await readExactExportConfirmation();
    const deniedBefore = await matchingAuditEventCount(
      "project.export_denied",
      projectId,
    );
    const exportedBefore = await matchingAuditEventCount(
      "project.exported",
      projectId,
    );

    try {
      const responsePromise = postConfirmedProjectExport({ confirmation });
      await Promise.race([
        downloadStarted,
        new Promise<never>((_resolve, reject) =>
          setTimeout(
            () => reject(new Error("export did not reach artefact download")),
            10_000,
          ),
        ),
      ]);

      await db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${membershipAdministrationLockKey()}, 0))`,
        );
        await tx
          .update(roleGrants)
          .set({
            revokedAt: new Date(),
            revocationReason: "package export concurrency test",
          })
          .where(eq(roleGrants.id, adminRoleGrantId));
      });
      releaseDownload();

      const response = await responsePromise;
      assert.equal(response.status, 403);
      assert.deepEqual(await response.json(), {
        error: "Package export authority changed. Refresh before retrying.",
      });
      await waitForAuditEventCount(
        "project.export_denied",
        projectId,
        deniedBefore + 1,
      );
      assert.equal(
        await matchingAuditEventCount("project.exported", projectId),
        exportedBefore,
      );
      const projectPackages = await db
        .select({ id: packages.id })
        .from(packages)
        .where(eq(packages.projectId, projectId));
      assert.deepEqual(projectPackages, []);
      const [unchangedProject] = await db
        .select({ status: projects.status })
        .from(projects)
        .where(eq(projects.id, projectId));
      assert.equal(unchangedProject?.status, "signed_off");
    } finally {
      releaseDownload();
      signedReportDownloadBarrier = null;
      await db
        .update(roleGrants)
        .set({ revokedAt: null, revocationReason: null })
        .where(eq(roleGrants.id, adminRoleGrantId));
      currentUser = null;
    }
  });

  test("an exact partner-relationship revocation during artefact preparation denies export before persistence or ZIP bytes", async () => {
    let markDownloadStarted!: () => void;
    let releaseDownload!: () => void;
    const downloadStarted = new Promise<void>((resolve) => {
      markDownloadStarted = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseDownload = resolve;
    });
    signedReportDownloadBarrier = {
      entered: markDownloadStarted,
      release,
    };
    currentUser = {
      id: partnerUserId,
      role: "partner_reviewer",
      name: "Export Partner",
    } as LocalUser;
    currentAccessContext = {
      organisationId,
      membershipId: partnerMembershipId,
      membershipOrganisationId: partnerOrganisationId,
      source: "partner",
      roles: ["consultancy_partner_analyst_reviewer"],
      permissions: partnerDerivedPermissionsForRoles([
        "consultancy_partner_analyst_reviewer",
      ]),
      breakGlassSessionId: null,
      partnerRelationshipId,
      partnerCoSigningRequired: false,
    };
    let exportRequest: Promise<globalThis.Response> | undefined;
    try {
      const confirmation = await readExactExportConfirmation();
      const durableBefore = await durableExportState();
      const deniedBefore = await matchingAuditEventCount(
        "project.export_denied",
        projectId,
      );
      exportRequest = postConfirmedProjectExport({ confirmation });
      await Promise.race([
        downloadStarted,
        new Promise<never>((_resolve, reject) =>
          setTimeout(
            () => reject(new Error("export did not reach artefact download")),
            10_000,
          ),
        ),
      ]);

      const revoked = await db
        .update(partnerRelationships)
        .set({
          status: "revoked",
          version: sql`${partnerRelationships.version} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(partnerRelationships.id, partnerRelationshipId))
        .returning({ id: partnerRelationships.id });
      assert.deepEqual(revoked, [{ id: partnerRelationshipId }]);
      releaseDownload();

      const response = await exportRequest;
      assert.equal(response.status, 403);
      assert.match(response.headers.get("content-type") ?? "", /json/iu);
      assert.deepEqual(await response.json(), {
        error: "Package export authority changed. Refresh before retrying.",
      });
      await waitForAuditEventCount(
        "project.export_denied",
        projectId,
        deniedBefore + 1,
      );
      assert.deepEqual(
        await durableExportState(),
        durableBefore,
        "relationship revocation creates no package, receipt, transition, or release evidence",
      );
    } finally {
      releaseDownload();
      if (exportRequest) await exportRequest.catch(() => undefined);
      signedReportDownloadBarrier = null;
      await db
        .update(partnerRelationships)
        .set({
          status: "active",
          version: sql`${partnerRelationships.version} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(partnerRelationships.id, partnerRelationshipId));
      currentAccessContext = null;
      currentUser = null;
    }
  });

  test("export holding current authority commits consistent ZIP evidence before grant revocation", async () => {
    const projectBlocker = await pool.connect();
    const revoker = await pool.connect();
    const lockProbe = await pool.connect();
    const idempotencyKey = randomUUID();
    let exportRequest: Promise<globalThis.Response> | undefined;
    let revocationWork: Promise<void> | undefined;
    let revocationCompleted = false;
    try {
      currentUser = {
        id: adminId,
        role: "client_organisation_owner",
        name: "Export Approver",
      } as LocalUser;
      const confirmation = await readExactExportConfirmation();

      await projectBlocker.query("BEGIN");
      await projectBlocker.query(
        "SELECT valo_security.set_current_organisation_id($1::uuid)",
        [organisationId],
      );
      const lockedProject = await projectBlocker.query(
        "SELECT id FROM public.projects WHERE id = $1::uuid FOR UPDATE",
        [projectId],
      );
      assert.equal(lockedProject.rowCount, 1);

      exportRequest = postConfirmedProjectExport({
        confirmation,
        idempotencyKey,
      });
      await waitForCondition(async () => {
        const result = await lockProbe.query<{ acquired: boolean }>(
          "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired",
          [membershipAdministrationLockKey()],
        );
        if (!result.rows[0]?.acquired) return true;
        await lockProbe.query(
          "SELECT pg_advisory_unlock(hashtextextended($1, 0))",
          [membershipAdministrationLockKey()],
        );
        return false;
      }, "package export did not acquire the membership authority lock");

      const waitingBefore = await waitingAdvisoryLockCount();
      await revoker.query("BEGIN");
      await revoker.query(
        "SELECT valo_security.set_current_organisation_id($1::uuid)",
        [organisationId],
      );
      revocationWork = (async () => {
        await revoker.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
          [membershipAdministrationLockKey()],
        );
        const revoked = await revoker.query(
          "UPDATE public.role_grants SET revoked_at = clock_timestamp(), revocation_reason = 'package export-first concurrency test' WHERE id = $1::uuid",
          [adminRoleGrantId],
        );
        assert.equal(revoked.rowCount, 1);
        await revoker.query("COMMIT");
        revocationCompleted = true;
      })();
      void revocationWork.catch(() => undefined);
      await waitForCondition(
        async () => (await waitingAdvisoryLockCount()) > waitingBefore,
        "grant revocation did not wait behind package export authority",
      );
      assert.equal(revocationCompleted, false);

      await projectBlocker.query("COMMIT");
      const response = await exportRequest;
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "application/zip");
      const bytes = Buffer.from(await response.arrayBuffer());
      await revocationWork;
      assert.equal(revocationCompleted, true);
      const receipt = await readExportReceipt(idempotencyKey);
      const [persistedVersion] = await db
        .select({
          id: packageVersions.id,
          versionNumber: packageVersions.versionNumber,
          manifestSha256: packageVersions.manifestHash,
          sourceSnapshotSha256: packageVersions.sourceSnapshotHash,
        })
        .from(packageVersions)
        .where(eq(packageVersions.id, receipt.packageVersionId));
      assert.deepEqual(persistedVersion, {
        id: receipt.packageVersionId,
        versionNumber: receipt.packageVersionNumber,
        manifestSha256: receipt.packageManifestSha256,
        sourceSnapshotSha256: receipt.packageSourceSnapshotSha256,
      });
      const zip = await JSZip.loadAsync(bytes);
      const reportBytes = await zip
        .file("bid-autopsy-report-v2.docx")!
        .async("nodebuffer");
      assert.ok(reportBytes.equals(FAKE_DOCX_BYTES));
      const [grant] = await db
        .select({ revokedAt: roleGrants.revokedAt })
        .from(roleGrants)
        .where(eq(roleGrants.id, adminRoleGrantId));
      assert.ok(grant?.revokedAt);
    } finally {
      await projectBlocker.query("ROLLBACK").catch(() => undefined);
      if (exportRequest) await exportRequest.catch(() => undefined);
      if (revocationWork) await revocationWork.catch(() => undefined);
      await revoker.query("ROLLBACK").catch(() => undefined);
      await db
        .update(roleGrants)
        .set({ revokedAt: null, revocationReason: null })
        .where(eq(roleGrants.id, adminRoleGrantId));
      currentAccessContext = null;
      currentUser = null;
      lockProbe.release();
      revoker.release();
      projectBlocker.release();
    }
  });

  test("authorised download yields a ZIP whose CSVs preserve seeded review_state", async () => {
    currentUser = {
      id: adminId,
      role: "client_organisation_owner",
      name: "Export Approver",
    } as LocalUser;
    const res = await postConfirmedProjectExport();
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/zip");

    const buffer = Buffer.from(await res.arrayBuffer());
    const zip = await JSZip.loadAsync(buffer);
    const files = Object.keys(zip.files).sort();

    // A release package is invalid without its latest governed report.
    assert.deepEqual(files, [
      "audit_events.csv",
      "audit_export_policy.json",
      "bid-autopsy-report-v2.docx",
      "boq_checks.csv",
      "defects.csv",
      "documents_manifest.csv",
      "evidence.csv",
      "project.json",
      "requirements.csv",
      "scorecard.json",
    ]);

    const read = async (name: string) => zip.file(name)!.async("string");

    // --- requirements.csv ---
    const reqCsv = parseCsv(await read("requirements.csv"));
    assert.ok(
      reqCsv.headers.includes("review_state"),
      "requirements review_state column",
    );
    assert.equal(reqCsv.rows.length, seeded.reqs.length);
    for (const s of seeded.reqs) {
      const row = reqCsv.rows.find((r) => r.id === s.id);
      assert.ok(row, `requirement ${s.id} present in CSV`);
      assert.equal(
        row!.review_state,
        s.expected,
        `requirement ${s.reviewStatus}`,
      );
    }
    assert.ok(
      reqCsv.rows.every((row) => row.review_state === "confirmed"),
      "the release gate prevents unreviewed suggestions entering the package",
    );

    // --- evidence.csv ---
    const evCsv = parseCsv(await read("evidence.csv"));
    assert.ok(evCsv.headers.includes("review_state"));
    assert.equal(evCsv.rows.length, seeded.evidence.length);
    for (const s of seeded.evidence) {
      const row = evCsv.rows.find((r) => r.id === s.id);
      assert.ok(row, `evidence ${s.id} present`);
      assert.equal(row!.review_state, s.expected);
    }

    // --- defects.csv ---
    const defCsv = parseCsv(await read("defects.csv"));
    assert.ok(defCsv.headers.includes("review_state"));
    assert.equal(defCsv.rows.length, seeded.defects.length);
    for (const s of seeded.defects) {
      const row = defCsv.rows.find((r) => r.id === s.id);
      assert.ok(row, `defect ${s.id} present`);
      assert.equal(row!.review_state, s.expected);
    }

    // --- boq_checks.csv + audit_events.csv are present and non-empty ---
    const boqCsv = parseCsv(await read("boq_checks.csv"));
    assert.ok(boqCsv.rows.some((r) => r.finding === "Extension mismatch"));
    const auditCsv = await read("audit_events.csv");
    assert.ok(auditCsv.includes("seeded audit event"));
    const auditPolicy = JSON.parse(await read("audit_export_policy.json"));
    assert.equal(auditPolicy.authoritativeTenantAuditRetained, true);
    assert.ok(auditPolicy.excludedEventTypes.includes("project.exported"));

    // --- project.json is valid and matches the seeded project ---
    const project = JSON.parse(await read("project.json"));
    assert.equal(project.id, projectId);
    assert.equal(project.status, "exported");
    const [persistedProject] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId));
    assert.equal(project.version, persistedProject.version);
    assert.equal(project.updatedAt, persistedProject.updatedAt.toISOString());

    currentUser = null;
  });

  test("exporting a signed-off project transitions status to 'exported'", async () => {
    // The previous test already exported; verify the persisted side effect.
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId));
    assert.equal(project.status, "exported");

    // And an audit trail of the export was recorded.
    const events = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.projectId, projectId));
    assert.ok(events.some((e) => e.eventType === "project.exported"));
  });

  test("the same idempotency key and exact body replay without duplicate durable effects", async () => {
    currentUser = {
      id: adminId,
      role: "client_organisation_owner",
      name: "Export Approver",
    } as LocalUser;
    try {
      const confirmation = await readExactExportConfirmation();
      const idempotencyKey = randomUUID();
      const firstResponse = await postConfirmedProjectExport({
        confirmation,
        idempotencyKey,
      });
      assert.equal(firstResponse.status, 200);
      const firstBytes = Buffer.from(await firstResponse.arrayBuffer());
      const afterFirst = await durableExportState();

      const replayResponse = await postConfirmedProjectExport({
        confirmation,
        idempotencyKey,
      });
      assert.equal(replayResponse.status, 200);
      const replayBytes = Buffer.from(await replayResponse.arrayBuffer());
      const [firstZip, replayZip] = await Promise.all([
        JSZip.loadAsync(firstBytes),
        JSZip.loadAsync(replayBytes),
      ]);
      const firstFilenames = Object.keys(firstZip.files).sort();
      assert.deepEqual(Object.keys(replayZip.files).sort(), firstFilenames);
      for (const filename of firstFilenames) {
        const [firstEntry, replayEntry] = await Promise.all([
          firstZip.file(filename)!.async("nodebuffer"),
          replayZip.file(filename)!.async("nodebuffer"),
        ]);
        assert.ok(
          replayEntry.equals(firstEntry),
          `idempotent replay preserves ${filename}`,
        );
      }
      assert.deepEqual(
        await durableExportState(),
        afterFirst,
        "an idempotent replay creates no package version, transition, or release evidence",
      );

      const receiptObjectId = createHash("sha256")
        .update(`${organisationId}\u0000${idempotencyKey}`, "utf8")
        .digest("hex");
      const receipts = (
        await db
          .select({
            eventType: auditEvents.eventType,
            objectType: auditEvents.objectType,
            objectId: auditEvents.objectId,
          })
          .from(auditEvents)
          .where(eq(auditEvents.projectId, projectId))
      ).filter(
        (event) =>
          event.eventType === "project.exported" &&
          event.objectType === "project_export_request" &&
          event.objectId === receiptObjectId,
      );
      assert.equal(receipts.length, 1);
    } finally {
      currentUser = null;
    }
  });

  test("reusing an idempotency key with a changed body returns 409 without durable effects", async () => {
    currentUser = {
      id: adminId,
      role: "client_organisation_owner",
      name: "Export Approver",
    } as LocalUser;
    try {
      const confirmation = await readExactExportConfirmation();
      const idempotencyKey = randomUUID();
      const firstResponse = await postConfirmedProjectExport({
        confirmation,
        idempotencyKey,
      });
      assert.equal(firstResponse.status, 200);
      await firstResponse.arrayBuffer();
      const afterFirst = await durableExportState();

      const changedBody: ExactExportBody = {
        ...confirmation.body,
        reportVersion: confirmation.body.reportVersion + 1,
      };
      const conflictResponse = await postConfirmedProjectExport({
        confirmation,
        idempotencyKey,
        body: changedBody,
      });
      assert.equal(conflictResponse.status, 409);
      assert.deepEqual(await conflictResponse.json(), {
        error: "Idempotency key was already bound to another export scope.",
      });
      assert.deepEqual(await durableExportState(), afterFirst);
    } finally {
      currentUser = null;
    }
  });

  test("archive assembly failure leaves no durable package/export evidence", async () => {
    const packageVersionIds = async () =>
      (
        await db
          .select({ id: packageVersions.id })
          .from(packageVersions)
          .innerJoin(packages, eq(packageVersions.packageId, packages.id))
          .where(eq(packages.projectId, projectId))
      )
        .map((row) => row.id)
        .sort();
    const releaseEvidenceIds = async () =>
      (
        await db
          .select({ id: auditEvents.id, eventType: auditEvents.eventType })
          .from(auditEvents)
          .where(eq(auditEvents.projectId, projectId))
      )
        .filter(
          (event) =>
            event.eventType === "project.exported" ||
            event.eventType.startsWith("package.project_export_version_"),
        )
        .map((event) => event.id)
        .sort();

    const beforePackageVersions = await packageVersionIds();
    const beforeReleaseEvidence = await releaseEvidenceIds();
    const finalizeMock = mock.method(
      ZipArchive.prototype,
      "finalize",
      async () => {
        throw new Error("simulated archive assembly failure");
      },
    );
    try {
      currentUser = {
        id: adminId,
        role: "client_organisation_owner",
        name: "Export Approver",
      } as LocalUser;
      const res = await postConfirmedProjectExport();
      assert.equal(res.status, 502);
      assert.match(
        ((await res.json()) as { error: string }).error,
        /could not be assembled/i,
      );

      assert.deepEqual(await packageVersionIds(), beforePackageVersions);
      assert.deepEqual(await releaseEvidenceIds(), beforeReleaseEvidence);
    } finally {
      finalizeMock.mock.restore();
      currentUser = null;
    }
  });

  // Fetch the mandatory report before sending ZIP headers so storage failure
  // is a clean non-200 rather than a partial or corrupt successful download.
  test("an unavailable signed artefact fails closed before ZIP streaming", async () => {
    const objectPath = "/objects/uploads/signed-report-v2";
    unavailableObjectPaths.add(objectPath);
    try {
      currentUser = {
        id: adminId,
        role: "client_organisation_owner",
        name: "Export Approver",
      } as LocalUser;
      const res = await postConfirmedProjectExport();
      assert.equal(res.status, 502);
      assert.match(
        ((await res.json()) as { error: string }).error,
        /signed report artefact is unavailable/i,
      );

      const [project] = await db
        .select()
        .from(projects)
        .where(eq(projects.id, projectId));
      assert.equal(project.status, "exported");
    } finally {
      unavailableObjectPaths.delete(objectPath);
      currentUser = null;
    }
  });
});

/**
 * Pins the object-storage-backed branches: attaching the latest signed-off
 * report's .docx into the project export ZIP, and the individual download
 * endpoints. The storage method is faked so a refactor that silently drops the
 * signed report (recipients get CSVs but no report) or breaks the download route
 * is caught.
 */
describe("object-storage-backed report attach & download", () => {
  test("export ZIP attaches the latest signed-off report's .docx with its bytes", async () => {
    const [releasedBefore] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId));
    assert.equal(releasedBefore.status, "exported");
    currentUser = {
      id: adminId,
      role: "client_organisation_owner",
      name: "Export Approver",
    } as LocalUser;
    const res = await postConfirmedProjectExport();
    assert.equal(res.status, 200);

    const buffer = Buffer.from(await res.arrayBuffer());
    const zip = await JSZip.loadAsync(buffer);
    const files = Object.keys(zip.files).sort();

    // The data files (CSV registers, documents manifest, scorecard, project
    // JSON) PLUS the signed report .docx (versioned filename from the latest
    // signed-off report that has a docxPath, i.e. v2 after the draft v1).
    assert.deepEqual(files, [
      "audit_events.csv",
      "audit_export_policy.json",
      "bid-autopsy-report-v2.docx",
      "boq_checks.csv",
      "defects.csv",
      "documents_manifest.csv",
      "evidence.csv",
      "project.json",
      "requirements.csv",
      "scorecard.json",
    ]);

    // The attached .docx must be the exact bytes returned by object storage.
    const docxBytes = await zip
      .file("bid-autopsy-report-v2.docx")!
      .async("nodebuffer");
    assert.ok(
      docxBytes.equals(FAKE_DOCX_BYTES),
      "attached .docx bytes match storage payload",
    );

    const packageRows = await db
      .select()
      .from(packages)
      .where(eq(packages.projectId, projectId));
    assert.equal(packageRows.length, 1);
    assert.equal(packageRows[0]!.packageType, "project_export");
    const [packageVersion] = await db
      .select()
      .from(packageVersions)
      .where(eq(packageVersions.packageId, packageRows[0]!.id))
      .orderBy(sql`${packageVersions.versionNumber} desc`)
      .limit(1);
    assert.ok(packageVersion);
    assert.equal(
      packageVersion.versionNumber,
      packageRows[0]!.currentVersionNumber,
    );
    assert.equal(packageVersion.renderQaStatus, "pending");
    const manifestItems = await db
      .select({
        ordinal: packageManifestItems.ordinal,
        itemType: packageManifestItems.itemType,
        sourceObjectId: packageManifestItems.sourceObjectId,
        sourceVersion: packageManifestItems.sourceVersion,
        filename: packageManifestItems.filename,
        sha256: packageManifestItems.sha256,
        sizeBytes: packageManifestItems.sizeBytes,
      })
      .from(packageManifestItems)
      .where(eq(packageManifestItems.packageVersionId, packageVersion.id))
      .orderBy(packageManifestItems.ordinal);
    assert.equal(manifestItems.length, files.length);
    assert.equal(
      computeProjectExportManifestHash(manifestItems),
      packageVersion.manifestHash,
    );
    for (const item of manifestItems) {
      const bytes = await zip.file(item.filename)!.async("nodebuffer");
      assert.equal(bytes.byteLength, item.sizeBytes);
      assert.equal(
        createHash("sha256").update(bytes).digest("hex"),
        item.sha256,
      );
    }

    const listResponse = await fetch(
      `${baseUrl}/projects/${projectId}/package-versions`,
    );
    assert.equal(listResponse.status, 200);
    const listed = (await listResponse.json()) as {
      items: Array<Record<string, unknown>>;
      limit: number;
      truncated: boolean;
    };
    assert.equal(listed.limit, 100);
    assert.equal(listed.truncated, false);
    assert.deepEqual(listed.items, [
      {
        packageId: packageRows[0]!.id,
        packageVersionId: packageVersion.id,
        packageType: "project_export",
        versionNumber: packageVersion.versionNumber,
        manifestSha256: packageVersion.manifestHash,
        sourceSnapshotSha256: packageVersion.sourceSnapshotHash,
        renderQaStatus: "pending",
        createdAt: packageVersion.createdAt.toISOString(),
      },
    ]);

    const qaResponse = await fetch(
      `${baseUrl}/projects/${projectId}/operations-suite/visual-qa-reports`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          packageVersionId: packageVersion.id,
          manifestSha256: packageVersion.manifestHash,
          expectedManifestSha256: packageVersion.manifestHash,
          pages: [
            {
              pageNumber: 1,
              textCharacterCount: 250,
              nonWhitespacePixelRatio: 0.2,
              clippedElementCount: 0,
            },
          ],
        }),
      },
    );
    const qa = (await qaResponse.json()) as {
      id?: string;
      result?: { status?: string };
    };
    assert.equal(qaResponse.status, 201, JSON.stringify(qa));
    assert.equal(qa.result?.status, "pass");

    const roomResponse = await fetch(
      `${baseUrl}/projects/${projectId}/operations-suite/submission-war-rooms`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          packageId: packageRows[0]!.id,
          packageVersionId: packageVersion.id,
          manifestSha256: packageVersion.manifestHash,
        }),
      },
    );
    const room = (await roomResponse.json()) as {
      id?: string;
      version?: number;
      status?: string;
    };
    assert.equal(roomResponse.status, 201, JSON.stringify(room));
    assert.equal(room.status, "planning");
    assert.equal(typeof room.id, "string");

    const freezeResponse = await fetch(
      `${baseUrl}/projects/${projectId}/operations-suite/submission-war-rooms/${room.id}/advance`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedVersion: room.version,
          toStatus: "frozen",
        }),
      },
    );
    const frozenRoom = (await freezeResponse.json()) as { status?: string };
    assert.equal(freezeResponse.status, 200, JSON.stringify(frozenRoom));
    assert.equal(frozenRoom.status, "frozen");

    const postAwardResponse = await fetch(
      `${baseUrl}/projects/${projectId}/operations-suite/post-award-items`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          category: "obligation",
          title: "Record the award mobilisation obligation",
        }),
      },
    );
    const postAward = (await postAwardResponse.json()) as {
      id?: string;
      version?: number;
      status?: string;
    };
    assert.equal(postAwardResponse.status, 201, JSON.stringify(postAward));
    assert.equal(postAward.status, "open");

    const updatePostAwardResponse = await fetch(
      `${baseUrl}/projects/${projectId}/operations-suite/post-award-items/${postAward.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedVersion: postAward.version,
          status: "in_progress",
        }),
      },
    );
    const updatedPostAward = (await updatePostAwardResponse.json()) as {
      status?: string;
    };
    assert.equal(
      updatePostAwardResponse.status,
      200,
      JSON.stringify(updatedPostAward),
    );
    assert.equal(updatedPostAward.status, "in_progress");

    const repeatedExport = await postConfirmedProjectExport();
    assert.equal(repeatedExport.status, 200);
    await repeatedExport.arrayBuffer();
    const [packageAfterRepeat] = await db
      .select()
      .from(packages)
      .where(eq(packages.id, packageRows[0]!.id));
    const versionsAfterRepeat = await db
      .select({
        id: packageVersions.id,
        renderQaStatus: packageVersions.renderQaStatus,
      })
      .from(packageVersions)
      .where(eq(packageVersions.packageId, packageRows[0]!.id));
    assert.equal(packageAfterRepeat.currentVersionNumber, 1);
    assert.deepEqual(versionsAfterRepeat, [
      { id: packageVersion.id, renderQaStatus: "passed" },
    ]);

    const [releasedAfter] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId));
    assert.equal(releasedAfter.status, "exported");
    assert.equal(
      releasedAfter.version,
      releasedBefore.version,
      "re-export does not rewrite released project content",
    );

    await db
      .update(projects)
      .set({ status: "archived" })
      .where(eq(projects.id, projectId));
    const archivedQaResponse = await fetch(
      `${baseUrl}/projects/${projectId}/operations-suite/visual-qa-reports`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          packageVersionId: packageVersion.id,
          manifestSha256: packageVersion.manifestHash,
          expectedManifestSha256: packageVersion.manifestHash,
          pages: [
            {
              pageNumber: 1,
              textCharacterCount: 250,
              nonWhitespacePixelRatio: 0.2,
              clippedElementCount: 0,
            },
          ],
        }),
      },
    );
    assert.equal(archivedQaResponse.status, 409);
    assert.deepEqual(await archivedQaResponse.json(), {
      error:
        "Released project content is immutable; use a governed reopen workflow.",
    });
    await db
      .update(projects)
      .set({
        status: "exported",
        version: releasedAfter.version,
        updatedAt: releasedAfter.updatedAt,
      })
      .where(eq(projects.id, projectId));

    currentUser = null;
  });

  test("download of a signed-off report streams the .docx bytes + filename", async () => {
    const auditCountBefore = await matchingAuditEventCount(
      "report.exported",
      signedReportId,
    );
    currentUser = {
      id: adminId,
      role: "client_organisation_owner",
      name: "Export Approver",
    } as LocalUser;
    const res = await fetch(`${baseUrl}/reports/${signedReportId}/download`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), DOCX_MIME);
    assert.equal(
      res.headers.get("content-disposition"),
      'attachment; filename="bid-autopsy-report-v2.docx"',
    );

    const body = Buffer.from(await res.arrayBuffer());
    assert.ok(
      body.equals(FAKE_DOCX_BYTES),
      "downloaded bytes match storage payload",
    );

    // The transaction is committed from the response lifecycle, which can
    // settle just after fetch() returns. Require this request's new event.
    await waitForAuditEventCount(
      "report.exported",
      signedReportId,
      auditCountBefore + 1,
    );

    currentUser = null;
  });

  test("download of a not-signed-off report is denied (403) and audited", async () => {
    const auditCountBefore = await matchingAuditEventCount(
      "report.export_denied",
      draftReportId,
    );
    currentUser = {
      id: adminId,
      role: "client_organisation_owner",
      name: "Export Approver",
    } as LocalUser;
    const res = await fetch(`${baseUrl}/reports/${draftReportId}/download`);
    assert.equal(res.status, 403);

    await waitForAuditEventCount(
      "report.export_denied",
      draftReportId,
      auditCountBefore + 1,
    );

    currentUser = null;
  });

  test("download-pdf of a signed-off report streams the .pdf bytes + filename", async () => {
    const auditCountBefore = await matchingAuditEventCount(
      "report.exported",
      signedReportId,
    );
    currentUser = {
      id: adminId,
      role: "client_organisation_owner",
      name: "Export Approver",
    } as LocalUser;
    const res = await fetch(
      `${baseUrl}/reports/${signedReportId}/download-pdf`,
    );
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), PDF_MIME);
    assert.equal(
      res.headers.get("content-disposition"),
      'attachment; filename="bid-autopsy-report-v2.pdf"',
    );

    const body = Buffer.from(await res.arrayBuffer());
    assert.ok(
      body.equals(FAKE_DOCX_BYTES),
      "downloaded bytes match storage payload",
    );

    // The successful PDF export is audited with report.exported, mirroring DOCX.
    await waitForAuditEventCount(
      "report.exported",
      signedReportId,
      auditCountBefore + 1,
    );

    currentUser = null;
  });

  test("download-pdf of a not-signed-off report is denied (403) and audited", async () => {
    const auditCountBefore = await matchingAuditEventCount(
      "report.export_denied",
      draftReportId,
    );
    currentUser = {
      id: adminId,
      role: "client_organisation_owner",
      name: "Export Approver",
    } as LocalUser;
    const res = await fetch(`${baseUrl}/reports/${draftReportId}/download-pdf`);
    assert.equal(res.status, 403);

    await waitForAuditEventCount(
      "report.export_denied",
      draftReportId,
      auditCountBefore + 1,
    );

    currentUser = null;
  });
});
