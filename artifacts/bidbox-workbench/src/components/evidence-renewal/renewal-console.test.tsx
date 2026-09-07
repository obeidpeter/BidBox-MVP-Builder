import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  EvidenceRenewalAuthorityList,
  EvidenceRenewalCreateDraft,
  EvidenceRenewalPlan,
  EvidenceRenewalReviewDraft,
  EvidenceRenewalSnapshot,
  EvidenceRenewalStageDraft,
} from "@/lib/evidence-renewal";
import { EvidenceRenewalConsole } from "./renewal-console";

const ORGANISATION_ID = "10000000-0000-4000-8000-000000000001";
const PROJECT_ID = "20000000-0000-4000-8000-000000000002";
const PLAN_ID = "30000000-0000-4000-8000-000000000003";
const VAULT_ITEM_ID = "40000000-0000-4000-8000-000000000004";
const OWNER_ID = "50000000-0000-4000-8000-000000000005";
const VERIFIER_ID = "60000000-0000-4000-8000-000000000006";
const DOCUMENT_ID = "70000000-0000-4000-8000-000000000007";
const SHA = "a".repeat(64);

const authorities: EvidenceRenewalAuthorityList = {
  organisationId: ORGANISATION_ID,
  owners: [{ userId: OWNER_ID, name: "Owner Ada" }],
  verifiers: [{ userId: VERIFIER_ID, name: "Verifier Tayo" }],
  limit: 100,
  truncated: false,
};

function plan(status: EvidenceRenewalPlan["status"] = "planned") {
  const staged = status !== "planned";
  return {
    id: PLAN_ID,
    organisationId: ORGANISATION_ID,
    projectId: PROJECT_ID,
    vaultItemId: VAULT_ITEM_ID,
    artefactType: "Tax clearance certificate",
    owner: { userId: OWNER_ID, name: "Owner Ada", current: true },
    verifier: {
      userId: VERIFIER_ID,
      name: "Verifier Tayo",
      current: true,
    },
    targetDate: "2026-09-01",
    internalReminder: {
      channel: "valo_evidence_renewal_register",
      assignedOwnerUserId: OWNER_ID,
      dueAt: "2026-09-01T16:00:00.000Z",
      status:
        status === "promoted" || status === "rejected" ? "resolved" : "open",
      recordedReceiptSha256: SHA,
      resolvedReceiptSha256:
        status === "promoted" || status === "rejected" ? "b".repeat(64) : null,
      externalDeliveryReceipt: null,
    },
    affectedPursuits: [
      { projectId: PROJECT_ID, title: "Pursuit Alpha", impact: "blocked" },
    ],
    status,
    version: staged ? 2 : 1,
    stagedReplacement: staged
      ? {
          documentId: DOCUMENT_ID,
          documentVersionId: "90000000-0000-4000-8000-000000000009",
          documentVersionNumber: 2,
          sha256: SHA,
          issueDate: "2026-08-12",
          expiryDate: "2027-08-12",
          expectedVaultItemVersion: 3,
          stagedByUserId: OWNER_ID,
          stagedAt: "2026-08-14T08:00:00.000Z",
        }
      : null,
    reviewReasonCode: null,
    createdByUserId: OWNER_ID,
    createdAt: "2026-08-13T08:00:00.000Z",
    updatedAt: staged ? "2026-08-14T08:00:00.000Z" : "2026-08-13T08:00:00.000Z",
    latestReceiptSha256: staged ? "b".repeat(64) : SHA,
    promotionReceiptSha256: null,
    receipts: [
      {
        version: 1,
        kind: "plan_created" as const,
        occurredAt: "2026-08-13T08:00:00.000Z",
        actorUserId: OWNER_ID,
        sha256: SHA,
      },
      ...(staged
        ? [
            {
              version: 2,
              kind: "replacement_staged" as const,
              occurredAt: "2026-08-14T08:00:00.000Z",
              actorUserId: OWNER_ID,
              sha256: "b".repeat(64),
            },
          ]
        : []),
    ],
    externalMessageSent: false as const,
  } satisfies EvidenceRenewalPlan;
}

function snapshot(item: EvidenceRenewalPlan = plan()): EvidenceRenewalSnapshot {
  return {
    organisationId: ORGANISATION_ID,
    projectId: PROJECT_ID,
    generatedAt: "2026-08-13T08:00:00.000Z",
    items: [item],
    limit: 100,
    truncated: false,
    externalMessagingConnected: false,
    authorityNote: "Internal only; no external message is sent.",
  };
}

const canonicalOptions = [
  {
    documentId: DOCUMENT_ID,
    projectId: PROJECT_ID,
    filename: "replacement.pdf",
    projectTitle: "Pursuit Alpha",
    sha256: SHA,
    versionNumber: 2,
    detectedMime: "application/pdf",
    sizeBytes: 512,
    privacyEligible: true,
  },
];

