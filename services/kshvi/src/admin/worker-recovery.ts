import { appendDurableJsonLine, readDurableJsonLines } from '../auth/durable-jsonl';

type WorkerRecoveryRecord = { workerId: string; sequence: number };

export class WorkerRecoveryService {
  private readonly completed = new Map<string, number>();

  constructor(private readonly options: { stateFile?: string } = {}) {
    for (const record of readDurableJsonLines<WorkerRecoveryRecord>(this.options.stateFile)) {
      this.completed.set(record.workerId, Math.max(this.completed.get(record.workerId) ?? -1, record.sequence));
    }
  }

  async resume(workerId: string, sequence: number, effect: () => Promise<void>): Promise<boolean> {
    if (!Number.isSafeInteger(sequence) || sequence < 0) throw new Error('Некорректная последовательность worker');
    if ((this.completed.get(workerId) ?? -1) >= sequence) return false;
    await effect();
    appendDurableJsonLine(this.options.stateFile, { workerId, sequence } satisfies WorkerRecoveryRecord);
    this.completed.set(workerId, sequence);
    return true;
  }
}
