import type { ProjectSummary } from "@workspace/api-client-react";

export const SEARCH_LIMIT = 120;
export const FILTER_VALUE_LIMIT = 160;
export const REGISTER_CLOCK_INTERVAL_MS = 60 * 1000;

const WAT_OFFSET_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const WAT_NAIVE_DEADLINE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/u;
const EXPLICIT_OFFSET_DEADLINE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/u;

export const PROJECT_STATUSES = [
  "intake",
  "extraction",
  "review",
  "defects",
  "reporting",
  "signed_off",
  "exported",
  "archived",
] as const;
export const PROJECT_RISKS = ["low", "medium", "high", "critical"] as const;
export const DEADLINE_FILTERS = [
  "overdue",
  "due_today",
  "next_7_days",
  "next_30_days",
  "no_deadline",
] as const;
export const PROJECT_SORTS = [
  "deadline_asc",
  "deadline_desc",
  "risk_desc",
  "created_desc",
  "title_asc",
] as const;

type ProjectStatusFilter = (typeof PROJECT_STATUSES)[number] | "all";
type ProjectRiskFilter = (typeof PROJECT_RISKS)[number] | "all";
type DeadlineFilter = (typeof DEADLINE_FILTERS)[number] | "all";
type ProjectSort = (typeof PROJECT_SORTS)[number];

export type ProjectRegisterFilters = {
  search: string;
  status: ProjectStatusFilter;
  risk: ProjectRiskFilter;
  client: string;
  reviewer: string;
  deadline: DeadlineFilter;
  sort: ProjectSort;
};

export function retainEligibleSelectionId(
  selectedId: string,
  options: readonly { id: string }[],
) {
  return options.some(({ id }) => id === selectedId) ? selectedId : "";
}

export function boundedValue(value: string | null, limit = FILTER_VALUE_LIMIT) {
  return (value ?? "").slice(0, limit);
}

