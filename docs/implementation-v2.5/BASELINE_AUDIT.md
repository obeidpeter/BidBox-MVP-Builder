# Baseline product and code audit

Audit snapshot: 2026-08-08. This is a source review, not proof of deployment or production suitability.

## Inputs reviewed

- `Valo_Business_Plan_v1.1.docx` (supplied file; extracted for complete text review).
- `Valo_Product_Roadmap_v1.0.docx` (supplied file and duplicate repository attachments).
- `Valo_TRD_v1.0.docx` (supplied file; not present in the repository archive).
- Master Implementation Prompt: Nigeria v2.5.
- Repository archive under review, including application, database schema, API contract, tests, CI workflow, and existing documentation.

No Business Plan v1.2 or Roadmap v1.1 was found. The TRD's alignment claim therefore cannot be reconciled and must not silently replace the supplied baseline.

## Executive finding

The repository contains a credible internal workbench for early Autopsy/Vault/Verifier delivery, not a production-ready multi-tenant v2.5 platform. Sound foundations should be retained: PostgreSQL/Drizzle persistence, Express routes, typed OpenAPI client generation, React workbench, deterministic risk/BOQ helpers, human review gates, report/export code, audit hashing, model provenance/evaluation scripts, and focused tests. Incremental modularisation is materially safer than a wholesale rewrite.

The production blockers are structural rather than cosmetic: client rows are the de facto boundary rather than organisations with enforced membership; broad `requireMember` checks do not express the required permission matrix; the observed schema has no tenant key/RLS policy; durable jobs and provider reconciliation are absent; migration history and infrastructure-as-code were not found; audit hashing is locally rewriteable without immutable anchoring; money types are inconsistent with the exact-decimal requirement; partner, order, subscription, consent-controlled benchmark, and complete package workflow models are missing; and no authorised deployment, backup restore, load, WCAG, or cross-tenant evidence was supplied.

Overall baseline classification: **Partial / pre-production**.

## Observed repository

| Surface             | Observed evidence                                                                                              | Assessment                                                                   |
| ------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Web application     | `artifacts/bidbox-workbench`, React/Vite, routes for dashboard, clients, projects, SBD and settings            | Retain; internal staff-first UX, incomplete role-specific portals            |
| API                 | `artifacts/api-server`, Express, authenticated route modules for core Autopsy functions                        | Retain and modularise; authorisation and tenancy need redesign               |
| Persistence         | `lib/db`, Drizzle/PostgreSQL, about 19 domain tables in one schema file                                        | Real persistence exists; no migration artefacts or RLS observed              |
| API contract        | `lib/api-spec/openapi.yaml`, generated Zod/client packages                                                     | Retain; expand and add contract-drift gate                                   |
| Core product        | clients, projects, documents, requirements, evidence, defects, BOQ, vault, capability, SBD, reports, retention | Substantial v0.1/v0.5 surface; several controls partial                      |
| Deterministic logic | risk/readiness/scorecard/BOQ-related code and unit tests                                                       | Retain; exact-money and exhaustive state coverage need proof                 |
| AI controls         | prompt/model provenance, structured sanitisation, evaluation and injection scripts                             | Retain; holdout size/quality targets and provider abstraction need expansion |
| Audit               | hash-chain helper, verifier script, audit routes                                                               | Tamper-evident locally; not tamper-resistant without external anchor         |
| CI                  | `.github/workflows/ci.yml` with PostgreSQL and application checks                                              | Useful baseline; full security/IaC/render/coverage gates not evidenced       |
| Operations          | Replit configuration and operator notes                                                                        | Deployment target inferred, not authorised or proven; no IaC/run evidence    |

## Capability audit

| Capability                       | Baseline           | Decision          | Material gap                                                                                              |
| -------------------------------- | ------------------ | ----------------- | --------------------------------------------------------------------------------------------------------- |
| Autopsy intake/extraction/review | Partial            | Retain + redesign | Malware/signature/ZIP/password/version/addendum/resumable controls incomplete                             |
| Deterministic compliance gates   | Partial            | Retain + redesign | Formal versioned transition model, independent fatal reclassification approval, concurrency               |
| Certificate Vault                | Partial            | Retain + extend   | Tenant ownership, version/approval/usage/retention history, quarantine                                    |
| Capability Library               | Partial            | Retain + extend   | Evidence validity/restrictions/usage and hard render-time grounding proof                                 |
| BOQ verifier                     | Partial            | Retain + redesign | Exact decimal end to end; formulas/displayed values, VAT rule pack, currencies/lots/hidden cells/rounding |
| Drafting                         | Partial/unclear    | Redesign          | Controlled grounded revisions, provenance for every factual claim, no unresolved release                  |
| Red team/readiness               | Partial            | Retain + extend   | Formal reviewer queue, server sign-off invariants, T-72 scheduling, independent approval                  |
| Package assembly/export          | Partial            | Retain + extend   | Prescribed templates, rendered visual QA evidence, manifest/signature controls, indexed delivery          |
| Client portal                    | Minimal/internal   | Add               | Organisation onboarding, client roles, tasks, billing, usage, support, mobile browser states              |
| Reviewer/admin console           | Partial            | Retain + extend   | Queue ownership, SLA/security/model/notification/billing operations                                       |
| Billing/entitlements             | Minimal            | Add               | Price book, products, orders, subscriptions, invoices, payments, usage and reconciliation                 |
| Notifications/integrations       | Development-level  | Redesign          | Adapter contracts, idempotency, retries, reconciliation, production provider proof                        |
| Partner/white-label              | Missing            | Add behind flag   | Partner tenancy, managed clients, branding boundaries, co-sign, reporting                                 |
| Benchmarks                       | Missing/inadequate | Add behind flag   | Consent ledger, cohort policy, suppression/differencing/withdrawal controls                               |

