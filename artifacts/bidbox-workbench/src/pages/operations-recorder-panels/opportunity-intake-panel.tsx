import type { OperationsRecorderPermissions } from "../pursuit-operations-suite-recorder";
import {
  CONTROL,
  Field,
  Panel,
  Submit,
  optionalIso,
  optionalSha,
  optionalText,
  requiredIso,
  requiredText,
  withOptional,
  type RecorderSend,
} from "./recorder-primitives";

export function OpportunityIntakePanel({
  permissions,
  disabled,
  send,
}: {
  permissions: OperationsRecorderPermissions;
  disabled: boolean;
  send: RecorderSend;
}) {
  return (
    <Panel
      title="1. Opportunity intake"
      description="Record an approved source and where it came from. For content without a URL, enter its fingerprint; licensed or OCDS sources also need the recorded basis for use."
      allowed={permissions.projectUpdate}
      unavailableReason="Project update permission is required."
      disabled={disabled}
    >
      <form
        className="grid gap-3"
        onSubmit={send((data) => {
          const sourceType = requiredText(
            data,
            "opportunitySourceType",
            "Source type",
            32,
          );
          const authorisationBasis = optionalText(
            data,
            "opportunityAuthorisation",
            "Authorisation basis",
            1_024,
          );
          const contentSha256 = optionalSha(
            data,
            "opportunityContentHash",
            "Source content hash",
          );
          if (sourceType !== "manual_url" && !contentSha256) {
            throw new Error(
              "Non-URL sources require a source content SHA-256.",
            );
          }
          if (
            ["licensed_csv", "ocds"].includes(sourceType) &&
            !authorisationBasis
          ) {
            throw new Error(
              "Licensed CSV and OCDS sources require an authorisation basis.",
            );
          }
          return {
            path: "/operations-suite/opportunities",
            method: "POST",
            successTitle: "Opportunity source recorded",
            body: withOptional(
              {
                title: requiredText(
                  data,
                  "opportunityTitle",
                  "Opportunity title",
                ),
                issuer: requiredText(data, "opportunityIssuer", "Issuer"),
                source: withOptional(
                  {
                    type: sourceType,
                    locator: requiredText(
                      data,
                      "opportunityLocator",
                      "Source locator",
                      2_048,
                    ),
                    receivedAt: requiredIso(
                      data,
                      "opportunityReceivedAt",
                      "Source received time",
                    ),
                  },
                  { authorisationBasis, contentSha256 },
                ),
              },
              {
                reference: optionalText(
                  data,
                  "opportunityReference",
                  "Reference",
                  256,
                ),
                lot: optionalText(data, "opportunityLot", "Lot", 256),
                deadline: optionalIso(data, "opportunityDeadline", "Deadline"),
              },
            ),
          };
        })}
      >
        <Field label="Opportunity title" name="opportunityTitle" />
        <Field label="Issuer" name="opportunityIssuer" />
        <Field label="Reference (optional)" name="opportunityReference" />
        <Field label="Lot (optional)" name="opportunityLot" />
        <Field
          label="Recorded deadline, ISO (optional)"
          name="opportunityDeadline"
        />
        <Field label="Source type" name="opportunitySourceType">
          <select
            id="opportunitySourceType"
            name="opportunitySourceType"
            className={CONTROL}
            data-control-size="44"
          >
            <option value="manual_url">Manual URL</option>
            <option value="forwarded_email">Forwarded email</option>
            <option value="licensed_csv">Licensed CSV</option>
            <option value="ocds">OCDS</option>
          </select>
        </Field>
        <Field label="Source locator" name="opportunityLocator" />
        <Field label="Source received time, ISO" name="opportunityReceivedAt" />
        <Field
          label="Authorisation basis (when required)"
          name="opportunityAuthorisation"
        />
        <Field
          label="Source content SHA-256 (when required)"
          name="opportunityContentHash"
        />
        <Submit disabled={!permissions.projectUpdate}>
          Record opportunity source
        </Submit>
      </form>
    </Panel>
  );
}
