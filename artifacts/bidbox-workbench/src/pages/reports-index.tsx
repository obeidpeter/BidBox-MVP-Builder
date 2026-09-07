import { useQueries } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  getListReportsQueryKey,
  listReports,
  useListProjects,
} from "@workspace/api-client-react";
import { ArrowRight, FileCheck2 } from "lucide-react";
import {
  DataErrorPanel,
  LoadingPanel,
  PageHeader,
  StateBadge,
  StatusPanel,
} from "@/components/platform-states";
import { formatWatInstant } from "@/lib/format";

function formatDate(value?: string | null): string {
  return formatWatInstant(value, { empty: "Not generated", withTime: false });
}

export default function ReportsIndex() {
  const projectsQuery = useListProjects();
  const projects = projectsQuery.data ?? [];
  const reportQueries = useQueries({
    queries: projects.map((project) => ({
      queryKey: getListReportsQueryKey(project.id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        listReports(project.id, { signal }),
      staleTime: 30_000,
    })),
  });
  const reportFailureCount = reportQueries.filter(
    (query) => query.isError,
  ).length;
  const reportPendingCount = reportQueries.filter(
    (query) => !query.isSuccess && !query.isError,
  ).length;
  const pageState = projectsQuery.isError
    ? "error"
    : reportFailureCount > 0
      ? "partial"
      : projectsQuery.isLoading || reportPendingCount > 0
        ? "pending"
        : "active";

  const rows = projects.map((project, index) => {
    const query = reportQueries[index];
    if (!query || (!query.isSuccess && !query.isError)) {
      return { project, state: "pending" as const };
    }
    if (query.isError) {
      return { project, state: "error" as const };
    }

    const reports = query.data;
    const latest = [...reports].sort((a, b) => b.version - a.version)[0];
    return { project, state: "success" as const, reports, latest };
  });

  return (
    <div className="mx-auto w-full max-w-7xl space-y-7 p-5 sm:p-8">
      <PageHeader
        eyebrow="Controlled outputs"
        title="Reports"
        description="See report records across pursuits. Report creation, approval and export stay inside each pursuit and permissions are checked again when you act."
        state={pageState}
      />
      {projectsQuery.isLoading ? (
        <LoadingPanel label="Loading pursuit records" />
      ) : null}
      {projectsQuery.isError ? (
        <DataErrorPanel
          description="The pursuit list could not be loaded. This does not mean there are no reports."
          onRetry={() => {
            void projectsQuery.refetch();
          }}
        />
      ) : null}
      {!projectsQuery.isError && reportFailureCount > 0 ? (
        <DataErrorPanel
          title="Some pursuit reports could not be loaded"
          description={`${reportFailureCount} pursuit report ${reportFailureCount === 1 ? "list is" : "lists are"} unavailable. Affected rows are marked unavailable and are not included in report counts.`}
          onRetry={() => {
            reportQueries.forEach((query) => {
              if (query.isError) void query.refetch();
            });
          }}
        />
      ) : null}
      {!projectsQuery.isError && reportPendingCount > 0 ? (
        <StatusPanel
          state="pending"
          title="Pursuit reports are loading"
          description={`${reportPendingCount} pursuit report ${reportPendingCount === 1 ? "list is" : "lists are"} still loading. Pending rows are not included in report counts.`}
        />
      ) : null}
      {projectsQuery.isSuccess && rows.length === 0 ? (
        <StatusPanel
          state="empty"
          title="No pursuits are available"
          description="A report can only exist inside a pursuit you can access."
        />
      ) : null}
      {projectsQuery.isSuccess && rows.length > 0 ? (
        <section
          aria-labelledby="reports-directory-heading"
          className="space-y-3"
        >
          <div>
            <h2
              id="reports-directory-heading"
              className="text-lg font-semibold"
            >
              Pursuit report directory
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Open a pursuit for generation, sign-off, download and export
              controls.
            </p>
          </div>
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b border-border bg-muted/45 text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Pursuit
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Client
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Versions
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Latest status
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Generated
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row) => (
                  <tr key={row.project.id}>
                    <td className="px-4 py-3 font-medium">
                      {row.project.tenderTitle}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {row.project.clientName ?? "Client not named"}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {row.state === "success"
                        ? row.reports.length
                        : row.state === "error"
                          ? "Unavailable"
                          : "Pending"}
                    </td>
                    <td className="px-4 py-3">
                      {row.state === "success" ? (
                        <StateBadge
                          state={
                            row.latest?.status === "signed_off"
                              ? "active"
                              : row.latest
                                ? "pending"
                                : "empty"
                          }
                          label={
                            row.latest?.status.replaceAll("_", " ") ??
                            "No report"
                          }
                        />
                      ) : row.state === "error" ? (
                        <StateBadge state="error" label="Unavailable" />
                      ) : (
                        <StateBadge state="pending" label="Loading" />
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {row.state === "success"
                        ? formatDate(row.latest?.createdAt)
                        : row.state === "error"
                          ? "Unavailable"
                          : "Pending"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/projects/${row.project.id}`}
                        className="inline-flex min-h-10 items-center gap-2 rounded-md px-3 font-medium text-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        Open
                        <ArrowRight aria-hidden="true" className="size-4" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/35 p-4 text-sm text-muted-foreground">
            <FileCheck2
              aria-hidden="true"
              className="mt-0.5 size-5 shrink-0 text-primary"
            />
            A report does not mean a submission is ready. Open issues, evidence
            gaps, assignments, source history and approval status still apply.
          </div>
        </section>
      ) : null}
    </div>
  );
}
