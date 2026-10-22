/**
 * «Командование» — экранные действия: то, что раньше делали только кнопки и списки (выбор объединения под приказ,
 * правка приказа в редакторе, подвкладки «Приказов», окно советника, раскрыть и взять из варианта, «на карте», события
 * операции, «только участок в списках», карта в редакторе, части вкладки «Посредник», выбор армий для линии). Кнопки
 * и голос вызывают одно действие (полнота — тест voice-completeness). Чистый модуль (без React): CommandView передаёт
 * состояние через get() и регистрирует screenActions.
 *
 * Фразы (parseScreen, только в «Переигровке»): «приказ восьмой гвардейской», «закрой приказ», «закрой доклад», «открой
 * тыл / переправы / резервы / полосы / войска», «покажи / скрой / сверни советника», «очисти беседу с советником»,
 * «раскрой второй вариант», «сверни варианты», «возьми из первого варианта второй приказ», «покажи событие …»,
 * «в списках только участок» / «в списках весь театр», «открой карту в редакторе», «покажи поправки посредника»,
 * «покажи все слои» / «скрой все слои». Названия, которых нет, — не свои (их разбирает модель).
 */
import type { LngLat } from '@def-ops/core';
import { TASK_RU, type Task } from '@def-ops/sim';
import type { Goal, PlanVariantView, TurnView } from '../../sim/game-protocol';
import { ordinalIndex, pickByName } from '../answers';
import { getAction, registerParser, type Action, type PhraseHit } from '../registry';
import { btn, hl, note, noted } from '../highlight';
import { short } from '../report';
import { nameCase, numberWords } from '../speech';
import { inReplay, NO_GAME, pickTitle, type CmdTab } from './command';
import { BUSY, findOwn, TASKS, type OrderDraft, type OrdersSub, type PlanState, type StaffAct, type Suggestion } from './staff';

export interface ScreenDeps {
  view: TurnView | null;
  /** Идёт расчёт хода (текст) — проект не правится. */
  busy: string | null;
  setTab(t: CmdTab): void;
  /** Подвкладка «Приказов» (выбор точки на карте при этом снимается). */
  setSub(s: OrdersSub): void;
  /** Закрыть карточку противника на карте (разведданные). */
  closeCard(): void;
  /** Выбранное объединение (доклад, приказ); null — снять выбор. */
  select(id: string | null): void;
  sel: string | null;
  goTo(at: LngLat, zoomIn?: boolean): void;
  drafts: Record<string, OrderDraft>;
  setDraft(id: string, d: OrderDraft | null): void;
  /** Окно советника: открыто, свёрнуто к краю. */
  advisor: { open: boolean; min: boolean };
  setAdvisor(open: boolean, min: boolean): void;
  clearAdvisor(): void;
  /** Сколько вопросов в беседе с советником. */
  talk: number;
  setPlanN(n: number): void;
  plan: PlanState | null;
  planOpen: number | null;
  setPlanOpen(i: number | null): void;
  takeSuggestion(s: Suggestion): void;
  /** Предложенный приказ i из ответа советника msg (нет — null). */
  suggestion(msg: number, i: number): Suggestion | null;
  hasAct(key: string): boolean;
  addAct(a: PlanVariantView['acts'][number]): Promise<boolean>;
  dropAct(key: string): void;
  acts: StaffAct[];
  /** Участок в фокусе (есть ли) и «только он в списках». */
  focus: boolean;
  focusOnly: boolean;
  setFocusOnly(on: boolean): void;
  setTime(t: string): void;
  toEditor(): boolean;
  setUmpirePart(p: 'enemy' | 'umpire'): void;
  setBounds(b: { front?: string; a?: string; b?: string }): void;
}

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
const SUB_TITLE: Record<OrdersSub, string> = { units: 'Войска', rear: 'Тыл', bridges: 'Переправы', reserves: 'Резервы', bounds: 'Полосы' };
const SUB_WORD: [RegExp, OrdersSub][] = [[/^войск/, 'units'], [/^тыл/, 'rear'], [/^переправ/, 'bridges'], [/^резерв/, 'reserves'], [/^полос/, 'bounds']];
/** Номер «второй», «второго», «два» (с единицы); нет — null. */
const nth = (w: string): number | null => { const i = ordinalIndex(w.replace(/(?:ого|его|ому|ему|ым|им|ом|ем|ой|ую)$/, 'ой')) ?? ordinalIndex(w); return i === null ? null : i + 1; };

