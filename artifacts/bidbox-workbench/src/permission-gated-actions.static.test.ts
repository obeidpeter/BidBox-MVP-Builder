import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("server-permission action gates", () => {
  it.each([
    [
      "./pages/project-tabs/documents-tab.tsx",
      ["document:upload", "document:delete"],
    ],
    [
      "./pages/project-tabs/requirements-tab.tsx",
      ["requirement:write", "requirement:review"],
    ],
    [
      "./pages/project-tabs/evidence-tab.tsx",
      ["evidence:write", "evidence:approve"],
    ],
    ["./pages/project-tabs/defects-tab.tsx", ["defect:write", "defect:review"]],
    ["./components/client-vault.tsx", ["evidence:write"]],
    [
      "./components/client-capability.tsx",
      ["evidence:write", "evidence:approve"],
    ],
    ["./pages/sbd.tsx", ["requirement:review"]],
    ["./pages/sbd-details.tsx", ["requirement:review"]],
    ["./pages/project-tabs/boq-tab.tsx", ["defect:write"]],
    [
      "./pages/project-tabs/boq-commercial-verification.tsx",
      ["defect:write", "defect:review"],
    ],
    ["./pages/project-tabs/risk-tab.tsx", ["defect:review"]],
    ["./pages/client-details.tsx", ["client:update", "project:create"]],
    [
      "./pages/project-tabs/delivery-studio-tab.tsx",
      [
        "draft:write",
        "document:read",
        "evidence:read",
        "draft:review",
        "defect:write",
        "defect:review",
        "intelligence:review",
        "package:generate",
        "package:sign_off",
      ],
    ],
    [
      "./pages/portfolio-intelligence.tsx",
      [
        "project:read",
        "draft:read",
        "defect:read",
        "package:read",
        "analytics:read",
      ],
    ],
  ])("gates %s with the API permissions", (path, permissions) => {
    const content = source(path);
    for (const permission of permissions) {
      expect(content).toMatch(
        new RegExp(
          `useOrganisationPermission\\(\\s*"${permission}"\\s*,?\\s*\\)`,
          "u",
        ),
      );
    }
  });

  it("binds Delivery Studio reads to direct membership and every server-required grant", () => {
    const content = source("./pages/project-tabs/delivery-studio-tab.tsx");
    for (const permission of [
      "project:read",
      "draft:read",
      "defect:read",
      "package:read",
    ]) {
      expect(content).toContain(`"${permission}"`);
    }
    expect(content).toMatch(
      /activeOrganisation\?\.accessSource === "membership"/u,
    );
    expect(content).toMatch(
      /activeOrganisation\.membershipOrganisationId === activeOrganisation\.id/u,
    );
    expect(content).toMatch(
      /DELIVERY_STUDIO_READ_PERMISSIONS\.every\(\(permission\) =>\s*effectivePermissions\.includes\(permission\)/u,
    );
    expect(content).toMatch(
      /const actorName = meQuery\.data\?\.name\?\.trim\(\)/u,
    );
    expect(content).toMatch(
      /actorName\.length >= 2\s*&&\s*actorName\.length <= 200/u,
    );
    expect(content).toMatch(
      /enabled: canRequestStudio && projectId\.length > 0/u,
    );
    expect(content).toContain('title="Delivery Studio access required"');
    expect(content).toContain('title="Named profile required"');
  });

  it("binds portfolio reads to the server's direct named-member scope", () => {
    const content = source("./pages/portfolio-intelligence.tsx");
    expect(content).toMatch(
      /activeOrganisation\?\.accessSource === "membership"/u,
    );
    expect(content).toMatch(
      /activeOrganisation\.membershipOrganisationId === activeOrganisation\.id/u,
    );
    expect(content).toMatch(
      /const actorName = meQuery\.data\?\.name\?\.trim\(\)/u,
    );
    expect(content).toMatch(
      /actorName\.length >= 2 && actorName\.length <= 200/u,
    );
    expect(content).toMatch(/enabled: canRequestPortfolio/u);
    expect(content).toContain('title="Portfolio intelligence access required"');
    expect(content).toContain('title="Named profile required"');
  });

  it("binds Tender Context reads and mutations to the complete capability set", () => {
    const content = source("./pages/tender-context-route.tsx");
    for (const permission of [
      "project:read",
      "document:read",
      "requirement:read",
      "evidence:read",
      "rule_pack:read",
    ]) {
      expect(content).toContain(`"${permission}"`);
    }
    expect(content).toMatch(
      /READ_PERMISSIONS\.every\(\(permission\) => permissions\.includes\(permission\)\)/,
    );
    expect(content).toMatch(
      /canRead && isDirectMember && permissions\.includes\("requirement:write"\)/,
    );
    expect(content).toMatch(
      /canRead && isDirectMember && permissions\.includes\("intelligence:review"\)/,
    );
  });

  it("binds Addendum review and apply to the complete capability sets", () => {
    const content = source(
      "./components/intelligence/addendum-impact-centre.tsx",
    );
    for (const permission of [
      "project:read",
      "document:read",
      "requirement:read",
      "draft:read",
      "package:read",
      "report:read",
    ]) {
      expect(content).toContain(`"${permission}"`);
    }
    for (const permission of [
      "project:update",
      "requirement:review",
      "package:generate",
      "report:generate",
    ]) {
      expect(content).toContain(`"${permission}"`);
    }
    expect(content).toMatch(
      /READ_PERMISSIONS\.every\(\(permission\) => permissions\.includes\(permission\)\)/,
    );
    expect(content).toMatch(
      /canRead && directMembership && permissions\.includes\("intelligence:review"\)/,
    );
    expect(content).toMatch(
      /APPLY_PERMISSIONS\.every\(\(permission\) => permissions\.includes\(permission\)\)/,
    );
  });

  it("loads selected-tenant reviewer choices from membership permission, never legacy role", () => {
    const content = source("./pages/projects.tsx");
    expect(content).toContain('useOrganisationPermission("membership:read")');
    expect(content).toContain(
      "enabled: canCreateProject && canReadMemberships",
    );
    expect(content).not.toContain('me?.role === "admin"');
  });

  it("route-gates organisation settings with membership management", () => {
    const content = source("./lib/platform-access.ts");
    expect(content).toContain('organisation_settings: "membership:manage"');
    expect(content).toMatch(
      /href: "\/organisation-settings"[\s\S]*?requiredPermission: "membership:manage"/,
    );
  });

  it("gates the dashboard area on analytics:read at the area level", () => {
    const content = source("./lib/platform-access.ts");
    // The /app nav item deliberately carries no per-item requiredPermission:
    // navigationForRole already routes every item through the area decision,
    // and this area-level entry is the single authoritative dashboard gate
    // for both the nav link and the route.
    expect(content).toContain('workbench: "analytics:read"');
    expect(content).toMatch(
      /const requiredPermission = AREA_REQUIRED_PERMISSION\[area\];/,
    );
  });

  it("sends the quoted defect version required by optimistic concurrency", () => {
    const content = source("./pages/project-tabs/defects-tab.tsx");
    expect(content).toContain('headers: { "If-Match": `"${defect.version}"` }');
    expect(content).toContain("updateDefectRequest(defect.id");
  });
});
