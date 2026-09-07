import { Link, useParams, useSearchParams } from "wouter";
import {
  useGetProject,
  useUpdateProject,
  useConfirmProjectPayment,
  useCreateProjectNotification,
  useCreateRetentionRequest,
  useListProjectNotifications,
  useGetProjectCost,
  getGetProjectCostQueryKey,
  getGetProjectQueryKey,
  getListProjectNotificationsQueryKey,
  getListRetentionRequestsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense, useEffect, useState } from "react";
import {
  Loader2,
  FileText,
  CheckSquare,
  Layers,
  AlertOctagon,
  FileBarChart,
  History,
  Activity,
  Calculator,
  ShieldAlert,
  Bell,
  Archive,
  Save,
  UserCheck,
  PackageCheck,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { errorMessage, mutationErrorToast, requestStatus } from "@/lib/errors";
import {
  ProjectReadinessGate,
  type ProjectTab,
} from "@/components/project-readiness-gate";
import { LoadingPanel } from "@/components/platform-states";
import { useOrganisationPermission } from "@/contexts/organisation-context";

const DocumentsTab = lazy(() =>
  import("./project-tabs/documents-tab").then(({ DocumentsTab }) => ({
    default: DocumentsTab,
  })),
);
const RequirementsTab = lazy(() =>
  import("./project-tabs/requirements-tab").then(({ RequirementsTab }) => ({
    default: RequirementsTab,
  })),
);
const EvidenceTab = lazy(() =>
  import("./project-tabs/evidence-tab").then(({ EvidenceTab }) => ({
    default: EvidenceTab,
  })),
);
const DefectsTab = lazy(() =>
  import("./project-tabs/defects-tab").then(({ DefectsTab }) => ({
    default: DefectsTab,
  })),
);
const ReportsTab = lazy(() =>
  import("./project-tabs/reports-tab").then(({ ReportsTab }) => ({
    default: ReportsTab,
  })),
);
const BoqTab = lazy(() =>
  import("./project-tabs/boq-tab").then(({ BoqTab }) => ({ default: BoqTab })),
);
const RiskTab = lazy(() =>
  import("./project-tabs/risk-tab").then(({ RiskTab }) => ({
    default: RiskTab,
  })),
);
const AuditTab = lazy(() =>
  import("./project-tabs/audit-tab").then(({ AuditTab }) => ({
    default: AuditTab,
  })),
);
const DeliveryStudioTab = lazy(() =>
  import("./project-tabs/delivery-studio-tab").then(
    ({ DeliveryStudioTab }) => ({ default: DeliveryStudioTab }),
  ),
);

const STATUS_OPTIONS = [
  "intake",
  "extraction",
  "review",
  "defects",
  "reporting",
  "signed_off",
  "exported",
  "archived",
] as const;
const CONFLICT_OPTIONS = ["clear", "blocked", "consented", "declined"] as const;
// Gate 0 mandate quality (Build Brief §17): a quality mandate is an assisted
// bid or retainer, not autopsy-only revenue.
const MANDATE_QUALITY_OPTIONS = [
  { value: "none", label: "Not set" },
  { value: "autopsy_only", label: "Autopsy-only revenue" },
  { value: "assisted_bid", label: "Assisted bid" },
  { value: "retainer", label: "Retainer" },
] as const;
type MandateQuality = (typeof MANDATE_QUALITY_OPTIONS)[number]["value"];
type ProjectStatus = (typeof STATUS_OPTIONS)[number];
type SlaClass = "standard" | "live";
type PaymentStatus = "not_required" | "pending" | "confirmed";
type ConflictStatus = (typeof CONFLICT_OPTIONS)[number];

const PROJECT_TABS: readonly ProjectTab[] = [
  "overview",
  "documents",
  "requirements",
  "evidence",
  "boq",
  "defects",
  "risk",
  "delivery",
  "reports",
  "audit",
];

function isProjectTab(value: string | null): value is ProjectTab {
  return PROJECT_TABS.some((tab) => tab === value);
}

export default function ProjectDetails() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    data: project,
    error: projectError,
    isError: projectIsError,
    isFetching: projectIsFetching,
    isLoading,
    refetch: refetchProject,
  } = useGetProject(id);
  const updateProject = useUpdateProject();
  const confirmPayment = useConfirmProjectPayment();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const canUpdateProject = useOrganisationPermission("project:update");
  const canManageRetention = useOrganisationPermission("retention:manage");
  const canReadTenderDocuments = useOrganisationPermission("document:read");
  const canReadTenderRequirements =
    useOrganisationPermission("requirement:read");
  const canReadTenderEvidence = useOrganisationPermission("evidence:read");
  const canReadTenderRules = useOrganisationPermission("rule_pack:read");
  const canOpenTenderContext =
    canReadTenderDocuments &&
    canReadTenderRequirements &&
    canReadTenderEvidence &&
    canReadTenderRules;
  const { data: notifications } = useListProjectNotifications(id ?? "", {
    query: {
      enabled: Boolean(id),
      queryKey: getListProjectNotificationsQueryKey(id ?? ""),
    },
  });
  const { data: cost } = useGetProjectCost(id ?? "", {
    query: {
      enabled: Boolean(id),
      queryKey: getGetProjectCostQueryKey(id ?? ""),
    },
  });
  const createNotification = useCreateProjectNotification();
  const createRetentionRequest = useCreateRetentionRequest();
  const requestedTab = searchParams.get("tab");
  const activeTab: ProjectTab = isProjectTab(requestedTab)
    ? requestedTab
    : "overview";
  const setActiveTab = (tab: ProjectTab) => {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (tab === "overview") next.delete("tab");
        else next.set("tab", tab);
        return next;
      },
      { replace: true },
    );
  };
  const [governance, setGovernance] = useState<{
    status: ProjectStatus;
    slaClass: SlaClass;
    paymentStatus: PaymentStatus;
    conflictStatus: ConflictStatus;
    conflictDecision: string;
    conflictRationale: string;
    physicalArchiveInstruction: string;
    redactionScope: string;
    restrictedMode: boolean;
  }>({
    status: "intake",
    slaClass: "standard",
    paymentStatus: "not_required",
    conflictStatus: "clear",
    conflictDecision: "",
    conflictRationale: "",
    physicalArchiveInstruction: "",
    redactionScope: "",
    restrictedMode: false,
  });
  const [notificationForm, setNotificationForm] = useState({
    template: "deadline_reminder",
    channel: "manual",
    recipient: "",
  });
  const [retentionReason, setRetentionReason] = useState("");
  const [mandateQuality, setMandateQuality] = useState<MandateQuality>("none");

  const syncGovernance = (p: NonNullable<typeof project>) => {
    setGovernance({
      status: p.status as ProjectStatus,
      slaClass: (p.slaClass ?? "standard") as SlaClass,
      paymentStatus: (p.paymentStatus ?? "not_required") as PaymentStatus,
      conflictStatus: (p.conflictStatus ?? "clear") as ConflictStatus,
      conflictDecision: p.conflictDecision ?? "",
      conflictRationale: p.conflictRationale ?? "",
      physicalArchiveInstruction: p.physicalArchiveInstruction ?? "",
      redactionScope: p.redactionScope ?? "",
      restrictedMode: Boolean(p.restrictedMode),
    });
  };

  // Seed the form when a project first loads (or the route switches projects).
  // Deliberately NOT keyed on the whole project object: background refetches
  // (payment confirmation, notifications) must not wipe unsaved form edits.
  useEffect(() => {
    if (project) {
      syncGovernance(project);
      setMandateQuality((project.mandateQuality ?? "none") as MandateQuality);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id]);

  const refreshProject = () => {
    if (id)
      queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(id) });
  };

  const handleSaveGovernance = () => {
    if (!id) return;
    updateProject.mutate(
      {
        id,
        data: {
          status: governance.status,
          slaClass: governance.slaClass,
          physicalArchiveInstruction:
            governance.physicalArchiveInstruction.trim() || null,
          redactionScope: governance.redactionScope.trim() || null,
          restrictedMode: governance.restrictedMode,
        },
      },
      {
        onSuccess: (data) => {
          // Sync from the server's canonical response (it may have auto-set
          // conflict fields) since background refetches no longer reset the form.
          syncGovernance(data);
          refreshProject();
          toast({ title: "Governance controls updated" });
        },
        onError: mutationErrorToast(
          toast,
          "Update blocked",
          "The project transition or governance update was rejected.",
        ),
      },
    );
  };

  const handleSaveMandateQuality = (value: MandateQuality) => {
    setMandateQuality(value);
    if (!id) return;
    updateProject.mutate(
      { id, data: { mandateQuality: value } },
      {
        onSuccess: () => {
          refreshProject();
          toast({ title: "Mandate quality updated" });
        },
        onError: (err) => {
          if (project)
            setMandateQuality(
              (project.mandateQuality ?? "none") as MandateQuality,
            );
          toast({
            variant: "destructive",
            title: "Update failed",
            description: errorMessage(
              err,
              "The mandate quality could not be saved.",
            ),
          });
        },
      },
    );
  };

  const handleCreateNotification = () => {
    if (!id) return;
    createNotification.mutate(
      {
        id,
        data: {
          template: notificationForm.template,
          channel: notificationForm.channel as
            | "manual"
            | "email"
            | "whatsapp"
            | "in_app",
          recipient: notificationForm.recipient.trim() || undefined,
        },
      },
      {
        onSuccess: () => {
          setNotificationForm({ ...notificationForm, recipient: "" });
          queryClient.invalidateQueries({
            queryKey: getListProjectNotificationsQueryKey(id),
          });
          toast({ title: "Notification logged" });
        },
        onError: mutationErrorToast(toast, "Notification failed"),
      },
    );
  };

  const handleRetentionRequest = () => {
    if (!id) return;
    createRetentionRequest.mutate(
      { id, data: { reason: retentionReason.trim() || undefined } },
      {
        onSuccess: () => {
          setRetentionReason("");
          // The admin retention queue on Settings reads this list.
          queryClient.invalidateQueries({
            queryKey: getListRetentionRequestsQueryKey(),
          });
          toast({ title: "Retention request opened" });
        },
        onError: mutationErrorToast(toast, "Retention request failed"),
      },
    );
  };

  const handleConfirmPayment = (role: "founder" | "advisor") => {
    if (!id) return;
    confirmPayment.mutate(
      { id, data: { role } },
      {
        onSuccess: () => {
          refreshProject();
          toast({ title: `Payment confirmed (${role} leg)` });
        },
        onError: mutationErrorToast(
          toast,
          "Confirmation rejected",
          "Dual confirmation requires two distinct people.",
        ),
      },
    );
  };

  if (isLoading) {
    return (
      <div className="p-8 flex justify-center items-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (
    !id ||
    (projectIsError && requestStatus(projectError) === 404) ||
    (!projectIsError && !project)
  ) {
    return (
      <div className="mx-auto flex min-h-[22rem] max-w-2xl flex-col items-center justify-center p-8 text-center">
        <FileText
          className="mb-4 h-10 w-10 text-muted-foreground"
          aria-hidden="true"
        />
        <h1 className="text-2xl font-semibold text-foreground">
          Pursuit not found
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This pursuit is unavailable in the selected organisation. It may have
          been removed, or your access may have changed.
        </p>
        <Button asChild variant="outline" className="mt-5">
          <Link href="/projects">Back to pursuits</Link>
        </Button>
      </div>
    );
  }

  if (projectIsError) {
    return (
      <div
        role="alert"
        className="mx-auto flex min-h-[22rem] max-w-2xl flex-col items-center justify-center p-8 text-center"
      >
        <ShieldAlert
          className="mb-4 h-10 w-10 text-destructive"
          aria-hidden="true"
        />
        <h1 className="text-2xl font-semibold text-foreground">
          Pursuit unavailable
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Valo could not check this pursuit. The failed request does not show
          that records are missing or that the pursuit is ready.
        </p>
        <p className="mt-3 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
          {errorMessage(projectError, "The pursuit could not be loaded.")}
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          <Button
            type="button"
            onClick={() => void refetchProject()}
            disabled={projectIsFetching}
          >
            {projectIsFetching && (
              <Loader2
                className="mr-2 h-4 w-4 animate-spin"
                aria-hidden="true"
              />
            )}
            Try again
          </Button>
          <Button asChild variant="outline">
            <Link href="/projects">Back to pursuits</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-[1600px] mx-auto w-full space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <Badge
              variant="outline"
              className="capitalize text-xs font-mono tracking-wider"
            >
              {project.status.replace("_", " ")}
            </Badge>
            {project.riskBand && (
              <Badge
                variant={
                  project.riskBand === "critical" || project.riskBand === "high"
                    ? "destructive"
                    : "secondary"
                }
                className="capitalize text-xs font-mono tracking-wider"
              >
                {project.riskBand} Risk
              </Badge>
            )}
            {project.outcome && project.outcome !== "none" && (
              <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 capitalize text-xs font-mono tracking-wider">
                {project.outcome.replace(/_/g, " ")}
              </Badge>
            )}
          </div>
          <h1 className="text-3xl font-serif tracking-tight font-semibold text-foreground">
            {project.tenderTitle}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm flex items-center gap-2">
            <span className="font-medium text-foreground">
              {project.clientName}
            </span>
            {project.issuingEntity && (
              <>
                <span>&bull;</span>
                <span>{project.issuingEntity}</span>
              </>
            )}
            {project.tenderRef && (
              <>
                <span>&bull;</span>
                <span className="font-mono text-xs">{project.tenderRef}</span>
              </>
            )}
          </p>
          {canOpenTenderContext ? (
            <Button asChild variant="outline" className="mt-4">
              <Link href={`/projects/${id}/tender-context`}>
                <UserCheck className="mr-2 h-4 w-4" aria-hidden="true" />
                Open Tender Context &amp; Eligibility Passport
              </Link>
            </Button>
          ) : null}
        </div>
        <div className="shrink-0 space-y-1.5">
          <Label
            htmlFor="mandateQuality"
            className="text-xs font-medium text-muted-foreground uppercase tracking-wider"
          >
            Mandate Quality
          </Label>
          <Select
            value={mandateQuality}
            onValueChange={(v) => handleSaveMandateQuality(v as MandateQuality)}
            disabled={!canUpdateProject}
          >
            <SelectTrigger
              id="mandateQuality"
              className="w-[220px]"
              disabled={!canUpdateProject}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MANDATE_QUALITY_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground max-w-[220px]">
            The initial readiness check counts assisted-bid and retainer work,
            not review-only work.
          </p>
        </div>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as ProjectTab)}
        className="w-full"
      >
        <TabsList className="w-full justify-start border-b border-border rounded-none bg-transparent h-auto p-0 space-x-6 overflow-x-auto">
          <TabsTrigger
            value="overview"
            className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 py-3 font-medium"
          >
            <Activity className="w-4 h-4 mr-2" />
            Overview &amp; next actions
          </TabsTrigger>
          <TabsTrigger
            value="documents"
            className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 py-3 font-medium"
          >
            <FileText className="w-4 h-4 mr-2" />
            Tender documents
          </TabsTrigger>
          <TabsTrigger
            value="requirements"
            className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 py-3 font-medium"
          >
            <CheckSquare className="w-4 h-4 mr-2" />
            Requirements
          </TabsTrigger>
          <TabsTrigger
            value="evidence"
            className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 py-3 font-medium"
          >
            <Layers className="w-4 h-4 mr-2" />
            Evidence &amp; compliance
          </TabsTrigger>
          <TabsTrigger
            value="boq"
            className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 py-3 font-medium"
          >
            <Calculator className="w-4 h-4 mr-2" />
            BOQ
          </TabsTrigger>
          <TabsTrigger
            value="defects"
            className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 py-3 font-medium"
          >
            <AlertOctagon className="w-4 h-4 mr-2" />
            Issues &amp; independent review
          </TabsTrigger>
          <TabsTrigger
            value="risk"
            className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 py-3 font-medium"
          >
            <ShieldAlert className="w-4 h-4 mr-2" />
            Risk review
          </TabsTrigger>
          <TabsTrigger
            value="delivery"
            className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 py-3 font-medium"
          >
            <PackageCheck className="w-4 h-4 mr-2" />
            Delivery studio
          </TabsTrigger>
          <TabsTrigger
            value="reports"
            className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 py-3 font-medium"
          >
            <FileBarChart className="w-4 h-4 mr-2" />
            Package &amp; export
          </TabsTrigger>
          <TabsTrigger
            value="audit"
            className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 py-3 font-medium"
          >
            <History className="w-4 h-4 mr-2" />
            Activity &amp; audit
          </TabsTrigger>
        </TabsList>

        <div className="pt-6 pb-20">
          <Suspense
            fallback={<LoadingPanel label="Loading pursuit workspace" />}
          >
            <TabsContent value="overview" className="m-0">
              <div className="space-y-6">
                <ProjectReadinessGate
                  project={project}
                  onGoToTab={setActiveTab}
                />
                <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                  <div className="bg-card border border-border p-6 rounded-xl shadow-xs">
                    <h3 className="font-serif text-lg font-medium mb-4">
                      Pursuit details
                    </h3>
                    <dl className="space-y-4 text-sm">
                      <div>
                        <dt className="text-muted-foreground uppercase text-xs tracking-wider font-mono">
                          Reviewer
                        </dt>
                        <dd className="mt-1">{project.reviewerName || "-"}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground uppercase text-xs tracking-wider font-mono">
                          Lot
                        </dt>
                        <dd className="mt-1">{project.lot || "-"}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground uppercase text-xs tracking-wider font-mono">
                          Scope
                        </dt>
                        <dd className="mt-1">{project.scope || "-"}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground uppercase text-xs tracking-wider font-mono">
                          Limitations
                        </dt>
                        <dd className="mt-1">{project.limitations || "-"}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground uppercase text-xs tracking-wider font-mono">
                          Created
                        </dt>
                        <dd className="mt-1">
                          {new Date(project.createdAt).toLocaleString()}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground uppercase text-xs tracking-wider font-mono">
                          Model Cost (est.)
                        </dt>
                        <dd className="mt-1">
                          {cost
                            ? `₦${(cost.estimatedKobo / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })} · ${cost.runs} run${cost.runs === 1 ? "" : "s"}`
                            : "-"}
                        </dd>
                      </div>
                    </dl>
                  </div>
                  <div className="bg-card border border-border p-6 rounded-xl shadow-xs xl:col-span-2 space-y-5">
                    <div className="flex items-center justify-between">
                      <h3 className="font-serif text-lg font-medium">
                        Status and controls
                      </h3>
                      {canUpdateProject ? (
                        <Button
                          size="sm"
                          onClick={handleSaveGovernance}
                          disabled={updateProject.isPending}
                        >
                          {updateProject.isPending ? (
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          ) : (
                            <Save className="w-4 h-4 mr-2" />
                          )}
                          Save
                        </Button>
                      ) : null}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label>Status</Label>
                        <Select
                          value={governance.status}
                          onValueChange={(status) =>
                            setGovernance({
                              ...governance,
                              status: status as ProjectStatus,
                            })
                          }
                          disabled={!canUpdateProject}
                        >
                          <SelectTrigger disabled={!canUpdateProject}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {STATUS_OPTIONS.map((status) => (
                              <SelectItem key={status} value={status}>
                                {status.replace(/_/g, " ")}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Review time target</Label>
                        <Select
                          value={governance.slaClass}
                          onValueChange={(slaClass) =>
                            setGovernance({
                              ...governance,
                              slaClass: slaClass as SlaClass,
                            })
                          }
                          disabled={!canUpdateProject}
                        >
                          <SelectTrigger disabled={!canUpdateProject}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="standard">Standard</SelectItem>
                            <SelectItem value="live">Live tender</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Payment check</Label>
                        <Select value={governance.paymentStatus} disabled>
                          <SelectTrigger disabled>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="not_required">
                              Not required
                            </SelectItem>
                            <SelectItem value="pending">Pending</SelectItem>
                            <SelectItem value="confirmed">Confirmed</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {[
                        {
                          role: "founder" as const,
                          label: "Founder confirmed",
                          confirmed: Boolean(project.paymentConfirmedByFounder),
                          name: project.paymentFounderConfirmedByName ?? null,
                          at: project.paymentFounderConfirmedAt ?? null,
                        },
                        {
                          role: "advisor" as const,
                          label: "Advisor confirmed",
                          confirmed: Boolean(project.paymentConfirmedByAdvisor),
                          name: project.paymentAdvisorConfirmedByName ?? null,
                          at: project.paymentAdvisorConfirmedAt ?? null,
                        },
                      ].map((leg) => (
                        <div
                          key={leg.role}
                          className="flex items-center justify-between gap-2 rounded-md border border-border p-3 text-sm"
                        >
                          <div className="min-w-0">
                            <span className="block">{leg.label}</span>
                            {leg.confirmed && leg.name && (
                              <span className="block text-xs text-muted-foreground truncate">
                                {leg.name}
                                {leg.at
                                  ? ` · ${new Date(leg.at).toLocaleDateString()}`
                                  : ""}
                              </span>
                            )}
                            {leg.confirmed && !leg.name && (
                              <span className="block text-xs text-amber-700">
                                Legacy confirmation — no identity recorded
                              </span>
                            )}
                          </div>
                          {leg.confirmed && leg.name ? (
                            <Badge
                              variant="outline"
                              className="text-emerald-700 border-emerald-200 bg-emerald-50 shrink-0"
                            >
                              Confirmed
                            </Badge>
                          ) : canUpdateProject ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="shrink-0"
                              onClick={() => handleConfirmPayment(leg.role)}
                              disabled={confirmPayment.isPending}
                            >
                              <UserCheck className="w-3.5 h-3.5 mr-1.5" />
                              {leg.confirmed
                                ? `Re-confirm as ${leg.role}`
                                : `Confirm as ${leg.role}`}
                            </Button>
                          ) : (
                            <Badge variant="outline" className="shrink-0">
                              Pending
                            </Badge>
                          )}
                        </div>
                      ))}
                      <label className="flex items-center justify-between rounded-md border border-border p-3 text-sm">
                        <span>Restricted mode</span>
                        <Switch
                          checked={governance.restrictedMode}
                          onCheckedChange={(restrictedMode) =>
                            setGovernance({ ...governance, restrictedMode })
                          }
                          disabled={!canUpdateProject}
                        />
                      </label>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label>Conflict status</Label>
                        <Select value={governance.conflictStatus} disabled>
                          <SelectTrigger disabled>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {CONFLICT_OPTIONS.map((status) => (
                              <SelectItem key={status} value={status}>
                                {status}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2 md:col-span-2">
                        <Label>Conflict decision</Label>
                        <Input
                          value={governance.conflictDecision}
                          readOnly
                          placeholder="Consent, decline, or mitigation decision"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label>Reason for conflict decision</Label>
                        <Textarea
                          value={governance.conflictRationale}
                          readOnly
                          className="min-h-[88px]"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Physical archive instructions</Label>
                        <Textarea
                          value={governance.physicalArchiveInstruction}
                          onChange={(e) =>
                            setGovernance({
                              ...governance,
                              physicalArchiveInstruction: e.target.value,
                            })
                          }
                          readOnly={!canUpdateProject}
                          className="min-h-[88px]"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>What to redact</Label>
                        <Textarea
                          value={governance.redactionScope}
                          onChange={(e) =>
                            setGovernance({
                              ...governance,
                              redactionScope: e.target.value,
                            })
                          }
                          readOnly={!canUpdateProject}
                          className="min-h-[88px]"
                        />
                      </div>
                    </div>
                  </div>
                  <div className="bg-card border border-border p-6 rounded-xl shadow-xs space-y-4">
                    <div className="flex items-center gap-2">
                      <Bell className="w-4 h-4 text-muted-foreground" />
                      <h3 className="font-serif text-lg font-medium">
                        Notifications
                      </h3>
                    </div>
                    {canUpdateProject ? (
                      <div className="space-y-3">
                        <Select
                          value={notificationForm.template}
                          onValueChange={(template) =>
                            setNotificationForm({
                              ...notificationForm,
                              template,
                            })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="deadline_reminder">
                              Deadline reminder
                            </SelectItem>
                            <SelectItem value="payment_confirmation">
                              Payment confirmation
                            </SelectItem>
                            <SelectItem value="certificate_renewal">
                              Certificate renewal
                            </SelectItem>
                            <SelectItem value="report_ready">
                              Report ready
                            </SelectItem>
                          </SelectContent>
                        </Select>
                        <div className="grid grid-cols-2 gap-3">
                          <Select
                            value={notificationForm.channel}
                            onValueChange={(channel) =>
                              setNotificationForm({
                                ...notificationForm,
                                channel,
                              })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="manual">Manual</SelectItem>
                              <SelectItem value="email">Email</SelectItem>
                              <SelectItem value="whatsapp">WhatsApp</SelectItem>
                            </SelectContent>
                          </Select>
                          <Input
                            value={notificationForm.recipient}
                            onChange={(e) =>
                              setNotificationForm({
                                ...notificationForm,
                                recipient: e.target.value,
                              })
                            }
                            placeholder="Recipient"
                          />
                        </div>
                        <Button
                          variant="outline"
                          className="w-full"
                          onClick={handleCreateNotification}
                          disabled={createNotification.isPending}
                        >
                          {createNotification.isPending && (
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          )}
                          Record notification
                        </Button>
                      </div>
                    ) : null}
                    <div className="divide-y divide-border border border-border rounded-md">
                      {(notifications ?? []).slice(0, 4).map((event) => (
                        <div key={event.id} className="p-3 text-xs">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium">
                              {event.template.replace(/_/g, " ")}
                            </span>
                            <Badge variant="outline" className="text-xs">
                              {event.status}
                            </Badge>
                          </div>
                          <p className="text-muted-foreground mt-1">
                            {event.channel}{" "}
                            {event.recipient ? `to ${event.recipient}` : ""}
                          </p>
                          {event.payload && (
                            <p className="text-muted-foreground/80 mt-1 italic line-clamp-2">
                              {event.payload}
                            </p>
                          )}
                        </div>
                      ))}
                      {(!notifications || notifications.length === 0) && (
                        <div className="p-3 text-xs text-muted-foreground">
                          No notification events yet.
                        </div>
                      )}
                    </div>
                  </div>
                  {canManageRetention ? (
                    <div className="bg-card border border-border p-6 rounded-xl shadow-xs space-y-4 xl:col-span-2">
                      <div className="flex items-center gap-2">
                        <Archive className="w-4 h-4 text-muted-foreground" />
                        <h3 className="font-serif text-lg font-medium">
                          Retention request
                        </h3>
                      </div>
                      <Textarea
                        value={retentionReason}
                        onChange={(e) => setRetentionReason(e.target.value)}
                        placeholder="Reason for deletion or retention review"
                        className="min-h-[88px]"
                      />
                      <Button
                        variant="outline"
                        onClick={handleRetentionRequest}
                        disabled={createRetentionRequest.isPending}
                      >
                        {createRetentionRequest.isPending && (
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        )}
                        Start retention review
                      </Button>
                    </div>
                  ) : null}
                </div>
              </div>
            </TabsContent>
            <TabsContent value="documents" className="m-0">
              <DocumentsTab
                projectId={id}
                ndaStatus={project.ndaStatus}
                conflictStatus={project.conflictStatus}
                restrictedMode={project.restrictedMode}
              />
            </TabsContent>
            <TabsContent value="requirements" className="m-0">
              <RequirementsTab projectId={id} />
            </TabsContent>
            <TabsContent value="evidence" className="m-0">
              <EvidenceTab projectId={id} />
            </TabsContent>
            <TabsContent value="boq" className="m-0">
              <BoqTab projectId={id} />
            </TabsContent>
            <TabsContent value="defects" className="m-0">
              <DefectsTab projectId={id} />
            </TabsContent>
            <TabsContent value="risk" className="m-0">
              <RiskTab projectId={id} />
            </TabsContent>
            <TabsContent value="delivery" className="m-0">
              <DeliveryStudioTab projectId={id} />
            </TabsContent>
            <TabsContent value="reports" className="m-0">
              <ReportsTab projectId={id} />
            </TabsContent>
            <TabsContent value="audit" className="m-0">
              <AuditTab projectId={id} />
            </TabsContent>
          </Suspense>
        </div>
      </Tabs>
    </div>
  );
}
