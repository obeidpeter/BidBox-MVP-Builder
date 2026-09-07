import type {
  OrganisationMembershipView,
  OrganisationRole,
} from "@workspace/api-client-react";
import type { OrganisationType } from "@/contexts/organisation-context";

export const ORGANISATION_ROLE_LABELS: Record<OrganisationRole, string> = {
  client_organisation_owner: "Client organisation owner",
  client_administrator: "Client administrator",
  bid_manager: "Bid manager",
  contributor: "Contributor",
  client_reviewer_approver: "Client reviewer / approver",
  valo_operations_administrator: "Valo operations administrator",
  restricted_platform_administrator: "Restricted platform administrator",
  consultancy_partner_administrator: "Consultancy partner administrator",
  consultancy_partner_analyst_reviewer:
    "Consultancy partner analyst / reviewer",
  read_only_auditor: "Read-only auditor",
  valo_analyst: "Valo analyst",
  valo_quality_adviser: "Valo quality adviser",
};

const CLIENT_ROLES: OrganisationRole[] = [
  "client_organisation_owner",
  "client_administrator",
  "bid_manager",
  "contributor",
  "client_reviewer_approver",
  "read_only_auditor",
];

const PARTNER_ROLES: OrganisationRole[] = [
  "consultancy_partner_administrator",
  "consultancy_partner_analyst_reviewer",
  "read_only_auditor",
];

const VALO_ROLES: OrganisationRole[] = [
  "valo_operations_administrator",
  "restricted_platform_administrator",
  "valo_analyst",
  "valo_quality_adviser",
  "read_only_auditor",
];

/**
 * Mirrors the delegation ceiling used by the API so the form never suggests
 * a grant that the current direct membership cannot make. The server remains
 * authoritative and repeats both the ceiling and organisation-type checks.
 */
export function delegableRoles(
  organisationType: OrganisationType,
  actorRoles: readonly string[],
): OrganisationRole[] {
  if (organisationType === "client") {
    if (actorRoles.includes("client_organisation_owner")) return CLIENT_ROLES;
    if (actorRoles.includes("client_administrator")) {
      return CLIENT_ROLES.filter(
        (role) => role !== "client_organisation_owner",
      );
    }
    return [];
  }

  if (organisationType === "consultancy_partner") {
    return actorRoles.includes("consultancy_partner_administrator")
      ? PARTNER_ROLES
      : [];
  }

  if (actorRoles.includes("restricted_platform_administrator")) {
    return VALO_ROLES;
  }
  if (actorRoles.includes("valo_operations_administrator")) {
    return VALO_ROLES.filter(
      (role) => role !== "restricted_platform_administrator",
    );
  }
  return [];
}

const ADMINISTRATIVE_ROLES = new Set<OrganisationRole>([
  "client_organisation_owner",
  "client_administrator",
  "consultancy_partner_administrator",
  "valo_operations_administrator",
  "restricted_platform_administrator",
]);

function grantIsCurrent(
  grant: OrganisationMembershipView["roles"][number],
  now: number,
): boolean {
  const startsAt = grant.startsAt ? new Date(grant.startsAt).getTime() : null;
  const expiresAt = grant.expiresAt
    ? new Date(grant.expiresAt).getTime()
    : null;
  return (
    (startsAt === null || (!Number.isNaN(startsAt) && startsAt <= now)) &&
    (expiresAt === null || (!Number.isNaN(expiresAt) && expiresAt > now))
  );
}

export function membershipHasCurrentAdministration(
  membership: OrganisationMembershipView,
  now = Date.now(),
): boolean {
  if (membership.status !== "active") return false;
  if (
    membership.accessStartsAt &&
    new Date(membership.accessStartsAt).getTime() > now
  ) {
    return false;
  }
  if (
    membership.accessExpiresAt &&
    new Date(membership.accessExpiresAt).getTime() <= now
  ) {
    return false;
  }
  return membership.roles.some(
    (grant) =>
      ADMINISTRATIVE_ROLES.has(grant.role) && grantIsCurrent(grant, now),
  );
}

export function isLastActiveAdministrator(
  membership: OrganisationMembershipView,
  memberships: readonly OrganisationMembershipView[],
  now = Date.now(),
): boolean {
  return (
    membershipHasCurrentAdministration(membership, now) &&
    memberships.filter((candidate) =>
      membershipHasCurrentAdministration(candidate, now),
    ).length === 1
  );
}
