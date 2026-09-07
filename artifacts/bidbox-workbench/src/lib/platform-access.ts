export const PLATFORM_ROLES = [
  "admin",
  "reviewer",
  "analyst",
  "none",
  "client_owner",
  "client_admin",
  "bid_manager",
  "contributor",
  "client_reviewer",
  "client_auditor",
  "valo_analyst",
  "valo_quality_adviser",
  "valo_operations_admin",
  "platform_admin_restricted",
  "partner_admin",
  "partner_analyst",
  "partner_reviewer",
  "client_organisation_owner",
  "client_administrator",
  "client_reviewer_approver",
  "valo_operations_administrator",
  "restricted_platform_administrator",
  "consultancy_partner_administrator",
  "consultancy_partner_analyst_reviewer",
  "read_only_auditor",
] as const;

export type PlatformRole = (typeof PLATFORM_ROLES)[number];
export type PlatformRoleInput = string | readonly string[] | null | undefined;

const PLATFORM_ROLE_LABELS: Readonly<Record<PlatformRole, string>> = {
  admin: "Administrator",
  reviewer: "Reviewer",
  analyst: "Analyst",
  none: "No role",
  client_owner: "Client organisation owner",
  client_admin: "Client administrator",
  bid_manager: "Bid manager",
  contributor: "Contributor",
  client_reviewer: "Client reviewer",
  client_auditor: "Client auditor",
  valo_analyst: "Valo analyst",
  valo_quality_adviser: "Valo quality adviser",
  valo_operations_admin: "Valo operations administrator",
  platform_admin_restricted: "Restricted platform administrator",
  partner_admin: "Consultancy partner administrator",
  partner_analyst: "Consultancy partner analyst",
  partner_reviewer: "Consultancy partner reviewer",
  client_organisation_owner: "Client organisation owner",
  client_administrator: "Client administrator",
  client_reviewer_approver: "Client reviewer / approver",
  valo_operations_administrator: "Valo operations administrator",
  restricted_platform_administrator: "Restricted platform administrator",
  consultancy_partner_administrator: "Consultancy partner administrator",
  consultancy_partner_analyst_reviewer:
    "Consultancy partner analyst / reviewer",
  read_only_auditor: "Read-only auditor",
};

export function platformRoleLabel(role: string): string {
  return (
    PLATFORM_ROLE_LABELS[role as PlatformRole] ??
    role
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ")
  );
}

export type PlatformArea =
  | "workbench"
  | "pursuit_workbench"
  | "pursuit_operations"
  | "operations"
  | "growth_operations"
  | "opportunity_sources"
  | "client_actions"
  | "production_acceptance"
  | "ai_shadow"
  | "field_companion"
  | "privacy_operations"
  | "client_portal"
  | "partner_workspace"
  | "evidence_readiness"
  | "billing_entitlements"
  | "commercial_retainer"
  | "portfolio_intelligence"
  | "claims_desk"
  | "communications"
  | "notifications"
  | "security_audit"
  | "organisation_settings"
  | "settings";

export type CommercialFeature =
  | "clientPortal"
  | "partnerWorkspace"
  | "billingEntitlements"
  | "notificationAdapters";

export interface PlatformFeatureFlags {
  clientPortal: boolean;
  partnerWorkspace: boolean;
  billingEntitlements: boolean;
  notificationAdapters: boolean;
}

export interface PlatformAccessDecision {
  area: PlatformArea;
  allowed: boolean;
  enabled: boolean;
  state: "active" | "pending_activation" | "denied";
  reason: string;
}

export type PlatformAccessSource = "membership" | "partner";

export interface PlatformNavItem {
  href: string;
  label: string;
  area: PlatformArea;
  group: "Workspace" | "Delivery" | "Oversight" | "Administration";
  feature?: CommercialFeature;
  requiredPermission?: string;
  requiredPermissions?: readonly string[];
}

export const INTELLIGENCE_READ_PERMISSIONS = [
  "client:read",
  "project:read",
  "document:read",
  "requirement:read",
  "evidence:read",
  "defect:read",
  "report:read",
  "draft:read",
  "package:read",
  "evaluation:read",
] as const;

export const PORTFOLIO_INTELLIGENCE_READ_PERMISSIONS = [
  "project:read",
  "draft:read",
  "defect:read",
  "package:read",
  "analytics:read",
] as const;

