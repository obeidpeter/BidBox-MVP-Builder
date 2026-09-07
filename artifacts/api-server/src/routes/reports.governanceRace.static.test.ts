import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";

const source = readFileSync(new URL("./reports.ts", import.meta.url), "utf8");
const authoritySource = readFileSync(
  new URL("../lib/directMembershipAuthority.ts", import.meta.url),
  "utf8",
);
const membershipWriterSource = readFileSync(
  new URL("./organisations.ts", import.meta.url),
  "utf8",
);
const tenancySource = readFileSync(
  new URL("../middlewares/tenancy.ts", import.meta.url),
  "utf8",
);
const routeIndexSource = readFileSync(
  new URL("./index.ts", import.meta.url),
  "utf8",
);

function routeSource(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `missing route marker: ${startMarker}`);
  assert.ok(end > start, `missing route end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("report sign-off revalidates current direct grant inside the final transaction", () => {
  const handler = routeSource(
    '"/reports/:id/sign-off"',
    "function reportDownloadHandler",
  );
  const transaction = handler.indexOf("updated = await db.transaction");
  const authorityLock = handler.indexOf(
    "resolveCurrentDirectAuthority(",
    transaction,
  );
  const clientLock = handler.indexOf('.for("share")', authorityLock);
  const finalAuthority = handler.indexOf(
    "resolveCurrentDirectAuthority(",
    authorityLock + 1,
  );
  const reportMutation = handler.indexOf("const [signed]", finalAuthority);

  assert.ok(transaction >= 0);
  assert.ok(authorityLock > transaction);
  assert.ok(clientLock > authorityLock);
  assert.ok(finalAuthority > clientLock);
  assert.ok(reportMutation > finalAuthority);
  assert.match(
    handler,
    /authority\.membershipId !== signOffAccessContext\?\.membershipId/u,
  );
  assert.match(handler, /authority\.permissions\.has\("report:sign_off"\)/u);
  assert.match(handler, /user\?\.id,\s*signedOffAt/u);
  assert.match(handler, /ReportSignOffAuthorityError/u);
  assert.match(handler, /res\.status\(authorityChanged \? 403 : 409\)/u);
});

test("sign-off authority and every supported membership mutation share one organisation lock", () => {
  assert.match(
    authoritySource,
    /valo\.membership-administration:\$\{context\.organisationId\}/u,
  );
  assert.match(
    membershipWriterSource,
    /valo\.membership-administration:\$\{organisationId\}/u,
  );

  const grantStart = membershipWriterSource.indexOf(
    '"/organisations/:organisationId/memberships",',
  );
  const lifecycleStart = membershipWriterSource.indexOf(
    '"/organisations/:organisationId/memberships/:membershipId",',
    grantStart,
  );
  assert.ok(grantStart >= 0 && lifecycleStart > grantStart);
  const grantHandler = membershipWriterSource.slice(grantStart, lifecycleStart);
  const lifecycleHandler = membershipWriterSource.slice(lifecycleStart);
  const grantLock = grantHandler.indexOf(
    "lockOrganisationMembershipAdministration(tx, organisationId)",
  );
  const membershipInsert = grantHandler.indexOf(
    ".insert(organisationMemberships)",
    grantLock,
  );
  const roleInsert = grantHandler.indexOf("tx.insert(roleGrants)", grantLock);
  const lifecycleLock = lifecycleHandler.indexOf(
    "lockOrganisationMembershipAdministration(tx, organisationId)",
  );
  const membershipUpdate = lifecycleHandler.indexOf(
    ".update(organisationMemberships)",
    lifecycleLock,
  );

  assert.ok(grantLock >= 0);
  assert.ok(membershipInsert > grantLock);
  assert.ok(roleInsert > grantLock);
  assert.ok(lifecycleLock >= 0);
  assert.ok(membershipUpdate > lifecycleLock);
});

test("sign-off and export resolve and lock their project before handler membership authority", () => {
  const tenantDatabase = routeIndexSource.indexOf(
    "router.use(attachTenantDatabase)",
  );
  const resourceBoundary = routeIndexSource.indexOf(
    "router.use(enforceTenantResourceBoundary)",
  );
  const reportsMount = routeIndexSource.indexOf("router.use(reportsRouter)");
  const boundaryStart = tenancySource.indexOf(
    "export async function enforceTenantResourceBoundary(",
  );
  const boundaryEnd = tenancySource.indexOf(
    "export function auditBreakGlassUse(",
    boundaryStart,
  );
  const boundary = tenancySource.slice(boundaryStart, boundaryEnd);
  const projectLookupLoop = boundary.indexOf(
    "for (const resource of PROJECT_LOOKUPS)",
  );
  const projectResolution = boundary.indexOf(
    "await Promise.all(projectChecks)",
    projectLookupLoop,
  );
  const projectLock = boundary.indexOf(
    "pg_advisory_xact_lock(hashtextextended(${projectId}, 0))",
    projectResolution,
  );
  const nextHandler = boundary.lastIndexOf("next();");
  const projectRouteLookup = tenancySource.indexOf(
    "{ pattern: /^\\/projects\\/([^/]+)/, load: async (id) => id }",
  );
  const reportLookup = tenancySource.indexOf(
    "{ pattern: /^\\/reports\\/([^/]+)/, load: lookupProjectId(reports) }",
  );
  const signOffHandler = routeSource(
    '"/reports/:id/sign-off"',
    "function reportDownloadHandler",
  );
  const signOffTransaction = signOffHandler.indexOf(
    "updated = await db.transaction",
  );
  const signOffMembershipAuthority = signOffHandler.indexOf(
    "resolveCurrentDirectAuthority(",
    signOffTransaction,
  );
  const exportHandler = routeSource(
    '"/projects/:id/export"',
    "export default router",
  );
  const exportTransaction = exportHandler.indexOf("await db.transaction(");
  const exportMembershipAuthority = exportHandler.indexOf(
    "await retainsExportAuthority()",
    exportTransaction,
  );
  const directAuthorityResolver = authoritySource.slice(
    authoritySource.indexOf(
      "export async function resolveCurrentDirectAuthority(",
    ),
    authoritySource.indexOf("async function resolveMembershipAuthorityAt("),
  );
  const accessAuthorityResolver = authoritySource.slice(
    authoritySource.indexOf(
      "export async function resolveCurrentAccessAuthority(",
    ),
    authoritySource.indexOf(
      "export async function hasCurrentAccessPermission(",
    ),
  );

  assert.ok(tenantDatabase >= 0);
  assert.ok(resourceBoundary > tenantDatabase);
  assert.ok(reportsMount > resourceBoundary);
  assert.equal(
    routeIndexSource.match(/router\.use\(reportsRouter\)/gu)?.length,
    1,
  );
  assert.ok(boundaryStart >= 0 && boundaryEnd > boundaryStart);
  assert.ok(projectRouteLookup >= 0);
  assert.ok(reportLookup >= 0);
  assert.ok(projectLookupLoop >= 0);
  assert.ok(projectResolution > projectLookupLoop);
  assert.ok(projectLock > projectResolution);
  assert.ok(nextHandler > projectLock);
  assert.ok(signOffMembershipAuthority > signOffTransaction);
  assert.ok(exportMembershipAuthority > exportTransaction);
  assert.match(
    exportHandler,
    /const retainsExportAuthority = \(\) =>[\s\S]*hasCurrentAccessPermission\(/u,
  );
  assert.match(
    directAuthorityResolver,
    /valo\.membership-administration:\$\{context\.organisationId\}/u,
  );
  assert.match(
    accessAuthorityResolver,
    /valo\.membership-administration:\$\{context\.membershipOrganisationId\}/u,
  );
  assert.doesNotMatch(tenancySource, /defersProjectLockToFinalTransaction/u);
});

test("package export locks and revalidates NDA state/version before evidence and commits before bytes", () => {
  const handler = routeSource(
    '"/projects/:id/export"',
    "export default router",
  );
  const finalTransaction = handler.indexOf("await db.transaction(");
  const zipBuild = handler.indexOf(
    "await buildProjectExportZip(archiveEntries)",
  );
  const firstAuthority = handler.indexOf(
    "await retainsExportAuthority()",
    finalTransaction,
  );
  const projectLock = handler.indexOf(
    "pg_advisory_xact_lock(hashtextextended",
    firstAuthority,
  );
  const ndaRead = handler.indexOf("const [currentClient]", finalTransaction);
  const ndaLock = handler.indexOf('.for("share")', ndaRead);
  const ndaStateCheck = handler.indexOf(
    'currentClient.ndaStatus !== "signed"',
    ndaLock,
  );
  const ndaVersionCheck = handler.indexOf(
    "currentClient.version !== governance.ndaVersion",
    ndaStateCheck,
  );
  const finalAuthority = handler.indexOf(
    "await retainsExportAuthority()",
    firstAuthority + 1,
  );
  const persist = handler.indexOf(
    "persistCanonicalProjectExportPackage",
    finalAuthority,
  );
  const commit = handler.indexOf(
    "await commitTenantDatabaseBeforeResponse(req)",
    persist,
  );
  const zipHeaders = handler.indexOf(
    'res.setHeader("Content-Type", "application/zip")',
    commit,
  );
  const zipSend = handler.indexOf("res.send(zipBuffer)", zipHeaders);

  assert.match(handler, /ndaVersion: clients\.version/u);
  assert.ok(zipBuild >= 0);
  assert.ok(zipBuild < finalTransaction);
  assert.ok(finalTransaction >= 0);
  assert.ok(firstAuthority > finalTransaction);
  assert.ok(projectLock > firstAuthority);
  assert.ok(ndaRead > finalTransaction);
  assert.ok(ndaLock > ndaRead);
  assert.ok(ndaStateCheck > ndaLock);
  assert.ok(ndaVersionCheck > ndaStateCheck);
  assert.ok(finalAuthority > ndaVersionCheck);
  assert.ok(persist > ndaVersionCheck);
  assert.ok(commit > persist);
  assert.ok(zipHeaders > commit);
  assert.ok(zipSend > zipHeaders);
  assert.match(handler, /authorityLost[\s\S]*res\.status\(403\)/u);
  assert.match(
    handler,
    /eventType: "project\.export_denied"[\s\S]*authorityLost/u,
  );
  assert.doesNotMatch(handler, /archive\.pipe\(res\)/u);
});

test("package export is a strict POST bound to the confirmed report and package scope", () => {
  const handler = routeSource(
    '"/projects/:id/export"',
    "export default router",
  );
  const packageBindingHelper = routeSource(
    "function hasCompletePackageBinding",
    "type ExportReceipt",
  );
  const bodyValidation = handler.indexOf(
    "ExportProjectBody.strict().safeParse(req.body)",
  );
  const archiveAssembly = handler.indexOf(
    "await buildProjectExportZip(archiveEntries)",
  );
  const finalTransaction = handler.indexOf("await db.transaction(");
  const finalScopeCheck = handler.indexOf(
    "exportScopeSha256(currentReport, lockedPackageBinding)",
    finalTransaction,
  );

  assert.match(source, /router\.post\(\s*"\/projects\/:id\/export"/u);
  assert.doesNotMatch(source, /router\.get\(\s*"\/projects\/:id\/export"/u);
  assert.match(handler, /requirePermissionOrLegacy\("report:export"\)/u);
  assert.match(handler, /req\.get\("Idempotency-Key"\)/u);
  assert.match(handler, /req\.get\("If-Match"\)/u);
  assert.match(handler, /\^"\(\[a-f0-9\]\{64\}\)"\$/u);
  assert.match(handler, /UUID_ANY_PATTERN\.test\(idempotencyKey\)/u);
  assert.match(handler, /hasCompletePackageBinding\(parsedBody\.data\)/u);
  assert.match(packageBindingHelper, /binding\.packageVersionId/u);
  assert.match(packageBindingHelper, /binding\.packageVersionNumber/u);
  assert.match(packageBindingHelper, /binding\.packageManifestSha256/u);
  assert.match(packageBindingHelper, /binding\.packageSourceSnapshotSha256/u);
  assert.doesNotMatch(packageBindingHelper, /Object\.values/u);
  assert.ok(bodyValidation >= 0);
  assert.ok(archiveAssembly > bodyValidation);
  assert.ok(finalTransaction > archiveAssembly);
  assert.ok(finalScopeCheck > finalTransaction);
  assert.match(
    handler,
    /res\.status\(409\)[\s\S]*confirmed report, package provenance or source material changed/iu,
  );
});

test("package export serializes idempotent effects and makes receipt replay read-only", () => {
  const handler = routeSource(
    '"/projects/:id/export"',
    "export default router",
  );
  const finalTransaction = handler.indexOf("await db.transaction(");
  const advisoryLock = handler.indexOf(
    "pg_advisory_xact_lock(hashtextextended",
    finalTransaction,
  );
  const finalReceiptRead = handler.indexOf(
    "const finalReceipts = await tx",
    advisoryLock,
  );
  const replayComment = handler.indexOf(
    "A completed request is a read-only replay",
    finalReceiptRead,
  );
  const replayBranch = handler.indexOf("if (finalReceipt)", replayComment);
  const replayReturn = handler.indexOf("return;", replayBranch);
  const persist = handler.indexOf(
    "persistCanonicalProjectExportPackage",
    replayReturn,
  );
  const receiptWrite = handler.indexOf(
    'objectType: "project_export_request"',
    persist,
  );
  const projectTransition = handler.indexOf(
    "const transitioned = await tx",
    receiptWrite,
  );

  assert.ok(finalTransaction >= 0);
  assert.ok(advisoryLock > finalTransaction);
  assert.ok(finalReceiptRead > advisoryLock);
  assert.ok(replayComment > finalReceiptRead);
  assert.ok(replayBranch > replayComment);
  assert.ok(replayReturn > replayBranch);
  assert.ok(persist > replayReturn);
  assert.ok(receiptWrite > persist);
  assert.ok(projectTransition > receiptWrite);
  assert.match(
    handler,
    /requestSha256[\s\S]*confirmedScopeSha256[\s\S]*exportRequest/u,
  );
  assert.match(handler, /finalReceipt\.requestSha256 !== requestSha256/u);
  assert.match(
    handler,
    /packageManifest\.manifestHash !==[\s\S]*finalReceipt\.packageManifestSha256/u,
  );
  assert.match(
    handler,
    /packageManifest\.sourceSnapshotHash !==[\s\S]*finalReceipt\.packageSourceSnapshotSha256/u,
  );
});

test("package-version projection exposes the server-verifiable export fingerprint", () => {
  const handler = routeSource(
    '"/projects/:id/package-versions"',
    '"/projects/:id/export"',
  );

  assert.match(
    handler,
    /sourceSnapshotSha256: packageVersions\.sourceSnapshotHash/u,
  );
  assert.match(handler, /exportScopeSha256: exportScopeSha256\(currentReport/u);
  assert.match(
    handler,
    /packageVersionId: items\[0\]\?\.packageVersionId \?\? null/u,
  );
  assert.match(
    handler,
    /packageManifestSha256: items\[0\]\?\.manifestSha256 \?\? null/u,
  );
  assert.match(
    handler,
    /packageSourceSnapshotSha256:[\s\S]*items\[0\]\?\.sourceSnapshotSha256 \?\? null/u,
  );
});
