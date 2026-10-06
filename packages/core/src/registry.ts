/**
 * Реестр объектов: формирования, сооружения, населённые пункты и т.п., на которые
 * ссылаются знаки разных карт (feature.entityId). Общий контракт для сервиса реестра,
 * редактора и внешних систем.
 *
 *  - Тип объекта (EntityType) задаёт схему характеристик — поля с типами значений.
 *    Поле с temporal: true меняется во времени (численность, командир, подчинение…),
 *    остальные постоянные (номер, род войск).
 *  - Объект (Entity) хранит постоянные характеристики и период существования.
 *  - Факт (Fact) — значения характеристик и/или положение, действующие с момента
 *    validFrom (по validTo, если задан). Каждый факт может ссылаться на источник.
 *  - Состояние на момент t (stateAt) — постоянные характеристики, поверх которых
 *    наложены все действующие на t факты в порядке validFrom: более поздний факт
 *    перекрывает более ранний по тем полям, которые в нём есть (null — «значение снято»).
 */
import type { Side, TimeInstant, TimeSpan } from './model';
import type { GeoJSONGeometry } from './geojson';
import { inSpan, toTime } from './temporal';

export type FieldType = 'string' | 'text' | 'integer' | 'number' | 'boolean' | 'date' | 'enum' | 'ref';

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  /** Значение меняется во времени — задаётся фактами, а не постоянными характеристиками. */
  temporal?: boolean;
  required?: boolean;
  /** Единица измерения для чисел: «чел.», «ед.», «км». */
  unit?: string;
  /** Варианты для enum. */
  options?: { value: string; label: string }[];
  /** Для ref: тип объекта, на который ссылается поле (например, вышестоящее формирование). */
  refType?: string;
  description?: string;
}

export interface EntityType {
  id: string;
  name: string;
  description: string;
  fields: FieldDef[];
  /** Встроенный тип (поставляется с платформой; поля можно дополнять, но не удалять). */
  builtin?: boolean;
  /** Элементы библиотеки знаков, которыми обычно обозначается объект этого типа. */
  elements?: string[];
}

