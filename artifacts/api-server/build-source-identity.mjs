import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const COMMIT_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

async function git(root, args) {
  const { stdout } = await execFileAsync("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
  return stdout.trim();
}

export async function resolveBuildSourceCommit({ root }) {
  const repositoryRoot = resolve(
    await git(root, ["rev-parse", "--show-toplevel"]),
  );
  assert.equal(
    repositoryRoot,
    resolve(root),
    "Build source identity requires the repository root",
  );
  const head = await git(root, ["rev-parse", "HEAD"]);
  assert.match(head, COMMIT_SHA, "Build source must be an exact Git object id");
  assert.equal(
    await git(root, ["status", "--porcelain=v1", "--untracked-files=normal"]),
    "",
    "Build source identity requires clean committed source, including new files",
  );

  // Replit can append empty publication commits and names the GitHub remote
  // upstream. Only collapse that history when Git proves the entire source
  // tree equals a main ancestor. Never accept an environment-provided SHA.
  const headTree = await git(root, ["rev-parse", `${head}^{tree}`]);
  const matchingAncestors = [];
  for (const mainRef of ["origin/main", "upstream/main"]) {
    let ancestor;
    try {
      ancestor = await git(root, ["merge-base", "HEAD", mainRef]);
    } catch {
      continue;
    }
    assert.match(ancestor, COMMIT_SHA, "Main ancestor must be exact");
    if (ancestor === head) return head;
    const ancestorTree = await git(root, ["rev-parse", `${ancestor}^{tree}`]);
    if (headTree === ancestorTree) {
      const distance = Number(
        await git(root, ["rev-list", "--count", `${ancestor}..HEAD`]),
      );
      assert.ok(Number.isSafeInteger(distance) && distance > 0);
      matchingAncestors.push({ ancestor, distance });
    }
  }
  matchingAncestors.sort((left, right) => left.distance - right.distance);
  // A changed provider snapshot or missing ancestry exposes actual HEAD, so
  // deployment verification can refuse it instead of inventing main identity.
  return matchingAncestors[0]?.ancestor ?? head;
}

export async function resolveBuildSourceIdentity({
  root,
  environment = process.env,
  warn = console.warn,
}) {
  try {
    return await resolveBuildSourceCommit({ root });
  } catch (error) {
    if (environment.NODE_ENV === "production" || environment.CI === "true") {
      throw new Error(
        "Production or CI build source cannot be verified. Build a clean checkout of the merged release candidate with its Git metadata.",
        { cause: error },
      );
    }
    warn(
      "Build source identity unavailable: this development build cannot pass deployment verification.",
    );
    return null;
  }
}
