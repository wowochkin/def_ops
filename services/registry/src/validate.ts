/**
 * Проверка и приведение к единому виду входных данных реестра: объектов, фактов,
 * типов, геометрии и моментов времени. Оба хранилища (память и PostgreSQL)
 * получают уже нормализованные значения — поэтому и отдают одинаковые.
 */
import type { Entity, EntityType, Fact, FieldDef, FieldType, GeoJSONGeometry, Side, TimeSpan } from '@def-ops/core';
import { isTime, toTime, validateAttrs } from '@def-ops/core';
import { HttpError } from '@def-ops/service-kit';

/** Ошибка содержимого запроса → 422 со списком сообщений. */
export class ValidationError extends HttpError {
  constructor(public errors: string[]) { super(422, 'validation', errors.join('; ')); }
}

const fail = (...errors: string[]): never => { throw new ValidationError(errors); };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: unknown): s is string => typeof s === 'string' && UUID.test(s);

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/* ----------------------------------- время ----------------------------------- */

/**
 * Канонический вид момента (UTC, без пояса): «1945-04-25», «1945-04-25T06:00»,
 * «1945-04-25T06:00:30», «1945-04-25T06:00:30.250». Одинаковые моменты —
 * одинаковые строки, в каком бы виде их ни передали.
 */
export function normTime(s: string): string {
  const iso = new Date(toTime(s)).toISOString();
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(:\d{2})\.(\d{3})Z$/.exec(iso);
  if (!m) throw new Error(`Момент вне допустимого диапазона: ${s}`);
  const [, date, hm, sec, ms] = m;
  if (ms !== '000') return `${date}T${hm}${sec}.${ms}`;
  if (sec !== ':00') return `${date}T${hm}${sec}`;
  if (hm !== '00:00') return `${date}T${hm}`;
  return date;
}

/** Момент для СУБД: ISO с поясом Z. */
export const pgTime = (s: string): string => new Date(toTime(s)).toISOString();

/** Проверенный момент (годы 0001–9999) в каноническом виде; иначе — сообщение об ошибке. */
function time(v: unknown, label: string, errors: string[]): string | undefined {
  if (!isTime(v)) { errors.push(`${label}: ожидается момент времени ISO 8601 («1945-04-25» или «1945-04-25T06:00»)`); return undefined; }
  const y = new Date(toTime(v)).getUTCFullYear();
  if (y < 1 || y > 9999) { errors.push(`${label}: год вне допустимого диапазона`); return undefined; }
  return normTime(v);
}

/** Параметр запроса «момент времени» (?at=) → канонический вид или 400. */
export function parseAt(v: string | null | undefined, name = 'at'): string | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  const errors: string[] = [];
  const t = time(v, name, errors);
  if (!t) throw new HttpError(400, 'bad_time', errors[0]);
  return t;
}

/** Период [from, to): null — без ограничений. */
function span(v: unknown, label: string, errors: string[]): TimeSpan | null {
  if (v === null || v === undefined) return null;
  if (!isObj(v)) { errors.push(`${label}: ожидается {from, to}`); return null; }
  const from = v.from === null || v.from === undefined || v.from === '' ? null : time(v.from, `${label}, начало`, errors) ?? null;
  const to = v.to === null || v.to === undefined || v.to === '' ? null : time(v.to, `${label}, окончание`, errors) ?? null;
  if (from && to && toTime(to) <= toTime(from)) errors.push(`${label}: окончание должно быть позже начала`);
  return from || to ? { from, to } : null;
}

/* --------------------------------- геометрия --------------------------------- */

type Pos = [number, number];

function position(p: unknown, errors: string[]): Pos {
  if (!Array.isArray(p) || p.length < 2 || p.length > 3 || !p.every((x) => typeof x === 'number' && Number.isFinite(x))) {
    errors.push('Геометрия: точка должна быть [долгота, широта]');
    return [0, 0];
  }
  const [lon, lat] = p as number[];
  if (lon < -180 || lon > 180 || lat < -90 || lat > 90) errors.push(`Геометрия: координаты вне диапазона WGS84 (${lon}, ${lat})`);
  return [lon, lat]; // высота отбрасывается — хранится плоская геометрия
}

function positions(a: unknown, min: number, what: string, errors: string[]): Pos[] {
  if (!Array.isArray(a) || a.length < min) { errors.push(`Геометрия: ${what} — не меньше ${min} точек`); return []; }
  return a.map((p) => position(p, errors));
}

function ring(a: unknown, errors: string[]): Pos[] {
  const r = positions(a, 4, 'контур многоугольника', errors);
  if (r.length >= 4) {
    const [f, l] = [r[0], r[r.length - 1]];
    if (f[0] !== l[0] || f[1] !== l[1]) errors.push('Геометрия: контур многоугольника должен быть замкнут (первая точка = последней)');
  }
  return r;
}

