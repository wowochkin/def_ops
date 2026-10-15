/**
 * Ручная правка фактов базы: поля формы по виду факта → формальная часть (formToClaim) и обратно (claimToForm),
 * кандидат ручного ввода (manualCandidate: проверки 3–7, без источника — допущение) и замечания формы (formWarnings).
 * Чистые функции — форма (FactForm.tsx) и тесты.
 */
import { DOCTRINE_LEVELS, doctrineValueRu, fingerprint, type Candidate, type CheckResult, type Claim, type Entry, type Evidence, type Fact, type Reliability } from '@def-ops/knowledge';
import { RULE_INPUTS } from '@def-ops/sim';
import { parseCount } from './queue';

/** param — путь из перечня входов правил; side — сторона (su, de); level — ступень правила доктрины; values — числа правила «имя=число; имя=от–до». */
export type FormFieldType = 'subject' | 'date' | 'number' | 'text' | 'list' | 'state' | 'param' | 'side' | 'level' | 'values';
export interface FormField { key: string; title: string; type: FormFieldType; required?: boolean }

const F = (key: string, title: string, type: FormFieldType, required = false): FormField => ({ key, title, type, required });
const SUBJ = F('subject', 'соединение', 'subject', true);
const SUBJ_OPT = F('subject', 'соединение', 'subject');
const NUMS = [F('personnel', 'людей', 'number'), F('tanks', 'танков', 'number'), F('guns', 'орудий', 'number')];
const RANGE = (required = false) => [F('rangeFrom', 'от', 'number', required), F('rangeTo', 'до', 'number', required)];

/** Параметры норматива: входы правил, профилей и агентной модели (путь, название, единица, группа). */
export const PARAM_OPTIONS = RULE_INPUTS.map((i) => ({ path: i.path, title: i.title, unit: i.unit, group: i.group }));

/** Поля формы по виду факта (порядок — как в форме). */
export const FORM_FIELDS: Record<Claim['kind'], FormField[]> = {
  strength: [SUBJ, F('at', 'на дату', 'date', true), ...NUMS],
  reinforce: [SUBJ, F('at', 'дата', 'date', true), ...NUMS],
  parent: [SUBJ, F('from', 'с', 'date', true), F('parent', 'вышестоящее', 'subject', true)],
  enter: [SUBJ, F('at', 'ввод в бой', 'date', true)],
  position: [SUBJ, F('at', 'на дату', 'date', true), F('place', 'пункт', 'text'), F('lat', 'широта', 'number'), F('lon', 'долгота', 'number'), F('uncertaintyKm', '± км', 'number')],
  boundary: [F('subject', 'объединение справа', 'subject', true), F('subject2', 'объединение слева', 'subject', true), F('from', 'с', 'date', true), F('to', 'по', 'date'),
    F('points', 'пункты (через «—»)', 'list', true), F('inclusive', 'включительно для', 'text')],
  crossing: [F('subject', 'переправа', 'text', true), F('from', 'с', 'date', true), F('state', 'состояние', 'state', true)],
  event: [F('title', 'событие', 'text', true), F('at', 'дата', 'date', true), F('place', 'место', 'text')],
  losses: [SUBJ, F('from', 'с', 'date', true), F('to', 'по', 'date', true), F('killed', 'убитых', 'number'), F('wounded', 'раненых', 'number'),
    F('missing', 'пропавших', 'number'), F('total', 'всего', 'number'), F('tanks', 'танков', 'number')],
  // нормативы модели: значение правила (число или диапазон; без них — допущение с «почему») и итог прогона
  param: [F('param', 'параметр', 'param', true), F('value', 'значение', 'number'), ...RANGE(), F('unit', 'единица', 'text'), F('side', 'сторона', 'side'),
    F('scale', 'дано на 1/n входа', 'number'), F('why', 'почему допущение', 'text')],
  outcome: [SUBJ_OPT, F('measure', 'мера (pace, loss, frontage)', 'text', true), F('scenario', 'операция', 'text', true), F('from', 'с', 'date', true), F('to', 'по', 'date', true),
    ...RANGE(true), F('unit', 'единица', 'text', true), F('side', 'сторона', 'side'), F('echelon', 'ступень', 'text'), F('near', 'район', 'text')],
  // правило доктрины «условие → действие» с числами
  doctrine: [F('side', 'сторона', 'side', true), F('level', 'уровень', 'level', true), F('group', 'группа', 'text', true), F('rule', 'id правила', 'text', true),
    F('condition', 'условие', 'text', true), F('action', 'действие', 'text', true), F('values', 'числа (имя=число; имя=от–до)', 'values')],
};

