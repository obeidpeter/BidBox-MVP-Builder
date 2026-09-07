import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Layout tenant boundary", () => {
  it("requires a verified active organisation instead of using the legacy user role", () => {
    const sources = [
      "layout.tsx",
      "require-area.tsx",
      "require-admin.tsx",
      "role-home.tsx",
    ].map((file) =>
      readFileSync(resolve(process.cwd(), "src", "components", file), "utf8"),
    );
    const source = sources[0];

    expect(source).toContain("if (!organisationAccess.activeOrganisation)");
    expect(source).toContain(
      "const effectiveRoles = organisationAccess.effectiveRoles",
    );
    for (const guardedSource of sources) {
      expect(guardedSource).not.toContain("[String(user.role)]");
    }
  });
});
