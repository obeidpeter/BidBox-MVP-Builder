# Product requirements: Nigeria v2.5

Document status: normative target; implementation evidence is maintained only in `REQUIREMENTS_TRACEABILITY.md`.

## Product outcome

BidBox helps legitimate organisations prevent controllable tender disqualification by turning tender documents into cited requirements, governed evidence work, deterministic checks, grounded drafts, independent human review, and controlled packages. BidBox warrants its process within the reviewed materials; it does not guarantee an award or predict an evaluator.

## Binding invariants

| ID     | Invariant                                                                                                              |
| ------ | ---------------------------------------------------------------------------------------------------------------------- |
| INV-01 | Every requirement has a resolvable citation to immutable document version and page/paragraph/table/coordinate.         |
| INV-02 | Dates, arithmetic, state, permission, entitlement, readiness and package rules are deterministic and server enforced.  |
| INV-03 | AI suggestions never silently mutate deterministic state.                                                              |
| INV-04 | Unsupported claims and fabricated credentials/experience/capability are prohibited.                                    |
| INV-05 | Every released factual claim links to approved valid evidence; otherwise release is blocked.                           |
| INV-06 | Any unresolved fatal or likely-fatal requirement blocks submission-ready status.                                       |
| INV-07 | Fatal reclassification requires reason, evidence, audit entry and independent authorised approval.                     |
| INV-08 | BidBox does not generate prices or rates; it only verifies client-supplied commercial figures.                         |
| INV-09 | No brokering, evaluator intelligence, facilitation, collusion help, influence service or award guarantee.              |
| INV-10 | Tenant data is isolated across database, storage, search, cache, logs and AI retrieval and never trains shared models. |
| INV-11 | Same-tender/same-lot conflicts are checked before assignment; governance is tender-specific.                           |
| INV-12 | Discovery uses licensed/authorised sources; no unauthorised government or tender scraping.                             |
| INV-13 | Sensitive actions and decisions are attributable in append-only records protected by external/immutable anchoring.     |
| INV-14 | Administrators cannot bypass tenant isolation, evidence grounding, conflict decisions or fatal gates.                  |

## Actors

Required actors and detailed permissions are defined in `PERMISSIONS_MATRIX.md`: organisation owner, organisation admin, bid manager, contributor, client approver, auditor, BidBox analyst, BidBox quality adviser, BidBox operations admin, restricted platform admin, partner admin, and partner analyst/reviewer.

## Lifecycle and deterministic states

### Engagement lifecycle

`draft -> onboarding -> conflict_review -> entitlement_review -> intake -> processing -> requirement_review -> evidence_work -> drafting -> red_team -> approval -> assembly -> sign_off -> export_ready -> delivered -> outcome_monitoring -> archived`

Exceptional states: `blocked_conflict`, `blocked_entitlement`, `quarantined`, `processing_failed`, `withdrawn`, `cancelled`, and `legal_hold`. Forward transitions require the previous gate. Reopen moves to the earliest affected gate and invalidates downstream approvals/packages. `archived`, `withdrawn`, and `cancelled` are terminal except for legally authorised restore to a new versioned engagement; historical audit is unchanged.

### Requirement lifecycle

`extracted -> pending_review -> confirmed -> assigned -> evidence_pending -> evidence_attached -> verified -> satisfied`

Alternatives: `rejected_extraction`, `not_applicable_pending_approval`, `not_applicable_approved`, `defective`, `reopened`, `superseded`. A tender addendum creates a new source version and deterministically marks affected requirements `reopened`; it never overwrites prior citations.

### Evidence lifecycle

`quarantined -> pending_verification -> verified -> approved -> active -> expiring -> expired` with side states `rejected`, `withdrawn`, `superseded`, and `legal_hold`. Only `approved`/`active` evidence valid for the relevant date and scope can ground released claims.

### Package lifecycle

`draft -> validation_failed|validated -> red_team_failed|red_team_passed -> approval_pending -> approved -> rendered -> visual_qa_passed -> signed -> exportable -> exported -> delivered`.

Every package is immutable once signed. Any changed source creates a new version and returns to validation.

## Functional requirements

### Identity, organisation and governance

