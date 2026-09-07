import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OWNER_PATTERN = /^@[A-Za-z0-9](?:[A-Za-z0-9-]{0,37})$/u;
const CHECK_CONTEXT_PATTERN = /^[^/\r\n]+ \/ [^/\r\n]+$/u;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export function validateBranchPolicy(policy) {
  assert.equal(policy?.schemaVersion, 1, "Branch policy schema must be v1");
  assert.equal(
    policy.status,
    "desired_state_requires_github_application",
    "The checked-in policy must not claim GitHub enforcement",
  );
  assert.equal(policy.branch, "main", "The protected branch must be main");
  assert.match(
    policy.owner,
    OWNER_PATTERN,
    "Policy owner must be a GitHub login",
  );

  assert.equal(
    policy.pullRequest?.required,
    true,
    "Pull requests are required",
  );
  assert.ok(
    Number.isSafeInteger(policy.pullRequest.requiredApprovingReviewCount) &&
      policy.pullRequest.requiredApprovingReviewCount >= 1,
    "At least one approving review is required",
  );
  for (const field of [
    "requireCodeOwnerReview",
    "dismissStaleApprovals",
    "requireApprovalOfMostRecentPush",
    "requireConversationResolution",
  ]) {
    assert.equal(policy.pullRequest[field], true, `${field} must be enabled`);
  }

  assert.equal(
    policy.requiredStatusChecks?.strict,
    true,
    "Required checks must run on the current base",
  );
  const checks = policy.requiredStatusChecks?.checks;
  assert.ok(
    Array.isArray(checks) && checks.length >= 3,
    "Required checks missing",
  );
  assert.equal(
    new Set(checks.map((check) => check.context)).size,
    checks.length,
    "Required check contexts must be unique",
  );
  for (const check of checks) {
    assert.match(check.context, CHECK_CONTEXT_PATTERN, "Invalid check context");
    assert.match(
      check.workflow,
      /^\.github\/workflows\/[a-z0-9-]+\.ya?ml$/u,
      `Invalid workflow path for ${check.context}`,
    );
    assert.match(
      check.job,
      /^[a-z0-9][a-z0-9-]*$/u,
      `Invalid job id for ${check.context}`,
    );
  }

  assert.equal(
    policy.history?.blockForcePushes,
    true,
    "Force pushes must be blocked",
  );
  assert.equal(
    policy.history?.blockDeletions,
    true,
    "Branch deletion must be blocked",
  );
  assert.equal(
    policy.administration?.enforceForAdministrators,
    true,
    "Repository administrators must remain subject to the ruleset",
  );
  assert.deepEqual(
    policy.administration.bypassActors,
    [],
    "The production source branch cannot have standing bypass actors",
  );
  assert.ok(
    policy.releaseEnvironments?.production?.requiredReviewers >= 1,
    "Production needs a protected-environment reviewer",
  );
  assert.equal(
    policy.releaseEnvironments.production.preventSelfReview,
    true,
    "Production must prevent self-review",
  );
  for (const environment of ["staging", "production"]) {
    assert.deepEqual(
      policy.releaseEnvironments?.[environment]?.allowedDeploymentBranches,
      ["main"],
      `${environment} must allow deployments from main only`,
    );
  }
  return policy;
}

