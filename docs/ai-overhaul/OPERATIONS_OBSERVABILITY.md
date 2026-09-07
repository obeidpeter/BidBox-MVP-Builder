# AI operations and observability

Status: **source-level operations view exists; production monitoring is not operational**.

## 1. Current operations surface

`GET /ai/operations` requires an active direct membership carrying one of the
named BidBox internal operations roles and `evaluation:read`. Client, partner,
read-only-auditor, restricted-platform-administrator and break-glass contexts
are denied even if they otherwise carry a read permission. Its database queries
filter `llm_runs` and `evaluation_runs` by the active organisation. The response
contains:

- environment, generation time and global kill-switch state;
- production-enabled calculation and safe blocker codes;
- model/configuration status and evaluation-approved flag;
- approved budget currency, remaining minor units and rate-card version when
  configured;
- provider region/retention policy—not credentials or raw legal evidence;
- release-gate allow/deny state, blocker codes and expected version set;
- each capability's autonomy level, approval authority, policy limits,
  environment/tenant gates, prompt/schema versions and hashes;
- up to 20 recent organisation-scoped runs with IDs, project, task, model,
  prompt version, token counts, success/failure, safe error and time;
- up to 10 organisation-scoped evaluation summaries.

Legacy or unexpected run errors are returned as
`AI_LEGACY_ERROR_REDACTED`. Raw provider errors, model inputs and raw outputs are
not returned. The source endpoint, generated contract, internal-role guard,
console and focused tests are implemented; this is not evidence of deployed
production authorisation, alerting or target-environment acceptance.

## 2. Current run provenance

Completed calls persist an input SHA-256 prefix, bounded output summary, tokens
and gateway provenance in an independent same-tenant transaction so a later
business-workflow rollback cannot erase the attempt. Cross-tenant nesting is
explicitly rejected. The provenance includes provider/request ID,
attempt/fallback, latency, actual computed cost and rate-card, model
configuration version, prompt/schema hashes and versions, provider-governance
evidence version and health-check time. Failure logging uses safe codes and is
required rather than silently best-effort.

The current `llm_runs` table exposes only part of that data as first-class
columns; other provenance is held in a bounded JSON summary. This is adequate
for development inspection, not a final immutable cost/audit ledger.

## 3. Release-gate telemetry

In production the project runtime reads a private retained evidence bundle from
the absolute `VALO_AI_RELEASE_EVIDENCE_PATH`, recomputes the release decision
against current model, prompt, schema-set, retrieval and index versions, and
returns `AI_RELEASE_GATE_DENIED` when any gate fails. Stored “passed” booleans
are not trusted alone.

There is currently no valid production evidence bundle. Retrieval and index
versions are unimplemented/unpinned, and placeholder values such as `none`,
`unknown` or `not_implemented` are rejected. The operations endpoint should
therefore show release-gate and other blockers in production.

## 4. Required signals

| Signal                       | Dimensions                                                | Minimum use                                     |
| ---------------------------- | --------------------------------------------------------- | ----------------------------------------------- |
| Capability attempts/outcomes | capability, safe code, tenant pseudonym, release version  | Availability and unsafe-failure detection       |
| Provider attempts/fallback   | approved provider alias, attempt, health age              | Outage/fallback drift                           |
| Schema/sanitiser failures    | capability, prompt/schema hash                            | Contract regression/injection signal            |
| Grounding results            | dropped/downgraded/accepted, capability                   | Citation quality and poisoning signal           |
| Human review outcomes        | accepted/edited/rejected, reason taxonomy, time-to-review | Quality drift without exposing content          |
| Tokens/cost                  | capability, tenant/engagement pseudonym, rate card        | Per-run/month/engagement budget enforcement     |
| Latency                      | gateway and end-to-end p50/p95/p99                        | Timeout/SLO and provider degradation            |
| Release/gate denial          | blocker code, capability, release                         | Misconfiguration or attempted unsafe enablement |
| Tenant/RLS denial            | data plane, operation                                     | Isolation attack/regression detection           |
| Injection detection          | taxonomy and source channel                               | Threat monitoring and corpus expansion          |
| OCR quality                  | extraction method, labelled quality cohort                | Omission/fabrication monitoring                 |
| Queue/outbox                 | not applicable today                                      | Required only if durable orchestration is built |