let live: (() => ScreenDeps) | null = null;
/** Действия сняты (выход из игры). */
export function releaseScreen(get: () => ScreenDeps): void { if (live === get) live = null; }

const NAME = { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] };

export function screenActions(get: () => ScreenDeps): Action[] {
  live = get;
  const ready = (): true | string => { const r = inReplay(); return r !== true ? r : get().view ? true : 'обстановка ещё готовится — подождите немного'; };
  const play = (): true | string => { const r = ready(); return r !== true ? r : get().view!.over ? 'игра окончена — приказы не нужны' : get().busy ? BUSY : true; };
  const base = { section: 'replay', available: ready };
  const variant = (n: unknown) => get().plan?.variants[Math.round(Number(n)) - 1] ?? null;
  return [
    { ...base, id: 'command.card.close', title: 'Закрыть карточку', describe: 'Закрывает карточку соединения противника на карте.', say: ['штаб, закрой карточку'],
      run: async () => { get().closeCard(); } },
    { ...base, id: 'command.unit.close', title: 'Закрыть доклад', describe: 'Закрывает раскрытый доклад объединения.', say: ['штаб, закрой доклад'],
      run: async () => { get().select(null); } },
    { ...base, id: 'command.order.open', highlight: noted, title: 'Приказ объединению', describe: 'Выбирает своё объединение во вкладке «Приказы», чтобы отдать или изменить приказ.',
      params: NAME, say: ['штаб, приказ восьмой гвардейской'], available: play,
      run: async (p: { name: string }) => {
        const d = get();
        const r = findOwn(String(p?.name ?? ''), d.view!);
        if (!r) return `Не нашёл своего объединения «${p?.name}».`;
        if ('say' in r) return r.say;
        d.select(r.found.id); d.setTab('orders'); d.setSub('units'); d.goTo(r.found.at, false);
        note(hl('oedit'), { at: r.found.at });
        const name = short(r.found.name);
        return `Приказ ${nameCase(name, 'dat')} — во вкладке «Приказы». Скажите его целиком, например: «${nameCase(name, 'dat')} наступать на …».`;
      } },
    { ...base, id: 'command.order.close', title: 'Закрыть приказ', describe: 'Закрывает редактор приказа (приказ остаётся в проекте).', say: ['штаб, закрой приказ'],
      run: async () => { get().select(null); } },
    { ...base, id: 'command.order.set', model: false, title: 'Правка приказа', describe: 'Правит приказ объединения в редакторе: задача (task), цель — пункт (place, id) или противник (enemy, id), указания (note); clear — убрать цель; form — приказ (order) или боевое распоряжение (instruction) на агентной модели.',
      params: { type: 'object', properties: { unit: { type: 'string' }, task: { enum: TASKS }, place: { type: 'string' }, enemy: { type: 'string' }, clear: { type: 'boolean' }, note: { type: 'string' }, form: { enum: ['order', 'instruction'] } }, required: ['unit'] },
      available: play,
      run: async (p: { unit: string; task?: Task; place?: string; enemy?: string; clear?: boolean; note?: string; form?: 'order' | 'instruction' }) => {
        const d = get(), v = d.view!;
        const u = v.own.find((x) => x.id === p?.unit && x.status !== 'destroyed');
        if (!u) return 'Такого объединения нет.';
        const cur: OrderDraft = d.drafts[u.id] ?? { formation: u.id, task: 'attack', target: null, targetText: '', at: null, note: '' };
        let next: OrderDraft = { ...cur };
        if (p.task) { if (!TASKS.includes(p.task)) return 'Такой задачи нет.'; next.task = p.task; }
        if (p.clear) next = { ...next, target: null, at: null, targetText: '' };
        if (p.place) { const pl = v.places.find((x) => x.id === p.place); if (!pl) return 'Такого пункта нет.'; next = { ...next, target: pl.id, at: pl.at, targetText: pl.title }; }
        if (p.enemy) { const e = v.intel.find((x) => x.id === p.enemy); if (!e) return 'Такого соединения противника нет.'; next = { ...next, target: { formation: e.id }, at: e.at, targetText: `против: ${short(e.name)}` }; }
        if (p.note !== undefined) next.note = String(p.note);
        if (p.form === 'order' || p.form === 'instruction') next.form = p.form;
        d.setDraft(u.id, next);
        return `${short(u.name)} — ${TASK_RU[next.task]}${next.targetText ? `, ${short(next.targetText)}` : ''}.`;
      } },
    { ...base, id: 'command.orders.sub', highlight: (p: { sub: OrdersSub }) => hl(`sub-${p?.sub}`), title: 'Подвкладка приказов', describe: 'Открывает во вкладке «Приказы»: войска, тыл, переправы, резервы, полосы.',
      params: { type: 'object', properties: { sub: { enum: Object.keys(SUB_TITLE) } }, required: ['sub'] }, say: ['штаб, открой тыл', 'штаб, открой резервы'],
      run: async (p: { sub: OrdersSub }) => { if (!SUB_TITLE[p?.sub]) return 'Такой подвкладки нет.'; get().setTab('orders'); get().setSub(p.sub); return `Приказы: «${SUB_TITLE[p.sub]}».`; } },
    // ---- советник: окно, беседа, варианты
    { ...base, id: 'command.advisor.show', highlight: (p: { mode: string }) => (p?.mode === 'close' ? null : p?.mode === 'min' ? hl('adv-tab') : [hl('advisor'), hl('adv-tab')]), title: 'Окно советника', describe: 'Окно советника: показать, свернуть к краю карты, скрыть (беседа сохраняется).',
      params: { type: 'object', properties: { mode: { enum: ['open', 'min', 'close', 'toggle'] } }, required: ['mode'] }, say: ['штаб, покажи советника', 'штаб, скрой советника'],
      run: async (p: { mode: 'open' | 'min' | 'close' | 'toggle' }) => {
        const d = get(), a = d.advisor;
        const mode = p?.mode === 'toggle' ? (a.open && a.min ? 'open' : a.open ? 'close' : 'open') : p?.mode;
        if (mode === 'open') { d.setAdvisor(true, false); return 'Советник открыт.'; }
        if (mode === 'min') { d.setAdvisor(true, true); return 'Советник свёрнут к краю карты.'; }
        if (mode === 'close') { d.setAdvisor(false, false); return 'Советник скрыт, беседа сохранена.'; }
        return 'Скажите: «покажи советника» или «скрой советника».';
      } },
    { ...base, id: 'command.advisor.clear', highlight: () => hl('advisor'), title: 'Очистить беседу с советником', describe: 'Стирает беседу с советником и его варианты (запросы останавливаются).', say: ['штаб, очисти беседу с советником'],
      params: { type: 'object', properties: { sure: { type: 'boolean' } } },
      // голосом: варианты и ответы — минуты работы модели; стереть — после «да» (кнопка «очистить» — как прежде)
      check: (p?: { sure?: boolean }) => (p?.sure || (!get().talk && !get().plan?.variants.some(Boolean)) ? true
        : { offer: 'Стереть беседу с советником и его варианты?', id: 'command.advisor.clear', params: { sure: true } }),
      run: async () => { get().clearAdvisor(); return 'Беседа с советником очищена.'; } },
    { ...base, id: 'command.variants.count', title: 'Сколько вариантов просить', describe: 'Сколько вариантов решения просить у советника по умолчанию (1–3).',
      params: { type: 'object', properties: { n: { type: 'integer', minimum: 1, maximum: 3 } }, required: ['n'] },
      run: async (p: { n: number }) => { const n = Math.round(Number(p?.n)); if (!(n >= 1 && n <= 3)) return 'От одного до трёх.'; get().setPlanN(n); return `Просить вариантов: ${numberWords(n)}.`; } },
    { ...base, id: 'command.variant.open', highlight: (p: { n?: number; open?: boolean }) => (p?.n && p.open !== false ? hl(`variant-${p.n}`) : null), title: 'Раскрыть вариант', describe: 'Раскрывает вариант решения N на экране (без чтения); open: false — свернуть.',
      params: { type: 'object', properties: { n: { type: 'integer', minimum: 1, maximum: 3 }, open: { type: 'boolean' } } }, say: ['штаб, раскрой второй вариант'],
      available: () => { const r = ready(); return r !== true ? r : get().plan?.variants.some(Boolean) ? true : 'вариантов ещё нет. Скажите: «Штаб, дай три варианта»'; },
      run: async (p: { n?: number; open?: boolean }) => {
        if (p?.open === false || !p?.n) { get().setPlanOpen(null); return; }
        if (!variant(p.n)) return 'Такого варианта нет.';
        get().setPlanOpen(p.n - 1); get().setAdvisor(true, false);
      } },
    { ...base, id: 'command.variant.take', highlight: noted, title: 'Взять из варианта', describe: 'Берёт в проект один приказ (order — номер) или распоряжение (act — номер) из варианта решения N.',
      params: { type: 'object', properties: { n: { type: 'integer' }, order: { type: 'integer' }, act: { type: 'integer' } }, required: ['n'] },
      say: ['штаб, возьми из первого варианта второй приказ'], available: play,
      run: async (p: { n: number; order?: number; act?: number }) => {
        const v = variant(p?.n);
        if (!v) return 'Такого варианта нет.';
        if (p.order !== undefined) {
          const o = v.orders[p.order - 1];
          if (!o || !o.ok) return 'Такого приказа в варианте нет.';
          get().takeSuggestion(o);
          note(hl(`order-${o.formation}`), hl(`orow-${o.formation}`), ...(o.at ? [{ at: o.at }] : []));
          return `В проекте: ${short(o.name)} — ${TASK_RU[o.task]}${o.targetText ? `, ${short(o.targetText)}` : ''}.`;
        }
        const a = v.acts[(p.act ?? 0) - 1];
        if (!a || !a.ok || !a.action) return 'Такого распоряжения в варианте нет.';
        if (!(await get().addAct(a))) return `Не выйдет: ${a.label}.`;
        note(hl(`act-${a.key}`));
        return `В проекте: ${a.label}.`;
      } },
    { ...base, id: 'command.suggestion.take', model: false, title: 'Приказ советника — в распоряжение', describe: 'Берёт в проект приказ, предложенный советником в ответе msg (i — номер).',
      params: { type: 'object', properties: { msg: { type: 'integer' }, i: { type: 'integer' } }, required: ['msg', 'i'] }, available: play,
      run: async (p: { msg: number; i: number }) => {
        const s = get().suggestion(p?.msg, p?.i);
        if (!s || !s.ok) return 'Такого предложенного приказа нет.';
        get().takeSuggestion(s);
        return `В распоряжение: ${short(s.name)} — ${TASK_RU[s.task]}.`;
      } },
    { ...base, id: 'command.act.drop', model: false, title: 'Убрать распоряжение', describe: 'Убирает распоряжение из проекта по его ключу (кнопка «×» у распоряжения).',
      params: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] }, available: play,
      run: async (p: { key: string }) => { const a = get().acts.find((x) => x.key === p?.key); if (!a) return 'Такого распоряжения нет.'; get().dropAct(a.key); return `Отменено: ${a.label}.`; } },
    // ---- карта
    { ...base, id: 'map.center', model: false, title: 'Показать точку на карте', describe: 'Показывает на карте точку (база, переправа, район резерва, армия).',
      params: { type: 'object', properties: { at: { type: 'array', items: { type: 'number' } }, zoom: { type: 'boolean' } }, required: ['at'] },
      run: async (p: { at: LngLat; zoom?: boolean }) => { if (!Array.isArray(p?.at) || p.at.length !== 2) return 'Не знаю, где это.'; get().goTo(p.at, p.zoom !== false); } },
    { ...base, id: 'map.event', highlight: noted, title: 'Показать событие операции', describe: 'Переводит карту к контрольному событию операции (по названию): время и место.',
      params: NAME, say: ['штаб, покажи событие Зееловские высоты'],
      run: async (p: { name: string }) => {
        const gs = get().view!.goals.filter((g) => g.at);
        if (!gs.length) return 'Контрольные события в игре ещё не случились.';
        const r = pickTitle(String(p?.name ?? ''), gs.map((g) => g.title.split(':')[0]), 'Какое событие', `События «${p?.name}» нет`);
        if ('say' in r) return r.say;
        const g: Goal = gs[r.index];
        get().setTime(g.at!);
        if (g.place) { get().goTo(g.place); note({ at: g.place }); }
        return `Событие: ${g.title.split(':')[0]}.`;
      } },
    { ...base, id: 'map.focusOnly', highlight: () => btn('map.focusOnly'), title: 'Списки — только участок', describe: 'Доклады, разведка и приказы — только по участку в фокусе (on) или по всему театру.',
      params: { type: 'object', properties: { on: { type: 'boolean' } }, required: ['on'] }, say: ['штаб, в списках только участок', 'штаб, в списках весь театр'],
      available: () => { const r = ready(); return r !== true ? r : get().focus ? true : 'участок не выбран. Скажите: «участок …»'; },
      run: async (p: { on: boolean }) => { get().setFocusOnly(!!p?.on); return p?.on ? 'В списках — только участок.' : 'В списках — весь театр.'; } },
    { ...base, id: 'command.toEditor', title: 'Карта в редакторе', describe: 'Открывает карту игры в разделе «Редактор» (правка, экспорт).', say: ['штаб, открой карту в редакторе'],
      run: async () => (get().toEditor() ? 'Карта игры открыта в редакторе.' : 'Карта ещё не готова.') },
    // ---- посредник, полосы
    { ...base, id: 'command.umpire.part', highlight: (p: { part: string }) => hl(`ump-${p?.part}`), title: 'Посредник: что показать', describe: 'Вкладка «Посредник»: как действовал противник или поправки посредника.',
      params: { type: 'object', properties: { part: { enum: ['enemy', 'umpire'] } }, required: ['part'] }, say: ['штаб, покажи поправки посредника'],
      run: async (p: { part: 'enemy' | 'umpire' }) => {
        if (p?.part !== 'enemy' && p?.part !== 'umpire') return 'Скажите: «как действовал противник» или «покажи поправки посредника».';
        get().setTab('umpire'); get().setUmpirePart(p.part);
        return p.part === 'umpire' ? 'Поправки посредника — на экране.' : 'Решения штаба противника — на экране.';
      } },
    { ...base, id: 'command.bounds.select', model: false, title: 'Армии для линии', describe: 'Вкладка «Полосы»: фронт и две армии, между которыми намечается линия.',
      params: { type: 'object', properties: { front: { type: 'string' }, a: { type: 'string' }, b: { type: 'string' } } }, available: play,
      run: async (p: { front?: string; a?: string; b?: string }) => { get().setBounds(p ?? {}); } },
  ];
}

