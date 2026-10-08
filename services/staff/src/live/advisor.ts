/**
 * ИИ-советник в штабе человека. Командующий выбирает категорию и готовый вопрос
 * или пишет свой; советник видит то же, что командующий (свои доклады,
 * разведсводку в тумане войны, тыл, проект решения на ход), и точные правила
 * арбитра. Отвечает текстом, может предложить приказы войскам (в той же форме,
 * что и штаб модели, — они сопоставляются со списками обстановки и включаются в
 * распоряжение только по нажатию командующего) и следующие вопросы.
 *
 * Свободный текст командующего идёт только советнику; арбитр получает лишь
 * приказы в строгой форме (формирование, задача, цель).
 */
import { checkEvents, onMap, profileOf, type GameState, type History, type Order, type SimContext } from '@def-ops/sim';
import { LlmClient, type ChatMessage, type ChatResult } from '../llm/client';
import type { Thinking } from '../llm/config';
import { StringFieldStream } from '../stream-json';
import { TASKS, type Issue, type Order as StaffOrder } from '../decision';
import { fill } from '../fill';
import { decisionToOrders } from './apply';
import { momentRu, situationParts } from './situation';

export interface AdvisorConfig { side: string; sideName: string; profile: string; role: string; anchor: string; anchorName: string }

export const ADVICE_CATEGORIES: { id: string; title: string; presets: string[] }[] = [
  { id: 'situation', title: 'Обстановка', presets: ['Оцени обстановку на утро: главное за сутки', 'Где сейчас наши главные проблемы?', 'Какие армии требуют внимания в первую очередь?'] },
  { id: 'enemy', title: 'Противник', presets: ['Каков вероятный замысел противника?', 'Где противник может нанести контрудар?', 'Где у противника слабые места?'] },
  { id: 'plan', title: 'Решение', presets: ['Предложи решение на сутки с приказами армиям', 'Как быстрее выйти к цели операции?', 'Как окружить группировку противника перед нами?', 'Оцени мой проект решения: что упущено?'] },
  { id: 'rear', title: 'Тыл и подвоз', presets: ['Каким армиям не хватает подвоза и почему?', 'Куда перенести базы снабжения?', 'Кому дать приоритет подвоза?'] },
  { id: 'engineering', title: 'Переправы', presets: ['Где нужны переправы в ближайшие сутки?', 'Какие армии упрутся в реки?'] },
  { id: 'reserves', title: 'Резервы', presets: ['Когда и куда ввести резервы Ставки?', 'Какие армии вывести во второй эшелон?'] },
  { id: 'rules', title: 'Правила арбитра', presets: ['Как считается исход боя?', 'Почему армия может оказаться отрезанной?', 'Сколько идёт приказ до войск и что это значит для планирования?', 'Что даёт подготовленная оборона противника?'] },
  { id: 'history', title: 'История', presets: ['Как развивались события в эти дни в истории?', 'Чем наша игра расходится с историей?'] },
];

export interface AdviceSuggestion { formation: string; task: StaffOrder['task']; area: string; toArea: string | null; why: string }
export interface Advice { answer: string; suggestions: AdviceSuggestion[]; followUps: string[] }

const str = { type: 'string' };
export const ADVICE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['answer', 'suggestions', 'followUps'],
  properties: {
    answer: str,
    suggestions: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['formation', 'task', 'area', 'toArea', 'why'],
        properties: { formation: str, task: { type: 'string', enum: [...TASKS] }, area: str, toArea: { type: ['string', 'null'] }, why: str },
      },
    },
    followUps: { type: 'array', items: str },
  },
} as const;

