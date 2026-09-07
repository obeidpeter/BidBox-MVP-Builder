import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch, useGetMe } from "@workspace/api-client-react";
import { ArrowRight, FileDiff, RotateCcw, ShieldCheck } from "lucide-react";
import {
  ADDENDUM_REOPEN_CONFIRMATION,
  adaptAddendumImpactApplication,
  adaptAddendumImpactCentre,
  type AddendumCitation,
  type AddendumImpactApplyRequest,
  type AddendumImpactCentreSnapshot,
  type AddendumImpactReviewDecision,
  type AddendumImpactReviewRequest,
} from "./addendum-impact-contract";
import { StateBadge, StatusPanel } from "@/components/platform-states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useOrganisationAccess } from "@/contexts/organisation-context";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { useToast } from "@/hooks/use-toast";
import { assertAuthorityScopeCurrent } from "@/lib/authority-scope";

const READ_PERMISSIONS = [
  "project:read",
  "document:read",
  "requirement:read",
  "draft:read",
  "package:read",
  "report:read",
] as const;

const APPLY_PERMISSIONS = [
  "project:update",
  "requirement:review",
  "package:generate",
  "report:generate",
] as const;

const ADDENDUM_PERMISSION_KEYS = new Set<string>([
  ...READ_PERMISSIONS,
  "intelligence:review",
  ...APPLY_PERMISSIONS,
]);

type MutationRequest =
  | { kind: "review"; body: AddendumImpactReviewRequest }
  | { kind: "apply"; body: AddendumImpactApplyRequest };

type MutationResult =
  | { kind: "review"; snapshot: AddendumImpactCentreSnapshot }
  | {
      kind: "apply";
      application: AddendumImpactCentreSnapshot["application"];
    };

function displayState(value: string): string {
  return value.replaceAll("_", " ");
}

function displayInstant(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date)
    : value;
}

function Citation({ value }: { value: AddendumCitation | null }) {
  if (!value) {
    return (
      <p className="text-xs text-muted-foreground">No value in this version.</p>
    );
  }
  return (
    <details className="mt-2 text-xs text-muted-foreground">
      <summary className="cursor-pointer font-medium text-foreground">
        View exact source
      </summary>
      <blockquote className="mt-2 border-l-2 border-border pl-3 leading-5">
        “{value.quote}”
      </blockquote>
      <p className="mt-2 font-mono text-[11px]">
        {value.sourceTitle}
        {value.page ? ` · page ${value.page}` : ""}
        {value.section ? ` · ${value.section}` : ""}
      </p>
    </details>
  );
}

function assessmentState(
  snapshot: AddendumImpactCentreSnapshot,
): "active" | "blocked" | "pending" | "empty" {
  if (snapshot.assessment.status === "blocked") return "blocked";
  if (
    snapshot.assessment.status === "no_changes" ||
    snapshot.assessment.status === "reviewed_no_affected_work"
  ) {
    return "empty";
  }
  if (
    snapshot.assessment.readyForReopening &&
    snapshot.review?.decision === "accepted" &&
    !snapshot.reviewStale
  ) {
    return "active";
  }
  return "pending";
}

