/**
 * «Командование» голосом — ход и что после него: провести ход (необратимо: подтверждение со словами; не готово — что
 * именно и предложение), штаб противника не дал решения (повторить запрос / ход без его приказов), доклад посредника
 * («повтори доклад»), как действовал противник, разбор операции (составить, прочитать раздел, остановить, сохранить),
 * журнал и запись игры — в «Загрузки». Чистый модуль (без React): CommandView передаёт состояние через get() и регистрирует
 * turnActions; кнопки «Провести ход ▸», «Повторить запрос», «Разбор операции», «Скачать журнал»… вызывают те же действия.
 *
 * Фразы (parseTurn, только в «Переигровке»): «проводи ход» / «сделай ход» / «давай ход» / «можно проводить ход»,
 * «повтори запрос», «ход без его приказов», «повтори доклад», «как действовал противник», «составь разбор», «открой /
 * закрой разбор», «прочитай итоговую оценку» (раздел разбора — если разбор открыт и такой раздел есть), «останови
 * разбор», «сохрани разбор [в маркдаун]», «сохрани журнал», «сохрани запись игры»; возврат и ветви — «вернись к ходу N»,
 * «вернись на ход назад», «покажи ветви», «перейди на ветвь от хода N» / «на основную линию», «удали ветвь …».
 */
import { TASK_RU, type GameRecord } from '@def-ops/sim';
import type { AiTurn } from '@def-ops/staff-service/live';
import type { AiStatus, EnemyMode, HumanDecision, TurnView } from '../../sim/game-protocol';
import { findLine, pickByName, spokenNumber } from '../answers';
import { readAloud } from '../dictation';
import { saveFile, savedText, textFile } from '../files';
import { getAction, registerParser, speak, voiceRecent, type Action, type Offer, type PhraseHit } from '../registry';
import { hl, tourEl } from '../highlight';
import { dayMonth, sentence, short } from '../report';
import { numberWords, speakable } from '../speech';
import { lastUmpire, repeatUmpire, showTurnReview } from '../umpire';
import { claimMore, inReplay, NO_GAME, type CmdTab } from './command';
import { BUSY_REFUSAL as BUSY_REWIND, rewindCheck } from '../../sim/game-rewind';
import { askTarget, BUSY, decisionMissing, NEEDS_TARGET, projectHas, type OrderDraft, type PlanState, type StaffAct } from './staff';

// ---------------------------------------------------------------- состояние

/** Разбор операции, пока его окно смонтировано (ReviewView). */
export interface ReviewCtl {
  sections(): { id: string; title: string; done: boolean; text: string }[];
  running(): boolean;
  /** Написать разделы ids (нет — все ненаписанные); промис — когда закончены или остановлены. */
  compose(ids?: string[]): Promise<void>;
  stop(): void;
  markdown(): string;
  pdf(): Promise<Blob>;
  name(ext: 'pdf' | 'md'): string;
}

export interface TurnDeps {
  view: TurnView | null;
  /** Обстановка на начало прошедшего хода (разбор хода: откуда проигрывать); нет — после перезапуска игры. */
  prev: TurnView | null;
  /** Идёт расчёт хода (текст). */
  busy: string | null;
  /** Штаб противника не дал решения (причина) — ход ждёт. */
  blocked: string | null;
  enemy: EnemyMode;
  ai: AiStatus;
  /** Решения штаба противника, новые — первыми. */
  aiTurns: AiTurn[];
  record: GameRecord | null;
  drafts: Record<string, OrderDraft>;
  acts: StaffAct[];
  decision: HumanDecision;
  plan: PlanState | null;
  planN: number;
  /** Отдать ход на расчёт (приказы, распоряжения, решение). */
  sendTurn(): void;
  retryAi(): void;
  skipAi(): void;
  setTab(t: CmdTab): void;
  setUmpirePart(p: 'enemy' | 'umpire'): void;
  /** Показать, чего не хватает для хода (вкладка, выбранный приказ, уведомление). */
  showMissing(m: Missing): void;
  /** Уведомление на экране. */
  notice(text: string): void;
  review: { open: boolean; ctl: ReviewCtl | null; show(on: boolean): void };
  journal(): { name: string; text: string };
  gameRecord(): { name: string; text: string } | null;
  /** Решения пунктов управления ниже Ставки в проекте хода (их тоже снимает возврат). */
  postProject?: boolean;
  /** Линии игры (game-branches lines): текущая первой. */
  lines: BranchLine[];
  /** Окно «Ветви» у ленты ходов. */
  branches: { open: boolean; show(on: boolean): void };
  /** Вернуться к ходу N (поток игры); ответ — когда поток вернулся и прежняя линия сохранена ветвью. */
  rewind(turn: number): Promise<RewindResult>;
  /** Перейти на ветвь id: запись — на неё, поток досчитывает её ходы повтором. */
  switchBranch(id: string): Promise<SwitchResult>;
  /** Удалить ветвь id (запись и её ходы); ошибка — текст, иначе null. */
  deleteBranch(id: string): Promise<string | null>;
}

