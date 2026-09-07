import assert from "node:assert/strict";
import { lstat, readFile, readdir } from "node:fs/promises";
import { extname, isAbsolute, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  importedSpecifiers,
  explicitNonOpenApiClassification,
  literalRuntimePolicyIds,
  parseOpenApiOperations,
  parseWorkspaceAliasRules,
  routePrefixMatches,
  resolveAliasTarget,
  workspaceDependencies,
} from "./architecture-source-imports.mjs";

export { parseOpenApiOperations };

export const REQUIRED_ARCHITECTURE_DOCUMENTS = Object.freeze([
  "docs/architecture/README.md",
  "docs/architecture/CONTEXT.md",
  "docs/architecture/CONTAINERS.md",
  "docs/architecture/COMPONENTS.md",
  "docs/architecture/DEPLOYMENT.md",
  "docs/architecture/DYNAMIC_FLOWS.md",
  "docs/architecture/COMPONENT_MAP.md",
  "docs/architecture/GLOSSARY.md",
  "docs/architecture/QUALITY_ATTRIBUTES.md",
  "docs/architecture/RISK_REGISTER.md",
]);

export const REQUIRED_ARCHITECTURE_CONFIGS = Object.freeze([
  "config/architecture/drivers.v1.json",
  "config/architecture/module-boundaries.v1.json",
  "config/architecture/route-policies.v1.json",
  "config/architecture/risks.v1.json",
]);

const ADR_DIRECTORY = "docs/implementation-v2.5/adrs";
const OPENAPI_PATH = "lib/api-spec/openapi.yaml";
const RUNTIME_ROUTE_POLICY_PATH =
  "artifacts/api-server/src/lib/projectRoutePolicy.ts";
const MAX_TEXT_BYTES = 4 * 1024 * 1024;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_.:/-]{2,159}$/u;
const ADR_ID = /^ADR-\d{4}$/u;
const DRIVER_ID = /^AD-\d{3}$/u;
const RISK_ID = /^AR-\d{3}$/u;
const SOURCE_EXTENSIONS = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
]);
const MUTATING_HTTP_METHODS = new Set(["delete", "patch", "post", "put"]);
const HTTP_METHODS = new Set([
  "delete",
  "get",
  "head",
  "options",
  "patch",
  "post",
  "put",
  "trace",
]);
const SKIPPED_DIRECTORY_NAMES = new Set([
  ".git",
  ".turbo",
  "coverage",
  "dist",
  "node_modules",
]);

const DOCUMENT_CONTENT_REQUIREMENTS = Object.freeze({
  "docs/architecture/CONTEXT.md": ["system context", "person"],
  "docs/architecture/CONTAINERS.md": ["container", "responsibil"],
  "docs/architecture/COMPONENTS.md": ["component", "responsibil"],
  "docs/architecture/DEPLOYMENT.md": ["deployment", "trust"],
  "docs/architecture/DYNAMIC_FLOWS.md": ["sequenceDiagram"],
  "docs/architecture/COMPONENT_MAP.md": [
    "artifacts/api-server",
    "artifacts/bidbox-workbench",
    "lib/db",
    "lib/api-spec",
  ],
  "docs/architecture/QUALITY_ATTRIBUTES.md": [
    "stimulus",
    "environment",
    "response",
    "measure",
  ],
  "docs/architecture/RISK_REGISTER.md": [
    "owner",
    "likelihood",
    "impact",
    "mitigation",
  ],
});

const DIAGRAM_DOCUMENTS = new Set([
  "docs/architecture/CONTEXT.md",
  "docs/architecture/CONTAINERS.md",
  "docs/architecture/COMPONENTS.md",
  "docs/architecture/DEPLOYMENT.md",
  "docs/architecture/DYNAMIC_FLOWS.md",
]);

function assertRecord(value, label) {
  assert.ok(
    value && typeof value === "object" && !Array.isArray(value),
    `${label} must be an object`,
  );
  return value;
}

function meaningfulText(value, label, minimumLength = 2) {
  assert.equal(typeof value, "string", `${label} must be a string`);
  const trimmed = value.trim();
  assert.ok(trimmed.length >= minimumLength, `${label} must be meaningful`);
  return trimmed;
}

function canonicalIsoDate(value, label) {
  const text = meaningfulText(value, label);
  assert.match(text, ISO_DATE, `${label} must be a canonical ISO date`);
  const parsed = new Date(`${text}T00:00:00.000Z`);
  assert.equal(
    Number.isNaN(parsed.valueOf()),
    false,
    `${label} must be a real ISO date`,
  );
  assert.equal(
    parsed.toISOString().slice(0, 10),
    text,
    `${label} must be a real ISO date`,
  );
  return text;
}

function exactStringArray(value, label, { allowEmpty = false } = {}) {
  assert.ok(Array.isArray(value), `${label} must be an array`);
  if (!allowEmpty) assert.ok(value.length > 0, `${label} must not be empty`);
  const values = value.map((entry, index) =>
    meaningfulText(entry, `${label}[${index}]`),
  );
  assert.equal(
    new Set(values).size,
    values.length,
    `${label} must not contain duplicates`,
  );
  return values;
}

