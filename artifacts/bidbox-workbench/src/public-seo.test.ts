import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  APPROVED_PUBLIC_ORIGIN,
  isApprovedPublicOrigin,
} from "@/components/public/public-meta";

const root = resolve(import.meta.dirname, "..");

describe("public SEO and privacy boundary", () => {
  it("keeps the static template zoomable, noindex by default and independent of remote fonts", () => {
    const html = readFileSync(resolve(root, "index.html"), "utf8");
    expect(html).toContain('lang="en-NG"');
    expect(html).toContain('name="robots" content="noindex, nofollow"');
    expect(html).not.toContain('rel="canonical"');
    expect(html).not.toContain('property="og:url"');
    expect(html).toContain('property="og:image"');
    expect(html).not.toContain("maximum-scale");
    expect(html).not.toContain("fonts.googleapis.com");
    expect(html).toContain("bill of quantities (BOQ)");
    expect(html).toContain(
      "Turn on JavaScript to view Valo's public pages or sign in securely.",
    );
    expect(html).not.toContain("responsiveness risks");
  });

  it("recognises only the exact approved production origin", () => {
    expect(isApprovedPublicOrigin(APPROVED_PUBLIC_ORIGIN)).toBe(true);
    expect(isApprovedPublicOrigin(`${APPROVED_PUBLIC_ORIGIN}/product`)).toBe(
      true,
    );
    expect(isApprovedPublicOrigin("http://valo-mvp-builder.replit.app")).toBe(
      false,
    );
    expect(
      isApprovedPublicOrigin("https://preview.valo-mvp-builder.replit.app"),
    ).toBe(false);
    expect(isApprovedPublicOrigin("http://localhost:4173")).toBe(false);
  });

  it("does not impose a document-level minimum width", () => {
    const css = readFileSync(resolve(root, "src", "index.css"), "utf8");
    expect(css).not.toMatch(/html\s*\{[^}]*min-width\s*:/s);
    expect(css).not.toMatch(/body\s*\{[^}]*min-width\s*:/s);
  });

  it("lists every implemented public route and no account route in the sitemap", () => {
    const sitemap = readFileSync(
      resolve(root, "public", "sitemap.xml"),
      "utf8",
    );
    for (const path of [
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
      expect(sitemap).toContain(`replit.app${path}</loc>`);
    }
    expect(sitemap).not.toContain("/app</loc>");
    expect(sitemap).not.toContain("/sign-in</loc>");
  });

  it("keeps authentication and workspace prefixes out of crawler scope", () => {
    const robots = readFileSync(resolve(root, "public", "robots.txt"), "utf8");
    for (const path of [
      "/app",
      "/projects",
      "/intelligence",
      "/portfolio-intelligence",
      "/reports",
      "/organisation-settings",
      "/account",
      "/sign-in",
    ]) {
      expect(robots).toContain(`Disallow: ${path}`);
    }
  });

  it("ships a crawler-compatible 1200 by 630 social preview", () => {
    const image = readFileSync(resolve(root, "public", "opengraph.png"));
    expect(image.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(image.readUInt32BE(16)).toBe(1200);
    expect(image.readUInt32BE(20)).toBe(630);
  });

  it("offers an online-first installable workspace without caching tender data", () => {
    const manifest = JSON.parse(
      readFileSync(resolve(root, "public", "site.webmanifest"), "utf8"),
    ) as {
      id?: string;
      start_url?: string;
      display?: string;
      shortcuts?: Array<{
        name?: string;
        short_name?: string;
        description?: string;
        url?: string;
      }>;
    };
    const html = readFileSync(resolve(root, "index.html"), "utf8");

    expect(manifest).toMatchObject({
      id: "/app",
      start_url: "/app",
      display: "standalone",
    });
    expect(manifest.shortcuts?.map((shortcut) => shortcut.url)).toEqual([
      "/projects",
      "/operations",
    ]);
    expect(manifest.shortcuts).toEqual([
      expect.objectContaining({
        name: "Pursuits",
        short_name: "Pursuits",
        description: "Open your secure pursuit workspace.",
      }),
      expect.objectContaining({
        name: "Operations",
        short_name: "Operations",
        description: "Open reviews and AI service status.",
      }),
    ]);
    expect(html).toContain('name="mobile-web-app-capable" content="yes"');
    expect(html).toContain('name="apple-mobile-web-app-capable" content="yes"');

    // The mobile shell is deliberately online-first. A future service worker
    // must pass a separate privacy review before any authenticated content can
    // enter Cache Storage or IndexedDB.
    expect(readFileSync(resolve(root, "src", "main.tsx"), "utf8")).not.toMatch(
      /serviceWorker|navigator\.serviceWorker/,
    );
  });

  it("keeps public integrity and human-review boundaries explicit", () => {
    const landing = readFileSync(
      resolve(root, "src", "components", "public", "landing-sections.tsx"),
      "utf8",
    );
    const terms = readFileSync(
      resolve(root, "src", "pages", "public-pages.tsx"),
      "utf8",
    );
    const signIn = readFileSync(
      resolve(root, "src", "pages", "sign-in.tsx"),
      "utf8",
    );

    expect(landing).toContain(
      "No facilitation, relationship brokering, evaluator intelligence, collusion or portal submission",
    );
    expect(terms).toContain("treat unreviewed AI");
    expect(terms).toContain("output as authoritative");
    expect(terms).toContain("before a named person reviews it");
    expect(terms).toContain("required readiness, security or service checks");
    expect(signIn).toContain(
      "Valo must also confirm an active membership for your",
    );
    expect(signIn).not.toContain("membership approved by your organisation");
  });
});
