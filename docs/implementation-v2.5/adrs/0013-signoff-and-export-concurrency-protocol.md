# ADR-0013: Exact sign-off and package-export concurrency protocol

Status: Accepted; source and race tests implemented; production contention evidence remains operational
Date: 2026-08-31
Last reviewed: 2026-08-31
Next review: 2026-10-31
Owner: Delivery governance (`@obeidpeter`)
Backup owner: Unassigned; tracked as `AR-001`
Reviewers: Product integrity, security/privacy and data role holders for release-protocol changes; named alternates are not yet recorded
Drivers: `AD-001`, `AD-003`, `AD-008`, `AD-010`
Evidence: `artifacts/api-server/src/routes/reports.ts`; `artifacts/api-server/src/lib/directMembershipAuthority.ts`; `artifacts/api-server/src/routes/organisations.ts`; `artifacts/api-server/src/middlewares/databaseTenancy.ts`; `artifacts/api-server/src/routes/reports.governanceRace.static.test.ts`; `artifacts/api-server/src/routes/reports.export.integration.test.ts`; `lib/db/migrations/0012_delivery_source_release_boundary.sql`; `lib/db/src/runtimeSecurity.ts`
Supersedes: Preflight-only authorization/readiness and stream-before-commit release behavior
Superseded by: None

## Context

Sign-off and package export are irreversible material gates. A correct preflight check can become stale while membership, a grant, NDA approval, project/report state, package provenance or release inputs change. Export also performs fallible object reads and ZIP assembly before it can return bytes.

## Decision

Treat preflight checks as user feedback only; authority comes from the final transaction.

The request resource boundary resolves the affected project and takes its transaction-scoped advisory lock before either report route runs. This `project -> membership/relationship -> rows -> audit` order is shared by project-scoped mutation paths; handler-level project lock calls are deliberate re-entries on the same transaction, not the first acquisition. Membership/grant administration takes only the membership namespace, and partner lifecycle administration takes only the exact relationship row, so neither introduces a back-edge to the project lock.

For report sign-off:

1. Require `report:sign_off`, the assigned reviewer, direct membership authority and a draft latest report.
2. After the request boundary holds the project advisory lock, enter the handler's final savepoint and resolve current direct authority under the same organisation-scoped advisory namespace used by membership administration.
3. Lock and re-read client governance, project and report; require the project/report versions and states to match. Recompute every readiness input after locks are held. Database guards force project-bound release-source mutations to contend with the project lock.
4. Obtain the database timestamp and resolve authority again at that exact instant, closing both concurrent revocation and naturally expiring-grant windows.
5. Compare-and-set the report and project, append the audit event in the same transaction, and commit before returning an authoritative receipt.

For project ZIP export:

1. Require `report:export`, a UUID idempotency key, quoted SHA-256 `If-Match`, exact report/package binding and a request-scope digest.
2. In the tenant request transaction, the shared resource boundary takes the project advisory lock before the handler performs permission/readiness reads, object fetches and complete ZIP assembly. A fetch/render/archive failure returns a real non-2xx response and no durable release evidence or success headers. Holding the project lock across this bounded preassembly is an explicit contention trade-off tracked by `AR-010`.
3. At the start of the handler's final savepoint, take the selected membership organisation's membership-administration advisory lock. For a partner-derived context, also share-lock the exact partner/client relationship. Evaluate current user, organisation, membership, grants and relationship access window at the database clock and reapply either the native or deliberately reduced partner permission matrix. Break-glass export fails closed.
4. Re-enter the already-held project advisory lock; re-read the idempotency receipt, project, latest signed report and canonical package binding; require exact snapshot/provenance equality; and lock/re-read the client NDA status and version.
5. Resolve the same access source again against a fresh database clock immediately before replay or persistence, closing natural membership, grant and relationship expiry while the transaction waited on project/package/client locks. The partner-edition flag is re-read as an admission gate, but feature-flag writers do not share this serialization protocol and the flag must not be described as a transaction-stable authority lock.
6. Persist/reuse the canonical package version, idempotency receipt, project state transition and audits atomically. A matching completed request is a read-only replay and must rebuild bytes matching its receipt.
7. Commit the tenant request transaction before setting ZIP headers or exposing bytes. Drift returns 409; lost authority returns an audited 403; changed NDA/governance returns 409 with a bounded blocker response.

## Consequences

Concurrent membership/grant revocation, exact partner-relationship lifecycle change, NDA change and release-source mutation are serialized or detected. A partner-edition flag change that commits before either authority read is detected, but is not serialized against this transaction. The protocol performs bounded ZIP assembly before the final authority/NDA row locks but while the shared project advisory lock and tenant request transaction are already held; `AR-010` tracks the resulting memory/contention exposure. Any future extraction of streaming, queueing or object persistence must preserve the exact confirmation digest, global project-first lock order, access-source identity, two database-clock authority evaluations, idempotent receipt and commit-before-capability boundary.

## Rejected

Relying on middleware authority captured at request start; checking NDA only before ZIP assembly; persisting an export before all bytes exist; returning headers before COMMIT; last-write-wins sign-off; idempotency keys not bound to the exact export scope.
