import { Router, type IRouter, type Request, type Response } from "express";
import { createHash } from "node:crypto";
import { and, eq, desc, sql } from "drizzle-orm";
import {
  db,
  reports,
  projects,
  clients,
  users,
  requirements,
  evidenceItems,
  defects,
  boqChecks,
  auditEvents,
  legacyAuditEvents,
  documents,
  drafts,
  draftVersions,
  draftClaims,
  claimEvidenceLinks,
  redTeamRuns,
  redTeamFindings,
  packages,
  packageVersions,
} from "@workspace/db";
import { ExportProjectBody, SignOffReportBody } from "@workspace/api-zod";
import { getLocalUser } from "../middlewares/auth";
import {
  getOrganisationId,
  getAccessContext,
  requirePermissionOrLegacy,
} from "../middlewares/tenancy";
import { commitTenantDatabaseBeforeResponse } from "../middlewares/databaseTenancy";
import { serializeReport } from "../lib/serializers";
import { writeAudit, writeAuditTx } from "../lib/audit";
import { buildReportDocx, DOCX_MIME, type ReportData } from "../lib/docx";
import { buildReportPdf, PDF_MIME } from "../lib/pdf";
import {
  ENGINE_VERSION,
  PROMPT_PACK_VERSION,
  MODEL_ID,
  TAXONOMY_VERSION,
} from "../lib/provenance";
import { computeRisk, type Severity } from "../lib/deterministic";
import {
  toCsv,
  requirementReviewState,
  suggestedFlagReviewState,
  withReviewState,
} from "../lib/reportCsv";
import {
  evaluateSubmissionReadiness,
  type SubmissionBlocker,
} from "../lib/submissionReadiness";
import { getActiveConfig } from "../lib/appConfig";
import { computeScorecard } from "../lib/scorecard";
import { ObjectStorageService } from "../lib/objectStorage";
import { lockStagedUploadObject } from "../lib/stagedUploadLock";
import {
  canGenerateReportForProjectStatus,
  isLatestReportVersion,
  packageExportDenial,
  reportExportDenial,
  reportSignerDenial,
} from "../lib/reportPolicy";
import {
  buildCanonicalProjectExportManifest,
  includeAuditEventInProjectExport,
  persistCanonicalProjectExportPackage,
  PROJECT_EXPORT_AUDIT_POLICY,
  PROJECT_EXPORT_PACKAGE_LIST_LIMIT,
  PROJECT_EXPORT_PACKAGE_TYPE,
  soleCanonicalProjectExportPackageId,
  type ProjectExportArchiveEntry,
} from "../lib/projectExportPackage";
import {
  computeCurrentDeliveryStudioSourceSnapshotHash,
  isAttestedRedTeamApproval,
  loadRedTeamApprovalAttestation,
  type DeliveryStudioQueryExecutor,
} from "../lib/deliveryStudio/drizzleRepository";
import {
  hasCurrentAccessPermission,
  resolveCurrentDirectAuthority,
} from "../lib/directMembershipAuthority";
import { buildProjectExportZip } from "../lib/projectExportArchive";

const router: IRouter = Router();
const objectStorage = new ObjectStorageService();

class ReportSignOffConflictError extends Error {
  constructor(
    message: string,
    readonly blockers?: SubmissionBlocker[],
  ) {
    super(message);
    this.name = "ReportSignOffConflictError";
  }
}

class ReportSignOffAuthorityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReportSignOffAuthorityError";
  }
}

class PackageExportGovernanceError extends Error {
  constructor(
    message: string,
    readonly ndaStatus: string | null,
    readonly authorityLost = false,
  ) {
    super(message);
    this.name = "PackageExportGovernanceError";
  }
}

class PackageExportDriftError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PackageExportDriftError";
  }
}

type ExportPackageBinding = {
  packageVersionId: string | null;
  packageVersionNumber: number | null;
  packageManifestSha256: string | null;
  packageSourceSnapshotSha256: string | null;
};

function exportScopeSha256(
  report: { id: string; version: number; status: string } | undefined,
  packageBinding: ExportPackageBinding,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        report: report
          ? { id: report.id, version: report.version, status: report.status }
          : null,
        package: packageBinding,
      }),
      "utf8",
    )
    .digest("hex");
}

function hasCompletePackageBinding(binding: ExportPackageBinding): boolean {
  const values = [
    binding.packageVersionId,
    binding.packageVersionNumber,
    binding.packageManifestSha256,
    binding.packageSourceSnapshotSha256,
  ];
  return (
    values.every((value) => value === null) ||
    values.every((value) => value !== null)
  );
}

type ExportReceipt = {
  requestSha256: string;
  packageVersionId: string;
  packageVersionNumber: number;
  packageManifestSha256: string;
  packageSourceSnapshotSha256: string;
};

function parseExportReceipt(value: string | null): ExportReceipt | null {
  try {
    const candidate = JSON.parse(
      value ?? "null",
    ) as Partial<ExportReceipt> | null;
    return candidate &&
      typeof candidate.requestSha256 === "string" &&
      typeof candidate.packageVersionId === "string" &&
      UUID_ANY_PATTERN.test(candidate.packageVersionId) &&
      Number.isSafeInteger(candidate.packageVersionNumber) &&
      Number(candidate.packageVersionNumber) >= 1 &&
      typeof candidate.packageManifestSha256 === "string" &&
      SHA256_PATTERN.test(candidate.packageManifestSha256) &&
      typeof candidate.packageSourceSnapshotSha256 === "string" &&
      SHA256_PATTERN.test(candidate.packageSourceSnapshotSha256)
      ? (candidate as ExportReceipt)
      : null;
  } catch {
    return null;
  }
}
import {
  SHA256_HEX_PATTERN as SHA256_PATTERN,
  UUID_PATTERN as UUID_ANY_PATTERN,
} from "../lib/identifierPatterns";
import { isOneOf } from "../lib/typeGuards";
import { parseInstantViaString } from "../lib/dbClock";

type StoredReportData = Omit<ReportData, "project"> & {
  project: ReportData["project"] & {
    organisationId: string | null;
    version: number;
  };
};

async function gatherReportData(
  projectId: string,
): Promise<StoredReportData | null> {
  const [row] = await db
    .select({ project: projects, client: clients, reviewerName: users.name })
    .from(projects)
    .leftJoin(clients, eq(projects.clientId, clients.id))
    .leftJoin(users, eq(projects.reviewerId, users.id))
    .where(eq(projects.id, projectId));
  if (!row) return null;

  const reqs = await db
    .select()
    .from(requirements)
    .where(eq(requirements.projectId, projectId));
  const ev = await db
    .select()
    .from(evidenceItems)
    .where(eq(evidenceItems.projectId, projectId));
  const defs = await db
    .select()
    .from(defects)
    .where(eq(defects.projectId, projectId));
  const boqs = await db
    .select()
    .from(boqChecks)
    .where(eq(boqChecks.projectId, projectId));

  const config = await getActiveConfig();
  const risk = computeRisk(
    {
      defects: defs.map((d) => ({
        severity: d.severity as Severity,
        status: d.status,
      })),
      requirements: reqs.map((r) => ({
        id: r.id,
        isMandatory: r.isMandatory,
        reviewStatus: r.reviewStatus,
      })),
      evidence: ev.map((e) => ({
        requirementId: e.requirementId,
        evidenceStatus: e.evidenceStatus,
        suggested: e.suggested,
      })),
    },
    config.risk,
  );

  return {
    project: row.project,
    client: row.client,
    reviewerName: row.reviewerName ?? null,
    requirements: reqs,
    evidence: ev,
    defects: defs,
    boqChecks: boqs,
    risk: {
      score: risk.score,
      band: row.project.riskOverrideBand || risk.band,
      explanation: risk.explanation,
      overrideBand: row.project.riskOverrideBand,
      overrideNote: row.project.riskOverrideNote,
      overrideBy: row.project.riskOverrideBy,
    },
    template: config.template,
    version: 1,
    generatedByName: null,
  };
}

