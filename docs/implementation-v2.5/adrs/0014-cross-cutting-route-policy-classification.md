# ADR-0014: Cross-cutting route-policy classification

Status: Accepted; contract/runtime identifier reconciliation automated; live mount-order review remains required
Date: 2026-08-31
Last reviewed: 2026-08-31
Next review: 2026-10-31
Owner: API and application security (`@obeidpeter`)
Backup owner: Unassigned; tracked as `AR-001`
Reviewers: API, security/privacy and operations role holders for a new route class or high-risk override; named alternates are not yet recorded
Drivers: `AD-001`, `AD-002`, `AD-007`, `AD-009`
Evidence: `artifacts/api-server/src/app.ts`; `artifacts/api-server/src/routes/index.ts`; `artifacts/api-server/src/lib/projectRoutePolicy.ts`; `artifacts/api-server/src/middlewares/tenancy.ts`; `artifacts/api-server/src/middlewares/databaseTenancy.ts`; `config/architecture/route-policies.v1.json`; `lib/api-spec/openapi.yaml`; `scripts/verify-architecture.mjs`
Supersedes: Per-route implicit assumptions about authentication, tenant context and response authority
Superseded by: None

## Context

BidBox has health probes, an identity proxy, public intake, authenticated tenant-free control-plane routes, tenant-plane routes and an intentionally unmounted workload surface. Mount order supplies security properties that are easy to bypass accidentally when a router is added in the wrong place. High-risk operations need stricter rules than their class default.

## Decision

Every route module or mounted prefix must declare exactly one default class in `config/architecture/route-policies.v1.json`:

- `public_health`: exact liveness/readiness only; no Clerk or throttling; no tenant data;
- `identity_proxy`: exact Clerk proxy prefix; fixed upstream and allowlisted public host;
- `public_intake`: no session, but approved origin, shared durable rate limit, strict bounded JSON and idempotency;
- `authenticated_control_plane`: Clerk/local user and actor mutation limit before tenant selection; each tenant-sensitive handler attaches and verifies its own context;
- `authenticated_tenant_plane`: Clerk/local user, resolved access context, break-glass audit, tenant/actor rate limit, transaction-scoped database context, RLS and resource-boundary enforcement; or
- `unmounted_workload`: no public/user mount until the workload activation ADR is satisfied.

The catalogue records mount order, route modules and high-risk overrides. Overrides may strengthen but never weaken their class. Sign-off/export follow ADR-0013; membership/grant changes share the authority advisory lock and require direct administration; feature-flag writes require permission, expected version and audited server evaluation; sensitive storage downloads require registered tenant references and audit before streaming; controlled reports/packages never use generic object download.

New or moved routes must update the catalogue and OpenAPI/generated contract when externally callable. A client tenant header, path identifier, role label, feature flag or UI gate is never authentication or authorization. Unknown/unclassified mounts fail architecture review.

`scripts/verify-architecture.mjs` rejects an OpenAPI operation without one most-specific prefix default, an override that does not bind an OpenAPI operation or declare an explicit activation-gated/internal classification, and a runtime `projectRoutePolicy.ts` identifier missing from the architecture catalogue. This automates contract and high-risk identifier reconciliation. It does not infer Express mount order or middleware semantics: `app.ts` and `routes/index.ts` remain the executable mount source of truth, their review remains required, and residual drift risk remains tracked as `AR-006`.

## Consequences

Reviewers can reason about middleware once per class and focus endpoint review on stronger overrides. Public and control-plane exceptions become explicit. The catalogue is intentionally module/prefix based rather than a duplicate hand-maintained list of every endpoint.

## Rejected

One global middleware stack for health, public intake and application APIs; assuming a router is protected because its path starts with `/api`; treating OpenAPI security declarations as runtime enforcement; mounting worker controls behind an ordinary human session.
