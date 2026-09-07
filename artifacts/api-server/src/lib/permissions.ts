/**
 * BidBox's role and permission policy is intentionally a pure module. Routes and
 * middleware consume the same matrix, and security tests can exercise every
 * decision without a database or a live identity provider.
 */
import { isOneOf } from "./typeGuards";

export const ORGANISATION_ROLES = [
  "client_organisation_owner",
  "client_administrator",
  "bid_manager",
  "contributor",
  "client_reviewer_approver",
  "valo_operations_administrator",
  "restricted_platform_administrator",
  "consultancy_partner_administrator",
  "consultancy_partner_analyst_reviewer",
  "read_only_auditor",
  "valo_analyst",
  "valo_quality_adviser",
] as const;

export type OrganisationRole = (typeof ORGANISATION_ROLES)[number];

export const PERMISSIONS = [
  "organisation:read",
  "organisation:update",
  "membership:read",
  "membership:manage",
  "partner_relationship:read",
  "partner_relationship:manage",
  "client:read",
  "client:create",
  "client:update",
  "project:read",
  "project:create",
  "project:update",
  "project:delete",
  "project:assign",
  "document:read",
  "document:upload",
  "document:delete",
  "requirement:read",
  "requirement:write",
  "requirement:review",
  "evidence:read",
  "evidence:write",
  "evidence:approve",
  "defect:read",
  "defect:write",
  "defect:review",
  "report:read",
  "report:generate",
  "report:sign_off",
  "report:export",
  "draft:read",
  "draft:write",
  "draft:review",
  "package:read",
  "package:generate",
  "package:sign_off",
  "package:export",
  "billing:read",
  "order:create",
  "entitlement:read",
  "privacy:read",
  "privacy:manage",
  "processing_job:read",
  "processing_job:retry",
  "evaluation:read",
  "evaluation:manage",
  "intelligence:review",
  "rule_pack:read",
  "rule_pack:manage",
  "partner_report:read",
  "audit:read",
  "analytics:read",
  "retention:manage",
  "configuration:read",
  "configuration:manage",
  "feature_flag:read",
  "feature_flag:manage",
  "break_glass:request",
  "break_glass:approve",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const READ_WORKSPACE: Permission[] = [
  "organisation:read",
  "membership:read",
  "partner_relationship:read",
  "client:read",
  "project:read",
  "document:read",
  "requirement:read",
  "evidence:read",
  "defect:read",
  "report:read",
  "draft:read",
  "package:read",
  "entitlement:read",
  "processing_job:read",
  "evaluation:read",
  "rule_pack:read",
  "feature_flag:read",
];

const CONTRIBUTE: Permission[] = [
  ...READ_WORKSPACE,
  "document:upload",
  "requirement:write",
  "evidence:write",
  "defect:write",
  "draft:write",
];

const REVIEW: Permission[] = [
  ...READ_WORKSPACE,
  "document:upload",
  "requirement:review",
  "evidence:write",
  "evidence:approve",
  "defect:write",
  "defect:review",
  "report:sign_off",
  "draft:review",
  "package:sign_off",
  "intelligence:review",
];

const MANAGE_PORTFOLIO: Permission[] = [
  ...READ_WORKSPACE,
  "document:upload",
  "evidence:write",
  "client:create",
  "client:update",
  "project:create",
  "project:update",
  "project:assign",
  "document:delete",
  "report:generate",
  "report:export",
  "package:generate",
  "package:export",
  "billing:read",
  "order:create",
  "privacy:read",
  "partner_report:read",
  "analytics:read",
];

const MANAGE_WORK: Permission[] = [...CONTRIBUTE, ...MANAGE_PORTFOLIO];

const PARTNER_PROPOSE: Permission[] = [
  ...CONTRIBUTE,
  "requirement:review",
  "report:export",
  "package:export",
  "partner_report:read",
];

/**
 * Restricted platform administrators intentionally have no client/project or
 * document permissions. Platform administration is not a tenant-data bypass.
 */
export const ROLE_PERMISSIONS: Readonly<
  Record<OrganisationRole, readonly Permission[]>
> = {
  client_organisation_owner: [
    ...MANAGE_PORTFOLIO,
    // Client owners retain the matrix's final client-approval authority, but
    // do not inherit evidence/fatal/BidBox-quality approval permissions.
    "report:sign_off",
    "organisation:update",
    "membership:manage",
    "partner_relationship:manage",
    "project:delete",
    "audit:read",
    "retention:manage",
    "configuration:read",
    "privacy:manage",
  ],
  client_administrator: [
    ...MANAGE_PORTFOLIO,
    "organisation:update",
    "membership:manage",
    "audit:read",
    "retention:manage",
    "configuration:read",
    "privacy:manage",
  ],
  bid_manager: [...MANAGE_WORK, "requirement:review"],
  contributor: CONTRIBUTE,
  client_reviewer_approver: [...REVIEW, "report:export", "package:export"],
  valo_operations_administrator: [
    "organisation:read",
    "membership:read",
    "partner_relationship:read",
    "billing:read",
    "order:create",
    "privacy:read",
    "privacy:manage",
    "processing_job:retry",
    "evaluation:read",
    "rule_pack:read",
    "partner_report:read",
    "analytics:read",
    "organisation:update",
    "membership:manage",
    "partner_relationship:manage",
    "audit:read",
    "retention:manage",
    "configuration:read",
    "configuration:manage",
    "feature_flag:manage",
    "break_glass:request",
  ],
  restricted_platform_administrator: [
    "organisation:read",
    "membership:read",
    "membership:manage",
    "partner_relationship:read",
    "feature_flag:read",
    "feature_flag:manage",
    "audit:read",
    "break_glass:approve",
  ],
  consultancy_partner_administrator: [
    ...MANAGE_WORK,
    "organisation:update",
    "membership:manage",
    "partner_relationship:manage",
    "audit:read",
    "privacy:manage",
  ],
  consultancy_partner_analyst_reviewer: PARTNER_PROPOSE,
  read_only_auditor: [
    ...READ_WORKSPACE,
    "partner_report:read",
    "audit:read",
    "analytics:read",
  ],
  valo_analyst: [
    ...CONTRIBUTE,
    "project:update",
    "project:assign",
    "requirement:review",
    "report:generate",
    "report:export",
    "package:generate",
    "package:export",
    "privacy:read",
    "partner_report:read",
    "analytics:read",
    "configuration:read",
  ],
  valo_quality_adviser: [
    ...REVIEW,
    "draft:write",
    "report:export",
    "package:export",
    "privacy:read",
    "evaluation:manage",
    "rule_pack:manage",
    "partner_report:read",
    "audit:read",
    "analytics:read",
    "configuration:read",
  ],
};

const ROLE_SET = new Set<string>(ORGANISATION_ROLES);
const PERMISSION_SET = new Set<string>(PERMISSIONS);

export function isOrganisationRole(value: unknown): value is OrganisationRole {
  return typeof value === "string" && ROLE_SET.has(value);
}

export function isPermission(value: unknown): value is Permission {
  return typeof value === "string" && PERMISSION_SET.has(value);
}

/** Legacy identity-row roles are compatibility aliases, never tenant grants. */
export function normalizeLegacyRole(value: string): OrganisationRole | null {
  switch (value) {
    case "admin":
      return "valo_operations_administrator";
    case "reviewer":
      return "client_reviewer_approver";
    case "analyst":
      return "contributor";
    case "client_owner":
      return "client_organisation_owner";
    case "client_admin":
      return "client_administrator";
    case "client_reviewer":
      return "client_reviewer_approver";
    case "client_auditor":
      return "read_only_auditor";
    case "valo_operations_admin":
      return "valo_operations_administrator";
    case "platform_admin_restricted":
      return "restricted_platform_administrator";
    case "partner_admin":
      return "consultancy_partner_administrator";
    case "partner_analyst":
    case "partner_reviewer":
      return "consultancy_partner_analyst_reviewer";
    default:
      return isOrganisationRole(value) ? value : null;
  }
}

export function permissionsForRoles(
  roles: readonly OrganisationRole[],
): Set<Permission> {
  const permissions = new Set<Permission>();
  for (const role of roles) {
    for (const permission of ROLE_PERMISSIONS[role])
      permissions.add(permission);
  }
  return permissions;
}

/**
 * A partner membership proves authority in the partner organisation only. An
 * active relationship may project this deliberately small capability set into
 * a client tenant, but never the partner role's native administrative,
 * approval, sign-off, commercial, privacy, or deletion powers. Confirming an
 * extracted requirement and exporting an already-signed package remain
 * available only when the native partner role also carries that permission.
 *
 * Partner co-signing is not yet a persisted, independently-approved workflow,
 * so release permissions are withheld for every partner-derived request. This
 * fails closed for relationships that require co-signing as well as those that
 * do not; client-owned reviewers remain the release authority.
 */
export const PARTNER_DERIVED_PERMISSIONS: ReadonlySet<Permission> = new Set([
  "organisation:read",
  "client:read",
  "project:read",
  "document:read",
  "document:upload",
  "requirement:read",
  "requirement:write",
  "requirement:review",
  "evidence:read",
  "evidence:write",
  "defect:read",
  "defect:write",
  "report:read",
  "report:export",
  "draft:read",
  "draft:write",
  "package:read",
  "package:export",
  "entitlement:read",
  "processing_job:read",
  "evaluation:read",
  "rule_pack:read",
  "partner_report:read",
]);

export function partnerDerivedPermissionsForRoles(
  roles: readonly OrganisationRole[],
): Set<Permission> {
  const nativePermissions = permissionsForRoles(roles);
  return new Set(
    [...PARTNER_DERIVED_PERMISSIONS].filter((permission) =>
      nativePermissions.has(permission),
    ),
  );
}

export function hasPermission(
  roles: readonly OrganisationRole[],
  permission: Permission,
): boolean {
  return roles.some((role) => ROLE_PERMISSIONS[role].includes(permission));
}

export const ORGANISATION_TYPES = [
  "client",
  "valo",
  "consultancy_partner",
] as const;

export type OrganisationType = (typeof ORGANISATION_TYPES)[number];

/** Narrowing guard for values (e.g. persisted rows) claiming to be an organisation type. */
export function isOrganisationType(value: unknown): value is OrganisationType {
  return isOneOf(value, ORGANISATION_TYPES);
}

export function isRoleAllowedForOrganisation(
  role: OrganisationRole,
  type: OrganisationType,
): boolean {
  if (type === "client") {
    return (
      role.startsWith("client_") ||
      role === "bid_manager" ||
      role === "contributor" ||
      role === "read_only_auditor"
    );
  }
  if (type === "consultancy_partner") {
    return (
      role.startsWith("consultancy_partner_") || role === "read_only_auditor"
    );
  }
  return (
    role === "valo_operations_administrator" ||
    role === "restricted_platform_administrator" ||
    role === "valo_analyst" ||
    role === "valo_quality_adviser" ||
    role === "read_only_auditor"
  );
}

/** Prevent delegated administrators from granting a role above themselves. */
export function canGrantRole(
  actorRoles: readonly OrganisationRole[],
  targetRole: OrganisationRole,
): boolean {
  if (actorRoles.includes("client_organisation_owner")) {
    return isRoleAllowedForOrganisation(targetRole, "client");
  }
  if (actorRoles.includes("client_administrator")) {
    return (
      isRoleAllowedForOrganisation(targetRole, "client") &&
      targetRole !== "client_organisation_owner"
    );
  }
  if (actorRoles.includes("consultancy_partner_administrator")) {
    return isRoleAllowedForOrganisation(targetRole, "consultancy_partner");
  }
  if (actorRoles.includes("restricted_platform_administrator")) {
    return isRoleAllowedForOrganisation(targetRole, "valo");
  }
  if (actorRoles.includes("valo_operations_administrator")) {
    return (
      isRoleAllowedForOrganisation(targetRole, "valo") &&
      targetRole !== "restricted_platform_administrator"
    );
  }
  return false;
}

export interface AccessWindow {
  status: string;
  startsAt?: Date | string | null;
  expiresAt?: Date | string | null;
  revokedAt?: Date | string | null;
}

function toMillis(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

export function isActiveAccessWindow(
  window: AccessWindow,
  now = new Date(),
): boolean {
  if (window.status !== "active" || window.revokedAt) return false;
  const nowMs = now.getTime();
  if (window.startsAt && toMillis(window.startsAt) > nowMs) return false;
  // Expiry is exclusive: at the exact deadline access has ended.
  if (window.expiresAt && toMillis(window.expiresAt) <= nowMs) return false;
  return true;
}

/** Null/unscoped resources always fail closed; legacy rows must be migrated. */
export function canAccessResourceOrganisation(
  activeOrganisationId: string | null | undefined,
  resourceOrganisationId: string | null | undefined,
): boolean {
  return Boolean(
    activeOrganisationId &&
    resourceOrganisationId &&
    activeOrganisationId === resourceOrganisationId,
  );
}

/** Accepts W/"3", "3" or 3; absence/invalid values fail closed. */
export function parseExpectedVersion(
  ifMatch: string | undefined,
): number | null {
  if (!ifMatch) return null;
  const match = /^(?:W\/)?"?(\d+)"?$/.exec(ifMatch.trim());
  if (!match) return null;
  const version = Number(match[1]);
  return Number.isSafeInteger(version) && version > 0 ? version : null;
}

export const BREAK_GLASS_ELIGIBLE_PERMISSIONS: ReadonlySet<Permission> =
  new Set([
    "organisation:read",
    "client:read",
    "project:read",
    "document:read",
    "requirement:read",
    "evidence:read",
    "defect:read",
    "report:read",
    "draft:read",
    "package:read",
    "entitlement:read",
    "processing_job:read",
    "evaluation:read",
    "rule_pack:read",
    "partner_report:read",
    "audit:read",
  ]);
