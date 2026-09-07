# Deployment runbook

No production deployment is authorised by this document. Replace bracketed provider commands with approved, non-interactive platform procedures and record outputs in `DEPLOYMENT_RECORD.md`.

For the Valo-to-BidBox domain and authentication transition, follow
[`BIDBOX_RENAME_CUTOVER.md`](BIDBOX_RENAME_CUTOVER.md), including its source-drift
and release-evidence checks before publication.

## Preconditions

- Named release owner, security/privacy approver, operations owner, target environment/domain and change window.
- Signed immutable artefact, version/commit, SBOM and provenance; repository visibility/branch protections verified.
- CI green: migrations, critical tests/coverage, security/dependency/secret/IaC, AI/injection, render and contract gates.
- Staging E2E, cross-tenant, accessibility, performance/resilience, restore and rollback evidence accepted.
- Provider agreements/regions/secrets/health approved; no development adapter can start.
- Baseline authentication adapter approved with `CLERK_SECRET_KEY` and
  `CLERK_PUBLISHABLE_KEY` references and
  `CLERK_ADAPTER_PRODUCTION_APPROVED=true` supplied only in the target; retain
  named approval evidence rather than inferring approval from configured keys.
- Both authenticated per-operation and per-actor limiter windows/maxima are
  reviewed and recorded using the four `AUTHENTICATED_*` policy variables in
  `../RELEASE_PROVENANCE.md`.
- Public-intake purge remains disabled until `NODE_ENV=production`,
  `VALO_MAINTENANCE_EXECUTE=confirmed`, `VALO_MAINTENANCE_DATABASE_URL` and
  `VALO_MAINTENANCE_DATABASE_ROLE` are installed with non-superuser,
  non-`BYPASSRLS`, table non-ownership and bounded function-execution proof.
- Authenticated-limiter purge remains disabled until
  `VALO_AUTH_RATE_LIMIT_MAINTENANCE_EXECUTE=confirmed`,
  `VALO_MAINTENANCE_DATABASE_URL` and
  `VALO_MAINTENANCE_DATABASE_OWNER_ROLE` are installed with function/table
  ownership, global FORCE-RLS authority and runtime-denial proof. Retain the
  scheduled workload owner and run evidence in `../OPERATIONAL_SCHEDULES.md`.
- Current signed Nigeria rule packs and intended feature/entitlement exposure reviewed.
- Encrypted backup and restore verification within approved RPO; rollback artefact/config available.
- No unresolved P0/P1 or high/critical security finding; incident/on-call contacts active.

## Build once

1. Resolve locked dependencies in trusted CI at an exact full commit reachable
   from protected `main`; follow `../RELEASE_PROVENANCE.md`.
2. Format/lint/typecheck/test/build all packages.
3. Generate/compare OpenAPI clients; validate migrations from supported baseline.
4. Produce application/worker/web artefacts, checksums, CycloneDX SBOM and the
   machine-verifiable release manifest. Preserve the candidate workflow run and
   artifact IDs.
5. Scan final artefacts; store in immutable registry. Do not rebuild per environment.

## Stage

1. Confirm separate staging identity, database, storage, keys and providers.
2. Capture pre-deploy versions, configuration digests, flag/rule-pack versions and backup status.
3. Apply backward-compatible expand migrations with the controlled migration identity.
4. Run migration reconciliation and RLS policy inspection using non-owner app role.
5. Inject the exact candidate `VALO_RELEASE_SHA256` through the target's
   deployment-secret mechanism (never tracked `.replit` or artifact
   configuration), deploy API/workers/web with flags off, then use the
   deployment-verification workflow to bind liveness, readiness and runtime
   identity to the candidate. Both probes must also return the build-stamped
   `X-BidBox-Source-Commit` matching that candidate. Build the clean merged
   checkout with Git metadata; do not reuse an old digest for a new snapshot.
6. Run smoke: sign-in/MFA, tenant denial, create engagement, safe test upload/quarantine/job progress, requirement review, evidence/fatal gate, BOQ fixture, package render/sign/export, audit anchor and notification simulator.
7. Run staging E2E/a11y/performance security subset; verify logs contain no content/secrets.
8. Approve promotion using the same artefacts.

## Replit database lineage and legacy bridge gate

