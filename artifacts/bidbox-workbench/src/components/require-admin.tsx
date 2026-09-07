import { useGetMe } from "@workspace/api-client-react";
import {
  getPlatformAccessDecision,
  platformFeatureFlags,
} from "@/lib/platform-access";
import { LoadingPanel, StatusPanel } from "@/components/platform-states";
import { useOrganisationAccess } from "@/contexts/organisation-context";

export default function RequireAdmin({
  children,
}: {
  children: React.ReactNode;
}) {
  const { data: user, isLoading, isPending, isError } = useGetMe();
  const organisationAccess = useOrganisationAccess();

  if (isLoading || isPending || organisationAccess?.isLoading) {
    return (
      <div className="p-6 sm:p-8">
        <LoadingPanel label="Checking admin access" />
      </div>
    );
  }

  if (isError || !user || organisationAccess?.isError) {
    return (
      <div className="p-6 sm:p-8">
        <StatusPanel
          state="error"
          title="We couldn't verify admin access"
          description="We must verify both your account and your organisation role before opening settings."
        />
      </div>
    );
  }

  const decision = getPlatformAccessDecision(
    organisationAccess?.activeOrganisation
      ? organisationAccess.effectiveRoles
      : undefined,
    "settings",
    platformFeatureFlags(),
    organisationAccess?.activeOrganisation
      ? organisationAccess.effectivePermissions
      : [],
  );

  if (!decision.allowed) {
    return (
      <div className="p-6 sm:p-8">
        <StatusPanel
          state="blocked"
          title="Access denied"
          description="Only Valo operations administrators can open these settings. If you think this is wrong, contact Valo support."
        />
      </div>
    );
  }

  return <>{children}</>;
}