async function latestReportForProject(projectId: string) {
  const [latest] = await db
    .select()
    .from(reports)
    .where(eq(reports.projectId, projectId))
    .orderBy(desc(reports.version))
    .limit(1);
  return latest;
}

async function gatherSupplementalReleaseGates(
  organisationId: string | null,
  projectId: string,
  query: DeliveryStudioQueryExecutor = db,
): Promise<{
  unsupportedClaimIds: string[];
  requiresRedTeam: true;
  redTeamApproved: boolean;
}> {
  const claimRows = await query
    .select({
      id: draftClaims.id,
      claimKind: draftClaims.claimKind,
      groundingStatus: draftClaims.groundingStatus,
      evidenceLinkId: claimEvidenceLinks.id,
    })
    .from(draftClaims)
    .innerJoin(draftVersions, eq(draftClaims.draftVersionId, draftVersions.id))
    .innerJoin(
      drafts,
      and(
        eq(draftVersions.draftId, drafts.id),
        eq(draftVersions.versionNumber, drafts.currentVersionNumber),
      ),
    )
    .leftJoin(
      claimEvidenceLinks,
      eq(claimEvidenceLinks.draftClaimId, draftClaims.id),
    )
    .where(eq(drafts.projectId, projectId));
  const evidenceLinkedClaimIds = new Set(
    claimRows.filter((row) => row.evidenceLinkId).map((row) => row.id),
  );
  const unsupportedClaimIds = [
    ...new Set(
      claimRows
        .filter(
          (row) =>
            new Set(["factual", "instructional"]).has(
              row.claimKind.toLowerCase(),
            ) &&
            (row.groundingStatus !== "approved" ||
              !evidenceLinkedClaimIds.has(row.id)),
        )
        .map((row) => row.id),
    ),
  ];

  const currentSourceSnapshotHash = organisationId
    ? await computeCurrentDeliveryStudioSourceSnapshotHash(
        organisationId,
        projectId,
        query,
      )
    : null;
  const [latestRedTeamRun] = await query
    .select()
    .from(redTeamRuns)
    .where(eq(redTeamRuns.projectId, projectId))
    .orderBy(desc(redTeamRuns.createdAt), desc(redTeamRuns.id))
    .limit(1);
  let redTeamApproved = false;
  if (
    latestRedTeamRun &&
    organisationId &&
    currentSourceSnapshotHash !== null
  ) {
    const findings = await query
      .select({ status: redTeamFindings.status })
      .from(redTeamFindings)
      .where(eq(redTeamFindings.redTeamRunId, latestRedTeamRun.id));
    const approvalAttestation = await loadRedTeamApprovalAttestation(query, {
      organisationId,
      projectId,
      runId: latestRedTeamRun.id,
      approvedByUserId: latestRedTeamRun.approvedByUserId,
      approvedAt: latestRedTeamRun.approvedAt,
    });
    redTeamApproved = isAttestedRedTeamApproval({
      runStatus: latestRedTeamRun.status,
      sourceSnapshotMatches:
        latestRedTeamRun.sourceSnapshotHash === currentSourceSnapshotHash,
      initiatedByUserId: latestRedTeamRun.initiatedByUserId,
      approvedByUserId: latestRedTeamRun.approvedByUserId,
      approvedAt: latestRedTeamRun.approvedAt,
      approvalAttestation,
      openFindingCount: findings.filter(
        (finding) => finding.status !== "resolved",
      ).length,
    });
  }
  return { unsupportedClaimIds, requiresRedTeam: true, redTeamApproved };
}

router.get(
  "/projects/:id/reports",
  requirePermissionOrLegacy("report:read"),
  async (req: Request, res: Response) => {
    const projectId = String(req.params.id);
    const rows = await db
      .select({ report: reports, generatedByName: users.name })
      .from(reports)
      .leftJoin(users, eq(reports.generatedBy, users.id))
      .where(eq(reports.projectId, projectId))
      .orderBy(desc(reports.version));
    await writeAudit({
      user: getLocalUser(req),
      projectId,
      eventType: "report.viewed",
      objectType: "project",
      objectId: projectId,
      details: `${rows.length} report version(s)`,
    });
    res.json(rows.map((r) => serializeReport(r.report, r.generatedByName)));
  },
);

