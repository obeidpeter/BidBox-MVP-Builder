# BidBox Bid Autopsy Workbench — User Manual

_A plain-language guide to the application: every surface, every screen, and the rules you will meet along the way._

This manual describes the application as it is actually built today. Where a capability is deliberately switched off — and BidBox keeps features off until their safety, governance and service-activation conditions are met — the manual says so, because a greyed-out button with a reason is part of the design, not a bug.

---

## 1. What BidBox is

BidBox is a workbench for **forensic tender review** in the Nigerian market. You give it a client's tender (what the government, agency, or operator asked for) and the client's bid (what they submitted or plan to submit). BidBox helps a named human team extract and review recorded requirements, test whether the bid addresses them, surface potential omissions, expiry issues, Bill-of-Quantities arithmetic exceptions and formatting risks, and produce versioned reports with audit evidence. It does not guarantee that every requirement or risk will be found or that an evaluator will accept the bid.

Five principles run through everything and explain most of the rules you will bump into:

1. **The computer checks; a named human decides.** AI-derived suggestions remain visibly unconfirmed until an authorised named reviewer records the applicable decision; deterministic checks and manually entered records retain their own states and provenance.
2. **Everything that must be exactly right is ordinary tested code, not AI.** Arithmetic, tax reconciliation, risk and expiry controls use deterministic code and recorded configuration or rule-pack versions, so a result can be reproduced from the same inputs and versioned policy. Money is never handled as floating-point numbers.
3. **No claim without evidence, and absence is never clearance.** An empty list means "the endpoint returned no records", not "everything is fine" — the screens say this in so many words. A capability claim is unusable until evidence is linked and approved.
4. **Tenant boundaries are absolute.** Every organisation's data is isolated at the database level. Your organisation choice scopes everything you see, and the server re-checks it on every request — the interface never has the final word on permissions.
5. **Nothing external happens silently.** In the shipped configuration, BidBox does not autonomously send messages, execute payments, submit bids, scrape sources or complete governed content deletion. Interfaces distinguish recorded _intent and evidence_ from an external effect; maintenance purges and any future approved provider actions follow separate controls.

If a button seems blocked, one of these principles is almost always the reason — section 21 is a cheat-sheet for exactly which rule you have hit.

---

## 2. The three surfaces

The application is split into three strictly separated surfaces:

| Surface       | Who sees it        | What it contains                                                                                                              |
| ------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| **Public**    | Anyone, no sign-in | The marketing site, legal notices, and one form: **Request a Bid Autopsy**. No workspace code loads.                          |
| **Access**    | People signing in  | `/sign-in`, invitation acceptance, and the SSO return page, powered by the identity provider.                                 |
| **Workspace** | Signed-in users    | Help and your Account are identity-level pages. Organisation workspaces additionally require an active organisation and role. |

Protected workspace routes use route-specific private titles such as `Pursuits | BidBox`; generic access and loading states may use `Secure access | BidBox`. Protected routes remain `noindex, nofollow`, and titles deliberately avoid client, pursuit, organisation and record names.

### The public site

Visitors see a landing page pitched at Nigerian public-sector, oil-and-gas (NipeX/NCDMB) and donor-funded bid teams, with a permanent disclaimer that BidBox does not guarantee any award. Supporting pages — Product, Solutions, How It Works, Security, About, Contact, Privacy, Terms — are read-only. The sample "defect register" on the landing page is labelled fictional.

The only thing an anonymous visitor can submit is the **Bid Autopsy request form** (`/request-bid-autopsy`): contact name, company, business email and telephone, tender category, bid stage, optional deadline, preferred contact method, and a privacy acknowledgement. The form accepts **no documents**. Any later document exchange must use the governed workspace after human scope, conflict and NDA review. On success you get a request reference on screen; a retry of an unchanged submission safely reuses the same reference.

---

## 3. Signing in and choosing your organisation