/** Ключ текстового факта по виду (как у фактов встроенной базы). */
export const FACT_KEY: Record<Claim['kind'], string> = {
  strength: 'personnel', reinforce: 'reinforce', parent: 'parent', enter: 'enter', position: 'path', boundary: 'boundary', crossing: 'crossings', event: 'event', losses: 'losses', param: 'numbers', outcome: 'numbers', doctrine: 'principles',
};

/** Дата из ввода: ГГГГ-ММ-ДД[ЧЧ:ММ] или ДД.ММ.ГГГГ [ЧЧ:ММ] → ISO; пусто — ''; не дата — null. */
export function parseDate(raw: string): string | null {
  const s = raw.trim();
  if (!s) return '';
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?$/.exec(s);
  let y: number, mo: number, d: number, h: string | undefined, mi: string | undefined;
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; h = m[4]; mi = m[5]; } else {
    m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2})[:.](\d{2}))?$/.exec(s);
    if (!m) return null;
    d = +m[1]; mo = +m[2]; y = +m[3]; h = m[4]?.padStart(2, '0'); mi = m[5];
  }
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  if (h != null && (+h > 23 || +mi! > 59)) return null;
  const day = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return h != null ? `${day}T${h}:${mi}` : day;
}

const FRACTIONAL = new Set(['lat', 'lon', 'uncertaintyKm', 'value', 'rangeFrom', 'rangeTo', 'scale']);

const STATES: Record<string, Extract<Claim, { kind: 'crossing' }>['state']> = {
  open: 'open', destroyed: 'destroyed', built: 'built', действует: 'open', цела: 'open', цел: 'open', разрушена: 'destroyed', разрушен: 'destroyed', взорван: 'destroyed', взорвана: 'destroyed', наведена: 'built', наведён: 'built', наведен: 'built',
};

/**
 * Формальная часть из полей формы. Ошибка — первое негодное поле по-русски (обязательное пусто, не дата, не число,
 * нет ни одного числа, конец периода раньше начала). Пустые необязательные поля в claim не попадают.
 */
