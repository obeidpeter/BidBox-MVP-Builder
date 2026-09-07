# Controlled AI Shadow Programme

BidBox now has an internal, tenant-scoped register for **no-output shadow evaluation**. It is an evidence workflow, not a model runner or activation switch.

## Delivered boundary

- Plans bind one approved capability to exact SHA-256 versions for the application release, model snapshot/configuration, prompt, schema, retrieval policy, corpus, governance decision, and expected-case manifest.
- Every plan includes all required continuous-evaluation cohorts and at least 25 expected cases.
- Observations store controlled metrics, a closed reviewer-note code, and an optional output digest. Free-text reviewer narrative, raw model output, and tender content are not accepted by the observation contract.
- Completed observations require an output digest. Duplicate case results and stale closure views fail closed.
- An independent named evaluator must close a plan; the creator cannot self-close it.
- Fatal misses, unsupported claims, tenant leakage, injection failure, disposition mismatch, citation error, missing cohorts, incomplete case coverage, or expiry block the recommendation.
- Even a complete safe result is only `eligible_for_governance_review`. Every response fixes `productionActivationGranted: false`.
- The audit-backed pilot retains at most 25 lifetime plans per organisation, including closed plans. It has no archive or capacity-recovery action; operators must stop intake before the limit and use a reviewed storage and retention migration without deleting tenant audit events.

The durable adapter stores closed event envelopes in the tenant audit chain, verifies current direct membership and evaluation roles inside each database transaction, uses scoped advisory locks, bounds metadata before materialising details, and rejects malformed or over-capacity history.

## Deliberately unavailable

- model/provider invocation;
- customer-visible output;
- raw output persistence;
- production capability enablement;
- automatic release promotion;
- production-scale plan archival or retention lifecycle;
- changes to provider, privacy, budget, retrieval, or Restricted Mode approvals.

Production AI therefore remains disabled. A later controlled runner must independently prove its execution manifest, provider governance, complete corpus, retrieval/index mode, budget ledger, and signed evaluation evidence before any separate activation proposal.