function repositoryPath(value, label) {
  const text = meaningfulText(value, label).replaceAll("\\", "/");
  assert.equal(isAbsolute(text), false, `${label} must be repository-relative`);
  assert.equal(text.includes("\0"), false, `${label} contains an invalid byte`);
  const normalized = posix.normalize(text);
  assert.ok(
    normalized !== ".." && !normalized.startsWith("../"),
    `${label} escapes the repository`,
  );
  assert.equal(normalized.startsWith("/"), false, `${label} must be relative`);
  return normalized.replace(/^\.\//u, "");
}

function insideRoot(root, path, label = path) {
  const normalized = repositoryPath(path, label);
  const target = resolve(root, ...normalized.split("/"));
  const relation = relative(resolve(root), target);
  assert.ok(
    relation === "" || (!relation.startsWith("..") && !isAbsolute(relation)),
    `${label} escapes the repository`,
  );
  return target;
}

async function readRegularText(root, path, maximumBytes = MAX_TEXT_BYTES) {
  const normalized = repositoryPath(path, `${path} path`);
  const target = insideRoot(root, normalized);
  const details = await lstat(target).catch(() => null);
  assert.ok(details, `${normalized} must exist`);
  assert.equal(
    details.isSymbolicLink(),
    false,
    `${normalized} must not be a symbolic link`,
  );
  assert.ok(details.isFile(), `${normalized} must be a regular file`);
  assert.ok(details.size > 0, `${normalized} must not be empty`);
  assert.ok(
    details.size <= maximumBytes,
    `${normalized} exceeds the architecture verification size limit`,
  );
  return readFile(target, "utf8");
}

async function readJson(root, path) {
  const source = await readRegularText(root, path);
  let value;
  try {
    value = JSON.parse(source);
  } catch (error) {
    assert.fail(`${path} must contain valid JSON: ${error.message}`);
  }
  return assertRecord(value, path);
}

function metadataSource(catalogue) {
  return catalogue.metadata &&
    typeof catalogue.metadata === "object" &&
    !Array.isArray(catalogue.metadata)
    ? { ...catalogue, ...catalogue.metadata }
    : catalogue;
}

export function validateCatalogueMetadata(catalogue, label) {
  const source = metadataSource(assertRecord(catalogue, label));
  assert.equal(source.schemaVersion, 1, `${label}.schemaVersion must be 1`);
  const catalogueId = meaningfulText(
    source.catalogueId ?? source.registryId ?? source.id,
    `${label}.catalogueId`,
    6,
  );
  assert.match(
    catalogueId,
    IDENTIFIER,
    `${label}.catalogueId has an invalid format`,
  );
  const lastReviewed = canonicalIsoDate(
    source.lastReviewed ?? source.lastReviewedOn,
    `${label}.lastReviewed`,
  );
  const sourceReviewedThrough = canonicalIsoDate(
    source.sourceReviewedThrough ??
      source.sourceReviewDate ??
      source.sourceReviewedOn,
    `${label}.sourceReviewedThrough`,
  );
  assert.ok(
    lastReviewed >= sourceReviewedThrough,
    `${label}.lastReviewed must not predate sourceReviewedThrough`,
  );
  return { catalogueId, lastReviewed, sourceReviewedThrough };
}

function stripMetadataDecoration(line) {
  let value = line.trim().replace(/^>\s*/u, "");
  if (value.startsWith("|") && value.endsWith("|")) {
    const cells = value
      .slice(1, -1)
      .split("|")
      .map((cell) => cell.trim().replaceAll("**", "").replaceAll("__", ""));
    if (cells.length >= 2) return `${cells[0]}: ${cells.slice(1).join(" | ")}`;
  }
  value = value.replaceAll("**", "").replaceAll("__", "");
  return value.replace(/^[-*]\s+/u, "");
}

export function parseArchitectureDocumentMetadata(source, label) {
  const fields = new Map();
  for (const line of source.split(/\r?\n/u).slice(0, 80)) {
    if (/^##\s+/u.test(line)) break;
    const match =
      /^(Current|Target|Deployed|Verified|Last reviewed)\s*:\s*(.+)$/iu.exec(
        stripMetadataDecoration(line),
      );
    if (!match) continue;
    const key = match[1].toLowerCase();
    assert.equal(
      fields.has(key),
      false,
      `${label} repeats ${match[1]} metadata`,
    );
    fields.set(key, meaningfulText(match[2], `${label} ${match[1]}`));
  }
  for (const required of [
    "current",
    "target",
    "deployed",
    "verified",
    "last reviewed",
  ]) {
    assert.ok(fields.has(required), `${label} is missing ${required} metadata`);
  }
  return {
    current: fields.get("current"),
    target: fields.get("target"),
    deployed: fields.get("deployed"),
    verified: fields.get("verified"),
    lastReviewed: canonicalIsoDate(
      fields.get("last reviewed"),
      `${label} Last reviewed`,
    ),
  };
}

function markdownFenceSummary(source, label) {
  let active = null;
  const mermaidBlocks = [];
  let activeLines = [];
  for (const [index, line] of source.split(/\r?\n/u).entries()) {
    const fence = /^\s*(`{3,}|~{3,})\s*([^\s`]*)?.*$/u.exec(line);
    if (!fence) {
      if (active?.language === "mermaid") activeLines.push(line);
      continue;
    }
    const marker = fence[1][0];
    if (!active) {
      active = {
        marker,
        length: fence[1].length,
        language: (fence[2] ?? "").toLowerCase(),
        line: index + 1,
      };
      activeLines = [];
      continue;
    }
    if (marker === active.marker && fence[1].length >= active.length) {
      if (active.language === "mermaid") {
        assert.ok(
          activeLines.join("\n").trim().length > 0,
          `${label} has an empty Mermaid fence at line ${active.line}`,
        );
        mermaidBlocks.push(activeLines.join("\n"));
      }
      active = null;
      activeLines = [];
      continue;
    }
    if (active.language === "mermaid") activeLines.push(line);
  }
  assert.equal(
    active,
    null,
    `${label} has an unclosed ${active?.language || "Markdown"} fence at line ${active?.line}`,
  );
  return { mermaidBlocks };
}

function markdownLinkTargets(source) {
  const targets = [];
  let fenced = false;
  let marker = null;
  for (const line of source.split(/\r?\n/u)) {
    const fence = /^\s*(`{3,}|~{3,})/u.exec(line);
    if (fence) {
      if (!fenced) {
        fenced = true;
        marker = fence[1][0];
      } else if (fence[1][0] === marker) {
        fenced = false;
        marker = null;
      }
      continue;
    }
    if (fenced) continue;
    const matcher = /!?\[[^\]]*\]\(([^)]+)\)/gu;
    for (const match of line.matchAll(matcher)) targets.push(match[1].trim());
  }
  return targets;
}

function localLinkPath(rawTarget) {
  let target = rawTarget.trim();
  if (target.startsWith("<")) {
    const close = target.indexOf(">");
    target = close === -1 ? target : target.slice(1, close);
  } else {
    target = target.split(/\s+/u)[0];
  }
  if (
    target === "" ||
    target.startsWith("#") ||
    target.startsWith("//") ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(target)
  ) {
    return null;
  }
  target = target.split("#", 1)[0].split("?", 1)[0];
  if (!target) return null;
  try {
    return decodeURIComponent(target);
  } catch {
    assert.fail(`Markdown link target ${rawTarget} is not valid URI text`);
  }
}

async function validateMarkdownLinks(root, path, source) {
  for (const rawTarget of markdownLinkTargets(source)) {
    const local = localLinkPath(rawTarget);
    if (!local) continue;
    const relativeTarget = repositoryPath(
      posix.join(posix.dirname(path), local.replaceAll("\\", "/")),
      `${path} Markdown link`,
    );
    const target = insideRoot(root, relativeTarget);
    const details = await lstat(target).catch(() => null);
    assert.ok(
      details && (details.isFile() || details.isDirectory()),
      `${path} has a broken Markdown link to ${local}`,
    );
    assert.equal(
      details.isSymbolicLink(),
      false,
      `${path} links to symbolic path ${local}`,
    );
  }
}

export async function validateArchitectureDocuments(
  root,
  { requiredDocuments = REQUIRED_ARCHITECTURE_DOCUMENTS } = {},
) {
  const documents = new Map();
  const metadata = new Map();
  let mermaidDiagramCount = 0;
  for (const rawPath of requiredDocuments) {
    const path = repositoryPath(rawPath, "architecture document path");
    const source = await readRegularText(root, path);
    const docMetadata = parseArchitectureDocumentMetadata(source, path);
    const fenceSummary = markdownFenceSummary(source, path);
    if (DIAGRAM_DOCUMENTS.has(path)) {
      assert.ok(
        fenceSummary.mermaidBlocks.length > 0,
        `${path} must contain at least one Mermaid architecture view`,
      );
    }
    if (path.endsWith("DYNAMIC_FLOWS.md")) {
      assert.ok(
        fenceSummary.mermaidBlocks.some((block) =>
          /\bsequenceDiagram\b/u.test(block),
        ),
        `${path} must contain a Mermaid sequenceDiagram`,
      );
    }
    for (const required of DOCUMENT_CONTENT_REQUIREMENTS[path] ?? []) {
      assert.ok(
        source.toLowerCase().includes(required.toLowerCase()),
        `${path} must describe ${required}`,
      );
    }
    await validateMarkdownLinks(root, path, source);
    documents.set(path, source);
    metadata.set(path, docMetadata);
    mermaidDiagramCount += fenceSummary.mermaidBlocks.length;
  }

  const guidebookPath = requiredDocuments.find((path) =>
    path.endsWith("docs/architecture/README.md"),
  );
  assert.ok(guidebookPath, "architecture guidebook README is required");
  const guidebook = documents.get(guidebookPath);
  for (const path of requiredDocuments) {
    if (path === guidebookPath) continue;
    assert.ok(
      guidebook.includes(posix.basename(path)),
      `${guidebookPath} must link the required ${posix.basename(path)} view`,
    );
  }
  for (const path of REQUIRED_ARCHITECTURE_CONFIGS) {
    assert.ok(
      guidebook.includes(path) || guidebook.includes(posix.basename(path)),
      `${guidebookPath} must identify ${path}`,
    );
  }
  return {
    documentCount: documents.size,
    mermaidDiagramCount,
    metadata,
  };
}

function frontMatterValue(source, key) {
  const match = new RegExp(`^${key}:\\s*(.+)$`, "imu").exec(source);
  return match?.[1]?.trim();
}

function adrReferences(value) {
  return value
    ? [...value.matchAll(/ADR-\d{4}/gu)].map((match) => match[0])
    : [];
}

export async function validateArchitectureDecisionRecords(
  root,
  { adrDirectory = ADR_DIRECTORY } = {},
) {
  const directory = insideRoot(root, adrDirectory);
  const entries = await readdir(directory, { withFileTypes: true }).catch(
    () => [],
  );
  const markdown = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .sort((left, right) => left.name.localeCompare(right.name));
  assert.ok(markdown.length > 0, `${adrDirectory} must contain ADRs`);
  const records = new Map();
  for (const entry of markdown) {
    const filenameMatch = /^(\d{4})-[a-z0-9][a-z0-9-]*\.md$/u.exec(entry.name);
    assert.ok(filenameMatch, `${entry.name} must use NNNN-kebab-case.md`);
    const path = `${adrDirectory}/${entry.name}`;
    const source = await readRegularText(root, path);
    const heading = /^#\s+(ADR-\d{4}):\s+\S.+$/mu.exec(source);
    assert.ok(heading, `${path} must start with an ADR-NNNN heading`);
    const id = heading[1];
    assert.equal(
      id,
      `ADR-${filenameMatch[1]}`,
      `${path} heading ID must match its filename`,
    );
    assert.equal(records.has(id), false, `${id} is duplicated`);
    const statusText = meaningfulText(
      frontMatterValue(source, "Status"),
      `${id} Status`,
    );
    const normalizedStatus = statusText.toLowerCase().split(/[;,(]/u)[0].trim();
    assert.ok(
      ["accepted", "deprecated", "proposed", "rejected", "superseded"].some(
        (status) => normalizedStatus.startsWith(status),
      ),
      `${id} has an invalid lifecycle Status`,
    );
    canonicalIsoDate(
      frontMatterValue(source, "Decision date") ??
        frontMatterValue(source, "Date"),
      `${id} Decision date`,
    );
    const lastReviewed = canonicalIsoDate(
      frontMatterValue(source, "Last reviewed"),
      `${id} Last reviewed`,
    );
    const nextReview = canonicalIsoDate(
      frontMatterValue(source, "Next review"),
      `${id} Next review`,
    );
    assert.ok(
      nextReview >= lastReviewed,
      `${id} Next review must not predate Last reviewed`,
    );
    meaningfulText(frontMatterValue(source, "Owner"), `${id} Owner`, 3);
    meaningfulText(
      frontMatterValue(source, "Backup owner"),
      `${id} Backup owner`,
      3,
    );
    meaningfulText(frontMatterValue(source, "Reviewers"), `${id} Reviewers`, 3);
    const drivers = exactStringArray(
      frontMatterValue(source, "Drivers")
        ?.split(/[;,]/u)
        .map((value) => value.trim().replaceAll("`", ""))
        .filter(Boolean) ?? [],
      `${id} Drivers`,
    );
    const evidence = exactStringArray(
      frontMatterValue(source, "Evidence")
        ?.split(";")
        .map((value) => value.trim().replaceAll("`", ""))
        .filter(Boolean) ?? [],
      `${id} Evidence`,
    );
    for (const section of ["Context", "Decision", "Consequences", "Rejected"]) {
      assert.match(
        source,
        new RegExp(`^##\\s+${section}\\b`, "mu"),
        `${id} must document ${section}`,
      );
    }
    const supersedesValue = meaningfulText(
      frontMatterValue(source, "Supersedes"),
      `${id} Supersedes`,
    );
    const supersededByValue = meaningfulText(
      frontMatterValue(source, "Superseded by"),
      `${id} Superseded by`,
    );
    const supersedes = adrReferences(supersedesValue);
    const supersededBy = adrReferences(supersededByValue);
    if (normalizedStatus.startsWith("superseded")) {
      assert.equal(
        supersededBy.length,
        1,
        `${id} with Superseded status must name exactly one successor`,
      );
    } else {
      assert.equal(
        supersededBy.length,
        0,
        `${id} names a successor but is not Superseded`,
      );
    }
    records.set(id, {
      id,
      path,
      normalizedStatus,
      supersedes,
      supersededBy,
      drivers,
      evidence,
      lastReviewed,
      nextReview,
    });
  }
  for (const record of records.values()) {
    for (const reference of [...record.supersedes, ...record.supersededBy]) {
      assert.notEqual(
        reference,
        record.id,
        `${record.id} cannot reference itself`,
      );
      assert.ok(
        records.has(reference),
        `${record.id} references missing ${reference}`,
      );
    }
    for (const previous of record.supersedes) {
      const predecessor = records.get(previous);
      assert.ok(
        predecessor.normalizedStatus.startsWith("superseded"),
        `${record.id} supersedes ${previous}, but ${previous} is not Superseded`,
      );
      assert.deepEqual(
        predecessor.supersededBy,
        [record.id],
        `${previous} must name ${record.id} as its successor`,
      );
    }
  }
  return { adrCount: records.size, records };
}

function catalogueArray(catalogue, keys, label) {
  for (const key of keys) {
    if (Array.isArray(catalogue[key])) return catalogue[key];
  }
  assert.fail(`${label} must define ${keys.join(" or ")}`);
}

export function validateArchitectureDrivers(catalogue) {
  const metadata = validateCatalogueMetadata(catalogue, "architecture drivers");
  const drivers = catalogueArray(
    catalogue,
    ["drivers", "architectureDrivers"],
    "architecture drivers",
  );
  assert.ok(drivers.length > 0, "architecture drivers must not be empty");
  const ids = new Set();
  const categories = new Set();
  const normalized = drivers.map((raw, index) => {
    const driver = assertRecord(raw, `drivers[${index}]`);
    const id = meaningfulText(driver.id, `drivers[${index}].id`);
    assert.match(id, DRIVER_ID, `${id} must use the AD-NNN driver format`);
    assert.equal(
      ids.has(id),
      false,
      `${id} is a duplicate architecture driver`,
    );
    ids.add(id);
    const category = meaningfulText(
      driver.category ?? driver.type,
      `${id}.category`,
    ).toLowerCase();
    const categoryAliases = {
      quality: "quality_attribute",
      quality_attribute: "quality_attribute",
      qualityattribute: "quality_attribute",
      functional: "functional",
      constraint: "constraint",
      principle: "principle",
      architectural_principle: "principle",
    };
    const normalizedCategory = categoryAliases[category];
    assert.ok(normalizedCategory, `${id} has an invalid driver category`);
    categories.add(normalizedCategory);
    meaningfulText(driver.title ?? driver.name, `${id}.title`, 6);
    meaningfulText(driver.owner, `${id}.owner`, 3);
    meaningfulText(driver.priority, `${id}.priority`);
    meaningfulText(driver.status, `${id}.status`);
    const evidence = exactStringArray(
      driver.evidence ?? driver.verification ?? [],
      `${id}.evidence`,
    );
    const decisionRefs = exactStringArray(
      driver.decisionRefs ?? driver.adrRefs ?? [],
      `${id}.decisionRefs`,
      { allowEmpty: true },
    );
    for (const reference of decisionRefs) {
      assert.match(
        reference,
        ADR_ID,
        `${id} has invalid ADR reference ${reference}`,
      );
    }
    return { id, category: normalizedCategory, evidence, decisionRefs };
  });
  assert.deepEqual(
    categories,
    new Set(["functional", "quality_attribute", "constraint", "principle"]),
    "architecture drivers must cover functional, quality attribute, constraint and principle categories",
  );
  return { metadata, drivers: normalized, ids };
}

export function validateArchitectureRisks(catalogue, driverIds) {
  const metadata = validateCatalogueMetadata(catalogue, "architecture risks");
  const risks = catalogueArray(catalogue, ["risks"], "architecture risks");
  assert.ok(risks.length > 0, "architecture risks must not be empty");
  const ids = new Set();
  const normalized = risks.map((raw, index) => {
    const risk = assertRecord(raw, `risks[${index}]`);
    const id = meaningfulText(risk.id, `risks[${index}].id`);
    assert.match(id, RISK_ID, `${id} must use the AR-NNN risk format`);
    assert.equal(ids.has(id), false, `${id} is a duplicate architecture risk`);
    ids.add(id);
    meaningfulText(risk.title ?? risk.name, `${id}.title`, 6);
    meaningfulText(risk.owner, `${id}.owner`, 3);
    meaningfulText(risk.likelihood, `${id}.likelihood`);
    meaningfulText(risk.impact, `${id}.impact`);
    const status = meaningfulText(risk.status, `${id}.status`).toLowerCase();
    assert.ok(
      ["accepted", "closed", "mitigating", "monitoring", "open"].includes(
        status,
      ),
      `${id}.status is invalid`,
    );
    meaningfulText(risk.mitigation, `${id}.mitigation`, 12);
    const linkedDrivers = exactStringArray(
      risk.driverIds ?? risk.drivers,
      `${id}.driverIds`,
    );
    for (const driverId of linkedDrivers) {
      assert.ok(
        driverIds.has(driverId),
        `${id} references missing ${driverId}`,
      );
    }
    const evidence = exactStringArray(risk.evidence ?? [], `${id}.evidence`, {
      allowEmpty: status !== "closed",
    });
    const reviewBy = canonicalIsoDate(
      risk.reviewBy ?? risk.nextReview,
      `${id}.reviewBy`,
    );
    assert.ok(
      reviewBy >= metadata.lastReviewed,
      `${id}.reviewBy must not predate the risk catalogue review`,
    );
    if (status === "accepted") {
      const acceptance = assertRecord(
        risk.acceptance,
        `${id}.acceptance for an accepted risk`,
      );
      meaningfulText(acceptance.acceptedBy, `${id}.acceptance.acceptedBy`, 3);
      meaningfulText(acceptance.rationale, `${id}.acceptance.rationale`, 12);
      canonicalIsoDate(acceptance.expiresOn, `${id}.acceptance.expiresOn`);
    }
    return { id, status, linkedDrivers, evidence, reviewBy };
  });
  return { metadata, risks: normalized, ids };
}

async function walkFiles(root, relativeDirectory) {
  const normalized = repositoryPath(relativeDirectory, "source root");
  const absoluteDirectory = insideRoot(root, normalized);
  const details = await lstat(absoluteDirectory).catch(() => null);
  assert.ok(details?.isDirectory(), `${normalized} must be a source directory`);
  assert.equal(
    details.isSymbolicLink(),
    false,
    `${normalized} must not be a symlink`,
  );
  const files = [];
  async function visit(absolute, relativePath) {
    const entries = await readdir(absolute, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (SKIPPED_DIRECTORY_NAMES.has(entry.name)) continue;
      if (entry.isSymbolicLink()) {
        assert.fail(
          `${relativePath}/${entry.name} must not be a symbolic link`,
        );
      }
      const childRelative = `${relativePath}/${entry.name}`.replace(/^\//u, "");
      const childAbsolute = resolve(absolute, entry.name);
      if (entry.isDirectory()) {
        await visit(childAbsolute, childRelative);
      } else if (entry.isFile()) {
        files.push(childRelative.replaceAll("\\", "/"));
      }
    }
  }
  await visit(absoluteDirectory, normalized);
  return files;
}

async function discoverWorkspacePackages(root) {
  const packageFiles = [];
  for (const base of ["artifacts", "lib", "scripts"]) {
    const baseDetails = await lstat(insideRoot(root, base)).catch(() => null);
    if (!baseDetails?.isDirectory()) continue;
    for (const file of await walkFiles(root, base)) {
      if (posix.basename(file) === "package.json") packageFiles.push(file);
    }
  }
  const packages = new Map();
  for (const path of packageFiles) {
    const manifest = await readJson(root, path);
    if (
      typeof manifest.name !== "string" ||
      !manifest.name.startsWith("@workspace/")
    ) {
      continue;
    }
    assert.equal(
      packages.has(manifest.name),
      false,
      `${manifest.name} has duplicate workspace package manifests`,
    );
    packages.set(manifest.name, {
      name: manifest.name,
      directory: posix.dirname(path),
      manifest,
    });
  }
  assert.ok(packages.size > 0, "no @workspace packages were discovered");
  return packages;
}

async function workspaceAliasRules(root, packageDirectory) {
  const configPath = `${packageDirectory}/tsconfig.json`;
  const details = await lstat(insideRoot(root, configPath)).catch(() => null);
  if (!details?.isFile() || details.isSymbolicLink()) return [];
  return parseWorkspaceAliasRules(await readRegularText(root, configPath), {
    configPath,
    packageDirectory,
  });
}

function moduleConfigArray(catalogue) {
  return catalogueArray(
    catalogue,
    ["modules", "boundaries"],
    "module boundaries",
  );
}

function normalizeModuleDefinitions(catalogue) {
  const entries = moduleConfigArray(catalogue);
  const ids = new Set();
  const packages = new Set();
  return entries.map((raw, index) => {
    const module = assertRecord(raw, `modules[${index}]`);
    const id = meaningfulText(module.id, `modules[${index}].id`);
    assert.match(id, IDENTIFIER, `${id} has an invalid module ID`);
    assert.equal(ids.has(id), false, `${id} is a duplicate module ID`);
    ids.add(id);
    const packageName = meaningfulText(
      module.package ?? module.packageName,
      `${id}.package`,
    );
    assert.ok(
      packageName.startsWith("@workspace/"),
      `${id}.package is not a workspace package`,
    );
    assert.equal(
      packages.has(packageName),
      false,
      `${packageName} is assigned to more than one module`,
    );
    packages.add(packageName);
    const roots = exactStringArray(
      module.roots ?? module.sourceRoots,
      `${id}.roots`,
    ).map((path, rootIndex) =>
      repositoryPath(path, `${id}.roots[${rootIndex}]`),
    );
    const mayDependOn = exactStringArray(
      module.mayDependOn ?? module.allowedDependencies ?? [],
      `${id}.mayDependOn`,
      { allowEmpty: true },
    );
    assert.equal(
      mayDependOn.includes(id),
      false,
      `${id} cannot depend on itself`,
    );
    const maxSourceFileLines =
      module.maxSourceFileLines ?? module.maximumSourceFileLines ?? null;
    assert.ok(
      maxSourceFileLines === null ||
        (Number.isSafeInteger(maxSourceFileLines) && maxSourceFileLines > 0),
      `${id}.maxSourceFileLines must be a positive integer when configured`,
    );
    return {
      id,
      packageName,
      roots,
      mayDependOn,
      maxSourceFileLines,
    };
  });
}

function assertAcyclicModules(modules) {
  const byId = new Map(modules.map((module) => [module.id, module]));
  const visiting = new Set();
  const visited = new Set();
  function visit(id, path = []) {
    if (visiting.has(id)) {
      assert.fail(
        `module dependency cycle detected: ${[...path, id].join(" -> ")}`,
      );
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id).mayDependOn) {
      assert.ok(
        byId.has(dependency),
        `${id} allows missing module ${dependency}`,
      );
      visit(dependency, [...path, id]);
    }
    visiting.delete(id);
    visited.add(id);
  }
  for (const module of modules) visit(module.id);
}

function pathIsWithin(path, root) {
  return path === root || path.startsWith(`${root}/`);
}

function componentForPath(components, path) {
  const matches = components
    .filter((component) =>
      component.roots.some((componentRoot) =>
        pathIsWithin(path, componentRoot),
      ),
    )
    .sort(
      (left, right) =>
        Math.max(...right.roots.map((root) => root.length)) -
        Math.max(...left.roots.map((root) => root.length)),
    );
  assert.ok(
    matches.length < 2 ||
      Math.max(...matches[0].roots.map((root) => root.length)) !==
        Math.max(...matches[1].roots.map((root) => root.length)),
    `${path} belongs to ambiguous internal component roots`,
  );
  return matches[0] ?? null;
}

function assertAcyclicComponents(components) {
  const byId = new Map(
    components.map((component) => [component.id, component]),
  );
  const visiting = new Set();
  const visited = new Set();
  function visit(id, path = []) {
    if (visiting.has(id)) {
      assert.fail(
        `internal component dependency cycle detected: ${[...path, id].join(" -> ")}`,
      );
    }
    if (visited.has(id)) return;
    visiting.add(id);
    const component = byId.get(id);
    for (const dependencyId of component.mayDependOn) {
      const dependency = byId.get(dependencyId);
      assert.ok(
        dependency,
        `${id} allows missing internal component ${dependencyId}`,
      );
      assert.equal(
        dependency.moduleId,
        component.moduleId,
        `${id} mayDependOn must name components in the same workspace module`,
      );
      visit(dependencyId, [...path, id]);
    }
    visiting.delete(id);
    visited.add(id);
  }
  for (const component of components) visit(component.id);
}

function normalizeInternalBoundaryPolicy(catalogue, modules, metadata) {
  const rawPolicy =
    catalogue.internalBoundaries ?? catalogue.componentBoundaries;
  assert.ok(
    rawPolicy,
    "module boundaries must define internalBoundaries or componentBoundaries",
  );
  const componentEntries = Array.isArray(rawPolicy)
    ? rawPolicy
    : catalogueArray(
        assertRecord(rawPolicy, "internal boundaries"),
        ["components", "boundaries"],
        "internal boundaries",
      );
  assert.ok(
    componentEntries.length > 0,
    "internal boundaries must not be empty",
  );
  const moduleById = new Map(modules.map((module) => [module.id, module]));
  const componentIds = new Set();
  const claimedRoots = new Set();
  const components = componentEntries.map((raw, index) => {
    const component = assertRecord(raw, `internalBoundaries[${index}]`);
    const id = meaningfulText(component.id, `internalBoundaries[${index}].id`);
    assert.match(id, IDENTIFIER, `${id} has an invalid internal component ID`);
    assert.equal(
      componentIds.has(id),
      false,
      `${id} is a duplicate internal component ID`,
    );
    componentIds.add(id);
    const moduleId = meaningfulText(
      component.module ?? component.moduleId,
      `${id}.module`,
    );
    const module = moduleById.get(moduleId);
    assert.ok(module, `${id} references missing workspace module ${moduleId}`);
    const roots = exactStringArray(
      component.roots ?? component.sourceRoots,
      `${id}.roots`,
    ).map((path, rootIndex) =>
      repositoryPath(path, `${id}.roots[${rootIndex}]`),
    );
    for (const rootPath of roots) {
      assert.ok(
        module.roots.some((moduleRoot) => pathIsWithin(rootPath, moduleRoot)),
        `${id} root ${rootPath} is outside ${moduleId}`,
      );
      assert.equal(
        claimedRoots.has(rootPath),
        false,
        `${rootPath} is assigned to more than one internal component`,
      );
      claimedRoots.add(rootPath);
    }
    const mayDependOn = exactStringArray(
      component.mayDependOn ?? component.allowedDependencies ?? [],
      `${id}.mayDependOn`,
      { allowEmpty: true },
    );
    assert.equal(
      mayDependOn.includes(id),
      false,
      `${id} cannot depend on itself`,
    );
    return { id, moduleId, roots, mayDependOn };
  });
  for (let leftIndex = 0; leftIndex < components.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < components.length;
      rightIndex += 1
    ) {
      const left = components[leftIndex];
      const right = components[rightIndex];
      for (const leftRoot of left.roots) {
        for (const rightRoot of right.roots) {
          assert.equal(
            pathIsWithin(leftRoot, rightRoot) ||
              pathIsWithin(rightRoot, leftRoot),
            false,
            `${left.id} and ${right.id} have overlapping internal component roots`,
          );
        }
      }
    }
  }
  assertAcyclicComponents(components);

  const exceptionEntries = Array.isArray(rawPolicy)
    ? (catalogue.internalBoundaryExceptions ?? [])
    : (rawPolicy.exceptions ?? []);
  assert.ok(
    Array.isArray(exceptionEntries),
    "internal boundary exceptions must be an array",
  );
  const exceptionIds = new Set();
  const exceptionKeys = new Map();
  const exceptions = exceptionEntries.map((raw, index) => {
    const exception = assertRecord(
      raw,
      `internal boundary exceptions[${index}]`,
    );
    const id = meaningfulText(
      exception.id,
      `internal boundary exceptions[${index}].id`,
    );
    assert.match(id, IDENTIFIER, `${id} has an invalid exception ID`);
    assert.equal(
      exceptionIds.has(id),
      false,
      `${id} is a duplicate exception ID`,
    );
    exceptionIds.add(id);
    const from = meaningfulText(exception.from, `${id}.from`);
    const to = meaningfulText(exception.to, `${id}.to`);
    const fromComponent = components.find((component) => component.id === from);
    const toComponent = components.find((component) => component.id === to);
    assert.ok(
      fromComponent,
      `${id} references missing source component ${from}`,
    );
    assert.ok(toComponent, `${id} references missing target component ${to}`);
    assert.notEqual(from, to, `${id} cannot except a component self-edge`);
    assert.equal(
      fromComponent.mayDependOn.includes(to),
      false,
      `${id} is unnecessary because ${from} already allows ${to}`,
    );
    const importers = exactStringArray(
      exception.importers ?? exception.files,
      `${id}.importers`,
    ).map((path, importerIndex) =>
      repositoryPath(path, `${id}.importers[${importerIndex}]`),
    );
    meaningfulText(exception.owner, `${id}.owner`, 3);
    meaningfulText(exception.reason ?? exception.rationale, `${id}.reason`, 12);
    const reviewBy = canonicalIsoDate(exception.reviewBy, `${id}.reviewBy`);
    assert.ok(
      reviewBy >= metadata.lastReviewed,
      `${id}.reviewBy must not predate the module-boundary review`,
    );
    for (const importer of importers) {
      assert.ok(
        fromComponent.roots.some((rootPath) =>
          pathIsWithin(importer, rootPath),
        ),
        `${id} importer ${importer} is outside ${from}`,
      );
      const key = `${from}\0${to}\0${importer}`;
      assert.equal(
        exceptionKeys.has(key),
        false,
        `${importer} has duplicate ${from} -> ${to} exceptions`,
      );
      exceptionKeys.set(key, id);
    }
    return { id, from, to, importers };
  });

  const apiServer = moduleById.get("api-server");
  if (apiServer) {
    const requiredRoots = [
      "artifacts/api-server/src/lib",
      "artifacts/api-server/src/middlewares",
      "artifacts/api-server/src/routes",
    ];
    const [library, middlewares, routes] = requiredRoots.map((requiredRoot) => {
      const component = components.find((candidate) =>
        candidate.roots.includes(requiredRoot),
      );
      assert.ok(component, `internal boundaries must classify ${requiredRoot}`);
      return component;
    });
    assert.equal(
      library.mayDependOn.includes(middlewares.id),
      false,
      `${library.id} must not allow the API middleware implementation`,
    );
    assert.equal(
      library.mayDependOn.includes(routes.id),
      false,
      `${library.id} must not allow the API route implementation`,
    );
  }
  if (moduleById.has("workbench")) {
    assert.ok(
      components.some((component) =>
        component.roots.includes("artifacts/bidbox-workbench/src"),
      ),
      "internal boundaries must classify artifacts/bidbox-workbench/src",
    );
  }
  return { components, exceptions, exceptionKeys };
}

