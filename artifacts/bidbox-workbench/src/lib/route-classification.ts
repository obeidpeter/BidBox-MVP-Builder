export const AUTH_PATHS = new Set([
  "/sign-in",
  "/accept-invitation",
  "/sso-callback",
]);

export const PROTECTED_PREFIXES = [
  "/app",
  "/dashboard",
  "/clients",
  "/projects",
  "/intelligence",
  "/portfolio-intelligence",
  "/sbd",
  "/operations",
  "/pursuit-operations",
  "/growth-operations",
  "/opportunity-sources",
  "/client-actions",
  "/portal",
  "/partner",
  "/consortium-room",
  "/evidence-readiness",
  "/evidence-renewals",
  "/reports",
  "/billing",
  "/commercial-retainer",
  "/claims-desk",
  "/notifications",
  "/communications",
  "/privacy-operations",
  "/organisation-settings",
  "/settings",
  "/account",
  "/production-acceptance",
  "/ai-shadow",
  "/field-companion",
] as const;

export type RouteSurface = "public" | "access" | "protected";

export function classifyRoute(location: string): RouteSurface {
  const path = location.split("?", 1)[0] || "/";
  if (AUTH_PATHS.has(path)) return "access";
  if (
    PROTECTED_PREFIXES.some(
      (prefix) => path === prefix || path.startsWith(`${prefix}/`),
    )
  ) {
    return "protected";
  }
  return "public";
}
