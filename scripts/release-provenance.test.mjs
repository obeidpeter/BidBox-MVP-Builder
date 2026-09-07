import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  attestGitHubCandidateRun,
  collectArtifact,
  createReleaseManifest,
  verifyDeploymentReadiness,
  verifyManifestCandidateRun,
  verifyReleaseManifest,
} from "./release-provenance.mjs";

const temporaryDirectories = [];
const servers = [];
const SOURCE_COMMIT = "a".repeat(40);
const WORKFLOW_COMMIT = "b".repeat(40);
const GENERATED_AT = "2026-08-13T12:00:00.000Z";
const REPOSITORY = "obeidpeter/BidBox-MVP-Builder";
const REPOSITORY_ID = "123456789";
const RUN_ID = "987654321";
const RUN_ATTEMPT = "2";
const WORKFLOW_ID = "456789";
const WORKFLOW_NAME = "Release candidate";
const WORKFLOW_PATH = ".github/workflows/release-candidate.yml";

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "bidbox-release-"));
  temporaryDirectories.push(root);
  await mkdir(join(root, "artifacts", "api", "nested"), { recursive: true });
  await mkdir(join(root, "artifacts", "web"), { recursive: true });
  await writeFile(
    join(root, "artifacts", "api", "index.mjs"),
    "export default 1;\n",
  );
  await writeFile(
    join(root, "artifacts", "api", "nested", "worker.mjs"),
    "export {};\n",
  );
  await writeFile(
    join(root, "artifacts", "web", "index.html"),
    "<!doctype html>\n",
  );
  await writeFile(
    join(root, "sbom.json"),
    JSON.stringify({ bomFormat: "CycloneDX", specVersion: "1.6", version: 1 }),
  );
  const manifest = await createReleaseManifest({
    root,
    sourceCommitSha: SOURCE_COMMIT,
    artifactInputs: [
      { name: "web", path: "artifacts/web" },
      { name: "api", path: "artifacts/api" },
    ],
    sbomPath: "sbom.json",
    generatedAt: GENERATED_AT,
    provenance: { provider: "test" },
  });
  return { root, manifest };
}

function githubRun(overrides = {}) {
  return {
    id: Number(RUN_ID),
    name: WORKFLOW_NAME,
    path: WORKFLOW_PATH,
    head_branch: "main",
    display_title: `${WORKFLOW_NAME} from ${SOURCE_COMMIT}`,
    event: "workflow_dispatch",
    status: "completed",
    conclusion: "success",
    head_sha: WORKFLOW_COMMIT,
    workflow_id: Number(WORKFLOW_ID),
    run_attempt: Number(RUN_ATTEMPT),
    html_url: `https://github.com/${REPOSITORY}/actions/runs/${RUN_ID}`,
    repository: { id: Number(REPOSITORY_ID), full_name: REPOSITORY },
    head_repository: { id: Number(REPOSITORY_ID), full_name: REPOSITORY },
    ...overrides,
  };
}

function candidateAttestation(run = githubRun()) {
  return attestGitHubCandidateRun({
    run,
    expectedRepository: REPOSITORY,
    expectedRepositoryId: REPOSITORY_ID,
    expectedRunId: RUN_ID,
    expectedWorkflowName: WORKFLOW_NAME,
    expectedWorkflowPath: WORKFLOW_PATH,
    expectedSourceCommit: SOURCE_COMMIT,
    attestedAt: GENERATED_AT,
  });
}

async function githubCandidateFixture() {
  const { root, manifest } = await fixture();
  manifest.provenance = {
    provider: "github-actions",
    repository: REPOSITORY,
    repositoryId: REPOSITORY_ID,
    workflow: WORKFLOW_NAME,
    workflowPath: WORKFLOW_PATH,
    workflowSha: WORKFLOW_COMMIT,
    workflowRunId: RUN_ID,
    workflowRunAttempt: RUN_ATTEMPT,
    workflowRunUrl: `https://github.com/${REPOSITORY}/actions/runs/${RUN_ID}`,
  };
  return { root, manifest, attestation: candidateAttestation() };
}

