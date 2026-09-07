import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { promisify } from "node:util";
import {
  resolveBuildSourceCommit,
  resolveBuildSourceIdentity,
} from "./build-source-identity.mjs";

const execFileAsync = promisify(execFile);
const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function repository() {
  const root = await mkdtemp(join(tmpdir(), "bidbox-build-source-"));
  temporaryDirectories.push(root);
  const git = async (...args) => {
    const { stdout } = await execFileAsync(
      "git",
      [
        "-c",
        "user.name=Build identity test",
        "-c",
        "user.email=build-identity@example.invalid",
        "-c",
        "commit.gpgsign=false",
        ...args,
      ],
      { cwd: root, encoding: "utf8", windowsHide: true },
    );
    return stdout.trim();
  };
  await git("init", "--initial-branch=main");
  await writeFile(join(root, "source.txt"), "reviewed source\n");
  await git("add", "source.txt");
  await git("commit", "-m", "Reviewed source");
  const source = await git("rev-parse", "HEAD");
  await git("update-ref", "refs/remotes/origin/main", source);
  return { root, git, source };
}

describe("build source identity", () => {
  it("refuses unverifiable production and candidate builds while leaving development unstamped", async () => {
    const { root } = await repository();
    await writeFile(join(root, "source.txt"), "uncommitted build input\n");
    for (const environment of [
      { NODE_ENV: "production" },
      { CI: "true" },
      { NODE_ENV: "development", CI: "true" },
    ]) {
      await assert.rejects(
        () => resolveBuildSourceIdentity({ root, environment }),
        /Production or CI build source cannot be verified/u,
      );
    }
    const warnings = [];
    assert.equal(
      await resolveBuildSourceIdentity({
        root,
        environment: { NODE_ENV: "development" },
        warn: (message) => warnings.push(message),
      }),
      null,
    );
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /cannot pass deployment verification/u);
  });

  it("resolves committed source and proven empty provider publication commits", async () => {
    const { root, git, source } = await repository();
    assert.equal(await resolveBuildSourceCommit({ root }), source);
    await git("commit", "--allow-empty", "-m", "Provider publication");
    assert.notEqual(await git("rev-parse", "HEAD"), source);
    assert.equal(await resolveBuildSourceCommit({ root }), source);
    await git("update-ref", "refs/remotes/upstream/main", source);
    await git("update-ref", "-d", "refs/remotes/origin/main");
    assert.equal(await resolveBuildSourceCommit({ root }), source);
  });

  it("does not label a changed provider snapshot as its main ancestor", async () => {
    const { root, git, source } = await repository();
    await writeFile(join(root, "source.txt"), "changed provider source\n");
    await git("add", "source.txt");
    await git("commit", "-m", "Changed source");
    const actualHead = await git("rev-parse", "HEAD");
    assert.notEqual(actualHead, source);
    assert.equal(await resolveBuildSourceCommit({ root }), actualHead);
  });

  it("rejects dirty tracked source and uncommitted new build inputs", async () => {
    const { root, git } = await repository();
    await writeFile(join(root, "source.txt"), "uncommitted change\n");
    await assert.rejects(
      () => resolveBuildSourceCommit({ root }),
      /clean committed source/u,
    );
    await git("add", "source.txt");
    await assert.rejects(
      () => resolveBuildSourceCommit({ root }),
      /clean committed source/u,
    );
    await git("commit", "-m", "Reviewed change");
    await writeFile(join(root, "new-source.txt"), "new build input\n");
    await assert.rejects(
      () => resolveBuildSourceCommit({ root }),
      /including new files/u,
    );
  });

  it("uses exact HEAD when no main ancestor is available", async () => {
    const { root, git, source } = await repository();
    await git("update-ref", "-d", "refs/remotes/origin/main");
    assert.equal(await resolveBuildSourceCommit({ root }), source);
    const noGit = await mkdtemp(join(tmpdir(), "bidbox-no-git-"));
    temporaryDirectories.push(noGit);
    await assert.rejects(() => resolveBuildSourceCommit({ root: noGit }));
  });
});
