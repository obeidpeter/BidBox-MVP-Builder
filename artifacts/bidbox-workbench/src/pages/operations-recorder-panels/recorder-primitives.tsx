import type { FormEvent, ReactNode } from "react";
import { StatusPanel } from "@/components/platform-states";
import { Button } from "@/components/ui/button";
import type {
  CanonicalDocumentOption,
  EvidenceRecordOption,
  OperationsRecorderCommand,
  PackageVersionOption,
  VaultItemOption,
  VersionedRecordOption,
} from "../pursuit-operations-suite-recorder";

const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
export const CONTROL =
  "min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export type RecorderSend = (
  factory: (data: FormData) => OperationsRecorderCommand,
) => (event: FormEvent<HTMLFormElement>) => void;

export function value(data: FormData, name: string): string {
  return String(data.get(name) ?? "").trim();
}

export function selectedCurrentUser(
  data: FormData,
  name: string,
  currentUserId: string | undefined,
  label: string,
): string | undefined {
  const selectedUserId = value(data, name);
  if (!selectedUserId) return undefined;
  if (!currentUserId || selectedUserId !== currentUserId) {
    throw new Error(`${label} is not the current authenticated user.`);
  }
  return selectedUserId;
}

export function requiredText(
  data: FormData,
  name: string,
  label: string,
  maximum = 4_096,
): string {
  const parsed = value(data, name);
  if (!parsed || parsed.length > maximum) {
    throw new Error(
      `${label} is required and must be within ${maximum} characters.`,
    );
  }
  return parsed;
}

export function optionalText(
  data: FormData,
  name: string,
  label: string,
  maximum = 4_096,
): string | undefined {
  const parsed = value(data, name);
  if (!parsed) return undefined;
  if (parsed.length > maximum) {
    throw new Error(`${label} must be within ${maximum} characters.`);
  }
  return parsed;
}

export function requiredId(
  data: FormData,
  name: string,
  label: string,
): string {
  const parsed = requiredText(data, name, label, 128);
  if (!ID_PATTERN.test(parsed))
    throw new Error(`${label} is not a valid record ID.`);
  return parsed;
}

export function optionalId(
  data: FormData,
  name: string,
  label: string,
): string | undefined {
  const parsed = optionalText(data, name, label, 128);
  if (parsed && !ID_PATTERN.test(parsed)) {
    throw new Error(`${label} is not a valid record ID.`);
  }
  return parsed;
}

export function requiredSha(
  data: FormData,
  name: string,
  label: string,
): string {
  const parsed = requiredText(data, name, label, 64).toLowerCase();
  if (!SHA256_PATTERN.test(parsed)) {
    throw new Error(`${label} must be a complete lowercase SHA-256.`);
  }
  return parsed;
}

export function optionalSha(
  data: FormData,
  name: string,
  label: string,
): string | undefined {
  const parsed = optionalText(data, name, label, 64)?.toLowerCase();
  if (parsed && !SHA256_PATTERN.test(parsed)) {
    throw new Error(`${label} must be a complete lowercase SHA-256.`);
  }
  return parsed;
}

export function requiredIso(
  data: FormData,
  name: string,
  label: string,
): string {
  const parsed = requiredText(data, name, label, 64);
  if (Number.isNaN(Date.parse(parsed)))
    throw new Error(`${label} must be an ISO date-time.`);
  return parsed;
}

export function optionalIso(
  data: FormData,
  name: string,
  label: string,
): string | undefined {
  const parsed = optionalText(data, name, label, 64);
  if (parsed && Number.isNaN(Date.parse(parsed))) {
    throw new Error(`${label} must be an ISO date-time.`);
  }
  return parsed;
}

export function list(
  data: FormData,
  name: string,
  label: string,
  maximum: number,
): string[] {
  const items = value(data, name)
    .split(/[\n,]/u)
    .map((item) => item.trim())
    .filter(Boolean);
  if (items.length > maximum || new Set(items).size !== items.length) {
    throw new Error(`${label} must contain at most ${maximum} unique values.`);
  }
  return items;
}