const CLIENT_ROLES = new Set<PlatformRole>([
  "client_owner",
  "client_admin",
  "bid_manager",
  "contributor",
  "client_reviewer",
  "client_organisation_owner",
  "client_administrator",
  "client_reviewer_approver",
]);

const PARTNER_ROLES = new Set<PlatformRole>([
  "partner_admin",
  "partner_analyst",
  "partner_reviewer",
  "consultancy_partner_administrator",
  "consultancy_partner_analyst_reviewer",
]);

const INTERNAL_ROLES = new Set<PlatformRole>([
  "admin",
  "reviewer",
  "analyst",
  "valo_analyst",
  "valo_quality_adviser",
  "valo_operations_admin",
  "valo_operations_administrator",
]);

const ADMIN_ROLES = new Set<PlatformRole>([
  "admin",
  "valo_operations_admin",
  "platform_admin_restricted",
  "valo_operations_administrator",
  "restricted_platform_administrator",
]);

const SETTINGS_ROLES = new Set<PlatformRole>([
  "admin",
  "valo_operations_admin",
  "valo_operations_administrator",
]);

const PURSUIT_ROLES = new Set<PlatformRole>([
  ...INTERNAL_ROLES,
  ...CLIENT_ROLES,
  ...PARTNER_ROLES,
  "read_only_auditor",
  "client_auditor",
]);

const GROWTH_OPERATIONS_ROLES = new Set<PlatformRole>([...PURSUIT_ROLES]);

const COMMERCIAL_RETAINER_ROLES = new Set<PlatformRole>([
  ...INTERNAL_ROLES,
  ...CLIENT_ROLES,
  ...PARTNER_ROLES,
]);

const PRODUCTION_ACCEPTANCE_ROLES = new Set<PlatformRole>([
  "admin",
  "valo_operations_admin",
  "valo_operations_administrator",
  "valo_quality_adviser",
  "platform_admin_restricted",
  "restricted_platform_administrator",
]);

const QUALITY_ROLES = new Set<PlatformRole>([
  "admin",
  "reviewer",
  "analyst",
  "valo_analyst",
  "valo_quality_adviser",
  "valo_operations_admin",
  "client_owner",
  "client_admin",
  "bid_manager",
  "client_reviewer",
  "client_auditor",
  "partner_admin",
  "partner_analyst",
  "partner_reviewer",
  "client_organisation_owner",
  "client_administrator",
  "client_reviewer_approver",
  "consultancy_partner_administrator",
  "consultancy_partner_analyst_reviewer",
  "read_only_auditor",
]);

const AREA_ROLES: Record<PlatformArea, ReadonlySet<PlatformRole>> = {
  workbench: INTERNAL_ROLES,
  // These roles carry project/requirement/evidence/report read permissions in
  // their selected server-authorised context. Related client contexts are
  // listed only after the backend validates the partner membership,
  // relationship lifecycle and commercial activation; the client is never
  // inferred from the role.
  pursuit_workbench: PURSUIT_ROLES,
  pursuit_operations: PURSUIT_ROLES,
  operations: INTERNAL_ROLES,
  growth_operations: GROWTH_OPERATIONS_ROLES,
  opportunity_sources: PURSUIT_ROLES,
  client_actions: PURSUIT_ROLES,
  production_acceptance: PRODUCTION_ACCEPTANCE_ROLES,
  ai_shadow: PRODUCTION_ACCEPTANCE_ROLES,
  field_companion: PURSUIT_ROLES,
  privacy_operations: QUALITY_ROLES,
  client_portal: new Set<PlatformRole>(["admin", ...CLIENT_ROLES]),
  partner_workspace: new Set<PlatformRole>(["admin", ...PARTNER_ROLES]),
  evidence_readiness: QUALITY_ROLES,
  billing_entitlements: new Set<PlatformRole>([
    "admin",
    "valo_operations_admin",
    "valo_operations_administrator",
    "client_owner",
    "client_admin",
    "partner_admin",
    "client_organisation_owner",
    "client_administrator",
    "consultancy_partner_administrator",
  ]),
  commercial_retainer: COMMERCIAL_RETAINER_ROLES,
  portfolio_intelligence: PURSUIT_ROLES,
  claims_desk: PURSUIT_ROLES,
  communications: new Set<PlatformRole>([
    ...INTERNAL_ROLES,
    ...CLIENT_ROLES,
    ...PARTNER_ROLES,
  ]),
  notifications: new Set<PlatformRole>([
    ...INTERNAL_ROLES,
    ...CLIENT_ROLES,
    ...PARTNER_ROLES,
  ]),
  security_audit: new Set<PlatformRole>([
    ...ADMIN_ROLES,
    "read_only_auditor",
    "client_auditor",
  ]),
  organisation_settings: new Set<PlatformRole>([
    "admin",
    "valo_operations_admin",
    "valo_operations_administrator",
    "client_owner",
    "client_admin",
    "client_organisation_owner",
    "client_administrator",
    "partner_admin",
    "consultancy_partner_administrator",
  ]),
  settings: SETTINGS_ROLES,
};

