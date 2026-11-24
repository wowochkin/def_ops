import type { CommandResult, InstanceCommand } from './command-service';

export const DOMAIN_OPERATION_TYPES = [
  'autonomy.worldEffects.apply.v1',
  'observation.create.v1',
  'observation.record.v1',
  'document.revision.create.v1',
  'document.coordinate.v1',
  'document.issue.v1',
  'input.create.v1',
  'input.classify.v1',
  'approval.request.create.v1',
  'projection.workingMap.update.v1',
  'assessment.record.v1',
  'decision.accept.v1',
  'task.assign.v1',
  'report.create.v1',
  'calculation.request.v1',
  'order.execute.v1',
  'deadline.check.v1',
  'data.request.v1',
  'force.advance.v1',
  'force.defend.v1',
  'force.withdraw.v1',
  'logistics.support.requested.v1',
  'agent.escalation.requested.v1',
  'order.continue.v1',
] as const;
export type DomainOperationType = typeof DOMAIN_OPERATION_TYPES[number];
export type TypedInstanceCommand<T extends DomainOperationType = DomainOperationType> = Omit<InstanceCommand, 'type'> & Readonly<{
  type: T;
  payload: Readonly<Record<string, unknown>>;
}>;

/** Совместимый порт: CommandService принимает более широкий базовый ввод без создания второго сервиса. */
export interface TypedInstanceCommandPort {
  execute(input: TypedInstanceCommand): Promise<CommandResult>;
}

export class RevisionTrackingCommandPort implements TypedInstanceCommandPort {
  private readonly revisions = new Map<string, number>();

  constructor(private readonly delegate: TypedInstanceCommandPort) {}

  async execute(input: TypedInstanceCommand): Promise<CommandResult> {
    const result = await this.delegate.execute(input);
    this.revisions.set(`${input.instanceId}/${input.branchId}`, result.revision);
    return result;
  }

  async revision(instanceId: string, branchId: string): Promise<number> {
    return this.revisions.get(`${instanceId}/${branchId}`) ?? 0;
  }
}

export function assertDomainOperationType(value: string): asserts value is DomainOperationType {
  if (!(DOMAIN_OPERATION_TYPES as readonly string[]).includes(value)) throw new Error(`Неизвестная типизированная операция ${value}`);
}
