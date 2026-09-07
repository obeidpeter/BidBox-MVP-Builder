import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReportsTab } from "./reports-tab";

const mocks = vi.hoisted(() => ({
  downloadReport: vi.fn(),
  downloadReportPdf: vi.fn(),
  refetch: vi.fn(),
  reports: undefined as undefined | Array<Record<string, unknown>>,
  isError: true,
  permissions: ["report:generate"] as string[],
}));

vi.mock("@/contexts/organisation-context", () => ({
  useOrganisationPermission: (permission: string) =>
    mocks.permissions.includes(permission),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@workspace/api-client-react", () => ({
  downloadReport: mocks.downloadReport,
  downloadReportPdf: mocks.downloadReportPdf,
  exportProject: vi.fn(),
  getGetProjectQueryKey: (id: string) => ["project", id],
  getListReportsQueryKey: (id: string) => ["reports", id],
  useGenerateReport: () => ({ mutate: vi.fn(), isPending: false }),
  useListReports: () => ({
    data: mocks.reports,
    isLoading: false,
    isError: mocks.isError,
    refetch: mocks.refetch,
  }),
  useRunResponsivenessReview: () => ({ mutate: vi.fn(), isPending: false }),
  useSignOffReport: () => ({ mutate: vi.fn(), isPending: false }),
}));

function renderReportsTab() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ReportsTab projectId="project-1" />
    </QueryClientProvider>,
  );
}

describe("ReportsTab query states", () => {
  beforeEach(() => {
    mocks.downloadReport.mockReset().mockResolvedValue(new Blob(["docx"]));
    mocks.downloadReportPdf.mockReset().mockResolvedValue(new Blob(["pdf"]));
    mocks.refetch.mockReset().mockResolvedValue(undefined);
    mocks.reports = undefined;
    mocks.isError = true;
    mocks.permissions = ["report:generate"];
  });

  it("never portrays a failed report query as an empty history", async () => {
    const user = userEvent.setup();
    renderReportsTab();

    expect(
      screen.getByRole("heading", { name: /report list unavailable/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/no reports generated yet/i),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /generate report/i }),
    ).toBeDisabled();

    await user.click(screen.getByRole("button", { name: /try again/i }));
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
  });

  it("omits report mutations that the selected context cannot perform", () => {
    mocks.permissions = ["report:read"];
    renderReportsTab();
    expect(
      screen.queryByRole("button", { name: /generate report/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /draft responsiveness review/i }),
    ).not.toBeInTheDocument();
  });

  it("downloads both signed formats through the authenticated blob client and revokes stale URLs", async () => {
    mocks.isError = false;
    mocks.permissions = ["report:read", "report:export"];
    mocks.reports = [
      {
        id: "report-1",
        version: 2,
        status: "signed_off",
        reviewerName: "Reviewer",
        createdAt: "2026-08-09T12:00:00Z",
      },
    ];
    const createObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValueOnce("blob:docx")
      .mockReturnValueOnce("blob:pdf");
    const revokeObjectURL = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => undefined);
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    const user = userEvent.setup();

    const view = renderReportsTab();
    await user.click(screen.getByRole("button", { name: /download docx/i }));
    await user.click(screen.getByRole("button", { name: /download pdf/i }));

    expect(mocks.downloadReport).toHaveBeenCalledWith("report-1");
    expect(mocks.downloadReportPdf).toHaveBeenCalledWith("report-1");
    expect(click).toHaveBeenCalledTimes(2);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:docx");

    view.unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:pdf");
    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
    click.mockRestore();
  });
});