## Security and privacy findings

| Severity           | Finding                                                                                           | Required closure evidence                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| P0 release blocker | No observed organisation/tenant boundary enforced through DB RLS                                  | Negative cross-tenant suite on every tenant-owned table and storage path, plus policy inspection |
| P0 release blocker | Broad member roles do not meet least-privilege/segregation matrix                                 | Server permission tests for all roles, temporary grants, delegation and break-glass              |
| P0 release blocker | Locally mutable audit chain has no immutable/external anchor                                      | Successful anchor/reconciliation evidence and restore/tamper exercise                            |
| P0 release blocker | Production/deployment and secret posture are unverified                                           | Approved target, configuration attestation, scans, smoke evidence, no public buckets             |
| P1                 | No observed malware quarantine and content disarm pipeline                                        | Hostile fixture suite and production scanner health proof                                        |
| P1                 | Retention defaults in older docs are described as “NDPR-aligned” without current legal validation | Counsel-approved, versioned policy/rule pack with lawful-basis and hold logic                    |
| P1                 | Analytics anonymity design previously relied on a nominal `k >= 8`                                | Cohort thresholds plus suppression, differencing, withdrawal and re-identification tests         |

## Data and architecture findings

- The schema is concentrated in `lib/db/src/schema/index.ts`; explicit bounded module ownership is missing.
- Several enums/states are free text and therefore cannot be relied on as closed deterministic domains.
- Monetary storage includes floating point and JavaScript-number bigint modes in observed BOQ fields. This conflicts with exact decimal and large-value safety requirements.
- Tender deadlines and several business dates are text rather than validated zoned/UTC temporal types.
- Migrations, roll-forward/roll-back verification, data classification metadata, legal holds, deletion certificates, evaluation cases, and partner/billing entities are incomplete or absent.
- CI currently uses a forced schema push rather than a versioned migration history, and documented/CI Node major versions are inconsistent; the production runtime must be pinned and reconciled.
- Synchronous request-driven processing is not a durable workflow engine. Document processing needs persistent jobs, leases, idempotency keys, retry policies, and dead-letter operations.
- Object storage and AI use need tenant-aware provider interfaces and explicit data-residency/cross-border controls.

## UX and accessibility findings

- The observed web UI is desktop-oriented and has a useful project-tab workbench.
- It does not yet evidence the full client, partner, delegated admin, approver, auditor, and restricted-admin experiences.
- Loading, offline, partial-success, stale-version, addendum, quarantine, background progress, and recovery states are not consistently specified.
- Component libraries are present, but WCAG 2.2 AA, keyboard review, focus order, reflow, contrast, accessible names, and screen-reader status announcements require automated and manual proof.
- Low-bandwidth requirements need progressive disclosure, resumable transfer, compressed previews, polling backoff, and explicit “safe to close” background states.

## Repository governance clarification

The baseline working copy arrived as a source archive without `.git` metadata, so that archive alone could not establish history, protection rules, signed provenance, visibility, or permission scope. Follow-up inspection on 2026-08-09 verified that `obeidpeter/Valo-MVP-Builder` is a **public** GitHub repository. The earlier private-repository assumption is therefore withdrawn: visibility is known, not an open question. Public visibility is acceptable only if it is intentional and the repository contains no client data, secrets, proprietary prompt packs, sensitive fixtures, or other restricted material. Branch protection, signed provenance, historical secret exposure, and the owner's intended open-source/governance posture still require their own evidence; a clean current-tree scan cannot prove historical absence.

## Immediate release blockers

1. Establish organisation tenancy, membership and server/DB/storage isolation.
2. Introduce real migrations and exact monetary/temporal types.
3. Implement durable document jobs with quarantine and recovery.
4. Complete permission segregation and break-glass audit.
5. Anchor audit checkpoints outside the mutable application datastore.
6. Define current, counsel-approved Nigeria rule packs; do not hard-code document/tax/procurement claims from the Business Plan.
7. Add production-ready provider adapters and disable development adapters outside development/test.
8. Produce security, accessibility, load, restore, rollback and deployment evidence.

## Audit limitations

No production credentials were requested or used. No production environment, object bucket, provider account, DNS record, backup, payment integration, or commercial dataset was inspected. A route or test filename is not proof it passed. The supplied archive lacks Git metadata, so statements about uncommitted work and historical versions are limited to the extracted tree.
