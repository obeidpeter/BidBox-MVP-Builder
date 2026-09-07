import type {
  ConsortiumParticipantOption,
  ConsortiumParty,
  ConsortiumReasonCode,
} from "./partner-consortium-contract";

export const REASON_LABELS: Readonly<Record<ConsortiumReasonCode, string>> = {
  ownership_mismatch: "Ownership mismatch",
  scope_unclear: "Scope is unclear",
  deadline_unworkable: "Deadline is unworkable",
  quality_control_gap: "Quality-control gap",
  evidence_not_sufficient: "Evidence is not sufficient",
  offline_discussion_required: "Offline discussion required",
};

export const REASONS = Object.keys(REASON_LABELS) as ConsortiumReasonCode[];

export function short(value: string, start = 8, end = 6): string {
  return value.length <= start + end + 1
    ? value
    : `${value.slice(0, start)}…${value.slice(-end)}`;
}

export function localIso(value: string): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

export function participantsFor(
  participants: readonly ConsortiumParticipantOption[],
  party: ConsortiumParty,
): readonly ConsortiumParticipantOption[] {
  return participants.filter((participant) => participant.party === party);
}

export function participantName(
  participants: readonly ConsortiumParticipantOption[],
  userId: string,
  party: ConsortiumParty,
): string {
  return (
    participants.find(
      (participant) =>
        participant.party === party && participant.userId === userId,
    )?.name ?? "Named member details unavailable"
  );
}
