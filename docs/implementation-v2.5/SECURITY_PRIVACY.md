# Security, privacy and Nigeria rule-pack plan

Status: normative security/privacy target. This is not legal advice. Legal conclusions and production rule packs require approval by Nigerian counsel/privacy leadership and named operational owners.

## Security objectives

1. Keep tenant data isolated in database, storage, search, cache, logs, jobs and AI context.
2. Preserve source/provenance and make sensitive decisions attributable and externally tamper-evident.
3. Prevent unsupported claims, fatal-gate bypass, commercial-figure generation and unauthorised provider use.
4. Minimise personal/commercial data, enforce retention/holds/rights, and govern cross-border processing.
5. Fail safely under malicious files, provider outage, concurrency, stale state and operator error.

## Data classification

| Class        | Examples                                                                                              | Baseline handling                                                                              |
| ------------ | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Restricted   | Tender/bid documents, BOQs, credentials, personnel IDs/CVs, signed packages, payment/provider secrets | Tenant scoped; encryption; no ordinary logs; narrow team; signed downloads; no shared training |
| Confidential | Requirements, evidence excerpts, defects, drafts, capability facts, audit details                     | Tenant scoped; least privilege; redacted telemetry                                             |
| Internal     | Operational queue metadata, non-sensitive configuration, aggregate service health                     | BidBox staff scope; no client content                                                          |
| Public       | Approved marketing pages and explicitly published benchmark releases                                  | Publication approval and provenance required                                                   |

## Controller/processor responsibility map

| Processing purpose                                                  | Provisional role                                 | Required governance                                                                           |
| ------------------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Account, security, billing, abuse prevention, BidBox legal records  | BidBox as controller                             | Privacy notice, lawful-basis record, retention, rights route                                  |
| Client tender/bid/evidence processing to deliver contracted service | BidBox as processor; client normally controller  | DPA/instructions, confidentiality, subprocessor register, deletion/return, assistance clauses |
| Independent integrity/security incident records                     | BidBox may be controller for the limited purpose | Necessity, access restriction, minimisation, documented balancing/legal analysis              |
| Optional benchmark/flagship dataset                                 | Separate controller-purpose analysis             | Specific informed opt-in/contract terms, withdrawal path, cohort safeguards; off by default   |
| Partner-managed workspace                                           | Roles depend on ownership/instructions           | Written responsibility matrix among client, partner and BidBox before activation              |

The actual role can vary by engagement and purpose; one blanket label is prohibited.

## Privacy controls

- Maintain records of processing, data inventory, purpose, data category, subject category, lawful basis, recipient/subprocessor, location, retention and security measures.
- Use consent only where appropriate and freely withdrawable; contract, legal obligation or legitimate interest require their own recorded analysis. Consent is mandatory for optional benchmark participation and direct marketing unless counsel approves another basis.
- Capture privacy/terms/NDA versions, actor, time and channel. A withdrawal is append-only and affects future processing/benchmark releases without deleting evidence required by law/hold.
- Provide authenticated access, rectification, objection/restriction, portability/erasure and complaint request workflows with identity verification, due-date calculation and exception/legal-hold reasoning.
- Conduct a DPIA before production use involving large-scale sensitive/commercial documents, AI-assisted profiling/classification, partner data sharing, benchmark publication, novel cross-border processing or other high risk.
- Appoint/record a DPO and DCPMI/CAR obligations where the approved rule pack determines they apply.
- Processor incidents notify the controller without undue delay; BidBox's incident decision engine uses the effective NDPA/GAID rule pack and counsel-approved thresholds. Internal escalation target is immediate, not the external deadline.
- Cross-border transfer is off until destination, provider, categories, purpose, transfer ground/instrument, safeguards, onward transfer and retention have been approved. Tenant routing must enforce the decision.

## Threat model

