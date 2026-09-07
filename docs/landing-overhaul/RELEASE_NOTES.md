# Landing-page overhaul release notes

Release status: **unreleased and not deployed**. This document describes the current merge candidate; it does not authorise production intake.

## Buyer journey

- Repositioned the public landing page around the headline **“Find the defects before submission.”**
- Replaced the generic walkthrough journey with one dominant action: **Request a Bid Autopsy**.
- Routed all dominant acquisition placements to `/request-bid-autopsy`; Sign In remains a low-emphasis utility action.
- Added buyer-specific problem framing for Nigerian federal contractors, NipeX/NCDMB suppliers, donor-funded bidders, bid teams and consultancy partners.
- Added a concrete Bid Autopsy deliverable, process, representative source-to-action sample, service progression, audience pathways, trust boundaries and expanded FAQ.
- Kept public claims within the reviewed evidence boundary: no testimonials, customer statistics, turnaround promise, provider guarantee, award guarantee or fabricated proof.
- Qualified BidBox as designed for AI-assisted, human-verified work only where provider, privacy and evaluation gates are approved; named human review remains authoritative.

## Public request journey

- Added an accessible business-only request form with contact/company details, closed tender category and bid-stage choices, optional deadline, contact preference and privacy acknowledgement.
- Deliberately excluded tender uploads, pricing, credentials, sensitive bid content and a free-text tender-details field from first contact.
- Added client validation, focused error summary, per-field errors, submitting, safe failure/retry and accepted states.
- Added reload-safe ambiguous-request handling. Session storage persists no raw field values; it retains a version, random idempotency key, form-start timestamp and session-scoped SHA-256 digest derived from the normalised fields for retry integrity. That digest is pseudonymous request metadata and remains within the privacy and retention activation review.
- Unchanged retries reuse the operation key, materially changed requests rotate it, and confirmed success clears it.
- Added SPA route-focus and live-announcement behaviour without stealing focus on an initial page load.

## API and database

- Added `POST /api/public/bid-autopsy-requests` to the OpenAPI contract and generated React/Zod clients.
- Added strict same-origin JSON handling, supported-content-encoding enforcement, bounded server validation, false-consent rejection, honeypot/minimum-time bot checks and safe public errors.
- Added exact replay and changed-payload conflict handling through hashed idempotency keys and normalised payload fingerprints.
- Added a database-backed fixed-window limiter shared across autoscale replicas. The database sees only an HMAC key, never the raw client address or server secret.
- Added isolated `valo_intake` migrations for bounded lead records, rate-limit buckets, explicit retention deadlines and owner-only purge functions.
- Denied the application runtime all direct table privileges and owner-side purge execution; runtime may call only the bounded intake and limiter functions.
- Limited ordinary success telemetry to an opaque committed-receipt event without submitted PII.

## SEO and delivery

- Added route-specific public titles, descriptions, Open Graph/Twitter metadata, sitemap coverage and crawler-readable production HTML.
- Made the static template noindex by default.
- Limited index/follow, canonical and `og:url` output to implemented public paths on the exact approved production origin.
- Kept previews, localhost, authentication/workspace routes and unknown paths noindex; unknown paths return HTTP 404.
- Added long-lived caching for versioned assets and no-cache handling for HTML.
- Added CI budgets for initial JavaScript/CSS, request and public-page lazy chunks, images and fonts.
- Kept the public journey free of remote fonts and client-side analytics transport.

## Accessibility and responsive changes

- Retained the skip link and semantic public landmarks.
- Added predictable mobile-menu focus, Escape close and trigger-focus restoration.
- Added visible FAQ focus, 44 CSS-pixel public targets and route-change focus/announcement behaviour.
- Added labelled form controls, connected hints/errors, focused validation summary and announced progress/outcomes.
- Removed the document-level minimum width that caused 320px horizontal overflow in retained captures.

The final local Chromium pass verified one H1, a visible primary CTA and no horizontal document overflow at 320 by 700, 360 by 780, 667 by 375, 768 by 1024, 1024 by 768, 1440 by 900 and 1920 by 1080 CSS pixels. Fresh 320px and 1440px landing/request screenshots are retained. No WCAG conformance claim is made.

