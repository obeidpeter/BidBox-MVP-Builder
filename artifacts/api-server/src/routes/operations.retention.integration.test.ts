import { test, describe, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { eq, sql } from "drizzle-orm";
import {
  db,
  users,
  clients,
  projects,
  documents,
  requirements,
  evidenceItems,
  defects,
  boqChecks,
  llmRuns,
  notificationAttempts,
  notificationEvents,
  reports,
  retentionRequests,
  vaultItems,
  auditEvents,
  organisations,
  organisationMemberships,
  packageManifestItems,
  packageVersions,
  packages,
  roleGrants,
  uploadSessions,
  workTasks,
  withTenantDatabase,
} from "@workspace/db";
import operationsRouter from "./operations";
import { createRetentionCompletionRouter } from "./retentionCompletion";
import {
  DrizzleRetentionCompletionRepository,
  RetentionCompletionService,
  loadCheckedRetentionCompletionActivationManifest,
} from "../lib/retentionCompletion";
import type { LocalUser } from "../middlewares/auth";
import { ObjectStorageService } from "../lib/objectStorage";
import {
  attachTenantContext,
  enforceTenantResourceBoundary,
} from "../middlewares/tenancy";
import { attachTenantDatabase } from "../middlewares/databaseTenancy";
import { RETAINER_TASK_PREFIX } from "../lib/commercialRetainer/contracts";
import { writeAuditTx } from "../lib/audit";

/**
 * End-to-end proof that retention request creation/listing remains available
 * while the dedicated completion workflow fails closed without touching relational content, upload
 * lifecycle control rows, object storage, project state or the audit chain.
 */

let server: Server;
let baseUrl: string;
let currentUser: LocalUser | null = null;

let adminId: string;
let adminUser: LocalUser;
let organisationId: string;
let clientId: string;
let projectId: string;
let vaultBlobPath: string;
let engagementBlobPath: string;
let reportBlobPath: string;
let packagePdfBlobPath: string;
let packageZipBlobPath: string;
const deletedBlobs: string[] = [];

async function deleteRetentionRequestFixture(projectId: string): Promise<void> {
  // Protocol-zero and protocol-one retention evidence is deliberately
  // immutable. This test-only owner DDL runs inside withTenantDatabase's
  // transaction, disables only the completion guard (not FK/cascade
  // triggers), and is rolled back automatically if cleanup cannot finish.
  await db.execute(
    sql`ALTER TABLE public.retention_requests DISABLE TRIGGER retention_request_completion_guard`,
  );
  await db
    .delete(retentionRequests)
    .where(eq(retentionRequests.subjectProjectId, projectId));
  await db.execute(
    sql`ALTER TABLE public.retention_requests ENABLE TRIGGER retention_request_completion_guard`,
  );
}

before(async () => {
  const stamp = new Date().toISOString();

  const [admin] = await db
    .insert(users)
    .values({
      clerkUserId: `__retention_it_admin__${stamp}`,
      email: `admin-${stamp}@retention-it.local`,
      name: "Retention Admin",
      role: "admin",
      status: "active",
    })
    .returning();
  adminId = admin.id;
  adminUser = admin;

  const [organisation] = await db
    .insert(organisations)
    .values({
      name: `Retention integration ${stamp}`,
      slug: `retention-it-${randomUUID()}`,
      type: "valo",
      createdBy: admin.id,
    })
    .returning();
  organisationId = organisation.id;
  const [membership] = await db
    .insert(organisationMemberships)
    .values({ organisationId, userId: admin.id })
    .returning();
  await db.insert(roleGrants).values({
    membershipId: membership.id,
    role: "valo_operations_administrator",
  });

  await withTenantDatabase(organisationId, async () => {
    const [client] = await db
      .insert(clients)
      .values({ organisationId, name: `__RETENTION_IT__ ${stamp}` })
      .returning();
    clientId = client.id;

    const [project] = await db
      .insert(projects)
      .values({
        organisationId,
        clientId: client.id,
        tenderTitle: "Retention Integration RT-2026-001",
        status: "intake",
        reviewerId: admin.id,
        scope: "Full autopsy of tender RT-2026-001",
        limitations: "BOQ addendum 3 not provided",
        responsivenessReview:
          "Verbatim narrative with confidential clause text",
      })
      .returning();
    projectId = project.id;

    engagementBlobPath = `retention-it/${stamp}/tender.txt`;
    vaultBlobPath = `retention-it/${stamp}/cac-cert.pdf`;
    reportBlobPath = `retention-it/${stamp}/report-v1.docx`;
    packagePdfBlobPath = `retention-it/${stamp}/project-package.pdf`;
    packageZipBlobPath = `retention-it/${stamp}/project-package.zip`;
    const [tenderDoc] = await db
      .insert(documents)
      .values([
        {
          organisationId,
          projectId,
          type: "tender",
          filename: "tender.txt",
          objectPath: engagementBlobPath,
        },
        {
          organisationId,
          projectId,
          type: "other",
          filename: "cac-cert.pdf",
          objectPath: vaultBlobPath,
        },
      ])
      .returning();

    // The second document's blob is claimed by the client's Certificate Vault —
    // the retention purge must leave that file alone.
    await db.insert(vaultItems).values({
      organisationId,
      clientId: client.id,
      artefactType: "CAC Certificate",
      objectPath: vaultBlobPath,
    });

    const [req1] = await db
      .insert(requirements)
      .values({
        organisationId,
        projectId,
        sourceDocId: tenderDoc.id,
        text: "Verbatim confidential clause: bid security of 2%",
        reviewStatus: "confirmed",
      })
      .returning();
    await db.insert(evidenceItems).values({
      organisationId,
      projectId,
      requirementId: req1.id,
      evidenceStatus: "present",
      excerpt: "Verbatim confidential bid excerpt",
    });
    await db.insert(defects).values({
      organisationId,
      projectId,
      requirementId: req1.id,
      type: "omission",
      severity: "scoring_risk",
      description: "Confidential defect narrative",
      evidenceSnapshot: "Verbatim snapshot",
      status: "open",
    });
    await db.insert(boqChecks).values({
      organisationId,
      projectId,
      lineRef: "1.1",
      description: "Confidential BOQ line",
      checkType: "extension",
      finding: "Extension mismatch",
    });
    await db.insert(llmRuns).values({
      organisationId,
      projectId,
      task: "extract_requirements",
      outputSummary: "Summary quoting confidential tender text",
    });
    await db.insert(reports).values({
      organisationId,
      projectId,
      version: 1,
      status: "draft",
      docxPath: reportBlobPath,
    });
    const [notificationEvent] = await db
      .insert(notificationEvents)
      .values({
        organisationId,
        projectId,
        channel: "email",
        template: "[RECONCILED-COMMS:v1]evidence_request_ready_v1",
        recipient: `user:${adminId}`,
        payload: JSON.stringify({
          requestId: randomUUID(),
          dueAt: new Date(Date.now() + 86_400_000).toISOString(),
        }),
        status: "prepared",
        createdBy: adminId,
      })
      .returning();
    await db.insert(notificationAttempts).values({
      organisationId,
      notificationEventId: notificationEvent.id,
      attemptNumber: 1,
      provider: "disconnected:test",
      idempotencyKey: `retention-${randomUUID()}`,
      status: "provider_disconnected",
      responseSummary: JSON.stringify({ receiptVerified: false }),
    });
    await db.insert(workTasks).values([
      {
        organisationId,
        projectId,
        title: "[OPS:evidence_request] Confidential evidence request",
        description: JSON.stringify({
          schema: "valo.operations-suite/v1",
          confidentialRequestMessage: "Provide the unpublished tax record",
        }),
      },
      {
        organisationId,
        projectId,
        title: `[CLIENT-ACTION:evidence_request] ${randomUUID()}`,
        description: JSON.stringify({
          schema: "valo.client-action-portal/v1",
          confidentialRequestMessage:
            "Provide the unpublished client evidence record",
        }),
      },
      {
        organisationId,
        projectId,
        title: `${RETAINER_TASK_PREFIX}${randomUUID()}] Confidential retainer request`,
        description: JSON.stringify({
          schemaVersion: "valo.retainer-service-request@v1",
          confidentialRequestMessage: "Review the unpublished tax record",
        }),
      },
      {
        organisationId,
        projectId,
        title: `[CONSORTIUM-ROOM:v1:${randomUUID()}]`,
        description: JSON.stringify({
          schema: "valo.partner-consortium-room/v1",
          confidentialResponsibility: "Prepare the unpublished pricing file",
        }),
      },
      {
        organisationId,
        projectId,
        title: `[CLAIMS-DESK:record_created] ${randomUUID()}`,
        description: JSON.stringify({
          schema: "valo.claims-desk-ledger/v1",
          receiptSha256: "a".repeat(64),
        }),
      },
      {
        organisationId,
        projectId,
        title: `[EVIDENCE-RENEWAL:plan:${randomUUID()}]`,
        description: JSON.stringify({
          schema: "valo.evidence-renewal/v1",
          ownerNote: "Replace the expiring audited accounts evidence",
        }),
      },
    ]);
    await db.transaction((tx) =>
      writeAuditTx(tx, {
        user: adminUser,
        organisationId,
        projectId,
        eventType: "evidence_renewal.plan_created",
        objectType: "evidence_renewal.plan",
        objectId: randomUUID(),
        details: JSON.stringify({
          schema: "valo.evidence-renewal-receipt/v1",
          receiptSha256: "b".repeat(64),
        }),
      }),
    );
    const [projectPackage] = await db
      .insert(packages)
      .values({
        organisationId,
        projectId,
        packageType: "project_export",
        currentVersionNumber: 1,
      })
      .returning();
    const [packageVersion] = await db
      .insert(packageVersions)
      .values({
        organisationId,
        packageId: projectPackage.id,
        versionNumber: 1,
        sourceSnapshotHash: "c".repeat(64),
        manifestHash: "d".repeat(64),
        renderQaStatus: "pending",
        readinessSnapshot: JSON.stringify({ confidential: "snapshot" }),
        generatedByUserId: adminId,
        // DOCX intentionally overlaps the report row to prove purge planning
        // deduplicates shared object paths before storage deletion.
        docxObjectPath: reportBlobPath,
        docxSha256: "f".repeat(64),
        pdfObjectPath: packagePdfBlobPath,
        pdfSha256: "1".repeat(64),
        zipObjectPath: packageZipBlobPath,
        zipSha256: "2".repeat(64),
      })
      .returning();
    await db.insert(packageManifestItems).values({
      organisationId,
      packageVersionId: packageVersion.id,
      ordinal: 1,
      itemType: "signed_report",
      filename: "confidential-report.docx",
      sha256: "e".repeat(64),
      sizeBytes: 128,
    });
    await db.insert(uploadSessions).values({
      organisationId,
      projectId,
      filename: "pending-client-upload.pdf",
      expectedBytes: 256,
      receivedBytes: 0,
      idempotencyKey: `retention-upload-${randomUUID()}`,
      status: "open",
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });
  });

  mock.method(
    ObjectStorageService.prototype,
    "deleteObjectEntity",
    async (objectPath: string) => {
      deletedBlobs.push(objectPath);
      return true;
    },
  );

  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as { localUser: LocalUser | null }).localUser = currentUser;
    (req as unknown as { log: unknown }).log = {
      error() {},
      warn() {},
      info() {},
      debug() {},
    };
    next();
  });
  app.use(attachTenantContext);
  app.use(attachTenantDatabase);
  app.use(enforceTenantResourceBoundary);
  app.use(
    createRetentionCompletionRouter({
      service: new RetentionCompletionService({
        repository: new DrizzleRetentionCompletionRepository(),
        activationManifest: loadCheckedRetentionCompletionActivationManifest(),
      }),
    }),
  );
  app.use(operationsRouter);

  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  currentUser = adminUser;
});