- `ORG-001` Create organisations, profiles, memberships, partner relationships and delegated client workspaces with immutable tenant ownership.
- `ORG-002` Enforce role/permission scope, segregation of duties, time-limited grants and audited delegation on the server.
- `ORG-003` Require identity assurance, NDA/privacy acknowledgement and applicable lawful-basis/consent records before sensitive intake.
- `ORG-004` Support engagements, tenders, lots, service levels, owners, deadlines, conflicts, notes and scoped teams.
- `ORG-005` Provide dual-controlled break-glass access that expires automatically and cannot suppress its audit trail.

### Entitlement and commercial control

- `ENT-001` Model price books, products, one-off services, subscriptions, retainers, partner terms and usage rules as versioned configuration; no domain price literals.
- `ENT-002` Require server-side order/subscription/payment/entitlement validation before governed work begins.
- `ENT-003` Reconcile payment/provider events idempotently and surface exceptions without granting access on ambiguous state.
- `ENT-004` Separate technical availability from commercial activation by tenant/role/capability feature flags.

### Secure intake and processing

- `INT-001` Accept approved PDF, DOCX, XLSX, JPEG, PNG and ZIP inputs using resumable uploads, enforced size/page limits and explicit supported-format policy.
- `INT-002` Verify MIME and signature, hash content, detect duplicates/versions/addenda, malware scan, quarantine suspicious/corrupt/password-protected inputs and never parse before clearance.
- `INT-003` Preserve originals immutably, create versioned derived files, record chain of custody and use signed expiring downloads.
- `INT-004` Run OCR/classification/extraction as durable idempotent jobs with progress, retries, dead letters and operator recovery.
- `INT-005` Support approved email/WhatsApp Business adapters only after sender binding, consent, manifest acknowledgement and provider governance are configured.

### Extraction and cited review

- `EXT-001` Extract administrative, eligibility, technical, commercial, submission and evaluation requirements into a schema with severity, mandatory status, confidence, due date and evidence need.
- `EXT-002` Resolve every citation against immutable source/version/page/paragraph/table/coordinate before review.
- `EXT-003` Provide keyboard-efficient human queues with source comparison, filters, safe bulk action, ownership, due dates, reviewer history and optimistic concurrency.
- `EXT-004` Permit low-risk auto-confirmation only for an approved field class after at least 99% precision on an unseen representative set; never for fatal/likely-fatal items.
- `EXT-005` Treat files as hostile instructions, contain prompt injection and capture corrections as evaluation cases.

### Compliance, defects and Autopsy

- `CMP-001` Enforce closed, versioned requirement/defect/package transition tables and log every denial and reclassification.
- `CMP-002` Apply an explainable, deterministic, versioned controllable-defect risk score; never present award probability.
- `CMP-003` Enforce fatal/likely-fatal blockers and independent reclassification approval with no administrative bypass.
- `CMP-004` Produce versioned Bid Autopsy output: findings, matrix, defects, readiness, citations, gaps, remediation owners/deadlines and sign-off.

### Vault and Capability Library

- `EVD-001` Maintain versioned Vault artefacts with type, issuer, issue/expiry, verification, approval, renewal, usage, tender association, retention and deletion history.
- `EVD-002` Maintain capability claims, fact-level evidence links, validity dates, restrictions, reviewer, approval state and usage history.
- `EVD-003` Prevent expired/rejected/withdrawn/unverified evidence and capabilities from a release-ready package.
- `EVD-004` Notify on configurable renewal policy through durable, reconciled notifications; delivery failure cannot alter evidence validity.

### BOQ verification

- `BOQ-001` Preserve originals and parse workbook structures without writing rates/prices.
- `BOQ-002` Use exact decimal arithmetic for quantities, rates, extensions, totals, discounts, tax, currency and bid security under a versioned tender/jurisdiction rule pack.
- `BOQ-003` Detect formula/display differences, words/figures mismatch, rounding, hidden rows/columns, merged cells, units, multiple lots/currencies and cross-document totals.
- `BOQ-004` Produce transparent, cited exceptions with review/waiver history and no silent workbook mutation.

### Grounded drafting, review and assembly

