import { describe, expect, it } from "vitest";
import type { OrganisationMembershipView } from "@workspace/api-client-react";
import {
  delegableRoles,
  isLastActiveAdministrator,
  membershipHasCurrentAdministration,
} from "./organisation-membership-policy";

const NOW = Date.parse("2026-08-09T12:00:00Z");

function membership(
  id: string,
  role: OrganisationMembershipView["roles"][number]["role"],
  overrides: Partial<OrganisationMembershipView> = {},
): OrganisationMembershipView {
  return {
    id,
    user: {
      id: `00000000-0000-4000-8000-${id.padStart(12, "0")}`,
      email: `${id}@example.com`,
      name: id,
    },
    status: "active",
    accessStartsAt: null,
    accessExpiresAt: null,
    roles: [
      {
        id: `grant-${id}`,
        role,
        startsAt: null,
        expiresAt: null,
      },
    ],
    version: 1,
    ...overrides,
  };
}

describe("organisation membership delegation policy", () => {
  it("keeps a client administrator below the owner delegation ceiling", () => {
    expect(delegableRoles("client", ["client_administrator"])).toEqual([
      "client_administrator",
      "bid_manager",
      "contributor",
      "client_reviewer_approver",
      "read_only_auditor",
    ]);
  });

  it("does not expose client roles to a consultancy partner administrator", () => {
    expect(
      delegableRoles("consultancy_partner", [
        "consultancy_partner_administrator",
      ]),
    ).toEqual([
      "consultancy_partner_administrator",
      "consultancy_partner_analyst_reviewer",
      "read_only_auditor",
    ]);
  });

  it("does not let an operations administrator grant the restricted platform role", () => {
    expect(
      delegableRoles("valo", ["valo_operations_administrator"]),
    ).not.toContain("restricted_platform_administrator");
  });
});

describe("last administrator protection", () => {
  it("recognises only current, active administrative grants", () => {
    const active = membership("1", "client_administrator");
    const expired = membership("2", "client_administrator", {
      accessExpiresAt: "2026-08-08T12:00:00Z",
    });
    const contributor = membership("3", "contributor");

    expect(membershipHasCurrentAdministration(active, NOW)).toBe(true);
    expect(membershipHasCurrentAdministration(expired, NOW)).toBe(false);
    expect(membershipHasCurrentAdministration(contributor, NOW)).toBe(false);
    expect(
      isLastActiveAdministrator(active, [active, expired, contributor], NOW),
    ).toBe(true);
  });

  it("allows suspension protection to clear once another administrator is active", () => {
    const owner = membership("1", "client_organisation_owner");
    const administrator = membership("2", "client_administrator");

    expect(isLastActiveAdministrator(owner, [owner, administrator], NOW)).toBe(
      false,
    );
  });
});
