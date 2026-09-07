import {
  useGetAiOperations,
  useGetVaultExpiring,
  useGetWorkflowAlerts,
  useListProjects,
} from "@workspace/api-client-react";
import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import {
  DataErrorPanel,
  LoadingPanel,
  PageHeader,
  QueueCapabilityCard,
  StateBadge,
  StatusPanel,
} from "@/components/platform-states";
import { useOnlineStatus } from "@/hooks/use-online-status";
import {
  formatWatInstant,
  humaniseToken as readableIdentifier,
} from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const AI_BLOCKER_LABELS: Record<string, string> = {
  AI_GLOBAL_DISABLED: "Global production switch is off",
  AI_RELEASE_GATE_DENIED: "Retained release evidence does not pass",
  AI_MODEL_CONFIGURATION_UNAVAILABLE:
    "No evaluated, approved model setup is active",
  AI_BUDGET_UNAVAILABLE: "No approved runtime budget is configured",
  AI_BUDGET_CURRENCY_MISMATCH:
    "The runtime budget currency does not match capability policy",
  AI_BUDGET_EXCEEDED: "The approved runtime budget is exhausted",
  AI_PROVIDER_PRIVACY_UNVERIFIED:
    "Provider privacy, region or retention evidence is incomplete",
  AI_PROVIDER_UNAVAILABLE: "No compatible healthy provider is available",
  AI_CAPABILITY_DISABLED: "No capability is enabled for this organisation",
};

function blockerLabel(value: string): string {
  return AI_BLOCKER_LABELS[value] ?? readableIdentifier(value);
}

function optionalVersion(value: string): string {
  return value.trim() || "Not configured";
}

function formatMinorAmount(currency: string, minor: number): string {
  try {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(minor / 100);
  } catch {
    return `${currency || "Currency unset"} ${minor} minor units`;
  }
}

function compactDate(value: string): string {
  return formatWatInstant(value);
}

