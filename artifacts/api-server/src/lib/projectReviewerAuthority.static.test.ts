import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./projectReviewerAuthority.ts", import.meta.url),
  "utf8",
);

test("project reviewer authority is direct, current and lock-stable", () => {
  assert.match(source, /valo\.membership-administration:/u);
  assert.match(source, /clock_timestamp\(\)/u);
  assert.match(
    source,
    /isNull\(organisationMemberships\.delegatedByMembershipId\)/u,
  );
  assert.match(source, /eq\(organisationMemberships\.status, "active"\)/u);
  assert.match(source, /lte\(organisationMemberships\.accessStartsAt, now\)/u);
  assert.match(source, /gt\(organisationMemberships\.accessExpiresAt, now\)/u);
  assert.match(source, /eq\(users\.status, "active"\)/u);
  assert.match(source, /isNull\(roleGrants\.revokedAt\)/u);
  assert.match(source, /lte\(roleGrants\.startsAt, now\)/u);
  assert.match(source, /gt\(roleGrants\.expiresAt, now\)/u);
  assert.match(source, /isRoleAllowedForOrganisation/u);
  assert.match(source, /hasPermission\(\[role\], "draft:review"\)/u);
  assert.match(source, /validProjectReviewerName\(membership\.userName\)/u);
  assert.doesNotMatch(source, /FOR (?:UPDATE|SHARE) OF grant_row/u);
  assert.doesNotMatch(
    source,
    /FROM public\.organisations[\s\S]{0,120}FOR SHARE/u,
  );
});

test("every supplied reviewer assignment is permission-gated and revalidated in the transaction", () => {
  const route = readFileSync(
    new URL("../routes/projects.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    route,
    /parsed\.data\.reviewerId !== undefined &&[\s\S]{0,120}!hasRequestPermission\(req, "project:assign"\)/u,
  );
  assert.doesNotMatch(
    route,
    /parsed\.data\.reviewerId !== undefined &&\s*parsed\.data\.reviewerId !== existing\.reviewerId/u,
  );
  assert.match(
    route,
    /if \(updateFields\.reviewerId !== undefined\) \{[\s\S]*?lockProjectReviewerAuthorityBoundary\([\s\S]*?isCurrentProjectReviewer\(/u,
  );
});
