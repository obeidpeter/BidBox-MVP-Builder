import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import axe from "axe-core";
import type { AppConfig } from "@workspace/api-client-react";
import Settings from "./settings";

const apiState = vi.hoisted(() => ({
  usersQuery: {} as Record<string, unknown>,
  retentionQuery: {} as Record<string, unknown>,
  readinessQuery: {} as Record<string, unknown>,
  completionQuery: {} as Record<string, unknown>,
  meQuery: {} as Record<string, unknown>,
  configQuery: {} as Record<string, unknown>,
  updateConfig: vi.fn(),
  completeRetention: vi.fn(),
  reconcileRetention: vi.fn(),
  certifyRetention: vi.fn(),
  refetchUsers: vi.fn(),
  refetchRetention: vi.fn(),
  refetchReadiness: vi.fn(),
  refetchCompletion: vi.fn(),
  refetchConfig: vi.fn(),
  toast: vi.fn(),
  online: true,
  releaseCriticalWorkflow: vi.fn(),
  beginCriticalWorkflow: vi.fn(),
  access: {} as Record<string, unknown>,
}));

vi.mock("@workspace/api-client-react", () => ({
  getGetAppConfigQueryKey: () => ["config"],
  getGetMeQueryKey: () => ["me"],
  getGetRetentionCompletionReadinessQueryKey: () => ["retention-readiness"],
  getGetRetentionRequestCompletionQueryKey: (id: string) => [
    "retention-completion",
    id,
  ],
  getListRetentionRequestsQueryKey: () => ["retention-requests"],
  useListUsers: () => apiState.usersQuery,
  useListRetentionRequests: () => apiState.retentionQuery,
  useGetRetentionCompletionReadiness: () => apiState.readinessQuery,
  useGetRetentionRequestCompletion: () => apiState.completionQuery,
  useGetMe: () => apiState.meQuery,
  useCompleteRetentionRequest: () => ({
    isPending: false,
    mutateAsync: apiState.completeRetention,
  }),
  useReconcileRetentionAction: () => ({
    isPending: false,
    mutateAsync: apiState.reconcileRetention,
  }),
  useCertifyRetentionAction: () => ({
    isPending: false,
    mutateAsync: apiState.certifyRetention,
  }),
  useGetAppConfig: () => apiState.configQuery,
  useUpdateAppConfig: () => ({
    isPending: false,
    mutate: apiState.updateConfig,
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: apiState.toast }),
}));

vi.mock("@/hooks/use-online-status", () => ({
  useOnlineStatus: () => apiState.online,
}));

vi.mock("@/contexts/organisation-context", () => ({
  useOrganisationAccess: () => apiState.access,
}));

const config: AppConfig = {
  severityWeights: {
    fatal: 40,
    likely_fatal: 30,
    scoring_risk: 20,
    cosmetic: 10,
  },
  missingEvidenceWeight: 25,
  bandCutoffs: { medium: 25, high: 50, critical: 75 },
  firmName: "Valo",
  confidentialityLegend: "Confidential",
  retentionDefaultDays: 365,
  updatedAt: "2026-08-11T10:00:00.000Z",
  updatedBy: null,
};

const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const ACTION_ID = "33333333-3333-4333-8333-333333333333";
const CURRENT_USER_ID = "44444444-4444-4444-8444-444444444444";
const PREPARER_USER_ID = "55555555-5555-4555-8555-555555555555";

const inactiveReadiness = {
  activated: false,
  manifestValid: true,
  environmentOptIn: false,
  workflow: "durable_two_phase_detach_reconcile_certify",
  activationBlockers: [
    {
      code: "environment_opt_in_missing",
      message: "Production retention completion has not been opted in.",
    },
  ],
  evidenceBlockers: [
    {
      code: "governed_evidence_retained",
      message:
        "Immutable governed evidence has no approved retention detachment policy.",
    },
  ],
  permissions: {
    canStart: false,
    canReconcile: false,
    canCertify: false,
  },
  makerCheckerRequired: true,
  checkedAt: "2026-08-22T10:00:00.000Z",
};

const activeReadiness = {
  ...inactiveReadiness,
  activated: true,
  environmentOptIn: true,
  activationBlockers: [],
  evidenceBlockers: [],
  permissions: {
    canStart: true,
    canReconcile: true,
    canCertify: true,
  },
};

