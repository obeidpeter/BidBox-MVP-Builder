import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { describe, expect, it, vi } from "vitest";
import type { CommercialRetainerSnapshotView } from "./commercial-retainer-contract";
import { CommercialControlCentre } from "./commercial-control-centre";

const ACTOR = "11111111-1111-4111-8111-111111111111";
const MAKER = "22222222-2222-4222-8222-222222222222";
const MEMBERSHIP = "33333333-3333-4333-8333-333333333333";

function snapshot(input?: {
  seeded?: boolean;
  quoteMaker?: string;
  withRequest?: boolean;
}): CommercialRetainerSnapshotView {
  const seeded = input?.seeded ?? true;
  return {
    organisationId: "org-a",
    manifest: {
      moduleVersion: "valo.commercial-retainer@v1",
      routeMounted: true,
      navigationMounted: true,
      openApiPublished: true,
      automaticPricingAllowed: false,
      paymentProviderConnected: false,
      externalMessagingConnected: false,
      autonomousWorkAllowed: false,
      makerCheckerRequired: true,
    },
    activation: {
      fixedPriceBookReady: seeded,
      providerConnected: false,
      manualReconciliationReady: true,
      retainerDeskReady: seeded,
    },
    offers: [
      {
        versionId: "evidence_readiness_retainer@1",
        sku: "evidence_readiness_retainer",
        title: "Evidence Readiness Retainer",
        summary: "Human-governed evidence readiness service desk.",
        cadence: "manual_monthly",
        fixedScope: ["Named requests"],
        excludedActions: ["Automatic payment"],
        humanQuoteRequired: true,
        orderable: seeded,
      },
    ],
    quotes: [
      {
        id: "44444444-4444-4444-8444-444444444444",
        projectId: null,
        offerVersionId: "evidence_readiness_retainer@1",
        customerReference: "Customer 24",
        scopeSummary: "Twelve named readiness requests.",
        currency: "NGN",
        amountMinor: 250_000,
        validUntil: "2026-08-20",
        serviceStartsOn: "2026-08-12",
        serviceEndsOn: "2027-08-11",
        serviceUnits: 12,
        status: "pending_checker",
        createdByUserId: input?.quoteMaker ?? MAKER,
        approvedByUserId: null,
        version: 1,
      },
    ],
    invoices: [],
    payments: [],
    entitlements: [
      {
        id: "55555555-5555-4555-8555-555555555555",
        orderId: "44444444-4444-4444-8444-444444444444",
        productKind: "evidence_readiness_retainer",
        status: "active",
        paymentState: "verified_manual",
        startsAt: "2026-08-12T00:00:00.000Z",
        endsAt: "2027-08-11T23:59:59.999Z",
        usageLimit: 12,
        usageConsumed: 1,
        version: 2,
      },
    ],
    serviceRequests: input?.withRequest
      ? [
          {
            id: "66666666-6666-4666-8666-666666666666",
            projectId: "77777777-7777-4777-8777-777777777777",
            entitlementId: "55555555-5555-4555-8555-555555555555",
            purpose: "evidence_review",
            summary: "Review current certificates",
            ownerMembershipId: MEMBERSHIP,
            sla: "standard",
            slaPolicyVersion: "valo.retainer-sla@v1",
            dueAt: "2026-08-16T12:00:00.000Z",
            status: "in_progress",
            comments: [],
            evidenceReceipts: [],
            version: 2,
          },
        ]
      : [],
  };
}

function renderCentre(
  value: CommercialRetainerSnapshotView,
  onMutate = vi.fn().mockResolvedValue(undefined),
) {
  return {
    onMutate,
    view: render(
      <CommercialControlCentre
        snapshot={value}
        actorUserId={ACTOR}
        actorMembershipId={MEMBERSHIP}
        canCreateOrder
        canApprove
        canReconcile
        canUseRetainer
        onMutate={onMutate}
      />,
    ),
  };
}

describe("CommercialControlCentre", () => {
  it("makes disconnected authority and missing catalogue seed explicit", () => {
    renderCentre(snapshot({ seeded: false }));
    expect(
      screen.getByText("Approved offers cannot be ordered"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Payment providers, external messages and automatic delivery are not connected/iu,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Create proposal for review",
      }),
    ).toBeDisabled();
    expect(screen.queryByText(/collect payment now/iu)).not.toBeInTheDocument();
  });

  it("prevents self-approval and exposes a checker action to another actor", async () => {
    const self = renderCentre(snapshot({ quoteMaker: ACTOR }));
    expect(
      screen.getByRole("button", { name: "Approve as second reviewer" }),
    ).toBeDisabled();
    expect(
      screen.getByText(/person who created the proposal cannot approve/iu),
    ).toBeInTheDocument();
    self.view.unmount();

    const other = renderCentre(snapshot({ quoteMaker: MAKER }));
    await userEvent.click(
      screen.getByRole("button", { name: "Approve as second reviewer" }),
    );
    expect(other.onMutate).toHaveBeenCalledWith({
      path: "/api/commercial-retainer/quotes/44444444-4444-4444-8444-444444444444/approve",
      body: { expectedVersion: 1 },
    });
  });

  it("settles a rejected checker action at the event boundary", async () => {
    const onMutate = vi.fn().mockRejectedValue(new Error("Write rejected"));
    renderCentre(snapshot({ quoteMaker: MAKER }), onMutate);

    await userEvent.click(
      screen.getByRole("button", { name: "Approve as second reviewer" }),
    );

    await waitFor(() => expect(onMutate).toHaveBeenCalledTimes(1));
  });

  it("retains proposal input when a rejected write is settled", async () => {
    const onMutate = vi.fn().mockRejectedValue(new Error("Write rejected"));
    renderCentre(snapshot(), onMutate);
    const customerReference = screen.getByLabelText("Customer reference");
    await userEvent.type(customerReference, "Retry customer");
    const submit = screen.getByRole("button", {
      name: "Create proposal for review",
    });

    fireEvent.submit(submit.closest("form") as HTMLFormElement);

    await waitFor(() => expect(onMutate).toHaveBeenCalledTimes(1));
    expect(customerReference).toHaveValue("Retry customer");
  });

  it("clears proposal input only after a successful write", async () => {
    const { onMutate } = renderCentre(snapshot());
    const customerReference = screen.getByLabelText("Customer reference");
    await userEvent.type(customerReference, "Recorded customer");
    const submit = screen.getByRole("button", {
      name: "Create proposal for review",
    });

    fireEvent.submit(submit.closest("form") as HTMLFormElement);

    await waitFor(() => expect(onMutate).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(customerReference).toHaveValue(""));
  });

  it("requires an evidence receipt before completion remains reachable", () => {
    renderCentre(snapshot({ withRequest: true }));
    expect(
      screen.getByRole("button", { name: "Record evidence receipt" }),
    ).toBeEnabled();
    expect(screen.getByRole("button", { name: "completed" })).toBeDisabled();
    expect(screen.getByLabelText("Evidence SHA-256")).toBeInTheDocument();
  });

  it("has no detectable axe violations", async () => {
    const { view } = renderCentre(snapshot({ withRequest: true }));
    const results = await axe.run(view.container, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(results.violations).toEqual([]);
  });
});
