import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, test } from "node:test";
import { promisify } from "node:util";
import {
  createUsabilityReleaseDecision,
  recordUsabilityReleaseDecision,
} from "./usability-release-decision.mjs";
import {
  createReleaseManifest,
  verifyReleaseManifest,
} from "./release-provenance.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const programmeText = await readFile(
  resolve(repositoryRoot, "config/product/usability-programme.v1.json"),
  "utf8",
);
const evidenceText = await readFile(
  resolve(repositoryRoot, "config/product/usability-release-evidence.v1.json"),
  "utf8",
);
const digest = (value) => createHash("sha256").update(value).digest("hex");
const execFileAsync = promisify(execFile);
const directories = [];

function input() {
  return {
    programme: JSON.parse(programmeText),
    evidence: JSON.parse(evidenceText),
    programmeSha256: digest(programmeText),
    evidenceSha256: digest(evidenceText),
    sourceCommitSha: "a".repeat(40),
    github: {
      repository: "obeidpeter/BidBox-MVP-Builder",
      repositoryId: "123",
      runId: "456",
      runAttempt: "1",
      actor: "obeidpeter",
      triggeringActor: "obeidpeter",
      workflowSha: "b".repeat(40),
      workflowRef:
        "obeidpeter/BidBox-MVP-Builder/.github/workflows/release-candidate.yml@refs/heads/main",
      ref: "refs/heads/main",
      event: "workflow_dispatch",
    },
    now: new Date("2026-09-07T12:00:00.000Z"),
  };
}

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

test("missing evidence still blocks by default and a reason alone does not opt in", () => {
  assert.throws(
    () => createUsabilityReleaseDecision(input()),
    /explicitly missing/u,
  );
  assert.throws(
    () =>
      createUsabilityReleaseDecision({
        ...input(),
        reason: "Release owner accepted missing evidence",
      }),
    /requires explicit opt-in/u,
  );
});

test("explicit waiver records the actual missing state and a bounded per-run authorization", () => {
  const values = input();
  const decision = createUsabilityReleaseDecision({
    ...values,
    waiveMissingEvidence: true,
    reason:
      "Owner authorised deployment without usability evidence on 2026-09-07.",
  });
  assert.equal(decision.decision, "missing_evidence_waived");
  assert.equal(decision.evidence.coverageStatus, "missing");
  assert.equal(decision.evidence.evidenceSha256, digest(evidenceText));
  assert.equal(decision.sourceCommitSha, values.sourceCommitSha);
  assert.equal(decision.authorization.actor, "obeidpeter");
  assert.equal(decision.authorization.runId, "456");
  assert.equal(decision.result, null);
  assert.equal(decision.waiver.scope, "missing_usability_evidence_only");
  assert.equal(
    values.evidence.releaseDecision.status,
    "blocked_missing_evidence",
  );
});

test("waiver refuses missing reason, malformed evidence, and non-main or unknown actors", () => {
  const values = {
    ...input(),
    waiveMissingEvidence: true,
    reason: "Approved one release with missing evidence",
  };
  assert.throws(
    () => createUsabilityReleaseDecision({ ...values, reason: "" }),
    /requires a single-line reason/u,
  );
  const malformed = structuredClone(values.evidence);
  malformed.findings.push({ severity: "critical", status: "open" });
  assert.throws(() =>
    createUsabilityReleaseDecision({ ...values, evidence: malformed }),
  );
  assert.throws(() =>
    createUsabilityReleaseDecision({
      ...values,
      github: { ...values.github, ref: "refs/heads/feature" },
    }),
  );
  assert.throws(() =>
    createUsabilityReleaseDecision({
      ...values,
      github: { ...values.github, actor: "" },
    }),
  );
});

