import { useEffect, useId, useMemo, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListOrganisationMembershipsQueryKey,
  useCreateOrganisationMembership,
  useGetMe,
  useListOrganisationMemberships,
  useUpdateOrganisationMembership,
  type OrganisationMembershipCreate,
  type OrganisationMembershipUpdate,
  type OrganisationMembershipView,
  type OrganisationRole,
} from "@workspace/api-client-react";
import {
  CalendarClock,
  Copy,
  KeyRound,
  Loader2,
  ShieldCheck,
  UserPlus,
  UsersRound,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
  DataErrorPanel,
  LoadingPanel,
  PageHeader,
  StateBadge,
  StatusPanel,
  type SurfaceState,
} from "@/components/platform-states";
import {
  ORGANISATION_ROLE_LABELS,
  delegableRoles,
  isLastActiveAdministrator,
} from "@/lib/organisation-membership-policy";
import { useOrganisationAccess } from "@/contexts/organisation-context";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { useToast } from "@/hooks/use-toast";
import { errorMessage, requestStatus as apiStatus } from "@/lib/errors";
import { formatWatInstant, watDateParts } from "@/lib/format";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function dateInputValue(value: string | null): string {
  if (!value) return "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : watDateParts(parsed);
}

function endOfWatDay(date: string): string {
  return `${date}T23:59:59+01:00`;
}

function validFutureEndDate(date: string): boolean {
  return !date || new Date(endOfWatDay(date)).getTime() > Date.now();
}

function formatDateTime(value: string | null): string {
  return formatWatInstant(value, {
    empty: "No expiry",
    invalid: "Invalid stored date",
    suffix: " WAT",
  });
}

function membershipState(membership: OrganisationMembershipView): {
  state: SurfaceState;
  label: string;
} {
  if (membership.status === "suspended") {
    return { state: "blocked", label: "Suspended" };
  }
  if (membership.status === "revoked") {
    return { state: "unavailable", label: "Revoked" };
  }
  const now = Date.now();
  if (
    membership.accessStartsAt &&
    new Date(membership.accessStartsAt).getTime() > now
  ) {
    return { state: "pending", label: "Scheduled" };
  }
  if (
    membership.accessExpiresAt &&
    new Date(membership.accessExpiresAt).getTime() <= now
  ) {
    return { state: "expired", label: "Expired" };
  }
  return { state: "active", label: "Active" };
}

function roleWindowLabel(
  role: OrganisationMembershipView["roles"][number],
): string | null {
  const now = Date.now();
  if (role.startsAt && new Date(role.startsAt).getTime() > now) {
    return `starts ${formatDateTime(role.startsAt)}`;
  }
  if (role.expiresAt && new Date(role.expiresAt).getTime() <= now) {
    return `expired ${formatDateTime(role.expiresAt)}`;
  }
  if (role.expiresAt) return `until ${formatDateTime(role.expiresAt)}`;
  return null;
}

