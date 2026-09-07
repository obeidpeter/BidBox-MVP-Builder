import {
  AlertTriangle,
  Archive,
  BookOpenCheck,
  Boxes,
  ClipboardCheck,
  FileOutput,
  Files,
  Gauge,
  LayoutDashboard,
  ListChecks,
  PackageCheck,
  ShieldAlert,
  type LucideIcon,
} from "lucide-react";

import type { Project } from "@workspace/api-client-react";
import { formatWatInstant } from "@/lib/format";
import type { ReadinessAssessment } from "@/lib/readiness";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";

export type PursuitRegister =
  | "overview"
  | "documents"
  | "requirements"
  | "evidence"
  | "boq"
  | "defects"
  | "risk"
  | "delivery"
  | "reports"
  | "audit";

type LifecycleStageId =
  | "prepare"
  | "analyse"
  | "respond"
  | "review"
  | "deliver"
  | "record";

interface RegisterDefinition {
  id: PursuitRegister;
  label: string;
  icon: LucideIcon;
}

interface StageDefinition {
  id: LifecycleStageId;
  label: string;
  defaultRegister: PursuitRegister;
  registers: readonly RegisterDefinition[];
}

export const PURSUIT_LIFECYCLE_STAGES: readonly StageDefinition[] = [
  {
    id: "prepare",
    label: "Prepare",
    defaultRegister: "overview",
    registers: [
      { id: "overview", label: "Overview", icon: LayoutDashboard },
      { id: "documents", label: "Documents", icon: Files },
    ],
  },
  {
    id: "analyse",
    label: "Analyse",
    defaultRegister: "requirements",
    registers: [
      { id: "requirements", label: "Requirements", icon: ListChecks },
      { id: "evidence", label: "Evidence", icon: BookOpenCheck },
      { id: "boq", label: "BOQ", icon: Boxes },
    ],
  },
  {
    id: "respond",
    label: "Respond",
    defaultRegister: "delivery",
    registers: [
      { id: "delivery", label: "Delivery Studio", icon: PackageCheck },
    ],
  },
  {
    id: "review",
    label: "Review",
    defaultRegister: "defects",
    registers: [
      { id: "defects", label: "Defects", icon: ShieldAlert },
      { id: "risk", label: "Risk", icon: Gauge },
    ],
  },
  {
    id: "deliver",
    label: "Deliver",
    defaultRegister: "reports",
    registers: [{ id: "reports", label: "Package & export", icon: FileOutput }],
  },
  {
    id: "record",
    label: "Record",
    defaultRegister: "audit",
    registers: [{ id: "audit", label: "Audit", icon: ClipboardCheck }],
  },
] as const;

const PURSUIT_REGISTERS = PURSUIT_LIFECYCLE_STAGES.flatMap((stage) =>
  stage.registers.map((register) => register.id),
);

export function pursuitRegisterFromSearch(
  searchParams: URLSearchParams,
): PursuitRegister {
  const requested = searchParams.get("tab");
  return PURSUIT_REGISTERS.includes(requested as PursuitRegister)
    ? (requested as PursuitRegister)
    : "overview";
}

export function withPursuitRegister(
  searchParams: URLSearchParams,
  register: PursuitRegister,
): URLSearchParams {
  const next = new URLSearchParams(searchParams);
  if (register === "overview") next.delete("tab");
  else next.set("tab", register);
  return next;
}

function stageForRegister(register: PursuitRegister): StageDefinition {
  return (
    PURSUIT_LIFECYCLE_STAGES.find((stage) =>
      stage.registers.some((candidate) => candidate.id === register),
    ) ?? PURSUIT_LIFECYCLE_STAGES[0]
  );
}

function deadlineCopy(deadline: string | null | undefined) {
  if (!deadline) return "Not recorded";
  return formatWatInstant(deadline, {
    invalid: "Recorded value unavailable",
    suffix: " WAT",
  });
}