// ---------------------------------------------------------------- разбор фраз

function hit(id: string, params?: unknown): PhraseHit {
  return getAction(id) ? { id, params } : { say: `Сейчас нельзя: ${NO_GAME}.` };
}

/** Экранные фразы (см. шапку модуля); только в «Переигровке». */
export function parseScreen(rest: string, section: string): PhraseHit | null {
  if (section !== 'replay') return null;
  const t = norm(rest);
  let m: RegExpExecArray | null;
  const v = live?.().view ?? null;
  if ((m = /^(?:(?:новый|отдай|отдать|дай) )?приказ (.+)$/.exec(t)) && v) {
    // только название своего объединения (иначе — фраза приказа или вопрос: их разбирают другие)
    return getAction('command.order.open') && findOwn(m[1], v) && !/\s(?:на|к|в)\s/.test(` ${m[1]} `) ? { id: 'command.order.open', params: { name: m[1] } } : null;
  }
  if (/^(?:закрой|закрыть) (?:приказ|редактор приказа)$/.test(t)) return hit('command.order.close');
  if (/^(?:закрой|закрыть|сверни) доклад$/.test(t)) return hit('command.unit.close');
  if (/^(?:закрой|закрыть|убери) карточку(?: противника)?$/.test(t)) return hit('command.card.close');
  if ((m = /^(?:открой|перейди на|переключись на|переключи на)(?: вкладку| подвкладку)? (\p{L}+)$/u.exec(t))) {
    const sub = SUB_WORD.find(([re]) => re.test(m![1]))?.[1];
    if (sub) return hit('command.orders.sub', { sub });
  }
  if (/^(?:покажи|открой|разверни|позови) советника$/.test(t)) return hit('command.advisor.show', { mode: 'open' });
  if (/^(?:скрой|закрой|убери) советника$/.test(t)) return hit('command.advisor.show', { mode: 'close' });
  if (/^сверни советника$/.test(t)) return hit('command.advisor.show', { mode: 'min' });
  if (/^(?:очисти|сотри) (?:беседу|беседу с советником|советника)$/.test(t)) return hit('command.advisor.clear');
  if ((m = /^(?:раскрой|разверни)(?: вариант)? (\p{L}+|\d)(?: вариант)?$/u.exec(t)) && nth(m[1])) return hit('command.variant.open', { n: nth(m[1]) });
  if (/^(?:сверни|закрой) варианты?$/.test(t)) return hit('command.variant.open', { open: false });
  if ((m = /^(?:возьми|взять) из (\p{L}+) варианта (\p{L}+) (приказ|распоряжение)$/u.exec(t)) && nth(m[1]) && nth(m[2]))
    return hit('command.variant.take', { n: nth(m[1]), [m[3] === 'приказ' ? 'order' : 'act']: nth(m[2]) });
  // событие — только если такое случилось (иначе «событие было вчера» — вопрос модели)
  if ((m = /^(?:покажи |перейди к )?событи\p{L}* (.+)$/u.exec(t)) && v && pickByName(m[1], v.goals.filter((g) => g.at).map((g) => g.title.split(':')[0])).length)
    return hit('map.event', { name: m[1] });
  if (/^(?:в списках|списки)(?: только)? (?:участок|по участку)$/.test(t)) return hit('map.focusOnly', { on: true });
  if (/^(?:в списках|списки)(?: по)? (?:весь театр|всему театру)$/.test(t)) return hit('map.focusOnly', { on: false });
  if (/^(?:открой|перенеси|отправь) карту(?: игры)? в редактор\p{L}*$/u.test(t)) return hit('command.toEditor');
  if (/^(?:покажи|открой) поправки посредника$/.test(t)) return hit('command.umpire.part', { part: 'umpire' });
  if (/^(?:покажи|включи) все слои$/.test(t)) return getAction('map.layers.all') ? { id: 'map.layers.all', params: { on: true } } : null;
  if (/^(?:скрой|убери|выключи) все слои$/.test(t)) return getAction('map.layers.all') ? { id: 'map.layers.all', params: { on: false } } : null;
  return null;
}

registerParser(parseScreen);
