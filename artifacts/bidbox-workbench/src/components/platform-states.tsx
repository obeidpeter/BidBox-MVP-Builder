import type { ReactNode } from "react";
import {
  AlertCircle,
  Ban,
  CheckCircle2,
  Clock3,
  CloudOff,
  Info,
  ShieldAlert,
  TriangleAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type SurfaceState =
  | "active"
  | "blocked"
  | "expired"
  | "pending"
  | "partial"
  | "error"
  | "offline"
  | "unavailable"
  | "empty";

const STATE_LABELS: Record<SurfaceState, string> = {
  active: "Active",
  blocked: "Blocked",
  expired: "Expired",
  pending: "Pending",
  partial: "Limited",
  error: "Error",
  offline: "Offline",
  unavailable: "Unavailable",
  empty: "No records",
};

const STATE_STYLES: Record<SurfaceState, string> = {
  active: "border-emerald-200 bg-emerald-50 text-emerald-800",
  blocked: "border-red-200 bg-red-50 text-red-800",
  expired: "border-red-200 bg-red-50 text-red-800",
  pending: "border-amber-200 bg-amber-50 text-amber-900",
  partial: "border-sky-200 bg-sky-50 text-sky-900",
  error: "border-red-200 bg-red-50 text-red-800",
  offline: "border-slate-300 bg-slate-100 text-slate-800",
  unavailable: "border-border bg-muted text-muted-foreground",
  empty: "border-border bg-muted text-muted-foreground",
};

const STATE_ICONS: Record<SurfaceState, typeof Info> = {
  active: CheckCircle2,
  blocked: Ban,
  expired: ShieldAlert,
  pending: Clock3,
  partial: Info,
  error: AlertCircle,
  offline: CloudOff,
  unavailable: ShieldAlert,
  empty: Info,
};

export function StateBadge({
  state,
  label,
  className,
}: {
  state: SurfaceState;
  label?: string;
  className?: string;
}) {
  const Icon = STATE_ICONS[state];
  const visibleLabel = label ?? STATE_LABELS[state];
  return (
    <Badge
      variant="outline"
      className={cn("gap-1.5 font-medium", STATE_STYLES[state], className)}
      data-state={state}
      aria-label={"Status: " + visibleLabel}
    >
      <Icon aria-hidden="true" className="size-3" />
      {visibleLabel}
    </Badge>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  state,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  state?: SurfaceState;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-3xl">
        {eyebrow ? (
          <p className="mb-2 font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
            {eyebrow}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-serif text-3xl font-semibold tracking-tight">
            {title}
          </h1>
          {state ? <StateBadge state={state} /> : null}
        </div>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>
      ) : null}
    </header>
  );
}

export function StatusPanel({
  state,
  title,
  description,
  children,
  className,
}: {
  state: SurfaceState;
  title: string;
  description: string;
  children?: ReactNode;
  className?: string;
}) {
  const Icon = STATE_ICONS[state];
  const urgent =
    state === "blocked" || state === "error" || state === "offline";
  return (
    <Card
      className={cn("shadow-none", className)}
      role={urgent ? "alert" : "status"}
      aria-live={urgent ? "assertive" : "polite"}
    >
      <CardContent className="flex gap-4 p-5">
        <div
          className={cn("mt-0.5 rounded-md border p-2", STATE_STYLES[state])}
        >
          <Icon aria-hidden="true" className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold">{title}</h2>
            <StateBadge state={state} />
          </div>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {description}
          </p>
          {children ? <div className="mt-4">{children}</div> : null}
        </div>
      </CardContent>
    </Card>
  );
}

export function PageGatePanel(props: {
  state: SurfaceState;
  title: string;
  description: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className="p-5 sm:p-8">
      <StatusPanel {...props} />
    </div>
  );
}

export function FeatureActivationNotice({
  enabled,
  feature,
  detail,
  partialWhenEnabled = true,
}: {
  enabled: boolean;
  feature: string;
  detail: string;
  partialWhenEnabled?: boolean;
}) {
  if (enabled) {
    return (
      <StatusPanel
        state={partialWhenEnabled ? "partial" : "active"}
        title={
          partialWhenEnabled
            ? feature + " has limited availability"
            : feature + " is active"
        }
        description={detail}
      />
    );
  }

  const descriptionId =
    "feature-activation-" + feature.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return (
    <StatusPanel
      state="pending"
      title={feature + " is not active yet"}
      description={detail}
    >
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          disabled
          aria-describedby={descriptionId}
        >
          Not available yet
        </Button>
        <p id={descriptionId} className="text-xs text-muted-foreground">
          A platform administrator must enable this feature and confirm that its
          required service is ready.
        </p>
      </div>
    </StatusPanel>
  );
}

export function LoadingPanel({
  label = "Loading current records",
}: {
  label?: string;
}) {
  return (
    <div
      className="flex min-h-40 items-center justify-center rounded-lg border border-border bg-card p-8"
      role="status"
      aria-live="polite"
    >
      <Clock3
        aria-hidden="true"
        className="mr-3 size-5 animate-pulse text-muted-foreground motion-reduce:animate-none"
      />
      <span className="text-sm text-muted-foreground">{label}</span>
    </div>
  );
}

export function DataErrorPanel({
  title = "We couldn't load the records",
  description,
  onRetry,
}: {
  title?: string;
  description: string;
  onRetry?: () => void;
}) {
  return (
    <StatusPanel state="error" title={title} description={description}>
      {onRetry ? (
        <Button type="button" variant="outline" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </StatusPanel>
  );
}

export function QueueCapabilityCard({
  title,
  description,
  state,
  value,
}: {
  title: string;
  description: string;
  state: SurfaceState;
  value?: string | number;
}) {
  return (
    <Card className="shadow-none">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold">{title}</h3>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {description}
            </p>
          </div>
          <StateBadge state={state} />
        </div>
        {value !== undefined ? (
          <p
            className="mt-5 font-mono text-2xl font-semibold"
            aria-label={title + ": " + value}
          >
            {value}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function OfflineBanner() {
  return (
    <div
      className="flex items-center justify-center gap-2 border-b border-slate-300 bg-slate-100 px-4 py-2 text-center text-xs font-medium text-slate-900"
      role="alert"
    >
      <CloudOff aria-hidden="true" className="size-4" />
      You are offline. Some information may be out of date. Wait until you are
      back online before making changes.
    </div>
  );
}

export function DeadlineCaution({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-3 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
      <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div>{children}</div>
    </div>
  );
}
