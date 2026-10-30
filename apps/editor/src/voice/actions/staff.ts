/**
 * «Командование» голосом — штабная работа на ход: советник (варианты решения, вопросы, предложенные приказы), решение
 * (поля диктовкой, «возьми с прошлого хода», черновик донесения, «что не готово?»), приказы соединениям и распоряжения
 * по тылу, переправам, резервам и полосам. Чистый модуль (без React): CommandView передаёт состояние через get() и
 * регистрирует staffActions; кнопки вкладок «Решение» и «Приказы» и советника вызывают те же действия.
 *
 * Фразы (parseStaff, регистрируется при загрузке модуля; только в «Переигровке»): «дай три варианта», «подробнее о
 * втором», «выбираю второй» (непустой проект — подтверждение), «только решение по второму», «спроси советника: …»,
 * «подробнее», «возьми приказ», «останови советника» / «стоп», «возьми с прошлого хода», «составь черновик донесения»,
 * «что не готово?», «восьмой гвардейской наступать на Зелов», «указания: …», «отмени приказ восьмой гвардейской»,
 * «какие приказы отданы?», «перенеси базу восьмой гвардейской в Зелов», «приоритет подвоза восьмой гвардейской и
 * пятой ударной», «наведи переправу у Кюстрина», «введи третью ударную в районе Зелова», «не вводи третью ударную»,
 * «предложи линию между восьмой гвардейской и пятой ударной», «в распоряжение». Поля решения — диктовкой
 * (dictation.ts): «запиши в замысел: …», «допиши в донесение …», «прочитай оценку».
 *
 * Фраза с названием, которого нет (соединения, места), — не своя: её разбирает модель (ложных перехватов нет).
 * Неисполнимое распоряжение — штаб говорит текст проверки расчёта (Worker).
 */
import type { LngLat } from '@def-ops/core';
import { groupManning, TASK_RU, type ActionCheck, type IntelReport, type StaffAction, type Target, type Task, type UnitReport } from '@def-ops/sim';
import type { AdviceView, HumanDecision, Place, PlanVariantView, TurnView } from '../../sim/game-protocol';
import { ordinalIndex, pickByName } from '../answers';
import { speakAnswersOn, setSpeakAnswers } from '../advisor-voice';
import { fieldActions, rawTail, readAloud } from '../dictation';
import type { PetitionState } from '../../petition';
import { findPlace, findUnit, parseRelative, resolveRelative } from '../places';
import { act, getAction, onTurnDone, registerParser, retract, speak, voiceRecent, voiceTurn, type Action, type PhraseHit } from '../registry';
import { short } from '../report';
import { hl, note as lit, noted, type HlTarget } from '../highlight';
import { nameCase, numberWords, plural, speakable } from '../speech';
import { claimMore, inReplay, NO_GAME, type CmdTab } from './command';
import { SUGGESTIONS } from '../../commander-view';
import { manningText } from '../../num-format';

// ---------------------------------------------------------------- типы состояния (общие с CommandView)

export const TASKS: Task[] = ['attack', 'counterattack', 'defend', 'hold', 'delay', 'regroup', 'reserve', 'withdraw', 'breakout', 'relieve'];
/** Задачи, для которых цель обязательна. */
export const NEEDS_TARGET: Task[] = ['attack', 'counterattack', 'regroup', 'withdraw', 'breakout', 'relieve'];

/** Приказ в проекте: объединение, задача, цель (пункт, противник, точка), подпись цели, точка для карты, указания. */
export interface OrderDraft { formation: string; task: Task; target: Target; targetText: string; at: LngLat | null; note: string; /** Форма на агентной модели: приказ или боевое распоряжение (нет — распоряжение). */ form?: 'order' | 'instruction' }
/** Распоряжение в проекте (тыл, переправа, резерв, полоса): ключ, действие, подпись и что сказала проверка. */
export interface StaffAct { key: string; action: StaffAction; label: string; text: string; at?: LngLat; from?: LngLat }
/** Варианты решения на ход от советника (на ход time): по мере генерации, затем итог. */
export interface PlanState { id: number; time: string; count: number; variants: PlanVariantView[]; progress: string; done: boolean; error?: string; warning?: string; seconds?: number; model?: string; accepted?: number }
export type Suggestion = AdviceView['suggestions'][number];
export type OrdersSub = 'units' | 'rear' | 'bridges' | 'reserves' | 'bounds';
/** Полоса, намечаемая между двумя армиями: фронт, армии, точки линии. */
/** Названия подвкладок «Приказов» (для ответа голосом). */
export const SUB_TITLE: Record<OrdersSub, string> = { units: 'Пункт управления', rear: 'Тыл', bridges: 'Переправы', reserves: 'Резервы', bounds: 'Полосы' };
export interface BoundsDraft { front: string; a: string; b: string; pts: LngLat[] }

export interface StaffDeps {
  view: TurnView | null;
  /** Идёт расчёт хода (текст) — проект не правится. */
  busy: string | null;
  setTab(t: CmdTab): void;
  setSub(s: OrdersSub): void;
  /** Какие подвкладки «Приказов» есть на этом уровне: true или причина, почему нет. */
  subsOk?: Record<OrdersSub, true | string>;
  /** Показать место на карте. */
  goTo(at: LngLat): void;
  // советник
  plan: PlanState | null;
  /** Сколько вариантов просить по умолчанию. */
  planN: number;
  /** Попросить варианты (советник открывается); возвращает номер запроса. */
  askPlan(count: number): number;
  /** Остановить ответ советника и подготовку вариантов. */
  stopAdvisor(): void;
  /** Раскрыть вариант i (с нуля) на экране. */
  openVariant(i: number): void;
  /** Принять вариант i в проект (only — только решение; edit — приказы в проекты пункта управления, без очереди), без вопросов; что сделано — словами. */
  applyPlan(i: number, only: boolean, edit?: boolean): Promise<string>;
  /** Советник отвечает на вопрос. */
  advisorBusy: boolean;
  /** Задать вопрос советнику (советник открывается; cat, topic — тема из дерева тем); возвращает номер вопроса. */
  askAdvisor(question: string, cat?: string, topic?: string): number;
  /** Текст в поле вопроса советника (и запись в него: советник открывается). */
  advisorText: string;
  setAdvisorText(s: string): void;
  /** Исполнимые приказы, предложенные в последнем ответе советника. */
  suggestions: Suggestion[];
  takeSuggestion(s: Suggestion): void;
  // решение
  decision: HumanDecision;
  setDecision(p: Partial<HumanDecision>): void;
  /** Составить поле решения: по обстановке (сразу) или советником (ответ встанет в поле); что сделано — словами. */
  composeField(f: FieldKey, advisor: boolean): string;
  /** Все поля решения советником — по очереди, каждое с уже написанными; что сделано — словами. */
  composeAll(): string;
  /** Советник на связи (языковая модель отвечает). */
  advisorReady: boolean;
  /** Советник уже пишет решение (общий заказ). */
  composing: boolean;
  /** Поля решения, составленные по обстановке и ещё не правленые: не считаются своим в проекте. */
  auto?: readonly string[];
  /** Прошлое решение того же штаба (пункт ниже Ставки — его, а не Ставки); нет поля — прошлое решение верхней инстанции. */
  prevDecision?: HumanDecision | null;
  /** Ходатайство о разграничительной линии в пункте управления: где действует, кто рассматривает, соседи (petition.ts). */
  petition?: PetitionState;
  /** Пункт управления: приоритет подвоза — его часть списка стороны (названные подчинённые вместо прежних его); нет — весь список. */
  mergePriority?(ids: string[]): string[];
  // приказы
  drafts: Record<string, OrderDraft>;
  /** Приказ объединению id (null — отменить). */
  setDraft(id: string, d: OrderDraft | null): void;
  /** Выбрать объединение в списке «Приказы → Войска». */
  select(id: string | null): void;
  // распоряжения
  acts: StaffAct[];
  /** Проверить распоряжение в расчёте и включить в проект, если исполнимо. */
  addAct(key: string, action: StaffAction, label: string, extra?: Partial<StaffAct>): Promise<ActionCheck>;
  dropAct(key: string): void;
  /** Ввести резерв в район (members — объединение целиком, по соединениям). */
  commit(g: { id: string; name: string; members?: { id: string; name: string }[] }, at: LngLat, title: string): Promise<ActionCheck>;
  bounds: BoundsDraft;
  setBounds(b: BoundsDraft): void;
}

// ---------------------------------------------------------------- слова

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** Конец предложения: точка, если её нет. */
const sent = (s: string) => { const x = s.trim(); return !x ? '' : /[.!?…]$/.test(x) ? x : `${x}.`; };
const ORD = ['первый', 'второй', 'третий', 'четвёртый', 'пятый'];
const ordName = (i: number) => ORD[i] ?? numberWords(i + 1);
const variantsWord = (n: number) => `${numberWords(n)} ${plural(n, ['вариант', 'варианта', 'вариантов'])}`;
/** Начала вопросов, а не команд: «как наступать…», «почему…» — это модели. */
const QUESTION = /^(?:как|что|чего|почему|зачем|когда|куда|кто|где|можно|может|могу|нужно|надо|стоит|лучше|если|ли)(?: |$)/;
/** Вопрос внутри или в конце фразы: «…или нет», «…как думаешь», «стоит ли…», «наступать ли…» — это не приказ. */
const QUESTION_IN = /(?:^| )(?:или нет|или как|как думаешь|как считаешь|как полагаешь|ли|верно|правильно)(?: |$)/;

/** Текст проверки расчёта — вслух: «≈ 18.04 17:00» → «примерно …», «×1,5» — словами. */
export function checkSpeech(text: string): string {
  return text.replace(/≈\s*/g, 'примерно ').replace(/подвоз ×1,5/g, 'подвоз в полтора раза больше').replace(/×0,75/g, 'на четверть меньше')
    .replace(/[.\s]+$/, '');
}
/** Место на карте — для подсветки (если известно). */
const spot = (at: LngLat | null | undefined): HlTarget[] => (at ? [{ at }] : []);
const actReply = (label: string, r: ActionCheck) => (r.ok ? `${label}: ${checkSpeech(r.text)}.` : `Не выйдет: ${checkSpeech(r.text)}.`);

// ---------------------------------------------------------------- задачи

const TASK_PHRASES: [string, Task][] = ([
  ['удерживать любой ценой', 'hold'], ['стоять насмерть', 'hold'], ['занять оборону', 'defend'], ['перейти к обороне', 'defend'],
  ['нанести контрудар', 'counterattack'], ['нанести удар', 'attack'], ['выйти из окружения', 'breakout'], ['отвести в резерв', 'reserve'],
  ['вывести в резерв', 'reserve'], ['в резерв', 'reserve'], ['пробиться к', 'relieve'],
  ...['наступать', 'наступай', 'наступайте', 'атаковать', 'атакуй', 'атакуйте', 'ударить', 'ударь', 'взять', 'овладеть', 'штурмовать'].map((w) => [w, 'attack']),
  ...['контратаковать', 'контратакуй', 'контратакуйте'].map((w) => [w, 'counterattack']),
  ...['оборонять', 'обороняй', 'обороняйте', 'обороняться', 'обороняйся'].map((w) => [w, 'defend']),
  ...['удерживать', 'удерживай', 'удержать', 'держать', 'держи'].map((w) => [w, 'hold']),
  ...['сдерживать', 'сдерживай', 'сдержать'].map((w) => [w, 'delay']),
  ...['перегруппироваться', 'перегруппируйся', 'перегруппируйтесь', 'выдвинуться', 'выдвигаться', 'выдвинись', 'сосредоточиться', 'переместиться'].map((w) => [w, 'regroup']),
  ...['отойти', 'отходить', 'отходи', 'отступить', 'отступать', 'отступай', 'отвести'].map((w) => [w, 'withdraw']),
  ...['прорываться', 'прорваться', 'прорывайся', 'вырваться'].map((w) => [w, 'breakout']),
  ...['деблокировать', 'деблокируй', 'выручить', 'выручай'].map((w) => [w, 'relieve']),
] as [string, Task][]).sort((a, b) => b[0].split(' ').length - a[0].split(' ').length);

/** Вопрос о цели по задаче: «Куда наступать?», «Что удерживать?». */
const TARGET_Q: Record<Task, string> = {
  attack: 'Куда наступать?', counterattack: 'Куда контратаковать?', defend: 'Что оборонять?', hold: 'Что удерживать?', delay: 'Где сдерживать?',
  regroup: 'Куда перегруппироваться?', reserve: 'Куда отвести?', withdraw: 'Куда отходить?', breakout: 'Куда прорываться?', relieve: 'Кого деблокировать?',
};

