import {
  getGetProjectIntelligenceQueryKey,
  getListProjectsQueryKey,
  useClaimIntelligenceReview,
  useDecideIntelligenceReview,
  useGetProjectIntelligence,
  useListProjects,
} from "@workspace/api-client-react";
import { useSearchParams } from "wouter";
import IntelligenceCentre, {
  type IntelligenceCentreLoadState,
} from "./intelligence-centre";
import type { IntelligenceCentreSnapshot } from "@/components/intelligence/intelligence-contract";
import { StatusPanel } from "@/components/platform-states";
import { useOrganisationAccess } from "@/contexts/organisation-context";
import { useToast } from "@/hooks/use-toast";
import { INTELLIGENCE_READ_PERMISSIONS } from "@/lib/platform-access";
import type { IntelligenceReviewDecision } from "@/components/intelligence/intelligence-review-inbox";
import AddendumImpactCentre from "@/components/intelligence/addendum-impact-centre";

function disconnectedSnapshot(): IntelligenceCentreSnapshot {
  return {
    environment: import.meta.env.PROD ? "production" : "development",
    productionAiEnabled: false,
    restrictedMode: false,
    generatedAt: null,
    capabilities: [],
  };
}

export default function IntelligenceCentreRoute() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast } = useToast();
  const organisationAccess = useOrganisationAccess();
  const hasCompleteReadAccess = Boolean(
    organisationAccess?.activeOrganisation &&
    INTELLIGENCE_READ_PERMISSIONS.every((permission) =>
      organisationAccess.effectivePermissions.includes(permission),
    ),
  );
  const projectsQuery = useListProjects(undefined, {
    query: {
      queryKey: getListProjectsQueryKey(),
      enabled: hasCompleteReadAccess,
    },
  });
  const projects = projectsQuery.data ?? [];
  const requestedProjectId = searchParams.get("project");
  const selectedProject =
    projects.find(({ id }) => id === requestedProjectId) ?? projects[0];
  const selectedProjectId = selectedProject?.id ?? "";
  const intelligenceQuery = useGetProjectIntelligence(selectedProjectId, {
    query: {
      enabled: hasCompleteReadAccess && selectedProjectId.length > 0,
      queryKey: getGetProjectIntelligenceQueryKey(selectedProjectId),
    },
  });
  const claimReview = useClaimIntelligenceReview({
    mutation: {
      onSuccess: () => {
        toast({ title: "Review item claimed" });
        void intelligenceQuery.refetch();
      },
      onError: () => {
        toast({
          variant: "destructive",
          title: "Review claim could not be recorded",
          description:
            "Refresh the current pursuit before trying again. The source or review version may have changed.",
        });
      },
    },
  });
  const decideReview = useDecideIntelligenceReview({
    mutation: {
      onSuccess: () => {
        toast({ title: "Review decision recorded" });
        void intelligenceQuery.refetch();
      },
      onError: () => {
        toast({
          variant: "destructive",
          title: "Review decision could not be recorded",
          description:
            "Refresh the current pursuit before trying again. No release or evidence approval was granted.",
        });
      },
    },
  });

  let loadState: IntelligenceCentreLoadState;
  if (
    projectsQuery.isLoading ||
    projectsQuery.isPending ||
    (selectedProjectId.length > 0 &&
      (intelligenceQuery.isLoading || intelligenceQuery.isPending))
  ) {
    loadState = { status: "loading" };
  } else if (projectsQuery.isError || intelligenceQuery.isError) {
    loadState = {
      status: "error",
      message:
        "The project list or intelligence summary could not be loaded for this organisation.",
      retry: () => {
        void projectsQuery.refetch();
        if (selectedProjectId) void intelligenceQuery.refetch();
      },
    };
  } else if (selectedProjectId.length > 0 && !intelligenceQuery.data) {
    loadState = {
      status: "error",
      message: "The intelligence summary could not be verified.",
      retry: () => void intelligenceQuery.refetch(),
    };
  } else {
    loadState = {
      status: "ready",
      snapshot: intelligenceQuery.data ?? disconnectedSnapshot(),
    };
  }

  const selectProject = (projectId: string) => {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set("project", projectId);
        return next;
      },
      { replace: true },
    );
  };

  const reviewInbox = intelligenceQuery.data?.reviewInbox;
  const hasReviewAccess = Boolean(
    organisationAccess?.effectivePermissions.includes("intelligence:review"),
  );
  const reviewItem = (itemId: string) =>
    reviewInbox?.items.find((item) => item.id === itemId);
  const reviewSourceManifest = () => {
    const value = reviewInbox?.sourceManifestSha256;
    return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value)
      ? value
      : null;
  };
  const showStaleReviewMessage = () =>
    toast({
      variant: "destructive",
      title: "Review source is no longer current",
      description:
        "Refresh the pursuit before recording responsibility or a decision.",
    });
  const claimReviewItem = (itemId: string) => {
    const item = reviewItem(itemId);
    const sourceManifestSha256 = reviewSourceManifest();
    if (
      !hasReviewAccess ||
      !item ||
      !sourceManifestSha256 ||
      item.status !== "pending"
    ) {
      showStaleReviewMessage();
      return;
    }
    claimReview.mutate({
      id: selectedProjectId,
      data: {
        capabilityId: item.capabilityId,
        expectedSourceVersion: item.sourceVersion,
        expectedSourceManifestSha256: sourceManifestSha256,
        expectedReviewVersion: item.reviewVersion,
      },
    });
  };
  const decideReviewItem = (
    itemId: string,
    decision: IntelligenceReviewDecision,
  ) => {
    const item = reviewItem(itemId);
    const sourceManifestSha256 = reviewSourceManifest();
    if (
      !hasReviewAccess ||
      !item ||
      !sourceManifestSha256 ||
      !item.assignedToCurrentUser ||
      item.status !== "in_review" ||
      item.reviewVersion === null
    ) {
      showStaleReviewMessage();
      return;
    }
    decideReview.mutate({
      id: selectedProjectId,
      data: {
        capabilityId: item.capabilityId,
        expectedSourceVersion: item.sourceVersion,
        expectedSourceManifestSha256: sourceManifestSha256,
        expectedReviewVersion: item.reviewVersion,
        decision,
      },
    });
  };

  if (!hasCompleteReadAccess) {
    return (
      <div className="p-6 sm:p-8">
        <StatusPanel
          state="blocked"
          title="Intelligence source access required"
          description="Your current role needs access to every source used here: projects, documents, requirements, evidence, defects, reports, drafts and packages. No partial content was loaded."
        />
      </div>
    );
  }

  return (
    <div>
      {projects.length > 0 ? (
        <section
          aria-labelledby="intelligence-project-heading"
          className="mx-auto w-full max-w-7xl px-5 pt-5 sm:px-8 sm:pt-8"
        >
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 shadow-none sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2
                id="intelligence-project-heading"
                className="text-sm font-semibold"
              >
                Active pursuit
              </h2>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                All information below is limited to the selected organisation
                and pursuit.
              </p>
            </div>
            <label
              className="grid gap-1.5 text-xs font-medium"
              htmlFor="intelligence-project"
            >
              Pursuit
              <select
                id="intelligence-project"
                className="min-h-10 min-w-64 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={selectedProjectId}
                onChange={(event) => selectProject(event.currentTarget.value)}
              >
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.tenderTitle}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>
      ) : null}
      <IntelligenceCentre
        loadState={loadState}
        reviewMutationPending={claimReview.isPending || decideReview.isPending}
        onReviewClaim={hasReviewAccess ? claimReviewItem : undefined}
        onReviewDecision={hasReviewAccess ? decideReviewItem : undefined}
      />
      {selectedProjectId ? (
        <AddendumImpactCentre projectId={selectedProjectId} />
      ) : null}
    </div>
  );
}
