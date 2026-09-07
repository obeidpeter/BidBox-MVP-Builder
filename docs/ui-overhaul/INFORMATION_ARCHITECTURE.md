# Information architecture

Status: route and navigation contract for the UI overhaul. `Implemented` means a current route/surface exists; it does not mean the full product journey or production environment is accepted.

## Principles

- Organise work by user decision, not database table.
- Put readiness, reason, owner, deadline, and next safe action before analytics.
- Derive navigation and material controls from the active organisation, canonical roles, and server-computed effective permissions.
- Keep public, identity, tenant-selection, and tenant-workspace contexts distinct.
- Never reveal protected data before access is resolved and never use client-side hiding as authorisation.
- Use `Pursuit` in product language while retaining `/projects` until an intentional redirect/API migration is approved.

## Public architecture

```text
/
|- /product
|- /solutions
|- /how-it-works
|- /security
|- /about
|- /contact
|- /privacy
|- /terms
`- public not-found
```

All routes are implemented. `/contact` is a safe hand-off to a configured HTTPS booking URL or email address; it is not a lead-capture or file-upload form.

## Access architecture

```text
/sign-in
|- /accept-invitation
`- /sso-callback

authenticated gateway
|- identity-provider verification
|- local user status
|- organisation discovery/selection
|- active direct membership or verified partner-projected client context
|- active role grants and effective permissions
`- context-derived home
```

Clerk is provider-backed. Missing identity configuration, disabled identity, pending role, unknown role, membership error, and required organisation selection each have an explicit fail-closed state.

## Authenticated navigation

```text
Workspace
|- /app                     Command Centre
|- /projects                Pursuits
|- /portal                  Client workspace [commercial gate]
`- /partner                 Partner workspace [commercial gate]

Delivery
|- /sbd                     Compliance corpus
|- /evidence-readiness      Evidence Library
|- /operations              Reviews and operations queues
`- /reports                 Reports

Oversight
|- /clients                 Clients
|- /billing                 Billing & entitlements [commercial gate; unavailable actions]
`- /notifications           Notifications [provider gate; unavailable delivery]

Administration
|- /app/security            Security & audit
|- /organisation-settings   Memberships, grants, relationships
|- /settings                Platform Operations
`- /account                 Provider-backed identity profile
```

The exact visible set is defined in `ROLE_ROUTE_MATRIX.md`. A pending feature may remain visible as pending; visibility does not activate the server capability.

## Pursuit workbench

`/projects/:id` is the core decision workspace:

| Tab                | User question                                                  | Current status                                                                          |
| ------------------ | -------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Overview/readiness | What blocks progress and what should happen next?              | Implemented; client summary is advisory to server gates.                                |
| Documents          | What was received, inspected, included, extracted, or blocked? | Implemented; storage/malware are provider-backed; resumable upload is absent.           |
| Requirements       | What does the source require and has a human ruled on it?      | Implemented/partial; source comparison needs browser QA.                                |
| Evidence           | Which approved record resolves each mandatory requirement?     | Implemented/partial.                                                                    |
| BOQ                | Which deterministic exceptions remain?                         | Implemented/partial; never suggests prices.                                             |
| Defects            | What controllable issue exists, at what severity and state?    | Implemented/partial; governed decision producer remains a critical integration concern. |
| Risk               | What is the explainable controllable-defect risk?              | Implemented; never award probability.                                                   |
| Reports            | Is there a generated, signed, exportable artefact?             | Implemented/partial; persistent package lifecycle is incomplete.                        |
| Audit              | Who changed or accessed what and when?                         | Implemented; external immutable anchoring remains provider/operations work.             |

Drafting, task management, package manifests, privacy cases, rule-pack approval, and provider health are required product concepts but do not all have complete first-class routes. Do not imply completion by adding empty navigation items; add a route only with an authoritative API and state model.

## Role homes

| Role cluster                      | Home                                                                    | First answer                                                                                                                           |
| --------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Client roles                      | `/projects`; `/portal` when activated                                   | Current pursuits, deadlines, evidence gaps, and permitted actions. The commercial portal gate never blocks the core pursuit workbench. |
| Partner roles                     | `/partner` directly; `/projects` in a selected projected client context | Approved relationships in the partner tenant and assigned client work only after server-verified relationship discovery/selection.     |
| BidBox delivery/operations        | `/app`                                                                  | Queues, deadlines, readiness blockers, and next safe actions.                                                                          |
| Restricted platform administrator | `/app/security`                                                         | Configuration and security controls without standing tenant-content access.                                                            |
| Read-only auditor                 | `/evidence-readiness`                                                   | Evidence and audit posture plus read-only pursuit/client/report directories, without mutation.                                         |

## Navigation and page rules

1. The active organisation and effective roles are always visible in the authenticated header; navigation and actions use that context's server-computed permissions.
2. Switching direct or partner-projected organisations is disabled while a write is pending; caches and tenant headers switch atomically, and the server revalidates the selector.
3. Every page uses a consistent header: area, title, plain-language purpose, current state, and permitted actions.
4. Every collection defines loading, empty, partial, error, offline, and stale-data behavior.
5. Every protected direct URL returns a non-revealing blocked/not-found state if access fails.
6. High-volume tables use server pagination/filter/sort and retain an accessible non-visual interpretation.
7. Mobile supports status, capture, and approval; desktop remains the primary source-comparison and bulk-review environment.

## Route additions gate

A new route is ready only when it has: canonical role/permission mapping; server endpoint and tenant enforcement; loading/empty/error/offline states; analytics-free primary task; keyboard and responsive behavior; tests; and a documented provider/commercial status. Otherwise keep the capability embedded in an existing truthful status surface or mark it unavailable.