function completionCopy(project: Pick<Project, "status" | "submissionStatus">) {
  if (project.status === "signed_off") {
    return "Sign-off is recorded. No external-delivery receipt is exposed here.";
  }
  if (project.status === "exported") {
    return "Export is recorded. Export is not proof that a buyer received the package.";
  }
  if (project.status === "archived") {
    return "Archive status is recorded. No buyer receipt is exposed here.";
  }
  if (project.submissionStatus) {
    return `Submission status: ${project.submissionStatus}. This status is not a receipt.`;
  }
  return "No completion or external-submission receipt is exposed by this pursuit record.";
}

function readinessCopy(readiness: ReadinessAssessment) {
  if (readiness.status === "loading") {
    return {
      label: "Checking readiness",
      detail: "The current registers are being checked.",
    };
  }
  if (readiness.status === "error") {
    return {
      label: "Readiness unavailable",
      detail: "No readiness verdict is being inferred.",
    };
  }
  if (readiness.status === "not_checked") {
    return {
      label: "Readiness not checked",
      detail: "Open Overview to calculate blockers and the next action.",
    };
  }
  if (readiness.summary.ready) {
    return {
      label: "Core registers ready",
      detail:
        readiness.summary.warningCount > 0
          ? `${readiness.summary.warningCount} advisory warning${readiness.summary.warningCount === 1 ? "" : "s"} remain.`
          : "All required readiness checks currently pass.",
    };
  }
  return {
    label: `${readiness.summary.blockedRequired} required blocker${readiness.summary.blockedRequired === 1 ? "" : "s"}`,
    detail:
      readiness.summary.nextCheck?.detail ??
      "Open Overview to review the blocker list.",
  };
}

interface PursuitLifecycleRailProps {
  activeRegister: PursuitRegister;
  project: Pick<
    Project,
    | "status"
    | "deadline"
    | "reviewerName"
    | "submissionStatus"
    | "conflictStatus"
  >;
  readiness: ReadinessAssessment;
  onSelectRegister: (register: PursuitRegister) => void;
}

