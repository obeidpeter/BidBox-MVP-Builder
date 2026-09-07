import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";
import type { AccessContext } from "../middlewares/tenancy";
import type { CommercialRetainerRouteAccess } from "./commercialRetainer";
import {
  COMMERCIAL_RETAINER_MANIFEST,
  RETAINER_TASK_PREFIX,
} from "../lib/commercialRetainer/contracts";

process.env.DATABASE_URL ??=
  "postgresql://bidbox_test:bidbox_test@127.0.0.1:1/bidbox_test";

const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const MEMBERSHIP = "33333333-3333-4333-8333-333333333333";

function access(
  source: AccessContext["source"] = "membership",
): CommercialRetainerRouteAccess {
  return {
    scope: {
      organisationId: ORG,
      actorUserId: USER,
      actorMembershipId: MEMBERSHIP,
    },
    context: {
      organisationId: ORG,
      membershipId: source === "membership" ? MEMBERSHIP : null,
      membershipOrganisationId: source === "membership" ? ORG : null,
      source,
      roles: ["valo_operations_administrator"],
      permissions: new Set([
        "billing:read",
        "order:create",
        "entitlement:read",
      ]),
      breakGlassSessionId: null,
      partnerRelationshipId: source === "partner" ? "partner-link" : null,
      partnerCoSigningRequired: false,
    },
  };
}

test("commercial policy denies partner-derived access", async () => {
  const { canAccessCommercialRetainer } = await import("./commercialRetainer");
  assert.equal(canAccessCommercialRetainer(access("partner"), "read"), false);
  const entitlementOnly = access();
  entitlementOnly.context.permissions = new Set(
    [...entitlementOnly.context.permissions].filter(
      (permission) => permission !== "billing:read",
    ),
  );
  assert.equal(canAccessCommercialRetainer(entitlementOnly, "read"), false);
  const readOnly = access();
  readOnly.context.permissions = new Set(
    [...readOnly.context.permissions].filter(
      (permission) => permission !== "order:create",
    ),
  );
  assert.equal(canAccessCommercialRetainer(readOnly, "retainer:use"), false);
  assert.equal(
    canAccessCommercialRetainer(access("membership"), "payment:verify"),
    true,
  );
});

test("commercial routes are mounted only after authenticated tenant database scope", async () => {
  const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");
  const authenticated = source.indexOf("router.use(attachUser)");
  const tenantDatabase = source.indexOf("router.use(attachTenantDatabase)");
  const mounted = source.indexOf(
    'router.use("/commercial-retainer", commercialRetainerRouter)',
  );
  assert.ok(authenticated >= 0 && authenticated < tenantDatabase);
  assert.ok(tenantDatabase >= 0 && tenantDatabase < mounted);
  assert.equal(COMMERCIAL_RETAINER_MANIFEST.routeMounted, true);
  assert.equal(COMMERCIAL_RETAINER_MANIFEST.navigationMounted, true);
  assert.equal(COMMERCIAL_RETAINER_MANIFEST.openApiPublished, true);
});

test("retention completion leaves retainer and financial rows untouched while activation is gated", async () => {
  const [routeSource, serviceSource] = await Promise.all([
    readFile(new URL("./retentionCompletion.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../lib/retentionCompletion/service.ts", import.meta.url),
      "utf8",
    ),
  ]);
  assert.equal(RETAINER_TASK_PREFIX, "[RETAINER-DESK:v1:");
  assert.match(routeSource, /RETENTION_COMPLETION_NOT_ACTIVATED/u);
  assert.match(routeSource, /sideEffectsApplied: false/u);
  assert.match(
    serviceSource,
    /async detach\([\s\S]*?this\.#assertActivated\(\);[\s\S]*?this\.#repository\.detach\(/u,
  );
  assert.doesNotMatch(routeSource, /RETAINER_TASK_PREFIX/u);
  assert.doesNotMatch(routeSource, /retainer_service_requests=/u);
  assert.doesNotMatch(routeSource, /commercialFinancialRetentionBlockers/u);
  assert.doesNotMatch(routeSource, /planProjectBlobPurge|purgeBlobs/u);
});

test("private manifest response is no-store and advertises blocked integrations", async () => {
  const { createCommercialRetainerRouter } =
    await import("./commercialRetainer");
  const unavailable = async (): Promise<never> => {
    throw new Error("unexpected service call");
  };
  const app = express();
  app.use(express.json());
  app.use(
    "/api/commercial-retainer",
    createCommercialRetainerRouter({
      service: {
        snapshot: unavailable,
        createQuote: unavailable,
        approveQuote: unavailable,
        createInvoice: unavailable,
        recordPayment: unavailable,
        verifyPayment: unavailable,
        createRetainerRequest: unavailable,
        mutateRetainerRequest: unavailable,
      },
      resolveAccess: () => access(),
    }),
  );
  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/commercial-retainer/manifest`,
    );
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control") ?? "", /private/u);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/u);
    const payload = (await response.json()) as {
      manifest: {
        paymentProviderConnected: boolean;
        externalMessagingConnected: boolean;
      };
    };
    assert.equal(payload.manifest.paymentProviderConnected, false);
    assert.equal(payload.manifest.externalMessagingConnected, false);
  } finally {
    server.close();
    await once(server, "close");
  }
});
