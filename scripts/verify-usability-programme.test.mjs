import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import {
  enforceUsabilityReleaseGate,
  validateUsabilityProgramme,
  validateUsabilityReleaseEvidence,
  verifyUsabilityProgramme,
} from "./verify-usability-programme.mjs";
import { createUsabilityReleaseDecision } from "./usability-release-decision.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const checkedInProgramme = JSON.parse(
  await readFile(
    resolve(repositoryRoot, "config/product/usability-programme.v1.json"),
    "utf8",
  ),
);

test("the per-release waiver cannot bypass failed complete evidence", () => {
  const values = {
    programme: programme(),
    evidence: completeReleaseEvidence(),
    programmeSha256: "a".repeat(64),
    evidenceSha256: "b".repeat(64),
    sourceCommitSha: "c".repeat(40),
    github: {
      repository: "obeidpeter/BidBox-MVP-Builder",
      repositoryId: "123",
      runId: "456",
      runAttempt: "1",
      actor: "obeidpeter",
      triggeringActor: "obeidpeter",
      workflowSha: "c".repeat(40),
      workflowRef:
        "obeidpeter/BidBox-MVP-Builder/.github/workflows/release-candidate.yml@refs/heads/main",
      ref: "refs/heads/main",
      event: "workflow_dispatch",
    },
    now: new Date("2026-08-30T12:00:00.000Z"),
  };
  const passed = createUsabilityReleaseDecision(values);
  assert.equal(passed.decision, "evidence_verified");
  assert.equal(passed.waiver, null);
  assert.equal(passed.result.completionPercent, 100);
  values.evidence.accessibilityReview.criticalViolations = 1;
  assert.throws(
    () => createUsabilityReleaseDecision(values),
    /Critical accessibility violations/u,
  );
  assert.throws(
    () =>
      createUsabilityReleaseDecision({
        ...values,
        waiveMissingEvidence: true,
        reason: "Owner approved release without missing research evidence",
      }),
    /Only explicitly missing usability evidence can be waived/u,
  );
});

function programme() {
  return structuredClone(checkedInProgramme);
}

function completeReleaseEvidence() {
  const currentProgramme = programme();
  const criticalTasks = currentProgramme.tasks.filter(
    ({ risk }) => risk === "critical",
  );
  const resultsByRole = new Map(
    currentProgramme.participantRoles.map((role) => [role, []]),
  );
  for (const task of criticalTasks) {
    const role = task.roles[0];
    resultsByRole.get(role).push(task.id);
  }
  for (const role of currentProgramme.participantRoles) {
    if (resultsByRole.get(role).length === 0) {
      const roleTask = currentProgramme.tasks.find((task) =>
        task.roles.includes(role),
      );
      resultsByRole.get(role).push(roleTask.id);
    }
  }
  const environments = currentProgramme.testEnvironments;
  return {
    schemaVersion: 1,
    programmeId: currentProgramme.programmeId,
    evidenceId: "usability-evidence-2026-08-30",
    coverageStatus: "complete",
    evidenceWindow: { from: "2026-08-01", through: "2026-08-30" },
    missingReason: null,
    expertWalkthrough: {
      status: "completed",
      completedAt: "2026-08-29T10:00:00.000Z",
      owner: "Product owner",
      taskIds: criticalTasks.map(({ id }) => id),
    },
    accessibilityReview: {
      status: "completed",
      completedAt: "2026-08-29T11:00:00.000Z",
      owner: "Accessibility reviewer",
      taskIds: criticalTasks.map(({ id }) => id),
      criticalViolations: 0,
    },
    roleCoverageReview: {
      status: "completed",
      completedAt: "2026-08-27T09:00:00.000Z",
      owner: "Research operations owner",
      participantRolesReviewed: currentProgramme.participantRoles,
      environmentsReviewed: currentProgramme.testEnvironments,
      coverageGaps: [],
      evidenceLocation: "research/redacted/coverage-review-2026-q3.md",
      privacyReviewed: true,
    },
    productionFeedbackTriages: ["01", "08", "15", "22", "29"].map((day) => ({
      triageId: `feedback-triage-2026-08-${day}`,
      triagedAt: `2026-08-${day}T09:00:00.000Z`,
      owner: "Product feedback owner",
      evidenceLocation: `research/redacted/feedback-triage-2026-08-${day}.md`,
      privacyReviewed: true,
      feedbackSources: ["support_themes", "privacy_safe_product_feedback"],
      researchQuestionsRecorded: 1,
    })),
    sessions: currentProgramme.participantRoles.map((role, index) => ({
      participantCode: `P${String(index + 1).padStart(3, "0")}`,
      role,
      observedAt: "2026-08-28T10:00:00.000Z",
      consentRecorded: true,
      recordingOptIn: false,
      personalDataRedacted: true,
      environments: [environments[index % environments.length]],
      taskResults: resultsByRole.get(role).map((taskId) => ({
        taskId,
        outcome: "completed",
        unrecoveredCriticalError: false,
        timeOnTaskSeconds: 120,
        interactionCount: 8,
        assistanceRequests: 0,
        confidenceRating: 4,
      })),
    })),
    findings: [],
    releaseDecision: {
      status: "approved",
      owner: "Release owner",
      decidedAt: "2026-08-30T09:00:00.000Z",
      rationale:
        "All configured critical gates pass against the reviewed evidence window.",
    },
  };
}