## Configuration required before activation

Source configuration selects the database destination, exact public origin and one trusted proxy hop. The following values are intentionally not committed:

- `VALO_PUBLIC_LEAD_RETENTION_DAYS`: requires an approved integer from 1 through 3650; there is no default.
- `PUBLIC_LEAD_RATE_LIMIT_HMAC_SECRET`: requires at least 32 bytes and belongs in Replit Secrets.

Activation also requires a named authorised queue/reconciliation owner, an approved lead and limiter-bucket purge schedule, an approved privacy-rights contact channel and an operationally authorised queue reconciliation path.

## Database change set

- `0003_zippy_skrulls.sql`: isolated public Bid Autopsy request store and bounded insert function.
- `0004_dizzy_virginia_dare.sql`: shared HMAC-keyed rate-limit buckets and consume function.
- `0005_tranquil_jack_power.sql`: explicit lead retention deadline plus owner-only lead and expired-bucket purge functions.
- `0006_lead_operations_queue.sql`: a content-minimised active lead queue, closed status-transition boundary and assigned-operator single-record preferred-contact handoff. Contact names, email addresses and telephone numbers remain outside bulk operator responses; the handoff sends no message and is purpose-audited without copying contact PII into tenant audit details.
- `scripts/start-replit-production.mjs`: shared same-process entrypoint used by both the effective API artifact and legacy `.replit` path; it awaits the bounded migration launcher before importing the compiled API, preserves the inherited deployment environment and keeps the port closed on migration failure.
- `migration:replit:intake`: Replit-production-only launcher that pins the accepted journal and source hashes, validates separated same-target credentials, serializes Autoscale starts, applies only the pending four-migration suffix, and verifies the final intake catalog before API startup.

The launcher applies migrations with owner authority and then starts the application with the dedicated least-privilege runtime database role. CI proves the migration chain on its isolated PostgreSQL target; the live production journal and runtime attestation remain deployment evidence gates.

## Validation snapshot

The frozen local tree passed source and test typechecks; security lint; release configuration; migration/bridge checks; 18 of 18 focused public API/web tests; the 2-test generated-client contract; 19 of 19 database runtime-security tests; 5 of 5 source-only Replit migration tests, with the sixth disposable PostgreSQL 16 rehearsal conditional on CI; the focused public journey, Axe and SEO selection of 34 tests across 3 files; and the full workbench suite of 29 files and 188 tests in 16.27 seconds. Both production builds passed; the workbench transformed 1,971 modules.

The landing and initial request page pass focused Axe checks with zero reported violations. Colour contrast is disabled in jsdom and remains a rendered browser/manual check. The frozen public budget passed at main JavaScript 84,269/102,400 gzip bytes; CSS 23,240/25,600; request chunk 6,474/8,192; public-pages chunk 6,712/10,240; images 40,977/819,200; fonts 0/102,400. Live PostgreSQL CI, production evidence and adversarial sign-off remain separate gates.

## Known blockers

Production remains **no-go** because there is no approved retention duration, HMAC secret, named queue owner, purge/reconciliation schedule, privacy-rights channel, live PostgreSQL/CI proof, complete owner-side `valo_intake` ACL/grantee audit, encrypted PostgreSQL transport and public-edge HTTPS/HSTS proof, representative screen-reader evidence, 200/400 percent zoom proof, cross-browser matrix, Lighthouse/mobile-network/Core Web Vitals evidence or deployed smoke. Public analytics also remains disabled pending provider, purpose, consent and retention approval.

The server's generic public prerender is replaced by a non-hydrating React `createRoot` render, so CLS risk remains unmeasured.

No analytics transport or CRM/email delivery adapter is active. The content-minimised queue read/status surface remains fail-closed until its one approved internal organisation, named operator, SLA and reconciliation controls are configured; an accepted database receipt does not by itself prove human follow-up.

See `ACCESSIBILITY_REPORT.md`, `PERFORMANCE_AND_SEO.md`, `BROWSER_AND_VISUAL_QA.md`, `VALIDATION_AND_RELEASE.md` and `MEASUREMENT_AND_LEAD_ROUTING.md` for the complete evidence boundary and activation gates.