The existing Replit development database was managed with `drizzle-kit push`
and has no `drizzle.__drizzle_migrations` journal. It is a populated 19-table
legacy database, not an empty target. Do not apply the v2.5 `0000` bootstrap or
use `push --force` against it. Its only supported in-place upgrade is the
reviewed, fail-closed bridge in
`scripts/migrations/replit-legacy-v1-to-v2.5.sql`, invoked through the database
package runner.

Exactly two complete ordered column fingerprints are supported: the canonical
legacy shape at that source commit and the locked Replit production
push-managed shape. The latter has reviewed order-only drift in `audit_events`,
`boq_checks`, `capability_items`, `clients`, `projects`, `requirements`, and
`vault_items`; it lacks only `documents.{extraction_method,
extraction_confidence,extraction_notes}`, `llm_runs.{prompt_tokens,
completion_tokens}`, and `reports.taxonomy_version`. All six canonical target
fields are nullable. The bridge copies every actual source column by its pinned
name and order and initializes only those six absent fields to `NULL`. Any
other missing, extra, or reordered column aborts; no compatible intersection is
inferred.

The Replit production database originated as the same populated 19-table legacy
lineage and has completed the reviewed bridge, adopting the exact
`0000`-`0002` journal. Do not replay the bridge or baseline, run
`drizzle-kit push`, or accept a publish schema diff. The only automated
production DDL path is the source-controlled `migration:replit:intake` launcher:
it is restricted to Replit production, pins all fourteen migration files, and
accepts only exact `0000`-`0002`, `0000`-`0005`, `0000`-`0006`,
`0000`-`0007`, `0000`-`0008`, `0000`-`0009`, `0000`-`0010`,
`0000`-`0011`, `0000`-`0012`, or
`0000`-`0013` journal prefixes. The three-row baseline requires the intake
schema to be absent and applies `0003`-`0013`; the six- through thirteen-row
upgrade states apply only their respective missing suffix (`0006`-`0013`
through `0013`); and the fourteen-row state is current.
Every upgrade state requires the intake schema to be present.
The
launcher validates separate same-target owner/runtime URLs, holds a fixed
advisory lock across migration, and verifies the exact fourteen-row journal and
intake object catalog before allowing API startup. The effective API
artifact and legacy `.replit` run path both invoke
`scripts/start-replit-production.mjs`; this same-process wrapper awaits that
launcher before dynamically importing the compiled API, so a migration failure
cannot open the service port. Source synchronisation
and `postMerge` still never authorise or run database promotion. Supply a
direct, session-affine owner endpoint, not a transaction-pooling URL: the
launcher keeps its settings, advisory lock and migration on one PostgreSQL
backend session.

### Required evidence and quiescence

1. Fix the exact source commit and recovery point. Create an approved
   custom-format `pg_dump`,
   produce a byte-preserving ordered export of `audit_events`, and capture row
   counts for exactly the 19 legacy tables plus the final audit sequence/hash.
   Store the backup, audit export, and approved rehearsal evidence manifest as
   private artifacts; the runner computes their hashes rather than trusting
   caller-supplied digest values.
2. Restore the backup into a new isolated database. Verify its checksum/custody,
   schema fingerprint, all frozen counts, audit head, foreign-key/orphan state,
   and application-level smoke. A provider's "backup complete" response without
   a successful restore is not evidence.
3. Before either rehearsal or source execution, stop the legacy API and every
   scheduler, workflow, job, operator session, and integration that can write
   PostgreSQL. Record who established the write freeze, when it began, and how
   the absence of writers was verified. If any source write occurs after the
   inventory or export, abort and regenerate the evidence.
4. Keep the verified backup and restore available through the change window.
   Record the restore reference and evidence hashes in `DEPLOYMENT_RECORD.md`;
   never record a connection string, password, secret value, or raw secret
   payload.

### Static check and runner inputs

Run the credential-free artifact check at the exact release SHA:

```sh
pnpm --filter @workspace/db migration:bridge:legacy:check
```

This check proves that the bridge contains the expected embedded migration
shape and audit boundary controls. It does not connect to PostgreSQL and is not
a data dry run. The isolated restore rehearsal is the required operational dry
run.

### Authoritative evidence capture

Do not assemble the v3 manifest with shell pipelines. While every source writer
remains stopped, restore the already-created custom dump into an isolated
PostgreSQL 16 endpoint using `pg_restore --exit-on-error --no-owner
--no-privileges`. The source and restored URLs must name the same database but
must use different endpoints. Record the successful restore operation in the
private deployment record, then run the repository verifier while the freeze is
still in force.

