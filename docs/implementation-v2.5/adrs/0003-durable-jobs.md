# ADR-0003: Persistent jobs and transactional outbox

Status: Accepted; persistence foundation implemented; workload activation gated
Date: 2026-08-08
Last reviewed: 2026-08-31
Next review: 2026-11-30
Owner: Delivery and operations architecture (`@obeidpeter`)
Backup owner: Unassigned; tracked as `AR-001`
Reviewers: Security/privacy, delivery and operations role holders before workload activation; named alternates are not yet recorded
Drivers: `AD-005`, `AD-008`, `AD-009`
Evidence: `artifacts/api-server/src/lib/durableWorkerFoundation.ts`; `artifacts/api-server/src/lib/transactionalOutbox.ts`; `artifacts/api-server/src/routes/durableWorkerFoundation.ts`; `docs/durable-worker-foundation/IMPLEMENTATION.md`; `config/operations/schedules.v1.json`
Supersedes: Request-lifetime and fire-and-forget execution for durable work
Superseded by: None

## Context

Scanning, OCR, extraction, notifications, rendering, anchoring and deletion outlive HTTP requests and must recover from provider/process failure without duplicate side effects.

## Decision

Use PostgreSQL-backed jobs/outbox first, with claim leases (`FOR UPDATE SKIP LOCKED` or equivalent), heartbeats, progress, bounded retry/backoff, dead-letter state and audited replay. Commands commit domain mutation, audit and outbox together. Consumers and provider calls use stable idempotency keys. A managed queue may replace transport behind an adapter when scale evidence justifies it.

## Consequences

At-least-once delivery is normal; consumers must be idempotent. Queue/tenant fairness, lease recovery, provider reconciliation and operator tooling become required. Database load is monitored before changing transport.

## Rejected

In-memory queues; fire-and-forget promises; unbounded automatic retries; premature external event platform.
