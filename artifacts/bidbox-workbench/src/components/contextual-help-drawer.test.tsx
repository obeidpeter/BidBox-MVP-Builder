import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

import { ContextualHelpDrawer } from "@/components/contextual-help-drawer";

describe("ContextualHelpDrawer", () => {
  it("explains the active project register and its missing permission", async () => {
    const user = userEvent.setup();
    const { hook } = memoryLocation({
      path: "/projects/11111111-1111-4111-8111-111111111111?tab=evidence",
      record: true,
    });
    render(
      <Router hook={hook}>
        <ContextualHelpDrawer
          location="/projects/11111111-1111-4111-8111-111111111111"
          roles={["reviewer"]}
          permissions={["project:read", "requirement:read"]}
          accessSource="membership"
        />
      </Router>,
    );

    await user.click(
      screen.getByRole("button", {
        name: /open help for evidence and compliance register/i,
      }),
    );

    expect(
      screen.getByRole("heading", { name: "Evidence and compliance register" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Reviewer · membership access"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/missing required permission: evidence:read/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Key terms" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Example" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Exact next action" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /open the full user manual/i }),
    ).toHaveAttribute(
      "href",
      "/help?topic=pursuits-the-register-and-the-workspace#pursuits-the-register-and-the-workspace",
    );
    expect(
      screen.getByRole("link", { name: /open the full user manual/i }),
    ).toHaveAttribute("target", "_blank");
  });

  it("reports Delivery Studio available for the server-authorised read set", async () => {
    const user = userEvent.setup();
    const { hook } = memoryLocation({
      path: "/projects/11111111-1111-4111-8111-111111111111?tab=delivery",
      record: true,
    });
    render(
      <Router hook={hook}>
        <ContextualHelpDrawer
          location="/projects/11111111-1111-4111-8111-111111111111"
          roles={["reviewer"]}
          permissions={[
            "project:read",
            "draft:read",
            "defect:read",
            "package:read",
          ]}
          accessSource="membership"
        />
      </Router>,
    );

    await user.click(
      screen.getByRole("button", {
        name: /open help for delivery studio/i,
      }),
    );

    expect(screen.getByText("Available")).toBeInTheDocument();
    expect(
      screen.queryByText(/missing required permission/i),
    ).not.toBeInTheDocument();
  });

  it("reports Delivery Studio blocked when defect read authority is absent", async () => {
    const user = userEvent.setup();
    const { hook } = memoryLocation({
      path: "/projects/11111111-1111-4111-8111-111111111111?tab=delivery",
      record: true,
    });
    render(
      <Router hook={hook}>
        <ContextualHelpDrawer
          location="/projects/11111111-1111-4111-8111-111111111111"
          roles={["reviewer"]}
          permissions={[
            "project:read",
            "draft:read",
            "package:read",
            "evaluation:read",
          ]}
          accessSource="membership"
        />
      </Router>,
    );

    await user.click(
      screen.getByRole("button", {
        name: /open help for delivery studio/i,
      }),
    );

    expect(screen.getByText("Access required")).toBeInTheDocument();
    expect(
      screen.getByText(/missing required permission: defect:read/i),
    ).toBeInTheDocument();
  });
});
