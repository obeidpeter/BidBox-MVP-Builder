# Operations and developer handover

## Repository surfaces

- Web: `artifacts/bidbox-workbench`
- API/workers target: `artifacts/api-server`
- Schema target: `lib/db` (add versioned migrations; existing schema push is development/CI only)
- Contract: `lib/api-spec/openapi.yaml` and generated clients/schemas
- CI: `.github/workflows/ci.yml`
- Implementation dossier: this directory

## Baseline local verification

Use the repository's pinned pnpm/Node versions and a disposable PostgreSQL 16 database. Never place real credentials in shell history/logs.

```text
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm --filter @workspace/db run push-force        # disposable CI/test DB only
pnpm --filter @workspace/api-server test
pnpm --filter @workspace/bidbox-workbench test
pnpm --filter @workspace/api-server prove:doctrine:offline
pnpm --filter @workspace/api-server prove:injection:offline
pnpm --filter @workspace/api-server eval:harness:offline
pnpm --filter @workspace/api-server build
pnpm --filter @workspace/bidbox-workbench build
```

When OpenAPI changes, regenerate with the existing codegen command and fail on unexpected generated drift. Live AI proofs require the approved deployment environment/secret mechanism and are not substituted by offline checks.

## Current environment caveat

On the Windows working copy used by the frontend agent, Vitest did not start because the Rollup Windows native package was missing after workspace override resolution. No test assertions ran. Fix by restoring a lockfile-compatible platform dependency install in the approved runtime/CI; do not claim pass, hand-edit `node_modules`, relax the lockfile or skip the suite.

## Release evidence locations

CI reports/logs, SBOM/provenance and scan results belong in immutable CI/artefact storage. Operational drill/deploy records use evidence IDs/hashes referenced from `REQUIREMENTS_TRACEABILITY.md`, `DEPLOYMENT_RECORD.md` and `ACCEPTANCE_REPORT.md`; do not commit secrets, production logs or client content.

## First priorities

1. Versioned migrations and tenant/RLS backfill proof.
2. Full permission/storage/search/job/AI tenant negative suite.
3. Durable jobs/provider adapters/audit anchor.
4. Exact rule packs and legal/privacy approval.
5. Full tests, accessibility/security/load/render/restore/rollback.
6. Authorised staging then production deployment under runbook.
