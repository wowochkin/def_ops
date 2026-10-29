/**
 * «Переигровка» и «Командование» голосом: действия реестра (кнопки и голос исполняют одно и то же) и разбор фраз с
 * параметрами без модели. Чистый модуль (без React): компоненты передают своё состояние через get() и регистрируют
 * действия (ReplayView — replayActions, CommandView — commandActions; карта — в LevelSwitch, LayersMenu, Legend,
 * SectorPicker).
 *
 * Раздел «Переигровка» остаётся смонтированным и в фоне: каждое действие проверяет, что раздел открыт (inReplay) и что
 * есть то, с чем работать (игра, расчёт, окно); иначе — причина простыми словами.
 *
 * Фразы (parseCommand, регистрируется в реестре при загрузке модуля): «рассчитай [берлинскую] операцию», «прими
 * командование [с восемнадцатого апреля]», «продолжи игру», «доложи обстановку», «подробнее», «что разведка»,
 * «доложи о восьмой гвардейской», «где восьмая гвардейская», «покажи Зелов», «открой приказы», «прочитай журнал
 * [за семнадцатое]», «оперативный уровень», «покажи / скрой реки», «участок Зееловские высоты», «весь театр»,
 * «приблизь», «отдали», «легенда», «покажи всех» / «верни туман войны», «выйди из игры», «заверши и удали игру».
 */
import { findLegendItem, shownLegend } from '../../map-legend';
import type { LngLat } from '@def-ops/core';
import type { MapEngine } from '../../engine/types';
import { showAt } from '../../engine/free-center';
import type { EnemyMode, TurnView } from '../../sim/game-protocol';
import { pickByName } from '../answers';
import { readAloud } from '../dictation';
import { findPlace, findUnit, parseRelative, resolveRelative } from '../places';
import { getAction, registerParser, type Action, type PhraseHit } from '../registry';
import { hl, btn, note, noted } from '../highlight';
import { dayMonth, enemyReport, groupReport, intelReport, journalDayText, moreText, short, situationReport, unitReport, whereText } from '../report';
import { ordinalWords, speakable } from '../speech';

// ---------------------------------------------------------------- раздел открыт?

let sectionNow = (): string => (typeof location === 'undefined' ? '' : location.hash.replace('#', ''));
/** Откуда брать открытый раздел (тесты; по умолчанию — адрес окна, его держит Shell). */
export function setSectionSource(f: () => string): void { sectionNow = f; }

export const NOT_IN_REPLAY = 'открыт другой раздел. Скажите: «Штаб, открой переигровку»';
export const NO_GAME = 'игра не идёт. Чтобы начать, скажите: «Штаб, открой переигровку», затем «рассчитай операцию» и «прими командование»';
export const NO_MAP = 'карта операции не открыта. Скажите: «Штаб, открой переигровку» и «рассчитай операцию»';

/** Раздел «Переигровка» открыт (не в фоне). */
export function inReplay(): true | string { return sectionNow() === 'replay' ? true : NOT_IN_REPLAY; }

// ---------------------------------------------------------------- слова

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
/** Основа слова: без окончания, не короче трёх и не длиннее пяти букв. */
const stem = (w: string) => w.slice(0, Math.max(3, Math.min(5, w.length - 1)));
const FILL = new Set(['пожалуйста', 'мне', 'нам', 'слой', 'на', 'карте', 'карту']);
const words = (s: string) => norm(s).split(' ').filter((w) => w && !FILL.has(w));

const MONTH_STEMS = ['январ', 'феврал', 'март', 'апрел', 'ма', 'июн', 'июл', 'август', 'сентябр', 'октябр', 'ноябр', 'декабр'];
/** Порядковые 1–31 по основам («шестнадцат», «двадцать перв»): длинные — первыми (не путать «пят» и «пятнадцат»). */
const ORD_STEMS: [string, number][] = Array.from({ length: 31 }, (_, i) => [ordinalWords(i + 1).replace(/(?:ый|ий|ой)$/, ''), i + 1] as [string, number])
  .sort((a, b) => b[0].length - a[0].length);

/** День (и месяц) из «за семнадцатое апреля», «с 18 апреля», «с двадцать первого»; нет — null. */
export function parseDay(text: string): { day: number; month?: number } | null {
  const t = norm(text);
  let day: number | undefined;
  const d = /(?:^| )(\d{1,2})(?:$| )/.exec(t);
  if (d && +d[1] >= 1 && +d[1] <= 31) day = +d[1];
  else for (const [s, n] of ORD_STEMS) if (new RegExp(`(?:^| )${s}\\p{L}*(?:$| )`, 'u').test(t)) { day = n; break; }
  if (day === undefined) return null;
  const ws = t.split(' ');
  const mi = MONTH_STEMS.findIndex((m, i) => ws.some((w) => (i === 4 ? /^ма[йяею]$/.test(w) : w.startsWith(m))));
  return mi >= 0 ? { day, month: mi + 1 } : { day };
}

// ---------------------------------------------------------------- вкладки, слои, участки, операции

export type CmdTab = 'reports' | 'intel' | 'decision' | 'orders' | 'journal' | 'umpire' | 'staffs';
export const TAB_TITLE: Record<CmdTab, string> = { reports: 'Доклады', intel: 'Разведка', decision: 'Решение', orders: 'Приказы', journal: 'Журнал', umpire: 'Посредник', staffs: 'Штабы' };
const TAB_STEMS: [string, CmdTab][] = [['докла', 'reports'], ['разве', 'intel'], ['решен', 'decision'], ['прика', 'orders'], ['журна', 'journal'], ['посре', 'umpire'], ['штабы', 'staffs']];
/** Вкладка по слову («приказы», «журнал», «посредника»); нет — null. */
export function tabByWord(w: string): CmdTab | null { const n = norm(w); return TAB_STEMS.find(([s]) => n.startsWith(s))?.[1] ?? null; }

