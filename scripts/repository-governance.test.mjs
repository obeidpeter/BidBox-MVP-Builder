import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  validateBranchPolicy,
  validateCiJobTopology,
  validateCodeowners,
  validateReleaseWorkflowSecurity,
  validateRequiredWorkflowActions,
  verifyRepositoryGovernance,
} from "./verify-repository-governance.mjs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function validPolicy() {
  return {
    schemaVersion: 1,
    status: "desired_state_requires_github_application",
    branch: "main",
    owner: "@bidbox-owner",
    pullRequest: {
      required: true,
      requiredApprovingReviewCount: 1,
      requireCodeOwnerReview: true,
      dismissStaleApprovals: true,
      requireApprovalOfMostRecentPush: true,
      requireConversationResolution: true,
    },
    requiredStatusChecks: {
      strict: true,
      checks: [
        {
          context: "CI / verify",
          workflow: ".github/workflows/ci.yml",
          job: "verify",
        },
        {
          context: "CodeQL / analyse",
          workflow: ".github/workflows/codeql.yml",
          job: "analyse",
        },
        {
          context: "Dependency review / dependency-review",
          workflow: ".github/workflows/dependency-review.yml",
          job: "dependency-review",
        },
      ],
    },
    history: { blockForcePushes: true, blockDeletions: true },
    administration: { enforceForAdministrators: true, bypassActors: [] },
    releaseEnvironments: {
      staging: { requiredReviewers: 1, allowedDeploymentBranches: ["main"] },
      production: {
        requiredReviewers: 1,
        preventSelfReview: true,
        allowedDeploymentBranches: ["main"],
      },
    },
  };
}

