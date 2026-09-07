# Release provenance and deployment verification

Status: source tooling implemented; GitHub rulesets, protected environments,
Replit configuration and live evidence still require an authorised operator.
Nothing in this document authorises a deployment.

## Merge controls

`.github/branch-policy.json` is the reviewed desired state for `main` and
`.github/CODEOWNERS` defines the accountable reviewer. CI validates that every
named required check still exists and that the fail-closed policy has not been
weakened. A repository file cannot configure GitHub protection by itself.

An administrator must create a branch ruleset for `main` with:

- pull requests and one approval;
- code-owner review, stale-approval dismissal, approval of the most recent
  push, and resolved conversations;
- strict `CI / verify`, `CodeQL / analyse`, and
  `Dependency review / dependency-review` checks;
- force pushes and branch deletion blocked; and
- administrators included with no standing bypass actor.

After applying it, compare the live settings with `.github/branch-policy.json`
and retain the ruleset URL/export in the private operations record. Configure
protected `staging` and `production` environments separately, allow deployment
from the `main` branch only, and require at least one reviewer. Production must
also prevent self-review.

## Candidate creation

Run the **Release candidate** workflow from protected `main` only, with a full
commit SHA already reachable from `main`. It checks out that exact object,
uses workflow-owned Git commands to prove exact HEAD, tracked cleanliness and
`main` ancestry before executing any checked-out script, builds the API and
Workbench, produces a CycloneDX SBOM, and writes
`release-evidence/release-manifest.json`. The manifest contains:

- the full source commit;
- a sorted SHA-256 inventory for every built artifact file;
- aggregate API and Workbench artifact digests;
- the SBOM digest and format;
- bounded GitHub workflow provenance; and
- `releaseSha256`, the stable digest of the source and aggregate release
  artifacts.

The workflow reverifies all bytes before uploading one 90-day GitHub artifact.
Copy accepted evidence to the approved immutable release store before that
retention window expires. The repository intentionally ignores
`release-evidence/`; never commit a live deployment record or private provider
metadata.

Every third-party action in both release workflows is pinned to the reviewed
40-character upstream commit. A version comment is descriptive only; the tag is
never used for execution. The Anchore step disables its own artifact upload,
release-asset upload and dependency-snapshot side effects. Only the final,
digest-bound BidBox bundle is uploaded. Re-resolve and review every upstream
commit before changing a pin.

For an offline rehearsal after both production builds and SBOM creation:

```sh
node scripts/release-provenance.mjs create \
  --expected-source-commit <full-current-HEAD> \
  --artifact api-server=artifacts/api-server/dist \
  --artifact workbench=artifacts/bidbox-workbench/dist \
  --sbom bidbox-sbom.cdx.json \
  --output release-evidence/release-manifest.json
```

The command refuses a mismatched HEAD, tracked changes, symlinked evidence,
empty artifacts, malformed CycloneDX input, duplicate artifacts, or an existing
output file.

## Bind the runtime

Before publishing, inject the candidate's `releaseSha256` into the target as
`VALO_RELEASE_SHA256` through the approved environment-secret mechanism. It is
not a secret, but environment-scoping prevents one target from claiming
another candidate. Never pin this candidate-specific value in `.replit`, a
checked-in `.replit-artifact/artifact.toml`, or another tracked source file. Do
not paste credentials or the optional probe authorization value into source,
workflow inputs, logs, or deployment records.

The exact health routes publish `X-BidBox-Release-Sha256` only when the configured
value is a lowercase 64-character digest. This is a deployment-controlled,
environment-declared identity; it is not a hash measured from the running
bytes. They also publish `X-BidBox-Source-Commit`, compiled into the API from
clean committed Git source at build time. No runtime environment variable can
set that source stamp. Deployment verification requires both headers to match
the candidate on both probes, so a reused digest cannot make changed source
pass as an older release.

Production and CI builds require Git metadata and a clean working tree, including no
uncommitted new files. Local development builds may proceed without that proof,
but omit the source stamp and cannot pass deployment verification. The build
rechecks committed source after bundling.
The API's selected application inputs and build configuration are also compared
directly with the committed Git blobs, including inputs hidden by ignore rules
or index flags. Workspace packages remain application source; third-party
dependency bytes remain covered by the frozen install and candidate inventory.
Replit publication commits are mapped
to their nearest `origin/main` or `upstream/main` ancestor only when Git proves the entire trees
identical. A changed provider snapshot or missing ancestry is never assigned an
assumed main commit: its actual HEAD must match the candidate, or verification
fails. Publish the exact candidate checkout with its Git metadata when the
provider cannot prove this binding.

Liveness remains dependency-free and readiness still requires the
accepting lifecycle plus the bounded database probe. A missing or malformed
identity does not make the process unhealthy, but it makes deployment
verification fail closed.

Replit currently rebuilds from a source snapshot. The CI artifact inventory is
therefore candidate evidence, not independent proof that Replit ran the same
bytes. The generated verification record explicitly says
`runtimeIdentityEvidence: environment_declared`,
`runtimeSourceEvidence: build_time_git_verified`, and
`liveArtifactDigestVerified: false`. Record the exact Replit source snapshot,
provider build evidence, and immutable deployment ID. Do not claim byte-for-byte
artifact promotion unless the platform supplies and the operator verifies a
runtime artifact digest.

## Verify the deployment

Set the `VALO_DEPLOYMENT_ORIGIN` configuration variable independently on each
protected GitHub environment. It must be the exact HTTPS origin without a path,
query, fragment or credential. A workflow caller cannot override this value,
which prevents the optional edge authorization secret from being sent to a
caller-chosen host.

