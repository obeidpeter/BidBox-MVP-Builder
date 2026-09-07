# UI overhaul audit and scope

Status: implementation contract based on the repository and supplied product sources reviewed on 9 August 2026. It records what exists; it is not deployment or production-acceptance evidence.

## Sources and version boundary

Reviewed inputs:

- `Valo_Business_Plan_v1.1.docx`
- `Valo_Product_Roadmap_v1.0.docx`
- `Valo_TRD_v1.0.docx`
- the master implementation prompt for Nigeria v2.5
- the current React workbench, API, OpenAPI-generated types, database schema, tests, CI, Replit configuration, and `docs/implementation-v2.5/`

The TRD and master prompt refer to Business Plan v1.2 and Product Roadmap v1.1, but only Business Plan v1.1 and Roadmap v1.0 were supplied or found. The repository contains references to the discrepancy, not approved copies of the newer sources. This overhaul therefore treats BP v1.1, Roadmap v1.0, TRD v1.0, and the stricter master-prompt invariants as the baseline. It must not invent decisions from the missing versions.

## Product thesis retained

BidBox is an evidence-led tender-readiness and bid-production control system. It reduces preventable disqualification; it does not guarantee award, predict evaluators, create prices, broker relationships, or submit to government portals. The interaction model must expose source, evidence, state, reason, owner, and next safe action. Deterministic server rules and named humans remain authoritative over model output.

## Current capability boundary

| Area                                            | Current classification             | Evidence and constraint                                                                                                                                                                                                                                      |
| ----------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Public site and legal pages                     | Implemented                        | Public routes cover product, solutions, workflow, security, about, contact, privacy, and terms. Copy preserves the process-not-outcome boundary.                                                                                                             |
| Public contact                                  | Implemented, externally configured | `/contact` opens only a validated HTTPS booking URL or validated email address. If neither exists, it states that the channel is unconfigured. There is no fake form, silent submission, or tender-file intake.                                              |
| Identity and recovery                           | Provider-backed                    | Clerk supplies sign-in, invitation, callback, MFA, and recovery. Missing provider configuration blocks protected access.                                                                                                                                     |
| Organisation and role context                   | Implemented                        | Organisation selection, active membership/grants, tenant header, role-derived home, and fail-closed route states are present. Server permission and tenant checks remain authoritative.                                                                      |
| Internal workbench                              | Implemented/partial                | Command centre, clients, pursuits, SBD corpus, project tabs, evidence readiness, operations, reports, security/audit, and organisation settings use generated API hooks. Some end-to-end producer workflows remain incomplete.                               |
| Client and partner workspaces                   | Implemented, commercially gated    | Data-backed surfaces exist behind role checks and build/server flags. Partner-derived permissions deliberately exclude release, admin, deletion, privacy, and commercial authority.                                                                          |
| Secure file intake                              | Implemented, provider-backed       | Signed object upload, server read-back/hash, signature/MIME/archive inspection, duplicate detection, malware verdict, quarantine/purge, NDA/conflict recheck, and extraction states exist. Resumable transfer and a production OCR adapter are not complete. |
| Model-assisted extraction                       | Provider-backed/partial            | A production-approved OpenAI adapter can be configured; structured output and fallback contracts exist. Scanned-document OCR is not represented by a configured production adapter in the audited tree.                                                      |
| BOQ, requirements, evidence, defects, risk      | Implemented/partial                | API-backed screens and deterministic rules exist. Breadth, provider-independent fixtures, and full browser journeys remain release-gated.                                                                                                                    |
| Report sign-off and ZIP export                  | Implemented/partial                | Named-reviewer sign-off and server readiness checks gate report/package export. Package lifecycle tables exist, but a complete persisted package/version/manifest workflow is not exposed end to end.                                                        |
| Billing and entitlements                        | Unavailable beyond control surface | The page accurately disables order creation and states that price-book, order, subscription, invoice, payment reconciliation, metering, and entitlement contracts are not connected. Project payment confirmation is not a billing ledger.                   |
| Notification delivery                           | Unavailable beyond manual records  | Project notification records exist. Email, WhatsApp Business, in-app inbox, provider reconciliation, and a global failure queue are not connected to the UI.                                                                                                 |
| Licensed tender feeds and audit anchoring       | Adapter contract only              | Provider interfaces exist, but no production-complete workflow or operator surface is evidenced.                                                                                                                                                             |
| Benchmarking, auto-confirm, controlled drafting | Commercially gated/partial         | Server flags default off. Activation requires an audited reference and must not imply that missing producer, consent, evaluation, or provider gates passed.                                                                                                  |
| Deployment                                      | Configured, not proven by source   | GitHub and Replit configuration exist. A preview, route filename, or source merge is not a successful deployment or post-deploy smoke result.                                                                                                                |

## Role-model gap

The canonical backend has 12 organisation roles, including client reviewer/approver and BidBox quality adviser. It has no dedicated finance role and no dedicated authorised-signatory role. Payment confirmation still uses specific founder/adviser confirmation fields, and named sign-off uses reviewer permissions plus signer records. The UI must not fabricate `finance`, `accounts`, `signatory`, or similar roles. Add those only through an approved backend role/permission/migration/API change with segregation tests, or express the responsibility as a time-bounded permission delegated to an existing canonical role.

## Scope decisions

| Decision | Scope                                                                                                                                                                                                                         |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Retain   | Deterministic core/human authority; current TypeScript modular monolith; tenant-aware API client; role-derived shell; semantic state components; calm teal/slate visual system; public contact without a data-capturing form. |
| Redesign | Navigation labels and page hierarchy around tasks and readiness; dense project tabs; source/evidence comparison; consistent empty/error/offline/partial states; commercial/provider status language.                          |
| Add      | This IA, role-route contract, business-rule traceability, state/journey matrix, exact design tokens, browser/accessibility gates, and deployment evidence checklist.                                                          |
| Remove   | Decorative AI language, award-probability cues, duplicate UI-only role names, dead-end enabled buttons, implied provider delivery, and any form that pretends to send when no backend exists.                                 |
| Defer    | Native mobile app, GCC localisation, tender scraping/discovery product, pricing strategy, evaluator intelligence, government-portal submission, and client-facing win prediction.                                             |

## Overhaul boundaries

In scope: public and authenticated information architecture, role-aware navigation, responsive shell, project workbench, state presentation, workflow recovery, design-system consistency, and validation/release gates.

Out of scope for a UI-only change: inventing backend roles, bypassing feature/provider readiness, enabling commercial features, completing paid integrations, changing deterministic rules, migrating production data, or claiming deployment. Any UI action without a server contract stays visibly unavailable.

## Priority gaps

1. Preserve fail-closed access and provider states while simplifying navigation.
2. Align every page with one status, one reason, one owner, and one next safe action.
3. Keep server readiness authoritative; client-side progress is advisory only.
4. Complete browser, accessibility, responsive, and low-bandwidth evidence before release.
5. Keep billing, notification delivery, OCR, partner co-sign, and dedicated finance/signatory responsibilities explicitly unavailable until their backend and operational gates exist.
