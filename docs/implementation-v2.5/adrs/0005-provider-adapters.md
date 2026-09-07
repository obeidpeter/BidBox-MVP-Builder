# ADR-0005: Provider-neutral adapters and fail-closed environments

Status: Accepted; adapter coverage varies by provider and activation remains fail-closed
Date: 2026-08-08
Last reviewed: 2026-08-31
Next review: 2026-11-30
Owner: Platform integrations (`@obeidpeter`)
Backup owner: Unassigned; tracked as `AR-001`
Reviewers: Security/privacy, product and operations role holders for new production providers; named alternates are not yet recorded
Drivers: `AD-006`, `AD-009`, `AD-011`
Evidence: `lib/integrations-openai-ai-server/src/index.ts`; `artifacts/api-server/src/lib/aiRuntime.ts`; `artifacts/api-server/src/lib/reconciledCommunications/service.ts`; `docs/ai-overhaul/TARGET_ARCHITECTURE.md`; `docs/implementation-v2.5/RELEASE_PROVENANCE.md`
Supersedes: Direct provider calls without a governed adapter boundary
Superseded by: None

## Context

Identity, storage, scanning, OCR, models, messaging, payment and licensed feeds carry privacy, outage and lock-in risk. Missing paid providers must not be presented as production complete.

## Decision

Define typed internal adapters with normalised errors, timeouts, retry-safety, idempotency, reconciliation, health and data-governance metadata. Select implementations by validated server configuration. Development/fake adapters identify themselves and abort startup in staging/production. Fallback occurs only when its residency/terms and evaluation gates satisfy the tenant policy.

## Consequences

Contract suites are required for each adapter. Some provider-specific capability remains explicit rather than hidden by a lowest-common-denominator interface. Production readiness includes provider terms, secrets, webhook and outage evidence.

## Rejected

Direct provider calls throughout routes; silent no-op adapters; fallback to an unapproved model/region.
