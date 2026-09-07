import {
  Router,
  type IRouter,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { and, eq, inArray } from "drizzle-orm";
import {
  breakGlassSessions,
  db,
  organisationMemberships,
  organisations,
  roleGrants,
  withTenantDatabase,
} from "@workspace/db";
import { getLocalUser } from "../middlewares/auth";
import {
  BREAK_GLASS_ELIGIBLE_PERMISSIONS,
  isActiveAccessWindow,
  isPermission,
  type Permission,
} from "../lib/permissions";
import { writeAuditTx } from "../lib/audit";

const router: IRouter = Router();
const MAX_BREAK_GLASS_MINUTES = 60;

async function hasActiveBidBoxOperationsRole(userId: string): Promise<boolean> {
  const now = new Date();
  const memberships = await db
    .select({
      membership: organisationMemberships,
      organisation: organisations,
    })
    .from(organisationMemberships)
    .innerJoin(
      organisations,
      eq(organisationMemberships.organisationId, organisations.id),
    )
    .where(eq(organisationMemberships.userId, userId));
  const activeIds = memberships
    .filter(
      ({ membership, organisation }) =>
        organisation.type === "valo" &&
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
    .map(({ membership }) => membership.id);
  if (activeIds.length === 0) return false;
  const grants = await db
    .select()
    .from(roleGrants)
    .where(inArray(roleGrants.membershipId, activeIds));
  return grants.some(
    (grant) =>
      grant.role === "valo_operations_administrator" &&
      isActiveAccessWindow(
        {
          status: grant.revokedAt ? "revoked" : "active",
          startsAt: grant.startsAt,
          expiresAt: grant.expiresAt,
          revokedAt: grant.revokedAt,
        },
        now,
      ),
  );
}

function requirePlatformApprover(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (getLocalUser(req)?.role !== "restricted_platform_administrator") {
    res
      .status(403)
      .json({ error: "Restricted platform administrator required" });
    return;
  }
  next();
}

function requestedPermissions(value: unknown): Permission[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const unique = [
    ...new Set(
      value.filter(
        (permission): permission is Permission =>
          isPermission(permission) &&
          BREAK_GLASS_ELIGIBLE_PERMISSIONS.has(permission),
      ),
    ),
  ];
  // Invalid/write permissions invalidate the request; silently narrowing an
  // emergency request would make the approval record misleading.
  return unique.length === value.length ? unique : null;
}

router.get("/break-glass/sessions", async (req: Request, res: Response) => {
  const user = getLocalUser(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const rows = await db
    .select()
    .from(breakGlassSessions)
    .where(eq(breakGlassSessions.requestedByUserId, user.id));
  res.json(
    rows.map((row) => ({
      ...row,
      requestedPermissions: JSON.parse(row.requestedPermissions) as unknown,
    })),
  );
});

router.post("/break-glass/sessions", async (req: Request, res: Response) => {
  const user = getLocalUser(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (!(await hasActiveBidBoxOperationsRole(user.id))) {
    res.status(403).json({ error: "BidBox operations role required" });
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const targetOrganisationId =
    typeof body.targetOrganisationId === "string"
      ? body.targetOrganisationId
      : "";
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  const incidentReference =
    typeof body.incidentReference === "string"
      ? body.incidentReference.trim()
      : "";
  const durationMinutes =
    typeof body.durationMinutes === "number"
      ? body.durationMinutes
      : Number.NaN;
  const permissions = requestedPermissions(body.permissions);
  if (
    !targetOrganisationId ||
    reason.length < 20 ||
    reason.length > 1_000 ||
    incidentReference.length < 3 ||
    incidentReference.length > 120 ||
    !Number.isInteger(durationMinutes) ||
    durationMinutes < 5 ||
    durationMinutes > MAX_BREAK_GLASS_MINUTES ||
    !permissions
  ) {
    res.status(400).json({ error: "Invalid break-glass request" });
    return;
  }
  const [target] = await db
    .select({ id: organisations.id })
    .from(organisations)
    .where(
      and(
        eq(organisations.id, targetOrganisationId),
        eq(organisations.status, "active"),
      ),
    );
  if (!target) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const now = new Date();
  const created = await withTenantDatabase(targetOrganisationId, () =>
    db.transaction(
      async (tx) => {
        const [session] = await tx
          .insert(breakGlassSessions)
          .values({
            targetOrganisationId,
            requestedByUserId: user.id,
            reason,
            incidentReference,
            requestedPermissions: JSON.stringify(permissions),
            expiresAt: new Date(now.getTime() + durationMinutes * 60_000),
          })
          .returning();
        await writeAuditTx(tx, {
          user,
          organisationId: targetOrganisationId,
          eventType: "break_glass.requested",
          objectType: "break_glass_session",
          objectId: session.id,
          details: JSON.stringify({
            incidentReference,
            durationMinutes,
            permissions,
            reason,
          }),
        });
        return session;
      },
      { isolationLevel: "read committed" },
    ),
  );
  res.status(201).json({ ...created, requestedPermissions: permissions });
});

router.post(
  "/break-glass/sessions/:id/approve",
  requirePlatformApprover,
  async (req: Request, res: Response) => {
    const approver = getLocalUser(req)!;
    const [pending] = await db
      .select()
      .from(breakGlassSessions)
      .where(
        and(
          eq(breakGlassSessions.id, String(req.params.id)),
          eq(breakGlassSessions.status, "pending"),
        ),
      );
    if (!pending) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (pending.requestedByUserId === approver.id) {
      res
        .status(409)
        .json({ error: "Break-glass requires a distinct approver" });
      return;
    }
    const requestedDuration = Math.min(
      MAX_BREAK_GLASS_MINUTES * 60_000,
      Math.max(
        5 * 60_000,
        pending.expiresAt.getTime() - pending.createdAt.getTime(),
      ),
    );
    const now = new Date();
    const approved = await withTenantDatabase(
      pending.targetOrganisationId,
      () =>
        db.transaction(
          async (tx) => {
            const [session] = await tx
              .update(breakGlassSessions)
              .set({
                approvedByUserId: approver.id,
                status: "active",
                startsAt: now,
                expiresAt: new Date(now.getTime() + requestedDuration),
                updatedAt: now,
              })
              .where(
                and(
                  eq(breakGlassSessions.id, pending.id),
                  eq(breakGlassSessions.status, "pending"),
                ),
              )
              .returning();
            if (!session) return undefined;
            await writeAuditTx(tx, {
              user: approver,
              organisationId: session.targetOrganisationId,
              eventType: "break_glass.approved",
              objectType: "break_glass_session",
              objectId: session.id,
              details: JSON.stringify({
                requester: session.requestedByUserId,
                expiresAt: session.expiresAt.toISOString(),
              }),
            });
            return session;
          },
          { isolationLevel: "read committed" },
        ),
    );
    if (!approved) {
      res
        .status(409)
        .json({ error: "Break-glass request is no longer pending" });
      return;
    }
    res.json({
      ...approved,
      requestedPermissions: JSON.parse(
        approved.requestedPermissions,
      ) as unknown,
    });
  },
);

router.delete(
  "/break-glass/sessions/:id",
  async (req: Request, res: Response) => {
    const user = getLocalUser(req);
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const [existing] = await db
      .select()
      .from(breakGlassSessions)
      .where(eq(breakGlassSessions.id, String(req.params.id)));
    if (
      !existing ||
      (existing.requestedByUserId !== user.id &&
        existing.approvedByUserId !== user.id &&
        user.role !== "restricted_platform_administrator")
    ) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const now = new Date();
    const revoked = await withTenantDatabase(
      existing.targetOrganisationId,
      () =>
        db.transaction(
          async (tx) => {
            const [session] = await tx
              .update(breakGlassSessions)
              .set({
                status: "revoked",
                revokedAt: now,
                revokedByUserId: user.id,
                updatedAt: now,
              })
              .where(
                and(
                  eq(breakGlassSessions.id, existing.id),
                  inArray(breakGlassSessions.status, ["pending", "active"]),
                ),
              )
              .returning();
            if (!session) return undefined;
            await writeAuditTx(tx, {
              user,
              organisationId: session.targetOrganisationId,
              eventType: "break_glass.revoked",
              objectType: "break_glass_session",
              objectId: session.id,
              details: session.incidentReference,
            });
            return session;
          },
          { isolationLevel: "read committed" },
        ),
    );
    if (!revoked) {
      res.status(409).json({ error: "Break-glass session is already closed" });
      return;
    }
    res.status(204).end();
  },
);

export default router;