Create a private `0700` evidence directory outside the checkout and inject all
inputs through the approved ephemeral secret mechanism:

- `VALO_BRIDGE_EVIDENCE_SOURCE_DATABASE_URL`: quiescent legacy source owner.
- `VALO_BRIDGE_EVIDENCE_RESTORED_DATABASE_URL`: isolated restored-copy owner.
- `VALO_BRIDGE_SOURCE_BACKUP_PATH`: the pre-existing custom dump, outside the
  checkout and `0600` on Linux.
- `VALO_BRIDGE_PG_RESTORE_PATH`: absolute path to the PostgreSQL 16
  `pg_restore` binary used to verify the archive list.
- `VALO_BRIDGE_EVIDENCE_OUTPUT_DIRECTORY`: the empty private evidence
  directory.
- `VALO_BRIDGE_EVIDENCE_QUIESCED_ACK`: exactly
  `APPLICATION_WRITERS_STOPPED_AND_RESTORE_ISOLATED`.
- `VALO_BRIDGE_EVIDENCE_RESTORE_ACK`: exactly
  `BOUND_CUSTOM_DUMP_PG_RESTORE_EXIT_STATUS_0`, injected only by the operator
  or approved restore automation that observed exit status zero for the exact
  dump named by `VALO_BRIDGE_SOURCE_BACKUP_PATH` and the isolated endpoint.

Run:

```sh
pnpm --filter @workspace/db migration:bridge:legacy:evidence:capture
```

The command is inert without its embedded explicit capture flag and both exact
operational acknowledgements. The restore acknowledgement is what authorises
the manifest's `scratchRestoreExitStatus: 0` claim; archive-list validation and
the byte/digest comparison independently fail closed around that claim. The
command refuses symlinked/in-repository evidence paths, requires the output
directory to contain zero entries both before validation and immediately before
publication, and refuses every unrecognized or duplicate table descriptor in
the custom archive inventory. It binds the dump header/list/hash by comparing
the file identity and a complete SHA-256 before and after list validation, then takes
`ACCESS EXCLUSIVE NOWAIT` locks on exactly the 19 legacy tables in both
databases before reading any database evidence. It compares the PostgreSQL-16
catalog digest, the exact legacy-lineage ID and ordered-column fingerprint, all
19 deterministic row counts/table digests, ordered audit
bytes, audit classification/head, and sequence state. Both transactions are
rolled back and connections closed before files are written; no database row or
schema is changed.

Success writes only `valo-legacy-audit.ndjson`,
`valo-legacy-restore-manifest.json`, and
`valo-legacy-restore-manifest.json.sha256`, all `0600`, outside the repository.
The manifest is parsed again through the bridge's exact v3/SOURCE_COMMIT
contract before publication. The command prints no connection string, row,
identity, audit value, evidence hash, or filesystem path. Independently record
the sidecar value in the approved private operations store, and keep the source
frozen until capture finishes. Any failure invalidates the attempted evidence;
do not treat partially created files as approved.

The older
`pnpm --filter @workspace/db migration:bridge:legacy:catalog-evidence` command
remains a non-PII diagnostic for an isolated database. It is not a substitute
for the authoritative capture command and must not be used to hand-assemble a
production manifest.

Inject these runner inputs from Replit Secrets or another approved ephemeral
secret mechanism; refer to secret-manager entries rather than copying values
into commands, source, tickets, screenshots, or logs:

- `DATABASE_URL`: the migration-owner connection used for the one-time DDL.
- `VALO_RUNTIME_DATABASE_URL`: a different credential for the fixed
  `valo_app_runtime` login, with a random password of at least 32 characters,
  made by replacing only the owner URL userinfo. Protocol, host, port, database,
  and all TLS/query options must remain identical.
- `VALO_BRIDGE_APPLICATION_QUIESCED_ACK`: the exact reviewed acknowledgement,
  injected only after every application/job/operator writer is stopped.
- `VALO_BRIDGE_PLATFORM_ADMIN_CLERK_USER_ID`: the approved active legacy
  administrator identity.
- `VALO_BRIDGE_SOURCE_BACKUP_PATH`: a private, runner-readable path to the
  approved source backup.