export function formToClaim(kind: Claim['kind'], fields: Record<string, string>): { claim: Claim } | { error: string } {
  const spec = FORM_FIELDS[kind];
  if (!spec) return { error: `неизвестный вид факта: ${kind}` };
  const out: Record<string, unknown> = {};
  for (const f of spec) {
    const raw = (fields[f.key] ?? '').trim();
    if (!raw) { if (f.required) return { error: kind === 'doctrine' ? `${f.title}: обязательное поле` : `не заполнено: ${f.title}` }; continue; }
    if (f.type === 'date') {
      const d = parseDate(raw);
      if (!d) return { error: `${f.title}: «${raw}» — не дата (ГГГГ-ММ-ДД или ДД.ММ.ГГГГ)` };
      out[f.key] = d;
    } else if (f.type === 'number') {
      // координаты и радиус — дробные (точка или запятая), счётные числа — с разрядами («4 910», «4.910»)
      const n = FRACTIONAL.has(f.key) ? (/^-?\d+(?:[.,]\d+)?$/.test(raw) ? Number(raw.replace(',', '.')) : null) : parseCount(raw);
      if (n == null || (n < 0 && f.key !== 'lat' && f.key !== 'lon')) return { error: `${f.title}: «${raw}» — не число` };
      out[f.key] = n;
    } else if (f.type === 'list') {
      const list = raw.split(/\s*[—–]\s*|\s*;\s*/).map((x) => x.trim()).filter(Boolean);
      if (list.length < 2) return { error: `${f.title}: нужно не меньше двух пунктов через «—»` };
      out[f.key] = list;
    } else if (f.type === 'state') {
      const st = STATES[raw.toLowerCase()];
      if (!st) return { error: `${f.title}: «${raw}» — одно из: действует, разрушена, наведена` };
      out[f.key] = st;
    } else if (f.type === 'side') {
      const sd = ({ su: 'su', de: 'de', ссср: 'su', германия: 'de' } as Record<string, 'su' | 'de'>)[raw.toLowerCase()];
      if (!sd) return { error: `${f.title}: «${raw}» — su или de` };
      out[f.key] = sd;
    } else if (f.type === 'level') {
      if (!(DOCTRINE_LEVELS as readonly string[]).includes(raw)) return { error: `${f.title}: front, army, corps или division` };
      out[f.key] = raw;
    } else if (f.type === 'values') {
      const v = parseValues(raw);
      if ('error' in v) return v;
      if (Object.keys(v.values).length) out[f.key] = v.values;
    } else out[f.key] = raw;
  }
  const nums = (keys: string[]) => keys.some((k) => typeof out[k] === 'number');
  switch (kind) {
    case 'strength': case 'reinforce':
      if (!nums(['personnel', 'tanks', 'guns'])) return { error: 'нужно хотя бы одно число: людей, танков или орудий' };
      return { claim: { kind, subject: out.subject as string, at: out.at as string, ...pick(out, ['personnel', 'tanks', 'guns']) } };
    case 'parent': return { claim: { kind, subject: out.subject as string, from: out.from as string, parent: out.parent as string } };
    case 'enter': return { claim: { kind, subject: out.subject as string, at: out.at as string } };
    case 'position': {
      const hasLat = typeof out.lat === 'number', hasLon = typeof out.lon === 'number';
      if (hasLat !== hasLon) return { error: 'координаты: нужны и широта, и долгота' };
      if (!out.place && !hasLat) return { error: 'нужен пункт или координаты' };
      if (hasLat && (Math.abs(out.lat as number) > 90 || Math.abs(out.lon as number) > 180)) return { error: 'координаты вне пределов (широта ±90, долгота ±180)' };
      return { claim: { kind, subject: out.subject as string, at: out.at as string, ...(out.place ? { place: out.place as string } : {}),
        ...(hasLat ? { lngLat: [out.lon as number, out.lat as number] as [number, number] } : {}), ...pick(out, ['uncertaintyKm']) } };
    }
    case 'boundary':
      if (out.to && (out.to as string) < (out.from as string)) return { error: '«по» раньше, чем «с»' };
      return { claim: { kind, between: [out.subject as string, out.subject2 as string], from: out.from as string, ...(out.to ? { to: out.to as string } : {}),
        points: out.points as string[], ...(out.inclusive ? { inclusive: out.inclusive as string } : {}) } };
    case 'crossing': return { claim: { kind, subject: out.subject as string, from: out.from as string, state: out.state as 'open' } };
    case 'event': {
      const at = out.at as string, title = out.title as string;
      const id = (fields.id ?? '').trim() || `ev:${at.slice(0, 10)}:${title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 40)}`;
      return { claim: { kind, id, at, title, ...(out.place ? { place: out.place as string } : {}) } };
    }
    case 'losses':
      if ((out.to as string) < (out.from as string)) return { error: '«по» раньше, чем «с»' };
      if (!nums(['killed', 'wounded', 'missing', 'total', 'tanks'])) return { error: 'нужно хотя бы одно число потерь' };
      return { claim: { kind, subject: out.subject as string, from: out.from as string, to: out.to as string, ...pick(out, ['killed', 'wounded', 'missing', 'total', 'tanks']) } };
    case 'param': case 'outcome': {
      const hasFrom = typeof out.rangeFrom === 'number', hasTo = typeof out.rangeTo === 'number';
      if (hasFrom !== hasTo) return { error: 'диапазон: нужны обе границы — «от» и «до»' };
      const range = hasFrom ? [out.rangeFrom as number, out.rangeTo as number] as [number, number] : undefined;
      if (range && range[1] < range[0]) return { error: 'диапазон: «до» меньше, чем «от»' };
      if (kind === 'param') {
        if (range == null && out.value == null && !out.why) return { error: 'нужно значение, диапазон или «почему допущение»' };
        if (out.scale != null && !((out.scale as number) > 0)) return { error: 'дано на 1/n входа: n больше нуля' };
        return { claim: { kind, param: out.param as string, ...(range ? { range } : pick(out, ['value'])), ...pick(out, ['unit', 'side', 'scale', 'why']) } as Claim };
      }
      if (!range) return { error: 'нужен диапазон: «от» и «до»' };
      if ((out.to as string) < (out.from as string)) return { error: '«по» раньше, чем «с»' };
      return { claim: { kind, measure: out.measure as string, scenario: out.scenario as string, ...pick(out, ['subject']), from: out.from as string, to: out.to as string,
        range, unit: out.unit as string, ...pick(out, ['side', 'echelon', 'near']) } as Claim };
    }
    case 'doctrine':
      return { claim: { kind, side: out.side as 'su' | 'de', level: out.level as 'front', group: out.group as string, rule: out.rule as string,
        condition: out.condition as string, action: out.action as string, ...pick(out, ['values']) } };
  }
}

