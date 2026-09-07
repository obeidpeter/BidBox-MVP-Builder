import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const COMMIT_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const ARTIFACT_NAME = /^[a-z][a-z0-9-]{0,63}$/u;
const DEPLOYMENT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const GITHUB_REPOSITORY =
  /^[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,99})\/[A-Za-z0-9_.-]{1,100}$/u;
const GITHUB_WORKFLOW_PATH = /^\.github\/workflows\/[a-z0-9-]+\.ya?ml$/u;
const POSITIVE_DECIMAL = /^[1-9][0-9]*$/u;
const MAX_PROBE_BODY_BYTES = 16 * 1024;
const MAX_GITHUB_API_BODY_BYTES = 512 * 1024;

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalJson(value) {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    assert.ok(
      Number.isFinite(value),
      "Canonical JSON rejects non-finite numbers",
    );
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  assert.ok(
    value &&
      typeof value === "object" &&
      Object.getPrototypeOf(value) === Object.prototype,
    "Canonical JSON accepts plain JSON values only",
  );
  const entries = Object.entries(value).sort(([left], [right]) =>
    compareStrings(left, right),
  );
  return `{${entries
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(",")}}`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function sha256File(path) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest("hex");
}

function workspacePath(root, absolutePath) {
  const path = relative(root, absolutePath);
  assert.ok(
    path && !path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path),
    "Evidence inputs must be contained by the release workspace",
  );
  return path.split(sep).join("/");
}

async function regularFile(path, label) {
  const stat = await lstat(path);
  assert.equal(
    stat.isSymbolicLink(),
    false,
    `${label} cannot be a symbolic link`,
  );
  assert.equal(stat.isFile(), true, `${label} must be a regular file`);
  return stat;
}

async function walkArtifact(
  rootDirectory,
  directory = rootDirectory,
  prefix = "",
) {
  const output = [];
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => compareStrings(left.name, right.name));
  for (const entry of entries) {
    const absolutePath = resolve(directory, entry.name);
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const stat = await lstat(absolutePath);
    assert.equal(
      stat.isSymbolicLink(),
      false,
      `Release artifact contains symbolic link: ${relativePath}`,
    );
    if (stat.isDirectory()) {
      output.push(
        ...(await walkArtifact(rootDirectory, absolutePath, relativePath)),
      );
      continue;
    }
    assert.equal(
      stat.isFile(),
      true,
      `Release artifact contains unsupported entry: ${relativePath}`,
    );
    output.push({
      path: relativePath,
      bytes: stat.size,
      sha256: await sha256File(absolutePath),
    });
  }
  return output;
}

export async function collectArtifact({ root, name, path }) {
  assert.match(name, ARTIFACT_NAME, "Artifact name is invalid");
  const absolutePath = resolve(root, path);
  const relativePath = workspacePath(root, absolutePath);
  const stat = await lstat(absolutePath);
  assert.equal(
    stat.isSymbolicLink(),
    false,
    `${name} cannot be a symbolic link`,
  );
  assert.equal(stat.isDirectory(), true, `${name} must be a directory`);
  const files = await walkArtifact(absolutePath);
  assert.ok(files.length > 0, `${name} cannot be empty`);
  return {
    name,
    path: relativePath,
    bytes: files.reduce((total, file) => total + file.bytes, 0),
    sha256: sha256(canonicalJson(files)),
    files,
  };
}

export async function collectSbom({ root, path }) {
  const absolutePath = resolve(root, path);
  const relativePath = workspacePath(root, absolutePath);
  const stat = await regularFile(absolutePath, "SBOM");
  let parsed;
  try {
    parsed = JSON.parse(await readFile(absolutePath, "utf8"));
  } catch {
    assert.fail("SBOM must contain valid JSON");
  }
  assert.equal(parsed?.bomFormat, "CycloneDX", "SBOM must use CycloneDX");
  assert.match(
    parsed?.specVersion,
    /^1\.[4-9]$/u,
    "Unsupported CycloneDX version",
  );
  assert.ok(
    Number.isSafeInteger(parsed?.version) && parsed.version >= 1,
    "CycloneDX document version is required",
  );
  return {
    path: relativePath,
    bytes: stat.size,
    sha256: await sha256File(absolutePath),
    bomFormat: parsed.bomFormat,
    specVersion: parsed.specVersion,
  };
}