- `VALO_BRIDGE_SOURCE_AUDIT_EXPORT_PATH`: a private path to the exact ordered
  audit NDJSON export. The runner hashes it and compares its bytes with the
  export regenerated from the connected source.
- `VALO_BRIDGE_REHEARSAL_MANIFEST_PATH`: a private path to the approved
  authoritative v3 rehearsal manifest binding target, backup/export, all 19
  counts and deterministic table digests, the normalized legacy catalog
  fingerprint, the exact ordered-column lineage, and audit evidence.
- `VALO_BRIDGE_EXPECTED_REHEARSAL_MANIFEST_SHA256`: the independently recorded
  SHA-256 of that manifest. Neither it nor any production evidence belongs in
  the repository. On Linux, all three evidence paths must be regular `0600`
  files (no group/world permission bits).

Replit production startup must set `NODE_ENV=production` and receives both the
managed `DATABASE_URL` (target/TLS attestation only) and
`VALO_RUNTIME_DATABASE_URL` (the actual pool). Startup fails closed unless the
latter authenticates as the constrained login with the expected audit/RLS
privileges. Immediately after Pool construction, code deletes both variables
from `process.env`; scheduled mutators run the same attestation before work.
The owner URL was nevertheless exposed briefly to the process. Record that
residual platform limitation, restrict access, and rotate after the operation;
environment erasure does not make an RCE/native-process boundary.

The production attestation is a PostgreSQL-16 contract, not a count-only smoke
test. In a repeatable-read, read-only snapshot it first requires the ambient
runtime path to resolve exactly to `pg_catalog, public`, then deparses under a
transaction-local `search_path=pg_catalog`. It pins all 106 public-table RLS
flags, the exact 94 FORCE-RLS identities, all 113 policy definitions, the
118-edge tenant-parent trigger graph, all 35 special trigger contracts, all 15
`valo_security` routine signatures and bodies, all four public Delivery Studio
guard routines and their exact 15 trigger bindings, and
all seven `valo_intake` routine signatures, bodies and execution boundaries, as
well as the complete effective table/column/sequence privilege matrix. It also
requires `row_security=on`, `session_replication_role=origin`, the fixed runtime
identity, no inherited/owned or schema-creation escape, and runtime EXECUTE only
on the two tenant-context routines, the two Delivery Studio resolution/mutability
helpers, plus the bounded Bid Autopsy store, shared limiter, content-minimised
active-queue read and status-transition functions. The two Delivery Studio
trigger entry points remain owner-only. Direct intake table/column privileges and both owner-side
purge functions remain denied to the web runtime. Any mismatch stops the
listener/job before application queries.

`app.current_organisation_id` is a transaction-local database boundary, not an
authentication credential: anyone holding the raw runtime database credential
can invoke its setter. Keep that credential private, authenticate and authorize
the selected membership in the API before setting it, and treat RLS plus the
tenant-parent/control-plane guards as defense in depth against application SQL
mistakes—not as a replacement for Clerk and permission checks.

### Rehearse and execute

1. On the isolated restore, inject environment-scoped inputs and run the exact
   mutating command:

   ```sh
   pnpm --filter @workspace/db migration:bridge:legacy
   ```

2. Preserve the sanitized runner result and independently reconcile source and
   archive counts, primary keys, tenant assignments, role grants, audit
   boundary, migration journal, the exact 96/85/104 table/RLS/policy catalog,
   116-trigger and nine-routine security contracts, and the runtime privilege
   matrix. Run same-tenant success and cross-tenant denial tests through
   `VALO_RUNTIME_DATABASE_URL`.
3. Obtain explicit approval of the authoritative restore manifest and its
   independently recorded hash. In the source change window, stop all writers,
   then inject the quiescence acknowledgement and run the same command once.
   The runner holds all 19 `NOWAIT` table locks before reading and recomputing
   the manifest-bound counts/digests/audit evidence in one transaction; a
   lock failure or any preflight/reconciliation mismatch is an abort, never a
   reason to weaken an input or retry over a changing source.
   A pre-commit error rolls the transaction back. If the runner emits
   `BRIDGE_COMMIT_OUTCOME_UNKNOWN`, the COMMIT call lost a definitive response:
   keep the app stopped, do not retry, reconnect with the owner credential, and
   prove whether the target is still exact legacy or fully completed v2.5
   before a reviewed forward-repair/PITR decision. Never record this state as a
   rollback. If the runner emits
   `BRIDGE_COMMITTED_POSTCHECK_FAILED`, the database has committed but runtime
   validation failed: keep the app stopped, preserve all evidence, and make a
   reviewed forward-repair versus PITR decision. Never assume rollback or
   blindly rerun.
