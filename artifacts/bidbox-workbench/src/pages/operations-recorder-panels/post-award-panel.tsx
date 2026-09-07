import type {
  OperationsRecorderPermissions,
  OperationsRecorderRecords,
} from "../pursuit-operations-suite-recorder";
import {
  CONTROL,
  CurrentUserAssignmentSelect,
  DocumentSelect,
  Field,
  Panel,
  RecordSelect,
  Submit,
  TextArea,
  optionalInteger,
  optionalIso,
  optionalText,
  requiredText,
  selected,
  selectedCurrentUser,
  selectedDocument,
  withOptional,
  type RecorderSend,
} from "./recorder-primitives";

export function PostAwardPanel({
  permissions,
  records,
  currentUserId,
  disabled,
  send,
}: {
  permissions: OperationsRecorderPermissions;
  records: OperationsRecorderRecords;
  currentUserId: string | undefined;
  disabled: boolean;
  send: RecorderSend;
}) {
  return (
    <Panel
      title="8. Post-award delivery"
      description="Record obligations and internal progress. Approved pursuit documents provide the source, evidence and completion receipt IDs. A named operator must enter reasons for disputed or cancelled work."
      allowed={permissions.projectUpdate}
      unavailableReason="Project update permission is required."
      disabled={disabled}
    >
      <form
        className="grid gap-3"
        onSubmit={send((data) => {
          const valueMinorUnits = optionalInteger(
            data,
            "postValueMinor",
            "Recorded value",
            0,
            Number.MAX_SAFE_INTEGER,
          );
          const currency = optionalText(
            data,
            "postCurrency",
            "Currency",
            3,
          )?.toUpperCase();
          if (Boolean(valueMinorUnits !== undefined) !== Boolean(currency)) {
            throw new Error(
              "Recorded value and currency must be supplied together.",
            );
          }
          if (currency && !/^[A-Z]{3}$/u.test(currency)) {
            throw new Error("Currency must be a three-letter code.");
          }
          const sourceDocument = selectedDocument(
            records.documents,
            data,
            "postSourceDocument",
            false,
          );
          const evidenceDocument = selectedDocument(
            records.documents,
            data,
            "postEvidenceDocument",
            false,
          );
          return {
            path: "/operations-suite/post-award-items",
            method: "POST",
            successTitle: "Post-award item recorded",
            body: withOptional(
              {
                category: requiredText(data, "postCategory", "Category", 32),
                title: requiredText(data, "postTitle", "Post-award title"),
                evidenceDocumentIds: evidenceDocument
                  ? [evidenceDocument.id]
                  : [],
              },
              {
                description: optionalText(
                  data,
                  "postDescription",
                  "Description",
                ),
                dueAt: optionalIso(data, "postDueAt", "Due time"),
                ownerUserId: selectedCurrentUser(
                  data,
                  "postOwner",
                  currentUserId,
                  "Post-award owner",
                ),
                sourceDocumentId: sourceDocument?.id,
                valueMinorUnits,
                currency,
              },
            ),
          };
        })}
      >
        <h3 className="text-sm font-semibold">Create post-award item</h3>
        <Field label="Category" name="postCategory">
          <select
            id="postCategory"
            name="postCategory"
            className={CONTROL}
            data-control-size="44"
          >
            <option value="obligation">Obligation</option>
            <option value="deliverable">Deliverable</option>
            <option value="variation">Variation</option>
            <option value="payment_milestone">Payment milestone</option>
            <option value="notice">Notice</option>
            <option value="completion_record">Completion record</option>
          </select>
        </Field>
        <Field label="Title" name="postTitle" />
        <Field label="Description (optional)" name="postDescription">
          <TextArea id="postDescription" />
        </Field>
        <Field label="Due time, ISO (optional)" name="postDueAt" />
        <Field label="Post-award owner" name="postOwner">
          <CurrentUserAssignmentSelect
            id="postOwner"
            currentUserId={currentUserId}
            emptyLabel="Leave unassigned"
          />
        </Field>
        <Field
          label="Approved source document (optional)"
          name="postSourceDocument"
        >
          <DocumentSelect id="postSourceDocument" records={records.documents} />
        </Field>
        <Field
          label="Initial approved evidence document (optional)"
          name="postEvidenceDocument"
        >
          <DocumentSelect
            id="postEvidenceDocument"
            records={records.documents}
          />
        </Field>
        <Field
          label="Value in minor units (optional pair)"
          name="postValueMinor"
        />
        <Field label="Currency code (optional pair)" name="postCurrency" />
        <Submit disabled={!permissions.projectUpdate}>
          Record post-award item
        </Submit>
      </form>
      <form
        className="grid gap-3 border-t border-border pt-4"
        onSubmit={send((data) => {
          const record = selected(
            records.postAwardItems,
            data,
            "updatePostId",
            "Post-award item",
          );
          const status = optionalText(data, "postUpdateStatus", "Status", 32);
          const ownerUserId = selectedCurrentUser(
            data,
            "postUpdateOwner",
            currentUserId,
            "Updated post-award owner",
          );
          const dueAt = optionalIso(data, "postUpdateDueAt", "Due time");
          const completionDocument = selectedDocument(
            records.documents,
            data,
            "postCompletionDocument",
            false,
          );
          const evidenceDocumentIds = completionDocument
            ? [
                ...new Set([
                  ...record.evidenceDocumentIds,
                  completionDocument.id,
                ]),
              ]
            : undefined;
          const completionReceiptSha256 = completionDocument?.sha256;
          const reason = optionalText(
            data,
            "postUpdateReason",
            "Reason",
            1_024,
          );
          const resultingEvidence =
            evidenceDocumentIds ?? record.evidenceDocumentIds;
          if (
            status === "satisfied" &&
            (!completionReceiptSha256 || resultingEvidence.length === 0)
          ) {
            throw new Error(
              "Satisfied status requires at least one evidence document and a completion receipt SHA-256.",
            );
          }
          if (["disputed", "cancelled"].includes(status ?? "") && !reason) {
            throw new Error("Disputed or cancelled items require a reason.");
          }
          const body = withOptional(
            { expectedVersion: record.version },
            {
              status,
              ownerUserId,
              dueAt,
              evidenceDocumentIds,
              completionReceiptSha256,
              reason,
            },
          );
          if (Object.keys(body).length === 1) {
            throw new Error("Enter at least one post-award update field.");
          }
          return {
            path: `/operations-suite/post-award-items/${encodeURIComponent(record.id)}`,
            method: "PATCH",
            successTitle: "Post-award update recorded",
            body,
          };
        })}
      >
        <h3 className="text-sm font-semibold">Record post-award update</h3>
        <Field label="Current post-award item" name="updatePostId">
          <RecordSelect id="updatePostId" records={records.postAwardItems} />
        </Field>
        <Field label="Status (optional)" name="postUpdateStatus">
          <select
            id="postUpdateStatus"
            name="postUpdateStatus"
            className={CONTROL}
            data-control-size="44"
          >
            <option value="">No status change</option>
            <option value="open">Open</option>
            <option value="in_progress">In progress</option>
            <option value="satisfied">
              Satisfied with evidence and receipt
            </option>
            <option value="disputed">Disputed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </Field>
        <Field label="Updated post-award owner" name="postUpdateOwner">
          <CurrentUserAssignmentSelect
            id="postUpdateOwner"
            currentUserId={currentUserId}
            emptyLabel="No owner change"
          />
        </Field>
        <Field label="Due time, ISO (optional)" name="postUpdateDueAt" />
        <Field
          label="Approved completion evidence or receipt (optional)"
          name="postCompletionDocument"
          hint="Selecting a project document adds its ID to the evidence list and records its exact current SHA-256 as the completion receipt."
        >
          <DocumentSelect
            id="postCompletionDocument"
            records={records.documents}
          />
        </Field>
        <Field
          label="Reason (required for disputed/cancelled)"
          name="postUpdateReason"
        >
          <TextArea id="postUpdateReason" maxLength={1_024} />
        </Field>
        <Submit disabled={!permissions.projectUpdate}>
          Record post-award update
        </Submit>
      </form>
    </Panel>
  );
}