/** Правила арбитра словами — из чисел правил и профиля стороны (а не по памяти модели). */
export function rulesBrief(ctx: SimContext, side: string): string {
  const R = ctx.rules, P = profileOf(ctx, side);
  const adv = R.advance.map(([r, v]) => `${r}:1 → ${v.toFixed(1).replace('.', ',')} км/сут`).join('; ');
  const delays = Object.entries(P.orderDelayHours).map(([e, h]) => `${e === 'army' ? 'армии' : e === 'corps' ? 'корпуса' : e === 'division' ? 'дивизии' : e === 'front' ? 'фронты' : e} — ${h} ч`).join(', ');
  const terr = Object.entries(R.defense.terrain).filter(([, v]) => v !== 1).map(([k, v]) => `${({ forest: 'лес', marsh: 'болото', urban: 'город', hills: 'высоты' } as Record<string, string>)[k] ?? k} ×${v.toFixed(2).replace('.', ',')}`).join(', ');
  const sp = P.supply;
  return [
    `- Ход — ${ctx.scenario.turnHours} ч. Приказ доходит до войск с задержкой: ${delays}. Пока не дошёл — войска выполняют прежнюю задачу.`,
    `- Бой: наступающие в соприкосновении (ближе ${R.contactKm} км) против обороняющихся. Соотношение сил — по численности, танкам, орудиям с учётом качества войск; оборона усиливается местностью (${terr}), подготовленной обороной (×${R.defense.prepared.toFixed(2).replace('.', ',')} после ${R.defense.prepareHours} ч на месте) и укреплёнными полосами (+${Math.round(R.defense.fortificationPerLevel * 100)} % за уровень); случайный разброс ±${Math.round(R.noise * 100)} %.`,
    `- Продвижение в сутки по соотношению сил: ${adv}. От 10 км/сут — прорыв, обороняющийся отходит; в городе, лесу, болоте — медленнее; укреплённую полосу «прогрызают» не быстрее предельного темпа.`,
    `- Боеприпасов меньше 0,5 бк — сила ×${R.ammoShort}; без горючего техника ×${R.fuelOut} и не движется. Усталость растёт в бою (+${Math.round(R.fatigueGain.combat * 100)} %/сут) и на марше, снижает силу (до −${Math.round(R.fatigueEffect * 100)} %), спадает на отдыхе.`,
    sp ? `- Подвоз: от баз снабжения только по своей территории; дальше ${sp.rangeHours} ч пути — не доходит. Пополнение в сутки: ${sp.ammoPerDay} бк, ${sp.fuelPerDay} запр. (до ${sp.maxAmmo} бк, ${sp.maxFuel} запр.). Без подвоза ${R.encircleHours ?? 36} ч подряд — формирование окружено (отрезано).` : '',
    R.territory ? `- Территория переходит к стороне только там, где прошли её войска (полоса ${R.territory.radiusKm} км); по чужой территории движение медленнее (заслоны, зачистка).` : '',
    `- Большую реку без моста техника не преодолевает (пехота — с задержкой ${R.riverCrossHours} ч); подвоз через реку — только по переправам.`,
    `- Противник виден в пределах разведки наших войск; дальше — неизвестно.`,
  ].filter(Boolean).join('\n');
}

/** Тыл, переправы, резервы стороны — словами, для советника. */
function rearText(ctx: SimContext, g: GameState, side: string): string {
  const s = g.state, T = ctx.theatre;
  const lg = s.logistics?.[side];
  const out: string[] = [];
  if (lg) {
    out.push(`- Базы снабжения: ${lg.bases.map((b) => `${b.name}${b.activeFrom && b.activeFrom > s.time ? ` (переносится до ${b.activeFrom.slice(8, 10)}.${b.activeFrom.slice(5, 7)})` : ''}`).join('; ')}.`);
    if (lg.priority.length) out.push(`- Приоритет подвоза: ${lg.priority.map((id) => s.formations.find((f) => f.id === id)?.name).join(', ')}.`);
  }
  const building = T.data.bridges.filter((b) => b.side === side && b.openFrom && b.openFrom > s.time);
  if (building.length) out.push(`- Наводятся переправы: ${building.map((b) => b.name).join('; ')}.`);
  const res = s.formations.filter((f) => f.side === side && f.reserveFrom);
  if (res.length) out.push(`- Резервы Ставки, не введённые в сражение: ${res.map((f) => `${f.name} (готов с ${f.reserveFrom!.slice(8, 10)}.${f.reserveFrom!.slice(5, 7)})`).join('; ')}.`);
  const coming = s.formations.filter((f) => f.side === side && !f.reserveFrom && f.enterAt && f.enterAt > s.time && !onMap(f, s.time));
  if (coming.length) out.push(`- Вводятся в сражение: ${coming.map((f) => f.name).join('; ')}.`);
  return out.length ? out.join('\n') : '- Особых распоряжений нет.';
}

export interface AdviceRequest {
  category: string;
  question: string;
  /** Проект решения командующего (оценка, замысел, приказы, распоряжения) — словами. */
  draft: string;
  /** Цель операции словами. */
  goal: string;
  /** Предыдущие вопросы и ответы этой беседы (последние). */
  thread: { q: string; a: string }[];
}

