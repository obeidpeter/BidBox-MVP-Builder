# Content and conversion specification

Status: implemented public-content contract. It does not authorise a new factual claim, service level or model-provider decision.

## Decision frame

| Question                        | Answer the page must make clear                                                                                                         |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Who is BidBox for?              | Nigerian federal contractors, NipeX/NCDMB suppliers, donor-funded bidders, bid/commercial teams and consultancy partners                |
| What problem does it address?   | Preventable compliance, evidence, arithmetic, responsiveness and package-control defects before submission                              |
| What is the offer?              | A scoped, human-verified Bid Autopsy against the published tender and supplied package                                                  |
| What does the customer receive? | Agreed source-cited requirements, findings, severity, gaps, deterministic BOQ checks and prioritised remediation with scope limitations |
| What is different?              | Evidence traceability, deterministic checks and named human accountability rather than generic proposal generation                      |
| What should the visitor do?     | Request a Bid Autopsy                                                                                                                   |

## Canonical copy

Headline: **Find the defects before submission.**

Primary action: **Request a Bid Autopsy**

Hero secondary link: **See What the Autopsy Checks**

Trust boundary:

> BidBox strengthens the review process; it does not guarantee an award or evaluator acceptance. Model-assisted steps operate only where provider, privacy and evaluation gates are approved; human review remains authoritative.

Offer definition:

> A Bid Autopsy is a structured review of a live, draft or previously submitted bid against the original tender. Depending on the agreed scope and materials provided, it may include a source-cited requirement matrix, severity-classified defect register, compliance and evidence gaps, deterministic checks on client-supplied BOQ figures, a responsiveness review, a prioritised remediation plan, named human review, and clear scope limitations.

Service progression:

> Start with the diagnosis. Continue where BidBox can add measurable value.

## CTA map

Every dominant acquisition action resolves to `/request-bid-autopsy`:

1. desktop and mobile header;
2. hero;
3. Bid Autopsy deliverable section;
4. trust section;
5. closing conversion section;
6. contact page;
7. public-page supporting CTA component.

Sign In is a utility action. In-page navigation and “See What the Autopsy Checks” use link styling, not primary-button styling. No free-trial, demo, account-creation or generic get-started action is introduced.

## Demonstration contract

Product/report demonstrations are labelled as representative sample data and must not resemble a real customer record. They may show a fictional tender clause, requirement, evidence state, finding, owner and action. Numeric sample counts are illustrative UI content, not customer or defect-rate proof. They must not imply that an unfinished provider or autonomous action is operating in production.

## Public form states

| State                     | Required behaviour                                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Initial                   | Minimal business fields; no document or free-text tender field; form-start time and empty honeypot prepared locally                   |
| Client validation         | Focused error summary links to fields; each invalid control has `aria-invalid` and an associated message; no network call             |
| Submitting                | Submit disabled, progress text visible and announced, duplicate clicks suppressed                                                     |
| Accepted                  | Opaque request reference and server-provided next step; no response-time or service promise                                           |
| Ambiguous/network failure | Values retained; same idempotency key reused for unchanged retry; clear “could not confirm whether the request was recorded” language |
| Edited retry              | A changed business payload receives a new key; stale-key conflict cannot overwrite a prior request                                    |
| Server rejection          | Safe generic recovery; no database/provider details or submitted values echoed                                                        |

The form never puts personal data in the URL, analytics, browser logs or client-side secrets. A visitor is explicitly told not to submit tender files, credentials, financial schedules or sensitive bid details.

## Language and claim rules

- Expand “bill of quantities (BOQ)” on first use.
- Explain responsiveness as addressing published criteria before using the procurement shorthand.
- Say “named human reviewer,” not “human authority,” in buyer copy.
- Describe organisation-scoped access controls; do not claim proven absolute tenant isolation.
- Describe the no-shared-model-training position as a release policy pending approved provider evidence.
- Avoid award, evaluator, pricing, endorsement, security, service-level, customer-count and statistical guarantees.
- Preserve human responsibility, client-supplied commercial figures and secure post-gate document intake.

## FAQ contract

The visible FAQ answers all required questions: definition, award boundary, live and retrospective reviews, financial pages, later document needs, pricing responsibility, information handling, timing, next step and remediation support. Timing remains scope-dependent with no public turnaround promise.
