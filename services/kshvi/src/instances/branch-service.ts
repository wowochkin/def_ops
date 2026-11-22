import { createHash } from 'node:crypto';
import { canonicalJson } from '../../../../packages/kshvi/src/events/canonical';
import { createBranch, publishBranch, type Branch, type CreateBranchInput } from '../../../../packages/kshvi/src/replay/branch';
import { compareBranches, type BranchDiff } from '../../../../packages/kshvi/src/replay/branch-diff';
import { snapshotStateHash } from '../../../../packages/kshvi/src/replay/snapshot-restore';
import type { ReplayState } from '../../../../packages/kshvi/src/replay/replay-engine';
import type { DecisionInput } from '../../../../packages/kshvi/src/decisions/decision';
import type { CommandService, InstanceCommand } from './command-service';
import type { ConductActor, ConductState } from '../../../../packages/kshvi/src/commands/conduct';

function replayState(state: ConductState, history: readonly { eventId: string; type: string; payload: unknown }[]): ReplayState {
  return {
    domains: {
      Decisions: structuredClone(state.decisions), Resources: structuredClone(state.world.resources),
      Tasks: structuredClone(state.world.state.Tasks), Documents: structuredClone(state.documentRevisions),
      EventFeed: { status: 'KNOWN', items: history.map(event => ({ eventId: event.eventId, type: event.type, payload: structuredClone(event.payload) })) },
    },
    appliedEventIds: history.map(event => event.eventId), eventCauses: {},
  };
}
function assertDefined(value: unknown, path = ''): void {
  if (value === undefined) throw new Error(`Канонический JSON не поддерживает undefined: ${path || '<root>'}`);
  if (Array.isArray(value)) { value.forEach((item, index) => assertDefined(item, `${path}[${index}]`)); return; }
  if (value && typeof value === 'object') for (const [key, child] of Object.entries(value as Record<string, unknown>)) assertDefined(child, path ? `${path}.${key}` : key);
}
function hash(value: unknown): string {
  assertDefined(value);
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export class BranchDomainService {
  private readonly branches = new Map<string, Branch>();
  constructor(private readonly commands: CommandService) {}

  private key(instanceId: string, branchId: string): string { return `${instanceId}/${branchId}`; }

  private async build(instanceId: string, branchId: string, organizationId: string, kind: Branch['kind'] = 'OFFICIAL'): Promise<Branch> {
    const state = this.commands.state(instanceId, branchId);
    const history = await this.commands.history(instanceId, branchId);
    const replay = replayState(state, history);
    assertDefined(replay, 'state');
    const time = state.world.state.Time as { operationalAt?: string | null; wallClockAt?: string | null };
    const weather = state.world.state.Weather as { snapshot?: { id: string; manifestSha256: string } };
    const modelId = 'aggregate-v1';
    return {
      branchId, organizationId, parentBranchId: kind === 'OFFICIAL' ? null : 'main', kind,
      snapshot: {
        snapshotId: `${instanceId}-${branchId}-${state.revision}`, branchId, sequence: state.revision,
        operationalAt: time.operationalAt ?? '2030-01-01T00:00:00Z', wallClockAt: time.wallClockAt ?? '2030-01-01T00:00:00Z',
        reducerVersion: 1, state: replay, stateHash: snapshotStateHash(replay),
      },
      state: replay,
      events: history.map((event, index) => ({
        eventId: event.eventId, branchId, sequence: index + 1, type: event.type,
        operationalAt: time.operationalAt ?? '2030-01-01T00:00:00Z', wallClockAt: time.wallClockAt ?? '2030-01-01T00:00:00Z',
        payload: event.payload as Record<string, unknown>, reducerVersion: 1,
        changes: [{ domain: 'EventFeed', value: { status: 'KNOWN', items: history.slice(0, index + 1).map(item => ({ eventId: item.eventId, type: item.type, payload: item.payload })) } }],
      })),
      documents: Object.values(state.documentRevisions).flatMap(revisions => Object.values(revisions)),
      assessment: structuredClone(state.completion),
      versions: {
        model: { id: modelId, revision: 1, sha256: hash({ id: modelId }) },
        environment: weather.snapshot
          ? { id: weather.snapshot.id, revision: 1, sha256: weather.snapshot.manifestSha256 }
          : { id: 'UNKNOWN', revision: 0, sha256: hash({ status: 'UNKNOWN', reason: 'Среда не привязана' }) },
        reducerVersion: 1,
      },
      seed: hash({ scenarioId: state.scenarioId, branchId }), rights: [], assumptions: [],
      hash: hash({ branchId, state: replay, events: history, versions: { reducerVersion: 1 } }),
    };
  }

  private async current(instanceId: string, branchId: string, organizationId: string, kind: Branch['kind'] = 'OFFICIAL'): Promise<Branch> {
    const key = this.key(instanceId, branchId);
    const existing = this.branches.get(key);
    const built = await this.build(instanceId, branchId, organizationId, kind);
    if (!existing) {
      this.branches.set(key, built);
      return built;
    }
    const current = {
      ...built, parentBranchId: existing.parentBranchId, kind: existing.kind,
      versions: existing.versions, seed: existing.seed, assumptions: existing.assumptions, rights: existing.rights,
      hash: hash({ branchId, state: built.state, events: built.events, versions: existing.versions }),
    };
    this.branches.set(key, current);
    return current;
  }

  async create(instanceId: string, actor: ConductActor, input: CreateBranchInput & { sourceBranchId: string }): Promise<Branch> {
    const official = await this.current(instanceId, input.sourceBranchId, actor.organizationId);
    const branch = createBranch(official, input);
    this.branches.set(this.key(instanceId, branch.branchId), branch);
    return structuredClone(branch);
  }

  async execute(instanceId: string, branchId: string, input: InstanceCommand) {
    if (!this.branches.has(this.key(instanceId, branchId))) throw new Error('Альтернативная ветвь не найдена');
    const result = await this.commands.execute(input);
    await this.current(instanceId, branchId, input.actor.organizationId, 'ALTERNATIVE');
    return result;
  }

  async compare(instanceId: string, sourceBranchId: string, alternativeBranchId: string, organizationId: string): Promise<BranchDiff> {
    const official = await this.current(instanceId, sourceBranchId, organizationId);
    const alternative = await this.current(instanceId, alternativeBranchId, organizationId, 'ALTERNATIVE');
    return compareBranches(official, alternative);
  }

  publish(): never {
    return publishBranch(undefined as never);
  }

  async adopt(instanceId: string, alternativeBranchId: string, input: { sourceEventId: string; rationale: string; decision: DecisionInput; expectedRevision: number }, actor: ConductActor) {
    const alternative = await this.current(instanceId, alternativeBranchId, actor.organizationId, 'ALTERNATIVE');
    const source = alternative.events.find(event => event.eventId === input.sourceEventId);
    if (!source) throw new Error('Исходное событие альтернативы не найдено');
    const result = await this.commands.execute({
      instanceId, branchId: 'main', expectedRevision: input.expectedRevision, idempotencyKey: `adopt-${alternativeBranchId}-${input.sourceEventId}`,
      type: 'branch.adopt', at: new Date().toISOString(), actor,
      payload: { sourceBranchId: alternativeBranchId, sourceEventId: input.sourceEventId, rationale: input.rationale, decision: input.decision },
    });
    await this.current(instanceId, 'main', actor.organizationId);
    return result;
  }
}
