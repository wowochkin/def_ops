import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AutonomyWorkerJournal, AutonomyWorkerJournalState } from './autonomy-worker';
import type { AgentWorkJournal } from '../agents/intermediary-worker';
import type { IntermediaryCycle } from '../../../../packages/kshvi-agents/src/intermediary/cycle';
import type { AgentCommandResponse } from '../../../../packages/kshvi-agents/src/intermediary/act';
import type { PendingAgentCommand } from '../agents/agent-recovery';

type JournalState = {
  autonomy: Record<string, AutonomyWorkerJournalState>;
  cycles: Record<string, IntermediaryCycle>;
  pending: Record<string, PendingAgentCommand>;
};
const empty = (): JournalState => ({ autonomy: {}, cycles: {}, pending: {} });
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export class FileWorkerJournal implements AutonomyWorkerJournal, AgentWorkJournal {
  private readonly file: string;
  private state?: JournalState;
  private writes: Promise<void> = Promise.resolve();

  constructor(directory: string) {
    this.file = join(directory, 'worker-journal.json');
  }

  async load(instanceId: string, branchId: string): Promise<AutonomyWorkerJournalState> {
    await this.writes;
    const state = await this.read();
    return clone(state.autonomy[`${instanceId}/${branchId}`] ?? { version: 1, intervals: {}, processedIntervalKeys: [] });
  }

  async save(value: AutonomyWorkerJournalState, instanceId: string, branchId: string): Promise<void> {
    await this.mutate(state => { state.autonomy[`${instanceId}/${branchId}`] = clone(value); });
  }

  async isCycleProcessed(cycleId: string): Promise<boolean> {
    await this.writes;
    return Boolean((await this.read()).cycles[cycleId]);
  }

  async enqueueCommand(record: PendingAgentCommand): Promise<void> {
    await this.mutate(state => {
      if (!state.pending[record.command.commandId]) state.pending[record.command.commandId] = clone(record);
    });
  }

  async completeCommand(commandId: string, _response: AgentCommandResponse): Promise<void> {
    await this.mutate(state => { delete state.pending[commandId]; });
  }

  async pendingCommands(): Promise<readonly PendingAgentCommand[]> {
    await this.writes;
    return Object.values((await this.read()).pending).map(clone);
  }

  async saveCycle(cycle: IntermediaryCycle): Promise<void> {
    await this.mutate(state => { state.cycles[cycle.cycleId] = clone(cycle); });
  }

  private async read(): Promise<JournalState> {
    if (this.state) return this.state;
    try {
      this.state = JSON.parse(await readFile(this.file, 'utf8')) as JournalState;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      this.state = empty();
    }
    return this.state;
  }

  private async mutate(operation: (state: JournalState) => void): Promise<void> {
    this.writes = this.writes.then(async () => {
      const state = await this.read();
      operation(state);
      await mkdir(join(this.file, '..'), { recursive: true });
      const temporary = `${this.file}.${process.pid}.tmp`;
      await writeFile(temporary, JSON.stringify(state), { mode: 0o600 });
      await rename(temporary, this.file);
    });
    return this.writes;
  }
}
