export type HeavyJob = Readonly<{
  id: string;
  kind: 'EXPORT' | 'ARCHIVE' | 'MASS_CALCULATION' | 'REPLAY';
  cpuUnits: number;
  memoryMb: number;
  status: 'RUNNING' | 'QUEUED' | 'SUCCEEDED';
}>;

export class ResourceBudget {
  private readonly jobs = new Map<string, HeavyJob>();
  private interactiveCommandsAccepted = 0;

  constructor(private readonly limits: {
    maxConcurrentHeavyJobs: number;
    maxQueuedHeavyJobs: number;
    cpuUnitsPerJob: number;
    memoryMbPerJob: number;
  }) {}

  submit(input: Omit<HeavyJob, 'status'>): HeavyJob {
    if (this.jobs.has(input.id)) throw new Error('Идентификатор задания уже использован');
    if (input.cpuUnits > this.limits.cpuUnitsPerJob) throw new Error('Задание превышает лимит CPU');
    if (input.memoryMb > this.limits.memoryMbPerJob) throw new Error('Задание превышает лимит памяти');
    const running = this.count('RUNNING');
    const queued = this.count('QUEUED');
    if (running >= this.limits.maxConcurrentHeavyJobs && queued >= this.limits.maxQueuedHeavyJobs) {
      throw new Error('Переполнена очередь тяжёлых заданий; интерактивные команды продолжают приниматься');
    }
    const job = { ...input, status: running < this.limits.maxConcurrentHeavyJobs ? 'RUNNING' as const : 'QUEUED' as const };
    this.jobs.set(job.id, job);
    return structuredClone(job);
  }

  runInteractive<Result>(_commandId: string, operation: () => Result): Result {
    this.interactiveCommandsAccepted += 1;
    return operation();
  }

  complete(id: string): void {
    const job = this.jobs.get(id);
    if (!job || job.status !== 'RUNNING') throw new Error('Выполняющееся задание не найдено');
    this.jobs.set(id, { ...job, status: 'SUCCEEDED' });
    const next = [...this.jobs.values()].find(candidate => candidate.status === 'QUEUED');
    if (next) this.jobs.set(next.id, { ...next, status: 'RUNNING' });
  }

  status(id: string): HeavyJob['status'] {
    const job = this.jobs.get(id);
    if (!job) throw new Error('Задание не найдено');
    return job.status;
  }

  snapshot(): { running: number; queued: number; interactiveCommandsAccepted: number } {
    return { running: this.count('RUNNING'), queued: this.count('QUEUED'), interactiveCommandsAccepted: this.interactiveCommandsAccepted };
  }

  private count(status: HeavyJob['status']): number {
    return [...this.jobs.values()].filter(job => job.status === status).length;
  }
}
