import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReportsTab } from "./reports-tab";

const mocks = vi.hoisted(() => ({
  downloadReport: vi.fn(),
  downloadReportPdf: vi.fn(),
  exportProject: vi.fn(),
  signOffMutate: vi.fn(),
  toast: vi.fn(),
  refetch: vi.fn(),
  reports: undefined as undefined | Array<Record<string, unknown>>,
  isError: true,
  reportsPending: false,
  reportsFetching: false,
  reportsOptions: undefined as undefined | Record<string, unknown>,
  packageVersions: {
    items: [] as Array<Record<string, unknown>>,
    limit: 100 as const,
    truncated: false,
    exportScopeSha256: "c".repeat(64),
  },
  packageVersionsLoading: false,
  packageVersionsFetching: false,
  packageVersionsError: false,
  packageOptions: undefined as undefined | Record<string, unknown>,
  permissions: ["report:read", "report:generate"] as string[],
}));

vi.mock("@/contexts/organisation-context", () => ({
  useOrganisationPermission: (permission: string) =>
    mocks.permissions.includes(permission),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("@workspace/api-client-react", () => ({
  downloadReport: mocks.downloadReport,
  downloadReportPdf: mocks.downloadReportPdf,
  exportProject: mocks.exportProject,
  getGetProjectQueryKey: (id: string) => ["project", id],
  getListReportsQueryKey: (id: string) => ["reports", id],
  getListProjectPackageVersionsQueryKey: (id: string) => [
    "package-versions",
    id,
  ],
  useGenerateReport: () => ({ mutate: vi.fn(), isPending: false }),
  useListReports: (_id: string, options: Record<string, unknown>) => {
    mocks.reportsOptions = options;
    return {
      data: mocks.reports,
      isLoading: false,
      isPending: mocks.reportsPending,
      isError: mocks.isError,
      isFetching: mocks.reportsFetching,
      isSuccess:
        !mocks.isError && !mocks.reportsPending && Array.isArray(mocks.reports),
      refetch: mocks.refetch,
    };
  },
  useRunResponsivenessReview: () => ({ mutate: vi.fn(), isPending: false }),
  useSignOffReport: () => ({
    mutate: mocks.signOffMutate,
    isPending: false,
  }),
  useListProjectPackageVersions: (
    _id: string,
    options: Record<string, unknown>,
  ) => {
    mocks.packageOptions = options;
    return {
      data: mocks.packageVersions,
      isLoading: mocks.packageVersionsLoading,
      isPending: mocks.packageVersionsLoading,
      isError: mocks.packageVersionsError,
      isFetching: mocks.packageVersionsFetching,
      isSuccess: !mocks.packageVersionsLoading && !mocks.packageVersionsError,
    };
  },
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
    mocks.exportProject.mockReset().mockResolvedValue(new Blob(["zip"]));
    mocks.signOffMutate.mockReset();
    mocks.toast.mockReset();
    mocks.refetch.mockReset().mockResolvedValue(undefined);
    mocks.reports = undefined;
    mocks.isError = true;
    mocks.reportsPending = false;
    mocks.reportsFetching = false;
    mocks.packageVersions = {
      items: [],
      limit: 100,
      truncated: false,
      exportScopeSha256: "c".repeat(64),
    };
    mocks.packageVersionsLoading = false;
    mocks.packageVersionsFetching = false;
    mocks.packageVersionsError = false;
    mocks.reportsOptions = undefined;
    mocks.packageOptions = undefined;
    mocks.permissions = ["report:read", "report:generate"];
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

  it("keeps a cold-paused report query loading and disables list-dependent actions", () => {
    mocks.isError = false;
    mocks.reportsPending = true;
    mocks.reports = undefined;
    mocks.permissions = ["report:generate", "report:export"];
    renderReportsTab();

    expect(
      screen.queryByText(/no reports generated yet/i),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /generate report/i }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /draft responsiveness review/i }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /export zip package/i }),
    ).toBeDisabled();
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

  it("does not request report history when report read access is absent", () => {
    mocks.isError = false;
    mocks.permissions = ["report:export", "package:read"];

    renderReportsTab();

    expect(
      screen.getByRole("heading", { name: "Report access required" }),
    ).toBeInTheDocument();
    expect(mocks.reportsOptions).toMatchObject({
      query: { enabled: false },
    });
    expect(
      screen.getByRole("button", { name: "Export ZIP package" }),
    ).toBeDisabled();
  });

  it("does not request package provenance when package read access is absent", () => {
    mocks.isError = false;
    mocks.permissions = ["report:read", "report:export"];
    mocks.reports = [
      {
        id: "report-signed-4",
        projectId: "project-1",
        version: 4,
        status: "signed_off",
        reviewerName: "Reviewer",
        createdAt: "2026-08-11T12:00:00Z",
      },
    ];

    renderReportsTab();

    expect(
      screen.getByRole("heading", {
        name: "Package provenance access required",
      }),
    ).toBeInTheDocument();
    expect(mocks.packageOptions).toMatchObject({
      query: { enabled: false },
    });
    expect(
      screen.getByRole("button", { name: "Export ZIP package" }),
    ).toBeDisabled();
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

  it("offers downloads only for the latest signed report version", () => {
    mocks.isError = false;
    mocks.permissions = ["report:read", "report:export"];
    mocks.reports = [
      {
        id: "report-signed-2",
        version: 2,
        status: "signed_off",
        reviewerName: "Earlier reviewer",
        createdAt: "2026-08-09T12:00:00Z",
      },
      {
        id: "report-signed-3",
        version: 3,
        status: "signed_off",
        reviewerName: "Current reviewer",
        createdAt: "2026-08-10T12:00:00Z",
      },
    ];

    renderReportsTab();

    expect(
      screen.getAllByRole("button", { name: "Download DOCX" }),
    ).toHaveLength(1);
    expect(
      screen.getAllByRole("button", { name: "Download PDF" }),
    ).toHaveLength(1);
    expect(
      screen.getByText(
        /Historical signed version\. Only the latest report version can be downloaded; the latest is v3/i,
      ),
    ).toBeInTheDocument();
  });

  it.each(["reports", "package"] as const)(
    "keeps export and downloads fail-closed while %s provenance refreshes",
    (refreshing) => {
      mocks.isError = false;
      mocks.permissions = ["report:read", "report:export", "package:read"];
      mocks.reports = [
        {
          id: "report-signed-4",
          version: 4,
          status: "signed_off",
          reviewerName: "Reviewer",
          createdAt: "2026-08-11T12:00:00Z",
        },
      ];
      if (refreshing === "reports") mocks.reportsFetching = true;
      if (refreshing === "package") mocks.packageVersionsFetching = true;

      renderReportsTab();

      expect(
        screen.getByRole("button", { name: "Export ZIP package" }),
      ).toBeDisabled();
      if (refreshing === "reports") {
        expect(
          screen.getByRole("button", { name: "Download DOCX" }),
        ).toBeDisabled();
        expect(
          screen.getByRole("button", { name: "Download PDF" }),
        ).toBeDisabled();
      }
    },
  );

  it("requires an exact-version preflight and human-entered attestation before sign-off", async () => {
    mocks.isError = false;
    mocks.permissions = ["report:read", "report:sign_off"];
    mocks.reports = [
      {
        id: "report-draft-3",
        projectId: "project-1",
        version: 3,
        status: "draft",
        createdAt: "2026-08-10T12:00:00Z",
        generatedBy: "generator-1",
        generatedByName: "Report Author",
        engineVersion: "report-engine-v3",
        promptPackVersion: "prompt-pack-v4",
        modelId: "model-reviewed-1",
        taxonomyVersion: "taxonomy-v2",
      },
    ];
    const user = userEvent.setup();
    renderReportsTab();

    await user.click(screen.getByRole("button", { name: "Sign off" }));

    expect(
      screen.getByRole("heading", {
        name: "Preflight — exact report and provenance",
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("report-draft-3").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", { name: "Sign off exact report version" }),
    ).toBeDisabled();
    expect(mocks.signOffMutate).not.toHaveBeenCalled();

    const attestation =
      "I reviewed the exact findings and provenance in report version 3.";
    await user.type(
      screen.getByRole("textbox", { name: "Named reviewer attestation" }),
      attestation,
    );
    await user.click(
      screen.getByRole("checkbox", {
        name: /I confirm that this attestation applies to report v3/i,
      }),
    );
    await user.click(
      screen.getByRole("button", { name: "Sign off exact report version" }),
    );

    expect(mocks.signOffMutate).toHaveBeenCalledWith(
      {
        id: "report-draft-3",
        data: { attestation },
      },
      expect.objectContaining({
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
      }),
    );
  });

  it("requires a fresh attestation and confirmation when sign-off provenance refreshes", async () => {
    mocks.isError = false;
    mocks.permissions = ["report:read", "report:sign_off"];
    mocks.reports = [
      {
        id: "report-draft-3",
        projectId: "project-1",
        version: 3,
        status: "draft",
        createdAt: "2026-08-10T12:00:00Z",
        generatedBy: "generator-1",
        generatedByName: "Report Author",
        engineVersion: "report-engine-v3",
        promptPackVersion: "prompt-pack-v4",
        modelId: "model-reviewed-1",
        taxonomyVersion: "taxonomy-v2",
      },
    ];
    const user = userEvent.setup();
    const view = renderReportsTab();
    await user.click(screen.getByRole("button", { name: "Sign off" }));
    const attestation = screen.getByRole("textbox", {
      name: "Named reviewer attestation",
    });
    const confirmation = screen.getByRole("checkbox", {
      name: /I confirm that this attestation applies to report v3/i,
    });
    await user.type(
      attestation,
      "I reviewed this exact report and its current provenance.",
    );
    await user.click(confirmation);
    expect(confirmation).toBeChecked();

    mocks.reportsFetching = true;
    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <ReportsTab projectId="project-1" />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(confirmation).not.toBeChecked());
    expect(attestation).toHaveValue("");
    expect(
      screen.getByRole("button", { name: "Sign off exact report version" }),
    ).toBeDisabled();

    mocks.reportsFetching = false;
    mocks.reports = [
      {
        ...mocks.reports[0]!,
        engineVersion: "report-engine-v4",
      },
    ];
    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <ReportsTab projectId="project-1" />
      </QueryClientProvider>,
    );

    expect(screen.getByText(/report-engine-v4/i)).toBeInTheDocument();
    expect(confirmation).not.toBeChecked();
    expect(attestation).toHaveValue("");
    expect(mocks.signOffMutate).not.toHaveBeenCalled();
  });

  it("keeps a rejected sign-off error inside the open preflight", async () => {
    mocks.isError = false;
    mocks.permissions = ["report:read", "report:sign_off"];
    mocks.reports = [
      {
        id: "report-draft-3",
        projectId: "project-1",
        version: 3,
        status: "draft",
        createdAt: "2026-08-10T12:00:00Z",
        generatedBy: "generator-1",
        engineVersion: "report-engine-v3",
        promptPackVersion: "prompt-pack-v4",
        modelId: "model-reviewed-1",
        taxonomyVersion: "taxonomy-v2",
      },
    ];
    mocks.signOffMutate.mockImplementationOnce(
      (_request: unknown, options: { onError: (error: unknown) => void }) =>
        options.onError(new Error("Reviewer authority changed.")),
    );
    const user = userEvent.setup();
    renderReportsTab();

    await user.click(screen.getByRole("button", { name: "Sign off" }));
    await user.type(
      screen.getByRole("textbox", { name: "Named reviewer attestation" }),
      "I reviewed this exact report and its recorded provenance.",
    );
    await user.click(
      screen.getByRole("checkbox", {
        name: /I confirm that this attestation applies to report v3/i,
      }),
    );
    await user.click(
      screen.getByRole("button", { name: "Sign off exact report version" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Reviewer authority changed.",
    );
    expect(
      screen.getByRole("heading", { name: "Confirm report sign-off" }),
    ).toBeInTheDocument();
  });

  it("does not export until the exact ZIP scope is reviewed and confirmed", async () => {
    mocks.isError = false;
    mocks.permissions = ["report:read", "report:export", "package:read"];
    mocks.reports = [
      {
        id: "report-signed-4",
        projectId: "project-1",
        version: 4,
        status: "signed_off",
        reviewerName: "Reviewer",
        createdAt: "2026-08-11T12:00:00Z",
      },
    ];
    mocks.packageVersions = {
      items: [
        {
          packageId: "package-1",
          packageVersionId: "package-version-2",
          packageType: "project_export",
          versionNumber: 2,
          manifestSha256: "a".repeat(64),
          sourceSnapshotSha256: "b".repeat(64),
          renderQaStatus: "passed",
          createdAt: "2026-08-11T12:30:00Z",
        },
      ],
      limit: 100,
      truncated: false,
      exportScopeSha256: "c".repeat(64),
    };
    const createObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:project-export");
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    const user = userEvent.setup();
    renderReportsTab();

    await user.click(
      screen.getByRole("button", { name: "Export ZIP package" }),
    );

    expect(
      screen.getByRole("heading", { name: "Preflight — exact package scope" }),
    ).toBeInTheDocument();
    expect(screen.getByText("package-version-2")).toBeInTheDocument();
    expect(screen.getByText(/requirements\.csv/i)).toBeInTheDocument();
    expect(mocks.exportProject).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Export confirmed ZIP package" }),
    ).toBeDisabled();

    await user.click(
      screen.getByRole("checkbox", {
        name: /I reviewed this exact report and package scope/i,
      }),
    );
    await user.click(
      screen.getByRole("button", { name: "Export confirmed ZIP package" }),
    );

    expect(mocks.exportProject).toHaveBeenCalledWith(
      "project-1",
      {
        reportId: "report-signed-4",
        reportVersion: 4,
        packageVersionId: "package-version-2",
        packageVersionNumber: 2,
        packageManifestSha256: "a".repeat(64),
        packageSourceSnapshotSha256: "b".repeat(64),
      },
      expect.any(String),
      `"${"c".repeat(64)}"`,
    );
    expect(click).toHaveBeenCalledTimes(1);
    createObjectURL.mockRestore();
    click.mockRestore();
  });

  it("requires renewed export consent when report or package provenance changes", async () => {
    mocks.isError = false;
    mocks.permissions = ["report:read", "report:export", "package:read"];
    mocks.reports = [
      {
        id: "report-signed-4",
        projectId: "project-1",
        version: 4,
        status: "signed_off",
        reviewerName: "Reviewer",
        createdAt: "2026-08-11T12:00:00Z",
      },
    ];
    mocks.packageVersions = {
      items: [
        {
          packageId: "package-1",
          packageVersionId: "package-version-2",
          packageType: "project_export",
          versionNumber: 2,
          manifestSha256: "a".repeat(64),
          sourceSnapshotSha256: "b".repeat(64),
          renderQaStatus: "passed",
          createdAt: "2026-08-11T12:30:00Z",
        },
      ],
      limit: 100,
      truncated: false,
      exportScopeSha256: "c".repeat(64),
    };
    const user = userEvent.setup();
    const view = renderReportsTab();

    await user.click(
      screen.getByRole("button", { name: "Export ZIP package" }),
    );
    const confirmation = screen.getByRole("checkbox", {
      name: /I reviewed this exact report and package scope/i,
    });
    await user.click(confirmation);
    expect(confirmation).toBeChecked();

    mocks.packageVersions = {
      ...mocks.packageVersions,
      items: [
        {
          ...mocks.packageVersions.items[0]!,
          packageVersionId: "package-version-3",
          versionNumber: 3,
          manifestSha256: "b".repeat(64),
          sourceSnapshotSha256: "d".repeat(64),
          createdAt: "2026-08-11T13:00:00Z",
        },
      ],
      exportScopeSha256: "e".repeat(64),
    };
    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <ReportsTab projectId="project-1" />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(confirmation).not.toBeChecked());
    expect(
      screen.getByRole("button", { name: "Export confirmed ZIP package" }),
    ).toBeDisabled();
    expect(mocks.exportProject).not.toHaveBeenCalled();
  });

  it("posts a complete all-null package binding when no prior package exists", async () => {
    mocks.isError = false;
    mocks.permissions = ["report:read", "report:export", "package:read"];
    mocks.reports = [
      {
        id: "report-signed-4",
        projectId: "project-1",
        version: 4,
        status: "signed_off",
        reviewerName: "Reviewer",
        createdAt: "2026-08-11T12:00:00Z",
      },
    ];
    const createObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:project-export-without-prior-package");
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    const user = userEvent.setup();
    renderReportsTab();

    await user.click(
      screen.getByRole("button", { name: "Export ZIP package" }),
    );
    await user.click(
      screen.getByRole("checkbox", {
        name: /I reviewed this exact report and package scope/i,
      }),
    );
    await user.click(
      screen.getByRole("button", { name: "Export confirmed ZIP package" }),
    );

    expect(mocks.exportProject).toHaveBeenCalledWith(
      "project-1",
      {
        reportId: "report-signed-4",
        reportVersion: 4,
        packageVersionId: null,
        packageVersionNumber: null,
        packageManifestSha256: null,
        packageSourceSnapshotSha256: null,
      },
      expect.any(String),
      `"${"c".repeat(64)}"`,
    );
    createObjectURL.mockRestore();
    click.mockRestore();
  });

  it("keeps export fail-closed when package provenance cannot be checked", async () => {
    mocks.isError = false;
    mocks.permissions = ["report:read", "report:export", "package:read"];
    mocks.reports = [
      {
        id: "report-signed-4",
        projectId: "project-1",
        version: 4,
        status: "signed_off",
        reviewerName: "Reviewer",
        createdAt: "2026-08-11T12:00:00Z",
      },
    ];
    mocks.packageVersionsError = true;
    const user = userEvent.setup();
    renderReportsTab();

    await user.click(
      screen.getByRole("button", { name: "Export ZIP package" }),
    );

    expect(
      screen.getByText("Current package provenance could not be verified."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", {
        name: /I reviewed this exact report and package scope/i,
      }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Export confirmed ZIP package" }),
    ).toBeDisabled();
    expect(mocks.exportProject).not.toHaveBeenCalled();
  });

  it("keeps an export failure visible in the still-open preflight", async () => {
    mocks.isError = false;
    mocks.permissions = ["report:read", "report:export", "package:read"];
    mocks.reports = [
      {
        id: "report-signed-4",
        projectId: "project-1",
        version: 4,
        status: "signed_off",
        reviewerName: "Reviewer",
        createdAt: "2026-08-11T12:00:00Z",
      },
    ];
    mocks.exportProject.mockRejectedValueOnce(
      new Error("NDA authority changed before export."),
    );
    const user = userEvent.setup();
    renderReportsTab();

    await user.click(
      screen.getByRole("button", { name: "Export ZIP package" }),
    );
    await user.click(
      screen.getByRole("checkbox", {
        name: /I reviewed this exact report and package scope/i,
      }),
    );
    await user.click(
      screen.getByRole("button", { name: "Export confirmed ZIP package" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "NDA authority changed before export.",
    );
    expect(
      screen.getByRole("heading", { name: "Confirm ZIP package export" }),
    ).toBeInTheDocument();
  });
});
