# Measurement and lead-routing contract

Status: privacy and operations contract for the Bid Autopsy public journey. It distinguishes implemented lead delivery from deferred public analytics.

## Authorised destination

The first-contact destination is the PostgreSQL `valo_intake.bid_autopsy_requests` queue. It is isolated from organisation-scoped tender tables because a public requester has no tenant or authenticated identity. The route stores only the bounded form fields and operational delivery metadata. It does not accept documents, tender contents, pricing, credentials, filenames, free-text service context, UTMs or analytics payloads.

The queue is a lead destination, not a tenant workspace or engagement record. A named authorised operator must complete the later privacy, NDA, scope and secure-sharing gate before sensitive material enters BidBox.

Production intake has no inferred retention default. The route fails closed until an approved `VALO_PUBLIC_LEAD_RETENTION_DAYS` value is supplied, each accepted row receives an explicit `retention_until`, and the owner-side lead and expired-rate-bucket purge functions remain unavailable to the application runtime. Activation therefore also requires a named operator and approved purge/reconciliation schedule for both lifecycle classes.

## Public request contract

`POST /api/public/bid-autopsy-requests` accepts same-origin JSON with:

- contact name;
- company name;
- business email;
- business telephone number;
- tender category from the closed public/federal, oil-and-gas, donor-funded or other set;
- live, draft or previously submitted bid stage;
- optional tender deadline date;
- email or telephone contact preference;
- current privacy-notice acknowledgement;
- client-recorded form-start timestamp;
- an empty, visually hidden website field used only as a bot signal.

The browser sends a random UUID in `Idempotency-Key` and retains it for retries. The server hashes the key, fingerprints the normalised payload and creates one queue record. An exact replay returns the original accepted request; a reused key with a different payload fails closed. The raw idempotency key is not retained.

## Security and privacy controls

- Server-side closed schema and length/format bounds.
- Same-origin request validation and JSON content-type enforcement.
- Autoscale-safe, database-backed bounded rate limiting keyed by an HMAC of the canonical client address; raw addresses and the server-only HMAC secret never enter PostgreSQL.
- Honeypot and minimum-completion-time bot checks without third-party tracking.
- Normalisation that rejects control characters and header-injection input.
- Safe generic public errors.
- No request body, email, phone or contact name in ordinary logs.
- No query-string submission or client secret.
- Database-only routing with explicit least-privilege role grants.
- No pre-NDA document upload.

Every replica consumes the same fixed-window database bucket. Production fails closed unless Replit's trusted-proxy boundary is enabled and a server-only `PUBLIC_LEAD_RATE_LIMIT_HMAC_SECRET` of at least 32 bytes is configured. Limiter failures deny intake rather than falling back to a per-process counter.

## Delivery monitoring

An accepted response means the record committed to the authorised database queue; it does not promise that a human has contacted the requester. Queue records carry `destination`, `delivery_status` and `received_at` for authorised operational reconciliation. Monitoring must use aggregate status/age and request IDs rather than copying PII into alerts or logs.

Production smoke must prove:

1. one synthetic valid request creates one queue row;
2. an exact retry returns the same request ID and creates no second row;
3. changed content under the same key is rejected;
4. disallowed origin, content type, bot signals and rate excess fail without storage;
5. logs and monitoring contain no submitted PII;
6. the authorised operator can reconcile the accepted request by opaque request ID.
7. the approved retention value is applied to the row and the owner-only expiry process removes a synthetic expired lead and expired HMAC limiter bucket without granting table access to the application runtime.

Do not submit a real person's details during automated or preview testing.

## Public event taxonomy

The approved future taxonomy is intentionally content-free:

| Event                     | Allowed properties           |
| ------------------------- | ---------------------------- |
| `landing_view`            | route, viewport class        |
| `primary_cta_click`       | placement                    |
| `secondary_link_click`    | placement, destination class |
| `form_start`              | route                        |
| `form_validation_failure` | non-PII error-code set       |
| `submission_attempt`      | retry boolean                |
| `submission_success`      | replay boolean               |
| `submission_failure`      | safe error code              |
| `sign_in_click`           | placement                    |

Names, emails, telephone numbers, company names, dates, tender categories/stages, free text, filenames, documents and request IDs are prohibited analytics properties. Referral and campaign values require a separate purpose, consent, allowlist and retention decision before collection.

## Analytics activation gate

No analytics transport is active in this release. Activation requires all of:

1. an approved provider and data-processing contract;
2. a documented purpose, lawful basis, consent requirement and retention period;
3. Nigerian data-protection and cross-border review;
4. a strict property allowlist matching the taxonomy above;
5. deferred loading and CSP approval;
6. navigation/retry deduplication tests;
7. network inspection proving no form content or identifier leakage;
8. an owner for deletion, access and incident response.

Until those gates pass, conversion measurement is limited to privacy-minimised aggregate server operations on accepted queue records. This is not presented as client-side analytics.