Run **Deployment verification** with the candidate workflow run ID, full source
commit SHA, immutable provider deployment ID, and protected environment. It
checks out that exact source, proves it remains reachable from `main`, and then:

1. queries the GitHub Actions run in the current repository and requires the
   exact `release-candidate.yml` path and name, protected `main` workflow ref,
   manual-dispatch event, completed status, successful conclusion, canonical
   run URL and the requested source in its display title;
2. downloads only the source-named artifact from that attested run into
   isolated runner-temporary storage, outside both the trusted checkout and the
   separately written run attestation;
3. requires the manifest repository ID/name, workflow path/name/SHA, run
   ID/attempt/URL and source commit to match the run attestation;
4. recomputes every candidate artifact and SBOM digest;
5. checks `/api/healthz` and `/api/readyz` without redirects, sending the target
   origin and requiring an exact credentialed CORS response;
6. requires both responses to declare the candidate release identity and the
   build-time source commit, without treating either as a measured live byte
   digest;
7. requires exact liveness, lifecycle and database readiness contracts;
8. checks the public `/api/__clerk/v1/environment` bootstrap without redirects,
   cookies or authorization, requiring bounded successful JSON containing
   Clerk's authentication and display configuration discriminators;
9. records metrics/paging delivery state without treating a disconnected
   adapter as connected; and
10. writes a content-minimised `valo.deployment-verification` JSON artifact with
    the run-attestation digest and bounded run identity.

The authentication probe follows Clerk's
[Frontend API environment contract](https://clerk.com/docs/reference/frontend-api).
Only its HTTP status and timing are recorded; provider configuration is neither
logged nor persisted. This verifies that sign-in can load its configuration,
not that a particular user can complete authentication. It catches an unmapped
proxy host even when the database and process are healthy.

For a private edge, store the complete HTTP `Authorization` value as the
protected environment secret `VALO_READINESS_AUTHORIZATION`. Leave it absent
when no edge authorization is required. That value is sent only to health and
readiness, never to the Clerk proxy where it could be relayed upstream. The
sign-in bootstrap must be publicly reachable; a private edge that blocks it
fails this probe. If GitHub-hosted runners cannot reach
the private deployment, run the same verifier from an approved private runner;
do not weaken the endpoint, publish a credential, or record an unverifiable
manual `200` claim.

The JSON record is evidence, not deployment authority. Add its workflow/artifact
ID and digest to the private deployment record alongside approvals, migration,
backup, smoke, observation and rollback evidence.

## Target environment checklist

Before starting a release candidate or Replit publication, the release owner
must retain a redacted configuration inventory and approval evidence for the
target. Never hardcode these values in either workflow or source configuration.

- Authentication is a baseline production adapter. Supply approved
  `CLERK_SECRET_KEY` and `CLERK_PUBLISHABLE_KEY` references and set
  `CLERK_ADAPTER_PRODUCTION_APPROVED=true` only after the named security/privacy
  approver accepts the provider, tenant, domain and key custody. Record that
  approval; a configured key pair alone is not production approval.
- Record reviewed bounded values for
  `AUTHENTICATED_RATE_LIMIT_MAX_REQUESTS`,
  `AUTHENTICATED_RATE_LIMIT_WINDOW_SECONDS`,
  `AUTHENTICATED_ACTOR_RATE_LIMIT_MAX_REQUESTS` and
  `AUTHENTICATED_ACTOR_RATE_LIMIT_WINDOW_SECONDS`. These are policy controls,
  not secrets; configuration must still be environment-scoped and included in
  the redacted digest.
- Install public-intake expiry purge only with `NODE_ENV=production`,
  `VALO_MAINTENANCE_EXECUTE=confirmed`, `VALO_MAINTENANCE_DATABASE_URL` and the
  exact `VALO_MAINTENANCE_DATABASE_ROLE`. Retain proof that this dedicated
  login is neither superuser nor `BYPASSRLS`, owns no intake table, and can
  execute only the two approved expiry functions.
- Install authenticated-rate-limit purge separately with
  `VALO_AUTH_RATE_LIMIT_MAINTENANCE_EXECUTE=confirmed`, the maintenance URL and
  exact `VALO_MAINTENANCE_DATABASE_OWNER_ROLE`. Retain proof that the connected
  session owns the bounded purge function and table, has the reviewed global
  FORCE-RLS traversal authority, and that `valo_app_runtime` cannot execute the
  function.
- For both purge jobs, retain the platform schedule/deployment ID, exact source
  SHA, workload identity, first successful bounded run, last-success/full-cycle
  signals, alert receipt and disable procedure described in
  `OPERATIONAL_SCHEDULES.md`. Source entrypoints are not schedule evidence.

## Failure handling

If a provider snapshot was published without a successful matching candidate,
remove its stale `VALO_RELEASE_SHA256` declaration through the target's
environment configuration. Health remains available while release verification
fails closed. Restore the declaration only from a successful candidate for the
source being deployed; never copy the previous deployment's digest. Missing
observed usability evidence remains a release blocker and cannot be replaced
by a successful source build or automated tests.

Do not retry around a changed source, digest mismatch, redirect, malformed or
oversized response, missing identity header, non-200 readiness, database check
failure, or candidate artifact mutation. Preserve the failed run, identify
which source/deployment/environment binding is wrong, and create new evidence
after correction. Never edit a generated manifest or deployment record.
