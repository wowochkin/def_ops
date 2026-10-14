/**
 * Проверки кандидата-факта 1–7 (восьмая, перекрёстное прочтение цитаты моделью, — вне этого модуля).
 * Чистые функции: всё нужное приходит в контексте CheckCtx.
 */
import type { Claim, Entry, Fact } from './schema';
import type { Candidate, CheckResult } from './candidate';
import { matchFormation, scenarioIdOf } from './sync';
import { matchEntryHow, quoteFound, stemSimilarity } from './extract';
import { fingerprint } from './resolve';

/** Пороги правдоподобия — допущения без опоры (norms.json: assume-plausible-*). */
export const PLAUSIBLE = {
  strength: { division: 20000, corps: 60000, army: 150000, front: 1200000, army_group: 1200000 } as Record<string, number>,
  dailyLossShare: 1 / 3,
  reinforceShare: 1 / 2,
};

export interface CheckCtx {
  /** Часть документа (для цитаты из текста). */
  text?: string;
  /** Расшифровка страницы скана. */
  transcript?: string;
  /** Строка таблицы существует. */
  rowExists?: boolean;
  formations: { id: string; name: string; echelon?: string; personnel?: number }[];
  entries: Entry[];
  theatre?: { locate(name: string): { at: [number, number] } | null };
  op?: { start: string; end: string };
  /** Последняя известная численность соединения на дату. */
  strengthOf(subject: string, at: string): number | null;
  /** Факты базы (для поиска повтора). */
  existing: Fact[];
}

const DAY = 86400000;

/** Все числа текста: разряды через пробел, неразрывный и узкий неразрывный пробел, точку (группа ровно из 3 цифр); запятая — десятичная. */
export function numbersIn(text: string): number[] {
  const out: number[] = [];
  const re = /(?<![\d.,])(?:\d{1,3}(?:[ \u00A0\u202F]\d{3}(?!\d))+(?:,\d+)?|\d{1,3}(?:\.\d{3}(?!\d))+|\d+(?:[.,]\d+)?)/g;
  for (const m of text.matchAll(re)) {
    const s = m[0];
    const grouped = /[ \u00A0\u202F]/.test(s) || /^\d{1,3}(?:\.\d{3})+$/.test(s);
    out.push(Number(grouped ? s.replace(/[ .\u00A0\u202F]/g, '').replace(',', '.') : s.replace(',', '.')));
  }
  return out;
}

/** Числа формальной части: численность, техника, потери. */
export function claimNumbers(c: Claim): number[] {
  const r = c as Record<string, unknown>;
  return ['personnel', 'tanks', 'guns', 'killed', 'wounded', 'missing', 'total'].map((k) => r[k]).filter((v): v is number => typeof v === 'number');
}

const worst = (rs: CheckResult[]): CheckResult['level'] => rs.some((r) => r.level === 'fail') ? 'fail' : rs.some((r) => r.level === 'doubt') ? 'doubt' : 'ok';
const ok = (check: CheckResult['check']): CheckResult => ({ check, level: 'ok' });
const res = (check: CheckResult['check'], level: CheckResult['level'], why: string): CheckResult => ({ check, level, why });

