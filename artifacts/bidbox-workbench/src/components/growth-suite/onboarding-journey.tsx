import {
  ArrowRight,
  Check,
  Circle,
  FlaskConical,
  ShieldCheck,
} from "lucide-react";
import { Link } from "wouter";
import type {
  OnboardingJourney,
  OnboardingProgress,
} from "./growth-suite-contract";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function GrowthOnboardingJourney({
  journey,
  progress,
  mutationPending = false,
  onToggle,
  liveDestinations = [],
}: {
  journey: OnboardingJourney;
  progress: OnboardingProgress;
  mutationPending?: boolean;
  onToggle?: (itemId: string, markerSaved: boolean) => void;
  liveDestinations?: readonly { href: string; label: string }[];
}) {
  const savedPracticeMarkers = new Set(progress.savedPracticeMarkerItemIds);

  return (
    <section aria-labelledby="growth-onboarding-heading" className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
            First-pursuit onboarding
          </p>
          <h2
            id="growth-onboarding-heading"
            className="mt-1 font-serif text-2xl font-semibold"
          >
            Practise in a sample workspace
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
            Your checklist reflects your current roles. Saving a practice marker
            creates an organisation audit receipt but does not change client or
            pursuit data. A marker is not proof that you completed real work.
          </p>
        </div>
        <Badge variant="outline">
          {savedPracticeMarkers.size}/{journey.checklist.length} practice
          markers
        </Badge>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Checklist for your role</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-3">
              <Badge variant="secondary">Practice only</Badge>
            </div>
            <ol className="space-y-3">
              {journey.checklist.map((item) => {
                const markerSaved = savedPracticeMarkers.has(item.id);
                return (
                  <li
                    key={item.id}
                    className="flex gap-3 rounded-lg border border-border p-3"
                  >
                    <span aria-hidden="true" className="mt-0.5 text-primary">
                      {markerSaved ? <Check size={18} /> : <Circle size={18} />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-semibold">{item.title}</h3>
                      <p className="mt-1 text-sm leading-5 text-muted-foreground">
                        {item.purpose}
                      </p>
                      {markerSaved ? (
                        <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-400">
                          Practice marker saved. This is not proof that the task
                          was completed.
                        </p>
                      ) : null}
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant={markerSaved ? "secondary" : "outline"}
                      aria-pressed={markerSaved}
                      disabled={mutationPending || !onToggle}
                      onClick={() => onToggle?.(item.id, !markerSaved)}
                    >
                      {markerSaved ? "Remove marker" : "Save practice marker"}
                    </Button>
                  </li>
                );
              })}
            </ol>
          </CardContent>
        </Card>

        <Card className="border-primary/20 bg-primary/[0.025]">
          <CardHeader>
            <div className="flex items-center gap-2 text-primary">
              <FlaskConical size={18} aria-hidden="true" />
              <CardTitle className="text-base">
                {journey.syntheticTour.title}
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2 rounded-md border border-primary/15 bg-background p-3 text-xs leading-5 text-muted-foreground">
              <ShieldCheck
                className="mt-0.5 shrink-0 text-primary"
                size={16}
                aria-hidden="true"
              />
              Sample data only. No customer data or official record is changed.
            </div>
            <ol className="space-y-4">
              {journey.syntheticTour.steps.map((step, index) => (
                <li key={step.id} className="grid grid-cols-[1.5rem_1fr] gap-2">
                  <span className="flex size-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                    {index + 1}
                  </span>
                  <div>
                    <h3 className="text-sm font-semibold">{step.title}</h3>
                    <p className="mt-1 text-sm leading-5 text-muted-foreground">
                      {step.instruction}
                    </p>
                    <code className="mt-2 inline-block rounded bg-muted px-2 py-1 text-[11px]">
                      {step.syntheticObjectReference}
                    </code>
                  </div>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </div>

      {liveDestinations.length > 0 ? (
        <Card>
          <CardHeader>
            <h3 className="text-base font-semibold leading-none tracking-tight">
              Continue in your live workspace
            </h3>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
              These links match your current permissions. Opening a link does
              not complete a checklist item; record real work in the
              destination.
            </p>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {liveDestinations.map((destination) => (
                <li key={destination.href}>
                  <Button
                    asChild
                    variant="outline"
                    className="w-full justify-between"
                  >
                    <Link href={destination.href}>
                      {destination.label}
                      <ArrowRight aria-hidden="true" />
                    </Link>
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </section>
  );
}
