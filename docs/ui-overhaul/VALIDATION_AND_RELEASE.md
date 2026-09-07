# Validation and release

Status: evidence gate for the UI overhaul. No route, test filename, local build, preview, merge, or Replit configuration is a deployment result by itself.

## Required code gates

Run from the repository root with the pinned Node/pnpm versions:

```sh
pnpm install --frozen-lockfile
pnpm run format:check
pnpm run lint
pnpm run verify:release-config
pnpm run typecheck
pnpm --filter @workspace/db migration:check
pnpm --filter @workspace/db migration:bridge:legacy:check
pnpm --filter @workspace/db migration:bridge:legacy:evidence:test
pnpm --filter @workspace/db migration:bridge:legacy:rehearse
pnpm --filter @workspace/db test
pnpm --filter @workspace/api-server test
pnpm --filter @workspace/bidbox-workbench test
pnpm --filter @workspace/api-server prove:doctrine:offline
pnpm --filter @workspace/api-server prove:injection:offline
pnpm --filter @workspace/api-server eval:harness:offline
pnpm run build
```

GitHub CI additionally applies PostgreSQL 16 migrations, checks RLS coverage, audits production dependencies, builds both artefacts, scans secrets, and emits an SBOM. CodeQL and dependency review are separate required checks. Green CI is necessary, not sufficient for production promotion.

## UI test matrix

Automated component tests must cover:

- signed-out/public/protected route classification and safe redirect behavior
- missing identity configuration, invitation/callback, disabled identity, no role, unsupported role, organisation selection, and tenant switch safety
- every canonical role against every route area, including direct URL and feature off/on
- loading, empty, partial, error, offline, blocked, expired, unavailable, and stale-version states
- upload success/failure ordering, quarantine/provider denial, and no database record after failed storage transfer
- advisory readiness aligned with stricter server readiness; no UI-only release authorization
- public contact with valid booking URL, valid email fallback, and no configured channel; no form submission path

## Browser and accessibility gate

A retained Chromium public-site run now covers 320, 768, 1024, 1440, and 1920 CSS-pixel widths. It found no page-level horizontal overflow or clipped interactive content, verified the mobile menu and visible keyboard focus, swept all nine indexable public routes plus the not-found state, and found no browser console error or warning. The sign-in and protected deep-link shells were also checked for immediate `noindex, nofollow` metadata before the identity provider finishes loading. Evidence and exact limits are recorded in `BROWSER_QA.md`.

This is meaningful browser and responsive evidence, but it is not full WCAG or cross-browser acceptance. The repository still has no configured Playwright/Cypress end-to-end suite or automated axe gate, and this run did not include a real configured Clerk tenant, screen-reader testing, 200%/400% zoom, Safari/WebKit, Firefox, authenticated role journeys, slow-network measurement, or Core Web Vitals at the 75th percentile. Those items remain release gates rather than inferred passes.

Before release, test at 360x800, 768x1024, 1024x768, 1440x900, and 1920x1080, plus 200% zoom and 320 CSS px reflow. Exercise at minimum:

1. public navigation, legal pages, metadata, contact configured/unconfigured, and no tender upload on public routes
2. Clerk sign-in/invitation/callback and protected redirect preservation
3. organisation selection/switch, role homes, denied direct URLs, and feature-pending routes
4. Command Centre partial-source failure and retry
5. upload, quarantine, duplicate, provider outage, extraction progress/failure, and offline write denial
6. requirement source comparison, keyboard review, evidence approval, BOQ exception, fatal block, named sign-off, and export denial/success
7. operations, client, partner, auditor, and restricted-admin views with least-privilege data

Accessibility evidence includes keyboard-only operation, visible focus/restoration, skip links, form errors, live regions, data-grid semantics, reduced motion, contrast/non-color status, NVDA + Chrome on Windows, and one mobile browser/screen-reader pass. Retain issues and screenshots where policy permits; no critical/serious issue may remain.

## Provider and feature gate

