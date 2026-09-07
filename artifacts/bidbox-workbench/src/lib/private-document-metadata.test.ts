import { beforeEach, describe, expect, it } from "vitest";
import {
  applyPrivateDocumentMetadata,
  PRIVATE_ROBOTS_DIRECTIVE,
} from "./private-document-metadata";

describe("private route metadata", () => {
  beforeEach(() => {
    document.head.innerHTML = `
      <title>Public page</title>
      <meta name="robots" content="index, follow">
      <meta property="og:url" content="https://bidbox.example.test/public">
      <link rel="canonical" href="https://bidbox.example.test/public">
    `;
  });

  it("fails closed before identity or workspace code finishes loading", () => {
    applyPrivateDocumentMetadata("Secure access | BidBox");

    expect(document.title).toBe("Secure access | BidBox");
    expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute(
      "content",
      PRIVATE_ROBOTS_DIRECTIVE,
    );
    expect(document.head.querySelector('link[rel="canonical"]')).toBeNull();
    expect(document.head.querySelector('meta[property="og:url"]')).toBeNull();
  });
});
