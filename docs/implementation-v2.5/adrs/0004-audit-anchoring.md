# ADR-0004: Externally anchored audit checkpoints

Status: Accepted target; provider selection and deployment evidence pending
Date: 2026-08-08
Last reviewed: 2026-08-31
Next review: 2026-11-30
Owner: Security and compliance architecture (`@obeidpeter`)
Backup owner: Unassigned; tracked as `AR-001`
Reviewers: Security/privacy, legal/compliance and operations role holders before provider activation; named alternates are not yet recorded
Drivers: `AD-003`, `AD-009`, `AD-010`
Evidence: `config/operations/schedules.v1.json`; `config/observability/alerts.v2.5.json`; `docs/implementation-v2.5/SECURITY_PRIVACY.md`; `docs/implementation-v2.5/runbooks/BACKUP.md`; `docs/implementation-v2.5/runbooks/RESTORE.md`
Supersedes: Local hash-chain-only target
Superseded by: None

## Context

The repository has a useful hash chain, but an attacker with database/application control could rewrite records and recompute the chain.

## Decision

Keep append-only sequenced event hashes, then periodically compute/sign a checkpoint root and write it to an independent immutable/WORM destination with retention lock or equivalent witness. Store anchor receipt, provider/object version and reconciliation state. Alert on sequence/hash/anchor freshness/divergence. Restore validates against the external anchor.

## Consequences

Tampering becomes independently detectable; an anchor provider/retention/cost/region decision and key-custody runbook are needed. Event payloads remain minimised; anchors contain digests, not client content.

## Rejected

Local hash chain alone; mutable backup bucket; public blockchain by default (privacy/cost/complexity without need).
