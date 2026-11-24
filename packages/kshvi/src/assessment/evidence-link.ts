export type MetricEvidenceEvent = {
  eventId: string;
  sequence: number;
  causeIds?: readonly string[];
};
export type EvidenceLink = {
  eventId: string;
  sequence: number;
  calculationId: string;
  field: string;
  causeEventIds: readonly string[];
};

export function createEvidenceLink(event: MetricEvidenceEvent, calculationId: string, field: string): EvidenceLink {
  return { eventId: event.eventId, sequence: event.sequence, calculationId, field, causeEventIds: [...(event.causeIds ?? [])] };
}
