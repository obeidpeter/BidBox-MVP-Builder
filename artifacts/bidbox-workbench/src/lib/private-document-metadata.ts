export const PRIVATE_ROBOTS_DIRECTIVE = "noindex, nofollow";

export function applyPrivateDocumentMetadata(title: string): void {
  document.title = title;

  let robots = document.head.querySelector<HTMLMetaElement>(
    'meta[name="robots"]',
  );
  if (!robots) {
    robots = document.createElement("meta");
    robots.name = "robots";
    document.head.appendChild(robots);
  }
  robots.content = PRIVATE_ROBOTS_DIRECTIVE;

  document.head.querySelector('link[rel="canonical"]')?.remove();
  document.head.querySelector('meta[property="og:url"]')?.remove();
}