const list = <T>(a: unknown, what: string, errors: string[], fn: (x: unknown) => T): T[] => {
  if (!Array.isArray(a) || !a.length) { errors.push(`Геометрия: ${what} — ожидается непустой массив`); return []; }
  return a.map(fn);
};

/** Геометрия GeoJSON (WGS84): Point, MultiPoint, LineString, MultiLineString, Polygon, MultiPolygon. */
export function parseGeometry(g: unknown): GeoJSONGeometry {
  const errors: string[] = [];
  if (!isObj(g) || typeof g.type !== 'string') fail('Геометрия: ожидается объект GeoJSON {type, coordinates}');
  const o = g as { type: string; coordinates: unknown };
  let out: unknown;
  switch (o.type) {
    case 'Point': out = { type: 'Point', coordinates: position(o.coordinates, errors) }; break;
    case 'MultiPoint': out = { type: 'MultiPoint', coordinates: positions(o.coordinates, 1, 'MultiPoint', errors) }; break;
    case 'LineString': out = { type: 'LineString', coordinates: positions(o.coordinates, 2, 'линия', errors) }; break;
    case 'MultiLineString': out = { type: 'MultiLineString', coordinates: list(o.coordinates, 'MultiLineString', errors, (l) => positions(l, 2, 'линия', errors)) }; break;
    case 'Polygon': out = { type: 'Polygon', coordinates: list(o.coordinates, 'Polygon', errors, (r) => ring(r, errors)) }; break;
    case 'MultiPolygon': out = { type: 'MultiPolygon', coordinates: list(o.coordinates, 'MultiPolygon', errors, (p) => list(p, 'Polygon', errors, (r) => ring(r, errors))) }; break;
    default: errors.push(`Геометрия: тип «${o.type}» не поддерживается (Point, MultiPoint, LineString, MultiLineString, Polygon, MultiPolygon)`);
  }
  if (errors.length) fail(...[...new Set(errors)]);
  return out as GeoJSONGeometry;
}

/** Охватывающий прямоугольник геометрии: [minLon, minLat, maxLon, maxLat]. */
export function geometryBBox(g: GeoJSONGeometry): [number, number, number, number] {
  const b: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  const walk = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === 'number') {
      b[0] = Math.min(b[0], c[0]); b[1] = Math.min(b[1], c[1] as number);
      b[2] = Math.max(b[2], c[0]); b[3] = Math.max(b[3], c[1] as number);
    } else if (Array.isArray(c)) c.forEach(walk);
  };
  walk((g as { coordinates: unknown }).coordinates);
  return b;
}

export type BBox = [number, number, number, number];

/** Параметр bbox=minLon,minLat,maxLon,maxLat → 400 при ошибке. */
export function parseBBox(v: string | null): BBox | undefined {
  if (v === null || v === '') return undefined;
  const n = v.split(',').map((x) => Number(x.trim()));
  const bad = () => { throw new HttpError(400, 'bad_bbox', 'bbox: ожидается minLon,minLat,maxLon,maxLat'); };
  if (n.length !== 4 || !n.every(Number.isFinite)) bad();
  const [a, b, c, d] = n;
  if (a > c || b > d || a < -180 || c > 180 || b < -90 || d > 90) bad();
  return [a, b, c, d];
}

export const bboxIntersects = (a: BBox, b: BBox) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];

/* ---------------------------------- объекты ---------------------------------- */

const SIDES: Side[] = ['own', 'enemy', 'neutral'];

function optString(v: unknown, label: string, errors: string[], max = 2000): string | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  if (typeof v !== 'string') { errors.push(`«${label}»: ожидается строка`); return undefined; }
  if (v.length > max) errors.push(`«${label}»: не длиннее ${max} символов`);
  return v;
}

function attrsOf(v: unknown, errors: string[]): Record<string, unknown> {
  if (v === undefined || v === null) return {};
  if (!isObj(v)) { errors.push('attrs: ожидается объект'); return {}; }
  return v;
}

/** Объект без пустых полей (необязательные поля без значения отсутствуют). */
function compact<T extends object>(o: T): T {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined || o[k] === null) delete o[k];
  return o;
}

/**
 * Проверить и собрать объект реестра из входных данных (создание и изменение).
 * Постоянные характеристики проверяются по схеме типа (validateAttrs, 'static').
 */