function releaseIdentity(source, artifacts, sbom) {
  return {
    schemaVersion: 1,
    source,
    artifacts: artifacts.map(({ name, path, bytes, sha256: digest }) => ({
      name,
      path,
      bytes,
      sha256: digest,
    })),
    sbom: {
      path: sbom.path,
      bytes: sbom.bytes,
      sha256: sbom.sha256,
      bomFormat: sbom.bomFormat,
      specVersion: sbom.specVersion,
    },
  };
}

function assertIsoInstant(value, label) {
  assert.equal(typeof value, "string", `${label} must be an ISO timestamp`);
  assert.equal(
    new Date(value).toISOString(),
    value,
    `${label} must be normalized UTC`,
  );
}

export async function createReleaseManifest({
  root,
  sourceCommitSha,
  artifactInputs,
  sbomPath,
  generatedAt = new Date().toISOString(),
  provenance = {},
}) {
  assert.match(
    sourceCommitSha,
    COMMIT_SHA,
    "Source commit must be an exact Git object id",
  );
  assertIsoInstant(generatedAt, "generatedAt");
  assert.ok(
    Array.isArray(artifactInputs) && artifactInputs.length > 0,
    "At least one release artifact is required",
  );
  const artifacts = [];
  for (const input of artifactInputs) {
    artifacts.push(await collectArtifact({ root, ...input }));
  }
  assert.equal(
    new Set(artifacts.map(({ name }) => name)).size,
    artifacts.length,
    "Artifact names must be unique",
  );
  assert.equal(
    new Set(artifacts.map(({ path }) => path)).size,
    artifacts.length,
    "Artifact paths must be unique",
  );
  artifacts.sort((left, right) => compareStrings(left.name, right.name));
  const source = { commitSha: sourceCommitSha };
  const sbom = await collectSbom({ root, path: sbomPath });
  return {
    schemaVersion: 1,
    kind: "valo.release-candidate",
    generatedAt,
    releaseSha256: sha256(
      canonicalJson(releaseIdentity(source, artifacts, sbom)),
    ),
    source,
    artifacts,
    sbom,
    provenance: {
      provider: provenance.provider ?? "local",
      repository: provenance.repository ?? null,
      repositoryId: provenance.repositoryId ?? null,
      workflow: provenance.workflow ?? null,
      workflowPath: provenance.workflowPath ?? null,
      workflowSha: provenance.workflowSha ?? null,
      workflowRunId: provenance.workflowRunId ?? null,
      workflowRunAttempt: provenance.workflowRunAttempt ?? null,
      workflowRunUrl: provenance.workflowRunUrl ?? null,
    },
  };
}

function assertManifestSource(manifest, expectedSourceCommit) {
  assert.match(
    expectedSourceCommit,
    COMMIT_SHA,
    "Expected source SHA must be exact",
  );
  assert.equal(
    manifest.source.commitSha,
    expectedSourceCommit,
    "Release manifest source differs from the expected source",
  );
}

function assertManifestShape(manifest) {
  assert.equal(
    manifest?.schemaVersion,
    1,
    "Release manifest schema must be v1",
  );
  assert.equal(
    manifest.kind,
    "valo.release-candidate",
    "Unexpected manifest kind",
  );
  assertIsoInstant(manifest.generatedAt, "generatedAt");
  assert.match(manifest.releaseSha256, SHA256, "Invalid release SHA-256");
  assert.match(manifest.source?.commitSha, COMMIT_SHA, "Invalid source commit");
  assert.ok(
    Array.isArray(manifest.artifacts) && manifest.artifacts.length > 0,
    "Release artifacts are required",
  );
  assert.equal(
    typeof manifest.provenance?.provider,
    "string",
    "Builder provider missing",
  );
  for (const field of [
    "repository",
    "repositoryId",
    "workflow",
    "workflowPath",
    "workflowSha",
    "workflowRunId",
    "workflowRunAttempt",
    "workflowRunUrl",
  ]) {
    assert.ok(
      manifest.provenance[field] === null ||
        (typeof manifest.provenance[field] === "string" &&
          manifest.provenance[field]),
      `Invalid provenance ${field}`,
    );
  }
}

