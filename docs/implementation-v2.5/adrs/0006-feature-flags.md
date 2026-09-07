# ADR-0006: Server-enforced feature flags for commercial activation

Status: Accepted; server-side evaluation implemented
Date: 2026-08-08
Last reviewed: 2026-08-31
Next review: 2026-11-30
Owner: Product platform (`@obeidpeter`)
Backup owner: Unassigned; tracked as `AR-001`
Reviewers: Product and security/privacy role holders for sensitive or commercial activation; named alternates are not yet recorded
Drivers: `AD-001`, `AD-006`, `AD-011`
Evidence: `artifacts/api-server/src/routes/featureFlags.ts`; `artifacts/api-server/src/middlewares/tenancy.ts`; `artifacts/api-server/src/lib/featureFlags.ts`; `lib/db/src/schema/index.ts`; `config/architecture/route-policies.v1.json`
Supersedes: Environment-only and client-authoritative activation
Superseded by: None

## Context

Engineering may complete v1.5-v2.5 capabilities before commercial/legal/operational gates. UI-only or environment-only toggles are insufficient for per-tenant controlled activation.

## Decision

Use versioned server flags evaluated by environment, release, tenant, role and capability. Sensitive flags default off and require owner/expiry/reason. Flag decisions are audited and included in command/job authorisation. Client code may use evaluated flags for presentation but is never authoritative. A flag cannot bypass permissions, entitlement, privacy, evidence, conflict or readiness.

## Consequences

Every flagged path needs on/off tests and stale-cache-safe evaluation. Emergency disable is rapid and audited. Flag debt is reviewed each release; permanent policy becomes entitlement/config or code and the flag is retired.

## Rejected

Frontend toggles; code comments/manual instructions; flags that alter historical rule results or weaken invariants.
