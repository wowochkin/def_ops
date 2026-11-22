import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { HttpError, type Ctx } from '@def-ops/service-kit';
import type { ElectronicIntermediaryAssignment } from '../../../../packages/kshvi-agents/src/model/assignment';
import type { AgentCommand } from '../../../../packages/kshvi-agents/src/intermediary/act';
import type { AgentEvaluationRequest, ModernOrder } from '../../../../packages/kshvi-agents/src/ports/agent-engine';
import { ProductionWorkerSupervisor, type ProductionAutonomyInput, type ProductionOpponentInput } from './production-workers';
import { AutonomyCommandQueueAdapter } from './autonomy-command-queue';
import { FileWorkerJournal } from './file-worker-journal';
import { IntermediaryWorker } from '../agents/intermediary-worker';
import { AgentCommandClient, createFetchAgentCommandTransport } from '../agents/agent-command-client';
import { AgentProcess, type DeliveredOrder, type OfficialAgentCommand } from '../agents/agent-process';
import { RustWorker } from '../agents/rust-worker';
import type { AgentDelegation } from '../http/agent-routes';
import type { SessionManager } from '../auth/sessions';
import { assertDomainOperationType, type TypedInstanceCommandPort } from '../instances/typed-command-port';

type AutonomyConfig = Omit<ProductionAutonomyInput, 'queue' | 'journal'> & { organizationId: string };
type IntermediaryConfig = {
  assignment: ElectronicIntermediaryAssignment;
  projectionUrl: string;
  commandBaseUrl?: string;
  accessToken: string;
};
type OpponentConfig = {
  request: Omit<AgentEvaluationRequest, 'seed'> & { seed: string };
  organizationId: string;
  actorUserId: string;
  branchId: string;
  communicationUrl: string;
  accessToken: string;
  everyMs: number;
};
type DelegationConfig = {
  assignmentId: string;
  userId: string;
  organizationId: string;
  branchId: string;
  allowedActions: readonly string[];
};
type RuntimeConfig = {
  autonomy?: readonly AutonomyConfig[];
  intermediaries?: readonly IntermediaryConfig[];
  opponents?: readonly OpponentConfig[];
  delegations?: readonly DelegationConfig[];
};

function expandSecrets(value: unknown): unknown {
  if (typeof value === 'string') {
    const match = /^\$\{([A-Z][A-Z0-9_]*)\}$/.exec(value);
    return match ? process.env[match[1]] ?? '' : value;
  }
  if (Array.isArray(value)) return value.map(expandSecrets);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, expandSecrets(item)]));
  return value;
}

function bearer(ctx: Ctx): string {
  const header = ctx.req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw new HttpError(401, 'unauthorized', '401: Требуется вход в систему');
  return header.slice(7);
}

export class ConfiguredProductionRuntime {
  readonly workers: ProductionWorkerSupervisor;

