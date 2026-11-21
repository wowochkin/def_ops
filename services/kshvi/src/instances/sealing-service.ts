import { createInstanceRegistry, sealScenario, startInstance, type SealScenarioInput, type SealedScenario, type StartInstanceCommand, type ExerciseInstance } from '@def-ops/kshvi';

export class SealingService {
  private readonly sealed = new Map<string, SealedScenario>();
  private readonly registry = createInstanceRegistry();

  async seal(input: SealScenarioInput): Promise<SealedScenario> {
    const sealed = sealScenario(input);
    this.sealed.set(sealed.id, sealed);
    return sealed;
  }

  async start(scenarioId: string, command: StartInstanceCommand): Promise<ExerciseInstance> {
    const sealed = this.sealed.get(scenarioId);
    if (!sealed) throw new Error('SEALED_SCENARIO_NOT_FOUND');
    return startInstance(sealed, command, this.registry);
  }
}
