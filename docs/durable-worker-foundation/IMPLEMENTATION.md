# Durable Worker and Outbox Foundation

BidBox now has a durable, tenant-scoped execution foundation over `processing_jobs`, `processing_runs`, `notification_events`, and `notification_attempts`.

## Implemented

- reference-only, idempotent job admission with per-tenant and per-capability limits;
- scoped FIFO claim, CAS fence tokens, bounded leases, heartbeats, deadlines, retries, cancellation, dead-lettering, and expired-lease recovery;
- a run row committed before any effect could be attempted;
- transactional success plus a content-free outbox intent;
- outbox attempts committed before invocation, with explicit unknown-outcome reconciliation;
- no global claim and no arbitrary persisted payload;
- external-provider effects and unverified delivery claims are hard-disabled.

## Activation gate

The worker-control router is intentionally not mounted in the user-authenticated API. A human administrator is not a workload identity and must not be able to claim or settle jobs by supplying a worker ID.

Activation requires all of the following:

1. an independently authenticated, rotated workload identity;
2. an allowlisted deterministic handler for every enabled capability;
3. a dispatcher that implements the declared tenant/capability fairness policy;
4. privacy-safe metrics, attempt reconciliation, and operator alerting;
5. integration tests for crash recovery, lease fencing, duplicate effects, two-tenant isolation, and graceful shutdown.

Until those gates are met, the repository and services are available to trusted in-process composition and tests only. No external provider, delivery, AI, retention, or release action is executed by this foundation.
