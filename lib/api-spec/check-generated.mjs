import { spawnSync } from "node:child_process";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

export const GENERATED_TREE_PATHS = [
  path.join("lib", "api-client-react", "src", "generated"),
  path.join("lib", "api-zod", "src", "generated"),
];

const apiSpecDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(apiSpecDirectory, "..", "..");

function relativeName(treePath, filePath) {
  return path.join(treePath, filePath).split(path.sep).join("/");
}

async function readTree(directory) {
  const files = new Map();

  async function visit(currentDirectory, relativeDirectory = "") {
    const entries = await readdir(currentDirectory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const absolutePath = path.join(currentDirectory, entry.name);
      const relativePath = path.join(relativeDirectory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath, relativePath);
        continue;
      }
      if (!entry.isFile()) {
        throw new Error(
          `Generated tree contains a non-regular entry: ${absolutePath}`,
        );
      }
      files.set(relativePath, await readFile(absolutePath));
    }
  }

  const metadata = await lstat(directory);
  if (!metadata.isDirectory()) {
    throw new Error(`Generated tree is not a directory: ${directory}`);
  }
  await visit(directory);
  return files;
}

export async function snapshotGeneratedTrees(root) {
  const snapshot = new Map();
  for (const treePath of GENERATED_TREE_PATHS) {
    const files = await readTree(path.resolve(root, treePath));
    for (const [name, contents] of files) {
      snapshot.set(relativeName(treePath, name), Buffer.from(contents));
    }
  }
  return snapshot;
}

export function compareSnapshots(before, after) {
  const differences = [];
  const names = [...before.keys(), ...after.keys()]
    .filter((name, index, all) => all.indexOf(name) === index)
    .sort();
  for (const name of names) {
    const original = before.get(name);
    const current = after.get(name);
    if (original === undefined) {
      differences.push({ kind: "added", file: name });
    } else if (current === undefined) {
      differences.push({ kind: "deleted", file: name });
    } else if (!original.equals(current)) {
      differences.push({ kind: "mutated", file: name });
    }
  }
  return differences;
}

export async function compareGeneratedTrees(canonicalRoot, regeneratedRoot) {
  const differences = [];

  for (const treePath of GENERATED_TREE_PATHS) {
    const [canonicalFiles, regeneratedFiles] = await Promise.all([
      readTree(path.resolve(canonicalRoot, treePath)),
      readTree(path.resolve(regeneratedRoot, treePath)),
    ]);
    const names = [...canonicalFiles.keys(), ...regeneratedFiles.keys()]
      .filter((name, index, all) => all.indexOf(name) === index)
      .sort();

    for (const name of names) {
      const canonical = canonicalFiles.get(name);
      const regenerated = regeneratedFiles.get(name);
      const file = relativeName(treePath, name);
      if (canonical === undefined) {
        differences.push({ kind: "missing-canonical", file });
      } else if (regenerated === undefined) {
        differences.push({ kind: "obsolete-canonical", file });
      } else if (!canonical.equals(regenerated)) {
        differences.push({ kind: "content-drift", file });
      }
    }
  }

  return differences;
}

function resolveOrvalBin() {
  const require = createRequire(import.meta.url);
  const packageJsonPath = require.resolve("orval/package.json");
  const packageJson = JSON.parse(
    require("node:fs").readFileSync(packageJsonPath, "utf8"),
  );
  const bin =
    typeof packageJson.bin === "string"
      ? packageJson.bin
      : packageJson.bin?.orval;
  if (typeof bin !== "string" || bin.length === 0) {
    throw new Error(
      "The installed Orval package does not declare an Orval CLI.",
    );
  }
  return path.resolve(path.dirname(packageJsonPath), bin);
}

function runNode(entryPoint, args, environment, label) {
  const result = spawnSync(process.execPath, [entryPoint, ...args], {
    cwd: apiSpecDirectory,
    env: environment,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${label} failed with exit code ${result.status ?? "unknown"}.`,
    );
  }
}

export async function checkGeneratedArtifacts() {
  const canonicalBefore = await snapshotGeneratedTrees(repositoryRoot);
  const scratchDirectory = path.resolve(repositoryRoot, "tmp");
  await mkdir(scratchDirectory, { recursive: true });
  let temporaryRoot;

  try {
    temporaryRoot = await mkdtemp(
      path.join(scratchDirectory, "bidbox-codegen-check-"),
    );
    const temporaryMutatorDirectory = path.resolve(
      temporaryRoot,
      "lib",
      "api-client-react",
      "src",
    );
    const environment = {
      ...process.env,
      BIDBOX_CODEGEN_OUTPUT_ROOT: temporaryRoot,
      BIDBOX_CODEGEN_MUTATOR_PATH: path.resolve(
        temporaryMutatorDirectory,
        "custom-fetch.ts",
      ),
    };

    await mkdir(temporaryRoot, { recursive: true });
    await mkdir(temporaryMutatorDirectory, { recursive: true });
    const canonicalCustomFetch = await readFile(
      path.resolve(
        repositoryRoot,
        "lib",
        "api-client-react",
        "src",
        "custom-fetch.ts",
      ),
      "utf8",
    );
    await writeFile(
      path.resolve(temporaryMutatorDirectory, "custom-fetch.ts"),
      canonicalCustomFetch.replaceAll("\r\n", "\n"),
      "utf8",
    );

    runNode(
      resolveOrvalBin(),
      ["--config", path.resolve(apiSpecDirectory, "orval.config.ts")],
      environment,
      "Orval generation",
    );
    runNode(
      path.resolve(apiSpecDirectory, "patch-generated-client.mjs"),
      [],
      environment,
      "Generated-client patching",
    );

    const differences = await compareGeneratedTrees(
      repositoryRoot,
      temporaryRoot,
    );
    if (differences.length > 0) {
      const labels = {
        "missing-canonical": "not checked in",
        "obsolete-canonical": "no longer generated",
        "content-drift": "content differs",
      };
      const detail = differences
        .map(({ kind, file }) => `- ${file} (${labels[kind]})`)
        .join("\n");
      throw new Error(
        `Generated artifacts are stale (${differences.length} difference(s)):\n${detail}`,
      );
    }

    console.log(
      `Generated artifacts match a clean, isolated regeneration (${GENERATED_TREE_PATHS.length} trees).`,
    );
  } finally {
    if (temporaryRoot) {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
    const canonicalAfter = await snapshotGeneratedTrees(repositoryRoot);
    const canonicalMutations = compareSnapshots(
      canonicalBefore,
      canonicalAfter,
    );
    if (canonicalMutations.length > 0) {
      const detail = canonicalMutations
        .map(({ kind, file }) => `- ${file} (${kind})`)
        .join("\n");
      throw new Error(
        `Hermetic code generation mutated canonical outputs:\n${detail}`,
      );
    }
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;
if (invokedPath === import.meta.url) {
  await checkGeneratedArtifacts();
}
