# Runtime reliability contract

## Admission and shutdown

The API starts in `starting`, becomes `accepting` only after the production database safety gate and socket bind succeed, and moves irreversibly to `draining` on `SIGTERM` or `SIGINT`. Draining makes `/api/readyz` fail before the HTTP listener stops admitting connections. Idle keep-alive connections close immediately; active HTTP work gets a bounded drain window, then remaining connections are forced closed. The database pool closes after HTTP drain. A pool-close failure or timeout exits non-zero.

Defaults are conservative and every override is range-checked at startup:

| Environment variable                  | Default | Purpose                                          |
| ------------------------------------- | ------: | ------------------------------------------------ |
| `VALO_HTTP_DRAIN_TIMEOUT_MS`          |   15000 | Active HTTP drain before forced connection close |
| `VALO_DB_CLOSE_TIMEOUT_MS`            |    5000 | Pool-close wait before failed shutdown           |
| `VALO_OPERATIONAL_SIGNAL_INTERVAL_MS` |   60000 | Aggregate structured-signal heartbeat            |
| `VALO_DB_POOL_MAX`                    |      10 | Maximum runtime connections                      |
| `VALO_DB_CONNECTION_TIMEOUT_MS`       |    5000 | New-connection wait                              |
| `VALO_DB_POOL_IDLE_TIMEOUT_MS`        |   30000 | Idle pooled-connection lifetime                  |
| `VALO_DB_POOL_MAX_LIFETIME_SECONDS`   |    1800 | Connection rotation ceiling                      |
| `VALO_DB_LOCK_TIMEOUT_MS`             |    5000 | PostgreSQL lock wait                             |
| `VALO_DB_STATEMENT_TIMEOUT_MS`        |   30000 | Server-side per-statement ceiling                |
| `VALO_DB_QUERY_TIMEOUT_MS`            |   35000 | Client-side per-query ceiling                    |
| `VALO_DB_IDLE_TRANSACTION_TIMEOUT_MS` |  300000 | Abandoned tenant-transaction ceiling             |

The statement limit applies to each SQL statement, not the complete report/export workflow. Existing exports perform storage download and archive generation outside a SQL statement, so those stages do not consume this budget. Deployments with proven legitimate statements above 30 seconds may raise both statement and query limits within their coded maxima, but must first retain a query plan/load-test artefact and must never disable the deadline. A timeout fails the request closed. Connection-string parameters capable of overriding runtime connection/query budgets are rejected; managed URLs may still carry transport settings such as `sslmode`.

Readiness calls wait 1.5 seconds. The underlying pool query can outlive that caller deadline until the configured query timeout, but probes are single-flight: repeated probes share the same pending query and cannot create an unbounded pool queue. Results, including failures, are cached in-process for one second to bound sequential public probes against a fast database; HTTP responses remain `no-store`.

## Privacy-safe operational signals

Every response carries a validated `X-Request-Id`; supplied IDs are accepted only from a bounded log-safe character set and no identity, tenant or content dimension is derived from them. Aggregate signals contain only HTTP status class/duration buckets, active/started counts, pool total/idle/waiting counts, uptime and lifecycle. Structured logs are immediately available. No external metrics backend, dashboard, paging route or delivery receipt is claimed; their status stays `disconnected` until deployment wiring and synthetic evidence exist.

## Commit-before-stream gate

Tenant middleware holds one RLS transaction until the response finishes by default and establishes the project advisory lock before project-scoped handlers. Exact high-risk commands may call `commitTenantDatabaseBeforeResponse` after all locked authority, state, audit and durable-evidence writes have completed and before exposing an irreversible capability, receipt, response header or byte. Package export currently holds that project lock while assembling the complete ZIP in memory, then revalidates report/package/NDA state plus current membership/grant and exact partner-relationship authority inside the locked transaction, repeats the authority check at a fresh database clock immediately before persistence, persists the canonical export evidence, awaits COMMIT, and only then sends the buffer. This project-lock duration is the explicit `AR-010` contention trade-off. Partner-edition activation is re-read but is not serialized by the membership/relationship lock protocol. Report sign-off and governed project-package export use the same commit-before-response primitive for their authoritative success response. Direct DOCX/PDF download routes retain the ordinary response-scoped transaction and are not claimed to satisfy this stronger gate.

This is an exact route capability, not a general middleware bypass. Callers must perform no database work after the commit promise resolves. Ordinary routes and any route without complete ordering evidence retain the response-scoped transaction.

A streaming route may move to commit-before-stream only when one focused change proves all of the following:

1. authentication, permission, tenant/resource boundary and quarantine/export policy checks run inside an explicit tenant transaction;
2. the immutable object/version identity and an `authorized_before_stream` audit event commit successfully before the first response byte;
3. no database proxy call, lazy query or transaction-derived object is used after that commit;
4. commit failure produces a non-2xx response before headers are flushed;
5. stream failure still aborts the response and does not overclaim successful delivery;
6. integration tests prove cross-tenant denial, audit-before-byte ordering, commit-before-byte ordering, client disconnect behavior and pool release during a deliberately slow stream; and
7. any global transaction-middleware exception is an exact, named route allowlist - not a prefix or client-controlled bypass.

Routes that have not met this gate retain the response-scoped transaction. The five-minute idle-transaction ceiling bounds abandoned/slow transactions; object-size and deployment-duration limits must keep authorised downloads inside that window. The runtime route-policy catalogue and focused database integration tests are the evidence boundary for adding or changing an exception.