/** Как слои называют вслух (ключи — TOGGLES окна; labels — подписи знаков). */
export const LAYER_WORDS: Record<string, string[]> = {
  ghosts: ['исторические положения', 'историческое положение', 'исторические', 'историю'],
  hfront: ['исторический фронт', 'фронт по истории', 'линию фронта по истории', 'историческую линию фронта'],
  front: ['фронт', 'линию фронта', 'расчетный фронт'],
  combat: ['бои', 'бои за ход'],
  theatre: ['рубежи', 'укрепленные полосы', 'укрепления'],
  plan: ['замысел', 'проект приказов'],
  rear: ['тыл', 'базы снабжения', 'подвоз'],
  rivers: ['реки'],
  pockets: ['котлы', 'окружения'],
  zones: ['зоны влияния', 'зоны влияния сторон', 'зоны', 'влияние сторон'],
  fortress: ['крепости'],
  hbounds: ['исторические разграничительные линии', 'разграничительные линии по директиве', 'директивы'],
  bounds: ['полосы', 'разграничительные линии', 'полосы армий', 'полосы фронтов'],
  labels: ['подписи', 'подписи знаков', 'названия'],
};
/** Слой по названию (нестрого: падежи, лишние слова названия); из keys, если дан. Нет или неоднозначно — null. */
export function findLayer(text: string, keys?: string[]): string | null {
  const q = words(text).map(stem);
  if (!q.length) return null;
  let best: { key: string; extra: number } | null = null;
  let tie = false;
  for (const [key, names] of Object.entries(LAYER_WORDS)) {
    if (keys && !keys.includes(key)) continue;
    for (const n of names) {
      const ns = words(n).map(stem);
      if (!q.every((w) => ns.includes(w))) continue;
      const extra = ns.length - q.length;
      if (!best || extra < best.extra) { best = { key, extra }; tie = false; } else if (extra === best.extra && best.key !== key) tie = true;
    }
  }
  return best && !tie ? best.key : null;
}

/** Выбор из списка по названию: один — index; несколько — переспрос «ask: «…», «…»?»; нет — none и что есть. */
export function pickTitle(said: string, titles: string[], ask: string, none: string): { index: number } | { say: string } {
  const hit = pickByName(said, titles);
  if (hit.length === 1) return { index: hit[0] };
  if (hit.length > 1) return { say: `${ask}: ${hit.slice(0, 3).map((i) => `«${titles[i]}»`).join(', ')}?` };
  return { say: `${none}. Есть: ${titles.slice(0, 5).map((t) => `«${t}»`).join(', ')}${titles.length > 5 ? ' и другие' : ''}.` };
}

// ---------------------------------------------------------------- места и соединения

type Who = { kind: 'own' | 'enemy' | 'group'; id: string; name: string };
/** Номер и род войск в названии («56|корпус»): совпали у своего и у противника — не выбирать молча. */
function numType(n: string): string | null {
  const num = /\d+/.exec(n)?.[0];
  const kind = /(арми|корпус|дивизи|бригад|фронт|групп)/.exec(norm(n))?.[1];
  return num && kind ? `${num}|${kind}` : null;
}
const OWN_MARK = /^(?:наш|сво[йеияю])/;
const ENEMY_MARK = /^(?:противник|немецк|вражеск|чуж)/;

/**
 * Своё, противник или фронт по названию; переспрос — say; не нашлось — null. Свои — первыми («восьмая гвардейская» —
 * наша армия), но одинаковые номер и род войск у своего и у противника — переспрос «Наш … или противника …?»;
 * «наш …» / «… противника» выбирают сторону.
 */
export function findWho(name: string, v: TurnView): { who: Who } | { say: string } | null {
  const pool: (Who & { side: string })[] = [
    ...v.own.map((u) => ({ kind: 'own' as const, id: u.id, name: u.name, side: 'own' })),
    ...v.groups.map((g) => ({ kind: 'group' as const, id: g.id, name: g.name, side: 'own' })),
    ...v.intel.map((e) => ({ kind: 'enemy' as const, id: e.id, name: e.name, side: 'enemy' })),
  ];
  const exact = pool.find((x) => x.id === name);
  if (exact) return { who: exact };
  const ws = norm(name).split(' ').filter(Boolean);
  const ownOnly = ws.some((w) => OWN_MARK.test(w)), enemyOnly = ws.some((w) => ENEMY_MARK.test(w));
  const q = ws.filter((w) => !OWN_MARK.test(w) && !ENEMY_MARK.test(w)).join(' ');
  if (!q) return null;
  const sides = ownOnly && !enemyOnly ? ['own'] : enemyOnly && !ownOnly ? ['enemy'] : ['own', 'enemy'];
  const found = sides.map((side) => findUnit(q, pool, { side }));
  const [a, b] = found;
  if (sides.length === 2 && a.unit && b.unit && numType(a.unit.name) && numType(a.unit.name) === numType(b.unit.name))
    return { say: `Наш «${short(a.unit.name)}» или противника «${short(b.unit.name)}»?` };
  for (const r of found) {
    if (r.unit) return { who: r.unit };
    if (r.options.length) return { say: `Какое соединение: ${r.labels.map((l) => `«${short(l)}»`).join(', ')}?` };
  }
  return null;
}

/** Есть ли в сказанном признак соединения (номер, тип): тогда соединение важнее места. */
const UNITISH = /\d|(?:^| )(?:перв|втор|трет|четв|пят|шест|седьм|восьм|девят|десят|\p{L}+надцат|двадцат|тридцат|сорок|армия|армии|армию|корпус|дивизи|фронт|гвардейск|ударн|танков|группа|групп)/u;