router.post(
  "/projects/:id/generate-report",
  requirePermissionOrLegacy("report:generate"),
  async (req: Request, res: Response) => {
    const projectId = String(req.params.id);
    // Serialise project-local max(version)+1 allocation inside the request's
    // tenant transaction. The unique index is the final concurrency backstop.
    await db.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${projectId}, 0))`,
    );
    const data = await gatherReportData(projectId);
    if (!data) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (!canGenerateReportForProjectStatus(data.project.status)) {
      res.status(409).json({
        error:
          "Report generation is only available during review, defects, or reporting.",
      });
      return;
    }
    const user = getLocalUser(req);
    const organisationId = getOrganisationId(req);
    const [{ maxVersion }] = await db
      .select({
        maxVersion: sql<number>`coalesce(max(${reports.version}), 0)::int`,
      })
      .from(reports)
      .where(eq(reports.projectId, projectId));
    const version = Number(maxVersion) + 1;
    data.version = version;
    data.generatedByName = user?.name ?? null;

    const uploadRendered = async (
      buffer: Buffer,
      mime: string,
    ): Promise<string> => {
      const uploadURL =
        await objectStorage.getObjectEntityUploadURL(organisationId);
      const putRes = await fetch(uploadURL, {
        method: "PUT",
        headers: { "Content-Type": mime },
        body: buffer,
      });
      if (!putRes.ok) throw new Error(`Upload failed: ${putRes.status}`);
      return objectStorage.normalizeObjectEntityPath(uploadURL);
    };

    let docxPath: string | null = null;
    let pdfPath: string | null = null;
    try {
      const [docxBuffer, pdfBuffer] = await Promise.all([
        buildReportDocx(data),
        buildReportPdf(data),
      ]);
      // Render both formats from the same report model so the DOCX and PDF are
      // content-identical; a failure in either aborts the whole generation.
      [docxPath, pdfPath] = await Promise.all([
        uploadRendered(docxBuffer, DOCX_MIME),
        uploadRendered(pdfBuffer, PDF_MIME),
      ]);
    } catch (error) {
      req.log.error({ err: error }, "report generation failed");
      res.status(500).json({ error: "Report generation failed" });
      return;
    }

    // The renderer currently persists into the tenant upload namespace. Hold
    // the same path locks as authenticated discard until both report
    // references commit, so cleanup cannot delete between upload and insert.
    for (const path of [docxPath, pdfPath]
      .filter((value): value is string => Boolean(value))
      .sort()) {
      await lockStagedUploadObject(path);
    }

    const created = await db.transaction(
      async (tx) => {
        const [lockedProject] = await tx
          .select({
            id: projects.id,
            organisationId: projects.organisationId,
            status: projects.status,
            version: projects.version,
          })
          .from(projects)
          .where(eq(projects.id, projectId))
          .for("update");
        if (
          !lockedProject ||
          lockedProject.organisationId !== data.project.organisationId ||
          lockedProject.version !== data.project.version ||
          !canGenerateReportForProjectStatus(lockedProject.status)
        ) {
          return null;
        }

        const [report] = await tx
          .insert(reports)
          .values({
            organisationId,
            projectId,
            version,
            status: "draft",
            docxPath,
            pdfPath,
            engineVersion: ENGINE_VERSION,
            promptPackVersion: PROMPT_PACK_VERSION,
            modelId: MODEL_ID,
            taxonomyVersion: TAXONOMY_VERSION,
            generatedBy: user?.id ?? null,
          })
          .returning();

        if (
          lockedProject.status === "defects" ||
          lockedProject.status === "review"
        ) {
          const [transitionedProject] = await tx
            .update(projects)
            .set({
              status: "reporting",
              version: sql`${projects.version} + 1`,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(projects.id, projectId),
                eq(projects.status, lockedProject.status),
                eq(projects.version, lockedProject.version),
              ),
            )
            .returning({ id: projects.id });
          if (!transitionedProject) {
            throw new Error("Project state changed during report generation");
          }
        }
        await writeAuditTx(tx, {
          user,
          organisationId,
          projectId,
          eventType: "report.generated",
          objectType: "report",
          objectId: report.id,
          details: `v${version}`,
        });
        return report;
      },
      { isolationLevel: "read committed" },
    );
    if (!created) {
      res.status(409).json({
        error:
          "Project state changed while the report was rendering. Refresh before generating another report.",
      });
      return;
    }
    await commitTenantDatabaseBeforeResponse(req);
    res.status(201).json(serializeReport(created, user?.name));
  },
);

router.post(
  "/reports/:id/sign-off",
  requirePermissionOrLegacy("report:sign_off"),
  async (req: Request, res: Response) => {
    const parsed = SignOffReportBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    const user = getLocalUser(req);
    const [report] = await db
      .select()
      .from(reports)
      .where(eq(reports.id, String(req.params.id)));
    if (!report) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const reportOrganisationId = report.organisationId;
    if (!reportOrganisationId) {
      res.status(409).json({
        error: "Report sign-off requires an organisation-bound report.",
      });
      return;
    }

    // Fatal-block invariant: a report cannot be signed off while any open
    // fatal or likely-fatal defect remains on the project. This is the
    // "process warranty" enforced in code — there is deliberately no override
    // path. The reviewer must resolve (remediate/waive) or downgrade the
    // defect first, which is itself an audited action.
    if (report.status !== "draft") {
      res.status(409).json({
        error: `Only a draft report can be signed off (current: ${report.status}).`,
      });
      return;
    }
    const latestReport = await latestReportForProject(report.projectId);
    if (!isLatestReportVersion(report, latestReport)) {
      await writeAudit({
        user,
        organisationId: getOrganisationId(req),
        projectId: report.projectId,
        eventType: "report.sign_off_denied",
        objectType: "report",
        objectId: report.id,
        details:
          "A newer report version exists; stale versions cannot be signed off.",
      });
      res
        .status(409)
        .json({ error: "Only the latest report version can be signed off." });
      return;
    }

    const [governance] = await db
      .select({ project: projects, ndaStatus: clients.ndaStatus })
      .from(projects)
      .leftJoin(clients, eq(projects.clientId, clients.id))
      .where(eq(projects.id, report.projectId));
    if (!governance) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    const signerDenial = reportSignerDenial({
      assignedReviewerId: governance.project.reviewerId,
      signerId: user?.id,
      accessSource: getAccessContext(req)?.source,
      membershipId: getAccessContext(req)?.membershipId,
    });
    if (signerDenial) {
      await writeAudit({
        user,
        organisationId: getOrganisationId(req),
        projectId: report.projectId,
        eventType: "report.sign_off_denied",
        objectType: "report",
        objectId: report.id,
        details: `Signer authority denied: ${signerDenial}.`,
      });
      res.status(403).json({
        error:
          "Only the assigned reviewer acting through an active direct grant may sign off.",
      });
      return;
    }
    if (governance.project.status !== "reporting") {
      await writeAudit({
        user,
        organisationId: getOrganisationId(req),
        projectId: report.projectId,
        eventType: "report.sign_off_denied",
        objectType: "report",
        objectId: report.id,
        details: `Project is ${governance.project.status}; expected reporting.`,
      });
      res
        .status(409)
        .json({ error: "Project must be in reporting state before sign-off." });
      return;
    }

    const [
      projectDocuments,
      projectRequirements,
      projectEvidence,
      projectDefects,
      projectBoqChecks,
      supplementalGates,
    ] = await Promise.all([
      db
        .select()
        .from(documents)
        .where(eq(documents.projectId, report.projectId)),
      db
        .select()
        .from(requirements)
        .where(eq(requirements.projectId, report.projectId)),
      db
        .select()
        .from(evidenceItems)
        .where(eq(evidenceItems.projectId, report.projectId)),
      db.select().from(defects).where(eq(defects.projectId, report.projectId)),
      db
        .select()
        .from(boqChecks)
        .where(eq(boqChecks.projectId, report.projectId)),
      gatherSupplementalReleaseGates(reportOrganisationId, report.projectId),
    ]);

    const readiness = evaluateSubmissionReadiness({
      project: {
        ndaStatus: governance.ndaStatus,
        reviewerId: governance.project.reviewerId,
        conflictStatus: governance.project.conflictStatus,
        paymentStatus: governance.project.paymentStatus,
        paymentConfirmedByFounder: governance.project.paymentConfirmedByFounder,
        paymentConfirmedByAdvisor: governance.project.paymentConfirmedByAdvisor,
        paymentFounderConfirmedBy: governance.project.paymentFounderConfirmedBy,
        paymentAdvisorConfirmedBy: governance.project.paymentAdvisorConfirmedBy,
        responsivenessSuggested: governance.project.responsivenessSuggested,
      },
      report: {
        generatedBy: report.generatedBy,
        engineVersion: report.engineVersion,
        promptPackVersion: report.promptPackVersion,
        modelId: report.modelId,
        taxonomyVersion: report.taxonomyVersion,
      },
      signerId: user?.id,
      documents: projectDocuments,
      requirements: projectRequirements,
      evidence: projectEvidence,
      defects: projectDefects,
      boqChecks: projectBoqChecks,
      ...supplementalGates,
      requireIndependentSignOff: true,
    });
    if (!readiness.ready) {
      await writeAudit({
        user,
        projectId: report.projectId,
        eventType: "report.sign_off_denied",
        objectType: "report",
        objectId: report.id,
        details: JSON.stringify({
          blockerCodes: readiness.blockers.map((blocker) => blocker.code),
        }),
      });
      res.status(409).json({
        error:
          "Report cannot be signed off until every submission-readiness invariant passes.",
        blockers: readiness.blockers,
      });
      return;
    }

    const reviewerName = user?.name || user?.email || "Unknown reviewer";
    const signOffAccessContext = getAccessContext(req);
    const assertCurrentSignerAuthority = (
      authority: Awaited<ReturnType<typeof resolveCurrentDirectAuthority>>,
    ): void => {
      if (
        !authority ||
        authority.organisationId !== reportOrganisationId ||
        authority.membershipId !== signOffAccessContext?.membershipId ||
        !authority.permissions.has("report:sign_off")
      ) {
        throw new ReportSignOffAuthorityError(
          "Signer membership or report sign-off grant changed during sign-off.",
        );
      }
    };
    let updated;
    try {
      updated = await db.transaction(async (tx) => {
        // The request context was resolved before the route ran and is only a
        // selector here. Re-derive authority from current durable membership
        // and grants inside the final transaction. The resolver takes the same
        // organisation-scoped advisory lock as membership administration, so
        // a concurrent revoke is ordered either wholly before this check (and
        // denied) or wholly after the committed sign-off.
        assertCurrentSignerAuthority(
          await resolveCurrentDirectAuthority(signOffAccessContext, user?.id),
        );

        // Inside the project advisory boundary already established by shared
        // middleware, client row -> project row is the canonical row-lock
        // order. A concurrent NDA change either completes before this re-read
        // or is serialized after sign-off; export rechecks current NDA state.
        const [lockedClient] = await tx
          .select({ id: clients.id, ndaStatus: clients.ndaStatus })
          .from(clients)
          .where(
            and(
              eq(clients.id, governance.project.clientId),
              eq(clients.organisationId, reportOrganisationId),
            ),
          )
          .for("share");
        if (!lockedClient) {
          throw new ReportSignOffConflictError(
            "Client governance changed during report sign-off.",
          );
        }

        const [lockedProject] = await tx
          .select()
          .from(projects)
          .where(
            and(
              eq(projects.id, report.projectId),
              eq(projects.organisationId, reportOrganisationId),
            ),
          )
          .for("update");
        if (
          !lockedProject ||
          lockedProject.status !== "reporting" ||
          lockedProject.version !== governance.project.version
        ) {
          throw new ReportSignOffConflictError(
            "Project state changed during report sign-off.",
          );
        }

        const [currentReport] = await tx
          .select()
          .from(reports)
          .where(
            and(
              eq(reports.id, report.id),
              eq(reports.projectId, report.projectId),
              eq(reports.organisationId, reportOrganisationId),
            ),
          )
          .for("update");
        if (!currentReport || currentReport.status !== "draft") {
          throw new ReportSignOffConflictError(
            "Report state changed during report sign-off.",
          );
        }

        const [currentLatestReport] = await tx
          .select({ id: reports.id })
          .from(reports)
          .where(eq(reports.projectId, report.projectId))
          .orderBy(desc(reports.version))
          .limit(1);
        if (currentLatestReport?.id !== report.id) {
          throw new ReportSignOffConflictError(
            "Report version changed during report sign-off.",
          );
        }

        // Recompute every release input only after the release locks are held.
        // The 0012 DB guards make project-bound rows contend on the locked
        // project, so this decision remains stable through the commit.
        const currentDocuments = await tx
          .select()
          .from(documents)
          .where(eq(documents.projectId, report.projectId));
        const currentRequirements = await tx
          .select()
          .from(requirements)
          .where(eq(requirements.projectId, report.projectId));
        const currentEvidence = await tx
          .select()
          .from(evidenceItems)
          .where(eq(evidenceItems.projectId, report.projectId));
        const currentDefects = await tx
          .select()
          .from(defects)
          .where(eq(defects.projectId, report.projectId));
        const currentBoqChecks = await tx
          .select()
          .from(boqChecks)
          .where(eq(boqChecks.projectId, report.projectId));
        const currentDeliveryGates = await gatherSupplementalReleaseGates(
          reportOrganisationId,
          report.projectId,
          tx,
        );
        const currentReadiness = evaluateSubmissionReadiness({
          project: {
            ndaStatus: lockedClient.ndaStatus,
            reviewerId: lockedProject.reviewerId,
            conflictStatus: lockedProject.conflictStatus,
            paymentStatus: lockedProject.paymentStatus,
            paymentConfirmedByFounder: lockedProject.paymentConfirmedByFounder,
            paymentConfirmedByAdvisor: lockedProject.paymentConfirmedByAdvisor,
            paymentFounderConfirmedBy: lockedProject.paymentFounderConfirmedBy,
            paymentAdvisorConfirmedBy: lockedProject.paymentAdvisorConfirmedBy,
            responsivenessSuggested: lockedProject.responsivenessSuggested,
          },
          report: {
            generatedBy: currentReport.generatedBy,
            engineVersion: currentReport.engineVersion,
            promptPackVersion: currentReport.promptPackVersion,
            modelId: currentReport.modelId,
            taxonomyVersion: currentReport.taxonomyVersion,
          },
          signerId: user?.id,
          documents: currentDocuments,
          requirements: currentRequirements,
          evidence: currentEvidence,
          defects: currentDefects,
          boqChecks: currentBoqChecks,
          ...currentDeliveryGates,
          requireIndependentSignOff: true,
        });
        if (!currentReadiness.ready) {
          throw new ReportSignOffConflictError(
            "Release inputs changed during report sign-off.",
            currentReadiness.blockers,
          );
        }

        const clock = await tx.execute<{ now: unknown }>(
          sql`SELECT pg_catalog.clock_timestamp() AS now`,
        );
        const signedOffAt = parseInstantViaString(clock.rows[0]?.now);
        if (signedOffAt === null) {
          throw new Error("Database clock is unavailable during sign-off");
        }
        // Bind the final authority decision to the exact timestamp recorded on
        // the sign-off. The advisory lock above has prevented administrative
        // revocation; this second read also closes a naturally expiring grant
        // window after readiness recomputation but before the report mutation.
        assertCurrentSignerAuthority(
          await resolveCurrentDirectAuthority(
            signOffAccessContext,
            user?.id,
            signedOffAt,
          ),
        );
        const [signed] = await tx
          .update(reports)
          .set({
            status: "signed_off",
            reviewerName,
            attestation: parsed.data.attestation,
            reviewerId: user?.id ?? null,
            signedOffAt,
            optimisticLockVersion: sql`${reports.optimisticLockVersion} + 1`,
            updatedAt: signedOffAt,
          })
          .where(and(eq(reports.id, report.id), eq(reports.status, "draft")))
          .returning();
        if (!signed) {
          throw new ReportSignOffConflictError(
            "Report state changed during report sign-off.",
          );
        }

        const [signedProject] = await tx
          .update(projects)
          .set({
            status: "signed_off",
            concludedAt: signed.signedOffAt,
            version: sql`${projects.version} + 1`,
            updatedAt: signedOffAt,
          })
          .where(
            and(
              eq(projects.id, signed.projectId),
              eq(projects.organisationId, reportOrganisationId),
              eq(projects.status, "reporting"),
              eq(projects.version, lockedProject.version),
            ),
          )
          .returning({ id: projects.id });
        if (!signedProject) {
          throw new ReportSignOffConflictError(
            "Project state changed during report sign-off.",
          );
        }
        await writeAuditTx(tx, {
          user,
          projectId: signed.projectId,
          eventType: "report.signed_off",
          objectType: "report",
          objectId: signed.id,
          details: `by ${reviewerName}`,
          createdAt: signedOffAt,
        });
        return signed;
      });
    } catch (error) {
      if (
        !(error instanceof ReportSignOffConflictError) &&
        !(error instanceof ReportSignOffAuthorityError)
      ) {
        throw error;
      }
      const authorityChanged = error instanceof ReportSignOffAuthorityError;
      await writeAudit({
        user,
        organisationId: reportOrganisationId,
        projectId: report.projectId,
        eventType: "report.sign_off_denied",
        objectType: "report",
        objectId: report.id,
        details: JSON.stringify({
          reason: error.message,
          blockerCodes:
            error instanceof ReportSignOffConflictError
              ? (error.blockers?.map((blocker) => blocker.code) ?? [])
              : [],
        }),
      });
      res.status(authorityChanged ? 403 : 409).json({
        error: authorityChanged
          ? "Report sign-off authority changed. Refresh your access before retrying."
          : "Report sign-off was denied because the release state changed. Refresh and review the current blockers.",
        ...(error instanceof ReportSignOffConflictError && error.blockers
          ? { blockers: error.blockers }
          : {}),
      });
      return;
    }
    await commitTenantDatabaseBeforeResponse(req);
    res.json(serializeReport(updated, user?.name));
  },
);

/**
 * Shared handler for the twin signed-report download endpoints (DOCX / PDF).
 * The two registrations differ only in which stored artefact path they serve,
 * the response MIME type/extension and the audit/log wording.
 */
function reportDownloadHandler(options: {
  pathField: "docxPath" | "pdfPath";
  mime: string;
  extension: "docx" | "pdf";
  denialPrefix: string;
  auditSuffix: string;
  logLabel: string;
}) {
  const { pathField, mime, extension, denialPrefix, auditSuffix, logLabel } =
    options;
  return async (req: Request, res: Response) => {
    const user = getLocalUser(req);
    const [report] = await db
      .select()
      .from(reports)
      .where(eq(reports.id, String(req.params.id)));
    const artefactPath = report?.[pathField];
    if (!report || !artefactPath) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const exportDenial = reportExportDenial(
      report,
      await latestReportForProject(report.projectId),
    );
    if (exportDenial) {
      await writeAudit({
        user,
        organisationId: getOrganisationId(req),
        projectId: report.projectId,
        eventType: "report.export_denied",
        objectType: "report",
        objectId: report.id,
        details: `${denialPrefix} blocked: ${exportDenial}.`,
      });
      res.status(exportDenial === "stale_version" ? 409 : 403).json({
        error:
          exportDenial === "stale_version"
            ? "Only the latest signed report version can be exported"
            : "Report must be signed off before it can be exported",
      });
      return;
    }
    try {
      const file = await objectStorage.getObjectEntityFile(artefactPath);
      const [buffer] = await file.download();
      res.setHeader("Content-Type", mime);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="bid-autopsy-report-v${report.version}.${extension}"`,
      );
      await writeAudit({
        user,
        projectId: report.projectId,
        eventType: "report.exported",
        objectType: "report",
        objectId: report.id,
        details: `Exported signed-off report v${report.version}${auditSuffix}.`,
      });
      res.send(buffer);
    } catch (error) {
      req.log.error({ err: error }, logLabel);
      res.status(404).json({ error: "Report file not found" });
    }
  };
}