describe("repository governance policy", () => {
  it("accepts the bounded desired-state contract", () => {
    assert.equal(validateBranchPolicy(validPolicy()).branch, "main");
  });

  it("rejects a policy that falsely claims external enforcement", () => {
    const policy = validPolicy();
    policy.status = "enforced";
    assert.throws(() => validateBranchPolicy(policy), /must not claim/u);
  });

  it("rejects missing stale-review and history protections", () => {
    const policy = validPolicy();
    policy.pullRequest.dismissStaleApprovals = false;
    assert.throws(() => validateBranchPolicy(policy), /dismissStaleApprovals/u);
    policy.pullRequest.dismissStaleApprovals = true;
    policy.history.blockForcePushes = false;
    assert.throws(() => validateBranchPolicy(policy), /Force pushes/u);
  });

  it("restricts protected release environments to main", () => {
    const policy = validPolicy();
    policy.releaseEnvironments.production.allowedDeploymentBranches = [
      "release/*",
    ];
    assert.throws(() => validateBranchPolicy(policy), /main only/u);
  });

  it("rejects standing administrator bypass", () => {
    const policy = validPolicy();
    policy.administration.bypassActors = ["RepositoryRole:admin"];
    assert.throws(() => validateBranchPolicy(policy), /bypass actors/u);
  });

  it("requires fallback and critical CODEOWNERS coverage", () => {
    const policy = validPolicy();
    const complete = [
      "* @bidbox-owner",
      "/.github/ @bidbox-owner",
      "/scripts/ @bidbox-owner",
      "/lib/db/ @bidbox-owner",
      "/lib/api-spec/ @bidbox-owner",
      "/artifacts/api-server/.replit-artifact/ @bidbox-owner",
      "/.replit @bidbox-owner",
    ].join("\n");
    assert.doesNotThrow(() => validateCodeowners(complete, policy));
    assert.throws(
      () =>
        validateCodeowners(complete.replace("/lib/db/", "/lib/other/"), policy),
      /lib\/db/u,
    );
  });

  it("pins every action in each protected required workflow", () => {
    const ci = `
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262
      - uses: gitleaks/gitleaks-action@e0c47f4f8be36e29cdc102c57e68cb5cbf0e8d1e
      - uses: pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262
      - uses: pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262
      - uses: pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020
      - uses: anchore/sbom-action@e22c389904149dbc22b58101806040fa8d37a610
        with:
          upload-artifact: false
          upload-release-assets: false
          dependency-snapshot: false
      - uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02
`;
    const codeql = `
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262
      - uses: github/codeql-action/init@03e4368ac7daa2bd82b3e85262f3bf87ee112f57
      - uses: github/codeql-action/analyze@03e4368ac7daa2bd82b3e85262f3bf87ee112f57
`;
    const dependency = `
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262
      - uses: actions/dependency-review-action@2031cfc080254a8a887f58cffee85186f0e49e48
`;
    assert.doesNotThrow(() =>
      validateRequiredWorkflowActions(".github/workflows/ci.yml", ci),
    );
    assert.doesNotThrow(() =>
      validateRequiredWorkflowActions(".github/workflows/codeql.yml", codeql),
    );
    assert.doesNotThrow(() =>
      validateRequiredWorkflowActions(
        ".github/workflows/dependency-review.yml",
        dependency,
      ),
    );
    assert.throws(
      () =>
        validateRequiredWorkflowActions(
          ".github/workflows/codeql.yml",
          codeql.replace(
            "github/codeql-action/init@03e4368ac7daa2bd82b3e85262f3bf87ee112f57",
            "github/codeql-action/init@v3",
          ),
        ),
      /full commit SHA/u,
    );
    assert.throws(
      () =>
        validateRequiredWorkflowActions(
          ".github/workflows/ci.yml",
          ci.replace("upload-artifact: false", "upload-artifact: true"),
        ),
      /CI Anchore must set upload-artifact: false/u,
    );
    for (const injected of [
      "      - { uses: attacker/action@main }",
      '      - "uses": attacker/action@main',
      "      - uses : attacker/action@main",
      "    uses: attacker/reusable/.github/workflows/pwn.yml@main",
    ]) {
      assert.throws(
        () =>
          validateRequiredWorkflowActions(
            ".github/workflows/ci.yml",
            `${ci}\n${injected}\n`,
          ),
        /action count changed|full commit SHA/u,
      );
    }
  });

  it("keeps the stable aggregate check and database gates ordered", async () => {
    const ci = await readFile(
      new URL("../.github/workflows/ci.yml", import.meta.url),
      "utf8",
    );
    assert.doesNotThrow(() => validateCiJobTopology(ci));
    assert.throws(
      () =>
        validateCiJobTopology(
          ci.replace("      - workbench-build", "      - omitted-lane"),
        ),
      /aggregate every parallel verification lane/u,
    );
    assert.throws(
      () =>
        validateCiJobTopology(
          ci.replace("codegen:check", "test-generated-comparator-only"),
        ),
      /hermetic generated-client reproduction/u,
    );
    assert.throws(
      () =>
        validateCiJobTopology(
          ci.replace(
            "pnpm --filter @workspace/db run migration:apply",
            "pnpm --filter @workspace/api-server test",
          ),
        ),
      /missing or out of order/u,
    );
  });

  it("rejects any protected workflow byte change before YAML aliases can expand", async () => {
    const root = await mkdtemp(join(tmpdir(), "bidbox-governance-"));
    try {
      await mkdir(join(root, ".github", "workflows"), { recursive: true });
      await writeFile(
        join(root, ".github", "branch-policy.json"),
        JSON.stringify(validPolicy()),
      );
      await writeFile(
        join(root, ".github", "CODEOWNERS"),
        [
          "* @bidbox-owner",
          "/.github/ @bidbox-owner",
          "/scripts/ @bidbox-owner",
          "/lib/db/ @bidbox-owner",
          "/lib/api-spec/ @bidbox-owner",
          "/artifacts/api-server/.replit-artifact/ @bidbox-owner",
          "/.replit @bidbox-owner",
        ].join("\n"),
      );
      const workflows = [
        "ci.yml",
        "codeql.yml",
        "dependency-review.yml",
        "release-candidate.yml",
        "deployment-verification.yml",
      ];
      for (const workflow of workflows) {
        const source = await import("node:fs/promises").then(({ readFile }) =>
          readFile(
            new URL(`../.github/workflows/${workflow}`, import.meta.url),
          ),
        );
        await writeFile(join(root, ".github", "workflows", workflow), source);
      }
      const ciPath = join(root, ".github", "workflows", "ci.yml");
      const { readFile } = await import("node:fs/promises");
      const ci = await readFile(ciPath, "utf8");
      await writeFile(
        ciPath,
        `${ci}\n# &step\n# - *step\n# \\"u\\u0073es\\": attacker/action@main\n`,
      );
      await assert.rejects(
        () => verifyRepositoryGovernance(root),
        /bytes changed without updating the reviewed workflow digest/u,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("enforces least privilege and secret-to-environment binding", () => {
    const sourceChecks = `if: github.ref == 'refs/heads/main'\ntest "$(git rev-parse HEAD)" = "$SOURCE_SHA"\ntest -z "$(git status --porcelain=v1 --untracked-files=no)"\ngit merge-base --is-ancestor "$SOURCE_SHA" origin/main\n`;
    const candidate = `permissions:\n  contents: read\n\n${sourceChecks}node ./scripts/release-provenance.mjs tool --expected-source-commit "$SOURCE_SHA"\nsteps:\n      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262\n        with:\n          persist-credentials: false\n      - uses: pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1\n      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020\n      - uses: anchore/sbom-action@e22c389904149dbc22b58101806040fa8d37a610\n        with:\n          upload-artifact: false\n          upload-release-assets: false\n          dependency-snapshot: false\n      - uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02\n`;
    const deployment = `permissions:\n  actions: read\n  contents: read\n\njobs:\n  verify:\n    environment: \${{ inputs.environment }}\n    ${sourceChecks}node ./scripts/release-provenance.mjs tool --expected-source-commit "$SOURCE_SHA"\n    steps:\n      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262\n        with:\n          persist-credentials: false\n      - env:\n          CANDIDATE_RUN_ID: \${{ inputs.candidate_run_id }}\n          EXPECTED_REPOSITORY: \${{ github.repository }}\n          EXPECTED_REPOSITORY_ID: \${{ github.repository_id }}\n          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}\n        run: node tool attest-github-run --candidate-run-id "$CANDIDATE_RUN_ID" --expected-repository "$EXPECTED_REPOSITORY" --expected-repository-id "$EXPECTED_REPOSITORY_ID" --expected-workflow-name "Release candidate" --expected-workflow-path ".github/workflows/release-candidate.yml" --expected-source-commit "$SOURCE_SHA" --output "$RUNNER_TEMP/bidbox-candidate-run-attestation.json"\n      - uses: actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093\n        with:\n          name: bidbox-release-\${{ inputs.source_sha }}\n          path: \${{ runner.temp }}/bidbox-release-candidate\n          run-id: \${{ inputs.candidate_run_id }}\n          github-token: \${{ secrets.GITHUB_TOKEN }}\n      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020\n      - run: node tool --root "$RUNNER_TEMP/bidbox-release-candidate" --expected-source-commit "$SOURCE_SHA" --run-attestation "$RUNNER_TEMP/bidbox-candidate-run-attestation.json"\n      - env:\n          DEPLOYMENT_URL: \${{ vars.VALO_DEPLOYMENT_ORIGIN }}\n          VALO_READINESS_AUTHORIZATION: \${{ secrets.VALO_READINESS_AUTHORIZATION }}\n        run: node tool --root "$RUNNER_TEMP/bidbox-release-candidate" --expected-source-commit "$SOURCE_SHA" --run-attestation "$RUNNER_TEMP/bidbox-candidate-run-attestation.json"\n      - uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02\n`;
    assert.doesNotThrow(() =>
      validateReleaseWorkflowSecurity(candidate, deployment),
    );
    assert.throws(
      () =>
        validateReleaseWorkflowSecurity(
          candidate.replace("contents: read", "contents: write"),
          deployment,
        ),
      /read-only/u,
    );
    assert.throws(
      () =>
        validateReleaseWorkflowSecurity(
          candidate,
          deployment.replace(
            "run: node tool",
            "run: node tool --authorization",
          ),
        ),
      /command argument/u,
    );
    assert.throws(
      () =>
        validateReleaseWorkflowSecurity(
          candidate,
          deployment.replace(
            "vars.VALO_DEPLOYMENT_ORIGIN",
            "inputs.deployment_url",
          ),
        ),
      /protected environment/u,
    );
    assert.throws(
      () =>
        validateReleaseWorkflowSecurity(
          candidate.replace(
            "actions/checkout@11d5960a326750d5838078e36cf38b85af677262",
            "actions/checkout@v4",
          ),
          deployment,
        ),
      /full commit SHA/u,
    );
    assert.throws(
      () =>
        validateReleaseWorkflowSecurity(
          candidate.replace("upload-artifact: false", "upload-artifact: true"),
          deployment,
        ),
      /Anchore must set upload-artifact: false/u,
    );
    assert.throws(
      () =>
        validateReleaseWorkflowSecurity(
          candidate,
          deployment.replace("attest-github-run", "attest-run"),
        ),
      /Candidate-run attestation lost/u,
    );
    assert.throws(
      () =>
        validateReleaseWorkflowSecurity(
          candidate.replace(
            'git merge-base --is-ancestor "$SOURCE_SHA" origin/main',
            'git merge-base --is-ancestor "$SOURCE_SHA" origin/feature',
          ),
          deployment,
        ),
      /lost trusted source check/u,
    );
    assert.throws(
      () =>
        validateReleaseWorkflowSecurity(
          `pull_request_target:\n${candidate}`,
          deployment,
        ),
      /pull_request_target/u,
    );
    assert.throws(
      () =>
        validateReleaseWorkflowSecurity(
          candidate,
          deployment.replace(
            "path: ${{ runner.temp }}/bidbox-release-candidate",
            "path: .",
          ),
        ),
      /must not overwrite/u,
    );
  });
});
