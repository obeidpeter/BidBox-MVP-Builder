import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Route, Switch, useLocation } from "wouter";
import LandingPage from "@/pages/landing";

const RequestBidAutopsyPage = lazy(() => import("@/pages/request-bid-autopsy"));

const ProductPage = lazy(() =>
  import("@/pages/public-pages").then((module) => ({
    default: module.ProductPage,
  })),
);
const SolutionsPage = lazy(() =>
  import("@/pages/public-pages").then((module) => ({
    default: module.SolutionsPage,
  })),
);
const HowItWorksPage = lazy(() =>
  import("@/pages/public-pages").then((module) => ({
    default: module.HowItWorksPage,
  })),
);
const SecurityPage = lazy(() =>
  import("@/pages/public-pages").then((module) => ({
    default: module.SecurityPage,
  })),
);
const AboutPage = lazy(() =>
  import("@/pages/public-pages").then((module) => ({
    default: module.AboutPage,
  })),
);
const ContactPage = lazy(() =>
  import("@/pages/public-pages").then((module) => ({
    default: module.ContactPage,
  })),
);
const PrivacyPage = lazy(() =>
  import("@/pages/public-pages").then((module) => ({
    default: module.PrivacyPage,
  })),
);
const TermsPage = lazy(() =>
  import("@/pages/public-pages").then((module) => ({
    default: module.TermsPage,
  })),
);
const PublicNotFoundPage = lazy(() =>
  import("@/pages/public-pages").then((module) => ({
    default: module.PublicNotFoundPage,
  })),
);

function PublicRouteFallback() {
  return (
    <div
      className="content-shell flex min-h-[50vh] items-center py-16"
      role="status"
      aria-live="polite"
    >
      <p className="text-sm text-muted-foreground">Loading page...</p>
    </div>
  );
}

function PublicRouteFocusManager() {
  const [location] = useLocation();
  const initialLocationRef = useRef(true);
  const lastHeadingRef = useRef<HTMLElement | null>(null);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    if (initialLocationRef.current) {
      initialLocationRef.current = false;
      lastHeadingRef.current =
        document.querySelector<HTMLElement>("#public-main h1");
      const initialHeadingFrame = window.requestAnimationFrame(() => {
        lastHeadingRef.current =
          document.querySelector<HTMLElement>("#public-main h1");
      });
      return () => window.cancelAnimationFrame(initialHeadingFrame);
    }

    let observer: MutationObserver | null = null;
    let timeoutId: number | null = null;
    const focusMainHeading = () => {
      const heading = document.querySelector<HTMLElement>("#public-main h1");
      if (!heading || heading === lastHeadingRef.current) return false;
      heading.tabIndex = -1;
      heading.focus();
      lastHeadingRef.current = heading;
      const headingText = heading.textContent?.trim() || "Page";
      setAnnouncement(`Navigated to ${headingText}.`);
      observer?.disconnect();
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      return true;
    };

    if (!focusMainHeading()) {
      observer = new MutationObserver(() => focusMainHeading());
      observer.observe(document.body, { childList: true, subtree: true });
      timeoutId = window.setTimeout(() => observer?.disconnect(), 5_000);
    }

    return () => {
      observer?.disconnect();
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    };
  }, [location]);

  return (
    <p
      className="sr-only"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      id="public-route-announcement"
    >
      {announcement}
    </p>
  );
}

export default function SignedOutRoutes() {
  return (
    <>
      <PublicRouteFocusManager />
      <Suspense fallback={<PublicRouteFallback />}>
        <Switch>
          <Route path="/" component={LandingPage} />
          <Route
            path="/request-bid-autopsy"
            component={RequestBidAutopsyPage}
          />
          <Route path="/product" component={ProductPage} />
          <Route path="/solutions" component={SolutionsPage} />
          <Route path="/how-it-works" component={HowItWorksPage} />
          <Route path="/security" component={SecurityPage} />
          <Route path="/about" component={AboutPage} />
          <Route path="/contact" component={ContactPage} />
          <Route path="/privacy" component={PrivacyPage} />
          <Route path="/terms" component={TermsPage} />
          <Route component={PublicNotFoundPage} />
        </Switch>
      </Suspense>
    </>
  );
}