/** Что показать на карте: соединение или место (в т. ч. «пять километров севернее Зелова»); переспрос — say; нет — null. */
export function resolveTarget(name: string, v: TurnView): { at: LngLat; label: string; who?: Who } | { say: string } | null {
  const rel = parseRelative(name);
  if (rel) {
    const r = resolveRelative(name, v.places);
    if (r.place) return { at: r.place.at, label: short(r.place.title) };
    if (r.options.length) return { say: `Какое место: ${r.labels.map((l) => `«${short(l)}»`).join(', ')}?` };
    return null;
  }
  const who = findWho(name, v);
  const pl = findPlace(name, v.places);
  const unitFirst = UNITISH.test(norm(name));
  const atOf = (w: Who): LngLat | null => (w.kind === 'own' ? v.own.find((u) => u.id === w.id)?.at : w.kind === 'enemy' ? v.intel.find((e) => e.id === w.id)?.at : null) ?? null;
  if (who && 'who' in who && (unitFirst || !pl.place)) {
    const at = atOf(who.who);
    if (at) return { at, label: short(who.who.name), who: who.who };
  }
  if (pl.place) return { at: pl.place.at, label: short(pl.place.title) };
  if (who && 'say' in who) return who;
  if (pl.options.length) return { say: `Какое место: ${pl.labels.map((l) => `«${short(l)}»`).join(', ')}?` };
  return null;
}

// ---------------------------------------------------------------- действия командования

export interface CommandDeps {
  view: TurnView | null;
  engine: (Pick<MapEngine, 'getView' | 'setView'> & Partial<Pick<MapEngine, 'project' | 'unproject' | 'getContainer'>>) | null;
  setTab(t: CmdTab): void;
  /** Своё объединение: выбрать, открыть доклад, показать на карте. */
  showUnit(id: string): void;
  /** Противник: карточка разведки. */
  showEnemy(id: string): void;
  enemy: EnemyMode; setEnemy(m: EnemyMode): void;
  reveal: boolean; setReveal(on: boolean): void;
  exit(discard: boolean): void;
}

/** Чьё «подробнее»: последнее длинное, что сказал штаб, — доклад обстановки или ответ советника (staff.ts). */
let moreOwner: 'report' | 'advice' | 'umpire' | null = null;
/** Последнее длинное сказанное — это (на него и «подробнее»). */
export function claimMore(kind: 'report' | 'advice' | 'umpire' | null): void { moreOwner = kind; }

/** Остальные донесения после краткого доклада («подробнее») — к обстановке того хода (at), не позже. */
let more: { at: TurnView; list: string[] } | null = null;
const sameTurn = (a: TurnView, b: TurnView) => a.time === b.time && a.takeover === b.takeover && a.scenario === b.scenario;
/** Действия командования, зарегистрированные сейчас (для разбора «мягких» фраз: есть ли такое место или соединение). */
let live: (() => CommandDeps) | null = null;
/** Действия командования сняты (выход из игры): разбор больше не смотрит в их обстановку. */
export function releaseCommand(get: () => CommandDeps): void { if (live === get) { live = null; more = null; } }

const NAME = { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] };
const ENEMY_SAY: Record<EnemyMode, string> = { llm: 'штаб на модели', passive: 'без штаба — держится прежних приказов', agents: 'штабы-агенты по уставам', intent: 'штабы по истории как замыслу' };

