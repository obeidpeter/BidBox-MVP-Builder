# Monitoring and alerting contract

Status: **privacy-safe signal registry and adapter boundary implemented; telemetry backend, alert evaluator and paging adapter not deployed**.

The machine-readable alert pack is `config/observability/alerts.v2.5.json`; its source/derivation registry is `config/observability/signals.v1.json`. CI validates that every alert points to a unique registered signal and has one adapter-neutral synthetic trigger fixture in `config/observability/synthetic-alerts.v1.json`. The registry distinguishes values emitted by source, values that a deployment adapter must derive, external evidence and gaps that are not implemented. The API emits a versioned batch of aggregate HTTP duration/status, database-pool pressure and lifecycle points to structured logs, with bounded request correlation IDs. A metrics adapter may report `connected` only with the exact registry version and an immutable verification-evidence reference; paging likewise requires synthetic delivery evidence. Both remain `disconnected` in the current composition.

## Probe contract

- `GET /api/healthz` is unauthenticated process **liveness**. It does not query Clerk, PostgreSQL or a provider. Use it only to decide whether the process should be restarted.
- `GET /api/readyz` is unauthenticated deployment **readiness**. It returns `200` only while the runtime accepts traffic and a bounded PostgreSQL probe succeeds; starting, draining, timeout and database failure return `503`. Responses are `private, no-store` and expose no dependency error details.
- The deployment load balancer and the `deployment_health` alert use `readyz`. They must not substitute `healthz`, because a live process can correctly refuse traffic while its dependency is unavailable or while it drains.
- External metrics/paging delivery is informational in the readiness body and remains `disconnected` until installed and verified. Missing optional delivery does not make the API dependency probe lie; the release gates below still prohibit calling monitoring verified.

## Required signal flow

1. API, worker, database, storage and provider adapters emit structured metrics without document content, personal data, tokens or secrets.
2. The deployment adapter maps each stable signal name in the alert pack to the selected metrics backend.
3. Alert evaluation preserves organisation identifiers only where the incident responder is authorised to see them; shared dashboards use aggregate or pseudonymous dimensions.
4. Critical and high alerts create an immutable delivery receipt and link to the named runbook.
5. Liveness, backup and audit-anchor alerts remain independent of the application database they supervise. Deployment readiness deliberately probes the application database.
6. Staging injects a synthetic failure for every alert before production approval; the deployment record retains the result and acknowledgement latency.

The repository fixtures prove coverage and payload shape only. They do **not** prove that an external evaluator fired, that a page arrived, or that anybody acknowledged it. Those are target-environment acceptance artefacts.

## Release gates

- No production release may label monitoring **verified** until the deployment adapter, dashboard, paging route and synthetic alert evidence exist.
- `deployment_health`, `backup_freshness` and `audit_anchor_failure` are release-blocking.
- Extraction quality is evaluated against the promoted holdout; a missing holdout result is a failed signal, not a zero-error result.
- Unit-cost thresholds are effective-dated configuration and must not be embedded in source.
- Tenant-denial and break-glass alerts are security events; access to their details follows the restricted audit role, not ordinary project membership.
- Durable storage deletion exposes a dead-letter transition counter and an oldest-age sample. The age alert is valid only when the same run emits `bidbox.storage.deletion_sample_complete=1`; a partial rotating tenant page must never be presented as the global backlog. Source now includes the tenant-fair reconciler entrypoint, but a platform schedule, provider-timeout proof and verified alert delivery receipt remain required before storage lifecycle automation can be called operationally active.
- Browser PUT grants close before their database lease and the reconciler waits a further bounded grace, but the current Replit/GCS sidecar contract does not prove a maximum duration for a PUT accepted before URL expiry. Production activation therefore remains blocked until the deployment proves an upper request-duration cap within that grace or replaces the signer with a create-only/generation-preconditioned capability. The response and status model deliberately call this bounded reconciliation, never exact late-write prevention.
- The deletion worker remains activation-gated until a content-minimised terminal-row retention policy and an operator-authorised, tamper-evident dead-letter replay/resolution workflow are implemented and rehearsed. Retry and dead-letter transitions are audited today; this does not imply that operator replay is available.
- Scheduled entrypoints emit sparse last-success timestamps rather than refreshing a heartbeat after a failure. The alert adapter derives staleness from those timestamps. Storage reconciliation emits its last-full-cycle timestamp only after every bounded organisation/upload page completes with no tenant or intent failure; a partial page never refreshes it.
- Backup and audit-anchor evidence validators require an absolute regular file plus a separately supplied SHA-256 digest. They validate strict timelines, RPO/age limits, complete tenant coverage and exact chain-head correspondence, but they do not create a provider backup or immutable anchor. Provider capture, signature verification and an independently controlled digest source remain platform prerequisites.

## Operator evidence record

For each environment record the alert-pack hash, telemetry adapter/version, dashboard URL, paging destination reference, synthetic trigger time, delivery receipt, acknowledgement time, resolver, linked incident/change ID and any suppression with expiry/approver. Add those references to `DEPLOYMENT_RECORD.md`; never paste secrets or personal recipient details into source control.

Runtime budgets, graceful shutdown behavior and the commit-before-stream gate are recorded in [RUNTIME_RELIABILITY.md](RUNTIME_RELIABILITY.md).
