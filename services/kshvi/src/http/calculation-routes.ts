import { randomUUID } from 'node:crypto';
import { HttpError, Router, type Ctx } from '@def-ops/service-kit';
import { canonicalJson } from '../../../../packages/kshvi/src/events/canonical';
import { calculate, approveCalculation, applyCalculation, type Calculation, type CalculateOptions } from '../../../../packages/kshvi/src/simulation/calculation';
import { overrideCalculation } from '../../../../packages/kshvi/src/simulation/manual-override';

export type CalculationActor = Readonly<{
  userId: string;
  organizationId: string;
  authorities: readonly string[];
  sideId?: string;
  assignedNodeIds?: readonly string[];
}>;
type CalculationEntry = { organizationId: string; calculation: Calculation; history: Calculation[] };
type CreateCalculationInput = Omit<CalculateOptions, 'id' | 'stochastic'> & {
  stochastic?: Omit<NonNullable<CalculateOptions['stochastic']>, 'key'> & {
    key: Omit<NonNullable<CalculateOptions['stochastic']>['key'], 'seed'> & { seed: string };
  };
};
type CalculationRequest = CreateCalculationInput & { idempotencyKey: string; actor?: unknown; id?: unknown };
type CalculationProjection = Readonly<Omit<Calculation, 'inputSnapshot' | 'inputs' | 'randomKeys' | 'intermediateResults' | 'modelPassport' | 'stochasticOutcomes'>>;

function requireAuthority(actor: CalculationActor, authority: string): void {
  if (!actor.authorities.includes(authority)) throw new HttpError(403, 'forbidden', 'Действие недоступно');
}
function clone<T>(value: T): T { return structuredClone(value); }
function notFound(): never { throw new HttpError(404, 'not_found', 'Расчёт не найден'); }
function assertScope(actor: CalculationActor, calculation: Calculation): void {
  if (calculation.sideId !== null && calculation.sideId !== actor.sideId) notFound();
  if (calculation.nodeId !== null && !(actor.assignedNodeIds ?? []).includes(calculation.nodeId)) notFound();
}
function projectCalculation(calculation: Calculation): CalculationProjection {
  const {
    inputSnapshot: _snapshot, inputs: _inputs, randomKeys: _randomKeys, intermediateResults: _intermediate,
    modelPassport: _passport, stochasticOutcomes: _outcomes, ...projection
  } = calculation;
  return clone(projection);
}

export class CalculationJournal {
  private readonly entries = new Map<string, CalculationEntry>();
  private readonly idempotency = new Map<string, { request: string; calculation: Calculation }>();
  private readonly idFactory: () => string;

  constructor(options: { idFactory?: () => string } = {}) { this.idFactory = options.idFactory ?? randomUUID; }
  get size(): number { return this.entries.size; }

  get(id: string, organizationId: string): Calculation {
    const entry = this.entries.get(id);
    if (!entry || entry.organizationId !== organizationId) notFound();
    return clone(entry.calculation);
  }

  history(id: string, organizationId: string): Calculation[] {
    const entry = this.entries.get(id);
    if (!entry || entry.organizationId !== organizationId) notFound();
    return clone(entry.history);
  }

  getForActor(id: string, actor: CalculationActor): Calculation | CalculationProjection {
    const calculation = this.get(id, actor.organizationId);
    if (actor.authorities.includes('calculation:read:truth')) return calculation;
    requireAuthority(actor, 'calculation:read');
    assertScope(actor, calculation);
    if (calculation.sideId === null || calculation.nodeId === null) notFound();
    return projectCalculation(calculation);
  }

  historyForActor(id: string, actor: CalculationActor): readonly (Calculation | CalculationProjection)[] {
    const history = this.history(id, actor.organizationId);
    if (actor.authorities.includes('calculation:read:truth')) return history;
    requireAuthority(actor, 'calculation:read');
    return history.map(calculation => {
      assertScope(actor, calculation);
      if (calculation.sideId === null || calculation.nodeId === null) notFound();
      return projectCalculation(calculation);
    });
  }

  private put(id: string, organizationId: string, calculation: Calculation): Calculation {
    const existing = this.entries.get(id);
    if (existing && existing.organizationId !== organizationId) throw new HttpError(409, 'calculation_conflict', 'Идентификатор расчёта уже использован');
    const stored = clone(calculation);
    if (existing) {
      existing.calculation = stored;
      existing.history.push(stored);
    } else this.entries.set(id, { organizationId, calculation: stored, history: [stored] });
    return clone(stored);
  }

  private assertNewId(id: string): void {
    if (this.entries.has(id)) throw new HttpError(409, 'calculation_conflict', 'Идентификатор расчёта уже использован');
  }

  private scopedInput(input: CreateCalculationInput, actor: CalculationActor): CreateCalculationInput {
    const assigned = actor.assignedNodeIds ?? [];
    const nodeId = assigned.length === 1 ? assigned[0] : input.nodeId && assigned.includes(input.nodeId) ? input.nodeId : null;
    if (assigned.length > 1 && input.nodeId && !assigned.includes(input.nodeId)) throw new HttpError(403, 'forbidden', 'Инстанция расчёта не назначена участнику');
    const scoped = { ...input };
    if (actor.sideId) scoped.sideId = actor.sideId;
    else delete scoped.sideId;
    if (nodeId) scoped.nodeId = nodeId;
    else delete scoped.nodeId;
    return scoped;
  }

