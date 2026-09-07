# ADR-0008: Replit single-process deployment topology

Status: Accepted current topology; source configured; live provider topology evidence remains external
Date: 2026-08-31
Last reviewed: 2026-08-31
Next review: 2026-11-30
Owner: Platform and release architecture (`@obeidpeter`)
Backup owner: Unassigned; tracked as `AR-001`
Reviewers: Operations and security/privacy role holders before topology or schedule activation changes; named alternates are not yet recorded
Drivers: `AD-004`, `AD-005`, `AD-010`
Evidence: `.replit`; `artifacts/api-server/.replit-artifact/artifact.toml`; `scripts/start-replit-production.mjs`; `artifacts/api-server/src/index.ts`; `artifacts/api-server/src/lib/webApp.ts`; `docs/implementation-v2.5/RELEASE_PROVENANCE.md`
Supersedes: Implicit Replit-oriented deployment assumption in `DOC-003`
Superseded by: None

## Context

The production source configuration selects a Replit autoscale application deployment. Replit rebuilds from a source snapshot, and the API process also serves the built Workbench. There is no independently deployed worker service or mounted worker-control endpoint. The startup wrapper performs guarded database migrations, validates any explicitly selected in-process schedules, and only then imports the API entrypoint.

This is a current operational constraint, not a claim that a live provider deployment has been independently observed or that Replit runs the byte-identical GitHub release artifact.

## Decision

Retain one Replit application deployment as the current topology:

1. `scripts/start-replit-production.mjs` is the sole production entrypoint on both checked-in Replit surfaces.
2. Startup order is migration gate, optional schedule selection, database/runtime attestation, then HTTP listen. Any selected but ineligible schedule or failed startup attestation fails closed before traffic is accepted.
3. The API serves `/api` and the production Workbench from the same Node process. Health and readiness remain exact unauthenticated probes; application routes retain their own authentication and tenant policy.
4. No external worker-control surface is mounted. A separately scalable worker, scheduler or provider dispatcher requires a new or amended ADR, workload identity, operational ownership, deployment evidence and failure-isolation plan.
5. In-process schedules remain off when `VALO_INPROCESS_SCHEDULES` is absent. They may be selected only from manifest entries marked `ready_for_platform_install`. Before enabling one on autoscale, operations must also prove single-active-run behavior across replicas or a job-specific distributed-exclusion/idempotency control; the runner's memory-only `concurrencyPolicy: forbid` is not a cross-replica lock.
6. Release verification must record the Replit source snapshot and immutable deployment ID. Environment-declared release identity is not represented as a measured live artifact digest.

## Consequences

The topology is simple and inexpensive to operate, but API, web delivery and any opted-in schedule share a process lifecycle and deployment blast radius. Autoscale restarts or multiple replicas make in-memory scheduling unsuitable as an exactly-once mechanism. Long/provider work stays behind the durable activation boundary until an independently authenticated workload and operational controls exist.

## Rejected

Claiming a separate worker that is not deployed; silently starting every declared schedule; using a human session as worker identity; representing a Replit source rebuild as byte-for-byte promotion of the GitHub candidate.
