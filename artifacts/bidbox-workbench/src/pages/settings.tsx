import { useEffect, useState, type FormEvent } from "react";
import {
  getGetMeQueryKey,
  getGetRetentionCompletionReadinessQueryKey,
  getGetRetentionRequestCompletionQueryKey,
  useListUsers,
  useListRetentionRequests,
  useGetMe,
  useGetAppConfig,
  useGetRetentionCompletionReadiness,
  useGetRetentionRequestCompletion,
  useCompleteRetentionRequest,
  useReconcileRetentionAction,
  useCertifyRetentionAction,
  useUpdateAppConfig,
  getGetAppConfigQueryKey,
  getListRetentionRequestsQueryKey,
} from "@workspace/api-client-react";
import type {
  AppConfig,
  AppConfigUpdate,
  RetentionAction,
  RetentionCompletionSnapshot,
  RetentionRequest,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  AlertTriangle,
  DatabaseZap,
  Loader2,
  RefreshCw,
  Shield,
  Info,
  SlidersHorizontal,
  FileText,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  DataErrorPanel,
  LoadingPanel,
  StateBadge,
  StatusPanel,
  type SurfaceState,
} from "@/components/platform-states";
import { useOrganisationAccess } from "@/contexts/organisation-context";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { useToast } from "@/hooks/use-toast";
import { errorMessage, mutationErrorToast, requestStatus } from "@/lib/errors";

type RetentionPhase = "detach" | "reconcile" | "certify";

interface RetentionPhaseDraft {
  phase: RetentionPhase;
  confirmation: string;
  attestation: string;
  idempotencyKey: string;
}

const RETENTION_ATTESTATION_MIN_LENGTH = 16;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

function humanise(value: string): string {
  return value.replaceAll("_", " ");
}

function requestSurfaceState(status: RetentionRequest["status"]): SurfaceState {
  if (status === "completed") return "active";
  if (status === "blocked") return "blocked";
  if (status === "reconciling") return "partial";
  return "pending";
}

function actionSurfaceState(status: RetentionAction["status"]): SurfaceState {
  if (status === "certified") return "active";
  if (status === "blocked") return "blocked";
  if (status === "reconciled") return "partial";
  return "pending";
}

function ownerPurgeProofVerified(
  action: RetentionAction | null | undefined,
): boolean {
  if (!action) return false;
  const phaseVersionVerified =
    (action.status === "detached" && action.version === 3) ||
    (action.status === "reconciled" && action.version === 4) ||
    (action.status === "certified" && action.version === 5) ||
    (action.status === "blocked" && action.version >= 3);
  return Boolean(
    phaseVersionVerified &&
    action.purgeReceipt !== null &&
    action.purgeReceipt !== undefined &&
    action.purgeReceiptSha256 &&
    SHA256_PATTERN.test(action.purgeReceiptSha256) &&
    action.purgedAt &&
    Number.isFinite(Date.parse(action.purgedAt)),
  );
}

function phaseConfirmation(
  phase: RetentionPhase,
  snapshot: RetentionCompletionSnapshot,
): string {
  if (phase === "detach") {
    return `DETACH ${snapshot.request.subjectProjectId}`;
  }
  return `${phase === "reconcile" ? "RECONCILE" : "CERTIFY"} ${snapshot.action?.id ?? ""}`;
}

function newRetentionIdempotencyKey(phase: RetentionPhase): string {
  return `retention-${phase}:${crypto.randomUUID()}`;
}

