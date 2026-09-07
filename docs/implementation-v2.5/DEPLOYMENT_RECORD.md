# Deployment evidence template and historical dossier record

Status: repository-safe template; not the current live-release ledger.

Last reconciled: 2026-08-31. The current topology is documented in [`../architecture/DEPLOYMENT.md`](../architecture/DEPLOYMENT.md). Exact deployment identity, approvals, smoke results and operational observations belong to immutable release evidence and must be matched to the running `/api/healthz` and `/api/readyz` identity; they are never inferred from this file.

## Current repository deployment contract

| Field                    | Source-controlled fact                                                                                                                                |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deployment target        | Replit autoscale application declared in `.replit`                                                                                                    |
| Production domain        | `https://valo-mvp-builder.replit.app` is the configured allowed origin and deployment URL                                                             |
| Runtime shape            | One Node production process serves `/api` and the built Workbench; PostgreSQL and object storage are external dependencies                            |
| Build/promotion boundary | Replit rebuilds the authorised source snapshot; source/SBOM/provenance controls exist, but this file does not claim independent live byte attestation |
| Database migration       | Source-controlled migrations and production startup safety checks exist; completion for a release requires retained runtime evidence                  |
| Worker activation        | Durable job/outbox foundations exist; the external worker-control plane remains unmounted until its activation gates are evidenced                    |
| Live release and smoke   | External evidence only; query the deployment and match its reported release identity to the authorised workflow                                       |

The earlier 2026-08-08 statement that the dossier had not deployed anything remains historically true for that snapshot, but it is not a current platform status. Candidate and verification tooling is documented in `RELEASE_PROVENANCE.md`; generated evidence remains external to the repository.

## Evidence required for a future deployment

| Evidence          | Expected record                                                   | Status                                                |
| ----------------- | ----------------------------------------------------------------- | ----------------------------------------------------- |
| Source/repository | Commit/tag, private visibility/permissions, branch protection     | Tooling present; live evidence pending                |
| Artefacts         | Immutable API/worker/web hashes, signature, SBOM/provenance       | Candidate workflow present; accepted artefact pending |
| CI                | Run URL/ID for required gates, no skipped critical tests          | Pending                                               |
| Migration         | Version, backup ID, dry run/reconciliation, approvers             | Pending                                               |
| Configuration     | Redacted digest, environment, flags, rule packs, adapters/regions | Pending                                               |
| Security/privacy  | Scans, RLS negative, DPIA/DPA/transfer/subprocessor approvals     | Pending                                               |
| Staging           | URL/version, E2E/a11y/load/restore/rollback evidence              | Pending                                               |
| Production        | URL/version/time/change ticket/approvers                          | Verification workflow present; live record pending    |
| Smoke             | Synthetic tenant journey and invariant checks                     | Pending                                               |
| Observation       | SLO/queues/providers/anchors/backups and incident state           | Pending                                               |

## Future deployment entry template

```text
Change/release ID:
Candidate workflow/artifact ID and manifest SHA-256:
Commit/tag, release SHA-256, SBOM and artefact digests:
Environment, region and URLs:
Immutable provider deployment ID:
Provider source snapshot/build evidence and any live artifact digest:
Runtime identity evidence (environment-declared; never imply live byte verification):
Started/completed UTC:
Database before/after + migration IDs:
Backup ID/recovery point:
Configuration/flag/rule-pack digests:
Authentication-adapter approval and redacted Clerk reference digest:
Authenticated limiter policy digest:
Maintenance purge role/ownership/runtime-denial evidence IDs:
CI/staging evidence IDs:
Deployment actions:
Smoke evidence:
Monitoring observation:
Rollback status/artefact:
Deviations/incidents:
Release/security/privacy/operations approvers:
```
