import type { AccessContext } from "../accessContext";

const LEAD_OPERATOR_ROLES = new Set([
  "valo_operations_administrator",
  "valo_analyst",
]);

function isDirectMembership(context: AccessContext | undefined): boolean {
  return Boolean(
    context &&
    context.source === "membership" &&
    context.membershipId &&
    context.membershipOrganisationId === context.organisationId,
  );
}

export function canViewGrowthOnboarding(
  context: AccessContext | undefined,
): boolean {
  return Boolean(
    isDirectMembership(context) &&
    context?.permissions.has("organisation:read") &&
    context.roles.length > 0,
  );
}

export function canOperateGrowthLeads(
  context: AccessContext | undefined,
): boolean {
  return Boolean(
    isDirectMembership(context) &&
    context?.permissions.has("client:update") &&
    context.roles.some((role) => LEAD_OPERATOR_ROLES.has(role)),
  );
}

export function canManageCommercialOffers(
  context: AccessContext | undefined,
): boolean {
  return Boolean(
    isDirectMembership(context) &&
    context?.permissions.has("order:create") &&
    context.roles.includes("valo_operations_administrator"),
  );
}