  constructor(private readonly options: {
    config: RuntimeConfig;
    directory: string;
    sessions: SessionManager;
    commands: TypedInstanceCommandPort;
    revision(instanceId: string, branchId: string): Promise<number>;
    commandBaseUrl: string;
  }) {
    const journal = new FileWorkerJournal(options.directory);
    const autonomy = (options.config.autonomy ?? []).map(input => {
      const { organizationId, ...workerInput } = input;
      return {
        ...workerInput,
        queue: new AutonomyCommandQueueAdapter({
          organizationId,
          actorUserId: 'autonomy-worker',
          commands: options.commands,
          revision: options.revision,
        }),
        journal,
      };
    });
    const intermediaries = (options.config.intermediaries ?? []).map(input => new IntermediaryWorker({
      assignments: [input.assignment],
      projectionSource: {
        loadProjection: async query => {
          const response = await fetch(input.projectionUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${input.accessToken}` },
            body: JSON.stringify(query),
          });
          if (!response.ok) throw new Error(`Проекция агента недоступна: ${response.status}`);
          return response.json();
        },
      },
      commandClient: new AgentCommandClient({
        transport: createFetchAgentCommandTransport({
          baseUrl: input.commandBaseUrl ?? options.commandBaseUrl,
          accessToken: input.accessToken,
        }),
      }),
      journal,
    }));
    const opponents: ProductionOpponentInput[] = (options.config.opponents ?? []).map(input => {
      const engine = new RustWorker();
      const request: AgentEvaluationRequest = { ...input.request, seed: BigInt(input.request.seed.replace(/n$/, '')) };
      return {
        everyMs: input.everyMs,
        request,
        process: new AgentProcess({
          engine,
          official: {
            submit: async (command: OfficialAgentCommand) => {
              assertDomainOperationType(command.type);
              const result = await options.commands.execute({
                instanceId: command.instanceId,
                branchId: input.branchId,
                expectedRevision: await options.revision(command.instanceId, input.branchId),
                idempotencyKey: command.idempotencyKey,
                type: command.type,
                actor: { userId: input.actorUserId, role: 'SYSTEM', organizationId: input.organizationId },
                payload: {
                  choiceId: command.choiceId,
                  profileVersion: command.profileVersion,
                  orderIds: command.orderIds,
                  expectedProjectionRevision: command.expectedRevision,
                },
              });
              return { accepted: true, commandId: result.eventId };
            },
          },
          communication: {
            deliver: async (order: ModernOrder): Promise<DeliveredOrder> => {
              const response = await fetch(input.communicationUrl, {
                method: 'POST',
                headers: { 'content-type': 'application/json', authorization: `Bearer ${input.accessToken}` },
                body: JSON.stringify(order),
              });
              if (!response.ok) throw new Error(`Канал связи отклонил приказ: ${response.status}`);
              const delivered = await response.json() as DeliveredOrder;
              if (delivered.status !== 'DELIVERED' && delivered.status !== 'SCHEDULED') throw new Error('Канал связи вернул неизвестный статус');
              return delivered;
            },
          },
        }),
        close: () => engine.close(),
      };
    });
    this.workers = new ProductionWorkerSupervisor({ autonomy, intermediaries, opponents });
  }

  async start(): Promise<void> { await this.workers.start(); }
  async stop(): Promise<void> { await this.workers.stop(); }

  resolveDelegation = async (ctx: Ctx, command: AgentCommand): Promise<AgentDelegation> => {
    const config = this.options.config.delegations?.find(item => item.assignmentId === command.assignmentId);
    if (!config || command.actor.kind !== 'system' || command.actor.assignmentId !== config.assignmentId) {
      throw new HttpError(403, 'OUTSIDE_DELEGATION', 'Действие вне серверной делегации агента');
    }
    const participant = await this.options.sessions.authenticate(bearer(ctx), config.organizationId);
    if (participant.userId !== config.userId || !participant.activeRole) throw new HttpError(403, 'OUTSIDE_DELEGATION', 'Действие вне серверной делегации агента');
    return {
      actor: { userId: participant.userId, role: participant.activeRole, organizationId: participant.organizationId },
      branchId: config.branchId,
      expectedRevision: await this.options.revision(command.instanceId, config.branchId),
      allowedActions: config.allowedActions,
    };
  };
}

export async function loadConfiguredProductionRuntime(options: {
  configPath?: string;
  sessions: SessionManager;
  commands: TypedInstanceCommandPort;
  revision(instanceId: string, branchId: string): Promise<number>;
  commandBaseUrl: string;
}): Promise<ConfiguredProductionRuntime> {
  const configPath = options.configPath ? resolve(options.configPath) : '';
  const config = configPath
    ? expandSecrets(JSON.parse(await readFile(configPath, 'utf8'))) as RuntimeConfig
    : {};
  return new ConfiguredProductionRuntime({
    config,
    directory: dirname(configPath || resolve('.tmp/kshvi-production-workers.json')),
    sessions: options.sessions,
    commands: options.commands,
    revision: options.revision,
    commandBaseUrl: options.commandBaseUrl,
  });
}