1. **Sign in** at `/sign-in`. BidBox is invitation-only: an administrator invites you, and you activate the invitation at `/accept-invitation`. Passwords, MFA, recovery and active sessions are managed by the identity provider (see your **Account** page later).
2. **Organisation selection.** After sign-in BidBox resolves which organisations you belong to. If you have exactly one, it is selected automatically. If you have several, a full-screen **"Select an organisation"** gate lists each one with its type (Client organisation / BidBox operations / Consultancy partner), your roles in it, whether your access is a direct membership or a **partner relationship**, and any expiry date on your access.
3. **Your role home.** BidBox then lands you where your role works: internal staff land on the Dashboard; client roles land on the Client workspace (or Pursuits); partner roles land on the Partner workspace; auditors land on Evidence library; restricted platform administrators land on Security & audit.

**Switching organisations** later is done from the switcher in the header (or the mobile menu). Switching wipes every cached record from the previous organisation before anything new loads. Switching is temporarily refused while a write is in flight — finish or cancel the in-progress action first.

Things you might see instead of the workspace, all deliberate: **Account disabled**, **Pending organisation access** (you exist but no organisation has admitted you), **Pending access** (registered identity, no role yet), and **Role configuration unsupported** (the server granted a role this app version does not know — contact an administrator rather than guessing).

---

## 4. Finding your way around

The left sidebar shows only what your role, permissions and organisation type allow, grouped under five headings:

- **Workspace** — Dashboard, Pursuits, Opportunity sources, Bid insights, Client workspace, Client requests, Partner workspace, Consortium workspace.
- **Delivery** — Requirements & compliance, Evidence library, Pursuit workflows, Field notes, Operations, Reports.
- **Oversight** — Clients, Portfolio intelligence, Leads & offers, Billing & access, Quotes, invoices & retainers, Claims, Notifications, Communication log.
- **Administration** — Security & audit, Privacy requests, Release checks, AI testing programme, Organisation settings, Platform settings.
- **Support** — Help & user manual. This identity-level page is available to enabled signed-in users and never grants access to an organisation workspace.

Items marked with an amber **"Pending"** chip are technically present but await feature or service activation (section 20 explains feature flags).

**Global search** — press **Ctrl/⌘ + K** (or click the header search box). It searches navigation by name and, if you can see Pursuits, searches your authorised pursuits by tender title, client name or tender reference.

**Contextual help** — use the question-mark control in the header for the current page's purpose, key terms, access explanation and exact next action. **Open the full user manual** opens the authenticated `/help` page in a new tab, so your in-progress page stays in place. Help explains access; it never grants access or overrides a server-backed blocker.

**Times** are shown in **West Africa Time (WAT)** wherever deadlines matter.

**Offline** — if your connection drops, the shell shows a banner and governed write surfaces remain unavailable or explain their offline state. Do not rely on displayed records as current. **Field notes** is the only surface designed for offline drafts (section 12).

---

## 5. Roles, permissions and access sources — the short version

BidBox has many precise roles; you only need the shape:

- **Internal (BidBox) roles** — analysts, quality advisers, operations administrators, and a deliberately restricted platform administrator. These can see the Dashboard, operations consoles and administration surfaces when their current permissions allow.
- **Client roles** — organisation owner, administrator, bid manager, contributor, reviewer/approver, auditor. These can see their own authorised pursuits, the client portal and client action room.
- **Partner roles** — consultancy partner administrators and analyst/reviewers. These see the partner workspace and, through the organisation switcher, the client contexts their relationship grants.
- **Auditors** — read-only roles that land on Evidence library and can read authorised audit surfaces.

Two further distinctions matter in practice:

1. **Permission-gated buttons.** Even inside a page you can see, individual actions appear only with the matching server permission (for example `defect:write` to run BOQ checks, `evidence:approve` to confirm evidence, `report:sign_off` to sign a report). If a colleague has a button you lack, that is the reason.
2. **Direct membership vs partner-derived access.** Eleven sensitive areas — Leads & offers, Opportunity sources, Client requests, Release checks, AI testing programme, Field notes, Privacy requests, Quotes/invoices/retainers, Portfolio intelligence, Claims, and Communication log — require a **direct membership** in the selected organisation. Partner-derived access is refused there by design, and each page says so.

Every access decision is enforced by the server; the sidebar merely reflects it.

---

## 6. The Dashboard (internal roles)

Depending on permissions and source availability, the Dashboard shows:

- **Pursuit decisions and next actions** — a control tower whose rows name why a pursuit needs attention and link to its recorded next action.
- **My Work** — your personal inbox of owned work plus unassigned work you may pick up, grouped Overdue / Today / Upcoming / Unscheduled in WAT.
- **Items needing attention**, **expiring evidence**, and **initial-readiness measures** where those sources are authorised and available.

