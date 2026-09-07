# Operations and developer handover

Status: maintained operational entry point. Last reviewed 2026-08-31. See the [root README](../../README.md) and [current architecture guidebook](../architecture/README.md) before relying on older implementation snapshots in this dossier.

## Repository surfaces

- Web: `artifacts/bidbox-workbench`
- API/runtime: `artifacts/api-server`
- Durable-worker foundation: `artifacts/api-server/src/lib/durableWorkerFoundation.ts` (external workload activation remains gated)
- Schema and source-controlled migrations: `lib/db`
- Contract: `lib/api-spec/openapi.yaml` and generated clients/schemas
- CI: `.github/workflows/ci.yml`
- Implementation dossier: this directory

## Baseline local verification

Use the repository's pinned pnpm/Node versions and a disposable PostgreSQL 16 database. Never place real credentials in shell history/logs.

```text
pnpm install --frozen-lockfile
pnpm run doctor
pnpm run verify:architecture
pnpm run check:fast

# With an approved disposable PostgreSQL 16 DATABASE_URL:
pnpm run check:db

# Complete local candidate verification:
pnpm run check:all
```

Never use schema push against shared, staging or production databases. `check:db` applies the source-controlled migration history to an explicitly supplied disposable test database. When OpenAPI changes, regenerate through the existing codegen command and fail on unexpected generated drift. Live AI proofs require the approved deployment environment/secret mechanism and are not substituted by offline checks.

## Release evidence locations

CI reports/logs, SBOM/provenance and scan results belong in immutable CI/artefact storage. Operational drill/deploy records use evidence IDs/hashes referenced from `REQUIREMENTS_TRACEABILITY.md`, `DEPLOYMENT_RECORD.md` and `ACCEPTANCE_REPORT.md`; do not commit secrets, production logs or client content.

## First priorities

1. Keep current/target/deployed/verified architecture labels and the driver-to-evidence ledger synchronized with every significant change.
2. Close or explicitly defer external worker identity, audit-anchor, telemetry/paging and scheduled-operation activation gates.
3. Retain production-shaped permission/RLS, concurrency, export, accessibility, load, restore and rollback evidence for the exact release.
4. Reconcile every live release identity and configuration digest through the deployment runbook; never treat source presence as deployment proof.
