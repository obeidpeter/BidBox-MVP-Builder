# Evaluation and annotation plan

## Corpus contract

Production promotion requires at least 25 authorised holdout cases and coverage
of native digital, poor scan, long document, table-heavy, multiple-lot,
BPP-style, NipeX/NCDMB, donor-funded, addendum and difficult-negative cohorts.
Each manifest entry records a pseudonymous source reference/hash, source
category, authorisation basis, split, cohorts, synthetic flag, production
eligibility, annotators, independent reviewer, adjudication/agreement method,
and confirms the manifest contains no raw sensitive data.

Current `gate0-inline-synthetic-v1` fixtures are development-only. They do not
meet this contract and are deliberately rejected by the production validator.

The current source corpus contains 14 inline synthetic/unverified scenarios.
Structural doctrine, injection and metric self-checks exercise the harness but
are not live provider results, are not independently adjudicated and do not
contain representative customer documents. No production metric can be claimed
from them.

## Annotation rules

- One discrete, checkable obligation per label.
- Record exact document version and page/paragraph/table/span coordinates.
- Label mandatory status and fatal/likely-fatal severity independently.
- Mark ambiguous, inaccessible and conflicting evidence; do not guess.
- Citation correctness requires both correct source version and exact locator.
- Unsupported claims require independent evidence adjudication.
- Negative cases specify expected abstention or safe failure.
- Two reviewers adjudicate material disagreements; retain agreement method,
  exclusions, limitations and corrections.
- Holdout organisations/document families cannot be used for prompt tuning.

## Production metrics

- Overall and mandatory recall: at least 95%.
- Citation correctness: at least 98%, with 100% citation evaluation coverage.
- Fatal misses: zero; at least one seeded fatal case is required.
- Precision: at least 95% as the fail-closed BidBox default pending owner approval.
- Unsupported-claim rate: zero with full support-label coverage.
- Correct abstention and safe failure: 100% on labelled negative cases.

Report sample size, cohort slices, confidence/limitations, every failing case,
latency, tokens and cost. A matcher self-check or unverified model locator is not
a production metric.

## Release evidence binding

The live evaluation must retain one unique result for every manifest case and
must allow aggregate metrics to be recomputed from those per-case results. It is
bound to real pinned model, prompt, schema-set, retrieval and index versions.
The runtime rejects missing/placeholder versions and any mismatch with the
deployed candidate. It separately requires complete provider, privacy, budget
and rollout decisions.

## Additional suites required

- page-level OCR transcription truthfulness and omission/fabrication labels;
- exact document-version/page/span citation and claim-support adjudication;
- prompt-injection behaviour on real PDF/OCR/table/image/metadata channels;
- two-tenant isolation across every deployed data plane;
- malformed/schema/usage/provider outage/cancellation/budget cases;
- unauthorised action, review bypass, replay and concurrency cases;
- cohort latency, token, cost and reviewer correction analyses.
