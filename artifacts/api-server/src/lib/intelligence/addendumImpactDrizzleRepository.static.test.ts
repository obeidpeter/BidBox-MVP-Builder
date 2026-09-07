import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const repository = readFileSync(
  new URL("./addendumImpactDrizzleRepository.ts", import.meta.url),
  "utf8",
);
const service = readFileSync(
  new URL("./addendumImpactService.ts", import.meta.url),
  "utf8",
);

test("exact tenant, project and document-version bindings select one assessment revision", () => {
  assert.match(
    repository,
    /eq\(documents\.organisationId, scope\.organisationId\)/u,
  );
  assert.match(repository, /eq\(documents\.projectId, projectId\)/u);
  assert.match(repository, /selection\.baselineVersionId/u);
  assert.match(repository, /selection\.revisionVersionId/u);
  assert.match(
    repository,
    /baselineDocumentVersionId,[\s\S]*input\.baselineDocumentVersionId/u,
  );
  assert.match(
    repository,
    /revisionDocumentVersionId,[\s\S]*input\.revisionDocumentVersionId/u,
  );
  assert.match(repository, /radarId, input\.radarId/u);
  assert.match(repository, /assessmentId,\s*input\.assessmentId/u);
  assert.match(
    repository,
    /impactManifestSha256,\s*input\.impactManifestSha256/u,
  );
});

test("v2 source chains bind bytes, canonical origins and immediate verified predecessors", () => {
  assert.match(repository, /valo\.addendum-structured-snapshot\/v2/u);
  assert.match(
    repository,
    /documentVersionSha256:\s*documentVersionSnapshots\.documentVersionSha256/u,
  );
  assert.match(repository, /row\.documentVersionSha256 !== row\.bytesSha256/u);
  assert.match(
    repository,
    /supersedesVersionId:\s*documentVersions\.supersedesVersionId/u,
  );
  assert.match(
    repository,
    /candidate\.snapshot\.sourceId !== candidate\.documentId/u,
  );
  assert.match(
    repository,
    /`document:\$\{candidate\.documentId\}:version:\$\{candidate\.documentVersionId\}`/u,
  );
  assert.match(
    repository,
    /latestOlder\?\.documentVersionId !== baseVersionId/u,
  );
  assert.match(
    repository,
    /candidate\.supersedesVersionId !== candidate\.snapshot\.baseVersionId/u,
  );
});

test("immutable source identity and mutable target-plan identity are stored separately", () => {
  assert.match(
    repository,
    /sourceManifestSha256: assessment\.sourceManifestSha256/u,
  );
  assert.match(
    repository,
    /impactManifestSha256: assessment\.impactManifestSha256/u,
  );
  assert.match(
    repository,
    /sourceManifestSha256:\s*input\.assessment\.sourceManifestSha256/u,
  );
  assert.doesNotMatch(
    repository,
    /sourceManifestSha256:\s*input\.impactManifestSha256/u,
  );
});

test("review and apply remain separate, CAS-bound audited transactions", () => {
  const review = repository.slice(repository.indexOf("async recordReview"));
  const apply = repository.slice(repository.indexOf("async applyReopening"));
  assert.match(review, /this\.database\.transaction/u);
  assert.match(review, /eventType: "addendum_impact\.review_recorded"/u);
  assert.doesNotMatch(
    review.slice(0, review.indexOf("async findApplicationReplay")),
    /applyTargetMutation/u,
  );
  assert.match(
    apply,
    /eq\(addendumImpactAssessments\.version, assessment\.version\)/u,
  );
  assert.match(
    apply,
    /eq\(addendumImpactAssessments\.appliedState, "not_applied"\)/u,
  );
  assert.match(
    apply,
    /eventType: "addendum_impact\.controlled_reopening_applied"/u,
  );
});

test("terminal review rows and items are append-only with exact-command replay", () => {
  const review = repository.slice(
    repository.indexOf("async recordReview"),
    repository.indexOf("async findApplicationReplay"),
  );
  assert.match(review, /existing && sameReview\(existing, input\)/u);
  assert.match(repository, /input\.expectedAssessmentVersion === 0/u);
  assert.match(review, /existing \|\|/u);
  assert.match(review, /\.insert\(addendumImpactAssessments\)/u);
  assert.match(review, /\.insert\(addendumImpactItems\)/u);
  assert.equal(
    review.match(/\.update\(addendumImpactAssessments\)/gu)?.length,
    1,
  );
  assert.equal(review.match(/\.update\(addendumImpactItems\)/gu)?.length, 1);
  assert.match(
    review,
    /update\(addendumImpactAssessments\)[\s\S]*reviewState, "pending_review"[\s\S]*version, 1/u,
  );
  assert.match(
    review,
    /update\(addendumImpactItems\)[\s\S]*reviewState, "pending_review"[\s\S]*version, 1/u,
  );
  assert.match(
    review,
    /reviewState: reviewState\(input\.decision\)[\s\S]*version: 2/u,
  );
});