export async function verifyReleaseManifest({ root, manifest }) {
  assertManifestShape(manifest);
  const artifactNames = manifest.artifacts.map(({ name }) => name);
  assert.deepEqual(
    artifactNames,
    [...artifactNames].sort(compareStrings),
    "Release artifacts must use canonical name order",
  );
  assert.equal(
    new Set(artifactNames).size,
    manifest.artifacts.length,
    "Artifact names must be unique",
  );
  assert.equal(
    new Set(manifest.artifacts.map(({ path }) => path)).size,
    manifest.artifacts.length,
    "Artifact paths must be unique",
  );
  const actualArtifacts = [];
  for (const artifact of manifest.artifacts) {
    assert.match(artifact.name, ARTIFACT_NAME, "Invalid artifact name");
    const actual = await collectArtifact({
      root,
      name: artifact.name,
      path: artifact.path,
    });
    assert.deepEqual(
      actual,
      artifact,
      `Artifact verification failed: ${artifact.name}`,
    );
    actualArtifacts.push(actual);
  }
  const actualSbom = await collectSbom({ root, path: manifest.sbom?.path });
  assert.deepEqual(actualSbom, manifest.sbom, "SBOM verification failed");
  const expectedReleaseSha256 = sha256(
    canonicalJson(
      releaseIdentity(manifest.source, actualArtifacts, actualSbom),
    ),
  );
  assert.equal(
    manifest.releaseSha256,
    expectedReleaseSha256,
    "Release identity does not match its source and artifacts",
  );
  return manifest;
}

function assertTimeoutMillis(value, label) {
  assert.ok(
    Number.isSafeInteger(value) && value >= 100 && value <= 30_000,
    `${label} must be between 100 and 30000 milliseconds`,
  );
}

function positiveDecimal(value, label) {
  const normalized =
    typeof value === "number" && Number.isSafeInteger(value)
      ? String(value)
      : typeof value === "string"
        ? value.trim()
        : "";
  assert.match(normalized, POSITIVE_DECIMAL, `${label} must be a positive id`);
  return normalized;
}

function expectedGitHubRunUrl(repository, runId) {
  return `https://github.com/${repository}/actions/runs/${runId}`;
}

export function attestGitHubCandidateRun({
  run,
  expectedRepository,
  expectedRepositoryId,
  expectedRunId,
  expectedWorkflowName,
  expectedWorkflowPath,
  expectedSourceCommit,
  attestedAt = new Date().toISOString(),
}) {
  assert.match(
    expectedRepository,
    GITHUB_REPOSITORY,
    "Expected GitHub repository is invalid",
  );
  const repositoryId = positiveDecimal(
    expectedRepositoryId,
    "Expected repository id",
  );
  const runId = positiveDecimal(expectedRunId, "Expected run id");
  assert.match(
    expectedWorkflowName,
    /^Release candidate$/u,
    "Unexpected candidate workflow name",
  );
  assert.match(
    expectedWorkflowPath,
    GITHUB_WORKFLOW_PATH,
    "Expected workflow path is invalid",
  );
  assert.match(
    expectedSourceCommit,
    COMMIT_SHA,
    "Expected source SHA must be exact",
  );
  assertIsoInstant(attestedAt, "attestedAt");
  assert.ok(
    run && typeof run === "object" && !Array.isArray(run),
    "GitHub workflow run response is invalid",
  );

  assert.equal(
    positiveDecimal(run.id, "Workflow run id"),
    runId,
    "Selected candidate run id differs",
  );
  const expectedRunTitle = `${expectedWorkflowName} from ${expectedSourceCommit}`;
  assert.ok(
    run.name === expectedWorkflowName || run.name === expectedRunTitle,
    "Selected run is not the release-candidate workflow",
  );
  assert.equal(
    run.path,
    expectedWorkflowPath,
    "Selected run uses another workflow path",
  );
  assert.equal(
    run.head_branch,
    "main",
    "Candidate workflow must run from protected main",
  );
  assert.equal(
    run.display_title,
    expectedRunTitle,
    "Selected run was dispatched for another source commit",
  );
  assert.equal(
    run.event,
    "workflow_dispatch",
    "Candidate run must be manually dispatched",
  );
  assert.equal(run.status, "completed", "Candidate run is not completed");
  assert.equal(run.conclusion, "success", "Candidate run was not successful");
  assert.match(run.head_sha, COMMIT_SHA, "Candidate workflow SHA is invalid");
  assert.equal(
    run.repository?.full_name,
    expectedRepository,
    "Candidate run belongs to another repository",
  );
  assert.equal(
    positiveDecimal(run.repository?.id, "Candidate repository id"),
    repositoryId,
    "Candidate repository id differs",
  );
  assert.equal(
    run.head_repository?.full_name,
    expectedRepository,
    "Candidate run head belongs to another repository",
  );
  assert.equal(
    positiveDecimal(run.head_repository?.id, "Candidate head repository id"),
    repositoryId,
    "Candidate head repository id differs",
  );
  const workflowId = positiveDecimal(run.workflow_id, "Candidate workflow id");
  const runAttempt = positiveDecimal(run.run_attempt, "Candidate run attempt");
  const runUrl = expectedGitHubRunUrl(expectedRepository, runId);
  assert.equal(run.html_url, runUrl, "Candidate run URL is not canonical");

  return {
    schemaVersion: 1,
    kind: "valo.github-candidate-run-attestation",
    attestedAt,
    repository: { id: repositoryId, fullName: expectedRepository },
    workflow: {
      id: workflowId,
      name: expectedWorkflowName,
      path: expectedWorkflowPath,
      ref: "refs/heads/main",
      sha: run.head_sha,
    },
    run: {
      id: runId,
      attempt: runAttempt,
      event: "workflow_dispatch",
      status: "completed",
      conclusion: "success",
      url: runUrl,
      displayTitle: run.display_title,
    },
    candidate: { sourceCommitSha: expectedSourceCommit },
  };
}

