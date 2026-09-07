import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

import { ProtectedRouteAccessibility } from "@/components/protected-route-accessibility";

describe("ProtectedRouteAccessibility", () => {
  it("sets private metadata for the in-platform manual", async () => {
    const { hook } = memoryLocation({ path: "/help", record: true });
    render(
      <Router hook={hook}>
        <main id="main-content" tabIndex={-1}>
          <ProtectedRouteAccessibility />
        </main>
      </Router>,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "Opened Help & user manual",
    );
    await waitFor(() => {
      expect(document.title).toBe("Help & user manual | BidBox");
    });
    expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute(
      "content",
      "noindex, nofollow",
    );
  });

  it("sets a route-specific private title, announces the tab and focuses main", async () => {
    const { hook } = memoryLocation({
      path: "/projects/11111111-1111-4111-8111-111111111111?tab=requirements",
      record: true,
    });
    render(
      <Router hook={hook}>
        <main id="main-content" tabIndex={-1}>
          <ProtectedRouteAccessibility />
        </main>
      </Router>,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "Opened Requirements · Pursuit",
    );
    await waitFor(() => {
      expect(document.title).toBe("Requirements · Pursuit | BidBox");
      expect(document.activeElement).toBe(
        document.getElementById("main-content"),
      );
    });
    expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute(
      "content",
      "noindex, nofollow",
    );
  });
});
