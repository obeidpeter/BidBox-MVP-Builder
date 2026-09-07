# ADR-0007: Versioned Nigeria and tender rule packs

Status: Accepted target; initial production packs require legal approval
Date: 2026-08-08
Last reviewed: 2026-08-31
Next review: 2026-11-30
Owner: Product rules and compliance (`@obeidpeter`)
Backup owner: Unassigned; tracked as `AR-001`
Reviewers: Nigerian legal, product and security/privacy role holders before pack promotion; named alternates are not yet recorded
Drivers: `AD-001`, `AD-003`, `AD-007`
Evidence: `config/rules/nigeria/v2026-08-08.json`; `docs/implementation-v2.5/SECURITY_PRIVACY.md`; `docs/implementation-v2.5/PRODUCT_REQUIREMENTS.md`
Supersedes: Fixed legal, tax, procurement and tender constants
Superseded by: None

## Context

Privacy, procurement, tax, bid-security, certificate, calendar and tender rules change. Supplied documents contain version discrepancies and working assumptions; tax law changed through the Nigeria Tax Act 2025 transition effective 2026-01-01.

## Decision

Represent changeable rules as signed, effective-dated packs with authoritative source URLs/document hashes, applicability/precedence, deterministic tests, preparer, Nigerian legal reviewer and product approval. Tender-specific instructions are signed overlays. Historical results retain the selected version. Ambiguity produces `needs_legal_review`, never a guessed calculation. Sources and governance are defined in `SECURITY_PRIVACY.md`.

## Consequences

Legal/product operations own a regulatory watch and pack promotion/rollback process. The application must expose the rule version in BOQ/findings/packages. Correcting an old pack is a new version with impact analysis, not silent mutation.

## Rejected

Hard-coded VAT/threshold/certificate/retention constants; Business Plan appendices as legal authority; fetching live web values during a package calculation; one global pack for every tender.
