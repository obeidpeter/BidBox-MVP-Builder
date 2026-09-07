import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentsTab } from "./documents-tab";

const stagedObjectPath =
  "/objects/tenants/11111111-1111-4111-8111-111111111111/uploads/33333333-3333-4333-8333-333333333333";
const mocks = vi.hoisted(() => ({
  createDocument: vi.fn(),
  discardUpload: vi.fn(),
  extractDocument: vi.fn(),
  deleteDocument: vi.fn(),
  refetchDocuments: vi.fn(),
  requestUploadUrl: vi.fn(),
  toast: vi.fn(),
  beginCriticalWorkflow: vi.fn(),
  releaseCriticalWorkflow: vi.fn(),
  documents: [] as Array<Record<string, unknown>>,
  queryError: false,
  queryPending: false,
  querySuccess: true,
  permissions: new Set<string>(),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("@/contexts/organisation-context", () => ({
  useOrganisationPermission: (permission: string) =>
    mocks.permissions.has(permission),
  useOrganisationAccess: () => ({
    beginCriticalWorkflow: mocks.beginCriticalWorkflow,
  }),
}));

vi.mock("@workspace/api-client-react", () => ({
  getListDocumentsQueryKey: (id: string) => ["documents", id],
  useListDocuments: () => ({
    data: mocks.documents,
    isLoading: false,
    isPending: mocks.queryPending,
    isError: mocks.queryError,
    isSuccess: mocks.querySuccess,
    refetch: mocks.refetchDocuments,
  }),
  useCreateDocument: () => ({ mutateAsync: mocks.createDocument }),
  useDiscardUpload: () => ({ mutateAsync: mocks.discardUpload }),
  useDeleteDocument: () => ({
    mutate: mocks.deleteDocument,
    isPending: false,
  }),
  useUpdateDocument: () => ({ mutate: vi.fn() }),
  useRequestUploadUrl: () => ({ mutateAsync: mocks.requestUploadUrl }),
  useVerifyDocument: () => ({ mutateAsync: vi.fn() }),
  useExtractDocument: () => ({
    mutate: mocks.extractDocument,
    isPending: false,
  }),
}));

function renderDocumentsTab() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <DocumentsTab projectId="project-1" ndaStatus="signed" />
    </QueryClientProvider>,
  );
}

describe("DocumentsTab governed document intake", () => {
  beforeEach(() => {
    mocks.createDocument.mockReset().mockResolvedValue({ id: "document-1" });
    mocks.discardUpload.mockReset().mockResolvedValue({
      disposition: "deleted",
      quarantineMayRetainCopy: false,
    });
    mocks.extractDocument.mockReset();
    mocks.deleteDocument.mockReset();
    mocks.refetchDocuments.mockReset();
    mocks.documents = [];
    mocks.queryError = false;
    mocks.queryPending = false;
    mocks.querySuccess = true;
    mocks.permissions = new Set([
      "document:upload",
      "document:delete",
      "evidence:approve",
    ]);
    mocks.requestUploadUrl.mockReset().mockResolvedValue({
      uploadURL: "https://objects.example.test/signed-upload",
      objectPath: stagedObjectPath,
    });
    mocks.toast.mockReset();
    mocks.releaseCriticalWorkflow.mockReset();
    mocks.beginCriticalWorkflow
      .mockReset()
      .mockReturnValue(mocks.releaseCriticalWorkflow);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("disables generic signed upload without issuing a request or retry control", () => {
    renderDocumentsTab();

    expect(
      screen.getByRole("button", { name: /upload unavailable/i }),
    ).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(
      /durable lease and the storage provider is confirmed to create new files only/i,
    );
    expect(
      screen.queryByLabelText(/choose a document to upload/i),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /retry upload/i }),
    ).not.toBeInTheDocument();
    expect(mocks.requestUploadUrl).not.toHaveBeenCalled();
    expect(mocks.createDocument).not.toHaveBeenCalled();
    expect(mocks.discardUpload).not.toHaveBeenCalled();
    expect(mocks.beginCriticalWorkflow).not.toHaveBeenCalled();
  });

  it("shows a deliberate extraction action only after an excluded document is eligible", async () => {
    mocks.documents = [
      {
        id: "document-1",
        projectId: "project-1",
        type: "tender",
        filename: "Tender.pdf",
        objectPath: "/objects/tenants/tenant-1/uploads/object-1",
        redactionStatus: "redacted",
        extractionStatus: "skipped",
        extractionMethod: "none",
        extractionNotes: "A reviewer made this document eligible.",
        createdAt: "2026-08-09T12:00:00Z",
      },
    ];
    const user = userEvent.setup();

    renderDocumentsTab();
    expect(
      screen.getByRole("combobox", { name: "Tender.pdf document type" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Tender.pdf redaction status" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/ready to extract/i)).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", {
        name: /start extraction for tender\.pdf/i,
      }),
    );

    expect(mocks.extractDocument).toHaveBeenCalledWith(
      { id: "document-1" },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it("never offers extraction for an excluded document", () => {
    mocks.documents = [
      {
        id: "document-1",
        projectId: "project-1",
        type: "tender",
        filename: "Confidential.pdf",
        objectPath: "/objects/tenants/tenant-1/uploads/object-1",
        redactionStatus: "excluded",
        extractionStatus: "skipped",
        extractionMethod: "none",
        extractionNotes: "Skipped by confidentiality policy.",
        createdAt: "2026-08-09T12:00:00Z",
      },
    ];

    renderDocumentsTab();
    expect(screen.getByText(/excluded · no model/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /extraction for confidential/i }),
    ).not.toBeInTheDocument();
  });

  it("lets contributors edit metadata but not redaction or start model extraction", () => {
    mocks.permissions = new Set(["document:upload"]);
    mocks.documents = [
      {
        id: "document-1",
        projectId: "project-1",
        type: "tender",
        filename: "Tender.pdf",
        objectPath: "/objects/tenants/tenant-1/documents/document-1",
        redactionStatus: "redacted",
        extractionStatus: "skipped",
        extractionMethod: "none",
        createdAt: "2026-08-09T12:00:00Z",
      },
    ];

    renderDocumentsTab();

    expect(screen.getAllByRole("combobox")).toHaveLength(1);
    expect(
      screen.queryByRole("button", {
        name: /start extraction for tender\.pdf/i,
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/documents are uploaded/i),
    ).not.toBeInTheDocument();
  });

  it("surfaces logical security quarantine and exposes no ordinary release control", () => {
    mocks.documents = [
      {
        id: "document-1",
        projectId: "project-1",
        type: "tender",
        filename: "Infected.pdf",
        objectPath: "/objects/tenants/tenant-1/documents/document-1",
        redactionStatus: "excluded",
        extractionStatus: "quarantined",
        extractionMethod: "none",
        extractionNotes: "Secure re-inspection security-blocked this source.",
        createdAt: "2026-08-09T12:00:00Z",
      },
    ];

    renderDocumentsTab();

    expect(screen.getByText(/security quarantined/i)).toBeInTheDocument();
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
    expect(
      screen.queryByRole("button", { name: /extraction for infected\.pdf/i }),
    ).not.toBeInTheDocument();
  });

  it("shows a retryable load failure instead of a verified empty state", async () => {
    mocks.queryError = true;
    mocks.querySuccess = false;
    const user = userEvent.setup();

    renderDocumentsTab();

    expect(
      screen.getByText(/couldn't load the pursuit documents/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/no documents uploaded yet/i),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /try again/i }));
    expect(mocks.refetchDocuments).toHaveBeenCalledTimes(1);
  });

  it("shows a named loading state for a cold paused query", () => {
    mocks.queryPending = true;
    mocks.querySuccess = false;

    renderDocumentsTab();

    expect(screen.getByText(/loading pursuit documents/i)).toBeInTheDocument();
    expect(
      screen.queryByText(/no documents uploaded yet/i),
    ).not.toBeInTheDocument();
  });

  it("fails closed when a settled query has no successful data", () => {
    mocks.querySuccess = false;

    renderDocumentsTab();

    expect(
      screen.getByText(/couldn't load the pursuit documents/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/no documents uploaded yet/i),
    ).not.toBeInTheDocument();
  });

  it("disambiguates duplicate filenames before deleting the selected document", async () => {
    mocks.documents = [
      {
        id: "document-1",
        projectId: "project-1",
        type: "tender",
        filename: "Tender.pdf",
        objectPath: "/objects/tenants/tenant-1/documents/document-1",
        redactionStatus: "excluded",
        extractionStatus: "skipped",
        extractionMethod: "none",
        createdAt: "2026-08-09T12:00:00Z",
      },
      {
        id: "document-2",
        projectId: "project-1",
        type: "evidence",
        filename: "Tender.pdf",
        objectPath: "/objects/tenants/tenant-1/documents/document-2",
        redactionStatus: "included",
        extractionStatus: "completed",
        extractionMethod: "text",
        createdAt: "2026-08-10T12:00:00Z",
      },
    ];
    const user = userEvent.setup();

    renderDocumentsTab();
    await user.click(
      screen.getByRole("button", {
        name: /delete tender\.pdf .* evidence document; id document-2/i,
      }),
    );

    expect(mocks.deleteDocument).not.toHaveBeenCalled();
    expect(
      screen.getByRole("alertdialog", {
        name: /permanently delete this document/i,
      }),
    ).toHaveTextContent(
      "Tender.pdf — evidence document; ID document-2; recorded 2026-08-10T12:00:00Z",
    );
    expect(screen.getByText(/cannot be undone/i)).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /^delete document$/i }),
    );
    expect(mocks.deleteDocument).toHaveBeenCalledWith(
      { id: "document-2" },
      expect.objectContaining({
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
      }),
    );
  });
});