after(async () => {
  mock.restoreAll();
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  await withTenantDatabase(organisationId, async () => {
    await db.execute(
      sql`SELECT set_config('valo.audit_test_cleanup', 'approved', true)`,
    );
    await deleteRetentionRequestFixture(projectId);
    await db.delete(auditEvents).where(eq(auditEvents.projectId, projectId));
    await db.delete(projects).where(eq(projects.id, projectId));
    await db.delete(clients).where(eq(clients.id, clientId));
  });
  await db.delete(organisations).where(eq(organisations.id, organisationId));
  await db.delete(users).where(eq(users.id, adminId));
});

interface RetentionBody {
  id: string;
  projectId?: string | null;
  subjectProjectId?: string;
  completionProtocolVersion?: 0 | 1;
  requestedByUserId?: string | null;
  requestedByName?: string | null;
  reason?: string | null;
  dueAt?: string;
  completedAt?: string | null;
  status: string;
  version?: number;
  createdAt?: string;
  updatedAt?: string;
  error: string;
  code?: string;
  sideEffectsApplied?: boolean;
  readiness?: unknown;
}

async function json(res: globalThis.Response): Promise<RetentionBody> {
  return (await res.json()) as RetentionBody;
}

function headers(jsonBody = false): Record<string, string> {
  return {
    "X-BidBox-Organisation-Id": organisationId,
    ...(jsonBody ? { "Content-Type": "application/json" } : {}),
  };
}

