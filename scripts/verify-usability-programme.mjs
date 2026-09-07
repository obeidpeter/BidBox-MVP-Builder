import assert from "node:assert/strict";
import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REQUIRED_ROLES = new Set([
  "bid_lead",
  "bid_analyst",
  "reviewer",
  "administrator",
  "partner",
  "executive_observer",
]);

const REQUIRED_ENVIRONMENTS = new Set([
  "desktop_standard",
  "mobile_narrow",
  "low_bandwidth",
  "deadline_interruption",
  "africa_lagos_time",
]);

const REQUIRED_METRICS = new Set([
  "task_completion",
  "task_abandonment",
  "time_on_task",
  "interaction_count",
  "errors_and_recovery",
  "assistance_requests",
  "confidence_rating",
  "system_usability_scale",
  "ueq_short",
  "nasa_tlx",
]);

const REQUIRED_CRITICAL_TASKS = new Set([
  "create_pursuit_with_validation",
  "understand_pursuit_lifecycle",
  "verify_existing_source_and_intake_state",
  "trace_requirement_to_source",
  "map_and_review_evidence",
  "compare_response_with_source",
  "sign_off_with_preflight",
  "assemble_and_export_package",
  "rehearse_submission_and_recover",
  "delete_record_safely",
]);

const REQUIRED_SURFACES = new Set([
  "form_feedback",
  "pursuit_lifecycle",
  "loading_and_error_states",
  "review_desk",
  "explainable_status",
  "governed_selectors",
  "sign_off_preflight",
  "export_preflight",
  "submission_rehearsal",
  "contextual_help",
]);

const TASK_ID = /^[a-z][a-z0-9_]{2,79}$/u;
const EVIDENCE_ID = /^[a-z0-9][a-z0-9._-]{2,119}$/u;
const PARTICIPANT_CODE = /^[A-Z0-9][A-Z0-9_-]{2,39}$/u;
const FINDING_ID = /^UX-[0-9]{4}-[0-9]{3,6}$/u;
const VALID_RISKS = new Set(["standard", "critical"]);
const VALID_FINDING_SEVERITIES = new Set(["critical", "high", "medium", "low"]);
const VALID_FINDING_PRINCIPLES = new Set([
  "accessibility",
  "authority_boundary",
  "interaction_design",
  "truthfulness",
  "usability",
]);
const VALID_FEEDBACK_SOURCES = new Set([
  "privacy_safe_product_feedback",
  "support_themes",
]);
const MAX_COMPLETE_EVIDENCE_WINDOW_DAYS = 100;
const MAX_FEEDBACK_TRIAGES = 20;
const MAX_COVERAGE_GAPS = 50;
const MILLISECONDS_PER_DAY = 86_400_000;

function assertExactSet(actual, expected, label) {
  assert.deepEqual(
    new Set(actual),
    expected,
    `${label} must match the required set`,
  );
  assert.equal(
    actual.length,
    expected.size,
    `${label} must not contain duplicates`,
  );
}

function assertNonEmptyText(value, label) {
  assert.equal(typeof value, "string", `${label} must be a string`);
  assert.ok(value.trim().length >= 12, `${label} must be meaningful`);
}

function assertRecord(value, label) {
  assert.ok(
    value && typeof value === "object" && !Array.isArray(value),
    `${label} must be an object`,
  );
  return value;
}

function isoInstant(value, label) {
  assert.equal(typeof value, "string", `${label} must be an ISO instant`);
  const parsed = new Date(value);
  assert.equal(
    Number.isNaN(parsed.valueOf()),
    false,
    `${label} must be an ISO instant`,
  );
  assert.equal(
    parsed.toISOString(),
    value,
    `${label} must be a canonical ISO instant`,
  );
  return parsed;
}

