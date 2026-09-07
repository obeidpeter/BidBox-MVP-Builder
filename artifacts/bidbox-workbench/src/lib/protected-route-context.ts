import type { PlatformArea } from "@/lib/platform-access";

export interface ProtectedRouteContext {
  title: string;
  helpTitle: string;
  purpose: string;
  area?: PlatformArea;
  requiredPermissions: readonly string[];
  keyTerms: readonly { term: string; meaning: string }[];
  example: string;
  nextAction: string;
}

const MANUAL_TOPIC_BY_ROUTE: ReadonlyArray<{
  prefixes: readonly string[];
  topic: string;
}> = [
  {
    prefixes: ["/projects"],
    topic: "pursuits-the-register-and-the-workspace",
  },
  {
    prefixes: ["/clients"],
    topic: "clients-the-certificate-vault-and-the-capability-library",
  },
  {
    prefixes: ["/sbd"],
    topic: "compliance-corpus-standard-bidding-documents-sbd",
  },
  { prefixes: ["/intelligence"], topic: "intelligence-centre-intelligence" },
  {
    prefixes: ["/operations", "/pursuit-operations"],
    topic: "operations-consoles-internal-roles",
  },
  {
    prefixes: ["/field-companion"],
    topic: "field-companion-field-companion-offline-notes-done-safely",
  },
  {
    prefixes: ["/growth-operations", "/opportunity-sources"],
    topic: "getting-started-offers-and-opportunity-sources",
  },
  {
    prefixes: ["/portal", "/client-actions"],
    topic: "the-client-facing-rooms",
  },
  {
    prefixes: ["/partner", "/consortium-room"],
    topic: "partner-workspaces",
  },
  {
    prefixes: [
      "/evidence-readiness",
      "/evidence-renewals",
      "/reports",
      "/portfolio-intelligence",
    ],
    topic: "evidence-renewals-reports-and-portfolio-intelligence",
  },
  {
    prefixes: ["/billing", "/commercial-retainer", "/claims-desk"],
    topic: "commercial-surfaces",
  },
  {
    prefixes: ["/notifications", "/communications"],
    topic: "notifications-and-communication-receipts",
  },
  {
    prefixes: [
      "/app/security",
      "/privacy-operations",
      "/production-acceptance",
      "/ai-shadow",
      "/organisation-settings",
      "/settings",
      "/account",
    ],
    topic: "administration",
  },
  {
    prefixes: ["/app", "/dashboard"],
    topic: "the-dashboard-internal-roles",
  },
];

