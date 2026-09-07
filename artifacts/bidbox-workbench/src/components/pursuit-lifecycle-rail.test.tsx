import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

import { Tabs } from "@/components/ui/tabs";
import {
  PURSUIT_LIFECYCLE_STAGES,
  PursuitLifecycleRail,
  pursuitRegisterFromSearch,
  type PursuitRegister,
  withPursuitRegister,
} from "@/components/pursuit-lifecycle-rail";

const project = {
  status: "review" as const,
  deadline: "2026-09-12T10:00:00.000Z",
  reviewerName: "Amina Bello",
  submissionStatus: null,
  conflictStatus: "clear" as const,
};

describe("PursuitLifecycleRail", () => {
  it("groups all ten registers into the six lifecycle stages", () => {
    render(
      <Tabs value="evidence">
        <PursuitLifecycleRail
          activeRegister="evidence"
          project={project}
          readiness={{ status: "not_checked" }}
          onSelectRegister={vi.fn()}
        />
      </Tabs>,
    );

    expect(PURSUIT_LIFECYCLE_STAGES.map((stage) => stage.label)).toEqual([
      "Prepare",
      "Analyse",
      "Respond",
      "Review",
      "Deliver",
      "Record",
    ]);
    const registers = PURSUIT_LIFECYCLE_STAGES.flatMap((stage) =>
      stage.registers.map((register) => register.label),
    );
    expect(registers).toEqual([
      "Overview",
      "Documents",
      "Requirements",
      "Evidence",
      "BOQ",
      "Delivery Studio",
      "Defects",
      "Risk",
      "Package & export",
      "Audit",
    ]);
    expect(new Set(registers).size).toBe(10);
    expect(screen.getByText(/Analyse registers/)).toBeInTheDocument();
    for (const label of ["Requirements", "Evidence", "BOQ"]) {
      expect(screen.getByRole("tab", { name: label })).toBeInTheDocument();
    }
    expect(
      screen.queryByRole("tab", { name: "Documents" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "View Analyse stage registers" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Viewing stage: Analyse")).toBeInTheDocument();
    expect(
      screen.getByText(/does not record a separate current lifecycle stage/i),
    ).toBeInTheDocument();
  });

  it("uses stage shortcuts without changing recorded project phase", async () => {
    const user = userEvent.setup();
    const onSelectRegister = vi.fn();
    function ControlledLifecycle() {
      const [activeRegister, setActiveRegister] =
        useState<PursuitRegister>("overview");
      return (
        <Tabs value={activeRegister}>
          <PursuitLifecycleRail
            activeRegister={activeRegister}
            project={project}
            readiness={{ status: "not_checked" }}
            onSelectRegister={(register) => {
              onSelectRegister(register);
              setActiveRegister(register);
            }}
          />
        </Tabs>
      );
    }
    render(<ControlledLifecycle />);

    await user.click(
      screen.getByRole("button", { name: "View Analyse stage registers" }),
    );
    expect(onSelectRegister).toHaveBeenCalledWith("requirements");
    expect(
      screen.getByRole("tab", { name: "Requirements" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Evidence" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "BOQ" })).toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: "Documents" }),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "View Review stage registers" }),
    );
    expect(screen.getByRole("tab", { name: "Defects" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Risk" })).toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: "Requirements" }),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "View Respond stage registers" }),
    );
    expect(onSelectRegister).toHaveBeenLastCalledWith("delivery");
    expect(
      screen.getByRole("tab", { name: "Delivery Studio" }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "View Deliver stage registers" }),
    );
    expect(onSelectRegister).toHaveBeenLastCalledWith("reports");
    expect(
      screen.getByRole("tab", { name: "Package & export" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/recorded project status: review/i),
    ).toBeInTheDocument();
  });

  it("shows the known reviewer without inventing a stage owner or export receipt", () => {
    render(
      <Tabs value="defects">
        <PursuitLifecycleRail
          activeRegister="defects"
          project={{ ...project, status: "exported" }}
          readiness={{ status: "error" }}
          onSelectRegister={vi.fn()}
        />
      </Tabs>,
    );

    expect(screen.getByText("Stage owner not recorded")).toBeInTheDocument();
    expect(
      screen.getByText("Named project reviewer: Amina Bello"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /export is recorded\. export is not proof that a buyer received/i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/no readiness verdict is being inferred/i),
    ).toBeInTheDocument();
  });
});

describe("pursuit register query routing", () => {
  it("preserves valid deep links and defaults invalid values to overview", () => {
    expect(pursuitRegisterFromSearch(new URLSearchParams("tab=delivery"))).toBe(
      "delivery",
    );
    expect(pursuitRegisterFromSearch(new URLSearchParams("tab=unknown"))).toBe(
      "overview",
    );
  });

  it("preserves unrelated query parameters when changing registers", () => {
    const selected = withPursuitRegister(
      new URLSearchParams("view=compact&tab=evidence"),
      "risk",
    );
    expect(selected.get("view")).toBe("compact");
    expect(selected.get("tab")).toBe("risk");

    const overview = withPursuitRegister(selected, "overview");
    expect(overview.get("view")).toBe("compact");
    expect(overview.has("tab")).toBe(false);
  });
});
