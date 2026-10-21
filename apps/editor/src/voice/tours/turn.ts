/**
 * Разбор прошедшего хода на карте — тур посредника (спецификация «Голос», 3.8). Шаги — из данных хода (TurnView и
 * обстановка до него): общее (карта проигрывает ход: движение войск, линия фронта, зоны влияния), главные бои (карта
 * переезжает к месту боя, метка и рамка вокруг участников; кто с кем, исход, наши потери словами), продвижение к
 * целям, важное в тылу (отрезанные, переправы, ввод резервов), что известно о противнике — только то, что видит своя
 * разведка: на карте нет мест противника сверх разведсводки (бой — соприкосновение: участники называются, но место
 * необнаруженного не показывается).
 *
 * Текст шага — по правилам (готов к озвучке: числа словами) или моделью: один запрос на весь разбор (reviewInput),
 * ответ — пронумерованные тексты по шагам (reviewFromModel). Чистый модуль (без React).
 */
import type { LngLat } from '@def-ops/core';
import type { TurnBattle, UnitReport } from '@def-ops/sim';
import type { TurnView } from '../../sim/game-protocol';
import { dayMonth, sentence, short } from '../report';
import { cardinalGen, nameCase, numberWords, placeGen, plural, speakable } from '../speech';
import type { Tour, TourMap } from './index';

export const REVIEW_TOUR = 'turn-review';
/** Главных боёв в разборе. */
export const REVIEW_BATTLES = 3;

