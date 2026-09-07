import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClientVault } from "./client-vault";

const mocks = vi.hoisted(() => ({
  permissions: new Set<string>(),
  items: [] as Array<Record<string, unknown>>,
  documents: [] as Array<Record<string, unknown>>,
  vaultQueryCall: vi.fn(),
  documentQueryCall: vi.fn(),
  refetchItems: vi.fn(),
  refetchDocuments: vi.fn(),
  createItem: vi.fn(),
  updateItem: vi.fn(),
  deleteItem: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/contexts/organisation-context", () => ({
  useOrganisationPermission: (permission: string) =>
    mocks.permissions.has(permission),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("@workspace/api-client-react", () => ({
  getListVaultItemsQueryKey: (id: string) => [`/api/clients/${id}/vault-items`],
  getListClientDocumentsQueryKey: (id: string) => [
    `/api/clients/${id}/documents`,
  ],
  useListVaultItems: (id: string, options: Record<string, unknown>) => {
    mocks.vaultQueryCall(id, options);
    const enabled = (options.query as { enabled: boolean }).enabled;
    return enabled
      ? {
          data: mocks.items,
          isLoading: false,
          isPending: false,
          isError: false,
          isSuccess: true,
          refetch: mocks.refetchItems,
        }
      : {
          data: undefined,
          isLoading: false,
          isPending: true,
          isError: false,
          isSuccess: false,
          refetch: mocks.refetchItems,
        };
  },
  useListClientDocuments: (id: string, options: Record<string, unknown>) => {
    mocks.documentQueryCall(id, options);
    const enabled = (options.query as { enabled: boolean }).enabled;
    return enabled
      ? {
          data: mocks.documents,
          isLoading: false,
          isPending: false,
          isError: false,
          isSuccess: true,
          refetch: mocks.refetchDocuments,
        }
      : {
          data: undefined,
          isLoading: false,
          isPending: true,
          isError: false,
          isSuccess: false,
          refetch: mocks.refetchDocuments,
        };
  },
  useCreateVaultItem: () => ({ mutate: mocks.createItem, isPending: false }),
  useUpdateVaultItem: () => ({ mutate: mocks.updateItem, isPending: false }),
  useDeleteVaultItem: () => ({ mutate: mocks.deleteItem, isPending: false }),
}));

function Wrapper({ children }: PropsWithChildren) {
  return (
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      {children}
    </QueryClientProvider>
  );
}

function vaultItem(
  id: string,
  issuer: string,
  version: number,
): Record<string, unknown> {
  return {
    id,
    clientId: "client-1",
    artefactType: "Tax Clearance (FIRS)",
    issuer,
    issueDate: "2026-01-01",
    expiryDate: "2026-12-31",
    renewalLeadDays: 30,
    status: "active",
    version,
    objectPath: null,
    sha256: null,
    sourceDocumentId: null,
    expiryBand: "ok",
    daysToExpiry: 120,
    createdAt: "2026-08-30T10:00:00.000Z",
  };
}

describe("ClientVault interaction safeguards", () => {
  beforeEach(() => {
    mocks.permissions = new Set([
      "evidence:read",
      "document:read",
      "evidence:write",
    ]);
    mocks.items = [];
    mocks.documents = [];
    for (const mock of [
      mocks.vaultQueryCall,
      mocks.documentQueryCall,
      mocks.refetchItems,
      mocks.refetchDocuments,
      mocks.createItem,
      mocks.updateItem,
      mocks.deleteItem,
      mocks.toast,
    ]) {
      mock.mockReset();
    }
  });

  it("does not request evidence or document options without their exact permissions", () => {
    mocks.permissions = new Set();

    render(<ClientVault clientId="client-1" />, { wrapper: Wrapper });

    expect(mocks.vaultQueryCall).toHaveBeenCalledWith("client-1", {
      query: {
        queryKey: ["/api/clients/client-1/vault-items"],
        enabled: false,
      },
    });
    expect(mocks.documentQueryCall).toHaveBeenCalledWith("client-1", {
      query: {
        queryKey: ["/api/clients/client-1/documents"],
        enabled: false,
      },
    });
    expect(
      screen.getByRole("heading", { name: "Evidence access required" }),
    ).toBeInTheDocument();
  });

  it("keeps evidence visible and explains unavailable document options", () => {
    mocks.permissions = new Set(["evidence:read"]);
    mocks.items = [vaultItem("vault-1", "FIRS Lagos", 1)];

    render(<ClientVault clientId="client-1" />, { wrapper: Wrapper });

    expect(mocks.vaultQueryCall).toHaveBeenCalledWith("client-1", {
      query: {
        queryKey: ["/api/clients/client-1/vault-items"],
        enabled: true,
      },
    });
    expect(mocks.documentQueryCall).toHaveBeenCalledWith("client-1", {
      query: {
        queryKey: ["/api/clients/client-1/documents"],
        enabled: false,
      },
    });
    expect(screen.getByText("FIRS Lagos")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "Document access required for source options",
      }),
    ).toBeInTheDocument();
  });

  it("focuses the first invalid control when an edit fails validation", async () => {
    mocks.items = [vaultItem("vault-1", "FIRS Lagos", 1)];
    const user = userEvent.setup();
    render(<ClientVault clientId="client-1" />, { wrapper: Wrapper });

    await user.click(
      screen.getByRole("button", { name: /Edit .*ID vault-1/u }),
    );
    const dialog = screen.getByRole("dialog");
    const renewalLeadDays = within(dialog).getByLabelText(
      "Renewal lead time (days)",
    );
    await user.clear(renewalLeadDays);
    await user.type(renewalLeadDays, "-1");
    await user.click(
      within(dialog).getByRole("button", { name: "Save changes" }),
    );

    expect(renewalLeadDays).toHaveFocus();
    expect(renewalLeadDays).toHaveAttribute("aria-invalid", "true");
    expect(mocks.updateItem).not.toHaveBeenCalled();
  });

  it("identifies the chosen duplicate-label record by issuer, version and stable ID", async () => {
    mocks.items = [
      vaultItem("vault-1", "FIRS Lagos", 3),
      vaultItem("vault-2", "FIRS Abuja", 7),
    ];
    const user = userEvent.setup();
    render(<ClientVault clientId="client-1" />, { wrapper: Wrapper });

    await user.click(
      screen.getByRole("button", {
        name: /Delete Tax Clearance \(FIRS\).*FIRS Abuja.*version 7.*ID vault-2/u,
      }),
    );

    const confirmation = screen.getByRole("alertdialog");
    expect(confirmation).toHaveTextContent("FIRS Abuja");
    expect(confirmation).toHaveTextContent("version 7");
    expect(confirmation).toHaveTextContent("ID vault-2");
    expect(confirmation).not.toHaveTextContent("ID vault-1");
  });
});