- Production identity, object storage, malware scan, OCR/model as required, email, WhatsApp, payment, licensed feed, and audit anchor each need a production descriptor, explicit approval, health evidence, failure test, and reconciliation where applicable.
- Signed-upload rollback handles observable transfer and registration failures, but a browser or process can still disappear after a successful PUT and before cleanup; a server can also stop after writing a promoted `/documents/{id}` object but before the database commit. Production activation requires a durable, monitored upload lease and reconciler (or equivalent verified lifecycle) that covers both unreferenced `/uploads/` objects and uncommitted promoted objects. Record its retention window, a synthetic expiry proof, alerting, and reconciliation; a 15-minute signed-URL expiry alone is not object cleanup.
- Database commits and object-store deletion are not one atomic transaction. Production deletion therefore also requires a durable deletion intent/outbox and reconciler: object deletion must never strand a committed evidence row, and a failed storage purge must remain observable and retryable without issuing a false deletion certificate.
- Retention completion is consequently activation-gated with a side-effect-free `503`. Reactivation requires a durable two-phase detach/reconcile/certify workflow covering relational content, object storage, upload sessions and lifecycle control rows; a pending request is not deletion evidence.
- The server now table-tests the complete role matrix for requirement confirmation, evidence/defect review, draft review, report/package sign-off, and export. Portfolio managers no longer inherit independent approval. Do not claim the remaining defect proposer or partner co-sign journeys complete until `defect:review` is split by decision type and backed by persisted two-person state. General engagement-assignment enforcement also remains a separate production gate.
- `VALO_REQUIRED_PRODUCTION_ADAPTERS` must name globally required capabilities; missing/development-only/unapproved entries fail startup.
- Feature-specific provider issues must disable only the affected action and remain visible to operators.
- Frontend flags for client portal, partner workspace, billing, and notification surfaces do not grant permission or activate providers.
- Server commercial flags default off and require an audited activation reference. Keep partner release/co-sign, benchmarks, auto-confirm, charging, WhatsApp intake, and controlled drafting off until their separate evidence passes.

## Replit promotion gate

1. Merge only the reviewed commit after all required GitHub checks pass; record the commit SHA and SBOM/provenance artefacts.
2. Sync that exact SHA to Replit and complete the frozen install/static checks. Do not let source sync apply a schema diff.
3. Treat each populated Replit legacy database independently. Quiesce all writers, capture private inventory/audit/backup evidence, prove isolated restore, rehearse the approved legacy bridge, and stop on any mismatch.
4. Run the one-time bridge only through its fail-closed runner with approved ephemeral secrets. Never run the fresh migration chain or `drizzle-kit push` against the populated legacy lineage.
5. Start production with `NODE_ENV=production`, a migration-owner `DATABASE_URL`, and distinct least-privilege `VALO_RUNTIME_DATABASE_URL`. PostgreSQL 16 startup attestation must pass before listen.
6. Verify exact CORS origin, Clerk configuration, private tenant object paths, abandoned-staging cleanup, provider approvals, runtime role, backups, rollback access, and flags-off baseline.
7. Build and preview both artefacts, then run the browser matrix and one synthetic tenant journey without real tender data.
8. Publish only after approval. Repeat non-destructive smoke tests on the published URL and record results, timestamps, version, URL, operator, and deviations.

## Post-deploy smoke

Required smoke: health and readiness; sign-in/MFA; organisation selection; same-tenant success/cross-tenant denial; feature-off states; safe synthetic intake/quarantine; requirement/evidence/fatal gate; BOQ fixture; sign-off/export; audit verification/anchor; provider failure presentation; and rollback access. Inspect redacted logs for content, credentials, and unexpected personal data.

## Evidence pack

Retain links/hashes for: CI runs, code/security/dependency checks, SBOM, browser/a11y report, viewport screenshots, test accounts/roles (non-secret references), migration/bridge rehearsal, backup/restore, runtime attestation, provider health/failure/reconciliation, deployment version/URL, smoke, monitoring window, approvals, and rollback decision.

## Abort conditions

Abort or roll back on cross-tenant exposure, access/readiness bypass, data loss/corruption, migration reconciliation failure, unsafe-file processing, secret/content leakage, provider side effects without reconciliation, audit failure, sustained health/SLO breach, or loss of a deadline-critical workflow.

## Release decision

| Decision         | Minimum evidence                                                                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Merge-ready      | Formatting, lint, typecheck, unit/integration/static security, builds, and reviewed docs green                                                               |
| Preview-ready    | Merge-ready plus safe configuration, provider-off behavior, route/role smoke, and no data migration                                                          |
| Staging-ready    | PostgreSQL/storage/provider isolation, migration rehearsal, browser/a11y, security, performance, render, restore/rollback, and end-to-end evidence           |
| Production-ready | Staging accepted; authorised target/secrets/providers; approved bridge/backup; startup attestation; post-deploy smoke/monitoring; deployment record complete |

Until the final row passes, describe the result as a candidate or deployment-ready change, not a production-complete platform.
