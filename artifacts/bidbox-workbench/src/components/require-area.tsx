import type { ReactNode } from "react";
import { useGetMe } from "@workspace/api-client-react";
import {
  getPlatformAccessDecision,
  platformFeatureFlags,
  type PlatformArea,
} from "@/lib/platform-access";
import { LoadingPanel, StatusPanel } from "@/components/platform-states";
import { useOrganisationAccess } from "@/contexts/organisation-context";

export default function RequireArea({
  area,
  children,
}: {
  area: PlatformArea;
  children: ReactNode;
}) {
  const { data: user, isLoading, isPending, error } = useGetMe();
  const organisationAccess = useOrganisationAccess();

  if (isLoading || isPending || organisationAccess?.isLoading) {
    return (
      <div className="p-6 sm:p-8">
        <LoadingPanel label="Checking your access" />
      </div>
    );
  }

  if (error || !user || organisationAccess?.isError) {
    return (
      <div className="p-6 sm:p-8">
        <StatusPanel
          state="error"
          title="We couldn't verify your access"
          description="Check your connection, then refresh. We could not match this session to a platform role."
        />
      </div>
    );
  }

  if (!organisationAccess?.activeOrganisation) {
    return (
      <div className="p-6 sm:p-8">
        <StatusPanel
          state="pending"
          title="Organisation access required"
          description="Choose an active organisation. If none is available, ask an administrator to add you. Workspace pages and actions stay locked until then."
        />
      </div>
    );
  }

  const roles = organisationAccess.effectiveRoles;
  const decision = getPlatformAccessDecision(
    roles,
    area,
    platformFeatureFlags(),
    organisationAccess.effectivePermissions,
    organisationAccess.activeOrganisation.accessSource,
  );
  if (!decision.allowed) {
    return (
      <div className="p-6 sm:p-8">
        <StatusPanel
          state="blocked"
          title="Access denied"
          description={
            decision.reason +
            " If you think this is wrong, contact an organisation administrator."
          }
        />
      </div>
    );
  }

  return <>{children}</>;
}
