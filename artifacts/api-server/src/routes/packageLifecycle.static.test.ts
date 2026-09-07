import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const reports = readFileSync(new URL("./reports.ts", import.meta.url), "utf8");
const lifecycle = readFileSync(
  new URL("../lib/projectExportPackage.ts", import.meta.url),
  "utf8",
);
const operationsRoute = readFileSync(
  new URL("./operationsSuite.ts", import.meta.url),
  "utf8",
);
const operationsService = readFileSync(
  new URL("../lib/operationsSuite/service.ts", import.meta.url),
  "utf8",
);
const durableStore = readFileSync(
  new URL("../lib/operationsSuite/drizzleStore.ts", import.meta.url),
  "utf8",
);
const retentionRoute = readFileSync(
  new URL("./retentionCompletion.ts", import.meta.url),
  "utf8",
);
const retentionService = readFileSync(
  new URL("../lib/retentionCompletion/service.ts", import.meta.url),
  "utf8",
);
const retentionRepository = readFileSync(
  new URL("../lib/retentionCompletion/drizzleRepository.ts", import.meta.url),
  "utf8",
);
const tenancy = readFileSync(
  new URL("../middlewares/tenancy.ts", import.meta.url),
  "utf8",
);
const projectRoutePolicy = readFileSync(
  new URL("../lib/projectRoutePolicy.ts", import.meta.url),
  "utf8",
);

