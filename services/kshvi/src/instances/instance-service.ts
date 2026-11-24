import type { ExerciseInstance } from '@def-ops/kshvi';
import type { ParticipantContext } from '../auth/authorize';
import type { SealingService } from './sealing-service';

export type StartInstanceInput = {
  sealedScenarioId: string;
  instanceId: string;
  idempotencyKey: string;
  seed: string;
};
export type InstanceRecord = { id: string; branchId: string; scenarioRevisionId: string; state: 'ACTIVE' };
export type SealedInstanceStarter = Pick<SealingService, 'start'>;

export class InstanceService {
  private readonly sealing?: SealedInstanceStarter;

  constructor(options: { sealing?: SealedInstanceStarter } = {}) {
    this.sealing = options.sealing;
  }

  async startInstance(input: StartInstanceInput, actor: ParticipantContext): Promise<InstanceRecord> {
    if (!this.sealing) throw new Error('SEALED_SCENARIO_NOT_FOUND');
    const instance: ExerciseInstance = await this.sealing.start(input.sealedScenarioId, {
      instanceId: input.instanceId,
      idempotencyKey: input.idempotencyKey,
      seed: input.seed,
      actorRole: 'DIRECTOR',
      serverCommand: true,
    }, actor);
    return {
      id: instance.id,
      branchId: `branch-${instance.id}`,
      scenarioRevisionId: instance.scenarioSha256,
      state: 'ACTIVE',
    };
  }
}