function validateGitHubRunAttestation(attestation) {
  assert.ok(
    attestation &&
      typeof attestation === "object" &&
      !Array.isArray(attestation),
    "Candidate run attestation is invalid",
  );
  exactObject(
    attestation,
    [
      "schemaVersion",
      "kind",
      "attestedAt",
      "repository",
      "workflow",
      "run",
      "candidate",
    ],
    "Candidate run attestation",
  );
  assert.equal(
    attestation.schemaVersion,
    1,
    "Candidate run attestation schema changed",
  );
  assert.equal(
    attestation.kind,
    "valo.github-candidate-run-attestation",
    "Candidate run attestation kind changed",
  );
  assertIsoInstant(attestation.attestedAt, "attestedAt");
  exactObject(
    attestation.repository,
    ["id", "fullName"],
    "Attested repository",
  );
  assert.match(
    attestation.repository.fullName,
    GITHUB_REPOSITORY,
    "Attested repository is invalid",
  );
  positiveDecimal(attestation.repository.id, "Attested repository id");
  exactObject(
    attestation.workflow,
    ["id", "name", "path", "ref", "sha"],
    "Attested workflow",
  );
  positiveDecimal(attestation.workflow.id, "Attested workflow id");
  assert.equal(
    attestation.workflow.name,
    "Release candidate",
    "Attested workflow name changed",
  );
  assert.equal(
    attestation.workflow.path,
    ".github/workflows/release-candidate.yml",
    "Attested workflow path changed",
  );
  assert.equal(
    attestation.workflow.ref,
    "refs/heads/main",
    "Attested workflow did not run from protected main",
  );
  assert.match(
    attestation.workflow.sha,
    COMMIT_SHA,
    "Attested workflow SHA is invalid",
  );
  exactObject(
    attestation.run,
    ["id", "attempt", "event", "status", "conclusion", "url", "displayTitle"],
    "Attested run",
  );
  positiveDecimal(attestation.run.id, "Attested run id");
  positiveDecimal(attestation.run.attempt, "Attested run attempt");
  assert.equal(
    attestation.run.event,
    "workflow_dispatch",
    "Attested run event changed",
  );
  assert.equal(
    attestation.run.status,
    "completed",
    "Attested run is incomplete",
  );
  assert.equal(
    attestation.run.conclusion,
    "success",
    "Attested run did not succeed",
  );
  assert.equal(
    attestation.run.url,
    expectedGitHubRunUrl(attestation.repository.fullName, attestation.run.id),
    "Attested run URL is not canonical",
  );
  exactObject(attestation.candidate, ["sourceCommitSha"], "Attested candidate");
  assert.match(
    attestation.candidate.sourceCommitSha,
    COMMIT_SHA,
    "Attested source SHA is invalid",
  );
  assert.equal(
    attestation.run.displayTitle,
    `Release candidate from ${attestation.candidate.sourceCommitSha}`,
    "Attested run title does not bind its candidate source",
  );
  return attestation;
}

export function verifyManifestCandidateRun({ manifest, attestation }) {
  assertManifestShape(manifest);
  validateGitHubRunAttestation(attestation);
  assert.equal(
    manifest.provenance.provider,
    "github-actions",
    "Release candidate was not built by GitHub Actions",
  );
  const expected = {
    repository: attestation.repository.fullName,
    repositoryId: attestation.repository.id,
    workflow: attestation.workflow.name,
    workflowPath: attestation.workflow.path,
    workflowSha: attestation.workflow.sha,
    workflowRunId: attestation.run.id,
    workflowRunAttempt: attestation.run.attempt,
    workflowRunUrl: attestation.run.url,
  };
  for (const [field, value] of Object.entries(expected)) {
    assert.equal(
      manifest.provenance[field],
      value,
      `Release manifest ${field} does not match the selected candidate run`,
    );
  }
  assert.equal(
    manifest.source.commitSha,
    attestation.candidate.sourceCommitSha,
    "Release manifest source does not match the selected candidate run",
  );
  return attestation;
}

