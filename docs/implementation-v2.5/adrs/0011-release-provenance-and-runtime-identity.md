# ADR-0011: Release provenance and runtime identity

Status: Accepted; candidate and verification tooling implemented; live protection, approvals and provider evidence remain external
Date: 2026-08-31
Last reviewed: 2026-09-07
Next review: 2026-11-30
Owner: Release engineering (`@obeidpeter`)
Backup owner: Unassigned; tracked as `AR-001`
Reviewers: Release, security/privacy and operations role holders for production; named alternates are not yet recorded
Drivers: `AD-003`, `AD-007`, `AD-010`
Evidence: `.github/workflows/release-candidate.yml`; `.github/workflows/deployment-verification.yml`; `scripts/release-provenance.mjs`; `artifacts/api-server/src/routes/health.ts`; `docs/implementation-v2.5/RELEASE_PROVENANCE.md`; `.github/branch-policy.json`
Supersedes: Release claims based only on branch name, a successful build or a manual HTTP 200
Superseded by: None

## Context

BidBox needs to bind an reviewed merged source object, built outputs, SBOM, deployment target and observable runtime identity without claiming evidence the hosting platform cannot supply. Replit currently rebuilds from a source snapshot rather than promoting the GitHub-built artifact bytes.

## Decision

1. A release candidate starts only from an exact full commit already reachable from protected `main`. The workflow verifies exact HEAD, tracked cleanliness and ancestry before executing checked-out tooling.
2. The candidate builds the API and Workbench, generates a CycloneDX SBOM, inventories artifact files with SHA-256, and emits an immutable manifest whose `releaseSha256` binds source plus aggregate artifact identities. It reverifies the manifest before publishing one source-named GitHub artifact.
3. Deployment injects that candidate digest as environment-scoped `VALO_RELEASE_SHA256`; it is not stored in tracked deployment configuration. Health and readiness publish it only when it is a valid lowercase SHA-256 digest. The API build independently stamps clean committed Git source into `X-BidBox-Source-Commit`; runtime variables cannot override it. Provider publication commits can resolve to their main ancestor only with identical Git trees.
4. Protected deployment verification accepts the candidate run ID, full source SHA, immutable provider deployment ID and environment. It attests the exact successful candidate workflow run, downloads only its source-named artifact, recomputes the candidate/SBOM digests, probes exact liveness and readiness URLs without redirects with the target Origin and matching credentialed CORS, and requires both the runtime-declared release identity and compiled source commit to match the candidate. Reusing an old environment digest with different source fails verification. A separate unauthenticated bounded Clerk environment probe rejects broken sign-in bootstrap; it records only status/timing and never forwards edge authorization.
5. The resulting record states `runtimeIdentityEvidence: environment_declared`, `runtimeSourceEvidence: build_time_git_verified`, and `liveArtifactDigestVerified: false` for Replit unless a provider-supplied measured runtime digest is independently verified. The exact Replit source snapshot and build/deployment evidence must be retained separately.
6. Candidate evidence and deployment verification are evidence, not deployment authority. Live branch/environment protection, reviewer approval, migration, backup, smoke, observation and rollback records remain required operational controls.
7. Missing usability evidence blocks a candidate by default. An explicitly authorised manual dispatch may accept only the valid `missing` evidence state through a default-off per-run waiver and reason. An immutable source/run/actor-bound decision artifact is included in the release digest. Research evidence remains missing; completed failed studies, malformed records and other release controls remain fail closed.

## Consequences

Source, candidate, workflow run and deployment are cryptographically cross-bound, while the remaining Replit limitation is explicit. Evidence expires from GitHub after its retention window and must be copied to the approved immutable store. A source rebuild cannot be described as build-once promotion without new measured evidence.

## Rejected

Mutable tags or short SHAs; unpinned third-party workflow actions; caller-supplied deployment URLs; redirects during verification; committing live deployment records or credentials; describing an environment header as a measured digest of running bytes.
