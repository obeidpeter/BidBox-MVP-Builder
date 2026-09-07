# ADR-0002: Organisation tenancy with PostgreSQL RLS

Status: Accepted target; migration evidence pending
Date: 2026-08-08

## Context

The observed model uses clients/projects and broad member roles. BidBox requires client, partner and BidBox organisations, delegated scopes, time-limited access and defence in depth across all data surfaces.

## Decision

Add immutable `tenant_id` to every tenant-owned row; introduce organisations, memberships, scoped role grants, partner relationships and break-glass grants. Resolve tenant/actor only from authenticated server state. Enable and force PostgreSQL RLS with an application role that neither owns tables nor has `BYPASSRLS`. Apply the same tenant identifier to storage, search, caches, jobs and AI retrieval. Operations use redacted projections, not bypass queries.

## Consequences

Every query/job/migration needs tenant context and negative tests. Cross-tenant foreign keys are prohibited. Backfill and rollout use expand/backfill/validate/constrain; no destructive migration without restore/rollback proof. RLS is a backstop, not a replacement for permission policy.

## Rejected

Application filters alone; one database/schema per client through v2.5; global admin bypass; client-supplied tenant IDs.
