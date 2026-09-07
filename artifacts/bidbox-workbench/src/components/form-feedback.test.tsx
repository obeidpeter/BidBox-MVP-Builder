import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  FieldErrorMessage,
  FormErrorSummary,
  UnsavedChangesAlert,
} from "./form-feedback";

describe("form feedback", () => {
  it("deduplicates persistent form errors and links field feedback", () => {
    render(
      <>
        <FormErrorSummary
          id="summary"
          errors={["Name is required", "Name is required", undefined]}
        />
        <FieldErrorMessage id="name-error">Name is required</FieldErrorMessage>
      </>,
    );

    expect(screen.getAllByRole("alert")).toHaveLength(2);
    expect(screen.getAllByText("Name is required")).toHaveLength(2);
    expect(document.querySelectorAll("#summary li")).toHaveLength(1);
    expect(document.getElementById("name-error")).toHaveAttribute(
      "role",
      "alert",
    );
  });

  it("requires an explicit discard choice for dirty forms", async () => {
    const onDiscard = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <UnsavedChangesAlert
        open
        onDiscard={onDiscard}
        onOpenChange={onOpenChange}
        subject="the client profile"
      />,
    );

    expect(screen.getByText(/client profile/u)).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Discard changes" }),
    );
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });
});
