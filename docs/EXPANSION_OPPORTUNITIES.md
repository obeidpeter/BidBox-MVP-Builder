# BidBox — Expansion Opportunities

Audit of the codebase against the Valo Business Plan v1.1/v1.2, the Replit Build Brief, the Product Roadmap v1.0, and the TRD v1.0. Originally written July 2026 against the Gate 0 MVP; updated through the August 2026 third-wave source integration — to keep what is built separated from what remains operationally or externally blocked.

## Shipped

- **Fatal-block invariant** (TRD I3 / FR-CSM-02) — sign-off is impossible with open fatal/likely-fatal defects; no override path.
- **Hash-chained, tamper-evident audit log** (FR-WFM-02) with verifier script, external head-anchor workflow, and DB-ordinal stray detection.
- **Fail-closed document intake** (FR-INT-01/02) — server-side SHA-256 manifests, measured sizes, NDA gate with audited denials and post-download re-check, integrity re-verification endpoint + UI, `documents_manifest.csv` in exports.
- **Full provenance stamps** (NFR-AUD-01) — engine/prompt-pack/model on every report row and DOCX sign-off block.
- **Certificate Vault v1 + expiry telemetry** (FR-VLT-01/02) — CRUD + client Vault section, deterministic T-3/T-14/T-30 bands (widened by renewal lead time), dashboard renewal radar. Vault ownership is represented separately from engagement content. Delivery channels (FR-NTF-01) deliberately not faked — in-app notification log only.
- **Exact-kobo BOQ arithmetic** (FR-BOQ-01) — BigInt money paths, zero default tolerance; **kobo-aware words-vs-figures** (FR-BOQ-02) fixing the historical fifty-cents bug.
- **LLM output containment** (FR-EXT-02) — sanitizeLlm schema clamping, fail-closed defect taxonomy, untrusted-input guardrail clause, and a synthetic hostile-document corpus covering exfiltration, instruction injection, taxonomy forging, prototype pollution, and flood attacks. This is structural offline evidence only, not live-model behavioural proof.
- **Gate 0 Technical Scorecard** (FR-EXT-03/04/05) — origin/engineText/reviewer stamps on requirements, fixed recall definitions, live endpoint + `scorecard.json` in exports, scorecard strip vs the 85% gate.
- **Human verification queue UI** — confirm/edit/reject/add with engine-proposal diffs.
- **Capability Library v1** (FR-CAP-01 / I4 seam) — evidence-linked claims, approval hard-blocked without evidence, `claimable` derived never stored.
- **BOQ Verifier upload** — CSV/XLSX with column mapping (incl. section + amount-in-words), preview, declared grand total.
- **Async extraction pipeline** — extraction runs as a background job with `extraction_status` polling in the Documents tab; re-extract endpoint included.
- **Workflow governance + SLA clocks** (FR-CSM-01/03, FR-WFM-01) — deterministic status-transition gate (named reviewer, conflict, payment, physical-archive instruction), SLA breach + red-team-window alerts on the dashboard (red-team alerts now expire at the tender deadline).
- **Dual payment confirmation with identities** (FR-BIL-01) — `POST /projects/:id/payment-confirmations` derives the confirming identity server-side, requires two _distinct_ people for the founder/advisor legs, and stamps who/when. The gate no longer trusts client-supplied booleans.
- **Conflict register with decisions** — same-tender/lot conflicts block intake; consent/decline decisions now stamp `decidedBy`/`decidedAt` on the open conflict record, and an unrelated PATCH can no longer silently re-block a consented conflict.
- **Durable retention-completion source workflow** (NFR-PRV-02) — the admin queue now has explicit, version-bound detach → reconcile → certify actions, exact storage-event bindings, separately retained evidence, immutable manifests and maker/checker certificates. Production remains fail-closed: every activation precondition is open, the runtime purge privilege is revoked, and mutation attempts return `503` without side effects.
- **Project Readiness Gate** — reviewer-facing checklist across governance/intake/evidence/defects/BOQ/risk/report; gate logic extracted to a pure, unit-tested module aligned with the server's deterministic gates (dual payment confirmation; only OPEN material defects block).
- **SBD Corpus v1** — templates + agency-quirk annotations; single-active-lineage enforced on activation, version cloning supersedes the source.
- **DOCX report** — document control block, table of contents, requirement matrix with evidence-trace annex, defect register, risk score, responsiveness review (UI trigger in the Reports tab), BOQ annex, remediation plan, copies manifest, signature/seal checklist, process warranty.
- **CI** (`.github/workflows/ci.yml`) — the full TRD §12.2 gate order: secret scan (gitleaks, NFR-SEC-04), typecheck, unit + DB-backed integration tests (including the retention activation gate, governance, and export end-to-end suites plus the FR-ASM-01 golden-file report test), offline injection + doctrine proofs, the eval-harness offline gates, and both production builds on every push/PR.
- **Eval harness Gate-0** (FR-EXT-05 / FR-EXT-04 / NFR-QLT-02) — 14 synthetic repository tenders are scored by the unit-tested matcher. The 85% Gate-0 threshold is non-production; the production profile requires at least 25 authorised adjudicated holdout cases, at least 95% recall and at least 98% citation correctness.
- **Controlled-evaluation source-binding foundation** — a metadata-only binder rejects raw fixture/model content, binds exact tenant/project/plan/capability and corpus hashes, and requires at least 25 approved-redacted, independently adjudicated holdout cases with cohort coverage. The fixture loader, authorisation-evidence plane, provider gateway, result writer, customer path and production activation are deliberately disconnected, so this cannot execute an evaluation.
- **Offline pre-ship compatibility gate** — `prove:ship` runs the offline doctrine, structural injection, and Gate-0 checks. It makes no provider call and is not production evidence. Runbook: `docs/PRE_SHIP_PROOFS.md`.
- **Configurable scoring + Settings** — severity weights, band cutoffs, report template details and retention defaults are editable app config (with the active config versioned); reports keep their provenance stamps so historic sign-offs stay traceable.
- **PDF export** — reports render to PDF alongside DOCX.
- **Requirement merge** — near-duplicate AI extractions can be merged in the review queue with citations preserved.
- **Founder Gate 0 metrics** — decision-maker conversations and mandate-quality tracking with a readiness dashboard.
- **Retention automation** (NFR-PRV-02, scheduled half) — `retention:scan` auto-opens retention requests at the 12-month mark. It never purges; the separate durable completion workflow remains production-disabled pending the operational proofs below.
- **Cost telemetry** (FR-ANL-03) — token counts on every llm_runs row, per-engagement rollup (`GET /projects/:id/cost`, shown on the project overview) and an admin monthly variance report (`GET /analytics/cost?month=`) against the BP ₦15–30k unit assumption.
- **Extraction telemetry** (FR-OCR-01/02) — every document records how its text was obtained (text layer / multimodal OCR / native), a deterministic confidence heuristic, and per-document notes that accumulate into the OCR evaluation set; surfaced in the Documents tab.
- **Versioned defect taxonomy** (FR-ANL-01) — `TAXONOMY_VERSION` joins the provenance stamp on every report row and DOCX; registry + governed change process in `docs/DEFECT_TAXONOMY.md`.
- **Report fidelity** — redacted/restricted engagements auto-render their limitation banner (FR-INT-03); notification templates render actual messages from engagement data (FR-NTF-01); the report timestamp is pinned to Nigerian local time.
- **User manual** — `docs/USER_MANUAL.md`: every screen, workflow, and gate in plain language, with a "why is this blocked?" cheat-sheet.
- **Third-wave Delivery Studio** — project-scoped, versioned Response Studio claims, exact-source red-team review, deterministic package-manifest assembly and no-effect portal rehearsal, plus tenant-local Portfolio intelligence. These are guarded human workflows, not model execution, package release or external submission; exact boundaries are frozen in `config/product/third-wave.v1.json`.