export function commandActions(get: () => CommandDeps): Action[] {
  more = null; // новая игра
  live = get;
  const ready = (): true | string => { const r = inReplay(); return r !== true ? r : get().view ? true : 'обстановка ещё готовится — подождите немного'; };
  const view = () => get().view!;
  const base = { section: 'replay', available: ready };
  // место — в свободной части карты: не под панелью голоса и легендой
  const center = (at: LngLat, zoom: number | null) => {
    const en = get().engine;
    if (!en) return;
    const z = en.getView().zoom;
    showAt(en, at, zoom === null ? z : Math.max(z, zoom));
  };
  const zoomBy = (d: number) => {
    const en = get().engine;
    if (!en) return 'Карта ещё не готова.';
    const v = en.getView();
    en.setView({ center: v.center, zoom: Math.min(17, Math.max(3, v.zoom + d)) });
  };
  // порядок — порядок примеров в «что я могу сказать»: главное первым
  return [
    { ...base, id: 'command.report', title: 'Доклад обстановки', describe: 'Коротко докладывает обстановку: дата и ход, цель, укомплектованность, главное из донесений.',
      say: ['штаб, доложи обстановку'], highlight: () => hl('tab-reports'),
      run: async () => { get().setTab('reports'); const r = situationReport(view()); more = { at: view(), list: r.more }; claimMore('report'); return r.text; } },
    { ...base, id: 'command.report.more', title: 'Подробнее', describe: 'Читает остальные донесения за ход после краткого доклада.', say: ['подробнее'],
      available: () => { const r = ready(); return r !== true ? r : more && more.list.length && sameTurn(more.at, view()) ? true : 'сначала доклад: скажите «Штаб, доложи обстановку»'; },
      run: async () => { const t = moreText(more!.list); more = null; return readAloud(t); } },
    { ...base, id: 'command.intel', title: 'Разведсводка', describe: 'Докладывает разведсводку: сколько противника обнаружено, новое, ближайшее к нашим.',
      say: ['штаб, что разведка?'], highlight: () => hl('tab-intel'), run: async () => { get().setTab('intel'); return intelReport(view()); } },
    { ...base, id: 'command.unit.report', title: 'Доклад соединения', describe: 'Доклад своего объединения (или разведданные о противнике) по названию.',
      params: NAME, say: ['штаб, доложи о восьмой гвардейской'], highlight: noted,
      run: async (p: { name: string }) => {
        const v = view();
        const r = findWho(String(p?.name ?? ''), v);
        if (!r) return `Не нашёл соединения «${p?.name}».`;
        if ('say' in r) return r.say;
        const w = r.who;
        if (w.kind === 'own') { get().showUnit(w.id); note(hl(`unit-${w.id}`)); return unitReport(v.own.find((u) => u.id === w.id)!); }
        if (w.kind === 'enemy') { const e = v.intel.find((x) => x.id === w.id)!; get().showEnemy(w.id); note(hl('enemy-card'), { at: e.at }); return enemyReport(e); }
        get().setTab('reports'); note(hl('tab-reports'));
        return groupReport(w, v);
      } },
    { ...base, id: 'command.unit.show', title: 'Где соединение', describe: 'Показывает объединение на карте и открывает его доклад.',
      params: NAME, say: ['штаб, где восьмая гвардейская?'], highlight: noted,
      run: async (p: { name: string }) => {
        const v = view();
        const r = findWho(String(p?.name ?? ''), v);
        if (!r) return `Не нашёл соединения «${p?.name}».`;
        if ('say' in r) return r.say;
        const w = r.who;
        if (w.kind === 'own') { const u = v.own.find((x) => x.id === w.id)!; get().showUnit(w.id); center(u.at, null); note(hl(`unit-${w.id}`), { at: u.at }); return whereText(u); }
        if (w.kind === 'enemy') { const e = v.intel.find((x) => x.id === w.id)!; get().showEnemy(w.id); center(e.at, 9); note(hl('enemy-card'), { at: e.at }); return enemyReport(e); }
        get().setTab('reports'); note(hl('tab-reports'));
        return groupReport(w, v);
      } },
    { ...base, id: 'map.show', title: 'Показать на карте', describe: 'Показывает на карте место (пункт) или соединение по названию.',
      params: NAME, say: ['штаб, покажи Зелов'], highlight: noted,
      run: async (p: { name: string }) => {
        const r = resolveTarget(String(p?.name ?? ''), view());
        if (!r) return `Не нашёл на карте «${p?.name}».`;
        if ('say' in r) return r.say;
        if (r.who?.kind === 'own') get().showUnit(r.who.id);
        if (r.who?.kind === 'enemy') get().showEnemy(r.who.id);
        center(r.at, r.who ? 9 : 10);
        note({ at: r.at }, ...(r.who?.kind === 'own' ? [hl(`unit-${r.who.id}`)] : r.who?.kind === 'enemy' ? [hl('enemy-card')] : []));
        return `Показываю: ${r.label}.`;
      } },
    { ...base, id: 'command.tab', title: 'Вкладка командования', describe: 'Открывает вкладку: доклады, разведка, решение, приказы, журнал, посредник.',
      params: { type: 'object', properties: { tab: { enum: Object.keys(TAB_TITLE) } }, required: ['tab'] }, say: ['штаб, открой приказы'],
      highlight: (p: { tab: CmdTab }) => hl(`tab-${p?.tab}`),
      run: async (p: { tab: CmdTab }) => { if (!TAB_TITLE[p?.tab]) return 'Такой вкладки нет.'; const cm = get().view?.command;
        if (p.tab === 'staffs' && (!cm || cm.mode === 'legacy')) return 'Вкладка «Штабы» — в игре на агентной модели в режиме «штабы-агенты» или «гибрид».';
        get().setTab(p.tab); return `Вкладка «${TAB_TITLE[p.tab]}».`; } },
    { ...base, id: 'map.zoomIn', title: 'Приблизить карту', describe: 'Приближает карту на один шаг.', say: ['штаб, приблизь'], run: async () => zoomBy(1) },
    { ...base, id: 'map.zoomOut', title: 'Отдалить карту', describe: 'Отдаляет карту на один шаг.', say: ['штаб, отдали'], run: async () => zoomBy(-1) },
    { ...base, id: 'command.journal.read', title: 'Прочитать журнал', describe: 'Читает вслух журнал боевых действий за день (по умолчанию — последний).',
      params: { type: 'object', properties: { day: { type: 'string' } } }, say: ['штаб, прочитай журнал'], highlight: () => hl('tab-journal'),
      run: async (p: { day?: string }) => {
        get().setTab('journal');
        const days = view().journal;
        if (!days.length) return 'Записей в журнале пока нет — они появятся после первого хода.';
        let d = days[days.length - 1];
        if (p?.day && !/^(?:последн|вчер)/.test(norm(p.day))) {
          const want = parseDay(p.day);
          const hit = want && [...days].reverse().find((x) => +x.time.slice(8, 10) === want.day && (!want.month || +x.time.slice(5, 7) === want.month));
          if (!hit) return `За ${p.day} записей нет. Есть: ${days.map((x) => dayMonth(x.time)).join(', ')}.`;
          d = hit;
        }
        return readAloud(journalDayText(d));
      } },
    { ...base, id: 'command.reveal', title: 'Туман войны', describe: 'Посредник: показать на карте всех (снять туман войны) или вернуть туман войны.',
      params: { type: 'object', properties: { on: { type: 'boolean' } }, required: ['on'] }, say: ['штаб, покажи всех', 'штаб, верни туман войны'],
      highlight: () => [btn('command.reveal'), hl('tab-umpire')],
      run: async (p: { on: boolean }) => { get().setReveal(!!p?.on); return p?.on ? 'Туман войны снят: на карте все войска.' : 'Туман войны возвращён.'; } },
    { ...base, id: 'command.enemyMode', title: 'Противник', describe: 'Кто командует противником: штаб на модели или без штаба (держится прежних приказов).',
      params: { type: 'object', properties: { mode: { enum: ['llm', 'passive'] } }, required: ['mode'] }, say: ['штаб, противник без штаба'],
      available: inReplay, highlight: () => [hl('enemy-mode'), hl('tab-umpire')],
      run: async (p: { mode: EnemyMode }) => { if (!ENEMY_SAY[p?.mode] || p.mode === 'agents') return 'Скажите: «штаб на модели» или «без штаба».'; if (get().enemy === 'agents') return 'Противник — штабы-агенты: это выбирается при передаче командования, в ходе игры не меняется.'; get().setEnemy(p.mode); return `Противник — ${ENEMY_SAY[p.mode]}.`; } },
    { ...base, id: 'command.exit', title: 'Выйти из игры', describe: 'Выходит из игры к переигровке; игра сохранена, её можно продолжить.', say: ['штаб, выйди из игры'],
      available: inReplay,
      run: async () => { more = null; get().exit(false); return 'Вышел из игры, она сохранена. Продолжить — скажите: «Штаб, продолжи игру».'; } },
    { ...base, id: 'command.discard', title: 'Завершить и удалить игру', describe: 'Завершает игру и удаляет её запись (необратимо).', say: ['штаб, заверши и удали игру'],
      irreversible: true, confirm: () => 'Завершить игру и удалить её запись?', available: inReplay,
      run: async () => { more = null; get().exit(true); return 'Игра завершена, запись удалена.'; } },
  ];
}