function requestFixture(
  status: "pending" | "reconciling" | "completed" | "blocked" = "pending",
  completionProtocolVersion: 0 | 1 = 1,
) {
  return {
    id: REQUEST_ID,
    projectId: PROJECT_ID,
    subjectProjectId: PROJECT_ID,
    requestedByUserId: CURRENT_USER_ID,
    requestedByName: "Retention Officer",
    reason: "Contract retention period elapsed.",
    dueAt: "2026-08-30T09:00:00.000Z",
    completedAt: status === "completed" ? "2026-08-22T12:00:00.000Z" : null,
    status,
    completionProtocolVersion,
    version: status === "pending" ? 1 : status === "reconciling" ? 2 : 3,
    createdAt: "2026-08-20T09:00:00.000Z",
    updatedAt: "2026-08-22T10:00:00.000Z",
  };
}

function actionFixture(
  status: "pending" | "detached" | "reconciled" | "certified" | "blocked",
  preparedByUserId: string | null = status === "reconciled" ||
  status === "certified"
    ? PREPARER_USER_ID
    : null,
) {
  return {
    id: ACTION_ID,
    retentionRequestId: REQUEST_ID,
    subjectProjectId: PROJECT_ID,
    status,
    version:
      status === "pending"
        ? 1
        : status === "detached" || status === "blocked"
          ? 3
          : status === "reconciled"
            ? 4
            : 5,
    sourceManifest: { subject: "project" },
    sourceManifestSha256: "a".repeat(64),
    purgeReceipt:
      status === "pending"
        ? null
        : {
            schema: "valo.retention-owner-purge-receipt/v1",
            retentionActionId: ACTION_ID,
          },
    purgeReceiptSha256: status === "pending" ? null : "e".repeat(64),
    purgedAt: status === "pending" ? null : "2026-08-22T10:45:00.000Z",
    reconciliationManifest:
      status === "reconciled" || status === "certified"
        ? { objects: "terminal" }
        : null,
    reconciliationManifestSha256:
      status === "reconciled" || status === "certified" ? "b".repeat(64) : null,
    preparedByUserId,
    preparedByName: preparedByUserId ? "Preparation Officer" : null,
    preparedAt: preparedByUserId ? "2026-08-22T11:00:00.000Z" : null,
    checkedByUserId: status === "certified" ? CURRENT_USER_ID : null,
    checkedByName: status === "certified" ? "Independent Checker" : null,
    checkedAt: status === "certified" ? "2026-08-22T12:00:00.000Z" : null,
    createdAt: "2026-08-22T10:30:00.000Z",
    updatedAt: "2026-08-22T11:00:00.000Z",
  };
}

const certificateFixture = {
  id: "66666666-6666-4666-8666-666666666666",
  retentionActionId: ACTION_ID,
  certificateNumber: "RET-2026-0001",
  scopeManifestHash: "a".repeat(64),
  certificateManifest: { certificate: "canonical" },
  certificateManifestSha256: "d".repeat(64),
  method: "durable_two_phase_detach_reconcile_certify",
  completedAt: "2026-08-22T12:00:00.000Z",
  signedByUserId: CURRENT_USER_ID,
  signedByName: "Independent Checker",
  signatureEvidence: "Independent reconciliation verification completed.",
  createdAt: "2026-08-22T12:00:00.000Z",
};

function completionFixture(
  status: "pending" | "detached" | "reconciled" | "certified" = "pending",
  preparedByUserId?: string | null,
) {
  const action =
    status === "pending" ? null : actionFixture(status, preparedByUserId);
  const certificate = status === "certified" ? certificateFixture : null;
  const requestStatus =
    status === "pending"
      ? "pending"
      : status === "certified"
        ? "completed"
        : "reconciling";
  return {
    request: requestFixture(requestStatus),
    action,
    objectReconciliation: {
      expected: status === "pending" ? 0 : 2,
      detached: status === "pending" ? 0 : 2,
      reconciled: status === "reconciled" || status === "certified" ? 2 : 0,
      pending: status === "detached" ? 2 : 0,
      deadLetters: 0,
    },
    objectBindings: [],
    retainedCategories: [
      {
        category: "financial_records",
        reason: "Statutory accounting retention applies.",
        count: 3,
      },
    ],
    blockers: [],
    certificate,
    permissions: {
      canStart: status === "pending",
      canReconcile: status === "detached",
      canCertify: status === "reconciled",
    },
    generatedAt: "2026-08-22T12:00:00.000Z",
  };
}

function successfulQuery(data: unknown, refetch: () => unknown) {
  return {
    data,
    isLoading: false,
    isPending: false,
    isError: false,
    isSuccess: true,
    isFetching: false,
    refetch,
  };
}

