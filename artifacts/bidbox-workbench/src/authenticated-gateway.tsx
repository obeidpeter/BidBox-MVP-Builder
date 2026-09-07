import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import {
  ClerkProvider,
  SignedIn,
  SignedOut,
  useAuth,
} from "@clerk/clerk-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Redirect } from "wouter";
import AccessRoutes from "@/access-routes";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";

const ProtectedApp = lazy(() => import("@/protected-app"));

function createWorkspaceQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
      },
    },
  });
}

function WorkspaceLoading() {
  return (
    <div
      className="flex min-h-screen items-center justify-center bg-background p-6"
      role="status"
    >
      <div className="text-center">
        <span
          aria-hidden="true"
          className="mx-auto block size-7 animate-spin rounded-full border-2 border-primary border-r-transparent"
        />
        <p className="mt-4 text-sm text-muted-foreground">
          Opening your workspace…
        </p>
      </div>
    </div>
  );
}

/**
 * A query client belongs to exactly one Clerk user/session pair. Replacing the
 * provider synchronously on either identifier changing prevents a newly active
 * identity from observing data cached for the previous identity. The cleanup
 * also cancels and clears the retired client; organisation switching continues
 * to clear tenant-scoped records within the current identity's client.
 */
export function IdentityBoundQueryProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { isLoaded, isSignedIn, userId, sessionId } = useAuth();
  const identityKey =
    isLoaded && isSignedIn && userId && sessionId
      ? `${userId}:${sessionId}`
      : null;

  if (!identityKey) return <WorkspaceLoading />;

  return <IdentityQueryScope key={identityKey}>{children}</IdentityQueryScope>;
}

function IdentityQueryScope({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createWorkspaceQueryClient);

  useEffect(
    () => () => {
      void queryClient.cancelQueries();
      queryClient.clear();
    },
    [queryClient],
  );

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function MissingIdentityConfiguration() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-5">
      <section className="w-full max-w-lg rounded-lg border border-destructive/35 bg-card p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-destructive">
          Sign-in setup needed
        </p>
        <h1 className="mt-3 text-xl font-semibold">Sign-in is not available</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Valo's sign-in service has not been set up. To protect your data, the
          app will remain locked until it can verify your identity.
        </p>
      </section>
    </main>
  );
}

export default function AuthenticatedGateway({
  accessRoute,
  requestedLocation,
}: {
  accessRoute: boolean;
  requestedLocation: string;
}) {
  const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

  if (!publishableKey) return <MissingIdentityConfiguration />;

  return (
    <ClerkProvider
      publishableKey={publishableKey}
      proxyUrl={
        import.meta.env.PROD
          ? "/api/__clerk"
          : import.meta.env.VITE_CLERK_PROXY_URL
      }
    >
      <TooltipProvider>
        {accessRoute ? (
          <>
            <SignedIn>
              <Redirect to="/app" />
            </SignedIn>
            <SignedOut>
              <AccessRoutes />
            </SignedOut>
          </>
        ) : (
          <>
            <SignedIn>
              <IdentityBoundQueryProvider>
                <Suspense fallback={<WorkspaceLoading />}>
                  <ProtectedApp />
                </Suspense>
              </IdentityBoundQueryProvider>
            </SignedIn>
            <SignedOut>
              <Redirect
                to={`/sign-in?redirect_url=${encodeURIComponent(requestedLocation)}`}
              />
            </SignedOut>
          </>
        )}
        <Toaster />
      </TooltipProvider>
    </ClerkProvider>
  );
}
