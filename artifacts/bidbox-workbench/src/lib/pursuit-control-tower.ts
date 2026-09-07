import type { ProjectSummary } from "@workspace/api-client-react";

export type PursuitStageId =
  | "intake"
  | "processing"
  | "review"
  | "resolution"
  | "submission"
  | "delivery";

export interface PursuitStageDefinition {
  id: PursuitStageId;
  label: string;
  shortLabel: string;
  description: string;
  tab: "overview" | "documents" | "requirements" | "defects" | "reports";
}

export interface PursuitControlSignal {
  label: string;
  state: "blocked" | "pending";
}

export interface PursuitControlTowerItem {
  project: ProjectSummary;
  stage: PursuitStageDefinition;
  href: string;
  nextAction: string;
  signals: PursuitControlSignal[];
  state: "blocked" | "pending" | "active";
  stateLabel: string;
  priority: number;
  deadlineTimestamp: number | null;
}

export interface PursuitControlTowerSignals {
  slaProjectIds: ReadonlySet<string>;
  independentReviewProjectIds: ReadonlySet<string>;
}

export const PURSUIT_STAGES: readonly PursuitStageDefinition[] = [
  {
    id: "intake",
    label: "Set up & intake",
    shortLabel: "Intake",
    description: "Confirm governance, access, scope and tender details.",
    tab: "overview",
  },
  {
    id: "processing",
    label: "Process documents",
    shortLabel: "Documents",
    description: "Inspect accepted source files and their processing state.",
    tab: "documents",
  },
  {
    id: "review",
    label: "Review requirements",
    shortLabel: "Review",
    description: "Confirm requirements, citations and evidence needs.",
    tab: "requirements",
  },
  {
    id: "resolution",
    label: "Resolve issues",
    shortLabel: "Issues",
    description: "Remediate findings and complete independent review.",
    tab: "defects",
  },
  {
    id: "submission",
    label: "Prepare package",
    shortLabel: "Package",
    description: "Check, sign and prepare the controlled package.",
    tab: "reports",
  },
  {
    id: "delivery",
    label: "Delivery & close",
    shortLabel: "Delivery",
    description: "Review signed, exported and close-out records.",
    tab: "reports",
  },
] as const;

const STAGE_BY_ID = new Map(PURSUIT_STAGES.map((stage) => [stage.id, stage]));

const EMPTY_SIGNALS: PursuitControlTowerSignals = {
  slaProjectIds: new Set<string>(),
  independentReviewProjectIds: new Set<string>(),
};

function stage(id: PursuitStageId): PursuitStageDefinition {
  const value = STAGE_BY_ID.get(id);
  if (!value) throw new Error(`Unknown pursuit stage: ${id}`);
  return value;
}

export function pursuitStageForStatus(
  status: ProjectSummary["status"],
): PursuitStageDefinition {
  switch (status) {
    case "intake":
      return stage("intake");
    case "extraction":
      return stage("processing");
    case "review":
      return stage("review");
    case "defects":
      return stage("resolution");
    case "reporting":
      return stage("submission");
    case "signed_off":
    case "exported":
    case "archived":
      return stage("delivery");
  }
}

