import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import AccessRoutes from "./access-routes";

vi.mock("@clerk/clerk-react", () => ({
  AuthenticateWithRedirectCallback: () => <div>Identity callback</div>,
  ClerkLoaded: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ClerkLoading: () => null,
  SignIn: () => <div>Provider sign in</div>,
  SignUp: () => <div>Provider invitation activation</div>,
}));

function renderAt(path: string) {
  const { hook } = memoryLocation({ path, record: true });
  return render(
    <Router hook={hook}>
      <AccessRoutes />
    </Router>,
  );
}

describe("provider-backed access routes", () => {
  it("renders the invitation-only sign-in entry", () => {
    renderAt("/sign-in");
    expect(
      screen.getByRole("heading", {
        name: "Sign in to your Valo workspace.",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Provider sign in")).toBeInTheDocument();
    expect(screen.getByText(/valo is invitation-only/i)).toBeInTheDocument();
    expect(
      screen.getByText(/signing in does not give access by itself/i),
    ).toBeInTheDocument();
  });

  it("renders invitation activation without opening an unrestricted registration route", () => {
    renderAt("/accept-invitation");
    expect(
      screen.getByText("Provider invitation activation"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /accept your valo invitation/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/organisation membership and role/i),
    ).toBeInTheDocument();
  });

  it("renders the identity-provider callback", () => {
    renderAt("/sso-callback");
    expect(
      screen.getByRole("heading", { name: /finishing sign-in/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("Identity callback")).toBeInTheDocument();
  });
});