test("governed export persists one canonical metadata-only package lifecycle", () => {
  assert.match(
    lifecycle,
    /pg_advisory_xact_lock\(hashtextextended\(\$\{identity\.projectId\}, 0\)\)/u,
  );
  assert.match(
    lifecycle,
    /eq\(packages\.packageType, PROJECT_EXPORT_PACKAGE_TYPE\)/u,
  );
  assert.match(
    lifecycle,
    /soleCanonicalProjectExportPackageId\(existingPackages\)/u,
  );
  assert.match(lifecycle, /\.insert\(packageVersions\)/u);
  assert.match(lifecycle, /renderQaStatus: "pending"/u);
  assert.match(lifecycle, /tx\.insert\(packageManifestItems\)/u);
  assert.match(lifecycle, /eq\(packages\.version, packageRow\.version\)/u);
  assert.match(lifecycle, /Canonical project export package CAS failed/u);
  assert.match(reports, /buildCanonicalProjectExportManifest\(/u);
  assert.match(reports, /persistCanonicalProjectExportPackage\(\s*tx,/u);
  assert.match(reports, /package\.project_export_version_created/u);
  assert.match(reports, /\.filter\(includeAuditEventInProjectExport\)/u);
  assert.match(reports, /filename: "audit_export_policy\.json"/u);
  assert.match(
    reports,
    /status: "exported" as const,[\s\S]*version: project\.version \+ 1,[\s\S]*updatedAt: exportTransitionAt/u,
  );
  assert.match(reports, /JSON\.stringify\(canonicalProject, null, 2\)/u);
});

test("package discovery is bounded, package-reader-only and content-free", () => {
  const start = reports.indexOf('"/projects/:id/package-versions"');
  const end = reports.indexOf('"/projects/:id/export"', start);
  assert.ok(start >= 0 && end > start);
  const endpoint = reports.slice(start, end);
  assert.match(endpoint, /requirePermissionOrLegacy\("package:read"\)/u);
  assert.match(endpoint, /PROJECT_EXPORT_PACKAGE_LIST_LIMIT \+ 1/u);
  assert.match(endpoint, /\.limit\(2\)\s*\.for\("share"\)/u);
  assert.match(
    endpoint,
    /soleCanonicalProjectExportPackageId\(canonicalPackages\)/u,
  );
  for (const field of [
    "packageId",
    "packageVersionId",
    "manifestSha256",
    "sourceSnapshotSha256",
    "exportScopeSha256",
    "renderQaStatus",
    "createdAt",
  ]) {
    assert.match(endpoint, new RegExp(`${field}:`, "u"));
  }
  assert.doesNotMatch(
    endpoint,
    /readinessSnapshot|docxObjectPath|pdfObjectPath|zipObjectPath|bytes|contentText/u,
  );
  assert.match(
    endpoint,
    /sourceSnapshotSha256: packageVersions\.sourceSnapshotHash/u,
  );
  assert.match(endpoint, /UUID_ANY_PATTERN\.test\(row\.packageId\)/u);
  assert.match(endpoint, /UUID_ANY_PATTERN\.test\(row\.packageVersionId\)/u);
  assert.match(endpoint, /Number\.isSafeInteger\(row\.versionNumber\)/u);
  assert.match(endpoint, /SHA256_PATTERN\.test\(row\.manifestSha256\)/u);
  assert.match(endpoint, /SHA256_PATTERN\.test\(row\.sourceSnapshotSha256\)/u);
  assert.match(endpoint, /Number\.isNaN\(row\.createdAt\.getTime\(\)\)/u);
  assert.match(endpoint, /Cache-Control", "private, no-store/u);
});

test("QA and export share the project lock and render QA changes use CAS", () => {
  const loaderStart = operationsRoute.indexOf(
    "async function loadCanonicalPackageVersion(",
  );
  const loaderEnd = operationsRoute.indexOf(
    "/**\n * Existing-schema reference guard",
    loaderStart,
  );
  const loader = operationsRoute.slice(loaderStart, loaderEnd);
  const exportLock = loader.indexOf("${scope.projectId}");
  const operationsLock = loader.indexOf(
    "${`${scope.organisationId}:${scope.projectId}`}",
    exportLock + 1,
  );
  assert.ok(loaderStart >= 0 && loaderEnd > loaderStart);
  assert.ok(exportLock >= 0 && operationsLock > exportLock);
  assert.match(
    loader,
    /pg_advisory_xact_lock\(hashtextextended\(\$\{scope\.projectId\}, 0\)\)/u,
  );
  assert.match(loader, /\.limit\(2\)\s*\.for\("share"\)/u);
  assert.match(
    loader,
    /soleCanonicalProjectExportPackageId\(canonicalPackages\)/u,
  );
  const storeLockStart = durableStore.indexOf("async #lockScope(");
  const storeLockEnd = durableStore.indexOf(
    "async #boundedIds(",
    storeLockStart,
  );
  const storeLock = durableStore.slice(storeLockStart, storeLockEnd);
  assert.ok(
    storeLock.indexOf("${scope.projectId}") >= 0 &&
      storeLock.indexOf("${scope.projectId}") <
        storeLock.indexOf("${`${scope.organisationId}:${scope.projectId}`}"),
  );
  assert.match(
    operationsRoute,
    /eq\(packageVersions\.renderQaStatus, version\.renderQaStatus\)/u,
  );
  assert.match(
    operationsRoute,
    /Canonical package render QA status CAS failed/u,
  );
  assert.match(
    operationsService,
    /assertPackageVersion\(scope, input\.packageVersionId, \{[\s\S]*expectedManifestSha256: input\.expectedManifestSha256,[\s\S]*\}\);[\s\S]*evaluateVisualPackageQa/u,
  );
  const visualQaStart = operationsService.indexOf(
    "async createVisualQaReport(",
  );
  const credentialStart = operationsService.indexOf(
    "async createCredentialVerification(",
    visualQaStart,
  );
  const visualQa = operationsService.slice(visualQaStart, credentialStart);
  assert.doesNotMatch(visualQa, /requireRenderQaPassed/u);
  assert.match(visualQa, /setPackageRenderQaResult/u);
});

test("every non-cancellation post-freeze transition rechecks the latest clean QA", () => {
  assert.match(
    operationsService,
    /if \(input\.toStatus === "cancelled"\)[\s\S]*return this\.#touch[\s\S]*input\.toStatus === "frozen" \|\| record\.status !== "planning"[\s\S]*#assertLatestCleanPackageQa\(scope, record\)/u,
  );
  assert.match(
    operationsService,
    /latest\.result\.status === "review"[\s\S]*latest\.result\.findings\.length > 0/u,
  );
  assert.match(operationsService, /requireRenderQaPassed: true/u);
});

test("released content immutability admits only exact package/post-award ledger routes", () => {
  assert.match(
    projectRoutePolicy,
    /projectStatus === "signed_off" \|\| projectStatus === "exported"/u,
  );
  for (const route of [
    "submission-war-rooms",
    "visual-qa-reports",
    "post-award-items",
  ]) {
    assert.match(
      projectRoutePolicy,
      new RegExp(`operations-suite\\\\/${route}`, "u"),
    );
  }
  assert.match(projectRoutePolicy, /released_append_only_ledger/u);
  assert.match(projectRoutePolicy, /released_export_command/u);
  assert.match(
    tenancy,
    /isProjectContentImmutable\(project\.status\)[\s\S]*!canMutateReleasedOperationsLedger\([\s\S]*project\.status,[\s\S]*req\.method,[\s\S]*req\.path/u,
  );
});

test("retention completion cannot synchronously remove package rows or blobs", () => {
  assert.match(retentionRoute, /RETENTION_COMPLETION_NOT_ACTIVATED/u);
  assert.match(retentionRoute, /sideEffectsApplied: false/u);
  assert.match(
    retentionService,
    /async detach\([\s\S]*?this\.#assertActivated\(\);[\s\S]*?this\.#repository\.detach\(/u,
  );
  assert.match(retentionRepository, /enqueueStorageDeletionIntentTx/u);
  assert.doesNotMatch(retentionRoute, /\.delete\(package/u);
  assert.doesNotMatch(retentionRoute, /planProjectBlobPurge|purgeBlobs/u);
  assert.doesNotMatch(
    retentionRepository,
    /ObjectStorageService|deleteObjectEntity|planProjectBlobPurge|purgeBlobs/u,
  );
  assert.doesNotMatch(retentionRoute, /package_versions=/u);
});
