import type { ProjectSummary } from "@workspace/api-client-react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { describe, expect, it } from "vitest";
import { PursuitControlTower } from "./pursuit-control-tower";

const NOW = Date.parse("2026-08-22T12:00:00Z");
const NO_SIGNALS = {
  slaProjectIds: new Set<string>(),
  independentReviewProjectIds: new Set<string>(),
};

function project(
  id: string,
  status: ProjectSummary["status"],
  overrides: Partial<ProjectSummary> = {},
): ProjectSummary {
  return {
    id,
    clientId: "client-a",
    clientName: "Apex Client",
    tenderTitle: `Tender ${id}`,
    issuingEntity: null,
    tenderRef: null,
    lot: null,
    deadline: null,
    segment: "other",
    status,
    reviewerId: "reviewer-ada",
    reviewerName: "Ada Reviewer",
    slaClass: "standard",
    paymentStatus: "confirmed",
    conflictStatus: "clear",
    restrictedMode: false,
    riskScore: null,
    riskBand: "low",
    outcome: "none",
    nextAction: "Check the recorded next step",
    defectCount: 0,
    fatalDefectCount: 0,
    requirementCount: 0,
    createdAt: "2026-08-20T09:00:00Z",
    ...overrides,
  };
}

function renderTower(
  props: Partial<React.ComponentProps<typeof PursuitControlTower>> = {},
) {
  const location = memoryLocation({ path: "/app", record: true });
  const view = render(
    <Router hook={location.hook}>
      <PursuitControlTower
        projects={[
          project("documents", "extraction"),
          project("issues", "defects", { fatalDefectCount: 1 }),
        ]}
        projectState="ready"
        signals={NO_SIGNALS}
        signalState="ready"
        roleLabel="Bid manager"
        now={NOW}
        {...props}
      />
    </Router>,
  );
  return { ...view, location };
}

describe("PursuitControlTower", () => {
  it("shows a role-labelled priority queue and filters it by stage", async () => {
    const user = userEvent.setup();
    renderTower();

    expect(
      screen.getByRole("heading", { name: "Pursuit Control Tower" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Queue for Bid manager")).toBeInTheDocument();
    expect(screen.getByText("Tender documents")).toBeInTheDocument();
    expect(screen.getByText("Tender issues")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Documents: 1 pursuit" }),
    );

    expect(screen.getByText("Tender documents")).toBeInTheDocument();
    expect(screen.queryByText("Tender issues")).not.toBeInTheDocument();
    expect(screen.getByText(/Inspect accepted source files/i)).toBeVisible();
  });

  it("links a finding directly to the issue-resolution console", () => {
    renderTower({
      projects: [
        project("finding", "reporting", {
          fatalDefectCount: 2,
          nextAction: "Resolve the fatal findings",
        }),
      ],
    });

    expect(
      screen.getByRole("link", { name: "Open next action for Tender finding" }),
    ).toHaveAttribute("href", "/projects/finding?tab=defects");
  });

  it("fails closed when the authorised pursuit register is unavailable", () => {
    renderTower({
      projectState: "unavailable",
      projects: [project("must-not-render", "review")],
    });

    expect(
      screen.getByRole("heading", {
        name: "Pursuit queue could not be loaded",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Tender must-not-render"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/No stage, priority, deadline or next action is shown/i),
    ).toBeInTheDocument();
  });

  it("keeps project rows visible but marks missing workflow signals as limited", () => {
    renderTower({ signalState: "unavailable" });

    expect(
      screen.getByRole("heading", {
        name: "Some workflow signals are unavailable",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Tender documents")).toBeInTheDocument();
    expect(
      screen.getByText(/Their absence below does not mean they are clear/i),
    ).toBeInTheDocument();
    expect(screen.queryByText("No summary issue")).not.toBeInTheDocument();
    expect(
      screen.getByText("Workflow signals not verified"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/workflow alerts could not be verified/i),
    ).toBeInTheDocument();
  });
});