export function idList(
  data: FormData,
  name: string,
  label: string,
  maximum: number,
): string[] {
  const items = list(data, name, label, maximum);
  if (items.some((item) => !ID_PATTERN.test(item))) {
    throw new Error(`${label} contains an invalid record ID.`);
  }
  return items;
}

export function integer(
  data: FormData,
  name: string,
  label: string,
  minimum: number,
  maximum: number,
): number {
  const raw = requiredText(data, name, label, 32);
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(
      `${label} must be a whole number from ${minimum} to ${maximum}.`,
    );
  }
  return parsed;
}

export function optionalInteger(
  data: FormData,
  name: string,
  label: string,
  minimum: number,
  maximum: number,
): number | undefined {
  if (!value(data, name)) return undefined;
  return integer(data, name, label, minimum, maximum);
}

export function jsonArray(
  data: FormData,
  name: string,
  label: string,
  maximum: number,
  required = false,
): unknown[] | undefined {
  const raw = value(data, name);
  if (!raw && !required) return undefined;
  if (!raw) throw new Error(`${label} is required.`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${label} must be valid JSON.`);
  }
  if (!Array.isArray(parsed) || parsed.length > maximum) {
    throw new Error(
      `${label} must be a JSON array with at most ${maximum} entries.`,
    );
  }
  return parsed;
}

export function selected<T extends VersionedRecordOption>(
  records: readonly T[],
  data: FormData,
  name: string,
  label: string,
): T {
  const id = requiredId(data, name, label);
  const record = records.find((candidate) => candidate.id === id);
  if (!record)
    throw new Error(`${label} is no longer in the current snapshot.`);
  return record;
}

export function shortId(id: string): string {
  return id.length <= 20 ? id : `${id.slice(0, 10)}…${id.slice(-7)}`;
}

export function evidenceSlotToken(requestId: string, slotId: string): string {
  return `${requestId}/${slotId}`;
}

export function selectedEvidenceSlot(
  records: readonly EvidenceRecordOption[],
  data: FormData,
  name: string,
  mode: "response" | "decision",
): {
  record: EvidenceRecordOption;
  slot: EvidenceRecordOption["slots"][number];
} {
  const token = requiredText(data, name, "Evidence request slot", 257);
  for (const record of records) {
    for (const slot of record.slots) {
      if (
        evidenceSlotToken(record.id, slot.id) === token &&
        (mode === "response"
          ? !slot.hasResponse || slot.acceptanceDecision === "rejected"
          : slot.hasResponse && slot.acceptanceDecision === null)
      ) {
        return { record, slot };
      }
    }
  }
  throw new Error(
    mode === "decision"
      ? "The selected slot has no undecided current response."
      : "The selected slot cannot currently accept a response or replacement.",
  );
}

export function selectedPackageVersion(
  records: readonly PackageVersionOption[],
  data: FormData,
  name: string,
): PackageVersionOption {
  const packageVersionId = requiredId(data, name, "Approved package version");
  const record = records.find(
    (candidate) => candidate.packageVersionId === packageVersionId,
  );
  if (!record) {
    throw new Error(
      "The selected package version is no longer in the current approved list.",
    );
  }
  return record;
}

export function selectedDocument(
  records: readonly CanonicalDocumentOption[],
  data: FormData,
  name: string,
  required: boolean,
): CanonicalDocumentOption | undefined {
  const documentId = value(data, name);
  if (!documentId && !required) return undefined;
  if (!ID_PATTERN.test(documentId)) {
    throw new Error("The selected approved document ID is invalid.");
  }
  const record = records.find((candidate) => candidate.id === documentId);
  if (!record) {
    throw new Error(
      "The selected document is no longer in the current project document list.",
    );
  }
  return record;
}

export function selectedVaultItem(
  records: readonly VaultItemOption[],
  data: FormData,
  name: string,
): VaultItemOption {
  const vaultItemId = requiredId(data, name, "Active Vault item");
  const record = records.find((candidate) => candidate.id === vaultItemId);
  if (!record) {
    throw new Error(
      "The selected Vault item is no longer in the active client Vault list.",
    );
  }
  return record;
}

export function withOptional<T extends Record<string, unknown>>(
  body: T,
  values: Record<string, unknown>,
): T & Record<string, unknown> {
  return {
    ...body,
    ...Object.fromEntries(
      Object.entries(values).filter(([, entry]) => entry !== undefined),
    ),
  };
}

export function Field({
  label,
  name,
  children,
  hint,
}: {
  label: string;
  name: string;
  children?: ReactNode;
  hint?: string;
}) {
  return (
    <label className="grid gap-1.5 text-xs font-medium" htmlFor={name}>
      {label}
      {children ?? (
        <input
          id={name}
          name={name}
          className={CONTROL}
          data-control-size="44"
        />
      )}
      {hint ? (
        <span className="font-normal text-muted-foreground">{hint}</span>
      ) : null}
    </label>
  );
}

export function TextArea({
  id,
  name = id,
  required = false,
  maxLength = 4_096,
  placeholder,
}: {
  id: string;
  name?: string;
  required?: boolean;
  maxLength?: number;
  placeholder?: string;
}) {
  return (
    <textarea
      id={id}
      name={name}
      required={required}
      maxLength={maxLength}
      placeholder={placeholder}
      className={`${CONTROL} min-h-24`}
      data-control-size="44"
    />
  );
}

export function RecordSelect({
  id,
  name = id,
  records,
  required = true,
  selectedValue,
  onValueChange,
}: {
  id: string;
  name?: string;
  records: readonly VersionedRecordOption[];
  required?: boolean;
  selectedValue?: string;
  onValueChange?: (value: string) => void;
}) {
  return (
    <select
      id={id}
      name={name}
      required={required}
      value={selectedValue}
      onChange={(event) => onValueChange?.(event.currentTarget.value)}
      className={CONTROL}
      data-control-size="44"
    >
      <option value="">
        {required ? "Choose a current record" : "No linked record"}
      </option>
      {records.map((record) => (
        <option key={record.id} value={record.id}>
          {record.label} · {shortId(record.id)} · {record.status} · v
          {record.version}
        </option>
      ))}
    </select>
  );
}

export function EvidenceSlotSelect({
  id,
  records,
  mode,
}: {
  id: string;
  records: readonly EvidenceRecordOption[];
  mode: "response" | "decision";
}) {
  const slots = records.flatMap((record) =>
    record.slots
      .filter((slot) =>
        mode === "response"
          ? !slot.hasResponse || slot.acceptanceDecision === "rejected"
          : slot.hasResponse && slot.acceptanceDecision === null,
      )
      .map((slot) => ({ record, slot })),
  );
  return (
    <select
      id={id}
      name={id}
      required
      className={CONTROL}
      data-control-size="44"
    >
      <option value="">Choose a current request slot</option>
      {slots.map(({ record, slot }) => (
        <option
          key={evidenceSlotToken(record.id, slot.id)}
          value={evidenceSlotToken(record.id, slot.id)}
        >
          {record.label} · {slot.label} · {shortId(slot.id)} ·{" "}
          {slot.acceptanceDecision === "rejected"
            ? "changes requested; replacement allowed"
            : slot.hasResponse
              ? "response awaiting decision"
              : "awaiting response"}
          {slot.priorResponseCount > 0
            ? ` · ${slot.priorResponseCount} prior rejected attempt${slot.priorResponseCount === 1 ? "" : "s"}`
            : ""}
        </option>
      ))}
    </select>
  );
}

export function CurrentUserAssignmentSelect({
  id,
  currentUserId,
  emptyLabel,
}: {
  id: string;
  currentUserId?: string;
  emptyLabel: string;
}) {
  return (
    <select
      id={id}
      name={id}
      className={CONTROL}
      data-control-size="44"
      defaultValue=""
    >
      <option value="">{emptyLabel}</option>
      {currentUserId ? (
        <option value={currentUserId}>Assign to me</option>
      ) : null}
    </select>
  );
}

export function PackageVersionSelect({
  id,
  records,
}: {
  id: string;
  records: readonly PackageVersionOption[];
}) {
  return (
    <select
      id={id}
      name={id}
      required
      className={CONTROL}
      data-control-size="44"
    >
      <option value="">Choose an approved pursuit export version</option>
      {records.map((record) => (
        <option key={record.packageVersionId} value={record.packageVersionId}>
          {shortId(record.packageId)} · v{record.versionNumber} · QA{" "}
          {record.renderQaStatus} · manifest{" "}
          {record.manifestSha256.slice(0, 12)}…
        </option>
      ))}
    </select>
  );
}

export function DocumentSelect({
  id,
  records,
  required = false,
}: {
  id: string;
  records: readonly CanonicalDocumentOption[];
  required?: boolean;
}) {
  return (
    <select
      id={id}
      name={id}
      required={required}
      className={CONTROL}
      data-control-size="44"
    >
      <option value="">
        {required
          ? "Choose an approved pursuit document"
          : "No document selected"}
      </option>
      {records.map((record) => (
        <option key={record.id} value={record.id}>
          {record.filename} · {record.id} · {record.contentType} ·{" "}
          {record.status}
          {" · SHA-256 "}
          {record.sha256}
        </option>
      ))}
    </select>
  );
}

export function VaultItemSelect({
  id,
  records,
}: {
  id: string;
  records: readonly VaultItemOption[];
}) {
  return (
    <select
      id={id}
      name={id}
      required
      className={CONTROL}
      data-control-size="44"
    >
      <option value="">Choose an active client Vault item</option>
      {records.map((record) => (
        <option key={record.id} value={record.id}>
          {record.label} · {record.id} · v{record.version} · {record.status}
          {" · source SHA-256 "}
          {record.documentSha256}
        </option>
      ))}
    </select>
  );
}

export function Panel({
  title,
  description,
  allowed,
  unavailableReason,
  disabled,
  children,
}: {
  title: string;
  description: string;
  allowed: boolean;
  unavailableReason: string;
  disabled: boolean;
  children: ReactNode;
}) {
  return (
    <details className="rounded-lg border border-border bg-card">
      <summary className="min-h-11 cursor-pointer px-4 py-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {title}
      </summary>
      <div className="space-y-4 border-t border-border p-4">
        <p className="text-sm leading-6 text-muted-foreground">{description}</p>
        {!allowed ? (
          <StatusPanel
            state="unavailable"
            title="Edit permission required"
            description={unavailableReason}
          />
        ) : null}
        <fieldset
          disabled={disabled || !allowed}
          className="space-y-6 disabled:opacity-65"
        >
          {children}
        </fieldset>
      </div>
    </details>
  );
}

export function Submit({
  children,
  disabled = false,
}: {
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <Button
      type="submit"
      className="min-h-11"
      data-control-size="44"
      disabled={disabled}
    >
      {children}
    </Button>
  );
}

export function PermissionBoundary({
  allowed,
  label,
  children,
}: {
  allowed: boolean;
  label: string;
  children: ReactNode;
}) {
  return (
    <fieldset disabled={!allowed} className="space-y-6 disabled:opacity-65">
      <legend className="sr-only">{label}</legend>
      {!allowed ? (
        <p className="text-xs leading-5 text-muted-foreground">
          {label} controls are disabled for this organisation context.
        </p>
      ) : null}
      {children}
    </fieldset>
  );
}