export function buildEntity(body: Record<string, unknown>, type: EntityType | undefined, base: Pick<Entity, 'id' | 'createdAt' | 'updatedAt'>): Entity {
  const errors: string[] = [];
  if (!type) fail(`Неизвестный тип объекта «${String(body.type ?? '')}»`);
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) errors.push('«Наименование» — обязательное поле');
  if (name.length > 500) errors.push('«Наименование»: не длиннее 500 символов');
  const side = body.side === null || body.side === undefined || body.side === '' ? undefined : body.side;
  if (side !== undefined && !SIDES.includes(side as Side)) errors.push(`«Сторона»: недопустимое значение «${String(side)}» (own, enemy, neutral)`);
  const attrs = attrsOf(body.attrs, errors);
  const e: Entity = compact({
    id: base.id,
    type: type!.id,
    name,
    shortName: optString(body.shortName, 'Краткое обозначение', errors, 200),
    side: side as Side | undefined,
    attrs: dropNulls(attrs),
    existence: span(body.existence, 'Период существования', errors),
    source: optString(body.source, 'Источник', errors),
    createdAt: base.createdAt,
    updatedAt: base.updatedAt,
  });
  errors.push(...validateAttrs(type!, e.attrs, 'static'));
  if (errors.length) fail(...errors);
  return e;
}

/** Постоянные характеристики: null означает «нет значения» — ключ не хранится. */
const dropNulls = (a: Record<string, unknown>) => Object.fromEntries(Object.entries(a).filter(([, v]) => v !== null && v !== undefined));

/** Изменение объекта (PATCH): attrs сливаются (null — удалить ключ), null у полей — снять значение. */
export function mergeEntityPatch(cur: Entity, patch: Record<string, unknown>): Record<string, unknown> {
  if (!isObj(patch)) fail('Тело запроса: ожидается объект');
  if (patch.type !== undefined && patch.type !== cur.type) fail('Тип объекта менять нельзя: создайте новый объект');
  if (patch.attrs !== undefined && patch.attrs !== null && !isObj(patch.attrs)) fail('attrs: ожидается объект');
  const out: Record<string, unknown> = { ...cur };
  for (const k of ['name', 'shortName', 'side', 'existence', 'source'] as const) if (k in patch) out[k] = patch[k];
  if (isObj(patch.attrs)) out.attrs = { ...cur.attrs, ...patch.attrs };
  return out;
}

/* ----------------------------------- факты ----------------------------------- */

/**
 * Проверить и собрать факт. В факте задаются только временные характеристики
 * (validateAttrs, 'temporal'); null — «значение снято с этого момента».
 * Геометрия null равнозначна её отсутствию: факт не меняет положение.
 */
export function buildFact(body: Record<string, unknown>, type: EntityType, base: Pick<Fact, 'id' | 'entityId' | 'createdAt'>): Fact {
  if (!isObj(body)) fail('Тело запроса: ожидается объект');
  const errors: string[] = [];
  const validFrom = time(body.validFrom, 'validFrom', errors);
  let validTo: string | null = null;
  if (body.validTo !== null && body.validTo !== undefined && body.validTo !== '') {
    validTo = time(body.validTo, 'validTo', errors) ?? null;
    if (validFrom && validTo && toTime(validTo) <= toTime(validFrom)) errors.push('validTo должен быть позже validFrom');
  }
  const attrs = attrsOf(body.attrs, errors);
  let geometry: GeoJSONGeometry | undefined;
  if (body.geometry !== null && body.geometry !== undefined) {
    try { geometry = parseGeometry(body.geometry); } catch (e) { errors.push(...((e as ValidationError).errors ?? [(e as Error).message])); }
  }
  errors.push(...validateAttrs(type, attrs, 'temporal'));
  if (!Object.keys(attrs).length && !geometry) errors.push('Факт должен содержать характеристики (attrs) и/или положение (geometry)');
  const source = optString(body.source, 'Источник', errors);
  const note = optString(body.note, 'Примечание', errors);
  if (errors.length) fail(...errors);
  const f: Fact = compact({ id: base.id, entityId: base.entityId, validFrom: validFrom!, attrs, geometry, source, note, createdAt: base.createdAt });
  f.validTo = validTo; // всегда присутствует: null — бессрочно
  return f;
}

/** Изменение факта (PATCH): поля заменяются целиком (attrs — тоже: null в них значимо), null — снять. */
export function mergeFactPatch(cur: Fact, patch: Record<string, unknown>): Record<string, unknown> {
  if (!isObj(patch)) fail('Тело запроса: ожидается объект');
  const out: Record<string, unknown> = { ...cur };
  for (const k of ['validFrom', 'validTo', 'attrs', 'geometry', 'source', 'note'] as const) if (k in patch) out[k] = patch[k];
  return out;
}

/* ------------------------------------ типы ------------------------------------ */

const FIELD_TYPES: FieldType[] = ['string', 'text', 'integer', 'number', 'boolean', 'date', 'enum', 'ref'];