Do not attach client document text, model messages, source excerpts, filenames,
personal data, commercial figures or raw provider errors as telemetry labels.

## 5. Proposed alert policy (owner approval required)

Exact thresholds and paging owners are undecided. Before shadow, approve at
least these stop conditions:

- any cross-tenant data access or unauthorised authoritative mutation;
- any fatal requirement miss or unsupported released claim in monitored review;
- any provider governance/region/retention evidence mismatch;
- any release-gate bypass or version mismatch;
- persistent schema invalidity, citation failure or grounding downgrade spike;
- budget reservation/settlement failure or approved-limit breach;
- provider failure/latency exceeding the approved envelope;
- kill-switch or alert-delivery drill failure;
- unusual reviewer rejection/edit rate by capability/cohort;
- canary content found in ordinary logs;
- repeated OCR low-quality output used without required review.

Some conditions require immediate global disable; others may disable one
capability/provider/tenant. The incident owner must be unambiguous.

## 6. Dashboards

The minimum production dashboard should show:

1. release candidate and exact versions;
2. effective global/capability/tenant gates;
3. provider eligibility, governance evidence age and health freshness;
4. attempt/success/safe-denial/schema-failure rates;
5. grounding and human-review outcomes;
6. latency, tokens, cost and budget remaining;
7. evaluation result/cohort trend and current promotion decision;
8. alerts, acknowledgement, incidents and latest kill-switch/rollback drill.

All tenant drill-downs require scoped authorisation. Cross-tenant aggregate
views require k-anonymity/suppression rules or equivalent privacy review.

## 7. SLO and quality budget decisions

The source policy contains hard timeouts (45 seconds for text tasks, 60 seconds
for multimodal transcription), but those are safety ceilings, not approved
SLOs. Product/operations owners must set p95/p99 latency, successful assistance,
manual fallback, cost and support targets from shadow/pilot data.

Quality thresholds for promotion are fixed in the evaluation plan; operational
quality budgets must additionally specify the window and minimum sample size so
small cohorts do not trigger misleading percentages.

## 8. Privacy, retention and access

- Limit ordinary run telemetry to IDs, hashes, counts, safe codes and approved
  bounded provenance.
- Define separate retention for run metadata, evaluation evidence, incident
  evidence and provider request IDs.
- Apply tenant RLS and access logging to operations/evaluation records.
- Keep release evidence private, integrity-protected, size-bounded and outside
  user-writable/document upload paths.
- Test deletion propagation to outputs, run links, indexes/caches (when built),
  evaluation exports and backups subject to legal holds.
- Run canary-string scans over application, provider, infrastructure and alert
  logs before each rollout stage.

## 9. Operational gaps

- No production alert backend, pager, alert rule set or delivery receipts.
- No approved SLOs or named on-call schedule.
- Attempt settlement currently acquires a second connection from the shared
  finite pool while the workflow holds its request transaction. Reserve
  dedicated telemetry capacity or move to a durable outbox/worker before
  production to prevent pool-starvation under concurrent completions.
- The durable record is written after provider settlement. A process failure
  after disclosure but before that write can still lose the attempt, and failed
  provider attempts may have billable usage the adapter cannot report. A
  pre-disclosure started record plus durable settlement/cost ledger is required
  before production.
- Provider `health()` currently proves local adapter configuration rather than a
  live provider transaction; health semantics need production design.
- No durable concurrency-safe budget ledger.
- No queue/outbox/dead-letter telemetry because those layers are not built.
- No retrieval/index drift or deletion telemetry because retrieval is absent.
- No retained shadow/pilot/canary dashboard evidence.
