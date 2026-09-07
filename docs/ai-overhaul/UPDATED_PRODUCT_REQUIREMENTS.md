# Updated product requirements: bounded AI assistance

Status: **implementation baseline, not production approval**.

## 1. Authority and product intent

These requirements update the observed Business Plan v1.1, Product Roadmap
v1.0 and TRD v1.0 for the current AI overhaul. The requested Business Plan
v1.2 and Product Roadmap v1.1 were unavailable; reconciliation against those
versions is a release prerequisite.

BidBox may use AI to accelerate extraction and review, but AI is not a tender
authority, legal adviser, compliance signatory, evidence approver, defect
closer, submission approver or award predictor. The deterministic application
and named users remain authoritative.

## 2. Users and outcomes

| User                         | Intended outcome                                | Authority retained by the user                     |
| ---------------------------- | ----------------------------------------------- | -------------------------------------------------- |
| Analyst                      | Faster first-pass extraction and mapping        | Accept, edit, reject or merge each suggestion      |
| Evidence reviewer            | Find likely evidence and gaps                   | Confirm source, status, validity and applicability |
| Defect reviewer              | Surface likely omissions and risks              | Set severity, ownership, status and remediation    |
| Report signatory             | Receive a draft responsiveness narrative        | Edit and sign off the final narrative/report       |
| Evaluation/operations reader | Inspect configuration and recent safe telemetry | Decide whether to pause, investigate or promote    |
| Security/privacy owner       | Assess disclosure, residency and retention      | Approve provider/data-governance evidence          |

## 3. Product principles

1. **AI assists; humans decide.** Every current model output is a visible,
   reversible, non-authoritative draft.
2. **No evidence, no claim.** Positive requirement/evidence assertions require
   exact grounding in the named in-scope source.
3. **Fail closed.** Missing policy, feature flag, budget, provider governance,
   region, retention, health, usage or schema evidence stops the capability.
4. **Tenant scope comes from the server.** The client never selects or asserts
   an organisation for model execution.
5. **Documents are hostile data.** Filenames, PDF text, OCR output, retrieved
   chunks and tool results never become trusted instructions.
6. **Promotion is version-specific.** Model, model configuration, prompt,
   schema, retrieval and index versions are evaluated as one release unit.
7. **Restricted data is not ordinary telemetry.** Logs use IDs, hashes, counts,
   safe codes and bounded summaries, not tender or bid content.

## 4. Functional requirements

### PR-AI-001 — Central execution boundary

All model-backed project work shall pass through one server-side AI gateway.
Direct provider calls from feature routes are prohibited.

Acceptance:

- The gateway derives the capability policy and registered prompt/schema.
- The project row supplies immutable organisation and Restricted Mode context.
- A global kill switch is checked before provider disclosure.
- In production, both a capability environment approval and the tenant feature
  flag must be enabled.
- The gateway returns only safe error codes to callers.

Working-tree status: implemented for the five current capabilities; integrated
validation and deployment evidence remain pending.

### PR-AI-002 — Requirement extraction

The system may propose discrete tender requirements from selected documents.
Every candidate must name an allowed source document and include a non-empty
source quote that occurs in that document after narrow Unicode/whitespace
normalisation. Unsupported candidates are not persisted.

The complete selected corpus is required. Until versioned retrieval exists,
corpora over the safe 60,000-character bound fail with an actionable error;
they are never silently truncated.

Persisted output remains `suggested` until a user with `requirement:review`
authority confirms, edits, rejects or merges it. Merges must retain citation
provenance.

### PR-AI-003 — Evidence mapping

The system may propose evidence mappings only against supplied, reviewed
requirements and in-scope documents. A proposed `present` or `expired` status
requires an exact excerpt in the named document; otherwise the server
downgrades it to `unclear`. Expiry semantics, document validity and
`not_applicable` decisions still require deterministic checks and human review.

Persisted mappings remain suggested until an authorised reviewer confirms
them. Nulling or changing a source must re-run grounding; prior grounding may
not survive a source change.

### PR-AI-004 — Defect suggestion

The system may propose defects from reviewed requirements and confirmed
evidence. It may not invent requirement IDs, close defects, waive findings,
downgrade fatality or change project/submission status. Defects persist in
`suggested` state until `defect:review` authority acts.

### PR-AI-005 — Responsiveness draft

The system may draft a responsiveness-review preview using reviewed
requirements and reviewed defects. The preview is marked AI-suggested and
blocks final release until a named user with `report:sign_off` authority edits
or confirms it. A human edit clears the suggestion marker and is audited. The
AI may not predict award outcomes.

### PR-AI-006 — Multimodal transcription