function AddMembershipForm({
  organisationId,
  allowedRoles,
  online,
}: {
  organisationId: string;
  allowedRoles: readonly OrganisationRole[];
  online: boolean;
}) {
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<OrganisationRole | "">(
    allowedRoles[0] ?? "",
  );
  const [accessEndDate, setAccessEndDate] = useState("");
  const [clearAccessExpiry, setClearAccessExpiry] = useState(false);
  const [roleEndDate, setRoleEndDate] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const helpId = useId();
  const mutation = useCreateOrganisationMembership();

  useEffect(() => {
    if (!role || !allowedRoles.includes(role)) setRole(allowedRoles[0] ?? "");
  }, [allowedRoles, role]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const targetUserId = userId.trim();
    if (!UUID_PATTERN.test(targetUserId)) {
      setFormError("Enter the user's full Valo user ID.");
      return;
    }
    if (!role || !allowedRoles.includes(role)) {
      setFormError("Select a role that you are allowed to grant.");
      return;
    }
    if (
      !validFutureEndDate(accessEndDate) ||
      !validFutureEndDate(roleEndDate)
    ) {
      setFormError("Expiry dates must end in the future.");
      return;
    }
    if (
      accessEndDate &&
      roleEndDate &&
      new Date(endOfWatDay(roleEndDate)).getTime() >
        new Date(endOfWatDay(accessEndDate)).getTime()
    ) {
      setFormError(
        "The role end date cannot be after the membership end date.",
      );
      return;
    }

    setFormError(null);
    const data: OrganisationMembershipCreate = {
      userId: targetUserId,
      role,
      ...(accessEndDate
        ? { accessExpiresAt: endOfWatDay(accessEndDate) }
        : clearAccessExpiry
          ? { accessExpiresAt: null }
          : {}),
      ...(roleEndDate ? { roleExpiresAt: endOfWatDay(roleEndDate) } : {}),
    };
    mutation.mutate(
      { organisationId, data },
      {
        onSuccess: async () => {
          await queryClient.invalidateQueries({
            queryKey: getListOrganisationMembershipsQueryKey(organisationId),
          });
          setUserId("");
          setAccessEndDate("");
          setClearAccessExpiry(false);
          setRoleEndDate("");
          toast({
            title: "Membership grant saved",
            description:
              "The server checked the organisation, your access and the roles you can grant.",
          });
        },
        onError: (error) => {
          setFormError(
            errorMessage(
              error,
              "The membership grant was refused. Check the user ID and confirm that you can grant this role.",
            ),
          );
        },
      },
    );
  };

  return (
    <Card className="shadow-none">
      <CardHeader>
        <div className="flex items-start gap-3">
          <div className="rounded-md border border-primary/20 bg-primary/5 p-2 text-primary">
            <UserPlus aria-hidden="true" className="size-4" />
          </div>
          <div>
            <CardTitle className="text-base">
              Grant organisation access
            </CardTitle>
            <p
              id={helpId}
              className="mt-1 text-sm leading-6 text-muted-foreground"
            >
              This form does not send an email invitation. The person must sign
              in to Valo first, then you enter their Valo user ID. The server
              checks that you can grant the selected role. You can add one role
              or reactivate a membership here, but you cannot remove a role.
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {allowedRoles.length === 0 ? (
          <StatusPanel
            state="blocked"
            title="You cannot grant any roles"
            description="Your current direct membership does not allow you to grant a role from this page."
          />
        ) : (
          <form className="space-y-5" onSubmit={submit} noValidate>
            <fieldset
              className="grid gap-4 md:grid-cols-2"
              disabled={mutation.isPending || !online}
              aria-describedby={helpId}
            >
              <legend className="sr-only">New organisation membership</legend>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="membership-user-id">Valo user ID</Label>
                <Input
                  id="membership-user-id"
                  value={userId}
                  onChange={(event) => setUserId(event.target.value)}
                  placeholder="00000000-0000-0000-0000-000000000000"
                  autoComplete="off"
                  spellCheck={false}
                  required
                  aria-invalid={Boolean(
                    formError && !UUID_PATTERN.test(userId.trim()),
                  )}
                />
                <p className="text-xs text-muted-foreground">
                  Email addresses are not accepted here. Ask the person to sign
                  in once, then obtain their Valo user ID through an authorised
                  support channel.
                </p>
              </div>

              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="membership-role">Role</Label>
                <Select
                  value={role}
                  onValueChange={(value) => setRole(value as OrganisationRole)}
                  required
                >
                  <SelectTrigger id="membership-role">
                    <SelectValue placeholder="Select a role" />
                  </SelectTrigger>
                  <SelectContent>
                    {allowedRoles.map((option) => (
                      <SelectItem key={option} value={option}>
                        {ORGANISATION_ROLE_LABELS[option]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="membership-access-end">
                  Membership end date (optional)
                </Label>
                <Input
                  id="membership-access-end"
                  type="date"
                  min={watDateParts()}
                  value={accessEndDate}
                  onChange={(event) => {
                    setAccessEndDate(event.target.value);
                    if (event.target.value) setClearAccessExpiry(false);
                  }}
                  disabled={clearAccessExpiry}
                />
                <p className="text-xs text-muted-foreground">
                  Access ends at 23:59:59 WAT on this date. When reactivating an
                  existing membership, leaving this blank preserves its stored
                  expiry.
                </p>
                <div className="flex items-start gap-2">
                  <Checkbox
                    id="membership-clear-access-end"
                    checked={clearAccessExpiry}
                    onCheckedChange={(checked) => {
                      const clear = checked === true;
                      setClearAccessExpiry(clear);
                      if (clear) setAccessEndDate("");
                    }}
                  />
                  <Label
                    htmlFor="membership-clear-access-end"
                    className="text-xs font-normal leading-5 text-muted-foreground"
                  >
                    Remove the current membership end date and allow access
                    without an expiry date.
                  </Label>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="membership-role-end">
                  Role end date (optional)
                </Label>
                <Input
                  id="membership-role-end"
                  type="date"
                  min={watDateParts()}
                  value={roleEndDate}
                  onChange={(event) => setRoleEndDate(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  The role grant ends at 23:59:59 WAT on this date.
                </p>
              </div>
            </fieldset>

            {formError ? (
              <p className="text-sm text-destructive" role="alert">
                {formError}
              </p>
            ) : null}
            {!online ? (
              <p className="text-sm text-muted-foreground" role="status">
                Reconnect before changing organisation access.
              </p>
            ) : null}
            <Button
              type="submit"
              disabled={mutation.isPending || !online || !role}
            >
              {mutation.isPending ? (
                <Loader2
                  aria-hidden="true"
                  className="size-4 animate-spin motion-reduce:animate-none"
                />
              ) : (
                <KeyRound aria-hidden="true" className="size-4" />
              )}
              Save membership grant
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function MembershipCard({
  membership,
  memberships,
  organisationId,
  currentUserId,
  online,
}: {
  membership: OrganisationMembershipView;
  memberships: readonly OrganisationMembershipView[];
  organisationId: string;
  currentUserId: string | undefined;
  online: boolean;
}) {
  const [accessEndDate, setAccessEndDate] = useState(
    dateInputValue(membership.accessExpiresAt),
  );
  const [inlineError, setInlineError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const status = membershipState(membership);
  const identityVerified = Boolean(currentUserId);
  const isSelf = currentUserId === membership.user.id;
  const lastAdministrator = isLastActiveAdministrator(membership, memberships);
  const protectedFromSuspension =
    !identityVerified || isSelf || lastAdministrator;
  const protectionReason = !identityVerified
    ? "Your current identity could not be matched safely. Reload before changing access."
    : isSelf
      ? "Use another authorised administrator to change your own access."
      : lastAdministrator
        ? "This is the last active administrative membership. Grant another administrator before changing it."
        : null;
  const storedDate = dateInputValue(membership.accessExpiresAt);
  const update = useUpdateOrganisationMembership({
    request: { headers: { "If-Match": `"${membership.version}"` } },
  });

  useEffect(() => {
    setAccessEndDate(dateInputValue(membership.accessExpiresAt));
    setInlineError(null);
  }, [membership.accessExpiresAt, membership.version]);

  const refresh = async () => {
    await queryClient.invalidateQueries({
      queryKey: getListOrganisationMembershipsQueryKey(organisationId),
    });
  };

  const submitUpdate = (data: OrganisationMembershipUpdate, label: string) => {
    setInlineError(null);
    update.mutate(
      { organisationId, membershipId: membership.id, data },
      {
        onSuccess: async () => {
          await refresh();
          toast({
            title: label,
            description:
              "The server checked the latest membership record and saved the change.",
          });
        },
        onError: async (error) => {
          const message =
            apiStatus(error) === 409
              ? "This membership changed in another session. The current record is being reloaded; review it before trying again."
              : errorMessage(error, "The membership update was refused.");
          setInlineError(message);
          if (apiStatus(error) === 409) await refresh();
        },
      },
    );
  };

  const saveExpiry = () => {
    if (!validFutureEndDate(accessEndDate)) {
      setInlineError("The access end date must end in the future.");
      return;
    }
    submitUpdate(
      { accessExpiresAt: accessEndDate ? endOfWatDay(accessEndDate) : null },
      accessEndDate ? "Access expiry updated" : "Access expiry cleared",
    );
  };

  const copyUserId = async () => {
    try {
      await navigator.clipboard.writeText(membership.user.id);
      toast({ title: "User ID copied" });
    } catch {
      toast({
        variant: "destructive",
        title: "Could not copy user ID",
        description: "Select and copy the identifier manually.",
      });
    }
  };

  return (
    <article aria-labelledby={`member-${membership.id}`}>
      <Card className="shadow-none">
        <CardHeader className="gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle
                id={`member-${membership.id}`}
                className="truncate text-base"
              >
                {membership.user.name?.trim() || membership.user.email}
              </CardTitle>
              {isSelf ? <Badge variant="secondary">You</Badge> : null}
              <StateBadge state={status.state} label={status.label} />
            </div>
            <p className="mt-1 break-all text-sm text-muted-foreground">
              {membership.user.email}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {membership.status === "active" ? (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={
                      protectedFromSuspension || update.isPending || !online
                    }
                  >
                    Suspend
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      Suspend this membership?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      {membership.user.email} will lose organisation access as
                      soon as the server saves this change. Audit history and
                      the membership record are retained.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Keep active</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onClick={() =>
                        submitUpdate(
                          { status: "suspended" },
                          "Membership suspended",
                        )
                      }
                    >
                      Suspend access
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : membership.status === "suspended" ? (
              <Button
                type="button"
                size="sm"
                disabled={update.isPending || !online}
                onClick={() =>
                  submitUpdate({ status: "active" }, "Membership reactivated")
                }
              >
                Reactivate
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Internal user ID
              </dt>
              <dd className="mt-1 flex items-center gap-2">
                <code className="min-w-0 break-all text-xs">
                  {membership.user.id}
                </code>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0"
                  aria-label={`Copy user ID for ${membership.user.email}`}
                  onClick={copyUserId}
                >
                  <Copy aria-hidden="true" className="size-3.5" />
                </Button>
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Membership version
              </dt>
              <dd className="mt-1 font-mono text-xs">{membership.version}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Access starts
              </dt>
              <dd className="mt-1">
                {membership.accessStartsAt
                  ? formatDateTime(membership.accessStartsAt)
                  : "Immediately"}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Access expires
              </dt>
              <dd className="mt-1">
                {formatDateTime(membership.accessExpiresAt)}
              </dd>
            </div>
          </dl>

          <div>
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Roles
            </h3>
            {membership.roles.length > 0 ? (
              <ul className="mt-2 flex flex-wrap gap-2" aria-label="Roles">
                {membership.roles.map((grant) => {
                  const window = roleWindowLabel(grant);
                  return (
                    <li key={grant.id}>
                      <Badge
                        variant="outline"
                        className="h-auto whitespace-normal py-1"
                      >
                        {ORGANISATION_ROLE_LABELS[grant.role]}
                        {window ? ` - ${window}` : ""}
                      </Badge>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">
                No current role was returned. This membership record alone does
                not prove that the person has access.
              </p>
            )}
          </div>

          {membership.status !== "revoked" ? (
            <div className="rounded-lg border border-border bg-muted/25 p-4">
              <div className="flex items-center gap-2">
                <CalendarClock
                  aria-hidden="true"
                  className="size-4 text-primary"
                />
                <h3 className="text-sm font-semibold">Access end date</h3>
              </div>
              <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="w-full max-w-64 space-y-2">
                  <Label htmlFor={`membership-expiry-${membership.id}`}>
                    End date (WAT)
                  </Label>
                  <Input
                    id={`membership-expiry-${membership.id}`}
                    type="date"
                    min={watDateParts()}
                    value={accessEndDate}
                    disabled={
                      protectedFromSuspension || update.isPending || !online
                    }
                    onChange={(event) => setAccessEndDate(event.target.value)}
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  disabled={
                    protectedFromSuspension ||
                    update.isPending ||
                    !online ||
                    accessEndDate === storedDate
                  }
                  onClick={saveExpiry}
                >
                  {update.isPending ? (
                    <Loader2
                      aria-hidden="true"
                      className="size-4 animate-spin motion-reduce:animate-none"
                    />
                  ) : null}
                  Save access end
                </Button>
                {accessEndDate ? (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={
                      protectedFromSuspension || update.isPending || !online
                    }
                    onClick={() => setAccessEndDate("")}
                  >
                    Clear field
                  </Button>
                ) : null}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                A selected date ends at 23:59:59 WAT. Clearing and saving
                removes the membership expiry.
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Revoked membership history is read-only in this interface.
            </p>
          )}

          {protectionReason ? (
            <p
              className="text-xs leading-5 text-muted-foreground"
              role="status"
            >
              {protectionReason}
            </p>
          ) : null}
          {inlineError ? (
            <p className="text-sm text-destructive" role="alert">
              {inlineError}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </article>
  );
}

export default function OrganisationSettings() {
  const organisationAccess = useOrganisationAccess();
  const organisation = organisationAccess?.activeOrganisation ?? null;
  const online = useOnlineStatus();
  const meQuery = useGetMe();
  const query = useListOrganisationMemberships(organisation?.id ?? "", {
    query: {
      queryKey: getListOrganisationMembershipsQueryKey(organisation?.id ?? ""),
      enabled: Boolean(organisation?.id),
      retry: (failureCount, error) => {
        const status = apiStatus(error);
        if (status === 401 || status === 403 || status === 404) return false;
        return failureCount < 2;
      },
    },
  });
  const memberships = useMemo(
    () =>
      [...(query.data ?? [])].sort((left, right) => {
        if (left.status !== right.status) {
          if (left.status === "active") return -1;
          if (right.status === "active") return 1;
        }
        return (left.user.name || left.user.email).localeCompare(
          right.user.name || right.user.email,
        );
      }),
    [query.data],
  );
  const allowedRoles = useMemo(
    () =>
      organisation
        ? delegableRoles(
            organisation.type,
            organisationAccess?.effectiveRoles ?? [],
          )
        : [],
    [organisation, organisationAccess?.effectiveRoles],
  );
  const forbidden = apiStatus(query.error) === 403;
  const membershipsPending = query.isLoading || query.isPending;

  if (!organisation) {
    return (
      <div className="mx-auto w-full max-w-7xl p-5 sm:p-8">
        <StatusPanel
          state="blocked"
          title="Select an organisation"
          description="Select an organisation where you have direct membership before opening organisation settings."
        />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-7 p-5 sm:p-8">
      <PageHeader
        eyebrow="Organisation administration"
        title="Organisation settings"
        description={`Manage membership access for ${organisation.name}. The server checks your authority for every view and change.`}
        state={
          !online
            ? "offline"
            : membershipsPending
              ? "pending"
              : query.isError
                ? forbidden
                  ? "blocked"
                  : "error"
                : "active"
        }
      />

      {query.isSuccess ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-border bg-card p-4">
            <UsersRound aria-hidden="true" className="size-5 text-primary" />
            <p className="mt-3 text-2xl font-semibold">{memberships.length}</p>
            <p className="text-xs text-muted-foreground">Membership records</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <ShieldCheck aria-hidden="true" className="size-5 text-primary" />
            <p className="mt-3 text-2xl font-semibold">
              {
                memberships.filter(
                  (membership) =>
                    membershipState(membership).state === "active",
                ).length
              }
            </p>
            <p className="text-xs text-muted-foreground">
              Currently active memberships
            </p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <KeyRound aria-hidden="true" className="size-5 text-primary" />
            <p className="mt-3 text-2xl font-semibold">{allowedRoles.length}</p>
            <p className="text-xs text-muted-foreground">Roles you can grant</p>
          </div>
        </div>
      ) : null}

      {!online ? (
        <StatusPanel
          state="offline"
          title="Access changes are paused"
          description="Reconnect before granting, suspending, reactivating or changing membership expiry. Cached records may be stale."
        />
      ) : null}

      {membershipsPending ? (
        <LoadingPanel label="Loading organisation memberships" />
      ) : null}

      {query.isError ? (
        forbidden ? (
          <StatusPanel
            state="blocked"
            title="Direct organisation membership required"
            description="The server did not allow access to this membership list. Partner access and emergency access cannot manage organisation memberships."
          />
        ) : (
          <DataErrorPanel
            title="Membership records could not be loaded"
            description="Missing records do not mean nobody has access. Check your connection, selected organisation and permissions, then try again."
            onRetry={() => void query.refetch()}
          />
        )
      ) : null}

      {query.isSuccess ? (
        <AddMembershipForm
          organisationId={organisation.id}
          allowedRoles={allowedRoles}
          online={online}
        />
      ) : null}

      {query.isSuccess ? (
        <section
          aria-labelledby="membership-register-heading"
          className="space-y-4"
        >
          <div>
            <h2
              id="membership-register-heading"
              className="text-lg font-semibold"
            >
              Members and access
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Roles are shown exactly as returned. A role that has not been
              revoked may still be scheduled or expired. The server checks
              effective permission for every request.
            </p>
          </div>
          {memberships.length === 0 ? (
            <StatusPanel
              state="empty"
              title="No membership records returned"
              description="The selected organisation returned no membership records. Do not grant access until someone reviews this unexpected result."
            />
          ) : (
            <div className="grid gap-4 xl:grid-cols-2">
              {memberships.map((membership) => (
                <MembershipCard
                  key={membership.id}
                  membership={membership}
                  memberships={memberships}
                  organisationId={organisation.id}
                  currentUserId={meQuery.data?.id}
                  online={online}
                />
              ))}
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
