import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch, useGetMe } from "@workspace/api-client-react";
import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { useOrganisationAccess } from "@/contexts/organisation-context";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { assertAuthorityScopeCurrent } from "@/lib/authority-scope";
import {
  adaptWorkInbox,
  type WorkInboxGroup,
  type WorkInboxItem,
} from "@/lib/work-inbox";
import { LoadingPanel, StateBadge, StatusPanel } from "./platform-states";
import { formatWatInstant, humaniseToken } from "@/lib/format";

const GROUP_LABELS: Record<WorkInboxGroup, string> = {
  overdue: "Overdue",
  today: "Today",
  upcoming: "Upcoming",
  unscheduled: "Unscheduled",
};

function itemKind(kind: WorkInboxItem["kind"]): string {
  return humaniseToken(kind);
}

function dueLabel(value: string | null): string {
  return formatWatInstant(value, { empty: "No due date recorded" });
}

export function MyWorkInbox() {
  const access = useOrganisationAccess();
  const online = useOnlineStatus();
  const meQuery = useGetMe();
  const organisationId = access?.activeOrganisation?.id ?? "";
  const actorUserId = meQuery.data?.id ?? "";
  const membershipId = access?.activeOrganisation?.membershipId ?? "";
  const directMembership =
    access?.activeOrganisation?.accessSource === "membership" &&
    access.activeOrganisation.membershipOrganisationId === organisationId;
  const capabilityKey = [...(access?.effectivePermissions ?? [])]
    .filter((permission) =>
      [
        "project:read",
        "project:update",
        "billing:read",
        "entitlement:read",
        "order:create",
      ].includes(permission),
    )
    .sort()
    .join("|");
  const enabled = Boolean(
    online && directMembership && organisationId && membershipId && actorUserId,
  );
  const activeScope = useRef({
    organisationId,
    membershipId,
    actorUserId,
    capabilityKey,
  });
  activeScope.current = {
    organisationId,
    membershipId,
    actorUserId,
    capabilityKey,
  };
  const query = useQuery({
    queryKey: [
      "work-inbox",
      organisationId,
      membershipId,
      actorUserId,
      capabilityKey,
    ],
    enabled,
    staleTime: 0,
    gcTime: 0,
    queryFn: async () => {
      const requestedScope = {
        organisationId,
        membershipId,
        actorUserId,
        capabilityKey,
      };
      const payload = await customFetch<unknown>("/api/work-inbox?limit=50", {
        responseType: "json",
        cache: "no-store",
      });
      assertAuthorityScopeCurrent(
        activeScope.current,
        requestedScope,
        "Work-inbox authority changed while tasks loaded",
      );
      return adaptWorkInbox(payload, organisationId);
    },
  });
  const identityPending = meQuery.isLoading || meQuery.isPending;
  const inboxPending = query.isLoading || query.isPending;
  const inboxUnavailable =
    query.isError ||
    (!inboxPending && (!query.isSuccess || query.data === undefined));

  if (!directMembership) return null;
  return (
    <section aria-labelledby="my-work-inbox-heading" className="space-y-4">
      <div>
        <h2 id="my-work-inbox-heading" className="text-xl font-semibold">
          My Work
        </h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
          Tasks assigned to you, plus unassigned tasks you can assign or update.
          Due dates use West Africa Time (WAT). This view does not change any
          task.
        </p>
      </div>
      {!online ? (
        <StatusPanel
          state="offline"
          title="My Work is unavailable offline"
          description="Reconnect to check your latest assignments and permissions. No saved task list is shown offline."
        />
      ) : inboxPending || identityPending ? (
        <LoadingPanel label="Loading current work assignments" />
      ) : meQuery.isError || !meQuery.isSuccess || inboxUnavailable ? (
        <StatusPanel
          state="error"
          title="My Work could not be loaded"
          description="Reload to check your current membership and task permissions. No tasks are shown until that check succeeds."
        />
      ) : Object.values(query.data.groups).every(
          (items) => items.length === 0,
        ) ? (
        <StatusPanel
          state="empty"
          title="No active work to show"
          description="There are no tasks assigned to you and no unassigned tasks you can currently manage."
        />
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {(Object.keys(GROUP_LABELS) as WorkInboxGroup[]).map((group) => {
            const items = query.data.groups[group];
            if (items.length === 0) return null;
            return (
              <div
                key={group}
                className="overflow-hidden rounded-lg border bg-card"
              >
                <div className="border-b px-4 py-3">
                  <h3 className="font-semibold">{GROUP_LABELS[group]}</h3>
                </div>
                <div className="divide-y">
                  {items.map((item) => (
                    <Link
                      key={item.key}
                      href={item.href}
                      className="flex min-h-24 items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium">{item.title}</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {item.projectTitle} · {itemKind(item.kind)} ·{" "}
                          {dueLabel(item.dueAt)} WAT
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {item.assignment === "owned"
                            ? "Assigned to you"
                            : "Unassigned · you can assign or update this work"}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <StateBadge
                          state={group === "overdue" ? "blocked" : "pending"}
                          label={item.status.replaceAll("_", " ")}
                        />
                        <ArrowRight aria-hidden="true" className="size-4" />
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {query.data?.truncated ? (
        <p className="text-xs text-muted-foreground">
          Showing the first {query.data.limit} tasks. Open the linked workspaces
          to see the rest.
        </p>
      ) : null}
    </section>
  );
}