const AREA_FEATURE: Partial<Record<PlatformArea, CommercialFeature>> = {
  client_portal: "clientPortal",
  partner_workspace: "partnerWorkspace",
  billing_entitlements: "billingEntitlements",
  notifications: "notificationAdapters",
};

const AREA_REQUIRED_PERMISSION: Partial<Record<PlatformArea, string>> = {
  workbench: "analytics:read",
  pursuit_workbench: "project:read",
  pursuit_operations: "project:read",
  operations: "project:read",
  growth_operations: "organisation:read",
  opportunity_sources: "organisation:read",
  client_actions: "project:read",
  production_acceptance: "audit:read",
  ai_shadow: "evaluation:read",
  field_companion: "project:read",
  privacy_operations: "privacy:read",
  client_portal: "project:read",
  partner_workspace: "partner_relationship:read",
  evidence_readiness: "evidence:read",
  billing_entitlements: "entitlement:read",
  communications: "project:read",
  notifications: "project:read",
  claims_desk: "project:read",
  security_audit: "audit:read",
  organisation_settings: "membership:manage",
  settings: "configuration:manage",
};

const AREA_REQUIRED_PERMISSIONS: Partial<
  Record<PlatformArea, readonly string[]>
> = {
  commercial_retainer: ["billing:read", "entitlement:read"],
  portfolio_intelligence: PORTFOLIO_INTELLIGENCE_READ_PERMISSIONS,
};

