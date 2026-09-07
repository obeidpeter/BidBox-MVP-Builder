import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DestructiveConfirmation } from "./destructive-confirmation";

describe("DestructiveConfirmation", () => {
  it("keeps the named consequence visible while confirmation is dispatched", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();

    render(
      <DestructiveConfirmation
        open
        onOpenChange={vi.fn()}
        itemName="Tax Clearance 2026"
        title="Permanently delete this evidence item?"
        consequence="This removes its source link. This action cannot be undone."
        confirmLabel="Delete evidence item"
        pendingLabel="Deleting evidence item…"
        pending={false}
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getByRole("alertdialog")).toHaveTextContent(
      "Tax Clearance 2026",
    );
    expect(screen.getByRole("alertdialog")).toHaveTextContent(
      /cannot be undone/i,
    );

    await user.click(
      screen.getByRole("button", { name: "Delete evidence item" }),
    );

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("announces a persistent server error and prevents duplicate submission", () => {
    render(
      <DestructiveConfirmation
        open
        onOpenChange={vi.fn()}
        itemName="Road rehabilitation claim"
        title="Permanently delete this claim?"
        consequence="This removes the claim."
        confirmLabel="Delete claim"
        pendingLabel="Deleting claim…"
        pending
        error="The claim was not deleted."
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "The claim was not deleted.",
    );
    expect(
      screen.getByRole("button", { name: "Deleting claim…" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Keep it" })).toBeDisabled();
  });
});
