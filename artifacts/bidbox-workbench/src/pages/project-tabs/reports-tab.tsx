import {
  useListReports,
  useGenerateReport,
  useSignOffReport,
  useRunResponsivenessReview,
  useListProjectPackageVersions,
  exportProject,
  downloadReport,
  downloadReportPdf,
  getListReportsQueryKey,
  getGetProjectQueryKey,
  getListProjectPackageVersionsQueryKey,
  type Report,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Loader2,
  FileBarChart,
  Download,
  FileSignature,
  ScrollText,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { errorMessage, mutationErrorToast } from "@/lib/errors";
import {
  DataErrorPanel,
  LoadingPanel,
  StatusPanel,
} from "@/components/platform-states";
import { useEffect, useRef, useState } from "react";
import { useOrganisationPermission } from "@/contexts/organisation-context";

const PROJECT_EXPORT_CONTENTS = [
  "project.json — canonical project snapshot",
  "requirements.csv — requirement register with review state",
  "evidence.csv — evidence register with review state",
  "defects.csv — defect register with review state",
  "boq_checks.csv — BOQ verification register",
  "audit_events.csv — governed audit export",
  "audit_export_policy.json — audit export policy",
  "documents_manifest.csv — project-document manifest",
  "scorecard.json — technical scorecard",
  "Signed report DOCX — exact latest signed report version named below",
] as const;

export function ReportsTab({ projectId }: { projectId: string }) {
  const canReadReports = useOrganisationPermission("report:read");
  const canReadPackages = useOrganisationPermission("package:read");
  const canGenerateReport = useOrganisationPermission("report:generate");
  const canSignOffReport = useOrganisationPermission("report:sign_off");
  const canExportReport = useOrganisationPermission("report:export");
  const reportsQuery = useListReports(projectId, {
    query: {
      enabled: canReadReports && projectId.trim().length > 0,
      queryKey: getListReportsQueryKey(projectId),
      retry: false,
    },
  });
  const {
    data: reports,
    isLoading,
    isError,
    isPending,
    isSuccess,
    isFetching,
  } = reportsQuery;
  const reportsLoading = isLoading || isPending;
  const reportsReady = isSuccess && Array.isArray(reports);
  const reportsCurrent = reportsReady && !isFetching;
  const reportsUnavailable = isError || (!reportsLoading && !reportsReady);
  const generateReport = useGenerateReport();
  const signOffReport = useSignOffReport();
  const runResponsiveness = useRunResponsivenessReview();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [exporting, setExporting] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [signOffCandidate, setSignOffCandidate] = useState<Report | null>(null);
  const [signOffAttestation, setSignOffAttestation] = useState("");
  const [signOffConfirmedBinding, setSignOffConfirmedBinding] = useState<
    string | null
  >(null);
  const [signOffError, setSignOffError] = useState<string | null>(null);
  const [exportPreflightOpen, setExportPreflightOpen] = useState(false);
  const [exportConfirmedBinding, setExportConfirmedBinding] = useState<
    string | null
  >(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const exportIdempotencyKeyRef = useRef<string | null>(null);
  const packageVersionsQuery = useListProjectPackageVersions(projectId, {
    query: {
      enabled: canReadPackages && reportsCurrent && projectId.trim().length > 0,
      queryKey: getListProjectPackageVersionsQueryKey(projectId),
      staleTime: 0,
      retry: false,
    },
  });
  const orderedReports = [...(reports ?? [])].sort(
    (left, right) => right.version - left.version,
  );
  const latestReport = orderedReports[0];
  const currentSignOffReport = signOffCandidate
    ? orderedReports.find((report) => report.id === signOffCandidate.id)
    : undefined;
  const signOffReportForDisplay = currentSignOffReport ?? signOffCandidate;
  const currentSignOffReportFingerprint =
    signOffCandidate && currentSignOffReport && reportsCurrent
      ? JSON.stringify({
          id: currentSignOffReport.id,
          projectId: currentSignOffReport.projectId,
          version: currentSignOffReport.version,
          status: currentSignOffReport.status,
          createdAt: currentSignOffReport.createdAt,
          generatedBy: currentSignOffReport.generatedBy,
          engineVersion: currentSignOffReport.engineVersion,
          promptPackVersion: currentSignOffReport.promptPackVersion,
          modelId: currentSignOffReport.modelId,
          taxonomyVersion: currentSignOffReport.taxonomyVersion,
        })
      : "";
  const currentSignOffConsentBinding = currentSignOffReportFingerprint
    ? JSON.stringify({
        report: currentSignOffReportFingerprint,
        attestation: signOffAttestation.trim(),
      })
    : "";
  const signOffConfirmed = Boolean(
    currentSignOffConsentBinding &&
    signOffConfirmedBinding === currentSignOffConsentBinding,
  );
  const currentPackageVersion = packageVersionsQuery.data?.items[0];
  const packageProvenanceReady = Boolean(
    canReadPackages &&
    packageVersionsQuery.isSuccess &&
    !packageVersionsQuery.isFetching &&
    packageVersionsQuery.data,
  );
  const exportKnownBlockers = [
    ...(!canReadReports ? ["Report history access is required."] : []),
    ...(!canReadPackages ? ["Package provenance access is required."] : []),
    ...(reportsLoading ? ["The current report history is still loading."] : []),
    ...(isFetching ? ["The current report history is refreshing."] : []),
    ...(reportsUnavailable
      ? ["The current report history could not be verified."]
      : []),
    ...(!latestReport
      ? ["No report version is available."]
      : latestReport.status !== "signed_off"
        ? [
            `Latest report v${latestReport.version} is ${latestReport.status.replaceAll("_", " ")}; the latest version must be signed off.`,
          ]
        : []),
    ...(packageVersionsQuery.isLoading ||
    packageVersionsQuery.isPending ||
    packageVersionsQuery.isFetching
      ? ["Current package provenance is still loading."]
      : []),
    ...(packageVersionsQuery.isError
      ? ["Current package provenance could not be verified."]
      : []),
    ...(!packageVersionsQuery.isLoading &&
    !packageVersionsQuery.isPending &&
    !packageVersionsQuery.isFetching &&
    !packageVersionsQuery.isError &&
    !packageProvenanceReady
      ? ["Current package provenance is unavailable."]
      : []),
    ...(packageVersionsQuery.data?.truncated ||
    (packageVersionsQuery.data?.items.length ?? 0) > 1
      ? ["Canonical package provenance is ambiguous."]
      : []),
    ...(currentPackageVersion?.renderQaStatus === "failed"
      ? ["The current canonical package version has failed render QA."]
      : currentPackageVersion?.renderQaStatus === "pending"
        ? ["The current canonical package version still has pending render QA."]
        : []),
  ];
  const signOffKnownBlockers = signOffCandidate
    ? [
        ...(!reportsCurrent
          ? ["The current report history is loading or refreshing."]
          : []),
        ...(!currentSignOffReport
          ? ["The selected report is no longer present in the current history."]
          : []),
        ...(currentSignOffReport && currentSignOffReport.status !== "draft"
          ? [
              `Report status is ${currentSignOffReport.status.replaceAll("_", " ")}.`,
            ]
          : []),
        ...(latestReport?.id !== currentSignOffReport?.id
          ? [
              "A newer report version exists; only the latest may be signed off.",
            ]
          : []),
        ...(!currentSignOffReport?.generatedBy
          ? ["The generating user ID is not recorded."]
          : []),
        ...(!currentSignOffReport?.engineVersion
          ? ["The report engine version is not recorded."]
          : []),
        ...(!currentSignOffReport?.promptPackVersion
          ? ["The prompt-pack version is not recorded."]
          : []),
        ...(!currentSignOffReport?.modelId
          ? ["The report model ID is not recorded."]
          : []),
        ...(!currentSignOffReport?.taxonomyVersion
          ? ["The taxonomy version is not recorded."]
          : []),
      ]
    : [];
  const currentExportPreflightBinding =
    exportPreflightOpen &&
    reportsCurrent &&
    packageProvenanceReady &&
    latestReport
      ? JSON.stringify({
          report: {
            id: latestReport.id,
            version: latestReport.version,
            status: latestReport.status,
            createdAt: latestReport.createdAt,
          },
          package: currentPackageVersion
            ? {
                packageId: currentPackageVersion.packageId,
                packageVersionId: currentPackageVersion.packageVersionId,
                versionNumber: currentPackageVersion.versionNumber,
                manifestSha256: currentPackageVersion.manifestSha256,
                sourceSnapshotSha256:
                  currentPackageVersion.sourceSnapshotSha256,
                renderQaStatus: currentPackageVersion.renderQaStatus,
                createdAt: currentPackageVersion.createdAt,
              }
            : null,
          exportScopeSha256:
            packageVersionsQuery.data?.exportScopeSha256 ?? null,
        })
      : "";
  const exportConfirmed = Boolean(
    currentExportPreflightBinding &&
    exportConfirmedBinding === currentExportPreflightBinding,
  );

  useEffect(
    () => () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    },
    [],
  );

  useEffect(() => {
    setExportConfirmedBinding(null);
    exportIdempotencyKeyRef.current = null;
  }, [currentExportPreflightBinding]);

  useEffect(() => {
    setSignOffConfirmedBinding(null);
    setSignOffAttestation("");
    setSignOffError(null);
  }, [currentSignOffReportFingerprint]);

  const saveBlob = (blob: Blob, filename: string) => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const url = URL.createObjectURL(blob);
    objectUrlRef.current = url;
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const invalidateAll = () => {
    queryClient.invalidateQueries({
      queryKey: getListReportsQueryKey(projectId),
    });
    // The project header badge reflects status (reporting -> signed_off), so
    // refresh the project too after generate/sign-off flips it.
    queryClient.invalidateQueries({
      queryKey: getGetProjectQueryKey(projectId),
    });
  };

  const handleGenerate = () => {
    generateReport.mutate(
      { id: projectId },
      {
        onSuccess: invalidateAll,
        onError: mutationErrorToast(toast, "Report generation failed"),
      },
    );
  };

  const openSignOffPreflight = (report: Report) => {
    setSignOffAttestation("");
    setSignOffConfirmedBinding(null);
    setSignOffError(null);
    setSignOffCandidate(report);
  };

  const handleSignOff = () => {
    if (
      !currentSignOffReport ||
      currentSignOffReport.status !== "draft" ||
      signOffAttestation.trim().length < 20 ||
      !signOffConfirmed ||
      signOffKnownBlockers.length > 0 ||
      !reportsCurrent
    ) {
      return;
    }
    signOffReport.mutate(
      {
        id: currentSignOffReport.id,
        data: {
          attestation: signOffAttestation.trim(),
        },
      },
      {
        onSuccess: () => {
          setSignOffCandidate(null);
          setSignOffAttestation("");
          setSignOffConfirmedBinding(null);
          setSignOffError(null);
          invalidateAll();
        },
        onError: (error: unknown) => {
          setSignOffConfirmedBinding(null);
          setSignOffError(
            errorMessage(
              error,
              "The report could not be signed off. Resolve any open fatal defects and refresh the exact version before trying again.",
            ),
          );
          mutationErrorToast(
            toast,
            "Sign-off blocked",
            "The report could not be signed off. Resolve any open fatal defects and try again.",
          )(error);
        },
      },
    );
  };

  const handleDownload = async (id: string, format: "docx" | "pdf") => {
    const key = `${id}:${format}`;
    setDownloading(key);
    try {
      const blob =
        format === "pdf"
          ? await downloadReportPdf(id)
          : await downloadReport(id);
      saveBlob(blob, `report-${id}.${format}`);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Report download blocked",
        description: errorMessage(
          err,
          "The signed report could not be downloaded in the selected organisation context.",
        ),
      });
    } finally {
      setDownloading(null);
    }
  };

  const handleResponsiveness = () => {
    runResponsiveness.mutate(
      { id: projectId },
      {
        onSuccess: () => {
          // The narrative lands on the project row (section E of the report).
          queryClient.invalidateQueries({
            queryKey: getGetProjectQueryKey(projectId),
          });
          toast({
            title: "Responsiveness review drafted",
            description:
              "The suggested narrative was saved to the project and will appear in section E of the next report. Review it before sign-off.",
          });
        },
        onError: mutationErrorToast(
          toast,
          "Responsiveness review failed",
          "The LLM review did not complete. Try again.",
        ),
      },
    );
  };

  const handleProjectExport = async () => {
    if (
      !exportConfirmed ||
      exportKnownBlockers.length > 0 ||
      !reportsCurrent ||
      !packageProvenanceReady ||
      !latestReport
    )
      return;
    setExporting(true);
    try {
      exportIdempotencyKeyRef.current ??= globalThis.crypto.randomUUID();
      const blob = await exportProject(
        projectId,
        {
          reportId: latestReport.id,
          reportVersion: latestReport.version,
          packageVersionId: currentPackageVersion?.packageVersionId ?? null,
          packageVersionNumber: currentPackageVersion?.versionNumber ?? null,
          packageManifestSha256: currentPackageVersion?.manifestSha256 ?? null,
          packageSourceSnapshotSha256:
            currentPackageVersion?.sourceSnapshotSha256 ?? null,
        },
        exportIdempotencyKeyRef.current,
        `"${packageVersionsQuery.data!.exportScopeSha256}"`,
      );
      saveBlob(blob, `project-${projectId}-export.zip`);
      setExportError(null);
      setExportPreflightOpen(false);
      setExportConfirmedBinding(null);
      exportIdempotencyKeyRef.current = null;
    } catch (err) {
      setExportConfirmedBinding(null);
      setExportError(
        errorMessage(
          err,
          "The package could not be exported. Refresh the exact report and package provenance, then resolve any archive or readiness blocker.",
        ),
      );
      toast({
        variant: "destructive",
        title: "Pursuit export blocked",
        description: errorMessage(
          err,
          "Confirm physical archive instructions before exporting a signed-off pursuit.",
        ),
      });
    } finally {
      setExporting(false);
    }
  };

  const openExportPreflight = () => {
    setExportConfirmedBinding(null);
    setExportError(null);
    exportIdempotencyKeyRef.current = null;
    setExportPreflightOpen(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-serif font-medium">Package and export</h2>
        <div className="flex gap-2">
          {canGenerateReport ? (
            <Button
              variant="outline"
              onClick={handleResponsiveness}
              disabled={runResponsiveness.isPending || !reportsCurrent}
            >
              {runResponsiveness.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <ScrollText className="w-4 h-4 mr-2" />
              )}
              Draft responsiveness review
            </Button>
          ) : null}
          {canExportReport ? (
            <Button
              variant="outline"
              onClick={openExportPreflight}
              disabled={
                exporting ||
                !canReadReports ||
                !canReadPackages ||
                !reportsCurrent ||
                packageVersionsQuery.isLoading ||
                packageVersionsQuery.isPending ||
                packageVersionsQuery.isFetching
              }
            >
              {exporting ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Download className="w-4 h-4 mr-2" />
              )}
              Export ZIP package
            </Button>
          ) : null}
          {canGenerateReport ? (
            <Button
              onClick={handleGenerate}
              disabled={generateReport.isPending || !reportsCurrent}
            >
              {generateReport.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <FileBarChart className="w-4 h-4 mr-2" />
              )}
              Generate report
            </Button>
          ) : null}
        </div>
      </div>

      {!canReadPackages && canExportReport ? (
        <StatusPanel
          state="blocked"
          title="Package provenance access required"
          description="Package export is paused because this role cannot read the exact canonical package version and source fingerprint. No package request was sent."
        />
      ) : null}

      <div className="bg-card border border-border rounded-lg shadow-xs overflow-hidden">
        {!canReadReports ? (
          <div className="p-5">
            <StatusPanel
              state="blocked"
              title="Report access required"
              description="This role cannot read report history. No report request was sent, and report-dependent actions remain paused."
            />
          </div>
        ) : reportsLoading ? (
          <div className="p-5">
            <LoadingPanel label="Loading report history" />
          </div>
        ) : reportsUnavailable ? (
          <div className="p-5">
            <DataErrorPanel
              title="Report list unavailable"
              description="The report list could not be loaded. This does not mean the history is empty, so report generation is paused until the current status can be checked."
              onRetry={() => {
                void reportsQuery.refetch();
              }}
            />
          </div>
        ) : reports && reports.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead>Version</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Reviewer</TableHead>
                <TableHead>Generated at</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orderedReports.map((report) => (
                <TableRow key={report.id}>
                  <TableCell className="font-medium font-mono text-sm">
                    v{report.version}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        report.status === "signed_off" ? "default" : "secondary"
                      }
                      className="capitalize text-xs"
                    >
                      {report.status.replace("_", " ")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">
                    {report.status === "signed_off" && report.reviewerName ? (
                      <span className="text-foreground">
                        {report.reviewerName}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(report.createdAt).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      {report.status === "draft" && canSignOffReport && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openSignOffPreflight(report)}
                          disabled={signOffReport.isPending || !reportsCurrent}
                        >
                          <FileSignature className="w-4 h-4 mr-2" />
                          Sign off
                        </Button>
                      )}
                      {report.status === "signed_off" &&
                      canExportReport &&
                      report.id === latestReport?.id ? (
                        <>
                          <Button
                            variant="default"
                            size="sm"
                            onClick={() =>
                              void handleDownload(report.id, "docx")
                            }
                            disabled={
                              downloading === `${report.id}:docx` ||
                              !reportsCurrent
                            }
                          >
                            <Download className="w-4 h-4 mr-2" />
                            Download DOCX
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              void handleDownload(report.id, "pdf")
                            }
                            disabled={
                              downloading === `${report.id}:pdf` ||
                              !reportsCurrent
                            }
                          >
                            <Download className="w-4 h-4 mr-2" />
                            Download PDF
                          </Button>
                        </>
                      ) : report.status === "signed_off" && canExportReport ? (
                        <p className="max-w-52 text-xs leading-5 text-muted-foreground">
                          Historical signed version. Only the latest report
                          version can be downloaded; the latest is v
                          {latestReport?.version ?? "—"} (
                          {latestReport?.status.replaceAll("_", " ") ??
                            "unavailable"}
                          ).
                        </p>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="p-12 text-center text-muted-foreground">
            <FileBarChart className="w-12 h-12 mx-auto mb-3 text-muted" />
            <p>No reports generated yet.</p>
          </div>
        )}
      </div>

      <Dialog
        open={signOffCandidate !== null}
        onOpenChange={(open) => {
          if (!open && !signOffReport.isPending) {
            setSignOffCandidate(null);
            setSignOffAttestation("");
            setSignOffConfirmedBinding(null);
          }
        }}
      >
        <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
          {signOffReportForDisplay ? (
            <>
              <DialogHeader>
                <DialogTitle>Confirm report sign-off</DialogTitle>
                <DialogDescription>
                  Sign-off is an audited named-human decision on this exact
                  report version. The server revalidates reviewer authority,
                  latest-version status and every release blocker inside the
                  final transaction.
                </DialogDescription>
              </DialogHeader>
              <section
                className="grid gap-4 rounded-lg border border-border p-4"
                aria-labelledby="report-sign-off-preflight-title"
              >
                <div>
                  <h3
                    id="report-sign-off-preflight-title"
                    className="text-sm font-semibold"
                  >
                    Preflight — exact report and provenance
                  </h3>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    The list projection does not repeat the report body. This
                    decision is bound to the immutable report ID and version
                    below; no different identifier can be entered here.
                  </p>
                </div>
                <dl className="grid gap-3 text-xs sm:grid-cols-2">
                  <div>
                    <dt className="text-muted-foreground">Report version</dt>
                    <dd className="mt-0.5 font-medium">
                      v{signOffReportForDisplay.version} ·{" "}
                      {signOffReportForDisplay.status.replaceAll("_", " ")}
                    </dd>
                    <dd className="mt-0.5 break-all font-mono">
                      {signOffReportForDisplay.id}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Generated</dt>
                    <dd className="mt-0.5">
                      {new Date(
                        signOffReportForDisplay.createdAt,
                      ).toLocaleString()}
                    </dd>
                    <dd className="mt-0.5 break-all font-mono">
                      {signOffReportForDisplay.generatedByName ??
                        "Unnamed generator"}{" "}
                      ·{" "}
                      {signOffReportForDisplay.generatedBy ?? "ID not recorded"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Engine / model</dt>
                    <dd className="mt-0.5 break-words font-mono">
                      {signOffReportForDisplay.engineVersion ?? "Not recorded"}{" "}
                      / {signOffReportForDisplay.modelId ?? "Not recorded"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">
                      Prompt pack / taxonomy
                    </dt>
                    <dd className="mt-0.5 break-words font-mono">
                      {signOffReportForDisplay.promptPackVersion ??
                        "Not recorded"}{" "}
                      /{" "}
                      {signOffReportForDisplay.taxonomyVersion ??
                        "Not recorded"}
                    </dd>
                  </div>
                </dl>
                <div
                  className={`rounded-md border p-3 text-sm leading-6 ${
                    signOffKnownBlockers.length === 0
                      ? "border-emerald-200 bg-emerald-50 text-emerald-950"
                      : "border-red-200 bg-red-50 text-red-950"
                  }`}
                >
                  {signOffKnownBlockers.length === 0 ? (
                    <p>
                      No blocker is exposed by the report-list projection. Open
                      fatal defects, readiness gates, assigned-reviewer
                      authority and organisation membership are still rechecked
                      by the server before sign-off.
                    </p>
                  ) : (
                    <div>
                      <p className="font-medium">Unresolved blockers</p>
                      <ul className="mt-1 list-disc space-y-1 pl-5">
                        {signOffKnownBlockers.map((blocker) => (
                          <li key={blocker}>{blocker}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
                {signOffError ? (
                  <div
                    role="alert"
                    className="rounded-md border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-950"
                  >
                    <p className="font-medium">Sign-off was not recorded</p>
                    <p className="mt-1">{signOffError}</p>
                  </div>
                ) : null}
                <div className="grid gap-1.5">
                  <Label htmlFor="report-sign-off-attestation">
                    Named reviewer attestation
                  </Label>
                  <Textarea
                    id="report-sign-off-attestation"
                    value={signOffAttestation}
                    onChange={(event) => {
                      setSignOffAttestation(event.currentTarget.value);
                      setSignOffConfirmedBinding(null);
                    }}
                    rows={5}
                    maxLength={2_000}
                    placeholder="State what you reviewed in this exact report version and why it is ready for sign-off."
                  />
                  <p className="text-xs leading-5 text-muted-foreground">
                    Enter at least 20 characters. This text is stored with the
                    sign-off record; it is not a generic acknowledgement.
                  </p>
                </div>
                <label
                  htmlFor="report-sign-off-confirmation"
                  className="flex items-start gap-3 rounded-md border border-border p-3 text-sm leading-6"
                >
                  <input
                    id="report-sign-off-confirmation"
                    type="checkbox"
                    className="mt-1 size-4"
                    checked={signOffConfirmed}
                    onChange={(event) =>
                      setSignOffConfirmedBinding(
                        event.currentTarget.checked
                          ? currentSignOffConsentBinding
                          : null,
                      )
                    }
                    disabled={
                      signOffKnownBlockers.length > 0 || signOffReport.isPending
                    }
                  />
                  <span>
                    I confirm that this attestation applies to report v
                    {signOffReportForDisplay.version} with ID{" "}
                    <span className="break-all font-mono">
                      {signOffReportForDisplay.id}
                    </span>
                    , and understand that sign-off is an audited release gate.
                  </span>
                </label>
              </section>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setSignOffCandidate(null);
                    setSignOffAttestation("");
                    setSignOffConfirmedBinding(null);
                  }}
                  disabled={signOffReport.isPending}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={handleSignOff}
                  disabled={
                    signOffReport.isPending ||
                    signOffKnownBlockers.length > 0 ||
                    signOffAttestation.trim().length < 20 ||
                    !signOffConfirmed
                  }
                >
                  {signOffReport.isPending ? (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  ) : (
                    <FileSignature className="mr-2 size-4" />
                  )}
                  Sign off exact report version
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={exportPreflightOpen}
        onOpenChange={(open) => {
          if (!open && !exporting) {
            setExportPreflightOpen(false);
            setExportConfirmedBinding(null);
          }
        }}
      >
        <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Confirm ZIP package export</DialogTitle>
            <DialogDescription>
              Export creates or reuses a canonical governed package, downloads
              it to this browser and may transition a signed-off pursuit to
              exported. It does not submit anything to an external portal.
            </DialogDescription>
          </DialogHeader>
          <section
            className="grid gap-4 rounded-lg border border-border p-4"
            aria-labelledby="project-export-preflight-title"
          >
            <div>
              <h3
                id="project-export-preflight-title"
                className="text-sm font-semibold"
              >
                Preflight — exact package scope
              </h3>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Project <span className="font-mono">{projectId}</span>. The
                server regenerates the manifest from current governed records
                and, under the final lock, rejects a changed project, report,
                package fingerprint or NDA before persisting or streaming the
                ZIP. Readiness gates are evaluated while the archive is built.
              </p>
            </div>
            <dl className="grid gap-3 text-xs sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">
                  Latest report included
                </dt>
                <dd className="mt-0.5 font-medium">
                  {latestReport
                    ? `v${latestReport.version} · ${latestReport.status.replaceAll("_", " ")}`
                    : "No report available"}
                </dd>
                <dd className="mt-0.5 break-all font-mono">
                  {latestReport?.id ?? "Not recorded"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">
                  Current canonical package
                </dt>
                <dd className="mt-0.5 font-medium">
                  {currentPackageVersion
                    ? `v${currentPackageVersion.versionNumber} · render QA ${currentPackageVersion.renderQaStatus}`
                    : "No prior canonical version; the server will assign one"}
                </dd>
                <dd className="mt-0.5 break-all font-mono">
                  {currentPackageVersion?.packageVersionId ?? "Not assigned"}
                </dd>
              </div>
              {currentPackageVersion ? (
                <div className="sm:col-span-2">
                  <dt className="text-muted-foreground">
                    Current manifest SHA-256
                  </dt>
                  <dd className="mt-0.5 break-all font-mono">
                    {currentPackageVersion.manifestSha256}
                  </dd>
                  <dt className="mt-2 text-muted-foreground">
                    Current source snapshot SHA-256
                  </dt>
                  <dd className="mt-0.5 break-all font-mono">
                    {currentPackageVersion.sourceSnapshotSha256}
                  </dd>
                  <dd className="mt-0.5 text-muted-foreground">
                    Created{" "}
                    {new Date(currentPackageVersion.createdAt).toLocaleString()}
                    . A changed governed input creates different package
                    provenance.
                  </dd>
                </div>
              ) : null}
            </dl>
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                ZIP contents
              </p>
              <ul className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
                {PROJECT_EXPORT_CONTENTS.map((item) => (
                  <li
                    key={item}
                    className="rounded-md border border-border bg-muted/20 p-2.5"
                  >
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div
              className={`rounded-md border p-3 text-sm leading-6 ${
                exportKnownBlockers.length === 0
                  ? "border-emerald-200 bg-emerald-50 text-emerald-950"
                  : "border-red-200 bg-red-50 text-red-950"
              }`}
            >
              {exportKnownBlockers.length === 0 ? (
                <p>
                  No blocker is exposed by the current report and package
                  metadata. The server evaluates readiness while assembling the
                  archive, then locks and rechecks the exact project, report,
                  package fingerprint and NDA before durable effects.
                </p>
              ) : (
                <div>
                  <p className="font-medium">Unresolved blockers</p>
                  <ul className="mt-1 list-disc space-y-1 pl-5">
                    {exportKnownBlockers.map((blocker) => (
                      <li key={blocker}>{blocker}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            {exportError ? (
              <div
                role="alert"
                className="rounded-md border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-950"
              >
                <p className="font-medium">ZIP export did not complete</p>
                <p className="mt-1">{exportError}</p>
              </div>
            ) : null}
            <label
              htmlFor="project-export-confirmation"
              className="flex items-start gap-3 rounded-md border border-border p-3 text-sm leading-6"
            >
              <input
                id="project-export-confirmation"
                type="checkbox"
                className="mt-1 size-4"
                checked={exportConfirmed}
                onChange={(event) =>
                  setExportConfirmedBinding(
                    event.currentTarget.checked
                      ? currentExportPreflightBinding
                      : null,
                  )
                }
                disabled={exportKnownBlockers.length > 0 || exporting}
              />
              <span>
                I reviewed this exact report and package scope, understand the
                local download and project-state consequence, and confirm that
                final external delivery remains a separate authorised action.
              </span>
            </label>
          </section>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setExportPreflightOpen(false);
                setExportConfirmedBinding(null);
              }}
              disabled={exporting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void handleProjectExport()}
              disabled={
                exporting || !exportConfirmed || exportKnownBlockers.length > 0
              }
            >
              {exporting ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Download className="mr-2 size-4" />
              )}
              Export confirmed ZIP package
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
