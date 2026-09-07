import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CanonicalEvidencePicker } from "@/components/canonical-evidence-picker";
import type {
  CanonicalEvidenceBinding,
  CanonicalEvidenceOption,
} from "@/lib/canonical-evidence-options";
import {
  CLAIMS_DESK_ASSESSMENT_CODES,
  CLAIMS_DESK_REASON_CODES,
  CLAIMS_DESK_RECORD_TYPES,
  type ClaimsDeskAction,
  type ClaimsDeskCreateDraft,
  type ClaimsDeskRecord,
  type ClaimsDeskRecordType,
  type ClaimsDeskTransitionDraft,
} from "./claims-desk-contract";
import { humaniseTokenCapitalised as label } from "@/lib/format";

const key = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

const actionsFor = (status: string): readonly ClaimsDeskAction[] => {
  switch (status) {
    case "registered":
      return ["start_review", "withdraw"];
    case "under_review":
      return ["propose_assessment", "withdraw"];
    case "assessment_proposed":
      return ["approve_assessment", "return_assessment"];
    case "assessed":
      return ["propose_closure", "withdraw"];
    case "closure_proposed":
      return ["approve_closure", "return_closure"];
    default:
      return [];
  }
};

export function ClaimsDeskCreatePanel({
  pending,
  evidenceOptions = [],
  evidenceOptionsTruncated = false,
  onCreate,
}: {
  pending: boolean;
  evidenceOptions?: readonly CanonicalEvidenceOption[];
  evidenceOptionsTruncated?: boolean;
  onCreate: (draft: ClaimsDeskCreateDraft) => Promise<void>;
}) {
  const [recordType, setRecordType] =
    useState<ClaimsDeskRecordType>("contract_event");
  const [reference, setReference] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [amountMinor, setAmountMinor] = useState("");
  const [currency, setCurrency] = useState("NGN");
  const [bindings, setBindings] = useState<CanonicalEvidenceBinding[]>([]);
  const [error, setError] = useState<string | null>(null);
  const amountAllowed = ["variation", "claim", "payment_certificate"].includes(
    recordType,
  );
  const dueRequired = ["notice_deadline", "obligation"].includes(recordType);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      const amount = amountMinor === "" ? null : Number(amountMinor);
      if (amount !== null && (!Number.isSafeInteger(amount) || amount < 0))
        throw new Error("Amount must be a non-negative integer in minor units");
      await onCreate({
        recordType,
        reference,
        eventDate,
        dueAt: dueAt ? new Date(dueAt).toISOString() : null,
        amountMinor: amount,
        currency: amount === null ? null : currency,
        documentBindings: bindings,
        idempotencyKey: key("claims-create"),
      });
      setReference("");
      setEventDate("");
      setDueAt("");
      setAmountMinor("");
      setBindings([]);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Record could not be prepared",
      );
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>
          Record workflow evidence
        </CardTitle>
        <CardDescription>
          The reference and amount are records only. They do not establish legal
          entitlement, certified value or price.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={submit}>
          <div className="space-y-2">
            <Label htmlFor="claims-type">Record type</Label>
            <Select
              value={recordType}
              onValueChange={(value) => {
                setRecordType(value as ClaimsDeskRecordType);
                setAmountMinor("");
              }}
            >
              <SelectTrigger id="claims-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CLAIMS_DESK_RECORD_TYPES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {label(value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="claims-reference">Reference</Label>
            <Input
              id="claims-reference"
              required
              maxLength={80}
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              placeholder="CLM-001"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="claims-event-date">Event date</Label>
            <Input
              id="claims-event-date"
              type="date"
              required
              value={eventDate}
              onChange={(event) => setEventDate(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="claims-due-at">
              Due date and time{dueRequired ? " (required)" : ""}
            </Label>
            <Input
              id="claims-due-at"
              type="datetime-local"
              required={dueRequired}
              value={dueAt}
              onChange={(event) => setDueAt(event.target.value)}
            />
          </div>
          {amountAllowed ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="claims-amount">
                  Amount (minor units, whole number)
                </Label>
                <Input
                  id="claims-amount"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={amountMinor}
                  onChange={(event) => setAmountMinor(event.target.value)}
                  placeholder="125000"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="claims-currency">Currency code (ISO)</Label>
                <Input
                  id="claims-currency"
                  minLength={3}
                  maxLength={3}
                  value={currency}
                  onChange={(event) =>
                    setCurrency(event.target.value.toUpperCase())
                  }
                />
              </div>
            </>
          ) : null}
          <div className="sm:col-span-2">
            <CanonicalEvidencePicker
              id="claims-bindings"
              label="Approved document evidence"
              options={evidenceOptions}
              value={bindings}
              onChange={setBindings}
              multiple
              maxSelections={10}
              disabled={pending}
              truncated={evidenceOptionsTruncated}
            />
            <p
              id="claims-bindings-help"
              className="text-xs text-muted-foreground"
            >
              Choose 1–10 current approved documents. When you submit, the
              server checks each version and security status again.
            </p>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive sm:col-span-2">
              {error}
            </p>
          ) : null}
          <div className="sm:col-span-2">
            <Button
              type="submit"
              disabled={
                pending || evidenceOptions.length === 0 || bindings.length === 0
              }
            >
              {pending ? "Recording…" : "Record evidence"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export function ClaimsDeskTransitionPanel({
  records,
  pending,
  evidenceOptions = [],
  evidenceOptionsTruncated = false,
  onTransition,
}: {
  records: readonly ClaimsDeskRecord[];
  pending: boolean;
  evidenceOptions?: readonly CanonicalEvidenceOption[];
  evidenceOptionsTruncated?: boolean;
  onTransition: (
    record: ClaimsDeskRecord,
    draft: ClaimsDeskTransitionDraft,
  ) => Promise<void>;
}) {
  const eligible = records.filter(
    (record) => actionsFor(record.status).length > 0,
  );
  const [recordId, setRecordId] = useState(eligible[0]?.id ?? "");
  const selected =
    eligible.find((record) => record.id === recordId) ?? eligible[0];
  const actions = selected ? actionsFor(selected.status) : [];
  const [action, setAction] = useState<ClaimsDeskAction>(
    actions[0] ?? "start_review",
  );
  const [reasonCode, setReasonCode] =
    useState<(typeof CLAIMS_DESK_REASON_CODES)[number]>("evidence_received");
  const [assessmentCode, setAssessmentCode] = useState<
    (typeof CLAIMS_DESK_ASSESSMENT_CODES)[number]
  >("requires_further_review");
  const [bindings, setBindings] = useState<CanonicalEvidenceBinding[]>(
    selected ? [...selected.documentBindings] : [],
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (selected) {
      setAction(actionsFor(selected.status)[0] ?? "start_review");
      setBindings([...selected.documentBindings]);
    }
  }, [selected?.id, selected?.version]);
  const makerChecker = useMemo(
    () =>
      [
        "approve_assessment",
        "return_assessment",
        "approve_closure",
        "return_closure",
      ].includes(action),
    [action],
  );
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    setError(null);
    try {
      await onTransition(selected, {
        action,
        reasonCode,
        assessmentCode: action === "propose_assessment" ? assessmentCode : null,
        documentBindings: bindings,
        idempotencyKey: key("claims-transition"),
      });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Transition could not be prepared",
      );
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>
          Change status
        </CardTitle>
        <CardDescription>
          A version check prevents stale updates. A different named person must
          approve an assessment or closure.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!selected ? (
          <p className="text-sm text-muted-foreground">
            No record currently has an available transition.
          </p>
        ) : (
          <form className="grid gap-4 sm:grid-cols-2" onSubmit={submit}>
            <div className="space-y-2">
              <Label htmlFor="claims-record">Record</Label>
              <Select value={selected.id} onValueChange={setRecordId}>
                <SelectTrigger id="claims-record">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {eligible.map((record) => (
                    <SelectItem key={record.id} value={record.id}>
                      {record.reference} · v{record.version}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="claims-action">Action</Label>
              <select
                id="claims-action"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={action}
                onChange={(event) =>
                  setAction(event.currentTarget.value as ClaimsDeskAction)
                }
              >
                {actions.map((value) => (
                  <option key={value} value={value}>
                    {label(value)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="claims-reason">Reason</Label>
              <Select
                value={reasonCode}
                onValueChange={(value) =>
                  setReasonCode(value as typeof reasonCode)
                }
              >
                <SelectTrigger id="claims-reason">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CLAIMS_DESK_REASON_CODES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {label(value)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {action === "propose_assessment" ? (
              <div className="space-y-2">
                <Label htmlFor="claims-assessment">Assessment</Label>
                <Select
                  value={assessmentCode}
                  onValueChange={(value) =>
                    setAssessmentCode(value as typeof assessmentCode)
                  }
                >
                  <SelectTrigger id="claims-assessment">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CLAIMS_DESK_ASSESSMENT_CODES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {label(value)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="flex items-end">
                <Badge variant={makerChecker ? "default" : "outline"}>
                  {makerChecker
                    ? "A different reviewer must approve this"
                    : `Current state: ${label(selected.status)}`}
                </Badge>
              </div>
            )}
            <div className="sm:col-span-2">
              <CanonicalEvidencePicker
                id="claims-transition-bindings"
                label="Rechecked document evidence"
                options={evidenceOptions}
                value={bindings}
                onChange={setBindings}
                multiple
                maxSelections={10}
                disabled={pending}
                truncated={evidenceOptionsTruncated}
              />
            </div>
            {error ? (
              <p
                role="alert"
                className="text-sm text-destructive sm:col-span-2"
              >
                {error}
              </p>
            ) : null}
            <div className="sm:col-span-2">
              <Button type="submit" disabled={pending || bindings.length === 0}>
                {pending ? "Recording…" : `Record ${label(action)}`}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
