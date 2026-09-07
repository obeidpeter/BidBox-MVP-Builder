import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProductionAcceptanceEvidenceForm } from "./production-acceptance-evidence-form";

const RELEASE_SHA = "a".repeat(64);
const OWNER_USER_ID = "33333333-3333-4333-8333-333333333333";
const OWNER_OPTIONS = [{ id: OWNER_USER_ID, name: "Migration Owner" }];

describe("ProductionAcceptanceEvidenceForm", () => {
  it("stays disabled until an exact release candidate is configured", () => {
    render(
      <ProductionAcceptanceEvidenceForm
        releaseSha256={null}
        ownerOptions={OWNER_OPTIONS}
        pending={false}
        onSubmit={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Record evidence reference" }),
    ).toBeDisabled();
    expect(screen.getByLabelText("Release SHA-256")).toHaveValue(
      "Not configured",
    );
  });

  it("submits only evidence metadata and an idempotency key", async () => {
    const submit = vi.fn().mockResolvedValue(undefined);
    render(
      <ProductionAcceptanceEvidenceForm
        releaseSha256={RELEASE_SHA}
        ownerOptions={OWNER_OPTIONS}
        pending={false}
        onSubmit={submit}
      />,
    );
    fireEvent.change(screen.getByLabelText("Accountable owner"), {
      target: { value: OWNER_USER_ID },
    });
    fireEvent.change(screen.getByLabelText("Observed at"), {
      target: { value: "2026-08-11T09:00" },
    });
    fireEvent.change(screen.getByLabelText("Expires at"), {
      target: { value: "2026-08-18T09:00" },
    });
    fireEvent.change(screen.getByLabelText("Retained evidence reference"), {
      target: { value: "private/migration/rehearsal-42" },
    });
    fireEvent.change(screen.getByLabelText("Retained artefact SHA-256"), {
      target: { value: "b".repeat(64) },
    });
    fireEvent.change(screen.getByLabelText("Summary (no sensitive content)"), {
      target: { value: "Synthetic migration rehearsal passed." },
    });
    fireEvent.submit(
      screen
        .getByRole("button", { name: "Record evidence reference" })
        .closest("form")!,
    );

    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "migration",
        outcome: "passed",
        environment: "recovery_rehearsal",
        releaseSha256: RELEASE_SHA,
        ownerUserId: OWNER_USER_ID,
        evidenceReference: "private/migration/rehearsal-42",
        artifactSha256: "b".repeat(64),
      }),
    );
    expect(submit.mock.calls[0]?.[0].idempotencyKey).toMatch(/^acceptance-/u);
    expect(submit.mock.calls[0]?.[0]).not.toHaveProperty("password");
    expect(submit.mock.calls[0]?.[0]).not.toHaveProperty("databaseUrl");
  });

  it("fails closed when no independent named owner is available", () => {
    render(
      <ProductionAcceptanceEvidenceForm
        releaseSha256={RELEASE_SHA}
        ownerOptions={[]}
        pending={false}
        onSubmit={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Record evidence reference" }),
    ).toBeDisabled();
    expect(
      screen.getByText(/No other active owner is available/u),
    ).toBeInTheDocument();
  });
});
