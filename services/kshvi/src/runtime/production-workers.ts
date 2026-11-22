import { runAutonomyWorker, type RunAutonomyWorkerInput } from './autonomy-worker';
import type { IntermediaryWorker } from '../agents/intermediary-worker';
import type { AgentProcess } from '../agents/agent-process';
import type { AgentEvaluationRequest } from '../../../../packages/kshvi-agents/src/ports/agent-engine';

export type ProductionAutonomyInput = RunAutonomyWorkerInput & Readonly<{ everyMs: number }>;
export type ProductionOpponentInput = Readonly<{
  process: AgentProcess;
  request: AgentEvaluationRequest;
  everyMs: number;
  close?: () => Promise<void>;
}>;
export type ProductionWorkerOptions = Readonly<{
  autonomy?: readonly ProductionAutonomyInput[];
  intermediaries?: readonly Pick<IntermediaryWorker, 'start' | 'stop'>[];
  opponents?: readonly ProductionOpponentInput[];
  onError?: (workerId: string, error: unknown) => void;
}>;

export class ProductionWorkerSupervisor {
  private readonly timers = new Set<ReturnType<typeof setInterval>>();
  private readonly active = new Set<Promise<void>>();
  private readonly failures: Array<{ workerId: string; error: unknown }> = [];
  private started = false;

  constructor(private readonly options: ProductionWorkerOptions) {}

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    for (const intermediary of this.options.intermediaries ?? []) await intermediary.start();
    for (const input of this.options.autonomy ?? []) {
      this.schedule(`${input.instanceId}/${input.branchId}:autonomy`, input.everyMs, () => runAutonomyWorker(input).then(() => undefined));
    }
    for (const input of this.options.opponents ?? []) {
      this.schedule(`${input.request.projection.instanceId}/${input.request.projection.agentId}:opponent`, input.everyMs, () => input.process.runOpponentCycle(input.request).then(() => undefined));
    }
  }

  async stop(): Promise<void> {
    for (const timer of this.timers) clearInterval(timer);
    this.timers.clear();
    for (const intermediary of this.options.intermediaries ?? []) intermediary.stop();
    for (const opponent of this.options.opponents ?? []) await opponent.close?.();
    await Promise.allSettled([...this.active]);
    this.started = false;
  }

  errors(): readonly Readonly<{ workerId: string; error: unknown }>[] {
    return [...this.failures];
  }

  private schedule(workerId: string, everyMs: number, operation: () => Promise<void>): void {
    if (!Number.isFinite(everyMs) || everyMs < 1) throw new Error(`Некорректный период worker ${workerId}`);
    let running = false;
    const run = () => {
      if (running || !this.started) return;
      running = true;
      const promise = operation().catch(error => {
        this.failures.push({ workerId, error });
        this.options.onError?.(workerId, error);
      }).finally(() => {
        running = false;
        this.active.delete(promise);
      });
      this.active.add(promise);
    };
    run();
    this.timers.add(setInterval(run, everyMs));
  }
}
