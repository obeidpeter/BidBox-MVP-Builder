# ADR-0012: Worker and scheduler activation boundary

Status: Accepted; durable foundation and bounded opt-in runner implemented; worker and platform schedules not activated
Date: 2026-08-31
Last reviewed: 2026-08-31
Next review: 2026-10-31
Owner: Delivery and operations architecture (`@obeidpeter`)
Backup owner: Unassigned; tracked as `AR-001`
Reviewers: Operations and security/privacy role holders before any workload activation; named alternates are not yet recorded
Drivers: `AD-001`, `AD-005`, `AD-008`, `AD-009`
Evidence: `docs/durable-worker-foundation/IMPLEMENTATION.md`; `artifacts/api-server/src/routes/durableWorkerFoundation.ts`; `artifacts/api-server/src/routes/index.ts`; `artifacts/api-server/src/lib/durableWorkerFoundation.ts`; `artifacts/api-server/src/lib/transactionalOutbox.ts`; `scripts/run-inprocess-schedules.mjs`; `config/operations/schedules.v1.json`
Supersedes: Implicit activation when a job entrypoint exists in source
Superseded by: None

## Context

BidBox has persistent job, run and transactional-outbox primitives, plus source entrypoints for maintenance work. Existence of these components does not prove a workload identity, dispatcher, platform schedule, provider receipt, paging route or safe multi-replica execution. Human Clerk sessions are not worker identities.

## Decision

1. The durable worker-control router remains unmounted from the authenticated user API. Its route factory is for trusted composition and tests until a separate, rotated workload identity and private authorization boundary exist.
2. Provider effects and unverified delivery claims remain disabled. An outbox attempt can be prepared or marked known-not-delivered/outcome-unknown, but cannot be called delivered without trusted provider evidence.
3. Production schedules are governed by `config/operations/schedules.v1.json`. `entrypointStatus`, `platformScheduleStatus`, `activation`, prerequisites and evidence signals are distinct. A source entrypoint never implies installation or successful operation.
4. The in-process runner is off by default. `VALO_INPROCESS_SCHEDULES` is an explicit comma-separated allowlist; unknown, duplicate, blocked or unsupported-cron selections fail startup. Only `ready_for_platform_install` entries are selectable, and each process forbids overlapping runs of the same job.
5. Cross-replica exclusion is not supplied by the in-memory runner. Autoscale activation therefore requires proof of a single active scheduler or job-specific database/provider idempotency and distributed exclusion, plus retained run receipts and alerts.
6. Worker activation additionally requires allowlisted handlers, tenant/capability fairness, lease/crash/fence/duplicate-effect/two-tenant/shutdown tests, privacy-safe metrics, reconciliation and named operational ownership. Platform schedules must retain their platform ID, exact source, workload identity, first successful full cycle, last-success signal, paging receipt and disable procedure.

## Consequences

BidBox can develop and test durable semantics without exposing a privileged human-callable worker API or overstating production operation. Scheduling remains deliberately conservative. Operational latency may remain manual until the identity, monitoring and installation evidence is supplied.

## Rejected

Mounting worker claim/settle endpoints behind ordinary user auth; treating environment-selected worker IDs as identities; automatically starting every manifest job; equating a source command with an installed schedule; claiming external delivery without a verifiable receipt.
