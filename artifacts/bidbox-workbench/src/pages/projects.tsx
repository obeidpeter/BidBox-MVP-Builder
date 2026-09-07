import {
  useListProjects,
  useCreateProject,
  getListProjectsQueryKey,
  useListClients,
  useListUsers,
  getListUsersQueryKey,
} from "@workspace/api-client-react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Loader2,
  Plus,
  Briefcase,
  AlertTriangle,
  RotateCcw,
} from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useState, useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useSearchParams } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/errors";
import { useOrganisationPermission } from "@/contexts/organisation-context";
import {
  FILTER_VALUE_LIMIT,
  PROJECT_RISKS,
  PROJECT_STATUSES,
  REGISTER_CLOCK_INTERVAL_MS,
  SEARCH_LIMIT,
  boundedValue,
  deadlineInputToIsoWat,
  filterAndSortProjects,
  formatDeadlineWat,
  readProjectRegisterFilters,
  retainEligibleSelectionId,
} from "./project-register";

const createProjectSchema = z.object({
  clientId: z.string().min(1, "Client is required"),
  tenderTitle: z.string().min(1, "Tender Title is required"),
  issuingEntity: z.string().optional(),
  tenderRef: z.string().optional(),
  lot: z.string().optional(),
  deadline: z
    .string()
    .refine(
      (value) => !value || deadlineInputToIsoWat(value) !== null,
      "Enter a valid submission deadline in WAT",
    )
    .optional(),
  segment: z.enum(["federal", "nipex_ncdmb", "donor", "other"]).optional(),
  reviewerId: z.string().min(1, "Reviewer is required"),
  slaClass: z.enum(["standard", "live"]).optional(),
  physicalArchiveInstruction: z.string().optional(),
  redactionScope: z.string().optional(),
  restrictedMode: z.boolean().optional(),
});

type CreateProjectForm = z.infer<typeof createProjectSchema>;

