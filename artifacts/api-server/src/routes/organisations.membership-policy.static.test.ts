import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./organisations.ts", import.meta.url),
  "utf8",
);
const discoverySource = readFileSync(
  new URL("../lib/organisationDiscovery.ts", import.meta.url),
  "utf8",
);
const runtimeSecuritySource = readFileSync(
  new URL("../../../../lib/db/src/runtimeSecurity.ts", import.meta.url),
  "utf8",
);

describe("organisation membership route policy integration", () => {
  test("discovers only server-authorised direct and partner-projected contexts", () => {
    assert.match(source, /discoverableOrganisationRoleAccess\(/);
    assert.match(source, /active\.flatMap\(\(\{ membership, organisation \}\)/);
    assert.match(source, /if \(!roleAccess\) return \[\];/);
    assert.match(discoverySource, /!grant\.revokedAt/);
    assert.match(source, /permissionsForRoles\(roles\)/);
    assert.match(source, /partnerDerivedPermissionsForRoles\(source\.roles\)/);
    assert.match(
      source,
      /isTenantFeatureEnabled\(client\.id, "partner_edition"\)/,
    );
    assert.match(
      source,
      /isActiveAccessWindow\([\s\S]*relationship\.accessStartsAt[\s\S]*relationship\.accessExpiresAt/,
    );
    assert.match(source, /accessSource: "partner"/);
    assert.match(source, /partnerRelationshipId: relationship\.id/);
  });

  test("advertises the continuous role-grant boundary as context expiry", () => {
    assert.match(discoverySource, /continuousAccessExpiry\(eligible, now\)/);
    assert.match(
      source,
      /accessExpiresAt: earliestAccessExpiry\([\s\S]*membership\.accessExpiresAt,[\s\S]*roleAccessExpiresAt/,
    );
    assert.match(
      source,
      /source\.sourceAccessExpiresAt,[\s\S]*relationship\.accessExpiresAt/,
    );
  });

  test("serialises membership writers without requiring forbidden grant updates", () => {
    assert.match(source, /await lockCompatibleAdvisoryKey\(/);
    assert.match(source, /organisation_memberships[\s\S]*FOR UPDATE/);
    assert.doesNotMatch(source, /FOR UPDATE OF grant_row/);
    const lockCalls =
      source.match(/lockOrganisationMembershipAdministration\(tx/g) ?? [];
    assert.equal(lockCalls.length, 2);
  });

  test("re-evaluates grant, reactivation and lifecycle authority in the transaction", () => {
    assert.match(source, /evaluateMembershipGrantAuthority\(\{/);
    const lifecycleChecks =
      source.match(/evaluateMembershipLifecycleAuthority\(\{/g) ?? [];
    assert.equal(lifecycleChecks.length, 2);
    assert.match(source, /context\.membershipId!/);
    assert.match(source, /eventType: "membership\.change_denied"/);
    assert.match(source, /nullableInstantsEqual\(matchingGrant\.expiresAt/);
    assert.match(source, /kind: "immutable_role_expiry"/);
    assert.doesNotMatch(source, /update\(roleGrants\)/);
    assert.match(runtimeSecuritySource, /proof\.can_update_role_grants \|\|/);
    assert.match(
      source,
      /Existing role expiry is immutable; reactivate without changing roleExpiresAt/,
    );
    assert.match(
      source,
      /existingMembership && !changesAccessExpiry[\s\S]*existingMembership\.accessExpiresAt[\s\S]*: accessExpiresAt/,
    );
    assert.match(source, /!existingMembership \|\| changesAccessExpiry/);
  });

  test("retains optimistic concurrency and atomic success auditing", () => {
    assert.match(
      source,
      /eq\(organisationMemberships\.version, expectedVersion\)/,
    );
    assert.match(source, /eventType: "membership\.updated"/);
    assert.match(
      source,
      /eventType: matchingGrant[\s\S]*membership\.reactivated/,
    );
  });
});
