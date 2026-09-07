import type { ProjectSummary } from "@workspace/api-client-react";
import { describe, expect, it } from "vitest";
import {
  buildPursuitControlTower,
  buildPursuitControlTowerItem,
  projectDeadlineTimestamp,
  pursuitStageForStatus,
  type PursuitControlTowerSignals,
} from "./pursuit-control-tower";

const NOW = Date.parse("2026-08-22T12:00:00Z");
const NO_SIGNALS: PursuitControlTowerSignals = {
  slaProjectIds: new Set(),
  independentReviewProjectIds: new Set(),
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

describe("pursuit control tower model", () => {
  it.each([
    ["intake", "intake", "overview"],
    ["extraction", "processing", "documents"],
    ["review", "review", "requirements"],
    ["defects", "resolution", "defects"],
    ["reporting", "submission", "reports"],
    ["signed_off", "delivery", "reports"],
    ["exported", "delivery", "reports"],
    ["archived", "delivery", "reports"],
  ] as const)(
    "maps %s to the %s stage and %s console",
    (status, stageId, tab) => {
      const mappedStage = pursuitStageForStatus(status);

      expect(mappedStage.id).toBe(stageId);
      expect(mappedStage.tab).toBe(tab);
    },
  );

  it("routes blockers to the console that can resolve them", () => {
    const conflict = buildPursuitControlTowerItem(
      project("conflict", "review", { conflictStatus: "blocked" }),
      NO_SIGNALS,
      NOW,
    );
    const fatalFinding = buildPursuitControlTowerItem(
      project("fatal", "reporting", { fatalDefectCount: 2 }),
      NO_SIGNALS,
      NOW,
    );
    const reviewDue = buildPursuitControlTowerItem(
      project("review-due", "review"),
      {
        ...NO_SIGNALS,
        independentReviewProjectIds: new Set(["review-due"]),
      },
      NOW,
    );

    expect(conflict.href).toBe("/projects/conflict?tab=overview");
    expect(conflict.state).toBe("blocked");
    expect(fatalFinding.href).toBe("/projects/fatal?tab=defects");
    expect(fatalFinding.state).toBe("pending");
    expect(reviewDue.href).toBe("/projects/review-due?tab=defects");
    expect(reviewDue.signals).toContainEqual({
      label: "Independent review due",
      state: "pending",
    });
  });

  it("orders verified blockers first and leaves archived pursuits out", () => {
    const items = buildPursuitControlTower(
      [
        project("upcoming", "review", {
          deadline: "2026-08-23T12:00",
        }),
        project("archived", "archived", {
          conflictStatus: "blocked",
        }),
        project("sla", "extraction"),
        project("quiet", "intake"),
      ],
      {
        ...NO_SIGNALS,
        slaProjectIds: new Set(["sla"]),
      },
      NOW,
    );

    expect(items.map((item) => item.project.id)).toEqual([
      "sla",
      "upcoming",
      "quiet",
    ]);
    expect(items[0].state).toBe("blocked");
    expect(items[2].stateLabel).toBe("No summary issue");
  });

  it("treats timezone-less recorded datetimes as West Africa Time", () => {
    expect(projectDeadlineTimestamp("2026-08-22T13:00")).toBe(
      Date.parse("2026-08-22T13:00:00+01:00"),
    );
    expect(projectDeadlineTimestamp("not-a-date")).toBeNull();
  });
});
