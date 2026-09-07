import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";

export const PUBLIC_SITE_ORIGIN = "https://valo-mvp-builder.replit.app";

interface PublicPageMetadata {
  title: string;
  description: string;
  heading: string;
  summary?: readonly string[];
}

const PUBLIC_WEB_PAGES = {
  "/": {
    title: "Bid Autopsy for Nigerian Tenders | BidBox",
    description:
      "Find compliance gaps, evidence gaps, BOQ inconsistencies and responsiveness risks before submission with a human-verified BidBox Bid Autopsy.",
    heading: "Find the defects before submission.",
    summary: [
      "BidBox helps Nigerian federal contractors, NipeX and NCDMB suppliers, donor-funded bidders, bid teams and consultancy partners test a tender package against the published requirements before it reaches the evaluator.",
      "A scoped Bid Autopsy may include a source-cited requirement matrix, severity-classified defect register, compliance and evidence gaps, deterministic checks on client-supplied BOQ figures, a responsiveness review and a prioritised remediation plan verified by a named human reviewer.",
      "BidBox strengthens the review process. It does not guarantee an award or evaluator acceptance, set commercial pricing, influence evaluators or submit the bid.",
    ],
  },
  "/product": {
    title: "Product | BidBox",
    description:
      "Explore BidBox's evidence-led tender workspaces for intake, cited requirements, evidence, BOQ checks, issues, reports and audit.",
    heading: "A controlled workspace for evidence-heavy pursuits.",
  },
  "/solutions": {
    title: "Solutions | BidBox",
    description:
      "BidBox supports bid, compliance and advisory teams with source-backed tender workflows and controlled human review.",
    heading: "The same evidence record, shaped for each responsibility.",
  },
  "/how-it-works": {
    title: "How it works | BidBox",
    description:
      "Follow BidBox's controlled path from NDA-gated intake to cited requirements, evidence, review, approval and audit-ready release.",
    heading: "A review process with explicit gates.",
  },
  "/security": {
    title: "Security | BidBox",
    description:
      "Understand BidBox's tenant, input-security, provider-readiness, audit and human-authority controls.",
    heading: "Controls that are visible when they matter.",
  },
  "/about": {
    title: "About | BidBox",
    description:
      "BidBox is building an evidence-led tender operating system for Nigerian and regulated-market bid teams.",
    heading: "Better tender operations begin with a better record.",
  },
  "/contact": {
    title: "Contact | BidBox",
    description:
      "Request a BidBox Bid Autopsy without sending tender documents or sensitive commercial information through the public form.",
    heading: "Request a Bid Autopsy.",
  },
  "/request-bid-autopsy": {
    title: "Request a Bid Autopsy | BidBox",
    description:
      "Tell BidBox about your bid context without uploading tender documents or sensitive commercial information. The first-contact request is reviewed before any approved document-sharing step.",
    heading: "Request a Bid Autopsy.",
    summary: [
      "Use this first-contact request to share only the minimum information needed to discuss scope. Do not include tender documents, pricing, credentials or other sensitive bid content.",
      "Submitting a request does not create an engagement or promise an award, evaluator acceptance, service scope or response time.",
    ],
  },
  "/privacy": {
    title: "Privacy | BidBox",
    description:
      "How this BidBox web experience handles public enquiries, account identity and tender-workspace information.",
    heading: "Privacy notice",
  },
  "/terms": {
    title: "Terms | BidBox",
    description:
      "Plain-language boundaries for using the BidBox public site and controlled tender workspace.",
    heading: "Service terms notice",
  },
} as const satisfies Readonly<Record<string, PublicPageMetadata>>;

type PublicWebPath = keyof typeof PUBLIC_WEB_PAGES;

function resolvePublicWebPath(pathname: string): PublicWebPath | undefined {
  switch (pathname) {
    case "/":
      return "/";
    case "/product":
      return "/product";
    case "/solutions":
      return "/solutions";
    case "/how-it-works":
      return "/how-it-works";
    case "/security":
      return "/security";
    case "/about":
      return "/about";
    case "/contact":
      return "/contact";
    case "/request-bid-autopsy":
      return "/request-bid-autopsy";
    case "/privacy":
      return "/privacy";
    case "/terms":
      return "/terms";
    default:
      return undefined;
  }
}

