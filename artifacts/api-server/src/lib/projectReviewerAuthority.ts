import { lockCompatibleAdvisoryKey } from "./compatibleAdvisoryLock";
import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
import {
  db,
  organisationMemberships,
  organisations,
  roleGrants,
  users,
} from "@workspace/db";
import {
  ORGANISATION_ROLES,
  hasPermission,
  isOrganisationRole,
  isOrganisationType,
  isRoleAllowedForOrganisation,
  type OrganisationRole,
} from "./permissions";
import { parseInstantPreserving } from "./dbClock";
import { validProjectReviewerName } from "./projectReviewerNamePolicy";

type ReviewerAuthorityTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];
type ReviewerAuthorityDatabase = typeof db | ReviewerAuthorityTransaction;

export interface CurrentProjectMembershipAuthority {
  membershipId: string;
  userId: string;
  roles: OrganisationRole[];
}

export const PROJECT_REVIEWER_ROLES = ORGANISATION_ROLES.filter((role) =>
  hasPermission([role], "draft:review"),
);

/**
 * Membership writers take this same organisation-scoped advisory lock. It
 * serialises grant changes while row locks keep the selected identity and
 * direct memberships stable until the surrounding project transaction
 * commits. The runtime role intentionally has no UPDATE privilege on grants
 * or organisations, so those authority rows must not use a locking SELECT.
 */
export async function lockProjectReviewerAuthorityBoundary(
  tx: ReviewerAuthorityTransaction,
  organisationId: string,
  reviewerUserId: string,
): Promise<void> {
  await tx.execute(sql`SET LOCAL lock_timeout = '3s'`);
  await lockCompatibleAdvisoryKey(
    tx,
    `valo.membership-administration:${organisationId}`,
  );
  await tx.execute(sql`
    SELECT id FROM public.organisation_memberships
    WHERE organisation_id = ${organisationId}::uuid
    ORDER BY id FOR UPDATE
  `);
  await tx.execute(sql`
    SELECT grant_row.id
    FROM public.role_grants AS grant_row
    INNER JOIN public.organisation_memberships AS membership_row
      ON membership_row.id = grant_row.membership_id
    WHERE membership_row.organisation_id = ${organisationId}::uuid
    ORDER BY grant_row.id
  `);
  await tx.execute(sql`
    SELECT id FROM public.organisations
    WHERE id = ${organisationId}::uuid
  `);
  await tx.execute(sql`
    SELECT id FROM public.users
    WHERE id = ${reviewerUserId}::uuid
    FOR SHARE
  `);
}

export async function currentProjectReviewerAuthorityTime(
  database: ReviewerAuthorityDatabase = db,
): Promise<Date> {
  const rows = await database.execute(
    sql`SELECT pg_catalog.clock_timestamp() AS "now"`,
  );
  const parsed = parseInstantPreserving(rows.rows[0]?.now);
  if (parsed === null) {
    throw new Error("Current database time could not be verified");
  }
  return parsed;
}

/**
 * Resolve only current, direct organisation authority. This is deliberately
 * narrower than relationship-projected request authority: a named project
 * reviewer must be a current person in the project-owning organisation.
 */
export async function loadCurrentProjectMembershipAuthorities(
  database: ReviewerAuthorityDatabase,
  organisationId: string,
  now: Date,
  reviewerUserId?: string,
): Promise<CurrentProjectMembershipAuthority[]> {
  const memberships = await database
    .select({
      membershipId: organisationMemberships.id,
      userId: organisationMemberships.userId,
      userName: users.name,
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
        eq(organisationMemberships.organisationId, organisationId),
        reviewerUserId
          ? eq(organisationMemberships.userId, reviewerUserId)
          : undefined,
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
        isNotNull(users.name),
        eq(organisations.status, "active"),
      ),
    )
    .orderBy(asc(organisationMemberships.id));
  if (memberships.length === 0) return [];

  const grants = await database
    .select({
      membershipId: roleGrants.membershipId,
      role: roleGrants.role,
    })
    .from(roleGrants)
    .where(
      and(
        inArray(
          roleGrants.membershipId,
          memberships.map(({ membershipId }) => membershipId),
        ),
        isNull(roleGrants.revokedAt),
        or(isNull(roleGrants.startsAt), lte(roleGrants.startsAt, now)),
        or(isNull(roleGrants.expiresAt), gt(roleGrants.expiresAt, now)),
      ),
    )
    .limit(memberships.length * ORGANISATION_ROLES.length + 1);
  // More live grants than canonical roles indicates duplicate/corrupt
  // authority state. It cannot establish reviewer eligibility.
  if (grants.length > memberships.length * ORGANISATION_ROLES.length) {
    return [];
  }

  const grantsByMembership = new Map<string, Set<OrganisationRole>>();
  for (const grant of grants) {
    if (!isOrganisationRole(grant.role)) continue;
    const roles = grantsByMembership.get(grant.membershipId) ?? new Set();
    roles.add(grant.role);
    grantsByMembership.set(grant.membershipId, roles);
  }

  const seenUsers = new Set<string>();
  const authorities: CurrentProjectMembershipAuthority[] = [];
  for (const membership of memberships) {
    if (
      seenUsers.has(membership.userId) ||
      !validProjectReviewerName(membership.userName) ||
      !isOrganisationType(membership.organisationType)
    ) {
      continue;
    }
    seenUsers.add(membership.userId);
    const organisationType = membership.organisationType;
    const granted =
      grantsByMembership.get(membership.membershipId) ?? new Set();
    const roles = ORGANISATION_ROLES.filter(
      (role) =>
        granted.has(role) &&
        isRoleAllowedForOrganisation(role, organisationType),
    );
    authorities.push({
      membershipId: membership.membershipId,
      userId: membership.userId,
      roles,
    });
  }
  return authorities;
}

export function hasProjectReviewerAuthority(
  authority: CurrentProjectMembershipAuthority | undefined,
): boolean {
  return Boolean(
    authority?.roles.some((role) =>
      PROJECT_REVIEWER_ROLES.includes(
        role as (typeof PROJECT_REVIEWER_ROLES)[number],
      ),
    ),
  );
}

export async function isCurrentProjectReviewer(
  database: ReviewerAuthorityDatabase,
  organisationId: string,
  reviewerUserId: string,
  now: Date,
): Promise<boolean> {
  const authorities = await loadCurrentProjectMembershipAuthorities(
    database,
    organisationId,
    now,
    reviewerUserId,
  );
  return (
    authorities.length === 1 && hasProjectReviewerAuthority(authorities[0])
  );
}