export interface BranchLine { id: string | null; name: string; turns: number; from: number | null; current: boolean }
/** branch — имя ветви, под которым сохранена прежняя линия; null — снятых ходов не было; dup — такая линия уже была. */
export type RewindResult = { ok: true; at: string; branch: string | null; dup?: boolean } | { ok: false; text: string };
export type SwitchResult = { ok: true; name: string; turns: number } | { ok: false; text: string };

/** Чего не хватает для хода: приказы без цели (объединения), поля решения (подписи). */
export interface Missing { targets: string[]; decision: string[] }
export function turnMissing(p: { drafts: Record<string, OrderDraft>; decision: HumanDecision }): Missing {
  return {
    targets: Object.values(p.drafts).filter((d) => NEEDS_TARGET.includes(d.task) && !d.target).map((d) => d.formation),
    decision: decisionMissing(p.decision),
  };
}

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
const low = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
/** Markdown — в текст для чтения: заголовки — предложениями, разметка снята. */
const plain = (md: string) => md.split('\n').map((l) => l.trim()).filter(Boolean)
  .map((l) => (/^#{1,6}\s/.test(l) ? `${l.replace(/^#+\s*/, '').replace(/[.:\s]+$/, '')}.` : l.replace(/^\s*(?:[-•*]|\d+[.)])\s+/, '')))
  .join(' ').replace(/[*_`>]+/g, '').replace(/\s+/g, ' ').trim();
/** Причина сбоя модели словами: техническое не пересказывается. */
const reason = (e: string) => {
  const t = e.replace(/LM Studio/g, 'моделью').trim().replace(/[.\s]+$/, '');
  return /[A-Za-z]{3}/.test(t) || !t ? 'сбой модели, подробности на экране' : t;
};

/** Разделы разбора по названию: «итоговую оценку», «тыл и снабжение», «раздел разведка». */
function findSection(said: string, secs: { id: string; title: string }[]): number[] {
  const q = norm(said).replace(/^(?:раздел\p{L}*|часть) /u, '').replace(/ (?:из )?разбора$/, '');
  return q ? pickByName(q, secs.map((s) => s.title)) : [];
}

/** «18 апреля, 06:00» — начало хода. */
const when = (t: string) => `${dayMonth(t)}, ${t.slice(11, 16)}`;
const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
const end = (x: string) => { const t = cap(x.trim()); return /[?]$/.test(t) ? t : `${t.replace(/[.!\s]+$/, '')}.`; };
/** Проект хода не пуст (приказы, распоряжения, решение, решения пунктов) — при возврате он пропадёт. */
export const SWITCH_OFFER = (name: string) => `В проекте хода есть приказы и распоряжения — при переходе они пропадут. Перейти на ветвь «${name}»?`;
export const REWIND_OFFER = (n: number) => `В проекте хода есть приказы и распоряжения — при возврате они пропадут. Вернуться к ходу ${n}?`;

// ---------------------------------------------------------------- действия

/** Состояние зарегистрированных действий (разбор фраз: открыт ли разбор, есть ли раздел). */
let live: (() => TurnDeps) | null = null;
/** Действия сняты (выход из игры). */
export function releaseTurn(get: () => TurnDeps): void { if (live === get) live = null; }

const SECTION = { type: 'object', properties: { section: { type: 'string' } }, required: ['section'] };
const TURN_NO = { type: 'object', properties: { turn: { type: 'integer', minimum: 1 } }, required: ['turn'] };
const NAME = { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] };
const WAIT_MS = 3000;

export function turnActions(get: () => TurnDeps): Action[] {
  live = get;
  const game = (): true | string => {
    const r = inReplay(); if (r !== true) return r;
    return get().view ? true : 'обстановка ещё готовится — подождите немного';
  };
  const play = (): true | string => {
    const r = game(); if (r !== true) return r;
    const d = get();
    if (d.view!.over) return 'игра окончена. Можно сказать: «Штаб, составь разбор»';
    if (d.blocked) return 'штаб противника не дал решения. Скажите «повтори запрос» или «ход без его приказов»';
    return d.busy ? BUSY : true;
  };
  const played = (): true | string => { const r = game(); return r !== true ? r : get().record?.turns.length ? true : 'разбор — после первого хода: ходов ещё не было'; };
  const unitName = (id: string) => short(get().view!.own.find((u) => u.id === id)?.name ?? id);

  /** Не готово — что именно и что предложить (вместо подтверждения хода). */
  const notReady = (m: Missing): string | Offer => {
    const d = get(), v = d.view!;
    if (m.targets.length) {
      const o = d.drafts[m.targets[0]];
      const head = speakable(`Ход проводить рано: у приказа нет цели — ${unitName(o.formation)} — ${TASK_RU[o.task]}.`, { full: true });
      return `${head} ${askTarget(o.formation, unitName(o.formation), o.task, o.note)}`;
    }
    const head = `Ход проводить рано: не готово — ${m.decision.join(', ')}.`;
    const p = d.plan;
    const vs = p && p.time === v.time ? p.variants.map((x, i) => ({ x, i })).filter((y) => y.x) : [];
    if (p && p.done && vs.length && p.accepted === undefined) {
      const replace = projectHas(d, v.lastDecision);
      return { offer: `${head} ${replace ? 'Заменить проект вариантом' : 'Составить решение по варианту'} «${vs[0].x.title}»?`,
        id: replace ? 'command.variant.replace' : 'command.variant.pick', params: { n: vs[0].i + 1 } };
    }
    if (p && !p.done && p.time === v.time) return `${head} Советник готовит варианты — скажу, когда будут готовы.`;
    if (m.decision.length === 1 && !d.decision.report.trim())
      return { offer: `${head} Составить черновик донесения?`, id: 'decision.draftReport' };
    return { offer: `${head} Попросить у советника варианты решения?`, id: 'command.variants', params: { count: d.planN } };
  };
  const confirm = () => {
    const d = get();
    const n = Object.keys(d.drafts).length, m = d.acts.length;
    return `Провожу ход: решение готово, ${n ? `приказов ${numberWords(n)}` : 'новых приказов нет'}, ${m ? `распоряжений ${numberWords(m, 'n')}` : 'распоряжений нет'}.`;
  };

  /** Окно разбора: открыть и дождаться, пока оно смонтируется. */
  const reviewCtl = async (): Promise<ReviewCtl | null> => {
    if (!get().review.open || !get().review.ctl) get().review.show(true);
    for (let k = 0; k < WAIT_MS / 50 && !get().review.ctl; k++) await new Promise((r) => setTimeout(r, 50));
    return get().review.ctl;
  };
  const save = async (name: string, data: Blob, done: string, what: string) => {
    const t = savedText(await saveFile(name, data), done, what);
    get().notice(t.screen);
    return t.say;
  };
  /** Возврат к ходу n: нельзя — почему; проект хода не пуст (offer) — предложение с явным «да». */
  const rewindAsk = (n: number, offer: boolean): true | string | Offer => {
    const d = get();
    const no = rewindCheck({ busy: !!d.busy, played: d.record?.turns.length ?? 0, turn: n });
    if (no) return no;
    if (offer && (projectHas(d, d.view!.lastDecision) || d.postProject)) return { offer: REWIND_OFFER(n), id: 'command.rewind.force', params: { turn: n }, strict: true };
    return true;
  };
  const rewindRun = async (n: number) => {
    const no = rewindAsk(n, false);
    if (no !== true) return end(no as string);
    const r = await get().rewind(n);
    if (!r.ok) return end(r.text);
    const head = `Вернулся к ходу ${n} (${when(r.at)}).`;
    return r.branch ? `${head} Прежняя линия сохранена: «${r.branch}».` : r.dup ? `${head} Прежняя линия уже есть среди ветвей.` : head;
  };
  /** Переход на ветвь: нельзя — почему; проект хода не пуст (offer) — то же предложение с явным «да», что при возврате. */
  const switchAsk = (name: string, offer: boolean): true | string | Offer => {
    const d = get();
    if (d.busy) return BUSY_REWIND;
    const r = pickLine(name);
    if (typeof r === 'string') return r;
    if (offer && (projectHas(d, d.view!.lastDecision) || d.postProject)) return { offer: SWITCH_OFFER(r.name), id: 'command.branch.switch.force', params: { name }, strict: true };
    return true;
  };
  const switchRun = async (name: string) => {
    const no = switchAsk(name, false);
    if (no !== true) return end(no as string);
    const x = await get().switchBranch((pickLine(name) as BranchLine).id!);
    return x.ok ? `Перешёл на ветвь «${x.name}»: ход ${x.turns + 1}.` : end(x.text);
  };
  /** Линия по названию: одна — она; нет, несколько, текущая — что сказать. */
  const pickLine = (name: string): BranchLine | string => {
    const ls = get().lines;
    if (ls.length < 2) return 'ветвей нет: игра идёт одной линией';
    const hit = findLine(String(name ?? ''), ls);
    if (!hit.length) return `такой ветви нет. Есть: ${ls.map((l) => `«${l.name}»`).join(', ')}`;
    if (hit.length > 1) return `какую ветвь: ${hit.slice(0, 3).map((l) => `«${l.name}»`).join(', ')}?`;
    if (hit[0].current) return `вы и так на ветви «${hit[0].name}»`;
    return hit[0];
  };
  const base = { section: 'replay', available: game };
  return [
    // ---- ход
    { ...base, id: 'command.turn', highlight: () => hl('foot'), title: 'Провести ход', describe: 'Проводит ход: утверждает решение, отдаёт приказы и распоряжения, считает ход (необратимо). Решение не готово — скажет, чего нет.',
      say: ['штаб, проводи ход'], irreversible: true, available: play, confirm,
      check: () => { const m = turnMissing(get()); return m.targets.length || m.decision.length ? notReady(m) : true; },
      run: async () => {
        const d = get(), m = turnMissing(d);
        // кнопка (без вопроса) и «да» после подтверждения: проект могли поменять — проверить ещё раз
        if (m.targets.length || m.decision.length) {
          d.showMissing(m);
          return m.targets.length ? `Не указана цель: ${m.targets.map(unitName).join(', ')}.` : `Решение на ход не готово: ${m.decision.join(', ')}.`;
        }
        d.sendTurn();
        return 'Считаю ход. Посредник доложит итоги.';
      } },
    { ...base, id: 'command.ai.retry', highlight: () => hl('foot'), title: 'Повторить запрос штабу противника', describe: 'Штаб противника не дал решения: спросить модель ещё раз.', say: ['штаб, повтори запрос'],
      available: () => { const r = game(); if (r !== true) return r; const d = get(); return d.blocked || d.ai.state === 'error' ? true : 'штаб противника решение дал — повторять нечего'; },
      run: async () => { get().retryAi(); return 'Повторяю запрос штабу противника.'; } },
    { ...base, id: 'command.ai.skip', highlight: () => hl('foot'), title: 'Ход без новых приказов противника', describe: 'Штаб противника не дал решения: провести ход, противник держится прежних приказов.', say: ['штаб, ход без его приказов'],
      available: () => { const r = game(); return r !== true ? r : get().blocked ? true : 'штаб противника решение дал — ход идёт как обычно'; },
      run: async () => { get().skipAi(); return 'Провожу ход без новых приказов противника. Посредник доложит итоги.'; } },
    // ---- возврат к ходу, ветви
    { ...base, id: 'command.rewind', highlight: () => hl('ribbon'), title: 'Вернуться к ходу', describe: 'Возвращает игру к началу хода turn (с 1): ходы после него снимаются, прежняя линия сохраняется ветвью «ветвь от хода N (дата)».',
      params: TURN_NO, say: ['штаб, вернись к ходу два'],
      check: (p: { turn: number }) => rewindAsk(p?.turn, true), run: async (p: { turn: number }) => rewindRun(p?.turn) },
    { ...base, id: 'command.rewind.force', model: false, highlight: () => hl('ribbon'), title: 'Вернуться к ходу (проект хода пропадёт)', describe: 'Возврат к ходу turn, хотя в проекте хода есть приказы и распоряжения.',
      params: TURN_NO, check: (p: { turn: number }) => rewindAsk(p?.turn, false), run: async (p: { turn: number }) => rewindRun(p?.turn) },
    { ...base, id: 'command.rewind.back', highlight: () => hl('ribbon'), title: 'Вернуться на ход назад', describe: 'Возвращает игру к началу прошлого хода (прежняя линия сохраняется ветвью).', say: ['штаб, вернись на ход назад'],
      available: () => { const r = game(); return r !== true ? r : get().record?.turns.length ? true : 'вернуться некуда: это первый ход'; },
      check: () => rewindAsk(get().record!.turns.length, true), run: async () => rewindRun(get().record!.turns.length) },
    { ...base, id: 'command.branches.show', highlight: () => hl('branches'), title: 'Ветви игры', describe: 'Открывает окно «Ветви» и перечисляет линии игры: текущая, сохранённые ветви, число ходов.', say: ['штаб, покажи ветви'],
      run: async () => {
        const d = get(), ls = d.lines;
        d.branches.show(true);
        if (ls.length < 2) return 'Ветвей нет: игра идёт одной линией.';
        return `Ветвей ${ls.length - 1}: ${ls.map((l) => `${l.name}${l.current ? ' — текущая' : ''}, ходов ${l.turns}`).join('; ')}.`;
      } },
    { ...base, id: 'command.branches.close', highlight: () => hl('ribbon'), title: 'Закрыть окно «Ветви»', describe: 'Закрывает окно «Ветви».', say: ['штаб, закрой ветви'],
      available: () => { const r = game(); return r !== true ? r : get().branches?.open ? true : 'окно ветвей не открыто'; },
      run: async () => { get().branches.show(false); } },
    { ...base, id: 'command.branch.switch', highlight: () => hl('ribbon'), title: 'Перейти на ветвь', describe: 'Переходит на сохранённую ветвь игры (name — её название: «ветвь от хода 5 (…)», «основная линия»); текущая линия сохраняется ветвью.',
      params: NAME, say: ['штаб, перейди на ветвь от хода два'],
      check: (p: { name: string }) => switchAsk(p?.name, true), run: async (p: { name: string }) => switchRun(p?.name) },
    { ...base, id: 'command.branch.switch.force', model: false, highlight: () => hl('ribbon'), title: 'Перейти на ветвь (проект хода пропадёт)', describe: 'Переход на ветвь name, хотя в проекте хода есть приказы и распоряжения.',
      params: NAME, check: (p: { name: string }) => switchAsk(p?.name, false), run: async (p: { name: string }) => switchRun(p?.name) },
    { ...base, id: 'command.branch.delete', highlight: () => hl('branches'), title: 'Удалить ветвь', describe: 'Удаляет сохранённую ветвь игры (name — её название) вместе с её ходами (необратимо). Текущую линию удалить нельзя.',
      params: NAME, say: ['штаб, удали ветвь от хода два'], irreversible: true,
      confirm: (p: { name: string }) => { const r = pickLine(p?.name); return `Удалить ${typeof r === 'string' ? 'ветвь' : `ветвь «${r.name}»`}? Её ходы пропадут.`; },
      check: (p: { name: string }) => { const r = pickLine(p?.name); return typeof r === 'string' ? r : true; },
      run: async (p: { name: string }) => {
        const r = pickLine(p?.name);
        if (typeof r === 'string') return end(r);
        const e = await get().deleteBranch(r.id!);
        return e ? end(e) : `Ветвь «${r.name}» удалена.`;
      } },
    // ---- посредник
    { ...base, id: 'command.turn.show', highlight: () => tourEl('cmd-map'), title: 'Разбор хода', describe: 'Посредник показывает прошедший ход на карте по шагам: общее (ход проигрывается), главные бои, цели, тыл, противник по разведке.',
      say: ['штаб, покажи ход'], available: played,
      run: async () => { const d = get(); claimMore(null); showTurnReview(d.view!, d.prev, d.record); } },
    { ...base, id: 'command.umpire.repeat', title: 'Повторить доклад посредника', describe: 'Повторяет коротко доклад посредника о последнем ходе (его голосом): общий шаг и итог. Весь разбор — «подробнее» или «Штаб, покажи ход».', say: ['штаб, повтори доклад'],
      available: () => { const r = game(); return r !== true ? r : lastUmpire() ? true : 'доклада посредника ещё не было — он звучит после хода'; },
      run: async () => { repeatUmpire(); claimMore('umpire'); } },
    { ...base, id: 'command.enemy.read', highlight: () => [hl('ump-enemy'), hl('tab-umpire')], title: 'Как действовал противник', describe: 'Посредник: решение штаба противника на прошлый ход — замысел, оценка, приказы.', say: ['штаб, как действовал противник'],
      run: async () => {
        const d = get();
        d.setTab('umpire'); d.setUmpirePart('enemy');
        if (d.enemy === 'passive') return 'Противник без штаба: держится прежних приказов, решений не принимает.';
        if (d.enemy === 'intent') return 'Противником командуют штабы по истории как замыслу: решения — в журнале документов.';
        if (d.enemy === 'agents') return 'Противником командуют штабы-агенты по уставам: их решения — в журнале документов (вкладка «Штабы» показывает только свои).';
        const t = d.aiTurns[0];
        if (!t) return 'Решений штаба противника ещё нет — они появятся после первого хода.';
        if (!t.ok || !t.decision) return speakable(`Штаб противника ${dayMonth(t.time)} решения не дал: ${reason(t.error ?? '')}.`, { full: true });
        const x = t.decision;
        const orders = t.applied.filter((a) => a.order).slice(0, 3).map((a) => `${short(a.formation ?? a.given.formation)} — ${TASK_RU[a.given.task as keyof typeof TASK_RU] ?? a.given.task}${a.target ? `, ${short(a.target)}` : ''}`);
        return readAloud(speakable([
          `Штаб противника, решение от ${dayMonth(t.time)}: ${low(sentence(x.intent))}`,
          x.assessment ? `Оценка: ${low(sentence(x.assessment))}` : '',
          orders.length ? `Приказы: ${orders.join('; ')}.` : 'Новых приказов не отдал.',
          x.risks?.length ? `Риски: ${x.risks.slice(0, 2).map((r) => r.replace(/[.\s]+$/, '')).join('; ')}.` : '',
        ].filter(Boolean).join(' '), { full: true }));
      } },
    // ---- разбор
    { ...base, id: 'command.review.open', highlight: () => hl('review'), title: 'Открыть разбор операции', describe: 'Открывает окно «Разбор операции».', say: ['штаб, открой разбор'], available: played,
      run: async () => { get().review.show(true); return 'Разбор операции открыт. Скажите «составь разбор».'; } },
    { ...base, id: 'command.review.close', title: 'Закрыть разбор', describe: 'Закрывает окно разбора (написанное сохраняется, разбор продолжает писаться).', say: ['штаб, закрой разбор'],
      available: () => { const r = game(); return r !== true ? r : get().review.open ? true : 'разбор не открыт'; },
      run: async () => { get().review.show(false); return 'Разбор закрыт — написанное сохранится.'; } },
    { ...base, id: 'command.review.compose', highlight: () => hl('review'), title: 'Составить разбор', describe: 'Составляет разбор операции: разделы (sections — названия; нет — все ненаписанные) пишутся по очереди.',
      params: { type: 'object', properties: { sections: { type: 'array', items: { type: 'string' } } } }, say: ['штаб, составь разбор'], available: played,
      run: async (p?: { sections?: string[] }) => {
        const ctl = await reviewCtl();
        if (!ctl) return 'Окно разбора не открылось — откройте его кнопкой «Разбор операции».';
        if (ctl.running()) return 'Разбор уже пишется — скажу, когда будет готов.';
        const secs = ctl.sections();
        let ids: string[] | undefined;
        if (p?.sections?.length) {
          ids = [...new Set(p.sections.flatMap((s) => (secs.some((x) => x.id === s) ? [s] : findSection(s, secs).map((i) => secs[i].id))))];
          if (!ids.length) return `Таких разделов нет. Есть: ${secs.map((s) => `«${s.title}»`).join(', ')}.`;
        }
        const n = ids?.length ?? secs.filter((s) => !s.done).length;
        if (!n) return 'Разбор уже составлен. Прочитать — скажите «прочитай итоговую оценку», сохранить — «сохрани разбор».';
        void ctl.compose(ids).then(() => {
          if (!voiceRecent() || ctl.running()) return;
          const left = ctl.sections().filter((s) => !s.done).length;
          speak(left ? `Разбор написан не весь: осталось разделов — ${numberWords(left)}. Дописать — «составь разбор».`
            : 'Разбор готов. Прочитать — скажите «прочитай итоговую оценку», сохранить — «сохрани разбор».', { keep: true });
        });
        return `Составляю разбор: разделов — ${numberWords(n)}, по очереди. Это займёт время — скажу, когда будет готов.`;
      } },
    { ...base, id: 'command.review.read', highlight: () => hl('review'), title: 'Прочитать раздел разбора', describe: 'Читает вслух раздел разбора операции (section — название; «разбор» — все написанные).',
      params: SECTION, say: ['штаб, прочитай итоговую оценку'], available: played,
      run: async (p: { section: string }) => {
        const ctl = await reviewCtl();
        if (!ctl) return 'Окно разбора не открылось.';
        const secs = ctl.sections();
        if (/^(?:разбор|весь разбор|разбор целиком|разбор операции)$/.test(norm(p?.section ?? ''))) {
          const done = secs.filter((s) => s.done);
          return done.length ? readAloud(done.map((s) => `${s.title}. ${plain(s.text)}`).join(' ')) : 'Разбор ещё не написан. Скажите «составь разбор».';
        }
        const hit = findSection(String(p?.section ?? ''), secs);
        if (!hit.length) return `Такого раздела нет. Есть: ${secs.map((s) => `«${s.title}»`).join(', ')}.`;
        if (hit.length > 1) return `Какой раздел: ${hit.slice(0, 3).map((i) => `«${secs[i].title}»`).join(', ')}?`;
        const s = secs[hit[0]];
        if (!s.done) return `Раздел «${s.title}» ещё не написан. Скажите «составь разбор».`;
        return readAloud(`${s.title}. ${plain(s.text)}`);
      } },
    { ...base, id: 'command.review.stop', title: 'Остановить разбор', describe: 'Останавливает написание разбора (написанное сохраняется).', say: ['штаб, останови разбор'],
      available: () => { const r = game(); return r !== true ? r : get().review.ctl?.running() ? true : 'разбор сейчас не пишется'; },
      run: async () => { get().review.ctl!.stop(); return 'Разбор остановлен, написанное сохранено.'; } },
    { ...base, id: 'command.review.save', title: 'Сохранить разбор', describe: 'Сохраняет разбор операции в файл: PDF (по умолчанию) или текст .md; в настольном приложении — в папку «Загрузки».',
      params: { type: 'object', properties: { format: { enum: ['pdf', 'md'] } } }, say: ['штаб, сохрани разбор'], available: played,
      // формат, которого нет («в ворд»), — честно и предложение PDF, а не молча PDF
      check: (p?: { format?: string }) => (!p?.format || p.format === 'pdf' || p.format === 'md' ? true
        : { offer: `В ${/^(?:ворд|word|док\p{L}*|doc\p{L}*)$/u.test(p.format) ? 'Word' : `«${p.format}»`} не умею. Сохранить разбор в PDF?`, id: 'command.review.save', params: { format: 'pdf' } }),
      run: async (p?: { format?: string }) => {
        const ctl = await reviewCtl();
        if (!ctl) return 'Окно разбора не открылось.';
        if (!ctl.sections().some((s) => s.done)) return 'Разбор ещё не составлен. Скажите «составь разбор».';
        const fmt = p?.format === 'md' ? 'md' : 'pdf';
        let data: Blob;
        try { data = fmt === 'md' ? textFile(ctl.markdown(), 'text/markdown') : await ctl.pdf(); } catch { return 'Не удалось собрать файл разбора — подробности на экране.'; }
        return save(ctl.name(fmt), data, 'Разбор сохранён', 'Разбор');
      } },
    { ...base, id: 'command.journal.save', title: 'Сохранить журнал', describe: 'Сохраняет журнал боевых действий (.md); в настольном приложении — в папку «Загрузки».', say: ['штаб, сохрани журнал'],
      run: async () => { const j = get().journal(); return save(j.name, textFile(j.text, 'text/markdown'), 'Журнал сохранён', 'Журнал'); } },
    { ...base, id: 'command.record.save', title: 'Сохранить запись игры', describe: 'Сохраняет запись игры (.json) — её можно открыть для разбора; в настольном приложении — в папку «Загрузки».',
      say: ['штаб, сохрани запись игры'],
      run: async () => { const r = get().gameRecord(); if (!r) return 'Записи игры ещё нет.'; return save(r.name, textFile(r.text, 'application/json'), 'Запись игры сохранена', 'Запись игры'); } },
  ];
}

// ---------------------------------------------------------------- события игры

/** Штаб противника не дал решения: сказать, что можно (если голосом пользуются; на экране — всегда). */
export function blockedArrived(error: string): void {
  if (!voiceRecent()) return;
  speak(`Штаб противника не дал решения: ${reason(error)}. Скажите «повтори запрос» или «ход без его приказов».`, { keep: true });
}

// ---------------------------------------------------------------- разбор фраз

function hit(id: string, params?: unknown): PhraseHit {
  return getAction(id) ? { id, params } : { say: `Сейчас нельзя: ${NO_GAME}.` };
}

const TURN = /^(?:(?:можно|пора|давай|давайте|теперь)(?: уже)? )?(?:проводи|проводить|проведи|провести|проводим|сделай|сделать|делай|делать|делаем|давай|завершай|завершить|заверши)(?: следующий)? ход$|^следующий ход$/;

/** Фразы хода, посредника и разбора (см. шапку модуля); только в «Переигровке». */
export function parseTurn(rest: string, section: string): PhraseHit | null {
  if (section !== 'replay') return null;
  // «пожалуйста» — вежливость, не часть команды: «проводи ход, пожалуйста»
  const t = norm(rest).split(' ').filter((w) => w !== 'пожалуйста').join(' ');
  let m: RegExpExecArray | null;
  if (TURN.test(t)) return hit('command.turn');
  // возврат к ходу и ветви: «назад» — раньше «к ходу N» («вернись на ход назад»)
  if (/^(?:вернись|вернемся|откатись) на (?:один )?ход назад$|^(?:отмени|откати) (?:последний )?ход$/.test(t)) return hit('command.rewind.back');
  if ((m = /^(?:вернись|вернемся|вернуться|откатись|откати игру) (?:к|на) ход(?:у)? (.+)$/.exec(t))) {
    const n = spokenNumber(m[1]);
    return n === null ? { say: 'Не понял, к какому ходу. Скажите, например: «вернись к ходу два».' } : hit('command.rewind', { turn: n });
  }
  if (/^(?:покажи|какие|перечисли|открой)(?: мне)? ветви(?: игры)?$/.test(t)) return hit('command.branches.show');
  if (/^(?:закрой|скрой|убери) (?:окно )?ветви$/.test(t)) return hit('command.branches.close');
  if ((m = /^(?:перейди|переключись|вернись) (?:на|в|к) (ветв\S* .+|основн\S* лини\S*)$/.exec(t))) return hit('command.branch.switch', { name: m[1] });
  if ((m = /^(?:удали|удалить|сотри) (ветв\S* .+)$/.exec(t))) return hit('command.branch.delete', { name: m[1] });
  if (/^(?:повтори|повторить|повторите|повтори еще раз) запрос(?: штабу противника| противнику)?$|^запроси (?:штаб )?противника (?:снова|еще раз)$/.test(t)) return hit('command.ai.retry');
  if (/^(?:(?:проводи|проведи|сделай|давай) )?ход без (?:его |новых )?приказов(?: противника)?$/.test(t)) return hit('command.ai.skip');
  if (/^(?:повтори|повторите)(?: еще раз)? доклад(?: посредника)?$|^что сказал посредник$/.test(t)) return hit('command.umpire.repeat');
  if (/^(?:как|что) (?:действовал|делал|предпринял|сделал|решил) (?:штаб )?противник(?:а)?(?: за ход)?$|^(?:какое |прочитай |доложи )?решение (?:штаба )?противника$/.test(t)) return hit('command.enemy.read');
  // разбор операции
  if (/^(?:составь|составить|составьте|напиши|написать|сделай|подготовь|начни|начинай|пиши|допиши)(?: мне)? разбор(?: операции| игры)?$/.test(t)) return hit('command.review.compose', {});
  // голое «разбор операции» — открыть окно (составление долгое — только по просьбе)
  if (/^(?:открой|покажи) разбор(?: операции)?$|^разбор операции$/.test(t)) return hit('command.review.open');
  if (/^(?:закрой|скрой|убери) разбор(?: операции)?$/.test(t)) return hit('command.review.close');
  if (/^(?:останови|остановить|прерви|прекрати) (?:разбор|писать разбор)$/.test(t)) return hit('command.review.stop');
  if ((m = /^(?:сохрани|сохранить|скачай|скачать) разбор(?: операции)?(?: (?:в|как|в виде) (\p{L}+))?$/u.exec(t)))
    return hit('command.review.save', !m[1] || /^(?:pdf|пдф)$/.test(m[1]) ? {} : /^(?:маркдаун|markdown|md|текст\p{L}*)$/u.test(m[1]) ? { format: 'md' } : { format: m[1] });
  if (/^(?:сохрани|сохранить|скачай|скачать) журнал(?: боевых действий)?$/.test(t)) return hit('command.journal.save');
  if (/^(?:сохрани|сохранить|скачай|скачать) запись игры$/.test(t)) return hit('command.record.save');
  // раздел разбора — только если разбор открыт и такой раздел есть (иначе «прочитай …» — чужая фраза)
  if ((m = /^(?:прочитай|прочти|зачитай|читай)(?: мне)? (.+)$/.exec(t))) {
    const ctl = live?.().review.ctl;
    if (!ctl || !getAction('command.review.read')) return null;
    if (/^(?:разбор|весь разбор|разбор целиком|разбор операции)$/.test(m[1])) return { id: 'command.review.read', params: { section: m[1] } };
    return findSection(m[1], ctl.sections()).length ? { id: 'command.review.read', params: { section: m[1] } } : null;
  }
  return null;
}

registerParser(parseTurn);
