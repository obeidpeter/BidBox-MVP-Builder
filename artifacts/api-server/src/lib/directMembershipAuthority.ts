import { and, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import {
  db,
  organisationMemberships,
  organisations,
  roleGrants,
  users,
} from "@workspace/db";
import type { AccessContext } from "../middlewares/tenancy";
import { parseInstantViaString } from "./dbClock";
import {
  ORGANISATION_ROLES,
  isOrganisationRole,
  isRoleAllowedForOrganisation,
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
  await db.execute(sql`
    SELECT pg_advisory_xact_lock(
      hashtextextended(
        ${`bidbox.membership-administration:${context.organisationId}`},
        0
      )
    )
  `);
  const nowResult = requestedNow
    ? { rows: [{ now: requestedNow }] }
    : await db.execute(sql`SELECT clock_timestamp() AS now`);
  const now = parseInstantViaString(nowResult.rows[0]?.now);
  if (now === null) return null;

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
        eq(organisationMemberships.id, context.membershipId),
        eq(organisationMemberships.organisationId, context.organisationId),
        eq(organisationMemberships.userId, actorUserId),
        eq(organisationMemberships.status, "active"),
        isNull(organisationMemberships.delegatedByMembershipId),
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
    organisationId: context.organisationId,
    actorUserId,
    membershipId: membership.membershipId,
    roles,
    permissions: permissionsForRoles(roles),
  };
}