const normName = (x: string) => x.toLowerCase().replace(/ё/g, 'е').replace(/[«»"“”„'’`()]/g, ' ').replace(/[\s\-–—_.]+/g, ' ').trim();

/** 1. Цитата на месте. */
function checkQuote(c: Candidate, ctx: CheckCtx): CheckResult {
  const e = c.evidence;
  switch (e.kind) {
    case 'quote':
      if (ctx.text == null) return res('quote', 'doubt', 'текст части документа недоступен');
      return quoteFound(e.quote, ctx.text) ? ok('quote') : res('quote', 'fail', 'цитата не найдена в тексте документа');
    case 'scan': {
      if (ctx.transcript == null) return res('quote', 'doubt', 'расшифровка скана недоступна');
      if (!quoteFound(e.quote, ctx.transcript)) return res('quote', 'fail', 'цитаты нет в расшифровке страницы');
      return /\d\s?\?|\?\s?\d/.test(e.quote) ? res('quote', 'doubt', 'в числах цитаты есть «?» — цифры прочитаны неуверенно') : ok('quote');
    }
    case 'row':
      return ctx.rowExists ? ok('quote') : res('quote', 'fail', 'строки таблицы нет');
    case 'agent':
      return e.quote || e.ref ? ok('quote') : res('quote', 'doubt', 'ни выписки, ни ссылки на документ');
    default:
      return ok('quote');
  }
}

/** Текст, в котором должны стоять числа факта. */
function evidenceText(c: Candidate): string {
  const e = c.evidence;
  return e.kind === 'row' ? Object.values(e.cells).join(' ') : e.kind === 'manual' ? '' : e.quote ?? '';
}

/** 2. Числа факта есть в цитате. */
function checkNumbers(c: Candidate): CheckResult {
  const e = c.evidence;
  // выписки нет, есть только ссылка на документ: числа сверить не с чем
  if (e.kind === 'agent' && !e.quote) return res('numbers', 'doubt', 'выписки нет — числа не сверены');
  // строка таблицы: числа — по ячейкам (соседние ячейки «310», «640» в одной строке не разряды одного числа);
  // день в столбцах — только ячейка этого дня и столбцы не-дни, а не числа соседних дней
  const own = e.kind === 'row' && e.cell != null ? [e.cell].flat() : null;
  const rowCells = e.kind === 'row'
    ? Object.entries(e.cells).filter(([k]) => !own || own.includes(k) || !(e.dayCells ?? []).includes(k)).map(([, v]) => v)
    : null;
  const have = new Set(rowCells ? rowCells.flatMap(numbersIn) : numbersIn(evidenceText(c)));
  const miss = claimNumbers(c.claim).filter((n) => !have.has(n));
  // скан: «?» у цифры — цифры неразборчивы, число не найдено не из-за ошибки извлечения, а из-за плохого чтения
  if (miss.length && e.kind === 'scan' && /\d\s?\?|\?\s?\d/.test(e.quote)) return res('numbers', 'doubt', 'цифры помечены как неразборчивые');
  return miss.length ? res('numbers', 'fail', `в цитате нет числа: ${miss.join(', ')}`) : ok('numbers');
}

/**
 * Сопоставить название с соединением сценария или записью базы: id соединения сценария или причина сомнения. loose —
 * найдено только по сходству основ слов (не точное название, синоним или номер): id ставится, но проверка — сомнение.
 * Соединение — всегда id сценария (su_1bf), а не id записи (f:su_1bf): найдена запись — берётся её синоним-id
 * сценария; у записи его нет — соединение не ставится (сомнение «запись базы без соединения сценария»).
 */
function matchName(name: string, ctx: CheckCtx): { id: string; loose?: string } | { why: string } {
  const f = matchFormation(name, ctx.formations, ctx.entries);
  if (f) return { id: f };
  const n = normName(name);
  const similar = (title: string) => normName(title) === n || stemSimilarity(name, title) > 0;
  const hitEntries = ctx.entries.filter((e) => e.category === 'formations' && [e.title, ...(e.aliases ?? [])].some(similar));
  const hitForms = ctx.formations.filter((x) => similar(x.name));
  const titles = [...new Set([...hitEntries.map((e) => e.title), ...hitForms.map((x) => x.name)])];
  if (titles.length > 1) return { why: `«${name}» подходит к нескольким: ${titles.join('; ')}` };
  const one = matchEntryHow(ctx.entries, 'formations', name, []);
  const loose = (title: string) => `сопоставлено по сходству названия: «${name}» → «${title}» — проверьте`;
  const noScenario = (e: Entry) => ({ why: `«${name}» → запись базы «${e.title}» без соединения сценария — укажите соединение` });
  if (one) {
    const id = ctx.formations.find((x) => (one.entry.aliases ?? []).includes(x.id))?.id ?? scenarioIdOf(one.entry);
    if (!id) return noScenario(one.entry);
    return one.exact ? { id } : { id, loose: loose(one.entry.title) };
  }
  const exactName = (t: string) => normName(t) === n;
  if (hitEntries.length === 1) {
    const e = hitEntries[0], id = scenarioIdOf(e);
    if (!id) return noScenario(e);
    return [e.title, ...(e.aliases ?? [])].some(exactName) ? { id } : { id, loose: loose(e.title) };
  }
  if (hitForms.length === 1) { const x = hitForms[0]; return exactName(x.name) ? { id: x.id } : { id: x.id, loose: loose(x.name) }; }
  return { why: `«${name}» не найдено среди соединений` };
}

/** 3. Соединение сопоставлено ровно с одним; id записывается в claim (у переправы — её название, у события — нет). */
function checkSubject(c: Candidate, ctx: CheckCtx): CheckResult | null {
  const cl = c.claim as Record<string, unknown>;
  const whys: string[] = [];
  const set = (field: string, name: string | undefined) => {
    if (name) {
      const m = matchName(name, ctx);
      if ('id' in m) { cl[field] = m.id; if (m.loose) whys.push(m.loose); } else whys.push(m.why);
    } else if (!cl[field]) whys.push(`не указано: ${field === 'parent' ? 'вышестоящий' : 'соединение'}`);
  };
  // событие — не о соединении: сопоставление не выполняется
  if (c.claim.kind === 'event') return null;
  // переправа — о мосте, не о соединении: claim.subject — её название (мост театра находит сборщик по названию)
  if (c.claim.kind === 'crossing') {
    const name = (c.names.subject ?? '').trim() || c.claim.subject.trim();
    c.claim.subject = name;
    return name ? ok('subject') : res('subject', 'doubt', 'не названа переправа');
  }
  if (c.claim.kind === 'boundary') {
    const b = c.claim.between;
    [0, 1].forEach((i) => {
      const name = c.names.between?.[i];
      if (name) { const m = matchName(name, ctx); if ('id' in m) { b[i] = m.id; if (m.loose) whys.push(m.loose); } else whys.push(m.why); }
      else if (!b[i]) whys.push('не указано: объединение линии');
    });
  } else {
    set('subject', c.names.subject);
    if (c.claim.kind === 'parent') set('parent', c.names.parent);
  }
  return whys.length ? res('subject', 'doubt', whys.join('; ')) : ok('subject');
}

/** 4. Место найдено на театре (или даны координаты). */
function checkPlace(c: Candidate, ctx: CheckCtx): CheckResult | null {
  let names: string[];
  if (c.claim.kind === 'position') {
    if (c.claim.lngLat) return ok('place');
    const p = c.names.place ?? c.claim.place;
    if (!p) return res('place', 'doubt', 'место не указано');
    names = [p];
  } else if (c.claim.kind === 'boundary') names = c.claim.points;
  else return null;
  if (!ctx.theatre) return res('place', 'doubt', 'театр недоступен — место не проверено');
  const lost = names.filter((p) => !ctx.theatre!.locate(p));
  return lost.length ? res('place', 'doubt', `нет на театре: ${lost.join(', ')}`) : ok('place');
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/;
/** Дата ISO (день или момент) → миллисекунды, иначе null. Несуществующий день (13-й месяц) — не дата. */
function parseIso(s: unknown): number | null {
  if (typeof s !== 'string') return null;
  const m = ISO.exec(s);
  if (!m) return null;
  const [y, mo, d, h = 0, mi = 0, se = 0] = m.slice(1).map((x) => (x == null ? 0 : Number(x)));
  const t = Date.UTC(y, mo - 1, d, h, mi, se);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d || h > 23 || mi > 59 || se > 59) return null;
  return t;
}

/** Даты формальной части: at / from / to. */
function claimDates(c: Claim): string[] {
  const r = c as Record<string, unknown>;
  return ['at', 'from', 'to'].map((k) => r[k]).filter((v): v is string => typeof v === 'string');
}

/** 5. Дата: ISO; в пределах операции (от начала минус 7 суток до конца). */
function checkDate(c: Candidate, ctx: CheckCtx): CheckResult | null {
  const ds = claimDates(c.claim);
  if (!ds.length) return null;
  const bad = ds.filter((d) => parseIso(d) == null);
  if (bad.length) return res('date', 'fail', bad.every((d) => !d) ? 'даты нет' : `не дата: ${bad.filter(Boolean).join(', ') || 'пусто'}`);
  if (!ctx.op) return ok('date');
  const s = parseIso(ctx.op.start), e = parseIso(ctx.op.end);
  if (s == null || e == null) return ok('date');
  const lo = Math.floor(s / DAY) * DAY - 7 * DAY, hi = Math.floor(e / DAY) * DAY + DAY - 1;
  const out = ds.filter((d) => { const t = parseIso(d)!; return t < lo || t > hi; });
  return out.length ? res('date', 'doubt', `вне операции (${ctx.op.start.slice(0, 10)} — ${ctx.op.end.slice(0, 10)}, с запасом 7 суток до начала): ${out.join(', ')}`) : ok('date');
}

/** Ступени по старшинству (для проверки «вышестоящий выше»). */
const LEVEL: Record<string, number> = { brigade: 0, division: 1, corps: 2, army: 3, front: 4, army_group: 4 };

/** 6. Правдоподобие: численность по ступени, потери и пополнение — в долях численности, подчинённость — по ступеням. */
function checkPlausible(c: Candidate, ctx: CheckCtx): CheckResult | null {
  const cl = c.claim;
  if (cl.kind !== 'strength' && cl.kind !== 'reinforce' && cl.kind !== 'losses' && cl.kind !== 'parent') return null;
  const f = ctx.formations.find((x) => x.id === cl.subject);
  const whys: string[] = [];
  if (cl.kind === 'strength') {
    const lim = f?.echelon ? PLAUSIBLE.strength[f.echelon] : undefined;
    if (cl.personnel != null && lim != null && cl.personnel > lim) whys.push(`численность ${cl.personnel} выше предела ${lim} для ступени «${f!.echelon}»`);
  } else if (cl.kind === 'parent') {
    const p = ctx.formations.find((x) => x.id === cl.parent);
    const a = f?.echelon ? LEVEL[f.echelon] : undefined, b = p?.echelon ? LEVEL[p.echelon] : undefined;
    if (a != null && b != null && b <= a) whys.push(`вышестоящий («${p!.echelon}») не выше по ступени, чем соединение («${f!.echelon}»)`);
  } else {
    const at = cl.kind === 'losses' ? cl.from : cl.at;
    const str = ctx.strengthOf(cl.subject, at) ?? f?.personnel ?? null;
    if (str != null && str > 0) {
      if (cl.kind === 'reinforce') {
        if (cl.personnel != null && cl.personnel > str * PLAUSIBLE.reinforceShare) whys.push(`пополнение ${cl.personnel} больше половины численности ${str}`);
      } else {
        const total = cl.total ?? ((cl.killed ?? 0) + (cl.wounded ?? 0) + (cl.missing ?? 0));
        if (total > str) whys.push(`потери ${total} больше численности ${str}`);
        const t0 = parseIso(cl.from), t1 = parseIso(cl.to);
        if (t0 != null && t1 != null) {
          const days = Math.max(1, (t1 - t0) / DAY);
          if (total / days > str * PLAUSIBLE.dailyLossShare) whys.push(`потери за сутки ${Math.round(total / days)} больше трети численности ${str}`);
        }
      }
    }
  }
  return whys.length ? res('plausible', 'doubt', whys.join('; ')) : ok('plausible');
}

const claimFp = (c: Claim) => fingerprint({ key: '', value: '', claim: c });
/**
 * Тот же факт по формальной части: кандидат (как извлечён) и факт базы (как записан). Положение по названию места
 * при приёме получает координаты с театра — у кандидата без координат они при сравнении не учитываются.
 */
export function sameClaim(cand: Claim, stored: Claim): boolean {
  if (cand.kind === 'position' && stored.kind === 'position' && !cand.lngLat) {
    const { lngLat: _l, ...rest } = stored;
    return claimFp(cand) === claimFp(rest);
  }
  return claimFp(cand) === claimFp(stored);
}

/** 7. Повтор: тот же claim от того же источника уже в базе. */
function checkDuplicate(c: Candidate, ctx: CheckCtx): CheckResult {
  const dup = ctx.existing.some((f) => f.claim && f.source === c.source && sameClaim(c.claim, f.claim));
  return dup ? res('duplicate', 'fail', 'тот же факт из того же источника уже в базе') : ok('duplicate');
}

/**
 * Проверки 1–7. Соединение (3) выполняется первым из-за id в claim, но в итогах идёт в порядке нумерации;
 * при однозначном сопоставлении id записывается в c.claim. Ручная правка проходит проверки 3–7.
 */
export function runChecks(c: Candidate, ctx: CheckCtx): CheckResult[] {
  const subject = checkSubject(c, ctx);
  const manual = c.origin === 'manual' || c.evidence.kind === 'manual';
  return [
    ...(manual ? [] : [checkQuote(c, ctx), checkNumbers(c)]),
    ...(subject ? [subject] : []),
    ...[checkPlace(c, ctx), checkDate(c, ctx), checkPlausible(c, ctx)].filter((r): r is CheckResult => r != null),
    checkDuplicate(c, ctx),
  ];
}

/** Итог: есть fail — отбой, иначе есть doubt — в очередь, иначе — в базу. */
export function verdictOf(results: CheckResult[]): Candidate['verdict'] {
  const w = worst(results);
  return w === 'fail' ? 'drop' : w === 'doubt' ? 'review' : 'auto';
}
