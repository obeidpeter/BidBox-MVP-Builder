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
    /bidbox\.membership-administration:\$\{context\.organisationId\}/u,
  );
  assert.match(
    membershipWriterSource,
    /bidbox\.membership-administration:\$\{organisationId\}/u,
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

test("package export locks and revalidates NDA state/version before evidence and commits before bytes", () => {
  const handler = routeSource(
    '"/projects/:id/export"',
    "export default router",
  );
  const finalTransaction = handler.indexOf("await db.transaction(");
  const zipBuild = handler.indexOf(
    "await buildProjectExportZip(archiveEntries)",
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
  const persist = handler.indexOf(
    "persistCanonicalProjectExportPackage",
    ndaVersionCheck,
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
  assert.ok(ndaRead > finalTransaction);
  assert.ok(ndaLock > ndaRead);
  assert.ok(ndaStateCheck > ndaLock);
  assert.ok(ndaVersionCheck > ndaStateCheck);
  assert.ok(persist > ndaVersionCheck);
  assert.ok(commit > persist);
  assert.ok(zipHeaders > commit);
  assert.ok(zipSend > zipHeaders);
  assert.doesNotMatch(handler, /archive\.pipe\(res\)/u);
});
