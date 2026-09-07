import { useEffect, useRef } from "react";
import { useLocation, useSearchParams } from "wouter";

import { applyPrivateDocumentMetadata } from "@/lib/private-document-metadata";
import { getProtectedRouteContext } from "@/lib/protected-route-context";

export function ProtectedRouteAccessibility() {
  const [location] = useLocation();
  const [searchParams] = useSearchParams();
  const search = searchParams.toString();
  const context = getProtectedRouteContext(
    location,
    new URLSearchParams(search),
  );
  const fallbackFocusRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    applyPrivateDocumentMetadata(`${context.title} | BidBox`);
    const target =
      document.getElementById("main-content") ?? fallbackFocusRef.current;
    target?.focus();
  }, [context.title, location]);

  return (
    <>
      <span
        ref={fallbackFocusRef}
        tabIndex={-1}
        className="sr-only"
        aria-hidden="true"
      />
      <p
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        Opened {context.title}
      </p>
    </>
  );
}
