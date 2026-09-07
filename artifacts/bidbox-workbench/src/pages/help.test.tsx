import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

import HelpPage from "@/pages/help";

vi.mock("@/contexts/organisation-context", () => ({
  useOrganisationAccess: () => ({
    activeOrganisation: {
      id: "org-test",
      name: "Test organisation",
      accessSource: "membership" as const,
    },
    effectiveRoles: ["reviewer"],
    effectivePermissions: [
      "analytics:read",
      "client:read",
      "document:read",
      "requirement:read",
      "evidence:read",
      "project:read",
      "report:read",
    ],
  }),
}));

function renderHelp(path = "/help") {
  const location = memoryLocation({ path, record: true });
  return {
    ...render(
      <Router hook={location.hook}>
        <HelpPage />
      </Router>,
    ),
    location,
  };
}

describe("HelpPage", () => {
  it("renders the complete release-matched manual without tenant records", () => {
    renderHelp();

    expect(
      screen.getByRole("heading", { level: 1, name: "Help & user manual" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "Private, release-matched guidance",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/a plain-language guide to the application/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "22 topics in this manual",
    );
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: /why is this blocked/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "/projects" })).toHaveAttribute(
      "href",
      "/projects",
    );
    expect(
      screen.queryByRole("link", { name: "/portal" }),
    ).not.toBeInTheDocument();
  });

  it("filters by task text, reports an empty result, and clears safely", async () => {
    const user = userEvent.setup();
    renderHelp();
    const search = screen.getByRole("searchbox", {
      name: "Search help and user manual",
    });

    await user.type(search, "WIPE MY DRAFTS");
    expect(screen.getByRole("status")).toHaveTextContent("1 topic found");
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: /field companion.*offline notes/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", {
        level: 2,
        name: /the dashboard/i,
      }),
    ).not.toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "not-a-real-bidbox-topic-93763526");
    expect(
      screen.getByRole("heading", { name: "No help topic matched" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear search" }));
    expect(search).toHaveValue("");
    expect(screen.getByRole("status")).toHaveTextContent(
      "22 topics in this manual",
    );
  });

  it("clears a filter before opening a topic that it hid", async () => {
    const user = userEvent.setup();
    const { location } = renderHelp();
    const search = screen.getByRole("searchbox", {
      name: "Search help and user manual",
    });

    await user.type(search, "WIPE MY DRAFTS");
    expect(
      screen.queryByRole("heading", {
        level: 2,
        name: /quick reference.*statuses and badges/i,
      }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: /decode a status/i }));

    expect(search).toHaveValue("");
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: /quick reference.*statuses and badges/i,
      }),
    ).toBeInTheDocument();
    expect(location.history.at(-1)).toContain(
      "topic=quick-reference-statuses-and-badges",
    );
  });
});
