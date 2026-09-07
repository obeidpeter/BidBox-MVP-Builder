import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  compareSnapshots,
  compareGeneratedTrees,
  GENERATED_TREE_PATHS,
} from "./check-generated.mjs";

test("canonical snapshot comparison detects mutations before a false parity result", () => {
  const before = new Map([
    ["generated/changed.ts", Buffer.from("before\n")],
    ["generated/deleted.ts", Buffer.from("deleted\n")],
  ]);
  const after = new Map([
    ["generated/changed.ts", Buffer.from("after\n")],
    ["generated/added.ts", Buffer.from("added\n")],
  ]);

  assert.deepEqual(compareSnapshots(before, after), [
    { kind: "added", file: "generated/added.ts" },
    { kind: "mutated", file: "generated/changed.ts" },
    { kind: "deleted", file: "generated/deleted.ts" },
  ]);
});

async function writeGeneratedFile(root, tree, name, contents) {
  const directory = path.resolve(root, tree);
  await mkdir(path.dirname(path.resolve(directory, name)), { recursive: true });
  await writeFile(path.resolve(directory, name), contents);
}

test("the generated-tree comparator detects additions, deletions, and byte drift", async (t) => {
  const fixtureRoot = await mkdtemp(
    path.join(os.tmpdir(), "bidbox-codegen-test-"),
  );
  t.after(() => rm(fixtureRoot, { recursive: true, force: true }));
  const canonicalRoot = path.join(fixtureRoot, "canonical");
  const regeneratedRoot = path.join(fixtureRoot, "regenerated");

  for (const tree of GENERATED_TREE_PATHS) {
    await writeGeneratedFile(canonicalRoot, tree, "same.ts", "same\n");
    await writeGeneratedFile(regeneratedRoot, tree, "same.ts", "same\n");
  }
  await writeGeneratedFile(
    canonicalRoot,
    GENERATED_TREE_PATHS[0],
    "changed.ts",
    "before\n",
  );
  await writeGeneratedFile(
    regeneratedRoot,
    GENERATED_TREE_PATHS[0],
    "changed.ts",
    "after\n",
  );
  await writeGeneratedFile(
    canonicalRoot,
    GENERATED_TREE_PATHS[0],
    "obsolete.ts",
    "obsolete\n",
  );
  await writeGeneratedFile(
    regeneratedRoot,
    GENERATED_TREE_PATHS[1],
    path.join("types", "new.ts"),
    "new\n",
  );

  assert.deepEqual(
    await compareGeneratedTrees(canonicalRoot, regeneratedRoot),
    [
      {
        kind: "content-drift",
        file: "lib/api-client-react/src/generated/changed.ts",
      },
      {
        kind: "obsolete-canonical",
        file: "lib/api-client-react/src/generated/obsolete.ts",
      },
      {
        kind: "missing-canonical",
        file: "lib/api-zod/src/generated/types/new.ts",
      },
    ],
  );
});

test("Orval and the deterministic patcher share the isolated output-root contract", async () => {
  const directory = path.dirname(fileURLToPath(import.meta.url));
  const [config, patcher] = await Promise.all([
    readFile(path.join(directory, "orval.config.ts"), "utf8"),
    readFile(path.join(directory, "patch-generated-client.mjs"), "utf8"),
  ]);

  assert.match(config, /process\.env\.BIDBOX_CODEGEN_OUTPUT_ROOT/u);
  assert.match(patcher, /process\.env\.BIDBOX_CODEGEN_OUTPUT_ROOT/u);
});
