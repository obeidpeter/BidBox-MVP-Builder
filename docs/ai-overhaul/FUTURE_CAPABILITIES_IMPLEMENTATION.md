# Future intelligence capabilities: implementation handoff

Status: **deterministic evidence and named review connected; production model execution remains disabled**.

This handoff covers the twenty-two Intelligence Centre capabilities in the
current working tree. The capability outputs remain deterministic and
read-only: they project tenant-scoped, human-review decision support from
records BidBox already holds. The connected Review Inbox can persist a named
person's claim or review disposition, but that review metadata is not an
authoritative evidence approval, package release or model-execution decision.
No route in this delivery calls an AI provider.

No provider calls were made while implementing or validating this capability
set. BidBox does not autonomously send a clarification, submit a tender, approve
evidence or a package, select or change a price, or make or predict an award
decision. The existing dormant schema was reused; this work adds no database
migration.

## What is connected now

- `GET /projects/{id}/intelligence` requires the complete server-side
  read-authority set for every returned data class. It returns a
  content-minimised snapshot, deterministic evidence-layer summary and Review
  Inbox for exactly one server-authorised pursuit.
- `POST /projects/{id}/intelligence/evidence-search` performs bounded lexical
  retrieval over the exact current manifest of accepted, verified spans. It
  validates tenant, project, actor permissions, document visibility, source
  versions and hashes and fails closed on stale manifests. Every match marks
  document text with `instructionAuthority: none`. It invokes no model, vector
  service or external tool and writes no search output.
- `POST /projects/{id}/intelligence/reviews/claim` and
  `POST /projects/{id}/intelligence/reviews/decision` persist named review
  responsibility and dispositions with source-manifest and optimistic-version
  checks. They require explicit `intelligence:review` authority, emit audit
  events and never approve source evidence, release a package or authorise
  model execution.
- The Intelligence read and evidence-search routes return explicit
  empty/partial/restricted states or `abstain`/`blocked` dispositions as
  applicable and set `Cache-Control: private, no-store`.
- The snapshot joins existing project, document/version, requirement/citation,
  evidence, Vault, capability, draft/claim, defect, BOQ, package, report, task,
  opportunity and outcome records. Missing evidence stays missing; it is never
  converted into an approval, score or inferred obligation.
- `/intelligence` is a protected Intelligence Centre screen with pursuit
  selection, loading/error/empty/partial/restricted handling, source locators,
  the Review Inbox and the human-control boundary for every card.
- The OpenAPI operations and generated clients expose the same twenty-two-item,
  evidence-search and named-review contracts.
  `productionAiEnabled` is intentionally `false` for this release.
- Pure, deterministic domain functions provide fail-closed building blocks for
  all twenty-two capabilities. They validate source scope, versions, exact
  citations, review state and bounded inputs where applicable; they do not
  persist capability outputs or perform external actions. Only the separate,
  named Review Inbox workflow persists human review metadata.

The connected evidence layer resolves whether a citation's verifier is a
currently active, direct member of the same tenant with a current native role
grant containing `evidence:approve`. Existing rows do not contain an immutable
attestation of the verifier's authority at the historical verification time.
The current-state check must therefore not be represented as historical proof,
and production model activation remains blocked until that provenance is
persisted and independently validated.

The public snapshot states are `review_ready`, `partial`, `empty`, `restricted`
and `production_disabled`. `review_ready` is emitted only when the
capability-specific, joined and provenance-checked prerequisites are present;
it means that recorded material is ready for a person to inspect. It never
means approved, eligible, compliant, priced, submitted or awarded.

## Capability boundary

The **current capability runtime level is Level 0 for every row**: deterministic
projection only, with no model output and no mutation of capability source data
or generated drafts. The Review Inbox can mutate only named human-review
metadata. The “bounded product ceiling” below describes the most autonomous
future behaviour represented by the product catalogue, not an enabled runtime.
Level 1 is a non-persistent preview; Level 2 is a reversible proposal or draft
that still requires named-human review. No Level 3 bounded action or Level 4
autonomous consequential action is authorised.

