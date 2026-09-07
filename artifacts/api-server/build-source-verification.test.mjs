import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { promisify } from "node:util";
import { build } from "esbuild";
import { verifyCommittedBuildInputs } from "./build-source-verification.mjs";

const execFileAsync = promisify(execFile);
const directories = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "bidbox-build-inputs-"));
  directories.push(root);
  const git = async (...args) => {
    const { stdout } = await execFileAsync(
      "git",
      [
        "-c",
        "user.name=Build input test",
        "-c",
        "user.email=build-inputs@example.invalid",
        "-c",
        "commit.gpgsign=false",
        ...args,
      ],
      { cwd: root, encoding: "utf8", windowsHide: true },
    );
    return stdout.trim();
  };
  await git("init", "--initial-branch=main");
  await mkdir(join(root, "src"));
  await writeFile(join(root, ".gitattributes"), "* text=auto eol=lf\n");
  await writeFile(join(root, ".gitignore"), "node_modules\nsrc/shadow.tsx\n");
  await writeFile(
    join(root, "src", "main.ts"),
    "export { source } from './shadow';\n",
  );
  await writeFile(
    join(root, "src", "shadow.ts"),
    "export const source = 'reviewed';\n",
  );
  await writeFile(
    join(root, "build.mjs"),
    "// committed build configuration\n",
  );
  await git("add", ".");
  await git("commit", "-m", "Reviewed source");
  const sourceCommitSha = await git("rev-parse", "HEAD");
  const verify = (metafile) =>
    verifyCommittedBuildInputs({
      root,
      sourceCommitSha,
      metafile,
      extraInputs: ["build.mjs", ".gitattributes"],
    });
  const bundle = () =>
    build({
      absWorkingDir: root,
      entryPoints: ["src/main.ts"],
      bundle: true,
      write: false,
      metafile: true,
      platform: "node",
      format: "esm",
    });
  return { root, git, sourceCommitSha, verify, bundle };
}

test("validates clean esbuild inputs and build configuration against committed blobs", async () => {
  const { root, verify, bundle } = await fixture();
  await mkdir(join(root, "node_modules", "example"), { recursive: true });
  await writeFile(
    join(root, "node_modules", "example", "index.js"),
    "module.exports = 1;\n",
  );
  const { metafile } = await bundle();
  metafile.inputs["node_modules/example/index.js"] = { bytes: 20, imports: [] };
  assert.deepEqual(await verify(metafile), { verifiedApplicationInputs: 4 });
});

test("rejects ignored TSX source that esbuild resolves ahead of the tracked TS file", async () => {
  const { root, git, verify, bundle } = await fixture();
  await writeFile(
    join(root, "src", "shadow.tsx"),
    "export const source = 'unreviewed';\n",
  );
  assert.equal(await git("status", "--porcelain=v1"), "");
  const { metafile } = await bundle();
  assert.ok(Object.hasOwn(metafile.inputs, "src/shadow.tsx"));
  await assert.rejects(
    () => verify(metafile),
    /not a committed regular file: src\/shadow\.tsx/u,
  );
});

test("accepts an identical ancestor tree after an empty provider publication commit", async () => {
  const { git, sourceCommitSha, verify, bundle } = await fixture();
  await git("commit", "--allow-empty", "-m", "Provider publication");
  assert.notEqual(await git("rev-parse", "HEAD"), sourceCommitSha);
  assert.deepEqual(await verify((await bundle()).metafile), {
    verifiedApplicationInputs: 4,
  });
});

for (const flag of ["--assume-unchanged", "--skip-worktree"]) {
  test(`rejects changed source hidden from git status by ${flag}`, async () => {
    const { root, git, verify, bundle } = await fixture();
    await git("update-index", flag, "src/shadow.ts");
    await writeFile(
      join(root, "src", "shadow.ts"),
      "export const source = 'unreviewed';\n",
    );
    assert.equal(await git("status", "--porcelain=v1"), "");
    await assert.rejects(
      () => bundle().then(({ metafile }) => verify(metafile)),
      /differs from committed source: src\/shadow\.ts/u,
    );
  });
}

test("checks build scripts even when they are not esbuild application inputs", async () => {
  const { root, git, verify, bundle } = await fixture();
  await git("update-index", "--assume-unchanged", "build.mjs");
  await writeFile(
    join(root, "build.mjs"),
    "// unreviewed build configuration\n",
  );
  assert.equal(await git("status", "--porcelain=v1"), "");
  await assert.rejects(
    () => bundle().then(({ metafile }) => verify(metafile)),
    /differs from committed source: build\.mjs/u,
  );
});

test("accepts repository-normalized CRLF while checking actual file contents", async () => {
  const { root, verify, bundle } = await fixture();
  await writeFile(
    join(root, "src", "shadow.ts"),
    "export const source = 'reviewed';\r\n",
  );
  assert.deepEqual(await verify((await bundle()).metafile), {
    verifiedApplicationInputs: 4,
  });
});

test("rejects non-dependency inputs outside the committed repository", async () => {
  const { root, sourceCommitSha } = await fixture();
  const outside = await mkdtemp(join(tmpdir(), "bidbox-outside-input-"));
  directories.push(outside);
  const input = join(outside, "source.ts");
  await writeFile(input, "export const outside = true;\n");
  await assert.rejects(
    () =>
      verifyCommittedBuildInputs({
        root,
        sourceCommitSha,
        metafile: { inputs: { [input]: { bytes: 29, imports: [] } } },
      }),
    /outside committed source/u,
  );
});
