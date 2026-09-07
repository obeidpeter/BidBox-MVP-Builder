import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import IntelligenceCentre, {
  type IntelligenceCentreLoadState,
} from "./intelligence-centre";
import type { IntelligenceCentreSnapshot } from "@/components/intelligence/intelligence-contract";

function readySnapshot(
  overrides: Partial<IntelligenceCentreSnapshot> = {},
): IntelligenceCentreSnapshot {
  return {
    environment: "development",
    productionAiEnabled: false,
    restrictedMode: false,
    generatedAt: "2026-08-10T09:30:00.000Z",
    capabilities: [
      {
        id: "evidence_graph",
        state: "review_ready",
        stateReason: "Two suggested findings are ready for named review.",
        summary: "No finding has been confirmed by this snapshot.",
        reviewItemCount: 2,
        citationCount: 1,
        citations: [
          {
            id: "citation-1",
            sourceName: "Invitation to Tender.pdf",
            locator: "Page 14 · Clause 3.2",
            excerpt:
              "The bidder shall provide a valid tax clearance certificate.",
          },
        ],
        lastUpdatedAt: "2026-08-10T09:20:00.000Z",
      },
    ],
    ...overrides,
  };
}

describe("Intelligence Centre", () => {
  it("defaults to an honest production-disabled catalogue of all twenty-two capabilities", () => {
    const { container } = render(<IntelligenceCentre />);

    expect(
      screen.getByRole("heading", { name: "Bid insights" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "Production model execution is disabled",
      }),
    ).toBeInTheDocument();
    expect(container.querySelectorAll("[data-capability-id]")).toHaveLength(22);
    expect(
      screen.getAllByText(/Current level 0 · Maximum planned level [12]/),
    ).toHaveLength(22);
    expect(
      screen.getByRole("heading", {
        name: "Advanced decision support",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Current runtime")).toBeInTheDocument();
    expect(screen.getByText("Level 0")).toBeInTheDocument();
    expect(screen.getByText(/AI previews/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Valo does not approve evidence/i),
    ).toBeInTheDocument();
  });

  it("keeps loading and error states distinct from disabled or empty evidence", async () => {
    const retry = vi.fn();
    const { rerender } = render(
      <IntelligenceCentre loadState={{ status: "loading" }} />,
    );

    expect(
      screen.getByText("Loading intelligence evidence for this organisation"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", {
        name: "Production model execution is disabled",
      }),
    ).not.toBeInTheDocument();

    rerender(
      <IntelligenceCentre
        loadState={{ status: "error", message: "Service unavailable.", retry }}
      />,
    );
    expect(
      screen.getByRole("heading", {
        name: "Intelligence evidence could not be loaded",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Do not infer that capabilities/i),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("renders empty and partial snapshots as unknown while preserving the catalogue", () => {
    const emptyState: IntelligenceCentreLoadState = {
      status: "ready",
      snapshot: readySnapshot({ capabilities: [] }),
    };
    const { container, rerender } = render(
      <IntelligenceCentre loadState={emptyState} />,
    );

    expect(
      screen.getByRole("heading", {
        name: "No intelligence evidence is available",
      }),
    ).toBeInTheDocument();
    expect(container.querySelectorAll("[data-capability-id]")).toHaveLength(22);
    expect(screen.getAllByText("No current evidence")).toHaveLength(22);

    rerender(
      <IntelligenceCentre
        loadState={{ status: "ready", snapshot: readySnapshot() }}
      />,
    );
    expect(
      screen.getByRole("heading", {
        name: "The current intelligence data is incomplete",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/21 of 22 capability states/i)).toBeInTheDocument();
    expect(screen.getByText("Invitation to Tender.pdf")).toBeInTheDocument();
    expect(screen.getByText("Page 14 · Clause 3.2")).toBeInTheDocument();
    expect(
      screen.getByText(/A named reviewer checks every source quote/i),
    ).toBeInTheDocument();
  });

  it("makes Restricted Mode explicit without implying that it was bypassed", () => {
    render(
      <IntelligenceCentre
        loadState={{
          status: "ready",
          snapshot: readySnapshot({ restrictedMode: true }),
        }}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Restricted Mode is active" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/does not bypass that boundary/i),
    ).toBeInTheDocument();
  });
});
