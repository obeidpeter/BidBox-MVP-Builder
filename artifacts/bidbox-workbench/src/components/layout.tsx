import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { UserButton } from "@clerk/clerk-react";
import { getGetMeQueryKey, useGetMe } from "@workspace/api-client-react";
import {
  Bell,
  BarChart3,
  BookOpenText,
  BookOpenCheck,
  BriefcaseBusiness,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  CreditCard,
  FileStack,
  FlaskConical,
  Handshake,
  LayoutDashboard,
  Library,
  Network,
  LockKeyhole,
  Menu,
  ScrollText,
  Scale,
  Settings,
  ShieldCheck,
  Sparkles,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  navigationForRole,
  normalizePlatformRoles,
  platformFeatureFlags,
  platformRoleLabel,
} from "@/lib/platform-access";
import {
  LoadingPanel,
  OfflineBanner,
  StateBadge,
  StatusPanel,
} from "@/components/platform-states";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { useOrganisationAccess } from "@/contexts/organisation-context";
import { requestStatus } from "@/lib/errors";
import {
  OrganisationLoadError,
  OrganisationSelectionGate,
  OrganisationSwitcher,
} from "@/components/organisation-switcher";
import { BidBoxMark } from "@/components/bidbox-mark";
import {
  GlobalCommand,
  type ShellNavigationItem,
} from "@/components/global-command";
import { BidBoxUserIdCard } from "@/components/bidbox-user-id-card";
import { ContextualHelpDrawer } from "@/components/contextual-help-drawer";

const ICONS: Record<string, LucideIcon> = {
  "/app": LayoutDashboard,
  "/clients": Users,
  "/projects": BriefcaseBusiness,
  "/intelligence": Sparkles,
  "/portfolio-intelligence": BarChart3,
  "/sbd": BookOpenCheck,
  "/portal": Building2,
  "/partner": ShieldCheck,
  "/consortium-room": Handshake,
  "/pursuit-operations": ClipboardCheck,
  "/operations": ClipboardCheck,
  "/growth-operations": Sparkles,
  "/opportunity-sources": Network,
  "/client-actions": Building2,
  "/production-acceptance": ShieldCheck,
  "/ai-shadow": FlaskConical,
  "/field-companion": LockKeyhole,
  "/evidence-readiness": Library,
  "/reports": FileStack,
  "/billing": CreditCard,
  "/notifications": Bell,
  "/communications": Bell,
  "/app/security": LockKeyhole,
  "/privacy-operations": ShieldCheck,
  "/claims-desk": Scale,
  "/organisation-settings": Settings,
  "/settings": ScrollText,
  "/help": BookOpenText,
};

const NAV_GROUPS: ShellNavigationItem["group"][] = [
  "Workspace",
  "Delivery",
  "Oversight",
  "Administration",
  "Support",
];

const HELP_NAV_ITEM: ShellNavigationItem = {
  href: "/help",
  label: "Help & user manual",
  group: "Support",
  state: "active",
};

