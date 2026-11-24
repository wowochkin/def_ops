import { fork, type ChildProcess } from 'node:child_process';

export type HeavyOperation =
  | { kind: 'CPU_WORK'; iterations: number }
  | { kind: 'COPY_FILE'; source: string; destination: string }
  | { kind: 'DOMAIN_WORK'; domainKind: 'EXPORT' | 'ARCHIVE' | 'MASS_CALCULATION' | 'REPLAY'; inputPath: string };
export type HeavyJob = Readonly<{
  id: string;
  kind: 'EXPORT' | 'ARCHIVE' | 'MASS_CALCULATION' | 'REPLAY';
  cpuUnits: number;
  memoryMb: number;
  operation: HeavyOperation;
  status: 'RUNNING' | 'QUEUED';
}>;
export type HeavyJobResult = Readonly<{
  status: 'SUCCEEDED';
  result: {
    pid: number; iterations?: number; bytes?: number; cpuUsage: { userMs: number; systemMs: number };
    kind?: HeavyJob['kind']; rows?: number; sha256?: string; checksum?: number; orderingErrors?: number;
  };
}>;
type JobRecord = {
  job: HeavyJob;
  child?: ChildProcess;
  promise: Promise<HeavyJobResult>;
  resolve: (result: HeavyJobResult) => void;
  reject: (error: Error) => void;
  payload?: HeavyJobResult['result'];
  status: 'RUNNING' | 'QUEUED' | 'SUCCEEDED' | 'FAILED';
};

export class ResourceBudget {
  private readonly jobs = new Map<string, JobRecord>();
  private interactiveCommandsAccepted = 0;

  constructor(private readonly limits: {
    maxConcurrentHeavyJobs: number;
    maxQueuedHeavyJobs: number;
    cpuUnitsPerJob: number;
    memoryMbPerJob: number;
  }, private readonly observer: { event: (event: string) => void } = { event: () => {} }) {}

  submit(input: Omit<HeavyJob, 'status'>): HeavyJob {
    if (this.jobs.has(input.id)) throw new Error('Идентификатор задания уже использован');
    if (input.cpuUnits > this.limits.cpuUnitsPerJob) throw new Error('Задание превышает лимит CPU');
    if (input.memoryMb > this.limits.memoryMbPerJob) throw new Error('Задание превышает лимит памяти');
    if (!Number.isSafeInteger(input.cpuUnits) || input.cpuUnits <= 0 || !Number.isSafeInteger(input.memoryMb) || input.memoryMb < 32) {
      throw new Error('Лимиты задания должны быть положительными, память — не менее 32 МиБ');
    }
    if (input.operation.kind === 'CPU_WORK' && (!Number.isSafeInteger(input.operation.iterations) || input.operation.iterations < 0)) {
      throw new Error('Число итераций должно быть конечным неотрицательным целым');
    }
    if (this.count('RUNNING') >= this.limits.maxConcurrentHeavyJobs && this.count('QUEUED') >= this.limits.maxQueuedHeavyJobs) {
      throw new Error('Переполнена очередь тяжёлых заданий; интерактивные команды продолжают приниматься');
    }
    const job: HeavyJob = { ...input, status: 'QUEUED' };
    let resolve!: (result: HeavyJobResult) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<HeavyJobResult>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
    this.jobs.set(job.id, { job, promise, resolve, reject, status: 'QUEUED' });
    this.pump();
    return structuredClone(this.jobs.get(job.id)!.job);
  }

  async wait(id: string): Promise<HeavyJobResult> {
    const record = this.jobs.get(id);
    if (!record) throw new Error('Задание не найдено');
    return record.promise;
  }

  runInteractive<Result>(_commandId: string, operation: () => Result): Result {
    this.interactiveCommandsAccepted += 1;
    return operation();
  }

  status(id: string): JobRecord['status'] {
    const record = this.jobs.get(id);
    if (!record) throw new Error('Задание не найдено');
    return record.status;
  }

  snapshot(): { running: number; queued: number; interactiveCommandsAccepted: number; completed: number } {
    return {
      running: this.count('RUNNING'), queued: this.count('QUEUED'),
      interactiveCommandsAccepted: this.interactiveCommandsAccepted, completed: this.count('SUCCEEDED'),
    };
  }

  capabilities(): { cpuControl: 'BLOCKED'; cpuUnitsAdmissionOnly: true; nf04Confirmed: false; reason: string } {
    return {
      cpuControl: 'BLOCKED', cpuUnitsAdmissionOnly: true, nf04Confirmed: false,
      reason: 'Поддерживаемый CPU-троттлинг не настроен; измеряется только process.cpuUsage, NF-04 и AC-14 не подтверждаются.',
    };
  }

  async close(): Promise<void> {
    const pending: Promise<unknown>[] = [];
    for (const record of this.jobs.values()) {
      if (record.status === 'RUNNING' && record.child) {
        record.child.kill();
        pending.push(record.promise.catch(() => {}));
      } else if (record.status === 'QUEUED') {
        record.status = 'FAILED';
        record.reject(new Error('Планировщик остановлен'));
        pending.push(record.promise.catch(() => {}));
      }
    }
    await Promise.all(pending);
  }

  private pump(): void {
    while (this.count('RUNNING') < this.limits.maxConcurrentHeavyJobs) {
      const next = [...this.jobs.values()].find(record => record.status === 'QUEUED');
      if (!next) return;
      next.status = 'RUNNING';
      next.job = { ...next.job, status: 'RUNNING' };
      this.start(next);
    }
  }

  private start(record: JobRecord): void {
    this.observer.event(`started:${record.job.id}`);
    const worker = new URL('./heavy-job-worker.mjs', import.meta.url).pathname;
    const child = fork(worker, [JSON.stringify(record.job)], {
      execArgv: [`--max-old-space-size=${record.job.memoryMb}`], silent: true,
    });
    record.child = child;
    child.once('message', message => {
      const payload = message as { result?: HeavyJobResult['result'] };
      if (payload.result) record.payload = payload.result;
    });
    child.once('error', error => this.finish(record, error));
    child.once('exit', code => {
      if (code === 0 && record.payload) this.finish(record);
      else this.finish(record, new Error(`Тяжёлое задание завершилось с кодом ${code ?? 'unknown'}`));
    });
  }

  private finish(record: JobRecord, error?: Error): void {
    if (record.status === 'SUCCEEDED' || record.status === 'FAILED') return;
    record.child = undefined;
    if (error || !record.payload) {
      record.status = 'FAILED';
      this.observer.event(`failed:${record.job.id}`);
      record.reject(error ?? new Error('Тяжёлое задание не вернуло результат'));
    } else {
      record.status = 'SUCCEEDED';
      this.observer.event(`completed:${record.job.id}`);
      record.resolve({ status: 'SUCCEEDED', result: record.payload });
    }
    this.pump();
  }

  private count(status: JobRecord['status']): number {
    return [...this.jobs.values()].filter(record => record.status === status).length;
  }
}
