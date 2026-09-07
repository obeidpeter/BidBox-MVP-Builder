import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  assertReleaseIdentityIsDeploymentOnly,
  RELEASE_IDENTITY_SOURCE_CONFIG_PATHS,
} from "./release-config-policy.mjs";

const root = resolve(import.meta.dirname, "..");

async function loadJson(relativePath) {
  const source = await readFile(resolve(root, relativePath), "utf8");
  return JSON.parse(source);
}

async function loadText(relativePath) {
  return readFile(resolve(root, relativePath), "utf8");
}

function readTomlSection(source, name) {
  const lines = source.replaceAll("\r\n", "\n").split("\n");
  const header = `[${name}]`;
  const sectionStarts = lines.flatMap((line, index) =>
    line === header ? [index] : [],
  );
  assert.equal(
    sectionStarts.length,
    1,
    `Expected one ${header} section in the Replit configuration`,
  );

  const start = sectionStarts[0];
  const relativeEnd = lines
    .slice(start + 1)
    .findIndex((line) => /^\[\[?.+\]\]?$/.test(line));
  const end = relativeEnd === -1 ? lines.length : start + 1 + relativeEnd;
  return lines.slice(start + 1, end).join("\n");
}

const rulePack = await loadJson("config/rules/nigeria/v2026-08-08.json");
const alerts = await loadJson("config/observability/alerts.v2.5.json");
const dbPackage = await loadJson("lib/db/package.json");
const releaseIdentitySourceConfigurations = Object.fromEntries(
  await Promise.all(
    RELEASE_IDENTITY_SOURCE_CONFIG_PATHS.map(async (relativePath) => [
      relativePath,
      await loadText(relativePath),
    ]),
  ),
);
assertReleaseIdentityIsDeploymentOnly(releaseIdentitySourceConfigurations);
const replitConfiguration = releaseIdentitySourceConfigurations[".replit"];
const replitArtifactConfiguration =
  releaseIdentitySourceConfigurations[
    "artifacts/api-server/.replit-artifact/artifact.toml"
  ];
const replitProductionStartup = await loadText(
  "scripts/start-replit-production.mjs",
);
const replitMigrationLauncher = await loadText(
  "lib/db/scripts/replit-intake-migrations.mjs",
);
const legacyDeploymentConfiguration = readTomlSection(
  replitConfiguration,
  "deployment",
);
const artifactRunConfiguration = readTomlSection(
  replitArtifactConfiguration,
  "services.production.run",
);
const artifactRunEnvironment = readTomlSection(
  replitArtifactConfiguration,
  "services.production.run.env",
);

assert.equal(
  dbPackage.scripts?.["migration:replit:intake"],
  "node ./scripts/replit-intake-migrations.mjs",
  "The Replit deployment migration alias must execute the inspected bounded launcher",
);

