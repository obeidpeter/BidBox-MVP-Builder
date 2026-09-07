import type {
  OperationsRecorderPermissions,
  OperationsRecorderRecords,
} from "../pursuit-operations-suite-recorder";
import {
  CONTROL,
  DocumentSelect,
  EvidenceSlotSelect,
  Field,
  Panel,
  PermissionBoundary,
  RecordSelect,
  Submit,
  TextArea,
  list,
  optionalIso,
  requiredText,
  selected,
  selectedDocument,
  selectedEvidenceSlot,
  withOptional,
  type RecorderSend,
} from "./recorder-primitives";

export function ClientEvidenceRequestPanel({
  permissions,
  records,
  documentsState,
  disabled,
  send,
}: {
  permissions: OperationsRecorderPermissions;
  records: OperationsRecorderRecords;
  documentsState: "loading" | "ready" | "error" | "unavailable";
  disabled: boolean;
  send: RecorderSend;
}) {
  return (
    <Panel
      title="3. Client evidence request"
      description="Valo records the request and later records the named person's manual sharing, uploaded document hash, signed confirmation and reasoned review decision. It sends nothing."
      allowed={permissions.evidenceWrite || permissions.evidenceApprove}
      unavailableReason="Evidence write or approval permission is required."
      disabled={disabled}
    >
      <PermissionBoundary
        allowed={permissions.evidenceWrite}
        label="Evidence write"
      >
        <form
          className="grid gap-3"
          onSubmit={send((data) => ({
            path: "/operations-suite/evidence-requests",
            method: "POST",
            successTitle: "Evidence request draft recorded",
            body: withOptional(
              {
                recipientLabel: requiredText(
                  data,
                  "evidenceRecipient",
                  "Recipient label",
                  256,
                ),
                requestMessage: requiredText(
                  data,
                  "evidenceMessage",
                  "Request message",
                ),
                slots: [
                  {
                    label: requiredText(
                      data,
                      "evidenceSlotLabel",
                      "Slot label",
                      256,
                    ),
                    required: data.get("evidenceSlotRequired") === "on",
                    acceptedContentTypes: list(
                      data,
                      "evidenceContentTypes",
                      "Accepted content types",
                      50,
                    ),
                  },
                ],
              },
              { dueAt: optionalIso(data, "evidenceDueAt", "Due time") },
            ),
          }))}
        >
          <h3 className="text-sm font-semibold">Create request draft</h3>
          <Field label="Recipient label" name="evidenceRecipient" />
          <Field label="Due time, ISO (optional)" name="evidenceDueAt" />
          <Field label="Request message" name="evidenceMessage">
            <TextArea id="evidenceMessage" required />
          </Field>
          <Field label="Upload slot label" name="evidenceSlotLabel" />
          <Field
            label="Accepted content types (comma/newline)"
            name="evidenceContentTypes"
          />
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" name="evidenceSlotRequired" /> Required slot
          </label>
          <Submit disabled={!permissions.evidenceWrite}>
            Record request draft
          </Submit>
        </form>
        <form
          className="grid gap-3 border-t border-border pt-4"
          onSubmit={send((data) => {
            const record = selected(
              records.evidenceRequests,
              data,
              "sharedEvidenceId",
              "Evidence request",
            );
            return {
              path: `/operations-suite/evidence-requests/${encodeURIComponent(record.id)}/mark-shared`,
              method: "POST",
              successTitle: "Manual sharing recorded",
              body: { expectedVersion: record.version },
            };
          })}
        >
          <h3 className="text-sm font-semibold">Record manual sharing</h3>
          <Field label="Current request" name="sharedEvidenceId">
            <RecordSelect
              id="sharedEvidenceId"
              records={records.evidenceRequests}
            />
          </Field>
          <Submit disabled={!permissions.evidenceWrite}>
            Mark manually shared
          </Submit>
        </form>
        <form
          className="grid gap-3 border-t border-border pt-4"
          onSubmit={send((data) => {
            const { record, slot } = selectedEvidenceSlot(
              records.evidenceRequests,
              data,
              "responseEvidenceSlot",
              "response",
            );
            const document = selectedDocument(
              records.documents,
              data,
              "responseDocumentId",
              true,
            );
            if (!document) {
              throw new Error("An approved response document is required.");
            }
            const acceptedContentTypes = slot.acceptedContentTypes.map(
              (contentType) => contentType.trim().toLowerCase(),
            );
            if (
              acceptedContentTypes.length > 0 &&
              !acceptedContentTypes.includes(
                document.contentType.trim().toLowerCase(),
              )
            ) {
              throw new Error(
                "The selected document content type is not accepted by this request slot.",
              );
            }
            return {
              path: `/operations-suite/evidence-requests/${encodeURIComponent(record.id)}/responses`,
              method: "POST",
              successTitle: "Evidence response recorded",
              body: {
                expectedVersion: record.version,
                slotId: slot.id,
                documentId: document.id,
                sha256: document.sha256,
                attestation: requiredText(
                  data,
                  "responseAttestation",
                  "Signed confirmation",
                ),
              },
            };
          })}
        >
          <h3 className="text-sm font-semibold">Record uploaded response</h3>
          <Field label="Current request slot" name="responseEvidenceSlot">
            <EvidenceSlotSelect
              id="responseEvidenceSlot"
              records={records.evidenceRequests}
              mode="response"
            />
          </Field>
          <Field label="Approved uploaded document" name="responseDocumentId">
            <DocumentSelect
              id="responseDocumentId"
              records={records.documents}
              required
            />
          </Field>
          <Field label="Named operator confirmation" name="responseAttestation">
            <TextArea id="responseAttestation" required />
          </Field>
          <Submit
            disabled={
              !permissions.evidenceWrite ||
              documentsState !== "ready" ||
              records.documents.length === 0
            }
          >
            Record uploaded response
          </Submit>
        </form>
      </PermissionBoundary>
      <PermissionBoundary
        allowed={permissions.evidenceApprove}
        label="Evidence approval"
      >
        <form
          className="grid gap-3 border-t border-border pt-4"
          onSubmit={send((data) => {
            const { record, slot } = selectedEvidenceSlot(
              records.evidenceRequests,
              data,
              "decisionEvidenceSlot",
              "decision",
            );
            const decision = requiredText(
              data,
              "evidenceDecision",
              "Decision",
              16,
            );
            return {
              path: `/operations-suite/evidence-requests/${encodeURIComponent(record.id)}/decisions`,
              method: "POST",
              successTitle:
                decision === "accepted"
                  ? "Evidence acceptance recorded"
                  : "Evidence changes requested",
              body: {
                expectedVersion: record.version,
                slotId: slot.id,
                decision,
                reason: requiredText(
                  data,
                  "evidenceDecisionReason",
                  "Decision reason",
                  1_024,
                ),
              },
            };
          })}
        >
          <h3 className="text-sm font-semibold">Record response decision</h3>
          <Field label="Responded request slot" name="decisionEvidenceSlot">
            <EvidenceSlotSelect
              id="decisionEvidenceSlot"
              records={records.evidenceRequests}
              mode="decision"
            />
          </Field>
          <Field label="Decision" name="evidenceDecision">
            <select
              id="evidenceDecision"
              name="evidenceDecision"
              className={CONTROL}
              data-control-size="44"
            >
              <option value="accepted">Accept</option>
              <option value="rejected">Request changes</option>
            </select>
          </Field>
          <Field label="Decision reason" name="evidenceDecisionReason">
            <TextArea id="evidenceDecisionReason" required maxLength={1_024} />
          </Field>
          <Submit disabled={!permissions.evidenceApprove}>
            Record response decision
          </Submit>
        </form>
      </PermissionBoundary>
    </Panel>
  );
}
