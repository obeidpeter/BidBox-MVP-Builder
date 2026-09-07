# Database package

`@workspace/db` owns BidBox's PostgreSQL contract: Drizzle schema, ordered SQL migrations, connection-pool configuration, transaction helpers, FORCE RLS policies, database guards/functions, runtime identities, and startup security attestation.

## Entry points and boundaries

- [`src/index.ts`](src/index.ts) exports the application-facing database API.
- [`src/schema`](src/schema/) owns the logical schema definitions.
- `@workspace/db/replit-intake-migrations` is the sole cross-workspace entrypoint to the bounded Replit migration launcher; other files under `scripts/` remain package-internal.
- [`migrations`](migrations/) and the Drizzle journal are the ordered database change authority.
- [`src/runtimeSecurity.ts`](src/runtimeSecurity.ts) verifies required runtime security objects and privileges.

Allowed principal dependencies are PostgreSQL, Drizzle, and Zod. This package must not depend on HTTP routes, browser components, or provider SDKs. Application code enters through exported helpers and tenant-scoped transactions; new bypass, owner, or cross-tenant capabilities require an explicit reviewed security decision.

## Commands

```sh
pnpm --filter @workspace/db run migration:check
pnpm --filter @workspace/db run test
pnpm --filter @workspace/db run migration:apply
pnpm --filter @workspace/db run migration:bridge:legacy:rehearse
```

Every database command requires an intentional `DATABASE_URL`. Migration apply, legacy bridge, purge, and maintenance commands mutate data: use a disposable PostgreSQL 16 database for development and CI rehearsal, and follow the production migration/runbook gates for any controlled environment.

Architecture: [authentication → tenant → RLS flow](../../docs/architecture/DYNAMIC_FLOWS.md#authentication--tenant--rls), [component map](../../docs/architecture/COMPONENT_MAP.md), and [deployment trust boundaries](../../docs/architecture/DEPLOYMENT.md).
