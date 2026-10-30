/**
 * «Итоги» голосом и кнопками: `results.show {part}` открывает вкладку «Итоги» и её часть — в игре вкладку
 * командования, в переигровке вкладку боковой панели (разбор хода там — по суткам расчёта). Разбор хода:
 * `command.debrief.as {name}` — «разобрать с позиции …», `command.debrief.event {n}` — событие на карте и раскрыть,
 * `command.debrief.narrate` — связный текст модели по тем же фактам. Регистрируют ReplayView и CommandView; игра
 * открывается поверх переигровки, поэтому окна — стопкой: действия говорят с верхним, а когда игра закрыта, действия
 * снова принадлежат переигровке.
 */
import { register, type Action } from '../registry';
import { hl } from '../highlight';
import { inReplay } from './command';
import { PART_TITLE, type ResultsPart } from '../../results-view';
import { perspectiveOptions } from '../../debrief-view';
import { debriefFor, type CommandTerms, type OperationSummary, type TurnDebrief } from '@def-ops/sim';

export interface ResultsDeps {
  /** Какое окно показывает итоги: переигровка, игра; null — итогов нет. */
  section(): 'replay' | 'command' | null;
  summary(): OperationSummary | null;
  side(): 'su' | 'de';
  /** Открыть вкладку «Итоги» и часть. */
  setPart(p: ResultsPart): void;
  /** Разбор хода, который показан (игра — последний ход, переигровка — сутки на шкале); null — нет. */
  debrief(): TurnDebrief | null;
  terms(): CommandTerms;
  /** Позиция разбора: штаб; null — верхняя инстанция. */
  hq(): string | null;
  setHq(hq: string | null): void;
  /** Событие n (с 1) — карта к нему, событие раскрыто. */
  openEvent(n: number): void;
  /** Связный текст модели по фактам разбора. */
  narrate(): void;
  modelOn(): boolean;
}

