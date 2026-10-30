/**
 * Разбор хода в окне (часть «Ход» вкладки «Итоги»): выбор «разобрать с позиции …» — верхняя инстанция и дерево своих
 * штабов; карта события (переезд, метка, рамка); строки события «что / где / почему / что значит»; вход для связного
 * текста модели по тем же фактам и проверка ответа (ни одного числа, которого нет во входе). Чистые функции.
 */
import { debriefFor, RUMB_TO, type CommandTerms, type DebriefHq, type KeyEvent, type TurnDebrief } from '@def-ops/sim';
import type { TourMap } from './voice/tours';
import { placeGen } from './voice/speech';

export interface PerspectiveOption { id: string | null; label: string; depth: number; note: string | null }

const NOTE: Record<DebriefHq['state'], string | null> = { line: null, removed: 'снят с операции', destroyed: 'разгромлен' };

/** «Разобрать с позиции …»: первая — верхняя инстанция, дальше свои штабы деревом (фронт → армия → корпус). */
export function perspectiveOptions(d: TurnDebrief, terms: CommandTerms): PerspectiveOption[] {
  const all = Object.values(d.hqs);
  const kids = new Map<string | null, DebriefHq[]>();
  for (const x of all) {
    const p = x.parent && d.hqs[x.parent] ? x.parent : null;
    kids.set(p, [...(kids.get(p) ?? []), x]);
  }
  const out: PerspectiveOption[] = [{ id: null, label: terms.top, depth: 0, note: null }];
  const walk = (p: string | null, depth: number) => {
    for (const x of kids.get(p) ?? []) {
      out.push({ id: x.id, label: x.name, depth, note: NOTE[x.state] });
      walk(x.id, depth + 1);
    }
  };
  walk(null, 1);
  return out;
}

/** Карта события: переезд к месту (вместе с началом и концом стрелки), метка, рамка; взятие пункта — уровень армии. */
export function eventMap(e: KeyEvent): TourMap {
  const fit = [e.at, e.from, e.to].filter((p): p is NonNullable<typeof p> => !!p);
  return { at: e.at, level: e.kind === 'capture' ? 'army' : 'division', fit, spot: e.at, ...(fit.length > 1 ? { box: fit } : {}) };
}

/**
 * Место словами для показа: без латинского названия в скобках, пункт — в родительном падеже («у Зеелова»), румб —
 * полными словами, как в тексте события («к юго-востоку»).
 */
export function placeWords(p: string): string {
  return p.replace(/\s*\([^)]*\)/g, '').replace(/ к (С|СВ|В|ЮВ|Ю|ЮЗ|З|СЗ) от /, (_m, r: string) => ` к ${RUMB_TO[r]} от `)
    .replace(/^(у |.* от )(.+)$/, (_m, a: string, n: string) => a + placeGen(n));
}

const r1 = (x: number) => Math.round(x * 10) / 10;
/** Км: меньше 10 — с десятыми, дальше — целые. */
const fmtKm = (x: number) => String(x < 10 ? r1(x) : Math.round(x)).replace('.', ',');
/** Целое с пробелами между разрядами. */
const fmtN = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const pad = (n: number) => String(n).padStart(2, '0');
/** Время часа хода ядра по разбору: d.time — время часа d.to. */
export function tickTime(d: TurnDebrief, tick: number): string {
  const t = new Date(Date.parse(`${d.time}Z`) - (d.to - tick) * 3.6e6);
  return `${pad(t.getUTCDate())}.${pad(t.getUTCMonth() + 1)} ${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`;
}
const goalName = (title: string) => placeGen(title.replace(/\s*\([^)]*\)/g, '').trim());

/** «до Берлина 42 км, за ход ближе на 9 км» — цель штаба; нет цели — null. */
export function goalLine(x: DebriefHq | null): string | null {
  if (!x?.goal || x.goal.kmAfter == null) return null;
  const dd = x.goal.kmBefore == null ? null : x.goal.kmBefore - x.goal.kmAfter;
  return `до ${goalName(x.goal.title)} ${fmtKm(x.goal.kmAfter)} км${dd == null ? '' : Math.abs(dd) < 0.5 ? ', за ход — на прежнем удалении' : `, за ход ${dd > 0 ? 'ближе' : 'дальше'} на ${fmtKm(Math.abs(dd))} км`}`;
}

/** Оценка позиции (debriefFor().verdict) для показа: цель — в родительном падеже, без латинского названия. */
export function verdictLines(d: TurnDebrief, hq: string | null): string[] {
  const f = debriefFor(d, hq);
  return f.verdict.map((v) => (v.startsWith('до ') ? goalLine(f.hq) ?? v : v));
}

/** Строки «что значит» по виду события: своё (сторона разбора) и противника. */
const MEANING: Record<KeyEvent['kind'], [string, string]> = {
  breakthrough: ['оборона противника прорвана', 'угроза: противник прорвался'],
  encirclement: ['угроза окружения своих войск', 'противник отрезан — котёл'],
  capture: ['объект взят', 'пункт занят противником'],
  counterattack: ['свой контрудар', 'угроза: контрудар противника'],
  withdrawal: ['свои войска отходят', 'противник отходит'],
  destroyed: ['свои соединения выбыли', 'соединения противника разгромлены'],
};

