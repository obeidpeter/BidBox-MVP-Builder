import { useGetMe } from "@workspace/api-client-react";
import { Redirect } from "wouter";
import Dashboard from "@/pages/dashboard";
import { LoadingPanel, StatusPanel } from "@/components/platform-states";
import {
  isInternalRole,
  platformFeatureFlags,
  platformHomeForRole,
} from "@/lib/platform-access";
import { useOrganisationAccess } from "@/contexts/organisation-context";

export default function RoleHome() {
  const { data: user, isLoading, isPending, error } = useGetMe();
  const organisationAccess = useOrganisationAccess();

  if (isLoading || isPending || organisationAccess?.isLoading) {
    return (
      <div className="p-6 sm:p-8">
        <LoadingPanel label="Opening your workspace" />
      </div>
    );
  }

  if (error || !user || organisationAccess?.isError) {
    return (
      <div className="p-6 sm:p-8">
        <StatusPanel
          state="error"
          title="We couldn't open your workspace"
          description="We could not confirm your role for this session. Refresh and try again."
        />
      </div>
    );
  }

  if (!organisationAccess?.activeOrganisation) {
    return (
      <div className="p-6 sm:p-8">
        <StatusPanel
          state="pending"
          title="No organisation selected"
          description="Choose an active organisation. If none is available, ask an administrator for access. Older account roles do not give access to organisation data."
        />
      </div>
    );
  }

  const roles = organisationAccess.effectiveRoles;
  const home = platformHomeForRole(
    roles,
    platformFeatureFlags(),
    organisationAccess.effectivePermissions,
  );
  if (home !== "/app") return <Redirect to={home} />;
  if (isInternalRole(roles)) return <Dashboard />;

  return (
    <div className="p-6 sm:p-8">
      <StatusPanel
        state="blocked"
        title="No workspace available"
        description="Your account does not have an active role for this organisation."
      />
    </div>
  );
}
