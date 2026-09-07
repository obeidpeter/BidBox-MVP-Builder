import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  DataErrorPanel,
  FeatureActivationNotice,
  StateBadge,
  StatusPanel,
} from "./platform-states";

describe("platform state semantics", () => {
  it("announces blocked conditions as alerts with an explicit status label", () => {
    render(
      <StatusPanel
        state="blocked"
        title="Package release blocked"
        description="A fatal requirement is unresolved."
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Package release blocked",
    );
    expect(screen.getByLabelText("Status: Blocked")).toBeInTheDocument();
  });

  it("labels expiry independently of colour", () => {
    render(<StateBadge state="expired" />);
    expect(screen.getByLabelText("Status: Expired")).toHaveAttribute(
      "data-state",
      "expired",
    );
  });

  it("keeps an unavailable commercial action disabled and explains activation", () => {
    render(
      <FeatureActivationNotice
        enabled={false}
        feature="Client portal"
        detail="Commercial activation is pending."
      />,
    );
    const button = screen.getByRole("button", {
      name: "Not available yet",
    });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(/platform administrator/i);
    expect(screen.getByLabelText("Status: Pending")).toBeInTheDocument();
  });

  it("offers a keyboard-operable retry for data errors", () => {
    const retry = vi.fn();
    render(<DataErrorPanel description="The queue failed." onRetry={retry} />);
    screen.getByRole("button", { name: "Try again" }).click();
    expect(retry).toHaveBeenCalledOnce();
  });
});