const NUM = String.raw`-?\d+(?:[.,]\d+)?`;
const toNum = (s: string) => Number(s.replace(',', '.'));
/** Числа правила доктрины из строки «имя=число; имя=от–до» (десятичная точка или запятая; тире, минус или дефис между границами). */
export function parseValues(raw: string): { values: Record<string, number | [number, number]> } | { error: string } {
  const values: Record<string, number | [number, number]> = {};
  for (const part of raw.split(';').map((x) => x.trim()).filter(Boolean)) {
    const m = /^([^=]+?)\s*=\s*(.+)$/.exec(part);
    if (!m) return { error: `числа: «${part}» — нужно имя=число или имя=от–до` };
    const [, name, v] = m;
    if (new RegExp(`^${NUM}$`).test(v)) { values[name] = toNum(v); continue; }
    const r = new RegExp(`^(${NUM})\\s*[–—−-]\\s*(${NUM})$`).exec(v);
    if (!r) return { error: `${name}: «${v}» — не число и не «от–до»` };
    const lo = toNum(r[1]), hi = toNum(r[2]);
    if (hi < lo) return { error: `${name}: «до» меньше, чем «от»` };
    values[name] = [lo, hi];
  }
  return { values };
}

const pick = (o: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.filter((k) => o[k] != null).map((k) => [k, o[k]]));

/** Поля формы из формальной части (правка, «исправить»). */
export function claimToForm(c: Claim): Record<string, string> {
  const r = c as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const f of FORM_FIELDS[c.kind]) {
    const v = r[f.key];
    if (v != null) out[f.key] = Array.isArray(v) ? v.join(' — ') : String(v);
  }
  if (c.kind === 'boundary') { out.subject = c.between[0]; out.subject2 = c.between[1]; }
  if (c.kind === 'position' && c.lngLat) { out.lon = String(c.lngLat[0]); out.lat = String(c.lngLat[1]); }
  if (c.kind === 'event') out.id = c.id;
  if ((c.kind === 'param' || c.kind === 'outcome') && c.range) { out.rangeFrom = String(c.range[0]); out.rangeTo = String(c.range[1]); }
  if (c.kind === 'doctrine') { if (c.values) out.values = Object.entries(c.values).map(([k, v]) => `${k}=${doctrineValueRu(v)}`).join('; '); else delete out.values; }
  return out;
}

