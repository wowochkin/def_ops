/** Маршруты сервиса реестра объектов (см. docs/data-model.md, «API реестра»). */
import type { Entity, EntityType, Fact } from '@def-ops/core';
import { ENTITY_TYPES, ENTITY_TYPE_BY_ID, attrHistory, stateAt } from '@def-ops/core';
import { Router, HttpError, reply, type Ctx } from '@def-ops/service-kit';
import { ConflictError, type RegistryRepo } from './repo';
import { EventBus } from './events';
import { buildEntity, buildFact, buildTypeRow, isUuid, mergeEntityPatch, mergeFactPatch, mergeTypes, parseAt, parseBBox } from './validate';

const LIMIT_DEFAULT = 50;
const LIMIT_MAX = 500;
const STATES_MAX = 5000;

export function buildRouter(repo: RegistryRepo, bus: EventBus): Router {
  const r = new Router();

  const source = (c: Ctx) => (c.req.headers['x-source-system'] as string) || undefined;
  const types = async (tenant: string) => mergeTypes(ENTITY_TYPES, await repo.typeRows(tenant));
  const typeOf = async (tenant: string, id: unknown): Promise<EntityType | undefined> =>
    typeof id === 'string' ? (await types(tenant)).find((t) => t.id === id) : undefined;
  /** Тип существующего объекта (если тип организации пропал — схема без полей). */
  const typeOfEntity = async (tenant: string, e: Entity): Promise<EntityType> =>
    (await typeOf(tenant, e.type)) ?? { id: e.type, name: e.type, description: '', fields: [] };

  const load = async (c: Ctx): Promise<Entity> => {
    const id = c.params.id;
    const e = isUuid(id) ? await repo.getEntity(c.tenant, id.toLowerCase()) : null;
    if (!e) throw new HttpError(404, 'not_found', 'Объект не найден');
    return e;
  };
  const loadFact = async (c: Ctx, e: Entity): Promise<Fact> => {
    const id = c.params.factId;
    const f = isUuid(id) ? await repo.getFact(c.tenant, e.id, id.toLowerCase()) : null;
    if (!f) throw new HttpError(404, 'not_found', 'Факт не найден');
    return f;
  };
  const body = async (c: Ctx): Promise<Record<string, unknown>> => {
    const b = await c.json();
    if (!b || typeof b !== 'object' || Array.isArray(b)) throw new HttpError(400, 'bad_body', 'Тело запроса: ожидается объект JSON');
    return b as Record<string, unknown>;
  };
  /** Отметка изменения строго позже предыдущей (для оптимистичной блокировки). */
  const stamp = (prev?: string) => {
    const now = Date.now();
    const p = prev ? Date.parse(prev) : 0;
    return new Date(Math.max(now, p + 1)).toISOString();
  };
  const factChanged = (c: Ctx, f: Fact, change: 'created' | 'updated' | 'deleted') =>
    bus.publish({ type: 'fact.changed', tenant: c.tenant, entityId: f.entityId, factId: f.id, change, source: source(c) });

  /* ------------------------------------ типы ------------------------------------ */
  r.get('/registry/types', (c) => types(c.tenant));

  r.put('/registry/types/:id', async (c) => {
    const id = c.params.id;
    const row = buildTypeRow(id, await c.json(), ENTITY_TYPE_BY_ID.get(id));
    await repo.putTypeRow(c.tenant, row);
    return (await types(c.tenant)).find((t) => t.id === id);
  });

  /* ---------------------------------- объекты ---------------------------------- */
  r.get('/registry/entities', async (c) => {
    const at = parseAt(c.query.get('at'));
    const bbox = parseBBox(c.query.get('bbox'));
    if (bbox && !at) throw new HttpError(400, 'bad_request', 'bbox задаётся вместе с моментом at: положение объектов меняется во времени');
    const lim = c.query.get('limit');
    const limit = lim === null || lim === '' ? LIMIT_DEFAULT : Number(lim);
    if (!Number.isInteger(limit) || limit < 1) throw new HttpError(400, 'bad_limit', 'limit: ожидается целое число ≥ 1');
    const list = await repo.listEntities(c.tenant, {
      q: c.query.get('q')?.trim() || undefined,
      type: c.query.get('type') || undefined,
      side: c.query.get('side') || undefined,
      limit: Math.min(limit, LIMIT_MAX),
      bbox, at,
    });
    if (!at) return list;
    const facts = await repo.listFacts(c.tenant, list.map((e) => e.id));
    return list.map((e) => ({ ...e, state: stateAt(e, facts, at) }));
  });

  r.post('/registry/entities', async (c) => {
    const b = await body(c);
    const now = stamp();
    const e = buildEntity(b, await typeOf(c.tenant, b.type), { id: crypto.randomUUID(), createdAt: now, updatedAt: now });
    const out = await repo.createEntity(c.tenant, e);
    bus.publish({ type: 'entity.created', tenant: c.tenant, entityId: out.id, source: source(c) });
    return reply(201, out);
  });

  r.get('/registry/entities/:id', async (c) => {
    const at = parseAt(c.query.get('at'));
    const entity = await load(c);
    if (!at) return { entity };
    return { entity, state: stateAt(entity, await repo.listFacts(c.tenant, [entity.id]), at) };
  });

  r.patch('/registry/entities/:id', async (c) => {
    const cur = await load(c);
    const patch = await body(c);
    const expected = typeof patch.updatedAt === 'string' ? patch.updatedAt : undefined;
    if (expected !== undefined && Date.parse(expected) !== Date.parse(cur.updatedAt!))
      throw new HttpError(409, 'conflict', new ConflictError(cur.updatedAt!).message);
    const merged = mergeEntityPatch(cur, patch);
    const next = buildEntity(merged, await typeOfEntity(c.tenant, cur), { id: cur.id, createdAt: cur.createdAt, updatedAt: stamp(cur.updatedAt) });
    let out: Entity | null;
    try { out = await repo.updateEntity(c.tenant, next, expected ?? cur.updatedAt); } catch (e) {
      if (e instanceof ConflictError) throw new HttpError(409, 'conflict', e.message);
      throw e;
    }
    if (!out) throw new HttpError(404, 'not_found', 'Объект не найден');
    bus.publish({ type: 'entity.updated', tenant: c.tenant, entityId: out.id, source: source(c) });
    return out;
  });

  r.delete('/registry/entities/:id', async (c) => {
    const e = await load(c);
    if (!(await repo.deleteEntity(c.tenant, e.id))) throw new HttpError(404, 'not_found', 'Объект не найден');
    bus.publish({ type: 'entity.deleted', tenant: c.tenant, entityId: e.id, source: source(c) });
    return reply(204, null);
  });

  /* ----------------------------------- факты ----------------------------------- */
  r.get('/registry/entities/:id/facts', async (c) => repo.listFacts(c.tenant, [(await load(c)).id]));

  r.post('/registry/entities/:id/facts', async (c) => {
    const e = await load(c);
    const f = buildFact(await body(c), await typeOfEntity(c.tenant, e), { id: crypto.randomUUID(), entityId: e.id, createdAt: stamp() });
    const out = await repo.addFact(c.tenant, f);
    factChanged(c, out, 'created');
    return reply(201, out);
  });

  r.patch('/registry/entities/:id/facts/:factId', async (c) => {
    const e = await load(c);
    const cur = await loadFact(c, e);
    const next = buildFact(mergeFactPatch(cur, await body(c)), await typeOfEntity(c.tenant, e), { id: cur.id, entityId: e.id, createdAt: cur.createdAt });
    const out = await repo.updateFact(c.tenant, next);
    if (!out) throw new HttpError(404, 'not_found', 'Факт не найден');
    factChanged(c, out, 'updated');
    return out;
  });

  r.delete('/registry/entities/:id/facts/:factId', async (c) => {
    const e = await load(c);
    const f = await loadFact(c, e);
    if (!(await repo.deleteFact(c.tenant, e.id, f.id))) throw new HttpError(404, 'not_found', 'Факт не найден');
    factChanged(c, f, 'deleted');
    return reply(204, null);
  });

  r.get('/registry/entities/:id/history', async (c) => {
    const key = c.query.get('key');
    if (!key) throw new HttpError(400, 'bad_request', 'Не указана характеристика: ?key=');
    const e = await load(c);
    return attrHistory(await repo.listFacts(c.tenant, [e.id]), key);
  });

  /* ------------------------- состояния многих объектов ------------------------- */
  /** Состояния объектов на момент — для отрисовки знаков карты разом. */
  r.post('/registry/states', async (c) => {
    const b = await body(c);
    const at = parseAt(typeof b.at === 'string' ? b.at : b.at === undefined ? '' : String(b.at));
    if (!at) throw new HttpError(400, 'bad_time', 'Не указан момент at');
    if (!Array.isArray(b.ids) || !b.ids.every((x) => typeof x === 'string')) throw new HttpError(400, 'bad_request', 'ids: ожидается массив идентификаторов');
    if (b.ids.length > STATES_MAX) throw new HttpError(400, 'bad_request', `ids: не больше ${STATES_MAX} за запрос`);
    const ids = [...new Set((b.ids as string[]).filter(isUuid).map((x) => x.toLowerCase()))];
    const entities = await repo.getEntities(c.tenant, ids);
    const facts = await repo.listFacts(c.tenant, entities.map((e) => e.id));
    const byId = new Map(entities.map((e) => [e.id, e]));
    return { states: ids.filter((id) => byId.has(id)).map((id) => stateAt(byId.get(id)!, facts, at)) };
  });

  /* ------------------------------------ события ------------------------------------ */
  /** Поток событий реестра (Server-Sent Events); ?entityId= — только по одному объекту. */
  r.get('/registry/events', (c) => {
    const only = c.query.get('entityId');
    c.res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    c.res.write(': connected\n\n');
    const off = bus.subscribe(c.tenant, (e) => {
      if (only && e.entityId !== only) return;
      c.res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
    });
    const ping = setInterval(() => c.res.write(': ping\n\n'), 25000);
    c.req.on('close', () => { off(); clearInterval(ping); });
  });

  return r;
}
