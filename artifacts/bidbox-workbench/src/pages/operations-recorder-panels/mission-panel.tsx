import { useState } from "react";
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
  jsonArray,
  optionalId,
  optionalText,
  requiredIso,
  requiredText,
  selected,
  selectedCurrentUser,
  selectedDocument,
  shortId,
  withOptional,
  type RecorderSend,
} from "./recorder-primitives";

export function MissionPanel({
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
  const [updateMissionId, setUpdateMissionId] = useState("");
  const updateMission = records.missions.find(
    (mission) => mission.id === updateMissionId,
  );
  return (
    <Panel
      title="7. Pre-bid and site-visit mission"
      description="Record the plan and named delegate's authority. Later updates use the current checklist, approved pursuit documents, linked follow-up work and reasons entered by the operator."
      allowed={permissions.projectUpdate}
      unavailableReason="Project update permission is required."
      disabled={disabled}
    >
      <form
        className="grid gap-3"
        onSubmit={send((data) => {
          const delegateUserId = selectedCurrentUser(
            data,
            "missionDelegate",
            currentUserId,
            "Mission delegate",
          );
          const delegateAuthorityNote = optionalText(
            data,
            "missionAuthority",
            "Delegate authority note",
            1_024,
          );
          if (delegateUserId && !delegateAuthorityNote) {
            throw new Error("A delegate requires a recorded authority note.");
          }
          return {
            path: "/operations-suite/missions",
            method: "POST",
            successTitle: "Mission plan recorded",
            body: withOptional(
              {
                missionType: requiredText(
                  data,
                  "missionType",
                  "Mission type",
                  32,
                ),
                title: requiredText(data, "missionTitle", "Mission title"),
                location: requiredText(
                  data,
                  "missionLocation",
                  "Location",
                  1_024,
                ),
                startsAt: requiredIso(data, "missionStartsAt", "Start time"),
                attendanceRequired:
                  data.get("missionAttendanceRequired") === "on",
                checklist:
                  jsonArray(
                    data,
                    "missionChecklist",
                    "Mission checklist",
                    100,
                    true,
                  ) ?? [],
              },
              { delegateUserId, delegateAuthorityNote },
            ),
          };
        })}
      >
        <h3 className="text-sm font-semibold">Create mission plan</h3>
        <Field label="Mission type" name="missionType">
          <select
            id="missionType"
            name="missionType"
            className={CONTROL}
            data-control-size="44"
          >
            <option value="pre_bid">Pre-bid meeting</option>
            <option value="site_visit">Site visit</option>
          </select>
        </Field>
        <Field label="Mission title" name="missionTitle" />
        <Field label="Location" name="missionLocation" />
        <Field label="Start time, ISO" name="missionStartsAt" />
        <Field label="Mission delegate" name="missionDelegate">
          <CurrentUserAssignmentSelect
            id="missionDelegate"
            currentUserId={currentUserId}
            emptyLabel="No delegate"
          />
        </Field>
        <Field
          label="Delegate authority note (required with delegate)"
          name="missionAuthority"
        >
          <TextArea id="missionAuthority" maxLength={1_024} />
        </Field>
        <Field
          label="Checklist JSON"
          name="missionChecklist"
          hint='Array entries: {"label":"Carry authority letter","required":true}'
        >
          <TextArea id="missionChecklist" required maxLength={100_000} />
        </Field>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" name="missionAttendanceRequired" /> Attendance
          required
        </label>
        <Submit disabled={!permissions.projectUpdate}>
          Record mission plan
        </Submit>
      </form>
      <form
        className="grid gap-3 border-t border-border pt-4"
        onSubmit={send((data) => {
          const record = selected(
            records.missions,
            data,
            "updateMissionId",
            "Mission",
          );
          const status = optionalText(
            data,
            "missionUpdateStatus",
            "Status",
            32,
          );
          const completedChecklistItemId = optionalId(
            data,
            "missionChecklistItemId",
            "Checklist item ID",
          );
          const proofDocument = selectedDocument(
            records.documents,
            data,
            "missionProofDocumentId",
            false,
          );
          const proofDocumentId = proofDocument?.id;
          const proofSha256 = proofDocument?.sha256;
          const followUpWorkItemId = optionalId(
            data,
            "missionFollowUpWorkId",
            "Follow-up work ID",
          );
          const reason = optionalText(
            data,
            "missionUpdateReason",
            "Reason",
            1_024,
          );
          if (["missed", "cancelled"].includes(status ?? "") && !reason) {
            throw new Error("Missed or cancelled missions require a reason.");
          }
          if (
            completedChecklistItemId &&
            !record.checklist.some(({ id }) => id === completedChecklistItemId)
          ) {
            throw new Error(
              "The checklist item is not in the selected mission.",
            );
          }
          const patch = withOptional(
            { expectedVersion: record.version },
            {
              status,
              completedChecklistItemId,
              proofDocumentId,
              proofSha256,
              followUpWorkItemId,
              reason,
            },
          );
          if (Object.keys(patch).length === 1) {
            throw new Error("Enter at least one mission update field.");
          }
          return {
            path: `/operations-suite/missions/${encodeURIComponent(record.id)}`,
            method: "PATCH",
            successTitle: "Mission update recorded",
            body: patch,
          };
        })}
      >
        <h3 className="text-sm font-semibold">Record mission update</h3>
        <Field label="Current mission" name="updateMissionId">
          <RecordSelect
            id="updateMissionId"
            records={records.missions}
            selectedValue={updateMissionId}
            onValueChange={setUpdateMissionId}
          />
        </Field>
        <Field label="Status (optional)" name="missionUpdateStatus">
          <select
            id="missionUpdateStatus"
            name="missionUpdateStatus"
            className={CONTROL}
            data-control-size="44"
          >
            <option value="">No status change</option>
            <option value="planned">Planned</option>
            <option value="attended">Attended</option>
            <option value="missed">Missed</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </Field>
        <Field
          label="Completed checklist item (optional)"
          name="missionChecklistItemId"
        >
          <select
            id="missionChecklistItemId"
            name="missionChecklistItemId"
            className={CONTROL}
            data-control-size="44"
            disabled={!updateMission}
          >
            <option value="">No checklist completion</option>
            {updateMission?.checklist.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label} · {shortId(item.id)}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Approved visit proof document (optional)"
          name="missionProofDocumentId"
          hint="The selected project document supplies both the exact document ID and current SHA-256."
        >
          <DocumentSelect
            id="missionProofDocumentId"
            records={records.documents}
          />
        </Field>
        <Field
          label="Follow-up work item (optional)"
          name="missionFollowUpWorkId"
        >
          <RecordSelect
            id="missionFollowUpWorkId"
            records={records.workItems}
            required={false}
          />
        </Field>
        <Field
          label="Reason (required for missed/cancelled)"
          name="missionUpdateReason"
        >
          <TextArea id="missionUpdateReason" maxLength={1_024} />
        </Field>
        <Submit disabled={!permissions.projectUpdate}>
          Record mission update
        </Submit>
      </form>
    </Panel>
  );
}
