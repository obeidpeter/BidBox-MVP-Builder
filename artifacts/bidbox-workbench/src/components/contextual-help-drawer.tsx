import { useState } from "react";
import {
  CircleHelp,
  ExternalLink,
  KeyRound,
  Lightbulb,
  Route,
} from "lucide-react";
import { useSearchParams } from "wouter";

import {
  getPlatformAccessDecision,
  normalizePlatformRoles,
  platformFeatureFlags,
  platformRoleLabel,
  type PlatformAccessSource,
  type PlatformRoleInput,
} from "@/lib/platform-access";
import {
  getProtectedRouteContext,
  getProtectedRouteManualTopic,
} from "@/lib/protected-route-context";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface ContextualHelpDrawerProps {
  location: string;
  roles: PlatformRoleInput;
  permissions: readonly string[];
  accessSource?: PlatformAccessSource;
}

export function ContextualHelpDrawer({
  location,
  roles,
  permissions,
  accessSource,
}: ContextualHelpDrawerProps) {
  const [open, setOpen] = useState(false);
  const [searchParams] = useSearchParams();
  const context = getProtectedRouteContext(location, searchParams);
  const manualTopic = getProtectedRouteManualTopic(location);
  const normalizedRoles = normalizePlatformRoles(roles);
  const roleLabel = normalizedRoles.length
    ? normalizedRoles.map(platformRoleLabel).join(" · ")
    : "No active role";
  const decision = context.area
    ? getPlatformAccessDecision(
        normalizedRoles,
        context.area,
        platformFeatureFlags(),
        permissions,
        accessSource,
      )
    : null;
  const missingPermissions = context.requiredPermissions.filter(
    (permission) => !permissions.includes(permission),
  );
  const blocked = decision?.state === "denied" || missingPermissions.length > 0;
  const pending = decision?.state === "pending_activation";
  const accessLabel = blocked
    ? "Access required"
    : pending
      ? "Pending activation"
      : "Available";
  const accessReason = missingPermissions.length
    ? `Missing required permission${missingPermissions.length === 1 ? "" : "s"}: ${missingPermissions.join(", ")}.`
    : (decision?.reason ??
      "This identity-level page does not require an organisation feature area.");
  const exactNextAction = blocked
    ? `Ask an organisation administrator for ${missingPermissions.length ? missingPermissions.join(", ") : "access to this page"}, then reload this route.`
    : pending
      ? "Ask an organisation administrator to confirm commercial activation for this feature."
      : context.nextAction;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label={`Open help for ${context.helpTitle}`}
          title={`Help: ${context.helpTitle}`}
          className="inline-flex size-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <CircleHelp aria-hidden="true" className="size-[1.1rem]" />
        </button>
      </DialogTrigger>
      <DialogContent className="!left-auto !right-0 !top-0 !h-dvh !w-[min(100vw,30rem)] !max-w-none !translate-x-0 !translate-y-0 !gap-0 overflow-y-auto rounded-none border-y-0 border-r-0 p-0 sm:rounded-none">
        <DialogHeader className="border-b border-border px-6 py-6 pr-12 text-left">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Contextual help
          </p>
          <DialogTitle className="text-xl leading-7">
            {context.helpTitle}
          </DialogTitle>
          <DialogDescription className="leading-6">
            {context.purpose}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 px-6 py-6">
          <section
            aria-labelledby="help-access-title"
            className="rounded-xl border border-border bg-muted/30 p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3
                id="help-access-title"
                className="flex items-center gap-2 text-sm font-semibold"
              >
                <KeyRound className="size-4" aria-hidden="true" />
                Your access here
              </h3>
              <Badge variant="outline">{accessLabel}</Badge>
            </div>
            <dl className="mt-3 space-y-2 text-sm">
              <div>
                <dt className="font-medium text-foreground">
                  Role and context
                </dt>
                <dd className="mt-0.5 text-muted-foreground">
                  {roleLabel}
                  {accessSource ? ` · ${accessSource} access` : ""}
                </dd>
              </div>
              <div>
                <dt className="font-medium text-foreground">
                  Why{" "}
                  {blocked || pending
                    ? "access is limited"
                    : "this is available"}
                </dt>
                <dd className="mt-0.5 text-muted-foreground">{accessReason}</dd>
              </div>
            </dl>
          </section>

          <section aria-labelledby="help-terms-title">
            <h3 id="help-terms-title" className="text-sm font-semibold">
              Key terms
            </h3>
            <dl className="mt-3 space-y-3">
              {context.keyTerms.map(({ term, meaning }) => (
                <div key={term} className="rounded-lg border border-border p-3">
                  <dt className="text-sm font-semibold text-foreground">
                    {term}
                  </dt>
                  <dd className="mt-1 text-sm leading-6 text-muted-foreground">
                    {meaning}
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          <section aria-labelledby="help-example-title">
            <h3
              id="help-example-title"
              className="flex items-center gap-2 text-sm font-semibold"
            >
              <Lightbulb className="size-4" aria-hidden="true" />
              Example
            </h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {context.example}
            </p>
          </section>

          <section
            aria-labelledby="help-next-title"
            className="rounded-xl border border-brand-200 bg-brand-50 p-4"
          >
            <h3
              id="help-next-title"
              className="flex items-center gap-2 text-sm font-semibold text-brand-950"
            >
              <Route className="size-4" aria-hidden="true" />
              Exact next action
            </h3>
            <p className="mt-2 text-sm leading-6 text-brand-950/80">
              {exactNextAction}
            </p>
          </section>

          <a
            href={`/help?topic=${encodeURIComponent(manualTopic)}#${manualTopic}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center gap-2 rounded-md font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Open the full user manual
            <ExternalLink className="size-4" aria-hidden="true" />
          </a>
        </div>
      </DialogContent>
    </Dialog>
  );
}
