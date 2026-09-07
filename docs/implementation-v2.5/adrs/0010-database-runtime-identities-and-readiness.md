# ADR-0010: Database runtime identities and readiness attestation

Status: Accepted; exact startup attestation implemented; live credential custody and deployment evidence remain external
Date: 2026-08-31
Last reviewed: 2026-08-31
Next review: 2026-11-30
Owner: Platform security and data (`@obeidpeter`)
Backup owner: Unassigned; tracked as `AR-001`
Reviewers: Database operations and security/privacy role holders for role, migration or readiness changes; named alternates are not yet recorded
Drivers: `AD-001`, `AD-002`, `AD-008`, `AD-010`
Evidence: `lib/db/src/index.ts`; `lib/db/src/runtimeSecurity.ts`; `lib/db/src/runtimeSecurity.test.ts`; `lib/db/migrations/0001_tenant_rls.sql`; `scripts/start-replit-production.mjs`; `artifacts/api-server/src/index.ts`; `artifacts/api-server/src/routes/health.ts`
Supersedes: Production use of one owner-capable `DATABASE_URL` for migrations and application traffic
Superseded by: None

## Context

Production migration needs and application traffic have incompatible privilege requirements. The runtime must neither own tenant tables nor bypass forced RLS, and readiness must not turn green merely because a TCP/database query succeeds against a drifted security catalogue.

## Decision

1. `DATABASE_URL` is the migration-owner connection and target-attestation input. `VALO_RUNTIME_DATABASE_URL` is mandatory for production application traffic, must address the same database/TLS target, must carry different credentials, and must authenticate as exactly `valo_app_runtime`.
2. Guarded migrations run before the API module is imported. The runtime pool captures only the constrained connection. After pool construction, both database URLs are removed from the mutable process environment; approved delayed schedule runners must capture only the runtime credential and a credential-free owner target before that scrub.
3. Before listening, the API runs a read-only repeatable-read startup attestation. It verifies the exact runtime identity and role attributes, absence of ownership/inherited/bypass capabilities, schema/database privileges, table/column/sequence privileges, forced-RLS and policy catalogues, tenant-parent and special guard triggers including enabled state and binding, security/delivery/intake/rate-limit function semantics and ACLs, and pinned catalogue totals.
4. Tenant work runs in a transaction and sets the organisation only through `valo_security.set_current_organisation_id`. Cross-tenant nested context is prohibited; transaction-local context must not leak through the pool.
5. `/api/healthz` remains dependency-free liveness. `/api/readyz` is ready only while the process is accepting work and a bounded, single-flight `SELECT 1` succeeds. The API cannot reach accepting state unless the startup attestation already passed; readiness is rechecked after an in-flight probe so drain cannot report green.
6. Owner and special maintenance credentials are never general runtime fallbacks. A missing, equal, malformed or target-mismatched runtime URL fails production startup.

## Consequences

A drifted database security boundary blocks startup rather than degrading tenant isolation. Migrations and runtime have explicit blast radii, and readiness represents a constrained process that has passed startup attestation. Catalogue changes require synchronized migration, attestation and test updates. Per-probe readiness deliberately does not rerun the full expensive catalogue attestation.

## Rejected

Using the database owner for API traffic; accepting any non-superuser role by name alone; count-only trigger readiness; setting tenant context outside a transaction; exposing owner credentials to delayed children; making liveness depend on PostgreSQL.
