import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ClientActionUploadBinding } from "./client-action-upload-contract";
import {
  ClientActionUploadControl,
  type ClientActionUploadControlProps,
} from "./client-action-upload-control";
import { ClientActionUploadFlowError } from "./client-action-upload-flow";
import {
  clientActionUploadRecoveryScope,
  clientActionUploadRecoveryStorageKey,
  writeClientActionUploadRecovery,
} from "./client-action-upload-recovery";

const binding: ClientActionUploadBinding = {
  organisationId: "11111111-1111-4111-8111-111111111111",
  projectId: "22222222-2222-4222-8222-222222222222",
  recordId: "33333333-3333-4333-8333-333333333333",
  slotId: "44444444-4444-4444-8444-444444444444",
  intentId: "55555555-5555-4555-8555-555555555555",
  expectedRecordVersion: 3,
  filename: "proof.pdf",
  contentType: "application/pdf",
  sizeBytes: 3,
  declaredSha256: "a".repeat(64),
  acceptedContentTypes: ["application/pdf"],
};
const MEMBERSHIP = "66666666-6666-4666-8666-666666666666";
const ACTOR = "77777777-7777-4777-8777-777777777777";

describe("ClientActionUploadControl", () => {
  beforeEach(() => sessionStorage.clear());

  it("recovers the same operation key after remount and requires exact file reselection", async () => {
    const firstUpload = vi.fn(async (_input, onProgress) => {
      onProgress({
        phase: "lease_ready",
        leaseId: "88888888-8888-4888-8888-888888888888",
        expiresAt: "2026-08-13T12:15:00.000Z",
        replayed: false,
        lateRewriteClosure: "bounded-cushion-and-post-expiry-reconcile",
      });
      throw new ClientActionUploadFlowError(
        "Transfer interrupted.",
        "transferring",
        "same_operation",
        true,
      );
    });
    const props = {
      binding,
      membershipId: MEMBERSHIP,
      actorUserId: ACTOR,
      onReload: vi.fn(),
    };
    const first = render(
      <ClientActionUploadControl {...props} onUpload={firstUpload} />,
    );
    const selected = new File([new Uint8Array([1, 2, 3])], "proof.pdf", {
      type: "application/pdf",
    });
    fireEvent.change(screen.getByLabelText(/File for proof\.pdf/u), {
      target: { files: [selected] },
    });
    fireEvent.click(screen.getByRole("button", { name: /Check and upload/u }));
    await screen.findByRole("alert");
    const persistedKey = firstUpload.mock.calls[0]?.[0].idempotencyKey;
    first.unmount();

    const recoveredUpload = vi.fn(
      async (
        _input: Parameters<ClientActionUploadControlProps["onUpload"]>[0],
      ) => {
        throw new Error("stop after assertion");
      },
    );
    render(<ClientActionUploadControl {...props} onUpload={recoveredUpload} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      /pending upload was recovered/u,
    );
    expect(
      screen.getByRole("button", { name: /Check and upload/u }),
    ).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/File for proof\.pdf/u), {
      target: { files: [selected] },
    });
    fireEvent.click(screen.getByRole("button", { name: /Check and upload/u }));
    await waitFor(() => expect(recoveredUpload).toHaveBeenCalledOnce());
    expect(recoveredUpload.mock.calls[0]?.[0].idempotencyKey).toBe(
      persistedKey,
    );
  });

  it("announces lease truth, retries with one stable key, and never claims local discard deleted bytes", async () => {
    const onUpload = vi.fn(async (_input, onProgress) => {
      onProgress({ phase: "leasing" });
      onProgress({
        phase: "lease_ready",
        leaseId: "88888888-8888-4888-8888-888888888888",
        expiresAt: "2026-08-13T12:15:00.000Z",
        replayed: false,
        lateRewriteClosure: "bounded-cushion-and-post-expiry-reconcile",
      });
      throw new ClientActionUploadFlowError(
        "The signed transfer result is unknown.",
        "transferring",
        "same_operation",
        true,
      );
    });
    render(
      <ClientActionUploadControl
        binding={binding}
        membershipId={MEMBERSHIP}
        actorUserId={ACTOR}
        onUpload={onUpload}
        onReload={vi.fn()}
      />,
    );

    expect(screen.getByText(/Maximum 50 MB/u)).toBeInTheDocument();
    expect(screen.getAllByText(/application\/pdf/u)).not.toHaveLength(0);
    const selectedFile = new File([new Uint8Array([1, 2, 3])], "proof.pdf", {
      type: "application/pdf",
    });
    fireEvent.change(screen.getByLabelText(/File for proof\.pdf/u), {
      target: { files: [selectedFile] },
    });
    fireEvent.click(screen.getByRole("button", { name: /Check and upload/u }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /signed transfer result is unknown/u,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      /server, not this browser, confirms cleanup/u,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/Upload slot expires/u);
    const firstKey = onUpload.mock.calls[0]?.[0].idempotencyKey;
    fireEvent.change(screen.getByLabelText(/File for proof\.pdf/u), {
      target: { files: [selectedFile] },
    });
    fireEvent.click(screen.getByRole("button", { name: /Check and upload/u }));
    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(2));
    expect(onUpload.mock.calls[1]?.[0].idempotencyKey).toBe(firstKey);

    fireEvent.click(
      screen.getByRole("button", { name: /Discard local selection/u }),
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      /does not cancel the upload slot or prove that a temporary upload was deleted/u,
    );
  });

  it("does not downgrade an enriched recovered lease when local preflight fails", async () => {
    const scope = clientActionUploadRecoveryScope({
      binding,
      membershipId: MEMBERSHIP,
      actorUserId: ACTOR,
    });
    writeClientActionUploadRecovery(sessionStorage, {
      schema: "valo.client-action-upload-recovery/v1",
      scope,
      idempotencyKey: "client-upload:99999999-9999-4999-8999-999999999999",
      leaseId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      expiresAt: "2026-08-13T12:15:00.000Z",
      lateRewriteClosure: "bounded-cushion-and-post-expiry-reconcile",
    });
    const storageKey = clientActionUploadRecoveryStorageKey(scope);
    const before = sessionStorage.getItem(storageKey);
    const preflight = vi.fn(
      async (
        _input: Parameters<ClientActionUploadControlProps["onUpload"]>[0],
      ) => {
        throw new ClientActionUploadFlowError(
          "The selected bytes do not match the acknowledged SHA-256.",
          "checking",
          "none",
          false,
        );
      },
    );
    const view = render(
      <ClientActionUploadControl
        binding={binding}
        membershipId={MEMBERSHIP}
        actorUserId={ACTOR}
        onUpload={preflight}
        onReload={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText(/File for proof\.pdf/u), {
      target: {
        files: [
          new File([new Uint8Array([9, 9, 9])], "proof.pdf", {
            type: "application/pdf",
          }),
        ],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: /Check and upload/u }));
    await screen.findByRole("alert");
    expect(sessionStorage.getItem(storageKey)).toBe(before);
    expect(preflight.mock.calls[0]?.[0].idempotencyKey).toBe(
      "client-upload:99999999-9999-4999-8999-999999999999",
    );
    view.unmount();
    render(
      <ClientActionUploadControl
        binding={binding}
        membershipId={MEMBERSHIP}
        actorUserId={ACTOR}
        onUpload={vi.fn()}
        onReload={vi.fn()}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      /pending upload was recovered/u,
    );
  });

  it("requires a reload instead of blind retry after lease expiry", async () => {
    const onReload = vi.fn(async () => undefined);
    render(
      <ClientActionUploadControl
        binding={binding}
        membershipId={MEMBERSHIP}
        actorUserId={ACTOR}
        onUpload={async () => {
          throw new ClientActionUploadFlowError(
            "The upload lease expired.",
            "finalizing",
            "new_lease",
            true,
          );
        }}
        onReload={onReload}
      />,
    );
    fireEvent.change(screen.getByLabelText(/File for proof\.pdf/u), {
      target: {
        files: [
          new File([new Uint8Array([1, 2, 3])], "proof.pdf", {
            type: "application/pdf",
          }),
        ],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: /Check and upload/u }));
    expect(
      await screen.findByRole("button", { name: /Reload current request/u }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Retry same upload/u }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /Reload current request/u }),
    );
    await waitFor(() => expect(onReload).toHaveBeenCalledOnce());
  });

  it("offers authoritative reload, not upload retry, after a terminal intake disposition", async () => {
    render(
      <ClientActionUploadControl
        binding={binding}
        membershipId={MEMBERSHIP}
        actorUserId={ACTOR}
        onUpload={async () => {
          throw new ClientActionUploadFlowError(
            "Secure intake rejected the file.",
            "finalizing",
            "none",
            true,
          );
        }}
        onReload={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText(/File for proof\.pdf/u), {
      target: {
        files: [
          new File([new Uint8Array([1, 2, 3])], "proof.pdf", {
            type: "application/pdf",
          }),
        ],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: /Check and upload/u }));
    expect(
      await screen.findByRole("button", {
        name: /Reload current status/u,
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Check and upload/u }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Retry same upload/u }),
    ).not.toBeInTheDocument();
  });
});
