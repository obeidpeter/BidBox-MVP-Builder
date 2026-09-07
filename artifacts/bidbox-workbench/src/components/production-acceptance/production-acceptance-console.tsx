import type { ReactNode } from "react";
import {
  PageHeader,
  StateBadge,
  StatusPanel,
  type SurfaceState,
} from "@/components/platform-states";
import { Card, CardContent } from "@/components/ui/card";
import type {
  ProductionAcceptanceSnapshot,
  ProductionAcceptanceState,
} from "./production-acceptance-contract";
import { formatWatInstant, humaniseToken as readable } from "@/lib/format";

const SURFACE_STATE: Readonly<Record<ProductionAcceptanceState, SurfaceState>> =
  {
    passed: "active",
    failed: "blocked",
    missing: "pending",
    expired: "expired",
    release_mismatch: "blocked",
    integrity_failed: "error",
  };

const STATE_LABEL: Readonly<Record<ProductionAcceptanceState, string>> = {
  passed: "Passed",
  failed: "Failed",
  missing: "Missing",
  expired: "Expired",
  release_mismatch: "Wrong release",
  integrity_failed: "Integrity failed",
};

function formattedDate(value: string): string {
  return formatWatInstant(value);
}

export function ProductionAcceptanceConsole({
  snapshot,
  evidenceRecorder,
}: {
  snapshot: ProductionAcceptanceSnapshot;
  evidenceRecorder?: ReactNode;
}) {
  const passedCount = snapshot.categories.filter(
    ({ state }) => state === "passed",
  ).length;
  const go = snapshot.recommendedDecision === "go";

  return (
    <div className="mx-auto w-full max-w-7xl space-y-7 p-5 sm:p-8">
      <PageHeader
        eyebrow="Release evidence"
        title="Release checks"
        description="Review evidence references for migrations, organisation security, browser checks and recovery rehearsals. This page cannot deploy or run recovery."
        state={go ? "partial" : "blocked"}
      />

      <StatusPanel
        state={go ? "partial" : "blocked"}
        title={
          go
            ? "Evidence is complete; a named person must make the go decision"
            : "No-go: required evidence is incomplete or invalid"
        }
        description={snapshot.authorityNote}
      >
        <div className="grid gap-3 text-sm sm:grid-cols-3">
          <p>
            <span className="font-medium">Evidence gates:</span> {passedCount}{" "}
            of {snapshot.categories.length} passed
          </p>
          <p>
            <span className="font-medium">Blocking findings:</span>{" "}
            {snapshot.blockers.length}
          </p>
          <p>
            <span className="font-medium">Automatic approval:</span> none
          </p>
        </div>
      </StatusPanel>

      <Card className="shadow-none">
        <CardContent className="p-5">
          <h2 className="text-sm font-semibold">Release candidate binding</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Every passing record must use this exact SHA-256. A branch, tag or
            deployment name is not equivalent.
          </p>
          <code className="mt-3 block break-all rounded-md bg-muted px-3 py-2 text-xs">
            {snapshot.expectedReleaseSha256 ??
              "Exact release is not configured"}
          </code>
          <p className="mt-3 text-xs text-muted-foreground">
            Checked at {formattedDate(snapshot.generatedAt)}
          </p>
        </CardContent>
      </Card>

      {snapshot.blockers.length > 0 ? (
        <section
          aria-labelledby="acceptance-blockers-heading"
          className="space-y-3"
        >
          <h2
            id="acceptance-blockers-heading"
            className="text-lg font-semibold"
          >
            Go/no-go blockers
          </h2>
          <ul className="space-y-2">
            {snapshot.blockers.map((blocker) => (
              <li
                key={`${blocker.category ?? "global"}:${blocker.code}`}
                className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-950"
              >
                <p className="font-mono text-xs font-semibold">
                  {blocker.code}
                </p>
                <p className="mt-1 leading-6">{blocker.message}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section
        aria-labelledby="acceptance-evidence-heading"
        className="space-y-4"
      >
        <div>
          <h2
            id="acceptance-evidence-heading"
            className="text-lg font-semibold"
          >
            Required evidence
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            The newest record in each category determines this advisory view.
            Older records remain append-only.
          </p>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {snapshot.categories.map((category) => {
            const evidence = category.latestEvidence;
            return (
              <Card key={category.category} className="shadow-none">
                <CardContent className="space-y-4 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold">{category.label}</h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Required production gate
                      </p>
                    </div>
                    <StateBadge
                      state={SURFACE_STATE[category.state]}
                      label={STATE_LABEL[category.state]}
                    />
                  </div>
                  {evidence ? (
                    <dl className="grid gap-3 text-sm sm:grid-cols-2">
                      <div>
                        <dt className="text-xs text-muted-foreground">Owner</dt>
                        <dd className="mt-1 break-all font-medium">
                          {evidence.ownerUserId}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">
                          Verifier
                        </dt>
                        <dd className="mt-1 break-all font-medium">
                          {evidence.verifiedByUserId}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">
                          Observed
                        </dt>
                        <dd className="mt-1">
                          {formattedDate(evidence.observedAt)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">
                          Expires
                        </dt>
                        <dd className="mt-1">
                          {formattedDate(evidence.expiresAt)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">
                          Environment
                        </dt>
                        <dd className="mt-1 capitalize">
                          {readable(evidence.environment)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">
                          Outcome
                        </dt>
                        <dd className="mt-1 capitalize">{evidence.outcome}</dd>
                      </div>
                      <div className="sm:col-span-2">
                        <dt className="text-xs text-muted-foreground">
                          Summary
                        </dt>
                        <dd className="mt-1 leading-6">{evidence.summary}</dd>
                      </div>
                      <div className="sm:col-span-2">
                        <dt className="text-xs text-muted-foreground">
                          Retained evidence reference
                        </dt>
                        <dd className="mt-1 break-all font-mono text-xs">
                          {evidence.evidenceReference}
                        </dd>
                      </div>
                      <div className="sm:col-span-2">
                        <dt className="text-xs text-muted-foreground">
                          Evidence digest
                        </dt>
                        <dd className="mt-1 break-all font-mono text-xs">
                          {evidence.evidenceDigest}
                        </dd>
                      </div>
                      <div className="sm:col-span-2">
                        <dt className="text-xs text-muted-foreground">
                          Retained artefact SHA-256
                        </dt>
                        <dd className="mt-1 break-all font-mono text-xs">
                          {evidence.artifactSha256}
                        </dd>
                      </div>
                    </dl>
                  ) : (
                    <p className="text-sm leading-6 text-muted-foreground">
                      No digest-verified evidence is available for this gate.
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      {evidenceRecorder}
    </div>
  );
}
