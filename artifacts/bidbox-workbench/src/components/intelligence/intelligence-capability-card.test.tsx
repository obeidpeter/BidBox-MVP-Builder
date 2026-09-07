import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { IntelligenceCapabilityCard } from "./intelligence-capability-card";
import { INTELLIGENCE_CAPABILITY_CATALOG } from "./intelligence-contract";

describe("IntelligenceCapabilityCard", () => {
  it("renders the real fragment target used by Review Inbox links", () => {
    const definition = INTELLIGENCE_CAPABILITY_CATALOG.find(
      ({ id }) => id === "evidence_graph",
    );
    expect(definition).toBeDefined();

    const { container } = render(
      <IntelligenceCapabilityCard
        definition={definition!}
        snapshot={{
          id: "evidence_graph",
          state: "partial",
          stateReason: "Named review is still required.",
        }}
      />,
    );

    expect(
      container.querySelector("#capability-evidence_graph"),
    ).toHaveAttribute("data-capability-id", "evidence_graph");
  });
});
