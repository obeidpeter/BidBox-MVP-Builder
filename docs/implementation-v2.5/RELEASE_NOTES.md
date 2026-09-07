# Release notes: Nigeria v2.5 implementation candidate

Release state: **not released / not production accepted**
Documentation baseline: 2026-08-08

## Purpose

This candidate establishes the source-controlled implementation contract and adds a verified tranche of organisation-tenancy, release-governance and role-scoped UI work. It must not be marketed as a complete v2.5 production platform.

## Documentation added

- Baseline/gap audit and bidirectional requirements traceability.
- Product, UX, architecture, data, security/privacy, test and rule-pack specifications.
- Re-baselined dependency roadmap and Business Plan impact addendum.
- ADRs for modular monolith, tenancy/RLS, jobs, audit anchoring, adapters, feature flags and Nigeria rule packs.
- Deployment, backup, restore, incident and rollback runbooks.
- Administrator, reviewer, client and partner guides.
- Deployment and acceptance evidence records with current blockers.

## Application changes in this candidate

### Frontend

- Added role-scoped client portal, partner workspace, operations console, evidence/readiness, billing/entitlement, notifications and security/audit views.
- Added shared platform-state, access and role-home components; responsive navigation, skip link, mobile/offline/account states; canonical v2.5 role selection and feature-gated route guards.
- Added organisation discovery/selection context. Role grants now derive from the selected membership; switching is blocked during writes, context-bound caches are cancelled/removed, and the request client sets or clears `X-BidBox-Organisation-Id` explicitly.
- Personnel settings remain explicitly read-only because the mutation endpoint is retired. Unimplemented delivery/payment/partner capabilities are labelled unavailable or partial rather than simulated.

### Backend and data

- Added all 12 organisation roles, organisation/membership/grant/partner/break-glass/feature-flag schema, tenant-aware permission policy, security/tenant middleware and control-plane routes.
- Added `lib/db/migrations/0001_tenant_rls.sql`: transaction-GUC RLS with forced policies for tenant-resource tables, parent-derived policies for child tables, scoped tenant writes to feature/price overrides and a guarded non-production rollback.
- Tenant-scoped audit sequencing and hashes now include organisation identity; the verifier runs per tenant.
- Partner-derived access is capped at an explicit least-privilege set and intersected with the partner's own roles. Break-glass request use is fail-closed audited.
- Direct project payment/conflict/release/delete mutations and defect disposition/downgrade/delete bypasses fail closed. Report sign-off requires the assigned direct reviewer; generation after release is blocked; project ZIP export reruns current readiness under a transaction advisory lock.
- Unsupported-claim and red-team read-side gates are wired into sign-off and project ZIP export. Their producer workflow is not implemented, so this is not accepted as complete claim governance.
- Notification creation records only `queued`; callers cannot forge `sent`/delivered state. Retention and seed paths now enter explicit tenant transactions. Audit CSV values are protected from formula execution.
- Upload requests have bounded metadata and a 100 MiB absolute ceiling (50 MiB deployment default). Document intake performs a metadata precheck and bounded streaming read, avoiding an unbounded in-memory object download; authoritative inspection and quarantine remain blocked as described below.

## Verification evidence

| Check                                                          | Result                                                                                                                                                                                                                                           |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| DB declarations, API and scripts typechecks                    | **Passed**                                                                                                                                                                                                                                       |
| Focused backend pure/static security suite                     | **Passed:** 59/59 tests across 9 suites. Because the optional native `@esbuild/win32-x64` runner was unavailable, tests were compiled to temporary CommonJS and executed with `node --test`. This was not a full monorepo or live-database test. |
| Dependency-light API suite                                     | **Passed:** 246/246 tests across 45 suites; live-database integration tests excluded because no PostgreSQL target was supplied                                                                                                                   |
| Frontend source/test typechecks                                | **Passed**                                                                                                                                                                                                                                       |
| Frontend Vitest                                                | **Passed:** 8 files, 52 tests                                                                                                                                                                                                                    |
| Frontend production build                                      | **Passed:** 2,244 modules; only pre-existing UI sourcemap warnings reported                                                                                                                                                                      |
| API production build                                           | **Passed**                                                                                                                                                                                                                                       |
| OpenAPI/client generation                                      | **Passed:** OpenAPI 3.1 validation had zero errors; 234 generated React/Zod files were byte-identical across two runs                                                                                                                            |
| Offline doctrine/injection/eval harness                        | **Passed locally:** 3/3, 2,081/2,081 and 16/16 respectively; no recorded live-model run                                                                                                                                                          |
| Formatting/migration/config/security policy                    | **Passed statically;** no live migration apply/rollback                                                                                                                                                                                          |
| Production dependency audit                                    | **Passed:** no known vulnerabilities reported                                                                                                                                                                                                    |
| Live PostgreSQL/FORCE-RLS, provider/storage and deployment E2E | **Not run**                                                                                                                                                                                                                                      |