| Capability                                          | ID                            | Implemented deterministic behaviour                                                                                                                                                          | Bounded product ceiling                                                                      |
| --------------------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Evidence Graph                                      | `evidence_graph`              | Builds provenance-checked requirement/evidence links and coverage; a link is unusable until its requirement, evidence and link reviews are accepted.                                         | Level 2; reviewer accepts each citation and applicability decision.                          |
| Addendum & Deadline Radar                           | `addendum_radar`              | Compares two structured, authoritative source versions, identifies exact added/changed/removed fields and lists dependent artifacts for review. It never applies a change.                   | Level 2; reviewer confirms the version diff and each downstream impact.                      |
| Tender Eligibility Passport                         | `eligibility_passport`        | Evaluates only tender-cited criteria against source-backed company artifacts, validity dates and legal-entity rules. It does not invent a universal checklist.                               | Level 1; owner verifies applicability, authority, dates and remediation.                     |
| Grounded Tender Copilot                             | `grounded_copilot`            | Produces an extractive claim plan from accepted, role-visible, in-scope facts, or abstains. It does not compose unsupported prose.                                                           | Level 1; user inspects the exact source before reuse.                                        |
| Opportunity Radar                                   | `opportunity_radar`           | Screens recorded opportunities using explicit capability, region, deadline and capacity policy. It never estimates win probability or makes bid/no-bid decisions.                            | Level 1; business-development lead makes the bid/no-bid decision.                            |
| Citation-first Response Studio                      | `response_studio`             | Requires exact in-scope citations for factual and instructional draft claims, validates exact-quote support, placeholders and citation scope; paraphrases remain subject to semantic review. | Level 2; named authors/reviewers accept or reject each draft claim.                          |
| Submission Pack Preflight                           | `submission_preflight`        | Checks source-backed obligations, addenda, filenames, hashes, final/approval state and deadlines and proposes remediation. A passing result is not release authority.                        | Level 1; the named signatory makes the release and submission decision.                      |
| Clarification Question Assistant                    | `clarification_assistant`     | Proposes source-linked questions for conflicting, ambiguous or missing values. Every proposal has `deliveryStatus: not_sent` and no recipient.                                               | Level 2; authorised tender lead decides whether and how to send.                             |
| BOQ & Commercial Sanity Checker                     | `boq_sanity`                  | Projects source-backed arithmetic in configured minor units and flags decimal, extension and mixed-currency issues. It makes no rate, FX, tax or pricing recommendation.                     | Level 1; commercial reviewer owns rates, assumptions and approval.                           |
| Award-to-Delivery Handoff                           | `award_handoff`               | Converts accepted, cited award obligations into internal draft-task proposals and checks dates, owners and dependencies. It creates no task or external commitment.                          | Level 2; contract/project manager accepts obligations, owners and dates.                     |
| Published-Evaluation Score Planner                  | `evaluation_score_planner`    | Maps accepted published criteria and cited allocations; never predicts award probability or hidden evaluator behaviour.                                                                      | Level 1; reviewer confirms every criterion, allocation and evidence mapping.                 |
| Bid Security & Guarantee Integrity Desk             | `bid_security_integrity`      | Compares exact security terms and verified instrument fields; never represents validity or instructs a bank.                                                                                 | Level 1; legal, commercial and treasury reviewers decide remediation.                        |
| Regulatory Rule-Pack Watchtower                     | `regulatory_watchtower`       | Compares verified official rule versions and proposes pursuit/control impacts without activating an interpretation.                                                                          | Level 1; compliance or legal owner approves authority, interpretation and activation.        |
| JV / Consortium Responsibility Matrix               | `consortium_responsibility`   | Proposes entity-bound responsibility rows and blocks transferable-credential assumptions.                                                                                                    | Level 2; authorised representatives accept each allocation; partner terms are never changed. |
| Portal Submission Rehearsal & Form Mapper           | `portal_submission_rehearsal` | Checks frozen package fields, files, names, sizes and upload order against a reviewed portal profile.                                                                                        | Level 1; an operator performs the real login, declarations and submission.                   |
| Commercial Assumption & Cashflow Exposure Simulator | `commercial_exposure`         | Projects deterministic clause-bound cashflow scenarios without choosing rates, prices or financing.                                                                                          | Level 1; finance reviewers approve assumptions and decisions.                                |
| Nigerian-Content Evidence Composer                  | `nigerian_content_composer`   | Composes source-exact, availability-reviewed local-content plan lines from verified company facts.                                                                                           | Level 2; evidence owners accept every quantity, percentage and commitment.                   |
| Past-Performance & Key-Personnel Tailoring Studio   | `personnel_tailoring`         | Matches reviewed criteria to current verified people and projects while excluding unsupported or unavailable candidates.                                                                     | Level 2; HR, project and bid owners attest currency, availability and selection.             |
| Tender-to-Contract Deviation Desk                   | `contract_deviation`          | Compares reviewed clauses across solicitation, bid, clarification, award and draft contract without accepting terms.                                                                         | Level 1; legal and commercial owners decide every issue and communication.                   |
| Pursuit Critical-Path & Capacity Simulator          | `critical_path_simulator`     | Computes bounded dependency/resource scenarios from accepted milestones without mutating tasks, owners or dates.                                                                             | Level 1; task owners accept any authoritative plan change.                                   |
| Procurement-Integrity & Conflict Sentinel           | `integrity_sentinel`          | Emits restricted immutable-evidence control signals that are explicitly not allegations or external reports.                                                                                 | Level 1; authorised ethics/legal reviewers investigate and decide.                           |
| Outcome Learning & Repeat-Defect Coach              | `outcome_learning`            | Proposes tenant-local lessons from client-confirmed outcomes and repeated cited defects; training and cross-tenant reuse default off.                                                        | Level 2; governance owner approves lesson, scope and retention.                              |

