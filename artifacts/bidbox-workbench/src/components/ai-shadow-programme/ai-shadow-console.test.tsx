import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AiShadowSnapshot } from "./ai-shadow-contract";
import { AiShadowProgrammeConsole } from "./ai-shadow-console";

type ConsoleProps = Parameters<typeof AiShadowProgrammeConsole>[0];
type MutationCallbacks = Pick<
  ConsoleProps,
  "onCreatePlan" | "onRecordObservation" | "onClosePlan"
>;

const snapshot: AiShadowSnapshot = {
  generatedAt: "2026-08-11T10:00:00.000Z",
  authority: {
    runtimeConnected: true,
    modelExecutionConnected: false,
    providerDisclosureAllowed: false,
    rawOutputPersistenceAllowed: false,
    customerVisible: false,
    productionActivationGranted: false,
    authority: "named_human_governance_review_required",
  },
  plans: [
    {
      plan: {
        id: "10000000-0000-4000-8000-000000000001",
        organisationId: "20000000-0000-4000-8000-000000000002",
        capabilityId: "extract_requirements",
        title: "Current shadow plan",
        purpose: "Verify controlled rejection handling.",
        status: "active",
        version: 1,
        expectedCaseCount: 25,
        expiresAt: "2026-08-31T10:00:00.000Z",
        createdByName: "Named Evaluator",
        createdAt: "2026-08-11T10:00:00.000Z",
        closedByName: null,
        evaluationRecommendation: "not_evaluated",
        customerVisible: false,
        productionActivationGranted: false,
      },
      observationCount: 0,
      coveredCohorts: [],
      blockers: [],
    },
  ],
};

function renderConsole(overrides: Partial<MutationCallbacks> = {}) {
  const callbacks: MutationCallbacks = {
    onCreatePlan:
      overrides.onCreatePlan ??
      vi.fn<MutationCallbacks["onCreatePlan"]>().mockResolvedValue(undefined),
    onRecordObservation:
      overrides.onRecordObservation ??
      vi
        .fn<MutationCallbacks["onRecordObservation"]>()
        .mockResolvedValue(undefined),
    onClosePlan:
      overrides.onClosePlan ??
      vi.fn<MutationCallbacks["onClosePlan"]>().mockResolvedValue(undefined),
  };
  return {
    ...render(
      <AiShadowProgrammeConsole
        snapshot={snapshot}
        canManage
        pending={false}
        {...callbacks}
      />,
    ),
    callbacks,
  };
}

describe("AiShadowProgrammeConsole mutation failures", () => {
  it("keeps plan evidence and reports a rejected registration", async () => {
    const onCreatePlan = vi
      .fn<MutationCallbacks["onCreatePlan"]>()
      .mockRejectedValue(new Error("conflict"));
    const { container } = renderConsole({ onCreatePlan });

    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Rejected plan" },
    });
    fireEvent.change(screen.getByLabelText("Purpose"), {
      target: { value: "Retain this draft after a rejection." },
    });
    for (const input of container.querySelectorAll<HTMLInputElement>(
      'input[pattern="[a-f0-9]{64}"][required]',
    )) {
      fireEvent.change(input, { target: { value: "a".repeat(64) } });
    }
    fireEvent.change(screen.getByLabelText("Expires"), {
      target: { value: "2026-08-31T10:00" },
    });
    fireEvent.change(container.querySelector("#shadow-plan-key")!, {
      target: { value: "plan-retry-key-0001" },
    });

    fireEvent.submit(
      screen.getByRole("button", { name: "Create test plan" }).closest("form")!,
    );

    expect(
      await screen.findByText(/test plan was not recorded/u),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveValue("Rejected plan");
    expect(onCreatePlan).toHaveBeenCalledTimes(1);
  });

  it("keeps observation evidence and reports a rejected record", async () => {
    const onRecordObservation = vi
      .fn<MutationCallbacks["onRecordObservation"]>()
      .mockRejectedValue(new Error("version conflict"));
    const { container } = renderConsole({ onRecordObservation });

    fireEvent.change(screen.getByLabelText("Case ID"), {
      target: { value: "case-retry-1" },
    });
    fireEvent.change(screen.getByLabelText("Observed at"), {
      target: { value: "2026-08-12T10:00" },
    });
    fireEvent.change(container.querySelector("#shadow-observation-key")!, {
      target: { value: "observation-key-0001" },
    });

    fireEvent.submit(
      screen
        .getByRole("button", { name: "Record observation" })
        .closest("form")!,
    );

    expect(
      await screen.findByText(/test observation was not recorded/u),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Case ID")).toHaveValue("case-retry-1");
    expect(onRecordObservation).toHaveBeenCalledTimes(1);
  });

  it("keeps the closure reason and reports a rejected closure", async () => {
    const onClosePlan = vi
      .fn<MutationCallbacks["onClosePlan"]>()
      .mockRejectedValue(new Error("denied"));
    renderConsole({ onClosePlan });

    fireEvent.change(screen.getByLabelText("Independent closure reason"), {
      target: { value: "Independent review is incomplete." },
    });
    fireEvent.submit(
      screen
        .getByRole("button", { name: "Close as independent reviewer" })
        .closest("form")!,
    );

    expect(
      await screen.findByText(/Plan closure was not confirmed/u),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Independent closure reason")).toHaveValue(
      "Independent review is incomplete.",
    );
    expect(onClosePlan).toHaveBeenCalledTimes(1);
  });
});