test("review and apply lock and recompute the exact current v2 plan in-transaction", () => {
  assert.match(
    repository,
    /valo\.membership-administration:\$\{scope\.organisationId\}/u,
  );
  assert.match(
    repository,
    /valo\.document-snapshot-series:\$\{scope\.organisationId\}:\$\{projectId\}:\$\{sourceId\}/u,
  );
  assert.match(repository, /loadCurrentAddendumImpactPlan\([\s\S]*true/u);
  assert.match(repository, /assertCurrentPlanIdentity/u);
  assert.match(repository, /projectQuery\.for\("update"\)/u);
  assert.match(repository, /query\.for\("share"\)/u);
  assert.match(repository, /requirementQuery\.for\("share"\)/u);
});

test("apply denies current-byte, redaction or predecessor drift before target mutation", () => {
  const apply = repository.slice(repository.indexOf("async applyReopening"));
  const acquire = apply.indexOf("acquireAddendumMutationLocks");
  const recompute = apply.indexOf("loadCurrentAddendumImpactPlan");
  const identity = apply.indexOf("assertCurrentPlanIdentity");
  const mutation = apply.indexOf("applyTargetMutation");
  assert.ok(acquire >= 0);
  assert.ok(recompute > acquire);
  assert.ok(identity > recompute);
  assert.ok(mutation > identity);
  assert.match(repository, /row\.documentVersionSha256 !== row\.bytesSha256/u);
  assert.match(
    repository,
    /candidate\.capturedRedactionStatus === candidate\.redactionStatus/u,
  );
  assert.match(
    repository,
    /latestOlder\?\.documentVersionId !== baseVersionId/u,
  );
});

test("verified-series ordering never filters out an ineligible intermediary", () => {
  const loader = repository.slice(
    repository.indexOf("async function loadVersionCandidates"),
    repository.indexOf("async function loadCurrentAddendumImpactPlan"),
  );
  assert.doesNotMatch(
    loader,
    /eq\(documentVersions\.malwareStatus, "clean"\)/u,
  );
  assert.doesNotMatch(
    loader,
    /eq\(documentVersions\.quarantineStatus, "cleared"\)/u,
  );
  assert.doesNotMatch(
    loader,
    /documents\.redactionStatus\} IN \('redacted', 'included'\)/u,
  );
  assert.match(repository, /!candidateIsCurrentlyEligible\(cursor\)/u);
});

test("target mismatch throws inside the same transaction before plan state and audit commit", () => {
  const apply = repository.slice(repository.indexOf("async applyReopening"));
  const targetLoop = apply.indexOf("await applyTargetMutation");
  const appliedCas = apply.indexOf(".update(addendumImpactAssessments)");
  const audit = apply.indexOf("await this.auditWriter");
  assert.ok(targetLoop >= 0);
  assert.ok(appliedCas > targetLoop);
  assert.ok(audit > appliedCas);
  assert.match(
    repository,
    /if \(rows\.length !== 1\)[\s\S]*PersistenceConflict\("stale"\)/u,
  );
});

test("same-command replay is resolved before rebuilding a now-stale target plan", () => {
  const replay = service.indexOf("findApplicationReplay");
  const load = service.indexOf("const snapshot = await this.load", replay);
  assert.ok(replay >= 0);
  assert.ok(load > replay);
  assert.match(
    repository,
    /row\.version === input\.expectedAssessmentVersion \+ 1/u,
  );
  assert.match(
    repository,
    /return \{ outcome: "replayed" as const, value: replay \}/u,
  );
});

test("invalidation preserves historical approval and report authority", () => {
  const targetMutation = repository.slice(
    repository.indexOf("async function applyTargetMutation"),
    repository.indexOf("function parsedStoredAction"),
  );
  assert.doesNotMatch(targetMutation, /decidedByUserId:\s*null/u);
  assert.doesNotMatch(targetMutation, /decidedAt:\s*null/u);
  assert.doesNotMatch(targetMutation, /reviewerId:\s*null/u);
  assert.doesNotMatch(targetMutation, /attestation:\s*null/u);
  assert.doesNotMatch(targetMutation, /signedOffAt:\s*null/u);
  assert.match(repository, /preservedHistoricalAuthority/u);
});

test("repository repeats two-person and direct-membership controls", () => {
  assert.match(repository, /input\.scope\.source !== "membership"/u);
  assert.match(repository, /input\.scope\.membershipId/u);
  assert.match(
    repository,
    /storedReview\.reviewerUserId === input\.scope\.actorUserId/u,
  );
  assert.match(repository, /segregationOfDuties/u);
});

test("project reopening keeps the persisted reviewer gate and denies legacy null authority", () => {
  const targetMutation = repository.slice(
    repository.indexOf("async function applyTargetMutation"),
    repository.indexOf("function parsedStoredAction"),
  );
  assert.match(targetMutation, /reviewerId: current\.reviewerId/u);
  assert.doesNotMatch(targetMutation, /reviewerId: input\.scope\.actorUserId/u);
  assert.match(
    targetMutation,
    /if \(!transition\.ok\) throw new AddendumImpactPersistenceConflict\("stale"\)/u,
  );
});

test("terminal target states and no-op mutations cannot create repeat applications", () => {
  assert.match(
    repository,
    /isPendingAddendumImpactMutationTarget\(\s*"requirement",\s*requirement\.reviewStatus/u,
  );
  assert.match(
    repository,
    /isPendingAddendumImpactMutationTarget\("work_task", task\.status\)/u,
  );
  assert.match(
    repository,
    /isPendingAddendumImpactMutationTarget\("boq_check", check\.status\)/u,
  );
  assert.match(repository, /mutation\.fromState === mutation\.toState/u);
});
