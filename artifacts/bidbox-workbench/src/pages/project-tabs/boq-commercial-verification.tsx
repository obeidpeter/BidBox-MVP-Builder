import {
  useListDocuments,
  getListDocumentsQueryKey,
  useGetBoqVerification,
  getGetBoqVerificationQueryKey,
  useGetBoqVerificationRun,
  getGetBoqVerificationRunQueryKey,
  useCreateBoqVerificationRun,
  resolveBoqVerificationException,
  type BoqVerificationException,
  type BoqVerificationLine,
} from "@workspace/api-client-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Calculator } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { useOrganisationPermission } from "@/contexts/organisation-context";

// ---------------------------------------------------------------------------
// Commercial verification (v2): the server pins the Nigeria rule pack, binds
// each run to the current cleared version of a governed project document, and
// records lot-level tax/discount/bid-security exceptions for named-human
// resolution. All decimals travel as strings — floats never carry money.
// ---------------------------------------------------------------------------

/** Strip currency symbols (₦/$/€/£), commas and whitespace from a money cell;
 *  rewrite accounting-style parenthesised negatives to a leading minus. */
export function cleanMoneyCell(value: string): string {
  let cleaned = value.replace(/[₦$€£,\s]/g, "");
  const paren = /^\((.*)\)$/.exec(cleaned);
  if (paren) cleaned = `-${paren[1]}`;
  return cleaned;
}

/** Normalise a workbook money/number cell to a plain decimal string. */
function toDecimalString(value: string | undefined): string | null {
  if (value == null) return null;
  const cleaned = cleanMoneyCell(value);
  if (!/^-?\d{1,24}(\.\d{1,12})?$/.test(cleaned)) return null;
  return cleaned;
}

function sanitizeLineId(raw: string | undefined, fallback: string): string {
  const cleaned = (raw ?? "").replace(/[^\w./:-]/g, "-").slice(0, 100);
  return /[\w]/.test(cleaned) ? cleaned : fallback;
}

function percentToBasisPoints(value: string): number | null {
  if (!value.trim()) return 0;
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) return null;
  return Math.round(parsed * 100);
}

const SEVERITY_LABEL: Record<string, string> = {
  fatal: "Fatal",
  likely_fatal: "Likely fatal",
  scoring_risk: "Scoring risk",
};

