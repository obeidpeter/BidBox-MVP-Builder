import { Building2, Clock3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StateBadge, StatusPanel } from "@/components/platform-states";
import { useOrganisationAccess } from "@/contexts/organisation-context";
import { useLocation } from "wouter";
import {
  platformFeatureFlags,
  platformHomeForRole,
  platformRoleLabel,
} from "@/lib/platform-access";
import { useOnlineStatus } from "@/hooks/use-online-status";

function typeLabel(type: "client" | "valo" | "consultancy_partner"): string {
  if (type === "consultancy_partner") return "Consultancy partner";
  return type === "valo" ? "Valo operations" : "Client organisation";
}

export function OrganisationSelectionGate() {
  const access = useOrganisationAccess();
  const [, navigate] = useLocation();
  if (!access) return null;
  const switchBlocked = access.hasPendingMutation || access.hasCriticalWorkflow;

  const chooseOrganisation = async (organisationId: string) => {
    const selected = access.organisations.find(
      (organisation) => organisation.id === organisationId,
    );
    if (!selected) return;
    const switched = await access.selectOrganisation(organisationId);
    if (switched)
      navigate(
        platformHomeForRole(
          selected.roles,
          platformFeatureFlags(),
          selected.permissions,
        ),
      );
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-5">
      <div className="w-full max-w-3xl space-y-5">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
            Choose where to work
          </p>
          <h1 className="mt-2 font-serif text-3xl font-semibold tracking-tight">
            Select an organisation
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            You can access more than one organisation. Choose one to continue.
            The server checks your membership and permissions for every request.
          </p>
        </div>

        {switchBlocked ? (
          <StatusPanel
            state="blocked"
            title="Organisation switching is temporarily unavailable"
            description="Finish or cancel the current change before switching organisations."
          />
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          {access.organisations.map((organisation) => (
            <button
              key={organisation.id}
              type="button"
              className="rounded-lg border border-border bg-card p-5 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
              disabled={access.isSwitching || switchBlocked}
              onClick={() => void chooseOrganisation(organisation.id)}
            >
              <span className="flex items-start justify-between gap-3">
                <span className="flex min-w-0 items-center gap-3">
                  <span className="rounded-md bg-muted p-2">
                    <Building2 aria-hidden="true" className="size-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">
                      {organisation.name}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {typeLabel(organisation.type)}
                    </span>
                  </span>
                </span>
                <StateBadge
                  state="active"
                  label={
                    organisation.accessSource === "partner"
                      ? "Partner access"
                      : "Direct member"
                  }
                />
              </span>
              <span className="mt-4 block text-xs leading-5 text-muted-foreground">
                {organisation.roles.length > 0
                  ? organisation.roles.map(platformRoleLabel).join(", ")
                  : "No active role"}
              </span>
              {organisation.accessExpiresAt ? (
                <span className="mt-2 flex items-center gap-1.5 text-xs text-amber-800">
                  <Clock3 aria-hidden="true" className="size-3.5" />
                  Access expires{" "}
                  {new Date(organisation.accessExpiresAt).toLocaleString(
                    "en-NG",
                  )}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function OrganisationSwitcher() {
  const access = useOrganisationAccess();
  const [, navigate] = useLocation();
  if (!access?.activeOrganisation || access.organisations.length < 2)
    return null;
  const switchBlocked = access.hasPendingMutation || access.hasCriticalWorkflow;

  const switchOrganisation = async (organisationId: string) => {
    const selected = access.organisations.find(
      (organisation) => organisation.id === organisationId,
    );
    if (!selected) return;
    const switched = await access.selectOrganisation(organisationId);
    if (switched)
      navigate(
        platformHomeForRole(
          selected.roles,
          platformFeatureFlags(),
          selected.permissions,
        ),
      );
  };

  return (
    <div className="min-w-0">
      <label htmlFor="active-organisation" className="sr-only">
        Active organisation
      </label>
      <select
        id="active-organisation"
        className="h-9 max-w-56 rounded-md border border-border bg-background px-3 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        value={access.activeOrganisation.id}
        disabled={access.isSwitching || switchBlocked}
        aria-describedby={
          switchBlocked ? "organisation-switch-blocked" : undefined
        }
        onChange={(event) => void switchOrganisation(event.target.value)}
      >
        {access.organisations.map((organisation) => (
          <option key={organisation.id} value={organisation.id}>
            {organisation.name}
            {organisation.accessSource === "partner" ? " (partner access)" : ""}
          </option>
        ))}
      </select>
      {switchBlocked ? (
        <span id="organisation-switch-blocked" className="sr-only">
          Organisation switching is unavailable while a change or sensitive task
          is in progress.
        </span>
      ) : null}
    </div>
  );
}

export function OrganisationLoadError() {
  const access = useOrganisationAccess();
  const online = useOnlineStatus();
  if (!access) return null;
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-5">
      <div className="w-full max-w-lg">
        <StatusPanel
          state={online ? "error" : "offline"}
          title={
            online
              ? "We couldn't load your organisations"
              : "Organisation access is unavailable while offline"
          }
          description="We could not verify your membership. Organisation data and actions stay locked until access is restored."
        >
          <Button type="button" variant="outline" onClick={access.refetch}>
            Try again
          </Button>
        </StatusPanel>
      </div>
    </div>
  );
}
