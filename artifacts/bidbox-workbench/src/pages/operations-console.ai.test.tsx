import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import OperationsConsole from "./operations-console";

const mockState = vi.hoisted(() => ({
  aiData: undefined as Record<string, unknown> | undefined,
  aiError: false,
  aiLoading: false,
}));

vi.mock("@/hooks/use-online-status", () => ({
  useOnlineStatus: () => true,
}));

vi.mock("@workspace/api-client-react", () => ({
  useListProjects: () => ({
    data: [],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useGetWorkflowAlerts: () => ({
    data: { slaBreaches: [], redTeamDue: [], vaultExpiring: [] },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useGetVaultExpiring: () => ({
    data: { buckets: { expired: 0 } },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useGetAiOperations: () => ({
    data: mockState.aiData,
    isLoading: mockState.aiLoading,
    isError: mockState.aiError,
    refetch: vi.fn(),
  }),
}));

function aiSnapshot() {
  return {
    generatedAt: "2026-08-09T20:00:00.000Z",
    environment: "production",
    productionAiEnabled: false,
    globalKillSwitchEngaged: true,
    modelConfiguration: {
      model: "approved-model",
      configurationVersion: null,
      status: "draft",
      evaluationApproved: false,
    },
    budget: null,
    providerPolicy: {
      requiredRegion: "",
      requireZeroRetention: false,
      maxRetentionDays: -1,
      restrictedModeSupported: false,
    },
    releaseGate: {
      applicable: true,
      allowed: false,
      blockerCodes: ["release_evidence_missing"],
      expectedVersions: {
        model: "approved-model",
        modelConfiguration: "",
        prompt: "ai-foundation-v1",
        promptRegistry: "prompt-registry-hash",
        schema: "schema-set-hash",
        retrieval: "",
        index: "",
      },
    },
    blockers: [
      "AI_GLOBAL_DISABLED",
      "AI_RELEASE_GATE_DENIED",
      "AI_BUDGET_UNAVAILABLE",
    ],
    capabilities: [
      {
        id: "extract_requirements",
        autonomyLevel: 2,
        outputState: "non_authoritative_draft",
        approvalAuthority: "requirement:review",
        environmentApproved: false,
        tenantEnabled: false,
        effectiveEnabled: false,
        promptVersion: "requirements-v2",
        promptHash: "prompt-hash-must-not-render",
        schemaVersion: "requirements-schema-v2",
        schemaHash: "schema-hash-must-not-render",
        limits: {
          maxInputBytes: 60_000,
          maxOutputTokens: 8_192,
          timeoutMs: 45_000,
          maxRetriesPerProvider: 1,
          maxFallbackProviders: 1,
          maxCostMinor: 300_000,
          costCurrency: "NGN",
        },
      },
    ],
    recentRuns: [
      {
        id: "run-id",
        projectId: "project-id",
        task: "extract_requirements",
        model: "approved-model",
        promptVersion: "requirements-v2",
        promptTokens: 10,
        completionTokens: 5,
        status: "failed",
        errorCode: "AI_RELEASE_GATE_DENIED",
        createdAt: "2026-08-09T19:00:00.000Z",
      },
    ],
    evaluations: [
      {
        id: "evaluation-id",
        task: "extract_requirements",
        corpusVersion: "holdout-v1",
        status: "completed",
        sampleSize: 25,
        releaseDecision: "denied",
        startedAt: "2026-08-09T18:00:00.000Z",
        completedAt: "2026-08-09T18:30:00.000Z",
      },
    ],
  };
}

describe("AI operations console", () => {
  beforeEach(() => {
    mockState.aiData = aiSnapshot();
    mockState.aiError = false;
    mockState.aiLoading = false;
  });

  it("shows default-off, release, capability and sanitised telemetry evidence", () => {
    render(<OperationsConsole />);

    expect(
      screen.getByRole("heading", { name: "AI service controls" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "AI is disabled by the global switch",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Global production switch is off"),
    ).toBeInTheDocument();
    expect(screen.getByText("release_evidence_missing")).toBeInTheDocument();
    expect(screen.getByText("ai-foundation-v1")).toBeInTheDocument();
    expect(
      screen.getByText(/No approved model provider is eligible/i),
    ).toBeInTheDocument();
    expect(screen.getAllByText("extract requirements").length).toBeGreaterThan(
      0,
    );
    expect(
      screen.getByText("holdout-v1", { exact: false }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("prompt-hash-must-not-render"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("schema-hash-must-not-render"),
    ).not.toBeInTheDocument();
  });

  it("treats empty run and evaluation histories as unknown rather than approval", () => {
    mockState.aiData = {
      ...aiSnapshot(),
      recentRuns: [],
      evaluations: [],
    };

    render(<OperationsConsole />);

    expect(
      screen.getByRole("heading", {
        name: "No AI runs are recorded for this organisation",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/not proof that a provider was never contacted/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "No evaluation runs are recorded for this organisation",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/does not show that a promotion decision was made/i),
    ).toBeInTheDocument();
  });

  it("does not present an AI query failure as a disabled or empty system", () => {
    mockState.aiData = undefined;
    mockState.aiError = true;

    render(<OperationsConsole />);

    expect(
      screen.getByRole("heading", {
        name: "AI service status could not be loaded",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", {
        name: "No AI runs are recorded for this organisation",
      }),
    ).not.toBeInTheDocument();
  });

  it("reports non-production release evidence as not evaluated and zero budget as blocked", () => {
    mockState.aiData = {
      ...aiSnapshot(),
      environment: "development",
      globalKillSwitchEngaged: false,
      budget: {
        currency: "NGN",
        remainingMinor: 0,
        rateCardVersion: "rate-card-v1",
      },
      releaseGate: {
        ...aiSnapshot().releaseGate,
        applicable: false,
        allowed: false,
        blockerCodes: [],
      },
      blockers: ["AI_BUDGET_EXCEEDED"],
    };

    render(<OperationsConsole />);

    expect(
      screen.getByRole("heading", {
        name: "AI services are in development mode",
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Not evaluated").length).toBeGreaterThan(0);
    expect(screen.getByText("Exhausted")).toBeInTheDocument();
    expect(
      screen.getByText("The approved runtime budget is exhausted"),
    ).toBeInTheDocument();
  });

  it("does not render a production capability as enabled when platform readiness is blocked", () => {
    const snapshot = aiSnapshot();
    mockState.aiData = {
      ...snapshot,
      globalKillSwitchEngaged: false,
      capabilities: snapshot.capabilities.map((capability) => ({
        ...capability,
        environmentApproved: true,
        tenantEnabled: true,
        effectiveEnabled: true,
      })),
    };

    render(<OperationsConsole />);

    expect(screen.queryByText("Enabled")).not.toBeInTheDocument();
    expect(screen.getAllByText("Disabled").length).toBeGreaterThan(0);
  });
});
