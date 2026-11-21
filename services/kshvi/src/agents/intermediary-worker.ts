import type { AgentCommand, AgentCommandResponse } from '../../../../packages/kshvi-agents/src/intermediary/act';
import {
  runIntermediaryCycle,
  type AgentProjectionQuery,
  type AgentWake,
  type IntermediaryCycle,
} from '../../../../packages/kshvi-agents/src/intermediary/cycle';
import type { ElectronicIntermediaryAssignment } from '../../../../packages/kshvi-agents/src/model/assignment';
import { recoverAgentCommands, type AgentRecoveryJournal, type AgentRecoveryResult, type PendingAgentCommand } from './agent-recovery';

export type AgentWorkJournal = AgentRecoveryJournal & Readonly<{
  isCycleProcessed(cycleId: string): Promise<boolean>;
  enqueueCommand(record: PendingAgentCommand): Promise<void>;
  saveCycle(cycle: IntermediaryCycle): Promise<void>;
}>;

export type AgentProjectionSource = Readonly<{
  loadProjection(query: AgentProjectionQuery): Promise<unknown>;
}>;

export type AgentCommandSubmitter = Readonly<{
  submit(command: AgentCommand): Promise<AgentCommandResponse>;
}>;

export class IntermediaryWorker {
  private readonly assignments: Map<string, ElectronicIntermediaryAssignment>;
  private readonly projectionSource: AgentProjectionSource;
  private readonly commandClient: AgentCommandSubmitter;
  private readonly journal: AgentWorkJournal;
  private readonly timers = new Map<string, ReturnType<typeof setInterval>>();
  private readonly running = new Set<string>();

  constructor(options: {
    assignments: readonly ElectronicIntermediaryAssignment[];
    projectionSource: AgentProjectionSource;
    commandClient: AgentCommandSubmitter;
    journal: AgentWorkJournal;
  }) {
    this.assignments = new Map(options.assignments.map(assignment => [assignment.assignmentId, assignment]));
    this.projectionSource = options.projectionSource;
    this.commandClient = options.commandClient;
    this.journal = options.journal;
  }

  updateAssignment(assignment: ElectronicIntermediaryAssignment): void {
    const current = this.assignments.get(assignment.assignmentId);
    if (current && assignment.version < current.version) throw new Error('Нельзя вернуть устаревшую версию назначения');
    this.assignments.set(assignment.assignmentId, assignment);
  }

  async runAssignment(assignmentId: string, wake: AgentWake): Promise<IntermediaryCycle | undefined> {
    const assignment = this.assignments.get(assignmentId);
    if (!assignment || assignment.status !== 'ACTIVE' || this.running.has(assignmentId)) return undefined;
    const cycleId = `${assignmentId}:${wake.wakeId}`;
    if (await this.journal.isCycleProcessed(cycleId)) return undefined;
    this.running.add(assignmentId);
    try {
      const cycle = await runIntermediaryCycle({
        assignment,
        wake,
        server: {
          loadProjection: query => this.projectionSource.loadProjection(query),
          submit: async command => {
            await this.journal.enqueueCommand({ cycleId, command });
            const response = await this.commandClient.submit(command);
            if (response.status !== 'PENDING') await this.journal.completeCommand(command.commandId, response);
            return response;
          },
        },
      });
      await this.journal.saveCycle(cycle);
      this.assignments.set(assignmentId, cycle.assignment);
      return cycle;
    } finally {
      this.running.delete(assignmentId);
    }
  }

  async recover(): Promise<AgentRecoveryResult> {
    return recoverAgentCommands(this.journal, command => this.commandClient.submit(command));
  }

  async start(): Promise<void> {
    await this.recover();
    for (const assignment of this.assignments.values()) {
      if (this.timers.has(assignment.assignmentId)) continue;
      const run = () => {
        const at = new Date().toISOString();
        void this.runAssignment(assignment.assignmentId, { wakeId: `schedule:${at}`, kind: 'SCHEDULE', requestedAt: at }).catch(() => undefined);
      };
      run();
      this.timers.set(assignment.assignmentId, setInterval(run, assignment.schedule.everyMs));
    }
  }

  stop(): void {
    for (const timer of this.timers.values()) clearInterval(timer);
    this.timers.clear();
  }
}
