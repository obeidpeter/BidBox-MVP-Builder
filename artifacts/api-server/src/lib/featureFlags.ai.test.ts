import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??=
  "postgresql://test:test@database.test.invalid:5432/bidbox_test";

const { explicitTenantFlagValue } = await import("./featureFlags");

test("a global feature flag cannot activate tenant AI", () => {
  assert.equal(
    explicitTenantFlagValue(
      [{ organisationId: null, enabled: true }],
      "00000000-0000-4000-8000-000000000001",
    ),
    false,
  );
});

test("only an explicit enabled row activates that tenant", () => {
  const tenant = "00000000-0000-4000-8000-000000000001";
  assert.equal(
    explicitTenantFlagValue(
      [{ organisationId: tenant, enabled: true }],
      tenant,
    ),
    true,
  );
  assert.equal(
    explicitTenantFlagValue(
      [{ organisationId: tenant, enabled: false }],
      tenant,
    ),
    false,
  );
});
