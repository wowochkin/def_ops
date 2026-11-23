import type { AutonomyCommandQueue, AutonomyQueueCommand, AutonomyQueueReceipt } from './autonomy-worker';
import type { DomainOperationType, TypedInstanceCommandPort } from '../instances/typed-command-port';

const OPERATION_TYPES: Readonly<Record<AutonomyQueueCommand['kind'], DomainOperationType>> = {
  applyWorldEffects: 'autonomy.worldEffects.apply.v1',
  createObservation: 'observation.create.v1',
  createDocumentRevision: 'document.revision.create.v1',
  createInput: 'input.create.v1',
  createApprovalRequest: 'approval.request.create.v1',
};

export class AutonomyCommandQueueAdapter implements AutonomyCommandQueue {
  constructor(private readonly options: {
    organizationId: string;
    actorUserId: string;
    commands: TypedInstanceCommandPort;
    revision(instanceId: string, branchId: string): Promise<number>;
  }) {}

  async enqueue(command: AutonomyQueueCommand): Promise<AutonomyQueueReceipt> {
    const type = OPERATION_TYPES[command.kind];
    if (!type) throw new Error(`Неизвестная операция autonomy ${String(command.kind)}`);
    const result = await this.options.commands.execute({
      instanceId: command.instanceId,
      branchId: command.branchId,
      expectedRevision: await this.options.revision(command.instanceId, command.branchId),
      idempotencyKey: command.idempotencyKey,
      type,
      at: command.operationalAt,
      actor: { userId: this.options.actorUserId, role: 'SYSTEM', organizationId: this.options.organizationId },
      payload: {
        ...command.payload,
        operationalSecond: command.operationalSecond,
        priority: command.priority,
        sequence: command.sequence,
      },
    });
    return { idempotent: result.idempotent };
  }
}