function hotspotPolicy(catalogue, metadata) {
  const raw = catalogue.hotspotPolicy ?? catalogue.hotspots;
  const policy = assertRecord(raw, "module boundaries hotspotPolicy");
  const defaultMaxLines = Number(
    policy.defaultMaxLines ?? policy.defaultMaximumLines,
  );
  assert.ok(
    Number.isSafeInteger(defaultMaxLines) && defaultMaxLines > 0,
    "hotspotPolicy.defaultMaxLines must be a positive integer",
  );
  const excludedPaths = exactStringArray(
    policy.excludedPaths ?? policy.exclude ?? [],
    "hotspotPolicy.excludedPaths",
    { allowEmpty: true },
  ).map((path, index) =>
    repositoryPath(path, `hotspotPolicy.excludedPaths[${index}]`),
  );
  const exceptions = (policy.exceptions ?? []).map((rawException, index) => {
    const exception = assertRecord(
      rawException,
      `hotspotPolicy.exceptions[${index}]`,
    );
    const path = repositoryPath(
      exception.path,
      `hotspotPolicy.exceptions[${index}].path`,
    );
    const maxLines = Number(exception.maxLines ?? exception.maximumLines);
    assert.ok(
      Number.isSafeInteger(maxLines) && maxLines > defaultMaxLines,
      `${path} exception maxLines must exceed the default budget`,
    );
    meaningfulText(exception.owner, `${path} exception owner`, 3);
    meaningfulText(
      exception.reason ?? exception.rationale,
      `${path} exception reason`,
      12,
    );
    const reviewBy = canonicalIsoDate(
      exception.reviewBy ?? exception.reviewedOn,
      `${path} exception review metadata`,
    );
    assert.ok(
      reviewBy >= metadata.lastReviewed,
      `${path} hotspot exception review must not predate the module-boundary review`,
    );
    return { path, maxLines };
  });
  assert.equal(
    new Set(exceptions.map(({ path }) => path)).size,
    exceptions.length,
    "hotspot exceptions must have unique paths",
  );
  return { defaultMaxLines, excludedPaths, exceptions };
}