// ---------------------------------------------------------------- действия переигровки (вход в командование)

export interface ReplayDeps {
  catalog: { id: string; title: string }[];
  scenario: string;
  /** Идёт расчёт (текст хода расчёта) или нет. */
  busy: string | null;
  /** Идёт игра (раздел показывает командование). */
  game: boolean;
  /** Начать расчёт операции id. */
  calc(id: string): void;
  /** Рассчитанная операция (null — нет расчёта) и время плеера. */
  result: { scenarioName: string; start: string; end: string } | null;
  time: string | null;
  /** Начало хода, на который приходится момент t. */
  takeAt(t: string): string;
  setTime(t: string): void;
  /** Окно «Принять командование»: открыть с момента, закрыть; открыто — с какого момента. */
  openTake(at: string): void;
  closeTake(): void;
  take: string | null;
  saved: { title: string } | null;
  /** Начать игру (без вопросов) и продолжить сохранённую. */
  /** mode — режим командования на агентной модели (нет — выбранный в окне и запомненный). */
  begin(enemy: EnemyMode, mode?: 'legacy' | 'agents' | 'hybrid' | 'commanders'): void;
  continueGame(): void;
  /** Остановить расчёт; удалить запись незавершённой игры. */
  stop(): void;
  discardSaved(): void;
}

