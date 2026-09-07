import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

import {
  GlobalCommand,
  type ShellNavigationItem,
} from "@/components/global-command";

vi.mock("@workspace/api-client-react", () => ({
  getListProjectsQueryKey: () => ["/api/projects"],
  useListProjects: () => ({
    data: [],
    isError: false,
    isLoading: false,
  }),
}));

describe("GlobalCommand", () => {
  it("finds and opens the in-platform user manual", async () => {
    const user = userEvent.setup();
    const location = memoryLocation({ path: "/app", record: true });
    const navigation: ShellNavigationItem[] = [
      {
        href: "/help",
        label: "Help & user manual",
        group: "Support",
        state: "active",
      },
    ];

    render(
      <Router hook={location.hook}>
        <GlobalCommand navigation={navigation} />
      </Router>,
    );

    await user.click(
      screen.getByRole("button", { name: "Search pages and pursuits" }),
    );
    await user.type(
      screen.getByPlaceholderText("Search pages or a pursuit"),
      "manual",
    );
    await user.click(
      screen.getByRole("button", { name: /help & user manual/i }),
    );

    expect(location.history.at(-1)).toBe("/help");
  });
});
