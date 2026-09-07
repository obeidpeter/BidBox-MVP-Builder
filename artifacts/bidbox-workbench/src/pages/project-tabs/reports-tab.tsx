import {
  useListReports,
  useGenerateReport,
  useSignOffReport,
  useRunResponsivenessReview,
  exportProject,
  downloadReport,
  downloadReportPdf,
  getListReportsQueryKey,
  getGetProjectQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { DataErrorPanel } from "@/components/platform-states";
import { useEffect, useRef, useState } from "react";
import { useOrganisationPermission } from "@/contexts/organisation-context";

export function ReportsTab({ projectId }: { projectId: string }) {
  const reportsQuery = useListReports(projectId);
  const { data: reports, isLoading, isError } = reportsQuery;
  const generateReport = useGenerateReport();
  const signOffReport = useSignOffReport();
  const runResponsiveness = useRunResponsivenessReview();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [exporting, setExporting] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const canGenerateReport = useOrganisationPermission("report:generate");
  const canSignOffReport = useOrganisationPermission("report:sign_off");
  const canExportReport = useOrganisationPermission("report:export");

  useEffect(
    () => () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    },
    [],
  );

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

  const handleSignOff = (id: string) => {
    signOffReport.mutate(
      {
        id,
        data: {
          attestation:
            "I have reviewed the findings in this report and confirm them as the responsible reviewer.",
        },
      },
      {
        onSuccess: invalidateAll,
        onError: mutationErrorToast(
          toast,
          "Sign-off blocked",
          "The report could not be signed off. Resolve any open fatal defects and try again.",
        ),
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
    setExporting(true);
    try {
      const blob = await exportProject(projectId);
      saveBlob(blob, `project-${projectId}-export.zip`);
    } catch (err) {
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

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-serif font-medium">Package and export</h2>
        <div className="flex gap-2">
          {canGenerateReport ? (
            <Button
              variant="outline"
              onClick={handleResponsiveness}
              disabled={runResponsiveness.isPending}
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
              onClick={handleProjectExport}
              disabled={exporting}
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
              disabled={generateReport.isPending || isError}
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

      <div className="bg-card border border-border rounded-lg shadow-xs overflow-hidden">
        {isLoading ? (
          <div className="p-8 flex justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : isError ? (
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
              {reports.map((report) => (
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
                          onClick={() => handleSignOff(report.id)}
                          disabled={signOffReport.isPending}
                        >
                          <FileSignature className="w-4 h-4 mr-2" />
                          Sign off
                        </Button>
                      )}
                      {report.status === "signed_off" && canExportReport && (
                        <>
                          <Button
                            variant="default"
                            size="sm"
                            onClick={() =>
                              void handleDownload(report.id, "docx")
                            }
                            disabled={downloading === `${report.id}:docx`}
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
                            disabled={downloading === `${report.id}:pdf`}
                          >
                            <Download className="w-4 h-4 mr-2" />
                            Download PDF
                          </Button>
                        </>
                      )}
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
    </div>
  );
}