When ordinary PDF text extraction is insufficient, the system may request
verbatim multimodal transcription. The output is a transcription suggestion,
not verified source truth. It must not summarise, translate or interpret the
document. Page-level OCR truthfulness evaluation is required before production.

### PR-AI-007 — Structured output containment

Every capability shall use a registered strict JSON Schema and a matching
server-side exact-key/type/length/enum validator. Valid JSON alone is
insufficient. Schema failure produces no partial business records.

### PR-AI-008 — Provider and privacy gating

Before client content is disclosed, the gateway shall require retained
evidence for provider approval, no-training posture, DPA, approved region,
retention compatibility, Restricted Mode eligibility and current health.
Fallback must be equivalent or stronger on governance and separately evaluated.

Provider, region, retention and DPA decisions are currently pending.

### PR-AI-009 — Cost and usage control

Every run shall have a capability ceiling and an approved budget/rate-card
record. The gateway shall conservatively reserve against input bytes and maximum
output tokens before disclosure, then compute actual token-based cost after the
call. Missing usage or budget evidence fails closed.

The code contains per-run ceilings, but the monthly and per-engagement budget,
currency authority and durable reservation/settlement design are not approved.

### PR-AI-010 — Provenance and review visibility

The application shall expose AI origin, suggestion state, source quote,
document/page/clause references where available, reviewer identity/time,
model/configuration version, prompt/schema hashes and safe run outcomes to
authorised users. Ordinary users must never confuse AI text with approved fact.

### PR-AI-011 — Operations view

An active direct BidBox-internal membership with a named operations role and
`evaluation:read` shall be required for the organisation-scoped view. Client,
partner, auditor, restricted-platform-administrator and break-glass contexts
shall be denied. The view shall show effective capability gates, prompt/schema
versions and hashes, policy limits, model/budget/privacy configuration status,
safe recent-run metadata and evaluation summaries. It must redact
legacy/provider error detail and never expose model inputs or raw outputs.

Working-tree status: API, UI, generated contract and source-level negative
authorisation tests exist; deployment and operational validation are not yet
accepted.

### PR-AI-012 — Evaluation and release control

Production promotion shall require an authorised, independently reviewed
holdout corpus of at least 25 cases across the required cohorts, bound to the
exact model/prompt/schema/retrieval/index versions. Minimum metrics are 95%
overall and mandatory recall, 95% precision, 98% citation correctness, 100%
citation/support-label coverage, zero fatal misses, zero unsupported claims and
100% correct labelled abstention/safe failure.

Current 14-case synthetic fixtures are regression checks only.

### PR-AI-013 — Emergency control and rollback

Operations shall be able to disable all AI server-side and disable individual
capabilities by environment plus tenant. Rollback may only select a previously
approved and evaluated configuration. Kill-switch, rollback and alert delivery
must be exercised before canary.

### PR-AI-014 — No autonomous action plane

No current capability may send email, submit a tender, upload to an external
portal, modify pricing, sign a report, approve evidence, close defects, change
project status, invoke shell/database/object-store/network tools, or create
authoritative business state. A future tool plane requires a separately
approved tool contract, per-call authorisation, idempotency and audit ledger.

## 5. Non-functional requirements

| Area            | Requirement                                                                                                                                     |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Security        | RLS and server-derived tenant scope; two-tenant negative tests across DB, object storage, cache, queues, retrieval and tools before production. |
| Privacy         | Data minimisation, provider governance evidence, approved residency/retention, deletion proof, DPIA and no client content in ordinary logs.     |
| Reliability     | Bounded timeout/retry/fallback, cancellation checks, no partial output persistence and manual recovery on failure.                              |
| Performance     | Capability-specific timeouts are hard safety bounds; product SLOs and measured p95/p99 targets require owner approval.                          |
| Accessibility   | AI origin, status, errors and review controls must remain keyboard and assistive-technology accessible.                                         |
| Audit           | Immutable review events and version/hash provenance sufficient to reconstruct what was suggested, reviewed and released.                        |
| Maintainability | One policy registry, one prompt/schema registry, one provider boundary and no feature-specific provider SDK calls.                              |

## 6. Explicit non-goals for this release

- No general Copilot or conversational agent.
- No cross-engagement or long-term AI memory.
- No production retrieval, embeddings, vector index or reranker.
- No AI queue worker or transactional outbox.
- No autonomous external tools or actions.
- No legal/compliance conclusion, award prediction, score simulation or
  evaluator impersonation.
- No training or fine-tuning on client content.

## 7. Release decision

These requirements do not authorise production. The current release remains
blocked until the exact checklist in
[Deployment and acceptance](DEPLOYMENT_ACCEPTANCE.md) is evidenced and signed.
