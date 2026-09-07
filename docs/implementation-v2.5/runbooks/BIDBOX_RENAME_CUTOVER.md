# BidBox rename cutover

This is a deployment procedure, not evidence that the cutover has happened. Keep
the current deployment available until the replacement domain and authentication
have been verified. Renaming the repository or project title does not prove that
the provider has assigned a new public domain.

## Compatibility release

- Preserve the database, object storage, Clerk keys, existing user IDs, migration
  history, persisted schema tags and `VALO_*` environment identifiers.
- Deploy the dual-lock compatibility code to every API instance. It acquires each
  original Valo lock before its transitional BidBox alias. Do not rename either
  lock as a branding edit or remove the alias while renamed instances remain.
- Ask users to finish active work and refresh every open tab after rollout. The
  corrected browser bundle coordinates with either preceding bundle, but it
  cannot repair coordination between two already-open, unpatched bundles.
- Do not clear IndexedDB or browser encryption keys. The original encrypted
  database is intentionally shared with the renamed interface.
- Keep both explicit organisation-header aliases accepted during the bridge;
  conflicting aliases must fail before a request is sent.

## Domain and identity transition

1. Compare the provider checkout and effective deployment settings with the merged
   source. Preserve unrelated provider changes. In particular, retain both
   `https://bidbox-mvp-builder.replit.app` and
   `https://valo-mvp-builder.replit.app` in `CORS_ALLOWED_ORIGINS` while the existing
   Valo deployment serves users. The same allowlist controls Clerk's proxy hosts.
2. Obtain the actual deployment URL from Replit's Publishing/Domain controls.
   Verify that it belongs to this app and has working HTTPS. Do not update GitHub
   variables merely because the desired name appears in metadata.
3. If the provider requires unpublishing before it can assign a replacement
   domain, stop and obtain an approved downtime window and rollback plan. Do not
   delete or recreate the app, database, storage or identity instance.
4. Obtain a successful release candidate from the exact merged source. The
   usability evidence gate remains mandatory; the missing-evidence placeholder
   is not approval. Follow the [usability programme](../../usability/CONTINUOUS_USABILITY_PROGRAMME.md)
   to record real, consented, privacy-reviewed observations and named reviews.
5. Publish the verified candidate. Set `VALO_RELEASE_SHA256` to that candidate's
   digest, never a digest copied from an earlier build. The API build itself stamps
   the verified source commit; it cannot be supplied through runtime environment.
6. Verify the new root page, canonical/OG URLs, robots and sitemap. Probe
   `/api/healthz` and `/api/readyz` with the new browser `Origin`, and verify exact
   credentialed CORS responses as well as release and source identities. The
   unauthenticated `/api/__clerk/v1/environment` must return its public identity
   configuration successfully. Never send an operator token to the Clerk proxy.
7. Complete a real sign-in and authorised read smoke test using a test account;
   a public identity configuration response alone does not prove the entire
   authenticated user flow. Confirm existing account IDs and memberships remain.
8. Update the GitHub production environment's `VALO_DEPLOYMENT_ORIGIN` only after
   the new URL works. Run the deployment-verification workflow against that URL
   and candidate. Retain the old origin until the agreed compatibility period and
   rollback window have ended.

## Observed starting state (7 September 2026)

These are diagnostic observations, not a release acceptance record:

- GitHub main was merged PR #59 (`be55bb9a3a0189e7863e5d4bbb01e40a63d5949c`).
- The provider checkout was `c4f3911`, with later configuration changes removing
  the old CORS origin, while production still served the old domain.
- The desired BidBox domain returned 404. The old domain returned healthy
  dependency probes without an Origin, but rejected its own browser Origin with
  403 and its identity environment endpoint with 421.
- The running release header still advertised an older candidate digest.
- Checked-in usability release evidence was still explicitly missing.

Re-check these facts before acting. Do not treat this dated snapshot, passing unit
tests, or the provider's generic "published" status as proof of a safe cutover.
