import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import express from "express";
import {
  isApplicationWebPath,
  isIndexablePublicWebPath,
  PUBLIC_SITE_ORIGIN,
  registerProductionWebApp,
  WEB_APP_CONTENT_SECURITY_POLICY,
} from "./webApp";

function fetchWithHostHeaders(
  target: string,
  headers: Readonly<Record<string, string>>,
): Promise<Response> {
  const url = new URL(target);
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers,
      },
      (incoming) => {
        const chunks: Buffer[] = [];
        incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
        incoming.on("end", () => {
          const responseHeaders = new Headers();
          for (const [name, value] of Object.entries(incoming.headers)) {
            if (Array.isArray(value)) {
              value.forEach((item) => responseHeaders.append(name, item));
            } else if (value !== undefined) {
              responseHeaders.set(name, value);
            }
          }
          resolve(
            new Response(Buffer.concat(chunks), {
              status: incoming.statusCode ?? 500,
              headers: responseHeaders,
            }),
          );
        });
      },
    );
    request.on("error", reject);
    request.end();
  });
}

describe("production web route indexing", () => {
  it("allows only the implemented public routes to be indexed", () => {
    for (const path of [
      "/",
      "/product",
      "/solutions",
      "/how-it-works",
      "/security",
      "/about",
      "/contact",
      "/request-bid-autopsy",
      "/privacy",
      "/terms",
    ]) {
      assert.equal(isIndexablePublicWebPath(path), true, path);
    }
  });

  it("fails closed for authentication, workspace, and unknown paths", () => {
    for (const path of [
      "/sign-in",
      "/accept-invitation",
      "/app",
      "/projects/example-sensitive-id",
      "/intelligence?project=example-sensitive-id",
      "/organisation-settings",
      "/not-an-implemented-public-page",
    ]) {
      assert.equal(isIndexablePublicWebPath(path), false, path);
    }
    assert.equal(isApplicationWebPath("/sign-in"), true);
    assert.equal(isApplicationWebPath("/projects/example-sensitive-id"), true);
    assert.equal(isApplicationWebPath("/intelligence"), true);
    assert.equal(
      isApplicationWebPath("/not-an-implemented-public-page"),
      false,
    );
  });

  it("serves the SPA with a Clerk-compatible, deny-by-default CSP", () => {
    assert.match(WEB_APP_CONTENT_SECURITY_POLICY, /default-src 'self'/);
    assert.match(WEB_APP_CONTENT_SECURITY_POLICY, /object-src 'none'/);
    assert.match(WEB_APP_CONTENT_SECURITY_POLICY, /frame-ancestors 'none'/);
    assert.match(
      WEB_APP_CONTENT_SECURITY_POLICY,
      /style-src 'self' 'unsafe-inline'/,
    );
    assert.match(
      WEB_APP_CONTENT_SECURITY_POLICY,
      /https:\/\/\*\.protect\.clerk\.com/,
    );
    assert.doesNotMatch(WEB_APP_CONTENT_SECURITY_POLICY, /unsafe-eval/);
  });

  it("indexes public deep links only on the approved production origin", async () => {
    const fixtureDirectory = await mkdtemp(
      path.join(tmpdir(), "bidbox-web-app-"),
    );
    try {
      await mkdir(path.join(fixtureDirectory, "assets"));
      await writeFile(
        path.join(fixtureDirectory, "index.html"),
        `<!doctype html><html><head>
          <title>BidBox fixture</title>
          <meta name="description" content="fixture" />
          <meta name="robots" content="index, follow" />
          <link rel="canonical" href="https://bidbox-mvp-builder.replit.app/" />
          <meta property="og:title" content="fixture" />
          <meta property="og:description" content="fixture" />
          <meta property="og:url" content="https://bidbox-mvp-builder.replit.app/" />
          <meta name="twitter:title" content="fixture" />
          <meta name="twitter:description" content="fixture" />
        </head><body><div id="root"></div></body></html>`,
      );
      await writeFile(
        path.join(fixtureDirectory, "assets", "app-fixture.js"),
        "export {};",
      );

      const app = express();
      app.set("trust proxy", 1);
      app.get("/api/healthz", (_request, response) => {
        response.json({ status: "ok" });
      });
      registerProductionWebApp(app, fixtureDirectory);

      const server = await new Promise<ReturnType<typeof app.listen>>(
        (resolve) => {
          const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
        },
      );
      try {
        const address = server.address();
        assert.ok(address && typeof address === "object");
        const origin = `http://127.0.0.1:${address.port}`;

        const publicResponse = await fetch(`${origin}/product`);
        assert.equal(publicResponse.status, 200);
        assert.equal(
          publicResponse.headers.get("x-robots-tag"),
          "noindex, nofollow",
        );
        assert.equal(
          publicResponse.headers.get("content-security-policy"),
          WEB_APP_CONTENT_SECURITY_POLICY,
        );
        const publicHtml = await publicResponse.text();
        assert.match(publicHtml, /<title>Product \| BidBox<\/title>/);
        assert.match(publicHtml, /name="robots" content="noindex, nofollow"/);
        assert.doesNotMatch(publicHtml, /rel="canonical"/);
        assert.doesNotMatch(publicHtml, /property="og:url"/);
        assert.match(
          publicHtml,
          /<h1>A controlled workspace for evidence-heavy pursuits\.<\/h1>/,
        );
        assert.match(publicHtml, /data-public-prerender="true"/);

        const canonicalHeaders = {
          Host: new URL(PUBLIC_SITE_ORIGIN).host,
          "X-Forwarded-Proto": "https",
        };
        const canonicalResponse = await fetchWithHostHeaders(
          `${origin}/product`,
          canonicalHeaders,
        );
        assert.equal(canonicalResponse.status, 200);
        assert.equal(canonicalResponse.headers.get("x-robots-tag"), null);
        const canonicalHtml = await canonicalResponse.text();
        assert.match(canonicalHtml, /name="robots" content="index, follow"/);
        assert.match(
          canonicalHtml,
          /rel="canonical" href="https:\/\/bidbox-mvp-builder\.replit\.app\/product"/,
        );
        assert.match(
          canonicalHtml,
          /property="og:url" content="https:\/\/bidbox-mvp-builder\.replit\.app\/product"/,
        );

        const autopsyResponse = await fetchWithHostHeaders(
          `${origin}/request-bid-autopsy`,
          canonicalHeaders,
        );
        assert.equal(autopsyResponse.status, 200);
        const autopsyHtml = await autopsyResponse.text();
        assert.match(
          autopsyHtml,
          /<title>Request a Bid Autopsy \| BidBox<\/title>/,
        );
        assert.match(
          autopsyHtml,
          /rel="canonical" href="https:\/\/bidbox-mvp-builder\.replit\.app\/request-bid-autopsy"/,
        );
        assert.match(autopsyHtml, /Do not include tender documents/);

        const stagingResponse = await fetchWithHostHeaders(
          `${origin}/product`,
          {
            Host: "preview.bidbox-mvp-builder.replit.app",
            "X-Forwarded-Proto": "https",
          },
        );
        assert.equal(stagingResponse.status, 200);
        assert.equal(
          stagingResponse.headers.get("x-robots-tag"),
          "noindex, nofollow",
        );
        const stagingHtml = await stagingResponse.text();
        assert.doesNotMatch(stagingHtml, /rel="canonical"/);
        assert.doesNotMatch(stagingHtml, /property="og:url"/);

        for (const [pathname, expectedStatus] of [
          ["/sign-in", 200],
          ["/projects/example-sensitive-id", 200],
          ["/intelligence?project=example-sensitive-id", 200],
          ["/not-a-public-page", 404],
          ["/%3Cscript%3Ewindow.__bidbox_xss_probe%3D1%3C%2Fscript%3E", 404],
          [
            "/projects/%22%3E%3Cscript%3Ewindow.__bidbox_xss_probe%3D1%3C%2Fscript%3E",
            200,
          ],
        ] as const) {
          const privateResponse = await fetchWithHostHeaders(
            `${origin}${pathname}`,
            canonicalHeaders,
          );
          assert.equal(privateResponse.status, expectedStatus);
          assert.equal(
            privateResponse.headers.get("x-robots-tag"),
            "noindex, nofollow",
          );
          const privateHtml = await privateResponse.text();
          assert.doesNotMatch(privateHtml, /rel="canonical"/);
          assert.doesNotMatch(privateHtml, /property="og:url"/);
          assert.doesNotMatch(privateHtml, /__bidbox_xss_probe|%3Cscript/i);
        }

        const assetResponse = await fetch(`${origin}/assets/app-fixture.js`);
        assert.equal(assetResponse.status, 200);
        assert.match(
          assetResponse.headers.get("cache-control") ?? "",
          /immutable/,
        );

        const apiResponse = await fetch(`${origin}/api/healthz`);
        assert.equal(apiResponse.status, 200);
        assert.deepEqual(await apiResponse.json(), { status: "ok" });
        const missingApiResponse = await fetch(`${origin}/api/not-found`);
        assert.equal(missingApiResponse.status, 404);
        assert.doesNotMatch(await missingApiResponse.text(), /BidBox fixture/);
      } finally {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        });
      }
    } finally {
      await rm(fixtureDirectory, { recursive: true, force: true });
    }
  });
});
