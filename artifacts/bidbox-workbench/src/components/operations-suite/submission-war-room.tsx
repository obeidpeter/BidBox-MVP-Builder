import { useId } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  FileCheck2,
  LockKeyhole,
  ReceiptText,
} from "lucide-react";
import {
  StateBadge,
  StatusPanel,
  type SurfaceState,
} from "@/components/platform-states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type {
  OperationsSectionState,
  SubmissionPackageRecord,
  SubmissionPackageStatus,
  VisualQaStatus,
} from "./operations-suite-contract";
import {
  HumanAuthorityNotice,
  OperationsSection,
  RecordsBoundary,
  RecordFacts,
  safeCount,
  safeInternalHref,
} from "./operations-suite-primitives";

const PACKAGE_STATUS: Record<
  SubmissionPackageStatus,
  { label: string; state: SurfaceState }
> = {
  draft: { label: "Draft package", state: "pending" },
  frozen: { label: "Hash frozen", state: "partial" },
  copies_prepared: { label: "Copies prepared", state: "partial" },
  sealed: { label: "Sealed", state: "partial" },
  dispatched: { label: "Dispatch recorded", state: "pending" },
  receipt_recorded: { label: "Receipt recorded", state: "active" },
  cancelled: { label: "Cancelled", state: "unavailable" },
  qa_only: { label: "QA record only", state: "partial" },
};

const QA_STATUS: Record<
  VisualQaStatus,
  { label: string; state: SurfaceState }
> = {
  pass: { label: "Passed", state: "active" },
  warning: { label: "Review warning", state: "pending" },
  fail: { label: "Failed", state: "blocked" },
  not_run: { label: "Not run", state: "unavailable" },
};

const DELIVERY_LABEL: Record<
  SubmissionPackageRecord["deliveryMethod"],
  string
> = {
  portal: "External portal",
  courier: "Courier",
  hand_delivery: "Hand delivery",
  email: "Email",
  other: "Recorded out-of-band method",
  not_recorded: "Not recorded",
};

export interface SubmissionWarRoomProps extends OperationsSectionState {
  packages: readonly SubmissionPackageRecord[];
  onFreezePackage?: (packageId: string) => void;
  onRecordReceipt?: (packageId: string) => void;
}