/** Задача по слову («наступать», «атакуй», «занять оборону», «attack»); не задача — null. */
export function taskOf(text: string): Task | null {
  const t = norm(text);
  if ((TASKS as string[]).includes(t)) return t as Task;
  return TASK_PHRASES.find(([p]) => p === t)?.[1] ?? null;
}
/** Задача в словах ws, начиная с i: задача и сколько слов она заняла. */
function taskAt(ws: string[], i: number): { task: Task; len: number } | null {
  for (const [p, task] of TASK_PHRASES) {
    const n = p.split(' ').length;
    if (ws.slice(i, i + n).join(' ') === p) return { task, len: n };
  }
  return null;
}

// ---------------------------------------------------------------- решение

/** Чего не хватает в решении, чтобы провести ход (подписи для экрана). */
export function decisionMissing(d: HumanDecision): string[] {
  const out: string[] = [];
  if (!d.assessment.trim()) out.push('оценка обстановки');
  if (!d.intent.trim()) out.push('решение (замысел)');
  if (!d.report.trim()) out.push('боевое донесение вышестоящему');
  return out;
}

/**
 * В проекте уже что-то есть — принятие варианта его заменит: приказы, распоряжения, оценка, донесение или поле решения,
 * которое не просто перенесено с прошлого хода (замысел, замысел противника, риски переносятся сами) и не составлено по
 * обстановке при открытии хода и не правлено (auto), ходатайство.
 */
/** Прошлое решение, с которым сравнивается проект: штаба пункта (ниже Ставки) или верхней инстанции. */
export const prevOf = (d: StaffDeps): HumanDecision | null => (d.prevDecision !== undefined ? d.prevDecision : d.view?.lastDecision ?? null);

export function projectHas(p: { drafts: Record<string, unknown>; acts: unknown[]; decision: HumanDecision; auto?: readonly string[] }, last: HumanDecision | null): boolean {
  const d = p.decision, auto = p.auto ?? [];
  const own = (k: 'enemyIntent' | 'intent' | 'risks') => !auto.includes(k) && !!d[k].trim() && d[k].trim() !== (last?.[k] ?? '').trim();
  const put = (k: 'assessment' | 'report') => !auto.includes(k) && !!d[k].trim();
  return Object.keys(p.drafts).length > 0 || p.acts.length > 0 || put('assessment') || put('report') || !!d.request?.trim() || !!(d.petition && (d.petition.line.length || d.petition.note.trim()))
    || own('enemyIntent') || own('intent') || own('risks');
}

const hhmm = (t: string) => t.slice(11, 16);
const ddmm = (t: string) => `${t.slice(8, 10)}.${t.slice(5, 7)}`;
/** Черновик боевого донесения по докладам: в строю, главное за ход, отрезанные, решение. */
export function draftReportText(v: TurnView, d: HumanDecision): string {
  const active = v.own.filter((u) => u.status === 'active');
  const cut = active.filter((u) => u.cutOff).map((u) => short(u.name));
  return [
    `К ${hhmm(v.time)} ${ddmm(v.time)}: в строю ${active.length} объединений, средняя укомплектованность ${manningText(groupManning(active))}.`,
    ...v.events.slice(0, 8),
    cut.length ? `Отрезаны от подвоза: ${cut.join(', ')}.` : '',
    d.intent ? `Решение на ${ddmm(v.time)}: ${d.intent}` : '',
  ].filter(Boolean).join('\n');
}

const FIELD_KEYS = ['assessment', 'enemyIntent', 'intent', 'risks', 'report'] as const;
type FieldKey = (typeof FIELD_KEYS)[number];
/** Поле решения в винительном падеже — «взял оценку обстановки». */
const FIELD_ACC: Record<FieldKey, string> = { assessment: 'оценку обстановки', enemyIntent: 'замысел противника', intent: 'замысел', risks: 'риски', report: 'донесение' };
/** Поле уже заполнено — словами. */
const FIELD_DONE: Record<FieldKey, string> = { assessment: 'Оценка обстановки уже написана', enemyIntent: 'Замысел противника уже написан', intent: 'Замысел уже написан', risks: 'Риски уже написаны', report: 'Донесение уже написано' };
/** Поле решения по словам «оценку», «замысел противника», «решение», «донесение»; всё / ничего — undefined; не поле — null. */
function fieldOf(text: string): FieldKey | undefined | null {
  const t = norm(text);
  if (!t || /^(?:все|всё|всё решение|все поля|решение целиком)$/.test(t)) return undefined;
  if (/противник/.test(t)) return 'enemyIntent';
  if (/^(?:оценк)/.test(t)) return 'assessment';
  if (/^(?:замыс|решени)/.test(t)) return 'intent';
  if (/^риск/.test(t)) return 'risks';
  if (/донесени/.test(t)) return 'report';
  return null;
}

// ---------------------------------------------------------------- советник: тексты

/** Вариант вслух: название, суть, замысел, главные приказы (до трёх), распоряжения. */
export function variantText(v: PlanVariantView, n: number): string {
  const ok = v.orders.filter((o) => o.ok);
  const main = ok.slice(0, 3).map((o) => `${short(o.name)} — ${TASK_RU[o.task]}${o.targetText ? `, ${short(o.targetText)}` : ''}`);
  const rest = ok.length - main.length;
  const acts = v.acts.filter((a) => a.ok).length;
  // полный вариант пункта: приказы всем подчинённым — в замысле словами; сколько их и сколько дополнено правилом
  if (v.dirs) return [
    `Вариант ${ordName(n - 1)}: «${v.title}»${v.source === 'rules' ? ' — по правилам, без модели' : ''}.`, sent(v.idea),
    v.decision.intent ? `Замысел: ${sent(v.decision.intent)}` : '',
    `Приказов подчинённым: ${numberWords(v.dirs.length)}${v.filled?.length ? `, из них дополнено правилом: ${numberWords(v.filled.length)}` : ''}.`,
    acts ? `Распоряжений по тылу и переправам: ${numberWords(acts, 'n')}.` : '',
  ].filter(Boolean).join(' ');
  return [
    `Вариант ${ordName(n - 1)}: «${v.title}».`, sent(v.idea),
    v.decision.intent ? `Замысел: ${sent(v.decision.intent)}` : '',
    ok.length ? `Главные приказы: ${main.join('; ')}${rest > 0 ? `, и ещё ${numberWords(rest)}` : ''}.` : 'Новых приказов нет.',
    acts ? `Распоряжений по тылу, переправам и резервам: ${numberWords(acts, 'n')}.` : '',
  ].filter(Boolean).join(' ');
}

/** Просьбы, о которых штаб доложит, когда ответ готов: вопрос голосом, варианты — когда голосом пользуются. */
let voicePlan: number | null = null;
const voiceAsk = new Set<number>();
/** Остаток ответа советника — на «подробнее». */
let adviceMore: string | null = null;

/** Причина сбоя модели словами: техническое (латиница) не пересказывается. */
const failReason = (e = '') => (/[A-Za-z]{3}/.test(e) || !e.trim() ? 'сбой связи с моделью, подробности на экране' : e.trim().replace(/[.\s]+$/, ''));
const sugText = (s: Suggestion) => `${short(s.name)} — ${TASK_RU[s.task]}${s.targetText ? `, ${short(s.targetText)}` : ''}`;

/** Варианты готовы (plan-done): что сказать, если их просили голосом; иначе null. */
export function planArrived(p: PlanState): string | null {
  if (p.id !== voicePlan) return null;
  voicePlan = null;
  // «Переигровка» в фоне: подсказки фраз здесь не исполнятся — только где варианты
  if (inReplay() !== true) return /останов/.test(p.error ?? '') ? null : 'Советник подготовил варианты. Они — в разделе «Переигровка».';
  const vs = p.variants.filter(Boolean);
  if (!vs.length) return /останов/.test(p.error ?? '') ? null : speakable(`Советник не дал вариантов: ${failReason(p.error)}.`, { full: true });
  const list = vs.map((v, i) => `${ordName(i)} — «${v.title}»`).join(', ');
  return speakable(`Советник предложил ${variantsWord(vs.length)}: ${list}. Скажите: «подробнее о первом» или «выбираю первый».`, { full: true });
}