function renderConsole(
  item: EvidenceRenewalPlan,
  actorUserId: string,
  callbacks: {
    onCreate: (draft: EvidenceRenewalCreateDraft) => Promise<void>;
    onStage: (
      plan: EvidenceRenewalPlan,
      draft: EvidenceRenewalStageDraft,
    ) => Promise<void>;
    onReview: (
      plan: EvidenceRenewalPlan,
      draft: EvidenceRenewalReviewDraft,
    ) => Promise<void>;
  } = {
    onCreate: vi.fn(async (_draft: EvidenceRenewalCreateDraft) => {}),
    onStage: vi.fn(
      async (
        _plan: EvidenceRenewalPlan,
        _draft: EvidenceRenewalStageDraft,
      ) => {},
    ),
    onReview: vi.fn(
      async (
        _plan: EvidenceRenewalPlan,
        _draft: EvidenceRenewalReviewDraft,
      ) => {},
    ),
  },
) {
  render(
    <EvidenceRenewalConsole
      snapshot={snapshot(item)}
      authorities={authorities}
      vaultItems={[
        {
          id: VAULT_ITEM_ID,
          artefactType: "Tax clearance certificate",
          expiryDate: "2026-09-10",
        },
      ]}
      pursuits={[{ projectId: PROJECT_ID, title: "Pursuit Alpha" }]}
      canonicalOptions={canonicalOptions}
      canonicalOptionsTruncated={false}
      currentActorUserId={actorUserId}
      canManage
      canVerify
      pending={false}
      {...callbacks}
    />,
  );
  return callbacks;
}

describe("EvidenceRenewalConsole", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(
      "10000000-0000-4000-8000-000000000010",
    );
  });

  it("records named ownership, impact and explicit internal-only truth", () => {
    const callbacks = renderConsole(plan(), OWNER_ID);
    expect(
      screen.getByText(/no external reminder is sent/iu),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/receipt-backed reminder is assigned to you/iu),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/No external delivery receipt exists/iu),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Target date"), {
      target: { value: "2026-09-01" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Record internal renewal plan" }),
    );
    expect(callbacks.onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        vaultItemId: VAULT_ITEM_ID,
        ownerUserId: OWNER_ID,
        verifierUserId: VERIFIER_ID,
        affectedPursuits: [{ projectId: PROJECT_ID, impact: "blocked" }],
      }),
    );
  });

  it("retains the same request key when a create response is not verified", () => {
    let suffix = 11;
    vi.mocked(globalThis.crypto.randomUUID).mockImplementation(
      () => `10000000-0000-4000-8000-${String(suffix++).padStart(12, "0")}`,
    );
    const callbacks = renderConsole(plan(), OWNER_ID, {
      onCreate: vi.fn<(draft: EvidenceRenewalCreateDraft) => Promise<void>>(
        () => Promise.reject(new Error("response lost")),
      ),
      onStage: vi.fn(async () => {}),
      onReview: vi.fn(async () => {}),
    });
    fireEvent.change(screen.getByLabelText("Target date"), {
      target: { value: "2026-09-01" },
    });
    const submit = screen.getByRole("button", {
      name: "Record internal renewal plan",
    });
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(callbacks.onCreate).toHaveBeenCalledTimes(2);
    const createMock = vi.mocked(callbacks.onCreate);
    expect(createMock.mock.calls[1]?.[0].idempotencyKey).toBe(
      createMock.mock.calls[0]?.[0].idempotencyKey,
    );
  });

  it("lets only the assigned owner bind canonical replacement bytes", () => {
    const callbacks = renderConsole(plan(), OWNER_ID);
    fireEvent.change(
      screen.getByLabelText("Current clean replacement document"),
      { target: { value: DOCUMENT_ID } },
    );
    fireEvent.change(screen.getByLabelText("Issue date"), {
      target: { value: "2026-08-12" },
    });
    fireEvent.change(screen.getByLabelText("Expiry date"), {
      target: { value: "2027-08-12" },
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Stage for independent verification",
      }),
    );
    expect(callbacks.onStage).toHaveBeenCalledWith(
      expect.objectContaining({ id: PLAN_ID, version: 1 }),
      expect.objectContaining({ documentId: DOCUMENT_ID, sha256: SHA }),
    );
  });

  it("offers promotion only to the different assigned verifier", () => {
    const callbacks = renderConsole(plan("replacement_staged"), VERIFIER_ID);
    expect(
      screen.queryByRole("button", {
        name: "Stage for independent verification",
      }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Verify and promote" }));
    expect(callbacks.onReview).toHaveBeenCalledWith(
      expect.objectContaining({ id: PLAN_ID, version: 2 }),
      expect.objectContaining({
        decision: "approve",
        reasonCode: "replacement_verified",
      }),
    );
  });
});
