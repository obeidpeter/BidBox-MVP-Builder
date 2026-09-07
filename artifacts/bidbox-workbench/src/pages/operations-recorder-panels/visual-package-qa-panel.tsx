import type {
  OperationsRecorderPermissions,
  OperationsRecorderRecords,
} from "../pursuit-operations-suite-recorder";
import {
  Field,
  PackageVersionSelect,
  Panel,
  Submit,
  TextArea,
  jsonArray,
  selectedPackageVersion,
  withOptional,
  type RecorderSend,
} from "./recorder-primitives";

export function VisualPackageQaPanel({
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
      title="5. Visual package checks"
      description="Record layout results supplied by the operator. Valo checks only the values entered; it does not invent pages, signatures or cross-reference results."
      allowed={permissions.packageGenerate}
      unavailableReason="Package generation permission is required."
      disabled={disabled || packageVersionsState !== "ready"}
    >
      <form
        className="grid gap-3"
        onSubmit={send((data) => {
          const packageVersion = selectedPackageVersion(
            records.packageVersions,
            data,
            "qaPackageVersion",
          );
          return {
            path: "/operations-suite/visual-qa-reports",
            method: "POST",
            successTitle: "Visual QA metrics evaluated and recorded",
            body: withOptional(
              {
                packageVersionId: packageVersion.packageVersionId,
                manifestSha256: packageVersion.manifestSha256,
                expectedManifestSha256: packageVersion.manifestSha256,
                pages:
                  jsonArray(data, "qaPages", "Page metrics", 2_000, true) ?? [],
              },
              {
                crossReferences: jsonArray(
                  data,
                  "qaCrossReferences",
                  "Cross-reference checks",
                  5_000,
                ),
                signatures: jsonArray(
                  data,
                  "qaSignatures",
                  "Signature checks",
                  250,
                ),
              },
            ),
          };
        })}
      >
        <Field label="Approved package version" name="qaPackageVersion">
          <PackageVersionSelect
            id="qaPackageVersion"
            records={records.packageVersions}
          />
        </Field>
        <Field
          label="Page metrics JSON"
          name="qaPages"
          hint='Array entries: {"pageNumber":1,"textCharacterCount":10,"nonWhitespacePixelRatio":0.2,"clippedElementCount":0}'
        >
          <TextArea
            id="qaPages"
            required
            maxLength={200_000}
            placeholder="[]"
          />
        </Field>
        <Field
          label="Cross-reference checks JSON (optional)"
          name="qaCrossReferences"
          hint='Array entries: {"label":"Section 2","resolved":true}'
        >
          <TextArea id="qaCrossReferences" maxLength={200_000} />
        </Field>
        <Field
          label="Signature checks JSON (optional)"
          name="qaSignatures"
          hint='Array entries: {"label":"Form of tender","required":true,"present":true}'
        >
          <TextArea id="qaSignatures" maxLength={100_000} />
        </Field>
        <Submit disabled={!permissions.packageGenerate}>
          Evaluate and record visual QA
        </Submit>
      </form>
    </Panel>
  );
}