Unauthorised sections are withheld. If a data source fails to load, the Dashboard shows it as unavailable; an unavailable count must never be read as zero, and order may adapt with page state.

---

## 7. Clients, the Certificate Vault and the Capability Library

**Clients** (`/clients`) is a card grid of client organisations with NDA status, segment, sector and project count. With `client:create` you can add a client, including the Gate-0 relationship metrics (decision-maker talks, junior contacts).

Each **client detail page** contains, besides the editable profile:

- **Certificate Vault** — certificate and evidence records can cover common artefacts such as CAC registration, FIRS tax clearance, PENCOM, ITF, NSITF, group life insurance, audited accounts, BPP/CCSP, NCDMB/NipeX registrations, sector licences, ISO certificates and bond facilities. Each row shows issuer, dates, a renewal lead, an expiry badge, and optionally a linked source document with its SHA-256 hash. Requirements vary by tender: add only records relevant to the engagement. BidBox does not automatically prove or require a complete vault.
- **Capability Library** — claims about past projects, personnel, equipment and certifications. **A claim is unusable in drafts until an evidence document is linked and the claim approved.** Unsupported claims are flagged, never silently filled in.

---

## 8. Pursuits — the register and the workspace

### The register (`/projects`)

A filterable table of all tender projects: search, status, risk, client, reviewer, WAT deadline windows, and sort options, all kept in the URL so you can share a filtered view. With `project:create`, **New Project** collects the client, tender identity, WAT submission deadline, the assigned reviewer (only active, current, directly-authorised reviewers are offered), SLA class, physical-archive and redaction instructions, and a **Restricted mode** switch for highly sensitive engagements.

**Every project starts payment-pending.** Analytical work can proceed, but release actions remain blocked. The two-leg founder/adviser confirmation control is currently unavailable because those authorities are not yet bound server-side; an attempted confirmation is rejected. Do not treat visible controls as an operable payment workflow.

### The pursuit workspace (`/projects/:id`)

The header shows status, risk band and outcome, plus the **Mandate Quality** selector (autopsy-only / assisted bid / retainer). A six-stage lifecycle rail — Prepare, Analyse, Respond, Review, Deliver and Record — exposes ten registers:

1. **Overview & next actions** — the **Project Readiness Gate** (a live checklist with a "next action" jump button; it refuses to rule at all if any underlying register failed to load), project metadata including model cost so far, the **Governance & Gates** card (status, SLA class, archive and redaction instructions, restricted mode, read-only conflict and payment state, and the two payment-confirmation legs), a per-project **notification log** (deadline reminders, payment confirmations, certificate renewals, report-ready notices — recorded, not dispatched), and for authorised users a **Retention Request** entry point.
2. **Tender documents** — the document register with type, redaction status, extraction status and an integrity **Verify** action that re-hashes the stored object. Documents arrive **excluded** from processing by default; a reviewer must deliberately include (or redact) them before extraction can read them. **New generic uploads are deliberately disabled** ("Upload unavailable") until the durable-lease upload path is verified; governed uploads happen through the Client Action Room (section 14).
3. **Requirements** — the requirement matrix. **AI Extraction** proposes requirements with grounded source quotes; each row shows its origin (engine vs manual), confidence, and review state. Reviewers confirm (✓), reject (✗), or edit — an edited row keeps the engine's original proposal visible. A **Gate 0 scorecard** tracks mandatory-requirement recall against the 85% gate. **Merge** lets you combine duplicate requirements; linked evidence and defects move to the surviving row.
4. **Evidence & compliance** — the evidence map binding requirements to documents with a status (present / missing / expired / unclear / not applicable / pending) and a verbatim excerpt. **Auto-Map** suggests bindings; only holders of `evidence:approve` can confirm them.
5. **BOQ** — the Bill-of-Quantities verifier, in two layers:
   - **Arithmetic checks (BOQ Lite).** Load figures by uploading a CSV/XLSX or pasting rows, map the columns (item ref, quantity, rate, amount…), optionally enter the declared grand total, and run. Tolerance defaults to zero — one kobo of drift is a finding. Any flagged row can be pushed to the defect register with one click.
   - **Commercial verification.** The deeper layer reconciles a whole lot against the **pinned Nigeria rule pack** (`ng-commercial-boq/v1`): line extensions, lot net, discount, taxable base, **VAT at 7.5%**, gross, net payable and bid security, all in exact kobo arithmetic. You select the governed source document the figures came from, enter the declared totals from the bid schedule, and run. Every discrepancy becomes a recorded **exception** with an exact expected/actual amount and a severity; exceptions stay open until a defect reviewer records a named resolution or waiver with a reason. Withholding-tax verification is deliberately disabled pending legal sign-off of category rates — declaring WHT raises its own exception rather than being silently accepted. Each run is stored permanently with the rule-pack version and the document version it verified, so a pass is reproducible — and a pass is an arithmetic statement, never a pricing or award opinion.