export type ReviewKind = 'outcome' | 'overview' | 'battle' | 'goal' | 'rear' | 'enemy';
export interface ReviewStep {
  kind: ReviewKind;
  title: string;
  /** Данные шага для модели (числа цифрами). */
  facts: string;
  /** Текст по правилам — готов к озвучке. */
  text: string;
  map: TourMap;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** Предложения после озвучки — каждое с заглавной («шестьдесят девятая армия…» в начале фразы). */
const say = (t: string) => speakable(t, { full: true }).replace(/(^|[.!?…]\s+)(\p{Ll})/gu, (_m, a: string, b: string) => a + b.toUpperCase());
const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} и ${xs[xs.length - 1]}`);
/** «ещё двух соединений» (родительный) / «ещё два соединения» (именительный, винительный). */
const more = (n: number, c?: 'gen' | 'acc') => {
  const noun = plural(n, ['соединение', 'соединения', 'соединений']);
  return c === 'gen' ? `${cardinalGen(n) ?? n} ${n % 10 === 1 && n % 100 !== 11 ? 'соединения' : 'соединений'}` : `${numberWords(n, 'n')} ${noun}`;
};
const names = (xs: { name: string }[], c?: 'gen' | 'acc') => {
  const n = xs.slice(0, 2).map((x) => (c ? nameCase(short(x.name), c) : short(x.name)));
  return xs.length > 2 ? `${n.join(', ')} и ещё ${more(xs.length - 2, c)}` : list(n);
};
const RUMB: Record<string, [string, string]> = {
  С: ['северу', 'севернее'], СВ: ['северо-востоку', 'северо-восточнее'], В: ['востоку', 'восточнее'], ЮВ: ['юго-востоку', 'юго-восточнее'],
  Ю: ['югу', 'южнее'], ЮЗ: ['юго-западу', 'юго-западнее'], З: ['западу', 'западнее'], СЗ: ['северо-западу', 'северо-западнее'],
};
/** Ближе этого, км, — «южнее Зелова», дальше — «в 15 км к югу от Зелова». */
const NEAR_KM = 12;
/**
 * «8,4 км к СВ от Зелова (Seelow)» → «северо-восточнее Зелова»; «15 км к Ю от …» → «в 15 км к югу от …» (для речи —
 * без «в»: озвучка не склоняет число после предлога — «пятнадцать километров к югу от …»).
 */
const placeText = (p: string, prep = true) => p.replace(/\s*\([^)]*\)/g, '').replace(/^(у |[\d,]+ км к (?:СВ|СЗ|ЮВ|ЮЗ|С|В|Ю|З) от )(.+)$/, (_m, a: string, n: string) => a + placeGen(n)).replace(/^([\d,]+) км к (СВ|СЗ|ЮВ|ЮЗ|С|В|Ю|З) от /, (_m, km: string, r: string) => {
  const d = Math.round(+km.replace(',', '.'));
  return d < NEAR_KM ? `${RUMB[r][1]} ` : `${prep ? 'в ' : ''}${d} км к ${RUMB[r][0]} от `;
});
/** «Переправа у Кюстрина» → «у Кюстрина». */
const bridgeName = (n: string) => n.replace(/^переправа\s+/i, '');
const goalName = (title: string) => title.split(':')[0].trim();
const times = (n: number) => `${n} ${plural(n, ['раз', 'раза', 'раз'])}`;
const pct = (x: number) => `${Math.round(x * 100)} %`;
const hour = (t: string) => `${+t.slice(11, 13)}:${t.slice(14, 16)}`;
const ms = (t: string) => Date.parse(`${t}Z`);
const iso = (n: number) => new Date(n).toISOString().slice(0, 16);

/** Важность боя: исход, потери. */
const weight = (b: TurnBattle) => ({ breakthrough: 4, advance: 3, repelled: 2, held: 2 }[b.outcome] + b.ownLossPct / 5 + (b.role === 'defend' && (b.outcome === 'breakthrough' || b.outcome === 'advance') ? 1.5 : 0));
/** Главные бои: два важнейших и важнейшая атака противника (если её нет среди них), иначе — третий по важности. */
function mainBattles(bs: TurnBattle[]): TurnBattle[] {
  const s = [...bs].sort((a, b) => weight(b) - weight(a));
  const top = s.slice(0, REVIEW_BATTLES - 1);
  const def = s.find((b) => b.role === 'defend' && !top.includes(b));
  const third = def ?? s[REVIEW_BATTLES - 1];
  return third ? [...top, third] : top;
}

const OUR_ATTACK = { breakthrough: 'прорыв', advance: 'продвижение', held: 'противник удержал позиции', repelled: 'наша атака отбита' } as const;
const THEIR_ATTACK = { breakthrough: 'противник прорвал оборону', advance: 'противник потеснил наши части', held: 'оборона удержана', repelled: 'атака отбита' } as const;

function battleStep(v: TurnView, b: TurnBattle): ReviewStep {
  const where = cap(placeText(b.place, false));
  const km = Math.round(b.advanceKm);
  const gained = b.outcome === 'breakthrough' || b.outcome === 'advance';
  const res = b.role === 'attack' ? OUR_ATTACK[b.outcome] : THEIR_ATTACK[b.outcome];
  const loss = b.ownLossPct < 0.5 ? 'потери участвовавших незначительны' : `потери — около ${Math.round(b.ownLossPct)} % участвовавших`;
  const raw = b.role === 'attack'
    ? `${where} — наступление ${names(b.own, 'gen')} против ${names(b.enemy, 'gen')}: ${res}${gained && km ? ` на ${km} км` : ''}; ${loss}.`
    : `${where} противник атаковал ${names(b.own, 'acc')} — ${names(b.enemy)}; ${res}${gained && km ? ` на ${km} км` : ''}; ${loss}.`;
  // рамка — место боя, свои участники и тот противник, которого видит разведка (место прочих не показывается)
  const box: LngLat[] = [b.at, ...b.own.flatMap((x) => { const u = v.own.find((o) => o.id === x.id); return u ? [u.at] : []; }),
    ...b.enemy.flatMap((x) => { const e = v.intel.find((o) => o.id === x.id); return e ? [e.at] : []; })];
  return {
    kind: 'battle', title: `Бой ${placeText(b.place)}`, text: say(raw), map: { at: b.at, level: 'tac', fit: box, spot: b.at, box },
    facts: `${b.role === 'attack' ? 'Наше наступление' : 'Атака противника'} ${placeText(b.place)} в ${hour(b.time)}: свои — ${b.own.map((x) => x.name).join(', ')}; противник — ${b.enemy.map((x) => x.name).join(', ')}; исход — ${res}${km ? `, ${km} км` : ''}; потери — ${b.ownLossPct} % от участвовавших в бою.`,
  };
}

const onMap = (u: UnitReport) => u.status === 'active';

/** Шаги разбора хода v (prev — обстановка на начало хода; нет — ход проигрывается от v.time − длины хода). */
export function turnReview(v: TurnView, prev: TurnView | null): ReviewStep[] {
  const from = prev?.time ?? iso(ms(v.time) - v.turnHours * 3_600_000);
  const own = v.own.filter(onMap);
  const before = new Map((prev?.own ?? []).map((u) => [u.id, u]));
  const out: ReviewStep[] = [];
  const all: LngLat[] = [...own.map((u) => u.at), ...v.battles.map((b) => b.at)];

  if (v.over && v.outcome) {
    const t = `Игра окончена: ${v.outcome.result === 'victory' ? 'победа' : 'поражение'}. ${v.outcome.text}`;
    const g = v.goals.find((x) => x.at && x.at === v.outcome!.at && x.place);
    out.push({ kind: 'outcome', title: 'Итог игры', text: say(t), facts: t, map: g?.place ? { at: g.place, level: 'op', spot: g.place } : { fit: all, level: 'auto' } });
  }

  // общее: что изменилось за ход — карта проигрывает ход
  const far = [...own].sort((a, b) => b.movedKm - a.movedKm)[0];
  const att = v.battles.filter((b) => b.role === 'attack'), won = att.filter((b) => b.outcome === 'breakthrough' || b.outcome === 'advance');
  const def = v.battles.filter((b) => b.role === 'defend');
  const lost = prev && Math.round((prev.strength - v.strength) * 100) >= 1 ? `, за ход потеряно ${pct(prev.strength - v.strength)}` : '';
  const overview = [
    `Итоги хода на ${+v.time.slice(11, 13)} ч ${dayMonth(v.time)}.`,
    far && far.movedKm >= 1 ? `Войска продвинулись до ${Math.round(far.movedKm)} км, дальше всех — ${short(far.name)}.` : 'Войска остались на прежних рубежах.',
    v.battles.length
      ? `Боёв за ход — ${v.battles.length}: наступали мы ${times(att.length)}, успешно — ${won.length}${def.length ? `; противник атаковал ${times(def.length)}` : ''}.`
      // боёв с местом нет (агентная модель их не отдаёт) — главное из донесений
      : v.events.length ? `Главное из донесений: ${sentence(v.events[0])}` : 'За ход боёв не было.',
    `В строю ${pct(v.strength)} исходной численности${lost}.`,
  ].join(' ');
  out.push({ kind: 'overview', title: 'Ход в целом', text: say(overview), facts: overview, map: { fit: all, level: 'auto', play: [from, v.time] } });

  // главные бои
  for (const b of mainBattles(v.battles)) out.push(battleStep(v, b));

  // продвижение к целям: достигнутое за ход или следующая цель
  const reached = v.goals.filter((g) => g.simulated && (!prev || !prev.goals.find((p) => p.title === g.title)?.simulated));
  const next = v.goals.find((g) => !g.simulated);
  if (reached.length) {
    const t = `Достигнуто за ход: ${list(reached.map((g) => goalName(g.title)))}.${reached[0].days != null && reached[0].days < 0 ? ` Это на ${-reached[0].days} дн. раньше, чем в истории.` : ''}`;
    const at = reached.find((g) => g.place)?.place;
    out.push({ kind: 'goal', title: 'Цели операции', text: say(t), facts: t, map: at ? { at, level: 'op', spot: at } : { fit: all, level: 'auto' } });
  } else if (next && !v.over) {
    const t = `Следующая цель — ${goalName(next.title)}; в истории — ${dayMonth(next.historical)}.`;
    out.push({ kind: 'goal', title: 'Цели операции', text: say(t), facts: t, map: next.place ? { fit: [next.place, ...own.map((u) => u.at)], level: 'op', spot: next.place } : { fit: all, level: 'auto' } });
  }

  // тыл: отрезанные, новые переправы, ввод резервов
  const cut = own.filter((u) => u.cutOff && !before.get(u.id)?.cutOff);
  const bridges = v.bridges.filter((b) => b.openFrom && b.openFrom > from && b.openFrom <= v.time);
  const entered = own.filter((u) => { const p = before.get(u.id); return p && (p.status === 'reserve' || p.status === 'arriving'); });
  const rear: { text: string; at: LngLat[] }[] = [
    cut.length ? { text: `Отрезаны от подвоза: ${names(cut)}.`, at: cut.map((u) => u.at) } : null,
    bridges.length ? { text: bridges.length === 1 ? `Действует новая переправа ${bridgeName(bridges[0].name)}.` : `Действуют новые переправы: ${list(bridges.map((b) => bridgeName(b.name)))}.`, at: bridges.map((b) => b.at) } : null,
    entered.length ? { text: `Введены в бой: ${names(entered)}.`, at: entered.map((u) => u.at) } : null,
  ].filter((x): x is { text: string; at: LngLat[] } => !!x);
  if (rear.length) {
    const t = rear.map((x) => x.text).join(' ');
    const at = rear.flatMap((x) => x.at);
    out.push({ kind: 'rear', title: 'Тыл', text: say(t), facts: t, map: at.length === 1 ? { at: at[0], level: 'tac', spot: at[0] } : { fit: at, level: 'tac', spot: at[0] } });
  }

  // противник — только по разведке: новые обнаруженные и его атаки
  const fresh = v.intel.filter((e) => e.fresh);
  if (fresh.length || def.length) {
    const t = [
      fresh.length ? `Разведка обнаружила: ${fresh.slice(0, 2).map((e) => `${short(e.name)} ${placeText(e.place, false)} — ${e.estimate.split(',')[0]}`).join('; ')}${fresh.length > 2 ? `; и ещё ${more(fresh.length - 2)}` : ''}.` : 'Новых сил противника разведка не обнаружила.',
      def.length ? `Противник атаковал ${times(def.length)}${def.some((b) => b.outcome === 'breakthrough' || b.outcome === 'advance') ? ' и местами потеснил наши части' : def.length === 1 ? ', атака отбита' : ', атаки отбиты'}.` : 'Противник не атаковал.',
    ].join(' ');
    const at = [...fresh.map((e) => e.at), ...def.map((b) => b.at)];
    out.push({ kind: 'enemy', title: 'Противник', text: say(t), facts: t, map: at.length === 1 ? { at: at[0], level: 'op', spot: at[0] } : { fit: at, level: 'op', spot: at[0] } });
  }
  return out;
}

/** Тур разбора: шаги на карте, голос посредника; texts — тексты модели по шагам (нет — по правилам). */
export function reviewTour(steps: ReviewStep[], texts?: string[] | null): Tour {
  return {
    id: REVIEW_TOUR, section: 'replay', game: true, role: 'umpire', pauseOnCommand: true, title: 'Разбор хода',
    steps: steps.map((s, i) => ({ target: 'cmd-map', title: s.title, text: texts?.[i] ?? s.text, map: s.map })),
  };
}

/** Системный текст модели для разбора хода — от лица посредника. */
export const REVIEW_SYSTEM = [
  'Ты — посредник штабной игры по операции Великой Отечественной войны. После хода ты показываешь командующему на карте, что произошло за ход, по шагам.',
  'Для каждого шага напиши одну-три короткие фразы — что видно на карте на этом шаге. Только по данным шага, ничего не выдумывай.',
  'Ответ — столько же пунктов, сколько шагов, в том же порядке, каждый с новой строки: «1. …», «2. …». Других строк не пиши.',
  'Не раскрывай того, что не знает разведка: только данные ниже. Без разметки, английских слов и сокращений. Все числа и даты — словами.',
].join('\n');

/** Данные разбора для модели: обстановка коротко и шаги с их данными. */
export function reviewInput(v: TurnView, steps: ReviewStep[]): string {
  return [
    `Операция: ${v.scenarioName}. Ход ${v.turn - 1} закончен, время ${v.time.replace('T', ' ')}. Сторона командующего: ${v.human.name}.`,
    `Цель операции: ${v.victory}; предельный срок ${v.deadline.slice(0, 10)}.`,
    `Шагов: ${steps.length}.`,
    ...steps.map((s, i) => `Шаг ${i + 1} (${s.title}): ${s.facts}`),
  ].join('\n');
}

/** Ответ модели — тексты по шагам (к озвучке, не больше трёх фраз); не по шагам или пустой шаг — null. */
export function reviewFromModel(text: string, n: number): string[] | null {
  const items = new Map<number, string>();
  let cur = 0;
  for (const line of text.replace(/<think>[\s\S]*?<\/think>/g, '').split('\n')) {
    const m = /^\s*(?:\*\*)?(\d+)[.)](?:\*\*)?\s*(.*)$/.exec(line);
    if (m) { cur = +m[1]; items.set(cur, (items.get(cur) ?? '') + m[2]); } else if (cur && line.trim()) items.set(cur, `${items.get(cur)} ${line.trim()}`);
  }
  const out: string[] = [];
  for (let i = 1; i <= n; i++) {
    const t = say((items.get(i) ?? '').replace(/[*_#>`]+/g, ' ').replace(/\s+/g, ' ').trim());
    const ss = t.match(/[^.!?…]+[.!?…]+["»]?/g)?.map((x) => x.trim()) ?? [];
    if (!ss.length) return null;
    out.push(ss.slice(0, 3).join(' '));
  }
  return items.size >= n ? out : null;
}
