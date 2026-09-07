import type { NextFunction, Request, Response } from "express";
import { and, eq, sql } from "drizzle-orm";
import {
  breakGlassSessions,
  boqChecks,
  capabilityItems,
  clients,
  db,
  defects,
  documents,
  evidenceItems,
  organisationMemberships,
  organisations,
  partnerRelationships,
  projects,
  reports,
  requirements,
  retentionActions,
  retentionRequests,
  roleGrants,
  sbdAnnotations,
  sbdTemplates,
  vaultItems,
  withTenantDatabase,
} from "@workspace/db";
import { getLocalUser } from "./auth";
import {
  BREAK_GLASS_ELIGIBLE_PERMISSIONS,
  canAccessResourceOrganisation,
  isActiveAccessWindow,
  isOrganisationRole,
  isPermission,
  isRoleAllowedForOrganisation,
  hasPermission,
  normalizeLegacyRole,
  partnerDerivedPermissionsForRoles,
  permissionsForRoles,
  type OrganisationRole,
  type OrganisationType,
  type Permission,
} from "../lib/permissions";
export { parseExpectedVersion } from "../lib/permissions";
import { isTenantFeatureEnabled } from "../lib/featureFlags";
import { writeAudit } from "../lib/audit";
import { isProjectContentImmutable } from "../lib/reportPolicy";
import { CLAIMS_DESK_RELEASED_LEDGER_ROUTE_EXCEPTIONS } from "../lib/claimsDesk/activation";

export const ORGANISATION_HEADER = "x-bidbox-organisation-id";
export const BREAK_GLASS_HEADER = "x-bidbox-break-glass-session";
// Pre-rename header names, honoured for one release so browser tabs still
// running the previous bundle keep their tenant selection across the cutover.
export const LEGACY_ORGANISATION_HEADER = "x-valo-organisation-id";
export const LEGACY_BREAK_GLASS_HEADER = "x-valo-break-glass-session";

const RELEASED_OPERATIONS_LEDGER_MUTATIONS: ReadonlyArray<{
  method: "PATCH" | "POST";
  path: RegExp;
}> = Object.freeze([
  ...CLAIMS_DESK_RELEASED_LEDGER_ROUTE_EXCEPTIONS,
  {
    method: "POST",
    path: /^\/projects\/[^/]+\/operations-suite\/submission-war-rooms$/u,
  },
  {
    method: "POST",
    path: /^\/projects\/[^/]+\/operations-suite\/submission-war-rooms\/[^/]+\/advance$/u,
  },
  {
    method: "POST",
    path: /^\/projects\/[^/]+\/operations-suite\/visual-qa-reports$/u,
  },
  {
    method: "POST",
    path: /^\/projects\/[^/]+\/operations-suite\/post-award-items$/u,
  },
  {
    method: "PATCH",
    path: /^\/projects\/[^/]+\/operations-suite\/post-award-items\/[^/]+$/u,
  },
  {
    method: "POST",
    path: /^\/projects\/[^/]+\/client-actions\/package-deliveries$/u,
  },
  {
    method: "POST",
    path: /^\/projects\/[^/]+\/client-actions\/package-deliveries\/[^/]+\/acknowledgements$/u,
  },
  {
    method: "POST",
    path: /^\/projects\/[^/]+\/communications\/intents$/u,
  },
  {
    method: "POST",
    path: /^\/projects\/[^/]+\/communications\/intents\/[^/]+\/attempts$/u,
  },
  {
    method: "POST",
    path: /^\/projects\/[^/]+\/communications\/intents\/[^/]+\/reconciliations$/u,
  },
]);

/**
 * Released tender/report/document content stays immutable, while these exact
 * append-only Operations ledger workflows remain usable after sign-off. An
 * archived project is terminal and therefore never receives this exception.
 */
export function canMutateReleasedOperationsLedger(
  projectStatus: string,
  method: string,
  path: string,
): boolean {
  if (projectStatus !== "signed_off" && projectStatus !== "exported") {
    return false;
  }
  const normalizedMethod = method.toUpperCase();
  return RELEASED_OPERATIONS_LEDGER_MUTATIONS.some(
    (route) => route.method === normalizedMethod && route.path.test(path),
  );
}

const GOVERNED_ADDENDUM_IMPACT_MUTATIONS = Object.freeze([
  /^\/projects\/[^/]+\/addendum-impact\/review$/u,
  /^\/projects\/[^/]+\/addendum-impact\/apply$/u,
]);