function isExcluded(path, excludedPaths) {
  return excludedPaths.some(
    (excluded) => path === excluded || path.startsWith(`${excluded}/`),
  );
}

export async function validateModuleBoundaries(root, catalogue) {
  const metadata = validateCatalogueMetadata(catalogue, "module boundaries");
  const modules = normalizeModuleDefinitions(catalogue);
  assertAcyclicModules(modules);
  const internal = normalizeInternalBoundaryPolicy(
    catalogue,
    modules,
    metadata,
  );
  for (const component of internal.components) {
    for (const rootPath of component.roots) {
      const details = await lstat(insideRoot(root, rootPath)).catch(() => null);
      assert.ok(
        details?.isDirectory(),
        `${component.id} root ${rootPath} must be a directory`,
      );
      assert.equal(
        details.isSymbolicLink(),
        false,
        `${component.id} root ${rootPath} must not be a symlink`,
      );
    }
  }
  const workspacePackages = await discoverWorkspacePackages(root);
  const byPackage = new Map(
    modules.map((module) => [module.packageName, module]),
  );
  assert.deepEqual(
    new Set(byPackage.keys()),
    new Set(workspacePackages.keys()),
    "module boundaries must declare every discovered @workspace package exactly once",
  );
  const aliasRulesByModule = new Map();
  for (const module of modules) {
    aliasRulesByModule.set(
      module.id,
      await workspaceAliasRules(
        root,
        workspacePackages.get(module.packageName).directory,
      ),
    );
  }
  const observedModuleEdges = new Set();
  for (const module of modules) {
    const workspacePackage = workspacePackages.get(module.packageName);
    for (const dependencyName of workspaceDependencies(
      workspacePackage.manifest,
    )) {
      const dependency = byPackage.get(dependencyName);
      assert.ok(
        dependency,
        `${module.packageName} declares unknown workspace dependency ${dependencyName}`,
      );
      assert.ok(
        module.mayDependOn.includes(dependency.id),
        `${module.id} package.json dependency ${dependency.id} is not in mayDependOn`,
      );
      observedModuleEdges.add(`${module.id} -> ${dependency.id}`);
    }
  }

  let importCount = 0;
  let internalImportCount = 0;
  const sourceFiles = new Set();
  const usedInternalExceptions = new Set();
  const observedInternalEdges = new Set();
  for (const module of modules) {
    for (const rootPath of module.roots) {
      for (const path of await walkFiles(root, rootPath)) {
        if (!SOURCE_EXTENSIONS.has(extname(path))) continue;
        sourceFiles.add(path);
        const source = await readRegularText(root, path);
        const specifiers = importedSpecifiers(source, path);
        for (const specifier of specifiers) {
          if (!specifier.startsWith("@workspace/")) continue;
          const dependency = [...byPackage.entries()]
            .sort(([left], [right]) => right.length - left.length)
            .find(
              ([packageName]) =>
                specifier === packageName ||
                specifier.startsWith(`${packageName}/`),
            )?.[1];
          assert.ok(
            dependency,
            `${path} imports unknown workspace package ${specifier}`,
          );
          assert.ok(
            module.mayDependOn.includes(dependency.id),
            `${path} imports ${dependency.id}, which is not allowed by ${module.id}.mayDependOn`,
          );
          observedModuleEdges.add(`${module.id} -> ${dependency.id}`);
          importCount += 1;
        }
        const enforceInternalBoundary =
          !/(?:^|\.)test\.[^.]+$/u.test(posix.basename(path)) &&
          !path.includes("/generated/");
        if (!enforceInternalBoundary) continue;
        const sourceComponent = componentForPath(internal.components, path);
        for (const specifier of specifiers) {
          const targetPath = specifier.startsWith(".")
            ? posix.normalize(
                posix.join(
                  posix.dirname(path),
                  specifier.split(/[?#]/u)[0].replaceAll("\\", "/"),
                ),
              )
            : resolveAliasTarget(aliasRulesByModule.get(module.id), specifier);
          if (!targetPath) continue;
          assert.equal(
            targetPath === ".." || targetPath.startsWith("../"),
            false,
            `${path} source import ${specifier} escapes the repository`,
          );
          const targetModules = modules.filter((candidate) =>
            candidate.roots.some((candidateRoot) =>
              pathIsWithin(targetPath, candidateRoot),
            ),
          );
          assert.ok(
            targetModules.length <= 1,
            `${path} source import ${specifier} targets ambiguous workspace modules`,
          );
          const targetModule = targetModules[0] ?? null;
          assert.ok(
            !targetModule || targetModule.id === module.id,
            `${path} source import ${specifier} crosses into ${targetModule?.id}; workspace implementations must be consumed through their declared package boundary`,
          );
          if (!sourceComponent || !targetModule) continue;
          const targetComponent = componentForPath(
            internal.components,
            targetPath,
          );
          if (
            !targetComponent ||
            targetComponent.moduleId !== module.id ||
            targetComponent.id === sourceComponent.id
          ) {
            continue;
          }
          const edge = `${sourceComponent.id} -> ${targetComponent.id}`;
          if (sourceComponent.mayDependOn.includes(targetComponent.id)) {
            observedInternalEdges.add(edge);
          } else {
            const exceptionKey = `${sourceComponent.id}\0${targetComponent.id}\0${path}`;
            const exceptionId = internal.exceptionKeys.get(exceptionKey);
            assert.ok(
              exceptionId,
              `${path} imports forbidden internal component ${targetComponent.id}; ${sourceComponent.id}.mayDependOn does not allow it`,
            );
            usedInternalExceptions.add(exceptionKey);
          }
          internalImportCount += 1;
        }
      }
    }
  }
  for (const [exceptionKey, exceptionId] of internal.exceptionKeys) {
    const importer = exceptionKey.split("\0").at(-1);
    assert.ok(
      sourceFiles.has(importer),
      `${exceptionId} importer ${importer} is not a source file`,
    );
    assert.ok(
      usedInternalExceptions.has(exceptionKey),
      `${exceptionId} is stale because ${importer} has no matching forbidden internal import`,
    );
  }

  const hotspots = hotspotPolicy(catalogue, metadata);
  const exceptions = new Map(
    hotspots.exceptions.map((exception) => [exception.path, exception]),
  );
  const usedExceptions = new Set();
  let measuredSourceFileCount = 0;
  for (const path of [...sourceFiles].sort()) {
    if (
      isExcluded(path, hotspots.excludedPaths) ||
      /(?:^|\.)test\.[^.]+$/u.test(posix.basename(path)) ||
      path.includes("/generated/")
    ) {
      continue;
    }
    const source = await readRegularText(root, path);
    const lineCount = source.split(/\r?\n/u).length;
    const owningModules = modules.filter((module) =>
      module.roots.some(
        (rootPath) => path === rootPath || path.startsWith(`${rootPath}/`),
      ),
    );
    assert.equal(
      owningModules.length,
      1,
      `${path} must belong to exactly one declared module source root`,
    );
    const budget =
      owningModules[0].maxSourceFileLines ?? hotspots.defaultMaxLines;
    const exception = exceptions.get(path);
    if (lineCount > budget) {
      assert.ok(
        exception,
        `${path} has ${lineCount} lines and exceeds its ${budget}-line architectural hotspot budget without an explicit exception`,
      );
      assert.ok(
        lineCount <= exception.maxLines,
        `${path} has ${lineCount} lines and exceeds its ${exception.maxLines}-line hotspot exception`,
      );
      usedExceptions.add(path);
    }
    measuredSourceFileCount += 1;
  }
  for (const exception of hotspots.exceptions) {
    assert.ok(
      sourceFiles.has(exception.path),
      `${exception.path} hotspot exception targets no source file`,
    );
    assert.ok(
      usedExceptions.has(exception.path),
      `${exception.path} hotspot exception is stale because the file is within its normal budget`,
    );
  }
  return {
    metadata,
    modules,
    moduleCount: modules.length,
    importCount,
    internalComponentCount: internal.components.length,
    internalImportCount,
    internalExceptionCount: internal.exceptions.length,
    componentDependencyEdges: internal.components
      .flatMap((component) =>
        component.mayDependOn.map(
          (dependency) => `${component.id} -> ${dependency}`,
        ),
      )
      .sort(),
    observedComponentDependencyEdges: [...observedInternalEdges].sort(),
    observedModuleDependencyEdges: [...observedModuleEdges].sort(),
    measuredSourceFileCount,
    hotspotExceptionCount: hotspots.exceptions.length,
  };
}

function policyControlObject(entry) {
  return assertRecord(
    entry.controls ?? entry.policy ?? entry,
    "route controls",
  );
}

function requirePolicyControl(controls, aliases, label) {
  const alias = aliases.find((candidate) =>
    Object.prototype.hasOwnProperty.call(controls, candidate),
  );
  assert.ok(alias, `${label} must be defined`);
  return meaningfulText(controls[alias], label);
}

function assertPolicyControlDimensions(
  entry,
  label,
  { highRisk = false } = {},
) {
  const controls = policyControlObject(entry);
  requirePolicyControl(
    controls,
    ["authentication", "auth", "authenticated"],
    `${label} authentication`,
  );
  requirePolicyControl(
    controls,
    ["tenantScope", "tenantScoped", "tenancy"],
    `${label} tenant scope`,
  );
  requirePolicyControl(
    controls,
    ["transactionMode", "transaction", "databaseMode"],
    `${label} transaction mode`,
  );
  if (!highRisk) return;
  for (const [name, aliases] of Object.entries({
    permission: ["permission", "requiredPermission", "authorisation"],
    releasedProjectPolicy: [
      "releasedProjectPolicy",
      "releasedStatePolicy",
      "immutabilityPolicy",
    ],
    idempotency: ["idempotency", "idempotencyPolicy"],
    concurrency: ["concurrency", "precondition", "concurrencyPolicy"],
    audit: ["audit", "auditEvent", "auditPolicy"],
  })) {
    requirePolicyControl(
      controls,
      aliases,
      `${label} high-risk override ${name}`,
    );
  }
}

async function runtimeProjectRoutePolicyIds(root) {
  const source = await readRegularText(root, RUNTIME_ROUTE_POLICY_PATH);
  return literalRuntimePolicyIds(source, RUNTIME_ROUTE_POLICY_PATH);
}

export async function validateRoutePolicyCatalogue(
  root,
  catalogue,
  moduleIds,
  { openApiPath = OPENAPI_PATH } = {},
) {
  const metadata = validateCatalogueMetadata(catalogue, "route policies");
  const statusVocabulary = new Set(
    exactStringArray(
      catalogue.statusVocabulary,
      "route policy statusVocabulary",
    ),
  );
  const validateStatus = (entry, label) => {
    const status = meaningfulText(entry.status, `${label}.status`);
    assert.ok(
      statusVocabulary.has(status),
      `${label}.status ${status} is not declared in route policy statusVocabulary`,
    );
    return status;
  };
  const defaults = catalogueArray(
    catalogue,
    ["defaults", "moduleDefaults", "prefixDefaults"],
    "route policies",
  ).map((raw, index) => {
    const entry = assertRecord(raw, `route policy defaults[${index}]`);
    const status = validateStatus(entry, `route policy defaults[${index}]`);
    const module = meaningfulText(
      entry.module ?? entry.moduleId,
      `route policy defaults[${index}].module`,
    );
    assert.ok(
      moduleIds.has(module),
      `route policy default references missing ${module}`,
    );
    const pathPrefix = meaningfulText(
      entry.pathPrefix ?? entry.prefix,
      `route policy defaults[${index}].pathPrefix`,
      1,
    );
    assert.ok(
      pathPrefix.startsWith("/"),
      `${module} route prefix must start with /`,
    );
    assert.equal(
      pathPrefix.includes("?") || pathPrefix.includes("#"),
      false,
      `${module} route prefix must be a path`,
    );
    const methods = entry.methods
      ? exactStringArray(entry.methods, `${module} ${pathPrefix} methods`).map(
          (method) => method.toUpperCase(),
        )
      : null;
    if (methods) {
      for (const method of methods) {
        assert.ok(
          HTTP_METHODS.has(method.toLowerCase()),
          `${method} is not an HTTP method`,
        );
      }
    }
    assertPolicyControlDimensions(entry, `${module} ${pathPrefix} default`);
    return { module, pathPrefix, methods, status };
  });
  const defaultKeys = defaults.map(
    ({ module, pathPrefix, methods }) =>
      `${module}\0${pathPrefix}\0${methods?.sort().join(",") ?? "*"}`,
  );
  assert.equal(
    new Set(defaultKeys).size,
    defaults.length,
    "route policy defaults must be unique",
  );

  const overrides = catalogueArray(
    catalogue,
    ["overrides", "operationOverrides", "highRiskOperations"],
    "route policies",
  ).map((raw, index) => {
    const entry = assertRecord(raw, `route policy overrides[${index}]`);
    const id = meaningfulText(entry.id, `route policy overrides[${index}].id`);
    assert.match(id, IDENTIFIER, `${id} has an invalid route policy ID`);
    const status = validateStatus(entry, id);
    const module = meaningfulText(
      entry.module ?? entry.moduleId,
      `${id}.module`,
    );
    assert.ok(moduleIds.has(module), `${id} references missing ${module}`);
    const method = meaningfulText(entry.method, `${id}.method`).toUpperCase();
    assert.ok(
      HTTP_METHODS.has(method.toLowerCase()),
      `${id} has an invalid HTTP method`,
    );
    const path = meaningfulText(entry.path, `${id}.path`);
    assert.ok(path.startsWith("/"), `${id}.path must start with /`);
    assertPolicyControlDimensions(entry, id, { highRisk: true });
    return {
      id,
      module,
      method,
      path,
      status,
      classification: explicitNonOpenApiClassification(entry),
    };
  });
  assert.equal(
    new Set(overrides.map(({ id }) => id)).size,
    overrides.length,
    "route policy override IDs must be unique",
  );
  assert.equal(
    new Set(overrides.map(({ method, path }) => `${method} ${path}`)).size,
    overrides.length,
    "route policy overrides must target unique operations",
  );
  assert.ok(
    overrides.length > 0,
    "route policies must declare high-risk overrides",
  );

  const openApi = await readRegularText(root, openApiPath);
  const operations = parseOpenApiOperations(openApi);
  const operationKeys = new Set(
    operations.map(({ method, path }) => `${method} ${path}`),
  );
  for (const operation of operations) {
    const matches = defaults.filter(
      ({ pathPrefix, methods }) =>
        routePrefixMatches(operation.path, pathPrefix) &&
        (!methods || methods.includes(operation.method)),
    );
    assert.ok(
      matches.length > 0,
      `${operation.method} ${operation.path} has no route-policy default`,
    );
    const longest = Math.max(
      ...matches.map(({ pathPrefix }) => pathPrefix.length),
    );
    const mostSpecific = matches.filter(
      ({ pathPrefix }) => pathPrefix.length === longest,
    );
    assert.equal(
      mostSpecific.length,
      1,
      `${operation.method} ${operation.path} has ambiguous route-policy defaults`,
    );
  }
  for (const override of overrides) {
    const mapsToOpenApi = operationKeys.has(
      `${override.method} ${override.path}`,
    );
    assert.ok(
      mapsToOpenApi || override.classification,
      `${override.id} must match an OpenAPI operation or declare an explicit internal-only/activation-gated classification`,
    );
    const matchedDefault = defaults.some(
      ({ module, pathPrefix, methods }) =>
        module === override.module &&
        routePrefixMatches(override.path, pathPrefix) &&
        (!methods || methods.includes(override.method)),
    );
    assert.ok(
      matchedDefault,
      `${override.id} is not covered by a default for ${override.module}`,
    );
  }
  const runtimeIds = await runtimeProjectRoutePolicyIds(root);
  const configuredIds = new Set(overrides.map(({ id }) => id));
  for (const id of runtimeIds) {
    assert.ok(
      configuredIds.has(id),
      `${id} exists in the runtime project-route policy catalogue but not in architecture route policies`,
    );
  }
  assert.ok(
    overrides.some(
      ({ id, method, path }) =>
        id === "project-package-export" &&
        method === "POST" &&
        path === "/projects/{id}/export",
    ),
    "route policies must bind project-package-export to POST /projects/{id}/export",
  );
  return {
    metadata,
    statusVocabularyCount: statusVocabulary.size,
    defaultCount: defaults.length,
    overrideCount: overrides.length,
    runtimePolicyCount: runtimeIds.size,
    operationCount: operations.length,
    mutatingOperationCount: operations.filter(({ method }) =>
      MUTATING_HTTP_METHODS.has(method.toLowerCase()),
    ).length,
  };
}

export async function validateArchitectureImpactTemplate(root) {
  const candidates = [
    ".github/pull_request_template.md",
    ".github/PULL_REQUEST_TEMPLATE.md",
    ".github/PULL_REQUEST_TEMPLATE/default.md",
  ];
  let selected = null;
  let source = null;
  for (const candidate of candidates) {
    const details = await lstat(insideRoot(root, candidate)).catch(() => null);
    if (!details?.isFile() || details.isSymbolicLink()) continue;
    selected = candidate;
    source = await readRegularText(root, candidate);
    break;
  }
  assert.ok(
    selected,
    "an architecture-impact pull request template is required",
  );
  for (const [label, pattern] of [
    ["architecture impact", /architecture\s+impact/iu],
    ["architecture driver", /architecture\s+driver/iu],
    ["decision record", /\bADR\b|decision\s+record/iu],
    ["module boundary", /module\s+boundar|component\s+map/iu],
    ["risk", /architecture\s+risk|risk\s+register/iu],
    ["route policy", /route\s+polic/iu],
    ["architecture views", /\bC4\b|dynamic\s+flow|deployment\s+view/iu],
  ]) {
    assert.match(source, pattern, `${selected} must prompt for ${label}`);
  }
  return { path: selected };
}

async function validateEvidencePaths(root, drivers, risks, adrRecords) {
  const paths = new Set([
    ...drivers.flatMap(({ evidence }) => evidence),
    ...risks.flatMap(({ evidence }) => evidence),
    ...[...adrRecords.values()].flatMap(({ evidence }) => evidence),
  ]);
  for (const [index, rawPath] of [...paths].entries()) {
    const path = repositoryPath(rawPath, `architecture evidence[${index}]`);
    const details = await lstat(insideRoot(root, path)).catch(() => null);
    assert.ok(details?.isFile(), `${path} architecture evidence must exist`);
    assert.equal(
      details.isSymbolicLink(),
      false,
      `${path} evidence must not be a symlink`,
    );
  }
  return paths.size;
}

function validateArchitectureFreshness(
  documentMetadata,
  catalogues,
  adrRecords,
) {
  assert.equal(
    new Set(catalogues.map(({ catalogueId }) => catalogueId)).size,
    catalogues.length,
    "architecture catalogue IDs must be unique",
  );
  const baseline = catalogues
    .map(({ sourceReviewedThrough }) => sourceReviewedThrough)
    .sort()
    .at(-1);
  for (const [path, metadata] of documentMetadata) {
    assert.ok(
      metadata.lastReviewed >= baseline,
      `${path} was last reviewed ${metadata.lastReviewed}, before the architecture source review ${baseline}`,
    );
  }
  for (const record of adrRecords.values()) {
    assert.ok(
      record.lastReviewed >= baseline,
      `${record.id} was last reviewed ${record.lastReviewed}, before the architecture source review ${baseline}`,
    );
  }
  for (const catalogue of catalogues) {
    assert.ok(
      catalogue.lastReviewed >= baseline,
      `${catalogue.catalogueId} is stale against source review ${baseline}`,
    );
  }
  return baseline;
}

export async function verifyArchitectureRepository(
  root,
  {
    requiredDocuments = REQUIRED_ARCHITECTURE_DOCUMENTS,
    requiredConfigs = REQUIRED_ARCHITECTURE_CONFIGS,
    requireRoutePolicies = true,
  } = {},
) {
  const documents = await validateArchitectureDocuments(root, {
    requiredDocuments,
  });
  const adrs = await validateArchitectureDecisionRecords(root);
  const configPaths = new Set(requiredConfigs);
  const driversPath = "config/architecture/drivers.v1.json";
  const modulesPath = "config/architecture/module-boundaries.v1.json";
  const risksPath = "config/architecture/risks.v1.json";
  for (const required of [driversPath, modulesPath, risksPath]) {
    assert.ok(configPaths.has(required), `${required} must be required`);
  }
  const drivers = validateArchitectureDrivers(
    await readJson(root, driversPath),
  );
  const modules = await validateModuleBoundaries(
    root,
    await readJson(root, modulesPath),
  );
  const risks = validateArchitectureRisks(
    await readJson(root, risksPath),
    drivers.ids,
  );
  for (const record of adrs.records.values()) {
    for (const driverId of record.drivers) {
      assert.ok(
        drivers.ids.has(driverId),
        `${record.id} references missing architecture driver ${driverId}`,
      );
    }
  }
  for (const driver of drivers.drivers) {
    for (const reference of driver.decisionRefs) {
      assert.ok(
        adrs.records.has(reference),
        `${driver.id} references missing ${reference}`,
      );
    }
  }
  const evidenceFileCount = await validateEvidencePaths(
    root,
    drivers.drivers,
    risks.risks,
    adrs.records,
  );
  let routes = null;
  const routePath = "config/architecture/route-policies.v1.json";
  if (configPaths.has(routePath)) {
    routes = await validateRoutePolicyCatalogue(
      root,
      await readJson(root, routePath),
      new Set(modules.modules.map(({ id }) => id)),
    );
  } else if (requireRoutePolicies) {
    assert.fail(`${routePath} is required for repository verification`);
  }
  const pullRequestTemplate = await validateArchitectureImpactTemplate(root);
  const sourceReviewedThrough = validateArchitectureFreshness(
    documents.metadata,
    [
      drivers.metadata,
      modules.metadata,
      risks.metadata,
      ...(routes ? [routes.metadata] : []),
    ],
    adrs.records,
  );
  const moduleDependencyEdges = modules.modules
    .flatMap((module) =>
      module.mayDependOn.map((dependency) => `${module.id} -> ${dependency}`),
    )
    .sort();
  return {
    sourceReviewedThrough,
    documentCount: documents.documentCount,
    mermaidDiagramCount: documents.mermaidDiagramCount,
    adrCount: adrs.adrCount,
    driverCount: drivers.drivers.length,
    riskCount: risks.risks.length,
    moduleCount: modules.moduleCount,
    moduleDependencyEdges,
    observedModuleDependencyEdges: modules.observedModuleDependencyEdges,
    workspaceImportCount: modules.importCount,
    internalComponentCount: modules.internalComponentCount,
    internalImportCount: modules.internalImportCount,
    internalExceptionCount: modules.internalExceptionCount,
    componentDependencyEdges: modules.componentDependencyEdges,
    observedComponentDependencyEdges: modules.observedComponentDependencyEdges,
    measuredSourceFileCount: modules.measuredSourceFileCount,
    hotspotExceptionCount: modules.hotspotExceptionCount,
    routePolicyDefaultCount: routes?.defaultCount ?? 0,
    routePolicyOverrideCount: routes?.overrideCount ?? 0,
    routeOperationCount: routes?.operationCount ?? 0,
    evidenceFileCount,
    pullRequestTemplate: pullRequestTemplate.path,
  };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  const repositoryRoot = resolve(import.meta.dirname, "..");
  const result = await verifyArchitectureRepository(repositoryRoot);
  console.log(
    `Architecture verified: ${result.documentCount} guidebook documents, ${result.mermaidDiagramCount} diagrams, ${result.adrCount} ADRs, ${result.driverCount} drivers, ${result.riskCount} risks, ${result.moduleCount} modules, ${result.routeOperationCount} governed API operations. Source reviewed through ${result.sourceReviewedThrough}.`,
  );
  console.log("Declared workspace module dependency allowlist:");
  if (result.moduleDependencyEdges.length === 0) console.log("- (none)");
  for (const edge of result.moduleDependencyEdges) console.log(`- ${edge}`);
  console.log("Observed workspace module dependency graph:");
  if (result.observedModuleDependencyEdges.length === 0)
    console.log("- (none)");
  for (const edge of result.observedModuleDependencyEdges)
    console.log(`- ${edge}`);
  console.log("Declared internal component dependency allowlist:");
  if (result.componentDependencyEdges.length === 0) console.log("- (none)");
  for (const edge of result.componentDependencyEdges) console.log(`- ${edge}`);
  console.log("Observed internal component dependency graph:");
  if (result.observedComponentDependencyEdges.length === 0)
    console.log("- (none)");
  for (const edge of result.observedComponentDependencyEdges) {
    console.log(`- ${edge}`);
  }
}