## Remaining — near-term (current gate)

1. **Rehearse, attest and activate durable retention completion** — the source workflow exists, but migration rehearsal, runtime database proof, reviewed protected-record selectors, a monitored storage reconciler, trusted terminal receipts, restore-aware deletion rehearsal, a separately reviewed purge execution identity and named activation approval remain mandatory. The `503` gate stays closed until every checked item is verified.
2. **Complete the controlled shadow/evaluation execution plane** — connect private authorisation evidence, a privacy-safe fixture loader, the central gateway and telemetry, and a bounded evidence writer without creating a customer-output path. The checked foundation must continue to fail closed until that entire chain is independently approved.
3. **Assemble the authorised evaluation corpus** — 14 synthetic cases exist today; production needs at least 25 independently adjudicated holdout cases under approved privacy controls (labels are never edited to make a run pass).

## Third-wave integration delivered; higher-autonomy scope remains gated

- **Response Studio is integrated without generative drafting.** Named humans author immutable section versions; deterministic checks require exact in-scope citations for factual and instructional claims and block unsupported claims and placeholders. Any future criteria-mapped generation remains gated to approved, claimable Capability Library records and the production AI activation process.
- **Red-team review is operable without an autonomous scorer.** Named reviewers create source-hash-bound runs, resolve findings and approve independently; the T-72h clock remains a deterministic alert. Any future model-generated hostile-evaluator proposal remains behind the AI release gates.
- **Package assembly creates a governed candidate manifest, not a released submission.** Rendering, visual QA, immutable package sign-off, durable delivery receipts and external portal operation remain separate controls. DOCX/PDF/ZIP export continues to use its existing release gate and rechecks current claims and red-team source identity.
- **Portal rehearsal and Portfolio intelligence are decision support.** Rehearsal never authenticates or submits, while portfolio counts remain tenant-local workflow facts with no prediction, training, benchmark publication or cross-tenant reuse.
- Supporting: extraction recall ≥95% on a ≥25-doc harness, BPP SBD format detection (FR-EXT-06), cross-document BOQ consistency (FR-BOQ-03), anonymised defect dataset with the k≥8 gate (FR-ANL-02), runbooks (NFR-OPS-01).

## Guarded product surfaces delivered after the original audit

The client action portal, quote-to-cash and entitlements ledger, retainer service desk, partner and consortium room, claims desk, privacy operations centre, controlled AI shadow programme, opportunity-source pilot, reconciled communications ledger, and encrypted field-draft companion now have guarded application surfaces. Their exact delivered state and deliberate limits are recorded in `docs/roadmap-waves/IMPLEMENTATION_MATRIX.md`.

These surfaces must not be described as connected external services where their providers remain disconnected. In particular, they do not imply autonomous client or partner action, live message delivery, automatic pricing or payment, production AI activation, destructive privacy completion, external opportunity acquisition, or server-authoritative offline approval.

## Remaining — later product and commercial gates

The remaining expansion work includes approved provider connections, a reviewed price book and payment integration, governed enterprise identity and connector administration, production-grade portfolio reporting, an authorised AI evaluation corpus and execution plane, white-label channel operations, flagship defect reporting, and GCC localisation. Each item remains subject to its own commercial, privacy, security, operational, and named-human approval gates.

## Deploy note

Production schema changes use the checked-in, hash-pinned migration journal and the Replit intake migration runner. Do not use schema push. Legacy cutovers must first pass the bridge artifact check and disposable PostgreSQL 16 rehearsal. Database-dependent suites run only where `DATABASE_URL` is available; CI provides an isolated PostgreSQL instance for those proofs.
