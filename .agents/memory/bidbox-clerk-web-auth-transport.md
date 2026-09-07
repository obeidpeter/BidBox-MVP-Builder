---
name: Valo web Clerk auth transport
description: Why the valo-workbench web app must use Clerk session cookies, never setAuthTokenGetter/Bearer tokens.
---

The valo-workbench **web** app authenticates to the api-server via Clerk's **session cookie** (`__session`), which `clerkMiddleware` + `getAuth` read server-side. Same-origin `/api` fetches send the cookie automatically; the Vite dev proxy (`/api` → api-server) forwards it.

**Rule:** Never wire `setAuthTokenGetter` / `getToken()` / `Authorization: Bearer` in the web app. That transport is **mobile/Expo-only** (no browser cookie jar). `setAuthTokenGetter` stays exported from `@workspace/api-client-react` for mobile, but must not be *called* on web.

**Why:** A prior `use-auth-sync.ts` hook called `setAuthTokenGetter(() => getToken())` in the web app and produced a permanent "Authentication Failed" screen (rendered by `layout.tsx` when `useGetMe()` errors). Two failure modes:
- First-render race: `useGetMe()` lives in `Layout` (child), the token getter was set by `useAuthSync()` in `ProtectedApp` (parent). Effects run child-first, so the first `/api/me` went out with no token → 401. React Query has `retry:false`, so one miss = permanent failure until reload.
- Clerk session tokens from `getToken()` expire ~60s, adding intermittent 401s.

Cookie transport mechanics are sound: same-origin relative `/api` fetches use `credentials:"same-origin"` (cookies sent); the Vite dev proxy forwards the `Cookie` header verbatim (`changeOrigin` only rewrites Host); `clerkMiddleware` verifies the `__session` JWT networklessly via `CLERK_SECRET_KEY`. This matches the clerk-auth skill: web 401s are fixed in middleware order / `requireAuth` / the local-user JIT bridge, never by adding token auth to the browser.

**One-miss-is-fatal caveat:** the global queryClient sets `retry:false`. A single transient 401 (stale `__session` cookie on cold load, before clerk-js refreshes) then dead-ends permanently on "Authentication Failed". `layout.tsx`'s `useGetMe` therefore overrides retry (retry 401/5xx up to 3x, fail fast on 403). Keep that override if you touch the me query.

**How to apply:** If web API calls 401 while signed in, do NOT add token auth. Verify `clerkMiddleware` is mounted before `/api` routes, `attachUser` runs before protected routers, the browser is sending the session cookie through the proxy, and transient 401s self-heal via retry rather than dead-ending.
