import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, before, describe, test } from "node:test";
import express from "express";
import type { ErrorRequestHandler } from "express";
import type {
  DeliveryStudioEnvelope,
  DeliveryStudioMutationResponse,
} from "../lib/deliveryStudio/contracts";
import { DeliveryStudioError } from "../lib/deliveryStudio/contracts";
import type { Permission } from "../lib/permissions";
import type { AccessContext } from "../middlewares/tenancy";
import type { DeliveryStudioRouterOptions } from "./deliveryStudio";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??=
  "postgresql://bidbox_test:bidbox_test@127.0.0.1:1/bidbox_delivery_studio_test";

const { createDeliveryStudioRouter, parseDeliveryStudioAction } =
  await import("./deliveryStudio");

const ORGANISATION_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const ACTOR_ID = "33333333-3333-4333-8333-333333333333";
const MEMBERSHIP_ID = "44444444-4444-4444-8444-444444444444";
const IDEMPOTENCY_KEY = "delivery-studio-0001";
const PERMISSIONS: Permission[] = [
  "project:read",
  "draft:read",
  "defect:read",
  "package:read",
  "document:read",
  "evidence:read",
  "draft:write",
  "draft:review",
  "defect:write",
  "defect:review",
  "package:sign_off",
  "package:generate",
  "intelligence:review",
  "analytics:read",
];

const envelope: DeliveryStudioEnvelope = {
  authorityNote: "Named-human authority only.",
  generatedAt: "2026-08-22T10:00:00.000Z",
  version: 5,
  project: {
    id: PROJECT_ID,
    title: "Lagos response",
    status: "review",
    deadline: null,
  },
  sourceSnapshotHash: "a".repeat(64),
  responseStudio: {
    status: "empty",
    sectionCount: 0,
    claimCount: 0,
    groundedClaimCount: 0,
    placeholderCount: 0,
    sections: [],
  },
  redTeamReview: { status: "not_started", dueAt: null, run: null },
  packageAssembly: { status: "not_started", package: null },
  submissionRehearsal: { status: "not_started", receipt: null },
  safety: {
    automaticMutation: false,
    externalPortalAction: false,
    namedHumanAuthority: true,
  },
};

function access(): AccessContext {
  return {
    organisationId: ORGANISATION_ID,
    membershipId: MEMBERSHIP_ID,
    membershipOrganisationId: ORGANISATION_ID,
    source: "membership",
    roles: ["bid_manager"],
    permissions: new Set(PERMISSIONS),
    breakGlassSessionId: null,
    partnerRelationshipId: null,
    partnerCoSigningRequired: false,
  };
}

