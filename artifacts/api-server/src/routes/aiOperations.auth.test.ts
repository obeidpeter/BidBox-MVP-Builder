import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { OrganisationRole, Permission } from "../lib/permissions";
import type { AccessContext } from "../middlewares/tenancy";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??=
  "postgresql://bidbox_test:bidbox_test@127.0.0.1:1/bidbox_test";

const { aiOperationsBudgetBlocker, canReadInternalAiOperations } =
  await import("./aiOperations");

function accessContext(
  source: AccessContext["source"],
  roles: readonly OrganisationRole[],
): AccessContext {
  return {
    organisationId: "00000000-0000-4000-8000-000000000001",
    membershipId: source === "membership" ? "membership-id" : null,
    membershipOrganisationId:
      source === "membership" ? "00000000-0000-4000-8000-000000000001" : null,
    source,
    roles,
    permissions: new Set<Permission>(["evaluation:read"]),
    breakGlassSessionId: source === "break_glass" ? "break-glass-id" : null,
    partnerRelationshipId: source === "partner" ? "relationship-id" : null,
    partnerCoSigningRequired: false,
  };
}

describe("AI operations authority", () => {
  test("allows only direct BidBox internal operations memberships", () => {
    for (const role of [
      "valo_operations_administrator",
      "valo_analyst",
      "valo_quality_adviser",
    ] as const) {
      assert.equal(
        canReadInternalAiOperations(accessContext("membership", [role])),
        true,
        role,
      );
    }
  });

  test("denies client memberships even when their permission matrix includes evaluation read", () => {
    for (const role of [
      "client_organisation_owner",
      "client_administrator",
      "bid_manager",
      "contributor",
      "client_reviewer_approver",
      "read_only_auditor",
    ] as const) {
      assert.equal(
        canReadInternalAiOperations(accessContext("membership", [role])),
        false,
        role,
      );
    }
  });

  test("denies partner-derived and break-glass contexts", () => {
    assert.equal(
      canReadInternalAiOperations(
        accessContext("partner", ["consultancy_partner_administrator"]),
      ),
      false,
    );
    assert.equal(
      canReadInternalAiOperations(accessContext("break_glass", [])),
      false,
    );
  });

  test("denies restricted platform administration and missing context", () => {
    assert.equal(
      canReadInternalAiOperations(
        accessContext("membership", ["restricted_platform_administrator"]),
      ),
      false,
    );
    assert.equal(canReadInternalAiOperations(undefined), false);
  });
});

describe("AI operations budget readiness", () => {
  const baseBudget = {
    approved: true,
    currency: "NGN",
    remainingMinor: 5_000,
    rateCardVersion: "rate-card-v1",
    inputCostMinorPerThousandTokens: 1,
    outputCostMinorPerThousandTokens: 1,
  };

  test("fails closed for absent, exhausted and policy-mismatched budgets", () => {
    assert.equal(aiOperationsBudgetBlocker(null), "AI_BUDGET_UNAVAILABLE");
    assert.equal(
      aiOperationsBudgetBlocker({ ...baseBudget, remainingMinor: 0 }),
      "AI_BUDGET_EXCEEDED",
    );
    assert.equal(
      aiOperationsBudgetBlocker({ ...baseBudget, currency: "USD" }),
      "AI_BUDGET_CURRENCY_MISMATCH",
    );
    assert.equal(
      aiOperationsBudgetBlocker({ ...baseBudget, remainingMinor: 1 }),
      "AI_BUDGET_EXCEEDED",
    );
    assert.equal(
      aiOperationsBudgetBlocker({
        ...baseBudget,
        inputCostMinorPerThousandTokens: 0,
      }),
      "AI_BUDGET_UNAVAILABLE",
    );
  });

  test("accepts a positive budget in the capability-policy currency", () => {
    assert.equal(aiOperationsBudgetBlocker(baseBudget), null);
  });
});
