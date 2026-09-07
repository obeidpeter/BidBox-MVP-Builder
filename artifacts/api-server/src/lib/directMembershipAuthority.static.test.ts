import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("current direct authority shares the membership writer lock before time and reads", async () => {
  const source = await readFile(
    new URL("./directMembershipAuthority.ts", import.meta.url),
    "utf8",
  );
  const lockAt = source.indexOf("valo.membership-administration:");
  const clockAt = source.indexOf("clock_timestamp()", lockAt);
  const membershipAt = source.indexOf(
    ".from(organisationMemberships)",
    clockAt,
  );
  const grantsAt = source.indexOf(".from(roleGrants)", membershipAt);
  assert.ok(lockAt >= 0, "membership administration lock is missing");
  assert.ok(clockAt > lockAt, "current time must be evaluated after waiting");
  assert.ok(membershipAt > clockAt, "membership read must follow the lock");
  assert.ok(grantsAt > membershipAt, "grant read must follow membership read");
  assert.doesNotMatch(source, /transaction_timestamp\(\)/u);
});

test("membership writer and authority resolver use one exact lock namespace", async () => {
  const [authority, organisations] = await Promise.all([
    readFile(
      new URL("./directMembershipAuthority.ts", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../routes/organisations.ts", import.meta.url), "utf8"),
  ]);
  const namespace = "valo.membership-administration:${organisationId}";
  assert.match(authority, /valo\.membership-administration:/u);
  assert.ok(organisations.includes(namespace));
});

test("current partner authority locks its exact source before using one database clock", async () => {
  const source = await readFile(
    new URL("./directMembershipAuthority.ts", import.meta.url),
    "utf8",
  );
  const resolver = source.indexOf(
    "export async function resolveCurrentAccessAuthority",
  );
  const membershipLock = source.indexOf(
    "valo.membership-administration:${context.membershipOrganisationId}",
    resolver,
  );
  const relationshipRead = source.indexOf(
    ".from(partnerRelationships)",
    membershipLock,
  );
  const relationshipLock = source.indexOf('.for("share")', relationshipRead);
  const clock = source.indexOf("clock_timestamp()", relationshipLock);
  const membershipRead = source.indexOf("resolveMembershipAuthorityAt(", clock);

  assert.ok(resolver >= 0);
  assert.ok(membershipLock > resolver);
  assert.ok(relationshipRead > membershipLock);
  assert.ok(relationshipLock > relationshipRead);
  assert.ok(clock > relationshipLock);
  assert.ok(membershipRead > clock);
  assert.match(
    source.slice(resolver),
    /eq\(partnerRelationships\.id, context\.partnerRelationshipId!/u,
  );
  assert.match(
    source.slice(resolver),
    /partnerDerivedPermissionsForRoles\(membership\.roles\)/u,
  );
  assert.match(source.slice(resolver), /"partner_edition"/u);
});

test("current export authority preserves delegated membership access and rejects break-glass", async () => {
  const source = await readFile(
    new URL("./directMembershipAuthority.ts", import.meta.url),
    "utf8",
  );
  const resolver = source.slice(
    source.indexOf("export async function resolveCurrentAccessAuthority"),
  );

  assert.match(resolver, /context\.source === "break_glass"/u);
  assert.match(
    resolver,
    /resolveMembershipAuthorityAt\([\s\S]*?now,[\s\S]*?false,/u,
  );
  assert.match(resolver, /authority\?\.permissions\.has\(permission\)/u);
});