describe("Delivery Studio route contract", () => {
  let server: Server;
  let origin = "";
  let outcome: DeliveryStudioMutationResponse["outcome"] = "recorded";
  let stale = false;
  let executeCalls = 0;
  const events: string[] = [];

  test("red-team policy versions are bounded to the response contract", () => {
    assert.ok(
      parseDeliveryStudioAction({
        action: "start_red_team",
        policyVersion: "p".repeat(128),
        findings: [],
      }),
    );
    assert.equal(
      parseDeliveryStudioAction({
        action: "start_red_team",
        policyVersion: "p".repeat(129),
        findings: [],
      }),
      null,
    );
  });

  test("instructional response claims require a citation", () => {
    assert.equal(
      parseDeliveryStudioAction({
        action: "save_response",
        sectionKey: "methodology",
        title: "Methodology",
        content: "Use the prescribed inspection sequence.",
        claims: [
          {
            claimKey: "method-step",
            text: "Use the prescribed inspection sequence.",
            kind: "instructional",
            citations: [],
          },
        ],
      }),
      null,
    );
  });

  test("accepts RFC 9562 UUIDv6-v8 values allowed by the API contract", () => {
    const uuidV6 = "66666666-6666-6666-8666-666666666666";
    const uuidV7 = "77777777-7777-7777-8777-777777777777";
    const uuidV8 = "88888888-8888-8888-8888-888888888888";
    assert.ok(
      parseDeliveryStudioAction({
        action: "save_response",
        sectionKey: "methodology",
        title: "Methodology",
        content: "Use the cited inspection sequence.",
        claims: [
          {
            claimKey: "method-step",
            text: "Use the cited inspection sequence.",
            kind: "instructional",
            citations: [
              {
                documentId: uuidV6,
                documentVersionId: uuidV8,
                pageNumber: 1,
                quote: "Use the cited inspection sequence.",
              },
            ],
          },
        ],
      }),
    );
    assert.ok(
      parseDeliveryStudioAction({
        action: "review_response_claim",
        claimId: uuidV7,
        decision: "accepted",
        note: "Grounding checked.",
      }),
    );
  });

  before(async () => {
    const service: NonNullable<DeliveryStudioRouterOptions["service"]> = {
      getStudio: async () => envelope,
      getPortfolio: async () => ({
        generatedAt: envelope.generatedAt,
        authorityNote: envelope.authorityNote,
        totals: {
          projectCount: 0,
          responseReadyCount: 0,
          redTeamApprovedCount: 0,
          packageReadyCount: 0,
          rehearsalReadyCount: 0,
          confirmedOutcomeCount: 0,
        },
        projects: [],
        limitations: [],
      }),
      execute: async (input) => {
        executeCalls += 1;
        events.push(`service:${input.data.action}`);
        if (stale) {
          throw new DeliveryStudioError("stale_version", "stale");
        }
        return {
          projectId: input.projectId,
          action: input.data.action,
          outcome,
          receiptId: "55555555-5555-4555-8555-555555555555",
          data: envelope,
        };
      },
    };
    const app = express();
    app.use(express.json({ limit: "8mb" }));
    app.use(
      createDeliveryStudioRouter({
        service,
        resolveAccess: access,
        resolveActor: () => ({ id: ACTOR_ID, name: "Ada Reviewer" }),
        resolveDirectAuthority: async () => ({
          organisationId: ORGANISATION_ID,
          actorUserId: ACTOR_ID,
          membershipId: MEMBERSHIP_ID,
          roles: ["bid_manager"],
          permissions: new Set(PERMISSIONS),
        }),
        commitBeforeResponse: async () => {
          events.push("commit");
        },
      }),
    );
    const errors: ErrorRequestHandler = (error, _request, response, _next) => {
      response.status(500).json({ error: String(error) });
    };
    app.use(errors);
    server = createServer(app);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("No test address");
    origin = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  test("requires If-Match with 428 before service work", async () => {
    const before = executeCalls;
    const response = await fetch(
      `${origin}/projects/${PROJECT_ID}/delivery-studio/actions`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": IDEMPOTENCY_KEY,
        },
        body: JSON.stringify({
          action: "assemble_package",
          packageType: "submission",
        }),
      },
    );
    assert.equal(response.status, 428);
    assert.equal(executeCalls, before);
  });

  test("rejects unknown body fields before service work", async () => {
    const before = executeCalls;
    const response = await fetch(
      `${origin}/projects/${PROJECT_ID}/delivery-studio/actions`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "if-match": '"4"',
          "idempotency-key": IDEMPOTENCY_KEY,
        },
        body: JSON.stringify({
          action: "assemble_package",
          packageType: "submission",
          automaticSubmit: true,
        }),
      },
    );
    assert.equal(response.status, 400);
    assert.equal(executeCalls, before);
  });

  test("returns 201 only after commit for a recorded mutation", async () => {
    outcome = "recorded";
    stale = false;
    events.length = 0;
    const response = await fetch(
      `${origin}/projects/${PROJECT_ID}/delivery-studio/actions`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "if-match": '"4"',
          "idempotency-key": IDEMPOTENCY_KEY,
        },
        body: JSON.stringify({
          action: "assemble_package",
          packageType: "submission",
        }),
      },
    );
    assert.equal(response.status, 201);
    assert.deepEqual(events, ["service:assemble_package", "commit"]);
    assert.equal(response.headers.get("etag"), '"5"');
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  });

  test("returns 200 for an idempotent replay", async () => {
    outcome = "replayed";
    stale = false;
    const response = await fetch(
      `${origin}/projects/${PROJECT_ID}/delivery-studio/actions`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "if-match": '"4"',
          "idempotency-key": IDEMPOTENCY_KEY,
        },
        body: JSON.stringify({
          action: "assemble_package",
          packageType: "submission",
        }),
      },
    );
    assert.equal(response.status, 200);
  });

  test("maps stale project versions to 412 without commit", async () => {
    stale = true;
    events.length = 0;
    const response = await fetch(
      `${origin}/projects/${PROJECT_ID}/delivery-studio/actions`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "if-match": '"4"',
          "idempotency-key": IDEMPOTENCY_KEY,
        },
        body: JSON.stringify({
          action: "assemble_package",
          packageType: "submission",
        }),
      },
    );
    assert.equal(response.status, 412);
    assert.deepEqual(events, ["service:assemble_package"]);
    stale = false;
  });
});