function AppNavigation({
  items,
  location,
  onNavigate,
}: {
  items: ShellNavigationItem[];
  location: string;
  onNavigate?: () => void;
}) {
  return (
    <nav aria-label="Primary navigation" className="space-y-6">
      {NAV_GROUPS.map((group) => {
        const groupItems = items.filter((item) => item.group === group);
        if (groupItems.length === 0) return null;
        return (
          <div key={group}>
            <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-[0.13em] text-sidebar-foreground/65">
              {group}
            </p>
            <ul className="space-y-1">
              {groupItems.map((item) => {
                const Icon = ICONS[item.href] ?? CheckCircle2;
                const active =
                  location === item.href ||
                  (item.href !== "/app" &&
                    location.startsWith(item.href + "/"));
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                        active
                          ? "bg-sidebar-accent font-medium text-sidebar-primary"
                          : "text-sidebar-foreground/72 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground",
                      )}
                    >
                      <Icon
                        aria-hidden="true"
                        className="size-[1.1rem] shrink-0"
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {item.label}
                      </span>
                      {item.state === "pending_activation" ? (
                        <span
                          className="rounded-full border border-amber-300/35 bg-amber-300/10 px-2 py-0.5 text-xs font-semibold text-amber-200"
                          title="Feature not active yet"
                        >
                          Pending
                        </span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

function UtilityLink({
  href,
  label,
  icon: Icon,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      title={label}
      className="inline-flex size-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Icon aria-hidden="true" className="size-[1.1rem]" />
    </Link>
  );
}

function IdentityAccessLinks() {
  return (
    <div className="flex flex-wrap justify-center gap-2">
      <Link
        href="/help"
        className="inline-flex min-h-10 items-center gap-2 rounded-md border border-border bg-card px-3 text-sm font-semibold text-foreground shadow-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <BookOpenText aria-hidden="true" className="size-4" />
        Open user manual
      </Link>
      <Link
        href="/account"
        className="inline-flex min-h-10 items-center rounded-md px-3 text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Open profile
      </Link>
    </div>
  );
}

function IdentityOnlyLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <a
        href="#main-content"
        className="sr-only z-50 rounded-md bg-card px-4 py-2 text-sm font-medium shadow-sm focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Skip to main content
      </a>
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex min-h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
          <Link
            href="/"
            aria-label="BidBox home"
            className="rounded-md text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <BidBoxMark />
          </Link>
          <div className="flex items-center gap-2">
            <Link
              href="/help"
              className="inline-flex min-h-10 items-center gap-2 rounded-md px-3 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <BookOpenText aria-hidden="true" className="size-4" />
              <span className="hidden sm:inline">Help & user manual</span>
              <span className="sm:hidden">Help</span>
            </Link>
            <UserButton
              afterSignOutUrl="/"
              userProfileMode="navigation"
              userProfileUrl="/account"
            />
          </div>
        </div>
      </header>
      <main id="main-content" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}

export default function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const online = useOnlineStatus();
  const organisationAccess = useOrganisationAccess();
  const {
    data: user,
    isLoading,
    isPending,
    error,
  } = useGetMe({
    query: {
      queryKey: getGetMeQueryKey(),
      retry: (failureCount, err) => {
        const status = requestStatus(err);
        if (status === 403) return false;
        return failureCount < 3;
      },
      retryDelay: (attempt) => Math.min(400 * 2 ** attempt, 2000),
    },
  });

  useEffect(() => setMobileOpen(false), [location]);

  if (isLoading || isPending || organisationAccess?.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-5">
        <div className="w-full max-w-lg">
          <LoadingPanel label="Signing you in and opening your workspace" />
        </div>
      </div>
    );
  }

  if (error || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-5">
        <div className="w-full max-w-lg">
          <StatusPanel
            state={online ? "error" : "offline"}
            title={online ? "We couldn't sign you in" : "You're offline"}
            description={
              online
                ? "Refresh to try again. Records and actions stay locked until we can verify your session."
                : "Reconnect to the internet, then refresh. Records and actions stay locked until we can verify your session."
            }
          />
        </div>
      </div>
    );
  }

  if (user.status === "disabled") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-5">
        <div className="w-full max-w-lg space-y-6 text-center">
          <StatusPanel
            state="blocked"
            title="Account disabled"
            description="This account cannot open any organisation or pursuit workspace. Contact BidBox support to review the account."
          />
          <UserButton afterSignOutUrl="/" />
        </div>
      </div>
    );
  }

  if (!organisationAccess) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-5">
        <div className="w-full max-w-lg">
          <StatusPanel
            state="error"
            title="We couldn't check organisation access"
            description="No organisation workspace was opened. Refresh and try again."
          />
        </div>
      </div>
    );
  }
  const currentPath = location.split(/[?#]/, 1)[0].replace(/\/$/, "");
  const identityUtilityRoute =
    currentPath === "/account" || currentPath === "/help";
  if (organisationAccess.isError) {
    return identityUtilityRoute ? (
      <IdentityOnlyLayout>{children}</IdentityOnlyLayout>
    ) : (
      <OrganisationLoadError />
    );
  }
  const pendingRole =
    organisationAccess.effectiveRoles.length === 0 ||
    organisationAccess.effectiveRoles.every((role) => role === "none");
  if (
    identityUtilityRoute &&
    (!organisationAccess.activeOrganisation || pendingRole)
  ) {
    return <IdentityOnlyLayout>{children}</IdentityOnlyLayout>;
  }
  if (organisationAccess.needsSelection) return <OrganisationSelectionGate />;
  if (!organisationAccess.activeOrganisation) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-5">
        <div className="w-full max-w-lg space-y-6 text-center">
          <StatusPanel
            state="pending"
            title="You don't have organisation access yet"
            description="Your sign-in worked, but this account is not linked to an active organisation membership. Ask an organisation administrator to add you."
          />
          <BidBoxUserIdCard userId={user.id} />
          <IdentityAccessLinks />
          <UserButton afterSignOutUrl="/" />
        </div>
      </div>
    );
  }

  const effectiveRoles = organisationAccess.effectiveRoles;
  if (pendingRole) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-5">
        <div className="w-full max-w-lg space-y-6 text-center">
          <StatusPanel
            state="pending"
            title="No role assigned yet"
            description="Your account belongs to this organisation, but it has no active role. Ask an organisation administrator to assign one."
          />
          <BidBoxUserIdCard userId={user.id} />
          <IdentityAccessLinks />
          <UserButton afterSignOutUrl="/" />
        </div>
      </div>
    );
  }

  const normalizedRoles = normalizePlatformRoles(effectiveRoles);
  if (normalizedRoles.length === 0) {
    if (identityUtilityRoute) {
      return <IdentityOnlyLayout>{children}</IdentityOnlyLayout>;
    }
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-5">
        <div className="w-full max-w-lg">
          <StatusPanel
            state="blocked"
            title="This role isn't supported"
            description="This version of BidBox does not recognise the role returned by the server. No workspace was opened. Contact an administrator or support."
          />
          <IdentityAccessLinks />
        </div>
      </div>
    );
  }

  const authorisedNavItems = navigationForRole(
    normalizedRoles,
    platformFeatureFlags(),
    organisationAccess.effectivePermissions,
    organisationAccess.activeOrganisation.accessSource,
  );
  const navigation: ShellNavigationItem[] = [
    ...authorisedNavItems,
    HELP_NAV_ITEM,
  ];
  const assignedRoleLabel = normalizedRoles.map(platformRoleLabel).join(" · ");
  const navIncludes = (href: string) =>
    authorisedNavItems.some((item) => item.href === href);

  return (
    <div className="min-h-screen bg-background">
      <a
        href="#main-content"
        className="sr-only z-50 rounded-md bg-card px-4 py-2 text-sm font-medium shadow-sm focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Skip to main content
      </a>
      {!online ? <OfflineBanner /> : null}

      <div className="flex min-h-screen">
        <aside className="hidden w-[17rem] shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex">
          <div className="border-b border-sidebar-border p-5">
            <Link
              href="/app"
              aria-label="BidBox dashboard"
              className="block w-fit rounded-md text-sidebar-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
            >
              <BidBoxMark />
            </Link>
            <p className="mt-3 text-xs leading-5 text-sidebar-foreground/55">
              Tender review and evidence tracking
            </p>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            <AppNavigation items={navigation} location={location} />
          </div>
          <div className="border-t border-sidebar-border p-4">
            <div className="flex items-center gap-3 rounded-lg bg-sidebar-accent/70 p-3">
              <UserButton
                afterSignOutUrl="/"
                userProfileMode="navigation"
                userProfileUrl="/account"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {user.name || user.email}
                </p>
                <p className="mt-0.5 truncate text-xs text-sidebar-foreground/55">
                  {assignedRoleLabel}
                </p>
              </div>
            </div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 border-b border-border bg-background">
            <div className="flex min-h-16 items-center gap-3 px-4 sm:px-6">
              <button
                type="button"
                className="inline-flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-card lg:hidden"
                aria-expanded={mobileOpen}
                aria-controls="mobile-primary-navigation"
                aria-label={
                  mobileOpen ? "Close navigation menu" : "Open navigation menu"
                }
                onClick={() => setMobileOpen((open) => !open)}
              >
                {mobileOpen ? (
                  <X aria-hidden="true" className="size-5" />
                ) : (
                  <Menu aria-hidden="true" className="size-5" />
                )}
              </button>
              <div className="min-w-0 shrink sm:max-w-60">
                <p className="truncate text-sm font-semibold">
                  {organisationAccess.activeOrganisation.name}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {assignedRoleLabel}
                </p>
              </div>
              <div className="hidden min-w-0 flex-1 justify-center sm:flex">
                <GlobalCommand navigation={navigation} />
              </div>
              <div className="ml-auto flex shrink-0 items-center gap-0.5">
                {navIncludes("/operations") ? (
                  <UtilityLink
                    href="/operations"
                    label="Tasks and reviews"
                    icon={ClipboardCheck}
                  />
                ) : null}
                {navIncludes("/notifications") ? (
                  <UtilityLink
                    href="/notifications"
                    label="Notifications"
                    icon={Bell}
                  />
                ) : null}
                <ContextualHelpDrawer
                  location={location}
                  roles={normalizedRoles}
                  permissions={organisationAccess.effectivePermissions}
                  accessSource={
                    organisationAccess.activeOrganisation.accessSource
                  }
                />
                <div className="hidden px-2 xl:block">
                  <OrganisationSwitcher />
                </div>
                <StateBadge
                  state={online ? "active" : "offline"}
                  label={online ? "Connected" : "Offline"}
                  className="hidden 2xl:inline-flex"
                />
                <div className="ml-1 lg:hidden">
                  <UserButton
                    afterSignOutUrl="/"
                    userProfileMode="navigation"
                    userProfileUrl="/account"
                  />
                </div>
              </div>
            </div>
            <div className="px-4 pb-3 sm:hidden">
              <GlobalCommand navigation={navigation} />
            </div>
            {mobileOpen ? (
              <div
                id="mobile-primary-navigation"
                className="max-h-[75dvh] overflow-y-auto border-t border-sidebar-border bg-sidebar p-4 text-sidebar-foreground lg:hidden"
              >
                <AppNavigation
                  items={navigation}
                  location={location}
                  onNavigate={() => setMobileOpen(false)}
                />
                <div className="mt-6 border-t border-sidebar-border pt-4 xl:hidden">
                  <OrganisationSwitcher />
                </div>
              </div>
            ) : null}
          </header>

          <main id="main-content" tabIndex={-1} className="min-w-0 flex-1">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
