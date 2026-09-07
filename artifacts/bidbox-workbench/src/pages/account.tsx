import { UserProfile } from "@clerk/clerk-react";
import { useGetMe } from "@workspace/api-client-react";
import { PageHeader } from "@/components/platform-states";
import { ValoUserIdCard } from "@/components/valo-user-id-card";
import { useOrganisationAccess } from "@/contexts/organisation-context";
import { platformRoleLabel } from "@/lib/platform-access";

export default function AccountPage() {
  const access = useOrganisationAccess();
  const meQuery = useGetMe();
  return (
    <div className="mx-auto w-full max-w-6xl space-y-7 p-5 sm:p-8">
      <PageHeader
        eyebrow="Account and identity"
        title="Profile and security"
        description="Manage your sign-in profile and security. Organisation administrators manage roles and access separately."
        state="active"
      />
      <section className="rounded-lg border border-border bg-card p-5">
        <h2 className="text-sm font-semibold">
          Current organisation and roles
        </h2>
        <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Organisation</dt>
            <dd className="mt-1 font-medium">
              {access?.activeOrganisation?.name ?? "Not selected"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">
              Roles for this organisation
            </dt>
            <dd className="mt-1 font-medium">
              {access?.effectiveRoles.length
                ? access.effectiveRoles.map(platformRoleLabel).join(", ")
                : "No active role"}
            </dd>
          </div>
        </dl>
      </section>
      {meQuery.data?.id ? <ValoUserIdCard userId={meQuery.data.id} /> : null}
      <section
        aria-labelledby="identity-provider-heading"
        className="space-y-3"
      >
        <div>
          <h2 id="identity-provider-heading" className="text-lg font-semibold">
            Sign-in and security settings
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Clerk manages your password, verification, multi-factor
            authentication, active sessions and account recovery.
          </p>
        </div>
        <div className="overflow-hidden rounded-lg border border-border bg-card p-2 sm:p-4">
          <UserProfile
            routing="hash"
            appearance={{
              elements: {
                rootBox: "w-full",
                cardBox: "w-full shadow-none",
                card: "w-full shadow-none border-0 bg-card",
                navbar: "border-border",
                pageScrollBox: "p-0 sm:p-2",
              },
            }}
          />
        </div>
      </section>
    </div>
  );
}
