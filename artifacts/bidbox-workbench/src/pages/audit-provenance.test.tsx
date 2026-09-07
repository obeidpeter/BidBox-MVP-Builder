import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AuditTab } from "./project-tabs/audit-tab";
import SecurityAudit from "./security-audit";

const mockState = vi.hoisted(() => ({
  auditEvents: [] as Array<Record<string, unknown>>,
  assessments: [] as Array<Record<string, unknown>>,
  assessmentError: false,
  assessmentLoading: false,
}));

vi.mock("@workspace/api-client-react", () => ({
  useListAudit: () => ({
    data: mockState.auditEvents,
    isLoading: false,
  }),
  useGetAccessReview: () => ({
    data: { month: "2026-08", rows: [] },
    isLoading: false,
    isPending: false,
    isError: false,
    isSuccess: true,
    refetch: vi.fn(),
  }),
  useGetLegacyIntegrityAssessment: () => ({
    data: mockState.assessments,
    isLoading: mockState.assessmentLoading,
    isPending: mockState.assessmentLoading,
    isError: mockState.assessmentError,
    isSuccess: !mockState.assessmentLoading && !mockState.assessmentError,
    refetch: vi.fn(),
  }),
}));

describe("audit provenance visibility", () => {
  beforeEach(() => {
    mockState.auditEvents = [];
    mockState.assessments = [];
    mockState.assessmentError = false;
    mockState.assessmentLoading = false;
  });

  it("distinguishes active verification from a legacy known discontinuity", () => {
    mockState.auditEvents = [
      {
        id: "active-event",
        eventType: "project.viewed",
        userName: "Current reviewer",
        createdAt: "2026-08-09T10:00:00.000Z",
        auditSource: "active_v2",
        integrityStatus: "active_v2_record",
      },
      {
        id: "archived-event",
        eventType: "project.export_denied",
        userName: "Legacy reviewer",
        createdAt: "2026-07-09T10:00:00.000Z",
        auditSource: "legacy_v1_archive",
        integrityStatus: "known_discontinuity",
      },
    ];

    render(<AuditTab projectId="project-under-test" />);

    expect(
      screen.getByText("Preserved legacy v1 evidence"),
    ).toBeInTheDocument();
    expect(screen.getByText("Active v2 chain record")).toBeInTheDocument();
    expect(
      screen.getByText("Legacy v1 archive · known discontinuity"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Legacy v1 archive · active v2 record"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Active v2 · active v2 record"),
    ).not.toBeInTheDocument();
  });

  it("renders the tenant's stored legacy integrity assessment fields", () => {
    mockState.assessments = [
      {
        id: "assessment-under-test",
        organisationId: "organisation-under-test",
        sourceCommit: "source-commit-under-test",
        sourceEventCount: 12,
        verifiedRanges: "1-3, 11-12",
        discontinuityRanges: "4-10",
        finding: "Stored assessment finding for this organisation.",
        probableCause: "Recorded cause remains probable, not proven.",
        externalHeadSeq: 12,
        externalHeadHash: "external-head-under-test",
        sourceBackupSha256: "backup-digest-under-test",
        sourceAuditExportSha256: "audit-export-digest-under-test",
        rehearsalEvidenceSha256: "rehearsal-digest-under-test",
        archiveDigest: "archive-digest-under-test",
        assessedAt: "2026-08-08T12:00:00.000Z",
        createdAt: "2026-08-08T12:00:00.000Z",
        integrityStatus: "KNOWN_DISCONTINUITY",
      },
    ];

    render(<SecurityAudit />);

    expect(
      screen.getByRole("heading", {
        name: "Recorded gap in the legacy v1 audit chain",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Stored assessment finding for this organisation."),
    ).toBeInTheDocument();
    expect(screen.getByText("1-3, 11-12")).toBeInTheDocument();
    expect(screen.getByText("4-10")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Recorded probable cause: Recorded cause remains probable, not proven.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        /no evidence that audit events are externally anchored/i,
      ),
    ).not.toBeInTheDocument();
  });

  it("does not treat an empty assessment response as proof of integrity", () => {
    render(<SecurityAudit />);

    expect(
      screen.getByRole("heading", {
        name: "No legacy integrity assessment is stored",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/does not prove that the older audit chain is intact/i),
    ).toBeInTheDocument();
  });

  it("does not present an assessment fetch error as an empty archive", () => {
    mockState.assessmentError = true;

    render(<SecurityAudit />);

    expect(
      screen.getByRole("heading", {
        name: "Legacy integrity assessment could not be loaded",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", {
        name: "No legacy integrity assessment is stored",
      }),
    ).not.toBeInTheDocument();
  });
});
