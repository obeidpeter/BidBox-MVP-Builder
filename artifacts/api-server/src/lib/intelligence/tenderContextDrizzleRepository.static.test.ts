import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(
  new URL("./tenderContextDrizzleRepository.ts", import.meta.url),
  "utf8",
);

test("tender writes recheck direct authority in their tenant transaction", () => {
  assert.match(source, /withTenantDatabase\(scope\.organisationId/u);
  assert.match(source, /this\.database\.transaction/u);
  assert.match(source, /organisationMemberships\.delegatedByMembershipId/u);
  assert.match(source, /organisationMemberships\.accessStartsAt/u);
  assert.match(source, /organisationMemberships\.accessExpiresAt/u);
  assert.match(source, /roleGrants\.revokedAt/u);
  assert.match(source, /PROPOSE_PERMISSIONS/u);
  assert.match(source, /REVIEW_PERMISSIONS/u);
});

test("maker-checker review rejects the source-record creator", () => {
  assert.equal(
    [...source.matchAll(/current\.createdByUserId === actor\.id/gu)].length,
    2,
  );
});

test("acceptance locks and CAS-supersedes at most one exact predecessor", () => {
  assert.match(
    source,
    /eq\(tenderContextVersions\.status, "accepted"\)[\s\S]*\.limit\(2\)[\s\S]*\.for\("update"\)/u,
  );
  assert.match(source, /if \(acceptedRows\.length > 1\)/u);
  assert.match(
    source,
    /eq\(tenderContextVersions\.id, acceptedPredecessor\.id\)[\s\S]*eq\([\s\S]*tenderContextVersions\.version,[\s\S]*acceptedPredecessor\.version/u,
  );
  assert.match(source, /if \(superseded\.length !== 1\)/u);
  assert.match(source, /eventType: "tender_context\.superseded"/u);
  assert.match(source, /supersededByContextVersionId: contextVersionId/u);
  assert.doesNotMatch(
    source,
    /status: "superseded",[\s\S]{0,500}sql`\$\{tenderContextVersions\.version\} \+ 1`/u,
  );
});

test("context and eligibility sources are immutable and audited", () => {
  assert.match(source, /tenderContextRequirements\)\.values/u);
  assert.match(source, /tenderContextArtifacts\)\.values/u);
  assert.match(
    source,
    /verifyBindings\(transaction, scope, context, snapshot\)/u,
  );
  assert.match(source, /async function revalidateCurrentArtifactAuthority\(/u);
  for (const currentAuthorityField of [
    "row.item.status",
    "row.item.sourceDocumentId",
    "row.itemVersion.verificationState",
    "row.itemVersion.withdrawnAt",
  ]) {
    assert.match(
      source,
      new RegExp(currentAuthorityField.replace(".", "\\."), "u"),
    );
  }
  assert.match(
    source,
    /row\.snapshot\.documentVersionSha256[\s\S]*row\.documentVersion\.sha256/u,
  );
  assert.match(source, /citationQuoteSha256: sha256Text/u);
  assert.match(source, /eventType: "tender_context\.created"/u);
  assert.match(source, /eventType: "tender_context\.reviewed"/u);
  assert.match(source, /eventType: "tender_eligibility_passport\.created"/u);
  assert.match(source, /eventType: "tender_eligibility_passport\.reviewed"/u);
});

test("derived persistence envelopes are bounded before any authoritative insert", () => {
  const contextBound = source.indexOf(
    "TENDER_CONTEXT_BOUNDS.sourceManifestCodeUnits",
  );
  const contextInsert = source.indexOf(
    "transaction.insert(tenderContextVersions)",
  );
  const resultBound = source.indexOf(
    "TENDER_CONTEXT_BOUNDS.eligibilityResultCodeUnits",
  );
  const passportInsert = source.indexOf(
    "transaction.insert(tenderEligibilityPassports)",
  );
  assert.ok(contextBound >= 0 && contextBound < contextInsert);
  assert.ok(resultBound >= 0 && resultBound < passportInsert);
  for (const bound of [
    "sourceManifestBytes",
    "contextSnapshotCodeUnits",
    "contextSnapshotBytes",
    "ruleAdvisoriesCodeUnits",
    "ruleAdvisoriesBytes",
    "eligibilityResultBytes",
  ]) {
    assert.match(source, new RegExp(`TENDER_CONTEXT_BOUNDS\\.${bound}`, "u"));
  }
  assert.equal(
    [...source.matchAll(/serializedTenderValueWithinBound\(/gu)].length,
    4,
  );
});

test("read options are bounded, human-labelled and restricted to currently eligible authority", () => {
  assert.match(source, /async function loadSelectionOptions\(/u);
  for (const bound of [
    "primaryDocumentOptions",
    "rulePackOptions",
    "requirementOptions",
    "companyEvidenceOptions",
  ]) {
    assert.match(source, new RegExp(`TENDER_CONTEXT_BOUNDS\\.${bound}`, "u"));
  }
  for (const eligibilityCondition of [
    'eq(jurisdictionRulePacks.status, "approved")',
    'eq(users.status, "active")',
    'inArray(requirements.reviewStatus, ["confirmed", "edited"])',
    'eq(requirementCitations.verificationStatus, "verified")',
    'eq(vaultItemVersions.verificationState, "approved")',
    "isNull(vaultItemVersions.withdrawnAt)",
    'eq(vaultItems.status, "active")',
    'eq(documentVersionSnapshots.status, "verified")',
  ]) {
    assert.ok(source.includes(eligibilityCondition), eligibilityCondition);
  }
  assert.match(
    source,
    /freshnessNote: TENDER_CONTEXT_SELECTION_FRESHNESS_NOTE/u,
  );
  assert.match(
    source,
    /const label = `\$\{pack\.packKey\} — version \$\{pack\.version\}`/u,
  );
  assert.match(source, /sourceDocumentName: documents\.filename/u);
  assert.match(source, /approvedByName,/u);
});

test("read options project bounded metadata without materialising canonical snapshots", () => {
  const selectionLoader = source.slice(
    source.indexOf("async function loadSelectionOptions("),
    source.indexOf("async function readCentreTx("),
  );

  assert.doesNotMatch(selectionLoader, /snapshot:\s*documentVersionSnapshots/u);
  assert.doesNotMatch(selectionLoader, /document:\s*documents/u);
  assert.doesNotMatch(selectionLoader, /canonicalText/u);
  assert.match(selectionLoader, /documentId: documents\.id/u);
  assert.match(selectionLoader, /requirementId: requirements\.id/u);
  assert.match(selectionLoader, /vaultItemVersionId: vaultItemVersions\.id/u);
  assert.match(
    selectionLoader,
    /canonicalSnapshotSelectionEligibilitySql\(\)/u,
  );
  assert.match(selectionLoader, /uniqueVerifiedRequirementSnippetSql\(\)/u);
  assert.match(selectionLoader, /SELECTION_OPTION_TEXT_BOUNDS\.description/u);
  assert.match(selectionLoader, /SELECTION_OPTION_TEXT_BOUNDS\.filename/u);
  assert.match(selectionLoader, /SELECTION_OPTION_TEXT_BOUNDS\.issuer/u);
  assert.match(selectionLoader, /SELECTION_OPTION_TEXT_BOUNDS\.label/u);
  assert.match(
    source,
    /pg_catalog\.sha256\([\s\S]*documentVersionSnapshots\.canonicalText/u,
  );
  assert.match(
    source,
    /pg_catalog\.substr\([\s\S]*pg_catalog\.strpos\([\s\S]*\+ 1/u,
  );
});

test("advertised NG rule packs share final-load rule eligibility", () => {
  assert.match(
    source,
    /jurisdictionRulePacks\.jurisdiction\} ~ '\^NG\(\?:-\[A-Z0-9\]\{1,12\}\)\?\$'/u,
  );
  assert.match(
    source,
    /pg_catalog\.count\(\$\{jurisdictionRules\.id\}\) BETWEEN 1 AND \$\{MAX_RULES\}/u,
  );
  assert.match(
    source,
    /pg_catalog\.bool_and\(\$\{jurisdictionRuleEligibilitySql\(\)\}\)/u,
  );
  assert.match(
    source,
    /eligibleForTenderContext: jurisdictionRuleEligibilitySql\(\)/u,
  );
  assert.equal(
    [...source.matchAll(/jurisdictionRuleEligibilitySql\(\)/gu)].length,
    3,
  );
  assert.match(source, /pg_catalog\.pg_input_is_valid/u);
  assert.match(source, /pg_catalog\.jsonb_array_elements/u);
  assert.match(source, /pg_catalog\.jsonb_typeof\(entry\.value\) = 'string'/u);
  assert.doesNotMatch(source, /pg_catalog\.jsonb_array_elements_text/u);
  assert.match(source, /rows\.length > MAX_RULES/u);
  assert.match(
    source,
    /rows\.some\(\(\{ eligibleForTenderContext \}\) => !eligibleForTenderContext\)/u,
  );
});

test("the authoritative create lookup rechecks the exact current primary version", () => {
  const resolution = source.slice(
    source.indexOf("async function resolveContextMaterial("),
    source.indexOf("async function loadSelectionOptions("),
  );
  for (const exactCurrentCondition of [
    'eq(documents.extractionStatus, "extracted")',
    "eq(documentVersions.objectPath, documents.objectPath)",
    "eq(documentVersions.sha256, documents.sha256)",
    "eq(documentVersions.sizeBytes, documents.size)",
  ]) {
    assert.ok(
      resolution.includes(exactCurrentCondition),
      exactCurrentCondition,
    );
  }
  assert.match(
    resolution,
    /sourceDocument\(primary, "solicitation", "authoritative"\)/u,
  );
  assert.match(
    resolution,
    /rulePack: await loadRulePack\(transaction, draft\)/u,
  );
});