/**
 * The append-only review and the separately authorised apply command are the
 * only addendum mutations admitted for a released project. Archived projects
 * remain terminal, and near-match or nested paths never receive an exception.
 */
export function canMutateReleasedGovernedAddendumImpact(
  projectStatus: string,
  method: string,
  path: string,
): boolean {
  return (
    (projectStatus === "signed_off" || projectStatus === "exported") &&
    method.toUpperCase() === "POST" &&
    GOVERNED_ADDENDUM_IMPACT_MUTATIONS.some((route) => route.test(path))
  );
}

export interface AccessContext {
  organisationId: string;
  membershipId: string | null;
  membershipOrganisationId: string | null;
  source: "membership" | "partner" | "break_glass";
  roles: readonly OrganisationRole[];
  permissions: ReadonlySet<Permission>;
  breakGlassSessionId: string | null;
  partnerRelationshipId: string | null;
  partnerCoSigningRequired: boolean;
}

type AccessRequest = Request & { accessContext?: AccessContext };

export function getAccessContext(req: Request): AccessContext | undefined {
  return (req as AccessRequest).accessContext;
}

export function getOrganisationId(req: Request): string | undefined {
  return getAccessContext(req)?.organisationId;
}

function singleHeader(req: Request, name: string): string | undefined {
  const value = req.headers[name];
  if (Array.isArray(value)) return undefined;
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function deny(res: Response): void {
  // Keep tenant existence private: membership, relationship and target misses
  // deliberately share the same response.
  res.status(403).json({ error: "Organisation access denied" });
}

function parseBreakGlassPermissions(raw: string): Permission[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (permission): permission is Permission =>
        isPermission(permission) &&
        BREAK_GLASS_ELIGIBLE_PERMISSIONS.has(permission),
    );
  } catch {
    return [];
  }
}

async function resolveBreakGlass(
  userId: string,
  targetOrganisationId: string,
  sessionId: string,
  now: Date,
): Promise<AccessContext | null> {
  const [session] = await db
    .select()
    .from(breakGlassSessions)
    .where(
      and(
        eq(breakGlassSessions.id, sessionId),
        eq(breakGlassSessions.requestedByUserId, userId),
        eq(breakGlassSessions.targetOrganisationId, targetOrganisationId),
      ),
    );
  if (
    !session ||
    !session.approvedByUserId ||
    session.approvedByUserId === userId ||
    !isActiveAccessWindow(
      {
        status: session.status,
        startsAt: session.startsAt,
        expiresAt: session.expiresAt,
        revokedAt: session.revokedAt,
      },
      now,
    )
  ) {
    return null;
  }
  const permissions = new Set(
    parseBreakGlassPermissions(session.requestedPermissions),
  );
  if (permissions.size === 0) return null;
  return {
    organisationId: targetOrganisationId,
    membershipId: null,
    membershipOrganisationId: null,
    source: "break_glass",
    roles: [],
    permissions,
    breakGlassSessionId: session.id,
    partnerRelationshipId: null,
    partnerCoSigningRequired: false,
  };
}

/**
 * Resolves one explicit tenant context from active direct membership, an active
 * partner/client relationship, or a separately approved break-glass session.
 * No global/admin role bypass exists.
 */