export default function Projects() {
  const [searchParams, setSearchParams] = useSearchParams();
  const searchKey = searchParams.toString();
  const filters = useMemo(
    () => readProjectRegisterFilters(new URLSearchParams(searchKey)),
    [searchKey],
  );
  const defaultClientId = boundedValue(searchParams.get("clientId"));

  const {
    data: projects,
    isLoading: loadingProjects,
    isPending: projectsPending,
    isError: projectsFailed,
    isSuccess: projectsLoaded,
    isFetching: refreshingProjects,
    refetch: retryProjects,
  } = useListProjects();
  const {
    data: clients,
    isLoading: loadingClients,
    isPending: clientsPending,
    isError: clientsFailed,
    isSuccess: clientsLoaded,
    isFetching: refreshingClients,
    refetch: retryClients,
  } = useListClients();
  const canCreateProject = useOrganisationPermission("project:create");
  const canReadMemberships = useOrganisationPermission("membership:read");
  const {
    data: users,
    isLoading: loadingUsers,
    isPending: usersPending,
    isError: usersFailed,
    isSuccess: usersLoaded,
    isFetching: refreshingUsers,
    refetch: retryUsers,
  } = useListUsers({
    query: {
      enabled: canCreateProject && canReadMemberships,
      queryKey: getListUsersQueryKey(),
    },
  });
  const createProject = useCreateProject();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [isCreateOpen, setIsCreateOpen] = useState(
    defaultClientId !== "" && canCreateProject,
  );
  const projectRegisterPending = loadingProjects || projectsPending;
  const projectRegisterUnavailable =
    projectsFailed ||
    (!projectRegisterPending &&
      (projectsLoaded !== true || projects === undefined));
  const clientDirectoryPending = loadingClients || clientsPending;
  const clientDirectoryUnavailable =
    clientsFailed ||
    (!clientDirectoryPending &&
      (clientsLoaded !== true || clients === undefined));
  const reviewerDirectoryPending = Boolean(
    canCreateProject && canReadMemberships && (loadingUsers || usersPending),
  );
  const reviewerDirectoryUnavailable = Boolean(
    canCreateProject &&
    (!canReadMemberships ||
      usersFailed ||
      (!reviewerDirectoryPending &&
        (usersLoaded !== true || users === undefined))),
  );
  const reviewerOptions = useMemo(
    () =>
      usersLoaded === true && users
        ? users.filter(
            (user) =>
              user.status === "active" &&
              user.membershipStatus === "active" &&
              user.reviewerEligible === true,
          )
        : [],
    [users, usersLoaded],
  );
  const form = useForm<CreateProjectForm>({
    resolver: zodResolver(createProjectSchema),
    defaultValues: {
      clientId: defaultClientId,
      tenderTitle: "",
      issuingEntity: "",
      tenderRef: "",
      lot: "",
      deadline: "",
      segment: "other",
      reviewerId: "",
      slaClass: "standard",
      physicalArchiveInstruction: "",
      redactionScope: "",
      restrictedMode: false,
    },
  });
  const selectedClientId = form.watch("clientId");
  const selectedReviewerId = form.watch("reviewerId");
  const selectedClientEligible =
    clientsLoaded === true &&
    Boolean(retainEligibleSelectionId(selectedClientId, clients ?? []));
  const selectedReviewerEligible = Boolean(
    usersLoaded === true &&
    users !== undefined &&
    retainEligibleSelectionId(selectedReviewerId, reviewerOptions),
  );

  const [referenceNow, setReferenceNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = window.setInterval(
      () => setReferenceNow(Date.now()),
      REGISTER_CLOCK_INTERVAL_MS,
    );
    return () => window.clearInterval(interval);
  }, []);
  const visibleProjects = useMemo(
    () =>
      projectsLoaded && projects
        ? filterAndSortProjects(projects, filters, referenceNow)
        : [],
    [filters, projects, projectsLoaded, referenceNow],
  );
  const clientFilterOptions = useMemo(() => {
    const options = new Map<string, string>();
    for (const project of projects ?? []) {
      options.set(
        project.clientId,
        project.clientName?.trim() || "Unnamed client",
      );
    }
    return [...options].sort((a, b) =>
      a[1] === b[1] ? (a[0] < b[0] ? -1 : 1) : a[1] < b[1] ? -1 : 1,
    );
  }, [projects]);
  const reviewerFilterOptions = useMemo(() => {
    const options = (projects ?? []).reduce<Map<string, string>>(
      (directory, project) => {
        const { reviewerId } = project;
        if (reviewerId) {
          directory.set(
            reviewerId,
            project.reviewerName?.trim() || "Unnamed reviewer",
          );
        }
        return directory;
      },
      new Map(),
    );
    return Array.from(options).sort((a, b) =>
      a[1] === b[1] ? (a[0] < b[0] ? -1 : 1) : a[1] < b[1] ? -1 : 1,
    );
  }, [projects]);

  useEffect(() => {
    if (!projectsLoaded) return;
    const clientFilterIsStale =
      Boolean(filters.client) &&
      !clientFilterOptions.some(([id]) => id === filters.client);
    const reviewerFilterIsStale =
      Boolean(filters.reviewer) &&
      !reviewerFilterOptions.some(([id]) => id === filters.reviewer);
    if (!clientFilterIsStale && !reviewerFilterIsStale) return;

    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (clientFilterIsStale) next.delete("client");
        if (reviewerFilterIsStale) next.delete("reviewer");
        return next;
      },
      { replace: true },
    );
  }, [
    clientFilterOptions,
    filters.client,
    filters.reviewer,
    projectsLoaded,
    reviewerFilterOptions,
    setSearchParams,
  ]);

  const filtersActive =
    filters.search !== "" ||
    filters.status !== "all" ||
    filters.risk !== "all" ||
    filters.client !== "" ||
    filters.reviewer !== "" ||
    filters.deadline !== "all" ||
    filters.sort !== "deadline_asc";

  const updateFilter = (
    name: "q" | "status" | "risk" | "client" | "reviewer" | "deadline" | "sort",
    value: string,
  ) => {
    const bounded = boundedValue(
      value,
      name === "q" ? SEARCH_LIMIT : FILTER_VALUE_LIMIT,
    );
    const defaults: Partial<Record<typeof name, string>> = {
      status: "all",
      risk: "all",
      deadline: "all",
      sort: "deadline_asc",
    };
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (!bounded || bounded === defaults[name]) next.delete(name);
        else next.set(name, bounded);
        return next;
      },
      { replace: true },
    );
  };

  const clearFilters = () => {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        for (const name of [
          "q",
          "status",
          "risk",
          "client",
          "reviewer",
          "deadline",
          "sort",
        ]) {
          next.delete(name);
        }
        return next;
      },
      { replace: true },
    );
  };

  useEffect(() => {
    if (defaultClientId) {
      form.setValue("clientId", defaultClientId);
    }
  }, [defaultClientId, form]);

  useEffect(() => {
    if (
      clientsLoaded &&
      selectedClientId &&
      !retainEligibleSelectionId(selectedClientId, clients ?? [])
    ) {
      form.setValue("clientId", "", { shouldValidate: true });
    }
  }, [clients, clientsLoaded, form, selectedClientId]);

  useEffect(() => {
    if (
      usersLoaded &&
      selectedReviewerId &&
      !retainEligibleSelectionId(selectedReviewerId, reviewerOptions)
    ) {
      form.setValue("reviewerId", "", { shouldValidate: true });
    }
  }, [form, reviewerOptions, selectedReviewerId, usersLoaded]);

  const onSubmit = (data: CreateProjectForm) => {
    const canonicalDeadline = data.deadline
      ? deadlineInputToIsoWat(data.deadline)
      : undefined;
    if (canonicalDeadline === null) {
      form.setError("deadline", {
        type: "validate",
        message: "Enter a valid submission deadline in WAT",
      });
      return;
    }
    const payload = {
      ...data,
      issuingEntity: data.issuingEntity || undefined,
      tenderRef: data.tenderRef || undefined,
      lot: data.lot || undefined,
      deadline: canonicalDeadline,
      physicalArchiveInstruction: data.physicalArchiveInstruction || undefined,
      redactionScope: data.redactionScope || undefined,
    };
    createProject.mutate(
      { data: payload },
      {
        onSuccess: (newProject) => {
          setIsCreateOpen(false);
          form.reset({
            clientId: defaultClientId,
            tenderTitle: "",
            issuingEntity: "",
            tenderRef: "",
            lot: "",
            deadline: "",
            segment: "other",
            reviewerId: "",
            slaClass: "standard",
            physicalArchiveInstruction: "",
            redactionScope: "",
            restrictedMode: false,
          });
          queryClient.invalidateQueries({
            queryKey: getListProjectsQueryKey(),
          });
          navigate(`/projects/${newProject.id}`);
        },
        onError: (err) =>
          toast({
            variant: "destructive",
            title: "Pursuit creation failed",
            description: errorMessage(
              err,
              "Check the client, reviewer, and tender details and try again.",
            ),
          }),
      },
    );
  };

  return (
    <div className="p-8 max-w-7xl mx-auto w-full space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-serif tracking-tight font-semibold">
            Pursuits
          </h1>
          <p className="text-muted-foreground mt-1">
            Manage active pursuits and review past bids.
          </p>
        </div>
        {canCreateProject ? (
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button className="bg-primary text-primary-foreground">
                <Plus className="w-4 h-4 mr-2" />
                New pursuit
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-[680px]">
              <DialogHeader>
                <DialogTitle>Create pursuit</DialogTitle>
                <DialogDescription>
                  Create a pursuit for a tender or bid.
                </DialogDescription>
              </DialogHeader>
              <form
                onSubmit={form.handleSubmit(onSubmit)}
                className="space-y-4 pt-4"
              >
                <div className="space-y-2">
                  <Label htmlFor="clientId">Client</Label>
                  <Select
                    onValueChange={(val) =>
                      form.setValue("clientId", val, { shouldValidate: true })
                    }
                    value={form.watch("clientId")}
                    disabled={
                      clientDirectoryPending ||
                      clientDirectoryUnavailable ||
                      !clients?.length
                    }
                  >
                    <SelectTrigger id="clientId">
                      <SelectValue placeholder="Select client" />
                    </SelectTrigger>
                    <SelectContent>
                      {clients?.map((client) => (
                        <SelectItem key={client.id} value={client.id}>
                          {client.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {form.formState.errors.clientId && (
                    <p className="text-xs text-destructive">
                      {form.formState.errors.clientId.message}
                    </p>
                  )}
                  {clientDirectoryUnavailable ? (
                    <div
                      className="flex flex-wrap items-center gap-2"
                      role="alert"
                    >
                      <p className="text-xs text-destructive">
                        The client list could not be loaded. Select a client
                        after your current access is confirmed.
                      </p>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={refreshingClients}
                        onClick={() => void retryClients()}
                      >
                        Retry clients
                      </Button>
                    </div>
                  ) : clientDirectoryPending ? (
                    <p className="text-xs text-muted-foreground" role="status">
                      Loading clients. You can select one when the list is
                      ready.
                    </p>
                  ) : clientsLoaded && clients?.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No client records are available in this organisation.
                    </p>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="tenderTitle">Tender Title</Label>
                  <Input id="tenderTitle" {...form.register("tenderTitle")} />
                  {form.formState.errors.tenderTitle && (
                    <p className="text-xs text-destructive">
                      {form.formState.errors.tenderTitle.message}
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="issuingEntity">Issuing Entity</Label>
                    <Input
                      id="issuingEntity"
                      {...form.register("issuingEntity")}
                      placeholder="e.g. NNPC"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="tenderRef">Tender Ref</Label>
                    <Input id="tenderRef" {...form.register("tenderRef")} />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="lot">Lot</Label>
                    <Input
                      id="lot"
                      {...form.register("lot")}
                      placeholder="e.g. Lot 2"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="deadline">Submission Deadline (WAT)</Label>
                    <Input
                      id="deadline"
                      type="datetime-local"
                      {...form.register("deadline")}
                    />
                    <p className="text-xs text-muted-foreground">
                      Enter West Africa Time (UTC+1). The saved deadline is
                      converted to an unambiguous instant.
                    </p>
                    {form.formState.errors.deadline ? (
                      <p className="text-xs text-destructive">
                        {form.formState.errors.deadline.message}
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="reviewerId">Reviewer</Label>
                    <Select
                      onValueChange={(val) =>
                        form.setValue("reviewerId", val, {
                          shouldValidate: true,
                        })
                      }
                      value={form.watch("reviewerId")}
                      disabled={
                        reviewerDirectoryPending ||
                        reviewerDirectoryUnavailable ||
                        reviewerOptions.length === 0
                      }
                    >
                      <SelectTrigger id="reviewerId">
                        <SelectValue placeholder="Select reviewer" />
                      </SelectTrigger>
                      <SelectContent>
                        {reviewerOptions.map((user) => (
                          <SelectItem key={user.id} value={user.id}>
                            {user.name || user.email}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {form.formState.errors.reviewerId && (
                      <p className="text-xs text-destructive">
                        {form.formState.errors.reviewerId.message}
                      </p>
                    )}
                    {reviewerDirectoryUnavailable ? (
                      <div
                        className="flex flex-wrap items-center gap-2"
                        role="alert"
                      >
                        <p className="text-xs text-destructive">
                          The reviewer list could not be loaded. Select a
                          reviewer after current permissions are confirmed.
                        </p>
                        {canReadMemberships ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={refreshingUsers}
                            onClick={() => void retryUsers()}
                          >
                            Retry reviewers
                          </Button>
                        ) : null}
                      </div>
                    ) : reviewerDirectoryPending ? (
                      <p
                        className="text-xs text-muted-foreground"
                        role="status"
                      >
                        Loading reviewers. You can select one when the list is
                        ready.
                      </p>
                    ) : usersLoaded && reviewerOptions.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        No active reviewer with direct access is available in
                        this organisation.
                      </p>
                    ) : null}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="segment">Segment</Label>
                    <Select
                      onValueChange={(val) =>
                        form.setValue(
                          "segment",
                          val as CreateProjectForm["segment"],
                        )
                      }
                      value={form.watch("segment")}
                    >
                      <SelectTrigger id="segment">
                        <SelectValue placeholder="Select segment" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="federal">Federal</SelectItem>
                        <SelectItem value="nipex_ncdmb">
                          NIPEX / NCDMB
                        </SelectItem>
                        <SelectItem value="donor">Donor</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="slaClass">Review timing</Label>
                    <Select
                      onValueChange={(val) =>
                        form.setValue(
                          "slaClass",
                          val as CreateProjectForm["slaClass"],
                        )
                      }
                      value={form.watch("slaClass")}
                    >
                      <SelectTrigger id="slaClass">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="standard">Standard</SelectItem>
                        <SelectItem value="live">Live tender</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div
                    role="note"
                    aria-label="Commercial gate"
                    className="rounded-md border border-border bg-muted/30 p-3 text-sm"
                  >
                    <p className="font-medium">Commercial gate</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Every new pursuit starts with payment pending. The
                      authorised commercial workflow manages that status after
                      creation; it cannot be changed here.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="physicalArchiveInstruction">
                      Physical Archive
                    </Label>
                    <Textarea
                      id="physicalArchiveInstruction"
                      {...form.register("physicalArchiveInstruction")}
                      className="min-h-[72px]"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="redactionScope">Redaction Scope</Label>
                    <Textarea
                      id="redactionScope"
                      {...form.register("redactionScope")}
                      className="min-h-[72px]"
                    />
                  </div>
                </div>

                <label className="flex items-center justify-between rounded-md border border-border p-3 text-sm">
                  <span>
                    <span className="font-medium">Restricted mode</span>
                    <span className="block text-xs text-muted-foreground">
                      Limit handling for sensitive or conflicted work.
                    </span>
                  </span>
                  <Switch
                    checked={form.watch("restrictedMode") ?? false}
                    onCheckedChange={(checked) =>
                      form.setValue("restrictedMode", checked)
                    }
                  />
                </label>

                <div className="flex justify-end pt-4">
                  <Button
                    type="submit"
                    disabled={
                      createProject.isPending ||
                      clientDirectoryPending ||
                      clientDirectoryUnavailable ||
                      !selectedClientEligible ||
                      reviewerDirectoryPending ||
                      reviewerDirectoryUnavailable ||
                      !selectedReviewerEligible
                    }
                  >
                    {createProject.isPending ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : null}
                    Create pursuit
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        ) : null}
      </div>

      {projectsLoaded && projects && projects.length > 0 ? (
        <section
          aria-label="Pursuit register filters"
          className="space-y-4 rounded-lg border border-border bg-card p-4 shadow-xs"
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="project-search">Search register</Label>
              <Input
                id="project-search"
                type="search"
                maxLength={SEARCH_LIMIT}
                value={filters.search}
                onChange={(event) => updateFilter("q", event.target.value)}
                placeholder="Tender, client, reference, entity, lot, or reviewer"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-status-filter">Status</Label>
              <Select
                value={filters.status}
                onValueChange={(value) => updateFilter("status", value)}
              >
                <SelectTrigger id="project-status-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  {PROJECT_STATUSES.map((status) => (
                    <SelectItem key={status} value={status}>
                      {status.replace("_", " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-risk-filter">Risk</Label>
              <Select
                value={filters.risk}
                onValueChange={(value) => updateFilter("risk", value)}
              >
                <SelectTrigger id="project-risk-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All risk bands</SelectItem>
                  {PROJECT_RISKS.map((risk) => (
                    <SelectItem key={risk} value={risk}>
                      {risk}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-client-filter">Client</Label>
              <Select
                value={filters.client || "all"}
                onValueChange={(value) =>
                  updateFilter("client", value === "all" ? "" : value)
                }
              >
                <SelectTrigger id="project-client-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All clients</SelectItem>
                  {clientFilterOptions.map(([id, name]) => (
                    <SelectItem key={id} value={id}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-reviewer-filter">Reviewer</Label>
              <Select
                value={filters.reviewer || "all"}
                onValueChange={(value) =>
                  updateFilter("reviewer", value === "all" ? "" : value)
                }
              >
                <SelectTrigger id="project-reviewer-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All reviewers</SelectItem>
                  {reviewerFilterOptions.map(([id, name]) => (
                    <SelectItem key={id} value={id}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-deadline-filter">Deadline (WAT)</Label>
              <Select
                value={filters.deadline}
                onValueChange={(value) => updateFilter("deadline", value)}
              >
                <SelectTrigger id="project-deadline-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All deadlines</SelectItem>
                  <SelectItem value="overdue">Overdue</SelectItem>
                  <SelectItem value="due_today">Due today</SelectItem>
                  <SelectItem value="next_7_days">Next 7 WAT days</SelectItem>
                  <SelectItem value="next_30_days">Next 30 WAT days</SelectItem>
                  <SelectItem value="no_deadline">No deadline</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-sort">Sort</Label>
              <Select
                value={filters.sort}
                onValueChange={(value) => updateFilter("sort", value)}
              >
                <SelectTrigger id="project-sort">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="deadline_asc">
                    Deadline: earliest (WAT)
                  </SelectItem>
                  <SelectItem value="deadline_desc">
                    Deadline: latest (WAT)
                  </SelectItem>
                  <SelectItem value="risk_desc">Risk: highest</SelectItem>
                  <SelectItem value="created_desc">Newest created</SelectItem>
                  <SelectItem value="title_asc">Tender title</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3 text-sm text-muted-foreground">
            <p aria-live="polite">
              {refreshingProjects
                ? "Refreshing the pursuit register…"
                : `Showing ${visibleProjects.length} of ${projects.length} pursuits.`}
            </p>
            {filtersActive ? (
              <Button type="button" variant="ghost" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : null}
          </div>
        </section>
      ) : null}

      <div className="bg-card border border-border rounded-lg shadow-xs overflow-hidden">
        {projectRegisterPending ? (
          <div
            className="p-12 flex justify-center"
            role="status"
            aria-label="Loading pursuit register"
          >
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : projectRegisterUnavailable ? (
          <div
            className="space-y-3 p-12 text-center text-muted-foreground"
            role="alert"
          >
            <AlertTriangle className="mx-auto h-10 w-10 text-destructive" />
            <p className="font-medium text-foreground">
              The pursuit register could not be loaded.
            </p>
            <p className="text-sm">
              No pursuit count is shown while the register is unavailable.
            </p>
            <Button
              type="button"
              variant="outline"
              disabled={refreshingProjects}
              onClick={() => void retryProjects()}
              aria-label="Retry loading pursuit register"
            >
              {refreshingProjects ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RotateCcw className="mr-2 h-4 w-4" />
              )}
              Retry
            </Button>
          </div>
        ) : projects.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground bg-card">
            <Briefcase className="w-12 h-12 mx-auto mb-3 text-muted" />
            <p>No pursuits found.</p>
            <p className="text-sm mt-1">
              {canCreateProject
                ? "Create a pursuit to begin."
                : "No pursuits are available for your current organisation access."}
            </p>
          </div>
        ) : visibleProjects.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead>Tender</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Risk</TableHead>
                <TableHead className="text-right">Counts</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleProjects.map((project) => (
                <TableRow
                  key={project.id}
                  className="group hover:bg-muted/50 transition-colors"
                >
                  <TableCell>
                    <Link
                      href={`/projects/${project.id}`}
                      aria-label={`Open pursuit: ${project.tenderTitle}`}
                      className="inline-flex rounded-sm font-medium text-foreground underline-offset-4 transition-colors hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      {project.tenderTitle}
                    </Link>
                    <div className="text-xs text-muted-foreground mt-1">
                      {project.issuingEntity || "Unknown entity"}
                      {project.deadline &&
                        ` • Due ${formatDeadlineWat(project.deadline)}`}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">
                      {project.clientName || "Unnamed client"}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="capitalize">
                      {project.status.replace("_", " ")}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {project.riskBand === "critical" ||
                    project.riskBand === "high" ? (
                      <div className="flex items-center text-destructive text-sm font-medium">
                        <AlertTriangle className="w-3.5 h-3.5 mr-1" />
                        <span className="capitalize">{project.riskBand}</span>
                      </div>
                    ) : project.riskBand === "medium" ? (
                      <span className="text-amber-600 text-sm font-medium capitalize">
                        {project.riskBand}
                      </span>
                    ) : (
                      <span className="text-emerald-600 text-sm font-medium capitalize">
                        {project.riskBand || "Unknown"}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-3 text-xs text-muted-foreground">
                      <div className="flex flex-col items-end">
                        <span className="font-mono text-foreground font-medium">
                          {project.requirementCount ?? "Unavailable"}
                        </span>
                        <span className="uppercase tracking-wider text-xs">
                          Reqs
                        </span>
                      </div>
                      <div className="flex flex-col items-end">
                        <span className="font-mono text-foreground font-medium">
                          {project.defectCount ?? "Unavailable"}
                        </span>
                        <span className="uppercase tracking-wider text-xs">
                          Defects
                        </span>
                      </div>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="p-12 text-center text-muted-foreground bg-card">
            <Briefcase className="w-12 h-12 mx-auto mb-3 text-muted" />
            <p>No pursuits match the current filters.</p>
            <p className="text-sm mt-1">
              Clear or adjust the filters to review the loaded register.
            </p>
            <Button
              type="button"
              variant="outline"
              className="mt-4"
              onClick={clearFilters}
            >
              Clear filters
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