/** Строки события: что, где, почему (причины с часом и штабом), что значит для выбранной позиции (null — верхняя инстанция). */
export function eventLines(e: KeyEvent, d: TurnDebrief, hq: string | null): { what: string; where: string; why: string[]; meaning: string } {
  const own = e.side === d.side;
  const why = e.causes.length ? e.causes.map((c) => `${tickTime(d, c.tick)}, ${c.name}: ${c.text}`)
    : own ? ['причин в документах и решениях хода нет'] : ['решения противника известны только посреднику'];
  const x = hq ? d.hqs[hq] ?? null : null;
  const meaning = [
    MEANING[e.kind][own ? 0 : 1] + (own && e.km != null && (e.kind === 'breakthrough' || e.kind === 'withdrawal') ? ` — на ${fmtKm(e.km)} км` : ''),
    goalLine(x),
    e.lost > 0 ? `потери ${fmtN(e.lost)} человек` : null,
  ].filter(Boolean).join('; ');
  return { what: e.text, where: placeWords(e.place ?? ''), why, meaning };
}

/** Ход без событий одной строкой: продвижение и потери своих. */
export function quietLine(d: TurnDebrief): string {
  return `Наибольшее смещение своих дивизий — ${fmtKm(d.quiet.maxAdvanceKm)} км, потери за ход — ${fmtN(d.quiet.lost)} человек.`;
}

/** Модель посредника: связный разбор хода по фактам входа, ничего сверх них. */
export const DEBRIEF_SYSTEM = [
  'Ты — посредник штабной игры. Напиши связный разбор прошедшего хода с позиции, указанной во входе, по фактам ниже и только по ним.',
  'Не добавляй новых чисел, дат, названий пунктов и соединений — только те, что есть во входе; не выдумывай причин.',
  'Скажи, что случилось, где, почему и что это значит для задачи этой позиции. 5–8 фраз, по-русски, обычным текстом без разметки и списков.',
].join(' ');

/**
 * Вход модели: позиция, окно хода, оценка позиции, события с местом, причинами и смыслом (или «ключевых событий нет»);
 * top — верхняя инстанция словом стороны (terms.top).
 */
export function debriefInput(d: TurnDebrief, hq: string | null, names: Record<string, string>, top?: string): string {
  const f = debriefFor(d, hq);
  const who = hq == null ? (top ?? (d.side === 'de' ? 'ОКХ' : 'Ставка')) : names[hq] ?? d.hqs[hq]?.name ?? hq;
  const lines = [`Позиция: ${who}.`, `Ход: ${tickTime(d, d.from)} — ${tickTime(d, d.to)}.`];
  const verdict = verdictLines(d, hq);
  if (verdict.length) lines.push(`Оценка позиции: ${verdict.join('; ')}.`);
  if (!f.events.length) {
    lines.push(`За ход ключевых событий нет. ${quietLine(d)}`);
    return lines.join('\n');
  }
  lines.push('События хода:');
  f.events.forEach((e, i) => {
    const l = eventLines(e, d, hq);
    lines.push(`${i + 1}. ${e.title} (${tickTime(d, e.tick)}). ${l.what} Где: ${l.where}. Почему: ${l.why.join('; ')}. Что значит: ${l.meaning}.`);
  });
  return lines.join('\n');
}

/** Числа текста: разряды через пробел сведены, десятичная запятая — как точка. */
const numbers = (s: string) => (s.replace(/(\d)[\s  ](?=\d{3}(?!\d))/g, '$1').match(/\d+(?:[.,]\d+)?/g) ?? []).map((x) => x.replace(',', '.'));

/** Ответ модели годится: не пуст и каждое его число есть во входе. */
export function narrativeFits(text: string, input: string): boolean {
  if (!text.trim()) return false;
  const have = new Set(numbers(input));
  return numbers(text).every((x) => have.has(x));
}

export type NarrativeState = { state: 'off' } | { state: 'wait' } | { state: 'ready'; text: string } | { state: 'unfit' } | { state: 'error'; text: string };

/**
 * Ключ сброса разбора в игре: время хода и номер линии (возврат к ходу, переход на ветвь, новый проект хода — номер
 * растёт). Одно время на разных линиях — разные ходы: позиция, раскрытое событие и связный текст прежней линии не
 * переходят на новую.
 */
export function debriefResetKey(time: string, epoch: number): string {
  return `${epoch}|${time}`;
}

/** Состояние разбора: ключ, при котором выбраны позиция и событие, и связный текст модели по (ключу, позиции). */
export interface DebriefUi { key: string; hq: string | null; open: number | null; narr: { key: string; s: NarrativeState } }

/** Что показать при ключе resetKey: выбранное при другом ключе — снято (позиция — верхняя инстанция, текст — нет). */
export function debriefShown(st: DebriefUi, resetKey: string): { hq: string | null; open: number | null; narrative: NarrativeState } {
  const same = st.key === resetKey;
  const hq = same ? st.hq : null;
  const k = `${resetKey}|${hq ?? ''}`;
  return { hq, open: same ? st.open : null, narrative: st.narr.key === k ? st.narr.s : { state: 'off' } };
}