export function buildAdvice(ctx: SimContext, g: GameState, history: History, cfg: AdvisorConfig, tpl: { system: string; user: string; profile: string }, req: AdviceRequest, scenarioDescription: string) {
  const p = situationParts(ctx, g, cfg);
  const cat = ADVICE_CATEGORIES.find((c) => c.id === req.category) ?? ADVICE_CATEGORIES[0];
  let historyText = '';
  if (cat.id === 'history') {
    const got = new Map(checkEvents(ctx, { final: g.state, snapshots: g.snapshots }, history).map((r) => [r.id, r]));
    historyText = '\nКонтрольные события операции — в истории и в нашей игре:\n' + (history.events ?? []).map((e) => {
      const r = got.get(e.id);
      return `- ${e.title}: в истории ${e.date.slice(8, 10)}.${e.date.slice(5, 7)}; в игре — ${r?.simulated ? `${r.simulated.slice(8, 10)}.${r.simulated.slice(5, 7)}` : 'ещё нет'}`;
    }).join('\n') + '\n';
  }
  const system = fill(tpl.system, { side: cfg.sideName, scenario: scenarioDescription, role: cfg.role, profile: tpl.profile.trim(), rules: rulesBrief(ctx, cfg.side) }, 'advisor.system.md');
  const user = fill(tpl.user, {
    moment: momentRu(g.state.time), turn: String(g.state.turn + 1), goal: req.goal,
    ...p.vars, rear: rearText(ctx, g, cfg.side), draft: req.draft.trim() || '- пока ничего', history: historyText,
    category: cat.title, question: req.question,
  }, 'advisor.user.md');
  const messages: ChatMessage[] = [{ role: 'system', content: system }];
  for (const t of req.thread.slice(-3)) messages.push({ role: 'user', content: t.q }, { role: 'assistant', content: JSON.stringify({ answer: t.a, suggestions: [], followUps: [] }) });
  messages.push({ role: 'user', content: user });
  return { messages, parts: p };
}

export interface AdviceResult {
  ok: boolean;
  error?: string;
  answer: string;
  /** Предложенные приказы, сопоставленные с обстановкой (order — готовый приказ арбитру; null — не опознан). */
  suggestions: { given: AdviceSuggestion; order: Order | null; target: string | null; issue?: string }[];
  followUps: string[];
  issues: Issue[];
  timings?: ChatResult['timings'];
}

export async function advise(client: LlmClient, g: GameState, built: ReturnType<typeof buildAdvice>,
  opts: { thinking?: Thinking; signal?: AbortSignal; onAnswer?: (delta: string) => void } = {}): Promise<AdviceResult> {
  const stream = new StringFieldStream('answer', (d) => opts.onAnswer?.(d));
  let res: ChatResult;
  try {
    res = await client.chat({ messages: built.messages, schema: { name: 'staff_advice', schema: ADVICE_SCHEMA }, thinking: opts.thinking, signal: opts.signal, onDelta: (k, t) => { if (k === 'content') stream.push(t); } });
  } catch (e) {
    return { ok: false, error: (e as Error).message, answer: '', suggestions: [], followUps: [], issues: [] };
  }
  const a = res.json as Partial<Advice> | undefined;
  if (!a || typeof a.answer !== 'string') {
    // не по схеме — показать как есть, без предложений
    const text = res.content.trim() || res.reasoning.trim();
    return { ok: !!text, error: text ? undefined : res.jsonError ?? 'пустой ответ', answer: text, suggestions: [], followUps: [], issues: [], timings: res.timings };
  }
  const sugg = Array.isArray(a.suggestions) ? a.suggestions : [];
  const sit = { messages: [], formations: built.parts.formations.filter((f) => built.parts.own.find((u) => u.id === f.id)!.status !== 'destroyed'), areas: built.parts.areas, enemies: built.parts.enemies, time: g.state.time };
  const conv = decisionToOrders({ orders: sugg.map((x) => ({ formation: x.formation, task: x.task, area: x.area, toArea: x.toArea, deadline: '', details: x.why })) }, sit, 'human');
  return {
    ok: true, answer: a.answer, followUps: Array.isArray(a.followUps) ? a.followUps.slice(0, 4) : [], issues: conv.issues, timings: res.timings,
    suggestions: conv.applied.map((x, i) => ({ given: sugg[i], order: x.order, target: x.target, issue: x.issue })),
  };
}
