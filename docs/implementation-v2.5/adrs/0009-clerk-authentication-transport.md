# ADR-0009: Clerk authentication and transport boundary

Status: Accepted; web and server source boundary implemented; provider approval and live configuration remain environment evidence
Date: 2026-08-31
Last reviewed: 2026-08-31
Next review: 2026-11-30
Owner: Identity and application security (`@obeidpeter`)
Backup owner: Unassigned; tracked as `AR-001`
Reviewers: Security/privacy and product role holders for identity-provider or transport changes; named alternates are not yet recorded
Drivers: `AD-002`, `AD-009`, `AD-011`
Evidence: `artifacts/api-server/src/app.ts`; `artifacts/api-server/src/middlewares/auth.ts`; `artifacts/api-server/src/middlewares/clerkProxyMiddleware.ts`; `artifacts/bidbox-workbench/src/authenticated-gateway.tsx`; `lib/api-client-react/src/custom-fetch.ts`; `docs/implementation-v2.5/RELEASE_PROVENANCE.md`
Supersedes: Unspecified session/auth transport in the observed baseline
Superseded by: None

## Context

BidBox uses Clerk for external identity but keeps organisation membership, grants, tenant selection and business authority in PostgreSQL. The production Workbench is same-origin with the API and must work behind a Replit-compatible Clerk Frontend API proxy. Server-to-server or future non-browser clients may need bearer transport, while browser code should not manually handle session tokens.

## Decision

1. Clerk verifies the external session in `clerkMiddleware`; `attachUser` then resolves or just-in-time provisions the internal user by immutable Clerk user ID. Bootstrap privilege comes only from explicit configured Clerk IDs or email addresses, never insertion order.
2. Browser authentication uses Clerk's session cookie through the same-origin application. The production Workbench configures `proxyUrl=/api/__clerk`; it does not register the generated client's optional bearer-token getter.
3. The generated client may attach `Authorization: Bearer <token>` only when a non-web host explicitly registers a token getter and no Authorization header is already present. Tokens are never accepted through URL parameters or tenant headers.
4. The Clerk proxy is mounted before body parsers, is active only in production, forwards to Clerk's fixed Frontend API, and derives its public host only from the exact configured CORS-origin allowlist. An unknown host fails with 421. Clerk secret material remains server-side.
5. All protected `/api` routes run after Clerk middleware and `attachUser`. `X-BidBox-Organisation-Id` is only a candidate tenant selector; current membership, grants, access windows and break-glass policy remain server-derived authority.
6. Identity-bound browser query caches are replaced when Clerk user or session changes. Production activation requires approved key references and `CLERK_ADAPTER_PRODUCTION_APPROVED=true`; source configuration alone is not provider approval evidence.

## Consequences

Identity transport stays provider-specific at the edge while tenant authorization remains BidBox-controlled and testable. The same-origin proxy avoids exposing secret keys and supports production hosting, but makes allowed-origin configuration part of the identity boundary. A Clerk outage can prevent authentication and user lookup; it must not be bypassed with a development identity in production.

## Rejected

Client-supplied user or tenant identity; browser-managed bearer tokens by default; selecting Clerk tenants from untrusted forwarded-host data; granting platform privilege to the first database user; accepting a configured key pair as proof of provider approval.