export function projectDeadlineTimestamp(
  value: string | null | undefined,
): number | null {
  if (!value) return null;
  const hasTime = value.includes("T");
  const hasExplicitZone = /(?:z|[+-]\d{2}:?\d{2})$/i.test(value);
  const timestamp = new Date(
    hasTime && !hasExplicitZone ? `${value}+01:00` : value,
  ).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

function controlSignals(
  project: ProjectSummary,
  signals: PursuitControlTowerSignals,
  now: number,
): PursuitControlSignal[] {
  const rows: PursuitControlSignal[] = [];
  const deadline = projectDeadlineTimestamp(project.deadline);

  if (signals.slaProjectIds.has(project.id)) {
    rows.push({ label: "Review deadline missed", state: "blocked" });
  }
  if (
    project.conflictStatus === "blocked" ||
    project.conflictStatus === "declined"
  ) {
    rows.push({ label: "Conflict decision blocks intake", state: "blocked" });
  }
  if ((project.fatalDefectCount ?? 0) > 0) {
    rows.push({
      label: `${project.fatalDefectCount} fatal or likely-fatal finding${project.fatalDefectCount === 1 ? "" : "s"} recorded`,
      state: "pending",
    });
  }
  if (signals.independentReviewProjectIds.has(project.id)) {
    rows.push({ label: "Independent review due", state: "pending" });
  }
  if (project.paymentStatus === "pending") {
    rows.push({ label: "Payment confirmation pending", state: "pending" });
  }
  if (project.riskBand === "critical" || project.riskBand === "high") {
    rows.push({
      label: `${project.riskBand === "critical" ? "Critical" : "High"} recorded risk`,
      state: "pending",
    });
  }
  if (deadline !== null && deadline < now) {
    rows.push({ label: "Recorded submission time passed", state: "pending" });
  } else if (deadline !== null && deadline - now <= 72 * 60 * 60 * 1_000) {
    rows.push({ label: "Recorded deadline within 72 hours", state: "pending" });
  }

  return rows;
}

function targetTab(
  project: ProjectSummary,
  signals: PursuitControlTowerSignals,
  mappedStage: PursuitStageDefinition,
): PursuitStageDefinition["tab"] {
  if (
    project.conflictStatus === "blocked" ||
    project.conflictStatus === "declined" ||
    project.paymentStatus === "pending" ||
    signals.slaProjectIds.has(project.id)
  ) {
    return "overview";
  }
  if (
    (project.fatalDefectCount ?? 0) > 0 ||
    signals.independentReviewProjectIds.has(project.id)
  ) {
    return "defects";
  }
  return mappedStage.tab;
}

function priorityScore(
  project: ProjectSummary,
  signals: PursuitControlTowerSignals,
  now: number,
): number {
  let score = 0;
  if (signals.slaProjectIds.has(project.id)) score += 100;
  if (
    project.conflictStatus === "blocked" ||
    project.conflictStatus === "declined"
  ) {
    score += 90;
  }
  if ((project.fatalDefectCount ?? 0) > 0) score += 80;
  if (signals.independentReviewProjectIds.has(project.id)) score += 70;
  if (project.riskBand === "critical") score += 60;
  else if (project.riskBand === "high") score += 50;
  if (project.paymentStatus === "pending") score += 40;

  const deadline = projectDeadlineTimestamp(project.deadline);
  if (deadline !== null) {
    if (deadline < now) score += 35;
    else if (deadline - now <= 72 * 60 * 60 * 1_000) score += 25;
    else if (deadline - now <= 7 * 24 * 60 * 60 * 1_000) score += 15;
    else score += 5;
  }
  return score;
}

export function buildPursuitControlTowerItem(
  project: ProjectSummary,
  signals: PursuitControlTowerSignals = EMPTY_SIGNALS,
  now = Date.now(),
): PursuitControlTowerItem {
  const mappedStage = pursuitStageForStatus(project.status);
  const itemSignals = controlSignals(project, signals, now);
  const state = itemSignals.some((item) => item.state === "blocked")
    ? "blocked"
    : itemSignals.length > 0
      ? "pending"
      : "active";
  const tab = targetTab(project, signals, mappedStage);
  const nextAction =
    project.nextAction?.trim() || "Review current pursuit state";

  return {
    project,
    stage: mappedStage,
    href: `/projects/${project.id}?tab=${tab}`,
    nextAction,
    signals: itemSignals,
    state,
    stateLabel:
      state === "blocked"
        ? "Blocked"
        : state === "pending"
          ? `${itemSignals.length} item${itemSignals.length === 1 ? "" : "s"} to check`
          : "No summary issue",
    priority: priorityScore(project, signals, now),
    deadlineTimestamp: projectDeadlineTimestamp(project.deadline),
  };
}

export function buildPursuitControlTower(
  projects: readonly ProjectSummary[],
  signals: PursuitControlTowerSignals = EMPTY_SIGNALS,
  now = Date.now(),
): PursuitControlTowerItem[] {
  return projects
    .filter((project) => project.status !== "archived")
    .map((project) => buildPursuitControlTowerItem(project, signals, now))
    .sort(
      (left, right) =>
        right.priority - left.priority ||
        (left.deadlineTimestamp ?? Number.POSITIVE_INFINITY) -
          (right.deadlineTimestamp ?? Number.POSITIVE_INFINITY) ||
        new Date(right.project.createdAt).getTime() -
          new Date(left.project.createdAt).getTime(),
    );
}
