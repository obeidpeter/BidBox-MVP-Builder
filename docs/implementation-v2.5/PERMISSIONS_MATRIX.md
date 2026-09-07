# Roles and permission matrix

Permissions are server enforced, deny by default, tenant scoped and constrained by engagement assignment. UI hiding is not authorisation. A role may never override `INV-04` through `INV-14`.

## Roles

| Code | Role                              | Normal scope                                                                       |
| ---- | --------------------------------- | ---------------------------------------------------------------------------------- |
| COO  | Client organisation owner         | Own organisation, billing authority, delegated admins, final client accountability |
| CAD  | Client administrator              | Membership and workspace administration without ownership transfer                 |
| BMG  | Bid manager                       | Engagement workflow and assignment within client organisation                      |
| CON  | Contributor                       | Assigned tasks, evidence and draft content                                         |
| CAP  | Client reviewer/approver          | Independent review and client approval                                             |
| AUD  | Read-only auditor                 | Time-bounded evidence/audit visibility, no mutation/export by default              |
| VAN  | BidBox analyst                    | Assigned engagements, extraction/evidence/remediation operations                   |
| VQA  | BidBox quality adviser            | Independent quality/fatal reclassification/package sign-off                        |
| VOA  | BidBox operations administrator   | Queues, provider reconciliation, tenant-neutral operations metadata                |
| RPA  | Restricted platform administrator | Platform configuration with no standing client-content access                      |
| PAD  | Partner administrator             | Partner team and delegated client workspaces                                       |
| PAN  | Partner analyst/reviewer          | Partner-assigned engagement work, subject to co-sign policy                        |

## Permission matrix

Legend: `O` own organisation; `A` assigned engagement; `P` partner-managed client; `M` operational metadata only; `-` denied.

| Action                          | COO | CAD | BMG     | CON | CAP     | AUD    | VAN     | VQA     | VOA              | RPA              | PAD     | PAN     |
| ------------------------------- | --- | --- | ------- | --- | ------- | ------ | ------- | ------- | ---------------- | ---------------- | ------- | ------- |
| View organisation profile       | O   | O   | O       | O   | O       | O      | A       | A       | M                | M                | P       | P       |
| Change ownership/legal profile  | O   | -   | -       | -   | -       | -      | -       | -       | -                | -                | P\*     | -       |
| Invite/disable members          | O   | O   | -       | -   | -       | -      | -       | -       | M                | -                | P       | -       |
| Assign engagement team          | O   | O   | O       | -   | -       | -      | A       | A       | M                | -                | P       | P       |
| Create/order engagement         | O   | O   | O       | -   | -       | -      | -       | -       | M                | -                | P       | -       |
| Upload input/evidence           | O   | O   | A       | A   | A       | -      | A       | A       | M                | -                | P       | P       |
| Confirm extracted requirement   | -   | -   | A       | -   | A       | -      | A       | A       | -                | -                | -       | P       |
| Reclassify fatal/likely-fatal   | -   | -   | propose | -   | propose | -      | propose | approve | -                | -                | -       | propose |
| Approve evidence/capability     | -   | -   | propose | -   | approve | -      | propose | approve | -                | -                | propose | propose |
| Edit grounded draft             | -   | -   | A       | A   | comment | -      | A       | A       | -                | -                | P       | P       |
| Run BOQ checks                  | -   | -   | A       | -   | review  | -      | A       | A       | -                | -                | -       | P       |
| Waive non-fatal exception       | -   | -   | propose | -   | approve | -      | propose | approve | -                | -                | propose | propose |
| Client approval                 | O   | -   | -       | -   | A       | -      | -       | -       | -                | -                | P\*     | -       |
| BidBox QA sign-off              | -   | -   | -       | -   | -       | -      | -       | A       | -                | -                | -       | P\*\*   |
| Export signed package           | O   | O   | A       | -   | A       | view   | A       | A       | -                | -                | P       | P       |
| Billing/payment actions         | O   | O\* | view    | -   | -       | view\* | -       | -       | reconcile        | config           | P\*     | -       |
| Retention/deletion request      | O   | O   | -       | -   | -       | view   | -       | -       | execute\*        | policy           | P\*     | -       |
| View audit content              | O   | O   | A       | A   | A       | O      | A       | A       | M                | M                | P       | P       |
| Manage provider/config/flags    | -   | -   | -       | -   | -       | -      | -       | -       | operate          | config           | -       | -       |
| Access another tenant's content | -   | -   | -       | -   | -       | -      | -       | -       | break-glass only | break-glass only | -       | -       |

`*` requires the applicable delegation/dual control. `**` partner QA cannot replace mandatory BidBox co-sign where the product is BidBox-branded.

## Segregation rules

1. The person who proposes a fatal downgrade cannot independently approve it.
2. The author of a material factual claim cannot be its sole evidence approver and final quality signatory.
3. Payment reconciliation cannot be performed by the same identity that changed the price-book/entitlement rule for that transaction.
4. A platform administrator cannot grant themselves tenant content access.
5. A deletion executor cannot delete legal-hold data or delete the immutable audit/anchor evidence.
6. Break-glass requires an incident/support ticket, tenant, scope, reason, approving identity, expiry, prominent tenant notification unless legally prohibited, and after-action review.
7. Time-limited grants expire server-side and are rechecked on every request/job, not only at login.
8. Partner roles receive access through both partner-client relationship and engagement assignment; either revocation denies access.
9. Membership administration is re-authorised from live rows inside a serialised organisation transaction. An actor cannot mutate or reactivate a target with any non-revoked, unexpired (including scheduled) role above the actor's delegation ceiling.
10. Self-service role grants, self-suspension/revocation, and self-managed access-expiry changes are denied. A lifecycle change must not leave the organisation without an active administrator or, for a client organisation, an active owner at the effective time.

## Authorisation decision inputs

`actor_id`, `actor_tenant_id`, `role_grants`, `resource_tenant_id`, `engagement_assignment`, `partner_relationship`, `purpose`, `grant_expiry`, `feature_entitlement`, `object_state`, and `break_glass_context` are evaluated at the API and in worker execution. Database RLS is the backstop for tenant-owned rows; object storage paths/policies and retrieval indexes use the same immutable tenant identifier.

## Review evidence

Every permission row needs allow and deny tests, cross-tenant variants, expired-grant variants, and audit assertions. Until those tests pass against a disposable real PostgreSQL service with RLS enabled, this matrix is a requirement, not verified implementation.
