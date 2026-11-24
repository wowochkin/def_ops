import {
  evaluateChoices,
  type AgentEnginePort,
  type AgentEvaluation,
  type AgentEvaluationRequest,
  type ModernOrder,
} from '../../../../packages/kshvi-agents/src/ports/agent-engine';

export interface OfficialAgentCommand {
  type: string;
  instanceId: string;
  expectedRevision: number;
  idempotencyKey: string;
  choiceId: string;
  profileVersion: string;
  orderIds: readonly string[];
}

export interface OfficialCommandReceipt { accepted: boolean; commandId?: string; error?: string }
export interface OfficialCommandPort { submit(command: OfficialAgentCommand): Promise<OfficialCommandReceipt> }
export type DeliveredOrder = ModernOrder & { status: 'SCHEDULED' | 'DELIVERED' };
export interface CommunicationPort { deliver(order: ModernOrder): Promise<DeliveredOrder> }

export interface AgentProcessDependencies {
  engine: AgentEnginePort;
  official: OfficialCommandPort;
  communication: CommunicationPort;
}

export interface AgentCycleResult {
  status: 'DECIDED' | 'SAFE_ORDER' | 'ESCALATED' | 'REJECTED' | 'AWAITING_DELIVERY';
  evaluation: AgentEvaluation;
  unknown: readonly string[];
  command?: OfficialAgentCommand;
  receipt?: OfficialCommandReceipt;
  deliveries?: readonly DeliveredOrder[];
  error?: string;
}

export class AgentProcess {
  private readonly completed = new Map<string, AgentCycleResult>();

  constructor(private readonly dependencies: AgentProcessDependencies) {}

  async runOpponentCycle(request: AgentEvaluationRequest): Promise<AgentCycleResult> {
    const commandKey = `opponent:${request.projection.instanceId}:${request.projection.agentId}:${request.projection.tick}`;
    const cycleKey = `${commandKey}:${request.projection.revision}`;
    const previous = this.completed.get(cycleKey);
    if (previous) return previous;

    const evaluation = await evaluateChoices(this.dependencies.engine, request);
    const selected = evaluation.selected;
    if (selected.kind === 'CONTINUE_ORDER' || selected.kind === 'HOLD' || selected.commandType === null) {
      const result: AgentCycleResult = { status: 'SAFE_ORDER', evaluation, unknown: evaluation.unknown };
      this.completed.set(cycleKey, result);
      return result;
    }
    const command: OfficialAgentCommand = {
      type: selected.commandType,
      instanceId: request.projection.instanceId,
      expectedRevision: request.projection.revision,
      idempotencyKey: `${commandKey}:${selected.id}`,
      choiceId: selected.id,
      profileVersion: request.profile.version,
      orderIds: evaluation.orders.map(order => order.id),
    };

    if (selected.kind === 'ESCALATE') {
      const receipt = await this.dependencies.official.submit(command);
      const result: AgentCycleResult = receipt.accepted
        ? { status: 'ESCALATED', evaluation, unknown: evaluation.unknown, command, receipt }
        : { status: 'REJECTED', evaluation, unknown: evaluation.unknown, command, receipt, error: receipt.error ?? 'Сервер отклонил эскалацию' };
      this.completed.set(cycleKey, result);
      return result;
    }

    const deliveries: DeliveredOrder[] = [];
    for (const order of evaluation.orders) deliveries.push(await this.dependencies.communication.deliver(order));
    if (deliveries.length === 0 || deliveries.some(order => order.status !== 'DELIVERED')) {
      // Не кэшируем ожидание: следующий запуск сможет доотправить приказ с тем же ключом.
      return { status: 'AWAITING_DELIVERY', evaluation, unknown: evaluation.unknown, command, deliveries };
    }

    const receipt = await this.dependencies.official.submit(command);
    if (!receipt.accepted) {
      const result: AgentCycleResult = {
        status: 'REJECTED', evaluation, unknown: evaluation.unknown, command, receipt, deliveries,
        error: receipt.error ?? 'Сервер отклонил команду агента',
      };
      this.completed.set(cycleKey, result);
      return result;
    }
    const result: AgentCycleResult = { status: 'DECIDED', evaluation, unknown: evaluation.unknown, command, receipt, deliveries };
    this.completed.set(cycleKey, result);
    return result;
  }
}

export async function runOpponentCycle(
  dependencies: AgentProcessDependencies,
  request: AgentEvaluationRequest,
): Promise<AgentCycleResult> {
  return new AgentProcess(dependencies).runOpponentCycle(request);
}
