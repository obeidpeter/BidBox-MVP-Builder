import { lockCompatibleAdvisoryKey } from "./compatibleAdvisoryLock";
import { and, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import {
  db,
  organisationMemberships,
  organisations,
  partnerRelationships,
  roleGrants,
  users,
} from "@workspace/db";
import type { AccessContext } from "./accessContext";
import { parseInstantViaString } from "./dbClock";
import { isTenantFeatureEnabled } from "./featureFlags";
import {
  ORGANISATION_ROLES,
  isActiveAccessWindow,
  isOrganisationRole,
  isRoleAllowedForOrganisation,
  partnerDerivedPermissionsForRoles,
  permissionsForRoles,
  type OrganisationRole,
  type OrganisationType,
  type Permission,
} from "./permissions";

export interface CurrentDirectAuthority {
  organisationId: string;
  actorUserId: string;
  membershipId: string;
  roles: readonly OrganisationRole[];
  permissions: ReadonlySet<Permission>;
}

export interface CurrentAccessAuthority extends CurrentDirectAuthority {
  membershipOrganisationId: string;
  source: "membership" | "partner";
  partnerRelationshipId: string | null;
}

interface CurrentMembershipAuthority {
  membershipId: string;
  organisationType: OrganisationType;
  roles: readonly OrganisationRole[];
  permissions: ReadonlySet<Permission>;
}

/**
 * Rechecks direct authority inside the request's tenant transaction. The
 * access context is only a selector: current membership, user, organisation
 * and role-grant state are authoritative.
 */
export async function resolveCurrentDirectAuthority(
  context: AccessContext | undefined,
  actorUserId: string | undefined,
  requestedNow?: Date,
): Promise<CurrentDirectAuthority | null> {
  if (
    !context ||
    !actorUserId ||
    context.source !== "membership" ||
    !context.membershipId ||
    context.membershipOrganisationId !== context.organisationId
  ) {
    return null;
  }

  // Membership writers use this exact transaction-scoped organisation key.
  // Taking it before reading makes this authority snapshot stable through the
  // surrounding request transaction and therefore through any mutation.
  await lockCompatibleAdvisoryKey(
    db,
    `valo.membership-administration:${context.organisationId}`,
  );
  const nowResult = requestedNow
    ? { rows: [{ now: requestedNow }] }
    : await db.execute(sql`SELECT clock_timestamp() AS now`);
  const now = parseInstantViaString(nowResult.rows[0]?.now);
  if (now === null) return null;

  const authority = await resolveMembershipAuthorityAt(
    context.membershipId,
    context.organisationId,
    actorUserId,
    now,
    true,
  );
  if (!authority) return null;

  return {
    organisationId: context.organisationId,
    actorUserId,
    membershipId: authority.membershipId,
    roles: authority.roles,
    permissions: authority.permissions,
  };
}

async function resolveMembershipAuthorityAt(
  membershipId: string,
  membershipOrganisationId: string,
  actorUserId: string,
  now: Date,
  directOnly: boolean,
): Promise<CurrentMembershipAuthority | null> {
  const rows = await db
    .select({
      membershipId: organisationMemberships.id,
      organisationType: organisations.type,
    })
    .from(organisationMemberships)
    .innerJoin(users, eq(users.id, organisationMemberships.userId))
    .innerJoin(
      organisations,
      eq(organisations.id, organisationMemberships.organisationId),
    )
    .where(
      and(
        eq(organisationMemberships.id, membershipId),
        eq(organisationMemberships.organisationId, membershipOrganisationId),
        eq(organisationMemberships.userId, actorUserId),
        eq(organisationMemberships.status, "active"),
        directOnly
          ? isNull(organisationMemberships.delegatedByMembershipId)
          : undefined,
        or(
          isNull(organisationMemberships.accessStartsAt),
          lte(organisationMemberships.accessStartsAt, now),
        ),
        or(
          isNull(organisationMemberships.accessExpiresAt),
          gt(organisationMemberships.accessExpiresAt, now),
        ),
        eq(users.status, "active"),
        eq(organisations.status, "active"),
      ),
    )
    .limit(2);
  const membership = rows[0];
  if (rows.length !== 1 || !membership) return null;

  const grants = await db
    .select({ role: roleGrants.role })
    .from(roleGrants)
    .where(
      and(
        eq(roleGrants.membershipId, membership.membershipId),
        isNull(roleGrants.revokedAt),
        or(isNull(roleGrants.startsAt), lte(roleGrants.startsAt, now)),
        or(isNull(roleGrants.expiresAt), gt(roleGrants.expiresAt, now)),
      ),
    )
    .limit(ORGANISATION_ROLES.length + 1);
  if (grants.length > ORGANISATION_ROLES.length) return null;
  const roles = grants
    .map(({ role }) => role)
    .filter(isOrganisationRole)
    .filter((role) =>
      isRoleAllowedForOrganisation(
        role,
        membership.organisationType as OrganisationType,
      ),
    );
  if (roles.length === 0) return null;

  return {
    membershipId: membership.membershipId,
    organisationType: membership.organisationType as OrganisationType,
    roles,
    permissions: permissionsForRoles(roles),
  };
}

/**
 * Rechecks the exact access source selected at request admission. Membership
 * administration serialises membership/grant changes; partner access also
 * share-locks the selected relationship before evaluating its access window.
 */
export async function resolveCurrentAccessAuthority(
  context: AccessContext | undefined,
  actorUserId: string | undefined,
  requestedNow?: Date,
): Promise<CurrentAccessAuthority | null> {
  if (
    !context ||
    !actorUserId ||
    !context.membershipId ||
    !context.membershipOrganisationId ||
    context.source === "break_glass"
  ) {
    return null;
  }

  if (
    context.source === "membership" &&
    context.membershipOrganisationId !== context.organisationId
  ) {
    return null;
  }
  if (
    context.source === "partner" &&
    (!context.partnerRelationshipId ||
      context.membershipOrganisationId === context.organisationId)
  ) {
    return null;
  }

  await lockCompatibleAdvisoryKey(
    db,
    `valo.membership-administration:${context.membershipOrganisationId}`,
  );

  const relationshipRows =
    context.source === "partner"
      ? await db
          .select({
            id: partnerRelationships.id,
            status: partnerRelationships.status,
            accessStartsAt: partnerRelationships.accessStartsAt,
            accessExpiresAt: partnerRelationships.accessExpiresAt,
            clientStatus: organisations.status,
            clientType: organisations.type,
          })
          .from(partnerRelationships)
          .innerJoin(
            organisations,
            eq(partnerRelationships.clientOrganisationId, organisations.id),
          )
          .where(
            and(
              eq(partnerRelationships.id, context.partnerRelationshipId!),
              eq(
                partnerRelationships.partnerOrganisationId,
                context.membershipOrganisationId,
              ),
              eq(
                partnerRelationships.clientOrganisationId,
                context.organisationId,
              ),
            ),
          )
          .limit(2)
          .for("share")
      : [];
  const relationship = relationshipRows[0];
  if (context.source === "partner" && relationshipRows.length !== 1) {
    return null;
  }

  // Evaluate naturally expiring membership, grants and relationship against
  // one database clock after all access-source locks have been acquired.
  const nowResult = requestedNow
    ? { rows: [{ now: requestedNow }] }
    : await db.execute(sql`SELECT clock_timestamp() AS now`);
  const now = parseInstantViaString(nowResult.rows[0]?.now);
  if (now === null) return null;

  if (
    relationship &&
    (relationship.clientStatus !== "active" ||
      relationship.clientType !== "client" ||
      !isActiveAccessWindow(
        {
          status: relationship.status,
          startsAt: relationship.accessStartsAt,
          expiresAt: relationship.accessExpiresAt,
        },
        now,
      ))
  ) {
    return null;
  }

  const membership = await resolveMembershipAuthorityAt(
    context.membershipId,
    context.membershipOrganisationId,
    actorUserId,
    now,
    false,
  );
  if (!membership) return null;

  if (context.source === "partner") {
    if (
      membership.organisationType !== "consultancy_partner" ||
      !(await isTenantFeatureEnabled(context.organisationId, "partner_edition"))
    ) {
      return null;
    }
    return {
      organisationId: context.organisationId,
      membershipOrganisationId: context.membershipOrganisationId,
      actorUserId,
      membershipId: membership.membershipId,
      source: "partner",
      partnerRelationshipId: relationship!.id,
      roles: membership.roles,
      permissions: partnerDerivedPermissionsForRoles(membership.roles),
    };
  }

  return {
    organisationId: context.organisationId,
    membershipOrganisationId: context.membershipOrganisationId,
    actorUserId,
    membershipId: membership.membershipId,
    source: "membership",
    partnerRelationshipId: null,
    roles: membership.roles,
    permissions: membership.permissions,
  };
}

export async function hasCurrentAccessPermission(
  context: AccessContext | undefined,
  actorUserId: string | undefined,
  permission: Permission,
): Promise<boolean> {
  const authority = await resolveCurrentAccessAuthority(context, actorUserId);
  return authority?.permissions.has(permission) ?? false;
}