## Deterministic API map

The public API is implemented by
[`routes/intelligence.ts`](../../artifacts/api-server/src/routes/intelligence.ts)
and the content-minimised projection by
[`snapshot.ts`](../../artifacts/api-server/src/lib/intelligence/snapshot.ts).
The deterministic verified-span layer and its tenant-scoped storage adapter are
implemented by
[`evidenceLayer.ts`](../../artifacts/api-server/src/lib/intelligence/evidenceLayer.ts)
and
[`evidenceLayerStore.ts`](../../artifacts/api-server/src/lib/intelligence/evidenceLayerStore.ts).
Review projection and source-version-bound mutations are implemented by
[`reviewInbox.ts`](../../artifacts/api-server/src/lib/intelligence/reviewInbox.ts)
and
[`intelligenceReviewStore.ts`](../../artifacts/api-server/src/lib/intelligence/intelligenceReviewStore.ts).
The internal deterministic function surface is exported from
[`lib/intelligence/index.ts`](../../artifacts/api-server/src/lib/intelligence/index.ts):

| Capability                                          | Pure function                          |
| --------------------------------------------------- | -------------------------------------- |
| Evidence Graph                                      | `buildEvidenceGraph`                   |
| Addendum & Deadline Radar                           | `detectAddendumChanges`                |
| Tender Eligibility Passport                         | `evaluateEligibilityPassport`          |
| Grounded Tender Copilot                             | `planGroundedCopilotAnswer`            |
| Opportunity Radar                                   | `screenOpportunities`                  |
| Citation-first Response Studio                      | `validateCitationFirstResponse`        |
| Submission Pack Preflight                           | `runExtendedSubmissionPreflight`       |
| Clarification Question Assistant                    | `suggestSourceBackedClarifications`    |
| BOQ & Commercial Sanity Checker                     | `projectSourceBackedBoqSanity`         |
| Award-to-Delivery Handoff                           | `proposeAwardToDeliveryHandoff`        |
| Published-Evaluation Score Planner                  | `buildEvaluationScorePlan`             |
| Bid Security & Guarantee Integrity Desk             | `evaluateBidSecurityIntegrity`         |
| Regulatory Rule-Pack Watchtower                     | `buildRegulatoryWatchtower`            |
| JV / Consortium Responsibility Matrix               | `buildConsortiumResponsibilityMatrix`  |
| Portal Submission Rehearsal & Form Mapper           | `buildPortalSubmissionRehearsal`       |
| Commercial Assumption & Cashflow Exposure Simulator | `buildCommercialExposureProjection`    |
| Nigerian-Content Evidence Composer                  | `composeNigerianContentPlan`           |
| Past-Performance & Key-Personnel Tailoring Studio   | `tailorVerifiedPersonnelAndExperience` |
| Tender-to-Contract Deviation Desk                   | `compareTenderToContract`              |
| Pursuit Critical-Path & Capacity Simulator          | `simulatePursuitCriticalPath`          |
| Procurement-Integrity & Conflict Sentinel           | `detectProcurementIntegritySignals`    |
| Outcome Learning & Repeat-Defect Coach              | `proposeOutcomeLessons`                |

