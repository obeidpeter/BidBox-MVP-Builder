import { useId, useMemo, useRef, useState } from "react";
import { CheckCircle2, RotateCcw, Trash2, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CLIENT_ACTION_UPLOAD_MAXIMUM_BYTES,
  GOVERNED_CLIENT_UPLOAD_MIME_TYPES,
  type ClientActionUploadBinding,
  type ClientActionUploadFinalizationReceipt,
} from "./client-action-upload-contract";
import {
  ClientActionUploadFlowError,
  type ClientActionUploadProgress,
  type RunClientActionUploadInput,
} from "./client-action-upload-flow";
import {
  clearClientActionUploadRecovery,
  clientActionUploadRecoveryScope,
  pendingClientActionUploadRecovery,
  readClientActionUploadRecovery,
  writeClientActionUploadRecovery,
  type ClientActionUploadRecoveryMarker,
} from "./client-action-upload-recovery";

export interface ClientActionUploadControlProps {
  binding: ClientActionUploadBinding;
  membershipId: string;
  actorUserId: string;
  disabled?: boolean;
  onUpload(
    input: RunClientActionUploadInput,
    onProgress: (progress: ClientActionUploadProgress) => void,
  ): Promise<ClientActionUploadFinalizationReceipt>;
  onReload(): Promise<unknown> | unknown;
}

function recoveryStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function persistRecovery(
  marker: Parameters<typeof writeClientActionUploadRecovery>[1],
  leaseMayExist = false,
): void {
  const storage = recoveryStorage();
  if (!storage) {
    throw new ClientActionUploadFlowError(
      leaseMayExist
        ? "This browser cannot save the upload recovery record. No file bytes were transferred; reload the current request."
        : "This browser cannot safely save the upload recovery record. No upload slot was requested.",
      leaseMayExist ? "leasing" : "checking",
      "none",
      leaseMayExist,
    );
  }
  try {
    writeClientActionUploadRecovery(storage, marker);
  } catch (cause) {
    throw new ClientActionUploadFlowError(
      leaseMayExist
        ? "The upload recovery record could not be saved safely. No file bytes were transferred; reload the current request."
        : "The upload recovery record could not be saved safely. No upload slot was requested.",
      leaseMayExist ? "leasing" : "checking",
      "none",
      leaseMayExist,
      cause,
    );
  }
}

function clearRecovery(
  scope: Parameters<typeof clearClientActionUploadRecovery>[1],
): void {
  const storage = recoveryStorage();
  if (!storage) return;
  try {
    clearClientActionUploadRecovery(storage, scope);
  } catch {
    // The authoritative server receipt or reload remains valid even if this
    // tab cannot remove a stale recovery hint. Exact snapshot binding prevents
    // the marker from being offered for a changed or completed intent.
  }
}

type ViewState =
  | { state: "idle" | "selected"; message: string }
  | {
      state: "checking" | "leasing" | "transferring" | "finalizing";
      message: string;
      expiresAt: string | null;
    }
  | {
      state: "error";
      error: ClientActionUploadFlowError;
      expiresAt: string | null;
    }
  | {
      state: "completed";
      receipt: ClientActionUploadFinalizationReceipt;
    };

function operationKey(): string {
  return `client-upload:${globalThis.crypto.randomUUID()}`;
}

function asFlowError(error: unknown): ClientActionUploadFlowError {
  if (error instanceof ClientActionUploadFlowError) return error;
  return new ClientActionUploadFlowError(
    "The upload result is unknown. Reload the exact request before taking another action.",
    "finalizing",
    "reload_scope",
    true,
    error,
  );
}

function phaseMessage(progress: ClientActionUploadProgress): string {
  switch (progress.phase) {
    case "checking":
      return "Checking the selected file against the acknowledged upload details.";
    case "leasing":
      return "Requesting short-lived permission to upload this file. No file bytes are sent to the Valo API.";
    case "lease_ready":
      return `Temporary upload slot ${progress.replayed ? "reused" : "issued"}; it expires ${new Date(progress.expiresAt).toLocaleString("en-NG")}.`;
    case "transferring":
      return "Sending the selected file directly to the signed storage URL.";
    case "finalizing":
      return "Finishing the security checks and attaching the file to this request slot.";
    case "completed":
      return "The file passed the security checks and was attached to this request slot.";
  }
}