describe("release candidate provenance", () => {
  it("sorts file inputs and derives a stable content identity", async () => {
    const { root, manifest } = await fixture();
    assert.equal(manifest.releaseSha256.length, 64);
    assert.deepEqual(
      manifest.artifacts.map(({ name }) => name),
      ["api", "web"],
    );
    assert.deepEqual(
      manifest.artifacts[0].files.map(({ path }) => path),
      ["index.mjs", "nested/worker.mjs"],
    );
    await assert.doesNotReject(() => verifyReleaseManifest({ root, manifest }));

    const api = await collectArtifact({
      root,
      name: "api",
      path: "artifacts/api",
    });
    assert.equal(api.sha256, manifest.artifacts[0].sha256);
  });

  it("rejects changed artifact bytes and a changed release identity", async () => {
    const { root, manifest } = await fixture();
    await writeFile(
      join(root, "artifacts", "api", "index.mjs"),
      "export default 2;\n",
    );
    await assert.rejects(
      () => verifyReleaseManifest({ root, manifest }),
      /Artifact verification failed/u,
    );

    const fresh = await createReleaseManifest({
      root,
      sourceCommitSha: SOURCE_COMMIT,
      artifactInputs: [
        { name: "api", path: "artifacts/api" },
        { name: "web", path: "artifacts/web" },
      ],
      sbomPath: "sbom.json",
      generatedAt: GENERATED_AT,
    });
    fresh.releaseSha256 = "f".repeat(64);
    await assert.rejects(
      () => verifyReleaseManifest({ root, manifest: fresh }),
      /Release identity/u,
    );
  });

  it("rejects a non-canonical artifact inventory", async () => {
    const { root, manifest } = await fixture();
    manifest.artifacts.reverse();
    await assert.rejects(
      () => verifyReleaseManifest({ root, manifest }),
      /canonical name order/u,
    );
  });

  it("rejects an invalid or non-CycloneDX SBOM", async () => {
    const { root } = await fixture();
    await writeFile(join(root, "sbom.json"), JSON.stringify({ version: 1 }));
    await assert.rejects(
      () =>
        createReleaseManifest({
          root,
          sourceCommitSha: SOURCE_COMMIT,
          artifactInputs: [{ name: "api", path: "artifacts/api" }],
          sbomPath: "sbom.json",
          generatedAt: GENERATED_AT,
        }),
      /CycloneDX/u,
    );
  });

  it("binds the CycloneDX document into the release identity", async () => {
    const { root, manifest } = await fixture();
    await writeFile(
      join(root, "sbom.json"),
      JSON.stringify({
        bomFormat: "CycloneDX",
        specVersion: "1.6",
        version: 2,
      }),
    );
    const changed = await createReleaseManifest({
      root,
      sourceCommitSha: SOURCE_COMMIT,
      artifactInputs: [
        { name: "api", path: "artifacts/api" },
        { name: "web", path: "artifacts/web" },
      ],
      sbomPath: "sbom.json",
      generatedAt: GENERATED_AT,
    });
    assert.notEqual(changed.releaseSha256, manifest.releaseSha256);
  });
});

describe("GitHub candidate run provenance", () => {
  it("binds a successful exact workflow run to its manifest provenance", async () => {
    const { manifest, attestation } = await githubCandidateFixture();
    assert.equal(attestation.run.id, RUN_ID);
    assert.equal(attestation.run.conclusion, "success");
    assert.equal(attestation.workflow.path, WORKFLOW_PATH);
    assert.equal(
      verifyManifestCandidateRun({ manifest, attestation }),
      attestation,
    );
  });

  it("accepts GitHub's source-bound run name", () => {
    const sourceBoundName = `${WORKFLOW_NAME} from ${SOURCE_COMMIT}`;
    const attestation = candidateAttestation({
      ...githubRun(),
      name: sourceBoundName,
    });

    assert.equal(attestation.workflow.name, WORKFLOW_NAME);
    assert.equal(attestation.run.displayTitle, sourceBoundName);
  });

  it("rejects candidate-run substitution across repository and workflow", () => {
    assert.throws(
      () => candidateAttestation({ ...githubRun(), id: 111111 }),
      /run id differs/u,
    );
    assert.throws(
      () => candidateAttestation({ ...githubRun(), head_branch: "feature" }),
      /protected main/u,
    );
    assert.throws(
      () =>
        candidateAttestation({
          ...githubRun(),
          repository: { id: 12, full_name: "attacker/substitute" },
        }),
      /another repository/u,
    );
    assert.throws(
      () =>
        candidateAttestation({
          ...githubRun(),
          path: ".github/workflows/ci.yml",
        }),
      /another workflow path/u,
    );
    assert.throws(
      () => candidateAttestation({ ...githubRun(), name: "Release lookalike" }),
      /not the release-candidate workflow/u,
    );
  });

  it("rejects an incomplete, failed, or source-substituted run", () => {
    assert.throws(
      () => candidateAttestation({ ...githubRun(), status: "in_progress" }),
      /not completed/u,
    );
    assert.throws(
      () => candidateAttestation({ ...githubRun(), conclusion: "failure" }),
      /not successful/u,
    );
    assert.throws(
      () =>
        candidateAttestation({
          ...githubRun(),
          display_title: `Release candidate from ${"c".repeat(40)}`,
        }),
      /another source commit/u,
    );
  });

  it("rejects run, repository, workflow, and source mismatches in the manifest", async () => {
    const { manifest, attestation } = await githubCandidateFixture();
    for (const [field, value] of [
      ["workflowRunId", "111111"],
      ["repository", "attacker/substitute"],
      ["workflowPath", ".github/workflows/ci.yml"],
      ["workflowSha", "c".repeat(40)],
    ]) {
      const substituted = structuredClone(manifest);
      substituted.provenance[field] = value;
      assert.throws(
        () =>
          verifyManifestCandidateRun({ manifest: substituted, attestation }),
        new RegExp(field, "u"),
      );
    }
    const sourceSubstitution = structuredClone(manifest);
    sourceSubstitution.source.commitSha = "c".repeat(40);
    assert.throws(
      () =>
        verifyManifestCandidateRun({
          manifest: sourceSubstitution,
          attestation,
        }),
      /source does not match/u,
    );
  });
});

