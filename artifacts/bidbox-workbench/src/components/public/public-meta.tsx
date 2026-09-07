import { useEffect } from "react";

export const APPROVED_PUBLIC_ORIGIN = "https://valo-mvp-builder.replit.app";

function setMeta(name: string, content: string, property = false) {
  const selector = property
    ? `meta[property="${name}"]`
    : `meta[name="${name}"]`;
  let node = document.head.querySelector<HTMLMetaElement>(selector);
  if (!node) {
    node = document.createElement("meta");
    node.setAttribute(property ? "property" : "name", name);
    document.head.appendChild(node);
  }
  node.content = content;
}

function removeMeta(name: string, property = false) {
  const selector = property
    ? `meta[property="${name}"]`
    : `meta[name="${name}"]`;
  document.head.querySelector(selector)?.remove();
}

export function isApprovedPublicOrigin(origin: string): boolean {
  try {
    return new URL(origin).origin === APPROVED_PUBLIC_ORIGIN;
  } catch {
    return false;
  }
}

export function PublicMeta({
  title,
  description,
  path,
  index = true,
}: {
  title: string;
  description: string;
  path: string;
  index?: boolean;
}) {
  useEffect(() => {
    const fullTitle = title === "Valo" ? title : `${title} | Valo`;
    document.title = fullTitle;
    setMeta("description", description);
    setMeta("og:title", fullTitle, true);
    setMeta("og:description", description, true);
    setMeta("twitter:title", fullTitle);
    setMeta("twitter:description", description);
    const canIndex = index && isApprovedPublicOrigin(window.location.origin);
    setMeta("robots", canIndex ? "index, follow" : "noindex, nofollow");

    if (canIndex) {
      const canonicalUrl = new URL(path, APPROVED_PUBLIC_ORIGIN).href;
      setMeta("og:url", canonicalUrl, true);
      let canonical = document.head.querySelector<HTMLLinkElement>(
        'link[rel="canonical"]',
      );
      if (!canonical) {
        canonical = document.createElement("link");
        canonical.rel = "canonical";
        document.head.appendChild(canonical);
      }
      canonical.href = canonicalUrl;
    } else {
      removeMeta("og:url", true);
      document.head.querySelector('link[rel="canonical"]')?.remove();
    }
  }, [description, index, path, title]);

  return null;
}
