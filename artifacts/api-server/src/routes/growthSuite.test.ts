import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, before, describe, test } from "node:test";
import express from "express";
import type { OrganisationRole, Permission } from "../lib/permissions";
import type { AccessContext } from "../middlewares/tenancy";
import { MemoryGrowthSuiteRepository } from "../lib/growthSuite/memoryRepository";
import { deriveOnboardingJourney } from "../lib/growthSuite/onboarding";
import { parseQuoteDraft } from "../lib/growthSuite/offerCatalogue";
import type { LeadInboxItem } from "../lib/growthSuite/contracts";
import type {
  OnboardingProgress,
  OnboardingProgressRepository,
} from "../lib/growthSuite/onboardingProgress";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??=
  "postgresql://bidbox_test:bidbox_test@127.0.0.1:1/bidbox_growth_test";

const {
  createGrowthSuiteRouter,
  parseLeadContactHandoffRequest,
  parseLeadInboxMutation,
  parseOnboardingProgressMutation,
} = await import("./growthSuite");

const ORGANISATION_ID = "bidbox-org";
const NOW = new Date("2026-08-11T09:00:00.000Z");

function access(
  roles: readonly OrganisationRole[],
  permissions: readonly Permission[],
  source: AccessContext["source"] = "membership",
): AccessContext {
  return {
    organisationId: ORGANISATION_ID,
    membershipId: source === "membership" ? "membership-1" : null,
    membershipOrganisationId: source === "membership" ? ORGANISATION_ID : null,
    source,
    roles,
    permissions: new Set(permissions),
    breakGlassSessionId: source === "break_glass" ? "break-glass-1" : null,
    partnerRelationshipId: source === "partner" ? "relationship-1" : null,
    partnerCoSigningRequired: false,
  };
}

const LEAD: LeadInboxItem = {
  id: "lead-1",
  organisationId: ORGANISATION_ID,
  leadReference: "AUT-2026-0001",
  organisationLabel: "Example Engineering Limited",
  tenderCategory: "federal_public",
  bidStage: "live",
  receivedAt: "2026-08-11T08:00:00.000Z",
  tenderDeadline: "2026-09-01",
  assignedToUserId: "operator-1",
  status: "new",
  slaDueAt: null,
  conversionProposal: null,
  latestStatusDecision: null,
  version: 1,
  updatedAt: "2026-08-11T08:00:00.000Z",
};

describe("growth suite domain policy", () => {
  test("derives a role-specific journey that can touch only synthetic state", () => {
    const manager = deriveOnboardingJourney(["bid_manager"]);
    const auditor = deriveOnboardingJourney(["read_only_auditor"]);
    assert.equal(
      manager.syntheticTour.dataClassification,
      "synthetic_non_customer",
    );
    assert.equal(manager.syntheticTour.writesAuthoritativeState, false);
    assert(manager.checklist.some(({ id }) => id === "plan-first-pursuit"));
    assert(!auditor.checklist.some(({ id }) => id === "plan-first-pursuit"));
    assert(
      auditor.checklist.some(({ id }) => id === "inspect-synthetic-receipt"),
    );
  });

  test("accepts only bounded, manually entered quote terms", () => {
    const valid = parseQuoteDraft(
      {
        customerReference: "CLIENT-042",
        offerVersionId: "bid_autopsy@1",
        scopeSummary: "One reviewed bid package.",
        currency: "NGN",
        amountMinor: 25_000_000,
        validUntil: "2026-08-30",
      },
      NOW,
    );
    assert.equal(valid?.amountMinor, 25_000_000);
    assert.equal(
      parseQuoteDraft(
        {
          customerReference: "CLIENT-042",
          offerVersionId: "bid_autopsy@1",
          scopeSummary: "One reviewed bid package.",
          currency: "NGN",
          amountMinor: "auto",
          validUntil: "2026-08-30",
        },
        NOW,
      ),
      null,
    );
  });

  test("rejects unknown lead actions, extra fields and unsafe SLA bounds", () => {
    assert.equal(
      parseLeadInboxMutation({ action: "send_email", expectedVersion: 1 }, NOW),
      null,
    );
    assert.equal(
      parseLeadInboxMutation(
        {
          action: "assign",
          expectedVersion: 1,
          assigneeUserId: "user-1",
          email: "person@example.test",
        },
        NOW,
      ),
      null,
    );
    assert.equal(
      parseLeadInboxMutation(
        {
          action: "set_status",
          expectedVersion: 1,
          status: "qualified",
        },
        NOW,
      ),
      null,
    );
    assert.deepEqual(
      parseLeadInboxMutation(
        {
          action: "set_status",
          expectedVersion: 1,
          status: "not_a_fit",
          reason: "The recorded tender scope is outside the delivery remit.",
        },
        NOW,
      ),
      {
        action: "set_status",
        expectedVersion: 1,
        status: "not_a_fit",
        reason: "The recorded tender scope is outside the delivery remit.",
      },
    );
    assert.equal(
      parseLeadInboxMutation(
        {
          action: "set_status",
          expectedVersion: 1,
          status: "converted",
          reason: "Converted manually.",
          externalTargetReference: "PURSUIT-42",
          receiptSha256: "not-a-digest",
        },
        NOW,
      ),
      null,
    );
    assert.equal(
      parseLeadInboxMutation(
        {
          action: "set_sla",
          expectedVersion: 1,
          slaDueAt: "2030-01-01T00:00:00.000Z",
        },
        NOW,
      ),
      null,
    );
  });

  test("accepts canonical markers and the deprecated exact legacy request", () => {
    assert.deepEqual(
      parseOnboardingProgressMutation({
        journeyVersion: "2026-08-11.2",
        itemId: "confirm-active-workspace",
        expectedVersion: 0,
        markerSaved: true,
      }),
      {
        journeyVersion: "2026-08-11.2",
        itemId: "confirm-active-workspace",
        expectedVersion: 0,
        markerSaved: true,
      },
    );
    assert.deepEqual(
      parseOnboardingProgressMutation({
        journeyVersion: "2026-08-11.2",
        itemId: "confirm-active-workspace",
        expectedVersion: 0,
        completed: true,
      }),
      {
        journeyVersion: "2026-08-11.2",
        itemId: "confirm-active-workspace",
        expectedVersion: 0,
        markerSaved: true,
      },
    );
    assert.equal(
      parseOnboardingProgressMutation({
        journeyVersion: "2026-08-11.1",
        itemId: "confirm-active-workspace",
        expectedVersion: 0,
        completed: true,
      }),
      null,
    );
  });

  test("accepts only an exact, version-bound contact handoff purpose", () => {
    assert.deepEqual(
      parseLeadContactHandoffRequest({
        expectedVersion: 1,
        purpose: "initial_follow_up",
      }),
      { expectedVersion: 1, purpose: "initial_follow_up" },
    );
    assert.equal(
      parseLeadContactHandoffRequest({
        expectedVersion: 1,
        purpose: "initial_follow_up",
        email: "person@example.test",
      }),
      null,
    );
  });
});