6. **Defects** — the defect register (suggested / open / remediated / waived; severities fatal → cosmetic; types from omission to validity). A red banner counts open fatal and likely-fatal defects: report sign-off is blocked until each has a persisted remediation, waiver or reclassification. Severity can be raised but never lowered once recorded, and only reviewers change severity. Independent red-team review is recorded separately in Delivery Studio.
7. **Risk review** — the computed disqualification-risk band and score, plus a reviewer-only override that requires both a band and a written justification, and shows who set any active override.
8. **Delivery Studio** — the governed path from response to operator hand-off:
   - **Response Studio** stores versioned sections and a claim register. Exact-quote claims are checked against the selected current document version; factual and instructional claims without valid citations, plus unresolved placeholders, remain blocked. Opinion claims may be uncited. Paraphrases always require a different named reviewer.
   - **Red-team review** records a policy version, the exact current response-source hash, findings, resolutions and an independent approval. A source change makes the approval stale; an empty findings list is not silently treated as approval.
   - **Package assembly** freezes the current reviewed inputs into a content-addressed manifest. Assembly is not signing, visual QA, export, delivery or submission, and those separate controls remain in force.
   - **Submission rehearsal** checks a reviewed portal profile and frozen package files for order, names, extensions, sizes, mappings and manual declarations. It never stores credentials, logs in, accepts a declaration, uploads or clicks submit.
9. **Package & export** — report generation, the version table and sign-off (a fixed attestation recorded against a named reviewer). DOCX/PDF downloads appear for signed-off report versions. ZIP export is a separate controlled action requiring the latest signed report, exact canonical package provenance, render QA and current readiness, NDA and archive checks. Sign-off and export recheck the current Response Studio claims and exact, non-stale red-team source hash.
10. **Activity & audit** — the application's chained event timeline. Rows distinguish "Active v2 chain record" from amber "Legacy v1 archive" records and show recorded integrity status; this view does not claim external immutable anchoring.

**Tender Context & Eligibility Passport (`/projects/:id/tender-context`)** opens only with project, document, requirement, evidence and rule-pack read permissions. It presents source- and version-bound tender context and eligibility review; it does not grant eligibility or replace named review.

---

## 9. Compliance corpus — Standard Bidding Documents (`/sbd`)

A normalised library of Nigerian Standard Bidding Documents: code, category (Goods / Works / Consultancy / Non-Consultancy / Special), version, status (draft / active / superseded) and issuing circular. Reviewers can add templates, create new versions, and record **agency-format annotations** for documented format differences reviewers need to check. An annotation does not predict disqualification. Use this corpus to normalise recorded requirements and support review across pursuits.

---

## 10. Intelligence Centre (`/intelligence`)

The decision-support console. It requires the full set of read permissions over the underlying sources — if you lack any, the page tells you and loads nothing.

What you will find: pursuit-scoped evidence metrics, the current runtime level, restricted-mode and "production model execution is disabled" notices where applicable, a **review inbox** where a reviewer with `intelligence:review` claims an item and records a decision, and the **decision-support catalogue** of capabilities. Claim and decision actions are bound to exact source versions; a stale request is rejected and must be reloaded. The closing "decision contract" is worth reading once: suggestions may be wrong; open the named source; your identity stays on the decision; BidBox does not approve evidence, waive findings, set prices, predict awards or submit bids.

---

## 11. Operations consoles (internal roles)