export async function attachTenantContext(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const user = getLocalUser(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const now = new Date();
    const requestedOrganisationId =
      singleHeader(req, ORGANISATION_HEADER) ??
      singleHeader(req, LEGACY_ORGANISATION_HEADER);
    const breakGlassSessionId =
      singleHeader(req, BREAK_GLASS_HEADER) ??
      singleHeader(req, LEGACY_BREAK_GLASS_HEADER);

    if (breakGlassSessionId) {
      if (!requestedOrganisationId) {
        res.status(400).json({
          error: "Break-glass access requires an organisation header",
        });
        return;
      }
      const context = await resolveBreakGlass(
        user.id,
        requestedOrganisationId,
        breakGlassSessionId,
        now,
      );
      if (!context) {
        deny(res);
        return;
      }
      (req as AccessRequest).accessContext = context;
      res.vary("X-BidBox-Organisation-Id");
      res.vary("X-BidBox-Break-Glass-Session");
      next();
      return;
    }

    const membershipRows = await db
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

    const activeMemberships = membershipRows
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

    let selected = requestedOrganisationId
      ? activeMemberships.find(
          ({ membership }) =>
            membership.organisationId === requestedOrganisationId,
        )
      : activeMemberships.length === 1
        ? activeMemberships[0]
        : undefined;
    let source: AccessContext["source"] = "membership";
    let targetOrganisationId = selected?.membership.organisationId;
    let partnerRelationshipId: string | null = null;
    let partnerCoSigningRequired = false;

    // Partner-managed client workspaces require both an active partner
    // membership and an active relationship. They are never auto-selected.
    if (!selected && requestedOrganisationId) {
      for (const candidate of activeMemberships) {
        if (candidate.organisation.type !== "consultancy_partner") continue;
        const [relationship] = await db
          .select({ relationship: partnerRelationships, client: organisations })
          .from(partnerRelationships)
          .innerJoin(
            organisations,
            eq(partnerRelationships.clientOrganisationId, organisations.id),
          )
          .where(
            and(
              eq(
                partnerRelationships.partnerOrganisationId,
                candidate.membership.organisationId,
              ),
              eq(
                partnerRelationships.clientOrganisationId,
                requestedOrganisationId,
              ),
            ),
          );
        if (
          relationship?.client.status === "active" &&
          (await isTenantFeatureEnabled(
            requestedOrganisationId,
            "partner_edition",
          )) &&
          isActiveAccessWindow(
            {
              status: relationship.relationship.status,
              startsAt: relationship.relationship.accessStartsAt,
              expiresAt: relationship.relationship.accessExpiresAt,
            },
            now,
          )
        ) {
          selected = candidate;
          source = "partner";
          targetOrganisationId = requestedOrganisationId;
          partnerRelationshipId = relationship.relationship.id;
          partnerCoSigningRequired =
            relationship.relationship.coSigningRequired;
          break;
        }
      }
    }

    if (!selected || !targetOrganisationId) {
      if (!requestedOrganisationId && activeMemberships.length > 1) {
        res.status(400).json({
          error: "Select an organisation with X-BidBox-Organisation-Id",
        });
      } else {
        deny(res);
      }
      return;
    }

    const grants = await db
      .select()
      .from(roleGrants)
      .where(eq(roleGrants.membershipId, selected.membership.id));
    const roles = grants
      .filter((grant) =>
        isActiveAccessWindow(
          {
            status: grant.revokedAt ? "revoked" : "active",
            startsAt: grant.startsAt,
            expiresAt: grant.expiresAt,
            revokedAt: grant.revokedAt,
          },
          now,
        ),
      )
      .map((grant) => grant.role)
      .filter(isOrganisationRole)
      .filter((role) =>
        isRoleAllowedForOrganisation(
          role,
          selected.organisation.type as OrganisationType,
        ),
      );
    if (roles.length === 0) {
      deny(res);
      return;
    }

    (req as AccessRequest).accessContext = {
      organisationId: targetOrganisationId,
      membershipId: selected.membership.id,
      membershipOrganisationId: selected.membership.organisationId,
      source,
      roles,
      permissions:
        source === "partner"
          ? partnerDerivedPermissionsForRoles(roles)
          : permissionsForRoles(roles),
      breakGlassSessionId: null,
      partnerRelationshipId,
      partnerCoSigningRequired,
    };
    res.vary("X-BidBox-Organisation-Id");
    next();
  } catch (error) {
    req.log?.error({ err: error }, "tenant context resolution failed");
    res.status(500).json({ error: "Access context error" });
  }
}

export function requirePermission(permission: Permission) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const context = getAccessContext(req);
    if (!context?.permissions.has(permission)) {
      res.status(403).json({ error: "Insufficient permission" });
      return;
    }
    next();
  };
}

/**
 * Resolve a permission from the verified tenant context. The legacy fallback
 * exists only for direct route-level compatibility tests/older callers that
 * predate global attachTenantContext; it still uses the canonical matrix.
 */
export function hasRequestPermission(
  req: Request,
  permission: Permission,
): boolean {
  const context = getAccessContext(req);
  if (context) return context.permissions.has(permission);
  const user = getLocalUser(req);
  const legacyRole = user ? normalizeLegacyRole(user.role) : null;
  return Boolean(legacyRole && hasPermission([legacyRole], permission));
}

/**
 * Compatibility adapter for route-module integration tests that mount a router
 * without the application's authentication/tenant pipeline. In the real app a
 * context is mandatory before these routes are reachable.
 */
