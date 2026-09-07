# AI platform foundation implementation

Status: **deterministic evidence and review runtime connected; model runtime and production activation remain blocked**.

This implementation retains the pure, typed control contracts for the next BidBox
AI data plane and execution plane and adds four bounded foundations. A
tenant-scoped, deterministic verified-span evidence layer and a named Review
Inbox are connected to database-backed routes. Durable workflow and continuous
evaluation stores persist control evidence in the existing schema, but no
worker, scheduler, provider runner, evaluation runner or release-approval
writer consumes them. No connected path invokes a model, vector service or
external tool. The production AI kill switch and independent release gate
remain hard-blocking.

## Implemented foundation map

| Improvement                                   | Implemented source                                                                                                                                                                                                                                                                       | Current boundary                                                                                                                                                                         |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Evidence-grade ingestion and hybrid retrieval | `aiRetrievalPipeline.ts` retains the pure future hybrid-selection contract. `evidenceLayer.ts` and `evidenceLayerStore.ts` now build and search a tenant-scoped manifest of accepted, current-version, hash-checked, named-verifier spans through the Intelligence routes.               | The connected path is bounded lexical retrieval only. No vector index, model, immutable blob verifier, OCR parser or historical verifier-authority attestation is connected.             |
| Claim-level grounding and abstention          | `evaluateClaimGroundingAndAbstention` checks every material claim against exact retrieved spans and returns an explicit abstention/blocked disposition when coverage is absent, contradictory or invalid.                                                                                | It does not generate prose or persist a claim.                                                                                                                                           |
| Versioned continuous evaluation               | `aiContinuousEval.ts` binds evaluation evidence to the exact version set. `continuousEvaluationStore.ts` implements scoped, idempotent persistence for cases, runs, results and named reviews, and derives bounded run/cohort aggregates from the persisted result envelopes.            | No evaluation runner, live production-observation feed, authorised holdout publisher or release-approval writer is connected. Evaluation evidence cannot activate AI.                    |
| Risk-based human review                       | `assessAiHumanReviewRisk` retains the pure risk contract. `reviewInbox.ts` and `intelligenceReviewStore.ts` expose and persist named, source-manifest-bound review claims and dispositions with optimistic concurrency and audit events.                                                 | A persisted Review Inbox disposition is an assessment only. It cannot approve evidence, waive a finding, release a package, perform a consequential action or authorise model execution. |
| Privacy and tenant policy                     | Retrieval requires exact tenant/project actor scope, purpose, classification allow-list, redaction reference and PII minimisation. `approved_model` disclosure additionally requires approved region, no-training, retention and external-processing policy.                             | Approval inputs must later come from trusted policy services, never model/browser claims.                                                                                                |
| Typed bounded orchestration                   | `createQueuedAiRun` and `transitionAiDurableRun` define the control contract. `durableWorkflowStore.ts` implements scoped persistence for idempotent enqueue, claims, leases, heartbeats, bounded retries, cancellation, lease recovery, runs and review records in the existing tables. | Persistence is implemented, but no worker, scheduler, provider runner, transactional outbox or automated recovery loop is connected.                                                     |
| End-to-end observability                      | `createPrivacySafeAiTraceEvent` validates versioned, content-free trace events and rejects unsafe error/detail fields.                                                                                                                                                                   | No trace sink, cost ledger or alert transport is connected.                                                                                                                              |
| Retrieval/tool prompt-injection firewall      | `detectRetrievalInjectionSignals` and the retrieval builder reject instruction override, prompt probe, secret exfiltration, tool-execution and cross-tenant signals before context assembly.                                                                                             | This is deterministic screening, not proof against every attack; live adversarial evaluation remains mandatory.                                                                          |
| Quality-constrained model routing             | `routeQualityConstrainedModel` filters candidates by governance, region, retention, no-training, health, evaluated quality, context, latency and predicted per-request cost before deterministic selection.                                                                              | It does not call a provider, evaluate Restricted Mode, enforce a worst-case retry budget or weaken the existing approved-adapter gate.                                                   |
| Scalable execution and backpressure           | The durable store enforces atomic compare-and-set transitions, bounded claims, idempotency, leases, retries, expiry and cancellation without assuming an in-request model call.                                                                                                          | Capacity admission, worker concurrency, reserved telemetry capacity and reconciliation workers are still absent.                                                                         |
| Calibrated confidence and active learning     | `computeConfidenceCalibration`, `compareContinuousEvalRegression` and `selectActiveLearningCases` calculate calibration/regression evidence and bounded case selection without treating confidence as correctness.                                                                       | Selection does not train a model, move tenant data, or publish a baseline.                                                                                                               |

