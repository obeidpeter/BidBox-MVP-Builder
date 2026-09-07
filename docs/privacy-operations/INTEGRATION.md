# Privacy Operations Centre integration

This isolated module provides a bounded, tenant-scoped privacy evidence dashboard and three named-human recording workflows. It cannot contact a provider, establish identity, make a legal conclusion, release a legal hold, execute deletion, or alter a subprocessor/transfer approval.

## Backend exports and mount

`artifacts/api-server/src/lib/privacyOperationsCentre/` ({contracts,service,repository}.ts) exports the deterministic contracts, parsers, dashboard reducer, Postgres repository, audit-receipt utility, and workflow services.

`artifacts/api-server/src/routes/privacyOperationsCentre.ts` exports:

- `createPrivacyOperationsRouter(options)`;
- `PrivacyOperationsRouterOptions`;
- `canReadPrivacyOperations(context)`;
- `canManagePrivacyOperations(context)`.

Mount the factory under `/api` after the existing authentication and tenant-context middleware:

```ts
app.use("/api", createPrivacyOperationsRouter());
```

The default is the real `PostgresPrivacyOperationsRepository`. It wraps every operation in `withTenantDatabase`, applies explicit organisation predicates in addition to FORCE RLS, uses optimistic versions for compare-and-swap, and appends the privacy workflow receipt to the tenant audit chain in the same read-committed transaction.

## HTTP contract

- `GET /api/privacy-operations/assignees` requires direct membership and `privacy:manage`. It returns at most 100 active, direct, named users with a current privacy-management role; it exposes no email address or delegated identity.
- `GET /api/privacy-operations?limit=25` requires direct membership and `privacy:read`. The limit is 1–50 and defaults to 25.
- `POST /api/privacy-operations/data-subject-requests/:id/triage` requires direct membership, `privacy:manage`, an `If-Match` version, an active named tenant assignee, a controlled reason, and a decision-evidence SHA-256.
- `POST /api/privacy-operations/consent-records/:id/withdrawal` requires direct membership, `privacy:manage`, `If-Match`, an observed timestamp, and an evidence SHA-256. It cannot reverse or repeat a withdrawal.
- `POST /api/privacy-operations/legal-holds/:id/reviews` requires direct membership, `privacy:manage`, `If-Match`, a controlled human outcome, a bounded next-review date, and an evidence SHA-256. A `release_recommended` review is evidence only and does not release the hold.

Partner-derived and break-glass contexts are denied even if a synthetic permission set contains a privacy permission. Responses are `private, no-store` and explicitly report `legalDecisionAutomated: false`.

## Data minimisation and existing persistence

No schema or migration is introduced. The repository reuses:

- `data_subject_requests` for due/status/assignee/version posture, never selecting `requester_reference`;
- `consent_records` for capture/withdrawal/version posture, never selecting `subject_reference` or `affirmative_action`;
- `legal_holds` for active/released state and CAS review touches, never selecting free-text scope/reason;
- `subprocessors` and `cross_border_transfers` for corporate/review posture;
- `retention_actions` and `deletion_certificates` for deletion-receipt status;
- the v2 tenant `audit_events` chain for immutable DSR triage, consent withdrawal, and hold-review receipts.

Free-text response/approval evidence is reduced in SQL to present/absent and exact SHA-256 state. Lists do not expose requester/subject references, contact details, hold narratives, transfer data categories, or deletion object identifiers. Workflow bodies are closed schemas with controlled codes and digests; narrative PII is rejected.

## Frontend exports

`artifacts/bidbox-workbench/src/components/privacy-operations/index.ts` exports the runtime contract adapter, dashboard, and workflow panel. `artifacts/bidbox-workbench/src/pages/privacy-operations.tsx` default-exports the page mounted at `/privacy-operations`.

The mounted `/privacy-operations` page uses the existing organisation-aware authenticated fetch client, keys both the dashboard and bounded assignee directory by organisation, checks direct membership and exact privacy permissions, verifies every server payload at runtime, and holds the active organisation during mutations. Operators select a server-authorised named assignee; no UUID is entered manually.

## Activation gates

Before exposing the route in production, verify:

- deployed runtime credentials pass the existing FORCE-RLS startup check;
- positive and negative tenant-isolation tests cover all reused privacy tables and audit reads/writes;
- privacy owners agree the controlled status/outcome codes and evidence retention policy;
- alerts cover repository failures, CAS conflicts, malformed audit receipts, overdue DSRs/reviews, and missing deletion certificates;
- legal counsel confirms that the operational due/review windows are configuration inputs, not legal conclusions;
- a named human workflow remains responsible for identity verification, rights decisions, hold release, and deletion execution.
