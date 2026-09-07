import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??=
  "postgresql://bidbox_test:bidbox_test@127.0.0.1:1/bidbox_client_upload_activation_test";

const {
  CLIENT_ACTION_UPLOAD_FEATURE_FLAG,
  GOVERNED_CLIENT_UPLOAD_ACTIVATION,
  isGovernedClientUploadActivated,
} = await import("./activation");

test("governed browser upload issuance remains server-disabled by default", async () => {
  assert.equal(
    CLIENT_ACTION_UPLOAD_FEATURE_FLAG,
    "client_action_governed_upload",
  );
  assert.deepEqual(GOVERNED_CLIENT_UPLOAD_ACTIVATION, {
    serverEnforced: true,
    explicitTenantFlagRequired: true,
    platformScheduleVerified: false,
    providerInFlightPutMaximumVerified: false,
    exactLateRewriteClosureImplemented: false,
    productionIssuanceEnabled: false,
  });
  assert.equal(
    await isGovernedClientUploadActivated(
      "11111111-1111-4111-8111-111111111111",
    ),
    false,
  );
});
