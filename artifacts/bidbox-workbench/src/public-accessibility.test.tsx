import { render, screen } from "@testing-library/react";
import axe from "axe-core";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import SignedOutRoutes from "./signed-out-routes";

function renderAt(path: string) {
  const { hook } = memoryLocation({ path });
  return render(
    <Router hook={hook}>
      <SignedOutRoutes />
    </Router>,
  );
}

async function expectNoAutomatedAccessibilityViolations(path: string) {
  const view = renderAt(path);
  await screen.findByRole("heading", { level: 1 });
  const results = await axe.run(view.container, {
    // jsdom has no layout or canvas implementation, so contrast remains a
    // browser/manual check rather than producing an unreliable test result.
    rules: { "color-contrast": { enabled: false } },
  });
  expect(
    results.violations.map(({ id, impact, nodes }) => ({
      id,
      impact,
      targets: nodes.map((node) => node.target),
    })),
  ).toEqual([]);
}

describe("public WCAG automation", () => {
  it("finds no axe violations on the landing page", async () => {
    await expectNoAutomatedAccessibilityViolations("/");
  }, 15_000);

  it("finds no axe violations on the Bid Autopsy request page", async () => {
    await expectNoAutomatedAccessibilityViolations("/request-bid-autopsy");
  }, 15_000);
});
