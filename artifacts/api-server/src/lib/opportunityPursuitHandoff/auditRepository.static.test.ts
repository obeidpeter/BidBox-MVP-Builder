import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./auditRepository.ts", import.meta.url),
  "utf8",
);

test("write transaction shares the membership writer lock and rechecks database-time authority", () => {
  assert.match(source, /valo\.membership-administration:\$\{organisationId\}/u);
  assert.match(source, /pg_catalog\.clock_timestamp\(\)/u);
  assert.match(
    source,
    /lockMembershipAdministrationBoundary\(tx, scope\.organisationId\)[\s\S]*?lockOpportunitySourceNetwork\(tx, scope\.organisationId\)[\s\S]*?requireCurrentActor\(tx, scope, authorityTime\)[\s\S]*?lockOpportunityPursuitConflictBoundary/u,
  );
  const checks = source.match(
    /requireCurrentActor\(tx, scope, authorityTime\)/gu,
  );
  assert.ok((checks?.length ?? 0) >= 2);
  assert.match(source, /loadReviewers\(tx, scope, authorityTime\)/u);
  assert.doesNotMatch(source, /FOR (?:UPDATE|SHARE) OF grant_row/u);
});

test("source materialisation stays in the locked caller transaction", () => {
  assert.match(
    source,
    /lockOpportunitySourceNetwork\(tx, scope\.organisationId\)[\s\S]*?#loadCandidate\(tx, scope, candidateId\)/u,
  );
  assert.match(source, /loadOpportunitySourceCandidateTx\(/u);
  assert.doesNotMatch(
    source,
    /OpportunitySourceNetworkService|AuditOpportunitySourceRepository/u,
  );
});

test("tender and lot conflict identities are canonical from read through write", () => {
  assert.match(
    source,
    /canonicalOpportunityPursuitConflictValue\([\s\S]*?normalize\("NFC"\)[\s\S]*?replace\(\/\\s\+\/gu, " "\)/u,
  );
  assert.match(
    source,
    /const reference = canonicalOpportunityPursuitConflictValue\([\s\S]*?references\.has\(reference\)[\s\S]*?reference,/u,
  );
  assert.match(source, /regexp_replace\(normalize\(pg_catalog\.btrim/u);
  assert.match(source, /lot: selectedLotReference/u);
  const lotCas = source.indexOf(
    "lot.version !== draft.expectedTenderLotVersion",
  );
  const projectInsert = source.indexOf(".insert(projects)", lotCas);
  assert.ok(lotCas >= 0 && projectInsert > lotCas);
  assert.match(
    source.slice(lotCas, projectInsert),
    /lot\.reference !== draft\.confirmedLotReference[\s\S]*?"conflict"/u,
  );
  const clientCas = source.indexOf(
    "clientRows[0].version !== draft.expectedClientVersion",
  );
  assert.ok(clientCas >= 0 && projectInsert > clientCas);
});

test("current selected-lot conflict fails before draft persistence", () => {
  const guard = source.indexOf("if (matched) {");
  const projectInsert = source.indexOf(".insert(projects)", guard);
  const receiptWrite = source.indexOf("await writeAuditTx", guard);
  assert.ok(guard >= 0);
  assert.ok(projectInsert > guard);
  assert.ok(receiptWrite > projectInsert);
  assert.match(
    source.slice(guard, projectInsert),
    /throw new OpportunityPursuitHandoffError\([\s\S]*?"conflict"/u,
  );
  assert.doesNotMatch(source, /insert\(conflictRecords\)/u);
});

test("idempotent replay is exact and precedes every project insert", () => {
  const replay = source.indexOf('outcome: "replayed"');
  const insert = source.indexOf(".insert(projects)");
  assert.ok(replay >= 0 && replay < insert);
  assert.match(
    source,
    /keyReceipt\.candidateId !== candidateId[\s\S]*?keyReceipt\.requestSha256 !== draft\.requestSha256[\s\S]*?keyReceipt\.confirmedByUserId !== scope\.actorUserId/u,
  );
});

test("created pursuit is intake-only and provider disconnected", () => {
  assert.match(source, /status: "intake"/u);
  assert.match(source, /paymentStatus: "pending"/u);
  assert.match(source, /conflictStatus: "clear"/u);
  assert.doesNotMatch(source, /fetch\(|axios|undici|got\(/u);
});