export function getProtectedRouteManualTopic(location: string): string {
  const pathname = location.split("?", 1)[0].replace(/\/$/, "") || "/";
  return (
    MANUAL_TOPIC_BY_ROUTE.find(({ prefixes }) =>
      prefixes.some(
        (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
      ),
    )?.topic ?? "finding-your-way-around"
  );
}

const PROJECT_TAB_CONTEXTS: Readonly<Record<string, ProtectedRouteContext>> = {
  overview: {
    title: "Overview · Pursuit",
    helpTitle: "Pursuit overview and next actions",
    purpose:
      "Shows recorded governance facts, readiness checks, blockers and the first available next action.",
    area: "pursuit_workbench",
    requiredPermissions: ["project:read"],
    keyTerms: [
      {
        term: "Required blocker",
        meaning:
          "A failed check that prevents the readiness verdict from passing.",
      },
      {
        term: "Advisory warning",
        meaning:
          "A review item that does not by itself make the required gate fail.",
      },
    ],
    example:
      "If evidence coverage is blocked, Overview identifies that register without claiming the pursuit is ready.",
    nextAction:
      "Open the first blocker shown under Pursuit readiness and complete its stated action.",
  },
  documents: {
    title: "Documents · Pursuit",
    helpTitle: "Tender document register",
    purpose:
      "Tracks the authorised source files and the intake or extraction state exposed by the project.",
    area: "pursuit_workbench",
    requiredPermissions: ["project:read", "document:read"],
    keyTerms: [
      {
        term: "Source document",
        meaning: "A file recorded as input to this pursuit.",
      },
      {
        term: "Extraction",
        meaning: "Structured content derived from a recorded source file.",
      },
    ],
    example:
      "A file can be present while extraction is still pending; those are different states.",
    nextAction:
      "Review the visible file status, use its first enabled action, then return to Overview for the next blocker.",
  },
  requirements: {
    title: "Requirements · Pursuit",
    helpTitle: "Requirement register",
    purpose:
      "Supports human review of tender obligations and their mandatory or advisory classification.",
    area: "pursuit_workbench",
    requiredPermissions: ["project:read", "requirement:read"],
    keyTerms: [
      {
        term: "Mandatory requirement",
        meaning: "An obligation marked as required by the tender record.",
      },
      {
        term: "Human review",
        meaning: "A recorded reviewer decision, not an automated assumption.",
      },
    ],
    example:
      "A suggested requirement is not treated as reviewed until the register records that decision.",
    nextAction:
      "Review the first visible unreviewed requirement and record the human decision available on the page.",
  },
  evidence: {
    title: "Evidence · Pursuit",
    helpTitle: "Evidence and compliance register",
    purpose:
      "Maps recorded evidence to reviewed requirements and exposes gaps without inventing coverage.",
    area: "pursuit_workbench",
    requiredPermissions: ["project:read", "requirement:read", "evidence:read"],
    keyTerms: [
      {
        term: "Evidence mapping",
        meaning: "A recorded relationship between evidence and a requirement.",
      },
      {
        term: "Coverage gap",
        meaning: "A reviewed requirement without sufficient recorded evidence.",
      },
    ],
    example:
      "Uploading a file does not prove coverage until the relevant evidence mapping is recorded.",
    nextAction:
      "Open the first visible mandatory coverage gap and record or review the evidence mapping it requests.",
  },
  boq: {
    title: "BOQ · Pursuit",
    helpTitle: "BOQ checks",
    purpose:
      "Shows the bill-of-quantities checks recorded for the pursuit and their current result.",
    area: "pursuit_workbench",
    requiredPermissions: ["project:read", "document:read"],
    keyTerms: [
      {
        term: "BOQ",
        meaning:
          "The bill of quantities supplied for pricing or commercial review.",
      },
      {
        term: "Check result",
        meaning: "The result currently recorded by a specific BOQ check.",
      },
    ],
    example:
      "A passed arithmetic check does not imply that every commercial term has been approved.",
    nextAction:
      "Review the first non-passing visible BOQ check and follow the action attached to that result.",
  },
  reports: {
    title: "Package and export · Pursuit",
    helpTitle: "Package and export",
    purpose:
      "Shows report versions, human sign-off state and the controlled package export path.",
    area: "pursuit_workbench",
    requiredPermissions: ["project:read", "report:read"],
    keyTerms: [
      {
        term: "Sign-off",
        meaning:
          "A recorded internal approval; it is not proof of buyer receipt.",
      },
      {
        term: "Export",
        meaning:
          "Creation of a package; it is not proof of external submission.",
      },
    ],
    example:
      "An exported package can still lack any external-delivery receipt in BidBox.",
    nextAction:
      "Use the first enabled response or package action; if every action is blocked, open Overview for the reported prerequisite.",
  },
  defects: {
    title: "Red-team review · Pursuit",
    helpTitle: "Issues and independent review",
    purpose:
      "Records defects and independent review findings that may block readiness.",
    area: "pursuit_workbench",
    requiredPermissions: ["project:read", "defect:read"],
    keyTerms: [
      {
        term: "Fatal defect",
        meaning: "A recorded issue classified as a submission-blocking risk.",
      },
      {
        term: "Independent review",
        meaning: "A review recorded separately from response preparation.",
      },
    ],
    example:
      "Closing a minor issue does not clear a separate open fatal defect.",
    nextAction:
      "Open the highest-severity unresolved finding shown and use its available resolution action.",
  },
  risk: {
    title: "Risk review · Pursuit",
    helpTitle: "Pursuit risk review",
    purpose:
      "Shows the currently recorded risk assessment and its supporting factors.",
    area: "pursuit_workbench",
    requiredPermissions: ["project:read"],
    keyTerms: [
      {
        term: "Risk band",
        meaning:
          "The band produced by the recorded assessment, not an external guarantee.",
      },
      {
        term: "Risk factor",
        meaning: "A recorded input contributing to the assessment.",
      },
    ],
    example:
      "A low recorded band does not prove that an authority will accept the submission.",
    nextAction:
      "Review the visible risk factors, then resolve the first action identified by the current assessment.",
  },
  delivery: {
    title: "Delivery studio · Pursuit",
    helpTitle: "Delivery studio",
    purpose:
      "Coordinates Response Studio, red-team review, package assembly and rehearsal gates currently available for delivery preparation.",
    area: "pursuit_workbench",
    requiredPermissions: [
      "project:read",
      "draft:read",
      "defect:read",
      "package:read",
    ],
    keyTerms: [
      {
        term: "Gate",
        meaning: "A prerequisite whose visible state controls a later action.",
      },
      {
        term: "Receipt",
        meaning:
          "Explicit evidence of delivery; do not infer it from export or sign-off.",
      },
    ],
    example:
      "Package export can be recorded while buyer receipt remains unrecorded.",
    nextAction:
      "Follow the first incomplete visible gate; treat only an explicit receipt label as evidence of receipt.",
  },
  audit: {
    title: "Audit record · Pursuit",
    helpTitle: "Activity and audit record",
    purpose:
      "Shows the immutable activity records available to this signed-in organisation context.",
    area: "pursuit_workbench",
    requiredPermissions: ["project:read", "audit:read"],
    keyTerms: [
      {
        term: "Audit event",
        meaning:
          "A recorded action with the actor and time exposed by the service.",
      },
      {
        term: "Absence of evidence",
        meaning:
          "No visible event does not prove an action never occurred elsewhere.",
      },
    ],
    example:
      "Use the recorded export event as evidence of export, not as evidence of buyer receipt.",
    nextAction:
      "Filter or inspect the event relevant to your review and use only the facts recorded in that event.",
  },
};

interface RouteDefinition {
  path: string;
  title: string;
  area?: PlatformArea;
  permissions?: readonly string[];
}

const ROUTES: readonly RouteDefinition[] = [
  {
    path: "/app/security",
    title: "Security and audit",
    area: "security_audit",
    permissions: ["audit:read"],
  },
  {
    path: "/portfolio-intelligence",
    title: "Portfolio intelligence",
    area: "portfolio_intelligence",
    permissions: ["analytics:read"],
  },
  {
    path: "/production-acceptance",
    title: "Production acceptance",
    area: "production_acceptance",
    permissions: ["audit:read"],
  },
  {
    path: "/organisation-settings",
    title: "Organisation settings",
    area: "organisation_settings",
    permissions: ["organisation:read"],
  },
  {
    path: "/evidence-readiness",
    title: "Evidence readiness",
    area: "evidence_readiness",
    permissions: ["evidence:read"],
  },
  {
    path: "/evidence-renewals",
    title: "Evidence renewals",
    area: "evidence_readiness",
    permissions: ["evidence:read"],
  },
  {
    path: "/pursuit-operations",
    title: "Pursuit operations",
    area: "pursuit_operations",
    permissions: ["project:read"],
  },
  {
    path: "/growth-operations",
    title: "Growth operations",
    area: "growth_operations",
    permissions: ["organisation:read"],
  },
  {
    path: "/opportunity-sources",
    title: "Opportunity sources",
    area: "opportunity_sources",
    permissions: ["organisation:read"],
  },
  {
    path: "/field-companion",
    title: "Field companion",
    area: "field_companion",
    permissions: ["project:read"],
  },
  {
    path: "/commercial-retainer",
    title: "Commercial retainer",
    area: "commercial_retainer",
  },
  {
    path: "/privacy-operations",
    title: "Privacy operations",
    area: "privacy_operations",
    permissions: ["audit:read"],
  },
  {
    path: "/consortium-room",
    title: "Consortium room",
    area: "partner_workspace",
  },
  {
    path: "/client-actions",
    title: "Client actions",
    area: "client_actions",
    permissions: ["project:read"],
  },
  { path: "/claims-desk", title: "Claims desk", area: "claims_desk" },
  { path: "/communications", title: "Communications", area: "communications" },
  { path: "/notifications", title: "Notifications", area: "notifications" },
  {
    path: "/intelligence",
    title: "Intelligence",
    area: "pursuit_workbench",
    permissions: ["analytics:read"],
  },
  {
    path: "/operations",
    title: "Operations",
    area: "operations",
    permissions: ["project:read"],
  },
  {
    path: "/reports",
    title: "Reports",
    area: "pursuit_workbench",
    permissions: ["report:read"],
  },
  {
    path: "/billing",
    title: "Billing and entitlements",
    area: "billing_entitlements",
  },
  { path: "/partner", title: "Partner workspace", area: "partner_workspace" },
  { path: "/portal", title: "Client portal", area: "client_portal" },
  {
    path: "/clients",
    title: "Clients",
    area: "pursuit_workbench",
    permissions: ["client:read"],
  },
  {
    path: "/projects",
    title: "Pursuits",
    area: "pursuit_workbench",
    permissions: ["project:read"],
  },
  {
    path: "/sbd",
    title: "SBD library",
    area: "pursuit_workbench",
    permissions: ["rule_pack:read"],
  },
  {
    path: "/ai-shadow",
    title: "AI shadow review",
    area: "ai_shadow",
    permissions: ["evaluation:read"],
  },
  { path: "/settings", title: "Settings", area: "settings" },
  { path: "/account", title: "Profile" },
  { path: "/dashboard", title: "Dashboard", area: "workbench" },
  { path: "/app", title: "Dashboard", area: "workbench" },
];

function generalContext(definition: RouteDefinition): ProtectedRouteContext {
  return {
    title: definition.title,
    helpTitle: `${definition.title} help`,
    purpose: `Explains and provides access to the ${definition.title.toLowerCase()} records available in the selected organisation context.`,
    area: definition.area,
    requiredPermissions: definition.permissions ?? [],
    keyTerms: [
      {
        term: "Selected organisation",
        meaning:
          "The server-authorised organisation context used for the records on this page.",
      },
      {
        term: "Permission",
        meaning:
          "A capability granted by the active membership or validated partner context.",
      },
    ],
    example:
      "If an action is unavailable, its visible access state takes precedence over a role label alone.",
    nextAction:
      "Review the page status, then use the first enabled action that matches your task.",
  };
}

export function getProtectedRouteContext(
  location: string,
  searchParams: URLSearchParams = new URLSearchParams(),
): ProtectedRouteContext {
  const pathname = location.split("?")[0].replace(/\/$/, "") || "/";

  if (pathname === "/help") {
    return {
      title: "Help & user manual",
      helpTitle: "Using the Help & user manual",
      purpose:
        "Provides searchable, release-matched guidance without opening customer records or changing organisation access.",
      requiredPermissions: [],
      keyTerms: [
        {
          term: "Manual guidance",
          meaning:
            "An explanation of BidBox workflows and boundaries; it never grants access or overrides the current on-screen state.",
        },
        {
          term: "Topic search",
          meaning:
            "A local search across the manual headings and guidance included in this BidBox release.",
        },
      ],
      example:
        "Search for “blocked” to find the diagnostic guide, then follow the exact message shown on the authoritative workspace page.",
      nextAction:
        "Search for your task or choose a topic from the table of contents.",
    };
  }

  if (/^\/projects\/[^/]+\/tender-context$/.test(pathname)) {
    return {
      ...generalContext({
        path: pathname,
        title: "Tender context",
        area: "pursuit_workbench",
        permissions: [
          "project:read",
          "document:read",
          "requirement:read",
          "evidence:read",
          "rule_pack:read",
        ],
      }),
      purpose:
        "Shows tender-source context only when every required read permission is present.",
      nextAction:
        "Review the visible source context; if access is blocked, request the missing permission listed here.",
    };
  }

  if (/^\/projects\/[^/]+$/.test(pathname)) {
    const tab = searchParams.get("tab") ?? "overview";
    return PROJECT_TAB_CONTEXTS[tab] ?? PROJECT_TAB_CONTEXTS.overview;
  }

  if (/^\/clients\/[^/]+$/.test(pathname)) {
    return generalContext({
      path: pathname,
      title: "Client details",
      area: "pursuit_workbench",
      permissions: ["client:read"],
    });
  }
  if (/^\/sbd\/[^/]+$/.test(pathname)) {
    return generalContext({
      path: pathname,
      title: "SBD document",
      area: "pursuit_workbench",
      permissions: ["rule_pack:read"],
    });
  }

  const definition = ROUTES.find(
    (route) => pathname === route.path || pathname.startsWith(`${route.path}/`),
  );
  if (definition) return generalContext(definition);

  return {
    title: "Page not found",
    helpTitle: "Page help",
    purpose: "No protected BidBox page matches this address.",
    requiredPermissions: [],
    keyTerms: [
      {
        term: "Protected route",
        meaning: "A page available only after an authenticated access check.",
      },
    ],
    example: "A stale bookmark can point to a page that no longer exists.",
    nextAction:
      "Use the primary navigation to open an available workspace page.",
  };
}
