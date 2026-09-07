import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { adaptOpportunityPursuitHandoffPreparation } from "./opportunity-pursuit-handoff-contract";
import {
  CANDIDATE_ID,
  ORGANISATION_ID,
  readyHandoffResponse,
} from "./opportunity-pursuit-handoff-contract.test";
import { OpportunityPursuitHandoffPanel } from "./opportunity-pursuit-handoff-panel";

it("requires an official-source reopen and submits only an intake confirmation", async () => {
  const preparation = adaptOpportunityPursuitHandoffPreparation(
    readyHandoffResponse(),
    ORGANISATION_ID,
    CANDIDATE_ID,
  );
  const onConfirm = vi.fn().mockResolvedValue(undefined);
  render(
    <OpportunityPursuitHandoffPanel
      preparation={preparation}
      pending={false}
      onConfirm={onConfirm}
    />,
  );
  expect(
    screen.getByRole("link", { name: /reopen the official source/i }),
  ).toHaveAttribute("href", "https://procurement.example.test/notices/NG-42");
  const submit = screen.getByRole("button", {
    name: /create intake pursuit only/i,
  });
  expect(submit).toBeDisabled();
  fireEvent.change(screen.getByLabelText(/confirmation note/i), {
    target: { value: "Reopened and checked buyer, reference and deadline." },
  });
  fireEvent.click(screen.getByRole("checkbox"));
  expect(submit).toBeEnabled();
  fireEvent.click(submit);
  await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
  expect(onConfirm).toHaveBeenCalledWith(
    CANDIDATE_ID,
    expect.objectContaining({
      officialSourceReopened: true,
      confirmedBuyer: "Representative buyer",
      confirmedReference: "NG-42",
      confirmedSubmissionDeadline: "2026-09-01T12:00:00.000Z",
      expectedClientVersion: 1,
    }),
  );
});

it("consumes a rejected confirmation and preserves the exact human input", async () => {
  const preparation = adaptOpportunityPursuitHandoffPreparation(
    readyHandoffResponse(),
    ORGANISATION_ID,
    CANDIDATE_ID,
  );
  const onConfirm = vi.fn().mockRejectedValue(new Error("conflict"));
  render(
    <OpportunityPursuitHandoffPanel
      preparation={preparation}
      pending={false}
      onConfirm={onConfirm}
    />,
  );
  const note = screen.getByLabelText(/confirmation note/i);
  const reopened = screen.getByRole("checkbox");
  fireEvent.change(note, {
    target: { value: "Reopened and checked this exact source digest." },
  });
  fireEvent.click(reopened);
  fireEvent.click(
    screen.getByRole("button", { name: /create intake pursuit only/i }),
  );

  await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
  expect(note).toHaveValue("Reopened and checked this exact source digest.");
  expect(reopened).toBeChecked();
  expect(
    screen.getByLabelText(/buyer confirmed from official source/i),
  ).toHaveValue("Representative buyer");
});

it("blocks persistence when the selected tender and lot is currently occupied", () => {
  const response = readyHandoffResponse();
  const conflicted = {
    ...response,
    conflictBoundary: {
      ...response.conflictBoundary,
      matches: [
        {
          projectId: "77777777-7777-4777-8777-777777777777",
          lot: null,
          status: "intake",
          version: 1,
        },
      ],
    },
  };
  const preparation = adaptOpportunityPursuitHandoffPreparation(
    conflicted,
    ORGANISATION_ID,
    CANDIDATE_ID,
  );
  render(
    <OpportunityPursuitHandoffPanel
      preparation={preparation}
      pending={false}
      onConfirm={vi.fn()}
    />,
  );
  expect(
    screen.getByText("Current tender and lot conflict"),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("checkbox"));
  expect(
    screen.getByRole("button", { name: /create intake pursuit only/i }),
  ).toBeDisabled();
});

it("binds confirmation to the reviewed lot version and canonical reference", async () => {
  const preparation = adaptOpportunityPursuitHandoffPreparation(
    readyHandoffResponse(),
    ORGANISATION_ID,
    CANDIDATE_ID,
  );
  const onConfirm = vi.fn().mockResolvedValue(undefined);
  render(
    <OpportunityPursuitHandoffPanel
      preparation={preparation}
      pending={false}
      onConfirm={onConfirm}
    />,
  );
  fireEvent.change(screen.getByLabelText(/tender lot/i), {
    target: { value: "66666666-6666-4666-8666-666666666666" },
  });
  fireEvent.change(screen.getByLabelText(/confirmation note/i), {
    target: { value: "Reopened and checked the selected lot." },
  });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(
    screen.getByRole("button", { name: /create intake pursuit only/i }),
  );
  await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
  expect(onConfirm).toHaveBeenCalledWith(
    CANDIDATE_ID,
    expect.objectContaining({
      tenderLotId: "66666666-6666-4666-8666-666666666666",
      expectedTenderLotVersion: 1,
      confirmedLotReference: "LOT-1",
    }),
  );
});
