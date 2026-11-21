import { randomUUID } from 'node:crypto';

export type InstanceCommand = {
  instanceId: string;
  branchId: string;
  expectedRevision: number;
  idempotencyKey: string;
  type: string;
  actor: { userId: string; role: string; organizationId: string };
};
export type CommandResult = { eventId: string; revision: number; idempotent: boolean };

export class CommandService {
  private readonly results = new Map<string, CommandResult & { eventId: string }>();
  private readonly revisions = new Map<string, number>();

  async execute(input: InstanceCommand): Promise<CommandResult> {
    const key = `${input.instanceId}/${input.idempotencyKey}`;
    const existing = this.results.get(key);
    if (existing) return { ...existing, idempotent: true };
    if (input.actor.role !== 'LEADER') throw new Error('403: Команда недоступна');
    const branchKey = `${input.instanceId}/${input.branchId}`;
    const revision = this.revisions.get(branchKey) ?? 0;
    if (input.expectedRevision !== revision) throw new Error(`Устаревшая ревизия: ${input.expectedRevision}, актуальная ${revision}`);
    const result = { eventId: randomUUID(), revision: revision + 1, idempotent: false };
    this.results.set(key, result);
    this.revisions.set(branchKey, result.revision);
    return result;
  }
}
