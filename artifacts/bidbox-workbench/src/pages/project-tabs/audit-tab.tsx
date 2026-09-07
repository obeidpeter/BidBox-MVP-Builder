import { useListAudit } from "@workspace/api-client-react";
import { History, Loader2, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export function AuditTab({ projectId }: { projectId: string }) {
  const { data: events, isLoading } = useListAudit(projectId);
  const hasLegacyArchive = events?.some(
    (event) => event.auditSource === "legacy_v1_archive",
  );

  if (isLoading) {
    return (
      <div className="p-8 flex justify-center items-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-serif font-medium">Activity and audit</h2>
      </div>

      {hasLegacyArchive ? (
        <div
          className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-200"
          role="status"
        >
          <TriangleAlert
            className="mt-0.5 size-4 shrink-0"
            aria-hidden="true"
          />
          <div>
            <p className="font-semibold">Preserved legacy v1 evidence</p>
            <p className="mt-1 leading-5">
              Amber events come from the read-only legacy archive. A record
              fingerprint can match without proving an unbroken audit chain.
              Treat rows marked known discontinuity as unverified by the active
              chain.
            </p>
          </div>
        </div>
      ) : null}

      <div className="bg-card border border-border rounded-lg shadow-xs overflow-hidden p-6">
        {events && events.length > 0 ? (
          <div className="space-y-6 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-border before:to-transparent">
            {events.map((event) => {
              const archived = event.auditSource === "legacy_v1_archive";
              return (
                <div
                  key={event.id}
                  className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active"
                >
                  <div
                    className={`flex items-center justify-center w-10 h-10 rounded-full border bg-card shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 shadow-sm z-10 ${archived ? "border-amber-300" : "border-sky-200"}`}
                  >
                    {archived ? (
                      <TriangleAlert className="w-4 h-4 text-amber-700" />
                    ) : (
                      <History className="w-4 h-4 text-sky-700" />
                    )}
                  </div>
                  <div
                    className={`w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] p-4 rounded-xl border shadow-xs ${archived ? "border-amber-300 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/10" : "border-sky-200 bg-muted/20"}`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                      <span className="font-medium text-sm text-foreground">
                        {event.eventType.replace(/_/g, " ")}
                      </span>
                      <span className="text-xs uppercase font-mono text-muted-foreground">
                        {new Date(event.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <Badge
                      variant="outline"
                      className={
                        archived
                          ? "mb-2 border-amber-300 bg-amber-100 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
                          : "mb-2 border-sky-200 bg-sky-50 text-xs text-sky-900"
                      }
                    >
                      {archived
                        ? `Legacy v1 archive · ${event.integrityStatus.replace(/_/g, " ")}`
                        : "Active v2 chain record"}
                    </Badge>
                    <div className="text-xs text-muted-foreground">
                      by {event.userName || event.userId}
                    </div>
                    {event.details && (
                      <div className="mt-2 text-xs font-mono bg-background border border-border p-2 rounded truncate">
                        {JSON.stringify(event.details)}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="p-12 text-center text-muted-foreground">
            <History className="w-12 h-12 mx-auto mb-3 text-muted" />
            <p>No events logged yet.</p>
          </div>
        )}
      </div>
    </div>
  );
}