4. After commit, start v2.5 with both attestation inputs and
   `NODE_ENV=production`; verify the constrained pool, immediate environment
   erasure, catalog, tenant isolation, audit, and synthetic smoke checks. Retain
   the backup until the observation window and rollback decision are closed.

The successful runner prints `ACTIVE_V2_HEAD=<seq>:<hash>`. Record that
non-secret anchor outside PostgreSQL in the approved deployment evidence. Run
the independent verifier with private values injected at runtime:

- `AUDIT_ORGANISATION_ID`: the tenant being verified.
- `AUDIT_EXPECTED_HEAD`: the recorded active v2 `<seq>:<hash>` anchor.
- `AUDIT_EXPECTED_LEGACY_HEAD`: the manifest-bound legacy
  `<seq>:<hash>:<prev-hash>` anchor.
- `AUDIT_EXPECTED_LEGACY_ARCHIVE_SHA256`: the external digest of the exact
  archived source export.

Then run `pnpm --filter @workspace/api-server verify:audit`. For multiple
tenants, use the corresponding plural JSON-map variables
`AUDIT_EXPECTED_HEADS`, `AUDIT_EXPECTED_LEGACY_HEADS`, and
`AUDIT_EXPECTED_LEGACY_ARCHIVE_SHA256S`. A matching acknowledged legacy
discontinuity exits successfully but is always reported separately as
`KNOWN DISCONTINUITY (preserved)`; it is never labelled intact.

The legacy audit evidence has a recorded known historical discontinuity. The
bridge preserves the original bytes in immutable `legacy_audit_events`, records
an explicit `known_discontinuity` assessment, and begins the active
hash-version-2 chain with a boundary event linked to the archived evidence and
approved hashes. Exact affected ranges, counts, cause hypotheses, and source
evidence remain in the private rehearsal manifest and database assessment; do
not copy them into the repository or deployment log. Do not rewrite those rows
or describe the legacy range as repaired or continuously verified, and retain
the source backup and audit export as private evidence.

## Production promotion

1. Announce window and freeze conflicting changes/jobs as designed; do not interrupt deadline-critical work without owner plan.
2. Verify latest backup, replica/queue health, anchor freshness, provider health and rollback artefacts.
3. Record current deployment/config/schema/flags/rule packs and the exact
   candidate workflow, manifest, SBOM, artifact and source digests.
4. For an unbridged legacy target, execute only the approved legacy bridge
   procedure above. For the current already-bridged Replit target, require one
   exact approved journal prefix through `0013`, verify both checked-in production run
   paths name `scripts/start-replit-production.mjs`, and let its bounded
   `migration:replit:intake` implementation apply the missing suffix from
   `0003`-`0013`. Never
   substitute the unrestricted migration command or a publish schema diff.
   Halt on any journal, source-hash, catalog, reconciliation, or RLS error.
5. Deploy workers/API/web in compatible order; keep new commercial flags off.
6. Record the immutable provider deployment ID and run the protected
   deployment-verification workflow. Halt if the deployed release header,
   liveness, lifecycle or database readiness differs from the candidate.
   Observe error/latency, DB connections/locks, queue depth, provider failures,
   tenant denials and anchor status.
7. Execute non-destructive production smoke with dedicated test tenant and marked synthetic files.
8. Enable only approved tenant flags gradually; verify server and UI exposure.
9. Complete deployment record, links/hashes, actual times, deviations and approvers.

## Abort/rollback triggers

Cross-tenant exposure, fatal/readiness bypass, data corruption, migration reconciliation failure, secret/content leakage, sustained error/SLO breach, audit anchor failure with sensitive mutations, provider side effects without reconciliation, or inaccessible deadline-critical workflows. Follow `ROLLBACK.md`; start `INCIDENT_RESPONSE.md` for security/data impact.

## Post-deploy observation

Minimum enhanced observation is one complete document-processing/package cycle and the approved time window. Reconcile jobs/webhooks/notifications, check backup/anchor completion, review security/audit denials and close temporary grants. Commercial flags remain off until separate activation approval.
