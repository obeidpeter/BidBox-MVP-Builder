import { lockCompatibleAdvisoryKey } from "../lib/compatibleAdvisoryLock";
import {
  Router,
  type IRouter,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  organisationMemberships,
  organisations,
  partnerRelationships,
  roleGrants,
  users,
  withTenantDatabase,
} from "@workspace/db";
import { getLocalUser } from "../middlewares/auth";
import {
  attachTenantContext,
  getAccessContext,
  requirePermission,
  parseExpectedVersion,
} from "../middlewares/tenancy";
import {
  hasPermission,
  isActiveAccessWindow,
  isOrganisationRole,
  isOrganisationType,
  isRoleAllowedForOrganisation,
  partnerDerivedPermissionsForRoles,
  permissionsForRoles,
  type OrganisationRole,
  type OrganisationType,
} from "../lib/permissions";
import { isTenantFeatureEnabled } from "../lib/featureFlags";
import {
  evaluateMembershipGrantAuthority,
  evaluateMembershipLifecycleAuthority,
  type MembershipAuthorityDenial,
} from "../lib/membershipLifecyclePolicy";
import { writeAuditTx } from "../lib/audit";
import { discoverableOrganisationRoleAccess } from "../lib/organisationDiscovery";
import {
  isBootstrapIdentity,
  parseBootstrapOrganisationConfig,
  shouldAutoProvisionBootstrapOrganisation,
} from "../lib/bootstrap";

const router: IRouter = Router();

type OrganisationTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

/**
 * Every membership writer takes the same transaction-scoped organisation
 * lock before reading authority or counting administrators. Membership row
 * locks keep existing access stable, while the advisory lock serialises grant
 * changes and concurrent inserts that have no row to lock yet. Role grants are
 * read without a row-lock clause because the constrained runtime deliberately
 * has no UPDATE privilege on them. The surrounding tenant transaction is
 * intentionally read committed because the audit hash chain requires that
 * isolation level after waiting for its own advisory lock.
 */
async function lockOrganisationMembershipAdministration(
  tx: OrganisationTransaction,
  organisationId: string,
): Promise<void> {
  await tx.execute(sql`SET LOCAL lock_timeout = '3s'`);
  await lockCompatibleAdvisoryKey(
    tx,
    `valo.membership-administration:${organisationId}`,
  );
  await tx.execute(sql`
    SELECT id
    FROM public.organisation_memberships
    WHERE organisation_id = ${organisationId}::uuid
    ORDER BY id
    FOR UPDATE
  `);
  await tx.execute(sql`
    SELECT grant_row.id
    FROM public.role_grants AS grant_row
    INNER JOIN public.organisation_memberships AS membership_row
      ON membership_row.id = grant_row.membership_id
    WHERE membership_row.organisation_id = ${organisationId}::uuid
    ORDER BY grant_row.id
  `);
}

function membershipDenialResponse(denial: MembershipAuthorityDenial): {
  status: 403 | 409;
  error: string;
} {
  if (denial === "actor_authority_changed") {
    return {
      status: 409,
      error: "Membership authority changed; reload before updating",
    };
  }
  if (denial === "last_active_administrator") {
    return {
      status: 409,
      error: "Another active administrator is required before this change",
    };
  }
  if (denial === "last_active_owner") {
    return {
      status: 409,
      error: "Another active organisation owner is required before this change",
    };
  }
  if (denial === "unsafe_self_grant") {
    return {
      status: 403,
      error: "Self-service role grants are not permitted",
    };
  }
  if (denial === "unsafe_self_lifecycle_change") {
    return {
      status: 403,
      error: "Use another authorised administrator for your own access changes",
    };
  }
  return { status: 403, error: "Membership management authority denied" };
}

function roleGrantCanStillTakeEffect(
  grant: typeof roleGrants.$inferSelect,
  now: Date,
): boolean {
  return (
    !grant.revokedAt &&
    (!grant.expiresAt || grant.expiresAt.getTime() > now.getTime())
  );
}

