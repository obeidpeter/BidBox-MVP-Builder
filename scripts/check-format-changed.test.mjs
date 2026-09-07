import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const scriptPath = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/(.:)/u, "$1")),
  "check-format-changed.mjs",
);

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

test("local formatting fallback includes staged, unstaged, and untracked files", async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "bidbox-format-check-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  git(cwd, ["init", "--quiet"]);
  git(cwd, ["config", "user.email", "test@example.invalid"]);
  git(cwd, ["config", "user.name", "Test"]);

  await Promise.all([
    writeFile(path.join(cwd, "staged.mjs"), "export const staged = true;\n"),
    writeFile(
      path.join(cwd, "unstaged.mjs"),
      "export const unstaged = true;\n",
    ),
  ]);
  git(cwd, ["add", "."]);
  git(cwd, ["commit", "--quiet", "-m", "fixture"]);

  await writeFile(path.join(cwd, "staged.mjs"), "export const staged=false\n");
  git(cwd, ["add", "staged.mjs"]);
  await writeFile(
    path.join(cwd, "unstaged.mjs"),
    "export const unstaged=false\n",
  );
  await writeFile(
    path.join(cwd, "untracked.mjs"),
    "export const fresh=false\n",
  );

  assert.throws(
    () =>
      execFileSync(process.execPath, [scriptPath], {
        cwd,
        env: { ...process.env, FORMAT_BASE_SHA: "" },
        encoding: "utf8",
        stdio: "pipe",
      }),
    (error) => {
      const stderr = error.stderr?.toString() ?? "";
      assert.match(stderr, /staged\.mjs/u);
      assert.match(stderr, /unstaged\.mjs/u);
      assert.match(stderr, /untracked\.mjs/u);
      return true;
    },
  );
});