async function git(root, args) {
  const { stdout } = await execFileAsync("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
  return stdout.trim();
}

export async function assertExactSource({
  root,
  expectedCommitSha,
  ancestorRef,
}) {
  assert.match(
    expectedCommitSha,
    COMMIT_SHA,
    "Expected source SHA must be exact",
  );
  const repositoryRoot = resolve(
    await git(root, ["rev-parse", "--show-toplevel"]),
  );
  assert.equal(
    repositoryRoot,
    resolve(root),
    "Command must run at the repository root",
  );
  const actualCommitSha = await git(root, ["rev-parse", "HEAD"]);
  assert.equal(
    actualCommitSha,
    expectedCommitSha,
    "Checked-out source SHA differs",
  );
  const trackedChanges = await git(root, [
    "status",
    "--porcelain=v1",
    "--untracked-files=no",
  ]);
  assert.equal(trackedChanges, "", "Tracked release source must be clean");
  if (ancestorRef) {
    try {
      await execFileAsync(
        "git",
        ["merge-base", "--is-ancestor", actualCommitSha, ancestorRef],
        {
          cwd: root,
          windowsHide: true,
        },
      );
    } catch (error) {
      if (error && typeof error === "object" && error.code === 1) {
        assert.fail(`Release source is not reachable from ${ancestorRef}`);
      }
      throw error;
    }
  }
  return actualCommitSha;
}

function safeDeploymentUrl(value, allowHttp) {
  const url = new URL(value);
  assert.ok(
    url.protocol === "https:" || (allowHttp && url.protocol === "http:"),
    "Deployment URL must use HTTPS",
  );
  assert.equal(url.username, "", "Deployment URL cannot contain credentials");
  assert.equal(url.password, "", "Deployment URL cannot contain credentials");
  assert.equal(url.search, "", "Deployment URL cannot contain a query");
  assert.equal(url.hash, "", "Deployment URL cannot contain a fragment");
  assert.ok(
    url.pathname === "/" || url.pathname === "",
    "Deployment URL must be an origin",
  );
  return url.origin;
}

function exactObject(value, keys, label) {
  assert.ok(
    value && typeof value === "object" && !Array.isArray(value),
    `${label} is invalid`,
  );
  assert.deepEqual(
    Object.keys(value).sort(),
    [...keys].sort(),
    `${label} fields changed`,
  );
}

async function readBoundedResponseBody(response, maximumBytes, label) {
  assert.ok(response.body, `${label} body is missing`);
  const reader = response.body.getReader();
  const chunks = [];
  let bodyBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bodyBytes += value.byteLength;
    if (bodyBytes > maximumBytes) {
      await reader.cancel();
      assert.fail(`${label} body is too large`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, bodyBytes).toString("utf8");
}

/**
 * Shared bounded HTTPS JSON fetch. `label` carries each caller's exact
 * assertion messages; `assertResponse` runs between the content-type check
 * and the body read so per-caller header assertions keep their position in
 * the failure order.
 */
async function fetchBoundedJson({
  url,
  headers,
  timeoutMillis,
  maxBytes,
  label,
  assertResponse,
}) {
  const started = performance.now();
  const response = await fetch(url, {
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMillis),
  });
  const durationMillis = Math.round(performance.now() - started);
  assert.equal(response.status, 200, label.requestFailed);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^application\/json(?:;|$)/iu,
    label.expectedJson,
  );
  assertResponse?.(response);
  const body = await readBoundedResponseBody(
    response,
    maxBytes,
    label.responseBody,
  );
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    assert.fail(label.malformedJson);
  }
  return {
    status: response.status,
    durationMillis,
    body: parsed,
    headers: response.headers,
  };
}

