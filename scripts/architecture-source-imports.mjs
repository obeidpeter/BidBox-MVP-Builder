import assert from "node:assert/strict";
import { extname, posix } from "node:path";
import ts from "typescript";

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

function scriptKind(path) {
  return (
    {
      ".js": ts.ScriptKind.JS,
      ".jsx": ts.ScriptKind.JSX,
      ".ts": ts.ScriptKind.TS,
      ".tsx": ts.ScriptKind.TSX,
    }[extname(path)] ?? ts.ScriptKind.Unknown
  );
}

function sourceFile(source, path) {
  return ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(path),
  );
}

export function importedSpecifiers(source, path) {
  const values = new Set();
  function addLiteral(node) {
    if (node && ts.isStringLiteralLike(node)) values.add(node.text);
  }
  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      addLiteral(node.moduleSpecifier);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      addLiteral(node.moduleReference.expression);
    } else if (ts.isCallExpression(node) && node.arguments.length >= 1) {
      if (
        node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require")
      ) {
        addLiteral(node.arguments[0]);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile(source, path));
  return values;
}

export function workspaceDependencies(manifest) {
  const dependencies = new Set();
  for (const field of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ]) {
    const values = manifest[field];
    if (!values || typeof values !== "object" || Array.isArray(values)) {
      continue;
    }
    for (const name of Object.keys(values)) {
      if (name.startsWith("@workspace/")) dependencies.add(name);
    }
  }
  return dependencies;
}

function meaningfulText(value, label) {
  assert.equal(typeof value, "string", `${label} must be a string`);
  const normalized = value.trim();
  assert.ok(normalized.length > 0, `${label} must not be empty`);
  return normalized;
}

function relativeRepositoryPath(value, label) {
  const normalized = posix.normalize(
    meaningfulText(value, label).replaceAll("\\", "/"),
  );
  assert.ok(
    normalized !== ".." &&
      !normalized.startsWith("../") &&
      !normalized.startsWith("/"),
    `${label} must stay within the repository`,
  );
  return normalized.replace(/^\.\//u, "");
}

export function parseWorkspaceAliasRules(
  source,
  { configPath, packageDirectory },
) {
  const parsed = ts.parseConfigFileTextToJson(configPath, source);
  assert.equal(
    parsed.error,
    undefined,
    `${configPath} must contain parseable JSON`,
  );
  const compilerOptions = parsed.config?.compilerOptions ?? {};
  const paths = compilerOptions.paths ?? {};
  assert.ok(
    paths && typeof paths === "object" && !Array.isArray(paths),
    `${configPath} compilerOptions.paths must be an object`,
  );
  const base = relativeRepositoryPath(
    posix.join(packageDirectory, compilerOptions.baseUrl ?? "."),
    `${configPath} compilerOptions.baseUrl`,
  );
  return Object.entries(paths).map(([pattern, rawTargets]) => {
    assert.ok(
      [...pattern.matchAll(/\*/gu)].length <= 1,
      `${configPath} alias ${pattern} may contain at most one wildcard`,
    );
    assert.ok(
      Array.isArray(rawTargets) && rawTargets.length === 1,
      `${configPath} alias ${pattern} must have one deterministic architecture target`,
    );
    const target = meaningfulText(
      rawTargets[0],
      `${configPath} alias ${pattern} target`,
    );
    const [prefix, suffix = ""] = pattern.split("*");
    return { pattern, prefix, suffix, target, base };
  });
}

export function resolveAliasTarget(rules, specifier) {
  const matches = rules
    .map((rule) => {
      if (!rule.pattern.includes("*")) {
        return specifier === rule.pattern ? { rule, wildcard: "" } : null;
      }
      if (
        !specifier.startsWith(rule.prefix) ||
        !specifier.endsWith(rule.suffix) ||
        specifier.length < rule.prefix.length + rule.suffix.length
      ) {
        return null;
      }
      return {
        rule,
        wildcard: specifier.slice(
          rule.prefix.length,
          specifier.length - rule.suffix.length,
        ),
      };
    })
    .filter(Boolean)
    .sort(
      (left, right) =>
        right.rule.prefix.length +
        right.rule.suffix.length -
        (left.rule.prefix.length + left.rule.suffix.length),
    );
  if (matches.length === 0) return null;
  const selected = matches[0];
  return relativeRepositoryPath(
    posix.join(
      selected.rule.base,
      selected.rule.target.replaceAll("*", selected.wildcard),
    ),
    `alias ${specifier}`,
  );
}

function propertyName(node) {
  if (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) return node.text;
  return null;
}

export function literalRuntimePolicyIds(source, path) {
  const ids = [];
  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "policy" &&
      node.arguments.length === 1 &&
      ts.isObjectLiteralExpression(node.arguments[0])
    ) {
      const idProperties = node.arguments[0].properties.filter(
        (property) =>
          ts.isPropertyAssignment(property) &&
          propertyName(property.name) === "id",
      );
      assert.equal(
        idProperties.length,
        1,
        `${path} policy entry must declare exactly one id`,
      );
      const initializer = idProperties[0].initializer;
      assert.ok(
        ts.isStringLiteralLike(initializer) &&
          !ts.isNoSubstitutionTemplateLiteral(initializer),
        `${path} policy id must be a string literal`,
      );
      ids.push(initializer.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile(source, path));
  assert.ok(ids.length > 0, `${path} exposes no policy() entries`);
  assert.equal(
    new Set(ids).size,
    ids.length,
    `${path} policy ids must be unique`,
  );
  return new Set(ids);
}

export function parseOpenApiOperations(source) {
  const operations = [];
  let currentPath = null;
  for (const line of source.split(/\r?\n/u)) {
    const pathMatch = /^\s{2}(\/[^:]+):\s*$/u.exec(line);
    if (pathMatch) {
      currentPath = pathMatch[1];
      continue;
    }
    const methodMatch = /^\s{4}([a-z]+):\s*$/u.exec(line);
    if (currentPath && methodMatch && HTTP_METHODS.has(methodMatch[1])) {
      operations.push({
        method: methodMatch[1].toUpperCase(),
        path: currentPath,
      });
    }
  }
  assert.ok(operations.length > 0, "OpenAPI must expose operations");
  const keys = operations.map(({ method, path }) => `${method} ${path}`);
  assert.equal(
    new Set(keys).size,
    keys.length,
    "OpenAPI contains duplicate operations",
  );
  return operations;
}

export function explicitNonOpenApiClassification(entry) {
  const value =
    entry.classification ??
    entry.exposure ??
    entry.availability ??
    entry.operationClassification;
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replaceAll("-", "_");
  return [
    "activation_gated",
    "internal_only",
    "internal_unmounted",
    "runtime_internal",
  ].includes(normalized)
    ? normalized
    : null;
}

export function routePrefixMatches(path, prefix) {
  return (
    prefix === "/" ||
    path === prefix ||
    (prefix.endsWith("/")
      ? path.startsWith(prefix)
      : path.startsWith(`${prefix}/`))
  );
}