The HTTP contract is in
[`openapi.yaml`](../../lib/api-spec/openapi.yaml), and the protected screen is
connected by
[`intelligence-centre-route.tsx`](../../artifacts/bidbox-workbench/src/pages/intelligence-centre-route.tsx).
Unit and static tests sit beside the deterministic engines, route and UI.

## Safety and authority invariants

- Tenant and project scope is established by the authenticated request,
  permission middleware and existing database isolation controls. Internal pure
  functions are not standalone authorisation boundaries.
- Active source version, lifecycle state, authority, role visibility and exact
  source quotations are validated before a bounded proposal can be used.
- Restricted Mode and absent/partial evidence fail closed. The UI does not hide
  those states behind a confidence score.
- Model execution, model-output or draft persistence, notifications, emails,
  portal operations, submissions, authoritative approvals, pricing changes,
  award decisions and downstream task creation are outside this implementation.
  Persistence is limited to named Review Inbox metadata and the disconnected
  workflow/evaluation control stores described below.
- A deterministic check passing is evidence for a reviewer, not a release
  decision. Human approval cannot be inferred from system output.
- The feature set adds no general tool-execution plane, cross-client learning or
  long-term conversational memory.

## Production blockers and next stages

1. **Authoritative retrieval:** the connected route now provides bounded,
   deterministic lexical search over accepted, hash-checked verified spans. A
   production data plane still needs immutable page/table ingestion and
   historical verifier-authority attestations, version-aware index and deletion
   reconciliation, and independent two-tenant tests. The current Copilot is an
   extractive planner, not a conversational retrieval service.
2. **Governance decisions:** approve provider/model, processing region,
   retention, privacy terms, customer-data scope, rate card and budget. Keep the
   global/capability kill switches and fail-closed gateway in the activation
   path.
3. **Durable workflow controls:** the typed Drizzle store now persists bounded,
   idempotent jobs/runs, leases, retries, cancellation, recovery and review
   records in the existing schema. No worker, scheduler, provider runner,
   transactional outbox or automated reconciliation loop is connected. Those
   runtime controls and explicit capacity admission must pass production review
   before any Level 2 model-backed draft is connected.
4. **Feature evaluations:** the continuous-evaluation store now persists
   version-bound cases, runs, results, aggregate evidence and named reviews in
   the existing schema. No evaluation runner, authorised production holdout,
   live observation feed or release-approval writer is connected.
   Representative and adversarial cohorts for citation correctness,
   abstention, addendum recall, eligibility false claims, BOQ arithmetic and
   scope leakage still need independent adjudication and approved release
   thresholds.
5. **Operational proof:** exercise shadow, pilot and canary stages; verify
   concurrency, cost ceilings, alert delivery, incident handling, rollback and
   Restricted Mode in a production-like environment.
6. **Separate product approval:** only after the preceding controls pass should
   an owner decide whether any model-backed Level 1 preview or Level 2 reversible
   draft is worth enabling. Send/submit/approve/price/award actions remain out of
   scope and require a separate threat model and authority decision.

Until those stages are complete, the connected Intelligence Centre is a
deterministic review surface. It is not evidence that production AI has been
approved or enabled.
