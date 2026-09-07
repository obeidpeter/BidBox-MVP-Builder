import { describe, expect, it } from "vitest";

import userManualMarkdown from "../../../../docs/USER_MANUAL.md?raw";
import {
  getProtectedRouteContext,
  getProtectedRouteManualTopic,
} from "@/lib/protected-route-context";
import { parseUserManualMarkdown } from "@/lib/user-manual";

describe("getProtectedRouteContext", () => {
  it("treats the user manual as an identity-level protected page", () => {
    const context = getProtectedRouteContext("/help");

    expect(context.title).toBe("Help & user manual");
    expect(context.area).toBeUndefined();
    expect(context.requiredPermissions).toEqual([]);
    expect(context.purpose).toMatch(/without opening customer records/i);
  });

  it("maps contextual help links to real manual topics", () => {
    const topicIds = new Set(
      parseUserManualMarkdown(userManualMarkdown).sections.map(
        (section) => section.id,
      ),
    );
    for (const route of [
      "/app",
      "/projects/project-id?tab=evidence",
      "/field-companion",
      "/communications",
      "/organisation-settings",
      "/help",
    ]) {
      expect(topicIds).toContain(getProtectedRouteManualTopic(route));
    }
  });

  it("maps project deep links to register-specific help and titles", () => {
    const context = getProtectedRouteContext(
      "/projects/11111111-1111-4111-8111-111111111111",
      new URLSearchParams("tab=delivery"),
    );

    expect(context.title).toBe("Delivery studio · Pursuit");
    expect(context.requiredPermissions).toEqual([
      "project:read",
      "draft:read",
      "defect:read",
      "package:read",
    ]);
    expect(context.requiredPermissions).not.toContain("evaluation:read");
    expect(context.example).toMatch(/receipt/i);
  });

  it("uses Overview for an invalid project tab", () => {
    expect(
      getProtectedRouteContext(
        "/projects/11111111-1111-4111-8111-111111111111",
        new URLSearchParams("tab=not-a-register"),
      ).title,
    ).toBe("Overview · Pursuit");
  });
});