const opName = (t: string) => t.split(/[,:(]/)[0].trim();

/** Расчёт готов — коротко; подсказка, что дальше, — только если голосом пользовались недавно (hint). */
export function calcDoneText(scenarioName: string, hint: boolean): string {
  return `Расчёт готов: ${opName(scenarioName)}.${hint ? ' Чтобы командовать самому, скажите: «Штаб, прими командование».' : ''}`;
}
/** Сбой расчёта — причина словами (коротко), без взгляда на экран. */
export function calcFailText(message: string): string {
  // техническая ошибка (латиница) словами не пересказывается
  if (/[A-Za-z]{3}/.test(message)) return 'Расчёт не удался: внутренняя ошибка, подробности на экране.';
  return speakable(`Расчёт не удался: ${message.trim().replace(/[.\s]+$/, '')}.`);
}

/** Действия переигровки, зарегистрированные сейчас (каталог операций для «рассчитай <название>»). */
let liveReplay: (() => ReplayDeps) | null = null;
/** Действия переигровки сняты. */
export function releaseReplay(get: () => ReplayDeps): void { if (liveReplay === get) liveReplay = null; }
/** Что в «Переигровке» сейчас (для туров): идёт ли игра, есть ли незавершённая, рассчитана ли операция; раздела ещё не было — null. */
export function replayNow(): { game: boolean; saved: boolean; calculated: boolean } | null {
  const d = liveReplay?.();
  return d ? { game: d.game, saved: !!d.saved, calculated: !!(d.result && d.time) } : null;
}

export function replayActions(get: () => ReplayDeps): Action[] {
  liveReplay = get;
  const idle = (): true | string => {
    const r = inReplay(); if (r !== true) return r;
    const d = get();
    if (d.game) return 'идёт игра. Сначала выйдите из неё: «Штаб, выйди из игры»';
    return d.busy ? 'идёт расчёт — подождите, я скажу, когда будет готово' : true;
  };
  const takeOpen = (): true | string => { const r = inReplay(); return r !== true ? r : get().take ? true : 'окно «Принять командование» не открыто. Скажите: «Штаб, прими командование»'; };
  const ENEMY = { type: 'object', properties: { enemy: { enum: ['llm', 'passive', 'agents'] }, mode: { enum: ['legacy', 'agents', 'hybrid', 'commanders'] } } };
  const start = (p?: { enemy?: EnemyMode; mode?: 'legacy' | 'agents' | 'hybrid' | 'commanders' }) => { get().begin(p?.enemy === 'passive' || p?.enemy === 'agents' ? p.enemy : 'llm', p?.mode); return 'Командование принято. Готовлю обстановку — скажу, когда будет готова.'; };
  return [
    { section: 'replay', id: 'replay.calc', title: 'Рассчитать операцию', describe: 'Рассчитывает операцию (по названию; без названия — выбранную).',
      params: { type: 'object', properties: { operation: { type: 'string' } } }, say: ['штаб, рассчитай операцию', 'штаб, рассчитай берлинскую операцию'],
      available: idle, highlight: () => hl('calc'),
      run: async (p: { operation?: string }) => {
        const d = get();
        let id = d.scenario;
        const said = norm(String(p?.operation ?? '')).replace(/(?:^| )операци\S*/g, ' ').trim();
        if (said) {
          const r = pickTitle(said, d.catalog.map((c) => opName(c.title)), 'Какую операцию', `Операции «${p!.operation}» нет`);
          if ('say' in r) return r.say;
          id = d.catalog[r.index].id;
        }
        d.calc(id);
        return `Считаю: ${opName(d.catalog.find((c) => c.id === id)?.title ?? '')}. Это займёт до минуты — скажу, когда будет готово.`;
      } },
    { section: 'replay', id: 'replay.takeCommand', title: 'Принять командование', describe: 'Открывает окно «Принять командование» с момента на карте или с названного дня.',
      params: { type: 'object', properties: { at: { type: 'string' } } }, say: ['штаб, прими командование', 'штаб, прими командование с восемнадцатого апреля'],
      highlight: () => hl('take'),
      available: () => { const r = idle(); return r !== true ? r : get().result && get().time ? true : 'операция ещё не рассчитана. Скажите: «Штаб, рассчитай операцию»'; },
      run: async (p: { at?: string }) => {
        const d = get();
        const res = d.result!;
        let t = d.time!;
        const said = String(p?.at ?? '').trim();
        if (said && !/(?:этого момента|сейчас|отсюда|текущ)/.test(norm(said))) {
          const iso = /^\d{4}-\d{2}-\d{2}/.test(said) ? said.slice(0, 10) : null;
          const day = iso ? null : parseDay(said);
          if (!iso && !day) return 'Не понял, с какого дня. Скажите, например: «прими командование с восемнадцатого апреля».';
          const date = iso ?? `${res.start.slice(0, 4)}-${String(day!.month ?? +t.slice(5, 7)).padStart(2, '0')}-${String(day!.day).padStart(2, '0')}`;
          t = `${date}T${res.start.slice(11, 16) || '00:00'}`;
          if (t < res.start.slice(0, 16)) return `Операция начинается ${dayMonth(res.start)} — раньше принять нельзя.`;
          if (t >= res.end.slice(0, 16)) return `Операция в расчёте кончается ${dayMonth(res.end)} — такого дня в ней нет.`;
          d.setTime(t);
        }
        d.openTake(d.takeAt(t));
      } },
    { section: 'replay', id: 'replay.stop', title: 'Остановить расчёт', describe: 'Останавливает идущий расчёт операции.', say: ['штаб, останови расчёт'],
      available: () => { const r = inReplay(); return r !== true ? r : get().busy ? true : 'расчёт не идёт'; },
      run: async () => { get().stop(); return 'Расчёт остановлен.'; } },
    { section: 'replay', id: 'replay.discardSaved', title: 'Удалить незавершённую игру', describe: 'Удаляет запись незавершённой игры (необратимо).',
      say: ['штаб, удали незавершённую игру'], irreversible: true, confirm: () => 'Удалить запись незавершённой игры?',
      available: () => { const r = idle(); return r !== true ? r : get().saved ? true : 'незавершённой игры нет'; },
      run: async () => { get().discardSaved(); return 'Запись незавершённой игры удалена.'; } },
    { section: 'replay', id: 'replay.continue', title: 'Продолжить игру', describe: 'Продолжает сохранённую незавершённую игру.', say: ['штаб, продолжи игру'],
      available: () => { const r = idle(); return r !== true ? r : get().saved ? true : 'незавершённой игры нет'; },
      run: async () => { const s = get().saved!; get().continueGame(); return `Продолжаю игру: ${opName(s.title)}.`; } },
    { section: 'replay', id: 'replay.start', title: 'Начать игру', describe: 'Окно «Принять командование»: принять командование и начать игру.', params: ENEMY,
      say: ['принимаю'],
      available: () => { const r = takeOpen(); return r !== true ? r : get().saved ? 'есть незавершённая игра — новая её заменит, нужно подтверждение' : true; },
      run: async (p?: { enemy?: EnemyMode; mode?: 'legacy' | 'agents' | 'hybrid' | 'commanders' }) => start(p) },
    { section: 'replay', id: 'replay.startOver', title: 'Начать новую игру вместо незавершённой', describe: 'Начинает новую игру; запись незавершённой заменяется (необратимо).',
      params: ENEMY, irreversible: true, confirm: () => 'Есть незавершённая игра. Начать новую? Запись прежней будет заменена.', available: takeOpen,
      run: async (p?: { enemy?: EnemyMode; mode?: 'legacy' | 'agents' | 'hybrid' | 'commanders' }) => start(p) },
    { section: 'replay', id: 'replay.takeCommand.cancel', title: 'Отмена', describe: 'Закрывает окно «Принять командование».', say: ['отмена'], available: takeOpen,
      run: async () => { get().closeTake(); return 'Отменено.'; } },
  ];
}

/** Разбор ответов окна «Принять командование» (реплика без обращения). */
/**
 * Чтение окна «Принять командование» (до озвучки — speakable): вопрос, предупреждение, как отвечать, потом подробности;
 * в конце «Жду ответа.» (не слово-ответ). day — «16 апреля».
 */
export function takeoverRead(o: { day: string; turn: number; enemy: EnemyMode; down: boolean; saved: boolean }): string {
  return `Принять командование с ${o.day}? ${o.saved ? 'Незавершённая игра будет заменена. ' : ''}`
    + 'Скажите: «принимаю», «без штаба» или «штаб на модели», или «отмена». '
    + `Противник — ${o.enemy === 'llm' ? 'штаб на модели' : 'без штаба'}${o.down ? '; модель сейчас не на связи' : ''}. Ход ${o.turn}. Жду ответа.`;
}
/** Напоминание окна «Принять командование», если ответа нет. */
export const TAKEOVER_REMIND = 'Принимаете командование? Скажите «принимаю» или «отмена». Жду ответа.';
/** Реплика целиком — ответ окну «Принять командование» (принимается и без «штаб», и поверх его речи). */
export function takeoverIsAnswer(rest: string): boolean { return takeoverParse(rest, { saved: false, enemy: 'llm' }) !== null; }

export function takeoverParse(rest: string, o: { saved: boolean; enemy: EnemyMode }): { id: string; params?: unknown } | null {
  const t = norm(rest);
  if (/^(?:принимаю|принять|прими|принимай|начать|начинай|начнем|начинаем|да|принимаю командование|прими командование|принять командование|в бой)$/.test(t))
    return { id: o.saved ? 'replay.startOver' : 'replay.start', params: { enemy: o.enemy } };
  if (/^(?:противник )?без (?:штаба|модели)$/.test(t)) return { id: 'command.enemyMode', params: { mode: 'passive' } };
  if (/^(?:противник )?(?:штаб на модели|на модели|с моделью|с штабом|со штабом|модель)$/.test(t)) return { id: 'command.enemyMode', params: { mode: 'llm' } };
  if (/^(?:отмена|отмени|нет|закрой|закрыть|не надо|отставить|не принимаю)$/.test(t)) return { id: 'replay.takeCommand.cancel' };
  return null;
}

// ---------------------------------------------------------------- разбор фраз

/** Действие есть — вызов; нет — почему (или null: пусть разбирают другие — модель). */
function hit(id: string, params?: unknown, missing: string | null = NO_GAME): PhraseHit | null {
  if (getAction(id)) return { id, params };
  return missing === null ? null : { say: `Сейчас нельзя: ${missing}.` };
}

const SHOW = /^(?:покажи|показать|найди|найти|перейди к)(?: на карте)? (.+)$/;
/** Начала вопросов, а не названий: «где лучше наступать», «покажи как отдать приказ» — это модели. */
const QUESTION = /^(?:как|что|чего|чему|почему|зачем|когда|куда|кто|лучше|мои|мой|моих|здесь|тут|там|это|все|всё)(?: |$)/;

/**
 * Фраза с названием («покажи …», «где …», «доложи о …») — «мягкая»: исполняется, только если такое место или соединение
 * есть (или есть что переспросить); иначе null — фразу разбирает модель. Нет игры — тоже null.
 */
function soft(id: string, name: string, probe: (v: TurnView, name: string) => unknown): PhraseHit | null {
  if (QUESTION.test(name) || !getAction(id)) return null;
  const v = live?.().view;
  return v && probe(v, name) ? { id, params: { name } } : null;
}

/** Слова, которые в «рассчитай …» не называют операцию: «рассчитай заново», «рассчитай её ещё раз». */
const CALC_FILL = new Set(['заново', 'снова', 'еще', 'раз', 'ее', 'эту', 'опять', 'повторно', 'текущую', 'ту', 'же', 'мне', 'пожалуйста']);

/**
 * Фразы «Переигровки» и «Командования» → действие с параметрами (см. шапку модуля). rest — без обращения, section —
 * открытый раздел: вне «Переигровки» понимается только вход (расчёт, командование, продолжение — с переходом туда).
 */
export function parseCommand(rest: string, section: string): PhraseHit | null {
  const t = norm(rest);
  let m: RegExpExecArray | null;
  const away = section !== 'replay';
  const entry = (id: string, params?: unknown) => (away ? { id, params, section: 'replay' } : hit(id, params, NOT_IN_REPLAY));
  // вход: расчёт, командование, продолжение
  if ((m = /^(?:рассчитай|рассчитать|расчитай|посчитай|посчитать|просчитай|пересчитай|пересчитать|сделай расчет)(?: (.+))?$/.exec(t))) {
    // название — только операция из каталога (или переспрос между ними); «рассчитай потери» — вопрос модели
    const name = (m[1] ?? '').split(' ').filter((w) => !CALC_FILL.has(w) && !/^операци/.test(w)).join(' ');
    if (!name) return entry('replay.calc', {});
    const cat = liveReplay?.().catalog;
    return cat && pickByName(name, cat.map((c) => opName(c.title))).length ? entry('replay.calc', { operation: name }) : null;
  }
  if ((m = /^(?:прими|принять|принимай|возьми|взять|принимаю) командование(?: (.+))?$/.exec(t)))
    return entry('replay.takeCommand', m[1] ? { at: m[1].replace(/^(?:с|со) /, '') } : {});
  if (/^(?:продолжи|продолжить|продолжим|вернись к|вернуться к|вернемся к)(?: прежней| прежнюю| сохраненной| сохраненную| незавершенной| незавершенную)? игр[уеы]$/.test(t))
    return entry('replay.continue');
  // остальное — только в «Переигровке»: в других разделах «приблизь», «легенда», «журнал» — их собственные слова
  if (away) return null;
  if (/^(?:останови|остановить|прекрати|прерви) расчет$/.test(t)) return hit('replay.stop', undefined, NOT_IN_REPLAY);
  if (/^(?:удали|удалить|сотри) (?:незавершенную|сохраненную|прежнюю) игру$/.test(t)) return hit('replay.discardSaved', undefined, NOT_IN_REPLAY);
  // выход
  if (/^(?:заверши|завершить|закончи) и (?:удали|удалить) игру$|^(?:удали|удалить|сотри) игру$/.test(t)) return hit('command.discard');
  if (/^(?:выйди|выйти|выходи|выходим)(?: из)? игр[уы]$/.test(t)) return hit('command.exit');
  // туман войны
  if (/^(?:покажи|показать) (?:всех|все войска|всех на карте|противника на карте)$|^(?:сними|снять|убери) туман(?: войны)?$|^без тумана(?: войны)?$/.test(t)) return hit('command.reveal', { on: true });
  if (/^(?:верни|вернуть|включи|восстанови) туман(?: войны)?$/.test(t)) return hit('command.reveal', { on: false });
  // доклады
  if (/^(?:(?:доложи|доложите|докладывай|дай|какая|как|что за)(?: мне)? )?обстановк\p{L}*$|^доложи$|^доклад$|^что нового$/u.test(t)) return hit('command.report');
  // разбор прошедшего хода на карте (действие — voice/actions/turn.ts); раньше «покажи …» — названия мест
  if (/^(?:покажи|покажите|показать)(?: мне)? (?:прошедший |прошлый |последний )?ход$|^(?:покажи |давай )?разбор хода$|^(?:покажи )?что было за ход$/.test(t)) return hit('command.turn.show');
  if (/^(?:подробнее|подробней|остальные донесения|еще донесения|какие еще донесения)$/.test(t)) {
    // после краткого доклада посредника («повтори доклад») — весь разбор хода
    if (moreOwner === 'umpire' && getAction('command.turn.show')?.available() === true) return { id: 'command.turn.show' };
    return moreOwner !== 'advice' && getAction('command.report.more')?.available() === true ? { id: 'command.report.more' } : null;
  }
  if (/^(?:что|как)(?: там)? (?:разведка|с разведкой|противник|у противника)$|^(?:доложи |дай |прочитай )?разведсводк\p{L}*$|^разведка$|^доложи (?:разведку|о противнике|про противника)$/u.test(t)) return hit('command.intel');
  if ((m = /^(?:прочитай|прочти|зачитай|читай)(?: мне)? журнал(?: боевых действий)?(?: (?:за )?(.+))?$/.exec(t))) return hit('command.journal.read', m[1] ? { day: m[1] } : {});
  // карта
  if ((m = /^(?:(?:перейди|переключи|переключись|покажи|сделай)(?: на)? )?(тактическ|оперативн|стратегическ)\p{L}*(?: (?:уровень|масштаб|уровне|карта|карту))?$/u.exec(t))
    ?? (m = /^(?:уровень|масштаб) (тактическ|оперативн|стратегическ)\p{L}*$/u.exec(t)))
    return hit('map.level', { level: { тактическ: 'division', оперативн: 'front', стратегическ: 'stavka' }[m[1]] }, NO_MAP);
  // уровни по ступеням: «уровень армии», «перейди на уровень Ставки», «корпусной уровень»
  if ((m = /^(?:(?:перейди|переключи|переключись|покажи|сделай)(?: на)? )?уров(?:ень|не) (ставк|фронт|арми|корпус|дивизи)\p{L}*$/u.exec(t))
    ?? (m = /^(?:(?:перейди|переключи|переключись|покажи|сделай)(?: на)? )?(ставочн|фронтов|армейск|корпусн|дивизионн)\p{L}* (?:уровень|уровне)$/u.exec(t))) {
    const lv: Record<string, string> = { ставк: 'stavka', ставочн: 'stavka', фронт: 'front', фронтов: 'front', арми: 'army', армейск: 'army', корпус: 'corps', корпусн: 'corps', дивизи: 'division', дивизионн: 'division' };
    return hit('map.level', { level: lv[m[1]] }, NO_MAP);
  }
  if (/^(?:приблизь|приблизить|приблизь карту|ближе|крупнее|увеличь|увеличь карту)$/.test(t)) return hit('map.zoomIn');
  if (/^(?:отдали|отдалить|отдали карту|мельче|уменьши|уменьши карту)$/.test(t)) return hit('map.zoomOut');
  // «покажи карту» в игре — карта командования (весь театр), а не раздел «Карты»; карты нет — раздел
  if (/^(?:покажи|покажите|показать|открой) карту$/.test(t)) return getAction('map.sector') ? { id: 'map.sector', params: { name: '' } } : null;
  if (/^(?:покажи |открой |прочитай )?(?:легенд\p{L}*|условные обозначения)$|^что значат знаки$/u.test(t)) return hit('map.legend', undefined, NO_MAP);
  if (/^(?:(?:покажи|открой) )?(?:весь театр|весь фронт)$|^(?:сними|убери) (?:участок|фокус)$/.test(t)) return hit('map.sector', { name: '' }, NO_MAP);
  if ((m = /^(?:(?:покажи|открой|перейди к|перейди на|к) )?участ\p{L}* (.+)$/u.exec(t))) return hit('map.sector', { name: m[1] }, NO_MAP);
  // вкладки
  if ((m = /^(?:(?:открой|покажи|перейди|переключи|переключись)(?: на| в| к)?(?: вкладк\p{L}*)?|вкладк\p{L}*|на вкладку) (\p{L}+)$/u.exec(t)) && tabByWord(m[1]))
    return hit('command.tab', { tab: tabByWord(m[1]) });
  if (/^(?:доклады|приказы|журнал|посредник|решение)$/.test(t)) return hit('command.tab', { tab: tabByWord(t) });
  // слои
  if ((m = /^(покажи|показать|включи|скрой|скрыть|убери|выключи|спрячь|отключи)(?: слой)? (.+)$/.exec(t))) {
    const layer = findLayer(m[2]);
    if (layer) return hit('map.layer', { layer, on: /^(?:покажи|показать|включи)$/.test(m[1]) }, NO_MAP);
    // элемент легенды этого уровня, который есть на карте: «скрой отходы», «покажи удары противника»
    const it = getAction('map.legend.item') ? findLegendItem(m[2], shownLegend.items, shownLegend.level) : null;
    if (it) return hit('map.legend.item', { item: it.id, on: /^(?:покажи|показать|включи)$/.test(m[1]) }, NO_MAP);
  }
  // соединения и места по названию (что не нашлось — разберёт модель)
  if ((m = /^(?:доложи|доложите|доклад|что|как там)(?: мне)? (?:о|об|про|по|с|у) (.+)$/.exec(t))) return soft('command.unit.report', m[1], (v, n) => findWho(n, v));
  if ((m = /^где(?: сейчас| находится| находятся| стоит| стоят)? (.+)$/.exec(t))) return soft('command.unit.show', m[1], (v, n) => findWho(n, v));
  if ((m = SHOW.exec(t))) return soft('map.show', m[1].replace(/^на карте /, ''), (v, n) => resolveTarget(n, v));
  return null;
}

registerParser(parseCommand);