export async function fetchGitHubCandidateRunAttestation({
  token,
  expectedRepository,
  expectedRepositoryId,
  expectedRunId,
  expectedWorkflowName,
  expectedWorkflowPath,
  expectedSourceCommit,
  timeoutMillis = 10_000,
  attestedAt = new Date().toISOString(),
}) {
  assert.equal(typeof token, "string", "GitHub token is required");
  assert.ok(
    token.length >= 1 && token.length <= 4096 && !/[\r\n]/u.test(token),
    "GitHub token is invalid",
  );
  assert.match(
    expectedRepository,
    GITHUB_REPOSITORY,
    "Expected GitHub repository is invalid",
  );
  const runId = positiveDecimal(expectedRunId, "Expected run id");
  assertTimeoutMillis(timeoutMillis, "GitHub API timeout");
  const [owner, repository] = expectedRepository.split("/");
  const url =
    `https://api.github.com/repos/${encodeURIComponent(owner)}/` +
    `${encodeURIComponent(repository)}/actions/runs/${runId}`;
  const { body: run } = await fetchBoundedJson({
    url,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "bidbox-release-provenance",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    timeoutMillis,
    maxBytes: MAX_GITHUB_API_BODY_BYTES,
    label: {
      requestFailed: "GitHub candidate run lookup failed",
      expectedJson: "GitHub candidate run lookup must return JSON",
      responseBody: "GitHub candidate run response",
      malformedJson: "GitHub candidate run lookup returned malformed JSON",
    },
  });
  return attestGitHubCandidateRun({
    run,
    expectedRepository,
    expectedRepositoryId,
    expectedRunId: runId,
    expectedWorkflowName,
    expectedWorkflowPath,
    expectedSourceCommit,
    attestedAt,
  });
}

async function probeJson({ url, releaseSha256, timeoutMillis, authorization }) {
  const headers = { Accept: "application/json" };
  if (authorization) headers.Authorization = authorization;
  return fetchBoundedJson({
    url,
    headers,
    timeoutMillis,
    maxBytes: MAX_PROBE_BODY_BYTES,
    label: {
      requestFailed: `Deployment probe failed: ${new URL(url).pathname}`,
      expectedJson: "Deployment probe must return JSON",
      responseBody: "Deployment probe",
      malformedJson: "Deployment probe returned malformed JSON",
    },
    assertResponse: (response) => {
      assert.equal(
        response.headers.get("x-bidbox-release-sha256"),
        releaseSha256,
        "Deployment release identity mismatch",
      );
    },
  });
}

export async function verifyDeploymentReadiness({
  manifest,
  deploymentId,
  deploymentUrl,
  environment,
  authorization = null,
  timeoutMillis = 10_000,
  allowHttp = false,
  recordedAt = new Date().toISOString(),
}) {
  assertManifestShape(manifest);
  assert.match(deploymentId, DEPLOYMENT_ID, "Deployment id is invalid");
  assert.ok(
    ["staging", "production"].includes(environment),
    "Environment is invalid",
  );
  assertTimeoutMillis(timeoutMillis, "Probe timeout");
  if (authorization !== null) {
    assert.equal(
      typeof authorization,
      "string",
      "Authorization must be a string",
    );
    assert.ok(
      authorization.length <= 4096 && !/[\r\n]/u.test(authorization),
      "Authorization header is invalid",
    );
  }
  assertIsoInstant(recordedAt, "recordedAt");
  const origin = safeDeploymentUrl(deploymentUrl, allowHttp);
  const health = await probeJson({
    url: `${origin}/api/healthz`,
    releaseSha256: manifest.releaseSha256,
    timeoutMillis,
    authorization,
  });
  exactObject(health.body, ["status"], "Liveness response");
  assert.equal(health.body.status, "ok", "Deployment is not live");

  const readiness = await probeJson({
    url: `${origin}/api/readyz`,
    releaseSha256: manifest.releaseSha256,
    timeoutMillis,
    authorization,
  });
  assert.equal(
    readiness.headers.get("cache-control"),
    "private, no-store",
    "Readiness response must not be cached",
  );
  exactObject(
    readiness.body,
    ["status", "checks", "delivery"],
    "Readiness response",
  );
  assert.equal(readiness.body.status, "ready", "Deployment is not ready");
  assert.deepEqual(
    readiness.body.checks,
    { lifecycle: "ready", database: "ready" },
    "Runtime readiness checks failed",
  );
  exactObject(
    readiness.body.delivery,
    ["metrics", "paging"],
    "Delivery status",
  );
  for (const channel of ["metrics", "paging"]) {
    assert.ok(
      ["connected", "disconnected"].includes(readiness.body.delivery[channel]),
      `Invalid ${channel} delivery state`,
    );
  }
  return {
    schemaVersion: 1,
    kind: "valo.deployment-verification",
    recordedAt,
    environment,
    deployment: { id: deploymentId, url: origin },
    release: {
      releaseSha256: manifest.releaseSha256,
      sourceCommitSha: manifest.source.commitSha,
      runtimeIdentityEvidence: "environment_declared",
      liveArtifactDigestVerified: false,
    },
    probes: {
      health: { status: health.status, durationMillis: health.durationMillis },
      readiness: {
        status: readiness.status,
        durationMillis: readiness.durationMillis,
        checks: readiness.body.checks,
        delivery: readiness.body.delivery,
      },
    },
  };
}