**Operations (`/operations`)** — connected signals (tracked engagements, SLA breaches, red-team due, expired evidence), a "requires attention" list linking into pursuits, and the read-only **AI control plane** evidence: the global kill switch, release-gate blockers in plain English, the capability policy grid, budget state, and recent AI/evaluation runs. The console is honest about queues that are only partially wired.

**Pursuit Operations (`/pursuit-operations`)** — the working suite for the operational side of a pursuit: authorised opportunity intake, the work board, the client evidence request room, the submission war room and visual package QA, credential verification, pre-bid/site-visit mission control, and post-award delivery control. Every board carries its "human authority" boundary note, and a **low-bandwidth mobile queue** (`?view=mobile`) exists for field conditions.

---

## 12. Field Companion (`/field-companion`) — offline notes done safely

For site visits and delivery runs where connectivity is unreliable. Drafts (site-visit notes, delivery receipt notes, checklist progress) are **encrypted locally in your browser**, partitioned to your identity and your organisation, and **expire after seven days, non-extendable**. There is no background sync and no file/photo capture — this is a draft-only boundary.

When you are back online and hold `project:update`, a **promotion review** lets you copy one draft into one compatible governed work item after inspecting a field-level diff; the draft then records its receipt hash but remains local and is explicitly "not evidence". A destructive wipe control (`WIPE MY DRAFTS`) deletes your local key and drafts on that browser.

One warning the page makes itself: a shared browser profile is not a security boundary — use your own OS/browser profile on shared devices.

---

## 13. Getting Started & Offers, and Opportunity Sources

**Getting Started & Offers (`/growth-operations`)** — three things: a **lead operations inbox** for qualifying interest before conversion (assignment, SLA, status decisions, a purpose-bound contact hand-off, and conversion _proposals_ — no CRM, no messaging, no autonomous anything); a **first-pursuit onboarding** checklist with self-recorded practice markers and a synthetic guided tour; and the **versioned offer catalogue** — per-SKU scope cards with explicit inclusions and exclusions, and "Human quote required · External manual payment only" on every card.

**Opportunity Sources (`/opportunity-sources`)** — a bounded, manual pilot register of official tender sources. You record an official source URL, work the review inbox (accept/reject with a written reason, version-guarded), and hand an accepted opportunity to a pursuit — which requires a client and an independent reviewer and surfaces conflicts before anything is created. There is **no scraping or acquisition adapter**, source text is treated as untrusted, and the register has a lifetime cap per organisation; intake stops at capacity pending a reviewed retention migration.

---

## 14. The client-facing rooms

**Client workspace (`/portal`)** — a read-only summary for authorised client roles: open pursuits, fatal-blocker counts, workflow alerts, evidence expiry, deadlines in WAT, and recorded next steps. Eligible users see a **Pending** navigation item while its feature flag is off and the page says "Client portal is not active yet"; current permissions are still required after activation.

**Client Action Room (`/client-actions`)** — the governed way documents get from a client into a pursuit. An authorised person creates a **bounded evidence request** naming a recipient from a server-supplied directory; the recipient performs a **governed upload into that exact request slot** (a lease is issued, the object uploaded, then finalised — only one governed upload may be in flight at a time); reviewers accept or request changes; and released-package **acknowledgements** are recorded against an exact package version. No email or free-form messaging happens here, and the room closes for new requests once the pursuit is signed off, exported or archived.

---

## 15. Partner workspaces

**Partner workspace (`/partner`)** — server-authorised relationship summaries and the selected tenant's authorised pursuit and evidence signals, with lifecycle badges, co-signing requirements and QA responsibility text. Client contexts are entered only through server-validated organisation selection, so the tenant boundary stays intact.

**Consortium Room (`/consortium-room`)** — a bounded coordination ledger for exactly one active partner relationship and one client-owned project: a bilateral **responsibility matrix** (maker-checker on both sides) and a **QA/co-sign checklist**. Initialising a room requires naming both coordinators from a server-authorised directory. Released pursuits are read-only. There is no external messaging and no settlement here.

Eligible partner users may see these items marked **Pending** while the partner-workspace flag is off. The pages become usable only after activation and current server authority checks.

---

## 16. Evidence, renewals, reports and portfolio intelligence

