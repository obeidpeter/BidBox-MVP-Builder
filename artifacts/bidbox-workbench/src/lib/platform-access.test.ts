import { describe, expect, it } from "vitest";
import {
  getPlatformAccessDecision,
  navigationForRole,
  PORTFOLIO_INTELLIGENCE_READ_PERMISSIONS,
  platformFeatureFlags,
  platformHomeForRole,
  platformRoleLabel,
} from "./platform-access";

const disabledFlags = platformFeatureFlags({});
const enabledFlags = platformFeatureFlags({
  VITE_FEATURE_CLIENT_PORTAL: "true",
  VITE_FEATURE_PARTNER_WORKSPACE: "TRUE",
  VITE_FEATURE_BILLING_ENTITLEMENTS: "true",
  VITE_FEATURE_NOTIFICATION_ADAPTERS: "true",
});

describe("v2.5 platform access", () => {
  it("uses one clear label for canonical organisation roles", () => {
    expect(platformRoleLabel("client_organisation_owner")).toBe(
      "Client organisation owner",
    );
    expect(platformRoleLabel("bid_manager")).toBe("Bid manager");
    expect(platformRoleLabel("client_reviewer_approver")).toBe(
      "Client reviewer / approver",
    );
    expect(platformRoleLabel("future_role")).toBe("Future Role");
  });

  it("keeps commercial capabilities disabled unless explicitly activated", () => {
    expect(disabledFlags).toEqual({
      clientPortal: false,
      partnerWorkspace: false,
      billingEntitlements: false,
      notificationAdapters: false,
    });
    expect(enabledFlags).toEqual({
      clientPortal: true,
      partnerWorkspace: true,
      billingEntitlements: true,
      notificationAdapters: true,
    });
  });

  it("routes client and partner roles to their own home surfaces", () => {
    expect(
      platformHomeForRole("client_organisation_owner", disabledFlags),
    ).toBe("/projects");
    expect(platformHomeForRole("client_organisation_owner", enabledFlags)).toBe(
      "/portal",
    );
    expect(platformHomeForRole("consultancy_partner_analyst_reviewer")).toBe(
      "/partner",
    );
    expect(platformHomeForRole("valo_quality_adviser")).toBe("/app");
    expect(platformHomeForRole("restricted_platform_administrator")).toBe(
      "/app/security",
    );
  });

  it("uses clear labels for the main work areas", () => {
    const internalLabels = Object.fromEntries(
      navigationForRole("valo_operations_administrator", enabledFlags).map(
        (item) => [item.href, item.label],
      ),
    );
    const clientLabels = Object.fromEntries(
      navigationForRole("client_organisation_owner", enabledFlags).map(
        (item) => [item.href, item.label],
      ),
    );
    const growthLabels = Object.fromEntries(
      navigationForRole(
        "valo_operations_administrator",
        enabledFlags,
        ["organisation:read"],
        "membership",
      ).map((item) => [item.href, item.label]),
    );
    const commercialLabels = Object.fromEntries(
      navigationForRole(
        "client_organisation_owner",
        enabledFlags,
        ["billing:read", "entitlement:read"],
        "membership",
      ).map((item) => [item.href, item.label]),
    );

    expect(internalLabels).toMatchObject({
      "/app": "Dashboard",
      "/operations": "Operations",
      "/settings": "Platform settings",
    });
    expect(clientLabels).toMatchObject({
      "/intelligence": "Bid insights",
      "/portal": "Client workspace",
      "/sbd": "Requirements & compliance",
      "/billing": "Billing & access",
    });
    expect(growthLabels).toMatchObject({
      "/growth-operations": "Leads & offers",
    });
    expect(commercialLabels).toMatchObject({
      "/commercial-retainer": "Quotes, invoices & retainers",
    });
  });

  it("keeps Dashboard as home when an internal assignment is combined with an external role", () => {
    const roles = [
      "valo_operations_administrator",
      "client_reviewer_approver",
    ] as const;
    const permissions = ["analytics:read", "project:read"];

    expect(platformHomeForRole(roles, enabledFlags, permissions)).toBe("/app");
    expect(
      navigationForRole(roles, enabledFlags, permissions).map(
        (item) => item.href,
      ),
    ).toEqual(expect.arrayContaining(["/app", "/portal"]));
  });

  it("gives client owners the pursuit workbench plus their role surfaces", () => {
    const items = navigationForRole("client_organisation_owner", disabledFlags);
    expect(items.map((item) => item.href)).toEqual([
      "/projects",
      "/intelligence",
      "/portal",
      "/sbd",
      "/evidence-readiness",
      "/pursuit-operations",
      "/reports",
      "/clients",
      "/billing",
      "/notifications",
      "/organisation-settings",
    ]);
    expect(items.find((item) => item.href === "/portal")?.state).toBe(
      "pending_activation",
    );
    expect(items.some((item) => item.href === "/operations")).toBe(false);
    expect(items.some((item) => item.href === "/app")).toBe(false);
    expect(items.some((item) => item.href === "/settings")).toBe(false);
  });

  it("allows every canonical client role to open pursuit routes", () => {
    for (const role of [
      "client_organisation_owner",
      "client_administrator",
      "bid_manager",
      "contributor",
      "client_reviewer_approver",
    ] as const) {
      expect(
        getPlatformAccessDecision(role, "pursuit_workbench", enabledFlags),
      ).toMatchObject({ allowed: true, state: "active" });
      expect(
        navigationForRole(role, enabledFlags).map((item) => item.href),
      ).toContain("/projects");
    }
  });

  it("prevents a client role from opening internal operations directly", () => {
    expect(
      getPlatformAccessDecision("client_admin", "operations", enabledFlags),
    ).toMatchObject({
      allowed: false,
      state: "denied",
    });
    expect(
      getPlatformAccessDecision(
        "client_admin",
        "pursuit_operations",
        enabledFlags,
        ["project:read"],
        "membership",
      ),
    ).toMatchObject({ allowed: true, state: "active" });
  });

  it("allows partner reviewers to open selected-tenant pursuits but not administer billing", () => {
    const hrefs = navigationForRole(
      "consultancy_partner_analyst_reviewer",
      enabledFlags,
    ).map((item) => item.href);
    expect(hrefs).toContain("/partner");
    expect(hrefs).toContain("/evidence-readiness");
    expect(hrefs).toContain("/pursuit-operations");
    expect(hrefs).toContain("/notifications");
    expect(hrefs).not.toContain("/billing");
    expect(hrefs).toContain("/projects");
    expect(hrefs).toContain("/intelligence");
    expect(hrefs).not.toContain("/settings");
    expect(
      getPlatformAccessDecision(
        "consultancy_partner_analyst_reviewer",
        "pursuit_workbench",
        enabledFlags,
      ),
    ).toMatchObject({ allowed: true, state: "active" });
  });

  it("keeps the consortium room on the exact partner workspace feature and permission gate", () => {
    const permissions = ["partner_relationship:read", "project:read"];
    const pending = navigationForRole(
      "consultancy_partner_analyst_reviewer",
      disabledFlags,
      permissions,
      "partner",
    ).find(({ href }) => href === "/consortium-room");
    const active = navigationForRole(
      "consultancy_partner_analyst_reviewer",
      enabledFlags,
      permissions,
      "partner",
    ).find(({ href }) => href === "/consortium-room");
    expect(pending?.state).toBe("pending_activation");
    expect(active?.state).toBe("active");
    expect(
      navigationForRole(
        "consultancy_partner_analyst_reviewer",
        enabledFlags,
        ["project:read"],
        "partner",
      ).some(({ href }) => href === "/consortium-room"),
    ).toBe(false);
    expect(
      getPlatformAccessDecision(
        "client_organisation_owner",
        "partner_workspace",
        enabledFlags,
        permissions,
        "membership",
      ).allowed,
    ).toBe(false);
  });

  it("allows a read-only auditor to browse pursuit records without administration", () => {
    const hrefs = navigationForRole("read_only_auditor", enabledFlags).map(
      (item) => item.href,
    );
    expect(hrefs).toContain("/projects");
    expect(hrefs).toContain("/intelligence");
    expect(hrefs).toContain("/pursuit-operations");
    expect(hrefs).toContain("/reports");
    expect(hrefs).toContain("/app/security");
    expect(hrefs).not.toContain("/organisation-settings");
  });

  it("uses server-projected permissions to narrow partner navigation", () => {
    const permissions = [
      "project:read",
      "client:read",
      "requirement:read",
      "evidence:read",
      "report:read",
    ];
    const hrefs = navigationForRole(
      "consultancy_partner_administrator",
      enabledFlags,
      permissions,
      "partner",
    ).map((item) => item.href);
    expect(hrefs).toEqual([
      "/projects",
      "/sbd",
      "/evidence-readiness",
      "/pursuit-operations",
      "/reports",
      "/clients",
      "/notifications",
    ]);
    expect(
      platformHomeForRole(
        "consultancy_partner_administrator",
        enabledFlags,
        permissions,
      ),
    ).toBe("/projects");
  });

  it("shows the combined intelligence view only with its complete source-read set", () => {
    const basePermissions = [
      "client:read",
      "project:read",
      "document:read",
      "requirement:read",
      "evidence:read",
      "defect:read",
      "report:read",
      "draft:read",
      "evaluation:read",
    ];
    expect(
      navigationForRole("client_reviewer", enabledFlags, basePermissions).map(
        (item) => item.href,
      ),
    ).not.toContain("/intelligence");
    expect(
      navigationForRole("client_reviewer", enabledFlags, [
        ...basePermissions.filter(
          (permission) => permission !== "evaluation:read",
        ),
        "package:read",
      ]).map((item) => item.href),
    ).not.toContain("/intelligence");
    expect(
      navigationForRole("client_reviewer", enabledFlags, [
        ...basePermissions,
        "package:read",
      ]).map((item) => item.href),
    ).toContain("/intelligence");
  });

  it("keeps portfolio intelligence tenant-local and exact-permission-gated", () => {
    expect(
      getPlatformAccessDecision(
        "client_reviewer_approver",
        "portfolio_intelligence",
        enabledFlags,
        [...PORTFOLIO_INTELLIGENCE_READ_PERMISSIONS],
        "membership",
      ),
    ).toMatchObject({ allowed: true, state: "active" });
    expect(
      navigationForRole(
        "client_reviewer_approver",
        enabledFlags,
        [...PORTFOLIO_INTELLIGENCE_READ_PERMISSIONS],
        "membership",
      ).map((item) => item.href),
    ).toContain("/portfolio-intelligence");
    for (const accessSource of ["partner", undefined] as const) {
      expect(
        getPlatformAccessDecision(
          "consultancy_partner_analyst_reviewer",
          "portfolio_intelligence",
          enabledFlags,
          [...PORTFOLIO_INTELLIGENCE_READ_PERMISSIONS],
          accessSource,
        ),
      ).toMatchObject({ allowed: false, state: "denied" });
    }
    expect(
      getPlatformAccessDecision(
        "client_reviewer_approver",
        "portfolio_intelligence",
        enabledFlags,
        [],
        "membership",
      ),
    ).toMatchObject({ allowed: false, state: "denied" });
    expect(
      navigationForRole(
        "valo_operations_administrator",
        enabledFlags,
        ["analytics:read"],
        "membership",
      ).map((item) => item.href),
    ).not.toContain("/portfolio-intelligence");
  });

  it("preserves legacy reviewer access while hiding administration", () => {
    const hrefs = navigationForRole("reviewer", disabledFlags).map(
      (item) => item.href,
    );
    expect(hrefs).toContain("/app");
    expect(hrefs).toContain("/operations");
    expect(hrefs).toContain("/pursuit-operations");
    expect(hrefs).toContain("/evidence-readiness");
    expect(hrefs).not.toContain("/growth-operations");
    expect(hrefs).not.toContain("/app/security");
    expect(hrefs).not.toContain("/settings");
  });

  it("requires direct membership and organisation read access for onboarding and offers", () => {
    const permissions = ["organisation:read"];
    expect(
      getPlatformAccessDecision(
        "valo_operations_administrator",
        "growth_operations",
        enabledFlags,
        permissions,
        "membership",
      ),
    ).toMatchObject({ allowed: true, state: "active" });
    expect(
      navigationForRole(
        "valo_operations_administrator",
        enabledFlags,
        permissions,
        "membership",
      ).map((item) => item.href),
    ).toContain("/growth-operations");
    expect(
      getPlatformAccessDecision(
        "valo_operations_administrator",
        "growth_operations",
        enabledFlags,
        permissions,
        "partner",
      ),
    ).toMatchObject({ allowed: false, state: "denied" });
    expect(
      getPlatformAccessDecision(
        "valo_operations_administrator",
        "growth_operations",
        enabledFlags,
        permissions,
      ),
    ).toMatchObject({ allowed: false, state: "denied" });
    expect(
      getPlatformAccessDecision(
        "valo_operations_administrator",
        "growth_operations",
        enabledFlags,
        [],
        "membership",
      ),
    ).toMatchObject({ allowed: false, state: "denied" });
    expect(
      getPlatformAccessDecision(
        "client_reviewer_approver",
        "growth_operations",
        enabledFlags,
        permissions,
        "membership",
      ),
    ).toMatchObject({ allowed: true, state: "active" });
    expect(
      navigationForRole(
        "client_reviewer_approver",
        enabledFlags,
        permissions,
        "membership",
      ).map((item) => item.href),
    ).toContain("/growth-operations");
    expect(
      getPlatformAccessDecision(
        "consultancy_partner_analyst_reviewer",
        "growth_operations",
        enabledFlags,
        permissions,
        "partner",
      ),
    ).toMatchObject({ allowed: false, state: "denied" });
  });

  it("requires direct membership and both record-read grants for quotes, invoices and retainers", () => {
    const permissions = ["billing:read", "entitlement:read"];
    expect(
      getPlatformAccessDecision(
        "client_organisation_owner",
        "commercial_retainer",
        enabledFlags,
        permissions,
        "membership",
      ),
    ).toMatchObject({ allowed: true, state: "active" });
    expect(
      navigationForRole(
        "client_organisation_owner",
        enabledFlags,
        permissions,
        "membership",
      ).map((item) => item.href),
    ).toContain("/commercial-retainer");
    expect(
      getPlatformAccessDecision(
        "client_organisation_owner",
        "commercial_retainer",
        enabledFlags,
        ["entitlement:read"],
        "membership",
      ),
    ).toMatchObject({ allowed: false, state: "denied" });
    expect(
      getPlatformAccessDecision(
        "client_organisation_owner",
        "commercial_retainer",
        enabledFlags,
        permissions,
        "partner",
      ),
    ).toMatchObject({ allowed: false, state: "denied" });
  });

  it("fails the Claims Desk closed unless project-read comes from direct membership", () => {
    const permissions = ["project:read"];
    expect(
      getPlatformAccessDecision(
        "client_reviewer_approver",
        "claims_desk",
        enabledFlags,
        permissions,
        "membership",
      ),
    ).toMatchObject({ allowed: true, state: "active" });
    expect(
      navigationForRole(
        "client_reviewer_approver",
        enabledFlags,
        permissions,
        "membership",
      ).map((item) => item.href),
    ).toContain("/claims-desk");
    for (const accessSource of ["partner", undefined] as const) {
      expect(
        getPlatformAccessDecision(
          "consultancy_partner_analyst_reviewer",
          "claims_desk",
          enabledFlags,
          permissions,
          accessSource,
        ),
      ).toMatchObject({ allowed: false, state: "denied" });
    }
    expect(
      getPlatformAccessDecision(
        "client_reviewer_approver",
        "claims_desk",
        enabledFlags,
        [],
        "membership",
      ),
    ).toMatchObject({ allowed: false, state: "denied" });
  });

  it("keeps the durable communications ledger direct-only and independent of notification adapters", () => {
    const permissions = ["project:read"];
    const navigation = navigationForRole(
      "client_reviewer_approver",
      disabledFlags,
      permissions,
      "membership",
    );

    expect(
      navigation.find(({ href }) => href === "/notifications")?.state,
    ).toBe("pending_activation");
    expect(
      navigation.find(({ href }) => href === "/communications")?.state,
    ).toBe("active");
    expect(
      getPlatformAccessDecision(
        "consultancy_partner_analyst_reviewer",
        "communications",
        disabledFlags,
        permissions,
        "partner",
      ),
    ).toMatchObject({ allowed: false, state: "denied" });
  });

  it("rejects unknown and unassigned roles fail-closed", () => {
    expect(
      getPlatformAccessDecision("mystery_role", "client_portal", enabledFlags)
        .allowed,
    ).toBe(false);
    expect(
      getPlatformAccessDecision("none", "workbench", enabledFlags).allowed,
    ).toBe(false);
  });

  it("keeps restricted platform administration out of tenant workspaces", () => {
    const hrefs = navigationForRole(
      "restricted_platform_administrator",
      enabledFlags,
    ).map((item) => item.href);
    expect(hrefs).toEqual(["/app/security"]);
    expect(
      getPlatformAccessDecision(
        "restricted_platform_administrator",
        "workbench",
        enabledFlags,
      ).allowed,
    ).toBe(false);
  });

  it("unions multiple active role grants without widening unknown roles", () => {
    const hrefs = navigationForRole(
      ["client_reviewer_approver", "read_only_auditor", "unknown_role"],
      enabledFlags,
    ).map((item) => item.href);
    expect(hrefs).toContain("/portal");
    expect(hrefs).toContain("/evidence-readiness");
    expect(hrefs).toContain("/app/security");
    expect(hrefs).not.toContain("/settings");
  });

  it("accepts short role strings only as migration aliases", () => {
    expect(platformHomeForRole("client_owner", disabledFlags)).toBe(
      "/projects",
    );
    expect(platformHomeForRole("client_owner", enabledFlags)).toBe("/portal");
    expect(platformHomeForRole("partner_reviewer")).toBe("/partner");
    expect(platformHomeForRole("client_auditor")).toBe("/evidence-readiness");
    expect(
      navigationForRole("client_auditor", enabledFlags).map(
        (item) => item.href,
      ),
    ).toEqual([
      "/projects",
      "/intelligence",
      "/sbd",
      "/evidence-readiness",
      "/pursuit-operations",
      "/reports",
      "/clients",
      "/app/security",
    ]);
  });
});