async function writeEvidence(path, value) {
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
}

function parseOptions(arguments_) {
  const options = new Map();
  for (let index = 0; index < arguments_.length; index += 2) {
    const key = arguments_[index];
    const value = arguments_[index + 1];
    assert.match(
      key ?? "",
      /^--[a-z][a-z-]*$/u,
      `Invalid option: ${key ?? "<missing>"}`,
    );
    assert.notEqual(value, undefined, `Missing value for ${key}`);
    if (key === "--artifact") {
      const current = options.get(key) ?? [];
      current.push(value);
      options.set(key, current);
      continue;
    }
    assert.equal(options.has(key), false, `Duplicate option: ${key}`);
    options.set(key, value);
  }
  return options;
}

function required(options, name) {
  const value = options.get(name);
  assert.ok(typeof value === "string" && value, `${name} is required`);
  return value;
}

function parseArtifact(value) {
  const separator = value.indexOf("=");
  assert.ok(
    separator > 0 && separator < value.length - 1,
    "Artifact must be name=path",
  );
  return { name: value.slice(0, separator), path: value.slice(separator + 1) };
}

function provenanceFromEnvironment(environment) {
  const repository = environment.GITHUB_REPOSITORY?.trim() || null;
  const repositoryId = environment.GITHUB_REPOSITORY_ID?.trim() || null;
  const workflow = environment.GITHUB_WORKFLOW?.trim() || null;
  const workflowReference = environment.GITHUB_WORKFLOW_REF?.trim() || null;
  const workflowSha = environment.GITHUB_SHA?.trim() || null;
  const workflowRunId = environment.GITHUB_RUN_ID?.trim() || null;
  const workflowRunAttempt = environment.GITHUB_RUN_ATTEMPT?.trim() || null;
  const provider =
    environment.GITHUB_ACTIONS === "true" ? "github-actions" : "local";
  let workflowPath = null;
  if (provider === "github-actions") {
    assert.match(repository, GITHUB_REPOSITORY, "GitHub repository is invalid");
    positiveDecimal(repositoryId, "GitHub repository id");
    assert.ok(workflow, "GitHub workflow name is required");
    assert.ok(
      workflowReference?.startsWith(`${repository}/`) &&
        workflowReference.lastIndexOf("@") > repository.length + 1,
      "GitHub workflow reference is invalid",
    );
    workflowPath = workflowReference.slice(
      repository.length + 1,
      workflowReference.lastIndexOf("@"),
    );
    assert.match(
      workflowPath,
      GITHUB_WORKFLOW_PATH,
      "GitHub workflow path is invalid",
    );
    assert.match(workflowSha, COMMIT_SHA, "GitHub workflow SHA is invalid");
    positiveDecimal(workflowRunId, "GitHub workflow run id");
    positiveDecimal(workflowRunAttempt, "GitHub workflow run attempt");
  }
  return {
    provider,
    repository,
    repositoryId,
    workflow,
    workflowPath,
    workflowSha,
    workflowRunId,
    workflowRunAttempt,
    workflowRunUrl:
      repository && workflowRunId
        ? `https://github.com/${repository}/actions/runs/${workflowRunId}`
        : null,
  };
}

async function readManifest(path) {
  await regularFile(path, "Release manifest");
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    assert.fail("Release manifest must contain valid JSON");
  }
}

async function readRunAttestation(path) {
  await regularFile(path, "Candidate run attestation");
  const bytes = await readFile(path);
  try {
    return {
      bytes,
      attestation: validateGitHubRunAttestation(
        JSON.parse(bytes.toString("utf8")),
      ),
    };
  } catch (error) {
    if (error instanceof SyntaxError) {
      assert.fail("Candidate run attestation must contain valid JSON");
    }
    throw error;
  }
}

