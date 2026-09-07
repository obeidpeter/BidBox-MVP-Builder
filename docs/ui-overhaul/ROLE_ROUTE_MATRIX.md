# Role-route matrix

Status: UI exposure contract derived from current canonical backend roles and `platform-access.ts`. Backend permissions, tenant context, object state, assignments, partner relationships, access windows, feature flags, and break-glass context remain authoritative.

## Canonical roles

| Code | Backend role                           |
| ---- | -------------------------------------- |
| COO  | `client_organisation_owner`            |
| CAD  | `client_administrator`                 |
| BMG  | `bid_manager`                          |
| CON  | `contributor`                          |
| CRA  | `client_reviewer_approver`             |
| VOA  | `valo_operations_administrator`        |
| RPA  | `restricted_platform_administrator`    |
| CPA  | `consultancy_partner_administrator`    |
| CPR  | `consultancy_partner_analyst_reviewer` |
| AUD  | `read_only_auditor`                    |
| VAN  | `valo_analyst`                         |
| VQA  | `valo_quality_adviser`                 |

Legacy identity values such as `admin`, `reviewer`, `analyst`, `client_owner`, and `partner_admin` are compatibility aliases, not new tenant grants. User-facing labels should resolve to the canonical role.

## Route access

Legend: `Active` is role-eligible; `Gated` is role-eligible but commercially/provider gated; omitted roles are denied in the current frontend contract.

| Routes/area                                 | Eligible canonical roles                              | State                                                                                                                                      |
| ------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Public routes                               | Everyone                                              | Active                                                                                                                                     |
| `/sign-in`, invitation, callback            | Signed-out users; signed-in users redirect home       | Provider-backed                                                                                                                            |
| `/app`, `/dashboard`                        | VAN, VQA, VOA                                         | Active                                                                                                                                     |
| `/clients`, `/projects`, `/sbd`, `/reports` | COO, CAD, BMG, CON, CRA, CPA, CPR, AUD, VAN, VQA, VOA | Active in the selected server-authorised context; navigation and controls use its effective permissions, and the API rechecks every action |
| `/operations`                               | VAN, VQA, VOA                                         | Active                                                                                                                                     |
| `/portal`                                   | COO, CAD, BMG, CON, CRA                               | Gated by `VITE_FEATURE_CLIENT_PORTAL` plus server permissions/flags                                                                        |
| `/partner`                                  | CPA, CPR                                              | Gated by `VITE_FEATURE_PARTNER_WORKSPACE`, active relationship, assignment, and server flags                                               |
| `/evidence-readiness`                       | COO, CAD, BMG, CRA, VOA, CPA, CPR, AUD, VAN, VQA      | Active                                                                                                                                     |
| `/billing`                                  | COO, CAD, VOA, CPA                                    | Gated; current actions are unavailable until billing APIs/providers exist                                                                  |
| `/notifications`                            | COO, CAD, BMG, CON, CRA, VOA, CPA, CPR, VAN, VQA      | Gated; manual records do not prove delivery                                                                                                |
| `/app/security`                             | VOA, RPA, AUD                                         | Active within backend permission scope                                                                                                     |
| `/organisation-settings`                    | COO, CAD, VOA, CPA                                    | Active within delegation and grant-ceiling rules                                                                                           |
| `/settings`                                 | VOA                                                   | Active; restricted platform administration uses narrower security/flag routes, not this broad operations page                              |
| `/account`                                  | Any authenticated, enabled user                       | Provider-backed identity profile only                                                                                                      |

Frontend area checks combine role eligibility with the effective permissions returned for the selected server-authorised context. They improve navigation and control relevance but never replace server enforcement, object-state gates, assignments, or tenant checks.

## Role home and responsibility