export default function OperationsConsole() {
  const online = useOnlineStatus();
  const projectsQuery = useListProjects();
  const alertsQuery = useGetWorkflowAlerts();
  const vaultQuery = useGetVaultExpiring();
  const aiOperationsQuery = useGetAiOperations();
  const loading =
    projectsQuery.isLoading || alertsQuery.isLoading || vaultQuery.isLoading;
  const queueHasError =
    projectsQuery.isError || alertsQuery.isError || vaultQuery.isError;
  const hasError = queueHasError || aiOperationsQuery.isError;
  const alerts = alertsQuery.data;
  const projects = projectsQuery.data ?? [];
  const expiring = vaultQuery.data;
  const aiOperations = aiOperationsQuery.data;

  const retry = () => {
    void projectsQuery.refetch();
    void alertsQuery.refetch();
    void vaultQuery.refetch();
    void aiOperationsQuery.refetch();
  };

  return (
    <div className="mx-auto w-full max-w-7xl space-y-7 p-5 sm:p-8">
      <PageHeader
        eyebrow="Reviewer and administration console"
        title="Operations"
        description="Review live work queues and safe AI service status without exposing tender content, prompts, provider errors or secrets."
        state={
          !online
            ? "offline"
            : hasError || (aiOperations?.blockers.length ?? 0) > 0
              ? "partial"
              : "active"
        }
      />

      {!online ? (
        <StatusPanel
          state="offline"
          title="Operations data may be stale"
          description="Do not make deadline, assignment or release decisions from cached information. Reconnect and refresh first."
        />
      ) : null}

      {loading ? <LoadingPanel label="Loading operations queues" /> : null}
      {queueHasError ? (
        <DataErrorPanel
          title="Some operations queues could not be loaded"
          description="Some sections may be incomplete. Refresh before treating an empty queue as clear."
          onRetry={retry}
        />
      ) : null}

      {!loading ? (
        <section
          aria-labelledby="connected-queues-heading"
          className="space-y-4"
        >
          <div>
            <h2
              id="connected-queues-heading"
              className="font-serif text-xl font-semibold"
            >
              Connected signals
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Counts below come from current project, workflow-alert and Vault
              endpoints.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <QueueCapabilityCard
              title="Visible pursuits"
              description="Pursuits available to your current role."
              state={
                projectsQuery.isError
                  ? "error"
                  : projects.length === 0
                    ? "empty"
                    : "active"
              }
              value={projectsQuery.isError ? "—" : projects.length}
            />
            <QueueCapabilityCard
              title="Review deadlines missed"
              description="Review windows that are past their recorded deadline."
              state={
                alertsQuery.isError
                  ? "error"
                  : (alerts?.slaBreaches.length ?? 0) > 0
                    ? "blocked"
                    : "empty"
              }
              value={
                alertsQuery.isError ? "—" : (alerts?.slaBreaches.length ?? 0)
              }
            />
            <QueueCapabilityCard
              title="Independent reviews due"
              description="Pursuits whose independent-review window is open."
              state={
                alertsQuery.isError
                  ? "error"
                  : (alerts?.redTeamDue.length ?? 0) > 0
                    ? "pending"
                    : "empty"
              }
              value={
                alertsQuery.isError ? "—" : (alerts?.redTeamDue.length ?? 0)
              }
            />
            <QueueCapabilityCard
              title="Expired evidence"
              description="Vault artefacts already past their recorded expiry date."
              state={
                vaultQuery.isError
                  ? "error"
                  : (expiring?.buckets.expired ?? 0) > 0
                    ? "expired"
                    : "empty"
              }
              value={
                vaultQuery.isError ? "—" : (expiring?.buckets.expired ?? 0)
              }
            />
          </div>
        </section>
      ) : null}

      {alerts &&
      (alerts.slaBreaches.length > 0 || alerts.redTeamDue.length > 0) ? (
        <section aria-labelledby="attention-heading" className="space-y-3">
          <h2
            id="attention-heading"
            className="font-serif text-xl font-semibold"
          >
            Requires attention
          </h2>
          <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
            {alerts.slaBreaches.map((alert) => (
              <Link
                key={"sla-" + alert.projectId}
                href={"/projects/" + alert.projectId}
                className="flex min-h-16 items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-medium">
                      {alert.tenderTitle}
                    </p>
                    <StateBadge
                      state="blocked"
                      label="Review deadline missed"
                    />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Due {compactDate(alert.dueAt)} WAT
                  </p>
                </div>
                <ArrowRight aria-hidden="true" className="size-4 shrink-0" />
              </Link>
            ))}
            {alerts.redTeamDue.map((alert) => (
              <Link
                key={"red-team-" + alert.projectId}
                href={"/projects/" + alert.projectId}
                className="flex min-h-16 items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-medium">
                      {alert.tenderTitle}
                    </p>
                    <StateBadge
                      state="pending"
                      label="Independent review due"
                    />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Opened {compactDate(alert.dueAt)} WAT
                  </p>
                </div>
                <ArrowRight aria-hidden="true" className="size-4 shrink-0" />
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section aria-labelledby="ai-operations-heading" className="space-y-4">
        <div>
          <h2
            id="ai-operations-heading"
            className="font-serif text-xl font-semibold"
          >
            AI service controls
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Readiness, limited draft features and safe run history for this
            organisation. This view shows status only; it does not enable AI.
          </p>
        </div>

        {aiOperationsQuery.isLoading ? (
          <LoadingPanel label="Loading AI service status" />
        ) : null}
        {aiOperationsQuery.isError ? (
          <DataErrorPanel
            title="AI service status could not be loaded"
            description="A missing response does not show whether AI is enabled, disabled or ready for release. Refresh before making an operations decision."
            onRetry={() => void aiOperationsQuery.refetch()}
          />
        ) : null}

        {aiOperations ? (
          <div className="space-y-5">
            <StatusPanel
              state={
                aiOperations.globalKillSwitchEngaged
                  ? "blocked"
                  : aiOperations.environment === "production"
                    ? aiOperations.productionAiEnabled
                      ? "active"
                      : "blocked"
                    : "partial"
              }
              title={
                aiOperations.globalKillSwitchEngaged
                  ? "AI is disabled by the global switch"
                  : aiOperations.environment === "production"
                    ? aiOperations.productionAiEnabled
                      ? "Production AI checks pass for this organisation"
                      : "Production AI is not enabled"
                    : `AI services are in ${aiOperations.environment} mode`
              }
              description={
                aiOperations.environment === "production"
                  ? "Production use for eligible pursuits outside Restricted Mode requires the global switch, release evidence, model, budget, provider policy and at least one organisation feature check to pass. Restricted Mode has separate checks."
                  : "Running outside production is not production approval. Production still requires every release and organisation check shown below."
              }
            />

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
              <QueueCapabilityCard
                title="Global switch"
                description="Emergency and production-default-off control."
                state={
                  aiOperations.globalKillSwitchEngaged ? "blocked" : "active"
                }
                value={
                  aiOperations.globalKillSwitchEngaged ? "Engaged" : "Open"
                }
              />
              <QueueCapabilityCard
                title="Release evidence"
                description={
                  aiOperations.releaseGate.applicable
                    ? "Recomputed against retained evidence and exact expected versions."
                    : "Production release evidence is not evaluated in this environment."
                }
                state={
                  !aiOperations.releaseGate.applicable
                    ? "unavailable"
                    : aiOperations.releaseGate.allowed
                      ? "active"
                      : "blocked"
                }
                value={
                  !aiOperations.releaseGate.applicable
                    ? "Not evaluated"
                    : aiOperations.releaseGate.allowed
                      ? "Pass"
                      : "Denied"
                }
              />
              <QueueCapabilityCard
                title="Model promotion"
                description={
                  aiOperations.modelConfiguration.configurationVersion ??
                  "No approved model setup version"
                }
                state={
                  aiOperations.modelConfiguration.status === "promoted" &&
                  aiOperations.modelConfiguration.evaluationApproved
                    ? "active"
                    : "pending"
                }
                value={aiOperations.modelConfiguration.status}
              />
              <QueueCapabilityCard
                title="Approved budget"
                description={
                  aiOperations.budget
                    ? `Rate card ${aiOperations.budget.rateCardVersion}`
                    : "No approved runtime budget"
                }
                state={
                  aiOperations.budget &&
                  aiOperations.budget.remainingMinor > 0 &&
                  !aiOperations.blockers.includes("AI_BUDGET_CURRENCY_MISMATCH")
                    ? "active"
                    : "blocked"
                }
                value={
                  aiOperations.budget
                    ? aiOperations.blockers.includes(
                        "AI_BUDGET_CURRENCY_MISMATCH",
                      )
                      ? "Currency mismatch"
                      : aiOperations.budget.remainingMinor > 0
                        ? formatMinorAmount(
                            aiOperations.budget.currency,
                            aiOperations.budget.remainingMinor,
                          )
                        : "Exhausted"
                    : "Unavailable"
                }
              />
              <QueueCapabilityCard
                title="Restricted Mode"
                description={
                  aiOperations.providerPolicy.restrictedModeSupported
                    ? "An approved model provider is eligible for Restricted Mode."
                    : "No approved model provider is eligible; Restricted Mode projects remain blocked."
                }
                state={
                  aiOperations.providerPolicy.restrictedModeSupported
                    ? "active"
                    : "unavailable"
                }
                value={
                  aiOperations.providerPolicy.restrictedModeSupported
                    ? "Supported"
                    : "Unavailable"
                }
              />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card className="shadow-none">
                <CardContent className="p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold">
                      Production readiness blockers
                    </h3>
                    <StateBadge
                      state={
                        aiOperations.blockers.length === 0
                          ? "active"
                          : "blocked"
                      }
                      label={
                        aiOperations.blockers.length === 0
                          ? "No reported blockers"
                          : `${aiOperations.blockers.length} blocker${aiOperations.blockers.length === 1 ? "" : "s"}`
                      }
                    />
                  </div>
                  {aiOperations.blockers.length === 0 ? (
                    <p className="mt-4 text-sm text-muted-foreground">
                      The runtime reports no platform blocker for eligible
                      non-Restricted Mode projects. Individual capability and
                      each pursuit's Restricted Mode checks still apply.
                    </p>
                  ) : (
                    <ul className="mt-4 space-y-2 text-sm">
                      {aiOperations.blockers.map((blocker) => (
                        <li key={blocker} className="rounded-md bg-muted p-3">
                          <p className="font-medium">{blockerLabel(blocker)}</p>
                          <p className="mt-1 font-mono text-xs text-muted-foreground">
                            {blocker}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>

              <Card className="shadow-none">
                <CardContent className="p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold">
                      Release evidence checks
                    </h3>
                    <StateBadge
                      state={
                        !aiOperations.releaseGate.applicable
                          ? "unavailable"
                          : aiOperations.releaseGate.allowed
                            ? "active"
                            : "blocked"
                      }
                      label={
                        !aiOperations.releaseGate.applicable
                          ? "Not evaluated"
                          : aiOperations.releaseGate.allowed
                            ? "Allowed"
                            : "Denied"
                      }
                    />
                  </div>
                  {aiOperations.releaseGate.blockerCodes.length > 0 ? (
                    <div className="mt-4">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Evidence blockers
                      </p>
                      <ul className="mt-2 space-y-1 font-mono text-xs">
                        {aiOperations.releaseGate.blockerCodes.map((code) => (
                          <li key={code}>{code}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
                    {Object.entries(
                      aiOperations.releaseGate.expectedVersions,
                    ).map(([name, version]) => (
                      <div key={name} className="min-w-0">
                        <dt className="font-medium capitalize text-muted-foreground">
                          {name}
                        </dt>
                        <dd className="mt-1 break-all font-mono">
                          {optionalVersion(version)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </CardContent>
              </Card>
            </div>

            <div className="space-y-3">
              <div>
                <h3 className="text-sm font-semibold">AI feature policy</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Every current feature creates a reversible draft that needs
                  approval from a named person.
                </p>
              </div>
              {aiOperations.capabilities.length === 0 ? (
                <StatusPanel
                  state="unavailable"
                  title="No AI feature policy was returned"
                  description="Treat this as unavailable. It does not mean unrestricted AI is allowed."
                />
              ) : (
                <div className="grid gap-4 lg:grid-cols-2">
                  {aiOperations.capabilities.map((capability) => (
                    <Card key={capability.id} className="shadow-none">
                      <CardContent className="p-5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <h4 className="text-sm font-semibold">
                              {readableIdentifier(capability.id)}
                            </h4>
                            <p className="mt-1 text-xs text-muted-foreground">
                              Autonomy level {capability.autonomyLevel} · named
                              approval: {capability.approvalAuthority}
                            </p>
                          </div>
                          <StateBadge
                            state={
                              capability.effectiveEnabled &&
                              (aiOperations.environment !== "production" ||
                                aiOperations.productionAiEnabled)
                                ? aiOperations.environment === "production"
                                  ? "active"
                                  : "partial"
                                : "blocked"
                            }
                            label={
                              capability.effectiveEnabled &&
                              (aiOperations.environment !== "production" ||
                                aiOperations.productionAiEnabled)
                                ? aiOperations.environment === "production"
                                  ? "Enabled"
                                  : "Non-production"
                                : "Disabled"
                            }
                          />
                        </div>
                        <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
                          <div>
                            <dt className="text-muted-foreground">
                              Environment gate
                            </dt>
                            <dd className="mt-1 font-medium">
                              {capability.environmentApproved ? "Open" : "Off"}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-muted-foreground">
                              Organisation check
                            </dt>
                            <dd className="mt-1 font-medium">
                              {capability.tenantEnabled ? "Open" : "Off"}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-muted-foreground">Prompt</dt>
                            <dd className="mt-1 break-all font-mono">
                              {capability.promptVersion}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-muted-foreground">Schema</dt>
                            <dd className="mt-1 break-all font-mono">
                              {capability.schemaVersion}
                            </dd>
                          </div>
                        </dl>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>

            <div className="grid gap-5 xl:grid-cols-2">
              <div className="space-y-3">
                <h3 className="text-sm font-semibold">Recent AI runs</h3>
                {aiOperations.recentRuns.length === 0 ? (
                  <StatusPanel
                    state="empty"
                    title="No AI runs are recorded for this organisation"
                    description="This is an empty telemetry result, not proof that a provider was never contacted outside this retained history."
                  />
                ) : (
                  <Card className="shadow-none">
                    <CardContent className="p-3">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Task</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Tokens</TableHead>
                            <TableHead>Time</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {aiOperations.recentRuns.map((run) => (
                            <TableRow key={run.id}>
                              <TableCell>
                                <p className="font-medium">
                                  {readableIdentifier(run.task)}
                                </p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {run.model ?? "Model not recorded"}
                                </p>
                              </TableCell>
                              <TableCell>
                                <StateBadge
                                  state={
                                    run.status === "failed" ? "error" : "active"
                                  }
                                  label={
                                    run.errorCode ??
                                    (run.status === "failed"
                                      ? "Failed"
                                      : "Succeeded")
                                  }
                                />
                              </TableCell>
                              <TableCell className="font-mono text-xs">
                                {run.promptTokens == null &&
                                run.completionTokens == null
                                  ? "Unavailable"
                                  : (run.promptTokens ?? 0) +
                                    (run.completionTokens ?? 0)}
                              </TableCell>
                              <TableCell className="whitespace-nowrap text-xs">
                                {compactDate(run.createdAt)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                )}
              </div>

              <div className="space-y-3">
                <h3 className="text-sm font-semibold">Evaluation runs</h3>
                {aiOperations.evaluations.length === 0 ? (
                  <StatusPanel
                    state="empty"
                    title="No evaluation runs are recorded for this organisation"
                    description="An empty evaluation history does not show that a promotion decision was made."
                  />
                ) : (
                  <Card className="shadow-none">
                    <CardContent className="p-3">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Task</TableHead>
                            <TableHead>Decision</TableHead>
                            <TableHead>Sample</TableHead>
                            <TableHead>Started</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {aiOperations.evaluations.map((evaluation) => (
                            <TableRow key={evaluation.id}>
                              <TableCell>
                                <p className="font-medium">
                                  {readableIdentifier(evaluation.task)}
                                </p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  Corpus {evaluation.corpusVersion} · status{" "}
                                  {evaluation.status}
                                </p>
                              </TableCell>
                              <TableCell>
                                <StateBadge
                                  state="pending"
                                  label={evaluation.releaseDecision}
                                />
                              </TableCell>
                              <TableCell className="font-mono text-xs">
                                {evaluation.sampleSize}
                              </TableCell>
                              <TableCell className="whitespace-nowrap text-xs">
                                {compactDate(evaluation.startedAt)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              Updated {compactDate(aiOperations.generatedAt)} WAT. Provider
              messages and source content are intentionally absent.
            </p>
          </div>
        ) : null}
      </section>

      <section
        aria-labelledby="specialised-queues-heading"
        className="space-y-4"
      >
        <div>
          <h2
            id="specialised-queues-heading"
            className="font-serif text-xl font-semibold"
          >
            Specialised queue coverage
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Pursuit tools remain available, but unrelated data cannot confirm
            these organisation-wide queues.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <QueueCapabilityCard
            title="Intake and document review"
            description="Available inside each pursuit; there is no separate reviewer queue."
            state="partial"
          />
          <QueueCapabilityCard
            title="Conflict decisions"
            description="Conflict status is managed inside each pursuit; cross-tender assignments need a separate service queue."
            state="partial"
          />
          <QueueCapabilityCard
            title="Evidence approval"
            description="Evidence records exist, but there is no organisation-wide queue for independent approval and renewal."
            state="partial"
          />
          <QueueCapabilityCard
            title="BOQ exceptions and sign-off"
            description="Checks and readiness decisions stay inside each pursuit."
            state="partial"
          />
          <QueueCapabilityCard
            title="Billing and notification exceptions"
            description="Global commercial and delivery-failure queues are not connected."
            state="unavailable"
          />
          <QueueCapabilityCard
            title="Evaluation management"
            description="Read-only evaluation and release evidence is connected above; starting runs or changing promotion state is not exposed here."
            state="partial"
          />
        </div>
      </section>
    </div>
  );
}
