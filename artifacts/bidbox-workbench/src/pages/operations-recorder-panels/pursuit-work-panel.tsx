import type {
  OperationsRecorderPermissions,
  OperationsRecorderRecords,
} from "../pursuit-operations-suite-recorder";
import {
  CONTROL,
  CurrentUserAssignmentSelect,
  Field,
  Panel,
  PermissionBoundary,
  RecordSelect,
  Submit,
  TextArea,
  idList,
  optionalIso,
  optionalText,
  requiredText,
  selected,
  selectedCurrentUser,
  withOptional,
  type RecorderSend,
} from "./recorder-primitives";

const WORK_STATUS_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  backlog: ["ready", "cancelled"],
  ready: ["in_progress", "blocked", "cancelled"],
  in_progress: ["blocked", "in_review", "done", "cancelled"],
  blocked: ["ready", "in_progress", "cancelled"],
  in_review: ["in_progress", "blocked", "done", "cancelled"],
  done: [],
  cancelled: [],
};

export function PursuitWorkPanel({
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
      title="2. Pursuit work"
      description="Create work for this organisation, then add comments or a reasoned approval decision against the current record version."
      allowed={permissions.projectUpdate || permissions.projectAssign}
      unavailableReason="Project update or assignment permission is required."
      disabled={disabled}
    >
      <PermissionBoundary
        allowed={permissions.projectUpdate}
        label="Project update"
      >
        <form
          className="grid gap-3"
          onSubmit={send((data) => ({
            path: "/operations-suite/work-items",
            method: "POST",
            successTitle: "Work item recorded",
            body: withOptional(
              {
                title: requiredText(data, "workTitle", "Work title"),
                priority: requiredText(data, "workPriority", "Priority", 16),
                links: {
                  requirementIds: idList(
                    data,
                    "workRequirements",
                    "Requirement IDs",
                    100,
                  ),
                  evidenceItemIds: idList(
                    data,
                    "workEvidence",
                    "Evidence IDs",
                    100,
                  ),
                  packageIds: idList(data, "workPackages", "Package IDs", 100),
                },
                dependsOnIds: idList(
                  data,
                  "workDependencies",
                  "Dependency IDs",
                  50,
                ),
                approvalRequired: data.get("workApprovalRequired") === "on",
              },
              {
                description: optionalText(
                  data,
                  "workDescription",
                  "Description",
                ),
                ownerUserId: selectedCurrentUser(
                  data,
                  "workOwner",
                  currentUserId,
                  "Work owner",
                ),
                dueAt: optionalIso(data, "workDueAt", "Due time"),
              },
            ),
          }))}
        >
          <h3 className="text-sm font-semibold">Create work item</h3>
          <Field label="Work title" name="workTitle" />
          <Field label="Description (optional)" name="workDescription" />
          <Field label="Work owner" name="workOwner">
            <CurrentUserAssignmentSelect
              id="workOwner"
              currentUserId={currentUserId}
              emptyLabel="Leave unassigned"
            />
          </Field>
          <Field label="Due time, ISO (optional)" name="workDueAt" />
          <Field label="Priority" name="workPriority">
            <select
              id="workPriority"
              name="workPriority"
              className={CONTROL}
              data-control-size="44"
            >
              <option value="normal">Normal</option>
              <option value="low">Low</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </Field>
          <Field
            label="Requirement IDs (comma/newline)"
            name="workRequirements"
          />
          <Field label="Evidence IDs (comma/newline)" name="workEvidence" />
          <Field label="Package IDs (comma/newline)" name="workPackages" />
          <Field
            label="Dependency work IDs (comma/newline)"
            name="workDependencies"
          />
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" name="workApprovalRequired" /> Approval
            required
          </label>
          <Submit disabled={!permissions.projectUpdate}>
            Record work item
          </Submit>
        </form>
        <form
          className="grid gap-3 border-t border-border pt-4"
          onSubmit={send((data) => {
            const record = selected(
              records.workItems,
              data,
              "commentWorkId",
              "Work item",
            );
            return {
              path: `/operations-suite/work-items/${encodeURIComponent(record.id)}/comments`,
              method: "POST",
              successTitle: "Work comment recorded",
              body: {
                expectedVersion: record.version,
                body: requiredText(data, "workComment", "Comment"),
              },
            };
          })}
        >
          <h3 className="text-sm font-semibold">Record work comment</h3>
          <Field label="Current work item" name="commentWorkId">
            <RecordSelect id="commentWorkId" records={records.workItems} />
          </Field>
          <Field label="Comment" name="workComment">
            <TextArea id="workComment" required />
          </Field>
          <Submit disabled={!permissions.projectUpdate}>Record comment</Submit>
        </form>
        <form
          className="grid gap-3 border-t border-border pt-4"
          onSubmit={send((data) => {
            const record = selected(
              records.workItems,
              data,
              "statusWorkId",
              "Work item",
            );
            const status = requiredText(
              data,
              "recordedWorkStatus",
              "Work status",
              32,
            );
            if (!WORK_STATUS_TRANSITIONS[record.status]?.includes(status)) {
              throw new Error(
                "That work transition is not available from the current status.",
              );
            }
            const reason = optionalText(
              data,
              "workStatusReason",
              "Work status reason",
              1_024,
            );
            if (status === "cancelled" && !reason) {
              throw new Error("Work cancellation requires a reason.");
            }
            return {
              path: `/operations-suite/work-items/${encodeURIComponent(record.id)}`,
              method: "PATCH",
              successTitle: "Work status recorded",
              body: withOptional(
                { expectedVersion: record.version, status },
                { reason },
              ),
            };
          })}
        >
          <h3 className="text-sm font-semibold">
            Record work status with reason
          </h3>
          <Field label="Current work item" name="statusWorkId">
            <RecordSelect id="statusWorkId" records={records.workItems} />
          </Field>
          <Field label="Next status" name="recordedWorkStatus">
            <select
              id="recordedWorkStatus"
              name="recordedWorkStatus"
              className={CONTROL}
              data-control-size="44"
            >
              <option value="ready">Ready</option>
              <option value="in_progress">In progress</option>
              <option value="blocked">Blocked</option>
              <option value="in_review">In review</option>
              <option value="done">Done</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </Field>
          <Field
            label="Status reason (required for cancellation)"
            name="workStatusReason"
          >
            <TextArea id="workStatusReason" maxLength={1_024} />
          </Field>
          <Submit disabled={!permissions.projectUpdate}>
            Record work status
          </Submit>
        </form>
      </PermissionBoundary>
      <PermissionBoundary
        allowed={permissions.projectAssign}
        label="Project assignment"
      >
        <form
          className="grid gap-3 border-t border-border pt-4"
          onSubmit={send((data) => {
            const record = selected(
              records.workItems,
              data,
              "approvalWorkId",
              "Work item",
            );
            return {
              path: `/operations-suite/work-items/${encodeURIComponent(record.id)}/approval`,
              method: "POST",
              successTitle: "Work approval decision recorded",
              body: {
                expectedVersion: record.version,
                decision: requiredText(data, "workDecision", "Decision", 16),
                reason: requiredText(
                  data,
                  "workDecisionReason",
                  "Decision reason",
                  1_024,
                ),
              },
            };
          })}
        >
          <h3 className="text-sm font-semibold">Record approval decision</h3>
          <Field label="Current work item" name="approvalWorkId">
            <RecordSelect id="approvalWorkId" records={records.workItems} />
          </Field>
          <Field label="Decision" name="workDecision">
            <select
              id="workDecision"
              name="workDecision"
              className={CONTROL}
              data-control-size="44"
            >
              <option value="approved">Approve</option>
              <option value="rejected">Reject</option>
            </select>
          </Field>
          <Field label="Decision reason" name="workDecisionReason">
            <TextArea id="workDecisionReason" required maxLength={1_024} />
          </Field>
          <Submit disabled={!permissions.projectAssign}>
            Record approval decision
          </Submit>
        </form>
      </PermissionBoundary>
    </Panel>
  );
}
