# API server

`@workspace/api-server` is BidBox's Express composition root and server-side application. It owns HTTP middleware order, Clerk-to-local-user resolution, tenant and database boundaries, domain routes, provider/storage adapters, and production lifecycle signals.

## Entry points and boundaries

- [`src/index.ts`](src/index.ts) attests runtime database security, registers runtime identity, starts the server, and installs graceful shutdown.
- [`src/app.ts`](src/app.ts) composes the application edge and production Workbench host.
- [`src/routes/index.ts`](src/routes/index.ts) separates public, tenant-free authenticated control-plane, and tenant-scoped routes.
- [`src/middlewares`](src/middlewares/) owns authentication, tenant context, request transactions, resource boundaries, and rate limiting.
- [`src/lib`](src/lib/) contains deterministic policies/services plus bounded database, storage, worker, and provider adapters.

Allowed principal dependencies are the generated `@workspace/api-zod` contracts, `@workspace/db`, approved integration adapters, and package-declared server libraries. Route modules must not trust client-supplied actor or tenant identity, bypass the tenant transaction/RLS boundary, or call unapproved providers directly. Browser presentation belongs in the Workbench; transport shape changes begin in `@workspace/api-spec`.

## Commands

```sh
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/api-server run test
pnpm --filter @workspace/api-server run prove:ship
```

The test suite includes database-backed paths and expects `DATABASE_URL` to identify a disposable PostgreSQL 16 database. The `dev` shortcut uses POSIX environment syntax; on Windows, set `NODE_ENV` and `PORT` in PowerShell, then run `build` and `start`.

Architecture: [selected components](../../docs/architecture/COMPONENTS.md), [component map](../../docs/architecture/COMPONENT_MAP.md), and [dynamic flows](../../docs/architecture/DYNAMIC_FLOWS.md).