## Focused security disposition

Resolved in source/focused tests: partner privilege escalation, lossy break-glass auditing, cross-organisation audit predecessors, direct governed project/defect mutations, unassigned reviewer sign-off, post-release project mutation races, forged notification delivery, credentialed wildcard CORS, first-user auto-admin, feature-flag fail-open, global retention/seed tenant access and audit CSV formula injection.

Still blocking production acceptance:

- Uploads can reach extraction without the implemented malware/MIME/archive inspection gate. Bounded streaming and byte ceilings reduce memory-exhaustion exposure, but the signed-upload size/type is still caller-declared and no authoritative quarantine/malware decision precedes parsing.
- Production adapter readiness is not called at startup. Approved OCR/malware/payment/notification/licensed-feed/audit-anchor adapters and real delivery evidence are absent; the OpenAI adapter can be enumerated even when unhealthy or unapproved.
- Claim/evidence-link and red-team tables have no application producer. Unsupported generated prose can remain outside the registry, while mandatory red-team approval cannot be completed through the application. Direct DOCX/PDF downloads do not rerun current governance.
- Governed defect decisions have a helper/table but no API workflow, so an open fatal defect cannot lawfully be remediated or waived. Payment/conflict decision paths likewise remain intentionally unavailable and fail closed.
- Package/version/manifest/signoff/delivery tables have no server lifecycle. The ZIP path marks export before archive finalization, so a failed stream can be recorded as exported.
- The request transaction remains open until response finish, including slow external work; commit failure can occur after a success response, and fire-and-forget extraction can outlive its transaction. A durable job/outbox redesign is required.
- Partner suspend/revoke is implemented, but project scope, ownership/QA rules and co-sign remain incomplete; partner release stays denied.
- No external immutable audit anchor or live database/storage/provider/security/deployment proof exists.

## Compatibility and migration

The candidate preserves the TypeScript/PostgreSQL/React/OpenAPI architecture but changes the security model from a small all-staff workbench toward organisation tenancy and scoped roles. A source-controlled RLS migration now exists; no production migration was executed. Existing data still requires expand/backfill/validate/constrain rehearsal, reconciliation, live negative isolation tests, backup/restore and compatible rollback proof.

## Security/privacy and rule packs

Current Nigeria sources and effective-dated rule-pack status are recorded in `SECURITY_PRIVACY.md`. Authoritative document hashes, legal review, executable fixtures and signed activation are still required. The supplied Business Plan is v1.1 and Roadmap is v1.0, while the TRD claims alignment to missing Business Plan v1.2 and Roadmap v1.1; that discrepancy remains open. The local source archive has no Git metadata, but a read-only GitHub audit verified that `obeidpeter/Valo-MVP-Builder` is currently public and includes product-planning documents; repository visibility, history/content, secrets and MIT-licensing implications require owner/security/legal review.

## Feature activation

Client self-service mutation, auto-confirm, payment charging, WhatsApp intake, partner release/co-sign, benchmarks and restricted/in-country claims remain off or fail closed pending their documented gates. A queued notification is not delivery evidence.

## Known evidence limitations

There is no authorised production target, migration, deployment or smoke result; no accepted live RLS/cross-tenant, accessibility, load, security, AI holdout, render, backup/restore or rollback report; and no commercial activation evidence. See `ACCEPTANCE_REPORT.md` for the exact acceptance reconciliation and operator handover.
