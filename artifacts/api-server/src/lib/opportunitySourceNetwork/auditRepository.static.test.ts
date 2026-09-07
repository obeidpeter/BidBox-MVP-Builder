import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./auditRepository.ts", import.meta.url),
  "utf8",
);

test("source reads and decisions revalidate current direct tenant authority", () => {
  assert.match(source, /requireCurrentActor/u);
  assert.match(
    source,
    /eq\(organisationMemberships\.organisationId, scope\.organisationId\)/u,
  );
  assert.match(
    source,
    /isNull\(organisationMemberships\.delegatedByMembershipId\)/u,
  );
  assert.match(source, /eq\(users\.status, "active"\)/u);
  assert.match(source, /isNull\(roleGrants\.revokedAt\)/u);
  assert.match(source, /SOURCE_MANAGE_ROLES/u);
  assert.match(source, /valo\.membership-administration:\$\{organisationId\}/u);
  assert.match(source, /pg_catalog\.clock_timestamp\(\)/u);
  assert.match(
    source,
    /lockMembershipAdministrationBoundary\(tx, scope\.organisationId\)[\s\S]*?lockOpportunitySourceNetwork\(tx, scope\.organisationId\)[\s\S]*?currentDatabaseTime\(tx\)[\s\S]*?requireCurrentActor\(tx, scope, true, now\)/u,
  );
  assert.doesNotMatch(source, /FOR (?:UPDATE|SHARE) OF grant_row/u);
});

test("accepted sources create only an identified tenant tender plus audit receipt", () => {
  assert.match(source, /eq\(auditEvents\.organisationId, organisationId\)/u);
  assert.match(source, /organisationId: scope\.organisationId/u);
  assert.match(source, /status: "identified"/u);
  assert.match(source, /writeAuditTx\(tx/u);
  assert.doesNotMatch(source, /projectStatus|activatePursuit|scrape|fetch\(/u);
});