export interface Entity {
  id: string;
  type: string;
  /** Полное наименование: «150-я стрелковая Идрицкая дивизия». */
  name: string;
  /** Краткое обозначение для подписи на карте: «150 сд». */
  shortName?: string;
  side?: Side;
  /** Постоянные характеристики (поля без temporal). */
  attrs: Record<string, unknown>;
  /** Период существования (сформирована — расформирована). */
  existence?: TimeSpan | null;
  /** Откуда сведения: архивный фонд, литература. */
  source?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Fact {
  id: string;
  entityId: string;
  validFrom: TimeInstant;
  validTo?: TimeInstant | null;
  /** Значения характеристик с момента validFrom (только поля с temporal: true). */
  attrs: Record<string, unknown>;
  /** Положение объекта (WGS84). */
  geometry?: GeoJSONGeometry | null;
  source?: string;
  note?: string;
  createdAt?: string;
}

export interface EntityState {
  entityId: string;
  at: TimeInstant;
  /** Существует ли объект на момент at. */
  exists: boolean;
  /** Все характеристики на момент at: постоянные и временные. */
  attrs: Record<string, unknown>;
  geometry: GeoJSONGeometry | null;
  /** Для каждой временной характеристики — факт, из которого взято значение. */
  from: Record<string, string>;
}

/** Действует ли факт на момент t. */
export function factActive(f: Fact, t: TimeInstant): boolean {
  return inSpan({ from: f.validFrom, to: f.validTo ?? null }, t);
}

/** Состояние объекта на момент t по его фактам. */
export function stateAt(entity: Entity, facts: Fact[], t: TimeInstant): EntityState {
  const active = facts
    .filter((f) => f.entityId === entity.id && factActive(f, t))
    .sort((a, b) => toTime(a.validFrom) - toTime(b.validFrom) || (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
  const attrs: Record<string, unknown> = { ...entity.attrs };
  const from: Record<string, string> = {};
  let geometry: GeoJSONGeometry | null = null;
  for (const f of active) {
    for (const [k, v] of Object.entries(f.attrs ?? {})) {
      if (v === null) { delete attrs[k]; delete from[k]; } else { attrs[k] = v; from[k] = f.id; }
    }
    if (f.geometry !== undefined) geometry = f.geometry;
  }
  return { entityId: entity.id, at: t, exists: inSpan(entity.existence, t), attrs, geometry, from };
}

/** История одной характеристики: значения по моментам их появления. */
export function attrHistory(facts: Fact[], key: string): { t: TimeInstant; to?: TimeInstant | null; value: unknown; factId: string }[] {
  return facts
    .filter((f) => f.attrs && key in f.attrs)
    .sort((a, b) => toTime(a.validFrom) - toTime(b.validFrom))
    .map((f) => ({ t: f.validFrom, to: f.validTo, value: f.attrs[key], factId: f.id }));
}

/**
 * Проверка значений характеристик по схеме типа.
 * mode: 'static' — постоянные характеристики объекта, 'temporal' — значения факта.
 */
export function validateAttrs(type: EntityType, attrs: Record<string, unknown>, mode: 'static' | 'temporal'): string[] {
  const errors: string[] = [];
  const fields = new Map(type.fields.map((f) => [f.key, f]));
  for (const [k, v] of Object.entries(attrs)) {
    const f = fields.get(k);
    if (!f) continue; // произвольные поля допускаются (пользовательские характеристики)
    if (mode === 'static' && f.temporal) { errors.push(`«${f.label}» меняется во времени — задаётся фактом с датой`); continue; }
    if (mode === 'temporal' && !f.temporal) { errors.push(`«${f.label}» — постоянная характеристика, в факте не задаётся`); continue; }
    if (v === null) continue;
    const bad = (msg: string) => errors.push(`«${f.label}»: ${msg}`);
    switch (f.type) {
      case 'integer': if (!Number.isInteger(v)) bad('ожидается целое число'); break;
      case 'number': if (typeof v !== 'number' || !Number.isFinite(v)) bad('ожидается число'); break;
      case 'boolean': if (typeof v !== 'boolean') bad('ожидается да/нет'); break;
      case 'date': if (typeof v !== 'string' || !Number.isFinite(toTime(v))) bad('ожидается дата'); break;
      case 'enum': if (!f.options?.some((o) => o.value === v)) bad(`недопустимое значение «${String(v)}»`); break;
      case 'ref': case 'string': case 'text': if (typeof v !== 'string') bad('ожидается строка'); break;
    }
  }
  if (mode === 'static') {
    for (const f of type.fields) if (f.required && !f.temporal && (attrs[f.key] === undefined || attrs[f.key] === '')) errors.push(`«${f.label}» — обязательное поле`);
  }
  return errors;
}

/** Подпись значения для показа (enum — по варианту, число — с единицей). */
export function formatAttr(f: FieldDef | undefined, v: unknown): string {
  if (v === undefined || v === null || v === '') return '—';
  if (!f) return String(v);
  if (f.type === 'enum') return f.options?.find((o) => o.value === v)?.label ?? String(v);
  if (f.type === 'boolean') return v ? 'да' : 'нет';
  if ((f.type === 'integer' || f.type === 'number') && typeof v === 'number') return `${v.toLocaleString('ru-RU')}${f.unit ? ' ' + f.unit : ''}`;
  return String(v);
}

const opt = (pairs: [string, string][]) => pairs.map(([value, label]) => ({ value, label }));

/** Встроенные типы объектов. Организация может добавлять свои типы и поля. */
export const ENTITY_TYPES: EntityType[] = [
  {
    id: 'formation', name: 'Формирование', builtin: true,
    description: 'Объединение, соединение, часть или подразделение: фронт, армия, корпус, дивизия, бригада, полк, батальон.',
    elements: ['hq.front', 'hq.army', 'hq.corps', 'hq.division', 'hq.regiment', 'hq.battalion', 'unit.army', 'unit.mechCorps', 'unit.tankArmy', 'label.unit'],
    fields: [
      { key: 'number', label: 'Номер', type: 'string', required: true, description: 'Номер формирования: «150», «3 гв.»' },
      { key: 'echelon', label: 'Ступень', type: 'enum', required: true, options: opt([
        ['front', 'фронт'], ['army', 'армия'], ['corps', 'корпус'], ['division', 'дивизия'], ['brigade', 'бригада'],
        ['regiment', 'полк'], ['battalion', 'батальон'], ['company', 'рота'], ['platoon', 'взвод']]) },
      { key: 'branch', label: 'Род войск', type: 'enum', options: opt([
        ['rifle', 'стрелковые'], ['guards_rifle', 'гвардейские стрелковые'], ['tank', 'танковые'], ['mechanized', 'механизированные'],
        ['cavalry', 'кавалерия'], ['artillery', 'артиллерия'], ['rocket', 'гвардейские миномётные'], ['engineer', 'инженерные'],
        ['air', 'авиация'], ['aa', 'ПВО'], ['naval', 'флот'], ['airborne', 'воздушно-десантные'], ['nkvd', 'войска НКВД'], ['other', 'другое']]) },
      { key: 'honorifics', label: 'Почётные наименования и награды', type: 'text', temporal: true },
      { key: 'parent', label: 'Подчинение', type: 'ref', refType: 'formation', temporal: true, description: 'Вышестоящее формирование на период' },
      { key: 'commander', label: 'Командир', type: 'string', temporal: true },
      { key: 'status', label: 'Положение', type: 'enum', temporal: true, options: opt([
        ['forming', 'формируется'], ['reserve', 'в резерве'], ['march', 'на марше'], ['offensive', 'наступает'], ['defense', 'обороняется'],
        ['withdrawal', 'отходит'], ['encircled', 'в окружении'], ['refit', 'на доукомплектовании'], ['disbanded', 'расформировано']]) },
      { key: 'personnel', label: 'Численность', type: 'integer', unit: 'чел.', temporal: true },
      { key: 'tanks', label: 'Танки и САУ', type: 'integer', unit: 'ед.', temporal: true },
      { key: 'guns', label: 'Орудия и миномёты', type: 'integer', unit: 'ед.', temporal: true },
      { key: 'losses', label: 'Потери за период', type: 'integer', unit: 'чел.', temporal: true },
    ],
  },
  {
    id: 'structure', name: 'Сооружение', builtin: true,
    description: 'Фортификационное или инженерное сооружение, здание, мост: ДОТ, ДЗОТ, рубеж, переправа, опорный пункт.',
    elements: ['dot', 'dzot', 'fort', 'bridge', 'atDitch', 'trench', 'area.strongpoint'],
    fields: [
      { key: 'kind', label: 'Вид', type: 'enum', required: true, options: opt([
        ['dot', 'ДОТ'], ['dzot', 'ДЗОТ'], ['fort', 'форт'], ['trench', 'траншея'], ['ditch', 'противотанковый ров'], ['obstacle', 'заграждение'],
        ['bridge', 'мост'], ['crossing', 'переправа'], ['building', 'здание'], ['strongpoint', 'опорный пункт'], ['other', 'другое']]) },
      { key: 'material', label: 'Материал / конструкция', type: 'string' },
      { key: 'state', label: 'Состояние', type: 'enum', temporal: true, options: opt([
        ['planned', 'строится'], ['ready', 'готово'], ['damaged', 'повреждено'], ['destroyed', 'разрушено'], ['restored', 'восстановлено']]) },
      { key: 'holder', label: 'Кто занимает', type: 'ref', refType: 'formation', temporal: true },
      { key: 'garrison', label: 'Гарнизон', type: 'integer', unit: 'чел.', temporal: true },
    ],
  },
  {
    id: 'place', name: 'Населённый пункт, объект местности', builtin: true,
    description: 'Город, село, высота, лес, переправа — объект, за который велись бои.',
    elements: ['settlement', 'city', 'label.city', 'height'],
    fields: [
      { key: 'kind', label: 'Вид', type: 'enum', options: opt([['city', 'город'], ['town', 'посёлок'], ['village', 'село, деревня'], ['height', 'высота'], ['forest', 'лес'], ['other', 'другое']]) },
      { key: 'nameThen', label: 'Название в описываемый период', type: 'string' },
      { key: 'control', label: 'Контроль', type: 'enum', temporal: true, options: opt([['own', 'свои войска'], ['enemy', 'противник'], ['contested', 'бои'], ['neutral', 'ничейный']]) },
      { key: 'holder', label: 'Кто удерживает', type: 'ref', refType: 'formation', temporal: true },
    ],
  },
  {
    id: 'operation', name: 'Операция, бой', builtin: true,
    description: 'Операция или бой: период, замысел, итог. Знаки операции ссылаются на неё для отбора на карте.',
    elements: ['attack.main'],
    fields: [
      { key: 'start', label: 'Начало', type: 'date' },
      { key: 'end', label: 'Окончание', type: 'date' },
      { key: 'level', label: 'Масштаб', type: 'enum', options: opt([['strategic', 'стратегическая'], ['front', 'фронтовая'], ['army', 'армейская'], ['battle', 'бой']]) },
      { key: 'goal', label: 'Замысел', type: 'text' },
      { key: 'result', label: 'Итог', type: 'text' },
      { key: 'phase', label: 'Этап', type: 'string', temporal: true },
    ],
  },
];

export const ENTITY_TYPE_BY_ID = new Map(ENTITY_TYPES.map((t) => [t.id, t]));

