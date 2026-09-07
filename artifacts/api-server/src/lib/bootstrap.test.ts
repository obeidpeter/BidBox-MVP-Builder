import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  isBootstrapIdentity,
  parseBootstrapOrganisationConfig,
  shouldAutoProvisionBootstrapOrganisation,
} from "./bootstrap";

describe("explicit platform bootstrap", () => {
  const identity = { clerkUserId: "user_123", email: "Owner@Example.com" };

  test("an empty allowlist never elevates a user", () => {
    assert.equal(isBootstrapIdentity(identity, {}), false);
  });

  test("matches exact Clerk IDs and case-insensitive email addresses", () => {
    assert.equal(
      isBootstrapIdentity(identity, { clerkUserIds: "user_other, user_123" }),
      true,
    );
    assert.equal(
      isBootstrapIdentity(identity, {
        emails: "ops@example.com, owner@example.com",
      }),
      true,
    );
  });

  test("does not allow substring or domain matches", () => {
    assert.equal(
      isBootstrapIdentity(identity, {
        clerkUserIds: "user_1234",
        emails: "example.com",
      }),
      false,
    );
  });

  test("tenant bootstrap requires an explicit valid deployment config", () => {
    assert.equal(parseBootstrapOrganisationConfig({}), null);
    assert.deepEqual(
      parseBootstrapOrganisationConfig({
        enabled: "true",
        name: "Valo Nigeria",
        slug: "valo-nigeria",
      }),
      { name: "Valo Nigeria", slug: "valo-nigeria" },
    );
    assert.throws(
      () =>
        parseBootstrapOrganisationConfig({
          enabled: "true",
          name: "Valo Nigeria",
          slug: "../bidbox",
        }),
      /must identify a valid organisation/,
    );
  });

  test("auto-provisioning is allowlisted, role-bound, and empty-system only", () => {
    const eligible = {
      config: { name: "Valo Nigeria", slug: "valo-nigeria" },
      identityAllowlisted: true,
      userRole: "restricted_platform_administrator",
      membershipCount: 0,
      organisationCount: 0,
    };
    assert.equal(shouldAutoProvisionBootstrapOrganisation(eligible), true);
    assert.equal(
      shouldAutoProvisionBootstrapOrganisation({
        ...eligible,
        identityAllowlisted: false,
      }),
      false,
    );
    assert.equal(
      shouldAutoProvisionBootstrapOrganisation({
        ...eligible,
        userRole: "none",
      }),
      false,
    );
    assert.equal(
      shouldAutoProvisionBootstrapOrganisation({
        ...eligible,
        organisationCount: 1,
      }),
      false,
    );
  });
});