export function requirePermissionOrLegacy(permission: Permission) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const context = getAccessContext(req);
    if (context) {
      if (!hasRequestPermission(req, permission)) {
        res.status(403).json({ error: "Insufficient permission" });
        return;
      }
      next();
      return;
    }
    if (!hasRequestPermission(req, permission)) {
      res.status(403).json({ error: "Awaiting access approval" });
      return;
    }
    next();
  };
}

/**
 * A reusable fail-closed guard for resource routes. Mismatch and missing rows
 * are both 404 so callers cannot enumerate another tenant's identifiers.
 */
export function requireResourceOrganisation(
  loadOrganisationId: (req: Request) => Promise<string | null | undefined>,
) {
  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const context = getAccessContext(req);
      const resourceOrganisationId = await loadOrganisationId(req);
      if (
        !canAccessResourceOrganisation(
          context?.organisationId,
          resourceOrganisationId,
        )
      ) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      next();
    } catch (error) {
      req.log?.error({ err: error }, "resource tenant guard failed");
      res.status(500).json({ error: "Resource access check failed" });
    }
  };
}

type OrganisationLookup = (id: string) => Promise<string | null | undefined>;
type ProjectLookup = (id: string) => Promise<string | null | undefined>;

function lookupOrganisation(table: {
  id: unknown;
  organisationId: unknown;
}): OrganisationLookup {
  return async (id: string): Promise<string | null | undefined> => {
    // Drizzle's concrete column types are intentionally contained here; the
    // runtime shape is common across all tenant resources.
    const typed = table as typeof projects;
    const [row] = await db
      .select({ organisationId: typed.organisationId })
      .from(typed)
      .where(eq(typed.id, id));
    return row?.organisationId;
  };
}

function lookupProjectId(table: {
  id: unknown;
  projectId: unknown;
}): ProjectLookup {
  return async (id: string): Promise<string | null | undefined> => {
    const typed = table as typeof reports;
    const [row] = await db
      .select({ projectId: typed.projectId })
      .from(typed)
      .where(eq(typed.id, id));
    return row?.projectId;
  };
}

const RESOURCE_LOOKUPS: Array<{ pattern: RegExp; load: OrganisationLookup }> = [
  { pattern: /^\/projects\/([^/]+)/, load: lookupOrganisation(projects) },
  { pattern: /^\/clients\/([^/]+)/, load: lookupOrganisation(clients) },
  { pattern: /^\/documents\/([^/]+)/, load: lookupOrganisation(documents) },
  {
    pattern: /^\/requirements\/([^/]+)/,
    load: lookupOrganisation(requirements),
  },
  { pattern: /^\/evidence\/([^/]+)/, load: lookupOrganisation(evidenceItems) },
  { pattern: /^\/defects\/([^/]+)/, load: lookupOrganisation(defects) },
  { pattern: /^\/reports\/([^/]+)/, load: lookupOrganisation(reports) },
  { pattern: /^\/boq-checks\/([^/]+)/, load: lookupOrganisation(boqChecks) },
  { pattern: /^\/vault-items\/([^/]+)/, load: lookupOrganisation(vaultItems) },
  {
    pattern: /^\/capability-items\/([^/]+)/,
    load: lookupOrganisation(capabilityItems),
  },
  {
    pattern: /^\/sbd-templates\/([^/]+)/,
    load: lookupOrganisation(sbdTemplates),
  },
  {
    pattern: /^\/sbd-annotations\/([^/]+)/,
    load: lookupOrganisation(sbdAnnotations),
  },
  {
    pattern: /^\/retention-requests\/([^/]+)/,
    load: lookupOrganisation(retentionRequests),
  },
  {
    pattern: /^\/retention-actions\/([^/]+)/,
    load: lookupOrganisation(retentionActions),
  },
];

const PROJECT_LOOKUPS: Array<{ pattern: RegExp; load: ProjectLookup }> = [
  { pattern: /^\/projects\/([^/]+)/, load: async (id) => id },
  { pattern: /^\/documents\/([^/]+)/, load: lookupProjectId(documents) },
  { pattern: /^\/requirements\/([^/]+)/, load: lookupProjectId(requirements) },
  { pattern: /^\/evidence\/([^/]+)/, load: lookupProjectId(evidenceItems) },
  { pattern: /^\/defects\/([^/]+)/, load: lookupProjectId(defects) },
  { pattern: /^\/reports\/([^/]+)/, load: lookupProjectId(reports) },
  { pattern: /^\/boq-checks\/([^/]+)/, load: lookupProjectId(boqChecks) },
  {
    pattern: /^\/retention-requests\/([^/]+)/,
    load: lookupProjectId(retentionRequests),
  },
];