const ACCESS_WEB_PATHS = new Set([
  "/sign-in",
  "/accept-invitation",
  "/sso-callback",
]);

const PROTECTED_WEB_PREFIXES = [
  "/app",
  "/dashboard",
  "/clients",
  "/projects",
  "/intelligence",
  "/sbd",
  "/operations",
  "/portal",
  "/partner",
  "/evidence-readiness",
  "/reports",
  "/billing",
  "/notifications",
  "/organisation-settings",
  "/settings",
  "/account",
] as const;

export const WEB_APP_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' https://challenges.cloudflare.com https://*.protect.clerk.com",
  "connect-src 'self' https://clerk-telemetry.com https://*.clerk-telemetry.com https://*.protect.clerk.com",
  "img-src 'self' data: blob: https://img.clerk.com",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "frame-src 'self' https://challenges.cloudflare.com https://*.protect.clerk.com",
  "manifest-src 'self'",
].join("; ");

function setWebAppHeaders(response: Response): void {
  response.setHeader(
    "Content-Security-Policy",
    WEB_APP_CONTENT_SECURITY_POLICY,
  );
}

export function isIndexablePublicWebPath(pathname: string): boolean {
  return resolvePublicWebPath(pathname) !== undefined;
}

export function isApplicationWebPath(pathname: string): boolean {
  return (
    ACCESS_WEB_PATHS.has(pathname) ||
    PROTECTED_WEB_PREFIXES.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    )
  );
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function replaceNamedMeta(
  document: string,
  attribute: "name" | "property",
  key: string,
  content: string,
): string {
  const pattern = new RegExp(
    `<meta\\s+${attribute}="${key}"\\s+content="[^"]*"\\s*\\/?>`,
    "i",
  );
  const replacement = `<meta ${attribute}="${key}" content="${escapeHtml(content)}" />`;
  return pattern.test(document)
    ? document.replace(pattern, replacement)
    : document.replace("</head>", `${replacement}\n</head>`);
}

function replaceCanonical(document: string, canonicalUrl: string): string {
  const pattern = /<link\s+rel="canonical"\s+href="[^"]*"\s*\/>/i;
  const replacement = `<link rel="canonical" href="${escapeHtml(canonicalUrl)}" />`;
  return pattern.test(document)
    ? document.replace(pattern, replacement)
    : document.replace("</head>", `${replacement}\n</head>`);
}

export function isCanonicalPublicRequest(request: Request): boolean {
  const host = request.get("host");
  if (!host) return false;
  try {
    return (
      new URL(`${request.protocol}://${host}`).origin === PUBLIC_SITE_ORIGIN
    );
  } catch {
    return false;
  }
}

