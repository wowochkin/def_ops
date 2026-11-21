import type { AgentCommand, AgentCommandResponse } from '../../../../packages/kshvi-agents/src/intermediary/act';

export type PendingAgentCommand = Readonly<{
  cycleId: string;
  command: AgentCommand;
}>;

export type AgentRecoveryJournal = Readonly<{
  pendingCommands(): Promise<readonly PendingAgentCommand[]>;
  completeCommand(commandId: string, response: AgentCommandResponse): Promise<void>;
}>;

export type AgentRecoveryResult = Readonly<{
  recovered: number;
  remaining: number;
  responses: readonly AgentCommandResponse[];
}>;

export async function recoverAgentCommands(
  journal: AgentRecoveryJournal,
  submit: (command: AgentCommand) => Promise<AgentCommandResponse>,
): Promise<AgentRecoveryResult> {
  const pending = await journal.pendingCommands();
  const responses: AgentCommandResponse[] = [];
  let recovered = 0;
  let remaining = 0;
  for (const record of pending) {
    try {
      const response = await submit(record.command);
      responses.push(response);
      if (response.status === 'PENDING' || response.reason === 'COMMAND_UNAVAILABLE') {
        remaining += 1;
        continue;
      }
      await journal.completeCommand(record.command.commandId, response);
      recovered += 1;
    } catch {
      remaining += 1;
    }
  }
  return { recovered, remaining, responses };
}