async function rowCount(table: any): Promise<number> {
  return withTenantDatabase(organisationId, async () => {
    const rows = await db
      .select()
      .from(table)
      .where(eq(table.projectId, projectId));
    return rows.length;
  });
}

async function tenantRowCount(table: any): Promise<number> {
  return withTenantDatabase(organisationId, async () => {
    const rows = await db.select().from(table);
    return rows.length;
  });
}

describe("retention request lifecycle", () => {
  let requestId: string;

  test("opens a retention request for the engagement", async () => {
    const res = await fetch(
      `${baseUrl}/projects/${projectId}/retention-requests`,
      {
        method: "POST",
        headers: headers(true),
        body: JSON.stringify({ reason: "Client requested deletion" }),
      },
    );
    assert.equal(res.status, 201);
    const body = await json(res);
    requestId = body.id;
    assert.deepEqual(
      Object.keys(body).sort(),
      [
        "completedAt",
        "completionProtocolVersion",
        "createdAt",
        "dueAt",
        "id",
        "projectId",
        "reason",
        "requestedByName",
        "requestedByUserId",
        "status",
        "subjectProjectId",
        "updatedAt",
        "version",
      ].sort(),
    );
    assert.equal(body.projectId, projectId);
    assert.equal(body.subjectProjectId, projectId);
    assert.equal(body.completionProtocolVersion, 1);
    assert.equal(body.requestedByUserId, adminId);
    assert.equal(body.requestedByName, adminUser.name);
    assert.equal(body.reason, "Client requested deletion");
    assert.equal(body.completedAt, null);
    assert.equal(body.status, "pending");
    assert.equal(body.version, 1);
    assert.equal(Number.isFinite(Date.parse(body.dueAt ?? "")), true);
    assert.equal(Number.isFinite(Date.parse(body.createdAt ?? "")), true);
    assert.equal(Number.isFinite(Date.parse(body.updatedAt ?? "")), true);
  });

  test("rejects a duplicate open request for the same engagement", async () => {
    const res = await fetch(
      `${baseUrl}/projects/${projectId}/retention-requests`,
      {
        method: "POST",
        headers: headers(true),
        body: JSON.stringify({ reason: "duplicate" }),
      },
    );
    assert.equal(res.status, 409);
  });

  test("rejects a past dueAt", async () => {
    const res = await fetch(
      `${baseUrl}/projects/${projectId}/retention-requests`,
      {
        method: "POST",
        headers: headers(true),
        body: JSON.stringify({ dueAt: "2001-01-01T00:00:00.000Z" }),
      },
    );
    assert.equal(res.status, 400);
  });

  test("fails completion closed with zero storage, database, project, certificate, or audit effects", async () => {
    const auditCountBefore = await rowCount(auditEvents);
    const res = await fetch(
      `${baseUrl}/retention-requests/${requestId}/complete`,
      {
        method: "POST",
        headers: {
          ...headers(true),
          "If-Match": '"1"',
          "Idempotency-Key": "retention-inactive-integration-0001",
        },
        body: JSON.stringify({
          attestation:
            "I attest that this exact governed retention subject may be detached.",
        }),
      },
    );
    assert.equal(res.status, 503);
    assert.equal(res.headers.get("cache-control"), "private, no-store");
    const body = await json(res);
    assert.deepEqual(Object.keys(body).sort(), [
      "code",
      "error",
      "readiness",
      "sideEffectsApplied",
    ]);
    assert.equal(body.code, "RETENTION_COMPLETION_NOT_ACTIVATED");
    assert.equal(body.sideEffectsApplied, false);
    assert.equal((body.readiness as { activated: boolean }).activated, false);
    assert.match(body.error, /not activated/i);
    assert.match(body.error, /no data was deleted/i);
    assert.match(body.error, /no deletion certificate was issued/i);

    // The refusal must not mutate any project content or lifecycle control row.
    assert.equal(await rowCount(requirements), 1);
    assert.equal(await rowCount(documents), 2);
    assert.equal(await rowCount(evidenceItems), 1);
    assert.equal(await rowCount(defects), 1);
    assert.equal(await rowCount(boqChecks), 1);
    assert.equal(await rowCount(llmRuns), 1);
    assert.equal(await rowCount(reports), 1);
    assert.equal(await rowCount(workTasks), 6);
    assert.equal(await rowCount(notificationEvents), 1);
    assert.equal(await tenantRowCount(notificationAttempts), 1);
    assert.equal(await rowCount(packages), 1);
    assert.equal(await tenantRowCount(packageVersions), 1);
    assert.equal(await tenantRowCount(packageManifestItems), 1);
    assert.equal(await rowCount(uploadSessions), 1);
    const [reqRow] = await withTenantDatabase(organisationId, () =>
      db
        .select()
        .from(retentionRequests)
        .where(eq(retentionRequests.id, requestId)),
    );
    assert.equal(reqRow.status, "pending");
    assert.equal(reqRow.completedAt, null);
    assert.equal(reqRow.certificateText, null);
    const [project] = await withTenantDatabase(organisationId, () =>
      db.select().from(projects).where(eq(projects.id, projectId)),
    );
    assert.equal(project.status, "intake");
    assert.equal(project.scope, "Full autopsy of tender RT-2026-001");
    assert.equal(
      project.responsivenessReview,
      "Verbatim narrative with confidential clause text",
    );
    assert.equal(await rowCount(auditEvents), auditCountBefore);
    assert.equal(deletedBlobs.length, 0);
  });
});