assert.match(
  legacyDeploymentConfiguration,
  /^build = "PORT=3000 BASE_PATH=\/ NODE_ENV=production pnpm run build"$/m,
  "Replit publishing must build both production artifacts",
);
assert.match(
  legacyDeploymentConfiguration,
  /^run = "CORS_ALLOWED_ORIGINS=https:\/\/valo-mvp-builder\.replit\.app VALO_PUBLIC_LEAD_DESTINATION=database TRUST_PROXY=1 NODE_ENV=production node --enable-source-maps scripts\/start-replit-production\.mjs"$/m,
  "The legacy Replit deployment path must use the shared production startup wrapper",
);
assert.doesNotMatch(
  legacyDeploymentConfiguration,
  /&&|migration:replit:intake|artifacts\/api-server\/dist\/index\.mjs/,
  "The legacy Replit path must not duplicate or bypass the shared startup gate",
);
assert.match(
  artifactRunConfiguration,
  /^args = \["node", "--enable-source-maps", "scripts\/start-replit-production\.mjs"\]$/m,
  "The effective Replit API artifact must use the shared production startup wrapper",
);
assert.doesNotMatch(
  artifactRunConfiguration,
  /artifacts\/api-server\/dist\/index\.mjs|migration:replit:intake|&&/,
  "The effective Replit API artifact must not bypass or duplicate the shared startup gate",
);
for (const [name, value] of [
  ["PORT", "8080"],
  ["NODE_ENV", "production"],
  ["CORS_ALLOWED_ORIGINS", "https://valo-mvp-builder.replit.app"],
  ["VALO_PUBLIC_LEAD_DESTINATION", "database"],
  ["TRUST_PROXY", "1"],
]) {
  assert.match(
    artifactRunEnvironment,
    new RegExp(`^${name} = "${value.replaceAll(".", "\\.")}"$`, "m"),
    `The effective Replit API artifact must pin ${name}`,
  );
}
assert.doesNotMatch(
  `${legacyDeploymentConfiguration}\n${artifactRunEnvironment}`,
  /(?:PUBLIC_LEAD_RATE_LIMIT_HMAC_SECRET|VALO_PUBLIC_LEAD_RETENTION_DAYS)\s*=/,
  "Secrets and unapproved retention values must remain outside Replit source configuration",
);
assert.match(
  replitProductionStartup,
  /import \{ runReplitIntakeMigrations \} from "@workspace\/db\/replit-intake-migrations";/,
  "The shared production startup wrapper must import the bounded migration launcher through the database package boundary",
);
assert.match(
  replitProductionStartup,
  /"\.\.\/artifacts\/api-server\/dist\/index\.mjs",\s+import\.meta\.url,/,
  "The shared production startup wrapper must pin the compiled API entrypoint relative to its own file",
);
assert.match(
  replitProductionStartup,
  /await runMigrations\(environment\);[\s\S]*?await startSchedules\(\{ environment \}\);[\s\S]*?await importApiServer\(\);/,
  "The production startup wrapper must finish migrations, then validate any opted-in schedules, before importing the API",
);
assert.match(
  replitProductionStartup,
  /import\(API_SERVER_ENTRYPOINT\.href\)/,
  "The production startup wrapper must load the compiled API in-process after the gate",
);
assert.doesNotMatch(
  replitProductionStartup,
  /node:child_process|\b(?:exec|spawn|fork|execFile)\s*\(/,
  "The production startup wrapper must preserve process signals and inherited environment without a child shell",
);
assert.doesNotMatch(
  replitConfiguration,
  /PUBLIC_LEAD_RATE_LIMIT_HMAC_SECRET\s*=/,
  "The public-lead HMAC secret belongs in Replit Secrets, never source configuration",
);
assert.doesNotMatch(
  replitConfiguration,
  /VALO_PUBLIC_LEAD_RETENTION_DAYS\s*=/,
  "Public-lead retention must stay unset until an approved duration is recorded",
);
assert.match(
  replitMigrationLauncher,
  /environment\.NODE_ENV !== "production"/,
  "The deployment migration launcher must reject non-production execution",
);
assert.match(
  replitMigrationLauncher,
  /environment\.REPLIT_DEPLOYMENT !== "1"/,
  "The deployment migration launcher must reject non-Replit execution",
);
assert.match(
  replitMigrationLauncher,
  /pg_advisory_lock/,
  "The deployment migration launcher must wait on one session-affine autoscale lock",
);
assert.match(
  replitMigrationLauncher,
  /migrate\(drizzle\(lockClient\)/,
  "The deployment migration must execute on the advisory-lock session",
);
assert.match(
  replitMigrationLauncher,
  /SET search_path = public, pg_temp[\s\S]*SET search_path = pg_catalog/,
  "The deployment migration session must scope public resolution to migration execution and restore the catalog-only path",
);
assert.match(
  replitMigrationLauncher,
  /validateReplitMigrationJournal\(beforeRows\)/,
  "The deployment migration launcher must verify the production journal before mutation",
);
assert.doesNotMatch(
  replitMigrationLauncher,
  /postgres(?:ql)?:\/\/[^\s"']+@/,
  "The deployment migration launcher must not contain a database credential literal",
);

assert.equal(
  rulePack.jurisdiction,
  "NG",
  "Nigeria rule pack must be jurisdiction scoped",
);
assert.ok(
  Array.isArray(rulePack.rules) && rulePack.rules.length > 0,
  "Nigeria rules are required",
);
for (const rule of rulePack.rules) {
  assert.match(
    rule.ruleId,
    /^NG-/,
    `Rule ${rule.ruleId ?? "<missing>"} needs a stable NG id`,
  );
  assert.ok(
    Array.isArray(rule.sourceUrls) && rule.sourceUrls.length > 0,
    `${rule.ruleId} needs an authoritative source URL`,
  );
  assert.ok(rule.effectiveFrom, `${rule.ruleId} needs an effective-from date`);
  assert.ok(rule.jurisdiction, `${rule.ruleId} needs jurisdiction scope`);
  assert.ok(rule.legalReviewStatus, `${rule.ruleId} needs legal-review status`);
}

const requiredAlerts = new Set([
  "api_error_rate",
  "processing_job_failure_rate",
  "extraction_quality_regression",
  "tenant_access_denials_spike",
  "sla_breach",
  "notification_delivery_failure",
  "unit_cost_budget",
  "deployment_health",
  "backup_freshness",
  "audit_anchor_failure",
  "break_glass_use",
]);
for (const alert of alerts.alerts ?? []) {
  assert.ok(alert.id, "Every alert needs an id");
  assert.ok(alert.severity, `${alert.id} needs a severity`);
  assert.ok(alert.signal, `${alert.id} needs a signal`);
  assert.ok(alert.condition, `${alert.id} needs a condition`);
  assert.ok(alert.runbook, `${alert.id} needs a runbook`);
  requiredAlerts.delete(alert.id);
}
assert.deepEqual(
  [...requiredAlerts],
  [],
  "Mandatory operational alerts are missing",
);

console.log(
  `release configuration valid: ${rulePack.rules.length} rules, ${alerts.alerts.length} alerts`,
);