function RetentionOperatorPanel() {
  const access = useOrganisationAccess();
  const online = useOnlineStatus();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const directMembership =
    access?.activeOrganisation?.accessSource === "membership";
  const canManageRetention = Boolean(
    directMembership &&
    access?.effectivePermissions.includes("retention:manage"),
  );
  const liveQueriesEnabled = canManageRetention && online;

  const meQuery = useGetMe({
    query: { queryKey: getGetMeQueryKey(), enabled: liveQueriesEnabled },
  });
  const readinessQuery = useGetRetentionCompletionReadiness({
    query: {
      queryKey: getGetRetentionCompletionReadinessQueryKey(),
      enabled: liveQueriesEnabled,
    },
  });
  const retentionQuery = useListRetentionRequests({
    query: {
      queryKey: getListRetentionRequestsQueryKey(),
      enabled: liveQueriesEnabled,
    },
  });
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(
    null,
  );
  const completionQuery = useGetRetentionRequestCompletion(
    selectedRequestId ?? "",
    {
      query: {
        queryKey: getGetRetentionRequestCompletionQueryKey(
          selectedRequestId ?? "",
        ),
        enabled: liveQueriesEnabled && Boolean(selectedRequestId),
      },
    },
  );
  const completeMutation = useCompleteRetentionRequest();
  const reconcileMutation = useReconcileRetentionAction();
  const certifyMutation = useCertifyRetentionAction();
  const [phaseDraft, setPhaseDraft] = useState<RetentionPhaseDraft | null>(
    null,
  );
  const [phaseError, setPhaseError] = useState<string | null>(null);

  const retentionRequests = retentionQuery.data;
  useEffect(() => {
    if (!retentionRequests || retentionRequests.length === 0) {
      setSelectedRequestId(null);
      return;
    }
    if (
      !selectedRequestId ||
      !retentionRequests.some((request) => request.id === selectedRequestId)
    ) {
      setSelectedRequestId(retentionRequests[0]!.id);
    }
  }, [retentionRequests, selectedRequestId]);

  const snapshot = completionQuery.data;
  useEffect(() => {
    setPhaseDraft(null);
    setPhaseError(null);
  }, [selectedRequestId, snapshot?.action?.version, snapshot?.request.version]);

  const mutationPending =
    completeMutation.isPending ||
    reconcileMutation.isPending ||
    certifyMutation.isPending;
  const readiness = readinessQuery.data;
  const readinessEvidenceCurrent = Boolean(
    liveQueriesEnabled &&
    readinessQuery.isSuccess &&
    !readinessQuery.isError &&
    !readinessQuery.isPending &&
    !readinessQuery.isFetching &&
    readiness,
  );
  const listEvidenceCurrent = Boolean(
    liveQueriesEnabled &&
    retentionQuery.isSuccess &&
    !retentionQuery.isError &&
    !retentionQuery.isPending &&
    !retentionQuery.isFetching &&
    retentionQuery.data,
  );
  const identityEvidenceCurrent = Boolean(
    liveQueriesEnabled &&
    meQuery.isSuccess &&
    !meQuery.isError &&
    !meQuery.isPending &&
    !meQuery.isFetching &&
    meQuery.data?.id,
  );
  const completionEvidenceCurrent = Boolean(
    selectedRequestId &&
    liveQueriesEnabled &&
    completionQuery.isSuccess &&
    !completionQuery.isError &&
    !completionQuery.isPending &&
    !completionQuery.isFetching &&
    snapshot,
  );
  const criticalEvidenceCurrent = Boolean(
    readinessEvidenceCurrent &&
    listEvidenceCurrent &&
    identityEvidenceCurrent &&
    completionEvidenceCurrent,
  );
  const blockers = readiness
    ? [...readiness.activationBlockers, ...readiness.evidenceBlockers]
    : [];
  const activationVerified = Boolean(
    online &&
    readinessEvidenceCurrent &&
    readiness &&
    readiness.activated === true &&
    readiness.manifestValid === true &&
    readiness.environmentOptIn === true &&
    readiness.makerCheckerRequired === true &&
    blockers.length === 0,
  );
  const identityVerified = identityEvidenceCurrent;
  const terminalStorageVerified = Boolean(
    snapshot &&
    snapshot.objectReconciliation.expected ===
      snapshot.objectReconciliation.reconciled &&
    snapshot.objectReconciliation.pending === 0 &&
    snapshot.objectReconciliation.deadLetters === 0 &&
    snapshot.blockers.length === 0,
  );
  const purgeProofVerified = ownerPurgeProofVerified(snapshot?.action);
  const certificateEvidenceVerified = Boolean(
    snapshot?.certificate &&
    purgeProofVerified &&
    snapshot.request.status === "completed" &&
    snapshot.action?.status === "certified" &&
    snapshot.certificate.retentionActionId === snapshot.action.id &&
    snapshot.certificate.signedByUserId === snapshot.action.checkedByUserId &&
    snapshot.action.checkedByUserId !== snapshot.action.preparedByUserId &&
    snapshot.certificate.scopeManifestHash ===
      snapshot.action.sourceManifestSha256,
  );
  const legacyProtocolEvidence = Boolean(
    snapshot &&
    snapshot.request.completionProtocolVersion === 0 &&
    !snapshot.action &&
    !snapshot.certificate,
  );
  const startAuthorized = Boolean(
    readiness?.permissions.canStart && snapshot?.permissions.canStart,
  );
  const reconcileAuthorized = Boolean(
    readiness?.permissions.canReconcile && snapshot?.permissions.canReconcile,
  );
  const certifyAuthorized = Boolean(
    readiness?.permissions.canCertify && snapshot?.permissions.canCertify,
  );

  useEffect(() => {
    if (!criticalEvidenceCurrent || !activationVerified || !identityVerified) {
      setPhaseDraft(null);
      setPhaseError(null);
    }
  }, [activationVerified, criticalEvidenceCurrent, identityVerified]);

  const openPhase = (phase: RetentionPhase) => {
    setPhaseError(null);
    setPhaseDraft({
      phase,
      confirmation: "",
      attestation: "",
      idempotencyKey: newRetentionIdempotencyKey(phase),
    });
  };

  const refreshEvidence = () => {
    void readinessQuery.refetch();
    void retentionQuery.refetch();
    if (selectedRequestId) void completionQuery.refetch();
  };

  const recordPhase = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      !phaseDraft ||
      !snapshot ||
      !activationVerified ||
      !identityVerified ||
      !criticalEvidenceCurrent
    ) {
      setPhaseError(
        "Live activation, identity and completion evidence must be verified before this action.",
      );
      return;
    }
    const expectedConfirmation = phaseConfirmation(phaseDraft.phase, snapshot);
    const attestation = phaseDraft.attestation.trim();
    if (phaseDraft.confirmation !== expectedConfirmation) {
      setPhaseError("The typed confirmation does not match this exact record.");
      return;
    }
    if (
      attestation.length < RETENTION_ATTESTATION_MIN_LENGTH ||
      attestation.length > 512
    ) {
      setPhaseError("The attestation must contain 16 to 512 characters.");
      return;
    }

    const releaseCriticalWorkflow = access?.beginCriticalWorkflow();
    try {
      let result: RetentionCompletionSnapshot;
      if (phaseDraft.phase === "detach") {
        if (!startAuthorized || snapshot.request.version !== 1) {
          throw new Error("The server did not grant phase-one authority.");
        }
        result = await completeMutation.mutateAsync({
          id: snapshot.request.id,
          data: { attestation },
          ifMatch: String(snapshot.request.version),
          idempotencyKey: phaseDraft.idempotencyKey,
        });
        if (
          result.request.status !== "reconciling" ||
          result.request.version !== 2 ||
          result.action?.status !== "detached" ||
          result.action.version !== 3 ||
          !ownerPurgeProofVerified(result.action) ||
          result.action.retentionRequestId !== result.request.id ||
          result.action.subjectProjectId !== result.request.subjectProjectId ||
          result.certificate !== null
        ) {
          throw new Error(
            "The server response did not prove detached version 3 with a complete owner-purge receipt.",
          );
        }
      } else if (phaseDraft.phase === "reconcile") {
        if (
          !snapshot.action ||
          !reconcileAuthorized ||
          !purgeProofVerified ||
          !terminalStorageVerified
        ) {
          throw new Error(
            "Exact terminal storage evidence is not ready for reconciliation.",
          );
        }
        result = await reconcileMutation.mutateAsync({
          id: snapshot.action.id,
          data: { attestation },
          ifMatch: String(snapshot.action.version),
          idempotencyKey: phaseDraft.idempotencyKey,
        });
        if (
          result.request.status !== "reconciling" ||
          result.action?.status !== "reconciled" ||
          result.action.version !== 4 ||
          !ownerPurgeProofVerified(result.action) ||
          !result.action.reconciliationManifestSha256 ||
          result.action.id !== snapshot.action.id ||
          result.action.preparedByUserId !== meQuery.data?.id ||
          result.action.retentionRequestId !== result.request.id ||
          result.certificate !== null
        ) {
          throw new Error(
            "The server response did not contain owner-purge proof and exact version 4 reconciliation evidence.",
          );
        }
      } else {
        if (
          !snapshot.action ||
          !certifyAuthorized ||
          !purgeProofVerified ||
          snapshot.action.preparedByUserId === meQuery.data?.id
        ) {
          throw new Error(
            "Certification requires a different authorised checker.",
          );
        }
        result = await certifyMutation.mutateAsync({
          id: snapshot.action.id,
          data: { attestation },
          ifMatch: String(snapshot.action.version),
          idempotencyKey: phaseDraft.idempotencyKey,
        });
        if (
          result.request.status !== "completed" ||
          result.action?.status !== "certified" ||
          result.action.version !== 5 ||
          !ownerPurgeProofVerified(result.action) ||
          !result.certificate ||
          result.action.id !== snapshot.action.id ||
          result.action.checkedByUserId !== meQuery.data?.id ||
          result.certificate.signedByUserId !== meQuery.data?.id ||
          result.action.checkedByUserId === result.action.preparedByUserId ||
          result.certificate.retentionActionId !== result.action.id ||
          result.certificate.scopeManifestHash !==
            result.action.sourceManifestSha256
        ) {
          throw new Error(
            "The server response did not contain owner-purge proof and independent version 5 certificate evidence.",
          );
        }
      }

      queryClient.setQueryData(
        getGetRetentionRequestCompletionQueryKey(snapshot.request.id),
        result,
      );
      void queryClient.invalidateQueries({
        queryKey: getListRetentionRequestsQueryKey(),
      });
      void queryClient.invalidateQueries({
        queryKey: getGetRetentionCompletionReadinessQueryKey(),
      });
      setPhaseDraft(null);
      setPhaseError(null);
      toast({
        title:
          result.request.status === "completed"
            ? "Retention action certified"
            : result.action?.status === "reconciled"
              ? "Reconciliation evidence recorded"
              : "Relational detachment started",
        description:
          result.request.status === "completed"
            ? "The server returned an independently signed certificate."
            : result.action?.status === "reconciled"
              ? "A different authorised checker must certify this exact action."
              : "The server returned an owner-purge receipt. Durable object evidence is still being reconciled; no certificate was issued.",
      });
    } catch (error) {
      const status = requestStatus(error);
      const stale = status === 409 || status === 412 || status === 428;
      setPhaseError(
        stale
          ? "This record or its evidence changed. Live state is being reloaded; review it before trying again."
          : errorMessage(
              error,
              "The retention action was not recorded. No completion or certification has been assumed.",
            ),
      );
      if (stale) setPhaseDraft(null);
      refreshEvidence();
      toast({
        variant: "destructive",
        title: "Retention action not confirmed",
        description: stale
          ? "A current version is required. Review the refreshed evidence."
          : "Verify the live request, storage evidence and authority before retrying.",
      });
    } finally {
      releaseCriticalWorkflow?.();
    }
  };

  if (!canManageRetention) {
    return (
      <StatusPanel
        state="blocked"
        title="Retention management permission required"
        description="A current direct membership with retention management permission is required. Partner and emergency access cannot run this destructive workflow."
      />
    );
  }

  if (!online) {
    return (
      <StatusPanel
        state="offline"
        title="Live retention evidence is unavailable offline"
        description="Reconnect before reviewing or acting. Cached request, object or certificate data is not treated as current authority."
      />
    );
  }

  const readinessPending = readinessQuery.isLoading || readinessQuery.isPending;
  const readinessUnavailable =
    readinessQuery.isError ||
    (!readinessPending && (!readinessQuery.isSuccess || !readiness));
  const retentionPending = retentionQuery.isLoading || retentionQuery.isPending;
  const retentionUnavailable =
    retentionQuery.isError ||
    (!retentionPending && (!retentionQuery.isSuccess || !retentionRequests));

  return (
    <div className="space-y-4">
      {readinessPending ? (
        <LoadingPanel label="Verifying retention activation and evidence gates" />
      ) : readinessUnavailable ? (
        <DataErrorPanel
          title="Retention completion readiness could not be verified"
          description="No destructive control is available until the server confirms activation, evidence gates and current authority."
          onRetry={() => void readinessQuery.refetch()}
        />
      ) : readiness ? (
        <StatusPanel
          state={activationVerified ? "active" : "blocked"}
          title={
            activationVerified
              ? "Governed retention completion is active"
              : "Retention completion is not activated"
          }
          description={
            activationVerified
              ? "The server verified the production manifest, environment opt-in and three-phase operator controls. Each action still requires current evidence and authority."
              : blockers.length > 0
                ? "The server reported the blockers below. Review is available, but detachment, reconciliation and certification controls are hidden."
                : "The server did not return the evidence required to explain activation. Destructive controls remain hidden."
          }
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-md border p-3 text-sm">
              <p className="font-medium">Production manifest</p>
              <StateBadge
                state={readiness.manifestValid ? "active" : "blocked"}
                label={readiness.manifestValid ? "Verified" : "Blocked"}
                className="mt-2"
              />
            </div>
            <div className="rounded-md border p-3 text-sm">
              <p className="font-medium">Environment opt-in</p>
              <StateBadge
                state={readiness.environmentOptIn ? "active" : "blocked"}
                label={readiness.environmentOptIn ? "Verified" : "Blocked"}
                className="mt-2"
              />
            </div>
            <div className="rounded-md border p-3 text-sm">
              <p className="font-medium">Maker-checker</p>
              <StateBadge
                state={readiness.makerCheckerRequired ? "active" : "blocked"}
                label={
                  readiness.makerCheckerRequired ? "Required" : "Unverified"
                }
                className="mt-2"
              />
            </div>
          </div>
          {blockers.length > 0 ? (
            <div className="mt-4 space-y-2" aria-label="Activation blockers">
              {blockers.map((blocker) => (
                <div
                  key={`${blocker.code}:${blocker.message}`}
                  className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900"
                >
                  <p className="font-mono text-xs font-semibold">
                    {blocker.code}
                  </p>
                  <p className="mt-1">{blocker.message}</p>
                </div>
              ))}
            </div>
          ) : null}
          <p className="mt-3 text-xs text-muted-foreground">
            Verified {new Date(readiness.checkedAt).toLocaleString()}.
          </p>
        </StatusPanel>
      ) : null}

      {retentionUnavailable ? (
        <DataErrorPanel
          title="Retention requests could not be loaded"
          description="The queue state is unknown. Retry before concluding that no retention work is open."
          onRetry={() => void retentionQuery.refetch()}
        />
      ) : retentionPending ? (
        <LoadingPanel label="Loading retention requests" />
      ) : retentionRequests && retentionRequests.length > 0 ? (
        <div className="rounded-lg border border-border bg-card shadow-xs">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="font-mono text-xs uppercase tracking-wider">
                    Subject project
                  </TableHead>
                  <TableHead className="font-mono text-xs uppercase tracking-wider">
                    Request
                  </TableHead>
                  <TableHead className="font-mono text-xs uppercase tracking-wider">
                    Due
                  </TableHead>
                  <TableHead className="font-mono text-xs uppercase tracking-wider">
                    Status
                  </TableHead>
                  <TableHead className="text-right font-mono text-xs uppercase tracking-wider">
                    Evidence
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {retentionRequests.map((request) => (
                  <TableRow key={request.id} data-state={request.status}>
                    <TableCell className="font-mono text-xs">
                      {request.subjectProjectId}
                    </TableCell>
                    <TableCell className="max-w-[360px]">
                      <div className="text-sm">{request.reason || "-"}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Requested by{" "}
                        {request.requestedByName ||
                          "requester name unavailable"}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(request.dueAt).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <StateBadge
                        state={requestSurfaceState(request.status)}
                        label={humanise(request.status)}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        variant={
                          selectedRequestId === request.id
                            ? "secondary"
                            : "outline"
                        }
                        className="min-h-11"
                        onClick={() => setSelectedRequestId(request.id)}
                        disabled={mutationPending}
                        aria-pressed={selectedRequestId === request.id}
                      >
                        Review evidence
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      ) : (
        <StatusPanel
          state="empty"
          title="No retention requests are available"
          description="The verified organisation queue is empty. This is not a deletion or certification result."
        />
      )}

      {selectedRequestId ? (
        completionQuery.isLoading || completionQuery.isPending ? (
          <LoadingPanel label="Loading exact retention completion evidence" />
        ) : completionQuery.isError || !snapshot ? (
          <DataErrorPanel
            title="Retention completion evidence could not be loaded"
            description="No reconciliation or certification conclusion can be drawn from the request summary alone."
            onRetry={() => void completionQuery.refetch()}
          />
        ) : (
          <section
            className="space-y-5 rounded-lg border border-border bg-card p-5 shadow-xs sm:p-6"
            aria-labelledby="retention-evidence-heading"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3
                  id="retention-evidence-heading"
                  className="font-serif text-lg font-medium"
                >
                  Completion evidence
                </h3>
                <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                  Request {snapshot.request.id}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Evidence snapshot verified{" "}
                  {new Date(snapshot.generatedAt).toLocaleString()}.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <StateBadge
                  state={requestSurfaceState(snapshot.request.status)}
                  label={`Request ${humanise(snapshot.request.status)}`}
                />
                {snapshot.action ? (
                  <StateBadge
                    state={actionSurfaceState(snapshot.action.status)}
                    label={`Action ${humanise(snapshot.action.status)}`}
                  />
                ) : null}
              </div>
            </div>

            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {(
                [
                  ["Expected", snapshot.objectReconciliation.expected],
                  ["Bound intents", snapshot.objectReconciliation.detached],
                  ["Reconciled", snapshot.objectReconciliation.reconciled],
                  ["Pending", snapshot.objectReconciliation.pending],
                  ["Dead letters", snapshot.objectReconciliation.deadLetters],
                ] as const
              ).map(([label, count]) => (
                <div key={label} className="rounded-md border p-3">
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="mt-1 text-2xl font-semibold tabular-nums">
                    {count}
                  </dd>
                </div>
              ))}
            </dl>

            {snapshot.action ? (
              purgeProofVerified ? (
                <StatusPanel
                  state="partial"
                  title="Owner purge proof returned"
                  description="The server returned a canonical purge receipt, its SHA-256 digest and a purge timestamp for this exact action version. This evidence is required before storage reconciliation, but it is not a deletion certificate."
                />
              ) : (
                <StatusPanel
                  state="blocked"
                  title="Owner purge proof is incomplete"
                  description="Detached status alone does not prove the owner-scoped relational purge. Reconciliation and certification remain unavailable until the server returns a receipt, a valid SHA-256 digest, a purge timestamp and the expected protocol version."
                />
              )
            ) : null}

            {snapshot.objectReconciliation.deadLetters > 0 ? (
              <StatusPanel
                state="blocked"
                title="Storage dead letters require resolution"
                description="At least one bound object lacks trustworthy terminal evidence. Reconciliation and certification remain unavailable."
              />
            ) : snapshot.objectReconciliation.pending > 0 ? (
              <StatusPanel
                state="pending"
                title="Object reconciliation is still in progress"
                description="Relational content may already be detached. Wait for every bound storage event to reach a trustworthy terminal disposition before recording reconciliation."
              >
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  onClick={() => void completionQuery.refetch()}
                >
                  <RefreshCw className="mr-2 size-4" aria-hidden="true" />
                  Refresh evidence
                </Button>
              </StatusPanel>
            ) : null}

            {snapshot.blockers.length > 0 ? (
              <div className="space-y-2" aria-label="Completion blockers">
                {snapshot.blockers.map((blocker) => (
                  <div
                    key={`${blocker.code}:${blocker.message}`}
                    className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900"
                    role="alert"
                  >
                    <p className="font-mono text-xs font-semibold">
                      {blocker.code}
                    </p>
                    <p className="mt-1">{blocker.message}</p>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-md border p-4">
                <h4 className="font-medium">Manifest evidence</h4>
                <dl className="mt-3 space-y-3 text-sm">
                  <div>
                    <dt className="text-muted-foreground">
                      Action protocol version
                    </dt>
                    <dd className="mt-1 font-mono text-xs">
                      {snapshot.action?.version ?? "Not recorded"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">
                      Canonical owner purge receipt
                    </dt>
                    <dd className="mt-1 text-xs">
                      {snapshot.action?.purgeReceipt !== null &&
                      snapshot.action?.purgeReceipt !== undefined
                        ? "Returned (contents withheld from this surface)"
                        : "Not recorded"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">
                      Owner purge receipt SHA-256
                    </dt>
                    <dd className="mt-1 break-all font-mono text-xs">
                      {snapshot.action?.purgeReceiptSha256 || "Not recorded"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Owner purged at</dt>
                    <dd className="mt-1 text-xs">
                      {snapshot.action?.purgedAt
                        ? new Date(snapshot.action.purgedAt).toLocaleString()
                        : "Not recorded"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Source manifest</dt>
                    <dd className="mt-1 break-all font-mono text-xs">
                      {snapshot.action?.sourceManifestSha256 || "Not recorded"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">
                      Reconciliation manifest
                    </dt>
                    <dd className="mt-1 break-all font-mono text-xs">
                      {snapshot.action?.reconciliationManifestSha256 ||
                        "Not recorded"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Prepared by</dt>
                    <dd className="mt-1">
                      {snapshot.action?.preparedByName || "Not recorded"}
                      {snapshot.action?.preparedAt
                        ? ` · ${new Date(snapshot.action.preparedAt).toLocaleString()}`
                        : ""}
                    </dd>
                  </div>
                </dl>
              </div>

              <div className="rounded-md border p-4">
                <h4 className="font-medium">
                  Retained legal and financial categories
                </h4>
                {snapshot.retainedCategories.length > 0 ? (
                  <ul className="mt-3 space-y-3">
                    {snapshot.retainedCategories.map((item) => (
                      <li key={item.category} className="text-sm">
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-medium capitalize">
                            {humanise(item.category)}
                          </span>
                          <Badge variant="outline">{item.count}</Badge>
                        </div>
                        <p className="mt-1 text-muted-foreground">
                          {item.reason}
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3 text-sm text-muted-foreground">
                    The server reported no retained categories for this exact
                    action. This does not replace the manifest evidence.
                  </p>
                )}
              </div>
            </div>

            {snapshot.objectBindings.length > 0 ? (
              <details className="rounded-md border p-4">
                <summary className="cursor-pointer font-medium">
                  Path-free object evidence ({snapshot.objectBindings.length})
                </summary>
                <div className="mt-3 overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Kind</TableHead>
                        <TableHead>Queue status</TableHead>
                        <TableHead>Terminal disposition</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {snapshot.objectBindings.map((binding) => (
                        <TableRow key={binding.id}>
                          <TableCell>{humanise(binding.kind)}</TableCell>
                          <TableCell>{humanise(binding.status)}</TableCell>
                          <TableCell>
                            {binding.terminalDisposition
                              ? humanise(binding.terminalDisposition)
                              : "Pending"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </details>
            ) : null}

            {legacyProtocolEvidence ? (
              <StatusPanel
                state="partial"
                title="Legacy retention evidence is read-only"
                description="This request predates the detach, reconcile, and certify evidence protocol. Its historical status is shown without claiming a canonical deletion certificate, and no Wave 2 controls are available."
              />
            ) : certificateEvidenceVerified && snapshot.certificate ? (
              <StatusPanel
                state="active"
                title="Independent certificate evidence returned"
                description={`Certificate ${snapshot.certificate.certificateNumber} was signed by ${snapshot.certificate.signedByName} on ${new Date(snapshot.certificate.completedAt).toLocaleString()}.`}
              >
                <dl className="grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-muted-foreground">Scope manifest</dt>
                    <dd className="mt-1 break-all font-mono text-xs">
                      {snapshot.certificate.scopeManifestHash}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">
                      Certificate manifest
                    </dt>
                    <dd className="mt-1 break-all font-mono text-xs">
                      {snapshot.certificate.certificateManifestSha256 ||
                        "Not separately recorded"}
                    </dd>
                  </div>
                </dl>
              </StatusPanel>
            ) : snapshot.request.status === "completed" ||
              snapshot.action?.status === "certified" ||
              snapshot.certificate ? (
              <StatusPanel
                state="error"
                title="Certificate evidence is inconsistent"
                description="The request, action and immutable certificate do not agree. No completion claim is shown; reload and escalate the control-plane record."
              />
            ) : (
              <StatusPanel
                state="pending"
                title="No deletion certificate has been issued"
                description="Detachment or reconciliation evidence is not certification. Only a distinct checker and returned immutable certificate can complete this request."
              />
            )}

            {phaseError ? (
              <div
                role="alert"
                className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900"
              >
                {phaseError}
              </div>
            ) : null}

            {activationVerified &&
            identityVerified &&
            criticalEvidenceCurrent &&
            snapshot.request.completionProtocolVersion === 1 &&
            !phaseDraft ? (
              <div className="flex flex-wrap gap-3">
                {snapshot.request.status === "pending" &&
                snapshot.request.version === 1 &&
                !snapshot.action &&
                startAuthorized ? (
                  <Button
                    type="button"
                    variant="destructive"
                    className="min-h-11"
                    onClick={() => openPhase("detach")}
                  >
                    <DatabaseZap className="mr-2 size-4" aria-hidden="true" />
                    Prepare relational detachment
                  </Button>
                ) : null}
                {snapshot.action?.status === "detached" &&
                purgeProofVerified &&
                terminalStorageVerified &&
                reconcileAuthorized ? (
                  <Button
                    type="button"
                    className="min-h-11"
                    onClick={() => openPhase("reconcile")}
                  >
                    Record reconciliation evidence
                  </Button>
                ) : null}
                {snapshot.action?.status === "reconciled" &&
                purgeProofVerified &&
                certifyAuthorized &&
                snapshot.action.preparedByUserId !== meQuery.data?.id ? (
                  <Button
                    type="button"
                    className="min-h-11"
                    onClick={() => openPhase("certify")}
                  >
                    Certify as independent checker
                  </Button>
                ) : null}
              </div>
            ) : null}

            {snapshot.action?.status === "reconciled" &&
            snapshot.action.preparedByUserId === meQuery.data?.id ? (
              <StatusPanel
                state="blocked"
                title="A different checker must certify"
                description="You prepared this reconciliation evidence. Maker-checker separation prevents you from issuing its certificate."
              />
            ) : null}

            {phaseDraft &&
            activationVerified &&
            identityVerified &&
            criticalEvidenceCurrent ? (
              <form
                className="space-y-4 rounded-lg border-2 border-red-300 bg-red-50 p-4"
                onSubmit={(event) => void recordPhase(event)}
                aria-labelledby="retention-confirmation-heading"
              >
                <div className="flex gap-3">
                  <AlertTriangle
                    className="mt-0.5 size-5 shrink-0 text-red-700"
                    aria-hidden="true"
                  />
                  <div>
                    <h4
                      id="retention-confirmation-heading"
                      className="font-semibold text-red-950"
                    >
                      {phaseDraft.phase === "detach"
                        ? "Confirm irreversible relational detachment"
                        : phaseDraft.phase === "reconcile"
                          ? "Confirm exact terminal reconciliation"
                          : "Confirm independent certificate issuance"}
                    </h4>
                    <p className="mt-1 text-sm text-red-900">
                      {phaseDraft.phase === "detach"
                        ? "Project content will be irreversibly detached, then the owner-scoped relational graph will be purged and must return a canonical receipt before durable object reconciliation. Governed legal, financial and audit evidence is retained. This step does not issue a certificate."
                        : phaseDraft.phase === "reconcile"
                          ? "Confirm the owner-purge receipt and that every bound storage event has trustworthy terminal deletion evidence. This records you as the preparer and still does not issue a certificate."
                          : "Confirm an independent review distinct from the preparer, including the owner-purge receipt and both manifests, and authorise immutable certificate issuance."}
                    </p>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="retention-typed-confirmation">
                    Type this exact confirmation
                  </Label>
                  <p className="break-all font-mono text-xs font-semibold">
                    {phaseConfirmation(phaseDraft.phase, snapshot)}
                  </p>
                  <Input
                    id="retention-typed-confirmation"
                    value={phaseDraft.confirmation}
                    onChange={(event) =>
                      setPhaseDraft((draft) =>
                        draft
                          ? { ...draft, confirmation: event.target.value }
                          : draft,
                      )
                    }
                    autoComplete="off"
                    spellCheck={false}
                    aria-describedby="retention-confirmation-help"
                  />
                  <p
                    id="retention-confirmation-help"
                    className="text-xs text-red-900"
                  >
                    The phrase binds this action to the exact request or action
                    shown above.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="retention-attestation">
                    Named operator attestation
                  </Label>
                  <Textarea
                    id="retention-attestation"
                    minLength={RETENTION_ATTESTATION_MIN_LENGTH}
                    maxLength={512}
                    rows={4}
                    value={phaseDraft.attestation}
                    onChange={(event) =>
                      setPhaseDraft((draft) =>
                        draft
                          ? { ...draft, attestation: event.target.value }
                          : draft,
                      )
                    }
                    aria-describedby="retention-attestation-help"
                  />
                  <p
                    id="retention-attestation-help"
                    className="text-xs text-red-900"
                  >
                    Use 16–512 characters and record what you personally
                    verified. Do not paste credentials, object paths or tender
                    content.
                  </p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Button
                    type="submit"
                    variant={
                      phaseDraft.phase === "detach" ? "destructive" : "default"
                    }
                    className="min-h-11"
                    disabled={
                      mutationPending ||
                      !online ||
                      phaseDraft.confirmation !==
                        phaseConfirmation(phaseDraft.phase, snapshot) ||
                      phaseDraft.attestation.trim().length <
                        RETENTION_ATTESTATION_MIN_LENGTH ||
                      phaseDraft.attestation.trim().length > 512
                    }
                  >
                    {mutationPending ? (
                      <Loader2
                        className="mr-2 size-4 animate-spin"
                        aria-hidden="true"
                      />
                    ) : null}
                    {phaseDraft.phase === "detach"
                      ? "Start phase-one detachment"
                      : phaseDraft.phase === "reconcile"
                        ? "Record reconciled manifest"
                        : "Issue independent certificate"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11"
                    disabled={mutationPending}
                    onClick={() => {
                      setPhaseDraft(null);
                      setPhaseError(null);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            ) : null}
          </section>
        )
      ) : null}
    </div>
  );
}

export default function Settings() {
  const {
    data: users,
    isLoading: loadingUsers,
    isPending: usersPending,
    isError: usersFailed,
    refetch: refetchUsers,
  } = useListUsers();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const {
    data: config,
    isLoading: loadingConfig,
    isPending: configPending,
    isError: configFailed,
    refetch: refetchConfig,
  } = useGetAppConfig();
  const updateConfig = useUpdateAppConfig();
  const [draft, setDraft] = useState<AppConfig | null>(null);

  // Seed the editable draft once the active config lands, then let the admin
  // mutate it locally until they save.
  useEffect(() => {
    if (config) setDraft(config);
  }, [config]);

  const setWeight = (key: keyof AppConfig["severityWeights"], value: number) =>
    setDraft((d) =>
      d ? { ...d, severityWeights: { ...d.severityWeights, [key]: value } } : d,
    );
  const setCutoff = (key: keyof AppConfig["bandCutoffs"], value: number) =>
    setDraft((d) =>
      d ? { ...d, bandCutoffs: { ...d.bandCutoffs, [key]: value } } : d,
    );

  const cutoffsValid = (d: AppConfig) =>
    d.bandCutoffs.medium > 0 &&
    d.bandCutoffs.medium < d.bandCutoffs.high &&
    d.bandCutoffs.high < d.bandCutoffs.critical &&
    d.bandCutoffs.critical <= 100;

  const numericConfigValid = (d: AppConfig) => {
    const boundedIntegers: Array<[number, number, number]> = [
      [d.severityWeights.fatal, 0, 100],
      [d.severityWeights.likely_fatal, 0, 100],
      [d.severityWeights.scoring_risk, 0, 100],
      [d.severityWeights.cosmetic, 0, 100],
      [d.missingEvidenceWeight, 0, 100],
      [d.bandCutoffs.medium, 1, 100],
      [d.bandCutoffs.high, 1, 100],
      [d.bandCutoffs.critical, 1, 100],
      [d.retentionDefaultDays, 1, 3650],
    ];
    return boundedIntegers.every(
      ([value, minimum, maximum]) =>
        Number.isInteger(value) && value >= minimum && value <= maximum,
    );
  };

  const saveConfig = () => {
    if (!draft) return;
    if (!numericConfigValid(draft)) {
      toast({
        variant: "destructive",
        title: "Invalid number settings",
        description:
          "Weights and cutoffs must be whole numbers in range; retention must be a whole number from 1 to 3650 days.",
      });
      return;
    }
    if (!cutoffsValid(draft)) {
      toast({
        variant: "destructive",
        title: "Invalid band cutoffs",
        description: "Cutoffs must satisfy 0 < medium < high < critical ≤ 100.",
      });
      return;
    }
    if (!draft.firmName.trim() || !draft.confidentialityLegend.trim()) {
      toast({
        variant: "destructive",
        title: "Missing report details",
        description: "Firm name and confidentiality legend are required.",
      });
      return;
    }
    const body: AppConfigUpdate = {
      severityWeights: draft.severityWeights,
      missingEvidenceWeight: draft.missingEvidenceWeight,
      bandCutoffs: draft.bandCutoffs,
      firmName: draft.firmName.trim(),
      confidentialityLegend: draft.confidentialityLegend.trim(),
      retentionDefaultDays: draft.retentionDefaultDays,
    };
    updateConfig.mutate(
      { data: body },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({
            queryKey: getGetAppConfigQueryKey(),
          });
          toast({
            title: "Settings saved",
            description:
              "New scores use the updated settings. Historic reports are unchanged.",
          });
        },
        onError: mutationErrorToast(
          toast,
          "Could not save settings",
          "The update was refused.",
        ),
      },
    );
  };

  const configLoading = loadingConfig || configPending;
  const configUnavailable = configFailed || (!configLoading && !config);

  return (
    <div className="p-8 max-w-5xl mx-auto w-full space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-3xl font-serif tracking-tight font-semibold">
          Platform settings
        </h1>
        <p className="text-muted-foreground mt-1">
          Review personnel access and manage supported system settings.
        </p>
      </div>

      <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900 rounded-lg p-4 flex gap-3">
        <Info className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <h2 className="font-medium text-blue-900 dark:text-blue-300">
            Data retention & security
          </h2>
          <p className="text-sm text-blue-800 dark:text-blue-400/80 leading-relaxed">
            Tender documents and extracted evidence are encrypted in storage.
            Service keys are kept in environment secrets. Do not publish keys or
            service endpoints.
          </p>
        </div>
      </div>

      {configUnavailable ? (
        <DataErrorPanel
          title="Settings could not be loaded"
          description="Scoring, report and retention defaults remain unavailable. Retry before reviewing or changing settings."
          onRetry={() => void refetchConfig()}
        />
      ) : null}

      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="w-5 h-5 text-foreground" />
          <h2 className="text-xl font-serif tracking-tight font-medium">
            Scoring &amp; risk bands
          </h2>
        </div>

        <div className="bg-card border border-border rounded-lg shadow-xs p-6 space-y-6">
          {configUnavailable ? (
            <p className="p-6 text-sm text-muted-foreground">
              These fields are unavailable until the active settings are
              reloaded.
            </p>
          ) : configLoading || !draft ? (
            <div className="p-6 flex justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <div>
                <h3 className="text-sm font-medium mb-1">Severity weights</h3>
                <p className="text-xs text-muted-foreground mb-3">
                  Points each finding severity adds to the risk score (0–100).
                </p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="w-fatal" className="text-xs">
                      Fatal
                    </Label>
                    <Input
                      id="w-fatal"
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      value={draft.severityWeights.fatal}
                      onChange={(e) =>
                        setWeight("fatal", Number(e.target.value))
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="w-likely" className="text-xs">
                      Likely Fatal
                    </Label>
                    <Input
                      id="w-likely"
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      value={draft.severityWeights.likely_fatal}
                      onChange={(e) =>
                        setWeight("likely_fatal", Number(e.target.value))
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="w-scoring" className="text-xs">
                      Scoring Risk
                    </Label>
                    <Input
                      id="w-scoring"
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      value={draft.severityWeights.scoring_risk}
                      onChange={(e) =>
                        setWeight("scoring_risk", Number(e.target.value))
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="w-cosmetic" className="text-xs">
                      Cosmetic
                    </Label>
                    <Input
                      id="w-cosmetic"
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      value={draft.severityWeights.cosmetic}
                      onChange={(e) =>
                        setWeight("cosmetic", Number(e.target.value))
                      }
                    />
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-medium mb-1">
                  Missing evidence weight
                </h3>
                <p className="text-xs text-muted-foreground mb-3">
                  Points added for each required item without evidence (0–100).
                </p>
                <div className="w-40 space-y-1.5">
                  <Label htmlFor="w-missing" className="text-xs">
                    Weight
                  </Label>
                  <Input
                    id="w-missing"
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={draft.missingEvidenceWeight}
                    onChange={(e) =>
                      setDraft((d) =>
                        d
                          ? {
                              ...d,
                              missingEvidenceWeight: Number(e.target.value),
                            }
                          : d,
                      )
                    }
                  />
                </div>
              </div>

              <div>
                <h3 className="text-sm font-medium mb-1">Risk band cutoffs</h3>
                <p className="text-xs text-muted-foreground mb-3">
                  The score where each risk band begins. Values must increase
                  from medium to high to critical and stay within 1–100.
                </p>
                <div className="grid grid-cols-3 gap-4 max-w-md">
                  <div className="space-y-1.5">
                    <Label htmlFor="c-medium" className="text-xs">
                      Medium ≥
                    </Label>
                    <Input
                      id="c-medium"
                      type="number"
                      min={1}
                      max={100}
                      step={1}
                      value={draft.bandCutoffs.medium}
                      onChange={(e) =>
                        setCutoff("medium", Number(e.target.value))
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="c-high" className="text-xs">
                      High ≥
                    </Label>
                    <Input
                      id="c-high"
                      type="number"
                      min={1}
                      max={100}
                      step={1}
                      value={draft.bandCutoffs.high}
                      onChange={(e) =>
                        setCutoff("high", Number(e.target.value))
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="c-critical" className="text-xs">
                      Critical ≥
                    </Label>
                    <Input
                      id="c-critical"
                      type="number"
                      min={1}
                      max={100}
                      step={1}
                      value={draft.bandCutoffs.critical}
                      onChange={(e) =>
                        setCutoff("critical", Number(e.target.value))
                      }
                    />
                  </div>
                </div>
                {!cutoffsValid(draft) && (
                  <p className="text-xs text-destructive mt-2">
                    Cutoffs must be strictly increasing and within 1–100.
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <FileText className="w-5 h-5 text-foreground" />
          <h2 className="text-xl font-serif tracking-tight font-medium">
            Report template &amp; retention
          </h2>
        </div>

        <div className="bg-card border border-border rounded-lg shadow-xs p-6 space-y-4">
          {configUnavailable ? (
            <p className="p-6 text-sm text-muted-foreground">
              These fields are unavailable until the active settings are
              reloaded.
            </p>
          ) : configLoading || !draft ? (
            <div className="p-6 flex justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="firm-name" className="text-xs">
                  Firm Name
                </Label>
                <Input
                  id="firm-name"
                  type="text"
                  maxLength={120}
                  value={draft.firmName}
                  onChange={(e) =>
                    setDraft((d) =>
                      d ? { ...d, firmName: e.target.value } : d,
                    )
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="legend" className="text-xs">
                  Confidentiality Legend
                </Label>
                <Textarea
                  id="legend"
                  rows={2}
                  maxLength={500}
                  value={draft.confidentialityLegend}
                  onChange={(e) =>
                    setDraft((d) =>
                      d ? { ...d, confidentialityLegend: e.target.value } : d,
                    )
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Printed in the footer of generated reports.
                </p>
              </div>
              <div className="w-48 space-y-1.5">
                <Label htmlFor="retention-days" className="text-xs">
                  Default Retention (days)
                </Label>
                <Input
                  id="retention-days"
                  type="number"
                  min={1}
                  max={3650}
                  step={1}
                  value={draft.retentionDefaultDays}
                  onChange={(e) =>
                    setDraft((d) =>
                      d
                        ? { ...d, retentionDefaultDays: Number(e.target.value) }
                        : d,
                    )
                  }
                />
              </div>
            </>
          )}
        </div>

        {draft && (
          <div className="flex items-center justify-between gap-4">
            <p className="text-xs text-muted-foreground">
              {config?.updatedAt
                ? `Last updated ${new Date(config.updatedAt).toLocaleString()}`
                : "Using system defaults."}{" "}
              Saving affects new scores only. Past reports keep the settings
              used when they were created.
            </p>
            <Button onClick={saveConfig} disabled={updateConfig.isPending}>
              {updateConfig.isPending && (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              )}
              Save settings
            </Button>
          </div>
        )}
      </div>

      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-foreground" />
          <h2 className="text-xl font-serif tracking-tight font-medium">
            Personnel records
          </h2>
        </div>
        <div className="flex flex-wrap items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/20">
          <Badge
            variant="outline"
            className="border-amber-300 bg-white text-amber-900 dark:bg-transparent dark:text-amber-200"
          >
            Read only
          </Badge>
          <p className="min-w-0 flex-1 text-sm text-amber-950 dark:text-amber-200">
            Legacy identity records are shown for reference only. Use
            Organisation settings to change roles, status, delegated access or
            expiry dates.
          </p>
        </div>

        <div className="bg-card border border-border rounded-lg shadow-xs overflow-hidden">
          {usersFailed ? (
            <div className="p-6">
              <DataErrorPanel
                title="Personnel access could not be loaded"
                description="We could not confirm organisation membership. Try loading this organisation's personnel list again."
                onRetry={() => void refetchUsers()}
              />
            </div>
          ) : loadingUsers || usersPending ? (
            <div className="p-12 flex justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : users && users.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="font-mono text-xs uppercase tracking-wider">
                    User
                  </TableHead>
                  <TableHead className="font-mono text-xs uppercase tracking-wider">
                    Role
                  </TableHead>
                  <TableHead className="font-mono text-xs uppercase tracking-wider">
                    Status
                  </TableHead>
                  <TableHead className="font-mono text-xs uppercase tracking-wider">
                    Joined
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell>
                      <div className="font-medium">
                        {user.name || "Unnamed"}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {user.email}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className="capitalize"
                        aria-label={`Legacy role for ${user.name || user.email}: ${user.role}`}
                      >
                        {user.role.replaceAll("_", " ")}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          user.status === "active" ? "secondary" : "destructive"
                        }
                        className="capitalize"
                        aria-label={`Legacy account status for ${user.name || user.email}: ${user.status}`}
                      >
                        {user.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {user.createdAt
                        ? new Date(user.createdAt).toLocaleDateString()
                        : "-"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="p-8 text-center text-muted-foreground">
              No personnel records are available for this organisation.
            </div>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Archive className="w-5 h-5 text-foreground" />
          <h2 className="text-xl font-serif tracking-tight font-medium">
            Retention requests
          </h2>
        </div>
        <RetentionOperatorPanel />
      </div>
    </div>
  );
}
