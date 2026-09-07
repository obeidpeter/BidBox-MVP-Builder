import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("current direct authority shares the membership writer lock before time and reads", async () => {
  const source = await readFile(
    new URL("./directMembershipAuthority.ts", import.meta.url),
    "utf8",
  );
  const lockAt = source.indexOf("bidbox.membership-administration:");
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
  const namespace = "bidbox.membership-administration:${organisationId}";
  assert.match(authority, /bidbox\.membership-administration:/u);
  assert.ok(organisations.includes(namespace));
});
