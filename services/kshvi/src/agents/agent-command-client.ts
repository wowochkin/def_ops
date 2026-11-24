import type { AgentCommand, AgentCommandResponse } from '../../../../packages/kshvi-agents/src/intermediary/act';

export type AgentCommandTransport = (command: AgentCommand) => Promise<AgentCommandResponse>;

export class AgentCommandTransportError extends Error {
  readonly status?: number;
  readonly code?: string;
  readonly retryable: boolean;

  constructor(message: string, options: { status?: number; code?: string; retryable: boolean }) {
    super(message);
    this.name = 'AgentCommandTransportError';
    this.status = options.status;
    this.code = options.code;
    this.retryable = options.retryable;
  }
}

export class AgentCommandClient {
  private readonly transport: AgentCommandTransport;
  private readonly maxAttempts: number;
  private readonly retryDelayMs: number;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(options: {
    transport: AgentCommandTransport;
    maxAttempts?: number;
    retryDelayMs?: number;
    sleep?: (milliseconds: number) => Promise<void>;
  }) {
    if ((options.maxAttempts ?? 3) < 1) throw new Error('Нужна хотя бы одна попытка команды');
    this.transport = options.transport;
    this.maxAttempts = options.maxAttempts ?? 3;
    this.retryDelayMs = options.retryDelayMs ?? 25;
    this.sleep = options.sleep ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
  }

  async submit(command: AgentCommand): Promise<AgentCommandResponse> {
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        const response = await this.transport(command);
        if (response.commandId !== command.commandId) {
          throw new AgentCommandTransportError('Ответ относится к другой команде', { code: 'COMMAND_RESPONSE_MISMATCH', retryable: false });
        }
        return response;
      } catch (error) {
        const retryable = error instanceof AgentCommandTransportError ? error.retryable : true;
        if (!retryable) {
          return {
            commandId: command.commandId,
            accepted: false,
            idempotent: false,
            effectApplied: false,
            status: 'REJECTED',
            reason: error instanceof AgentCommandTransportError ? error.code ?? 'COMMAND_REJECTED' : 'COMMAND_REJECTED',
          };
        }
        if (attempt === this.maxAttempts) throw error;
        await this.sleep(this.retryDelayMs * attempt);
      }
    }
    throw new Error('Недостижимое состояние повтора команды');
  }
}

export function createFetchAgentCommandTransport(options: {
  baseUrl: string;
  accessToken: string;
  fetchImpl?: typeof fetch;
}): AgentCommandTransport {
  const fetchImpl = options.fetchImpl ?? fetch;
  return async command => {
    const response = await fetchImpl(`${options.baseUrl.replace(/\/$/, '')}/agents/commands`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${options.accessToken}`,
        'idempotency-key': command.idempotencyKey,
        'x-agent-assignment': command.assignmentId,
      },
      body: JSON.stringify(command),
    });
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
      throw new AgentCommandTransportError(`Сервер команды ответил ${response.status}`, {
        status: response.status,
        code: typeof body.code === 'string' ? body.code : typeof body.error === 'string' ? body.error : undefined,
        retryable: response.status === 408 || response.status === 429 || response.status >= 500,
      });
    }
    return body as unknown as AgentCommandResponse;
  };
}