test("accepts the checked-in role, task, safeguard, and release-gate contract", async () => {
  assert.doesNotThrow(() => validateUsabilityProgramme(programme()));
  assert.deepEqual(await verifyUsabilityProgramme(repositoryRoot), {
    taskCount: 12,
    evidenceStatus: "missing",
  });
});

test("rejects missing role and critical workflow coverage", () => {
  const missingRole = programme();
  missingRole.participantRoles = missingRole.participantRoles.filter(
    (role) => role !== "partner",
  );
  assert.throws(
    () => validateUsabilityProgramme(missingRole),
    /participantRoles must match/u,
  );

  const downgradedTask = programme();
  const signOff = downgradedTask.tasks.find(
    (task) => task.id === "sign_off_with_preflight",
  );
  signOff.risk = "standard";
  assert.throws(
    () => validateUsabilityProgramme(downgradedTask),
    /critical tasks must match/u,
  );
});

test("rejects fabricated-evidence policy and weakened release gates", () => {
  const fabricated = programme();
  fabricated.evidencePolicy =
    "Planned studies count as successful user outcomes.";
  assert.throws(
    () => validateUsabilityProgramme(fabricated),
    /prevent fabricated research claims/u,
  );

  const weakened = programme();
  weakened.releaseGates.maximumCriticalTruthfulnessDefects = 1;
  assert.throws(
    () => validateUsabilityProgramme(weakened),
    /Expected values to be strictly deep-equal/u,
  );
});

test("rejects a source-intake task that promises the disabled upload path", () => {
  const mismatched = programme();
  const sourceTask = mismatched.tasks.find(
    (task) => task.id === "verify_existing_source_and_intake_state",
  );
  sourceTask.startingState =
    "The participant has a synthetic tender document ready to upload.";
  sourceTask.successOutcome =
    "The participant uploads the source and sees it in the register.";

  assert.throws(
    () => validateUsabilityProgramme(mismatched),
    /must match the currently unavailable upload capability/u,
  );
});

test("records missing release research without treating it as approval", () => {
  const missingEvidence = JSON.parse(
    JSON.stringify({
      schemaVersion: 1,
      programmeId: "bidbox-continuous-usability/v1",
      evidenceId: "usability-evidence-pending",
      coverageStatus: "missing",
      evidenceWindow: { from: null, through: null },
      missingReason:
        "Representative moderated sessions and before-release reviews have not been recorded.",
      expertWalkthrough: null,
      accessibilityReview: null,
      roleCoverageReview: null,
      productionFeedbackTriages: [],
      sessions: [],
      findings: [],
      releaseDecision: {
        status: "blocked_missing_evidence",
        owner: null,
        decidedAt: null,
        rationale:
          "Release remains blocked until observed evidence is recorded.",
      },
    }),
  );

  assert.doesNotThrow(() =>
    validateUsabilityReleaseEvidence(missingEvidence, programme()),
  );
  assert.throws(
    () =>
      enforceUsabilityReleaseGate(
        missingEvidence,
        programme(),
        new Date("2026-08-30T12:00:00.000Z"),
      ),
    /explicitly missing/u,
  );
});

test("requires bounded weekly triage and named quarterly coverage evidence", () => {
  const missingTriage = completeReleaseEvidence();
  missingTriage.productionFeedbackTriages = [];
  assert.throws(
    () => validateUsabilityReleaseEvidence(missingTriage, programme()),
    /productionFeedbackTriages must contain 1\.\.20 records/u,
  );

  const incompleteCoverage = completeReleaseEvidence();
  incompleteCoverage.roleCoverageReview.environmentsReviewed =
    incompleteCoverage.roleCoverageReview.environmentsReviewed.slice(1);
  assert.throws(
    () => validateUsabilityReleaseEvidence(incompleteCoverage, programme()),
    /roleCoverageReview\.environmentsReviewed must match/u,
  );

  const weeklyGap = completeReleaseEvidence();
  weeklyGap.productionFeedbackTriages.splice(2, 1);
  assert.throws(
    () =>
      enforceUsabilityReleaseGate(
        weeklyGap,
        programme(),
        new Date("2026-08-30T12:00:00.000Z"),
      ),
    /gap longer than one week/u,
  );

  const staleBeforeDecision = completeReleaseEvidence();
  staleBeforeDecision.releaseDecision.decidedAt = "2026-09-20T09:00:00.000Z";
  assert.throws(
    () =>
      enforceUsabilityReleaseGate(
        staleBeforeDecision,
        programme(),
        new Date("2026-09-20T12:00:00.000Z"),
      ),
    /does not cover releaseDecision\.decidedAt/u,
  );
});