function nullableInstantsEqual(left: Date | null, right: Date | null): boolean {
  if (left === null || right === null) return left === right;
  return left.getTime() === right.getTime();
}

function requirePlatformBootstrap(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const user = getLocalUser(req);
  if (!user || user.role !== "restricted_platform_administrator") {
    res
      .status(403)
      .json({ error: "Restricted platform administrator required" });
    return;
  }
  next();
}

function requireSelectedOrganisation(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const context = getAccessContext(req);
  if (
    !context ||
    context.organisationId !== String(req.params.organisationId)
  ) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  next();
}

function optionalFutureDate(value: unknown): Date | null | "invalid" {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return "invalid";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) || date.getTime() <= Date.now()
    ? "invalid"
    : date;
}

function defaultOwnerRole(type: OrganisationType): OrganisationRole {
  if (type === "client") return "client_organisation_owner";
  if (type === "consultancy_partner")
    return "consultancy_partner_administrator";
  return "restricted_platform_administrator";
}

function earliestAccessExpiry(
  ...values: readonly (Date | null)[]
): string | null {
  const expiries = values.filter((value): value is Date => value !== null);
  if (expiries.length === 0) return null;
  return new Date(
    Math.min(...expiries.map((value) => value.getTime())),
  ).toISOString();
}

async function maybeProvisionConfiguredBootstrapOrganisation(
  req: Request,
  membershipCount: number,
): Promise<void> {
  const user = getLocalUser(req);
  if (!user || membershipCount !== 0) return;
  const config = parseBootstrapOrganisationConfig({
    enabled: process.env.VALO_BOOTSTRAP_ORGANISATION_ENABLED,
    name: process.env.VALO_BOOTSTRAP_ORGANISATION_NAME,
    slug: process.env.VALO_BOOTSTRAP_ORGANISATION_SLUG,
  });
  if (!config) return;
  const [{ count: organisationCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(organisations);
  const identityAllowlisted = isBootstrapIdentity(
    { clerkUserId: user.clerkUserId, email: user.email },
    {
      clerkUserIds: process.env.VALO_BOOTSTRAP_CLERK_USER_IDS,
      emails: process.env.VALO_BOOTSTRAP_EMAILS,
    },
  );
  if (
    !shouldAutoProvisionBootstrapOrganisation({
      config,
      identityAllowlisted,
      userRole: user.role,
      membershipCount,
      organisationCount,
    })
  ) {
    return;
  }

  const organisationId = randomUUID();
  await withTenantDatabase(organisationId, () =>
    db.transaction(
      async (tx) => {
        const [organisation] = await tx
          .insert(organisations)
          .values({
            id: organisationId,
            name: config.name,
            slug: config.slug,
            type: "valo",
            createdBy: user.id,
          })
          .returning();
        const [membership] = await tx
          .insert(organisationMemberships)
          .values({ organisationId, userId: user.id })
          .returning();
        await tx.insert(roleGrants).values({
          membershipId: membership.id,
          // The identity row keeps the platform-only bootstrap role. The
          // tenant grant is operational (not quality/sign-off authority) so
          // the first explicitly allowlisted operator can actually initialise
          // the workbench without a direct database edit.
          role: "valo_operations_administrator",
        });
        await writeAuditTx(tx, {
          user,
          organisationId,
          eventType: "organisation.bootstrap_provisioned",
          objectType: "organisation",
          objectId: organisation.id,
          details: JSON.stringify({
            name: config.name,
            slug: config.slug,
            type: "valo",
            tenantRole: "valo_operations_administrator",
            source: "explicit_environment_configuration",
          }),
        });
      },
      { isolationLevel: "serializable" },
    ),
  );
}

router.get("/organisations", async (req: Request, res: Response) => {
  const user = getLocalUser(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const now = new Date();
  let rows = await db
    .select({
      membership: organisationMemberships,
      organisation: organisations,
    })
    .from(organisationMemberships)
    .innerJoin(
      organisations,
      eq(organisationMemberships.organisationId, organisations.id),
    )
    .where(eq(organisationMemberships.userId, user.id));
  if (rows.length === 0) {
    try {
      await maybeProvisionConfiguredBootstrapOrganisation(req, rows.length);
      rows = await db
        .select({
          membership: organisationMemberships,
          organisation: organisations,
        })
        .from(organisationMemberships)
        .innerJoin(
          organisations,
          eq(organisationMemberships.organisationId, organisations.id),
        )
        .where(eq(organisationMemberships.userId, user.id));
    } catch (error) {
      if ((error as { code?: string }).code !== "23505") throw error;
      req.log.warn(
        { err: error },
        "bootstrap organisation was created by a concurrent request",
      );
      rows = await db
        .select({
          membership: organisationMemberships,
          organisation: organisations,
        })
        .from(organisationMemberships)
        .innerJoin(
          organisations,
          eq(organisationMemberships.organisationId, organisations.id),
        )
        .where(eq(organisationMemberships.userId, user.id));
    }
  }
  const active = rows
    .filter(
      ({ membership, organisation }) =>
        organisation.status === "active" &&
        isActiveAccessWindow(
          {
            status: membership.status,
            startsAt: membership.accessStartsAt,
            expiresAt: membership.accessExpiresAt,
          },
          now,
        ),
    )
    .sort((left, right) =>
      left.membership.id.localeCompare(right.membership.id),
    );
  const membershipIds = active.map(({ membership }) => membership.id);
  const grants =
    membershipIds.length === 0
      ? []
      : await db
          .select()
          .from(roleGrants)
          .where(inArray(roleGrants.membershipId, membershipIds));
  const directAccess: Array<{
    id: string;
    name: string;
    slug: string;
    type: string;
    status: string;
    countryCode: string;
    membershipId: string;
    membershipOrganisationId: string;
    accessSource: "membership" | "partner";
    partnerRelationshipId: string | null;
    accessExpiresAt: string | null;
    roles: OrganisationRole[];
    permissions: string[];
    version: number;
  }> = active.flatMap(({ membership, organisation }) => {
    const roleAccess = discoverableOrganisationRoleAccess(
      membership.id,
      organisation.type as OrganisationType,
      grants,
      now,
    );
    if (!roleAccess) return [];
    const { roles, roleAccessExpiresAt } = roleAccess;
    return [
      {
        id: organisation.id,
        name: organisation.name,
        slug: organisation.slug,
        type: organisation.type,
        status: organisation.status,
        countryCode: organisation.countryCode,
        membershipId: membership.id,
        membershipOrganisationId: organisation.id,
        accessSource: "membership" as const,
        partnerRelationshipId: null,
        accessExpiresAt: earliestAccessExpiry(
          membership.accessExpiresAt,
          roleAccessExpiresAt,
        ),
        roles,
        permissions: [...permissionsForRoles(roles)],
        version: organisation.version,
      },
    ];
  });

  const partnerSources = active.flatMap(({ membership, organisation }) => {
    if (organisation.type !== "consultancy_partner") return [];
    const roleAccess = discoverableOrganisationRoleAccess(
      membership.id,
      "consultancy_partner",
      grants,
      now,
    );
    if (!roleAccess) return [];
    const { roles, roleAccessExpiresAt } = roleAccess;
    const sourceAccessExpiresAt = [
      membership.accessExpiresAt,
      roleAccessExpiresAt,
    ].reduce<Date | null>((earliest, value) => {
      if (!value) return earliest;
      return !earliest || value.getTime() < earliest.getTime()
        ? value
        : earliest;
    }, null);
    return [
      {
        membership,
        organisation,
        roles,
        sourceAccessExpiresAt,
      },
    ];
  });
  const projectedAccess: typeof directAccess = [];
  if (partnerSources.length > 0) {
    const relationships = await db
      .select({ relationship: partnerRelationships, client: organisations })
      .from(partnerRelationships)
      .innerJoin(
        organisations,
        eq(partnerRelationships.clientOrganisationId, organisations.id),
      )
      .where(
        inArray(
          partnerRelationships.partnerOrganisationId,
          partnerSources.map((source) => source.organisation.id),
        ),
      );
    const exposedOrganisationIds = new Set(
      directAccess.map((access) => access.id),
    );
    for (const { relationship, client } of relationships.sort((left, right) =>
      left.relationship.id.localeCompare(right.relationship.id),
    )) {
      if (
        exposedOrganisationIds.has(client.id) ||
        client.status !== "active" ||
        !isActiveAccessWindow(
          {
            status: relationship.status,
            startsAt: relationship.accessStartsAt,
            expiresAt: relationship.accessExpiresAt,
          },
          now,
        ) ||
        !(await isTenantFeatureEnabled(client.id, "partner_edition"))
      ) {
        continue;
      }
      const source = partnerSources.find(
        (candidate) =>
          candidate.organisation.id === relationship.partnerOrganisationId,
      );
      if (!source) continue;
      const permissions = partnerDerivedPermissionsForRoles(source.roles);
      if (permissions.size === 0) continue;
      projectedAccess.push({
        id: client.id,
        name: client.name,
        slug: client.slug,
        type: client.type,
        status: client.status,
        countryCode: client.countryCode,
        membershipId: source.membership.id,
        membershipOrganisationId: source.organisation.id,
        accessSource: "partner",
        partnerRelationshipId: relationship.id,
        accessExpiresAt: earliestAccessExpiry(
          source.sourceAccessExpiresAt,
          relationship.accessExpiresAt,
        ),
        roles: source.roles,
        permissions: [...permissions],
        version: client.version,
      });
      exposedOrganisationIds.add(client.id);
    }
  }

  res.json([...directAccess, ...projectedAccess]);
});

router.post(
  "/organisations",
  requirePlatformBootstrap,
  async (req: Request, res: Response) => {
    const user = getLocalUser(req)!;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const slug =
      typeof body.slug === "string" ? body.slug.trim().toLowerCase() : "";
    const type = body.type;
    if (
      name.length < 2 ||
      name.length > 160 ||
      !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(slug) ||
      typeof type !== "string" ||
      !isOrganisationType(type)
    ) {
      res.status(400).json({ error: "Invalid organisation" });
      return;
    }
    try {
      const organisationId = randomUUID();
      const created = await withTenantDatabase(organisationId, () =>
        db.transaction(
          async (tx) => {
            const [organisation] = await tx
              .insert(organisations)
              .values({
                id: organisationId,
                name,
                slug,
                type,
                createdBy: user.id,
              })
              .returning();
            const [membership] = await tx
              .insert(organisationMemberships)
              .values({ organisationId: organisation.id, userId: user.id })
              .returning();
            await tx.insert(roleGrants).values({
              membershipId: membership.id,
              role: defaultOwnerRole(type),
            });
            await writeAuditTx(tx, {
              user,
              organisationId: organisation.id,
              eventType: "organisation.created",
              objectType: "organisation",
              objectId: organisation.id,
              details: JSON.stringify({ name, slug, type }),
            });
            return { organisation, membership };
          },
          { isolationLevel: "read committed" },
        ),
      );
      res.status(201).json({
        ...created.organisation,
        membershipId: created.membership.id,
      });
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        res.status(409).json({ error: "Organisation slug already exists" });
        return;
      }
      throw error;
    }
  },
);

router.get(
  "/organisations/:organisationId/memberships",
  attachTenantContext,
  requireSelectedOrganisation,
  requirePermission("membership:read"),
  async (req: Request, res: Response) => {
    const organisationId = String(req.params.organisationId);
    const { rows, grants } = await withTenantDatabase(
      organisationId,
      async () => {
        const rows = await db
          .select({ membership: organisationMemberships, user: users })
          .from(organisationMemberships)
          .innerJoin(users, eq(organisationMemberships.userId, users.id))
          .where(eq(organisationMemberships.organisationId, organisationId));
        const ids = rows.map(({ membership }) => membership.id);
        const grants = ids.length
          ? await db
              .select()
              .from(roleGrants)
              .where(inArray(roleGrants.membershipId, ids))
          : [];
        return { rows, grants };
      },
    );
    res.json(
      rows.map(({ membership, user }) => ({
        id: membership.id,
        user: { id: user.id, email: user.email, name: user.name },
        status: membership.status,
        accessStartsAt: membership.accessStartsAt?.toISOString() ?? null,
        accessExpiresAt: membership.accessExpiresAt?.toISOString() ?? null,
        roles: grants
          .filter(
            (grant) => grant.membershipId === membership.id && !grant.revokedAt,
          )
          .map((grant) => ({
            id: grant.id,
            role: grant.role,
            startsAt: grant.startsAt?.toISOString() ?? null,
            expiresAt: grant.expiresAt?.toISOString() ?? null,
          })),
        version: membership.version,
      })),
    );
  },
);

router.post(
  "/organisations/:organisationId/memberships",
  attachTenantContext,
  requireSelectedOrganisation,
  requirePermission("membership:manage"),
  async (req: Request, res: Response) => {
    const context = getAccessContext(req)!;
    if (context.source !== "membership") {
      res
        .status(403)
        .json({ error: "Direct organisation administration required" });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const userId = typeof body.userId === "string" ? body.userId : "";
    const role = body.role;
    const accessExpiresAt = optionalFutureDate(body.accessExpiresAt);
    const roleExpiresAt = optionalFutureDate(body.roleExpiresAt);
    const changesAccessExpiry = Object.prototype.hasOwnProperty.call(
      body,
      "accessExpiresAt",
    );
    const changesRoleExpiry = Object.prototype.hasOwnProperty.call(
      body,
      "roleExpiresAt",
    );
    if (
      !userId ||
      !isOrganisationRole(role) ||
      accessExpiresAt === "invalid" ||
      roleExpiresAt === "invalid"
    ) {
      res.status(400).json({ error: "Invalid membership grant" });
      return;
    }
    const organisationId = String(req.params.organisationId);
    const outcome = await withTenantDatabase(organisationId, () =>
      db.transaction(
        async (tx) => {
          await lockOrganisationMembershipAdministration(tx, organisationId);
          const now = new Date();
          if (
            (accessExpiresAt && accessExpiresAt.getTime() <= now.getTime()) ||
            (roleExpiresAt && roleExpiresAt.getTime() <= now.getTime())
          ) {
            return { kind: "invalid_expiry" as const };
          }
          const [[organisation], [targetUser], memberships, grants] =
            await Promise.all([
              tx
                .select()
                .from(organisations)
                .where(eq(organisations.id, organisationId)),
              tx.select().from(users).where(eq(users.id, userId)),
              tx
                .select()
                .from(organisationMemberships)
                .where(
                  eq(organisationMemberships.organisationId, organisationId),
                ),
              tx
                .select()
                .from(roleGrants)
                .where(
                  inArray(
                    roleGrants.membershipId,
                    tx
                      .select({ id: organisationMemberships.id })
                      .from(organisationMemberships)
                      .where(
                        eq(
                          organisationMemberships.organisationId,
                          organisationId,
                        ),
                      ),
                  ),
                ),
            ]);
          if (!organisation || !targetUser) {
            return { kind: "not_found" as const };
          }
          if (
            !isRoleAllowedForOrganisation(
              role,
              organisation.type as OrganisationType,
            )
          ) {
            return { kind: "invalid_role" as const };
          }

          const existingMembership = memberships.find(
            (membership) => membership.userId === userId,
          );
          const nextAccessExpiresAt =
            existingMembership && !changesAccessExpiry
              ? existingMembership.accessExpiresAt
              : accessExpiresAt;
          if (
            nextAccessExpiresAt &&
            nextAccessExpiresAt.getTime() <= now.getTime()
          ) {
            return { kind: "invalid_expiry" as const };
          }
          const authority = evaluateMembershipGrantAuthority({
            actorMembershipId: context.membershipId!,
            actorUserId: getLocalUser(req)!.id,
            targetMembershipId: existingMembership?.id,
            requestedRole: role,
            memberships,
            grants,
            now,
          });
          if (!authority.allowed) {
            await writeAuditTx(tx, {
              user: getLocalUser(req),
              organisationId,
              eventType: "membership.change_denied",
              objectType: "membership",
              objectId: existingMembership?.id ?? null,
              details: JSON.stringify({
                action: "grant_or_reactivate",
                denial: authority.denial,
                actorMembershipId: context.membershipId,
                actorRoles: authority.actorRoles,
                targetUserId: userId,
                requestedRole: role,
              }),
            });
            return {
              kind: "denied" as const,
              response: membershipDenialResponse(authority.denial),
            };
          }

          const matchingGrant = existingMembership
            ? grants.find(
                (grant) =>
                  grant.membershipId === existingMembership.id &&
                  grant.role === role &&
                  roleGrantCanStillTakeEffect(grant, now),
              )
            : undefined;
          if (
            matchingGrant?.startsAt &&
            changesRoleExpiry &&
            roleExpiresAt &&
            roleExpiresAt.getTime() <= matchingGrant.startsAt.getTime()
          ) {
            return { kind: "invalid_role_window" as const };
          }
          if (
            matchingGrant &&
            changesRoleExpiry &&
            !nullableInstantsEqual(matchingGrant.expiresAt, roleExpiresAt)
          ) {
            return { kind: "immutable_role_expiry" as const };
          }
          const membershipAlreadyActive = existingMembership
            ? isActiveAccessWindow(
                {
                  status: existingMembership.status,
                  startsAt: existingMembership.accessStartsAt,
                  expiresAt: existingMembership.accessExpiresAt,
                },
                now,
              )
            : false;
          if (matchingGrant && membershipAlreadyActive) {
            return { kind: "duplicate" as const };
          }

          const policyTargetId =
            existingMembership?.id ?? `pending-membership:${userId}`;
          const policyMemberships = existingMembership
            ? memberships
            : [
                ...memberships,
                {
                  id: policyTargetId,
                  userId,
                  status: "suspended",
                  accessStartsAt: null,
                  accessExpiresAt: null,
                },
              ];
          const policyGrants = matchingGrant
            ? grants
            : [
                ...grants,
                {
                  membershipId: policyTargetId,
                  role,
                  startsAt: null,
                  expiresAt: roleExpiresAt,
                  revokedAt: null,
                },
              ];
          const lifecycleAuthority = evaluateMembershipLifecycleAuthority({
            actorMembershipId: context.membershipId!,
            actorUserId: getLocalUser(req)!.id,
            targetMembershipId: policyTargetId,
            memberships: policyMemberships,
            grants: policyGrants,
            nextStatus: "active",
            changesAccessStart: true,
            nextAccessStartsAt: null,
            // Existing access expiry is preserved on omission. Clearing it to
            // indefinite access requires an explicit JSON null.
            changesAccessExpiry: !existingMembership || changesAccessExpiry,
            nextAccessExpiresAt,
            checksProposedAuthorityLoss:
              !matchingGrant && hasPermission([role], "membership:manage"),
            now,
          });
          if (!lifecycleAuthority.allowed) {
            await writeAuditTx(tx, {
              user: getLocalUser(req),
              organisationId,
              eventType: "membership.change_denied",
              objectType: "membership",
              objectId: existingMembership?.id ?? null,
              details: JSON.stringify({
                action: "grant_reactivate_or_replace_access_window",
                denial: lifecycleAuthority.denial,
                actorMembershipId: context.membershipId,
                actorRoles: lifecycleAuthority.actorRoles,
                targetUserId: userId,
                requestedRole: role,
                requestedRoleExpiresAt: roleExpiresAt,
                requestedAccessExpiresAt: changesAccessExpiry
                  ? accessExpiresAt
                  : undefined,
                nextAccessExpiresAt,
              }),
            });
            return {
              kind: "denied" as const,
              response: membershipDenialResponse(lifecycleAuthority.denial),
            };
          }

          const [membership] = await tx
            .insert(organisationMemberships)
            .values({
              organisationId,
              userId,
              accessExpiresAt: nextAccessExpiresAt,
              delegatedByMembershipId: context.membershipId,
            })
            .onConflictDoUpdate({
              target: [
                organisationMemberships.organisationId,
                organisationMemberships.userId,
              ],
              set: {
                status: "active",
                accessStartsAt: null,
                accessExpiresAt: nextAccessExpiresAt,
                delegatedByMembershipId: context.membershipId,
                version: sql`${organisationMemberships.version} + 1`,
                updatedAt: new Date(),
              },
            })
            .returning();
          if (!matchingGrant) {
            await tx.insert(roleGrants).values({
              membershipId: membership.id,
              role,
              grantedByMembershipId: context.membershipId,
              expiresAt: roleExpiresAt,
            });
          }
          await writeAuditTx(tx, {
            user: getLocalUser(req),
            organisationId,
            eventType: matchingGrant
              ? "membership.reactivated"
              : "membership.role_granted",
            objectType: "membership",
            objectId: membership.id,
            details: JSON.stringify({
              actorMembershipId: context.membershipId,
              actorRoles: authority.actorRoles,
              targetUserId: userId,
              role,
              requestedRoleExpiresAt: changesRoleExpiry
                ? roleExpiresAt
                : undefined,
              roleExpiresAt: matchingGrant
                ? matchingGrant.expiresAt
                : roleExpiresAt,
              previousRoleExpiresAt: matchingGrant?.expiresAt ?? null,
              roleExpiryChanged: false,
              requestedAccessExpiresAt: changesAccessExpiry
                ? accessExpiresAt
                : undefined,
              accessExpiresAt: membership.accessExpiresAt,
              accessExpiryChanged: !existingMembership || changesAccessExpiry,
              previousStatus: existingMembership?.status ?? null,
              previousAccessExpiresAt:
                existingMembership?.accessExpiresAt ?? null,
              reactivatedExistingGrant: Boolean(matchingGrant),
            }),
          });
          return { kind: "ok" as const, membership };
        },
        { isolationLevel: "read committed" },
      ),
    );
    if (outcome.kind === "not_found") {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (outcome.kind === "invalid_role") {
      res
        .status(400)
        .json({ error: "Role is not valid for this organisation type" });
      return;
    }
    if (outcome.kind === "invalid_expiry") {
      res
        .status(400)
        .json({ error: "Access expiry must remain in the future" });
      return;
    }
    if (outcome.kind === "invalid_role_window") {
      res.status(400).json({
        error: "Role expiry must be later than the retained grant start",
      });
      return;
    }
    if (outcome.kind === "immutable_role_expiry") {
      res.status(409).json({
        error:
          "Existing role expiry is immutable; reactivate without changing roleExpiresAt",
      });
      return;
    }
    if (outcome.kind === "denied") {
      res
        .status(outcome.response.status)
        .json({ error: outcome.response.error });
      return;
    }
    if (outcome.kind === "duplicate") {
      res.status(409).json({ error: "Role is already granted" });
      return;
    }
    res.status(201).json({ id: outcome.membership.id, role });
  },
);

router.patch(
  "/organisations/:organisationId/memberships/:membershipId",
  attachTenantContext,
  requireSelectedOrganisation,
  requirePermission("membership:manage"),
  async (req: Request, res: Response) => {
    const context = getAccessContext(req)!;
    if (context.source !== "membership") {
      res
        .status(403)
        .json({ error: "Direct organisation administration required" });
      return;
    }
    const expectedVersion = parseExpectedVersion(req.get("If-Match"));
    if (!expectedVersion) {
      res
        .status(428)
        .json({ error: "If-Match membership version is required" });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const allowedStatuses = new Set(["active", "suspended", "revoked"]);
    const status = body.status;
    const accessExpiresAt = optionalFutureDate(body.accessExpiresAt);
    if (
      (status !== undefined &&
        (typeof status !== "string" || !allowedStatuses.has(status))) ||
      accessExpiresAt === "invalid"
    ) {
      res.status(400).json({ error: "Invalid membership update" });
      return;
    }
    if (status === undefined && body.accessExpiresAt === undefined) {
      res.status(400).json({ error: "No membership changes supplied" });
      return;
    }
    const organisationId = String(req.params.organisationId);
    const outcome = await withTenantDatabase(organisationId, () =>
      db.transaction(
        async (tx) => {
          await lockOrganisationMembershipAdministration(tx, organisationId);
          const now = new Date();
          if (accessExpiresAt && accessExpiresAt.getTime() <= now.getTime()) {
            return { kind: "invalid_expiry" as const };
          }
          const [memberships, grants] = await Promise.all([
            tx
              .select()
              .from(organisationMemberships)
              .where(
                eq(organisationMemberships.organisationId, organisationId),
              ),
            tx
              .select()
              .from(roleGrants)
              .where(
                inArray(
                  roleGrants.membershipId,
                  tx
                    .select({ id: organisationMemberships.id })
                    .from(organisationMemberships)
                    .where(
                      eq(
                        organisationMemberships.organisationId,
                        organisationId,
                      ),
                    ),
                ),
              ),
          ]);
          const targetMembershipId = String(req.params.membershipId);
          const current = memberships.find(
            (membership) => membership.id === targetMembershipId,
          );
          if (!current || current.version !== expectedVersion) {
            return { kind: "conflict" as const };
          }

          const authority = evaluateMembershipLifecycleAuthority({
            actorMembershipId: context.membershipId!,
            actorUserId: getLocalUser(req)!.id,
            targetMembershipId,
            memberships,
            grants,
            ...(typeof status === "string"
              ? {
                  nextStatus: status as "active" | "suspended" | "revoked",
                }
              : {}),
            changesAccessExpiry: body.accessExpiresAt !== undefined,
            nextAccessExpiresAt: accessExpiresAt,
            now,
          });
          if (!authority.allowed) {
            await writeAuditTx(tx, {
              user: getLocalUser(req),
              organisationId,
              eventType: "membership.change_denied",
              objectType: "membership",
              objectId: current.id,
              details: JSON.stringify({
                action: "update_lifecycle",
                denial: authority.denial,
                actorMembershipId: context.membershipId,
                actorRoles: authority.actorRoles,
                requestedStatus: status ?? null,
                requestedAccessExpiresAt:
                  body.accessExpiresAt !== undefined ? accessExpiresAt : null,
                expectedVersion,
              }),
            });
            return {
              kind: "denied" as const,
              response: membershipDenialResponse(authority.denial),
            };
          }

          const [membership] = await tx
            .update(organisationMemberships)
            .set({
              ...(typeof status === "string" ? { status } : {}),
              ...(body.accessExpiresAt !== undefined
                ? { accessExpiresAt }
                : {}),
              version: sql`${organisationMemberships.version} + 1`,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(organisationMemberships.id, targetMembershipId),
                eq(organisationMemberships.organisationId, organisationId),
                eq(organisationMemberships.version, expectedVersion),
              ),
            )
            .returning();
          if (!membership) return { kind: "conflict" as const };
          await writeAuditTx(tx, {
            user: getLocalUser(req),
            organisationId,
            eventType: "membership.updated",
            objectType: "membership",
            objectId: membership.id,
            details: JSON.stringify({
              actorMembershipId: context.membershipId,
              actorRoles: authority.actorRoles,
              previousStatus: current.status,
              status: membership.status,
              previousAccessExpiresAt: current.accessExpiresAt,
              accessExpiresAt: membership.accessExpiresAt,
              previousVersion: current.version,
              version: membership.version,
            }),
          });
          return { kind: "ok" as const, membership };
        },
        { isolationLevel: "read committed" },
      ),
    );
    if (outcome.kind === "conflict") {
      res
        .status(409)
        .json({ error: "Membership changed; reload before updating" });
      return;
    }
    if (outcome.kind === "invalid_expiry") {
      res
        .status(400)
        .json({ error: "Access expiry must remain in the future" });
      return;
    }
    if (outcome.kind === "denied") {
      res
        .status(outcome.response.status)
        .json({ error: outcome.response.error });
      return;
    }
    res
      .setHeader("ETag", `"${outcome.membership.version}"`)
      .json(outcome.membership);
  },
);

export default router;
