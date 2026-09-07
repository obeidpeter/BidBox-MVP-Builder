import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  enforceUsabilityReleaseGate,
  validateUsabilityProgramme,
  validateUsabilityReleaseEvidence,
} from "./verify-usability-programme.mjs";
import { assertExactSource } from "./release-provenance.mjs";

const COMMIT_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const GITHUB_LOGIN = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}(?:\[bot\])?$/u;
const POSITIVE_ID = /^[1-9][0-9]*$/u;

export function createUsabilityReleaseDecision({
  programme,
  evidence,
  programmeSha256,
  evidenceSha256,
  sourceCommitSha,
  waiveMissingEvidence = false,
  reason = "",
  github,
  now = new Date(),
}) {
  validateUsabilityProgramme(programme);
  validateUsabilityReleaseEvidence(evidence, programme);
  assert.equal(typeof waiveMissingEvidence, "boolean");
  assert.equal(typeof reason, "string");
  assert.match(sourceCommitSha, COMMIT_SHA);
  assert.match(programmeSha256, SHA256);
  assert.match(evidenceSha256, SHA256);
  assert.match(github.repository, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u);
  assert.match(github.repositoryId, POSITIVE_ID);
  assert.match(github.runId, POSITIVE_ID);
  assert.match(github.runAttempt, POSITIVE_ID);
  assert.match(github.actor, GITHUB_LOGIN);
  assert.match(github.triggeringActor, GITHUB_LOGIN);
  assert.match(github.workflowSha, COMMIT_SHA);
  assert.equal(github.event, "workflow_dispatch");
  assert.equal(github.ref, "refs/heads/main");
  assert.equal(
    github.workflowRef,
    `${github.repository}/.github/workflows/release-candidate.yml@refs/heads/main`,
  );

  let waiver = null;
  let result = null;
  if (waiveMissingEvidence) {
    assert.equal(
      evidence.coverageStatus,
      "missing",
      "Only explicitly missing usability evidence can be waived",
    );
    const explanation = reason.trim();
    assert.ok(
      explanation.length >= 12 &&
        explanation.length <= 1000 &&
        !/[\u0000-\u001f\u007f]/u.test(explanation),
      "A missing-evidence waiver requires a single-line reason of 12..1000 characters",
    );
    waiver = {
      scope: "missing_usability_evidence_only",
      reason: explanation,
      acceptedRisk:
        "Representative usability outcomes are unknown because the required observed sessions and reviews have not been recorded.",
    };
  } else {
    assert.equal(reason.trim(), "", "A waiver reason requires explicit opt-in");
    result = enforceUsabilityReleaseGate(evidence, programme, now);
  }

  return {
    schemaVersion: 1,
    kind: "bidbox.usability-release-decision",
    recordedAt: now.toISOString(),
    decision: waiver ? "missing_evidence_waived" : "evidence_verified",
    sourceCommitSha,
    evidence: {
      id: evidence.evidenceId,
      coverageStatus: evidence.coverageStatus,
      programmeSha256,
      evidenceSha256,
    },
    authorization: {
      ...github,
      runUrl: `https://github.com/${github.repository}/actions/runs/${github.runId}`,
    },
    waiver,
    result,
  };
}

async function regularText(path) {
  const stat = await lstat(path);
  assert.ok(stat.isFile() && !stat.isSymbolicLink());
  assert.ok(stat.size > 0 && stat.size <= 5 * 1024 * 1024);
  return readFile(path, "utf8");
}

export async function recordUsabilityReleaseDecision({
  root,
  environment = process.env,
  now = new Date(),
}) {
  assert.equal(
    environment.GITHUB_ACTIONS,
    "true",
    "GitHub Actions is required",
  );
  assert.equal(environment.GITHUB_WORKFLOW, "Release candidate");
  assert.ok(
    ["true", "false"].includes(environment.WAIVE_MISSING_USABILITY_EVIDENCE),
    "The per-run waiver input must explicitly be true or false",
  );
  await assertExactSource({
    root,
    expectedCommitSha: environment.SOURCE_SHA,
    ancestorRef: "origin/main",
  });
  const programmeText = await regularText(
    resolve(root, "config/product/usability-programme.v1.json"),
  );
  const evidenceText = await regularText(
    resolve(root, "config/product/usability-release-evidence.v1.json"),
  );
  const digest = (value) => createHash("sha256").update(value).digest("hex");
  const decision = createUsabilityReleaseDecision({
    programme: JSON.parse(programmeText),
    evidence: JSON.parse(evidenceText),
    programmeSha256: digest(programmeText),
    evidenceSha256: digest(evidenceText),
    sourceCommitSha: environment.SOURCE_SHA,
    waiveMissingEvidence:
      environment.WAIVE_MISSING_USABILITY_EVIDENCE === "true",
    reason: environment.USABILITY_WAIVER_REASON ?? "",
    github: {
      repository: environment.GITHUB_REPOSITORY,
      repositoryId: environment.GITHUB_REPOSITORY_ID,
      runId: environment.GITHUB_RUN_ID,
      runAttempt: environment.GITHUB_RUN_ATTEMPT,
      actor: environment.GITHUB_ACTOR,
      triggeringActor: environment.GITHUB_TRIGGERING_ACTOR,
      workflowSha: environment.GITHUB_SHA,
      workflowRef: environment.GITHUB_WORKFLOW_REF,
      ref: environment.GITHUB_REF,
      event: environment.GITHUB_EVENT_NAME,
    },
    now,
  });
  let directory = await realpath(root);
  for (const segment of ["release-evidence", "usability"]) {
    directory = resolve(directory, segment);
    await mkdir(directory).catch((error) => {
      if (error.code !== "EEXIST") throw error;
    });
    const details = await lstat(directory);
    assert.ok(
      details.isDirectory() && !details.isSymbolicLink(),
      "Usability decision directory cannot be a symlink",
    );
    assert.equal(
      await realpath(directory),
      directory,
      "Usability decision directory must stay inside the release workspace",
    );
  }
  const output = resolve(directory, "decision.json");
  await writeFile(output, `${JSON.stringify(decision, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  return decision;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const decision = await recordUsabilityReleaseDecision({
    root: resolve(import.meta.dirname, ".."),
  });
  console.log(
    `Usability release decision: ${decision.decision}; coverage remains ${decision.evidence.coverageStatus}.`,
  );
}
