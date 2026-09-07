import type { users } from "@workspace/db";
import type { OrganisationRole, Permission } from "./permissions";

/** Server-resolved actor persisted in BidBox's local identity boundary. */
export type LocalUser = typeof users.$inferSelect;

/**
 * Authoritative organisation access resolved from membership, partner
 * relationship, or an approved break-glass session. Domain/application code
 * depends on this inward contract; Express middleware only attaches it.
 */
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
