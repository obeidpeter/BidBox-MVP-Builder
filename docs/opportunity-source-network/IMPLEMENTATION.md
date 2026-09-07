# Official Opportunity Source Network

BidBox now has a tenant-scoped, named-human pilot register for official opportunity source metadata. It records provenance for review; it does not scrape, execute, qualify, or activate a pursuit automatically.

## Delivered boundary

- Operators can record one official HTTPS URL with bounded metadata, a publication/licence note, and an observed timestamp.
- Recorded source text remains untrusted and is never executed as an instruction.
- A named human must accept or reject each receipt with a reason and optimistic-concurrency check.
- Accepted receipts can enter the existing tender register only through the bounded server workflow.
- The audit-backed pilot retains at most 250 lifetime source receipts per organisation, including accepted and rejected receipts. The UI stops new intake at the reported repository limit.

## Deliberately unavailable

- scraping or automated acquisition;
- source-provider adapters or inbox polling;
- automatic deadline confirmation, qualification, or pursuit creation;
- production-scale archive or retention lifecycle;
- deletion of tenant audit events to recover capacity.

The pilot has no in-app archive. Operators must stop intake before capacity and use a reviewed storage and retention migration before production-scale operation.
