# Landing-page audit and positioning

Status: implementation input and public-claim boundary reviewed on 10 August 2026. This document records evidence; it is not proof of production deployment or customer research.

## Sources and authority boundary

The review covered the complete Business Plan v1.1, Product Roadmap v1.0, TRD v1.0, the current repository, the published Replit page, existing design tokens, public routes, metadata, lead path, tests and CI.

Business Plan v1.1 and Roadmap v1.0 are confidential pre-Gate-0 drafts. TRD v1.0 explicitly aligns to missing Business Plan v1.2 and Roadmap v1.1. The missing versions cannot be treated as implicit public-claim approval. Production model execution is also hard-disabled by the AI release controls. Public copy therefore describes implemented methods and human authority, qualifies the designed AI-assisted operating model, and omits unapproved provider, region, retention, service-level and outcome claims.

No approved customer testimonial, logo, case study, customer count, turnaround commitment or performance statistic was found. None is used.

## Baseline evidence

The published page and the source-built page were captured before redesign at desktop and 320 CSS-pixel widths:

- `evidence/before-landing-1440.jpg`
- `evidence/before-landing-320.jpg`
- `evidence/before-source-landing-1440.jpg`
- `evidence/before-source-landing-320.jpg`

The published page was behind the merged source. It presented a dark workbench-oriented page with “Sign In to Workbench” as its primary action. The source build had a more mature warm-white public shell, but still sold a generic “walkthrough” and product workflow rather than the Bid Autopsy diagnostic wedge.

## Current-state inventory

| Area      | Baseline                                                                                              | Finding                                                                                           |
| --------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Header    | Capabilities/lifecycle on the published page; Product/Solutions/How it works/Security/About in source | Neither used the required buyer decision path; Sign In competed with acquisition                  |
| Hero      | “Every bid, dissected…” live; “Build a tender submission…” in source                                  | The outcome, named audiences and concrete diagnostic deliverable were not immediately clear       |
| Problem   | Generic workflow and handoff language                                                                 | Preventable compliance-gate failure modes were not explained                                      |
| Offer     | No Bid Autopsy definition                                                                             | Visitors could not tell what they would receive                                                   |
| Method    | Product capabilities and a four-step workflow                                                         | Sound source/evidence/human-review controls existed but used internal language                    |
| Proof     | Illustrative product UI                                                                               | No fabricated proof, but the page did not show a coherent source-to-action review trail           |
| Services  | Product/solution pages only                                                                           | No diagnosis-first progression to supported services                                              |
| Audiences | Broad bid/compliance/advisory language                                                                | Federal contractors, NipeX/NCDMB suppliers and donor-funded bidders were not given clear pathways |
| Trust     | Good limitation language                                                                              | AI/provider and isolation wording required qualification against release evidence                 |
| FAQ       | Four broad questions                                                                                  | Core Autopsy, financial-page, timing, pricing and remediation questions were unanswered           |
| Footer    | Public/legal routes and Sign In                                                                       | No dominant Autopsy journey                                                                       |

## CTA and form audit

The published page had no form. The source used “Request a walkthrough” and routed `/contact` to a build-time HTTPS booking URL, a `mailto:` fallback, or an honest unconfigured state. There was no canonical first-contact API, server validation, idempotency, bot control or monitored authorised lead store. No tender document was requested, which was correct and is preserved.

The redesigned conversion architecture has one dominant action, **Request a Bid Autopsy**, routed to `/request-bid-autopsy` from every primary placement. The only hero secondary action is an in-page “See What the Autopsy Checks” link. Sign In remains a low-emphasis utility action.

## Accessibility baseline

The published page had one H1 and no console errors in the retained Chromium pass, but it lacked a `main` landmark. The source shell already provided a skip link, semantic main/footer, visible focus tokens, reduced-motion styles and zoomable viewport settings. The source mobile navigation was functional but did not restore focus or close with Escape. There was no public form to test.

The redesign retains the sound shell and adds an accessible menu, semantic narrative, labelled fields, field errors, an error summary, status announcements and at least 44 by 44 CSS-pixel interactive targets. Automated checks do not replace keyboard, screen-reader and zoom evidence.

