import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClientCapability } from "./client-capability";

const mocks = vi.hoisted(() => ({
  permissions: new Set<string>(),
  items: [] as Array<Record<string, unknown>>,
  documents: [] as Array<Record<string, unknown>>,
  capabilityQueryCall: vi.fn(),
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
  getListCapabilityItemsQueryKey: (id: string) => [
    `/api/clients/${id}/capability-items`,
  ],
  getListClientDocumentsQueryKey: (id: string) => [
    `/api/clients/${id}/documents`,
  ],
  useListCapabilityItems: (id: string, options: Record<string, unknown>) => {
    mocks.capabilityQueryCall(id, options);
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
  useCreateCapabilityItem: () => ({
    mutate: mocks.createItem,
    isPending: false,
  }),
  useUpdateCapabilityItem: () => ({
    mutate: mocks.updateItem,
    isPending: false,
  }),
  useDeleteCapabilityItem: () => ({
    mutate: mocks.deleteItem,
    isPending: false,
  }),
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

function capabilityItem(
  id: string,
  evidenceDocName: string,
): Record<string, unknown> {
  return {
    id,
    clientId: "client-1",
    claimType: "project",
    description: "Bridge rehabilitation",
    evidenceDocId: `document-${id}`,
    evidenceDocName,
    approvedStatus: "pending",
    verifierName: null,
    verifiedAt: null,
    claimable: false,
    createdAt: "2026-08-30T10:00:00.000Z",
  };
}

describe("ClientCapability interaction safeguards", () => {
  beforeEach(() => {
    mocks.permissions = new Set([
      "evidence:read",
      "document:read",
      "evidence:write",
    ]);
    mocks.items = [];
    mocks.documents = [];
    for (const mock of [
      mocks.capabilityQueryCall,
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

    render(<ClientCapability clientId="client-1" />, { wrapper: Wrapper });

    expect(mocks.capabilityQueryCall).toHaveBeenCalledWith("client-1", {
      query: {
        queryKey: ["/api/clients/client-1/capability-items"],
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

  it("keeps claims visible and explains unavailable document options", () => {
    mocks.permissions = new Set(["evidence:read"]);
    mocks.items = [capabilityItem("claim-1", "Completion A.pdf")];

    render(<ClientCapability clientId="client-1" />, { wrapper: Wrapper });

    expect(mocks.capabilityQueryCall).toHaveBeenCalledWith("client-1", {
      query: {
        queryKey: ["/api/clients/client-1/capability-items"],
        enabled: true,
      },
    });
    expect(mocks.documentQueryCall).toHaveBeenCalledWith("client-1", {
      query: {
        queryKey: ["/api/clients/client-1/documents"],
        enabled: false,
      },
    });
    expect(screen.getByText("Bridge rehabilitation")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "Document access required for evidence options",
      }),
    ).toBeInTheDocument();
  });

  it("focuses the description after create validation fails", async () => {
    const user = userEvent.setup();
    render(<ClientCapability clientId="client-1" />, { wrapper: Wrapper });

    await user.click(screen.getByRole("button", { name: "Add claim" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Add claim" }));

    expect(screen.getByLabelText("Description")).toHaveFocus();
    expect(screen.getByLabelText("Description")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(mocks.createItem).not.toHaveBeenCalled();
  });

  it("identifies the chosen duplicate-label claim by evidence and stable ID", async () => {
    mocks.items = [
      capabilityItem("claim-1", "Completion A.pdf"),
      capabilityItem("claim-2", "Completion B.pdf"),
    ];
    const user = userEvent.setup();
    render(<ClientCapability clientId="client-1" />, { wrapper: Wrapper });

    await user.click(
      screen.getByRole("button", {
        name: /Delete Bridge rehabilitation.*Completion B\.pdf.*ID claim-2/u,
      }),
    );

    const confirmation = screen.getByRole("alertdialog");
    expect(confirmation).toHaveTextContent("Completion B.pdf");
    expect(confirmation).toHaveTextContent("ID claim-2");
    expect(confirmation).not.toHaveTextContent("ID claim-1");
  });
});
