# UI overhaul release notes

Status: implementation candidate. The changes are not a production-complete release until the provider, database, authenticated-browser, accessibility, and Replit promotion gates in `VALIDATION_AND_RELEASE.md` pass.

## Public experience

- Replaced the placeholder entry route with a complete public BidBox site for Nigerian contractors, NipeX/NCDMB suppliers, donor-funded bidders, and consultancy partners.
- Added Product, Solutions, How it works, Security, About, Contact, Privacy, Terms, and explicit not-found experiences.
- Added plain-language process, offering, integrity, security, and customer-fit content without fabricated testimonials, logos, statistics, prices, or award claims.
- Added an honest contact pathway: validated HTTPS booking destination, validated email fallback, or an explicit unconfigured state. No pretend submission exists.
- Added route-specific crawler-readable server HTML, semantic metadata, canonical rules, a 1200 by 630 PNG social preview, favicon, manifest, sitemap, robots configuration, true HTTP 404 responses, and private-route no-index protection.

## Authentication and access

- Preserved Clerk as the authentication authority and implemented provider-backed sign-in, invitation/callback, verification, recovery, MFA, session, disabled, rate-limit, and unavailable presentation states.
- Added safe return-path validation and immediate private-document metadata on sign-in and protected routes.
- Split public rendering from the identity/query runtime so the marketing site remains available without leaking or fabricating protected access.
- Added an organisation-selection gateway and fail-closed unsupported/no-role/error states.

## Authenticated product

- Rebuilt the global shell around Command Centre, Pursuits, Compliance, Evidence, Reviews, Reports, Clients, Platform Operations, and Organisation Settings.
- Added task-first global search, organisation/role context, responsive navigation, utility destinations, and an application error boundary.
- Rebuilt the Command Centre around real deadlines, SLAs, blocked conflicts, recorded findings, workflow alerts, and honest partial-source states.
- Added data-backed client and partner workspaces with explicit feature-pending and least-privilege states.
- Added organisation membership administration using generated contracts, conditional versions, expiry validation, delegation-aware policy, and safe self/last-admin handling.
- Re-authorised membership grants, reactivation, suspension, and expiry changes from locked live server rows; higher-role targets, self-service authority changes, and last-administrator/owner failures are denied and audited.
- Opened the core pursuit workbench to canonical client, partner, and read-only auditor roles according to the selected context's server-computed permissions. Organisation discovery now includes related client contexts only after active membership, relationship, client, and `partner_edition` checks; projected partner access remains bounded and is revalidated on every request.
- Hid client creation, pursuit creation/update/payment, retention, and report mutation controls when their exact server permission is absent, while retaining server-side enforcement.
- Added a reports index with truthful loading, partial, error, and empty states.
- Improved pursuit deep links, keyboard navigation, upload recovery, and storage-transfer failure handling.

## Design system and accessibility

- Introduced a calm ink/warm-neutral/teal system with semantic severity, workflow, focus, radius, border, spacing, motion, and typography tokens.
- Normalised undersized text, increased navigation-label contrast, preserved skip links, and converted click-only project rows into real focusable links.
- Added reusable public shell, BidBox mark, platform states, authentication/access shell, task search, and error-boundary components.
- Verified the public site at five responsive widths with no page-level overflow and retained three evidence screenshots.

## Performance and deployment composition

- Lazy-loaded every protected page and every pursuit tab.
- Reduced the protected shell from approximately 856.6 kB / 246.3 kB gzip to 109.7 kB / 30.7 kB gzip and isolated SheetJS to the BOQ route.
- Configured Replit to build both artefacts and run one production API process that serves the workbench, route-specific public deep links, private no-index headers, immutable hashed assets, and a deny-by-default Clerk-compatible CSP.
- Restricted Clerk proxy-host selection to the configured public-origin allowlist, so untrusted Host or forwarded-host values cannot choose a Clerk instance; unknown proxy hosts fail closed.

## Intentional limitations

- There is no approved public pricing, lead-form backend, analytics provider, or verified social-proof content, so none was fabricated.
- Dedicated finance/commercial and executive-signatory backend roles do not exist; the UI does not invent them.
- Billing, notification delivery, partner co-sign, OCR, licensed feeds, and audit anchoring remain provider- or feature-gated where their production contracts are incomplete.
- Observable failed uploads are rolled back through a tenant-authorised server path, but process/browser loss after PUT can leave an unreferenced staging object, and a server stop before database commit can leave an uncommitted promoted object. A durable upload lease and reconciler covering both namespaces is a production-activation gate; signed-URL expiry does not delete either object.
- Evidence deletion still spans PostgreSQL and object storage. Production activation requires a durable deletion intent/outbox and reconciler so a database rollback cannot leave a live record whose blob was already deleted.
- The current server authorises project resources at the selected tenant/partner-projected context, not at a general engagement-assignment boundary. Contributor, reviewer, quality-adviser, and partner journeys must not be described as assignment-restricted in production until an authoritative assignment relation is enforced throughout project/resource queries (or the approved scope contract is corrected).
- The canonical permission implementation now separates portfolio management, contribution/proposal, client review, and BidBox quality authority, with a full role-by-controlled-permission regression matrix. The remaining deliberate fail-closed gap is defect decision granularity: one `defect:review` permission still covers non-fatal waiver, risk override, and fatal-quality decisions, so proposer/partner roles cannot execute those decision paths until the workflow gains decision-specific permissions and two-person state.
- Full Clerk end-to-end, two-tenant browser, axe, screen-reader, cross-browser, field performance, and Replit production smoke evidence remain outstanding release gates.
