/**
 * «Итоги» голосом и кнопками: `results.show {part}` открывает вкладку «Итоги» и её часть — в игре вкладку
 * командования, в переигровке вкладку боковой панели (разбор хода там — по суткам расчёта). Разбор хода:
 * `command.debrief.as {name}` — «разобрать с позиции …», `command.debrief.event {n}` — событие на карте и раскрыть,
 * `command.debrief.narrate` — связный текст модели по тем же фактам. Регистрируют ReplayView и CommandView; игра
 * открывается поверх переигровки, поэтому окна — стопкой: действия говорят с верхним, а когда игра закрыта, действия
 * снова принадлежат переигровке. `results.losses.read` — «доложи потери»: свои и противника словами (`lossesSay`).
 * Фразы — `parseResults` (зовёт `parseCommand` до общих «покажи …»): «итоги хода», «покажи потери», «сравни с историей»,
 * «доложи потери», «разбери ход с позиции …», «покажи событие два», «расскажи ход связно».
 */
import { getAction, register, type Action, type PhraseHit } from '../registry';
import { hl } from '../highlight';
import { inReplay } from './command';
import { spokenNumber } from '../answers';
import { findUnit } from '../places';
import { numberWords, plural } from '../speech';
import { histPerDay, historyOf, PART_TITLE, type ResultsPart } from '../../results-view';
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
      // штаб по названию — тем же поиском соединения, что у вкладки штаба (номер словами, падеж, сокращения)
      const hqs = opts.flatMap((o) => (o.id != null ? [{ ...o, id: o.id, name: o.label }] : []));
      const hit = [terms.top, terms.topGen].map(norm).includes(q) ? opts[0]
        : opts.find((o) => o.id != null && (o.id === p?.name || norm(o.label) === q)) ?? (q ? findUnit(p?.name ?? '', hqs).unit : undefined)
          ?? (q.length >= 3 ? opts.find((o) => o.id != null && norm(o.label).startsWith(q)) : undefined);
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
  const read: Action = {
    id: 'results.losses.read', section: 'replay', title: 'Доложить потери',
    describe: 'Докладывает потери своей стороны и противника за всё время и за последние сутки (люди, танки, орудия), рядом — исторические среднесуточные, если они есть в базе знаний.',
    say: ['штаб, доложи потери'],
    available: show.available,
    highlight: () => hl('results-losses'),
    run: async () => {
      const d = top(), s = d?.summary();
      if (!d || !s) return 'Итогов нет.';
      d.setPart('losses');
      return lossesSay(s, d.side());
    },
  };
  show.say = ['штаб, итоги хода', 'штаб, покажи потери', 'штаб, сравни с историей', 'штаб, покажи итоги'];
  as.say = ['штаб, разбери ход с позиции Ставки', 'штаб, разбери ход с позиции восьмой гвардейской армии'];
  event.say = ['штаб, покажи событие два'];
  narrate.say = ['штаб, расскажи ход связно'];
  actions = [show, as, event, narrate, read];
  return actions;
}

/** Окно закрыто: убрать его из стопки; осталось окно под ним — действие снова его. */
export function releaseResults(get: () => ResultsDeps): void {
  const i = stack.lastIndexOf(get);
  if (i >= 0) stack.splice(i, 1);
  again?.(); again = null;
  if (stack.length && actions.length) { const offs = actions.map(register); again = () => offs.forEach((o) => o()); }
}

// ---------------------------------------------------------------- доклад потерь и фразы

const people = (n: number) => `${numberWords(n)} ${plural(n, ['человек', 'человека', 'человек'])}`;
const lossWords = (l: { personnel: number; tanks: number; guns: number }) => [
  people(Math.round(l.personnel)),
  l.tanks >= 1 ? `${numberWords(Math.round(l.tanks))} ${plural(Math.round(l.tanks), ['танк', 'танка', 'танков'])}` : null,
  l.guns >= 1 ? `${numberWords(Math.round(l.guns), 'n')} ${plural(Math.round(l.guns), ['орудие', 'орудия', 'орудий'])}` : null,
].filter(Boolean).join(', ');

/**
 * Потери голосом: свои и противника за всё время и за последние сутки, числа словами; рядом — исторические
 * среднесуточные стороны, если они есть в базе знаний (немецкие — по советскому донесению). Старый ход — с пометкой оценки.
 */
export function lossesSay(s: OperationSummary, side: 'su' | 'de'): string {
  const other = side === 'su' ? 'de' : 'su';
  const part = (id: 'su' | 'de', who: string): string | null => {
    const r = s.losses.rows.find((x) => x.id === id);
    if (!r) return null;
    const last = r.byDay[r.byDay.length - 1];
    const perDay = historyOf(s, id).map(histPerDay).find((x) => x != null) ?? null;
    return [
      `${who} — ${lossWords(r.total)}`,
      last && r.byDay.length > 1 ? `; за последние сутки — ${people(Math.round(last.personnel))}` : '',
      perDay != null ? `; в истории — в среднем ${people(perDay)} в сутки${id === 'de' ? ', по советскому донесению' : ''}` : '',
      '.',
    ].join('');
  };
  const out = [part(side, 'Наши потери'), part(other, 'Потери противника')].filter((x): x is string => !!x);
  if (!out.length) return 'Потерь в расчёте нет.';
  if (!s.losses.exact) out.push('Это оценка по убыли численности: пополнения и передачи не различаются.');
  return out.join(' ');
}

const hitOr = (id: string, params?: unknown): PhraseHit => (getAction(id)
  ? (params === undefined ? { id } : { id, params })
  : { say: 'Сейчас нельзя: итогов нет — рассчитайте операцию на агентной модели или сыграйте ход.' });

/**
 * Фразы итогов и разбора хода (rest — без обращения; только в «Переигровке»); не они — null. Номер события — словами
 * и цифрами; штаб — как сказан (ищет действие).
 */
export function parseResults(rest: string, section: string): PhraseHit | null {
  if (section !== 'replay') return null;
  const t = norm(rest);
  let m: RegExpExecArray | null;
  if (/^(?:покажи |открой )?итоги хода$/.test(t)) return hitOr('results.show', { part: 'turn' });
  if (/^(?:покажи|открой) итоги(?: операции)?$|^итоги(?: операции)?$/.test(t)) return hitOr('results.show', {});
  if (/^(?:покажи|открой) потери(?: сторон)?$/.test(t)) return hitOr('results.show', { part: 'losses' });
  if (/^(?:сравни|сравнить|покажи сравнение|сравнение)(?: игру)? с историей$/.test(t)) return hitOr('results.show', { part: 'compare' });
  if (/^(?:доложи|доложите|прочитай|какие|каковы)(?: наши)? потери$|^доклад о потерях$/.test(t)) return hitOr('results.losses.read');
  if ((m = /^(?:разбери|разобрать|разбор) ход(?:а)? с позиции (.+)$/.exec(t))) {
    // название — как сказано (регистр сохранён: «Ставки»)
    const raw = /с позиции\s+(.+)$/i.exec(rest.trim())?.[1]?.replace(/[«»".]/g, '').trim() ?? m[1];
    return hitOr('command.debrief.as', { name: raw });
  }
  if ((m = /^(?:покажи |открой |раскрой )?событие (?:номер )?(.+)$/.exec(t))) {
    const n = spokenNumber(m[1]);
    return n == null ? null : hitOr('command.debrief.event', { n });
  }
  if (/^(?:расскажи|разбери|опиши) ход связно$|^связный разбор(?: хода)?$/.test(t)) return hitOr('command.debrief.narrate');
  return null;
}