async function main(argv, environment = process.env) {
  const [command, ...arguments_] = argv;
  const options = parseOptions(arguments_);
  const root = resolve(options.get("--root") ?? process.cwd());
  if (command === "assert-source") {
    const commitSha = await assertExactSource({
      root,
      expectedCommitSha: required(options, "--expected-source-commit"),
      ancestorRef: options.get("--ancestor-ref") ?? null,
    });
    process.stdout.write(`${commitSha}\n`);
    return;
  }
  if (command === "attest-github-run") {
    const attestation = await fetchGitHubCandidateRunAttestation({
      token: environment.GITHUB_TOKEN?.trim() || "",
      expectedRepository: required(options, "--expected-repository"),
      expectedRepositoryId: required(options, "--expected-repository-id"),
      expectedRunId: required(options, "--candidate-run-id"),
      expectedWorkflowName: required(options, "--expected-workflow-name"),
      expectedWorkflowPath: required(options, "--expected-workflow-path"),
      expectedSourceCommit: required(options, "--expected-source-commit"),
    });
    await writeEvidence(
      resolve(root, required(options, "--output")),
      attestation,
    );
    process.stdout.write(`${attestation.run.id}\n`);
    return;
  }
  if (command === "create") {
    const expectedCommitSha = required(options, "--expected-source-commit");
    await assertExactSource({ root, expectedCommitSha, ancestorRef: null });
    const artifactValues = options.get("--artifact") ?? [];
    const manifest = await createReleaseManifest({
      root,
      sourceCommitSha: expectedCommitSha,
      artifactInputs: artifactValues.map(parseArtifact),
      sbomPath: required(options, "--sbom"),
      provenance: provenanceFromEnvironment(environment),
    });
    await writeEvidence(resolve(root, required(options, "--output")), manifest);
    process.stdout.write(`${manifest.releaseSha256}\n`);
    return;
  }
  if (command === "print-release-id") {
    const manifest = await readManifest(
      resolve(root, required(options, "--manifest")),
    );
    assertManifestShape(manifest);
    process.stdout.write(`${manifest.releaseSha256}\n`);
    return;
  }
  if (command === "verify-manifest") {
    const manifest = await readManifest(
      resolve(root, required(options, "--manifest")),
    );
    await verifyReleaseManifest({ root, manifest });
    const expectedSourceCommit = options.get("--expected-source-commit");
    if (expectedSourceCommit !== undefined) {
      assertManifestSource(manifest, expectedSourceCommit);
    }
    const runAttestationPath = options.get("--run-attestation");
    if (runAttestationPath !== undefined) {
      const { attestation } = await readRunAttestation(
        resolve(root, runAttestationPath),
      );
      verifyManifestCandidateRun({ manifest, attestation });
    }
    process.stdout.write(`${manifest.releaseSha256}\n`);
    return;
  }
  if (command === "verify-deployment") {
    const manifestPath = resolve(root, required(options, "--manifest"));
    const manifestBytes = await readFile(manifestPath);
    const manifest = JSON.parse(manifestBytes.toString("utf8"));
    await verifyReleaseManifest({ root, manifest });
    assertManifestSource(
      manifest,
      required(options, "--expected-source-commit"),
    );
    const runAttestationPath = required(options, "--run-attestation");
    const { bytes: runAttestationBytes, attestation: runAttestation } =
      await readRunAttestation(resolve(root, runAttestationPath));
    verifyManifestCandidateRun({ manifest, attestation: runAttestation });
    const record = await verifyDeploymentReadiness({
      manifest,
      deploymentId: required(options, "--deployment-id"),
      deploymentUrl: required(options, "--deployment-url"),
      environment: required(options, "--environment"),
      authorization: environment.VALO_READINESS_AUTHORIZATION?.trim() || null,
      timeoutMillis: Number(options.get("--timeout-millis") ?? "10000"),
    });
    record.evidence = {
      manifestSha256: sha256(manifestBytes),
      candidateRunAttestationSha256: sha256(runAttestationBytes),
      candidateRun: {
        repository: runAttestation.repository.fullName,
        workflow: runAttestation.workflow.path,
        workflowRef: runAttestation.workflow.ref,
        id: runAttestation.run.id,
        attempt: runAttestation.run.attempt,
        conclusion: runAttestation.run.conclusion,
      },
      sbomSha256: manifest.sbom.sha256,
      artifacts: manifest.artifacts.map(({ name, sha256: digest }) => ({
        name,
        sha256: digest,
      })),
    };
    await writeEvidence(resolve(root, required(options, "--output")), record);
    process.stdout.write(`${record.release.releaseSha256}\n`);
    return;
  }
  assert.fail(
    "Usage: release-provenance <assert-source|attest-github-run|create|print-release-id|verify-manifest|verify-deployment> [options]",
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(
      `release provenance failed: ${error instanceof Error ? error.message : "unknown error"}\n`,
    );
    process.exitCode = 1;
  });
}
