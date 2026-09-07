import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import OpportunityIntake from "./opportunity-intake";
import SubmissionWarRoom from "./submission-war-room";

describe("operations suite guardrails", () => {
  it("does not render unsafe source schemes as external actions", () => {
    render(
      <OpportunityIntake
        opportunities={[
          {
            id: "unsafe-opportunity",
            title: "Untrusted notice",
            buyer: "Unknown buyer",
            reference: "UNKNOWN",
            sourceType: "manual_url",
            sourceLabel: "Untrusted pasted value",
            sourceUrl: "javascript:alert(1)",
            deadline: null,
            provenance: "Not yet verified.",
            status: "needs_confirmation",
          },
        ]}
        onConfirm={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole("link", { name: /Open original source/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Confirm source and deadline" }),
    ).toBeInTheDocument();
  });

  it("blocks package freezing until every rendered check passes", async () => {
    const onFreeze = vi.fn();
    const view = render(
      <SubmissionWarRoom
        packages={[
          {
            id: "package-blocked",
            name: "Commercial submission",
            version: "v2",
            sha256: "b".repeat(64),
            status: "draft",
            copyCount: 1,
            deliveryMethod: "hand_delivery",
            qaChecks: [
              {
                id: "qa-failed",
                label: "Clipped tables",
                detail: "One pricing table is clipped.",
                status: "fail",
              },
            ],
          },
        ]}
        onFreezePackage={onFreeze}
      />,
    );

    const freeze = screen.getByRole("button", { name: "Freeze package hash" });
    expect(freeze).toBeDisabled();
    expect(
      screen.getByRole("note", { name: "Package freeze blocked" }),
    ).toHaveTextContent(/must pass/i);

    view.rerender(
      <SubmissionWarRoom
        packages={[
          {
            id: "package-blocked",
            name: "Commercial submission",
            version: "v3",
            sha256: "c".repeat(64),
            status: "draft",
            copyCount: 1,
            deliveryMethod: "hand_delivery",
            qaChecks: [
              {
                id: "qa-passed",
                label: "Clipped tables",
                detail: "No clipped tables were found.",
                status: "pass",
              },
            ],
          },
        ]}
        onFreezePackage={onFreeze}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Freeze package hash" }),
    );
    expect(onFreeze).toHaveBeenCalledWith("package-blocked");
  });

  it("keeps section loading, error and empty states semantically distinct", async () => {
    const retry = vi.fn();
    const view = render(
      <OpportunityIntake opportunities={[]} state="loading" />,
    );
    expect(
      screen.getByText("Loading opportunity records and source details"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", {
        name: "No opportunities have been recorded",
      }),
    ).not.toBeInTheDocument();

    view.rerender(
      <OpportunityIntake
        opportunities={[]}
        state="error"
        error="Authorised source unavailable."
        onRetry={retry}
      />,
    );
    expect(
      screen.getByRole("heading", {
        name: "Opportunity intake could not be loaded",
      }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);

    view.rerender(<OpportunityIntake opportunities={[]} />);
    expect(
      screen.getByRole("heading", {
        name: "No opportunities have been recorded",
      }),
    ).toBeInTheDocument();
  });
});