const NAV_ITEMS: PlatformNavItem[] = [
  {
    href: "/app",
    label: "Dashboard",
    area: "workbench",
    group: "Workspace",
  },
  {
    href: "/projects",
    label: "Pursuits",
    area: "pursuit_workbench",
    group: "Workspace",
    requiredPermission: "project:read",
  },
  {
    href: "/opportunity-sources",
    label: "Opportunity sources",
    area: "opportunity_sources",
    group: "Workspace",
    requiredPermission: "organisation:read",
  },
  {
    href: "/intelligence",
    label: "Bid insights",
    area: "pursuit_workbench",
    group: "Workspace",
    requiredPermissions: INTELLIGENCE_READ_PERMISSIONS,
  },
  {
    href: "/portal",
    label: "Client workspace",
    area: "client_portal",
    group: "Workspace",
    feature: "clientPortal",
    requiredPermission: "project:read",
  },
  {
    href: "/client-actions",
    label: "Client requests",
    area: "client_actions",
    group: "Workspace",
    requiredPermission: "project:read",
  },
  {
    href: "/partner",
    label: "Partner workspace",
    area: "partner_workspace",
    group: "Workspace",
    feature: "partnerWorkspace",
    requiredPermission: "partner_relationship:read",
  },
  {
    href: "/consortium-room",
    label: "Consortium workspace",
    area: "partner_workspace",
    group: "Workspace",
    feature: "partnerWorkspace",
    requiredPermissions: ["partner_relationship:read", "project:read"],
  },
  {
    href: "/sbd",
    label: "Requirements & compliance",
    area: "pursuit_workbench",
    group: "Delivery",
    requiredPermission: "requirement:read",
  },
  {
    href: "/evidence-readiness",
    label: "Evidence library",
    area: "evidence_readiness",
    group: "Delivery",
    requiredPermission: "evidence:read",
  },
  {
    href: "/pursuit-operations",
    label: "Pursuit workflows",
    area: "pursuit_operations",
    group: "Delivery",
    requiredPermission: "project:read",
  },
  {
    href: "/field-companion",
    label: "Field notes",
    area: "field_companion",
    group: "Delivery",
    requiredPermission: "project:read",
  },
  {
    href: "/operations",
    label: "Operations",
    area: "operations",
    group: "Delivery",
    requiredPermission: "project:read",
  },
  {
    href: "/reports",
    label: "Reports",
    area: "pursuit_workbench",
    group: "Delivery",
    requiredPermission: "report:read",
  },
  {
    href: "/clients",
    label: "Clients",
    area: "pursuit_workbench",
    group: "Oversight",
    requiredPermission: "client:read",
  },
  {
    href: "/portfolio-intelligence",
    label: "Portfolio intelligence",
    area: "portfolio_intelligence",
    group: "Oversight",
    requiredPermission: "analytics:read",
  },
  {
    href: "/growth-operations",
    label: "Leads & offers",
    area: "growth_operations",
    group: "Oversight",
    requiredPermission: "organisation:read",
  },
  {
    href: "/billing",
    label: "Billing & access",
    area: "billing_entitlements",
    group: "Oversight",
    feature: "billingEntitlements",
    requiredPermission: "entitlement:read",
  },
  {
    href: "/commercial-retainer",
    label: "Quotes, invoices & retainers",
    area: "commercial_retainer",
    group: "Oversight",
    requiredPermissions: ["billing:read", "entitlement:read"],
  },
  {
    href: "/claims-desk",
    label: "Claims",
    area: "claims_desk",
    group: "Oversight",
    requiredPermission: "project:read",
  },
  {
    href: "/notifications",
    label: "Notifications",
    area: "notifications",
    group: "Oversight",
    feature: "notificationAdapters",
    requiredPermission: "project:read",
  },
  {
    href: "/communications",
    label: "Communication log",
    area: "communications",
    group: "Oversight",
    requiredPermission: "project:read",
  },
  {
    href: "/app/security",
    label: "Security & audit",
    area: "security_audit",
    group: "Administration",
    requiredPermission: "audit:read",
  },
  {
    href: "/privacy-operations",
    label: "Privacy requests",
    area: "privacy_operations",
    group: "Administration",
    requiredPermission: "privacy:read",
  },
  {
    href: "/production-acceptance",
    label: "Release checks",
    area: "production_acceptance",
    group: "Administration",
    requiredPermission: "audit:read",
  },
  {
    href: "/ai-shadow",
    label: "AI testing programme",
    area: "ai_shadow",
    group: "Administration",
    requiredPermission: "evaluation:read",
  },
  {
    href: "/organisation-settings",
    label: "Organisation settings",
    area: "organisation_settings",
    group: "Administration",
    requiredPermission: "membership:manage",
  },
  {
    href: "/settings",
    label: "Platform settings",
    area: "settings",
    group: "Administration",
    requiredPermission: "configuration:manage",
  },
];

function enabled(value: unknown): boolean {
  return typeof value === "string" && value.toLowerCase() === "true";
}

export function platformFeatureFlags(
  env: Record<string, unknown> = import.meta.env,
): PlatformFeatureFlags {
  return {
    clientPortal: enabled(env.VITE_FEATURE_CLIENT_PORTAL),
    partnerWorkspace: enabled(env.VITE_FEATURE_PARTNER_WORKSPACE),
    billingEntitlements: enabled(env.VITE_FEATURE_BILLING_ENTITLEMENTS),
    notificationAdapters: enabled(env.VITE_FEATURE_NOTIFICATION_ADAPTERS),
  };
}

export function normalizePlatformRole(
  role: string | null | undefined,
): PlatformRole | null {
  return PLATFORM_ROLES.includes(role as PlatformRole)
    ? (role as PlatformRole)
    : null;
}

export function normalizePlatformRoles(
  role: PlatformRoleInput,
): PlatformRole[] {
  const values = Array.isArray(role) ? role : role ? [role] : [];
  return Array.from(
    new Set(
      values.flatMap((value) => {
        const normalized = normalizePlatformRole(value);
        return normalized ? [normalized] : [];
      }),
    ),
  );
}

export function isClientRole(role: PlatformRoleInput): boolean {
  return normalizePlatformRoles(role).some((normalized) =>
    CLIENT_ROLES.has(normalized),
  );
}

export function isPartnerRole(role: PlatformRoleInput): boolean {
  return normalizePlatformRoles(role).some((normalized) =>
    PARTNER_ROLES.has(normalized),
  );
}

export function isInternalRole(role: PlatformRoleInput): boolean {
  return normalizePlatformRoles(role).some((normalized) =>
    INTERNAL_ROLES.has(normalized),
  );
}