function failedQuery(refetch: () => unknown) {
  return {
    data: undefined,
    isLoading: false,
    isPending: false,
    isError: true,
    isSuccess: false,
    isFetching: false,
    refetch,
  };
}

function pausedQuery(refetch: () => unknown) {
  return {
    data: undefined,
    isLoading: false,
    isPending: true,
    isError: false,
    isSuccess: false,
    isFetching: false,
    refetch,
  };
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <Settings />
    </QueryClientProvider>,
  );
}

describe("Settings", () => {
  beforeEach(() => {
    apiState.updateConfig.mockReset();
    apiState.completeRetention.mockReset();
    apiState.reconcileRetention.mockReset();
    apiState.certifyRetention.mockReset();
    apiState.refetchUsers.mockReset();
    apiState.refetchRetention.mockReset();
    apiState.refetchReadiness.mockReset();
    apiState.refetchCompletion.mockReset();
    apiState.refetchConfig.mockReset();
    apiState.toast.mockReset();
    apiState.releaseCriticalWorkflow.mockReset();
    apiState.beginCriticalWorkflow.mockReset();
    apiState.beginCriticalWorkflow.mockReturnValue(
      apiState.releaseCriticalWorkflow,
    );
    apiState.online = true;
    apiState.access = {
      activeOrganisation: {
        id: "77777777-7777-4777-8777-777777777777",
        accessSource: "membership",
      },
      effectivePermissions: ["retention:manage"],
      beginCriticalWorkflow: apiState.beginCriticalWorkflow,
    };
    apiState.usersQuery = successfulQuery([], apiState.refetchUsers);
    apiState.retentionQuery = successfulQuery([], apiState.refetchRetention);
    apiState.readinessQuery = successfulQuery(
      inactiveReadiness,
      apiState.refetchReadiness,
    );
    apiState.completionQuery = successfulQuery(
      completionFixture(),
      apiState.refetchCompletion,
    );
    apiState.meQuery = successfulQuery(
      { id: CURRENT_USER_ID, status: "active" },
      vi.fn(),
    );
    apiState.configQuery = successfulQuery(config, apiState.refetchConfig);
  });

  it("shows retryable errors instead of spinners or false empty states", () => {
    apiState.usersQuery = failedQuery(apiState.refetchUsers);
    apiState.retentionQuery = failedQuery(apiState.refetchRetention);
    apiState.readinessQuery = failedQuery(apiState.refetchReadiness);
    apiState.configQuery = failedQuery(apiState.refetchConfig);

    renderPage();

    for (const [title, retry] of [
      ["Settings could not be loaded", apiState.refetchConfig],
      ["Personnel access could not be loaded", apiState.refetchUsers],
      [
        "Retention completion readiness could not be verified",
        apiState.refetchReadiness,
      ],
      ["Retention requests could not be loaded", apiState.refetchRetention],
    ] as const) {
      const panel = screen.getByText(title).closest('[role="alert"]');
      expect(panel).not.toBeNull();
      fireEvent.click(
        within(panel as HTMLElement).getByRole("button", { name: "Try again" }),
      );
      expect(retry).toHaveBeenCalledTimes(1);
    }

    expect(
      screen.queryByText(
        "No personnel records are available for this organisation.",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("No retention requests are available"),
    ).not.toBeInTheDocument();
  });

  it("keeps verified empty directories distinct from load failures", async () => {
    renderPage();

    expect(
      screen.getByText(
        "No personnel records are available for this organisation.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("No retention requests are available"),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.queryByText("Settings could not be loaded"),
      ).not.toBeInTheDocument(),
    );
  });

  it("does not report cold paused configuration or directories as empty", () => {
    apiState.usersQuery = pausedQuery(apiState.refetchUsers);
    apiState.retentionQuery = pausedQuery(apiState.refetchRetention);
    apiState.readinessQuery = pausedQuery(apiState.refetchReadiness);
    apiState.configQuery = pausedQuery(apiState.refetchConfig);

    renderPage();

    expect(
      screen.queryByText(
        "No personnel records are available for this organisation.",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("No retention requests are available"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Settings could not be loaded"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("Verifying retention activation and evidence gates"),
    ).toBeInTheDocument();
    expect(screen.getByText("Loading retention requests")).toBeInTheDocument();
    expect(document.querySelectorAll(".animate-spin")).toHaveLength(3);
  });

  it("blocks non-integer configuration before calling the API", async () => {
    renderPage();

    fireEvent.change(await screen.findByLabelText("Fatal"), {
      target: { value: "1.5" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    expect(apiState.updateConfig).not.toHaveBeenCalled();
    expect(apiState.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: "destructive",
        title: "Invalid number settings",
      }),
    );
  });

  it("shows exact inactive blockers without offering destructive controls", async () => {
    apiState.retentionQuery = successfulQuery(
      [requestFixture()],
      apiState.refetchRetention,
    );

    renderPage();

    expect(
      screen.getByText("Retention completion is not activated"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Production retention completion has not been opted in.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Immutable governed evidence has no approved retention detachment policy.",
      ),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { name: "Completion evidence" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "Prepare relational detachment",
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "Record reconciliation evidence",
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "Certify as independent checker",
      }),
    ).not.toBeInTheDocument();
  });

  it("shows historical protocol-zero completion as read-only evidence", async () => {
    const legacy = {
      ...completionFixture(),
      request: requestFixture("completed", 0),
    };
    apiState.readinessQuery = successfulQuery(
      activeReadiness,
      apiState.refetchReadiness,
    );
    apiState.retentionQuery = successfulQuery(
      [legacy.request],
      apiState.refetchRetention,
    );
    apiState.completionQuery = successfulQuery(
      legacy,
      apiState.refetchCompletion,
    );

    renderPage();

    expect(
      await screen.findByText("Legacy retention evidence is read-only"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Certificate evidence is inconsistent"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "Prepare relational detachment",
      }),
    ).not.toBeInTheDocument();
  });

  it.each(["readinessQuery", "retentionQuery", "meQuery"] as const)(
    "hides destructive controls when %s retains stale data after failure",
    async (queryName) => {
      const pending = completionFixture();
      apiState.readinessQuery = successfulQuery(
        activeReadiness,
        apiState.refetchReadiness,
      );
      apiState.retentionQuery = successfulQuery(
        [pending.request],
        apiState.refetchRetention,
      );
      apiState.completionQuery = successfulQuery(
        pending,
        apiState.refetchCompletion,
      );
      apiState.meQuery = successfulQuery(
        { id: CURRENT_USER_ID, status: "active" },
        vi.fn(),
      );
      apiState[queryName] = {
        ...apiState[queryName],
        isError: true,
        isSuccess: false,
      };

      renderPage();

      await screen.findByRole("heading", { name: "Completion evidence" });
      expect(
        screen.queryByRole("button", {
          name: "Prepare relational detachment",
        }),
      ).not.toBeInTheDocument();
    },
  );

  it.each([
    "readinessQuery",
    "retentionQuery",
    "meQuery",
    "completionQuery",
  ] as const)(
    "hides destructive controls while %s is refetching",
    async (queryName) => {
      const pending = completionFixture();
      apiState.readinessQuery = successfulQuery(
        activeReadiness,
        apiState.refetchReadiness,
      );
      apiState.retentionQuery = successfulQuery(
        [pending.request],
        apiState.refetchRetention,
      );
      apiState.completionQuery = successfulQuery(
        pending,
        apiState.refetchCompletion,
      );
      apiState.meQuery = successfulQuery(
        { id: CURRENT_USER_ID, status: "active" },
        vi.fn(),
      );
      apiState[queryName] = {
        ...apiState[queryName],
        isFetching: true,
      };

      renderPage();

      await screen.findByRole("heading", { name: "Completion evidence" });
      expect(
        screen.queryByRole("button", {
          name: "Prepare relational detachment",
        }),
      ).not.toBeInTheDocument();
    },
  );

  it("has no detectable accessibility violations in the blocked retention state", async () => {
    apiState.retentionQuery = successfulQuery(
      [requestFixture()],
      apiState.refetchRetention,
    );
    const view = renderPage();
    await screen.findByRole("heading", { name: "Completion evidence" });

    const results = await axe.run(view.container, {
      rules: { region: { enabled: false } },
    });
    expect(results.violations).toEqual([]);
  });

  it("requires exact typed confirmation and attestation before phase-one detachment", async () => {
    const pending = completionFixture();
    const detached = completionFixture("detached");
    apiState.readinessQuery = successfulQuery(
      activeReadiness,
      apiState.refetchReadiness,
    );
    apiState.retentionQuery = successfulQuery(
      [pending.request],
      apiState.refetchRetention,
    );
    apiState.completionQuery = successfulQuery(
      pending,
      apiState.refetchCompletion,
    );
    apiState.completeRetention.mockResolvedValue(detached);

    renderPage();

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Prepare relational detachment",
      }),
    );
    const submit = screen.getByRole("button", {
      name: "Start phase-one detachment",
    });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Type this exact confirmation"), {
      target: { value: `DETACH ${PROJECT_ID}` },
    });
    fireEvent.change(screen.getByLabelText("Named operator attestation"), {
      target: {
        value:
          "I verified the scope and understand the irreversible relational detachment.",
      },
    });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);

    await waitFor(() =>
      expect(apiState.completeRetention).toHaveBeenCalledWith({
        id: REQUEST_ID,
        data: {
          attestation:
            "I verified the scope and understand the irreversible relational detachment.",
        },
        ifMatch: "1",
        idempotencyKey: expect.stringMatching(
          /^retention-detach:[0-9a-f-]{36}$/i,
        ),
      }),
    );
    expect(apiState.beginCriticalWorkflow).toHaveBeenCalledOnce();
    expect(apiState.releaseCriticalWorkflow).toHaveBeenCalledOnce();
    expect(apiState.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Relational detachment started" }),
    );
    expect(
      screen.queryByText("Independent certificate evidence returned"),
    ).not.toBeInTheDocument();
  });

  it("closes an open destructive form when activation is withdrawn", async () => {
    const pending = completionFixture();
    apiState.readinessQuery = successfulQuery(
      activeReadiness,
      apiState.refetchReadiness,
    );
    apiState.retentionQuery = successfulQuery(
      [pending.request],
      apiState.refetchRetention,
    );
    apiState.completionQuery = successfulQuery(
      pending,
      apiState.refetchCompletion,
    );
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const settingsPage = () => (
      <QueryClientProvider client={client}>
        <Settings />
      </QueryClientProvider>
    );
    const view = render(settingsPage());

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Prepare relational detachment",
      }),
    );
    expect(
      screen.getByRole("heading", {
        name: "Confirm irreversible relational detachment",
      }),
    ).toBeInTheDocument();

    apiState.readinessQuery = successfulQuery(
      inactiveReadiness,
      apiState.refetchReadiness,
    );
    view.rerender(settingsPage());

    await waitFor(() =>
      expect(
        screen.queryByRole("heading", {
          name: "Confirm irreversible relational detachment",
        }),
      ).not.toBeInTheDocument(),
    );
    expect(apiState.completeRetention).not.toHaveBeenCalled();

    apiState.readinessQuery = successfulQuery(
      activeReadiness,
      apiState.refetchReadiness,
    );
    view.rerender(settingsPage());

    expect(
      await screen.findByRole("button", {
        name: "Prepare relational detachment",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", {
        name: "Confirm irreversible relational detachment",
      }),
    ).not.toBeInTheDocument();
  });

  it("records reconciliation only after every bound object has terminal evidence", async () => {
    const detached = completionFixture("detached");
    detached.objectReconciliation.pending = 0;
    detached.objectReconciliation.reconciled = 2;
    const reconciled = completionFixture("reconciled", CURRENT_USER_ID);
    apiState.readinessQuery = successfulQuery(
      activeReadiness,
      apiState.refetchReadiness,
    );
    apiState.retentionQuery = successfulQuery(
      [detached.request],
      apiState.refetchRetention,
    );
    apiState.completionQuery = successfulQuery(
      detached,
      apiState.refetchCompletion,
    );
    apiState.reconcileRetention.mockResolvedValue(reconciled);

    renderPage();

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Record reconciliation evidence",
      }),
    );
    fireEvent.change(screen.getByLabelText("Type this exact confirmation"), {
      target: { value: `RECONCILE ${ACTION_ID}` },
    });
    fireEvent.change(screen.getByLabelText("Named operator attestation"), {
      target: {
        value:
          "I verified trustworthy terminal deletion evidence for every bound storage event.",
      },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Record reconciled manifest" }),
    );

    await waitFor(() =>
      expect(apiState.reconcileRetention).toHaveBeenCalledWith(
        expect.objectContaining({
          id: ACTION_ID,
          ifMatch: "3",
          data: expect.objectContaining({
            attestation: expect.stringContaining("terminal deletion evidence"),
          }),
        }),
      ),
    );
    expect(apiState.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Reconciliation evidence recorded" }),
    );
  });

  it.each([
    ["detached", "missing fields", "Record reconciliation evidence"],
    ["reconciled", "missing fields", "Certify as independent checker"],
    ["detached", "malformed digest", "Record reconciliation evidence"],
    ["reconciled", "invalid timestamp", "Certify as independent checker"],
  ] as const)(
    "fails closed before %s evidence can advance with owner-purge %s",
    async (status, invalidProof, unavailableAction) => {
      const snapshot = completionFixture(status);
      if (invalidProof === "missing fields") {
        snapshot.action!.purgeReceipt = null;
        snapshot.action!.purgeReceiptSha256 = null;
        snapshot.action!.purgedAt = null;
      } else if (invalidProof === "malformed digest") {
        snapshot.action!.purgeReceiptSha256 = "not-a-sha256";
      } else {
        snapshot.action!.purgedAt = "not-a-date";
      }
      if (status === "detached") {
        snapshot.objectReconciliation.pending = 0;
        snapshot.objectReconciliation.reconciled = 2;
      }
      apiState.readinessQuery = successfulQuery(
        activeReadiness,
        apiState.refetchReadiness,
      );
      apiState.retentionQuery = successfulQuery(
        [snapshot.request],
        apiState.refetchRetention,
      );
      apiState.completionQuery = successfulQuery(
        snapshot,
        apiState.refetchCompletion,
      );

      renderPage();

      expect(
        await screen.findByText("Owner purge proof is incomplete"),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: unavailableAction }),
      ).not.toBeInTheDocument();
    },
  );

  it("enforces maker-checker separation and shows certificate evidence only when returned", async () => {
    const reconciledByCurrentUser = completionFixture(
      "reconciled",
      CURRENT_USER_ID,
    );
    apiState.readinessQuery = successfulQuery(
      activeReadiness,
      apiState.refetchReadiness,
    );
    apiState.retentionQuery = successfulQuery(
      [reconciledByCurrentUser.request],
      apiState.refetchRetention,
    );
    apiState.completionQuery = successfulQuery(
      reconciledByCurrentUser,
      apiState.refetchCompletion,
    );

    const first = renderPage();

    expect(
      await screen.findByText("A different checker must certify"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "Certify as independent checker",
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("No deletion certificate has been issued"),
    ).toBeInTheDocument();

    first.unmount();
    const certified = completionFixture("certified");
    apiState.retentionQuery = successfulQuery(
      [certified.request],
      apiState.refetchRetention,
    );
    apiState.completionQuery = successfulQuery(
      certified,
      apiState.refetchCompletion,
    );
    renderPage();

    expect(
      await screen.findByText("Independent certificate evidence returned"),
    ).toBeInTheDocument();
    expect(screen.getByText(/RET-2026-0001/)).toBeInTheDocument();
    expect(screen.getByText(/Independent Checker/)).toBeInTheDocument();
  });

  it("lets only a distinct checker certify the exact reconciled action", async () => {
    const reconciled = completionFixture("reconciled", PREPARER_USER_ID);
    const certified = completionFixture("certified");
    apiState.readinessQuery = successfulQuery(
      activeReadiness,
      apiState.refetchReadiness,
    );
    apiState.retentionQuery = successfulQuery(
      [reconciled.request],
      apiState.refetchRetention,
    );
    apiState.completionQuery = successfulQuery(
      reconciled,
      apiState.refetchCompletion,
    );
    apiState.certifyRetention.mockResolvedValue(certified);

    renderPage();

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Certify as independent checker",
      }),
    );
    fireEvent.change(screen.getByLabelText("Type this exact confirmation"), {
      target: { value: `CERTIFY ${ACTION_ID}` },
    });
    fireEvent.change(screen.getByLabelText("Named operator attestation"), {
      target: {
        value:
          "I independently verified both manifests and authorize immutable certificate issuance.",
      },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Issue independent certificate" }),
    );

    await waitFor(() =>
      expect(apiState.certifyRetention).toHaveBeenCalledWith(
        expect.objectContaining({
          id: ACTION_ID,
          ifMatch: "4",
          data: expect.objectContaining({
            attestation: expect.stringContaining("independently verified"),
          }),
        }),
      ),
    );
    expect(apiState.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Retention action certified" }),
    );
  });

  it("does not expose live retention evidence or controls offline", () => {
    apiState.online = false;
    apiState.retentionQuery = successfulQuery(
      [requestFixture()],
      apiState.refetchRetention,
    );
    apiState.readinessQuery = successfulQuery(
      activeReadiness,
      apiState.refetchReadiness,
    );

    renderPage();

    expect(
      screen.getByText("Live retention evidence is unavailable offline"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "Prepare relational detachment",
      }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(PROJECT_ID)).not.toBeInTheDocument();
  });
});