export function PursuitLifecycleRail({
  activeRegister,
  project,
  readiness,
  onSelectRegister,
}: PursuitLifecycleRailProps) {
  const viewedStage = stageForRegister(activeRegister);
  const readinessStatus = readinessCopy(readiness);
  const conflictBlocked =
    project.conflictStatus === "blocked" ||
    project.conflictStatus === "declined";
  const nextCheck =
    readiness.status === "ready" ? readiness.summary.nextCheck : null;
  let nextRegister: PursuitRegister | null = "overview";
  let nextAction =
    "Open Overview to calculate the first authoritative next action.";
  let nextActionLabel = "Open Overview";
  if (conflictBlocked) {
    nextAction =
      "Resolve the recorded conflict status from Overview before relying on downstream readiness.";
  } else if (nextCheck) {
    nextRegister = nextCheck.tab;
    nextAction = `${nextCheck.label}: ${nextCheck.detail}`;
    nextActionLabel = nextCheck.action;
  } else if (readiness.status === "error") {
    nextAction =
      "Return to Overview and retry after the connection recovers; no readiness verdict is available.";
  } else if (readiness.status === "ready" && readiness.summary.ready) {
    if (readiness.summary.warningCount > 0) {
      nextAction =
        "Open Overview and review the advisory warnings before external delivery.";
    } else {
      nextRegister = null;
      nextAction =
        "No system-prescribed next action is recorded. Select the stage that matches the pursuit plan.";
    }
  }

  return (
    <section className="space-y-4" aria-labelledby="pursuit-lifecycle-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            Pursuit lifecycle
          </p>
          <h2
            id="pursuit-lifecycle-title"
            className="mt-1 text-lg font-semibold text-slate-950"
          >
            Viewing stage: {viewedStage.label}
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Recorded project status: {project.status.replace(/_/g, " ")}. BidBox
            does not record a separate current lifecycle stage; selecting a
            stage only changes the registers in view.
          </p>
        </div>
        <Badge
          variant="outline"
          className="border-slate-300 bg-white text-slate-700"
        >
          {project.status.replace(/_/g, " ")}
        </Badge>
      </div>

      <ol
        className="flex snap-x gap-2 overflow-x-auto pb-2"
        aria-label="Pursuit stages"
      >
        {PURSUIT_LIFECYCLE_STAGES.map((stage) => {
          const isViewed = stage.id === viewedStage.id;
          return (
            <li key={stage.id} className="min-w-[8.75rem] flex-1 snap-start">
              <button
                type="button"
                aria-pressed={isViewed}
                aria-label={`View ${stage.label} stage registers`}
                onClick={() => onSelectRegister(stage.defaultRegister)}
                className={cn(
                  "min-h-[5.5rem] w-full rounded-xl border p-3 text-left transition-colors",
                  isViewed
                    ? "border-brand-700 bg-brand-50 text-brand-950"
                    : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50",
                )}
              >
                <span className="flex items-center justify-between gap-2 text-sm font-semibold">
                  {stage.label}
                </span>
                <span className="mt-2 block text-xs leading-5 text-slate-500">
                  {isViewed
                    ? "Registers in view"
                    : `${stage.registers.length} register${stage.registers.length === 1 ? "" : "s"}`}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4 sm:grid-cols-2 xl:grid-cols-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Owner / reviewer
          </p>
          <p className="mt-1 text-sm font-medium text-slate-900">
            Stage owner not recorded
          </p>
          <p className="mt-1 text-xs leading-5 text-slate-600">
            {project.reviewerName
              ? `Named project reviewer: ${project.reviewerName}`
              : "No named project reviewer is recorded."}
          </p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Deadline
          </p>
          <p className="mt-1 text-sm font-medium text-slate-900">
            {deadlineCopy(project.deadline)}
          </p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Readiness
          </p>
          <p className="mt-1 text-sm font-medium text-slate-900">
            {conflictBlocked
              ? "Conflict status blocks readiness"
              : readinessStatus.label}
          </p>
          <p className="mt-1 text-xs leading-5 text-slate-600">
            {conflictBlocked
              ? `Recorded conflict status: ${project.conflictStatus}.`
              : readinessStatus.detail}
          </p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Next action
          </p>
          <p className="mt-1 text-xs leading-5 text-slate-700">{nextAction}</p>
          {nextRegister ? (
            <Button
              type="button"
              variant="link"
              className="mt-1 h-auto p-0 text-brand-800"
              onClick={() => onSelectRegister(nextRegister)}
            >
              {nextActionLabel}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-3">
        <div className="flex items-start gap-2 text-xs leading-5 text-slate-600">
          {project.status === "exported" || project.status === "archived" ? (
            <Archive className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          ) : (
            <AlertTriangle
              className="mt-0.5 h-4 w-4 shrink-0"
              aria-hidden="true"
            />
          )}
          <p>{completionCopy(project)}</p>
        </div>
      </div>

      <details className="group rounded-xl border border-slate-200 bg-white">
        <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-slate-800 marker:hidden md:hidden">
          {viewedStage.label} registers
          <span className="ml-2 text-xs font-normal text-slate-500">
            {viewedStage.registers.length} in this stage · 10 total
          </span>
        </summary>
        <div className="hidden overflow-x-auto border-t border-slate-100 p-2 group-open:block md:block md:border-t-0">
          <TabsList
            className="h-auto min-w-max justify-start gap-1 bg-transparent p-0"
            aria-label={`${viewedStage.label} registers`}
          >
            {viewedStage.registers.map((register) => {
              const Icon = register.icon;
              return (
                <TabsTrigger
                  key={register.id}
                  value={register.id}
                  className="h-10 rounded-lg px-3 text-sm data-[state=active]:bg-slate-950 data-[state=active]:text-white"
                >
                  <Icon className="mr-2 h-4 w-4" aria-hidden="true" />
                  {register.label}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </div>
      </details>
    </section>
  );
}
