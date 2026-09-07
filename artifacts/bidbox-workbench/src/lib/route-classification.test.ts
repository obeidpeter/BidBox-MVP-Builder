import { describe, expect, it } from "vitest";
import { classifyRoute } from "./route-classification";

describe("route privacy classification", () => {
  it.each([
    ["/", "public"],
    ["/product", "public"],
    ["/security", "public"],
    ["/not-an-implemented-public-route", "public"],
    ["/sign-in", "access"],
    ["/accept-invitation?ticket=opaque", "access"],
    ["/app", "protected"],
    ["/app/security", "protected"],
    ["/projects/project-id?tab=requirements", "protected"],
    ["/intelligence?project=project-id", "protected"],
    ["/portfolio-intelligence", "protected"],
    ["/pursuit-operations?project=project-id", "protected"],
    ["/growth-operations", "protected"],
    ["/commercial-retainer?project=project-id", "protected"],
    ["/evidence-renewals?project=project-id", "protected"],
    ["/claims-desk?project=project-id", "protected"],
    ["/consortium-room?project=project-id", "protected"],
    ["/organisation-settings", "protected"],
    ["/help", "protected"],
  ] as const)("classifies %s as %s", (path, expected) => {
    expect(classifyRoute(path)).toBe(expected);
  });

  it("does not treat a lookalike public path as a protected prefix", () => {
    expect(classifyRoute("/projects-and-services")).toBe("public");
    expect(classifyRoute("/helpful")).toBe("public");
  });
});