/** Источник, страницы, надёжность, заметка — общая часть формы. */
export interface FormMeta { source: string; pages?: string; reliability?: Reliability; note?: string }

/**
 * Кандидат ручного ввода (origin manual, доказательство — заметка): для проверок 3–7 и addManual. Без источника —
 * факт-допущение: reliability нет, какой бы ни выбрали. names — названия соединений как введены (не id) для
 * сопоставления проверкой «соединение».
 */
export function manualCandidate(claim: Claim, meta: FormMeta, o: { id: string; op?: string; names?: Candidate['names']; value: string }): Candidate {
  const source = meta.source.trim();
  return {
    id: o.id, claim, names: o.names ?? {}, key: FACT_KEY[claim.kind], value: o.value, source,
    ...(source && meta.pages?.trim() ? { pages: meta.pages.trim() } : {}),
    ...(source && meta.reliability ? { reliability: meta.reliability } : {}),
    origin: 'manual', evidence: { kind: 'manual', ...(meta.note?.trim() ? { note: meta.note.trim() } : {}) }, ...(o.op ? { op: o.op } : {}),
    checks: [], verdict: 'review', state: 'pending',
  };
}

export const ASSUMPTION_WARNING = 'источник не указан — факт войдёт в базу как допущение (без надёжности)';

/** Замечания формы: сомнения и отказы проверок 3–7 и «допущение» без источника. Сохранить можно и с ними. */
export function formWarnings(checks: CheckResult[], meta: FormMeta): string[] {
  const out = checks.filter((r) => r.level !== 'ok').map((r) => r.why ?? r.check);
  if (!meta.source.trim()) out.push(ASSUMPTION_WARNING);
  return out;
}

/**
 * Как принят факт: человеком (check.by 'human'), проверками (авто), встроенный (сид: та же запись, тот же номер и
 * отпечаток, что у факта сида) или «ваш, без проверки» (факт пользователя, принятый до части 2, без отметки проверки).
 */
export type FactOrigin = 'human' | 'auto' | 'seed' | 'legacy';
/** seedById нет (сид не загружен или не нужен) — факт без отметки проверки считается встроенным. */
export function originOf(ref: { entry: string; index: number; fact: Pick<Fact, 'check' | 'claim' | 'value'> }, seedById?: Map<string, Entry> | null): FactOrigin {
  const by = ref.fact.check?.by;
  if (by === 'human' || by === 'auto') return by;
  if (!seedById) return 'seed';
  const b = seedById.get(ref.entry)?.facts?.[ref.index];
  return b && fingerprint(b) === fingerprint(ref.fact as Fact) ? 'seed' : 'legacy';
}
export const ORIGIN_RU: Record<FactOrigin, string> = { human: 'человек', auto: 'авто', seed: 'встроенный', legacy: 'ваш, без проверки' };

/** Как принят факт — для «Основы модели» и записи. */
export const ORIGIN_LONG: Record<FactOrigin, string> = { human: 'проверено человеком', auto: 'принято автоматически (проверки пройдены)', seed: 'встроенная база', legacy: 'ваш факт, принятый без проверки (до проверок базы)' };

/** Доказательство факта одной строкой; docName — название документа по id. */
export function evidenceRu(e: Evidence, docName: (id: string) => string = (id) => id): string {
  switch (e.kind) {
    case 'quote': return `документ «${docName(e.doc)}», часть ${e.chunk + 1}: «${e.quote}»`;
    case 'scan': return `скан «${docName(e.doc)}», с. ${e.page}: «${e.quote}»`;
    case 'row': return `таблица «${docName(e.doc)}», строка ${e.row}: ${Object.entries(e.cells).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join('; ')}`;
    case 'agent': return `пакет агента: ${e.ref}${e.quote ? ` — «${e.quote}»` : ''}`;
    case 'manual': return `ручной ввод${e.note ? `: ${e.note}` : ''}`;
  }
}