function parseField(v: unknown, i: number, errors: string[]): FieldDef | null {
  const at = `Поле ${i + 1}`;
  if (!isObj(v)) { errors.push(`${at}: ожидается объект {key, label, type}`); return null; }
  const key = v.key, label = v.label, type = v.type;
  if (typeof key !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key)) { errors.push(`${at}: key — латиница, цифры и _, начинается с буквы`); return null; }
  if (typeof label !== 'string' || !label.trim()) errors.push(`«${key}»: нужна подпись (label)`);
  if (!FIELD_TYPES.includes(type as FieldType)) errors.push(`«${key}»: тип значения — одно из ${FIELD_TYPES.join(', ')}`);
  const f: FieldDef = { key, label: String(label ?? ''), type: type as FieldType };
  if (v.temporal !== undefined) { if (typeof v.temporal !== 'boolean') errors.push(`«${key}»: temporal — да/нет`); else if (v.temporal) f.temporal = true; }
  if (v.required !== undefined) { if (typeof v.required !== 'boolean') errors.push(`«${key}»: required — да/нет`); else if (v.required) f.required = true; }
  for (const k of ['unit', 'refType', 'description'] as const) {
    if (v[k] === undefined || v[k] === null) continue;
    if (typeof v[k] !== 'string') errors.push(`«${key}»: ${k} — строка`); else f[k] = v[k] as string;
  }
  if (type === 'enum') {
    const ok = Array.isArray(v.options) && v.options.length > 0 && v.options.every((o) => isObj(o) && typeof o.value === 'string' && typeof o.label === 'string');
    if (!ok) errors.push(`«${key}»: для enum нужны варианты options [{value, label}]`);
    else f.options = (v.options as { value: string; label: string }[]).map((o) => ({ value: o.value, label: o.label }));
  }
  return f;
}

/** Канонический вид поля для сравнения со встроенным. */
const fieldKey = (f: FieldDef) => JSON.stringify([f.key, f.label, f.type, !!f.temporal, !!f.required, f.unit ?? null, f.options ?? null, f.refType ?? null, f.description ?? null]);

/**
 * Тип организации из тела PUT /registry/types/{id}.
 * Для встроенного типа возвращается запись только с добавленными полями:
 * встроенные поля нельзя ни удалить, ни изменить (переданные без изменений — допускаются).
 */
export function buildTypeRow(id: string, body: unknown, builtin: EntityType | undefined): EntityType {
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(id)) fail('Идентификатор типа: строчная латиница, цифры, - и _ (до 64 символов)');
  if (!isObj(body)) fail('Тело запроса: ожидается объект');
  const b = body as Record<string, unknown>;
  const errors: string[] = [];
  if (!Array.isArray(b.fields)) errors.push('fields: ожидается массив полей');
  const fields = (Array.isArray(b.fields) ? b.fields : []).map((f, i) => parseField(f, i, errors)).filter((f): f is FieldDef => !!f);
  const seen = new Set<string>();
  for (const f of fields) { if (seen.has(f.key)) errors.push(`Поле «${f.key}» указано дважды`); seen.add(f.key); }
  if (b.elements !== undefined && !(Array.isArray(b.elements) && b.elements.every((x) => typeof x === 'string'))) errors.push('elements: ожидается массив строк');

  if (builtin) {
    const own = new Map(builtin.fields.map((f) => [f.key, f]));
    const extra: FieldDef[] = [];
    for (const f of fields) {
      const bf = own.get(f.key);
      if (!bf) extra.push(f);
      else if (fieldKey(bf) !== fieldKey(f)) errors.push(`«${bf.label}» — поле встроенного типа, изменить его нельзя (можно только добавлять поля)`);
    }
    if (errors.length) fail(...errors);
    // имя и описание встроенного типа не меняются; хранятся только добавленные поля
    return { id, name: builtin.name, description: builtin.description, fields: extra, builtin: true };
  }

  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (!name) errors.push('«Название» типа — обязательное поле');
  if (b.description !== undefined && b.description !== null && typeof b.description !== 'string') errors.push('description: ожидается строка');
  if (errors.length) fail(...errors);
  const t: EntityType = { id, name, description: (b.description as string | undefined) ?? '', fields };
  if (Array.isArray(b.elements)) t.elements = b.elements as string[];
  return t;
}

/**
 * Типы организации: встроенные (из кода, с добавленными организацией полями)
 * и собственные. rows — записи организации из хранилища.
 */
export function mergeTypes(builtins: EntityType[], rows: EntityType[]): EntityType[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out = builtins.map((b) => {
    const r = byId.get(b.id);
    if (!r) return b;
    const own = new Set(b.fields.map((f) => f.key));
    return { ...b, fields: [...b.fields, ...r.fields.filter((f) => !own.has(f.key))] };
  });
  const builtinIds = new Set(builtins.map((b) => b.id));
  const custom = rows.filter((r) => !builtinIds.has(r.id)).map((r) => ({ ...r, builtin: false })).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return [...out, ...custom];
}
