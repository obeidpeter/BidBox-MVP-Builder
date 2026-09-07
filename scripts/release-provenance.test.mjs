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
    sourceCommitSha = SOURCE_COMMIT,
    readinessSourceCommitSha = sourceCommitSha,
    corsOrigin,
    readinessCorsOrigin = corsOrigin,
    corsCredentials = "true",
    identityStatus = 200,
    identityBody = {
      auth_config: { object: "auth_config" },
      display_config: { object: "display_config" },
    },
    identityRedirect = false,
    onRequest = () => {},
    readinessStatus = "ready",
    oversizedReadiness = false,
  }) {
    let fixtureOrigin;
    const server = createServer((request, response) => {
      onRequest(request);
      response.setHeader("Content-Type", "application/json");
      const allowedOrigin =
        request.url === "/api/readyz" ? readinessCorsOrigin : corsOrigin;
      if (allowedOrigin !== null) {
        response.setHeader(
          "Access-Control-Allow-Origin",
          allowedOrigin ?? fixtureOrigin,
        );
      }
      if (corsCredentials !== null) {
        response.setHeader("Access-Control-Allow-Credentials", corsCredentials);
      }
      response.setHeader("X-BidBox-Release-Sha256", releaseSha256);
      const source =
        request.url === "/api/readyz"
          ? readinessSourceCommitSha
          : sourceCommitSha;
      if (source !== null) {
        response.setHeader("X-BidBox-Source-Commit", source);
      }
      if (request.url === "/api/__clerk/v1/environment") {
        if (identityRedirect) {
          response.writeHead(302, { Location: "/redirected-identity" });
          response.end();
          return;
        }
        response.statusCode = identityStatus;
        response.end(JSON.stringify(identityBody));
        return;
      }
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
    fixtureOrigin = `http://127.0.0.1:${address.port}`;
    return fixtureOrigin;
  }

  it("keeps fixture CORS fixed to its listener regardless of request Origin", async () => {
    const { manifest } = await fixture();
    const deploymentUrl = await serve({
      releaseSha256: manifest.releaseSha256,
    });
    const response = await fetch(`${deploymentUrl}/api/readyz`, {
      headers: { Origin: "https://untrusted.example.invalid" },
    });
    assert.equal(
      response.headers.get("access-control-allow-origin"),
      deploymentUrl,
    );
    assert.equal(
      response.headers.get("access-control-allow-credentials"),
      "true",
    );
  });

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
    assert.equal(
      record.release.runtimeSourceEvidence,
      "build_time_git_verified",
    );
    assert.equal(record.probes.readiness.status, 200);
    assert.equal(record.probes.authentication.status, 200);
    assert.deepEqual(Object.keys(record.probes.authentication).sort(), [
      "durationMillis",
      "status",
    ]);
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

  it("rejects a reused release digest when either runtime source differs or is absent", async () => {
    const { manifest } = await fixture();
    for (const headers of [
      { sourceCommitSha: "c".repeat(40) },
      { sourceCommitSha: null },
      { readinessSourceCommitSha: "c".repeat(40) },
      { readinessSourceCommitSha: null },
    ]) {
      const deploymentUrl = await serve({
        releaseSha256: manifest.releaseSha256,
        ...headers,
      });
      await assert.rejects(
        () =>
          verifyDeploymentReadiness({
            manifest,
            deploymentId: "deployment-stale-digest",
            deploymentUrl,
            environment: "production",
            allowHttp: true,
            recordedAt: GENERATED_AT,
          }),
        /Deployment build source mismatch/u,
      );
    }
  });

  it("rejects missing, wildcard, wrong-origin, and noncredentialed CORS responses", async () => {
    const { manifest } = await fixture();
    for (const headers of [
      { corsOrigin: null },
      { corsOrigin: "*" },
      { corsOrigin: "https://another.example.invalid" },
      { readinessCorsOrigin: null },
      { readinessCorsOrigin: "https://another.example.invalid" },
      { corsCredentials: null },
      { corsCredentials: "false" },
    ]) {
      const deploymentUrl = await serve({
        releaseSha256: manifest.releaseSha256,
        ...headers,
      });
      await assert.rejects(
        () =>
          verifyDeploymentReadiness({
            manifest,
            deploymentId: "deployment-cors-drift",
            deploymentUrl,
            environment: "production",
            allowHttp: true,
          }),
        /CORS/u,
      );
    }
  });

  it("requires a functioning public identity bootstrap without forwarding edge authorization", async () => {
    const { manifest } = await fixture();
    const requests = [];
    const deploymentUrl = await serve({
      releaseSha256: manifest.releaseSha256,
      identityBody: {
        response: {
          auth_config: { object: "auth_config", future_setting: true },
          display_config: { object: "display_config" },
          unrelated_upstream_addition: {},
        },
      },
      onRequest: (request) => {
        requests.push({
          path: request.url,
          authorization: request.headers.authorization,
          cookie: request.headers.cookie,
          origin: request.headers.origin,
        });
      },
    });
    await verifyDeploymentReadiness({
      manifest,
      deploymentId: "deployment-private-edge",
      deploymentUrl,
      environment: "production",
      authorization: "Bearer private-edge-fixture",
      allowHttp: true,
    });
    assert.equal(requests[0].authorization, "Bearer private-edge-fixture");
    assert.equal(requests[1].authorization, "Bearer private-edge-fixture");
    assert.equal(requests[0].origin, deploymentUrl);
    assert.equal(requests[1].origin, deploymentUrl);
    assert.deepEqual(requests[2], {
      path: "/api/__clerk/v1/environment",
      authorization: undefined,
      cookie: undefined,
      origin: deploymentUrl,
    });
  });

  it("rejects a broken, redirected, oversized, or invalid identity bootstrap", async () => {
    const { manifest } = await fixture();
    for (const options of [
      { identityStatus: 421 },
      { identityRedirect: true },
      { identityBody: null },
      { identityBody: [] },
      { identityBody: {} },
      { identityBody: { errors: [{ code: "identity_proxy_host_rejected" }] } },
      { identityBody: { auth_config: { object: "auth_config" } } },
      { identityBody: { padding: "x".repeat(129 * 1024) } },
    ]) {
      const requests = [];
      const deploymentUrl = await serve({
        releaseSha256: manifest.releaseSha256,
        onRequest: (request) => requests.push(request.url),
        ...options,
      });
      await assert.rejects(() =>
        verifyDeploymentReadiness({
          manifest,
          deploymentId: "deployment-identity-drift",
          deploymentUrl,
          environment: "production",
          allowHttp: true,
        }),
      );
      assert.equal(requests.includes("/redirected-identity"), false);
    }
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