## Performance baseline

The pre-change production workbench build completed successfully with:

- public entry JavaScript: 274,153 raw bytes / 85,810 gzip bytes;
- shared stylesheet: 138,841 raw bytes / 22,880 gzip bytes;
- no remote web font;
- no landing-page photograph, video, carousel or third-party analytics script;
- protected workbench and heavy BOQ/SheetJS code split into separate chunks.

No real-user Core Web Vitals dataset or existing Lighthouse record was available. The numbers above are build artefacts, not 75th-percentile LCP, INP or CLS. CI now enforces explicit initial JavaScript/CSS and public image/font budgets after the production build.

## SEO baseline

The source already had route-specific canonical metadata, Open Graph tags, a valid 1200 by 630 social image, sitemap, robots exclusions, crawler-readable server HTML, long-term caching for versioned assets and real HTTP 404 responses. Weaknesses were the old generic homepage title/description, no indexable request route and thin prerendered homepage content. Private and access routes were correctly `noindex, nofollow`.

## Analytics baseline

No public analytics provider, consent policy, retention decision or approved analytics destination exists. The internal cost-analytics route is not a public web analytics system. Adding a bespoke event store would create a tracking and fingerprinting surface without an approved purpose boundary. Event transport is therefore deliberately disabled; the measurement specification is retained in `MEASUREMENT_AND_LEAD_ROUTING.md` for activation only after approval.

## Severity-ranked issues

| Severity | Issue                                                                              | Resolution                                                                                                     |
| -------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| S1       | No operational, exactly-once Bid Autopsy lead route                                | Add bounded public API and isolated database queue with origin, validation, bot, rate and idempotency controls |
| S1       | Published experience did not expose the required offer or CTA                      | Replace the public narrative and CTA architecture                                                              |
| S2       | Generic product positioning obscured audience and disqualification-defence outcome | Lead with the buyer problem and named Nigerian tender contexts                                                 |
| S2       | Public copy could imply unapproved live model/provider guarantees                  | Qualify designed AI assistance and keep named human review authoritative                                       |
| S2       | No request-form accessibility, failure or retry journey existed                    | Add dedicated accessible form states and focused tests                                                         |
| S2       | Search-readable homepage content and metadata described the old offer              | Update SSR/prerender metadata, sitemap and request route                                                       |
| S3       | Mobile navigation lacked Escape/focus restoration                                  | Add predictable keyboard close and restored focus                                                              |
| S3       | No enforced public-route performance budget                                        | Add CI budget gate                                                                                             |

## Approved positioning

Primary headline: **Find the defects before submission.**

BidBox helps Nigerian federal contractors, NipeX and NCDMB suppliers, donor-funded bidders, bid teams and consultancy partners test a bid package against the published tender before it reaches the evaluator. A scoped Bid Autopsy can produce source-cited requirements, evidence and eligibility gaps, severity-classified findings, deterministic checks on client-supplied bill-of-quantities figures, a responsiveness review and prioritised remediation verified by a named human reviewer.

BidBox is designed for AI-assisted, human-verified review. Model-assisted steps operate only where the engagement's provider, privacy and evaluation gates are approved; human review remains authoritative.

BidBox does not guarantee an award or evaluator acceptance, set commercial pricing, influence evaluators, broker relationships, provide legal advice or submit a bid.

## Revised page architecture

1. Buyer-specific hero and trust boundary.
2. Practical compliance-gate failure modes.
3. Concrete Bid Autopsy deliverable and second conversion point.
4. Four-step NDA-gated review process.
5. Representative source-to-requirement-to-evidence-to-action trail.
6. Diagnosis-first progression to supported services.
7. Mechanism-led differentiation.
8. Five audience pathways.
9. Integrity and controlled-data principles.
10. Complete Bid Autopsy FAQ.
11. Final value restatement and the same request action.
12. Public/legal footer and low-emphasis Sign In.

No representative user-comprehension study was available. The design has not been described as meeting the prompt's 80 percent comprehension target.
