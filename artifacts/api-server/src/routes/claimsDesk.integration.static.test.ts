import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";

const routesIndex = new URL("./index.ts", import.meta.url);
const projectRoutePolicy = new URL(
  "../lib/projectRoutePolicy.ts",
  import.meta.url,
);
const claimsActivation = new URL(
  "../lib/claimsDesk/activation.ts",
  import.meta.url,
);
const retentionRoute = new URL("./retentionCompletion.ts", import.meta.url);
const retentionService = new URL(
  "../lib/retentionCompletion/service.ts",
  import.meta.url,
);
const retentionActivation = new URL(
  "../lib/retentionCompletion/activation.ts",
  import.meta.url,
);

describe("Claims Desk shared integration", () => {
  test("mounts the real route factory only after tenant database and resource guards", async () => {
    const source = await readFile(routesIndex, "utf8");
    assert.match(
      source,
      /import \{ createClaimsDeskRouter \} from "\.\/claimsDesk"/u,
    );
    const databaseBoundary = source.indexOf("router.use(attachTenantDatabase)");
    const resourceBoundary = source.indexOf(
      "router.use(enforceTenantResourceBoundary)",
    );
    const claimsMount = source.indexOf("router.use(claimsDeskRouter)");
    assert.ok(databaseBoundary >= 0 && resourceBoundary > databaseBoundary);
    assert.ok(claimsMount > resourceBoundary);
  });

  test("keeps the human-session durable worker control surface unmounted", async () => {
    const source = await readFile(routesIndex, "utf8");
    assert.doesNotMatch(source, /internal\/worker/u);
    assert.doesNotMatch(source, /createDurableWorkerFoundationRouter/u);
    assert.doesNotMatch(source, /createDurableWorkerService/u);
    assert.doesNotMatch(source, /createTransactionalOutboxService/u);
  });

  test("uses the shared released-route catalogue and leaves claims content untouched while retention is gated", async () => {
    const [
      projectRoutePolicySource,
      claimsActivationSource,
      retentionRouteSource,
      retentionServiceSource,
      retentionActivationSource,
    ] = await Promise.all([
      readFile(projectRoutePolicy, "utf8"),
      readFile(claimsActivation, "utf8"),
      readFile(retentionRoute, "utf8"),
      readFile(retentionService, "utf8"),
      readFile(retentionActivation, "utf8"),
    ]);
    assert.match(
      projectRoutePolicySource,
      /id: "claims-desk-record-create"[\s\S]*id: "claims-desk-transition-create"/u,
    );
    assert.match(claimsActivationSource, /PROJECT_ROUTE_POLICIES\.filter/u);
    assert.match(retentionRouteSource, /RETENTION_COMPLETION_NOT_ACTIVATED/u);
    assert.match(retentionRouteSource, /sideEffectsApplied: false/u);
    assert.match(
      retentionActivationSource,
      /durable_two_phase_detach_reconcile_certify/u,
    );
    assert.match(
      retentionServiceSource,
      /async detach\([\s\S]*?this\.#assertActivated\(\);[\s\S]*?this\.#repository\.detach\(/u,
    );
    assert.doesNotMatch(
      retentionRouteSource,
      /CLAIMS_DESK_RETENTION_WORK_TASK_LIKE/u,
    );
    assert.doesNotMatch(retentionRouteSource, /claims_desk_events=/u);
  });
});