function isoDate(value, label) {
  assert.equal(typeof value, "string", `${label} must be an ISO date`);
  assert.match(value, /^\d{4}-\d{2}-\d{2}$/u, `${label} must be an ISO date`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  assert.equal(
    Number.isNaN(parsed.valueOf()),
    false,
    `${label} must be an ISO date`,
  );
  assert.equal(
    parsed.toISOString().slice(0, 10),
    value,
    `${label} must be a real ISO date`,
  );
  return parsed;
}

function ageInDays(now, value) {
  return (now.valueOf() - value.valueOf()) / MILLISECONDS_PER_DAY;
}

function calendarDay(value) {
  return Date.UTC(
    value.getUTCFullYear(),
    value.getUTCMonth(),
    value.getUTCDate(),
  );
}

function calendarDaysBetween(earlier, later) {
  return (calendarDay(later) - calendarDay(earlier)) / MILLISECONDS_PER_DAY;
}

export function validateUsabilityProgramme(programme) {
  assert.ok(
    programme && typeof programme === "object" && !Array.isArray(programme),
  );
  assert.equal(programme.schemaVersion, 1);
  assert.equal(programme.programmeId, "bidbox-continuous-usability/v1");
  assertNonEmptyText(programme.purpose, "purpose");
  assert.match(
    programme.evidencePolicy,
    /must never be reported as user outcomes/u,
    "The programme must prevent fabricated research claims",
  );

  assertExactSet(
    programme.participantRoles,
    REQUIRED_ROLES,
    "participantRoles",
  );
  assertExactSet(
    programme.testEnvironments,
    REQUIRED_ENVIRONMENTS,
    "testEnvironments",
  );
  assertExactSet(programme.metrics, REQUIRED_METRICS, "metrics");

  assert.deepEqual(programme.cadence, {
    expertWalkthrough: "before_each_release",
    accessibilityReview: "before_each_release",
    moderatedRoleSessions: "monthly",
    roleCoverageReview: "quarterly",
    productionFeedbackTriage: "weekly",
  });
  assert.deepEqual(programme.researchSafeguards, {
    requiresInformedConsent: true,
    useSyntheticTenderDataByDefault: true,
    recordingOptInOnly: true,
    excludeSecretsAndLiveBidContent: true,
    redactPersonalDataFromFindings: true,
    findingsRequireRoleAndEnvironmentContext: true,
  });
  assert.deepEqual(programme.releaseGates, {
    criticalTaskCompletionPercent: 90,
    maximumUnrecoveredCriticalErrors: 0,
    maximumCriticalAccessibilityViolations: 0,
    maximumCriticalTruthfulnessDefects: 0,
    requiresNamedFindingOwner: true,
    requiresRetestEvidenceForCriticalFixes: true,
  });

  assert.ok(Array.isArray(programme.tasks), "tasks must be an array");
  const taskIds = new Set();
  const criticalTasks = new Set();
  const coveredRoles = new Set();
  const coveredSurfaces = new Set();
  for (const task of programme.tasks) {
    assert.ok(task && typeof task === "object" && !Array.isArray(task));
    assert.match(task.id, TASK_ID);
    assert.equal(taskIds.has(task.id), false, `Duplicate task ${task.id}`);
    taskIds.add(task.id);
    assertNonEmptyText(task.title, `${task.id}.title`);
    assertNonEmptyText(task.startingState, `${task.id}.startingState`);
    assertNonEmptyText(task.successOutcome, `${task.id}.successOutcome`);
    assert.ok(VALID_RISKS.has(task.risk), `${task.id} has an invalid risk`);
    assert.ok(
      Array.isArray(task.roles) && task.roles.length > 0,
      `${task.id} needs roles`,
    );
    assert.equal(
      new Set(task.roles).size,
      task.roles.length,
      `${task.id}.roles must be unique`,
    );
    for (const role of task.roles) {
      assert.ok(REQUIRED_ROLES.has(role), `${task.id} uses an unknown role`);
      coveredRoles.add(role);
    }
    assert.ok(
      Array.isArray(task.surfaces) && task.surfaces.length > 0,
      `${task.id} needs product surfaces`,
    );
    assert.equal(
      new Set(task.surfaces).size,
      task.surfaces.length,
      `${task.id}.surfaces must be unique`,
    );
    task.surfaces.forEach((surface) => coveredSurfaces.add(surface));
    if (task.risk === "critical") criticalTasks.add(task.id);
  }

  assertExactSet([...coveredRoles], REQUIRED_ROLES, "task role coverage");
  assertExactSet([...criticalTasks], REQUIRED_CRITICAL_TASKS, "critical tasks");
  for (const surface of REQUIRED_SURFACES) {
    assert.ok(
      coveredSurfaces.has(surface),
      `Missing usability coverage for ${surface}`,
    );
  }
  const sourceTask = programme.tasks.find(
    ({ id }) => id === "verify_existing_source_and_intake_state",
  );
  assert.match(
    `${sourceTask.startingState} ${sourceTask.successOutcome}`,
    /uploads? (?:are|is) explicitly unavailable|no upload request can be sent/u,
    "Source-intake research must match the currently unavailable upload capability",
  );
  const lifecycleTask = programme.tasks.find(
    ({ id }) => id === "understand_pursuit_lifecycle",
  );
  assert.match(
    lifecycleTask.successOutcome,
    /no authoritative lifecycle stage is recorded/u,
    "Lifecycle research must not imply that stage navigation is recorded project state",
  );
  return programme;
}

export function validateUsabilityReleaseEvidence(evidence, programmeInput) {
  const programme = validateUsabilityProgramme(programmeInput);
  assertRecord(evidence, "release evidence");
  assert.equal(evidence.schemaVersion, 1);
  assert.equal(evidence.programmeId, programme.programmeId);
  assert.match(evidence.evidenceId, EVIDENCE_ID);
  assert.ok(
    ["complete", "missing"].includes(evidence.coverageStatus),
    "coverageStatus must be complete or missing",
  );
  assertRecord(evidence.evidenceWindow, "evidenceWindow");
  assert.ok(
    Array.isArray(evidence.productionFeedbackTriages),
    "productionFeedbackTriages must be an array",
  );
  assert.ok(Array.isArray(evidence.sessions), "sessions must be an array");
  assert.ok(Array.isArray(evidence.findings), "findings must be an array");
  assertRecord(evidence.releaseDecision, "releaseDecision");

  if (evidence.coverageStatus === "missing") {
    assert.equal(evidence.evidenceWindow.from, null);
    assert.equal(evidence.evidenceWindow.through, null);
    assertNonEmptyText(evidence.missingReason, "missingReason");
    assert.equal(evidence.expertWalkthrough, null);
    assert.equal(evidence.accessibilityReview, null);
    assert.equal(evidence.roleCoverageReview, null);
    assert.equal(evidence.productionFeedbackTriages.length, 0);
    assert.equal(evidence.sessions.length, 0);
    assert.equal(evidence.findings.length, 0);
    assert.deepEqual(evidence.releaseDecision, {
      status: "blocked_missing_evidence",
      owner: null,
      decidedAt: null,
      rationale: evidence.releaseDecision.rationale,
    });
    assertNonEmptyText(
      evidence.releaseDecision.rationale,
      "releaseDecision.rationale",
    );
    return evidence;
  }

  assert.equal(evidence.missingReason, null);
  const windowFrom = isoDate(
    evidence.evidenceWindow.from,
    "evidenceWindow.from",
  );
  const windowThrough = isoDate(
    evidence.evidenceWindow.through,
    "evidenceWindow.through",
  );
  assert.ok(
    windowFrom <= windowThrough,
    "evidenceWindow must not run backwards",
  );
  assert.ok(
    calendarDaysBetween(windowFrom, windowThrough) <=
      MAX_COMPLETE_EVIDENCE_WINDOW_DAYS,
    `evidenceWindow must not exceed ${MAX_COMPLETE_EVIDENCE_WINDOW_DAYS} days`,
  );

  const chronologyInstants = [];
  const assertInstantWithinWindow = (value, label) => {
    const parsed = isoInstant(value, label);
    const date = parsed.toISOString().slice(0, 10);
    assert.ok(
      date >= evidence.evidenceWindow.from &&
        date <= evidence.evidenceWindow.through,
      `${label} must fall inside evidenceWindow`,
    );
    chronologyInstants.push({ label, value: parsed });
    return parsed;
  };
  const criticalTaskIds = new Set(
    programme.tasks
      .filter(({ risk }) => risk === "critical")
      .map(({ id }) => id),
  );
  const taskById = new Map(programme.tasks.map((task) => [task.id, task]));
  const validateReview = (review, label) => {
    assertRecord(review, label);
    assert.equal(review.status, "completed");
    assertInstantWithinWindow(review.completedAt, `${label}.completedAt`);
    assertNonEmptyText(review.owner, `${label}.owner`);
    assert.ok(
      Array.isArray(review.taskIds),
      `${label}.taskIds must be an array`,
    );
    assertExactSet(review.taskIds, criticalTaskIds, `${label}.taskIds`);
  };
  validateReview(evidence.expertWalkthrough, "expertWalkthrough");
  validateReview(evidence.accessibilityReview, "accessibilityReview");
  assert.equal(
    Number.isInteger(evidence.accessibilityReview.criticalViolations),
    true,
    "accessibilityReview.criticalViolations must be an integer",
  );
  assert.ok(evidence.accessibilityReview.criticalViolations >= 0);

  const roleCoverageReview = assertRecord(
    evidence.roleCoverageReview,
    "roleCoverageReview",
  );
  assert.equal(roleCoverageReview.status, "completed");
  assertInstantWithinWindow(
    roleCoverageReview.completedAt,
    "roleCoverageReview.completedAt",
  );
  assertNonEmptyText(roleCoverageReview.owner, "roleCoverageReview.owner");
  assertNonEmptyText(
    roleCoverageReview.evidenceLocation,
    "roleCoverageReview.evidenceLocation",
  );
  assert.equal(
    roleCoverageReview.privacyReviewed,
    true,
    "roleCoverageReview needs privacy review",
  );
  assert.ok(
    Array.isArray(roleCoverageReview.participantRolesReviewed),
    "roleCoverageReview.participantRolesReviewed must be an array",
  );
  assertExactSet(
    roleCoverageReview.participantRolesReviewed,
    REQUIRED_ROLES,
    "roleCoverageReview.participantRolesReviewed",
  );
  assert.ok(
    Array.isArray(roleCoverageReview.environmentsReviewed),
    "roleCoverageReview.environmentsReviewed must be an array",
  );
  assertExactSet(
    roleCoverageReview.environmentsReviewed,
    REQUIRED_ENVIRONMENTS,
    "roleCoverageReview.environmentsReviewed",
  );
  assert.ok(
    Array.isArray(roleCoverageReview.coverageGaps) &&
      roleCoverageReview.coverageGaps.length <= MAX_COVERAGE_GAPS,
    `roleCoverageReview.coverageGaps must contain at most ${MAX_COVERAGE_GAPS} entries`,
  );
  for (const [index, gap] of roleCoverageReview.coverageGaps.entries()) {
    assertNonEmptyText(gap, `roleCoverageReview.coverageGaps[${index}]`);
  }

  assert.ok(
    evidence.productionFeedbackTriages.length > 0 &&
      evidence.productionFeedbackTriages.length <= MAX_FEEDBACK_TRIAGES,
    `productionFeedbackTriages must contain 1..${MAX_FEEDBACK_TRIAGES} records`,
  );
  const triageIds = new Set();
  for (const [index, triage] of evidence.productionFeedbackTriages.entries()) {
    const label = `productionFeedbackTriages[${index}]`;
    assertRecord(triage, label);
    assert.match(triage.triageId, EVIDENCE_ID);
    assert.equal(
      triageIds.has(triage.triageId),
      false,
      `Duplicate triage ${triage.triageId}`,
    );
    triageIds.add(triage.triageId);
    assertInstantWithinWindow(triage.triagedAt, `${label}.triagedAt`);
    assertNonEmptyText(triage.owner, `${label}.owner`);
    assertNonEmptyText(triage.evidenceLocation, `${label}.evidenceLocation`);
    assert.equal(triage.privacyReviewed, true, `${label} needs privacy review`);
    assert.ok(
      Array.isArray(triage.feedbackSources) &&
        triage.feedbackSources.length > 0,
      `${label}.feedbackSources must not be empty`,
    );
    assert.equal(
      new Set(triage.feedbackSources).size,
      triage.feedbackSources.length,
      `${label}.feedbackSources must be unique`,
    );
    for (const source of triage.feedbackSources) {
      assert.ok(
        VALID_FEEDBACK_SOURCES.has(source),
        `${label}.feedbackSources contains an unknown source`,
      );
    }
    assert.equal(
      Number.isInteger(triage.researchQuestionsRecorded),
      true,
      `${label}.researchQuestionsRecorded must be an integer`,
    );
    assert.ok(triage.researchQuestionsRecorded >= 0);
  }

  assert.ok(
    evidence.sessions.length > 0,
    "complete evidence needs observed sessions",
  );
  const participantCodes = new Set();
  const coveredRoles = new Set();
  const coveredEnvironments = new Set();
  const coveredCriticalTasks = new Set();
  const criticalResults = [];
  for (const [index, session] of evidence.sessions.entries()) {
    const label = `sessions[${index}]`;
    assertRecord(session, label);
    assert.match(session.participantCode, PARTICIPANT_CODE);
    assert.equal(
      participantCodes.has(session.participantCode),
      false,
      `Duplicate participant code ${session.participantCode}`,
    );
    participantCodes.add(session.participantCode);
    assert.ok(REQUIRED_ROLES.has(session.role), `${label}.role is unknown`);
    coveredRoles.add(session.role);
    assertInstantWithinWindow(session.observedAt, `${label}.observedAt`);
    assert.equal(
      session.consentRecorded,
      true,
      `${label} needs recorded consent`,
    );
    assert.equal(
      typeof session.recordingOptIn,
      "boolean",
      `${label}.recordingOptIn must be boolean`,
    );
    assert.equal(
      session.personalDataRedacted,
      true,
      `${label} must be privacy reviewed`,
    );
    assert.ok(
      Array.isArray(session.environments) && session.environments.length > 0,
      `${label}.environments must not be empty`,
    );
    assert.equal(
      new Set(session.environments).size,
      session.environments.length,
    );
    for (const environment of session.environments) {
      assert.ok(
        REQUIRED_ENVIRONMENTS.has(environment),
        `${label} uses an unknown environment`,
      );
      coveredEnvironments.add(environment);
    }
    assert.ok(
      Array.isArray(session.taskResults) && session.taskResults.length > 0,
      `${label}.taskResults must not be empty`,
    );
    for (const [resultIndex, result] of session.taskResults.entries()) {
      assertRecord(result, `${label}.taskResults[${resultIndex}]`);
    }
    assert.equal(
      new Set(session.taskResults.map((result) => result.taskId)).size,
      session.taskResults.length,
      `${label}.taskResults must use unique task IDs`,
    );
    for (const [resultIndex, result] of session.taskResults.entries()) {
      const resultLabel = `${label}.taskResults[${resultIndex}]`;
      const task = taskById.get(result.taskId);
      assert.ok(task, `${resultLabel}.taskId is unknown`);
      assert.ok(
        task.roles.includes(session.role),
        `${resultLabel} is not assigned to this role`,
      );
      assert.ok(
        ["completed", "abandoned"].includes(result.outcome),
        `${resultLabel}.outcome is invalid`,
      );
      assert.equal(typeof result.unrecoveredCriticalError, "boolean");
      assert.equal(Number.isFinite(result.timeOnTaskSeconds), true);
      assert.ok(result.timeOnTaskSeconds >= 0);
      assert.equal(Number.isInteger(result.interactionCount), true);
      assert.ok(result.interactionCount >= 0);
      assert.equal(Number.isInteger(result.assistanceRequests), true);
      assert.ok(result.assistanceRequests >= 0);
      assert.equal(Number.isFinite(result.confidenceRating), true);
      assert.ok(result.confidenceRating >= 1 && result.confidenceRating <= 5);
      if (criticalTaskIds.has(result.taskId)) {
        coveredCriticalTasks.add(result.taskId);
        criticalResults.push(result);
      }
    }
  }
  assertExactSet(
    [...coveredRoles],
    REQUIRED_ROLES,
    "release-evidence role coverage",
  );
  assertExactSet(
    [...coveredEnvironments],
    REQUIRED_ENVIRONMENTS,
    "release-evidence environment coverage",
  );
  assertExactSet(
    [...coveredCriticalTasks],
    criticalTaskIds,
    "release-evidence critical-task coverage",
  );

  const findingIds = new Set();
  for (const [index, finding] of evidence.findings.entries()) {
    const label = `findings[${index}]`;
    assertRecord(finding, label);
    assert.match(finding.id, FINDING_ID);
    assert.equal(
      findingIds.has(finding.id),
      false,
      `Duplicate finding ${finding.id}`,
    );
    findingIds.add(finding.id);
    const observedAt = assertInstantWithinWindow(
      finding.observedAt,
      `${label}.observedAt`,
    );
    assert.ok(REQUIRED_ROLES.has(finding.role), `${label}.role is unknown`);
    assert.ok(
      REQUIRED_ENVIRONMENTS.has(finding.environment),
      `${label}.environment is unknown`,
    );
    assert.ok(taskById.has(finding.taskId), `${label}.taskId is unknown`);
    assert.ok(
      VALID_FINDING_SEVERITIES.has(finding.severity),
      `${label}.severity is invalid`,
    );
    assert.ok(
      VALID_FINDING_PRINCIPLES.has(finding.principle),
      `${label}.principle is invalid`,
    );
    assertNonEmptyText(finding.observation, `${label}.observation`);
    assertNonEmptyText(finding.evidenceLocation, `${label}.evidenceLocation`);
    assert.equal(
      finding.privacyReviewed,
      true,
      `${label} needs privacy review`,
    );
    assertNonEmptyText(finding.owner, `${label}.owner`);
    assert.ok(
      ["open", "fixed"].includes(finding.status),
      `${label}.status is invalid`,
    );
    if (finding.status === "fixed") {
      assertNonEmptyText(finding.retestEvidence, `${label}.retestEvidence`);
      const retestedAt = assertInstantWithinWindow(
        finding.retestedAt,
        `${label}.retestedAt`,
      );
      assert.ok(
        retestedAt >= observedAt,
        `${label}.retestedAt must not predate observedAt`,
      );
    } else {
      assert.equal(finding.retestEvidence, null);
      assert.equal(finding.retestedAt, null);
    }
  }

  assert.equal(evidence.releaseDecision.status, "approved");
  assertNonEmptyText(evidence.releaseDecision.owner, "releaseDecision.owner");
  const decidedAt = isoInstant(
    evidence.releaseDecision.decidedAt,
    "releaseDecision.decidedAt",
  );
  assert.ok(
    decidedAt.toISOString().slice(0, 10) >= evidence.evidenceWindow.through,
    "releaseDecision must not predate evidenceWindow.through",
  );
  for (const event of chronologyInstants) {
    assert.ok(
      event.value <= decidedAt,
      `releaseDecision must follow ${event.label}`,
    );
  }
  assertNonEmptyText(
    evidence.releaseDecision.rationale,
    "releaseDecision.rationale",
  );
  return {
    evidence,
    criticalResults,
    chronology: {
      decidedAt,
      instants: chronologyInstants,
      windowFrom,
      windowThrough,
    },
  };
}

export function enforceUsabilityReleaseGate(
  evidenceInput,
  programmeInput,
  now = new Date(),
) {
  const validated = validateUsabilityReleaseEvidence(
    evidenceInput,
    programmeInput,
  );
  if (evidenceInput.coverageStatus === "missing") {
    throw new Error(
      `Usability release evidence is explicitly missing: ${evidenceInput.missingReason}`,
    );
  }
  const { evidence, criticalResults, chronology } = validated;
  const programme = programmeInput;
  assert.ok(now instanceof Date && !Number.isNaN(now.valueOf()));
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  assert.ok(
    chronology.windowThrough <= today,
    "evidenceWindow.through cannot be future-dated",
  );
  assert.ok(
    chronology.decidedAt <= now,
    "releaseDecision.decidedAt cannot be future-dated",
  );
  for (const event of chronology.instants) {
    assert.ok(event.value <= now, `${event.label} cannot be future-dated`);
  }
  for (const [label, date] of [
    [
      "expert walkthrough",
      isoInstant(
        evidence.expertWalkthrough.completedAt,
        "expertWalkthrough.completedAt",
      ),
    ],
    [
      "accessibility review",
      isoInstant(
        evidence.accessibilityReview.completedAt,
        "accessibilityReview.completedAt",
      ),
    ],
  ]) {
    const age = ageInDays(now, date);
    assert.ok(age >= 0, `${label} cannot be future-dated`);
    assert.ok(
      age <= 31,
      `${label} is older than the before-release evidence window`,
    );
  }
  for (const [index, session] of evidence.sessions.entries()) {
    const age = ageInDays(
      now,
      isoInstant(session.observedAt, `sessions[${index}].observedAt`),
    );
    assert.ok(age >= 0, `sessions[${index}] cannot be future-dated`);
    assert.ok(
      age <= 100,
      `sessions[${index}] is outside quarterly role/environment coverage`,
    );
  }
  assert.ok(
    evidence.sessions.some(
      (session) => ageInDays(now, new Date(session.observedAt)) <= 45,
    ),
    "No moderated session satisfies the monthly evidence cadence",
  );
  const coverageReviewAge = ageInDays(
    now,
    isoInstant(
      evidence.roleCoverageReview.completedAt,
      "roleCoverageReview.completedAt",
    ),
  );
  assert.ok(
    coverageReviewAge >= 0 && coverageReviewAge <= 100,
    "Role/environment coverage review is outside the quarterly cadence",
  );

  const triageDates = evidence.productionFeedbackTriages
    .map((triage, index) =>
      isoInstant(
        triage.triagedAt,
        `productionFeedbackTriages[${index}].triagedAt`,
      ),
    )
    .sort((left, right) => left.valueOf() - right.valueOf());
  assert.ok(
    calendarDaysBetween(chronology.windowFrom, triageDates[0]) <= 7,
    "Weekly production-feedback triage does not cover evidenceWindow.from",
  );
  for (let index = 1; index < triageDates.length; index += 1) {
    assert.ok(
      calendarDaysBetween(triageDates[index - 1], triageDates[index]) <= 7,
      "Production-feedback triage contains a gap longer than one week",
    );
  }
  assert.ok(
    calendarDaysBetween(
      triageDates[triageDates.length - 1],
      chronology.windowThrough,
    ) <= 7,
    "Weekly production-feedback triage does not cover evidenceWindow.through",
  );
  assert.ok(
    calendarDaysBetween(
      triageDates[triageDates.length - 1],
      chronology.decidedAt,
    ) <= 7,
    "Weekly production-feedback triage does not cover releaseDecision.decidedAt",
  );
  const completion =
    (criticalResults.filter(({ outcome }) => outcome === "completed").length /
      criticalResults.length) *
    100;
  assert.ok(
    completion >= programme.releaseGates.criticalTaskCompletionPercent,
    `Critical-task completion ${completion.toFixed(1)}% is below ${programme.releaseGates.criticalTaskCompletionPercent}%`,
  );
  const unrecoveredCriticalErrors = criticalResults.filter(
    ({ unrecoveredCriticalError }) => unrecoveredCriticalError,
  ).length;
  assert.ok(
    unrecoveredCriticalErrors <=
      programme.releaseGates.maximumUnrecoveredCriticalErrors,
    `Unrecovered critical errors ${unrecoveredCriticalErrors} exceed the release gate`,
  );
  assert.ok(
    evidence.accessibilityReview.criticalViolations <=
      programme.releaseGates.maximumCriticalAccessibilityViolations,
    "Critical accessibility violations exceed the release gate",
  );
  const openCriticalFindings = evidence.findings.filter(
    ({ severity, status }) => severity === "critical" && status !== "fixed",
  );
  assert.equal(
    openCriticalFindings.length,
    0,
    "Open critical usability findings block release",
  );
  const openTruthfulnessDefects = evidence.findings.filter(
    ({ principle, severity, status }) =>
      principle === "truthfulness" &&
      severity === "critical" &&
      status !== "fixed",
  ).length;
  assert.ok(
    openTruthfulnessDefects <=
      programme.releaseGates.maximumCriticalTruthfulnessDefects,
    "Critical truthfulness defects exceed the release gate",
  );
  return {
    evidenceId: evidence.evidenceId,
    completionPercent: completion,
    sessionCount: evidence.sessions.length,
    findingCount: evidence.findings.length,
  };
}

async function readRegularFile(path) {
  const stat = await lstat(path);
  assert.equal(stat.isFile(), true, `${path} must be a regular file`);
  assert.equal(stat.isSymbolicLink(), false, `${path} must not be a symlink`);
  return readFile(path, "utf8");
}

export async function verifyUsabilityProgramme(root) {
  const programmePath = resolve(
    root,
    "config/product/usability-programme.v1.json",
  );
  const releaseEvidencePath = resolve(
    root,
    "config/product/usability-release-evidence.v1.json",
  );
  const guidePath = resolve(
    root,
    "docs/usability/CONTINUOUS_USABILITY_PROGRAMME.md",
  );
  const programme = validateUsabilityProgramme(
    JSON.parse(await readRegularFile(programmePath)),
  );
  const releaseEvidence = JSON.parse(
    await readRegularFile(releaseEvidencePath),
  );
  validateUsabilityReleaseEvidence(releaseEvidence, programme);
  const guide = await readRegularFile(guidePath);

  for (const requiredGuidance of [
    "only observed sessions",
    "Use synthetic tender data by default",
    "The release gate is fail closed",
    "it cannot be reported as participant evidence",
  ]) {
    assert.ok(
      guide.includes(requiredGuidance),
      `Usability guidance is missing ${JSON.stringify(requiredGuidance)}`,
    );
  }

  return {
    taskCount: programme.tasks.length,
    evidenceStatus: releaseEvidence.coverageStatus,
  };
}

export async function verifyUsabilityRelease(root, now = new Date()) {
  const programme = JSON.parse(
    await readRegularFile(
      resolve(root, "config/product/usability-programme.v1.json"),
    ),
  );
  const evidence = JSON.parse(
    await readRegularFile(
      resolve(root, "config/product/usability-release-evidence.v1.json"),
    ),
  );
  return enforceUsabilityReleaseGate(evidence, programme, now);
}

const modulePath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === modulePath) {
  const root = resolve(import.meta.dirname, "..");
  if (process.argv.includes("--release")) {
    const result = await verifyUsabilityRelease(root);
    console.log(
      `Verified usability release evidence ${result.evidenceId}: ${result.completionPercent.toFixed(1)}% critical-task completion across ${result.sessionCount} sessions.`,
    );
  } else {
    const result = await verifyUsabilityProgramme(root);
    console.log(
      `Verified ${result.taskCount} continuous-usability tasks; release evidence is ${result.evidenceStatus}.`,
    );
  }
}