export function validateCodeowners(source, policy) {
  const activeLines = source
    .replaceAll("\r\n", "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  assert.ok(activeLines.length > 0, "CODEOWNERS cannot be empty");
  const parsed = activeLines.map((line) => line.split(/\s+/u));
  assert.deepEqual(
    parsed[0],
    ["*", policy.owner],
    "The first CODEOWNERS rule must provide the policy fallback owner",
  );
  for (const [pattern, ...owners] of parsed) {
    assert.ok(pattern, "CODEOWNERS pattern is required");
    assert.ok(owners.length > 0, `${pattern} has no owner`);
    for (const owner of owners) assert.match(owner, OWNER_PATTERN);
  }
  const patterns = new Set(parsed.map(([pattern]) => pattern));
  for (const required of [
    "/.github/",
    "/scripts/",
    "/lib/db/",
    "/lib/api-spec/",
    "/artifacts/api-server/.replit-artifact/",
    "/.replit",
  ]) {
    assert.ok(patterns.has(required), `CODEOWNERS must cover ${required}`);
  }
}

const PINNED_ACTIONS = new Map([
  ["actions/checkout", "11d5960a326750d5838078e36cf38b85af677262"],
  ["pnpm/action-setup", "b906affcce14559ad1aafd4ab0e942779e9f58b1"],
  ["actions/setup-node", "49933ea5288caeca8642d1e84afbd3f7d6820020"],
  ["anchore/sbom-action", "e22c389904149dbc22b58101806040fa8d37a610"],
  ["actions/upload-artifact", "ea165f8d65b6e75b540449e92b4886f43607fa02"],
  ["actions/download-artifact", "d3f86a106a0bac45b974a628896c90dbdf5c8093"],
  ["gitleaks/gitleaks-action", "e0c47f4f8be36e29cdc102c57e68cb5cbf0e8d1e"],
  ["github/codeql-action", "03e4368ac7daa2bd82b3e85262f3bf87ee112f57"],
  [
    "actions/dependency-review-action",
    "2031cfc080254a8a887f58cffee85186f0e49e48",
  ],
]);

const REQUIRED_WORKFLOW_ACTIONS = new Map([
  [
    ".github/workflows/ci.yml",
    [
      "actions/checkout",
      "gitleaks/gitleaks-action",
      "pnpm/action-setup",
      "actions/setup-node",
      "actions/checkout",
      "pnpm/action-setup",
      "actions/setup-node",
      "actions/checkout",
      "pnpm/action-setup",
      "actions/setup-node",
      "anchore/sbom-action",
      "actions/upload-artifact",
    ],
  ],
  [
    ".github/workflows/codeql.yml",
    ["actions/checkout", "github/codeql-action", "github/codeql-action"],
  ],
  [
    ".github/workflows/dependency-review.yml",
    ["actions/checkout", "actions/dependency-review-action"],
  ],
]);

const REVIEWED_WORKFLOW_SHA256 = new Map([
  [
    ".github/workflows/ci.yml",
    "5f44322149b64331ee43eda613101a6be6612e3b0106b96016bea1ad9c0a732f",
  ],
  [
    ".github/workflows/codeql.yml",
    "11a60dea6bb03b6025a8d736235af3a7de76c020792ccba5615f42c08640ebf7",
  ],
  [
    ".github/workflows/dependency-review.yml",
    "1349da989f8cfece73087552710195f6da06e3a2cc4cbc0eb771c69d73fc1263",
  ],
  [
    ".github/workflows/release-candidate.yml",
    "9a96e0cf7f9d5adfd6154614024af6d6f60d4d27572b6b2ff04d78a4673e0cea",
  ],
  [
    ".github/workflows/deployment-verification.yml",
    "7a9a2cd529a4075e93d214c47a43db672388e2758e4633edb0d39bd5e0922b52",
  ],
]);

function normalizedWorkflowSha256(workflow) {
  return createHash("sha256")
    .update(workflow.replaceAll("\r\n", "\n"), "utf8")
    .digest("hex");
}

function validateReviewedWorkflowBytes(workflowPath, workflow) {
  assert.equal(
    normalizedWorkflowSha256(workflow),
    REVIEWED_WORKFLOW_SHA256.get(workflowPath),
    `${workflowPath} bytes changed without updating the reviewed workflow digest`,
  );
}

function validatePinnedActions(workflow, expectedActions, label) {
  const workflowLines = workflow.replaceAll("\r\n", "\n").split("\n");
  const usesLines = workflowLines.filter((line) => {
    const trimmed = line.trimStart();
    return !trimmed.startsWith("#") && /\buses\b/u.test(line);
  });
  assert.equal(
    usesLines.length,
    expectedActions.length,
    `${label} action count changed`,
  );
  const actualActions = [];
  for (const line of usesLines) {
    const match =
      /^(?: {6}- uses:| {8}uses:) ([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)(?:\/[A-Za-z0-9_.-]+)*@([0-9a-f]{40})(?: #.*)?$/u.exec(
        line,
      );
    assert.ok(
      match,
      `${label} contains an action that is not pinned to a full commit SHA`,
    );
    const [, action, commit] = match;
    assert.equal(
      PINNED_ACTIONS.get(action),
      commit,
      `${label} uses an unreviewed commit for ${action}`,
    );
    actualActions.push(action);
  }
  assert.deepEqual(
    actualActions,
    expectedActions,
    `${label} action order or identity changed`,
  );
}

export function validateRequiredWorkflowActions(workflowPath, workflow) {
  const expectedActions = REQUIRED_WORKFLOW_ACTIONS.get(workflowPath);
  assert.ok(
    expectedActions,
    `No reviewed action inventory exists for ${workflowPath}`,
  );
  validatePinnedActions(workflow, expectedActions, workflowPath);
  if (workflowPath === ".github/workflows/ci.yml") {
    for (const input of [
      "upload-artifact: false",
      "upload-release-assets: false",
      "dependency-snapshot: false",
    ]) {
      assert.match(
        workflow,
        new RegExp(`^\\s*${escapeRegExp(input)}\\s*$`, "mu"),
        `CI Anchore must set ${input}`,
      );
    }
  }
}

export function validateCiJobTopology(ci) {
  for (const job of ["static-contracts", "postgres-api", "workbench-build"]) {
    assert.match(ci, new RegExp(`^  ${job}:\\s*$`, "mu"), `CI lost ${job}`);
  }
  assert.match(
    ci,
    /^  verify:\n    if: \$\{\{ always\(\) \}\}\n    needs:\n      - static-contracts\n      - postgres-api\n      - workbench-build\n/mu,
    "CI verify must always aggregate every parallel verification lane",
  );
  assert.match(
    ci,
    /^\s*run: pnpm --filter @workspace\/api-spec codegen:check\s*$/mu,
    "CI static lane must enforce hermetic generated-client reproduction",
  );

  const orderedDatabaseGates = [
    "pnpm --filter @workspace/db run migration:check",
    "pnpm --filter @workspace/db migration:bridge:legacy:check",
    "pnpm --filter @workspace/db migration:bridge:legacy:evidence:test",
    "pnpm --filter @workspace/db migration:bridge:legacy:rehearse",
    "pnpm --filter @workspace/db test",
    "pnpm --filter @workspace/db run migration:apply",
    "node --test lib/db/tenant-rls.static.test.mjs",
    "pnpm --filter @workspace/api-server test",
  ];
  let previousIndex = -1;
  for (const gate of orderedDatabaseGates) {
    const currentIndex = ci.indexOf(gate);
    assert.ok(
      currentIndex > previousIndex,
      `CI database gate is missing or out of order: ${gate}`,
    );
    previousIndex = currentIndex;
  }
}

export function validateReleaseWorkflowSecurity(candidate, deployment) {
  assert.match(
    candidate,
    /^permissions:\n  contents: read\n$/mu,
    "Candidate workflow must have read-only repository access",
  );
  assert.match(
    deployment,
    /^permissions:\n  actions: read\n  contents: read\n$/mu,
    "Deployment verification must have only artifact and repository read access",
  );
  for (const [name, workflow] of [
    ["candidate", candidate],
    ["deployment verification", deployment],
  ]) {
    assert.doesNotMatch(
      workflow,
      /^\s*pull_request_target\s*:/mu,
      `${name} workflow cannot run candidate code in pull_request_target`,
    );
    assert.doesNotMatch(
      workflow,
      /^\s*[a-z-]+:\s*write\s*$/mu,
      `${name} workflow cannot have write permission`,
    );
    assert.match(
      workflow,
      /^\s*persist-credentials: false\s*$/mu,
      `${name} checkout must not persist its token`,
    );
    assert.match(
      workflow,
      /--expected-source-commit/u,
      `${name} workflow must bind its full source commit`,
    );
    assert.match(
      workflow,
      /^\s*if: github\.ref == 'refs\/heads\/main'\s*$/mu,
      `${name} workflow must refuse non-main dispatches`,
    );
    for (const trustedSourceCheck of [
      'test "$(git rev-parse HEAD)" = "$SOURCE_SHA"',
      'test -z "$(git status --porcelain=v1 --untracked-files=no)"',
      'git merge-base --is-ancestor "$SOURCE_SHA" origin/main',
    ]) {
      assert.ok(
        workflow.includes(trustedSourceCheck),
        `${name} workflow lost trusted source check: ${trustedSourceCheck}`,
      );
    }
    assert.ok(
      workflow.indexOf(
        'git merge-base --is-ancestor "$SOURCE_SHA" origin/main',
      ) < workflow.indexOf("node ./scripts/release-provenance.mjs"),
      `${name} workflow must prove main ancestry before executing checked-out code`,
    );
  }
  validatePinnedActions(
    candidate,
    [
      "actions/checkout",
      "pnpm/action-setup",
      "actions/setup-node",
      "anchore/sbom-action",
      "actions/upload-artifact",
    ],
    "Candidate workflow",
  );
  validatePinnedActions(
    deployment,
    [
      "actions/checkout",
      "actions/download-artifact",
      "actions/setup-node",
      "actions/upload-artifact",
    ],
    "Deployment verification workflow",
  );
  for (const input of [
    "upload-artifact: false",
    "upload-release-assets: false",
    "dependency-snapshot: false",
  ]) {
    assert.match(
      candidate,
      new RegExp(`^\\s*${escapeRegExp(input)}\\s*$`, "mu"),
      `Anchore must set ${input}`,
    );
  }
  assert.match(
    deployment,
    /^\s*environment: \$\{\{ inputs\.environment \}\}\s*$/mu,
    "Deployment verification must use the selected protected environment",
  );
  const secretReferences = deployment.match(
    /\$\{\{ secrets\.VALO_READINESS_AUTHORIZATION \}\}/gu,
  );
  assert.equal(
    secretReferences?.length,
    1,
    "Readiness authorization must have one secret-to-environment binding",
  );
  assert.match(
    deployment,
    /^\s*VALO_READINESS_AUTHORIZATION: \$\{\{ secrets\.VALO_READINESS_AUTHORIZATION \}\}\s*$/mu,
    "Readiness authorization must enter only through the step environment",
  );
  assert.match(
    deployment,
    /^\s*DEPLOYMENT_URL: \$\{\{ vars\.VALO_DEPLOYMENT_ORIGIN \}\}\s*$/mu,
    "Probe origin must come from the protected environment configuration",
  );
  assert.doesNotMatch(
    deployment,
    /inputs\.deployment_url/u,
    "A workflow caller cannot choose the origin that receives readiness authorization",
  );
  assert.doesNotMatch(
    deployment,
    /--authorization/u,
    "Readiness authorization cannot appear in a command argument",
  );
  for (const requiredBoundary of [
    "attest-github-run",
    "--candidate-run-id",
    "--expected-repository",
    "--expected-repository-id",
    '--expected-workflow-name "Release candidate"',
    '--expected-workflow-path ".github/workflows/release-candidate.yml"',
    "--run-attestation",
  ]) {
    assert.ok(
      deployment.includes(requiredBoundary),
      `Candidate-run attestation lost ${requiredBoundary}`,
    );
  }
  assert.match(
    deployment,
    /^\s*CANDIDATE_RUN_ID: \$\{\{ inputs\.candidate_run_id \}\}\s*$/mu,
    "Candidate run lookup must bind the selected workflow input",
  );
  assert.match(
    deployment,
    /^\s*name: bidbox-release-\$\{\{ inputs\.source_sha \}\}\s*$/mu,
    "Artifact download must select the exact source-bound candidate name",
  );
  assert.match(
    deployment,
    /^\s*run-id: \$\{\{ inputs\.candidate_run_id \}\}\s*$/mu,
    "Artifact download must use the attested candidate run",
  );
  assert.match(
    deployment,
    /^\s*path: \$\{\{ runner\.temp \}\}\/bidbox-release-candidate\s*$/mu,
    "Artifact download must not overwrite the trusted checkout",
  );
  assert.match(
    deployment,
    /^\s*github-token: \$\{\{ secrets\.GITHUB_TOKEN \}\}\s*$/mu,
    "Artifact download token must enter only through the action input",
  );
  assert.equal(
    deployment.match(/--run-attestation/gu)?.length,
    2,
    "Both manifest and deployment verification must consume the run attestation",
  );
  assert.equal(
    deployment.match(/--root "\$RUNNER_TEMP\/bidbox-release-candidate"/gu)
      ?.length,
    2,
    "Both candidate verifications must run against the isolated artifact root",
  );
  assert.equal(
    deployment.match(
      /--run-attestation "\$RUNNER_TEMP\/bidbox-candidate-run-attestation\.json"/gu,
    )?.length,
    2,
    "The API-produced attestation must remain outside downloaded artifact storage",
  );
  assert.match(
    deployment,
    /--output "\$RUNNER_TEMP\/bidbox-candidate-run-attestation\.json"/u,
    "Run attestation must be written outside downloaded artifact storage",
  );
  assert.ok(
    deployment.indexOf("attest-github-run") <
      deployment.indexOf("actions/download-artifact@"),
    "Candidate run must be attested before artifact download",
  );
  assert.match(
    deployment,
    /^\s*GITHUB_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}\s*$/mu,
    "GitHub run lookup token must enter through the step environment",
  );
  assert.equal(
    deployment.match(/\$\{\{ secrets\.GITHUB_TOKEN \}\}/gu)?.length,
    2,
    "GitHub token must be bound only to run attestation and artifact download",
  );
  assert.doesNotMatch(
    deployment,
    /--(?:github-)?token/u,
    "GitHub token cannot appear in a command argument",
  );
}

export async function verifyRepositoryGovernance(root = DEFAULT_ROOT) {
  const policy = validateBranchPolicy(
    JSON.parse(
      await readFile(resolve(root, ".github/branch-policy.json"), "utf8"),
    ),
  );
  validateCodeowners(
    await readFile(resolve(root, ".github/CODEOWNERS"), "utf8"),
    policy,
  );

  for (const check of policy.requiredStatusChecks.checks) {
    const workflow = await readFile(resolve(root, check.workflow), "utf8");
    validateReviewedWorkflowBytes(check.workflow, workflow);
    validateRequiredWorkflowActions(check.workflow, workflow);
    assert.match(
      workflow,
      /^\s*pull_request\s*:/mu,
      `${check.workflow} must run for pull requests`,
    );
    assert.match(
      workflow,
      new RegExp(`^  ${escapeRegExp(check.job)}:\\s*$`, "mu"),
      `${check.workflow} does not declare job ${check.job}`,
    );
  }

  const ci = await readFile(resolve(root, ".github/workflows/ci.yml"), "utf8");
  validateCiJobTopology(ci);
  assert.match(
    ci,
    /run: pnpm run verify:governance/u,
    "CI must enforce the checked-in governance desired state",
  );
  const candidatePath = ".github/workflows/release-candidate.yml";
  const deploymentPath = ".github/workflows/deployment-verification.yml";
  const candidate = await readFile(resolve(root, candidatePath), "utf8");
  const deployment = await readFile(resolve(root, deploymentPath), "utf8");
  validateReviewedWorkflowBytes(candidatePath, candidate);
  validateReviewedWorkflowBytes(deploymentPath, deployment);
  validateReleaseWorkflowSecurity(candidate, deployment);
  return policy;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await verifyRepositoryGovernance();
  process.stdout.write("repository governance desired state valid\n");
}
