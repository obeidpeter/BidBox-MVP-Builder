import type {
  OperationsRecorderPermissions,
  OperationsRecorderRecords,
} from "../pursuit-operations-suite-recorder";
import {
  CONTROL,
  Field,
  PackageVersionSelect,
  Panel,
  RecordSelect,
  Submit,
  integer,
  list,
  optionalSha,
  optionalText,
  requiredText,
  selected,
  selectedPackageVersion,
  withOptional,
  type RecorderSend,
} from "./recorder-primitives";

export function SubmissionWarRoomPanel({
  permissions,
  records,
  packageVersionsState,
  disabled,
  send,
}: {
  permissions: OperationsRecorderPermissions;
  records: OperationsRecorderRecords;
  packageVersionsState: "loading" | "ready" | "error";
  disabled: boolean;
  send: RecorderSend;
}) {
  return (
    <Panel
      title="4. Submission tracking"
      description="Start tracking an existing package version, then record each completed stage in order. The operator must enter the delivery method, receipt fingerprint and any cancellation reason."
      allowed={permissions.packageExport}
      unavailableReason="Package export permission is required."
      disabled={disabled || packageVersionsState !== "ready"}
    >
      <form
        className="grid gap-3"
        onSubmit={send((data) => {
          const packageVersion = selectedPackageVersion(
            records.packageVersions,
            data,
            "submissionPackageVersion",
          );
          return {
            path: "/operations-suite/submission-war-rooms",
            method: "POST",
            successTitle: "Submission custody room recorded",
            body: {
              packageId: packageVersion.packageId,
              packageVersionId: packageVersion.packageVersionId,
              manifestSha256: packageVersion.manifestSha256,
              copyCount: integer(
                data,
                "submissionCopyCount",
                "Copy count",
                0,
                10_000,
              ),
              sealIdentifiers: list(
                data,
                "submissionSeals",
                "Seal identifiers",
                100,
              ),
            },
          };
        })}
      >
        <h3 className="text-sm font-semibold">Create custody room</h3>
        <Field label="Approved package version" name="submissionPackageVersion">
          <PackageVersionSelect
            id="submissionPackageVersion"
            records={records.packageVersions}
          />
        </Field>
        <Field label="Physical copy count" name="submissionCopyCount">
          <input
            id="submissionCopyCount"
            name="submissionCopyCount"
            type="number"
            min="0"
            max="10000"
            defaultValue="0"
            className={CONTROL}
            data-control-size="44"
          />
        </Field>
        <Field
          label="Seal identifiers (comma/newline)"
          name="submissionSeals"
        />
        <Submit disabled={!permissions.packageExport}>
          Create submission custody room
        </Submit>
      </form>
      <form
        className="grid gap-3 border-t border-border pt-4"
        onSubmit={send((data) => {
          const record = selected(
            records.submissions,
            data,
            "advanceSubmissionId",
            "Submission room",
          );
          const toStatus = requiredText(
            data,
            "submissionNextStatus",
            "Next status",
            32,
          );
          const expectedNext: Record<string, string | undefined> = {
            planning: "frozen",
            frozen: "copies_prepared",
            copies_prepared: "sealed",
            sealed: "dispatched",
            dispatched: "receipt_recorded",
          };
          if (
            toStatus !== "cancelled" &&
            expectedNext[record.status] !== toStatus
          ) {
            throw new Error(
              "War-room stages must be recorded exactly once in order.",
            );
          }
          const dispatchMethod = optionalText(
            data,
            "submissionDispatchMethod",
            "Dispatch method",
            256,
          );
          const receiptSha256 = optionalSha(
            data,
            "submissionReceiptHash",
            "Receipt hash",
          );
          const reason = optionalText(
            data,
            "submissionReason",
            "Reason",
            1_024,
          );
          if (toStatus === "dispatched" && !dispatchMethod) {
            throw new Error(
              "Recording human dispatch requires the dispatch method.",
            );
          }
          if (toStatus === "receipt_recorded" && !receiptSha256) {
            throw new Error("Receipt recording requires its SHA-256.");
          }
          if (toStatus === "cancelled" && !reason) {
            throw new Error("Cancellation requires a reason.");
          }
          return {
            path: `/operations-suite/submission-war-rooms/${encodeURIComponent(record.id)}/advance`,
            method: "POST",
            successTitle: "Submission custody stage recorded",
            body: withOptional(
              { expectedVersion: record.version, toStatus },
              { dispatchMethod, receiptSha256, reason },
            ),
          };
        })}
      >
        <h3 className="text-sm font-semibold">Advance recorded custody</h3>
        <Field label="Current custody room" name="advanceSubmissionId">
          <RecordSelect
            id="advanceSubmissionId"
            records={records.submissions}
          />
        </Field>
        <Field label="Human-completed next stage" name="submissionNextStatus">
          <select
            id="submissionNextStatus"
            name="submissionNextStatus"
            className={CONTROL}
            data-control-size="44"
          >
            <option value="frozen">Freeze recorded hash</option>
            <option value="copies_prepared">Copies prepared</option>
            <option value="sealed">Sealed</option>
            <option value="dispatched">Human dispatch completed</option>
            <option value="receipt_recorded">Receipt obtained</option>
            <option value="cancelled">Cancel with reason</option>
          </select>
        </Field>
        <Field
          label="Dispatch method (dispatch only)"
          name="submissionDispatchMethod"
        />
        <Field
          label="Receipt SHA-256 (receipt only)"
          name="submissionReceiptHash"
        />
        <Field label="Reason (cancellation only)" name="submissionReason" />
        <Submit disabled={!permissions.packageExport}>
          Record custody stage
        </Submit>
      </form>
    </Panel>
  );
}