The original provider-free surface remains exported by
`artifacts/api-server/src/lib/{aiRetrievalPipeline,aiControlPlane,aiContinuousEval}.ts`. The new evidence,
review, workflow and evaluation surfaces are exported through
`artifacts/api-server/src/lib/intelligence/index.ts`. The evidence status marks
only its deterministic database/route runtime connected; its model and vector
runtimes remain disconnected. The durable-workflow and continuous-evaluation
statuses report persistence implemented but runtime disconnected. Every new
status keeps production approval false and activation blocked.

## Fail-closed guarantees

- A foreign tenant/project, non-active or hash-invalid source, missing
  permission, unapproved classification, unscanned/flagged injection payload,
  stale retrieval/index version, or oversized context cannot be selected.
- A material factual claim cannot be marked grounded without exact evidence;
  unsupported or contradictory output abstains rather than relying on model
  confidence.
- Connected evidence search is bound to the actor's exact document visibility
  and expected manifest hash. Document text has no instruction authority. A
  citation verifier must currently have active, direct tenant
  `evidence:approve` authority, but this is not historical proof that the same
  authority existed when an older citation was verified.
- A consequential action, injection signal or cross-tenant signal cannot be
  routed into execution. Reversible drafts require named review according to
  the risk decision.
- Review Inbox mutations require a named reviewer, exact source manifest and
  optimistic review version. A recorded `approved` wire status means only that
  the review was accepted; it grants no downstream authority.
- Model routing is governance- and quality-floor constrained. High/critical
  risk is quality-first; low/medium risk is cost-first only among candidates
  that meet the same quality, privacy, region, health and per-request cost
  policy. It performs no provider fallback on its own.
- Workflow transitions are deterministic and subject-bound. Approval, lease,
  idempotency and version data cannot silently transfer to a changed run.
- Evaluation results do not activate production. A run can satisfy its local
  evaluation profile only from persisted, reviewer-bound results, the exact
  immutable version vector and every required cohort; release still requires
  the independent gate and retained evidence for that exact version set.

## Production activation remains blocked

The following are intentionally not implemented or authorised by this
foundation and remain deployment gates:

1. immutable page/table ingestion, OCR provenance, historical
   verifier-authority attestations, trusted source/blob hash verification,
   trusted claim classification and a tenant-isolated vector index with
   deletion and version reconciliation beyond the connected bounded lexical
   manifest;
2. approved provider/model, processing region, retention, no-training terms,
   restricted-mode eligibility, rate card and budget ledger;
3. trusted workflow/model-router registries, capacity admission, a worker,
   scheduler, provider runner and transactional outbox around the implemented
   durable store, reserved worker/telemetry capacity, pre-disclosure attempt
   ledger, failed-attempt usage reconciliation and automated crash recovery;
4. an evaluation runner and release-approval writer around the implemented
   evaluation store, authorised production holdouts and live observations for
   every required cohort, signed corpus governance and independent
   adjudication;
5. live two-tenant isolation, injection, load/backpressure, alert, rollback,
   shadow, pilot and canary evidence; and
6. named privacy, security, product, legal and operational acceptance.

Until those gates pass, BidBox exposes deterministic Level-0 Intelligence
projections, bounded verified-span lexical search and named review metadata.
The workflow/evaluation stores remain disconnected from execution. No document
content is authorised for production model processing by this work.
