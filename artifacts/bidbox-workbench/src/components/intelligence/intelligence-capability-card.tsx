import {
  BookOpenCheck,
  CheckCheck,
  Clock3,
  FileSearch,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";
import { StateBadge, type SurfaceState } from "@/components/platform-states";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type {
  IntelligenceCapabilityDefinition,
  IntelligenceCapabilitySnapshot,
  IntelligenceCapabilityState,
} from "./intelligence-contract";
import { formatWatInstant } from "@/lib/format";

const STATE_PRESENTATION: Record<
  IntelligenceCapabilityState,
  { surface: SurfaceState; label: string }
> = {
  review_ready: { surface: "active", label: "Review ready" },
  partial: { surface: "partial", label: "Partial evidence" },
  empty: { surface: "empty", label: "No current evidence" },
  restricted: { surface: "unavailable", label: "Restricted" },
  production_disabled: { surface: "blocked", label: "Production off" },
};

function formatCount(value: number | null | undefined): string {
  return value == null
    ? "Not reported"
    : new Intl.NumberFormat("en-NG").format(value);
}

function formatTimestamp(value: string | null | undefined): string {
  return formatWatInstant(value, {
    empty: "Not reported",
    invalid: "Not reported",
  });
}

export function IntelligenceCapabilityCard({
  definition,
  snapshot,
}: {
  definition: IntelligenceCapabilityDefinition;
  snapshot: IntelligenceCapabilitySnapshot;
}) {
  const presentation = STATE_PRESENTATION[snapshot.state];
  const visibleCitations = snapshot.citations?.slice(0, 2) ?? [];

  return (
    <Card
      id={`capability-${definition.id}`}
      className="flex h-full flex-col shadow-none"
      data-capability-id={definition.id}
    >
      <CardHeader className="space-y-4 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <Badge variant="outline" className="gap-1.5 font-medium">
            {definition.level === 1 ? (
              <FileSearch aria-hidden="true" className="size-3" />
            ) : (
              <CheckCheck aria-hidden="true" className="size-3" />
            )}
            Current level 0 · Maximum planned level {definition.level}
          </Badge>
          <StateBadge state={presentation.surface} label={presentation.label} />
        </div>
        <div>
          <CardTitle className="font-serif text-xl">
            {definition.title}
          </CardTitle>
          <CardDescription className="mt-2 leading-6">
            {definition.description}
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-5 pt-0">
        <div className="rounded-md border border-border bg-muted/35 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Current evidence state
          </p>
          <p className="mt-1 text-sm leading-6">{snapshot.stateReason}</p>
          {snapshot.summary ? (
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {snapshot.summary}
            </p>
          ) : null}
        </div>

        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Review items</dt>
            <dd className="mt-1 font-mono font-medium">
              {formatCount(snapshot.reviewItemCount)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Citations</dt>
            <dd className="mt-1 font-mono font-medium">
              {formatCount(snapshot.citationCount)}
            </dd>
          </div>
        </dl>

        <div className="space-y-3">
          <div className="flex gap-3">
            <ShieldCheck
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-primary"
            />
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Human control
              </p>
              <p className="mt-1 text-sm leading-6">
                {definition.humanControl}
              </p>
            </div>
          </div>
          <div className="flex gap-3">
            <BookOpenCheck
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-primary"
            />
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Evidence boundary
              </p>
              <p className="mt-1 text-sm leading-6">
                {definition.evidenceBasis}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-auto border-t border-border pt-4">
          {visibleCitations.length > 0 ? (
            <div aria-label={`${definition.title} source references`}>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Source references
              </p>
              <ul className="mt-2 space-y-2">
                {visibleCitations.map((citation) => (
                  <li
                    key={citation.id}
                    className="rounded-md border border-border px-3 py-2 text-xs leading-5"
                  >
                    <p className="font-medium">{citation.sourceName}</p>
                    <p className="text-muted-foreground">{citation.locator}</p>
                    {citation.excerpt ? (
                      <p className="mt-1 line-clamp-2">“{citation.excerpt}”</p>
                    ) : null}
                  </li>
                ))}
              </ul>
              {(snapshot.citations?.length ?? 0) > visibleCitations.length ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  {snapshot.citations!.length - visibleCitations.length} more
                  source references are retained in the review record.
                </p>
              ) : null}
            </div>
          ) : (
            <div className="flex gap-2 text-xs leading-5 text-muted-foreground">
              <LockKeyhole
                aria-hidden="true"
                className="mt-0.5 size-3.5 shrink-0"
              />
              <p>
                No source reference is displayed. Do not rely on this capability
                state for a substantive decision.
              </p>
            </div>
          )}
          <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            <Clock3 aria-hidden="true" className="size-3.5" />
            Evidence last updated {formatTimestamp(snapshot.lastUpdatedAt)} WAT
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
