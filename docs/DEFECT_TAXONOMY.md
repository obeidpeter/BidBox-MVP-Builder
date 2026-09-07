# BidBox Defect Taxonomy — `ng-defects-v1.0.0`

The versioned defect taxonomy registry required by FR-ANL-01. Every defect in
the system must map to a type and severity below — the API rejects anything
else (`sanitizeLlm.ts` drops out-of-taxonomy AI suggestions outright; the
defect routes validate manual entries against the same enums). Reports are
stamped with the taxonomy version in service (`reports.taxonomy_version`,
DOCX document-control block), so a signed deliverable is always traceable to
the exact classification scheme it used.

## Types

| Type                | Meaning                                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------------------- |
| `omission`          | A required document, form, or datum is absent from the bid.                                          |
| `expiry`            | A certificate/artefact is expired or will expire before validity requirements are met.               |
| `arithmetic`        | BOQ or pricing arithmetic is internally inconsistent (quantity × rate, sums, words-vs-figures).      |
| `formatting`        | Presentation breaches the tender's format instructions (pagination, labelling, binding, signatures). |
| `responsiveness`    | The bid fails to answer what the tender actually asked.                                              |
| `eligibility`       | The bidder does not meet a stated eligibility criterion.                                             |
| `unsupported_claim` | A claim in the bid lacks verifiable evidence.                                                        |
| `validity`          | Bid validity period, bid security validity, or similar durational defect.                            |

## Severities

| Severity       | Meaning                                            | Effect                                             |
| -------------- | -------------------------------------------------- | -------------------------------------------------- |
| `fatal`        | Certain disqualification if submitted as-is.       | Blocks sign-off (I3); weight 40 in the risk score. |
| `likely_fatal` | Disqualification probable at evaluator discretion. | Blocks sign-off (I3); weight 25.                   |
| `scoring_risk` | Survives compliance but loses evaluation points.   | Weight 10.                                         |
| `cosmetic`     | No scoring effect; professional-polish item.       | Weight 3.                                          |

## Governed change process

1. Propose the change (add/remove/redefine a type or severity) in a PR that
   edits this file **and** bumps `TAXONOMY_VERSION` in
   `artifacts/api-server/src/lib/provenance.ts` (semver: additive = minor,
   redefinition/removal = major).
2. The PR description must state the rationale and which engagements observed
   the pattern that motivates it (the taxonomy grows from delivered work,
   never speculation — roadmap §9).
3. Update the enum sets in `sanitizeLlm.ts`, the defect routes' validation,
   and — for severity changes — `SEVERITY_WEIGHTS` in `deterministic.ts`,
   in the same PR. CI's tests hold them consistent.
4. Historic reports keep their stamped version; scores are never recomputed
   retroactively.

## Version history

| Version             | Date    | Change                                                                                   |
| ------------------- | ------- | ---------------------------------------------------------------------------------------- |
| `ng-defects-v1.0.0` | 2026-07 | Initial registry: 8 types, 4 severities, seeded from the Gate 0 build and BP Appendix A. |