**Evidence Library (`/evidence-readiness`)** — the portfolio exception view: fatal-defect projects, conflict blocks, pending payment gates, expired evidence, and the expiry-window register. Its standing panel says the important thing: portfolio signals are not a release decision.

**Evidence renewals (`/evidence-renewals`)** — governed renewal plans per pursuit: create a plan, stage a canonical replacement document, review the affected-pursuit impact, and record an **independent verifier decision**. Every action produces a hash receipt and confirms "no external message sent".

**Reports (`/reports`)** — a portfolio directory of report records with version counts and latest status, linking into each pursuit. Rows whose register failed to load say "Unavailable" and are excluded from counts. Report presence is not submission readiness — generation, sign-off and export stay project-scoped.

**Portfolio intelligence (`/portfolio-intelligence`)** — a tenant-local operating view of response, red-team, package and rehearsal status across the pursuits you are authorised to see. Filters and drill-downs lead back to the authoritative project records. Counts are descriptive workflow evidence only: this page does not predict awards, infer evaluator behaviour, train a model, compare tenants or authorise release.

---

## 17. Commercial surfaces

**Billing & entitlements (`/billing`)** — a transparency page. Until commercial activation it makes no orders, invoices, payments or grants, and its capability cards say precisely what is unavailable, blocked, partial or pending.

**Commercial & Retainer (`/commercial-retainer`)** — the human-controlled quote-to-cash ledger: fixed offers, maker-checker approval, manual invoice records, payment **evidence** records (no payment provider is connected), entitlements, and retainer service requests. The page verifies its own safety contract on load — automatic pricing disallowed, no payment provider, no external messaging, maker-checker required — and refuses to render a snapshot that violates it.

**Commercial & Claims Desk (`/claims-desk`)** — the post-award claims and contract-events ledger: register contract events, notice deadlines, variations, claims, payment certificates and obligations, with evidence bindings to governed documents and version-guarded maker-checker transitions. Every write returns a receipt hash. The desk records evidence and positions; it cannot dispatch notices, determine legal entitlement, price work, or touch invoices and payments.

---

## 18. Notifications and communication receipts

**Notifications (`/notifications`)** — a status console. The global dispatcher is not connected, and the page's six channel cards say exactly what is active (manual record) and what is not (email, WhatsApp, in-app, failure queue, digests). Per-project notification logging lives on the pursuit Overview tab.

**Communication Receipts (`/communications`)** — the reconciled communication log: queue an approved intent from an approved template and record every external attempt **before** its effect. In the default runtime message providers and receipt verification are disconnected, so attempts are recorded as known not delivered and BidBox cannot verify delivery. A **verified delivered** state is valid only when a trusted receipt from an approved adapter is available.

---

## 19. Administration

**Security & audit (`/app/security`)** — the stored legacy-migration integrity assessment (what was preserved, what discontinuities are known), security queue coverage (break-glass access is deliberately not exposed here), and the **monthly access review**: who touched what, when, with each row marked as a legacy-archive or active-chain record.

**Privacy Operations (`/privacy-operations`)** — minimised privacy evidence plus three named-human workflows: DSR triage, consent-withdrawal evidence, and legal-hold review, each version-guarded and optionally citing a governed document. The centre records evidence; it does not establish identity, decide legal rights, release holds, or execute deletion.

**Production Acceptance (`/production-acceptance`)** — the release evidence console for the most senior internal roles: tenant scope, immutable digests, release-candidate binding, expiry windows, and an evidence form bound to the expected release SHA-256 with a named owner. Its safe state is spelled out: **no-go**. It cannot deploy, restore or roll back anything.

**AI Shadow Programme (`/ai-shadow`)** — a no-output evaluation evidence pilot: version-bound plans, hash-only observations, and independent closure. The client hard-fails any response that does not preserve "production activation granted: false". A clean result makes a capability _eligible for governance review_ — nothing more.

**Organisation Settings (`/organisation-settings`)** — membership administration for the selected organisation: grant access by internal user ID with a role inside your delegation ceiling, set membership and role end dates (WAT end-of-day), suspend/reactivate, and edit access windows — with guards against locking yourself out or removing the last active administrator. Version conflicts reload the record rather than overwriting someone else's change.

