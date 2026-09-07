import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DefectsTab } from "./defects-tab";
import { EvidenceTab } from "./evidence-tab";
import { RequirementsTab } from "./requirements-tab";

const mocks = vi.hoisted(() => ({
  evidence: [] as Array<Record<string, unknown>>,
  requirements: [] as Array<Record<string, unknown>>,
  documents: [] as Array<Record<string, unknown>>,
  defects: [] as Array<Record<string, unknown>>,
  createEvidence: vi.fn(),
  updateEvidence: vi.fn(),
  deleteEvidence: vi.fn(),
  createRequirement: vi.fn(),
  updateRequirement: vi.fn(),
  createDefect: vi.fn(),
  toast: vi.fn(),
  refetch: vi.fn(),
  permissions: new Set([
    "evidence:write",
    "evidence:approve",
    "requirement:write",
    "requirement:review",
    "defect:write",
    "defect:review",
  ]),
}));

function readyQuery(data: unknown) {
  return {
    data,
    isLoading: false,
    isPending: false,
    isError: false,
    isSuccess: true,
    refetch: mocks.refetch,
  };
}

vi.mock("@/contexts/organisation-context", () => ({
  useOrganisationPermission: (permission: string) =>
    mocks.permissions.has(permission),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("@workspace/api-client-react", () => ({
  getGetProjectScorecardQueryKey: (id: string) => ["scorecard", id],
  getListDefectsQueryKey: (id: string) => ["defects", id],
  getListEvidenceQueryKey: (id: string) => ["evidence", id],
  getListRequirementsQueryKey: (id: string) => ["requirements", id],
  updateDefect: vi.fn(),
  useCreateDefect: () => ({
    mutate: mocks.createDefect,
    isPending: false,
  }),
  useCreateEvidence: () => ({
    mutate: mocks.createEvidence,
    isPending: false,
  }),
  useCreateRequirement: () => ({
    mutate: mocks.createRequirement,
    isPending: false,
  }),
  useDeleteEvidence: () => ({
    mutate: mocks.deleteEvidence,
    isPending: false,
  }),
  useExtractRequirements: () => ({ mutate: vi.fn(), isPending: false }),
  useGetProjectScorecard: () =>
    readyQuery({
      totals: {
        engineConfirmed: 0,
        engineEdited: 0,
        engineRejected: 0,
        manualVerified: 0,
      },
    }),
  useListDefects: () => readyQuery(mocks.defects),
  useListDocuments: () => readyQuery(mocks.documents),
  useListEvidence: () => readyQuery(mocks.evidence),
  useListRequirements: () => readyQuery(mocks.requirements),
  useMapEvidence: () => ({ mutate: vi.fn(), isPending: false }),
  useMergeRequirements: () => ({ mutate: vi.fn(), isPending: false }),
  useSuggestDefects: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateEvidence: () => ({
    mutate: mocks.updateEvidence,
    isPending: false,
  }),
  useUpdateRequirement: () => ({
    mutate: mocks.updateRequirement,
    isPending: false,
  }),
}));

function renderWithQueryClient(children: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  );
}

describe("operational form recovery", () => {
  beforeEach(() => {
    mocks.evidence = [];
    mocks.requirements = [];
    mocks.documents = [];
    mocks.defects = [];
    mocks.createEvidence.mockReset();
    mocks.updateEvidence.mockReset();
    mocks.deleteEvidence.mockReset();
    mocks.createRequirement.mockReset();
    mocks.updateRequirement.mockReset();
    mocks.createDefect.mockReset();
    mocks.toast.mockReset();
    mocks.refetch.mockReset();
  });

  it("focuses the requirement selector when a new evidence link is incomplete", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<EvidenceTab projectId="project-1" />);

    await user.click(screen.getByRole("button", { name: "Link evidence" }));
    const dialog = screen.getByRole("dialog", { name: "Link evidence" });
    await user.click(
      within(dialog).getByRole("button", { name: "Link evidence" }),
    );

    const requirement = within(dialog).getByRole("combobox", {
      name: "Requirement",
    });
    expect(requirement).toHaveFocus();
    expect(requirement).toHaveAttribute("aria-invalid", "true");
    expect(requirement).toHaveAccessibleDescription("Select a requirement.");
    expect(mocks.createEvidence).not.toHaveBeenCalled();
  });

  it("focuses requirement text when a new requirement is incomplete", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<RequirementsTab projectId="project-1" />);

    await user.click(screen.getByRole("button", { name: "Add requirement" }));
    const dialog = screen.getByRole("dialog", { name: "Add requirement" });
    await user.click(
      within(dialog).getByRole("button", { name: "Add as confirmed" }),
    );

    const text = within(dialog).getByRole("textbox", {
      name: "Requirement text",
    });
    expect(text).toHaveFocus();
    expect(text).toHaveAttribute("aria-invalid", "true");
    expect(text).toHaveAccessibleDescription("Enter the requirement text.");
    expect(mocks.createRequirement).not.toHaveBeenCalled();
  });

  it("focuses issue description when a new defect is incomplete", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<DefectsTab projectId="project-1" />);

    await user.click(screen.getByRole("button", { name: "Add issue" }));
    const dialog = screen.getByRole("dialog", { name: "Add issue" });
    await user.click(within(dialog).getByRole("button", { name: "Add issue" }));

    const description = within(dialog).getByRole("textbox", {
      name: "Description",
    });
    expect(description).toHaveFocus();
    expect(description).toHaveAttribute("aria-invalid", "true");
    expect(description).toHaveAccessibleDescription(
      "Enter a description of the issue.",
    );
    expect(mocks.createDefect).not.toHaveBeenCalled();
  });

  it("disambiguates duplicate requirement labels before deleting an evidence link", async () => {
    mocks.evidence = [
      {
        id: "evidence-1",
        projectId: "project-1",
        requirementId: "requirement-1",
        requirementText: "Provide audited accounts",
        documentId: "document-1",
        documentName: "Accounts-2024.pdf",
        evidenceStatus: "present",
        excerpt: "Audited accounts for 2024",
        suggested: false,
        createdAt: "2026-08-20T10:00:00Z",
      },
      {
        id: "evidence-2",
        projectId: "project-1",
        requirementId: "requirement-1",
        requirementText: "Provide audited accounts",
        documentId: "document-2",
        documentName: "Accounts-2025.pdf",
        evidenceStatus: "present",
        excerpt: "Audited accounts for 2025",
        suggested: false,
        createdAt: "2026-08-21T10:00:00Z",
      },
    ];
    const user = userEvent.setup();
    renderWithQueryClient(<EvidenceTab projectId="project-1" />);

    await user.click(
      screen.getByRole("button", {
        name: /delete evidence link for provide audited accounts .* accounts-2025\.pdf; mapping id evidence-2/i,
      }),
    );

    const confirmation = screen.getByRole("alertdialog", {
      name: "Permanently delete this evidence link?",
    });
    expect(confirmation).toHaveTextContent(
      "Evidence link for Provide audited accounts — Accounts-2025.pdf; mapping ID evidence-2; recorded 2026-08-21T10:00:00Z",
    );
    expect(mocks.deleteEvidence).not.toHaveBeenCalled();

    await user.click(
      within(confirmation).getByRole("button", {
        name: "Delete evidence link",
      }),
    );
    expect(mocks.deleteEvidence).toHaveBeenCalledWith(
      { id: "evidence-2" },
      expect.objectContaining({
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
      }),
    );
  });
});