/**
 * Defence-in-depth boundary for legacy route handlers. It verifies resource
 * path IDs and common parent IDs in request bodies before any handler runs.
 */
export async function enforceTenantResourceBoundary(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const context = getAccessContext(req);
  if (!context) {
    res.status(403).json({ error: "Organisation access denied" });
    return;
  }
  try {
    const checks: Array<Promise<string | null | undefined>> = [];
    const projectChecks: Array<Promise<string | null | undefined>> = [];
    for (const resource of RESOURCE_LOOKUPS) {
      const match = resource.pattern.exec(req.path);
      if (match) {
        checks.push(resource.load(match[1]));
        break;
      }
    }
    for (const resource of PROJECT_LOOKUPS) {
      const match = resource.pattern.exec(req.path);
      if (match) {
        projectChecks.push(resource.load(match[1]));
        break;
      }
    }
    const body =
      req.body && typeof req.body === "object"
        ? (req.body as Record<string, unknown>)
        : undefined;
    if (typeof body?.projectId === "string") {
      checks.push(lookupOrganisation(projects)(body.projectId));
      projectChecks.push(Promise.resolve(body.projectId));
    }
    if (typeof body?.clientId === "string") {
      checks.push(lookupOrganisation(clients)(body.clientId));
    }
    if (typeof body?.requirementId === "string") {
      checks.push(lookupOrganisation(requirements)(body.requirementId));
    }
    if (typeof body?.documentId === "string") {
      checks.push(lookupOrganisation(documents)(body.documentId));
    }
    const resourceOrganisationIds = await Promise.all(checks);
    if (
      resourceOrganisationIds.some(
        (organisationId) =>
          !canAccessResourceOrganisation(
            context.organisationId,
            organisationId,
          ),
      )
    ) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const projectIds = [
      ...new Set(
        (await Promise.all(projectChecks)).filter((id): id is string =>
          Boolean(id),
        ),
      ),
    ].sort();
    // Every request touching project state takes the same transaction-scoped
    // lock. Readiness, sign-off/export and all source mutations therefore
    // cannot interleave. Sorting prevents deadlocks for unusual multi-project
    // requests.
    for (const projectId of projectIds) {
      await db.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${projectId}, 0))`,
      );
    }
    const governedRetentionWorkflow =
      /^\/projects\/[^/]+\/retention-requests$/.test(req.path) ||
      /^\/retention-requests\/[^/]+\/complete$/.test(req.path) ||
      /^\/retention-actions\/[^/]+\/(?:reconcile|certify)$/.test(req.path);
    if (
      !governedRetentionWorkflow &&
      !new Set(["GET", "HEAD", "OPTIONS"]).has(req.method)
    ) {
      for (const projectId of projectIds) {
        const [project] = await db
          .select({ status: projects.status })
          .from(projects)
          .where(eq(projects.id, projectId));
        if (
          project &&
          isProjectContentImmutable(project.status) &&
          !canMutateReleasedOperationsLedger(
            project.status,
            req.method,
            req.path,
          ) &&
          !canMutateReleasedGovernedAddendumImpact(
            project.status,
            req.method,
            req.path,
          )
        ) {
          res.status(409).json({
            error:
              "Released project content is immutable; use a governed reopen workflow.",
          });
          return;
        }
      }
    }
    next();
  } catch {
    // Invalid IDs and lookup failures reveal no tenant/resource existence.
    res.status(404).json({ error: "Not found" });
  }
}

/** Every emergency request produces an immutable use record, including denials. */
export function auditBreakGlassUse(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const context = getAccessContext(req);
  if (context?.source !== "break_glass") {
    next();
    return;
  }
  const user = getLocalUser(req);
  // Commit the attempt in its own tenant transaction before opening the main
  // request transaction. A later 5xx rollback must not erase emergency-use
  // evidence, and an audit failure prevents the emergency request entirely.
  void withTenantDatabase(context.organisationId, () =>
    writeAudit({
      user,
      organisationId: context.organisationId,
      eventType: "break_glass.used",
      objectType: "break_glass_session",
      objectId: context.breakGlassSessionId,
      details: JSON.stringify({
        method: req.method,
        path: req.path,
        phase: "attempted",
      }),
    }),
  ).then(
    () => next(),
    (error: unknown) => next(error),
  );
}
