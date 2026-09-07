# Post-award Commercial & Claims Desk integration contract

Status: application integration complete. API, direct-membership Workbench access, exact released-ledger exceptions, OpenAPI, and generated clients are mounted or published. Retention completion is activation-gated and does not mutate Claims Desk content.

## Runtime exports

- API route factory: `createClaimsDeskRouter` and default `claimsDeskRouter` from `artifacts/api-server/src/routes/claimsDesk.ts`.
- Production repository: `PostgresClaimsDeskRepository` and `postgresClaimsDeskRepository` from `artifacts/api-server/src/lib/claimsDesk/repository.ts`.
- Shared backend modules: `artifacts/api-server/src/lib/claimsDesk/{contracts,service,repository,activation}.ts`.
- Workbench page default export: `artifacts/bidbox-workbench/src/pages/claims-desk.tsx`.
- Workbench component barrel: `artifacts/bidbox-workbench/src/components/claims-desk/index.ts`.

The API factory defaults to the real tenant-RLS Postgres repository. Repository injection exists only for deterministic route tests; production has no memory fallback.

## Completed shared integration

1. `artifacts/api-server/src/routes/index.ts` mounts `createClaimsDeskRouter()` after tenant context, tenant database, and resource-boundary guards.
2. `artifacts/bidbox-workbench/src/protected-routes.tsx` lazy-loads `/claims-desk` behind the dedicated `claims_desk` platform area.
3. Navigation and route access require direct membership plus `project:read`; the page requires `project:update` before rendering mutation controls and provides tenant-keyed project selection.
4. The consolidated OpenAPI publishes the Claims Desk operations and generated React/Zod clients. The page still validates runtime payloads before rendering them.

## Released-project immutability exception

The repository is event-sourced and performs only `INSERT` into the `[CLAIMS-DESK:*]` namespace. To keep it usable after sign-off/export, the shared immutable-project guard must add exactly the two exported exceptions from `CLAIMS_DESK_RELEASED_LEDGER_ROUTE_EXCEPTIONS`:

```text
POST ^/projects/[^/]+/claims-desk/records$
POST ^/projects/[^/]+/claims-desk/records/[^/]+/transitions$
```

No PATCH, PUT, DELETE, document, notice-dispatch, invoice or payment route is eligible. The exception is valid only for `signed_off` and `exported`; `archived` must remain terminal. The repository independently re-reads project status and rejects archived projects for reads and writes.

## Namespace and retention contract

- Durable rows use title prefix `[CLAIMS-DESK:` and a `valo.claims-desk-ledger/v1` JSON envelope.
- Claims Desk rows must not be independently deleted. The retention-completion endpoint returns an explicit `503` and leaves the namespace, audit chain, project, request and certificate untouched.
- Reactivation requires a durable two-phase detach/reconcile/certify workflow that governs Claims Desk envelopes alongside all relational content, object storage, upload sessions, lifecycle control rows and legal holds.
- A future certificate must report the proven Claims Desk disposition without embedding confidential envelope content. The previous synchronous selector and certificate-count implementation is not active.

The exact exported selector is `CLAIMS_DESK_RETENTION_WORK_TASK_LIKE === "[CLAIMS-DESK:%"`.

## Security and authority boundary

- Read: direct active tenant membership and exact `project:read`.
- Manage: direct active tenant membership and exact `project:update`.
- The repository revalidates membership activity, tenant/project scope, canonical current document SHA-256, malware-clean and quarantine-cleared posture inside the write transaction.
- Creation and every transition are idempotent; transitions are CAS guarded by `If-Match`.
- Assessment and closure approvals enforce different maker/checker user IDs.
- Audit receipts contain IDs, versions, event kind, timestamp and digest only; references and raw document content are omitted.
- Amounts are non-negative safe integers in minor units paired with an active ISO 4217 code. They do not certify valuation or pricing.
- The feature cannot reach legal conclusions, certify entitlement/valuation, price work, dispatch notices, mutate invoices/payments, call providers, or act autonomously.

## Activation evidence required

- API and Workbench source/test typechecks green.
- Focused service, reducer, route, UI and static-security tests green.
- Shared tenancy tests cover both released exceptions plus archived/non-matching denial.
- Retention activation tests prove the completion route has no database, storage or audit mutation path and cannot issue a certificate.
- Browser test proves direct-membership read/manage gates, CAS conflict recovery, maker-checker denial, tenant switch isolation, canonical evidence rejection, signed-off/exported append and archived denial.
