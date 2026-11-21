import { randomUUID } from 'node:crypto';

export type StartInstanceInput = { scenarioState: string; scenarioRevisionId: string; idempotencyKey: string };
export type InstanceRecord = { id: string; branchId: string; scenarioRevisionId: string; state: 'ACTIVE' };

export class InstanceService {
  private readonly starts = new Map<string, InstanceRecord>();

  async startInstance(input: StartInstanceInput): Promise<InstanceRecord> {
    if (input.scenarioState !== 'SEALED') throw new Error('Запуск возможен только из SEALED');
    const existing = this.starts.get(input.idempotencyKey);
    if (existing) return existing;
    const instance = { id: randomUUID(), branchId: randomUUID(), scenarioRevisionId: input.scenarioRevisionId, state: 'ACTIVE' as const };
    this.starts.set(input.idempotencyKey, instance);
    return instance;
  }
}
