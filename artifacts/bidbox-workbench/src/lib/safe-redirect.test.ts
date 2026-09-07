import { describe, expect, it } from "vitest";
import { safePostAuthRedirect } from "./safe-redirect";

const origin = "https://valo.example.test";

describe("post-authentication redirects", () => {
  it("preserves a same-origin protected deep link", () => {
    expect(
      safePostAuthRedirect("/projects/project-1?tab=requirements", origin),
    ).toBe("/projects/project-1?tab=requirements");
  });

  it.each([
    null,
    "",
    "https://attacker.invalid/steal",
    "//attacker.invalid/steal",
    "/\\attacker.invalid/steal",
    "/contact",
    "/sign-in",
  ])("rejects unsafe or non-workspace target %s", (target) => {
    expect(safePostAuthRedirect(target, origin)).toBe("/app");
  });
});
