import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./repository.ts", import.meta.url),
  "utf8",
);

test("repository selects minimised fields and never lists subject references", () => {
  assert.doesNotMatch(source, /requesterReference/u);
  assert.doesNotMatch(source, /subjectReference/u);
  assert.match(source, /responseEvidencePresent/u);
  assert.match(source, /approvalEvidencePresent/u);
  assert.doesNotMatch(source, /\.select\(\)\s*\.from\(dataSubjectRequests\)/u);
  assert.doesNotMatch(source, /\.select\(\)\s*\.from\(consentRecords\)/u);
});

test("repository uses tenant-RLS context plus explicit organisation predicates", () => {
  assert.match(source, /withTenantDatabase\(scope\.organisationId/u);
  assert.match(
    source,
    /eq\(dataSubjectRequests\.organisationId, scope\.organisationId\)/u,
  );
  assert.match(
    source,
    /eq\(consentRecords\.organisationId, scope\.organisationId\)/u,
  );
  assert.match(
    source,
    /eq\(legalHolds\.organisationId, scope\.organisationId\)/u,
  );
  assert.match(
    source,
    /eq\(subprocessors\.organisationId, scope\.organisationId\)/u,
  );
  assert.match(
    source,
    /eq\(crossBorderTransfers\.organisationId, scope\.organisationId\)/u,
  );
});

test("every workflow is CAS-bound and atomically appends the audit chain", () => {
  assert.ok(
    (source.match(/eq\([^,]+\.version, command\.expectedVersion\)/gu) ?? [])
      .length >= 3,
  );
  assert.ok((source.match(/writeAuditTx\(transaction/gu) ?? []).length >= 3);
  assert.ok(
    (source.match(/isolationLevel: "read committed"/gu) ?? []).length >= 3,
  );
  assert.doesNotMatch(source, /\.delete\(/u);
  assert.doesNotMatch(source, /fetch\(|axios|twilio|sendgrid|provider/iu);
});

test("mutations revalidate a current direct named privacy authority", () => {
  assert.match(
    source,
    /eq\(organisationMemberships\.organisationId, organisationId\)/u,
  );
  assert.match(
    source,
    /isNull\(organisationMemberships\.delegatedByMembershipId\)/u,
  );
  assert.match(source, /eq\(users\.status, "active"\)/u);
  assert.match(source, /inArray\(roleGrants\.role/u);
  assert.match(source, /PRIVACY_MANAGE_ROLES/u);
});

test("every privacy mutation stabilises membership authority before reads and writes", () => {
  assert.match(
    source,
    /pg_advisory_xact_lock\([\s\S]*bidbox\.membership-administration:\$\{organisationId\}/u,
  );
  const methods = [
    ["async triageDataSubjectRequest", "async recordConsentWithdrawal"],
    ["async recordConsentWithdrawal", "async recordLegalHoldReview"],
    [
      "async recordLegalHoldReview",
      "export const postgresPrivacyOperationsRepository",
    ],
  ] as const;
  for (const [start, end] of methods) {
    const method = source.slice(source.indexOf(start), source.indexOf(end));
    const lockAt = method.indexOf("lockPrivacyMembershipAdministration(");
    const timeAt = method.indexOf("const authorityNow = new Date()", lockAt);
    const actorAt = method.indexOf("await actorForAudit(", timeAt);
    const stateReadAt = method.indexOf("await transaction", actorAt);
    const mutationAt = method.indexOf(".update(", stateReadAt);
    assert.ok(lockAt >= 0, `${start} is missing the membership lock`);
    assert.ok(timeAt > lockAt, `${start} must evaluate time after lock wait`);
    assert.ok(actorAt > timeAt, `${start} must recheck actor after the lock`);
    assert.ok(
      stateReadAt > actorAt,
      `${start} reads state before actor recheck`,
    );
    assert.ok(
      mutationAt > stateReadAt,
      `${start} mutates before authority reads`,
    );
  }
});

test("privacy and membership writers share the exact advisory namespace", () => {
  const organisations = readFileSync(
    new URL("../../routes/organisations.ts", import.meta.url),
    "utf8",
  );
  const namespace = "bidbox.membership-administration:${organisationId}";
  assert.ok(source.includes(namespace));
  assert.ok(organisations.includes(namespace));
});

test("DSR assignment rejects inactive, delegated, or unnamed members", () => {
  const triage = source.slice(
    source.indexOf("async triageDataSubjectRequest"),
    source.indexOf("async recordConsentWithdrawal"),
  );
  assert.match(triage, /innerJoin\(users/u);
  assert.match(
    triage,
    /isNull\(organisationMemberships\.delegatedByMembershipId\)/u,
  );
  assert.match(triage, /eq\(users\.status, "active"\)/u);
  assert.match(triage, /assignee\.name !== assignee\.name\.trim\(\)/u);
});

test("hold review records evidence but cannot release or delete a hold", () => {
  const reviewMethod = source.slice(
    source.indexOf("async recordLegalHoldReview"),
  );
  assert.match(reviewMethod, /eq\(legalHolds\.status, "active"\)/u);
  assert.doesNotMatch(reviewMethod, /status:\s*"released"/u);
  assert.doesNotMatch(reviewMethod, /releasedAt|releasedByUserId/u);
});
