import { act, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import {
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IdentityBoundQueryProvider } from "./authenticated-gateway";

const clerkState = vi.hoisted(() => ({
  isLoaded: true,
  isSignedIn: true,
  userId: "user-a" as string | null,
  sessionId: "session-a" as string | null,
}));

vi.mock("@clerk/clerk-react", () => ({
  ClerkProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  SignedIn: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SignedOut: () => null,
  useAuth: () => clerkState,
}));

function CacheProbe({ onClient }: { onClient: (client: QueryClient) => void }) {
  const queryClient = useQueryClient();
  const query = useQuery<string>({
    queryKey: ["tenant-sensitive-record"],
    queryFn: async () => "remote value",
    enabled: false,
  });

  useEffect(() => onClient(queryClient), [onClient, queryClient]);

  return <output>{query.data ?? "No cached tenant data"}</output>;
}

describe("identity-bound query cache", () => {
  beforeEach(() => {
    clerkState.isLoaded = true;
    clerkState.isSignedIn = true;
    clerkState.userId = "user-a";
    clerkState.sessionId = "session-a";
  });

  it("explains that the workspace is opening while identity is still loading", () => {
    clerkState.isLoaded = false;
    clerkState.isSignedIn = false;
    clerkState.userId = null;
    clerkState.sessionId = null;

    render(
      <IdentityBoundQueryProvider>
        <p>Private workspace</p>
      </IdentityBoundQueryProvider>,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "Opening your workspace",
    );
    expect(screen.queryByText("Private workspace")).not.toBeInTheDocument();
  });

  it.each([
    ["a different account", "user-b", "session-b"],
    ["a replacement session", "user-a", "session-b"],
  ])(
    "does not expose cached tenant data to %s",
    async (_label, userId, sessionId) => {
      const clients: QueryClient[] = [];
      const captureClient = (client: QueryClient) => {
        if (!clients.includes(client)) clients.push(client);
      };
      const view = render(
        <IdentityBoundQueryProvider>
          <CacheProbe onClient={captureClient} />
        </IdentityBoundQueryProvider>,
      );

      await waitFor(() => expect(clients).toHaveLength(1));
      const retiredClient = clients[0];
      act(() => {
        retiredClient.setQueryData(
          ["tenant-sensitive-record"],
          "Tenant A secret",
        );
      });
      expect(retiredClient.getQueryData(["tenant-sensitive-record"])).toBe(
        "Tenant A secret",
      );

      clerkState.userId = userId;
      clerkState.sessionId = sessionId;
      view.rerender(
        <IdentityBoundQueryProvider>
          <CacheProbe onClient={captureClient} />
        </IdentityBoundQueryProvider>,
      );

      expect(screen.getByText("No cached tenant data")).toBeInTheDocument();
      await waitFor(() => {
        expect(clients).toHaveLength(2);
        expect(clients[1]).not.toBe(retiredClient);
        expect(
          retiredClient.getQueryData(["tenant-sensitive-record"]),
        ).toBeUndefined();
      });
    },
  );
});