| ID   | Threat                                         | Principal controls                                                                     | Required proof                                                  |
| ---- | ---------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| T-01 | Cross-tenant database read/write               | Immutable tenant key, forced RLS, scoped app role, permission service                  | Negative suite over every tenant table/query/job                |
| T-02 | Storage/search/AI tenant leakage               | Tenant policy, scoped signed URLs, partitioned indexes/context, re-authorisation       | Cross-tenant object/retrieval/injection tests                   |
| T-03 | Prompt/retrieval injection                     | Cleared/sandboxed parsing, data delimiters, schema, no tools, citation/ID allow-list   | Hostile corpus, zero behavioural deviation/exfiltration         |
| T-04 | Malware/archive bombs/malformed files          | Signature/MIME, malware scanner, quarantine, archive limits, sandbox/resource caps     | Hostile fixtures and scanner outage tests                       |
| T-05 | Unsupported or fabricated package claim        | Approved fact provenance, placeholder blockers, transactional release validator        | 100% seeded unsupported-claim rejection                         |
| T-06 | Fatal blocker or conflict bypass               | Closed state machine, independent approval, server/DB checks, no admin bypass          | Property/permission/concurrency tests                           |
| T-07 | Privileged insider misuse                      | No standing content access, assignment scope, break-glass dual control, access reviews | Grant-expiry and after-action exercises                         |
| T-08 | Audit rewriting                                | Append-only sequence/hash plus external immutable anchor and reconciliation            | Tamper/restore/anchor-gap exercise                              |
| T-09 | Provider/webhook spoofing or replay            | Signature verification, timestamp window, unique event ID, reconciliation              | Replay/tamper/provider outage tests                             |
| T-10 | Stale/concurrent approval                      | Aggregate version, expected version, immutable inputs, sign transaction                | Race tests with two reviewers/addendum                          |
| T-11 | Data exfiltration through logs/backups/exports | Redaction, classification, key separation, signed expiry, egress alerts                | Log scan, backup access and expired-link tests                  |
| T-12 | Supply-chain compromise                        | Lockfiles, SBOM, signed builds, dependency/secret/SAST scans, provenance               | CI artefacts and vulnerability closure                          |
| T-13 | Privacy-unsafe benchmark/differencing          | Consent ledger, minimum cohorts, small-cell suppression, query budget, release review  | Reconstruction/withdrawal test suite                            |
| T-14 | Repository exposure                            | Private repository, branch protections, no client fixtures/secrets, history scan       | Owner visibility/permission attestation and secret/history scan |

## Authentication and session controls

MFA is required for BidBox staff, partner admins and client owners/approvers; risk-based step-up applies to exports, role grants, break-glass, payment changes and sign-off. Sessions use secure/HttpOnly/SameSite cookies, CSRF protection where applicable, rotation, absolute/idle expiry and revocation on role/security change. API rate limits are identity+tenant+operation aware and do not leak resource existence.

## Cryptography and secrets

TLS 1.2+ (prefer 1.3), managed encryption at rest, separate environment keys, rotation/versioning and least-privilege service identities. Sensitive object encryption can use tenant-scoped envelope keys where supported. Secrets live only in approved secret management; logs/errors/build artefacts never contain them. Passwords are delegated to the approved identity provider.

## Audit protection

Each event contains sequence, previous hash, event hash, tenant, actor, purpose/reason, correlation/causation, action, object, result and before/after digests. Periodic Merkle/root checkpoints are signed and published to an immutable external destination with retention lock or equivalent independent witness. Reconciliation alerts on missing sequence, invalid chain, missing/late anchor or restored database divergence. Hashing alone inside the same mutable database is insufficient.

## Retention, legal hold and deletion

Retention is purpose/category/contract/rule-pack driven, not a single “12 months” constant. Legal hold prevents eligible deletion and records authority/scope/review. A deletion workflow covers primary rows, object versions, derived OCR/search/vector/cache, provider copies where contractually controllable, exports and backup expiry; it verifies actions before issuing a signed certificate. Audit/accounting/legal evidence retained under an approved exception is minimised and listed transparently.

## Nigeria rule-pack governance

Rules that can change - tax/VAT, bid security, procurement thresholds/templates, statutory certificate assumptions, privacy reporting/registration, holidays/business calendars and retention - are configuration, not code literals.

Each pack contains:

```text
pack_id, jurisdiction, domain, semantic_version, status=draft|approved|superseded|withdrawn
effective_from, effective_to, as_of_date, authoritative_source_urls
source_document_hashes, extracted_rules, applicability/precedence, calculation tests
prepared_by, legal_reviewer, product_owner, approved_at, supersedes
```

Activation is signed, dual-controlled, audited and prospective. Historical calculations retain the pack version. Tender-specific instructions take precedence where lawful and are a separate signed overlay. If applicability is ambiguous, BOQ/readiness returns `needs_legal_review`; it never guesses.

## Authoritative source register (verified online 2026-08-08)

