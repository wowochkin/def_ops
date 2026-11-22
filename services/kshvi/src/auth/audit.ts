export type AuditInput = {
  actorId: string;
  action: string;
  correlationId: string;
  resourceId?: string;
  organizationId?: string;
  outcome?: 'ALLOWED' | 'DENIED';
};

export function auditRecord(input: AuditInput & Record<string, unknown>): AuditInput {
  const record: AuditInput = { actorId: input.actorId, action: input.action, correlationId: input.correlationId };
  if (input.resourceId) record.resourceId = input.resourceId;
  if (input.organizationId) record.organizationId = input.organizationId;
  if (input.outcome) record.outcome = input.outcome;
  return record;
}