- `DRF-001` Draft only from confirmed requirements, approved valid evidence/capability facts and authorised client instructions with fact-level provenance.
- `DRF-002` Stop or insert explicit unresolved placeholders when evidence is missing; placeholders block release.
- `DRF-003` Provide versions, diffs, comments, ownership and approvals; concurrent edits use optimistic locking.
- `REV-001` Run adversarial review for mandatory criteria, contradictions, unsupported/expired evidence, formatting, BOQ exceptions and package completeness.
- `PKG-001` Assemble traceable DOCX/PDF/reports/manifests/indexed ZIP outputs using versioned templates and deterministic ordering/naming.
- `PKG-002` Render generated documents and require automated structural checks plus human visual QA before sign-off.
- `PKG-003` Require named sign-off and server-side release validation before signed, expiring export/delivery.

### Portal, operations, partners and analytics

- `PRT-001` Provide responsive role-specific client views for onboarding, intake, progress, actions, evidence, reports, packages, billing/usage and support.
- `OPS-001` Provide reviewer/admin queues for intake, extraction, conflicts, evidence, expiry, BOQ, red team, sign-off, billing, notifications, SLA, support, evaluations, security and audit.
- `PAR-001` Support partner organisations, delegated management, partner client workspaces, co-signing/QA responsibility and ownership rules.
- `PAR-002` Permit branding to alter presentation only, never provenance, evidence, state, controls or BidBox integrity notices.
- `PAR-003` Report partner usage/performance/revenue-share inputs without computing or paying money unless the authorised finance workflow approves it.
- `ANL-001` Provide operational/product metrics with tenant scope and privacy-safe access.
- `ANL-002` Publish consent-controlled benchmarks only through minimum-cohort, small-cell suppression, differencing, withdrawal and re-identification controls.

### Providers and operations

- `ADP-001` Put identity, storage, OCR, model, email, WhatsApp, payment and licensed feeds behind provider-neutral adapters with timeouts, retries, idempotency and reconciliation.
- `ADP-002` Development adapters are clearly labelled and fail startup outside development/test.
- `AUD-001` Append audit events with actor, tenant, subject, reason, correlation, before/after digest and causal link; anchor checkpoints externally/immutably.
- `OPS-002` Provide health/readiness, redacted logs, correlation IDs, metrics, traces, alerting, backups, restore, rollback and incident response.

## Non-functional requirements

| ID           | Target                                                                                                                                                                 |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NFR-SEC-001  | Zero successful cross-tenant access in negative tests; no unresolved critical/high security findings before GA.                                                        |
| NFR-A11Y-001 | WCAG 2.2 AA for critical workflows, verified automatically and manually with keyboard and screen reader.                                                               |
| NFR-PERF-001 | P95 ordinary interactive response below 2 seconds under the agreed load profile; async processing always reports progress.                                             |
| NFR-REL-001  | Availability target 99.5% at v1.5 and 99.9% at v2.0/v2.5, measured by defined SLI/SLOs.                                                                                |
| NFR-DR-001   | RTO at most 4 hours; approved RPO no worse than 24 hours until business impact analysis justifies a tighter target.                                                    |
| NFR-AI-001   | Requirement recall at least 95%, citation correctness at least 98%, no fatal miss in the release-blocking labelled set, separately reported fatal/likely-fatal recall. |
| NFR-INT-001  | 100% rejection of seeded unsupported claims and 100% detection of seeded deterministic BOQ errors in the release fixture set.                                          |
| NFR-COV-001  | 100% branch coverage for critical state, fatal gate, BOQ arithmetic, entitlement, grounding and release invariants; no meaningless global 100% target.                 |
| NFR-OPS-001  | Immutable versioned artefacts, provenance, SBOM, backward-compatible migrations, restore/rollback evidence and post-deploy smoke proof.                                |

Quality targets require dataset composition, sample size, exclusions and limitations. They are release gates, not current claims.

## Explicit non-goals through v2.5

- Tender discovery by unauthorised scraping.
- Government portal submission or credential handling.
- Commercial rate generation, bid pricing strategy or success-fee optimisation.
- Award prediction, evaluator profiling, brokering or influence services.
- Native mobile application.
- GCC/Arabic localisation.
- Fully autonomous BidBox-branded submission-ready packages without configured human QA.