test("binds every evidence event and the release decision to one chronology", () => {
  const outsideWindow = completeReleaseEvidence();
  outsideWindow.sessions[0].observedAt = "2026-07-31T23:59:59.000Z";
  assert.throws(
    () => validateUsabilityReleaseEvidence(outsideWindow, programme()),
    /must fall inside evidenceWindow/u,
  );

  const prematureDecision = completeReleaseEvidence();
  prematureDecision.accessibilityReview.completedAt =
    "2026-08-30T10:00:00.000Z";
  assert.throws(
    () => validateUsabilityReleaseEvidence(prematureDecision, programme()),
    /releaseDecision must follow accessibilityReview\.completedAt/u,
  );

  const futureDecision = completeReleaseEvidence();
  assert.throws(
    () =>
      enforceUsabilityReleaseGate(
        futureDecision,
        programme(),
        new Date("2026-08-30T08:00:00.000Z"),
      ),
    /releaseDecision\.decidedAt cannot be future-dated/u,
  );

  const futureWindow = completeReleaseEvidence();
  futureWindow.evidenceWindow.through = "2026-08-31";
  futureWindow.releaseDecision.decidedAt = "2026-08-31T12:00:00.000Z";
  assert.throws(
    () =>
      enforceUsabilityReleaseGate(
        futureWindow,
        programme(),
        new Date("2026-08-30T12:00:00.000Z"),
      ),
    /evidenceWindow\.through cannot be future-dated/u,
  );

  const malformedTaskResult = completeReleaseEvidence();
  malformedTaskResult.sessions[0].taskResults[0] = null;
  assert.throws(
    () => validateUsabilityReleaseEvidence(malformedTaskResult, programme()),
    /sessions\[0\]\.taskResults\[0\] must be an object/u,
  );

  const impossibleRetest = completeReleaseEvidence();
  impossibleRetest.findings.push({
    id: "UX-2026-001",
    observedAt: "2026-08-28T12:00:00.000Z",
    role: "reviewer",
    environment: "desktop_standard",
    taskId: "sign_off_with_preflight",
    severity: "high",
    principle: "interaction_design",
    observation:
      "The participant could not recover from the validation failure without assistance.",
    evidenceLocation: "research/redacted/UX-2026-001.md",
    privacyReviewed: true,
    owner: "Reports owner",
    status: "fixed",
    retestEvidence: "research/redacted/UX-2026-001-retest.md",
    retestedAt: "2026-08-28T11:00:00.000Z",
  });
  assert.throws(
    () => validateUsabilityReleaseEvidence(impossibleRetest, programme()),
    /retestedAt must not predate observedAt/u,
  );
});

test("applies completion, critical-error, and finding release gates", () => {
  const evidence = completeReleaseEvidence();
  assert.deepEqual(
    enforceUsabilityReleaseGate(
      evidence,
      programme(),
      new Date("2026-08-30T12:00:00.000Z"),
    ),
    {
      evidenceId: "usability-evidence-2026-08-30",
      completionPercent: 100,
      sessionCount: 6,
      findingCount: 0,
    },
  );

  const belowThreshold = completeReleaseEvidence();
  const criticalResults = belowThreshold.sessions
    .flatMap(({ taskResults }) => taskResults)
    .filter(({ taskId }) =>
      programme().tasks.some(
        (task) => task.id === taskId && task.risk === "critical",
      ),
    );
  criticalResults[0].outcome = "abandoned";
  criticalResults[1].outcome = "abandoned";
  assert.throws(
    () =>
      enforceUsabilityReleaseGate(
        belowThreshold,
        programme(),
        new Date("2026-08-30T12:00:00.000Z"),
      ),
    /completion .* below 90%/u,
  );

  const criticalError = completeReleaseEvidence();
  criticalError.sessions[0].taskResults[0].unrecoveredCriticalError = true;
  assert.throws(
    () =>
      enforceUsabilityReleaseGate(
        criticalError,
        programme(),
        new Date("2026-08-30T12:00:00.000Z"),
      ),
    /Unrecovered critical errors/u,
  );

  const openCritical = completeReleaseEvidence();
  openCritical.findings.push({
    id: "UX-2026-001",
    observedAt: "2026-08-28T12:00:00.000Z",
    role: "reviewer",
    environment: "desktop_standard",
    taskId: "sign_off_with_preflight",
    severity: "critical",
    principle: "truthfulness",
    observation:
      "The participant believed a blocked sign-off had completed successfully.",
    evidenceLocation: "research/redacted/UX-2026-001.md",
    privacyReviewed: true,
    owner: "Reports owner",
    status: "open",
    retestEvidence: null,
    retestedAt: null,
  });
  assert.throws(
    () =>
      enforceUsabilityReleaseGate(
        openCritical,
        programme(),
        new Date("2026-08-30T12:00:00.000Z"),
      ),
    /Open critical usability findings/u,
  );
});
