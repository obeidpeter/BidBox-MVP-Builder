import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("canonical evidence uses bounded DB-side current-version filtering", async () => {
  const source = await readFile(
    new URL("./canonicalEvidence.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /NOT EXISTS \([\s\S]*later_version\.version_number > current_version\.version_number/u,
  );
  assert.match(source, /LIMIT \$\{limit \+ 1\}/u);
  assert.match(source, /await lockCompatibleAdvisoryKey\(/u);
  assert.match(
    source,
    /valo:canonical-evidence:\$\{organisationId\}:\$\{sha256\}/u,
  );
  assert.doesNotMatch(source, /limit \* 4|limit \* 16/u);
  assert.doesNotMatch(source, /count\(\*\) OVER/u);
  assert.match(source, /TRUE AS "privacyEligible"/u);
});

test("document registration takes the same digest lock before insertion", async () => {
  const source = await readFile(
    new URL("../routes/documents.ts", import.meta.url),
    "utf8",
  );
  const lockAt = source.indexOf(
    "await lockCanonicalEvidenceDigest(organisationId, sha256)",
  );
  const insertAt = source.indexOf(".insert(documents)", lockAt);
  assert.ok(lockAt >= 0, "document registration must take the digest lock");
  assert.ok(insertAt > lockAt, "digest lock must precede document insertion");
});

test("document registration bounds the legacy duplicate-hash lookup", async () => {
  const source = await readFile(
    new URL("../routes/documents.ts", import.meta.url),
    "utf8",
  );
  const lookupStart = source.indexOf("const knownTenantHashes");
  const inspectionAt = source.indexOf(
    "const inspection = await inspectDocumentIntake",
    lookupStart,
  );
  const lookup = source.slice(lookupStart, inspectionAt);
  assert.ok(lookupStart >= 0 && inspectionAt > lookupStart);
  assert.match(lookup, /eq\(documents\.sha256, measuredSha256\)/u);
  assert.match(lookup, /\.limit\(1\)/u);
});
