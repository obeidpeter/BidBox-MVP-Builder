import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, before, describe, test } from "node:test";
import express from "express";
import type { Permission } from "../lib/permissions";
import type { CurrentDirectAuthority } from "../lib/directMembershipAuthority";
import type {
  PrivacyOperationsRepository,
  PrivacyWorkflowReceipt,
} from "../lib/privacyOperationsCentre/contracts";
import { createPrivacyWorkflowAuditDetails } from "../lib/privacyOperationsCentre/service";
import type { AccessContext } from "../middlewares/tenancy";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??=
  "postgresql://bidbox_test:bidbox_test@127.0.0.1:1/bidbox_privacy_test";

const { createPrivacyOperationsRouter } =
  await import("./privacyOperationsCentre");

const ORGANISATION_ID = "10000000-0000-4000-8000-000000000001";
const ACTOR_ID = "20000000-0000-4000-8000-000000000002";
const ASSIGNEE_ID = "30000000-0000-4000-8000-000000000003";
const DSR_ID = "40000000-0000-4000-8000-000000000004";
const CONSENT_ID = "50000000-0000-4000-8000-000000000005";
const HOLD_ID = "60000000-0000-4000-8000-000000000006";
const SHA_A = "a".repeat(64);
const NOW = new Date("2026-08-11T12:00:00.000Z");

function access(
  permissions: readonly Permission[],
  source: AccessContext["source"] = "membership",
): AccessContext {
  return {
    organisationId: ORGANISATION_ID,
    membershipId: source === "membership" ? "membership-1" : null,
    membershipOrganisationId: source === "membership" ? ORGANISATION_ID : null,
    source,
    roles: ["client_administrator"],
    permissions: new Set(permissions),
    breakGlassSessionId: source === "break_glass" ? "break-glass-1" : null,
    partnerRelationshipId: source === "partner" ? "relationship-1" : null,
    partnerCoSigningRequired: false,
  };
}

function receipt(
  eventType: PrivacyWorkflowReceipt["eventType"],
  objectId: string,
  payload: Record<string, string | number>,
): PrivacyWorkflowReceipt {
  return createPrivacyWorkflowAuditDetails({
    eventType,
    objectId,
    actorUserId: ACTOR_ID,
    recordedAt: NOW.toISOString(),
    resultingVersion: 2,
    payload,
  }).receipt;
}

