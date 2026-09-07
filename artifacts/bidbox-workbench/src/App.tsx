import { lazy, Suspense, useEffect } from "react";
import { Router as WouterRouter, useLocation } from "wouter";
import { AppErrorBoundary } from "@/components/app-error-boundary";
import SignedOutRoutes from "@/signed-out-routes";
import { classifyRoute } from "@/lib/route-classification";
import { applyPrivateDocumentMetadata } from "@/lib/private-document-metadata";

const AuthenticatedGateway = lazy(() => import("@/authenticated-gateway"));

function LoadingAccess() {
  return (
    <main
      className="flex min-h-screen items-center justify-center bg-background p-6"
      role="status"
    >
      <p className="text-sm text-muted-foreground">Loading secure sign-in…</p>
    </main>
  );
}

function RoutedExperience() {
  const [location] = useLocation();
  const surface = classifyRoute(location);

  useEffect(() => {
    if (surface !== "public") {
      applyPrivateDocumentMetadata("Secure access | Valo");
    }
  }, [surface]);

  if (surface === "public") return <SignedOutRoutes />;

  return (
    <Suspense fallback={<LoadingAccess />}>
      <AuthenticatedGateway
        accessRoute={surface === "access"}
        requestedLocation={location}
      />
    </Suspense>
  );
}

export default function App() {
  return (
    <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
      <AppErrorBoundary>
        <RoutedExperience />
      </AppErrorBoundary>
    </WouterRouter>
  );
}