async function releaseFixture() {
  const root = await mkdtemp(join(tmpdir(), "bidbox-waiver-"));
  directories.push(root);
  await mkdir(join(root, "config/product"), { recursive: true });
  await writeFile(
    join(root, "config/product/usability-programme.v1.json"),
    programmeText,
  );
  await writeFile(
    join(root, "config/product/usability-release-evidence.v1.json"),
    evidenceText,
  );
  await writeFile(join(root, ".gitignore"), "/release-evidence/\n");
  const git = async (...args) => {
    const { stdout } = await execFileAsync(
      "git",
      [
        "-c",
        "user.name=Waiver test",
        "-c",
        "user.email=waiver@example.invalid",
        "-c",
        "commit.gpgsign=false",
        ...args,
      ],
      { cwd: root, encoding: "utf8", windowsHide: true },
    );
    return stdout.trim();
  };
  await git("init", "--initial-branch=main");
  await git("add", ".");
  await git("commit", "-m", "Source fixture");
  const sourceCommitSha = await git("rev-parse", "HEAD");
  await git("update-ref", "refs/remotes/origin/main", sourceCommitSha);
  const environment = {
    GITHUB_ACTIONS: "true",
    GITHUB_WORKFLOW: "Release candidate",
    WAIVE_MISSING_USABILITY_EVIDENCE: "true",
    USABILITY_WAIVER_REASON:
      "Owner authorised this release without usability evidence",
    SOURCE_SHA: sourceCommitSha,
    GITHUB_REPOSITORY: "obeidpeter/BidBox-MVP-Builder",
    GITHUB_REPOSITORY_ID: "123",
    GITHUB_RUN_ID: "456",
    GITHUB_RUN_ATTEMPT: "1",
    GITHUB_ACTOR: "obeidpeter",
    GITHUB_TRIGGERING_ACTOR: "obeidpeter",
    GITHUB_SHA: sourceCommitSha,
    GITHUB_WORKFLOW_REF: input().github.workflowRef,
    GITHUB_REF: "refs/heads/main",
    GITHUB_EVENT_NAME: "workflow_dispatch",
  };
  return { root, environment, git, sourceCommitSha };
}

test("decision is immutable, source checked, and hashed into the release candidate", async () => {
  const { root, environment, git, sourceCommitSha } = await releaseFixture();
  await assert.rejects(
    () =>
      recordUsabilityReleaseDecision({
        root,
        environment: { ...environment, SOURCE_SHA: "c".repeat(40) },
      }),
    /Checked-out source SHA differs/u,
  );
  const decision = await recordUsabilityReleaseDecision({ root, environment });
  assert.equal(decision.sourceCommitSha, sourceCommitSha);
  assert.equal(await git("status", "--porcelain=v1"), "");
  await assert.rejects(
    () => recordUsabilityReleaseDecision({ root, environment }),
    /EEXIST/u,
  );
  await writeFile(
    join(root, "release-evidence/sbom.json"),
    JSON.stringify({ bomFormat: "CycloneDX", specVersion: "1.6", version: 1 }),
  );
  const manifest = await createReleaseManifest({
    root,
    sourceCommitSha,
    artifactInputs: [
      { name: "usability-decision", path: "release-evidence/usability" },
    ],
    sbomPath: "release-evidence/sbom.json",
  });
  await verifyReleaseManifest({ root, manifest });
  await writeFile(
    join(root, "release-evidence/usability/decision.json"),
    JSON.stringify({ ...decision, sourceCommitSha: "d".repeat(40) }),
  );
  await assert.rejects(
    () => verifyReleaseManifest({ root, manifest }),
    /Artifact verification failed/u,
  );
});

test("decision refuses symlinked evidence directories without writing outside its checkout", async () => {
  for (const segment of ["release-evidence", "release-evidence/usability"]) {
    const { root, environment } = await releaseFixture();
    const outside = await mkdtemp(join(tmpdir(), "bidbox-waiver-outside-"));
    directories.push(outside);
    if (segment.includes("/")) await mkdir(join(root, "release-evidence"));
    await symlink(
      outside,
      join(root, segment),
      process.platform === "win32" ? "junction" : "dir",
    );
    await assert.rejects(
      () => recordUsabilityReleaseDecision({ root, environment }),
      /directory cannot be a symlink/u,
    );
    assert.deepEqual(await readdir(outside), []);
  }
});
