# BidBox Workbench

`@workspace/bidbox-workbench` is the React/Vite browser application. It owns public pages, sign-in/access flows, the organisation-aware protected shell, task interfaces, accessible route transitions, and tenant/resource-scoped client caching.

## Entry points and boundaries

- [`src/main.tsx`](src/main.tsx) mounts the SPA; [`src/App.tsx`](src/App.tsx) classifies public, access, and protected navigation.
- [`src/authenticated-gateway.tsx`](src/authenticated-gateway.tsx) binds Clerk identity to a fresh React Query cache.
- [`src/protected-app.tsx`](src/protected-app.tsx) resolves the signed-in organisation/access context.
- [`src/protected-routes.tsx`](src/protected-routes.tsx) maps protected routes; [`src/pages`](src/pages/) and [`src/components`](src/components/) implement feature experiences.

Allowed principal dependencies are `@workspace/api-client-react`, Clerk's browser SDK, React Query, Wouter, and package-declared UI/form libraries. Workbench permission checks explain access and avoid guaranteed-denial calls; the API remains authoritative. The Workbench must not import server/database implementation or edit generated API operations directly.

## Commands

```sh
pnpm --filter @workspace/bidbox-workbench run dev
pnpm --filter @workspace/bidbox-workbench run typecheck
pnpm --filter @workspace/bidbox-workbench run test
pnpm --filter @workspace/bidbox-workbench run build
pnpm --filter @workspace/bidbox-workbench run budget:public
```

Local Vite development uses `PORT` and `BASE_PATH`; `API_PROXY_TARGET` points `/api` requests to the API process. The production build is served by the API process in the configured Replit topology.

Architecture: [selected components](../../docs/architecture/COMPONENTS.md), [current containers](../../docs/architecture/CONTAINERS.md), and [deployment](../../docs/architecture/DEPLOYMENT.md).
