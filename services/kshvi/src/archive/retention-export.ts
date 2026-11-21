export type ExportParticipant = {
  userId: string;
  displayName?: string;
  role: string;
  sideId: string;
  [key: string]: unknown;
};
export type ParticipantExportPolicy = { includeDisplayNames: boolean; allowedSideIds: readonly string[] };

export function filterParticipantsForExport(participants: readonly ExportParticipant[], policy: ParticipantExportPolicy): readonly Record<string, unknown>[] {
  return participants.filter(participant => policy.allowedSideIds.includes(participant.sideId)).map(participant => ({
    userId: participant.userId,
    role: participant.role,
    sideId: participant.sideId,
    ...(policy.includeDisplayNames && participant.displayName ? { displayName: participant.displayName } : {}),
  }));
}