router.get(
  "/reports/:id/download",
  requirePermissionOrLegacy("report:export"),
  reportDownloadHandler({
    pathField: "docxPath",
    mime: DOCX_MIME,
    extension: "docx",
    denialPrefix: "Export",
    auditSuffix: "",
    logLabel: "report download failed",
  }),
);

router.get(
  "/reports/:id/download-pdf",
  requirePermissionOrLegacy("report:export"),
  reportDownloadHandler({
    pathField: "pdfPath",
    mime: PDF_MIME,
    extension: "pdf",
    denialPrefix: "PDF export",
    auditSuffix: " (PDF)",
    logLabel: "report pdf download failed",
  }),
);

router.get(
  "/projects/:id/package-versions",
  requirePermissionOrLegacy("package:read"),
  async (req: Request, res: Response) => {
    const projectId = String(req.params.id);
    const organisationId = getOrganisationId(req);
    if (!organisationId || !UUID_ANY_PATTERN.test(projectId)) {
      res.status(403).json({ error: "Organisation access denied" });
      return;
    }
    await db.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${projectId}, 0))`,
    );
    const canonicalPackages = await db
      .select({ id: packages.id })
      .from(packages)
      .where(
        and(
          eq(packages.organisationId, organisationId),
          eq(packages.projectId, projectId),
          eq(packages.packageType, PROJECT_EXPORT_PACKAGE_TYPE),
        ),
      )
      .limit(2)
      .for("share");
    const canonicalPackageId =
      soleCanonicalProjectExportPackageId(canonicalPackages);
    const [currentReport] = await db
      .select({
        id: reports.id,
        version: reports.version,
        status: reports.status,
      })
      .from(reports)
      .where(
        and(
          eq(reports.organisationId, organisationId),
          eq(reports.projectId, projectId),
        ),
      )
      .orderBy(desc(reports.version), desc(reports.id))
      .limit(1)
      .for("share");
    const rows = canonicalPackageId
      ? await db
          .select({
            packageId: packages.id,
            packageVersionId: packageVersions.id,
            packageType: packages.packageType,
            versionNumber: packageVersions.versionNumber,
            manifestSha256: packageVersions.manifestHash,
            sourceSnapshotSha256: packageVersions.sourceSnapshotHash,
            renderQaStatus: packageVersions.renderQaStatus,
            createdAt: packageVersions.createdAt,
          })
          .from(packages)
          .innerJoin(
            packageVersions,
            and(
              eq(packageVersions.organisationId, packages.organisationId),
              eq(packageVersions.packageId, packages.id),
              eq(packageVersions.versionNumber, packages.currentVersionNumber),
            ),
          )
          .where(
            and(
              eq(packages.id, canonicalPackageId),
              eq(packages.organisationId, organisationId),
              eq(packages.projectId, projectId),
              eq(packages.packageType, PROJECT_EXPORT_PACKAGE_TYPE),
            ),
          )
          .orderBy(desc(packageVersions.createdAt), desc(packageVersions.id))
          .limit(PROJECT_EXPORT_PACKAGE_LIST_LIMIT + 1)
      : [];
    if (canonicalPackageId && rows.length !== 1) {
      throw new Error("Canonical package current version failed validation");
    }
    const truncated = rows.length > PROJECT_EXPORT_PACKAGE_LIST_LIMIT;
    const items = rows
      .slice(0, PROJECT_EXPORT_PACKAGE_LIST_LIMIT)
      .map((row) => {
        if (
          row.packageType !== PROJECT_EXPORT_PACKAGE_TYPE ||
          !isOneOf(row.renderQaStatus, ["pending", "passed", "failed"]) ||
          !UUID_ANY_PATTERN.test(row.packageId) ||
          !UUID_ANY_PATTERN.test(row.packageVersionId) ||
          !Number.isSafeInteger(row.versionNumber) ||
          row.versionNumber < 1 ||
          !SHA256_PATTERN.test(row.manifestSha256) ||
          !SHA256_PATTERN.test(row.sourceSnapshotSha256) ||
          !(row.createdAt instanceof Date) ||
          Number.isNaN(row.createdAt.getTime())
        ) {
          throw new Error("Canonical package version failed validation");
        }
        return {
          packageId: row.packageId,
          packageVersionId: row.packageVersionId,
          packageType: PROJECT_EXPORT_PACKAGE_TYPE,
          versionNumber: row.versionNumber,
          manifestSha256: row.manifestSha256,
          sourceSnapshotSha256: row.sourceSnapshotSha256,
          renderQaStatus: row.renderQaStatus,
          createdAt: row.createdAt.toISOString(),
        };
      });
    await writeAudit({
      user: getLocalUser(req),
      organisationId,
      projectId,
      eventType: "package.versions_viewed",
      objectType: "project",
      objectId: projectId,
      details: JSON.stringify({ count: items.length, truncated }),
    });
    res.setHeader("Cache-Control", "private, no-store");
    res.json({
      items,
      limit: PROJECT_EXPORT_PACKAGE_LIST_LIMIT,
      truncated,
      exportScopeSha256: exportScopeSha256(currentReport, {
        packageVersionId: items[0]?.packageVersionId ?? null,
        packageVersionNumber: items[0]?.versionNumber ?? null,
        packageManifestSha256: items[0]?.manifestSha256 ?? null,
        packageSourceSnapshotSha256: items[0]?.sourceSnapshotSha256 ?? null,
      }),
    });
  },
);

router.post(
  "/projects/:id/export",
  requirePermissionOrLegacy("report:export"),
  async (req: Request, res: Response) => {
    const projectId = String(req.params.id);
    const organisationId = getOrganisationId(req);
    const idempotencyKey = req.get("Idempotency-Key")?.trim() ?? "";
    const confirmedScopeHeader = req.get("If-Match")?.trim() ?? "";
    const confirmedScopeMatch = /^"([a-f0-9]{64})"$/u.exec(
      confirmedScopeHeader,
    );
    const confirmedScopeSha256 = confirmedScopeMatch?.[1] ?? "";
    const parsedBody = ExportProjectBody.strict().safeParse(req.body);
    if (
      !organisationId ||
      !UUID_ANY_PATTERN.test(projectId) ||
      !UUID_ANY_PATTERN.test(idempotencyKey) ||
      !confirmedScopeMatch ||
      !parsedBody.success ||
      !Number.isSafeInteger(parsedBody.data.reportVersion) ||
      !Number.isSafeInteger(parsedBody.data.packageVersionNumber ?? 1) ||
      !hasCompletePackageBinding(parsedBody.data)
    ) {
      res.status(400).json({ error: "Invalid exact export confirmation" });
      return;
    }
    const exportRequest = parsedBody.data;
    const requestSha256 = createHash("sha256")
      .update(
        JSON.stringify({
          organisationId,
          projectId,
          confirmedScopeSha256,
          exportRequest,
        }),
        "utf8",
      )
      .digest("hex");
    const idempotencyObjectId = createHash("sha256")
      .update(`${organisationId}\u0000${idempotencyKey}`, "utf8")
      .digest("hex");
    const [existingReceipt] = await db
      .select({ details: auditEvents.details })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organisationId, organisationId),
          eq(auditEvents.projectId, projectId),
          eq(auditEvents.eventType, "project.exported"),
          eq(auditEvents.objectType, "project_export_request"),
          eq(auditEvents.objectId, idempotencyObjectId),
        ),
      )
      .limit(1);
    if (existingReceipt) {
      const receipt = parseExportReceipt(existingReceipt.details);
      if (!receipt || receipt.requestSha256 !== requestSha256) {
        res.status(409).json({
          error: "Idempotency key was already bound to another export scope.",
        });
        return;
      }
    }
    const [governance] = await db
      .select({
        project: projects,
        clientId: clients.id,
        ndaStatus: clients.ndaStatus,
        ndaVersion: clients.version,
      })
      .from(projects)
      .leftJoin(clients, eq(projects.clientId, clients.id))
      .where(
        and(
          eq(projects.id, projectId),
          eq(projects.organisationId, organisationId),
        ),
      );
    if (!governance) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const project = governance.project;
    const projectReports = await db
      .select()
      .from(reports)
      .where(
        and(
          eq(reports.organisationId, organisationId),
          eq(reports.projectId, projectId),
        ),
      )
      .orderBy(desc(reports.version));
    const latestReport = projectReports[0];
    const packageDenial = packageExportDenial({
      projectStatus: project.status,
      physicalArchiveInstruction: project.physicalArchiveInstruction,
      latestReport,
    });
    if (packageDenial) {
      await writeAudit({
        user: getLocalUser(req),
        organisationId: getOrganisationId(req),
        projectId,
        eventType: "project.export_denied",
        objectType: "project",
        objectId: projectId,
        details: `Package export blocked: ${packageDenial}.`,
      });
      res.status(409).json({
        error:
          "Package export requires the latest signed report and archive handling instruction.",
      });
      return;
    }
    const [
      reqs,
      ev,
      defs,
      boqs,
      activeAudits,
      archivedAudits,
      projectDocuments,
      supplementalGates,
    ] = await Promise.all([
      db
        .select()
        .from(requirements)
        .where(eq(requirements.projectId, projectId)),
      db
        .select()
        .from(evidenceItems)
        .where(eq(evidenceItems.projectId, projectId)),
      db.select().from(defects).where(eq(defects.projectId, projectId)),
      db.select().from(boqChecks).where(eq(boqChecks.projectId, projectId)),
      db.select().from(auditEvents).where(eq(auditEvents.projectId, projectId)),
      db
        .select()
        .from(legacyAuditEvents)
        .where(eq(legacyAuditEvents.projectId, projectId)),
      db.select().from(documents).where(eq(documents.projectId, projectId)),
      gatherSupplementalReleaseGates(project.organisationId, projectId),
    ]);
    const readiness = evaluateSubmissionReadiness({
      project: {
        ndaStatus: governance.ndaStatus,
        reviewerId: project.reviewerId,
        conflictStatus: project.conflictStatus,
        paymentStatus: project.paymentStatus,
        paymentConfirmedByFounder: project.paymentConfirmedByFounder,
        paymentConfirmedByAdvisor: project.paymentConfirmedByAdvisor,
        paymentFounderConfirmedBy: project.paymentFounderConfirmedBy,
        paymentAdvisorConfirmedBy: project.paymentAdvisorConfirmedBy,
        responsivenessSuggested: project.responsivenessSuggested,
      },
      report: {
        generatedBy: latestReport!.generatedBy,
        engineVersion: latestReport!.engineVersion,
        promptPackVersion: latestReport!.promptPackVersion,
        modelId: latestReport!.modelId,
        taxonomyVersion: latestReport!.taxonomyVersion,
      },
      signerId: latestReport!.reviewerId,
      documents: projectDocuments,
      requirements: reqs,
      evidence: ev,
      defects: defs,
      boqChecks: boqs,
      ...supplementalGates,
      requireIndependentSignOff: true,
    });
    if (!readiness.ready) {
      await writeAudit({
        user: getLocalUser(req),
        organisationId: getOrganisationId(req),
        projectId,
        eventType: "project.export_denied",
        objectType: "project",
        objectId: projectId,
        details: JSON.stringify({
          blockerCodes: readiness.blockers.map((blocker) => blocker.code),
        }),
      });
      res.status(409).json({
        error: "Package export readiness changed or is incomplete.",
        blockers: readiness.blockers,
      });
      return;
    }
    // Document manifest for the export: intake metadata + SHA-256 so the
    // recipient can independently verify file integrity. Deliberately excludes
    // contentText (bulky, and the files themselves are the source of truth).
    const docManifest = await db
      .select({
        id: documents.id,
        type: documents.type,
        filename: documents.filename,
        objectPath: documents.objectPath,
        contentType: documents.contentType,
        size: documents.size,
        sha256: documents.sha256,
        source: documents.source,
        dateReceived: documents.dateReceived,
        redactionStatus: documents.redactionStatus,
        extractionStatus: documents.extractionStatus,
        createdAt: documents.createdAt,
      })
      .from(documents)
      .where(eq(documents.projectId, projectId));
    // Fetch the signed DOCX *before* committing to the response stream. This is
    // the only fallible, mid-stream I/O in the export, and once we've flushed
    // 200 + zip headers we can no longer turn a failure into a real error
    // status. Downloading it up front means a fatal fetch failure produces a
    // clean non-200, and the archive is only ever streamed from in-memory data.
    // The package is not valid without the governed report artefact.
    let reportDocx: { name: string; buffer: Buffer };
    try {
      const file = await objectStorage.getObjectEntityFile(
        latestReport!.docxPath!,
      );
      const [buffer] = await file.download();
      reportDocx = {
        name: `bid-autopsy-report-v${latestReport!.version}.docx`,
        buffer,
      };
    } catch (error) {
      req.log.error({ err: error }, "could not attach signed report to export");
      await writeAudit({
        user: getLocalUser(req),
        organisationId: getOrganisationId(req),
        projectId,
        eventType: "project.export_denied",
        objectType: "project",
        objectId: projectId,
        details: "Latest signed report artefact could not be loaded.",
      });
      res
        .status(502)
        .json({ error: "Latest signed report artefact is unavailable." });
      return;
    }

    // Flag review state so recipients can tell reviewer-confirmed findings from
    // raw AI suggestions, mirroring how the signed DOCX report segregates them.
    const byId = <T extends { id: string }>(rows: readonly T[]): T[] =>
      [...rows].sort((left, right) => left.id.localeCompare(right.id));
    const orderedRequirements = byId(reqs);
    const reqsCsv = withReviewState(
      orderedRequirements,
      requirementReviewState,
    );
    const evCsv = withReviewState(byId(ev), suggestedFlagReviewState);
    const defsCsv = withReviewState(byId(defs), suggestedFlagReviewState);
    const exportTransitionAt =
      project.status === "signed_off" ? new Date() : project.updatedAt;
    const canonicalProject =
      project.status === "signed_off"
        ? {
            ...project,
            status: "exported" as const,
            version: project.version + 1,
            updatedAt: exportTransitionAt,
          }
        : project;
    const auditRows = [
      ...[...activeAudits]
        .filter(includeAuditEventInProjectExport)
        .sort((left, right) => left.seq - right.seq)
        .map((event) => ({
          ...event,
          auditSource: "active_v2",
          integrityStatus: "active_v2_record",
        })),
      ...byId(archivedAudits).map((event) => ({
        ...event,
        auditSource: "legacy_v1_archive",
      })),
    ];
    const scorecard = computeScorecard(
      orderedRequirements.map((requirement) => ({
        sourceDocId: requirement.sourceDocId,
        origin: requirement.origin,
        isMandatory: requirement.isMandatory,
        reviewStatus: requirement.reviewStatus,
      })),
    );
    const aggregateSource = {
      sourceObjectId: projectId,
      sourceVersion: canonicalProject.version,
    } as const;
    const archiveEntries: ProjectExportArchiveEntry[] = [
      {
        itemType: "project_snapshot",
        ...aggregateSource,
        filename: "project.json",
        bytes: Buffer.from(JSON.stringify(canonicalProject, null, 2), "utf8"),
      },
      {
        itemType: "requirement_register",
        ...aggregateSource,
        filename: "requirements.csv",
        bytes: Buffer.from(toCsv(reqsCsv), "utf8"),
      },
      {
        itemType: "evidence_register",
        ...aggregateSource,
        filename: "evidence.csv",
        bytes: Buffer.from(toCsv(evCsv), "utf8"),
      },
      {
        itemType: "defect_register",
        ...aggregateSource,
        filename: "defects.csv",
        bytes: Buffer.from(toCsv(defsCsv), "utf8"),
      },
      {
        itemType: "boq_register",
        ...aggregateSource,
        filename: "boq_checks.csv",
        bytes: Buffer.from(toCsv(byId(boqs)), "utf8"),
      },
      {
        itemType: "audit_register",
        ...aggregateSource,
        filename: "audit_events.csv",
        bytes: Buffer.from(toCsv(auditRows), "utf8"),
      },
      {
        itemType: "audit_export_policy",
        ...aggregateSource,
        filename: "audit_export_policy.json",
        bytes: Buffer.from(
          JSON.stringify(PROJECT_EXPORT_AUDIT_POLICY, null, 2),
          "utf8",
        ),
      },
      {
        itemType: "document_manifest",
        ...aggregateSource,
        filename: "documents_manifest.csv",
        bytes: Buffer.from(toCsv(byId(docManifest)), "utf8"),
      },
      {
        itemType: "technical_scorecard",
        ...aggregateSource,
        filename: "scorecard.json",
        bytes: Buffer.from(JSON.stringify(scorecard, null, 2), "utf8"),
      },
      {
        itemType: "signed_report",
        sourceObjectId: latestReport!.id,
        sourceVersion: latestReport!.version,
        filename: reportDocx.name,
        bytes: reportDocx.buffer,
      },
    ];
    const packageManifest = buildCanonicalProjectExportManifest(
      {
        organisationId: getOrganisationId(req)!,
        projectId,
        projectVersion: canonicalProject.version,
        reportId: latestReport!.id,
        reportVersion: latestReport!.version,
      },
      archiveEntries,
    );

    let zipBuffer: Buffer;
    try {
      zipBuffer = await buildProjectExportZip(archiveEntries);
    } catch (error) {
      req.log.error({ err: error }, "project export archive assembly failed");
      await writeAudit({
        user: getLocalUser(req),
        organisationId: getOrganisationId(req),
        projectId,
        eventType: "project.export_denied",
        objectType: "project",
        objectId: projectId,
        details:
          "Package export archive assembly failed before release evidence was persisted.",
      });
      res.status(502).json({
        error:
          "Package export could not be assembled. Refresh before retrying.",
      });
      return;
    }

    const authorityLoss = new PackageExportGovernanceError(
      "Package export authority changed or expired before persistence.",
      null,
      true,
    );
    const exportAccessContext = getAccessContext(req);
    const exportActorId = getLocalUser(req)?.id;
    const retainsExportAuthority = () =>
      hasCurrentAccessPermission(
        exportAccessContext,
        exportActorId,
        "report:export",
      );
    try {
      await db.transaction(
        async (tx) => {
          if (!(await retainsExportAuthority())) throw authorityLoss;
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${projectId}, 0))`,
          );
          const finalReceipts = await tx
            .select({ details: auditEvents.details })
            .from(auditEvents)
            .where(
              and(
                eq(auditEvents.organisationId, organisationId),
                eq(auditEvents.projectId, projectId),
                eq(auditEvents.eventType, "project.exported"),
                eq(auditEvents.objectType, "project_export_request"),
                eq(auditEvents.objectId, idempotencyObjectId),
              ),
            )
            .limit(2)
            .for("share");
          if (finalReceipts.length > 1) {
            throw new PackageExportDriftError(
              "Export idempotency receipt is ambiguous.",
            );
          }
          const finalReceipt = finalReceipts[0]
            ? parseExportReceipt(finalReceipts[0].details)
            : null;
          if (
            finalReceipts[0] &&
            (!finalReceipt || finalReceipt.requestSha256 !== requestSha256)
          ) {
            throw new PackageExportDriftError(
              "Idempotency key was already bound to another export scope.",
            );
          }
          const [currentProject] = await tx
            .select({
              id: projects.id,
              clientId: projects.clientId,
              status: projects.status,
              version: projects.version,
            })
            .from(projects)
            .where(
              and(
                eq(projects.id, projectId),
                eq(projects.organisationId, organisationId),
              ),
            )
            .for("share");
          const [currentReport] = await tx
            .select()
            .from(reports)
            .where(
              and(
                eq(reports.organisationId, organisationId),
                eq(reports.projectId, projectId),
              ),
            )
            .orderBy(desc(reports.version), desc(reports.id))
            .limit(1)
            .for("share");
          if (
            !currentProject ||
            currentProject.clientId !== project.clientId ||
            (finalReceipt
              ? currentProject.status !== "exported" ||
                currentProject.version !== canonicalProject.version
              : currentProject.status !== project.status ||
                currentProject.version !== project.version) ||
            !currentReport ||
            currentReport.id !== exportRequest.reportId ||
            currentReport.version !== exportRequest.reportVersion ||
            currentReport.status !== "signed_off" ||
            currentReport.docxPath !== latestReport!.docxPath ||
            currentReport.updatedAt?.getTime() !==
              latestReport!.updatedAt?.getTime()
          ) {
            throw new PackageExportDriftError(
              "Report or project source material changed during package export.",
            );
          }
          const lockedPackages = await tx
            .select({ id: packages.id })
            .from(packages)
            .where(
              and(
                eq(packages.organisationId, organisationId),
                eq(packages.projectId, projectId),
                eq(packages.packageType, PROJECT_EXPORT_PACKAGE_TYPE),
              ),
            )
            .limit(2)
            .for("update");
          const lockedPackageId =
            soleCanonicalProjectExportPackageId(lockedPackages);
          const [lockedPackageVersion] = lockedPackageId
            ? await tx
                .select({
                  id: packageVersions.id,
                  versionNumber: packageVersions.versionNumber,
                  manifestSha256: packageVersions.manifestHash,
                  sourceSnapshotSha256: packageVersions.sourceSnapshotHash,
                })
                .from(packages)
                .innerJoin(
                  packageVersions,
                  and(
                    eq(packageVersions.organisationId, packages.organisationId),
                    eq(packageVersions.packageId, packages.id),
                    eq(
                      packageVersions.versionNumber,
                      packages.currentVersionNumber,
                    ),
                  ),
                )
                .where(eq(packages.id, lockedPackageId))
                .limit(1)
                .for("share")
            : [];
          const lockedPackageBinding: ExportPackageBinding = {
            packageVersionId: lockedPackageVersion?.id ?? null,
            packageVersionNumber: lockedPackageVersion?.versionNumber ?? null,
            packageManifestSha256: lockedPackageVersion?.manifestSha256 ?? null,
            packageSourceSnapshotSha256:
              lockedPackageVersion?.sourceSnapshotSha256 ?? null,
          };
          const requestedPackageBinding: ExportPackageBinding = {
            packageVersionId: exportRequest.packageVersionId,
            packageVersionNumber: exportRequest.packageVersionNumber,
            packageManifestSha256: exportRequest.packageManifestSha256,
            packageSourceSnapshotSha256:
              exportRequest.packageSourceSnapshotSha256,
          };
          if (finalReceipt) {
            if (
              JSON.stringify(lockedPackageBinding) !==
              JSON.stringify({
                packageVersionId: finalReceipt.packageVersionId,
                packageVersionNumber: finalReceipt.packageVersionNumber,
                packageManifestSha256: finalReceipt.packageManifestSha256,
                packageSourceSnapshotSha256:
                  finalReceipt.packageSourceSnapshotSha256,
              })
            ) {
              throw new PackageExportDriftError(
                "The package created for this idempotent request is no longer current.",
              );
            }
          } else if (
            exportScopeSha256(currentReport, lockedPackageBinding) !==
              confirmedScopeSha256 ||
            JSON.stringify(lockedPackageBinding) !==
              JSON.stringify(requestedPackageBinding)
          ) {
            throw new PackageExportDriftError(
              "Confirmed package provenance changed during package export.",
            );
          }
          // Package bytes and their manifest were prepared from the earlier
          // readiness snapshot. Re-lock and re-read the authoritative client
          // row immediately before writing durable package/export evidence.
          // A concurrent NDA change must therefore commit before this read
          // (and fail the version/state check), or wait until this export has
          // committed. No stale approval can authorize a package.
          const [currentClient] = await tx
            .select({
              id: clients.id,
              ndaStatus: clients.ndaStatus,
              version: clients.version,
            })
            .from(clients)
            .where(
              and(
                eq(clients.id, project.clientId),
                eq(clients.organisationId, project.organisationId!),
              ),
            )
            .for("share");
          if (
            !currentClient ||
            currentClient.id !== governance.clientId ||
            currentClient.ndaStatus !== "signed" ||
            currentClient.version !== governance.ndaVersion
          ) {
            throw new PackageExportGovernanceError(
              "Client NDA state or version changed during package export.",
              currentClient?.ndaStatus ?? null,
            );
          }
          if (!(await retainsExportAuthority())) throw authorityLoss;

          // A completed request is a read-only replay. The advisory lock makes
          // concurrent same-key calls observe the first receipt; matching the
          // rebuilt manifest to that receipt guarantees the returned bytes are
          // still bound to the original canonical package without creating a
          // version, transition, or duplicate audit event.
          if (finalReceipt) {
            if (
              packageManifest.manifestHash !==
                finalReceipt.packageManifestSha256 ||
              packageManifest.sourceSnapshotHash !==
                finalReceipt.packageSourceSnapshotSha256
            ) {
              throw new PackageExportDriftError(
                "Rebuilt archive no longer matches the idempotency receipt.",
              );
            }
            return;
          }

          const packageVersion = await persistCanonicalProjectExportPackage(
            tx,
            {
              identity: {
                organisationId: getOrganisationId(req)!,
                projectId,
                projectVersion: canonicalProject.version,
                reportId: latestReport!.id,
                reportVersion: latestReport!.version,
              },
              manifest: packageManifest,
              generatedByUserId: getLocalUser(req)?.id ?? null,
            },
          );
          await writeAuditTx(tx, {
            user: getLocalUser(req),
            organisationId,
            projectId,
            eventType: "project.exported",
            objectType: "project_export_request",
            objectId: idempotencyObjectId,
            details: JSON.stringify({
              requestSha256,
              packageVersionId: packageVersion.packageVersionId,
              packageVersionNumber: packageVersion.versionNumber,
              packageManifestSha256: packageVersion.manifestHash,
              packageSourceSnapshotSha256: packageVersion.sourceSnapshotHash,
            } satisfies ExportReceipt),
          });
          if (project.status === "signed_off") {
            const transitioned = await tx
              .update(projects)
              .set({
                status: "exported",
                version: sql`${projects.version} + 1`,
                updatedAt: exportTransitionAt,
              })
              .where(
                and(
                  eq(projects.id, projectId),
                  eq(projects.organisationId, getOrganisationId(req)!),
                  eq(projects.status, "signed_off"),
                  eq(projects.version, project.version),
                ),
              )
              .returning({ id: projects.id });
            if (transitioned.length !== 1) {
              throw new Error("Project export status CAS failed");
            }
          }
          await writeAuditTx(tx, {
            user: getLocalUser(req),
            organisationId: getOrganisationId(req),
            projectId,
            eventType: packageVersion.created
              ? "package.project_export_version_created"
              : "package.project_export_version_reused",
            objectType: "package_version",
            objectId: packageVersion.packageVersionId,
            details: JSON.stringify({
              packageId: packageVersion.packageId,
              versionNumber: packageVersion.versionNumber,
              sourceSnapshotHash: packageVersion.sourceSnapshotHash,
              manifestHash: packageVersion.manifestHash,
              entryCount: packageManifest.items.length,
              renderQaStatus: packageVersion.renderQaStatus,
            }),
          });
          await writeAuditTx(tx, {
            user: getLocalUser(req),
            organisationId: getOrganisationId(req),
            projectId,
            eventType: "project.exported",
            objectType: "project",
            objectId: projectId,
          });
        },
        { isolationLevel: "read committed" },
      );
    } catch (error) {
      if (error instanceof PackageExportDriftError) {
        await writeAudit({
          user: getLocalUser(req),
          organisationId,
          projectId,
          eventType: "project.export_denied",
          objectType: "project",
          objectId: projectId,
          details: error.message,
        });
        res.status(409).json({
          error:
            "The confirmed report, package provenance or source material changed. Refresh before exporting.",
        });
        return;
      }
      if (!(error instanceof PackageExportGovernanceError)) throw error;
      const ndaApprovalMissing = error.ndaStatus !== "signed";
      await writeAudit({
        user: getLocalUser(req),
        organisationId: getOrganisationId(req),
        projectId,
        eventType: "project.export_denied",
        objectType: "project",
        objectId: projectId,
        details: error.message,
      });
      if (error.authorityLost) {
        res.status(403).json({
          error: "Package export authority changed. Refresh before retrying.",
        });
        return;
      }
      res.status(409).json({
        error: ndaApprovalMissing
          ? "Package export was denied because NDA approval changed. Refresh before retrying."
          : "Package export was denied because client governance changed. Refresh before retrying.",
        ...(ndaApprovalMissing
          ? {
              blockers: [
                {
                  code: "nda_missing",
                  message:
                    "A current signed NDA is required for package export.",
                },
              ],
            }
          : {}),
      });
      return;
    }

    // The ZIP is already complete. Commit the locked governance decision and
    // durable package evidence before exposing any response headers or bytes.
    // A failed archive or COMMIT therefore cannot look like a successful
    // download to the caller.
    await commitTenantDatabaseBeforeResponse(req);

    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="project-export-${projectId}.zip"`,
    );
    res.setHeader("Content-Length", zipBuffer.byteLength);
    res.send(zipBuffer);
  },
);

export default router;