export default function AddendumImpactCentre({
  projectId,
}: {
  projectId: string;
}) {
  const access = useOrganisationAccess();
  const online = useOnlineStatus();
  const meQuery = useGetMe();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const organisationId = access?.activeOrganisation?.id ?? "";
  const membershipId = access?.activeOrganisation?.membershipId ?? "";
  const accessSource = access?.activeOrganisation?.accessSource ?? "partner";
  const membershipOrganisationId =
    access?.activeOrganisation?.membershipOrganisationId ?? "";
  const actorUserId = meQuery.data?.id ?? "";
  const permissions = access?.effectivePermissions ?? [];
  const capabilityKey = permissions
    .filter((permission) => ADDENDUM_PERMISSION_KEYS.has(permission))
    .sort()
    .join("|");
  const canRead = Boolean(
    organisationId &&
    projectId &&
    actorUserId &&
    READ_PERMISSIONS.every((permission) => permissions.includes(permission)),
  );
  const directMembership = Boolean(
    accessSource === "membership" &&
    membershipId &&
    membershipOrganisationId === organisationId,
  );
  const canReview = Boolean(
    canRead && directMembership && permissions.includes("intelligence:review"),
  );
  const canApply = Boolean(
    canRead &&
    directMembership &&
    APPLY_PERMISSIONS.every((permission) => permissions.includes(permission)),
  );
  const activeScope = useRef({
    organisationId,
    projectId,
    actorUserId,
    membershipId,
    accessSource,
    capabilityKey,
  });
  activeScope.current = {
    organisationId,
    projectId,
    actorUserId,
    membershipId,
    accessSource,
    capabilityKey,
  };
  const queryKey = [
    "addendum-impact-centre",
    organisationId,
    projectId,
    actorUserId,
    membershipId,
    accessSource,
    capabilityKey,
  ] as const;

  const snapshotQuery = useQuery({
    queryKey,
    enabled: canRead && online,
    staleTime: 0,
    gcTime: 0,
    queryFn: async () => {
      const requestedScope = { ...activeScope.current };
      const payload = await customFetch<unknown>(
        `/api/projects/${encodeURIComponent(projectId)}/addendum-impact`,
        { responseType: "json", cache: "no-store" },
      );
      assertAuthorityScopeCurrent(
        activeScope.current,
        requestedScope,
        "Organisation or project access changed while the addendum impact loaded",
      );
      return adaptAddendumImpactCentre(payload, projectId);
    },
  });
  const snapshot = snapshotQuery.data;
  const [reviewDecision, setReviewDecision] =
    useState<AddendumImpactReviewDecision>("accepted");
  const [reviewReason, setReviewReason] = useState("");
  const [applyReason, setApplyReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [lastApplication, setLastApplication] =
    useState<AddendumImpactCentreSnapshot["application"]>(null);

  useEffect(() => {
    setReviewReason("");
    setApplyReason("");
    setConfirmation("");
  }, [projectId, snapshot?.assessment.id, snapshot?.assessment.version]);

  useEffect(() => {
    setLastApplication(null);
  }, [projectId]);

  useEffect(() => {
    if (
      snapshot &&
      snapshot.assessment.impacts.length > 0 &&
      lastApplication?.assessmentId !== snapshot.assessment.id
    ) {
      setLastApplication(null);
    }
  }, [lastApplication?.assessmentId, snapshot]);

  const mutation = useMutation({
    mutationFn: async (request: MutationRequest): Promise<MutationResult> => {
      const requestedScope = { ...activeScope.current };
      const releaseCriticalWorkflow = access?.beginCriticalWorkflow();
      try {
        const path = `/api/projects/${encodeURIComponent(projectId)}/addendum-impact/${request.kind}`;
        const payload = await customFetch<unknown>(path, {
          method: "POST",
          body: JSON.stringify(request.body),
          responseType: "json",
          cache: "no-store",
        });
        assertAuthorityScopeCurrent(
          activeScope.current,
          requestedScope,
          "Organisation or project authority changed while the decision was recorded",
        );
        return request.kind === "review"
          ? {
              kind: "review",
              snapshot: adaptAddendumImpactCentre(payload, projectId),
            }
          : {
              kind: "apply",
              application: adaptAddendumImpactApplication(payload),
            };
      } finally {
        releaseCriticalWorkflow?.();
      }
    },
    onSuccess: (result) => {
      if (result.kind === "review") {
        queryClient.setQueryData(queryKey, result.snapshot);
        setReviewReason("");
        toast({
          title: "Addendum review recorded",
          description:
            result.snapshot.review?.decision === "accepted"
              ? "A different authorised manager can now apply this exact plan."
              : "No downstream work was reopened.",
        });
      } else {
        setLastApplication(result.application);
        setApplyReason("");
        setConfirmation("");
        toast({
          title: "Affected work reopened",
          description: `${result.application?.mutationCount ?? 0} controlled change${result.application?.mutationCount === 1 ? "" : "s"} recorded.`,
        });
      }
      void queryClient.invalidateQueries({ queryKey });
    },
    onError: () => {
      toast({
        variant: "destructive",
        title: "The addendum decision was not recorded",
        description:
          "Reload the comparison. Its review, source versions, access or downstream work may have changed.",
      });
    },
  });

  if (meQuery.isError) {
    return (
      <section className="mx-auto w-full max-w-7xl px-5 pb-8 sm:px-8">
        <StatusPanel
          state="error"
          title="Your identity could not be checked"
          description="No addendum access, review or reopening authority has been assumed. Retry the identity check before continuing."
        >
          <Button
            type="button"
            variant="outline"
            onClick={() => void meQuery.refetch()}
          >
            Try identity check again
          </Button>
        </StatusPanel>
      </section>
    );
  }
  if (access?.isError) {
    return (
      <section className="mx-auto w-full max-w-7xl px-5 pb-8 sm:px-8">
        <StatusPanel
          state="error"
          title="Organisation access could not be checked"
          description="No addendum comparison or authority has been loaded. Retry the organisation access check before continuing."
        >
          <Button type="button" variant="outline" onClick={access.refetch}>
            Try access check again
          </Button>
        </StatusPanel>
      </section>
    );
  }
  if (access?.isLoading || meQuery.isLoading || meQuery.isPending) {
    return (
      <section className="mx-auto w-full max-w-7xl px-5 pb-8 sm:px-8">
        <StatusPanel
          state="pending"
          title="Checking your identity and access"
          description="Waiting for the current organisation and identity before checking addendum permissions."
        />
      </section>
    );
  }
  if (!canRead) {
    return (
      <section className="mx-auto w-full max-w-7xl px-5 pb-8 sm:px-8">
        <StatusPanel
          state="blocked"
          title="Addendum comparison access required"
          description="You need access to this pursuit's documents, requirements, drafts, packages and reports. No partial comparison was loaded."
        />
      </section>
    );
  }
  if (!online) {
    return (
      <section className="mx-auto w-full max-w-7xl px-5 pb-8 sm:px-8">
        <StatusPanel
          state="offline"
          title="Addendum comparisons need a live connection"
          description="Cached information cannot be used to review or reopen affected work. Reconnect to load the current versions."
        />
      </section>
    );
  }
  if (snapshotQuery.isLoading || snapshotQuery.isPending) {
    return (
      <section className="mx-auto w-full max-w-7xl px-5 pb-8 sm:px-8">
        <StatusPanel
          state="pending"
          title="Checking the latest addendum"
          description="Following the verified addendum chain and checking the work affected by this version."
        />
      </section>
    );
  }
  if (snapshotQuery.isError || !snapshot) {
    return (
      <section className="mx-auto w-full max-w-7xl px-5 pb-8 sm:px-8">
        <StatusPanel
          state="error"
          title="The addendum impact could not be verified"
          description="No review or reopening authority has been assumed. Check that every document in the addendum chain is verified and linked to the version before it, then try again."
        >
          <Button
            type="button"
            variant="outline"
            onClick={() => void snapshotQuery.refetch()}
          >
            Try again
          </Button>
        </StatusPanel>
      </section>
    );
  }

  const currentApplication = lastApplication ?? snapshot.application;
  const reviewerIsCurrentActor =
    snapshot.review?.reviewerUserId === actorUserId;
  const acceptedCurrentReview = Boolean(
    snapshot.review?.decision === "accepted" && !snapshot.reviewStale,
  );
  const applyReady = Boolean(
    canApply &&
    acceptedCurrentReview &&
    snapshot.assessment.readyForReopening &&
    !reviewerIsCurrentActor &&
    !currentApplication,
  );

  const submitReview = () => {
    if (!canReview || !snapshot || reviewReason.trim().length < 3) return;
    mutation.mutate({
      kind: "review",
      body: {
        baselineVersionId: snapshot.baseline.documentVersionId,
        revisionVersionId: snapshot.revision.documentVersionId,
        assessmentId: snapshot.assessment.id,
        radarId: snapshot.assessment.radarId,
        expectedImpactManifestSha256: snapshot.assessment.impactManifestSha256,
        expectedAssessmentVersion: snapshot.assessment.version,
        decision: reviewDecision,
        reason: reviewReason.trim(),
      },
    });
  };
  const submitApply = () => {
    if (
      !applyReady ||
      !snapshot ||
      applyReason.trim().length < 3 ||
      confirmation !== ADDENDUM_REOPEN_CONFIRMATION
    ) {
      return;
    }
    mutation.mutate({
      kind: "apply",
      body: {
        baselineVersionId: snapshot.baseline.documentVersionId,
        revisionVersionId: snapshot.revision.documentVersionId,
        assessmentId: snapshot.assessment.id,
        radarId: snapshot.assessment.radarId,
        expectedImpactManifestSha256: snapshot.assessment.impactManifestSha256,
        expectedAssessmentVersion: snapshot.assessment.version,
        reason: applyReason.trim(),
        confirmation,
      },
    });
  };

  return (
    <section
      aria-labelledby="addendum-impact-heading"
      className="mx-auto w-full max-w-7xl space-y-5 px-5 pb-8 sm:px-8"
    >
      <Card className="shadow-none">
        <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <FileDiff aria-hidden="true" className="size-4" />
              Addendum Impact Centre
            </div>
            <h2
              id="addendum-impact-heading"
              className="text-xl font-semibold tracking-tight"
            >
              See what changed before reopening work
            </h2>
            <CardDescription className="mt-2 max-w-3xl leading-6">
              We follow the verified addendum chain and compare this version
              with the effective version just before it. Every value stays
              linked to its exact source, and review remains separate from
              reopening work.
            </CardDescription>
          </div>
          <StateBadge
            state={assessmentState(snapshot)}
            label={displayState(snapshot.assessment.status)}
          />
        </CardHeader>
        <CardContent>
          <p className="rounded-md border bg-muted/40 p-3 text-xs leading-5 text-muted-foreground">
            {snapshot.authorityNote}
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1fr_auto_1fr] lg:items-stretch">
        {(
          [
            ["Effective version before this addendum", snapshot.baseline],
            ["Selected addendum", snapshot.revision],
          ] as const
        ).map(([label, source], index) => (
          <div key={source.documentVersionId} className="contents">
            {index === 1 ? (
              <div className="hidden items-center lg:flex">
                <ArrowRight
                  aria-hidden="true"
                  className="size-5 text-muted-foreground"
                />
              </div>
            ) : null}
            <Card className="shadow-none">
              <CardHeader>
                <CardDescription>{label}</CardDescription>
                <CardTitle className="break-words text-base">
                  {source.filename}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-xs text-muted-foreground">
                <p>Version {source.versionNumber}</p>
                <p>Captured {displayInstant(source.capturedAt)}</p>
                <p className="break-all font-mono text-[11px]">
                  Document version {source.documentVersionId}
                </p>
              </CardContent>
            </Card>
          </div>
        ))}
      </div>

      {snapshot.assessment.issues.length > 0 ? (
        <StatusPanel
          state={
            snapshot.assessment.issues.some(
              ({ severity }) => severity === "blocker",
            )
              ? "blocked"
              : "partial"
          }
          title="Comparison checks need attention"
          description={snapshot.assessment.issues
            .map(({ message }) => message)
            .join(" ")}
        />
      ) : null}

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle className="text-base">
            Changes found ({snapshot.assessment.changes.length})
          </CardTitle>
          <CardDescription>
            Each value is tied to the exact text in its document version.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {snapshot.assessment.changes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No verified field changes were found between these versions.
            </p>
          ) : (
            snapshot.assessment.changes.map((change) => (
              <article key={change.id} className="rounded-lg border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">
                    {displayState(change.category)} ·{" "}
                    {displayState(change.kind)}
                  </h3>
                  <Badge variant="outline">
                    {displayState(change.reviewState)}
                  </Badge>
                </div>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div className="rounded-md bg-muted/40 p-3">
                    <p className="text-xs font-medium text-muted-foreground">
                      Before
                    </p>
                    <p className="mt-1 text-sm">
                      {change.beforeValue ?? "Not present"}
                    </p>
                    <Citation value={change.beforeCitation} />
                  </div>
                  <div className="rounded-md bg-muted/40 p-3">
                    <p className="text-xs font-medium text-muted-foreground">
                      After
                    </p>
                    <p className="mt-1 text-sm">
                      {change.afterValue ?? "Removed"}
                    </p>
                    <Citation value={change.afterCitation} />
                  </div>
                </div>
              </article>
            ))
          )}
        </CardContent>
      </Card>

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle className="text-base">
            Affected work ({snapshot.assessment.impacts.length})
          </CardTitle>
          <CardDescription>
            Applying the plan changes only the listed objects at the listed
            versions.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {snapshot.assessment.impacts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No current downstream work needs to be reopened or invalidated.
            </p>
          ) : (
            snapshot.assessment.impacts.map((impact) => (
              <div
                key={`${impact.objectType}:${impact.targetId}`}
                className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="text-sm font-semibold">{impact.label}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {displayState(impact.objectType)} · current state{" "}
                    {displayState(impact.currentState)} · version{" "}
                    {impact.currentVersion}
                  </p>
                </div>
                <Badge variant="outline">
                  {displayState(impact.proposedAction)}
                </Badge>
              </div>
            ))
          )}
          <div className="grid gap-2 rounded-md bg-muted/40 p-3 font-mono text-[11px] text-muted-foreground">
            <p className="break-all">
              Source manifest: {snapshot.assessment.sourceManifestSha256}
            </p>
            <p className="break-all">
              Impact plan: {snapshot.assessment.impactManifestSha256}
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card className="shadow-none">
          <CardHeader>
            <div className="flex items-center gap-2">
              <ShieldCheck aria-hidden="true" className="size-4" />
              <CardTitle className="text-base">
                1. Review the impact plan
              </CardTitle>
            </div>
            <CardDescription>
              A review records a named decision. It does not reopen or
              invalidate anything.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {snapshot.review ? (
              <div className="rounded-md border bg-muted/40 p-3 text-sm">
                <p className="font-medium">
                  {displayState(snapshot.review.decision)} by{" "}
                  {snapshot.review.reviewerName}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {displayInstant(snapshot.review.reviewedAt)} · version{" "}
                  {snapshot.review.version}
                  {snapshot.reviewStale ? " · no longer current" : ""}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  {snapshot.review.reason}
                </p>
              </div>
            ) : null}
            {!canReview ? (
              <p className="text-sm text-muted-foreground">
                A direct member with Addendum review permission must record this
                decision.
              </p>
            ) : (
              <>
                <div className="grid gap-2">
                  <Label htmlFor="addendum-review-decision">Decision</Label>
                  <select
                    id="addendum-review-decision"
                    className="min-h-10 rounded-md border border-input bg-background px-3 text-sm"
                    value={reviewDecision}
                    disabled={mutation.isPending}
                    onChange={(event) =>
                      setReviewDecision(
                        event.currentTarget
                          .value as AddendumImpactReviewDecision,
                      )
                    }
                  >
                    <option value="accepted">Accept this exact plan</option>
                    <option value="changes_requested">Request changes</option>
                    <option value="rejected">Reject</option>
                  </select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="addendum-review-reason">Reason</Label>
                  <Textarea
                    id="addendum-review-reason"
                    maxLength={2_000}
                    value={reviewReason}
                    disabled={mutation.isPending}
                    onChange={(event) =>
                      setReviewReason(event.currentTarget.value)
                    }
                    placeholder="Explain what you checked and why you made this decision."
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  disabled={
                    mutation.isPending || reviewReason.trim().length < 3
                  }
                  onClick={submitReview}
                >
                  Record named review
                </Button>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-none">
          <CardHeader>
            <div className="flex items-center gap-2">
              <RotateCcw aria-hidden="true" className="size-4" />
              <CardTitle className="text-base">
                2. Apply the reviewed plan
              </CardTitle>
            </div>
            <CardDescription>
              A different authorised manager must apply the accepted plan. The
              reviewer cannot apply their own decision.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {currentApplication ? (
              <StatusPanel
                state="active"
                title="Controlled reopening recorded"
                description={`${currentApplication.mutationCount} change${currentApplication.mutationCount === 1 ? "" : "s"} applied by ${currentApplication.appliedByName} on ${displayInstant(currentApplication.appliedAt)}. ${currentApplication.reason}`}
              />
            ) : !canApply ? (
              <p className="text-sm text-muted-foreground">
                Applying requires a direct operational manager with project,
                requirement, package and report authority.
              </p>
            ) : reviewerIsCurrentActor ? (
              <StatusPanel
                state="blocked"
                title="A different person must apply this plan"
                description="You recorded the review. Ask another authorised manager to reload and apply the accepted plan."
              />
            ) : !acceptedCurrentReview ? (
              <p className="text-sm text-muted-foreground">
                An accepted current review is required before this step becomes
                available.
              </p>
            ) : (
              <>
                <div className="grid gap-2">
                  <Label htmlFor="addendum-apply-reason">
                    Reason for reopening
                  </Label>
                  <Textarea
                    id="addendum-apply-reason"
                    maxLength={2_000}
                    value={applyReason}
                    disabled={mutation.isPending}
                    onChange={(event) =>
                      setApplyReason(event.currentTarget.value)
                    }
                    placeholder="Explain why this exact reviewed work must be reopened."
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="addendum-confirmation">
                    Type {snapshot.requiredConfirmation}
                  </Label>
                  <Input
                    id="addendum-confirmation"
                    autoComplete="off"
                    value={confirmation}
                    disabled={mutation.isPending}
                    onChange={(event) =>
                      setConfirmation(event.currentTarget.value)
                    }
                  />
                </div>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={
                    mutation.isPending ||
                    !applyReady ||
                    applyReason.trim().length < 3 ||
                    confirmation !== ADDENDUM_REOPEN_CONFIRMATION
                  }
                  onClick={submitApply}
                >
                  Apply controlled reopening
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
