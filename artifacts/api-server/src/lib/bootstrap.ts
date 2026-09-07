export interface BootstrapIdentity {
  clerkUserId: string;
  email: string;
}

export interface BootstrapOrganisationConfig {
  name: string;
  slug: string;
}

function allowlist(raw: string | undefined, normalise = false): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => (normalise ? value.toLowerCase() : value)),
  );
}

/**
 * Bootstrap is an explicit deployment decision. An empty configuration grants
 * nobody elevated access; being the first database user has no significance.
 */
export function isBootstrapIdentity(
  identity: BootstrapIdentity,
  config: {
    clerkUserIds?: string;
    emails?: string;
  },
): boolean {
  const ids = allowlist(config.clerkUserIds);
  const emails = allowlist(config.emails, true);
  return (
    ids.has(identity.clerkUserId) || emails.has(identity.email.toLowerCase())
  );
}

/**
 * The initial BidBox tenant is a deployment configuration, never an implicit
 * reward for being the first caller. Enabling it without complete, valid
 * values fails loudly instead of guessing an organisation identity.
 */
export function parseBootstrapOrganisationConfig(config: {
  enabled?: string;
  name?: string;
  slug?: string;
}): BootstrapOrganisationConfig | null {
  if (config.enabled !== "true") return null;
  const name = config.name?.trim() ?? "";
  const slug = config.slug?.trim().toLowerCase() ?? "";
  if (
    name.length < 2 ||
    name.length > 160 ||
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(slug)
  ) {
    throw new Error(
      "VALO_BOOTSTRAP_ORGANISATION_NAME/SLUG must identify a valid organisation",
    );
  }
  return { name, slug };
}

export function shouldAutoProvisionBootstrapOrganisation(input: {
  config: BootstrapOrganisationConfig | null;
  identityAllowlisted: boolean;
  userRole: string;
  membershipCount: number;
  organisationCount: number;
}): boolean {
  return Boolean(
    input.config &&
    input.identityAllowlisted &&
    input.userRole === "restricted_platform_administrator" &&
    input.membershipCount === 0 &&
    input.organisationCount === 0,
  );
}
