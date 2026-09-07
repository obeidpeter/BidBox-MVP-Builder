import type { ClientActionSnapshot } from "./client-action-contract";
import type { ClientActionUploadBinding } from "./client-action-upload-contract";

export function assertClientActionUploadTargetCurrent(
  snapshot: ClientActionSnapshot | undefined,
  binding: ClientActionUploadBinding,
  currentUserId: string,
): void {
  const request = snapshot?.records.find(
    (record) =>
      record.kind === "evidence_request" && record.id === binding.recordId,
  );
  const slot =
    request?.kind === "evidence_request"
      ? request.slots.find((candidate) => candidate.id === binding.slotId)
      : undefined;
  const attempt = slot?.attempts.at(-1);
  if (
    snapshot?.organisationId !== binding.organisationId ||
    snapshot.projectId !== binding.projectId ||
    !request ||
    request.kind !== "evidence_request" ||
    request.recipientUserId !== currentUserId ||
    request.requestAcknowledgement?.acknowledgedByUserId !== currentUserId ||
    request.status !== "in_progress" ||
    request.version !== binding.expectedRecordVersion ||
    !slot ||
    !attempt ||
    attempt.intent.id !== binding.intentId ||
    attempt.intent.recordedByUserId !== currentUserId ||
    attempt.intent.filename !== binding.filename ||
    attempt.intent.contentType !== binding.contentType ||
    attempt.intent.sizeBytes !== binding.sizeBytes ||
    attempt.intent.declaredSha256 !== binding.declaredSha256 ||
    attempt.document !== null ||
    attempt.review !== null ||
    slot.acceptedContentTypes.length !== binding.acceptedContentTypes.length ||
    slot.acceptedContentTypes.some(
      (contentType, index) =>
        contentType !== binding.acceptedContentTypes[index],
    )
  ) {
    throw new Error(
      "Client action request, recipient, slot, version, or upload intent is no longer current",
    );
  }
}
