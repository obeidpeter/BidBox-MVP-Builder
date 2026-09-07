import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, before, describe, test } from "node:test";
import express from "express";
import type { CurrentDirectAuthority } from "../lib/directMembershipAuthority";
import type {
  EvidenceRenewalPlan,
  EvidenceRenewalRepository,
  EvidenceRenewalScope,
} from "../lib/evidenceRenewal/contracts";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??=
  "postgresql://bidbox_test:bidbox_test@127.0.0.1:1/bidbox_evidence_renewal_test";

const { createEvidenceRenewalRouter } = await import("./evidenceRenewal");

const ORGANISATION_ID = "10000000-0000-4000-8000-000000000001";
const PROJECT_ID = "20000000-0000-4000-8000-000000000002";
const PLAN_ID = "30000000-0000-4000-8000-000000000003";
const VAULT_ITEM_ID = "40000000-0000-4000-8000-000000000004";
const OWNER_ID = "50000000-0000-4000-8000-000000000005";
const VERIFIER_ID = "60000000-0000-4000-8000-000000000006";
const MEMBERSHIP_ID = "70000000-0000-4000-8000-000000000007";
const DOCUMENT_ID = "80000000-0000-4000-8000-000000000008";
const SHA = "a".repeat(64);

const authority: CurrentDirectAuthority = {
  organisationId: ORGANISATION_ID,
  actorUserId: OWNER_ID,
  membershipId: MEMBERSHIP_ID,
  roles: ["bid_manager"],
  permissions: new Set(["evidence:read", "evidence:write", "evidence:approve"]),
};

function plan(version = 1): EvidenceRenewalPlan {
  return {
    id: PLAN_ID,
    organisationId: ORGANISATION_ID,
    projectId: PROJECT_ID,
    vaultItemId: VAULT_ITEM_ID,
    artefactType: "Tax clearance certificate",
    owner: { userId: OWNER_ID, name: "Owner Ada", current: true },
    verifier: {
      userId: VERIFIER_ID,
      name: "Verifier Tayo",
      current: true,
    },
    targetDate: "2026-09-01",
    internalReminder: {
      channel: "bidbox_evidence_renewal_register",
      assignedOwnerUserId: OWNER_ID,
      dueAt: "2026-09-01T16:00:00.000Z",
      status: version >= 3 ? "resolved" : "open",
      recordedReceiptSha256: SHA,
      resolvedReceiptSha256: version >= 3 ? SHA : null,
      externalDeliveryReceipt: null,
    },
    affectedPursuits: [
      { projectId: PROJECT_ID, title: "Pursuit Alpha", impact: "blocked" },
    ],
    status: version === 1 ? "planned" : "replacement_staged",
    version,
    stagedReplacement: null,
    reviewReasonCode: null,
    createdByUserId: OWNER_ID,
    createdAt: "2026-08-13T08:00:00.000Z",
    updatedAt: "2026-08-13T08:00:00.000Z",
    latestReceiptSha256: SHA,
    promotionReceiptSha256: null,
    receipts: [
      {
        version: 1,
        kind: "plan_created",
        occurredAt: "2026-08-13T08:00:00.000Z",
        actorUserId: OWNER_ID,
        sha256: SHA,
      },
    ],
    externalMessageSent: false,
  };
}

describe("evidence-renewal route", () => {
  let server: Server;
  let origin = "";
  let currentAuthority: CurrentDirectAuthority | null = authority;
  const calls: Array<{ kind: string; scope: EvidenceRenewalScope }> = [];

  const repository: EvidenceRenewalRepository = {
    async readSnapshot(scope) {
      calls.push({ kind: "read", scope });
      return {
        organisationId: ORGANISATION_ID,
        projectId: PROJECT_ID,
        generatedAt: "2026-08-13T08:00:00.000Z",
        items: [plan()],
        limit: 100,
        truncated: false,
        externalMessagingConnected: false,
        authorityNote: "Internal only.",
      };
    },
    async listAuthorities(scope) {
      calls.push({ kind: "authorities", scope });
      return {
        organisationId: ORGANISATION_ID,
        owners: [{ userId: OWNER_ID, name: "Owner Ada" }],
        verifiers: [{ userId: VERIFIER_ID, name: "Verifier Tayo" }],
        limit: 100,
        truncated: false,
      };
    },
    async createPlan(scope) {
      calls.push({ kind: "create", scope });
      return { outcome: "created", plan: plan(), replayed: false };
    },
    async stageReplacement(scope) {
      calls.push({ kind: "stage", scope });
      return { outcome: "updated", plan: plan(2), replayed: false };
    },
    async reviewReplacement(scope) {
      calls.push({ kind: "review", scope });
      return { outcome: "updated", plan: plan(3), replayed: false };
    },
  };

  before(async () => {
    const app = express();
    app.use(express.json());
    app.use(
      "/api",
      createEvidenceRenewalRouter({
        repository,
        resolveAuthority: async () => currentAuthority,
        now: () => new Date("2026-08-13T08:00:00.000Z"),
      }),
    );
    server = createServer(app);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    assert(address && typeof address !== "string");
    origin = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  test("returns a private project-scoped snapshot with no messaging claim", async () => {
    const response = await fetch(
      `${origin}/api/projects/${PROJECT_ID}/evidence-renewals`,
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.match(
      response.headers.get("vary") ?? "",
      /X-BidBox-Organisation-Id/u,
    );
    const body = (await response.json()) as Record<string, unknown>;
    assert.equal(body.organisationId, ORGANISATION_ID);
    assert.equal(body.projectId, PROJECT_ID);
    assert.equal(body.externalMessagingConnected, false);
    assert.equal(calls.at(-1)?.scope.actorMembershipId, MEMBERSHIP_ID);
  });

  test("requires CAS and returns explicit no-delivery truth on mutations", async () => {
    const missingMatch = await fetch(
      `${origin}/api/projects/${PROJECT_ID}/evidence-renewals/${PLAN_ID}/staged-replacement`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentId: DOCUMENT_ID,
          sha256: SHA,
          issueDate: "2026-08-12",
          expiryDate: "2027-08-12",
          idempotencyKey: "renewal-stage-0001",
        }),
      },
    );
    assert.equal(missingMatch.status, 428);

    const create = await fetch(
      `${origin}/api/projects/${PROJECT_ID}/evidence-renewals`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vaultItemId: VAULT_ITEM_ID,
          ownerUserId: OWNER_ID,
          verifierUserId: VERIFIER_ID,
          targetDate: "2026-09-01",
          affectedPursuits: [{ projectId: PROJECT_ID, impact: "blocked" }],
          idempotencyKey: "renewal-plan-0001",
        }),
      },
    );
    assert.equal(create.status, 201);
    const body = (await create.json()) as Record<string, unknown>;
    assert.equal(body.externalMessageSent, false);
    assert.equal(create.headers.get("etag"), '"1"');
  });

  test("denies absent direct current authority", async () => {
    currentAuthority = null;
    assert.equal(
      (await fetch(`${origin}/api/projects/${PROJECT_ID}/evidence-renewals`))
        .status,
      403,
    );
    currentAuthority = authority;
  });

  test("rejects a request above the renewal subtree body bound", async () => {
    const response = await fetch(
      `${origin}/api/projects/${PROJECT_ID}/evidence-renewals`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oversized: "x".repeat(70_000) }),
      },
    );
    assert.equal(response.status, 413);
    assert.match(await response.text(), /evidence-renewal bound/u);
  });
});