export function ClientActionUploadControl({
  binding,
  membershipId,
  actorUserId,
  disabled = false,
  onUpload,
  onReload,
}: ClientActionUploadControlProps) {
  const inputId = useId();
  const recoveryScope = useMemo(
    () =>
      clientActionUploadRecoveryScope({
        binding,
        membershipId,
        actorUserId,
      }),
    [actorUserId, binding, membershipId],
  );
  const initialRecovery = useMemo(() => {
    const storage = recoveryStorage();
    if (!storage) return null;
    try {
      return readClientActionUploadRecovery(storage, recoveryScope);
    } catch {
      return null;
    }
  }, [recoveryScope]);
  const [inputGeneration, setInputGeneration] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<ViewState>({
    state: "idle",
    message: initialRecovery
      ? initialRecovery.leaseId
        ? "A pending upload was recovered for this organisation, user, request slot and record version. Select the same file to continue the same upload."
        : "A pending upload request was recovered. Select the same file to continue it."
      : "Select the file named in the current upload details.",
  });
  const retryKey = useRef<string | null>(
    initialRecovery?.idempotencyKey ?? null,
  );
  const recoveryMarker = useRef<ClientActionUploadRecoveryMarker | null>(
    initialRecovery,
  );
  const leaseId = useRef<string | null>(initialRecovery?.leaseId ?? null);
  const leaseExpiry = useRef<string | null>(initialRecovery?.expiresAt ?? null);

  const acceptedTypes = (
    binding.acceptedContentTypes.length > 0
      ? binding.acceptedContentTypes
      : GOVERNED_CLIENT_UPLOAD_MIME_TYPES
  ).filter((contentType) =>
    GOVERNED_CLIENT_UPLOAD_MIME_TYPES.includes(
      contentType as (typeof GOVERNED_CLIENT_UPLOAD_MIME_TYPES)[number],
    ),
  );
  const intentWithinPolicy =
    binding.sizeBytes >= 1 &&
    binding.sizeBytes <= CLIENT_ACTION_UPLOAD_MAXIMUM_BYTES &&
    acceptedTypes.includes(binding.contentType) &&
    /^[0-9a-f]{64}$/u.test(binding.declaredSha256) &&
    /^[^/\\\u0000-\u001f\u007f\ud800-\udfff]{1,255}$/u.test(binding.filename);

  const startUpload = async () => {
    if (!file || busy || disabled) return;
    const key = retryKey.current ?? operationKey();
    retryKey.current = key;
    setBusy(true);
    try {
      const receipt = await onUpload(
        { binding, file, idempotencyKey: key },
        (progress) => {
          if (progress.phase === "leasing" && !recoveryMarker.current) {
            const pending = pendingClientActionUploadRecovery(
              recoveryScope,
              key,
            );
            persistRecovery(pending);
            recoveryMarker.current = pending;
          }
          if (progress.phase === "lease_ready") {
            if (
              recoveryMarker.current?.leaseId &&
              recoveryMarker.current.leaseId !== progress.leaseId
            ) {
              throw new ClientActionUploadFlowError(
                "The recovered upload permission changed. No file bytes were transferred; reload the current request.",
                "leasing",
                "none",
                true,
              );
            }
            leaseId.current = progress.leaseId;
            leaseExpiry.current = progress.expiresAt;
            const enriched: ClientActionUploadRecoveryMarker = {
              schema: "valo.client-action-upload-recovery/v1",
              scope: recoveryScope,
              idempotencyKey: key,
              leaseId: progress.leaseId,
              expiresAt: progress.expiresAt,
              lateRewriteClosure: progress.lateRewriteClosure,
            };
            persistRecovery(enriched, true);
            recoveryMarker.current = enriched;
          }
          if (progress.phase === "completed") {
            setView({ state: "completed", receipt: progress.receipt });
            return;
          }
          if (progress.phase === "lease_ready") {
            setView({
              state: "transferring",
              message: phaseMessage(progress),
              expiresAt: progress.expiresAt,
            });
            return;
          }
          setView({
            state: progress.phase,
            message: phaseMessage(progress),
            expiresAt: leaseExpiry.current,
          });
        },
      );
      clearRecovery(recoveryScope);
      recoveryMarker.current = null;
      retryKey.current = null;
      leaseId.current = null;
      leaseExpiry.current = null;
      setView({ state: "completed", receipt });
    } catch (error) {
      setView({
        state: "error",
        error: asFlowError(error),
        expiresAt: leaseExpiry.current,
      });
    } finally {
      setBusy(false);
    }
  };

  const reload = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onReload();
      clearRecovery(recoveryScope);
      recoveryMarker.current = null;
      retryKey.current = null;
      leaseId.current = null;
      leaseExpiry.current = null;
      setView({
        state: file ? "selected" : "idle",
        message:
          "The request was reloaded. Review the upload details before requesting new upload permission.",
      });
    } catch {
      setView({
        state: "error",
        error: new ClientActionUploadFlowError(
          "The current request could not be reloaded. Do not request another upload slot.",
          "checking",
          "none",
          false,
        ),
        expiresAt: leaseExpiry.current,
      });
    } finally {
      setBusy(false);
    }
  };

  const discardLocalSelection = () => {
    const leaseMayExist =
      leaseId.current !== null ||
      recoveryMarker.current !== null ||
      (view.state === "error" && view.error.serverLeaseMayExist);
    setFile(null);
    if (!leaseMayExist) {
      clearRecovery(recoveryScope);
      recoveryMarker.current = null;
      retryKey.current = null;
      leaseId.current = null;
      leaseExpiry.current = null;
    }
    setInputGeneration((value) => value + 1);
    setView({
      state: "idle",
      message: leaseMayExist
        ? "The local selection was discarded. This does not cancel the upload slot or prove that a temporary upload was deleted. Server cleanup still applies."
        : "The local selection was discarded before an upload slot was confirmed.",
    });
  };

  const statusMessage = !intentWithinPolicy
    ? "These upload details do not meet the allowed size, filename, fingerprint or file-type rules. Record valid details before selecting a file."
    : view.state === "error"
      ? view.error.message
      : view.state === "completed"
        ? "The file passed the security checks and was attached to this request slot."
        : view.message;
  const visibleLeaseExpiry =
    ("expiresAt" in view ? view.expiresAt : null) ??
    recoveryMarker.current?.expiresAt ??
    null;

  return (
    <section
      className="space-y-3 rounded-md border border-primary/30 bg-primary/5 p-4"
      aria-labelledby={`${inputId}-heading`}
      aria-busy={busy}
    >
      <div>
        <h5 id={`${inputId}-heading`} className="font-medium">
          Upload the acknowledged file
        </h5>
        <p className="mt-1 text-xs text-muted-foreground">
          Maximum {CLIENT_ACTION_UPLOAD_MAXIMUM_BYTES / 1024 / 1024} MB.
          Accepted MIME for this slot: {acceptedTypes.join(", ")}. Bytes go
          directly to the short-lived signed storage URL; the Valo API receives
          metadata and finalization only.
        </p>
        <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
          Upload details: {binding.filename} /{" "}
          {binding.sizeBytes.toLocaleString("en-NG")} bytes /{" "}
          {binding.contentType} / SHA-256 {binding.declaredSha256}
        </p>
      </div>

      {view.state !== "completed" ? (
        <div className="space-y-2">
          <Label htmlFor={inputId}>File for {binding.filename}</Label>
          <Input
            key={inputGeneration}
            id={inputId}
            type="file"
            accept={acceptedTypes.join(",")}
            disabled={busy || disabled || !intentWithinPolicy}
            onChange={(event) => {
              const selected = event.currentTarget.files?.[0] ?? null;
              setFile(selected);
              if (!recoveryMarker.current) {
                retryKey.current = null;
                leaseId.current = null;
                leaseExpiry.current = null;
              }
              setView({
                state: selected ? "selected" : "idle",
                message: selected
                  ? recoveryMarker.current?.leaseId
                    ? `${selected.name} selected to continue the recovered upload.`
                    : recoveryMarker.current
                      ? `${selected.name} selected to continue the pending upload request.`
                      : `${selected.name} selected. No upload slot has been requested yet.`
                  : "Select the file named in the current upload details.",
              });
            }}
          />
        </div>
      ) : null}

      <div
        className={
          view.state === "error" || !intentWithinPolicy
            ? "text-sm text-destructive"
            : "text-sm"
        }
        role={
          view.state === "error" || !intentWithinPolicy ? "alert" : "status"
        }
        aria-live={
          view.state === "error" || !intentWithinPolicy ? "assertive" : "polite"
        }
        aria-atomic="true"
      >
        <p>{statusMessage}</p>
        {visibleLeaseExpiry ? (
          <p className="mt-1 text-xs">
            Upload slot expires{" "}
            {new Date(visibleLeaseExpiry).toLocaleString("en-NG")}; the signed
            write window closes earlier to leave a safety margin.
          </p>
        ) : null}
        {view.state === "error" &&
        (view.error.serverLeaseMayExist || recoveryMarker.current) ? (
          <p className="mt-1 text-xs">
            A temporary upload may exist. The server, not this browser, confirms
            cleanup.
          </p>
        ) : null}
        {view.state === "completed" ? (
          <p className="mt-1 break-all font-mono text-xs">
            Receipt SHA-256 {view.receipt.receiptSha256}
          </p>
        ) : null}
      </div>

      {view.state !== "completed" ? (
        <div className="flex flex-wrap gap-2">
          {view.state === "error" && view.error.retry === "same_operation" ? (
            <Button
              type="button"
              disabled={!file || busy || disabled || !intentWithinPolicy}
              onClick={() => void startUpload()}
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              Retry same upload
            </Button>
          ) : view.state === "error" &&
            ["new_lease", "reload_scope"].includes(view.error.retry) ? (
            <Button
              type="button"
              variant="outline"
              disabled={busy || disabled}
              onClick={() => void reload()}
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              Reload current request
            </Button>
          ) : view.state === "error" && view.error.retry === "none" ? (
            <Button
              type="button"
              variant="outline"
              disabled={busy || disabled}
              onClick={() => void reload()}
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              Reload current status
            </Button>
          ) : (
            <Button
              type="button"
              disabled={!file || busy || disabled || !intentWithinPolicy}
              onClick={() => void startUpload()}
            >
              <UploadCloud className="mr-2 h-4 w-4" />
              Check and upload
            </Button>
          )}
          {file ? (
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={discardLocalSelection}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Discard local selection
            </Button>
          ) : null}
        </div>
      ) : (
        <p className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          Document attached
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Your upload slot lasts up to 15 minutes. Closing this page, discarding
        your selection or seeing an error does not confirm that the temporary
        upload was deleted. Valo stops accepting data before time runs out, then
        checks for late uploads and records cleanup.
      </p>
    </section>
  );
}