| Pack/source                          | Authoritative reference                                                                                                                                            | Product treatment                                                                                                                                          |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Privacy primary law                  | [Nigeria Data Protection Act 2023 - NDPC](https://www.ndpc.gov.ng/ndp-act-2023/)                                                                                   | Baseline statute; retain official PDF hash in approved pack                                                                                                |
| Privacy implementation               | [NDP Act General Application and Implementation Directive (GAID) 2025 - NDPC PDF](https://ndpc.gov.ng/wp-content/uploads/2025/07/NDP-ACT-GAID-2025-MARCH-20TH.pdf) | Effective operational directive; counsel maps relevant articles/schedules                                                                                  |
| NDPC current interpretation/services | [NDPC FAQs](https://ndpc.gov.ng/faqs/)                                                                                                                             | Watch source for transfers, CAR/registration and rights; not a substitute for statute/directive                                                            |
| Federal procurement statute          | [Public Procurement Act 2007 - BPP official PDF](https://bpp.gov.ng/wp-content/uploads/2019/01/Public-Procurement-Act-2007pdf.pdf)                                 | Base procurement source; never infer a particular tender's rules from it alone                                                                             |
| Procurement instruments              | [BPP revised Standard Bidding Documents](https://www.bpp.gov.ng/revisedsbds/) and [BPP downloads](https://bpp.gov.ng/downloads/)                                   | Versioned licensed/authorised corpus; capture specific artefact/hash/effective context                                                                     |
| Current tax transition               | [Federal Ministry of Finance: Tax Acts 2025 transition guidelines](https://finance.gov.ng/federal-government-issues-transition-guidelines-for-tax-acts-2025/)      | Records Nigeria Tax Act 2025 framework effective 2026-01-01 and transition treatment; exact calculation parameters require the enacted gazette and counsel |
| Nigeria Tax Act                      | [Official government-hosted Gazette copy: Nigeria Tax Act 2025](https://irs.gm.gov.ng/docs/national/NIGERIA_TAX_ACT_2025.pdf)                                      | Pin enacted PDF hash; verify commencement/applicability and amendments before approval                                                                     |

### Initial effective-dated pack registry

These entries record source chronology but are deliberately **not executable** until the listed legal/product approvals and deterministic tests are complete.

| Candidate pack         | Candidate effective range                                                           | Source status as of 2026-08-08                                                                                                                                                               | Pack/activation status                                                              |
| ---------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `NG-PRIVACY-NDPA-2023` | 2023-06-12 onward, subject to amendments/current instruments                        | Official NDPC Act source verified                                                                                                                                                            | `draft`; legal mapping/hash/tests pending; **inactive**                             |
| `NG-PRIVACY-GAID-2025` | 2025-09-19 onward (NDPC-stated operational effective date; confirm during approval) | Official NDPC GAID, issued 2025-03-20, verified; the effective date is described in the [official NDPC Journal 2026](https://ndpc.gov.ng/wp-content/uploads/2026/02/NDPC-Journal-2026-1.pdf) | `draft`; article/schedule mapping and legal sign-off pending; **inactive**          |
| `NG-PROC-PPA-2007`     | 2007-06-04 onward, subject to later lawful instruments                              | Official BPP/Federal Gazette source verified                                                                                                                                                 | `draft`; applicability/precedence tests pending; **inactive**                       |
| `NG-PROC-BPP-SBD`      | Per exact SBD/circular/version and tender issue date                                | Official current BPP catalogue verified; individual artefact hashes/effective metadata not yet pinned                                                                                        | `blocked`; no generic SBD pack may activate                                         |
| `NG-TAX-NTA-2025`      | 2026-01-01 onward for the Nigeria Tax Act regime, with transition handling          | Official Gazette copy and Federal Ministry of Finance transition statement verified                                                                                                          | `draft`; exact VAT/tax/transition extraction and legal review pending; **inactive** |
| `NG-CALENDAR-LAGOS`    | Version-specific annual period                                                      | IANA `Africa/Lagos`; official Nigerian holidays still require annual authoritative source                                                                                                    | `blocked` until holiday/calendar source and owner approval                          |

`effective_to` remains open only until a superseding pack is approved; the regulatory watch must close prior versions prospectively. A tender overlay records its own issue/addendum/effective dates and can narrow a general pack. “Inactive” means production calculation/readiness must return configuration/legal review required, not fall back to a hard-coded legacy value.

The Business Plan's working certificate taxonomy, thresholds, VAT assumptions and third-party market sources are hypotheses/reference material, not authoritative executable rules. Product copy must say “required by this tender/rule pack” rather than imply every Nigerian tender requires the same artefacts.

## Rule-pack discrepancies and open legal decisions

1. TRD v1.0 cites BP v1.2/Roadmap v1.1, but only BP v1.1/Roadmap v1.0 were supplied; no unreviewed rule from missing documents is adopted.
2. Older TRD text uses a fixed `k >= 8` benchmark gate. v2.5 replaces this with contextual minimum cohort plus small-cell, differencing, withdrawal and re-identification controls.
3. Older TRD text presents fixed 12-month/14-day retention as “NDPR-aligned.” Retention/rights deadlines require current NDPA/GAID/contract/legal analysis; keep configurable until approved.
4. Business Plan procurement thresholds and certificate lists must be re-verified against BPP/tender-specific instruments before any rule-pack approval.
5. Tax/VAT logic must use the Nigeria Tax Act 2025 regime effective from 2026-01-01 with transition rules where relevant; no previous VAT/tax constant may be copied blindly.

## Production security gates

No GA activation until RLS/storage/search/AI negative tests pass; repository visibility is verified; secret/SAST/dependency/container/IaC scans have no unresolved high/critical finding; DPIA/DPA/subprocessor/transfer records are approved; incident and DSR drills run; backup restore and audit-anchor recovery pass; and access/feature/development-adapter configuration is attested in the deployment record.
