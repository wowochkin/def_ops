export type AuditInput = {
  actorId: string;
  action: string;
  correlationId: string;
  resourceId?: string;
};

export function auditRecord(input: AuditInput & Record<string, unknown>): AuditInput {
  const record: AuditInput = { actorId: input.actorId, action: input.action, correlationId: input.correlationId };
  if (input.resourceId) record.resourceId = input.resourceId;
  return record;
}
