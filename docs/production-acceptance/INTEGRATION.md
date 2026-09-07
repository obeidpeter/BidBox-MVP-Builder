# Production Acceptance & Recovery Console integration

This module records and verifies evidence about recovery readiness. It cannot run migrations, backups, restores, rollbacks, or deployments. A `go` recommendation still requires named human approval and never authorises deployment.

## Backend exports

The deterministic contracts and service are exported from `artifacts/api-server/src/lib/productionAcceptance/index.ts`:

- evidence, snapshot, scope, and repository types;
- category/schema/bounds constants and the closed draft parser;
- evidence creation and SHA-256 digest verification;
- fail-closed snapshot evaluation and append validation;
- the unavailable default repository and typed unavailable/validation errors.

`artifacts/api-server/src/routes/productionAcceptance.ts` exports:

- `createProductionAcceptanceRouter(options)`;
- `ProductionAcceptanceRouterOptions`;
- `canReadProductionAcceptance(context)` and `canRecordProductionAcceptance(context)`.

The application mounts the factory under `/api` after authentication, tenant
context, tenant database, and resource-boundary middleware:

```ts
app.use(
  "/api",
  createProductionAcceptanceRouter({
    repository: new AuditProductionAcceptanceRepository(),
    currentReleaseSha256: () => exactReleaseSha256,
  }),
);
```

The integrated repository uses the tenant audit chain as an append-only evidence
register. It revalidates the reader, verifier, and accountable owner against
current direct memberships, active named users, and current role grants inside
the database transaction. It never relies on the browser's user list to decide
authority.

## Repository activation contract

The route index injects `AuditProductionAcceptanceRepository`; the factory's
default remains intentionally unavailable for isolated or incorrectly composed
mounts. The connected implementation:

1. derive organisation scope from the supplied `ProductionAcceptanceScope`, never from request payload data;
2. enforce database RLS and tenant-isolation tests for both reads and writes;
3. persist rows append-only and reject mutation or deletion;
4. bind each idempotency key to the supplied stable request digest, returning the originally stored immutable evidence on an exact replay and a conflict otherwise;
5. atomically append a content-free audit receipt with a newly appended row;
6. preserve the stored evidence object byte-for-field so digest verification remains deterministic;
7. return only rows from the requested organisation and honour the supplied limit.

Set `VALO_RELEASE_SHA256` to the exact 64-character lowercase SHA-256 release identifier, or inject `currentReleaseSha256`. Evidence for another release is rejected.

## HTTP contract

- `GET /api/production-acceptance` returns the seven-category snapshot. It requires a direct internal membership, `audit:read`, and an accepted internal role.
- `GET /api/production-acceptance/authorities` returns at most 100 current,
  named, direct tenant authorities who may act as the independent accountable
  owner. The current verifier is excluded. It has the stricter recording gate
  and exposes no email address or delegated membership.
- `POST /api/production-acceptance/evidence` records metadata only. It additionally requires an operations/quality role and `configuration:manage` or `evaluation:manage`. The authenticated verifier must differ from the named owner.
- There are intentionally no recovery-action or destructive `PUT`, `PATCH`, or `DELETE` endpoints.

Responses are `private, no-store`. Both record and snapshot responses explicitly expose `deploymentAuthorized: false`.

## Frontend exports

`artifacts/bidbox-workbench/src/components/production-acceptance/index.ts` exports the strict runtime adapter, evidence form, console, and their public types. `artifacts/bidbox-workbench/src/pages/production-acceptance.tsx` has the default page export.

The page is mounted at `/production-acceptance`, uses the authenticated
organisation-aware fetch client, keys the evidence and authority queries by
organisation, and fails closed for offline, partner, unauthorised, stale-tenant,
or malformed responses. The owner control consumes only the bounded authority
endpoint and never accepts a raw user identifier.

## Go-live gates

Do not expose this module in production until all of these gates are evidenced:

- the connected append-only repository and atomic audit receipt are healthy;
- migrations have been applied and verified in a production-like environment;
- RLS and cross-tenant negative tests pass against the production database policy;
- accessibility and supported-browser checks pass on the integrated route;
- backup, restore, and rollback rehearsals have owners, immutable artifacts, and unexpired evidence;
- the exact release digest is supplied by the deployment pipeline;
- monitoring alerts on repository unavailability, integrity blockers, and repeated recording conflicts;
- a named human approver and an external deployment control remain responsible for the final decision.
