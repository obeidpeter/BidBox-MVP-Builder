import type { ReactNode } from "react";
import { ShieldCheck } from "lucide-react";
import { LoadingPanel, StatusPanel } from "@/components/platform-states";
import { Button } from "@/components/ui/button";
import { formatWatInstant } from "@/lib/format";

export function formatOperationsDate(value: string | null): string {
  return formatWatInstant(value, {
    empty: "Not recorded",
    invalid: "Date unavailable",
  });
}

export function safeCount(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export function safeExternalHref(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export function safeInternalHref(
  value: string | null | undefined,
): string | null {
  return value && value.startsWith("/") && !value.startsWith("//")
    ? value
    : null;
}

export function OperationsSection({
  id,
  title,
  description,
  icon,
  children,
  busy = false,
}: {
  id: string;
  title: string;
  description: string;
  icon: ReactNode;
  children: ReactNode;
  busy?: boolean;
}) {
  const headingId = `${id}-heading`;
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      aria-busy={busy || undefined}
      className="scroll-mt-24 space-y-4"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 rounded-lg border border-border bg-card p-2 text-primary">
          {icon}
        </span>
        <div className="min-w-0">
          <h2 id={headingId} className="font-serif text-xl font-semibold">
            {title}
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
            {description}
          </p>
        </div>
      </div>
      {children}
    </section>
  );
}

export function RecordsBoundary({
  state = "ready",
  error,
  count,
  loadingLabel,
  errorTitle,
  emptyTitle,
  emptyDescription,
  onRetry,
}: {
  state?: "ready" | "loading" | "error";
  error?: string | null;
  count: number;
  loadingLabel: string;
  errorTitle: string;
  emptyTitle: string;
  emptyDescription: string;
  onRetry?: () => void;
}): ReactNode {
  if (state === "loading") return <LoadingPanel label={loadingLabel} />;
  if (state === "error" || error) {
    return (
      <StatusPanel
        state="error"
        title={errorTitle}
        description={`${error || "The record source is unavailable."} Empty counts must not be treated as cleared controls.`}
      >
        {onRetry ? (
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            data-control-size="44"
            onClick={onRetry}
          >
            Try again
          </Button>
        ) : null}
      </StatusPanel>
    );
  }
  if (count === 0) {
    return (
      <StatusPanel
        state="empty"
        title={emptyTitle}
        description={emptyDescription}
      />
    );
  }
  return null;
}

export function HumanAuthorityNotice({
  title = "A named person must decide",
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <div
      role="note"
      aria-label={title}
      className="flex gap-3 rounded-lg border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950"
    >
      <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <p className="leading-6">
        <strong>{title}:</strong> {children}
      </p>
    </div>
  );
}

export function RecordFacts({
  facts,
}: {
  facts: readonly { label: string; value: ReactNode }[];
}) {
  return (
    <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
      {facts.map((fact) => (
        <div key={fact.label} className="min-w-0">
          <dt className="text-xs font-medium text-muted-foreground">
            {fact.label}
          </dt>
          <dd className="mt-1 break-words font-medium">{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}
