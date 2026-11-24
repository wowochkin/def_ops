import { sealScenario, startInstance, type SealScenarioInput, type SealedScenario, type StartInstanceCommand, type ExerciseInstance } from '@def-ops/kshvi';
import type { ParticipantContext } from '../auth/authorize';

export type StoredSealedScenario = SealedScenario & Readonly<{ organizationId?: string }>;
export interface SealingStore {
  saveSealed(value: StoredSealedScenario): Promise<void>;
  loadSealed(id: string): Promise<StoredSealedScenario | null>;
  findInstance(key: string): Promise<ExerciseInstance | null>;
  saveInstance(key: string, value: ExerciseInstance): Promise<void>;
}

export class InMemorySealingStore implements SealingStore {
  private readonly sealed = new Map<string, StoredSealedScenario>();
  private readonly instances = new Map<string, ExerciseInstance>();

  async saveSealed(value: StoredSealedScenario): Promise<void> { this.sealed.set(value.id, structuredClone(value)); }
  async loadSealed(id: string): Promise<StoredSealedScenario | null> { return this.sealed.get(id) ?? null; }
  async findInstance(key: string): Promise<ExerciseInstance | null> { return this.instances.get(key) ?? null; }
  async saveInstance(key: string, value: ExerciseInstance): Promise<void> { this.instances.set(key, structuredClone(value)); }
}

function assertDirector(actor: ParticipantContext, authority: string): void {
  if (!actor.organizationId || actor.activeRole !== 'DIRECTOR' || !actor.authorities.includes(authority)) {
    throw new Error('Недостаточно полномочий для серверного перехода сценария');
  }
}

export class SealingService {
  private readonly store: SealingStore;

  constructor(options: { store?: SealingStore } = {}) {
    this.store = options.store ?? new InMemorySealingStore();
  }

  async seal(input: SealScenarioInput, actor: ParticipantContext): Promise<SealedScenario> {
    assertDirector(actor, 'scenario.seal');
    const sealed = sealScenario(input);
    await this.store.saveSealed({ ...sealed, organizationId: actor.organizationId });
    return sealed;
  }

  async start(scenarioId: string, command: StartInstanceCommand, actor: ParticipantContext): Promise<ExerciseInstance> {
    assertDirector(actor, 'instance.start');
    const sealed = await this.store.loadSealed(scenarioId);
    if (!sealed) throw new Error('SEALED_SCENARIO_NOT_FOUND');
    if (sealed.organizationId && sealed.organizationId !== actor.organizationId) throw new Error('Недостаточно полномочий для этого сценария');
    if (!command.instanceId.trim() || !command.idempotencyKey.trim() || !command.seed.trim()) throw new Error('START_COMMAND_INVALID');
    const key = `${sealed.scenarioSha256}:${command.idempotencyKey}`;
    const existing = await this.store.findInstance(key);
    if (existing) {
      if (existing.id !== command.instanceId || existing.seed !== command.seed || existing.scenarioSha256 !== sealed.scenarioSha256) throw new Error('IDEMPOTENCY_CONFLICT');
      return existing;
    }
    let created: ExerciseInstance | undefined;
    startInstance(sealed, {
      instanceId: command.instanceId,
      idempotencyKey: command.idempotencyKey,
      seed: command.seed,
      actorRole: 'DIRECTOR',
      serverCommand: true,
    }, {
      count: 0,
      get: () => undefined,
      put: (_key, value) => { created = value; },
    });
    if (!created) throw new Error('START_COMMAND_INVALID');
    await this.store.saveInstance(key, created);
    return created;
  }
}