function allowedValue<T extends string, F extends string>(
  value: string | null,
  allowed: readonly T[],
  fallback: F,
): T | F {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

export type ParsedDeadline =
  | { kind: "none" }
  | { kind: "invalid" }
  | { kind: "valid"; timestamp: number };

function parseNaiveWatDeadline(value: string): number | null {
  const match = WAT_NAIVE_DEADLINE.exec(value);
  if (!match) return null;
  const [, year, month, day, hour = "00", minute = "00", second = "00"] = match;
  const milliseconds = (match[7] ?? "").padEnd(3, "0");
  const parts = [year, month, day, hour, minute, second, milliseconds].map(
    Number,
  );
  const [yearValue, monthValue, dayValue, hourValue, minuteValue, secondValue] =
    parts;
  if (
    monthValue < 1 ||
    monthValue > 12 ||
    dayValue < 1 ||
    dayValue > 31 ||
    hourValue > 23 ||
    minuteValue > 59 ||
    secondValue > 59
  ) {
    return null;
  }

  const watWallClockAsUtc = Date.UTC(
    yearValue,
    monthValue - 1,
    dayValue,
    hourValue,
    minuteValue,
    secondValue,
    parts[6],
  );
  const roundTrip = new Date(watWallClockAsUtc);
  if (
    roundTrip.getUTCFullYear() !== yearValue ||
    roundTrip.getUTCMonth() !== monthValue - 1 ||
    roundTrip.getUTCDate() !== dayValue ||
    roundTrip.getUTCHours() !== hourValue ||
    roundTrip.getUTCMinutes() !== minuteValue ||
    roundTrip.getUTCSeconds() !== secondValue
  ) {
    return null;
  }
  return watWallClockAsUtc - WAT_OFFSET_MS;
}

function hasValidCalendarDate(value: string) {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day || month > 12) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function parseProjectDeadline(
  value: string | null | undefined,
): ParsedDeadline {
  if (value === null || value === undefined) return { kind: "none" };
  const normalized = value.trim();
  if (!normalized) return { kind: "invalid" };

  const naiveWat = parseNaiveWatDeadline(normalized);
  if (naiveWat !== null) return { kind: "valid", timestamp: naiveWat };
  if (
    !EXPLICIT_OFFSET_DEADLINE.test(normalized) ||
    !hasValidCalendarDate(normalized)
  ) {
    return { kind: "invalid" };
  }
  const explicit = Date.parse(normalized);
  return Number.isFinite(explicit)
    ? { kind: "valid", timestamp: explicit }
    : { kind: "invalid" };
}

export function deadlineInputToIsoWat(value: string) {
  if (!value) return undefined;
  const parsed = parseProjectDeadline(value);
  if (parsed.kind !== "valid") return null;
  return new Date(parsed.timestamp).toISOString();
}

export function readProjectRegisterFilters(
  searchParams: URLSearchParams,
): ProjectRegisterFilters {
  return {
    search: boundedValue(searchParams.get("q"), SEARCH_LIMIT),
    status: allowedValue(searchParams.get("status"), PROJECT_STATUSES, "all"),
    risk: allowedValue(searchParams.get("risk"), PROJECT_RISKS, "all"),
    client: boundedValue(searchParams.get("client")),
    reviewer: boundedValue(searchParams.get("reviewer")),
    deadline: allowedValue(
      searchParams.get("deadline"),
      DEADLINE_FILTERS,
      "all",
    ),
    sort: allowedValue(searchParams.get("sort"), PROJECT_SORTS, "deadline_asc"),
  };
}

function instantTimestamp(value: string | null | undefined) {
  if (!value || !EXPLICIT_OFFSET_DEADLINE.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function watDay(value: number) {
  return Math.floor((value + WAT_OFFSET_MS) / DAY_MS);
}

function stableText(value: string | null | undefined) {
  return (value ?? "").trim().toLocaleLowerCase("en");
}

function stableIdentitySort(a: ProjectSummary, b: ProjectSummary) {
  const titleA = stableText(a.tenderTitle);
  const titleB = stableText(b.tenderTitle);
  if (titleA !== titleB) return titleA < titleB ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function deadlineMatches(
  deadline: string | null | undefined,
  filter: DeadlineFilter,
  now: number,
) {
  if (filter === "all") return true;
  const parsedDeadline = parseProjectDeadline(deadline);
  if (filter === "no_deadline") return parsedDeadline.kind === "none";
  if (parsedDeadline.kind !== "valid") return false;
  const deadlineTime = parsedDeadline.timestamp;
  if (filter === "overdue") return deadlineTime < now;

  const dayDistance = watDay(deadlineTime) - watDay(now);
  if (filter === "due_today") return dayDistance === 0;
  if (deadlineTime < now) return false;
  if (filter === "next_7_days") return dayDistance <= 7;
  return dayDistance <= 30;
}

export function filterAndSortProjects(
  projects: readonly ProjectSummary[],
  filters: ProjectRegisterFilters,
  referenceNow = Date.now(),
) {
  const query = stableText(filters.search);
  const riskWeight: Record<string, number> = {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
  };

  return projects
    .filter((project) => {
      if (
        query &&
        ![
          project.tenderTitle,
          project.issuingEntity,
          project.tenderRef,
          project.lot,
          project.clientName,
          project.reviewerName,
        ].some((value) => stableText(value).includes(query))
      ) {
        return false;
      }
      if (filters.status !== "all" && project.status !== filters.status) {
        return false;
      }
      if (filters.risk !== "all" && project.riskBand !== filters.risk) {
        return false;
      }
      if (filters.client && project.clientId !== filters.client) return false;
      if (filters.reviewer && project.reviewerId !== filters.reviewer) {
        return false;
      }
      return deadlineMatches(project.deadline, filters.deadline, referenceNow);
    })
    .sort((a, b) => {
      const parsedA = parseProjectDeadline(a.deadline);
      const parsedB = parseProjectDeadline(b.deadline);
      const aDeadline = parsedA.kind === "valid" ? parsedA.timestamp : null;
      const bDeadline = parsedB.kind === "valid" ? parsedB.timestamp : null;
      const deadlineDirection = filters.sort === "deadline_desc" ? -1 : 1;

      if (filters.sort === "deadline_asc" || filters.sort === "deadline_desc") {
        if (aDeadline === null && bDeadline !== null) return 1;
        if (aDeadline !== null && bDeadline === null) return -1;
        if (
          aDeadline !== null &&
          bDeadline !== null &&
          aDeadline !== bDeadline
        ) {
          return (aDeadline - bDeadline) * deadlineDirection;
        }
      } else if (filters.sort === "risk_desc") {
        const riskDifference =
          (riskWeight[b.riskBand ?? ""] ?? 0) -
          (riskWeight[a.riskBand ?? ""] ?? 0);
        if (riskDifference !== 0) return riskDifference;
      } else if (filters.sort === "created_desc") {
        const createdDifference =
          (instantTimestamp(b.createdAt) ?? Number.NEGATIVE_INFINITY) -
          (instantTimestamp(a.createdAt) ?? Number.NEGATIVE_INFINITY);
        if (createdDifference !== 0) return createdDifference;
      }

      return stableIdentitySort(a, b);
    });
}

export function formatDeadlineWat(deadline: string) {
  const parsed = parseProjectDeadline(deadline);
  if (parsed.kind !== "valid") return "Invalid deadline";
  return `${new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Lagos",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(parsed.timestamp))} WAT`;
}
