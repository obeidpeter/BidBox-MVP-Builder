import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { OpportunitySourceConsole } from "./opportunity-source-console";
import type {
  OpportunitySourceCandidate,
  OpportunitySourceSnapshot,
} from "./opportunity-source-contract";

const authority: OpportunitySourceSnapshot["authority"] = {
  runtimeConnected: true,
  externalAcquisitionConnected: false,
  autonomousScrapingAllowed: false,
  autonomousPursuitActivationAllowed: false,
  authority: "named_human_confirmation_required",
};

function candidate(): OpportunitySourceCandidate {
  return {
    id: "candidate-1",
    organisationId: "org-1",
    sourceKind: "manual_url",
    provenance: "operator_recorded",
    sourceSystem: "bpp_nocopo",
    sourceAuthority: "BPP",
    sourceLocator: "https://example.test/tender/1",
    sourceLicenceReference: null,
    sourceLocatorSha256: "a".repeat(64),
    sourceContentSha256: null,
    receiptSha256: "b".repeat(64),
    dedupeKey: "c".repeat(64),
    externalReference: "TENDER-1",
    title: "Road rehabilitation",
    procuringEntity: "Road Authority",
    jurisdiction: "NG",
    fundingSource: null,
    procurementCategory: null,
    publishedAt: null,
    submissionDeadline: null,
    observedAt: "2026-08-21T10:00:00.000Z",
    status: "pending_review",
    version: 1,
    recordedByUserId: "user-1",
    recordedByName: "Ada Operator",
    reviewedByUserId: null,
    reviewedByName: null,
    reviewedAt: null,
    decisionReason: null,
    tenderId: null,
  };
}

describe("Opportunity Source console mutation failures", () => {
  it("keeps manual-source input intact and consumes a rejected record action", async () => {
    const user = userEvent.setup();
    const onRecord = vi.fn().mockRejectedValue(new Error("conflict"));

    render(
      <OpportunitySourceConsole
        snapshot={{ items: [], limit: 250, truncated: false, authority }}
        canManage
        pending={false}
        onRecord={onRecord}
        onDecision={vi.fn()}
      />,
    );

    await user.type(
      screen.getByLabelText(/official https url/i),
      "https://example.test/tender/1",
    );
    await user.type(screen.getByLabelText(/publishing authority/i), "BPP");
    await user.type(screen.getByLabelText(/source system id/i), "bpp_nocopo");
    await user.type(screen.getByLabelText(/tender reference/i), "TENDER-1");
    await user.type(
      screen.getByLabelText(/opportunity title/i),
      "Road rehabilitation",
    );
    await user.type(
      screen.getByLabelText(/procuring entity/i),
      "Road Authority",
    );
    await user.click(
      screen.getByRole("button", { name: /record for human review/i }),
    );

    await waitFor(() => expect(onRecord).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText(/official https url/i)).toHaveValue(
      "https://example.test/tender/1",
    );
  });

  it("consumes a rejected decision action instead of leaking an event-handler promise", async () => {
    const user = userEvent.setup();
    const onDecision = vi.fn().mockRejectedValue(new Error("conflict"));

    render(
      <OpportunitySourceConsole
        snapshot={{
          items: [candidate()],
          limit: 250,
          truncated: false,
          authority,
        }}
        canManage
        pending={false}
        onRecord={vi.fn()}
        onDecision={onDecision}
      />,
    );

    await user.type(
      screen.getByLabelText(/reason for decision/i),
      "Verified against the official notice",
    );
    await user.click(
      screen.getByRole("button", { name: /accept source record/i }),
    );

    await waitFor(() =>
      expect(onDecision).toHaveBeenCalledWith(
        expect.objectContaining({ id: "candidate-1" }),
        "accept",
        "Verified against the official notice",
      ),
    );
  });
});