function renderIndexDocument(
  indexTemplate: string,
  publicPath: PublicWebPath | undefined,
  applicationPath: boolean,
  allowIndexing: boolean,
): string {
  const page: PublicPageMetadata | undefined =
    publicPath === undefined ? undefined : PUBLIC_WEB_PAGES[publicPath];
  const publicPage = page !== undefined;
  const indexable = publicPage && allowIndexing;
  const metadata = page ?? {
    title: applicationPath
      ? "Secure workspace | BidBox"
      : "Page not found | BidBox",
    description: applicationPath
      ? "Authorised access to the BidBox tender workspace."
      : "The requested BidBox page could not be found.",
    heading: "",
  };
  const canonicalUrl =
    publicPath === undefined
      ? undefined
      : `${PUBLIC_SITE_ORIGIN}${publicPath === "/" ? "/" : publicPath}`;

  let document = indexTemplate.replace(
    /<title>[\s\S]*?<\/title>/i,
    `<title>${escapeHtml(metadata.title)}</title>`,
  );
  document = replaceNamedMeta(
    document,
    "name",
    "description",
    metadata.description,
  );
  document = replaceNamedMeta(
    document,
    "name",
    "robots",
    indexable ? "index, follow" : "noindex, nofollow",
  );
  document = replaceNamedMeta(document, "property", "og:title", metadata.title);
  document = replaceNamedMeta(
    document,
    "property",
    "og:description",
    metadata.description,
  );
  document = replaceNamedMeta(
    document,
    "name",
    "twitter:title",
    metadata.title,
  );
  document = replaceNamedMeta(
    document,
    "name",
    "twitter:description",
    metadata.description,
  );

  if (indexable && canonicalUrl !== undefined) {
    document = replaceCanonical(document, canonicalUrl);
    document = replaceNamedMeta(document, "property", "og:url", canonicalUrl);
  } else {
    document = document
      .replace(/\s*<link\s+rel="canonical"\s+href="[^"]*"\s*\/>/i, "")
      .replace(/\s*<meta\s+property="og:url"\s+content="[^"]*"\s*\/>/i, "");
  }

  if (publicPage) {
    const staticPublicContent = [
      '<div id="root">',
      '<main data-public-prerender="true">',
      '<nav aria-label="Public navigation">',
      '<a href="/">BidBox home</a> ',
      '<a href="/product">Product</a> ',
      '<a href="/solutions">Solutions</a> ',
      '<a href="/how-it-works">How it works</a> ',
      '<a href="/security">Security</a> ',
      '<a href="/about">About</a> ',
      '<a href="/contact">Contact</a> ',
      '<a href="/request-bid-autopsy">Request a Bid Autopsy</a> ',
      '<a href="/sign-in">Sign in</a>',
      "</nav>",
      `<h1>${escapeHtml(metadata.heading)}</h1>`,
      `<p>${escapeHtml(metadata.description)}</p>`,
      ...(
        metadata.summary ?? [
          "BidBox supports source-cited requirements, evidence-grounded actions, deterministic checks and named human review. It does not guarantee contract awards or invent credentials, claims or prices.",
        ]
      ).map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`),
      "</main>",
      "</div>",
    ].join("");
    document = document.replace('<div id="root"></div>', staticPublicContent);
  }

  return document;
}

export function registerProductionWebApp(
  app: Express,
  publicDirectory = path.resolve(
    import.meta.dirname,
    "../../bidbox-workbench/dist/public",
  ),
): void {
  const indexPath = path.join(publicDirectory, "index.html");

  if (!existsSync(indexPath)) {
    throw new Error(
      "Production workbench artifact is missing. Build @workspace/bidbox-workbench before starting the API.",
    );
  }
  const indexTemplate = readFileSync(indexPath, "utf8");

  app.use((request: Request, response: Response, next: NextFunction): void => {
    if (!isCanonicalPublicRequest(request)) {
      response.setHeader("X-Robots-Tag", "noindex, nofollow");
    }
    next();
  });

  app.use(
    express.static(publicDirectory, {
      index: false,
      setHeaders(response, filePath) {
        setWebAppHeaders(response);
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          response.setHeader(
            "Cache-Control",
            "public, max-age=31536000, immutable",
          );
        } else {
          response.setHeader("Cache-Control", "no-cache");
        }
        if (path.basename(filePath) === "index.html") {
          response.setHeader("X-Robots-Tag", "noindex, nofollow");
        }
      },
    }),
  );

  app.use((request: Request, response: Response, next: NextFunction): void => {
    if (
      (request.method !== "GET" && request.method !== "HEAD") ||
      request.path === "/api" ||
      request.path.startsWith("/api/")
    ) {
      next();
      return;
    }

    const publicPath = resolvePublicWebPath(request.path);
    const publicPage = publicPath !== undefined;
    const indexable = publicPage && isCanonicalPublicRequest(request);
    const applicationPath = isApplicationWebPath(request.path);
    if (!indexable) {
      response.setHeader("X-Robots-Tag", "noindex, nofollow");
    }
    setWebAppHeaders(response);
    response.setHeader("Cache-Control", "no-cache");
    response
      .status(publicPage || applicationPath ? 200 : 404)
      .type("html")
      .send(
        renderIndexDocument(
          indexTemplate,
          publicPath,
          applicationPath,
          indexable,
        ),
      );
  });
}
