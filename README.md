# BidBox

BidBox is a tenant-isolated tender delivery and assurance platform. This repository contains the React Workbench, Express API, PostgreSQL schema and security controls, OpenAPI-generated clients, operational controls, and controlled documentation.

## Start here

- [Living architecture guidebook](docs/architecture/README.md) — current boundaries, deployment view, dynamic flows, quality drivers, and risks.
- [User manual](docs/USER_MANUAL.md) — task-oriented product guidance.
- [Controlled Nigeria v2.5 dossier](docs/implementation-v2.5/README.md) — requirements, accepted decisions, security, operations, and release evidence rules.
- [OpenAPI contract](lib/api-spec/openapi.yaml) — authoritative HTTP interface.

The words **current**, **target**, **deployed**, and **verified** have distinct meanings in the [architecture status vocabulary](docs/architecture/README.md#status-vocabulary). A merged build or Replit configuration is not, by itself, proof of a live deployment.

## Workspace map

| Area                                                                 | Responsibility                                                                      |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| [`artifacts/api-server`](artifacts/api-server/README.md)             | HTTP composition, identity/tenant enforcement, domain routes, and runtime adapters. |
| [`artifacts/bidbox-workbench`](artifacts/bidbox-workbench/README.md) | Public, access, and signed-in browser experience.                                   |
| [`lib/db`](lib/db/README.md)                                         | Schema, migrations, RLS, runtime security attestation, and database maintenance.    |
| [`lib/api-spec`](lib/api-spec/README.md)                             | OpenAPI authority and reproducible client/validator generation.                     |
| `lib/api-client-react`, `lib/api-zod`                                | Generated contract outputs; change them through `lib/api-spec`.                     |
| `config`                                                             | Reviewed release, operations, provider, usability, and architecture catalogues.     |
| `scripts`                                                            | CI fitness checks, startup gates, release provenance, and operational verification. |
| `docs`                                                               | Controlled dossier, capability notes, runbooks, and the architecture guidebook.     |

## Prerequisites

- Node.js `>=22 <25`
- pnpm `>=10.34 <11` (the workspace pins `pnpm@10.34.0`)
- PostgreSQL 16 for database-backed checks and local API work

Install and run the fast, database-free validation path:

```sh
pnpm install --frozen-lockfile
pnpm run doctor
pnpm run check:fast
```

`pnpm run check:db` applies and rehearses migrations. Point `DATABASE_URL` only at a disposable PostgreSQL 16 database created for the check; never run it against production or a populated development database.

## Development

The checked-in Replit `Project` workflow starts the API and Workbench together. It supplies `PORT=5000` to the API and runs the Workbench on `PORT=3000` with `API_PROXY_TARGET=http://127.0.0.1:5000`.

For local development, provide the same values in your shell plus the documented identity/database configuration, then run these blocking processes in separate terminals:

```sh
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/bidbox-workbench run dev
```

On Windows, set environment variables in PowerShell before invoking the API build/start commands; the package's `dev` shortcut uses POSIX environment syntax. Secrets belong in the deployment or local secret store, never in source.

## Contracts and verification

Change HTTP operations in [`lib/api-spec/openapi.yaml`](lib/api-spec/openapi.yaml), run `pnpm --filter @workspace/api-spec codegen`, and commit the deterministic generated outputs. `pnpm run codegen:check` rejects drift.

Use the smallest relevant check while iterating, then the release-required suite:

```sh
pnpm run check:fast
pnpm run check:all
```

The full suite needs the disposable database described above. Package-specific commands and dependency rules are documented in the linked package READMEs.

## Release and deployment

CI produces and verifies a release candidate; it does not silently deploy it. A human-authorised promotion must bind the immutable candidate to the provider deployment, after which the protected deployment-verification workflow checks the live identity and probes. See [deployment and trust boundaries](docs/architecture/DEPLOYMENT.md) and [release provenance](docs/implementation-v2.5/RELEASE_PROVENANCE.md).

## Keeping architecture current

When a change moves a trust boundary, data owner, deployment topology, dependency rule, or long-lived trade-off, update the affected [guidebook view](docs/architecture/README.md#maintenance-rule) and ADR in the same change. Do not use architecture documents as a substitute for executable contracts or retained operational evidence.