export function platformHomeForRole(
  role: PlatformRoleInput,
  flags: PlatformFeatureFlags = platformFeatureFlags(),
  effectivePermissions?: readonly string[],
): string {
  const permits = (permission: string): boolean =>
    effectivePermissions === undefined ||
    effectivePermissions.includes(permission);
  if (isInternalRole(role)) return "/app";
  if (isClientRole(role) && permits("project:read"))
    return flags.clientPortal ? "/portal" : "/projects";
  if (isPartnerRole(role)) {
    if (permits("partner_relationship:read")) return "/partner";
    if (permits("project:read")) return "/projects";
  }
  const roles = normalizePlatformRoles(role);
  if (
    roles.includes("platform_admin_restricted") ||
    roles.includes("restricted_platform_administrator")
  ) {
    return "/app/security";
  }
  if (roles.includes("read_only_auditor") || roles.includes("client_auditor")) {
    return "/evidence-readiness";
  }
  return "/app";
}

export function getPlatformAccessDecision(
  role: PlatformRoleInput,
  area: PlatformArea,
  flags: PlatformFeatureFlags = platformFeatureFlags(),
  effectivePermissions?: readonly string[],
  accessSource?: PlatformAccessSource,
): PlatformAccessDecision {
  const normalized = normalizePlatformRoles(role);
  const allowed = normalized.some((assignedRole) =>
    AREA_ROLES[area].has(assignedRole),
  );
  if (!allowed) {
    return {
      area,
      allowed: false,
      enabled: false,
      state: "denied",
      reason: "Your role does not include access to this page.",
    };
  }

  const requiredPermission = AREA_REQUIRED_PERMISSION[area];
  if (
    requiredPermission &&
    effectivePermissions !== undefined &&
    !effectivePermissions.includes(requiredPermission)
  ) {
    return {
      area,
      allowed: false,
      enabled: false,
      state: "denied",
      reason:
        "Your role in the selected organisation does not include the required permission.",
    };
  }

  const requiredPermissions = AREA_REQUIRED_PERMISSIONS[area];
  if (
    requiredPermissions &&
    effectivePermissions !== undefined &&
    !requiredPermissions.every((permission) =>
      effectivePermissions.includes(permission),
    )
  ) {
    return {
      area,
      allowed: false,
      enabled: false,
      state: "denied",
      reason:
        "Your role in the selected organisation is missing one or more required permissions.",
    };
  }

  if (
    [
      "growth_operations",
      "opportunity_sources",
      "client_actions",
      "production_acceptance",
      "ai_shadow",
      "field_companion",
      "privacy_operations",
      "commercial_retainer",
      "portfolio_intelligence",
      "claims_desk",
      "communications",
    ].includes(area) &&
    accessSource !== "membership"
  ) {
    return {
      area,
      allowed: false,
      enabled: false,
      state: "denied",
      reason:
        "You need a direct membership in the selected organisation to use this page.",
    };
  }

  const feature = AREA_FEATURE[area];
  const featureEnabled = feature ? flags[feature] : true;
  if (!featureEnabled) {
    return {
      area,
      allowed: true,
      enabled: false,
      state: "pending_activation",
      reason: "This feature is not active yet.",
    };
  }

  return {
    area,
    allowed: true,
    enabled: true,
    state: "active",
    reason: "You have access to this page.",
  };
}

export function navigationForRole(
  role: PlatformRoleInput,
  flags: PlatformFeatureFlags = platformFeatureFlags(),
  effectivePermissions?: readonly string[],
  accessSource?: PlatformAccessSource,
): Array<PlatformNavItem & { state: PlatformAccessDecision["state"] }> {
  return NAV_ITEMS.flatMap((item) => {
    const decision = getPlatformAccessDecision(
      role,
      item.area,
      flags,
      effectivePermissions,
      accessSource,
    );
    const singlePermissionAllowed =
      !item.requiredPermission ||
      effectivePermissions === undefined ||
      effectivePermissions.includes(item.requiredPermission);
    const permissionSetAllowed =
      !item.requiredPermissions ||
      effectivePermissions === undefined ||
      item.requiredPermissions.every((permission) =>
        effectivePermissions.includes(permission),
      );
    return decision.allowed && singlePermissionAllowed && permissionSetAllowed
      ? [{ ...item, state: decision.state }]
      : [];
  });
}
