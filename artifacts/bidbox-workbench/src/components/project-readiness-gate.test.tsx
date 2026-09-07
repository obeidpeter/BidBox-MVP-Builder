import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { Project } from "@workspace/api-client-react";

import { ProjectReadinessGate } from "@/components/project-readiness-gate";

const queryState = vi.hoisted(() => ({
  current: {
    data: undefined,
    isLoading: true,
    isPending: true,
    isError: false,
    isFetching: true,
  },
}));

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@workspace/api-client-react")>();
  const loadingQuery = () => queryState.current;
  return {
    ...actual,
    useGetProjectScorecard: loadingQuery,
    useGetRisk: loadingQuery,
    useListBoqChecks: loadingQuery,
    useListDefects: loadingQuery,
    useListDocuments: loadingQuery,
    useListEvidence: loadingQuery,
    useListReports: loadingQuery,
    useListRequirements: loadingQuery,
  };
});

const project: Project = {
  id: "11111111-1111-4111-8111-111111111111",
  clientId: "22222222-2222-4222-8222-222222222222",
  tenderTitle: "Test pursuit",
  status: "intake",
  reviewerId: null,
  reviewerName: null,
  conflictStatus: "clear",
  createdAt: "2026-08-30T08:00:00.000Z",
};

describe("ProjectReadinessGate", () => {
  beforeEach(() => {
    queryState.current = {
      data: undefined,
      isLoading: true,
      isPending: true,
      isError: false,
      isFetching: true,
    };
  });

  it("labels its loading state and reports that assessment state upstream", async () => {
    const onAssessmentChange = vi.fn();
    render(
      <ProjectReadinessGate
        project={project}
        onGoToTab={vi.fn()}
        onAssessmentChange={onAssessmentChange}
      />,
    );

    expect(screen.getByRole("status")).toHaveAccessibleName(
      "Checking readiness",
    );
    await waitFor(() => {
      expect(onAssessmentChange).toHaveBeenCalledWith({ status: "loading" });
    });
  });

  it("keeps a cold paused pending query in the labelled loading state", async () => {
    queryState.current = {
      data: undefined,
      isLoading: false,
      isPending: true,
      isError: false,
      isFetching: false,
    };
    const onAssessmentChange = vi.fn();
    render(
      <ProjectReadinessGate
        project={project}
        onGoToTab={vi.fn()}
        onAssessmentChange={onAssessmentChange}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Checking readiness");
    expect(screen.queryByText(/blocker/i)).not.toBeInTheDocument();
    await waitFor(() => {
      expect(onAssessmentChange).toHaveBeenCalledWith({ status: "loading" });
    });
  });

  it("fails closed when an error and another pending state overlap", async () => {
    queryState.current = {
      data: undefined,
      isLoading: false,
      isPending: true,
      isError: true,
      isFetching: false,
    };
    const onAssessmentChange = vi.fn();
    render(
      <ProjectReadinessGate
        project={project}
        onGoToTab={vi.fn()}
        onAssessmentChange={onAssessmentChange}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "readiness cannot be assessed",
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(onAssessmentChange).toHaveBeenCalledWith({ status: "error" });
    });
  });

  it("withdraws a cached assessment while invalidated registers refetch", async () => {
    queryState.current = {
      data: undefined,
      isLoading: false,
      isPending: false,
      isError: false,
      isFetching: false,
    };
    const onAssessmentChange = vi.fn();
    const onGoToTab = vi.fn();
    const { rerender } = render(
      <ProjectReadinessGate
        project={project}
        onGoToTab={onGoToTab}
        onAssessmentChange={onAssessmentChange}
      />,
    );

    await waitFor(() => {
      expect(onAssessmentChange).toHaveBeenCalledWith(
        expect.objectContaining({ status: "ready" }),
      );
    });

    queryState.current = {
      ...queryState.current,
      isFetching: true,
    };
    rerender(
      <ProjectReadinessGate
        project={project}
        onGoToTab={onGoToTab}
        onAssessmentChange={onAssessmentChange}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Checking readiness");
    await waitFor(() => {
      expect(onAssessmentChange).toHaveBeenLastCalledWith({
        status: "loading",
      });
    });
  });
});
