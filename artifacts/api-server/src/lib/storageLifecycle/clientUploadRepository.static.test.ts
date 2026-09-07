import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./clientUploadRepository.ts", import.meta.url),
  "utf8",
);
const route = readFileSync(
  new URL("../../routes/clientActionUpload.ts", import.meta.url),
  "utf8",
);
const objectStorage = readFileSync(
  new URL("../objectStorage.ts", import.meta.url),
  "utf8",
);
const references = readFileSync(
  new URL("../storageReferences.ts", import.meta.url),
  "utf8",
);

test("project precedes current authority and both upload commands invoke that helper first", () => {
  const helperStart = source.indexOf("async function lockAuthorityAndProject(");
  const helperEnd = source.indexOf("async function loadTargetForWrite(");
  const helper = source.slice(helperStart, helperEnd);
  const projectLock = helper.indexOf("scope.projectId}, 0)");
  const authorityLock = helper.indexOf("resolveCurrentDirectAuthority(");
  assert.ok(helperStart >= 0 && helperEnd > helperStart);
  assert.ok(projectLock >= 0 && authorityLock > projectLock);

  const issueStart = source.indexOf("  async issueLease(");
  const finalizeStart = source.indexOf("  async finalize(", issueStart);
  const issue = source.slice(issueStart, finalizeStart);
  const issueAuthority = issue.indexOf("lockAuthorityAndProject(scope)");
  const issueTarget = issue.indexOf("loadTargetForWrite(scope, command)");
  const issueObject = issue.indexOf("lockStagedUploadObject(objectPath)");
  const issueStorage = issue.indexOf("getObjectEntityUploadURL(");
  assert.ok(issueStart >= 0 && finalizeStart > issueStart);
  assert.equal(issue.match(/lockAuthorityAndProject\(scope\)/gu)?.length, 1);
  assert.ok(issueAuthority >= 0 && issueTarget > issueAuthority);
  assert.ok(issueObject > issueTarget && issueStorage > issueObject);

  const finalizeEnd = source.indexOf(
    "  async #recordFailedIntake(",
    finalizeStart,
  );
  const finalize = source.slice(finalizeStart, finalizeEnd);
  const finalizeAuthority = finalize.indexOf("lockAuthorityAndProject(scope)");
  const finalizeTarget = finalize.indexOf("loadTargetForWrite(scope, command)");
  const finalizeObject = finalize.indexOf("lockStagedUploadObject(objectPath)");
  const finalizeStorage = finalize.indexOf("downloadObjectEntityForIntake(");
  assert.ok(finalizeEnd > finalizeStart);
  assert.equal(finalize.match(/lockAuthorityAndProject\(scope\)/gu)?.length, 1);
  assert.ok(finalizeAuthority >= 0 && finalizeTarget > finalizeAuthority);
  assert.ok(
    finalizeObject > finalizeTarget && finalizeStorage > finalizeObject,
  );
  assert.match(source, /\.for\("update"\)/u);
  assert.match(source, /authority\.permissions\.has\("document:upload"\)/u);
});

test("closed lease replay is O(1), target-bound and project-capacity bounded", () => {
  assert.match(
    source,
    /deterministicLeaseId\([\s\S]*CLIENT_UPLOAD_LEASE_SCHEMA/u,
  );
  assert.match(source, /eq\(uploadSessions\.id, leaseId\)/u);
  assert.match(source, /assertLeaseMatches\(/u);
  assert.match(
    source,
    /limit\(STORAGE_LIFECYCLE_BOUNDS\.activeUploadLeasesPerProject \+ 1\)/u,
  );
  assert.match(source, /active\.recordId === command\.recordId/u);
  assert.match(source, /uploadSignedUrlMaximumSeconds/u);
  assert.match(source, /uploadSignedUrlLeaseCushionSeconds/u);
  assert.match(source, /signedNotAfter/u);
  assert.match(
    source,
    /lateRewriteClosure: STORAGE_LIFECYCLE_BOUNDS\.lateRewriteClosure/u,
  );
});

test("finalize downloads once, inspects exact material and commits all DB records atomically", () => {
  assert.equal(
    source.match(/downloadObjectEntityForIntake\(/gu)?.length,
    2,
    "one interface declaration plus one finalization call is expected",
  );
  assert.match(source, /intake\.bytes\.length === session\.expectedBytes/u);
  assert.match(source, /measuredSha256 === session\.expectedSha256/u);
  assert.match(source, /intake\.contentType === envelope\.contentType/u);
  assert.match(source, /inspectDocumentIntake/u);
  assert.match(source, /promoteStagedUploadToDocument\(/u);
  assert.match(source, /\.insert\(documents\)/u);
  assert.match(source, /\.insert\(documentVersions\)/u);
  assert.match(source, /\.update\(workTasks\)/u);
  assert.match(source, /\.update\(uploadSessions\)/u);
  assert.match(source, /eventType: "client_action\.upload_finalized"/u);
  assert.match(source, /rawFileAcceptedByApi: false/u);
});

test("staged leases remain sweep references and ambiguous cleanup fails closed", () => {
  assert.match(references, /uploadSessions/u);
  assert.match(references, /excludeUploadSessionId/u);
  assert.match(
    references,
    /eq\(uploadSessions\.status, "open"\)[\s\S]*eq\(uploadSessions\.status, "completed"\)[\s\S]*eq\(uploadSessions\.status, "rejected"\)[\s\S]*eq\(uploadSessions\.status, "quarantined"\)[\s\S]*eq\(uploadSessions\.status, "cleanup_unconfirmed"\)/u,
  );
  assert.match(source, /status: "cleanup_unconfirmed"/u);
  assert.match(source, /ObjectPromotionCleanupError/u);
  assert.match(source, /ObjectQuarantinePartialMoveError/u);
  assert.match(
    source,
    /quarantineObjectEntity\([\s\S]*intake\.contentType,[\s\S]*session\.id/u,
  );
  assert.doesNotMatch(
    source,
    /enqueueStorageDeletionIntentTx/u,
    "request-side expiry must leave the open lease for atomic multi-path sweep",
  );
  assert.match(objectStorage, /await deleteAndConfirmAbsent\(file\)/u);
});

test("route accepts bounded metadata only and exposes no generic portal", () => {
  assert.match(route, /CLIENT_UPLOAD_REQUEST_BODY_BYTES/u);
  assert.match(route, /requirePermissionOrLegacy\("document:upload"\)/u);
  assert.match(route, /accessContext\.source !== "membership"/u);
  assert.match(route, /Cache-Control", "private, no-store"/u);
  assert.match(route, /holdTenantDatabaseUntilComplete/u);
  assert.doesNotMatch(route, /multer|form-data|Readable|Buffer/u);
  assert.doesNotMatch(
    route,
    /sendExternal|deliverPackage|sendEmail|providerId/u,
  );
});