  create(input: CreateCalculationInput, actor: CalculationActor, idempotencyKey: string): { calculation: Calculation; idempotent: boolean } {
    requireAuthority(actor, 'calculation:create');
    if (!idempotencyKey.trim()) throw new HttpError(422, 'idempotency_key_required', 'Нужен ключ идемпотентности');
    const scoped = this.scopedInput(input, actor);
    const scope = `${actor.organizationId}/${actor.userId}/${idempotencyKey}`;
    const request = canonicalJson(scoped);
    const previous = this.idempotency.get(scope);
    if (previous) {
      if (previous.request !== request) throw new HttpError(409, 'idempotency_conflict', 'Идемпотентный ключ уже использован с другим содержимым');
      return { calculation: clone(previous.calculation), idempotent: true };
    }
    const normalized = scoped.mode === 'MANUAL'
      ? { ...scoped, manual: scoped.manual ? { ...scoped.manual, author: actor.userId } : scoped.manual }
      : scoped;
    const stochastic = normalized.stochastic
      ? { ...normalized.stochastic, key: { ...normalized.stochastic.key, seed: BigInt(normalized.stochastic.key.seed.replace(/n$/, '')) } }
      : undefined;
    const id = this.idFactory();
    this.assertNewId(id);
    const created = calculate({ ...normalized, stochastic, id } as CalculateOptions);
    const calculation = this.put(created.id, actor.organizationId, { ...created, createdBy: actor.userId });
    this.idempotency.set(scope, { request, calculation: clone(calculation) });
    return { calculation, idempotent: false };
  }

  approve(id: string, actor: CalculationActor, reviewedParameters?: Readonly<Record<string, unknown>>): Calculation {
    requireAuthority(actor, 'calculation:approve');
    const current = this.get(id, actor.organizationId);
    assertScope(actor, current);
    return this.put(id, actor.organizationId, approveCalculation(current, { author: actor.userId, authorized: true, reviewedParameters }));
  }

  apply(id: string, actor: CalculationActor, appliedEventIds: readonly string[]): Calculation {
    requireAuthority(actor, 'calculation:apply');
    const current = this.get(id, actor.organizationId);
    assertScope(actor, current);
    return this.put(id, actor.organizationId, applyCalculation(current, { authorized: true, appliedEventIds }));
  }

  override(id: string, actor: CalculationActor, input: { reason: string; result: unknown; createdAt: string }): Calculation {
    requireAuthority(actor, 'calculation:override');
    const current = this.get(id, actor.organizationId);
    assertScope(actor, current);
    const manualId = this.idFactory();
    this.assertNewId(manualId);
    const manual = overrideCalculation(current, { id: manualId, author: actor.userId, ...input }) as Calculation & { supersededCalculation: Calculation };
    this.put(id, actor.organizationId, manual.supersededCalculation);
    return this.put(manual.id, actor.organizationId, manual);
  }
}

export function registerCalculationRoutes(router: Router, journal: CalculationJournal, actorOf: (ctx: Ctx) => CalculationActor | Promise<CalculationActor>): void {
  router.post('/kshvi/calculations', async ctx => {
    const body = await ctx.json<CalculationRequest>();
    const input = { ...body } as Partial<CalculationRequest>;
    delete input.idempotencyKey;
    delete input.actor;
    delete input.id;
    return journal.create(input as CreateCalculationInput, await actorOf(ctx), body.idempotencyKey);
  });
  router.get('/kshvi/calculations/:id', async ctx => journal.getForActor(ctx.params.id, await actorOf(ctx)));
  router.get('/kshvi/calculations/:id/history', async ctx => journal.historyForActor(ctx.params.id, await actorOf(ctx)));
  router.post('/kshvi/calculations/:id/approve', async ctx => {
    const body = await ctx.json<{ reviewedParameters?: Readonly<Record<string, unknown>> }>();
    return journal.approve(ctx.params.id, await actorOf(ctx), body.reviewedParameters);
  });
  router.post('/kshvi/calculations/:id/apply', async ctx => {
    const body = await ctx.json<{ appliedEventIds?: readonly string[] }>();
    return journal.apply(ctx.params.id, await actorOf(ctx), body.appliedEventIds ?? []);
  });
  router.post('/kshvi/calculations/:id/override', async ctx => {
    const body = await ctx.json<{ reason?: string; result?: unknown; createdAt?: string }>();
    return journal.override(ctx.params.id, await actorOf(ctx), { reason: body.reason ?? '', result: body.result, createdAt: body.createdAt ?? '' });
  });
}

export function buildCalculationRouter(journal: CalculationJournal, actorOf: (ctx: Ctx) => CalculationActor | Promise<CalculationActor>): Router {
  const router = new Router();
  registerCalculationRoutes(router, journal, actorOf);
  return router;
}