export function CommercialVerificationSection({
  projectId,
  dataRows,
  cellFor,
  requiredColumnsMapped,
}: {
  projectId: string;
  dataRows: string[][];
  cellFor: (
    row: string[],
    key: "lineRef" | "quantity" | "unitRate" | "extension",
  ) => string | undefined;
  requiredColumnsMapped: boolean;
}) {
  const canRun = useOrganisationPermission("defect:write");
  const canResolve = useOrganisationPermission("defect:review");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: snapshot, isLoading: snapshotLoading } =
    useGetBoqVerification(projectId);
  const { data: documents } = useListDocuments(projectId, {
    query: { queryKey: getListDocumentsQueryKey(projectId), enabled: canRun },
  });
  const createRun = useCreateBoqVerificationRun();

  const [documentId, setDocumentId] = useState("");
  const [lotRef, setLotRef] = useState("lot-1");
  const [declaredNet, setDeclaredNet] = useState("");
  const [discountPercent, setDiscountPercent] = useState("");
  const [declaredDiscount, setDeclaredDiscount] = useState("");
  const [declaredTaxableBase, setDeclaredTaxableBase] = useState("");
  const [declaredVat, setDeclaredVat] = useState("");
  const [declaredGross, setDeclaredGross] = useState("");
  const [declaredNetPayable, setDeclaredNetPayable] = useState("");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const [resolveTarget, setResolveTarget] =
    useState<BoqVerificationException | null>(null);
  const [resolveStatus, setResolveStatus] = useState<"resolved" | "waived">(
    "resolved",
  );
  const [resolveReason, setResolveReason] = useState("");

  const activeRunId = selectedRunId ?? snapshot?.runs[0]?.id ?? null;
  const { data: runDetail } = useGetBoqVerificationRun(
    projectId,
    activeRunId ?? "",
    {
      query: {
        queryKey: getGetBoqVerificationRunQueryKey(
          projectId,
          activeRunId ?? "",
        ),
        enabled: Boolean(activeRunId),
      },
    },
  );

  const resolveException = useMutation({
    mutationFn: async (input: {
      exception: BoqVerificationException;
      status: "resolved" | "waived";
      reason: string;
    }) =>
      resolveBoqVerificationException(
        projectId,
        input.exception.id,
        { status: input.status, reason: input.reason },
        { headers: { "If-Match": `"${input.exception.version}"` } },
      ),
    onSuccess: () => {
      setResolveTarget(null);
      setResolveReason("");
      queryClient.invalidateQueries({
        queryKey: getGetBoqVerificationQueryKey(projectId),
      });
      if (activeRunId) {
        queryClient.invalidateQueries({
          queryKey: getGetBoqVerificationRunQueryKey(projectId, activeRunId),
        });
      }
      toast({ title: "Exception resolution recorded" });
    },
    onError: () =>
      toast({
        variant: "destructive",
        title: "Resolution failed",
        description:
          "The exception may have changed in another session. Reload and retry.",
      }),
  });

  const handleRunVerification = () => {
    const net = toDecimalString(declaredNet);
    const vat = toDecimalString(declaredVat);
    const gross = toDecimalString(declaredGross);
    const discountBp = percentToBasisPoints(discountPercent);
    const discount = declaredDiscount.trim()
      ? toDecimalString(declaredDiscount)
      : "0";
    const lotId = sanitizeLineId(lotRef, "lot-1");
    if (!documentId) {
      toast({
        variant: "destructive",
        title: "Select the approved source document for this workbook",
      });
      return;
    }
    if (net == null || vat == null || gross == null || discount == null) {
      toast({
        variant: "destructive",
        title: "Declared net, VAT and gross totals are required decimals",
      });
      return;
    }
    if (discountBp == null) {
      toast({
        variant: "destructive",
        title: "Discount percentage must be between 0 and 100",
      });
      return;
    }
    const taxable = declaredTaxableBase.trim()
      ? toDecimalString(declaredTaxableBase)
      : discount === "0"
        ? net
        : null;
    if (taxable == null) {
      toast({
        variant: "destructive",
        title: "A discounted bid needs its declared taxable base",
      });
      return;
    }
    const netPayable = declaredNetPayable.trim()
      ? toDecimalString(declaredNetPayable)
      : gross;
    if (netPayable == null) {
      toast({
        variant: "destructive",
        title: "Declared net payable must be a decimal",
      });
      return;
    }

    const lines: BoqVerificationLine[] = [];
    const seen = new Set<string>();
    let skipped = 0;
    dataRows.forEach((row, index) => {
      const quantity = toDecimalString(cellFor(row, "quantity"));
      const unitRate = toDecimalString(cellFor(row, "unitRate"));
      const extension = toDecimalString(cellFor(row, "extension"));
      if (quantity == null && unitRate == null && extension == null) return;
      if (quantity == null || unitRate == null || extension == null) {
        skipped += 1;
        return;
      }
      let id = sanitizeLineId(cellFor(row, "lineRef"), `row-${index + 1}`);
      while (seen.has(id)) id = `${id}.${index + 1}`;
      seen.add(id);
      lines.push({
        id,
        lotId,
        currency: "NGN",
        quantity,
        unitRate,
        displayedExtension: extension,
      });
    });
    if (lines.length === 0) {
      toast({
        variant: "destructive",
        title: "No fully priced rows to verify",
        description:
          "Commercial verification needs quantity, rate and amount on each row.",
      });
      return;
    }

    createRun.mutate(
      {
        projectId,
        data: {
          documentId,
          lines,
          lots: [
            {
              lotId,
              currency: "NGN",
              declaredNet: net,
              discountRateBasisPoints: discountBp,
              declaredDiscount: discount,
              declaredTaxableBase: taxable,
              vatRateBasisPoints: 750,
              declaredVat: vat,
              declaredGross: gross,
              declaredNetPayable: netPayable,
            },
          ],
        },
      },
      {
        onSuccess: (result) => {
          setSelectedRunId(result.run.id);
          queryClient.invalidateQueries({
            queryKey: getGetBoqVerificationQueryKey(projectId),
          });
          toast({
            title: result.run.passed
              ? "Commercial verification passed"
              : `${result.run.exceptionCount} exception(s) recorded`,
            description: `Rule pack ${result.run.rulePackId}.${
              skipped > 0
                ? ` ${skipped} partially priced row(s) were excluded.`
                : ""
            }`,
          });
        },
        onError: () =>
          toast({
            variant: "destructive",
            title: "Commercial verification failed",
            description:
              "Check the source document selection and declared totals, then retry.",
          }),
      },
    );
  };

  return (
    <div className="bg-card border border-border p-4 rounded-lg shadow-xs space-y-4">
      <div>
        <h3 className="text-sm font-medium">Commercial verification</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Check lot-level VAT, discounts and totals with the selected Nigeria
          rule set{snapshot ? ` (${snapshot.rulePackId})` : ""}. These checks
          use only the figures supplied by the client. A pass is not a pricing
          or award opinion.
        </p>
      </div>

      {canRun && dataRows.length > 0 && (
        <div className="space-y-3 border border-border rounded-md p-3">
          {!requiredColumnsMapped ? (
            <p className="text-xs text-muted-foreground">
              Map the Quantity, Unit Rate and Amount columns above to enable
              commercial verification of the loaded rows.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="space-y-1 col-span-2">
                  <label className="text-xs font-medium text-muted-foreground uppercase">
                    Approved source document
                  </label>
                  <Select value={documentId} onValueChange={setDocumentId}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Select the uploaded BOQ document" />
                    </SelectTrigger>
                    <SelectContent>
                      {(documents ?? []).map((doc) => (
                        <SelectItem key={doc.id} value={doc.id}>
                          {doc.filename}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground uppercase">
                    Lot reference
                  </label>
                  <Input
                    className="h-8 text-sm"
                    value={lotRef}
                    onChange={(e) => setLotRef(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground uppercase">
                    Declared net total
                  </label>
                  <Input
                    className="h-8 text-sm"
                    placeholder="e.g. 4,000,000.00"
                    value={declaredNet}
                    onChange={(e) => setDeclaredNet(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground uppercase">
                    Discount % (0 if none)
                  </label>
                  <Input
                    className="h-8 text-sm"
                    placeholder="0"
                    value={discountPercent}
                    onChange={(e) => setDiscountPercent(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground uppercase">
                    Declared discount
                  </label>
                  <Input
                    className="h-8 text-sm"
                    placeholder="0.00"
                    value={declaredDiscount}
                    onChange={(e) => setDeclaredDiscount(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground uppercase">
                    Declared taxable base
                  </label>
                  <Input
                    className="h-8 text-sm"
                    placeholder="defaults to net"
                    value={declaredTaxableBase}
                    onChange={(e) => setDeclaredTaxableBase(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground uppercase">
                    Declared VAT (7.5%)
                  </label>
                  <Input
                    className="h-8 text-sm"
                    placeholder="e.g. 300,000.00"
                    value={declaredVat}
                    onChange={(e) => setDeclaredVat(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground uppercase">
                    Declared gross total
                  </label>
                  <Input
                    className="h-8 text-sm"
                    placeholder="e.g. 4,300,000.00"
                    value={declaredGross}
                    onChange={(e) => setDeclaredGross(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground uppercase">
                    Declared net payable
                  </label>
                  <Input
                    className="h-8 text-sm"
                    placeholder="defaults to gross"
                    value={declaredNetPayable}
                    onChange={(e) => setDeclaredNetPayable(e.target.value)}
                  />
                </div>
              </div>
              <Button
                onClick={handleRunVerification}
                disabled={createRun.isPending}
              >
                {createRun.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Calculator className="w-4 h-4 mr-2" />
                )}
                Run commercial checks
              </Button>
            </>
          )}
        </div>
      )}

      {snapshotLoading ? (
        <div className="p-6 flex justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : snapshot && snapshot.runs.length > 0 ? (
        <>
          <div className="border border-border rounded-md overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead>Run</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Exceptions</TableHead>
                  <TableHead>Rule pack</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {snapshot.runs.map((run) => (
                  <TableRow
                    key={run.id}
                    className={
                      run.id === activeRunId ? "bg-muted/40" : "cursor-pointer"
                    }
                    onClick={() => setSelectedRunId(run.id)}
                  >
                    <TableCell className="text-xs font-mono">
                      {new Date(run.startedAt).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={run.passed ? "outline" : "destructive"}
                        className="text-xs"
                      >
                        {run.passed ? "Passed" : "Exceptions recorded"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {run.exceptionCount}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {run.rulePackId}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {runDetail && runDetail.exceptions.length > 0 && (
            <div className="border border-border rounded-md overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead>Exception</TableHead>
                    <TableHead>Severity</TableHead>
                    <TableHead>Lot / Line</TableHead>
                    <TableHead>Finding</TableHead>
                    <TableHead className="text-right">
                      Expected / Actual (kobo)
                    </TableHead>
                    <TableHead>Status</TableHead>
                    {canResolve && <TableHead className="w-[90px]"></TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runDetail.exceptions.map((exception) => (
                    <TableRow key={exception.id}>
                      <TableCell className="text-xs font-mono">
                        {exception.exceptionCode}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            exception.severity === "scoring_risk"
                              ? "secondary"
                              : "destructive"
                          }
                          className="text-xs"
                        >
                          {SEVERITY_LABEL[exception.severity] ??
                            exception.severity}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs font-mono">
                        {exception.lotReference ?? "-"}
                        {exception.cellReference
                          ? ` / ${exception.cellReference}`
                          : ""}
                      </TableCell>
                      <TableCell className="text-sm max-w-[320px]">
                        {exception.finding}
                        {exception.resolutionReason && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {exception.status}: {exception.resolutionReason}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-xs font-mono">
                        {exception.expectedMinor ?? "-"} /{" "}
                        {exception.actualMinor ?? "-"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize text-xs">
                          {exception.status}
                        </Badge>
                      </TableCell>
                      {canResolve && (
                        <TableCell className="text-right">
                          {exception.status === "open" && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setResolveTarget(exception);
                                setResolveStatus("resolved");
                                setResolveReason("");
                              }}
                            >
                              Resolve
                            </Button>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {canResolve && resolveTarget && (
            <div className="border border-border rounded-md p-3 space-y-2">
              <p className="text-xs text-muted-foreground">
                Recording a decision for{" "}
                <span className="font-mono">{resolveTarget.exceptionCode}</span>{" "}
                — your identity and reason are kept on the exception.
              </p>
              <div className="flex flex-wrap items-end gap-3">
                <Select
                  value={resolveStatus}
                  onValueChange={(value) =>
                    setResolveStatus(value === "waived" ? "waived" : "resolved")
                  }
                >
                  <SelectTrigger className="h-8 w-32 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="resolved">Resolved</SelectItem>
                    <SelectItem value="waived">Waived</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  className="h-8 flex-1 min-w-[220px] text-sm"
                  placeholder="Reason (required, kept on record)"
                  value={resolveReason}
                  onChange={(e) => setResolveReason(e.target.value)}
                />
                <Button
                  size="sm"
                  disabled={!resolveReason.trim() || resolveException.isPending}
                  onClick={() =>
                    resolveException.mutate({
                      exception: resolveTarget,
                      status: resolveStatus,
                      reason: resolveReason.trim(),
                    })
                  }
                >
                  {resolveException.isPending ? (
                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                  ) : null}
                  Record decision
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setResolveTarget(null)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          No commercial checks are recorded for this pursuit. An empty list does
          not mean any workbook has been verified.
        </p>
      )}
    </div>
  );
}