export function SubmissionWarRoom({
  packages,
  state = "ready",
  error,
  readOnly = false,
  onRetry,
  onFreezePackage,
  onRecordReceipt,
}: SubmissionWarRoomProps) {
  const instanceId = useId();
  const boundary = RecordsBoundary({
    state,
    error,
    count: packages.length,
    loadingLabel: "Loading submission package custody records",
    errorTitle: "Submission custody records could not be loaded",
    emptyTitle: "No submission packages are recorded",
    emptyDescription:
      "No package record was supplied. This does not establish that a tender was packaged, visually checked, dispatched or received.",
    onRetry,
  });

  return (
    <OperationsSection
      id="submission-war-room"
      title="Submission and visual package checks"
      description="Render and inspect the final package, lock its fingerprint, coordinate physical copies and keep delivery receipts."
      icon={<FileCheck2 aria-hidden="true" className="size-5" />}
      busy={state === "loading"}
    >
      <HumanAuthorityNotice title="Manual submission boundary">
        Valo does not click Submit, send an email, hand over a package or
        certify delivery. An authorised operator performs that external action
        and records the resulting receipt against the frozen hash.
      </HumanAuthorityNotice>

      {boundary ?? (
        <ul
          className="grid list-none gap-4 p-0"
          aria-label="Submission packages"
        >
          {packages.map((submissionPackage) => {
            const packageState = PACKAGE_STATUS[submissionPackage.status];
            const previewHref = safeInternalHref(submissionPackage.previewHref);
            const allQaPassed =
              submissionPackage.qaChecks.length > 0 &&
              submissionPackage.qaChecks.every(
                (check) => check.status === "pass",
              );
            const canFreeze =
              submissionPackage.status === "draft" &&
              allQaPassed &&
              Boolean(submissionPackage.sha256);
            const canRecordReceipt =
              submissionPackage.status === "frozen" ||
              submissionPackage.status === "dispatched";
            return (
              <li key={submissionPackage.id}>
                <Card className="shadow-none">
                  <article
                    aria-labelledby={`${instanceId}-${submissionPackage.id}-title`}
                  >
                    <CardHeader className="space-y-3 pb-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <StateBadge
                          state={packageState.state}
                          label={packageState.label}
                        />
                        <span className="font-mono text-xs text-muted-foreground">
                          Version {submissionPackage.version}
                        </span>
                      </div>
                      <h3
                        id={`${instanceId}-${submissionPackage.id}-title`}
                        className="text-base font-semibold"
                      >
                        {submissionPackage.name}
                      </h3>
                    </CardHeader>
                    <CardContent className="space-y-5 pt-0">
                      <RecordFacts
                        facts={[
                          {
                            label: "Delivery method",
                            value:
                              submissionPackage.deliveryMethodLabel ??
                              DELIVERY_LABEL[submissionPackage.deliveryMethod],
                          },
                          {
                            label: "Required copies",
                            value: safeCount(
                              submissionPackage.copyCount,
                            ).toLocaleString("en-NG"),
                          },
                          {
                            label: "Receipt fingerprint",
                            value:
                              submissionPackage.receiptHash ?? "Not recorded",
                          },
                          ...(submissionPackage.statusReason
                            ? [
                                {
                                  label: "Applicable status reason",
                                  value: submissionPackage.statusReason,
                                },
                              ]
                            : []),
                        ]}
                      />

                      <div>
                        <p className="text-xs font-medium text-muted-foreground">
                          Package SHA-256
                        </p>
                        <code className="mt-1 block break-all rounded-md border border-border bg-muted/40 p-3 text-xs">
                          {submissionPackage.sha256 ?? "Not generated"}
                        </code>
                      </div>

                      <div className="space-y-3">
                        <h4 className="text-sm font-semibold">
                          Rendered package checks
                        </h4>
                        {submissionPackage.qaChecks.length === 0 ? (
                          <StatusPanel
                            state="unavailable"
                            title="Visual QA has not run"
                            description="Render the final DOCX/PDF before freezing. A package without recorded checks remains blocked."
                          />
                        ) : (
                          <ul
                            className="grid list-none gap-2 p-0 sm:grid-cols-2"
                            aria-label={`Visual QA for ${submissionPackage.name}`}
                          >
                            {submissionPackage.qaChecks.map((check) => {
                              const checkState = QA_STATUS[check.status];
                              return (
                                <li
                                  key={check.id}
                                  className="rounded-lg border border-border bg-muted/20 p-3"
                                >
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <p className="text-sm font-medium">
                                      {check.label}
                                    </p>
                                    <StateBadge
                                      state={checkState.state}
                                      label={checkState.label}
                                    />
                                  </div>
                                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                                    {check.detail}
                                  </p>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>

                      {!allQaPassed && submissionPackage.status === "draft" ? (
                        <div
                          role="note"
                          aria-label="Package freeze blocked"
                          className="flex gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"
                        >
                          <AlertTriangle
                            aria-hidden="true"
                            className="mt-0.5 size-4 shrink-0"
                          />
                          Every rendered-package check must pass before the hash
                          can be frozen.
                        </div>
                      ) : null}

                      <div className="flex flex-wrap gap-2 border-t border-border pt-4">
                        {previewHref ? (
                          <Button
                            asChild
                            variant="outline"
                            className="min-h-11 w-full sm:w-auto"
                            data-control-size="44"
                          >
                            <a
                              href={previewHref}
                              aria-label={`Inspect rendered package: ${submissionPackage.name}`}
                            >
                              <Eye aria-hidden="true" />
                              Inspect rendered package
                            </a>
                          </Button>
                        ) : null}
                        {submissionPackage.status === "draft" ? (
                          <Button
                            type="button"
                            className="min-h-11 w-full sm:w-auto"
                            data-control-size="44"
                            disabled={
                              readOnly || !onFreezePackage || !canFreeze
                            }
                            onClick={() =>
                              onFreezePackage?.(submissionPackage.id)
                            }
                          >
                            <LockKeyhole aria-hidden="true" />
                            Freeze package hash
                          </Button>
                        ) : null}
                        {canRecordReceipt ? (
                          <Button
                            type="button"
                            className="min-h-11 w-full sm:w-auto"
                            data-control-size="44"
                            disabled={readOnly || !onRecordReceipt}
                            onClick={() =>
                              onRecordReceipt?.(submissionPackage.id)
                            }
                          >
                            <ReceiptText aria-hidden="true" />
                            Record human-obtained receipt
                          </Button>
                        ) : null}
                        {submissionPackage.status === "receipt_recorded" ? (
                          <span className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-emerald-800">
                            <CheckCircle2
                              aria-hidden="true"
                              className="size-4"
                            />
                            Custody record complete
                          </span>
                        ) : null}
                      </div>
                    </CardContent>
                  </article>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </OperationsSection>
  );
}

export default SubmissionWarRoom;