/** Ответ советника пришёл: что сказать (коротко, 2–4 фразы; остальное — «подробнее»), если спрашивали голосом; иначе null. */
export function adviceArrived(id: number, r: AdviceView): string | null {
  const asked = voiceAsk.delete(id);
  if (!asked && !speakAnswersOn()) return null;
  if (!r.ok) return r.error === 'остановлено' ? null : speakable(`Советник не ответил: ${failReason(r.error)}.`, { full: true });
  const plain = r.answer.replace(/[*_#>`]+/g, ' ').replace(/^\s*[-•]\s*/gm, '').replace(/\s+/g, ' ').trim();
  // «Переигровка» в фоне: ответ целиком — на «подробнее» там; здесь — только где он
  if (inReplay() !== true) { adviceMore = plain || null; if (adviceMore) claimMore('advice'); return 'Советник ответил. Ответ — в разделе «Переигровка».'; }
  const ss = plain.match(/[^.!?…]+[.!?…]+["»]?|[^.!?…]+$/g)?.map((x) => x.trim()).filter(Boolean) ?? [];
  let k = 0, len = 0;
  while (k < ss.length && k < 3 && (k === 0 || len + ss[k].length <= 350)) { len += ss[k].length; k++; }
  const parts = [`Советник: ${ss.slice(0, k).join(' ')}`];
  const sg = r.suggestions.filter((s) => s.ok);
  if (sg.length === 1) parts.push(`Предлагает приказ: ${sugText(sg[0])}. Взять — скажите «возьми приказ».`);
  else if (sg.length > 1) parts.push(`Предлагает приказы: ${sg.slice(0, 3).map((s, i) => `${ordName(i)} — ${sugText(s)}`).join('; ')}. Взять — скажите «возьми первый приказ».`);
  adviceMore = k < ss.length ? ss.slice(k).join(' ') : null;
  if (adviceMore) { parts.push('Остальное — скажите «подробнее».'); claimMore('advice'); }
  return speakable(parts.join(' '), { full: true });
}

/** Последний поздний ответ советника, ждущий в очереди штаба: новая просьба к советнику его снимает. */
let lastAnnounce: number | null = null;
const announce = (text: string | null) => { if (!text) return; const id = speak(text, { keep: true }); lastAnnounce = typeof id === 'number' ? id : null; };
const retractAnnounce = () => { if (lastAnnounce !== null) retract(lastAnnounce); lastAnnounce = null; };
/** Ответ советника пришёл (CommandView): сказать коротко, если спрашивали голосом; фраза не устаревает от новой реплики. */
export function adviceReady(id: number, r: AdviceView): void { announce(adviceArrived(id, r)); }
/** Варианты готовы (CommandView): доложить, если просили голосом. */
export function planReady(p: PlanState): void { announce(planArrived(p)); }

/**
 * Кнопка — действие реестра; недоступно (идёт расчёт хода, игра окончена) — причина словами (onReason), а не молча.
 */
export async function press(id: string, params: unknown, onReason: (text: string) => void): Promise<void> {
  const av = getAction(id)?.available();
  if (av === undefined) return;
  if (av !== true) { onReason(`${cap(av.trim().replace(/[.!\s]+$/, ''))}.`); return; }
  await act(id, params);
}

// ---------------------------------------------------------------- места, соединения, полосы

type Found<T> = { found: T } | { say: string } | null;

/** Пункт по названию, id или «N км <сторона> от …»; несколько похожих — переспрос; нет — null. */
function placeOf(text: string, v: TurnView): Found<Place> {
  const t = text.trim();
  const byId = v.places.find((p) => p.id === t);
  if (byId) return { found: byId };
  const r = parseRelative(t) ? resolveRelative(t, v.places) : findPlace(t, v.places);
  if (r.place) return { found: r.place };
  if (r.options.length) return { say: `Какое место: ${r.labels.map((l) => `«${short(l)}»`).join(', ')}?` };
  return null;
}
/** Своё объединение (не уничтоженное) по названию или id. */
function ownOf(text: string, v: TurnView, pool: UnitReport[] = v.own.filter((u) => u.status !== 'destroyed')): Found<UnitReport> {
  const byId = pool.find((u) => u.id === text);
  if (byId) return { found: byId };
  const r = findUnit(text.replace(/^(?:наш\p{L}*|сво\p{L}*) /u, ''), pool);
  if (r.unit) return { found: r.unit };
  if (r.options.length) return { say: `Какое соединение: ${r.labels.map((l) => `«${short(l)}»`).join(', ')}?` };
  return null;
}
/** Противник из разведсводки по названию или id. */
function enemyOf(text: string, v: TurnView): Found<IntelReport> {
  const t = text.replace(/^(?:против|на) /, '').replace(/^противник\p{L}* (?=\S)/u, '');
  const byId = v.intel.find((e) => e.id === t);
  if (byId) return { found: byId };
  const r = findUnit(t, v.intel);
  if (r.unit) return { found: r.unit };
  if (r.options.length) return { say: `Какое соединение противника: ${r.labels.map((l) => `«${short(l)}»`).join(', ')}?` };
  return null;
}
const UNIT_WORD = /(?:^| )(?:\d|корпус|дивизи|арми|групп|бригад|полк|противник)/u;
const km = (p: LngLat, q: LngLat) => Math.hypot((p[0] - q[0]) * Math.cos((p[1] * Math.PI) / 180), p[1] - q[1]) * 111;

/** Линия между двумя армиями: через середину между их войсками, поперёк направления на противника, от тыла к переднему краю. */
export function proposeLine(v: TurnView, A: { at: LngLat }, B: { at: LngLat }): LngLat[] {
  const m: LngLat = [(A.at[0] + B.at[0]) / 2, (A.at[1] + B.at[1]) / 2], c = Math.cos((m[1] * Math.PI) / 180);
  // направление на противника — среднее направлений от своих соединений рядом (до 40 км) к ближайшему к каждому
  // обнаруженному противнику, т. е. поперёк фронта; без разведки — поперёк направления между армиями
  let nx = 0, ny = 0;
  const near40 = v.own.filter((u) => u.status === 'active' && km(m, u.at) <= 40);
  if (v.intel.length) for (const u of near40) {
    const f = v.intel.reduce((b, x) => (km(u.at, x.at) < km(u.at, b.at) ? x : b));
    const dx = (f.at[0] - u.at[0]) * c, dy = f.at[1] - u.at[1], d = Math.hypot(dx, dy) || 1;
    nx += dx / d; ny += dy / d;
  }
  if (Math.hypot(nx, ny) < 0.3) { nx = -(B.at[1] - A.at[1]); ny = (B.at[0] - A.at[0]) * c; }
  const L = Math.hypot(nx, ny) || 1; nx /= L; ny /= L;
  const at = (k: number): LngLat => [+(m[0] + (nx * k) / 111 / c).toFixed(4), +(m[1] + (ny * k) / 111).toFixed(4)];
  return [at(-30), at(0), at(40)];
}

/** Резерв, ждущий ввода: объединение целиком (по соединениям) или одно соединение. */
function reserveOf(text: string, v: TurnView): Found<{ id: string; name: string; members?: { id: string; name: string }[] }> {
  const groups = (v.reserveGroups ?? []).filter((g) => g.status === 'reserve');
  const units = groups.flatMap((g) => g.members).map((id) => v.own.find((u) => u.id === id)).filter((u): u is UnitReport => !!u);
  const byId = groups.find((g) => g.id === text) ?? units.find((u) => u.id === text);
  const pool = [...groups.map((g) => ({ id: g.id, name: g.name })), ...units.filter((u) => !groups.some((g) => g.id === u.id)).map((u) => ({ id: u.id, name: u.name }))];
  let hit = byId ? { id: byId.id, name: byId.name } : undefined;
  if (!hit) {
    const r = findUnit(text, pool);
    if (r.options.length) return { say: `Какой резерв: ${r.labels.map((l) => `«${short(l)}»`).join(', ')}?` };
    hit = r.unit;
  }
  if (!hit) return null;
  const g = groups.find((x) => x.id === hit!.id);
  const one = !g || (g.members.length === 1 && g.members[0] === g.id);
  return { found: one ? { id: hit.id, name: hit.name } : { id: g.id, name: g.name, members: units.filter((u) => g.members.includes(u.id)).map((u) => ({ id: u.id, name: u.name })) } };
}

// ---------------------------------------------------------------- действия

/** Состояние зарегистрированных действий (для разбора «мягких» фраз: есть ли такое соединение и место). */
let live: (() => StaffDeps) | null = null;
/** Приказ ждёт цели («Куда?»): кому, какая задача, до какого времени ответ принимается. */
let awaiting: { unit: string; name: string; task: Task; note?: string; until: number; turn: number } | null = null;
/** Последнее объединение, которому отдан приказ голосом (для «указания: …»). */
let lastUnit: string | null = null;
const AWAIT_MS = 30_000;

/** Действия сняты (выход из игры): разбор больше не смотрит в их обстановку. */
export function releaseStaff(get: () => StaffDeps): void {
  if (live !== get) return;
  live = null; awaiting = null; lastUnit = null; voicePlan = null; voiceAsk.clear(); adviceMore = null;
}

const TEXT = { type: 'string' };

// ---------------------------------------------------------------- разговор с командующим («Переигровка», вкладка «Командующий»)

/** Открытая вкладка «Командующий»: спросить (ответ — на выбранный час, в разговоре на экране) и чей это командующий. */
export interface CommanderDeps { name: string; ask(question: string): string }
let commanderLive: (() => CommanderDeps | null) | null = null;
/** Действие «спроси командующего»: get — вкладка (null — закрыта); снимается releaseCommander. */
export function commanderAction(get: () => CommanderDeps | null): Action {
  commanderLive = get;
  return {
    id: 'commander.ask', section: 'replay', title: 'Спросить командующего',
    describe: 'Задаёт командующему, чья вкладка открыта в карточке штаба, вопрос (почему так решил, что знал о противнике, что думал о соседе, почему не выбрал другой вариант, чего хочет сейчас, как оценивает положение); ответ — из записанного разбора на выбранный час, без языковой модели.',
    params: { type: 'object', properties: { question: TEXT }, required: ['question'] },
    say: ['спроси командующего: почему так решил?', 'почему так решил'],
    available: () => { const r = inReplay(); return r !== true ? r : get() ? true : 'вкладка «Командующий» не открыта. Откройте карточку штаба фронта и вкладку «Командующий»'; },
    highlight: () => hl('commander-chat'),
    run: async (p: { question: string }) => {
      const q = String(p?.question ?? '').trim();
      const d = get();
      if (!d) return 'Вкладка «Командующий» не открыта.';
      return q ? d.ask(q) : 'О чём спросить командующего?';
    },
  };
}
export function releaseCommander(get: () => CommanderDeps | null): void { if (commanderLive === get) commanderLive = null; }
const COMMANDER_PHRASES = SUGGESTIONS.map((s) => norm(s));
/** Разговор с командующим голосом: «спроси командующего …» — всегда; вопрос из подсказок — пока вкладка открыта. */
function parseCommander(t: string): PhraseHit | null {
  const m = /^(?:спроси|спросите|спросить) командующ\p{L}*(?: (.+))?$/u.exec(t);
  if (m) return m[1] ? hit('commander.ask', { question: m[1] }, 'откройте карточку штаба фронта и вкладку «Командующий»') : null;
  if (commanderLive?.() && COMMANDER_PHRASES.includes(t)) return hit('commander.ask', { question: t });
  return null;
}

/** Причина «нельзя» во время расчёта хода (кнопки и голос). */
export const BUSY = 'считаю ход — подождите, посредник доложит итоги';

/**
 * У приказа нет цели («проводи ход»): спросить её — «Куда наступать?»; ответ названием в следующей реплике дополнит
 * приказ (как после «восьмой гвардейской наступать» без цели). Возвращает вопрос.
 */
export function askTarget(unit: string, name: string, task: Task, note = ''): string {
  awaiting = { unit, name, task, note, until: Date.now() + AWAIT_MS, turn: voiceTurn() };
  return `${TARGET_Q[task]} Назовите пункт или соединение противника.`;
}
/** Своё объединение (не уничтоженное) по названию или id; переспрос — say; нет — null. */
export function findOwn(text: string, v: TurnView): { found: UnitReport } | { say: string } | null { return ownOf(text, v); }
const N = { type: 'object', properties: { n: { type: 'integer', minimum: 1, maximum: 3 } }, required: ['n'] };

export function staffActions(get: () => StaffDeps): Action[] {
  live = get; awaiting = null; lastUnit = null; voicePlan = null; voiceAsk.clear(); adviceMore = null;
  const ready = (): true | string => {
    const r = inReplay(); if (r !== true) return r;
    const d = get();
    if (!d.view) return 'обстановка ещё готовится — подождите немного';
    if (d.view.over) return 'игра окончена — новые приказы не нужны. Можно сказать: «Штаб, выйди из игры»';
    if (d.busy) return BUSY;
    return true;
  };
  const view = () => get().view!;
  const base = { section: 'replay', available: ready };
  const has = () => projectHas(get(), prevOf(get()));
  const draftReport = async () => {
    const d = get();
    d.setDecision({ report: draftReportText(view(), d.decision) });
    d.setTab('decision');
    lit(hl('field-report'));
    return 'Черновик донесения составлен по докладам. Прочитать — скажите «прочитай донесение».';
  };
  const compose = (p: { field: string; advisor?: boolean }) => {
    const f = (FIELD_KEYS.includes(p.field as FieldKey) ? p.field : fieldOf(p.field)) as FieldKey;
    const r = get().composeField(f, !!p.advisor);
    lit(hl(`field-${f}`));
    return r;
  };
  const planBusy = () => !!get().plan && !get().plan!.done;
  /** Ходатайство: действует ли на этом пункте (нет — пояснение, почему поле скрыто). */
  const petAv = (): true | string => { const r = ready(); if (r !== true) return r; const s = get().petition; return !s ? 'ходатайство здесь не подаётся' : s.show ? true : s.why; };
  const planHas = (): true | string => {
    const r = ready(); if (r !== true) return r;
    const p = get().plan;
    return p && p.variants.some(Boolean) ? true : 'вариантов ещё нет. Скажите: «Штаб, дай три варианта»';
  };
  const planReady = (): true | string => {
    const r = planHas(); if (r !== true) return r;
    const p = get().plan!;
    if (!p.done) return 'советник ещё готовит варианты — подождите';
    return p.time !== view().time ? 'варианты составлены для прошлого хода. Попросите новые: «Штаб, дай три варианта»' : true;
  };
  const variant = (n: unknown): { v: PlanVariantView; i: number } | string => {
    const vs = get().plan!.variants;
    const i = Math.round(Number(n)) - 1;
    const count = vs.filter(Boolean).length;
    return vs[i] ? { v: vs[i], i } : `Такого варианта нет: их ${numberWords(count)}.`;
  };
  const pick = async (n: unknown, only: boolean, edit = false) => { const x = variant(n); return typeof x === 'string' ? x : edit ? get().applyPlan(x.i, only, true) : get().applyPlan(x.i, only); };
  /** Варианты по правилам ядра: игра на агентной модели с командованием по ступеням. */
  const rulesOn = () => { const v = get().view; return v?.engine === 'agents' && !!v.command && v.command.mode !== 'legacy'; };
  /** Открыть подвкладку «Приказов»; её нет на этом уровне — не переключать, вернуть причину словами. */
  const toOrders = (s: OrdersSub): string | undefined => {
    const why = get().subsOk?.[s];
    if (why && why !== true) return `«${SUB_TITLE[s]}» на этом уровне нет: ${why}.`;
    get().setTab('orders'); get().setSub(s);
  };
  /** Поле решения диктовкой; acc — название в примерах фраз («запиши в оценку: …»), gender — род названия. */
  const decisionField = (k: FieldKey, id: string, title: string, acc: string, gender: 'm' | 'f' | 'n' | 'pl', aliases: string[] = []) =>
    fieldActions(id, title, () => get().decision[k] ?? '', (s) => { get().setTab('decision'); get().setDecision({ [k]: s }); }, { section: 'replay', aliases, gender })
      .map((a) => ({ ...a, available: ready, say: a.say?.map((x) => x.replace(title.toLowerCase(), acc)), highlight: () => hl(`field-${k}`) }));

  /** Приказ объединению: задача, цель (пункт или противник), указания. Нужна цель, а её нет — «Куда?». */
  const order = async (p: { unit: string; task?: string; place?: string; enemy?: string; notes?: string }): Promise<string> => {
    const v = view(), d = get();
    const u = ownOf(String(p?.unit ?? ''), v);
    if (!u) return `Не нашёл своего соединения «${p?.unit}».`;
    if ('say' in u) return u.say;
    const unit = u.found, name = short(unit.name);
    const cur = d.drafts[unit.id];
    const task = p.task ? taskOf(p.task) : cur?.task ?? null;
    if (p.task && !task) return `Не понял задачу «${p.task}». Можно: наступать, оборонять, удерживать, сдерживать, отойти, контратаковать, прорываться.`;
    if (!task) return `Какую задачу поставить: ${name} — наступать, оборонять, отойти?`;
    const note = p.notes !== undefined ? cap(String(p.notes).trim()) : cur?.note ?? '';
    let target: Target = null, targetText = '', at: LngLat | null = null, spoken = '';
    const asked = String(p.enemy ?? p.place ?? '').trim();
    const said = asked.replace(/^(?:на|к|ко|в|во|до|у|против|через) /i, '');
    if (asked) {
      const byEnemy = () => enemyOf(asked, v), byPlace = () => placeOf(asked, v);
      const first = p.enemy ? byEnemy() : byPlace();
      const r = first && 'found' in first ? first : (p.enemy ? byPlace() : byEnemy()) ?? first;
      if (!r || 'say' in r) {
        awaiting = { unit: unit.id, name, task, note, until: Date.now() + AWAIT_MS, turn: voiceTurn() };
        return r ? r.say : `Не нашёл на карте «${said}». ${TARGET_Q[task]} Назовите пункт или соединение противника.`;
      }
      const f = r.found;
      if ('title' in f) { target = f.id; at = f.at; targetText = f.title; spoken = `, цель — ${short(f.title)}`; }
      else { target = { formation: f.id }; at = f.at; targetText = `против: ${short(f.name)}`; spoken = ` против ${nameCase(short(f.name), 'gen')}`; }
    } else if (!p.task && cur) ({ target, targetText, at } = cur); // только указания — цель прежняя
    if (!target && NEEDS_TARGET.includes(task)) {
      awaiting = { unit: unit.id, name, task, note, until: Date.now() + AWAIT_MS, turn: voiceTurn() };
      return `${name} — ${TASK_RU[task]}. ${TARGET_Q[task]} Назовите пункт или соединение противника.`;
    }
    if (target && !spoken) {
      const enemy = typeof target === 'object' && !Array.isArray(target) ? v.intel.find((e) => e.id === (target as { formation: string }).formation) : undefined;
      spoken = enemy ? ` против ${nameCase(short(enemy.name), 'gen')}` : `, цель — ${short(targetText)}`;
    }
    awaiting = null; lastUnit = unit.id;
    d.setDraft(unit.id, { formation: unit.id, task, target, targetText, at, note });
    d.select(unit.id); toOrders('units');
    lit(hl(`order-${unit.id}`), ...spot(at));
    if (!p.task && p.notes !== undefined) return `Указания записаны: ${name}.`;
    const delay = v.delays[unit.echelon] ?? 0;
    return `Приказ: ${name} — ${TASK_RU[task]}${target ? spoken : ', на месте'}.${delay ? ` Дойдёт до войск через ${delay} ч.` : ''}`;
  };

  return [
    // ---- советник
    { ...base, id: 'command.variants', title: 'Варианты советника', describe: 'Просит от одного до трёх полных вариантов решения на ход: решение, задачи всем подчинённым, полосы и ось главного удара, резервы, тыл, переправы. Советник (языковая модель) — и дополнение правилом; без модели — варианты командующих по правилам.',
      params: { type: 'object', properties: { count: { type: 'integer', minimum: 1, maximum: 3 } } }, say: ['штаб, дай три варианта'], highlight: () => [hl('plan-cta'), hl('advisor')],
      available: () => {
        const r = ready(); if (r !== true) return r;
        if (get().advisorReady === false && !rulesOn()) return 'советник не на связи; варианты по правилам — в игре на агентной модели';
        return planBusy() ? 'советник уже готовит варианты — подождите или скажите «стоп»' : true;
      },
      run: async (p?: { count?: number }) => {
        const n = p?.count === undefined ? get().planN : Math.round(Number(p.count));
        if (!(n >= 1 && n <= 3)) return 'Советник предлагает от одного до трёх вариантов.';
        retractAnnounce(); // прежний поздний ответ советника ещё ждёт — новая просьба важнее
        const id = get().askPlan(n);
        // голосом пользуются (кнопка — тоже это действие) — штаб доложит, когда варианты будут готовы
        if (voiceRecent()) voicePlan = id;
        if (get().advisorReady === false) return `Готовлю ${variantsWord(n)} решения по правилам, без модели.`;
        return `Прошу у советника ${variantsWord(n)} решения. Это займёт время — скажу, когда будут готовы.`;
      } },
    { ...base, id: 'command.variants.list', title: 'Какие варианты', describe: 'Перечисляет готовые варианты решения от советника (новые не готовит).',
      say: ['штаб, покажи варианты'], available: planHas, highlight: () => hl('plan'),
      run: async () => {
        const p = get().plan!, vs = p.variants.filter(Boolean);
        get().openVariant(0);
        const notes = [!p.done && 'Советник ещё готовит остальные.', p.time !== view().time && 'Они составлены для прошлого хода.'].filter(Boolean).join(' ');
        return `Готовы ${variantsWord(vs.length)}: ${vs.map((x, i) => `${ordName(i)} — «${x.title}»`).join(', ')}.${notes ? ` ${notes}` : ''} Скажите: «подробнее о первом» или «выбираю первый».`;
      } },
    { ...base, id: 'answer.no', title: 'Приказ не отдавать', describe: 'Отказ на вопрос штаба «Куда?»: приказ не отдаётся.', say: ['нет', 'отставить'],
      available: () => (awaitingFresh() ? true : 'штаб ни о чём не спрашивал'),
      run: async () => { const a = awaiting!; awaiting = null; return `Приказ не отдан: ${a.name}.`; } },
    { ...base, id: 'command.variant.more', title: 'Подробнее о варианте', describe: 'Читает вариант решения N: суть, замысел, главные приказы; раскрывает его на экране.',
      params: N, say: ['штаб, подробнее о первом'], available: planHas, highlight: (p: { n: number }) => hl(`variant-${p?.n}`),
      run: async (p: { n: number }) => { const x = variant(p?.n); if (typeof x === 'string') return x; get().openVariant(x.i); return readAloud(variantText(x.v, x.i + 1)); } },
    { ...base, id: 'command.variant.pick', title: 'Принять вариант', describe: 'Принимает вариант решения N в пустой проект: целиком — приказы в очередь хода; edit — «принять и поправить»: приказы в проекты пункта управления; only — только решение.',
      params: { type: 'object', properties: { n: { type: 'integer', minimum: 1, maximum: 3 }, only: { type: 'boolean' }, edit: { type: 'boolean' } }, required: ['n'] }, say: ['штаб, выбираю первый', 'штаб, принимаю второй и поправлю'],
      available: planReady, highlight: (p: { n: number }) => hl(`variant-${p?.n}`),
      check: (p: { n: number; only?: boolean }) => {
        const x = variant(p?.n); if (typeof x === 'string') return x;
        return !p.only && has() ? 'В проекте уже есть решение или приказы — вариант их заменит. Скажите: «выбираю …» ещё раз, я переспрошу.' : true;
      },
      run: async (p: { n: number; only?: boolean; edit?: boolean }) => pick(p?.n, !!p?.only, !!p?.edit) },
    { ...base, id: 'command.variant.replace', title: 'Заменить проект вариантом', describe: 'Заменяет непустой проект (решение, приказы, распоряжения) вариантом N (необратимо); edit — приказы в проекты пункта управления.',
      params: { type: 'object', properties: { n: { type: 'integer', minimum: 1, maximum: 3 }, edit: { type: 'boolean' } }, required: ['n'] }, irreversible: true, available: planReady, highlight: (p: { n: number }) => hl(`variant-${p?.n}`),
      check: (p: { n: number }) => { const x = variant(p?.n); return typeof x === 'string' ? x : true; },
      confirm: (p: { n: number }) => { const x = variant(p?.n); return `Заменить проект вариантом «${typeof x === 'string' ? '' : x.v.title}»? Текущие решение, приказы и распоряжения будут заменены.`; },
      run: async (p: { n: number; edit?: boolean }) => pick(p?.n, false, !!p?.edit) },
    { ...base, id: 'command.advisor.ask', title: 'Спросить советника', describe: 'Задаёт советнику вопрос своими словами; ответ штаб зачитает, когда он будет готов.',
      // cat, topic — вопрос из дерева тем (кнопки советника): ответ — на экране, вслух не зачитывается
      params: { type: 'object', properties: { text: TEXT, cat: TEXT, topic: TEXT }, required: ['text'] }, say: ['штаб, спроси советника: где лучше наступать?'], highlight: () => hl('advisor'),
      available: () => { const r = ready(); return r !== true ? r : get().advisorBusy ? 'советник ещё отвечает на прошлый вопрос — подождите или скажите «стоп»' : true; },
      run: async (p: { text: string; cat?: string; topic?: string }) => {
        const q = String(p?.text ?? '').trim();
        if (!q) return 'О чём спросить советника?';
        retractAnnounce();
        if (p.cat) { get().askAdvisor(q, p.cat, p.topic); return; }
        voiceAsk.add(get().askAdvisor(q));
        return 'Передал вопрос советнику. Доложу ответ, когда он будет готов.';
      } },
    ...fieldActions('command.advisor.q', 'Вопрос советнику', () => get().advisorText, (s) => { get().setAdvisorText(s); void act('command.advisor.show', { mode: 'open' }).catch(() => {}); },
      { section: 'replay', aliases: ['вопрос', 'вопрос для советника', 'вопрос советника'], gender: 'm' })
      .map((a) => ({ ...a, available: ready, say: a.say?.map((x) => x.replace('вопрос советнику', 'вопрос')), highlight: () => hl('advisor') })),
    { ...base, id: 'command.advisor.send', title: 'Отправить вопрос советнику', describe: 'Отправляет советнику вопрос, записанный в поле; ответ штаб зачитает.',
      say: ['штаб, отправь вопрос'], highlight: () => hl('advisor'),
      available: () => { const r = ready(); return r !== true ? r : get().advisorBusy ? 'советник ещё отвечает на прошлый вопрос — подождите или скажите «стоп»' : get().advisorText.trim() ? true : 'в поле вопроса пусто — сначала продиктуйте: «запиши в вопрос …»'; },
      run: async () => {
        const q = get().advisorText.trim();
        if (!q) return 'Вопрос пуст. Продиктуйте: «запиши в вопрос …».';
        retractAnnounce();
        voiceAsk.add(get().askAdvisor(q));
        get().setAdvisorText('');
        return 'Передал вопрос советнику. Доложу ответ, когда он будет готов.';
      } },
    { ...base, id: 'command.advisor.voice', title: 'Читать ответы советника вслух', describe: 'Включает или выключает озвучку ответов советника на любые вопросы (набранные, продиктованные, из дерева тем).',
      params: { type: 'object', properties: { on: { type: 'boolean' } }, required: ['on'] }, say: ['штаб, читай ответы советника вслух', 'штаб, не читай ответы советника'],
      highlight: () => hl('advisor'), available: () => true,
      run: async (p: { on: boolean }) => { setSpeakAnswers(!!p?.on); return p?.on ? 'Ответы советника буду зачитывать.' : 'Ответы советника — только на экране.'; } },
    { ...base, id: 'command.advisor.more', title: 'Подробнее (ответ советника)', describe: 'Читает остаток последнего ответа советника.', say: ['подробнее'],
      available: () => { const r = ready(); return r !== true ? r : adviceMore ? true : 'продолжения ответа нет'; },
      run: async () => { const t = adviceMore!; adviceMore = null; return readAloud(t); } },
    { ...base, id: 'command.advisor.take', title: 'Взять предложенный приказ', describe: 'Включает в проект приказ, предложенный советником в последнем ответе (n — номер, если их несколько).',
      params: { type: 'object', properties: { n: { type: 'integer', minimum: 1 } } }, say: ['штаб, возьми приказ'], highlight: noted,
      available: () => { const r = ready(); return r !== true ? r : get().suggestions.length ? true : 'советник не предлагал приказов. Спросите его: «Штаб, спроси советника: …»'; },
      run: async (p?: { n?: number }) => {
        const sg = get().suggestions;
        if (p?.n === undefined && sg.length > 1) return `Какой приказ: ${sg.slice(0, 3).map((s, i) => `${ordName(i)} — ${sugText(s)}`).join('; ')}? Скажите, например: «возьми первый приказ».`;
        const s = sg[p?.n === undefined ? 0 : Math.round(Number(p.n)) - 1];
        if (!s) return `Такого приказа нет: предложено ${numberWords(sg.length)}.`;
        get().takeSuggestion(s);
        lastUnit = s.formation;
        lit(hl(`order-${s.formation}`), hl(`orow-${s.formation}`), ...spot(s.at));
        return `Взял в проект: ${sugText(s)}.`;
      } },
    { ...base, id: 'command.advisor.stop', title: 'Остановить советника', describe: 'Прерывает ответ советника и подготовку вариантов.', say: ['штаб, останови советника', 'стоп'],
      available: () => { const r = ready(); return r !== true ? r : get().advisorBusy || planBusy() ? true : 'советник сейчас ничего не готовит'; },
      run: async () => { get().stopAdvisor(); voicePlan = null; return 'Советник остановлен.'; } },
    // ---- решение (поля — диктовкой: «запиши в замысел: …»)
    ...decisionField('assessment', 'decision.assessment', 'Оценка обстановки', 'оценку', 'f', ['оценка']),
    ...decisionField('enemyIntent', 'decision.enemy', 'Замысел противника', 'замысел противника', 'm'),
    ...decisionField('intent', 'decision.intent', 'Замысел', 'замысел', 'm', ['решение']),
    ...decisionField('risks', 'decision.risks', 'Риски', 'риски', 'pl'),
    ...decisionField('report', 'decision.report', 'Донесение', 'донесение', 'n', ['боевое донесение']),
    // ---- ходатайство о разграничительной линии: сосед, линия по пунктам, очистить (линия мышью — щелчками по карте)
    { ...base, id: 'decision.petition.neighbour', title: 'Ходатайство: сосед', describe: 'Начинает ходатайство о разграничительной линии с соседним фронтом (name — его название).',
      params: { type: 'object', properties: { name: TEXT }, required: ['name'] }, say: ['штаб, ходатайство о линии с первым украинским фронтом'], available: petAv, highlight: () => hl('field-request'),
      run: async (p: { name: string }) => {
        const nb = get().petition?.neighbours ?? [];
        if (!nb.length) return 'Соседних фронтов с войсками нет — линию просить не с кем.';
        const r = nb.find((x) => x.id === p?.name) ? { unit: nb.find((x) => x.id === p.name) } : findUnit(String(p?.name ?? ''), nb);
        if (!r.unit) return `Сосед — ${nb.map((x) => short(x.name)).join(' или ')}?`;
        const cur = get().decision.petition;
        get().setTab('decision');
        get().setDecision({ petition: { neighbour: r.unit.id, line: cur?.line ?? [], note: cur?.note ?? '' } });
        return `Ходатайство о линии с соседом: ${short(r.unit.name)}. Теперь пункты линии: «добавь в ходатайство …» или щелчками по карте.`;
      } },
    { ...base, id: 'decision.petition.point', title: 'Ходатайство: пункт линии', describe: 'Добавляет пункт (place — название) точкой в конец линии ходатайства.',
      params: { type: 'object', properties: { place: TEXT }, required: ['place'] }, say: ['штаб, добавь в ходатайство Котбус'], available: petAv, highlight: () => hl('field-request'),
      run: async (p: { place: string }) => {
        const pl = placeOf(String(p?.place ?? ''), view());
        if (!pl) return `Не нашёл пункта «${p?.place}».`;
        if ('say' in pl) return pl.say;
        const cur = get().decision.petition ?? { neighbour: '', line: [], note: '' };
        const line = [...cur.line, pl.found.at];
        get().setTab('decision');
        get().setDecision({ petition: { ...cur, line } });
        const n = line.length;
        return `В линию ходатайства — ${short(pl.found.title)}; точек — ${n === 1 ? 'одна' : numberWords(n, 'f')}.${n < 2 ? ' Нужна ещё хотя бы одна.' : ''}${cur.neighbour ? '' : ' Назовите соседа: «ходатайство о линии с …».'}`;
      } },
    { ...base, id: 'decision.petition.clear', title: 'Очистить ходатайство', describe: 'Убирает ходатайство о разграничительной линии из решения.',
      say: ['штаб, очисти ходатайство'], available: petAv, highlight: () => hl('field-request'),
      run: async () => { get().setDecision({ petition: undefined }); return 'Ходатайство очищено — подаваться не будет.'; } },
    { ...base, id: 'decision.fromLast', title: 'Взять с прошлого хода', describe: 'Берёт поле решения с прошлого хода (без поля — все пустые поля).',
      params: { type: 'object', properties: { field: { enum: [...FIELD_KEYS] } } }, say: ['штаб, возьми с прошлого хода'], highlight: noted,
      run: async (p?: { field?: FieldKey }) => {
        const d = get(), last = view().lastDecision;
        if (!last) return 'Прошлого решения нет — это первый ход.';
        d.setTab('decision');
        if (p?.field) {
          if (!last[p.field]) return `На прошлом ходу ${FIELD_ACC[p.field]} не писали.`;
          d.setDecision({ [p.field]: last[p.field] });
          lit(hl(`field-${p.field}`));
          return `Взял с прошлого хода: ${FIELD_ACC[p.field]}.`;
        }
        const keys = FIELD_KEYS.filter((k) => last[k] && !d.decision[k].trim());
        if (!keys.length) return 'Все поля уже заполнены. Заменить одно — скажите, например: «возьми оценку с прошлого хода».';
        d.setDecision(Object.fromEntries(keys.map((k) => [k, last[k]])));
        lit(...keys.map((k) => hl(`field-${k}`)));
        return `Взял с прошлого хода: ${keys.map((k) => FIELD_ACC[k]).join(', ')}.`;
      } },
    { ...base, id: 'decision.compose', title: 'Составить поле решения', describe: 'Составляет поле решения по обстановке хода — оценку обстановки, замысел противника, решение, риски или донесение (field); advisor — текст пишет советник за штаб пункта управления. Поле пусто.',
      params: { type: 'object', properties: { field: { type: 'string' }, advisor: { type: 'boolean' } }, required: ['field'] },
      say: ['штаб, составь оценку обстановки', 'штаб, пусть советник напишет риски'], highlight: noted,
      check: (p: { field: string; advisor?: boolean }) => {
        const f = FIELD_KEYS.includes(p?.field as FieldKey) ? p.field as FieldKey : fieldOf(String(p?.field ?? ''));
        if (!f) return 'Скажите, какое поле: оценку обстановки, замысел противника, решение, риски или донесение.';
        if (p.advisor && !get().advisorReady) return 'Советник не на связи — языковая модель не отвечает. Скажите без советника: «составь …» — черновик по обстановке.';
        if (get().decision[f].trim()) return `${FIELD_DONE[f]}. Заменить — скажите «составь ${FIELD_ACC[f]} заново».`;
        return true;
      },
      run: async (p: { field: string; advisor?: boolean }) => compose(p) },
    { ...base, id: 'decision.compose.replace', title: 'Составить поле решения заново', describe: 'Заменяет написанное в поле решения черновиком по обстановке или текстом советника (advisor).',
      params: { type: 'object', properties: { field: { type: 'string' }, advisor: { type: 'boolean' } }, required: ['field'] },
      say: ['штаб, составь оценку обстановки заново'], irreversible: true, highlight: noted,
      confirm: (p: { field: string }) => { const f = FIELD_KEYS.includes(p?.field as FieldKey) ? p.field as FieldKey : fieldOf(String(p?.field ?? '')); return `Составить ${f ? FIELD_ACC[f] : 'поле'} заново? Текст будет заменён.`; },
      check: (p: { field: string; advisor?: boolean }) => {
        const f = FIELD_KEYS.includes(p?.field as FieldKey) ? p.field as FieldKey : fieldOf(String(p?.field ?? ''));
        if (!f) return 'Скажите, какое поле: оценку обстановки, замысел противника, решение, риски или донесение.';
        return p.advisor && !get().advisorReady ? 'Советник не на связи — языковая модель не отвечает.' : true;
      },
      run: async (p: { field: string; advisor?: boolean }) => compose(p) },
    { ...base, id: 'decision.compose.all', title: 'Составить решение советником', describe: 'Советник (языковая модель) пишет все поля решения за штаб пункта управления — оценку обстановки, замысел противника, решение, риски и донесение — одно за другим. Поля пусты.',
      say: ['штаб, составь решение советником'], highlight: () => hl('field-assessment'),
      check: () => {
        const d = get();
        if (!d.advisorReady) return 'Советник не на связи — языковая модель не отвечает. Поля можно составить по обстановке: «составь оценку обстановки».';
        if (d.composing) return 'Советник уже пишет решение.';
        if (FIELD_KEYS.some((k) => d.decision[k].trim())) return 'Часть полей уже написана. Заменить всё — скажите «составь решение советником заново».';
        return true;
      },
      run: async () => get().composeAll() },
    { ...base, id: 'decision.compose.all.replace', title: 'Составить решение советником заново', describe: 'Советник переписывает все поля решения (написанное заменяется).',
      say: ['штаб, составь решение советником заново'], irreversible: true, highlight: () => hl('field-assessment'),
      confirm: () => 'Заменить всё решение текстом советника?',
      check: () => (!get().advisorReady ? 'Советник не на связи — языковая модель не отвечает.' : get().composing ? 'Советник уже пишет решение.' : true),
      run: async () => get().composeAll() },
    { ...base, id: 'decision.draftReport', title: 'Черновик донесения', describe: 'Составляет черновик боевого донесения по докладам за ход (поле донесения пусто).', say: ['штаб, составь черновик донесения'], highlight: noted,
      check: () => (get().decision.report.trim() ? 'Донесение уже продиктовано. Скажите «составь черновик донесения» ещё раз — я переспрошу, заменить ли его.' : true),
      run: draftReport },
    { ...base, id: 'decision.draftReport.replace', title: 'Заменить донесение черновиком', describe: 'Заменяет продиктованное донесение черновиком по докладам (необратимо).',
      irreversible: true, confirm: () => 'Заменить продиктованное донесение черновиком?', run: draftReport, highlight: noted },
    { ...base, id: 'decision.missing', title: 'Что не готово', describe: 'Говорит, чего не хватает для хода: поля решения, цели приказов.', say: ['штаб, что не готово?'],
      run: async () => {
        const d = get(), v = view();
        const miss = decisionMissing(d.decision).map((m) => (m.startsWith('решение') ? 'замысел' : m.startsWith('боевое') ? 'боевое донесение' : m));
        const noTarget = Object.values(d.drafts).filter((x) => NEEDS_TARGET.includes(x.task) && !x.target)
          .map((x) => short(v.own.find((u) => u.id === x.formation)?.name ?? x.formation));
        const n = Object.keys(d.drafts).length, m = d.acts.length;
        if (!miss.length && !noTarget.length) {
          return `Решение готово: ${n ? `${numberWords(n)} ${plural(n, ['приказ', 'приказа', 'приказов'])}` : 'приказов нет'}, ${m ? `${numberWords(m, 'n')} ${plural(m, ['распоряжение', 'распоряжения', 'распоряжений'])}` : 'распоряжений нет'}. Можно проводить ход.`;
        }
        if (miss.length) d.setTab('decision');
        const hints = [miss.includes('оценка обстановки') && '«запиши в оценку: …»', miss.includes('замысел') && '«запиши в замысел: …»',
          miss.includes('боевое донесение') && '«составь черновик донесения»', noTarget.length && `«${nameCase(noTarget[0], 'dat')} наступать на …»`].filter(Boolean);
        return `Не готово: ${[miss.join(', '), noTarget.length ? `нет цели у приказа: ${noTarget.join(', ')}` : ''].filter(Boolean).join('; ')}. Скажите, например: ${hints.join(', ')}.`;
      } },
    // ---- приказы
    { ...base, id: 'command.order', title: 'Приказ соединению', describe: 'Приказ своему объединению: задача (наступать, оборонять, удерживать, сдерживать, перегруппироваться, в резерв, отходить, контратаковать, прорываться, деблокировать), цель — пункт (place) или противник (enemy), указания (notes).',
      params: { type: 'object', properties: { unit: TEXT, task: TEXT, place: TEXT, enemy: TEXT, notes: TEXT }, required: ['unit'] },
      say: ['штаб, восьмой гвардейской наступать на Зелов'], run: order, highlight: noted },
    { ...base, id: 'command.order.cancel', title: 'Отменить приказ', describe: 'Отменяет новый приказ объединению (без названия — последний).',
      params: { type: 'object', properties: { unit: TEXT } }, say: ['штаб, отмени приказ восьмой гвардейской'], highlight: noted,
      run: async (p?: { unit?: string }) => {
        const d = get(), v = view();
        let id: string | null = null;
        if (p?.unit) { const u = ownOf(p.unit, v); if (!u) return `Не нашёл своего соединения «${p.unit}».`; if ('say' in u) return u.say; id = u.found.id; }
        else { const ids = Object.keys(d.drafts); id = lastUnit && d.drafts[lastUnit] ? lastUnit : ids.length === 1 ? ids[0] : null; if (!id) return ids.length ? 'Какой приказ отменить? Назовите соединение.' : 'Новых приказов нет.'; }
        const name = short(v.own.find((u) => u.id === id)?.name ?? id);
        if (!d.drafts[id]) return `Нового приказа нет: ${name}.`;
        d.setDraft(id, null);
        if (lastUnit === id) lastUnit = null;
        lit(hl(`orow-${id}`));
        return `Приказ отменён: ${name}.`;
      } },
    { ...base, id: 'command.orders.list', title: 'Какие приказы отданы', describe: 'Перечисляет новые приказы и распоряжения в проекте на этот ход.', say: ['штаб, какие приказы отданы?'], highlight: () => [hl('drafts'), hl('tab-orders')],
      run: async () => {
        const d = get(), v = view();
        const list = Object.values(d.drafts).map((x) => `${short(v.own.find((u) => u.id === x.formation)?.name ?? x.formation)} — ${TASK_RU[x.task]}, ${x.targetText ? short(x.targetText) : 'на месте'}`);
        const head = list.length ? `Приказов в проекте ${numberWords(list.length)}: ${list.join('; ')}.` : 'Новых приказов в проекте нет.';
        const acts = d.acts.length ? ` Распоряжения: ${d.acts.map((a) => short(a.label)).join('; ')}.` : '';
        return readAloud(head + acts);
      } },
    // ---- тыл, переправы, резервы, полосы
    { ...base, id: 'command.rear.base', title: 'Перенести базу снабжения', describe: 'Переносит базу снабжения в пункт (army — название базы или армия: переносится ближайшая к ней база).',
      params: { type: 'object', properties: { army: TEXT, place: TEXT }, required: ['army', 'place'] }, say: ['штаб, перенеси базу восьмой гвардейской в Зелов'], highlight: noted,
      run: async (p: { army: string; place: string }) => {
        const v = view();
        const b = baseOf(String(p?.army ?? ''), v);
        if ('say' in b) return b.say;
        const pl = placeOf(String(p?.place ?? ''), v);
        if (!pl) return `Не нашёл пункта «${p?.place}».`;
        if ('say' in pl) return pl.say;
        { const hid = toOrders('rear'); if (hid) return hid; }
        const r = await get().addAct(`base:${b.found.id}`, { kind: 'base', side: v.human.id, base: b.found.id, to: pl.found.at, toName: pl.found.title, issuedAt: v.time }, `База «${b.found.name}»`, { from: b.found.at });
        if (r.ok) lit(hl(`act-base:${b.found.id}`), { at: pl.found.at });
        return actReply(`База «${short(b.found.name)}»`, r);
      } },
    { ...base, id: 'command.rear.priority', title: 'Приоритет подвоза', describe: 'Даёт приоритет подвоза армиям (пустой список — подвоз поровну).',
      params: { type: 'object', properties: { armies: { type: 'array', items: TEXT }, ids: { type: 'array', items: TEXT } } }, say: ['штаб, приоритет подвоза восьмой гвардейской'], highlight: noted,
      run: async (p: { armies?: string[] | string; ids?: string[] }) => {
        const v = view(), d = get();
        // ids — уже готовый список стороны (пункт управления правит в нём свою часть); armies — названия
        const names = p?.ids ? [] : Array.isArray(p?.armies) ? p.armies : String(p?.armies ?? '').split(/,| и /).map((x) => x.trim()).filter(Boolean);
        const ids: string[] = p?.ids ? [...p.ids] : [];
        for (const n of names) { const u = ownOf(n, v); if (!u) return `Не нашёл своего соединения «${n}».`; if ('say' in u) return u.say; if (!ids.includes(u.found.id)) ids.push(u.found.id); }
        if (!p?.ids && d.mergePriority) { const m = d.mergePriority(ids); ids.length = 0; ids.push(...m); }
        { const hid = toOrders('rear'); if (hid) return hid; }
        if (ids.length === v.priority.length && ids.every((x) => v.priority.includes(x))) { d.dropAct('priority'); lit(hl('prio')); return 'Приоритет подвоза — как был.'; }
        const r = await d.addAct('priority', { kind: 'priority', side: v.human.id, formations: ids, issuedAt: v.time }, 'Приоритет подвоза');
        if (r.ok) lit(hl('act-priority'), hl('prio'));
        return actReply('Приоритет подвоза', r);
      } },
    { ...base, id: 'command.parks', title: 'Придать понтонные парки', describe: 'Придаёт подчинённому штабу понтонные парки (n — сколько всего будет у него): Ставка — фронтам, фронт — армиям, армия — корпусам.',
      params: { type: 'object', properties: { hq: TEXT, n: { type: 'number' } }, required: ['hq', 'n'] }, say: ['штаб, придай восьмой гвардейской два понтонных парка'], highlight: noted,
      run: async (p: { hq: string; n: number }) => {
        const v = view();
        const hqs = v.command?.hqs ?? {};
        const id = hqs[p?.hq] ? p.hq : Object.keys(hqs).find((k) => norm(hqs[k].name).includes(norm(String(p?.hq ?? '')))) ?? '';
        if (!id) return `Не нашёл штаба «${p?.hq}».`;
        const n = Math.max(0, Math.round(Number(p?.n ?? 0)));
        { const hid = toOrders('bridges'); if (hid) return hid; }
        const r = await get().addAct(`parks:${id}`, { kind: 'parks', side: v.human.id, hq: id, n, issuedAt: v.time }, `Понтонные парки — ${short(hqs[id].name)}`);
        if (r.ok) lit(hl('parks'));
        return actReply(`Понтонные парки — ${short(hqs[id].name)}`, r);
      } },
    { ...base, id: 'command.bridge', title: 'Навести переправу', describe: 'Наводит понтонную переправу у пункта (у реки).',
      params: { type: 'object', properties: { place: TEXT }, required: ['place'] }, say: ['штаб, наведи переправу у Кюстрина'], highlight: noted,
      run: async (p: { place: string }) => {
        const v = view();
        const pl = placeOf(String(p?.place ?? ''), v);
        if (!pl) return `Не нашёл пункта «${p?.place}».`;
        if ('say' in pl) return pl.say;
        { const hid = toOrders('bridges'); if (hid) return hid; }
        const key = `bridge:${Date.now()}`;
        const r = await get().addAct(key, { kind: 'bridge', side: v.human.id, at: pl.found.at, issuedAt: v.time }, 'Переправа');
        if (r.ok) { get().goTo(r.at ?? pl.found.at); lit(hl(`act-${key}`), { at: r.at ?? pl.found.at }); }
        return actReply('Переправа', r);
      } },
    { ...base, id: 'command.reserve.commit', title: 'Ввести резерв', describe: 'Вводит резерв (объединение целиком или соединение) в район пункта.',
      params: { type: 'object', properties: { army: TEXT, place: TEXT }, required: ['army', 'place'] }, say: ['штаб, введи третью ударную в районе Зелова'], highlight: noted,
      run: async (p: { army: string; place: string }) => {
        const v = view();
        const g = reserveOf(String(p?.army ?? ''), v);
        if (!g) return `«${p?.army}» — не резерв, ждущий ввода.`;
        if ('say' in g) return g.say;
        const pl = placeOf(String(p?.place ?? ''), v);
        if (!pl) return `Не нашёл пункта «${p?.place}».`;
        if ('say' in pl) return pl.say;
        { const hid = toOrders('reserves'); if (hid) return hid; }
        const free = g.found.members?.filter((m) => !get().acts.some((a) => a.key === `commit:${m.id}`));
        const r = await get().commit(free ? { ...g.found, members: free } : g.found, pl.found.at, pl.found.title);
        if (r.ok) lit(hl(`res-${g.found.id}`), { at: pl.found.at });
        return actReply(short(g.found.name), r);
      } },
    { ...base, id: 'command.reserve.cancel', title: 'Не вводить резерв', describe: 'Отменяет ввод резерва (объединения или соединения).',
      params: { type: 'object', properties: { army: TEXT }, required: ['army'] }, say: ['штаб, не вводи третью ударную'], highlight: noted,
      run: async (p: { army: string }) => {
        const v = view(), d = get();
        const g = reserveOf(String(p?.army ?? ''), v);
        if (!g) return `«${p?.army}» — не резерв, ждущий ввода.`;
        if ('say' in g) return g.say;
        const keys = (g.found.members ?? [g.found]).map((m) => `commit:${m.id}`).filter((k) => d.acts.some((a) => a.key === k));
        if (!keys.length) return `Ввода нет в проекте: ${short(g.found.name)}.`;
        { const hid = toOrders('reserves'); if (hid) return hid; }
        keys.forEach((k) => d.dropAct(k));
        lit(hl(`res-${g.found.id}`));
        return `Ввод отменён: ${short(g.found.name)}.`;
      } },
    { ...base, id: 'command.bounds.propose', title: 'Предложить разграничительную линию', describe: 'Намечает на карте линию между двумя армиями одного фронта (затем — «в распоряжение»).',
      params: { type: 'object', properties: { army: TEXT, neighbor: TEXT }, required: ['army', 'neighbor'] }, say: ['штаб, предложи линию между восьмой гвардейской и пятой ударной'], highlight: noted,
      run: async (p: { army: string; neighbor: string }) => {
        const v = view(), armies = v.armies ?? [];
        const one = (t: string): Found<(typeof armies)[number]> => {
          const byId = armies.find((a) => a.id === t); if (byId) return { found: byId };
          const r = findUnit(t, armies);
          return r.unit ? { found: r.unit } : r.options.length ? { say: `Какая армия: ${r.labels.map((l) => `«${short(l)}»`).join(', ')}?` } : null;
        };
        const A = one(String(p?.army ?? '')), B = one(String(p?.neighbor ?? ''));
        for (const [x, n] of [[A, p?.army], [B, p?.neighbor]] as const) { if (!x) return `Не нашёл армии «${n}» среди армий на театре.`; if ('say' in x) return x.say; }
        const a = (A as { found: (typeof armies)[number] }).found, b = (B as { found: (typeof armies)[number] }).found;
        if (a.id === b.id) return 'Нужны две разные армии.';
        if (a.group !== b.group) return `Линию проводят между армиями одного ${v.terms?.group === 'группа армий' ? 'объединения' : 'фронта'}, а ${short(a.name)} и ${short(b.name)} — в разных.`;
        { const hid = toOrders('bounds'); if (hid) return hid; }
        const pts = proposeLine(v, a, b);
        get().setBounds({ front: a.group, a: a.id, b: b.id, pts });
        get().goTo(pts[1]);
        lit(hl('bounds-form'), { at: pts[1] });
        return `Линия между ${nameCase(short(a.name), 'ins')} и ${nameCase(short(b.name), 'ins')} намечена на карте. Включить — скажите «в распоряжение»; поправить — точками на карте.`;
      } },
    { ...base, id: 'command.bounds.put', title: 'Линию — в распоряжение', describe: 'Включает намеченную разграничительную линию в распоряжения (после проверки).', say: ['штаб, в распоряжение'], highlight: noted,
      run: async () => {
        const v = view(), d = get(), { front, a, b, pts } = d.bounds;
        if (!a || !b || a === b || pts.length < 2) return 'Линии ещё нет. Скажите, например: «предложи линию между восьмой гвардейской и пятой ударной».';
        const nm = (id: string) => short((v.armies ?? []).find((x) => x.id === id)?.name ?? id);
        const label = `Линия ${nm(a)} / ${nm(b)}`;
        { const hid = toOrders('bounds'); if (hid) return hid; }
        const r = await d.addAct(`boundary:${[a, b].sort().join('|')}`, { kind: 'boundary', side: v.human.id, a, b, line: pts, issuedAt: v.time }, label, { at: pts[0] });
        if (r.ok) { d.setBounds({ front, a: '', b: '', pts: [] }); lit(hl(`act-boundary:${[a, b].sort().join('|')}`), { at: pts[0] }); }
        return actReply(label, r);
      } },
    { ...base, id: 'command.act.cancel', title: 'Отменить распоряжение', describe: 'Отменяет распоряжение в проекте: переправу (name — пункт), перенос базы (name — база), приоритет подвоза, разграничительную линию (name — армии).',
      params: { type: 'object', properties: { kind: { enum: ['bridge', 'base', 'priority', 'boundary'] }, name: TEXT }, required: ['kind'] }, say: ['штаб, отмени переправу'], highlight: noted,
      run: async (p: { kind: 'bridge' | 'base' | 'priority' | 'boundary'; name?: string }) => {
        const d = get(), v = view();
        const WHAT = { bridge: 'переправы', base: 'переноса базы', priority: 'приоритета подвоза', boundary: 'разграничительной линии' } as const;
        const SUB = { bridge: 'bridges', base: 'rear', priority: 'rear', boundary: 'bounds' } as const;
        if (!WHAT[p?.kind]) return 'Какое распоряжение отменить: переправу, перенос базы, приоритет подвоза или линию?';
        let list = d.acts.filter((a) => (p.kind === 'boundary' ? a.action.kind === 'boundary' || a.action.kind === 'directive' : a.action.kind === p.kind));
        if (!list.length) return `В проекте нет ${WHAT[p.kind]}.`;
        const nm = String(p.name ?? '').trim();
        if (nm && p.kind === 'bridge') {
          const pl = placeOf(nm, v);
          if (pl && 'say' in pl) return pl.say;
          if (pl) { const at = pl.found.at; list = [list.reduce((m, a) => (km(a.at ?? at, at) < km(m.at ?? at, at) ? a : m))]; }
        } else if (nm && p.kind === 'base') {
          const b = baseOf(nm, v);
          if ('say' in b) return b.say;
          list = list.filter((a) => a.key === `base:${b.found.id}`);
        } else if (nm && p.kind === 'boundary') {
          const ids = nm.split(/ и /).map((x) => findUnit(x, v.armies ?? []).unit?.id).filter(Boolean);
          list = list.filter((a) => a.action.kind === 'boundary' && ids.every((id) => id === (a.action as { a: string }).a || id === (a.action as { b: string }).b));
        }
        const label = (a: StaffAct) => { const x = a.label.replace(/\s*\([^)]*\)/g, ''); return x.charAt(0).toLowerCase() + x.slice(1); };
        if (!list.length) return 'Такого распоряжения в проекте нет.';
        if (list.length > 1) return `Какое отменить: ${list.slice(0, 3).map((a) => `«${label(a)}»`).join(', ')}? Назовите место или армии.`;
        const hid = toOrders(SUB[p.kind]);
        if (hid) return hid;
        d.dropAct(list[0].key);
        lit(hl(`sub-${SUB[p.kind]}`));
        return `Отменено: ${label(list[0])}.`;
      } },
  ];
}

/** База снабжения по названию или id; армия — ближайшая к ней база. */
function baseOf(text: string, v: TurnView): { found: TurnView['bases'][number] } | { say: string } {
  const byId = v.bases.find((b) => b.id === text);
  if (byId) return { found: byId };
  const hit = pickByName(text.replace(/^(?:базу|базы|база) /, ''), v.bases.map((b) => short(b.name)));
  if (hit.length === 1) return { found: v.bases[hit[0]] };
  if (hit.length > 1) return { say: `Какую базу: ${hit.slice(0, 3).map((i) => `«${short(v.bases[i].name)}»`).join(', ')}?` };
  const u = ownOf(text, v);
  if (u && 'say' in u) return u;
  if (u && v.bases.length) return { found: v.bases.reduce((m, b) => (km(b.at, u.found.at) < km(m.at, u.found.at) ? b : m)) };
  return { say: `Не нашёл базы «${text}». Базы: ${v.bases.map((b) => `«${short(b.name)}»`).join(', ')}.` };
}

// ---------------------------------------------------------------- разбор фраз

/** Действие есть — вызов; нет — «игра не идёт» (команда без названия) или null (пусть разбирает модель). */
function hit(id: string, params?: unknown, missing: string | null = NO_GAME): PhraseHit | null {
  if (getAction(id)) return { id, params };
  return missing === null ? null : { say: `Сейчас нельзя: ${missing}.` };
}
const COUNT: Record<string, number> = { один: 1, одну: 1, одного: 1, 1: 1, два: 2, две: 2, 2: 2, три: 3, 3: 3, четыре: 4, 4: 4, пять: 5, 5: 5 };
/** Номер варианта / приказа: «второй», «второму», «вариант три»; нет — null. */
function nth(text: string): number | null {
  const ws = norm(text).split(' ').filter((w) => w && !/^(?:вариант|приказ)\p{L}*$/u.test(w) && !['по', 'о', 'об', 'из', 'от', 'с', 'номер'].includes(w));
  if (ws.length !== 1) return null;
  const w = ws[0].replace(/(?:ому|ему|ого|его|ым|им|ом|ем|ой|ую)$/, 'ой');
  const i = ordinalIndex(w) ?? ordinalIndex(ws[0]);
  return i === null ? null : i + 1;
}
/** Разделить слова на «что» и «куда» по предлогу (справа налево): обе части годятся — ok(left, right). */
function splitAt<T>(ws: string[], preps: RegExp, ok: (a: string, b: string) => T | null): T | null {
  for (let i = ws.length - 2; i >= 1; i--) {
    if (!preps.test(ws[i])) continue;
    let j = i + 1;
    if (ws[i] === 'в' && /^район/.test(ws[j] ?? '')) j++;
    const r = ok(ws.slice(0, i).join(' '), ws.slice(j).join(' '));
    if (r) return r;
  }
  return null;
}
const found = (r: Found<unknown>) => !!r; // нашлось или есть что переспросить

/** Фразы штабной работы (см. шапку модуля). rest — без обращения, section — открытый раздел. */
export function parseStaff(rest: string, section: string, raw = rest): PhraseHit | null {
  if (section !== 'replay') return null;
  let t = norm(rest);
  let m: RegExpExecArray | null;
  const v = live?.().view ?? null;
  const cm = parseCommander(t);
  if (cm) return cm;
  // к советнику по имени: «советник, дай два варианта», «советник, где лучше наступать»
  if ((m = /^советник\p{L}* (.+)$/u.exec(t))) {
    if (/^(?:стоп|хватит|остановись|замолчи)$/.test(m[1])) return hit('command.advisor.stop');
    const own = parseStaff(m[1], section, raw);
    if (own) return own;
    return m[1].split(' ').length >= 2 ? hit('command.advisor.ask', { text: m[1] }) : null;
  }
  // ходатайство о разграничительной линии: «ходатайство о линии с …», «добавь в ходатайство …», «очисти ходатайство»
  if ((m = /^(?:(?:подай|подать|составь|начни|пиши|напиши) )?ходатайств\p{L}* (?:о|об|по) (?:разграничительн\p{L}* )?лини\p{L}* (?:с|со) (.+)$/u.exec(t))) return hit('decision.petition.neighbour', { name: m[1] });
  if ((m = /^(?:добавь|добавить|включи|внеси|поставь)(?: в)? (?:ходатайств\p{L}*|линию ходатайства)(?: пункт)? (.+)$/iu.exec(raw.trim().replace(/[.!]+$/, '')))) return hit('decision.petition.point', { place: m[1] });
  if (/^(?:очисти|очистить|убери|сними|отмени|удали)(?: мое| моё)? ходатайств\p{L}*$/u.test(t)) return hit('decision.petition.clear');
  // советник: варианты — готовые показать («покажи варианты», «варианты»), новые — только «дай / подготовь / предложи»
  if (/^(?:(?:покажи|прочитай|зачитай|какие|назови|перечисли)(?: мне)? )?варианты(?: решения)?(?: от советника)?$/.test(t)) return hit('command.variants.list');
  if ((m = /^(?:дай|дайте|предложи|предложите|подготовь|подготовьте|составь|нужны|хочу)(?: мне| нам)? (?:(\S+) )?вариант\p{L}*(?: решения)?(?: на ход)?(?: от советника)?$/u.exec(t))) {
    if (m[1] && !(m[1] in COUNT)) return null;
    return hit('command.variants', m[1] ? { count: COUNT[m[1]] } : {});
  }
  if ((m = /^(?:подробнее|подробней|расскажи(?: подробнее)?|опиши|прочитай|зачитай)(?: о| об| про)? (.+)$/.exec(t))) {
    const named = /(?:^| )вариант/.test(m[1]);
    const n = nth(m[1]);
    if (n && (named || /^(?:перв|втор|трет)(?:ом|ой|ый|ий|ем|ьем)$/.test(m[1]))) return hit('command.variant.more', { n });
  }
  if ((m = /^только решение(?: (?:по|из|от|с))? (.+)$/.exec(t)) && nth(m[1])) return hit('command.variant.pick', { n: nth(m[1]), only: true });
  if ((m = /^(?:выбираю|выбери|выбрать|выберем|беру|берем|принимаю|прими|принять|утверждаю)(?: (.+))?$/.exec(t))) {
    // «… и поправлю», «… с правкой» — принять и поправить: приказы в проекты пункта управления
    const em = /^(.*?) (?:и (?:поправлю|поправим|поправить|исправлю|доработаю)|с правкой|на правку)$/.exec(m[1] ?? '');
    const edit = !!em;
    const tail = em ? em[1] : m[1] ?? '';
    const n = nth(tail);
    const named = /(?:^| )вариант\p{L}*$|^вариант\p{L}*(?: |$)/u.test(tail);
    if (!n && !(named && tail.split(' ').length === 1)) return null;
    if (!getAction('command.variant.pick')) return hit('command.variant.pick');
    const p = live?.().plan;
    const vs = p?.variants.filter(Boolean) ?? [];
    if (!n) {
      if (vs.length > 1) return { say: `Какой вариант: ${vs.map((x, i) => `${ordName(i)} — «${x.title}»`).join(', ')}?` };
      return hit('command.variant.pick', edit ? { n: 1, edit } : { n: 1 });
    }
    const d = live!();
    return hit(d.view && projectHas(d, prevOf(d)) ? 'command.variant.replace' : 'command.variant.pick', edit ? { n, edit } : { n });
  }
  // советник: вопрос, остановка, «подробнее», предложенный приказ
  if ((m = /^(?:спроси|спросите|задай вопрос|вопрос)(?: у)? советник\p{L}*(?: о| об| про)? (.+)$/u.exec(t))) return hit('command.advisor.ask', { text: m[1] });
  if (/^(?:останови|остановить|прерви|прервать|отмени|стоп)(?: советника| советник| ответ советника| варианты| ответ)$/.test(t)) return hit('command.advisor.stop');
  if (/^(?:отправь|отправить|задай|задать)(?: этот| мой)? (?:вопрос|вопрос советнику)$|^отправь советнику$/.test(t)) return hit('command.advisor.send');
  if (/^(?:читай|читать|зачитывай|озвучивай)(?: мне)? ответы советника(?: вслух)?$|^читай ответы вслух$/.test(t)) return hit('command.advisor.voice', { on: true });
  if (/^(?:не читай|не зачитывай|не озвучивай|хватит читать|выключи озвучку)(?: мне)? ответ\p{L}*(?: советника)?$/u.test(t)) return hit('command.advisor.voice', { on: false });
  if (/^(?:подробнее|подробней)(?: ответ| ответ советника)?$/.test(t)) return adviceMore && getAction('command.advisor.more') ? { id: 'command.advisor.more' } : null;
  if ((m = /^(?:возьми|взять|бери|прими)(?: в проект| в распоряжение)? (?:(\S+) )?(?:предложенн\p{L}* )?приказ(?: советника)?(?: (\S+))?$/u.exec(t))) {
    const w = m[1] ?? m[2];
    const n = w ? nth(w) : null;
    if (w && !n && !/^(?:этот|его|предложенн)/.test(w)) return null;
    return hit('command.advisor.take', n ? { n } : {});
  }
  // решение
  // «составь заново оценку обстановки», «составь риски заново советником» — замена поля (с подтверждением);
  // «составь решение советником заново» — всё решение советником (действие реестра)
  if ((m = /^(?:составь|составить|напиши|написать) (.+)$/.exec(t)) && /(?:^| )заново(?: |$)/.test(m[1])) {
    const advisor = /(?:^| )советником(?: |$)/.test(m[1]);
    const tail = m[1].replace(/(?:^| )(?:заново|советником)(?= |$)/g, '').trim();
    const f = fieldOf(tail);
    if (f && !(advisor && /^решени/.test(tail))) return hit('decision.compose.replace', advisor ? { field: f, advisor: true } : { field: f });
  }
  if ((m = /^(?:возьми|взять|бери|перенеси|скопируй)(?: (.+?))? (?:с|из|от) прошлого хода$/.exec(t))) {
    const f = fieldOf(m[1] ?? '');
    if (f === null) return null;
    return hit('decision.fromLast', f ? { field: f } : {});
  }
  if (/^(?:составь|подготовь|набросай|сделай|напиши|заполни)(?: мне)? (?:черновик )?(?:боевого |боевое )?донесени\p{L}*(?: по докладам)?$|^черновик(?: боевого)? донесени\p{L}*$/u.test(t))
    return hit(live?.().decision.report.trim() ? 'decision.draftReport.replace' : 'decision.draftReport'); // продиктованное — спросить
  if (/^(?:что|чего)(?: еще)? не (?:готово|готов|хватает|заполнено|сделано)(?: для хода| к ходу| в решении)?$|^что осталось(?: сделать| заполнить)?$|^готово ли решение$/.test(t)) return hit('decision.missing');
  // приказы: перечень, отмена, указания
  if (/^(?:какие|что за) (?:приказы|распоряжения)(?: отданы| отдал| в проекте| есть)?$|^(?:перечисли|прочитай|зачитай|доложи) (?:приказы|распоряжения)$|^что приказано$/.test(t)) return hit('command.orders.list');
  if ((m = /^(?:отмени|отменить|сними|снять|убери)(?: новый)? приказ(?: для)?(?: (.+))?$/.exec(t))) {
    if (!m[1]) return hit('command.order.cancel', {});
    return v && getAction('command.order.cancel') && found(ownOf(m[1], v)) ? { id: 'command.order.cancel', params: { unit: m[1] } } : null;
  }
  if ((m = /^указани\p{L}*(?: к приказу)? (.+)$/u.exec(t)) && m[1].split(' ').length >= 2) {
    const d = live?.();
    // текст указаний — как сказан (регистр, «ё», знаки): он идёт в приказ, журнал и разбор
    const notes = cap(rawTail(raw, m[1].split(' ').length) ?? m[1]);
    return d && lastUnit && d.drafts[lastUnit] && getAction('command.order') ? { id: 'command.order', params: { unit: lastUnit, notes } } : null;
  }
  // тыл, переправы, резервы, полосы
  if ((m = /^(?:перенеси|перенести|перемести|переместить|передвинь)(?: базу| базы)(?: снабжения)? (.+)$/.exec(t))) {
    if (!v || !getAction('command.rear.base')) return hit('command.rear.base');
    return splitAt(m[1].split(' '), /^(?:в|во|к|ко|на)$/, (a, b) => (found(placeOf(b, v)) && 'found' in baseOf(a, v) ? { id: 'command.rear.base', params: { army: a, place: b } } : null));
  }
  if ((m = /^(?:дай |установи |назначь )?приоритет(?: подвоза| снабжения)?(?: для)? (.+)$/.exec(t))) {
    if (!v || !getAction('command.rear.priority')) return null;
    const names = m[1].split(/ и |, /).map((x) => x.trim()).filter(Boolean);
    return names.every((n) => found(ownOf(n, v))) ? { id: 'command.rear.priority', params: { armies: names } } : null;
  }
  if (/^подвоз поровну$/.test(t)) return hit('command.rear.priority', { armies: [] });
  // отменить распоряжение: переправу, перенос базы, приоритет подвоза, линию
  // хвост («у Зелова», «Костшин», «между … и …») должен называть то, что есть; иначе («с карты») — фраза модели
  if ((m = /^(?:отмени|отменить|убери|сними|не наводи|не наводить)(?: наведение| наводку)? переправ\p{L}*(?: (?:у|в|возле|около|под|на|к) (.+))?$/u.exec(t))) {
    if (m[1] && !(v && placeOf(m[1], v))) return null;
    return hit('command.act.cancel', { kind: 'bridge', ...(m[1] ? { name: m[1] } : {}) });
  }
  if ((m = /^(?:отмени|отменить|убери|сними) (?:перенос базы|перенос|базу)(?: (.+))?$|^не переноси(?:ть)? базу(?: (.+))?$/.exec(t))) {
    const nm = m[1] ?? m[2];
    if (nm && !(v && 'found' in baseOf(nm, v))) return null;
    return hit('command.act.cancel', { kind: 'base', ...(nm ? { name: nm } : {}) });
  }
  if (/^(?:сними|отмени|убери|отменить) приоритет(?: подвоза)?$/.test(t)) return hit('command.act.cancel', { kind: 'priority' });
  if ((m = /^(?:отмени|отменить|убери|сними) (?:разграничительную )?линию(?: (.+))?$/.exec(t))) {
    if (!m[1]) return hit('command.act.cancel', { kind: 'boundary' });
    const pair = /^между (.+)$/.exec(m[1]);
    const armies = v?.armies ?? [];
    const ok = pair && splitAt(pair[1].split(' '), /^и$/, (a, b) => (findUnit(a, armies).unit && findUnit(b, armies).unit ? `${a} и ${b}` : null));
    return ok ? hit('command.act.cancel', { kind: 'boundary', name: ok }) : null;
  }
  if ((m = /^(?:наведи|навести|наводи|построй|построить|поставь|поставить)(?: понтонную| наплавную)? переправ\p{L}*(?: через \p{L}+)?(?: (?:у|в|возле|около|под|на|к|в районе|рядом с) (.+))?$/u.exec(t))) {
    if (!m[1]) return getAction('command.bridge') ? { say: 'Где навести переправу? Скажите, например: «наведи переправу у Кюстрина».' } : hit('command.bridge');
    return hit('command.bridge', { place: m[1] });
  }
  if ((m = /^(?:введи|ввести|вводи|вводим)(?: в бой| в сражение)?(?: резерв\p{L}*)? (.+)$/u.exec(t))) {
    if (!v || !getAction('command.reserve.commit')) return null;
    return splitAt(m[1].split(' '), /^(?:в|у|под|возле|около|к|ко|район\p{L}*)$/u, (a, b) => (found(reserveOf(a, v)) && found(placeOf(b, v)) ? { id: 'command.reserve.commit', params: { army: a, place: b } } : null));
  }
  if ((m = /^(?:не вводи|не вводить|отмени ввод|отменить ввод)(?: резерв\p{L}*)? (.+)$/u.exec(t)))
    return v && getAction('command.reserve.cancel') && found(reserveOf(m[1], v)) ? { id: 'command.reserve.cancel', params: { army: m[1] } } : null;
  if ((m = /^(?:предложи|проведи|наметь|намети|установи)(?: разграничительную)? (?:линию|границу)(?: разграничения)? между (.+)$/.exec(t))) {
    if (!v || !getAction('command.bounds.propose')) return hit('command.bounds.propose');
    const armies = v.armies ?? [];
    return splitAt(m[1].split(' '), /^и$/, (a, b) => (findUnit(a, armies).unit || findUnit(a, armies).options.length) && (findUnit(b, armies).unit || findUnit(b, armies).options.length)
      ? { id: 'command.bounds.propose', params: { army: a, neighbor: b } } : null);
  }
  if (/^(?:в распоряжение|линию в распоряжение|включи линию(?: в распоряжение)?|утверди линию)$/.test(t)) return hit('command.bounds.put');
  // приказ: «<соединению> <задача> [<место | противник>] [обороты: любой ценой, к утру, через …, указания: …]» —
  // соединение должно найтись, иначе фраза модели
  if (QUESTION.test(t) || QUESTION_IN.test(t) || /\?/.test(raw) || !v || !getAction('command.order')) return null; // вопрос — модели
  t = t.replace(/^приказ /, '');
  const ws = t.split(' ');
  if (/^(?:войск|всем$|все$|всех$|частям|армиям|подразделени)/.test(ws[0])) return null; // «войскам наступать» — не Войско Польское
  for (let i = 1; i < ws.length; i++) {
    const k = taskAt(ws, i);
    if (!k) continue;
    const unit = ws.slice(0, i).join(' ');
    if (!found(ownOf(unit, v))) return null;
    const tail = ws.slice(i + k.len);
    if (!tail.length) return { id: 'command.order', params: { unit, task: k.task } };
    const tg = targetOf(tail, v, k.task, raw);
    return { id: 'command.order', params: { unit, task: k.task, [tg.enemy ? 'enemy' : 'place']: tg.text, ...(tg.notes ? { notes: tg.notes } : {}) } };
  }
  return null;
}

/** Ждёт ответа на «Куда?»: только следующая реплика и не позже AWAIT_MS. */
function awaitingFresh(): boolean {
  return !!awaiting && Date.now() <= awaiting.until && voiceTurn() === awaiting.turn + 1;
}

/**
 * Ответ на «Куда?» (разборщик первым): следующая реплика — пункт или противник — дополняет приказ; что-то другое
 * (новая просьба) — «Приказ не отдан», и реплику разбирают дальше как обычно.
 */
export function parseAnswer(rest: string, section: string, raw = rest): PhraseHit | null {
  if (!awaiting) return null;
  const a = awaiting;
  const v = live?.().view ?? null;
  const t = norm(rest);
  if (section === 'replay' && awaitingFresh() && v && getAction('command.order') && !QUESTION.test(t)) {
    const tg = targetOf(t.split(' '), v, a.task, raw);
    if (tg.found) {
      const notes = [a.note, tg.notes].filter(Boolean).join('; ');
      return { id: 'command.order', params: { unit: a.unit, task: a.task, [tg.enemy ? 'enemy' : 'place']: tg.text, ...(notes ? { notes } : {}) } };
    }
  }
  // новая просьба сразу после вопроса — приказ не отдан (сказать сейчас, до ответа на просьбу); прочее снимет turnDone
  if (awaitingFresh()) { awaiting = null; speak(`Приказ не отдан: ${speakable(a.name, { full: true })}.`); }
  return null;
}

/**
 * Реплика разобрана, а вопрос «Куда?» к ней остался (диктовка, «а можешь…», модель — мимо разбора фраз): ожидание
 * снимается сразу — «Приказ не отдан»; истекло — молча. Переспрос («повтори», «подожди») реплики не меняет — вопрос ждёт.
 */
onTurnDone(() => {
  const a = awaiting;
  if (!a || a.turn >= voiceTurn()) return;
  awaiting = null;
  if (Date.now() <= a.until) speak(`Приказ не отдан: ${speakable(a.name, { full: true })}.`);
});

const LEAD = /^(?:в направлении|в сторону|по направлению (?:к|на)|в район|в районе|на|к|ко|до|против)$/;

/**
 * Цель приказа из слов после задачи: начала «в направлении», «на», «к» снимаются; «через …», «указания …» и
 * неразобранный хвост — в указания (как сказаны, из raw); цель — самое длинное начало, которое нашлось (пункт или
 * противник). Не нашлось — text целиком (штаб честно скажет «не нашёл» и спросит «Куда?»).
 */
function targetOf(words: string[], v: TurnView, task: Task, raw: string): { text: string; enemy: boolean; notes?: string; found: boolean } {
  let ws = words.filter(Boolean);
  for (let n = 3; n >= 1; n--) if (ws.length > n && LEAD.test(ws.slice(0, n).join(' '))) { ws = ws.slice(n); break; }
  let cut = ws.findIndex((w, i) => i > 0 && (w === 'через' || /^указани/.test(w)));
  if (cut < 0) cut = ws.length;
  let hit: { k: number; enemy: boolean } | null = null;
  for (let k = cut; k >= 1 && !hit; k--) {
    const cand = ws.slice(0, k).join(' ');
    const enemy = UNIT_WORD.test(cand) && found(enemyOf(cand, v));
    const pl = placeOf(cand, v);
    if (enemy && !(pl && 'found' in pl)) hit = { k, enemy: true };
    else if (pl) hit = { k, enemy: false };
  }
  if (!hit) return { text: ws.slice(0, cut).join(' '), enemy: false, found: false, notes: notesOf(ws.slice(cut), raw, task) };
  return { text: ws.slice(0, hit.k).join(' '), enemy: hit.enemy, found: true, notes: notesOf(ws.slice(hit.k), raw, task) };
}
/** Хвост фразы — указания, как сказаны: «через Зелов», «к утру», «обойти с севера» (слово «указания» снимается). */
function notesOf(rest: string[], raw: string, task: Task): string | undefined {
  let ws = rest;
  if (task === 'hold' && ws.join(' ') === 'любой ценой') ws = []; // это и есть задача
  if (!ws.length) return undefined;
  const text = (rawTail(raw, ws.length) ?? ws.join(' ')).replace(/^указани\p{L}*\s*:?\s*/iu, '').replace(/,?\s*указани\p{L}*\s*:?\s*/iu, '; ').trim();
  return text ? cap(text) : undefined;
}

registerParser(parseAnswer, { first: true });
registerParser(parseStaff);