| Role | Home                                   | Intended UI responsibility                                                                                                                                                                                                                                        |
| ---- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| COO  | Pursuits / portal                      | Organisation accountability, team, ordering visibility, approval/export where permitted. The gated portal is home only when activated.                                                                                                                            |
| CAD  | Pursuits / portal                      | Membership/workspace administration and operational coordination. The gated portal is home only when activated.                                                                                                                                                   |
| BMG  | Pursuits / portal                      | Tenant-context pursuit coordination and requirement/evidence remediation. A general engagement-assignment enforcement boundary is not yet implemented. The gated portal is home only when activated.                                                              |
| CON  | Pursuits / portal                      | Tenant-context uploads, evidence, tasks, and grounded content. General engagement-assignment enforcement remains a production gate. The gated portal is home only when activated.                                                                                 |
| CRA  | Pursuits / portal                      | Independent requirement/evidence review and client approval/sign-off where permitted. The gated portal is home only when activated.                                                                                                                               |
| VAN  | Command Centre                         | Tenant-context intake, extraction review, evidence, defects, and report generation. A general engagement-assignment filter remains a production gate.                                                                                                             |
| VQA  | Command Centre                         | Independent quality decisions, fatal governance, sign-off/export.                                                                                                                                                                                                 |
| VOA  | Command Centre                         | Operational queues, retries, configuration, tenant administration, and reconciliation; no automatic QA authority.                                                                                                                                                 |
| RPA  | Security & audit                       | Platform security/feature administration without standing client-content access.                                                                                                                                                                                  |
| CPA  | Partner workspace / projected pursuits | Partner team and approved relationships in the direct partner context; relationship-projected client pursuits in an explicitly selected context, without projected release/admin/commercial powers. General engagement-assignment enforcement is not yet present. |
| CPR  | Partner workspace / projected pursuits | Partner delivery/review within the selected relationship-projected context's server-computed permission ceiling; a general engagement-assignment filter is not yet implemented.                                                                                   |
| AUD  | Evidence Library / pursuits            | Time-bounded read-only evidence, pursuit, report, client, analytics, and audit review without mutation.                                                                                                                                                           |

## Segregation and absent roles

- The canonical server matrix now separates portfolio management, contribution/proposal, client review, and BidBox quality authority. Client/partner administrators do not inherit requirement confirmation, evidence approval, defect disposition, or quality sign-off; bid managers and analysts may confirm requirements but cannot approve evidence or sign off; only the named client reviewer and BidBox quality role receive independent approval permissions. Every role is table-tested across the approval, review, sign-off, and export permissions.
- `defect:review` remains a coarse permission spanning non-fatal waiver, risk override, and fatal-quality decisions. The candidate therefore withholds it from proposers and partner roles; a persisted decision-type split is still required before partner/client propose-only defect workflows can be described as complete.
- Partner-derived access never grants release, deletion, privacy, billing, administration, or feature-control authority.
- A partner role alone never selects or reveals a client. Organisation discovery returns a client option only after validating an active partner membership, active relationship, active client, and the client tenant's `partner_edition` flag. Selecting that option sends its identifier as a header selector; middleware independently repeats the full relationship and permission check.
- Membership grants and lifecycle changes are re-authorised from locked, live membership/grant rows. Scheduled higher-authority grants count toward the management ceiling; self-grants, self-suspension/expiry changes, and changes that would leave no active administrator or client owner are denied and audited.
- Break-glass is time-bounded, scoped, audited, and read-only for the eligible permission set; it is not a navigation role.
- There is no canonical finance role. Billing screens must not expose an invented finance persona.
- There is no canonical authorised-signatory role. Existing sign-off uses `report:sign_off`/`package:sign_off` and a recorded signer. Corporate execution authority is a separate business fact that the backend does not yet model as a role.
- If finance or signatory responsibilities become necessary, define organisation role, permissions, grant ceiling, separation rules, schema/API changes, route mapping, and allow/deny/cross-tenant tests before UI exposure.

## Test minimum

For every route and material action, test each canonical role in owning and non-owning tenants, active and expired grants, direct and partner access, feature on/off, online/offline, and direct URL entry. Assert both the UI state and the server response; a hidden button is not a denial test.
