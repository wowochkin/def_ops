export type ExportParticipant = {
  userId: string;
  displayName?: string;
  role: string;
  sideId: string;
  [key: string]: unknown;
};
export type ParticipantExportPolicy = {
  includeDisplayNames: boolean;
  allowedSideIds: readonly string[];
  allowedAudiences?: readonly string[];
};

const OMIT = Symbol('archive-export-omit');
type Projection = typeof OMIT | unknown;

export function filterParticipantsForExport(participants: readonly ExportParticipant[], policy: ParticipantExportPolicy): readonly Record<string, unknown>[] {
  return participants.filter(participant => policy.allowedSideIds.includes(participant.sideId)
    && (!policy.allowedAudiences || !('audience' in participant)
      || (Array.isArray(participant.audience) && participant.audience.some(item => policy.allowedAudiences!.includes(String(item))))))
    .map(participant => ({
      userId: participant.userId,
      role: participant.role,
      sideId: participant.sideId,
      ...(policy.includeDisplayNames && participant.displayName ? { displayName: participant.displayName } : {}),
      ...(Array.isArray(participant.audience) ? { audience: participant.audience.filter(item => !policy.allowedAudiences || policy.allowedAudiences.includes(String(item))) } : {}),
    }));
}

function projectValue(value: unknown, policy: ParticipantExportPolicy): Projection {
  if (Array.isArray(value)) {
    return value.map(item => projectValue(item, policy)).filter(item => item !== OMIT);
  }
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  const sideId = record.sideId ?? record.side;
  if (typeof sideId === 'string' && !policy.allowedSideIds.includes(sideId)) return OMIT;
  if (Array.isArray(record.audience) && policy.allowedAudiences
    && !record.audience.some(item => policy.allowedAudiences!.includes(String(item)))) return OMIT;
  const projected = Object.fromEntries(Object.entries(record)
    .map(([key, nested]) => [key, projectValue(nested, policy)] as const)
    .filter(([, nested]) => nested !== OMIT));
  if (Array.isArray(record.audience) && policy.allowedAudiences) {
    projected.audience = record.audience.filter(item => policy.allowedAudiences!.includes(String(item)));
  }
  return projected;
}

export function projectComponentForExport(componentId: string, data: Uint8Array | string, policy: ParticipantExportPolicy): { data: Uint8Array | string; redacted: boolean } {
  if (componentId === 'viewer.engine' || componentId === 'viewer.index') return { data, redacted: false };
  const text = typeof data === 'string' ? data : new TextDecoder().decode(data);
  const source = JSON.parse(text) as unknown;
  if (componentId === 'participants.assignments' && source && typeof source === 'object') {
    const root = source as Record<string, unknown>;
    const payload = root.payload as Record<string, unknown> | undefined;
    if (payload && Array.isArray(payload.assignments)) {
      const projected = filterParticipantsForExport(payload.assignments as ExportParticipant[], policy);
      const changed = JSON.stringify(projected) !== JSON.stringify(payload.assignments);
      return { data: JSON.stringify({ ...root, payload: { ...payload, assignments: projected } }), redacted: changed };
    }
  }
  const projected = projectValue(source, policy);
  if (projected === OMIT) return { data: 'null', redacted: true };
  return { data: JSON.stringify(projected), redacted: JSON.stringify(projected) !== JSON.stringify(source) };
}