describe("growth suite route boundaries", () => {
  let server: Server;
  let origin: string;
  let currentAccess = access(
    ["valo_operations_administrator"],
    ["organisation:read", "client:update", "order:create"],
  );
  let currentActor = "operator-1";

  before(async () => {
    let idCounter = 0;
    const repository = new MemoryGrowthSuiteRepository({
      leads: [LEAD, { ...LEAD, id: "other-lead", organisationId: "other-org" }],
      contacts: {
        "lead-1": {
          contactName: "Amina Okafor",
          preferredContactMethod: "email",
          contactValue: "amina@example.test",
        },
      },
      now: () => NOW,
      id: () => `generated-${++idCounter}`,
    });
    const progressByActor = new Map<string, OnboardingProgress>();
    const onboardingProgressRepository: OnboardingProgressRepository = {
      getProgress: async (_scope, _roles) =>
        progressByActor.get(currentActor) ?? {
          journeyVersion: "2026-08-11.2",
          savedPracticeMarkerItemIds: [],
          completedItemIds: [],
          version: 0,
        },
      mutateProgress: async (_scope, roles, mutation) => {
        const journey = deriveOnboardingJourney(roles);
        const current = progressByActor.get(currentActor) ?? {
          journeyVersion: "2026-08-11.2" as const,
          savedPracticeMarkerItemIds: [] as readonly string[],
          completedItemIds: [] as readonly string[],
          version: 0,
        };
        if (mutation.expectedVersion !== current.version) {
          return { outcome: "not_found_or_conflict" as const };
        }
        if (!journey.checklist.some(({ id }) => id === mutation.itemId)) {
          return { outcome: "policy_denied" as const };
        }
        const savedMarkers = new Set(current.savedPracticeMarkerItemIds);
        if (mutation.markerSaved) savedMarkers.add(mutation.itemId);
        else savedMarkers.delete(mutation.itemId);
        const markerIds = [...savedMarkers].sort();
        const progress: OnboardingProgress = {
          journeyVersion: "2026-08-11.2",
          savedPracticeMarkerItemIds: markerIds,
          completedItemIds: markerIds,
          version: current.version + 1,
        };
        progressByActor.set(currentActor, progress);
        return { outcome: "updated" as const, progress };
      },
    };
    const app = express();
    app.use(express.json({ limit: "16kb" }));
    app.use(
      createGrowthSuiteRouter({
        repository,
        onboardingProgressRepository,
        now: () => NOW,
        resolveAccess: () => currentAccess,
        resolveActorUserId: () => currentActor,
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

  test("returns only tenant-scoped, contact-free lead summaries", async () => {
    const response = await fetch(`${origin}/growth-suite/leads`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/u);
    const body = (await response.json()) as {
      contactDataIncluded: boolean;
      items: Array<Record<string, unknown>>;
    };
    assert.equal(body.contactDataIncluded, false);
    assert.equal(body.items.length, 1);
    assert.equal(body.items[0]?.organisationId, ORGANISATION_ID);
    assert.equal("businessEmail" in body.items[0]!, false);
    assert.equal("businessTelephone" in body.items[0]!, false);
  });

  test("reveals one assigned contact without adding PII to the lead list", async () => {
    const response = await fetch(
      `${origin}/growth-suite/leads/lead-1/contact-handoff`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedVersion: 1,
          purpose: "initial_follow_up",
        }),
      },
    );
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/u);
    const body = (await response.json()) as {
      contactDataIncluded: boolean;
      handoff: {
        contactName: string;
        contactValue: string;
        preferredContactMethod: string;
        version: number;
      };
    };
    assert.equal(body.contactDataIncluded, true);
    assert.equal(body.handoff.contactName, "Amina Okafor");
    assert.equal(body.handoff.contactValue, "amina@example.test");
    assert.equal(body.handoff.preferredContactMethod, "email");
    assert.equal(body.handoff.version, 2);

    const leadList = (await (
      await fetch(`${origin}/growth-suite/leads`)
    ).json()) as { items: Array<Record<string, unknown>> };
    assert.equal("contactName" in leadList.items[0]!, false);
    assert.equal("contactValue" in leadList.items[0]!, false);
  });

  test("records a proposal without creating a pursuit or contacting the lead", async () => {
    const qualification = await fetch(
      `${origin}/growth-suite/leads/lead-1/actions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "set_status",
          expectedVersion: 2,
          status: "qualified",
          reason: "Tender scope and delivery window were confirmed manually.",
        }),
      },
    );
    assert.equal(qualification.status, 200);
    const response = await fetch(
      `${origin}/growth-suite/leads/lead-1/actions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "propose_conversion",
          expectedVersion: 3,
          suggestedPursuitTitle: "Synthetic roads tender",
          rationale: "Qualified by a named operator after scope review.",
        }),
      },
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      item: LeadInboxItem;
      authorityNote: string;
    };
    assert.equal(body.item.status, "conversion_proposed");
    assert.equal(
      body.item.conversionProposal?.status,
      "pending_human_decision",
    );
    assert.match(body.authorityNote, /creates no CRM record/u);
    assert.match(body.authorityNote, /converts no pursuit/u);
  });

  test("denies partner-derived and client-role access even with broad permissions", async () => {
    currentAccess = access(
      ["consultancy_partner_administrator"],
      ["organisation:read", "client:update", "order:create"],
      "partner",
    );
    assert.equal((await fetch(`${origin}/growth-suite/leads`)).status, 403);
    currentAccess = access(
      ["client_organisation_owner"],
      ["organisation:read", "client:update", "order:create"],
    );
    assert.equal((await fetch(`${origin}/growth-suite/leads`)).status, 403);
  });

  test("derives onboarding from server access and separates quote approval", async () => {
    currentAccess = access(
      ["valo_operations_administrator"],
      ["organisation:read", "client:update", "order:create"],
    );
    const onboarding = await fetch(
      `${origin}/growth-suite/onboarding?role=admin`,
    );
    assert.equal(onboarding.status, 200);
    const onboardingBody = (await onboarding.json()) as {
      journey: { derivedFromRoles: string[] };
      progress: OnboardingProgress;
    };
    assert.deepEqual(onboardingBody.journey.derivedFromRoles, [
      "valo_operations_administrator",
    ]);
    assert.equal(onboardingBody.progress.version, 0);

    const checkpoint = await fetch(
      `${origin}/growth-suite/onboarding/progress`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          journeyVersion: "2026-08-11.2",
          itemId: "confirm-active-workspace",
          expectedVersion: 0,
          markerSaved: true,
        }),
      },
    );
    assert.equal(checkpoint.status, 200);
    const checkpointBody = (await checkpoint.json()) as {
      progress: OnboardingProgress;
    };
    assert.deepEqual(checkpointBody.progress.savedPracticeMarkerItemIds, [
      "confirm-active-workspace",
    ]);
    assert.deepEqual(
      checkpointBody.progress.completedItemIds,
      checkpointBody.progress.savedPracticeMarkerItemIds,
    );
    assert.equal(checkpointBody.progress.version, 1);

    const draftResponse = await fetch(`${origin}/growth-suite/quotes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerReference: "CLIENT-042",
        offerVersionId: "assisted_bid@1",
        scopeSummary: "One bounded pursuit workspace.",
        currency: "NGN",
        amountMinor: 150_000_000,
        validUntil: "2026-08-30",
      }),
    });
    assert.equal(draftResponse.status, 201);
    const draft = (await draftResponse.json()) as {
      quote: { id: string; version: number };
    };
    const selfApproval = await fetch(
      `${origin}/growth-suite/quotes/${draft.quote.id}/approve`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion: draft.quote.version }),
      },
    );
    assert.equal(selfApproval.status, 409);

    currentActor = "operator-2";
    const approval = await fetch(
      `${origin}/growth-suite/quotes/${draft.quote.id}/approve`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion: draft.quote.version }),
      },
    );
    assert.equal(approval.status, 200);
    const approved = (await approval.json()) as {
      quote: { status: string; approvedByUserId: string };
    };
    assert.equal(approved.quote.status, "approved");
    assert.equal(approved.quote.approvedByUserId, "operator-2");
  });
});