const stack: (() => ResultsDeps)[] = [];
const top = () => stack[stack.length - 1]?.();
let actions: Action[] = [];
/** Снятие действия, заново зарегистрированного для окна под закрытым. */
let again: (() => void) | null = null;

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/[«»"'.]/g, '').replace(/\s+/g, ' ').trim();
const NO_DEBRIEF = 'разбора хода нет: в игре — после первого сыгранного хода, в переигровке — у расчёта на агентной модели';
const OFF = 'модель не на связи — разбор по данным хода';
const debriefOn = () => { const r = inReplay(); if (r !== true) return r; return top()?.debrief() ? true : NO_DEBRIEF; };

export function resultsActions(get: () => ResultsDeps): Action[] {
  stack.push(get);
  const show: Action = {
    id: 'results.show', section: 'replay', title: 'Итоги операции',
    describe: 'Открывает вкладку «Итоги» и её часть: turn — разбор хода (в игре — последний ход, в переигровке — сутки на шкале времени), losses — потери сторон рядом с историческими, compare — сравнение с историей.',
    params: { type: 'object', properties: { part: { enum: ['turn', 'losses', 'compare'] } } },
    say: ['штаб, покажи итоги', 'штаб, покажи потери'],
    available: () => { const r = inReplay(); if (r !== true) return r; return top()?.section() ? true : 'итогов нет: рассчитайте операцию на агентной модели'; },
    highlight: (p?: { part?: ResultsPart }) => hl(`results-${p?.part ?? 'losses'}`),
    run: async (p?: { part?: ResultsPart }) => {
      const d = top();
      if (!d) return 'Итогов нет.';
      const part: ResultsPart = p?.part && PART_TITLE[p.part] ? p.part : 'losses';
      if (part === 'turn' && !d.debrief()) return `${NO_DEBRIEF[0].toUpperCase()}${NO_DEBRIEF.slice(1)}.`;
      d.setPart(part);
      return `Итоги: ${PART_TITLE[part].toLowerCase()}.`;
    },
  };
  const as: Action = {
    id: 'command.debrief.as', section: 'replay', title: 'Разобрать ход с позиции штаба',
    describe: 'Разбор хода с позиции верхней инстанции (Ставка, ОКХ) или своего штаба: события и войска — его поддерева и полосы, оценка — против его задачи и исторического пути. name — название или id штаба.',
    params: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    available: debriefOn,
    highlight: () => hl('debrief-as'),
    run: async (p?: { name?: string }) => {
      const d = top(), b = d?.debrief();
      if (!d || !b) return 'Разбора хода нет.';
      const terms = d.terms(), q = norm(p?.name ?? '');
      const opts = perspectiveOptions(b, terms);
      const hit = [terms.top, terms.topGen].map(norm).includes(q) ? opts[0]
        : opts.find((o) => o.id != null && (o.id === p?.name || norm(o.label) === q)) ?? (q.length >= 3 ? opts.find((o) => o.id != null && norm(o.label).startsWith(q)) : undefined);
      if (!hit) return `Такого штаба нет: ${p?.name ?? ''}.`;
      d.setHq(hit.id);
      d.setPart('turn');
      const f = debriefFor(b, hit.id);
      const n = f.events.length;
      return [`Разбор хода с позиции: ${hit.label}${hit.note ? ` — ${hit.note}` : ''}.`, n ? `Событий: ${n}.` : 'Ключевых событий нет.', ...f.verdict.map((v) => `${v[0].toUpperCase()}${v.slice(1)}.`)].join(' ');
    },
  };
  const event: Action = {
    id: 'command.debrief.event', section: 'replay', title: 'Событие разбора хода на карте',
    describe: 'Показывает ключевое событие хода n (номер метки на карте, с 1): карта переезжает к месту, событие раскрыто — что, где, почему, что значит.',
    params: { type: 'object', properties: { n: { type: 'integer', minimum: 1 } }, required: ['n'] },
    available: debriefOn,
    highlight: (p?: { n?: number }) => hl(`debrief-ev-${p?.n ?? 1}`),
    run: async (p?: { n?: number }) => {
      const d = top(), b = d?.debrief();
      if (!d || !b) return 'Разбора хода нет.';
      const evs = debriefFor(b, d.hq()).events, n = Math.round(Number(p?.n));
      if (!evs.length) return 'За ход ключевых событий нет.';
      if (!(n >= 1 && n <= evs.length)) return `Такого события нет: событий за ход ${evs.length}.`;
      d.setPart('turn');
      d.openEvent(n);
      return `Событие ${n}: ${evs[n - 1].title}.`;
    },
  };
  const narrate: Action = {
    id: 'command.debrief.narrate', section: 'replay', title: 'Связный разбор хода (модель)',
    describe: 'Модель посредника пишет связный разбор хода по тем же фактам (события, причины, оценка позиции), без новых чисел и названий; без модели — недоступно, разбор по данным хода остаётся.',
    available: () => { const r = debriefOn(); if (r !== true) return r; return top()?.modelOn() ? true : OFF; },
    highlight: () => hl('debrief-narrate'),
    run: async () => {
      const d = top();
      if (!d?.debrief()) return 'Разбора хода нет.';
      if (!d.modelOn()) return `${OFF[0].toUpperCase()}${OFF.slice(1)}.`;
      d.setPart('turn');
      d.narrate();
      return 'Связный разбор хода: модель пишет по данным хода.';
    },
  };
  actions = [show, as, event, narrate];
  return actions;
}

/** Окно закрыто: убрать его из стопки; осталось окно под ним — действие снова его. */
export function releaseResults(get: () => ResultsDeps): void {
  const i = stack.lastIndexOf(get);
  if (i >= 0) stack.splice(i, 1);
  again?.(); again = null;
  if (stack.length && actions.length) { const offs = actions.map(register); again = () => offs.forEach((o) => o()); }
}
