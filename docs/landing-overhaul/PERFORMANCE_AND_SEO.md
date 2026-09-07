# Performance and SEO report

Status: build-budget and source-boundary report, reviewed 10 August 2026. It is not Lighthouse, Core Web Vitals, search-indexing or production-deployment evidence.

## Performance implementation

The public homepage remains in the initial workbench entry while the request form and supporting public pages are lazy route chunks. Protected workbench routes and the BOQ/SheetJS workload remain split from the public entry. The public experience adds no remote web font, photograph, video, carousel or third-party analytics script.

The CI budget script enforces:

| Asset class                             |        Limit |
| --------------------------------------- | -----------: |
| Initial JavaScript                      | 100 KiB gzip |
| Initial CSS                             |  25 KiB gzip |
| Any individual initial asset            |  350 KiB raw |
| `/request-bid-autopsy` lazy JavaScript  |   8 KiB gzip |
| Supporting public-pages lazy JavaScript |  10 KiB gzip |
| Public images, total                    |  800 KiB raw |
| Public fonts, total                     |  100 KiB raw |

## Final frozen build-budget result

The final frozen local production artifact passed the route-budget script with:

| Asset class                   |   Recorded result |         Limit |
| ----------------------------- | ----------------: | ------------: |
| Initial JavaScript            | 84,269 bytes gzip | 102,400 bytes |
| Initial CSS                   | 23,240 bytes gzip |  25,600 bytes |
| Request-route chunk           |  6,474 bytes gzip |   8,192 bytes |
| Supporting public-pages chunk |  6,712 bytes gzip |  10,240 bytes |
| Public images                 |  40,977 bytes raw | 819,200 bytes |
| Public fonts                  |           0 bytes | 102,400 bytes |

This is the final local production build-artifact budget pass. It is merge evidence for static asset size, not runtime performance evidence.

## Runtime performance evidence still required

No Lighthouse trace, throttled mobile-network trace, field telemetry or 75th-percentile Core Web Vitals dataset is available. LCP, INP and CLS therefore remain unknown.

There is a specific unresolved CLS risk: the production server emits a compact, generic public prerender, while the client starts with React `createRoot` rather than hydrating matching markup. The browser can replace materially different server content after the initial JavaScript loads. This may move content on slow devices or networks. It must be measured and either removed through matching render/hydration or accepted through a documented performance review before production activation.

Required activation evidence includes:

1. production-like mobile Lighthouse runs for `/` and `/request-bid-autopsy`;
2. a slow-network/CPU trace covering prerender replacement and lazy-route navigation;
3. measured LCP, INP and CLS with the test environment recorded;
4. verification that no landing or form dependency unexpectedly loads protected-workbench or spreadsheet code;
5. a cold-cache and repeat-view check; and
6. deployed asset caching and compression verification.

## SEO implementation

The implementation now applies a deny-by-default indexing boundary:

- `index.html` is `noindex, nofollow` by default and contains no default canonical or `og:url`.
- Only exact-origin requests for `https://bidbox-mvp-builder.replit.app` and an implemented public path receive `index, follow`, a canonical URL and `og:url` from the production server.
- Localhost, Replit preview/staging hosts, authentication routes, workspace routes and unknown paths remain `noindex, nofollow`; noncanonical responses also receive `X-Robots-Tag`.
- Unknown web paths return HTTP 404 rather than an indexable SPA success page.
- Public routes receive route-specific title, description, Open Graph/Twitter copy and crawler-readable server HTML.
- The sitemap includes every implemented public route, including `/request-bid-autopsy`, and excludes account/workspace routes.
- `robots.txt` excludes authentication and protected-workspace prefixes.
- The social image is a local 1200 by 630 PNG.
- Versioned static assets receive long-lived immutable caching; HTML remains `no-cache`.
- The page remains zoomable and does not depend on Google Fonts.

Static and server-route tests cover the exact production-origin rule, staging noindex behaviour, canonical removal, public/private route sets, crawler-readable content, sitemap/robots boundaries, real 404 handling, social-image dimensions and asset cache policy. Their exact final suite totals are recorded in `VALIDATION_AND_RELEASE.md`.

## SEO limitations and activation gates

The generic server prerender is search-readable, but it is not markup-equivalent to the interactive React page. In addition to the CLS concern, production activation requires:

- a deployed fetch of every public URL confirming status, canonical, robots header/meta, title, description and final rendered content;
- confirmation that proxy protocol and host handling identify only the approved origin in the actual Replit deployment;
- validation that previews never self-canonicalise or become indexable;
- structured manual checks of sitemap and robots responses at the deployed origin;
- social-card preview validation; and
- a post-deployment crawl with no protected URL or request data exposed.

No deployed smoke or search-console evidence exists. Production SEO acceptance is therefore **no-go**, even though the source and final build-budget controls are suitable merge evidence.