describe("privacy operations route factory", () => {
  let server: Server;
  let origin: string;
  let currentAccess = access(["privacy:read", "privacy:manage"]);
  let authorityPermissionsOverride: readonly Permission[] | null | undefined;
  const mutations: { kind: string; expectedVersion: number }[] = [];

  before(async () => {
    const repository: PrivacyOperationsRepository = {
      listAssignees: async () => [
        { userId: ASSIGNEE_ID, name: "Privacy Assignee" },
      ],
      readDashboard: async (scope) => ({
        totals: {
          dataSubjectRequests: 0,
          consentRecords: 0,
          legalHolds: 0,
          subprocessors: 0,
          crossBorderTransfers: 0,
          deletionActions: 0,
        },
        dataSubjectRequests: [],
        consentRecords: [],
        legalHolds: [],
        subprocessors: [],
        crossBorderTransfers: [],
        deletionActions: [],
        auditRows: [],
      }),
      triageDataSubjectRequest: async (_scope, command) => {
        mutations.push({
          kind: "triage",
          expectedVersion: command.expectedVersion,
        });
        return {
          outcome: "updated",
          resultingVersion: 2,
          receipt: receipt("privacy.dsr_triage_recorded", command.id, {
            assignedToUserId: command.assignedToUserId,
            decisionEvidenceSha256: command.decisionEvidenceSha256,
            expectedVersion: command.expectedVersion,
            identityVerificationStatus: command.identityVerificationStatus,
            reasonCode: command.reasonCode,
            status: command.status,
          }),
        };
      },
      recordConsentWithdrawal: async (_scope, command) => {
        mutations.push({
          kind: "withdrawal",
          expectedVersion: command.expectedVersion,
        });
        return {
          outcome: "updated",
          resultingVersion: 2,
          receipt: receipt("privacy.consent_withdrawal_recorded", command.id, {
            evidenceSha256: command.evidenceSha256,
            expectedVersion: command.expectedVersion,
            withdrawnAt: command.withdrawnAt,
          }),
        };
      },
      recordLegalHoldReview: async (_scope, command) => {
        mutations.push({
          kind: "hold-review",
          expectedVersion: command.expectedVersion,
        });
        return {
          outcome: "updated",
          resultingVersion: 2,
          receipt: receipt("privacy.legal_hold_review_recorded", command.id, {
            evidenceSha256: command.evidenceSha256,
            expectedVersion: command.expectedVersion,
            nextReviewAt: command.nextReviewAt,
            reviewOutcome: command.reviewOutcome,
          }),
        };
      },
    };

    const app = express();
    app.use(express.json());
    app.use(
      "/api",
      createPrivacyOperationsRouter({
        repository,
        now: () => NOW,
        resolveAccess: () => currentAccess,
        resolveActorUserId: () => ACTOR_ID,
        resolveAuthority: async (
          context,
          actorUserId,
        ): Promise<CurrentDirectAuthority | null> => {
          if (
            !context ||
            !actorUserId ||
            context.source !== "membership" ||
            !context.membershipId ||
            context.membershipOrganisationId !== context.organisationId ||
            authorityPermissionsOverride === null
          ) {
            return null;
          }
          return {
            organisationId: context.organisationId,
            actorUserId,
            membershipId: context.membershipId,
            roles: ["client_administrator"],
            permissions: new Set(
              authorityPermissionsOverride ?? context.permissions,
            ),
          };
        },
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

  test("returns a bounded private dashboard without subject PII", async () => {
    const response = await fetch(`${origin}/api/privacy-operations?limit=10`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    const body = (await response.json()) as Record<string, unknown>;
    assert.equal(body.boundedTo, 10);
    assert.equal(body.rawSubjectPiiIncluded, false);
    assert.equal(body.legalDecisionAutomated, false);
    assert.equal(JSON.stringify(body).includes("requesterReference"), false);
    assert.equal(JSON.stringify(body).includes("subjectReference"), false);
    assert.equal(
      (await fetch(`${origin}/api/privacy-operations?limit=51`)).status,
      400,
    );
  });

  test("returns only a bounded private assignee directory to managers", async () => {
    const response = await fetch(`${origin}/api/privacy-operations/assignees`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await response.json(), {
      organisationId: ORGANISATION_ID,
      items: [{ userId: ASSIGNEE_ID, name: "Privacy Assignee" }],
      limit: 100,
      truncated: false,
    });
    currentAccess = access(["privacy:read"]);
    assert.equal(
      (await fetch(`${origin}/api/privacy-operations/assignees`)).status,
      403,
    );
    currentAccess = access(["privacy:read", "privacy:manage"]);
  });

  test("requires direct membership and the exact read/manage permissions", async () => {
    currentAccess = access(["privacy:read", "privacy:manage"], "partner");
    assert.equal((await fetch(`${origin}/api/privacy-operations`)).status, 403);
    currentAccess = {
      ...access(["privacy:read", "privacy:manage"]),
      membershipId: null,
    };
    assert.equal((await fetch(`${origin}/api/privacy-operations`)).status, 403);
    currentAccess = access(["privacy:manage"]);
    assert.equal((await fetch(`${origin}/api/privacy-operations`)).status, 403);
    currentAccess = access(["privacy:read"]);
    assert.equal(
      (
        await fetch(
          `${origin}/api/privacy-operations/data-subject-requests/${DSR_ID}/triage`,
          { method: "POST" },
        )
      ).status,
      403,
    );
    currentAccess = access(["privacy:read", "privacy:manage"]);
  });

  test("rejects stale read and manage grants before repository work", async () => {
    currentAccess = access(["privacy:read", "privacy:manage"]);
    authorityPermissionsOverride = [];
    const mutationsBefore = mutations.length;
    assert.equal((await fetch(`${origin}/api/privacy-operations`)).status, 403);
    assert.equal(
      (await fetch(`${origin}/api/privacy-operations/assignees`)).status,
      403,
    );
    assert.equal(
      (
        await fetch(
          `${origin}/api/privacy-operations/data-subject-requests/${DSR_ID}/triage`,
          { method: "POST" },
        )
      ).status,
      403,
    );
    assert.equal(mutations.length, mutationsBefore);
    authorityPermissionsOverride = undefined;
  });

  test("DSR triage is CAS-bound, closed-schema and names an assignee", async () => {
    const url = `${origin}/api/privacy-operations/data-subject-requests/${DSR_ID}/triage`;
    const withoutVersion = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(withoutVersion.status, 428);

    const invalid = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "if-match": '"1"' },
      body: JSON.stringify({
        status: "triaged",
        identityVerificationStatus: "verified",
        assignedToUserId: ASSIGNEE_ID,
        reasonCode: "initial_triage",
        decisionEvidenceSha256: SHA_A,
        rawSubjectNotes: "must never be accepted",
      }),
    });
    assert.equal(invalid.status, 400);

    const accepted = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "if-match": '"1"' },
      body: JSON.stringify({
        status: "triaged",
        identityVerificationStatus: "verified",
        assignedToUserId: ASSIGNEE_ID,
        reasonCode: "initial_triage",
        decisionEvidenceSha256: SHA_A,
      }),
    });
    assert.equal(accepted.status, 200);
    assert.equal(accepted.headers.get("etag"), '"2"');
    assert.equal(mutations.at(-1)?.kind, "triage");
    assert.equal(mutations.at(-1)?.expectedVersion, 1);
    assert.equal(
      ((await accepted.json()) as { legalDecisionAutomated: boolean })
        .legalDecisionAutomated,
      false,
    );
  });

  test("consent withdrawal and hold review record evidence only", async () => {
    const withdrawal = await fetch(
      `${origin}/api/privacy-operations/consent-records/${CONSENT_ID}/withdrawal`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "if-match": '"1"' },
        body: JSON.stringify({
          withdrawnAt: "2026-08-11T11:00:00.000Z",
          evidenceSha256: SHA_A,
        }),
      },
    );
    assert.equal(withdrawal.status, 200);
    assert.equal(mutations.at(-1)?.kind, "withdrawal");

    const review = await fetch(
      `${origin}/api/privacy-operations/legal-holds/${HOLD_ID}/reviews`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "if-match": '"1"' },
        body: JSON.stringify({
          reviewOutcome: "release_recommended",
          nextReviewAt: "2026-09-11T12:00:00.000Z",
          evidenceSha256: SHA_A,
        }),
      },
    );
    assert.equal(review.status, 200);
    assert.equal(mutations.at(-1)?.kind, "hold-review");
    assert.equal(
      (
        (await review.json()) as { authorityNote: string }
      ).authorityNote.includes("release a hold"),
      true,
    );
  });

  test("exposes no provider or destructive privacy endpoint", async () => {
    for (const method of ["DELETE", "PUT", "PATCH"]) {
      assert.equal(
        (
          await fetch(
            `${origin}/api/privacy-operations/legal-holds/${HOLD_ID}`,
            {
              method,
            },
          )
        ).status,
        404,
      );
    }
  });
});