describe("deployed readiness evidence", () => {
  async function serve({
    releaseSha256,
    readinessStatus = "ready",
    oversizedReadiness = false,
  }) {
    const server = createServer((request, response) => {
      response.setHeader("Content-Type", "application/json");
      response.setHeader("X-BidBox-Release-Sha256", releaseSha256);
      if (request.url === "/api/healthz") {
        response.end(JSON.stringify({ status: "ok" }));
        return;
      }
      if (request.url === "/api/readyz") {
        response.setHeader("Cache-Control", "private, no-store");
        response.statusCode = readinessStatus === "ready" ? 200 : 503;
        if (oversizedReadiness) {
          response.end(JSON.stringify({ padding: "x".repeat(20 * 1024) }));
          return;
        }
        response.end(
          JSON.stringify({
            status: readinessStatus,
            checks: {
              lifecycle: readinessStatus,
              database: readinessStatus,
            },
            delivery: { metrics: "disconnected", paging: "disconnected" },
          }),
        );
        return;
      }
      response.statusCode = 404;
      response.end("{}");
    });
    servers.push(server);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert(address && typeof address !== "string");
    return `http://127.0.0.1:${address.port}`;
  }

  it("binds successful liveness and readiness to the candidate digest", async () => {
    const { manifest } = await fixture();
    const deploymentUrl = await serve({
      releaseSha256: manifest.releaseSha256,
    });
    const record = await verifyDeploymentReadiness({
      manifest,
      deploymentId: "deployment-123",
      deploymentUrl,
      environment: "staging",
      allowHttp: true,
      recordedAt: GENERATED_AT,
    });
    assert.equal(record.release.releaseSha256, manifest.releaseSha256);
    assert.equal(record.release.sourceCommitSha, SOURCE_COMMIT);
    assert.equal(
      record.release.runtimeIdentityEvidence,
      "environment_declared",
    );
    assert.equal(record.release.liveArtifactDigestVerified, false);
    assert.equal(record.probes.readiness.status, 200);
    assert.deepEqual(record.probes.readiness.checks, {
      lifecycle: "ready",
      database: "ready",
    });
  });

  it("fails closed when the runtime identifies another release", async () => {
    const { manifest } = await fixture();
    const deploymentUrl = await serve({ releaseSha256: "b".repeat(64) });
    await assert.rejects(
      () =>
        verifyDeploymentReadiness({
          manifest,
          deploymentId: "deployment-123",
          deploymentUrl,
          environment: "production",
          allowHttp: true,
          recordedAt: GENERATED_AT,
        }),
      /identity mismatch/u,
    );
  });

  it("stops reading an oversized deployment response", async () => {
    const { manifest } = await fixture();
    const deploymentUrl = await serve({
      releaseSha256: manifest.releaseSha256,
      oversizedReadiness: true,
    });
    await assert.rejects(
      () =>
        verifyDeploymentReadiness({
          manifest,
          deploymentId: "deployment-123",
          deploymentUrl,
          environment: "production",
          allowHttp: true,
          recordedAt: GENERATED_AT,
        }),
      /body is too large/u,
    );
  });
});
