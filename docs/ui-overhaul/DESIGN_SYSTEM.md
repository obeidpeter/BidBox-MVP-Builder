# Design system

Status: implementation contract aligned to `artifacts/bidbox-workbench/src/index.css` and the shared React components. The light theme is the audited baseline. Dark tokens exist, but dark-mode activation and visual QA are not release evidence.

## Character

Calm, credible, evidence-led, and efficient under deadline pressure. Hierarchy comes from typography, spacing, borders, and state explanations rather than gradients, glass effects, decorative cards, or “AI magic.”

## Core tokens

| Token                 | Current value/use                                                     |
| --------------------- | --------------------------------------------------------------------- |
| Canvas                | warm off-white `hsl(42 33% 98%)`                                      |
| Ink                   | deep slate `hsl(222 34% 13%)`                                         |
| Card                  | white                                                                 |
| Primary action        | dark teal `hsl(187 56% 25%)`                                          |
| Accent                | pale teal `hsl(188 30% 92%)`                                          |
| Border                | `hsl(216 20% 87%)`                                                    |
| Muted text            | `hsl(217 13% 43%)`                                                    |
| Pass                  | green/success                                                         |
| Attention             | amber/warning                                                         |
| Blocked/error/expired | red/destructive                                                       |
| Information/partial   | blue/info                                                             |
| Sidebar               | deep slate with teal active accent                                    |
| Typeface              | Inter, then Aptos/Segoe UI/Roboto/Helvetica/Arial                     |
| Monospace             | SFMono-Regular, Consolas, Liberation Mono                             |
| Radius                | `0.5rem` base; restrained shadows                                     |
| Layout                | 320px minimum viewport; 80rem public shell; 17rem desktop app sidebar |

`font-serif` currently resolves to the same UI sans stack. Do not imply a separate editorial typeface until one is intentionally added and licensed.

## Type and spacing

- Base text remains at least 16px for normal reading with line height near 1.5.
- Page titles use a compact 30px-36px scale; section titles use 18px-24px.
- Labels and metadata may use 11px-14px only with sufficient contrast and spacing.
- Use the 4px spacing scale. Dense review tables may compress vertically, but interactive targets should remain at least 44x44px where feasible.
- Use tabular numerals for deadlines, money, counts, versions, and hashes.
- Long IDs and source references wrap or truncate with an accessible full value.

## Semantic states

Every state uses icon + label + reason; color is never the only cue.

| State         | Meaning                                          | Required content                                             |
| ------------- | ------------------------------------------------ | ------------------------------------------------------------ |
| `active`      | Authoritative capability/data is available       | What is current and when it was verified                     |
| `blocked`     | A deterministic rule prevents progress           | Rule, blocking objects, owner, next safe action              |
| `expired`     | A time-bound record is no longer valid           | Expiry time, affected work, renewal action                   |
| `pending`     | Awaiting human, job, provider, or activation     | Waiting on whom/what and safe-to-close guidance              |
| `partial`     | Some sources succeeded                           | Available subset, unavailable subset, retry/reconcile action |
| `error`       | Request failed                                   | Retained work, correlation-safe message, retry/support path  |
| `offline`     | Connectivity is absent                           | Cache age, disabled writes, reconnect behavior               |
| `unavailable` | Capability or authoritative value does not exist | Why it is absent; never substitute zero/pass                 |
| `empty`       | Query succeeded with no records                  | Scope searched and a permitted creation/next step            |

## Component contract

Use and extend the existing primitives before creating one-off variants:

- shell: public shell, app layout, tenant switcher, global command, breadcrumbs
- status: `PageHeader`, `StateBadge`, `StatusPanel`, `LoadingPanel`, `DataErrorPanel`, `OfflineBanner`, activation notice
- workflow: readiness banner/gate, deadline caution, progress/timeline, approval panel, reason confirmation
- provenance: citation chip, evidence chip, source/version badge, audit timeline, diff/source viewer
- data: accessible table/data grid, filters, pagination, bulk-action bar, empty state
- input: labelled field, error summary, upload manager, dialog/alert dialog, toast plus persistent notification record

One surface should not contain multiple competing primary actions. Destructive or governance-changing actions require a reason, confirmation, and visible consequence.

## Content language

Prefer: “suggested,” “confirmed by,” “blocked because,” “source page/clause,” “evidence expires,” “provider accepted,” and “last recomputed.”

Avoid: “AI verified,” “guaranteed compliant,” “will win,” “safe” without a named basis, “delivered” for a queued notification, or “paid” for a project confirmation that is not reconciled billing data.

## Responsive and low-bandwidth behavior

- Desktop is primary for source comparison, large tables, and bulk review.
- Tablet/mobile prioritise state, next action, capture, and approval; true grids may scroll with an accessible summary.
- Public and app navigation collapse to explicit menus with 44px targets.
- Paginate and lazy-load; load source thumbnails before high-resolution pages.
- Never cache restricted documents in offline browser storage.
- Polling backs off; long jobs show retained ID/state and “safe to close” when true.
- Downloads show type/size before transfer. Upload failure never creates a successful document record.

## Accessibility

- Semantic landmarks, heading order, skip links, labelled controls, error summary, and inline errors.
- Visible 2px focus ring with offset; logical focus order and restoration; no keyboard trap.
- Live regions announce important progress without repeating every poll.
- Reflow at 320 CSS px, 200% zoom, text-spacing overrides, reduced motion, and non-color status.
- Data grids expose headers, sort, selection, and an equivalent summary; charts have a table/text alternative.
- Source images include document/page context; machine-derived OCR is labelled and access-controlled.

## Public contact rule

Do not add a contact form unless a real backend defines validation, consent/privacy handling, rate limiting, delivery/reconciliation, retention, and failure recovery. Until then, keep the validated external channel and explicit unconfigured state. Public pages must never accept tender files.
