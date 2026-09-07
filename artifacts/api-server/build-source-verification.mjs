import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const COMMIT_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

async function git(root, args) {
  const { stdout } = await execFileAsync("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  return stdout;
}

function inside(root, path) {
  const name = relative(root, path);
  return name !== ".." && !name.startsWith(`..${sep}`) && !isAbsolute(name);
}

function dependencyPath(path) {
  return path.split(/[\\/]/u).includes("node_modules");
}

/**
 * Git status omits ignored imports and can trust assume-unchanged index flags.
 * Verify the actual application files selected by esbuild against committed
 * blobs independently of those flags. Dependency bytes remain governed by the
 * frozen package install and artifact manifest, not this source-only stamp.
 * extraInputs are repository-relative build scripts/configuration that esbuild
 * executes or consumes without listing them in its application input metafile.
 */
export async function verifyCommittedBuildInputs({
  root,
  metafile,
  absWorkingDir = root,
  sourceCommitSha,
  extraInputs = [],
}) {
  assert.match(sourceCommitSha, COMMIT_SHA, "Build input source must be exact");
  assert.ok(
    metafile?.inputs && typeof metafile.inputs === "object",
    "Build input metafile is required",
  );
  const repositoryRoot = await realpath(root);
  const tree = await git(repositoryRoot, [
    "ls-tree",
    "-r",
    "-z",
    sourceCommitSha,
  ]);
  const committed = new Map(
    tree
      .split("\0")
      .filter(Boolean)
      .map((record) => {
        const match = /^(\d+) blob ([0-9a-f]+)\t([\s\S]+)$/u.exec(record);
        return match
          ? [match[3], { mode: match[1], oid: match[2] }]
          : ["", null];
      }),
  );
  const inputs = new Map([
    ...Object.keys(metafile.inputs).map((name) => [
      resolve(absWorkingDir, name),
      false,
    ]),
    ...extraInputs.map((name) => [resolve(repositoryRoot, name), true]),
  ]);
  const checkedPaths = new Map();
  for (const [input, required] of inputs) {
    const physical = await realpath(input);
    // Resolve workspace links before excluding third-party dependencies: an
    // @workspace package reached through node_modules is still project source.
    if (!required && dependencyPath(physical)) continue;
    assert.ok(
      inside(repositoryRoot, physical),
      `Build input is outside committed source: ${input}`,
    );
    const sourcePath = relative(repositoryRoot, physical).split(sep).join("/");
    const entry = committed.get(sourcePath);
    assert.ok(
      entry && ["100644", "100755"].includes(entry.mode),
      `Build input is not a committed regular file: ${sourcePath}`,
    );
    assert.ok(
      (await lstat(input)).isFile(),
      `Build input is not a regular file: ${sourcePath}`,
    );
    checkedPaths.set(sourcePath, entry.oid);
  }
  assert.ok(
    checkedPaths.size > 0,
    "No committed application build inputs were verified",
  );
  // hash-object reads current bytes even when the index says assume-unchanged
  // or skip-worktree. Git's path-based clean conversion handles repository EOL
  // rules, so a normal Windows CRLF checkout is compared with its LF blob.
  const paths = [...checkedPaths.keys()];
  for (let offset = 0; offset < paths.length; offset += 64) {
    const batch = paths.slice(offset, offset + 64);
    const hashes = (await git(repositoryRoot, ["hash-object", "--", ...batch]))
      .trim()
      .split(/\r?\n/u);
    assert.equal(hashes.length, batch.length, "Build input hash count differs");
    batch.forEach((path, index) => {
      assert.equal(
        hashes[index],
        checkedPaths.get(path),
        `Build input differs from committed source: ${path}`,
      );
    });
  }
  return { verifiedApplicationInputs: checkedPaths.size };
}