**Platform Operations (`/settings`)** — internal platform administrators only: severity weights and risk-band cutoffs, report template text and default retention, the read-only legacy personnel table (real access changes happen in Organisation Settings), and the retention-request queue. The queue exposes live readiness evidence and, only when every server-checked precondition is verified, the explicit detach → reconcile → certify workflow. Each phase needs the current version, a typed confirmation, an idempotency key and a named-human attestation; certification requires a checker different from the preparer. Loading, stale, offline, forbidden, blocked or failed evidence hides the action. In the shipped configuration production activation is denied, so no completion data is deleted and no new certificate is issued.

**Account (`/account`)** — your own profile: current organisation context and effective roles, your copyable **BidBox User ID** (used by an organisation administrator when granting membership), plus the identity provider's panel for password, MFA, sessions and recovery. Organisation access is granted by administrators, never self-service.

---

## 20. Feature flags — what "Pending" means

Current frontend feature flags gate the **Client workspace**, **Partner/Consortium workspace**, **Billing & access**, and **Notifications**. Communication log is not controlled by the notification feature flag; it requires direct membership and project access, and provider adapters remain disconnected by default. Where a flag is off, an eligible user may still see an amber **Pending** item and a page explaining that service activation is outstanding. Frontend visibility or activation never grants server authority, and a flag cannot bypass a permission, evidence, conflict, privacy or readiness gate.

---

## 21. "Why is this blocked?" — the cheat sheet

| What you see                                             | The rule you have hit                                                                                                                                        |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| "Upload unavailable" on Tender documents                 | Generic signed uploads are disabled until the durable-lease path is verified. Use the governed Client Action Room upload.                                    |
| "Payment confirmation pending" / release actions blocked | Founder/adviser authority binding is not active in the current configuration, so no user can clear this gate.                                                |
| NDA / conflict banner on a pursuit                       | Intake is blocked until the NDA gate is resolved or a named conflict decision is recorded.                                                                   |
| Sign-off refuses                                         | Open fatal or likely-fatal defects without a persisted remediation/waiver, unresolved archive instructions, or another readiness check — the toast names it. |
| "Direct … membership required"                           | You are on partner-derived access; eleven workspaces accept only direct memberships (section 5).                                                             |
| Amber "Pending" chip                                     | Feature or service activation is still outstanding (section 20).                                                                                             |
| "Released pursuit is read-only"                          | Most ordinary edits are blocked after release; only explicitly defined append-only or exception workflows remain available.                                  |
| A 409 "changed in another session"                       | The record changed. Reload it, compare the current version, then re-apply intentionally; BidBox must not overwrite it silently.                              |
| "Workspace switching is temporarily blocked"             | A write is in flight; finish or cancel it, then switch organisations.                                                                                        |
| Empty list with careful wording                          | Deliberate: absence of records is never presented as compliance, readiness or delivery.                                                                      |
| Buttons disabled while a banner says you are offline     | Mutations pause offline everywhere except Field Companion drafts.                                                                                            |
| "Send notification" disabled                             | No dispatcher is currently connected; sending remains unavailable until the feature and required provider/receipt controls are activated.                    |

---

## 22. Quick reference — statuses and badges

- **Requirement rows**: suggested → confirmed / edited / rejected; origin engine or manual; mandatory chip; grounded quotes expandable.
- **Evidence**: present / missing / expired / unclear / not applicable / pending; suggested rows need a ✓ from an approver.
- **Defects**: suggested / open / remediated / waived; severity fatal / likely fatal / scoring risk / cosmetic (raise-only).
- **BOQ commercial exceptions**: open / resolved / waived, each with code (e.g. `extension_mismatch`, `vat_mismatch`, `bid_security_mismatch`), severity, and exact expected/actual kobo amounts.
- **Documents**: redaction excluded / redacted / included; extraction states including "security quarantined"; integrity Verified / FAILED / Unverifiable (no intake fingerprint).
- **Reports**: draft → signed-off; downloads only on signed-off versions.
- **Memberships**: Active / Scheduled / Expired / Suspended / Revoked, with access windows in WAT.
- **Audit rows**: "Active v2 chain record" vs amber "Legacy v1 archive · integrity status".

---

_If help disagrees with the current on-screen state, stop and follow the current server-backed blocker or access explanation, then report the documentation discrepancy. Help never overrides permissions, readiness or release controls._
