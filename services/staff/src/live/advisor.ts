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
import { checkEvents, profileOf, type GameState, type History, type Order, type SimContext } from '@def-ops/sim';
import { LlmClient, type ChatMessage, type ChatResult } from '../llm/client';
import type { Thinking } from '../llm/config';
import { StringFieldStream } from '../stream-json';
import { TASKS, type Issue, type Order as StaffOrder } from '../decision';
import { fill } from '../fill';
import { decisionToOrders } from './apply';
import { momentRu, rearText, situationParts } from './situation';

export interface AdvisorConfig { side: string; sideName: string; profile: string; role: string; anchor: string; anchorName: string }

/**
 * Дерево тем советника: категория → подкатегория → вопросы. Узел dyn раскрывается по обстановке
 * (свои объединения, фронты, обнаруженный противник, резервы): вопрос — template с {name}.
 */
export type AdviceDyn = 'own' | 'group' | 'enemy' | 'reserve';
export interface AdviceNode { id: string; title: string; hint?: string; children?: AdviceNode[]; questions?: string[]; dyn?: AdviceDyn; template?: string }

const N = (id: string, title: string, questions: string[], hint?: string): AdviceNode => ({ id, title, questions, hint });
const D = (id: string, title: string, dyn: AdviceDyn, template: string, hint?: string): AdviceNode => ({ id, title, dyn, template, hint });

export const ADVICE_TREE: AdviceNode[] = [
  { id: 'situation', title: 'Обстановка', hint: 'оценка, фронты, армии, угрозы, местность', children: [
    N('general', 'Общая оценка', ['Оцени обстановку на утро: главное за сутки', 'Где сейчас наши главные проблемы?', 'Что изменилось за сутки?', 'Каково соотношение сил на главном направлении?', 'Идём ли мы к цели операции в срок?']),
    D('fronts', 'По фронтам', 'group', 'Доложи обстановку в полосе: {name} — успехи, проблемы, угрозы, что предпринять'),
    D('armies', 'По армиям', 'own', 'Доложи состояние: {name} — положение, силы, снабжение, угрозы; что ей приказать?'),
    N('threats', 'Угрозы и риски', ['Где противник может нас остановить?', 'Какие наши фланги открыты?', 'Каким армиям грозит окружение?', 'Где мы растянулись слишком сильно?']),
    N('terrain', 'Местность', ['Какие рубежи и реки впереди на главном направлении?', 'Где местность благоприятна для танковых армий?', 'Где придётся вести бой в городе или в лесу?']),
  ] },
  { id: 'enemy', title: 'Противник', hint: 'замысел, контрудары, слабые места, соединения', children: [
    N('intent', 'Замысел', ['Каков вероятный замысел противника?', 'Будет противник отходить или держаться?', 'Куда противник отводит войска?']),
    N('counter', 'Контрудары', ['Где противник может нанести контрудар?', 'Какие подвижные резервы есть у противника?', 'Как парировать возможный контрудар?']),
    N('weak', 'Слабые места', ['Где у противника слабые места?', 'Где стык между его группировками?', 'Какие его соединения обескровлены?']),
    D('units', 'По соединениям', 'enemy', 'Что известно о противнике: {name} — силы, задача, чего от него ждать?'),
    N('unknown', 'Чего мы не знаем', ['Что о противнике нам неизвестно и где он может скрывать силы?', 'Где наша разведка не видит противника, а он может быть?']),
  ] },
  { id: 'plan', title: 'Решение', hint: 'замысел, наступление, окружение, оборона, задачи армиям', children: [
    N('day', 'Замысел на сутки', ['Предложи решение на сутки с приказами армиям', 'Оцени мой проект решения: что упущено?', 'Где наносить главный удар и почему?', 'Какие варианты действий у нас есть?']),
    N('attack', 'Наступление', ['Как быстрее выйти к цели операции?', 'Где ввести танковые армии в прорыв?', 'Как прорвать укреплённую полосу?', 'Обходить узлы обороны или штурмовать?']),
    N('encircle', 'Окружение', ['Как окружить группировку противника перед нами?', 'Как замкнуть кольцо окружения?', 'Как не дать окружённым прорваться?']),
    N('defence', 'Оборона и фланги', ['Где перейти к обороне?', 'Чем прикрыть фланги ударной группировки?']),
    N('regroup', 'Перегруппировка', ['Какие армии перегруппировать и куда?', 'Кого вывести во второй эшелон?']),
    D('tasks', 'Задача армии', 'own', 'Какую задачу поставить на сутки: {name}?'),
  ] },
  { id: 'rear', title: 'Тыл и подвоз', hint: 'подвоз, базы, приоритет, боеприпасы, горючее', children: [
    N('flow', 'Подвоз', ['Каким армиям не хватает подвоза и почему?', 'Почему армии отрезаны от подвоза?', 'Что будет, если наступать без подвоза?']),
    N('bases', 'Базы снабжения', ['Куда перенести базы снабжения?', 'Какую базу переносить первой?', 'Сколько займёт перенос базы и чем это грозит?']),
    N('priority', 'Приоритет подвоза', ['Кому дать приоритет подвоза?', 'Снимать ли приоритет с армий, которые остановились?']),
    N('stocks', 'Боеприпасы и горючее', ['У кого на исходе боеприпасы?', 'Какие танковые армии остановятся без горючего?']),
    D('armies', 'По армиям', 'own', 'Как обстоит снабжение: {name} — и что сделать?'),
  ] },
  { id: 'engineering', title: 'Переправы', hint: 'где наводить, сроки, подвоз через реки', children: [
    N('where', 'Где наводить', ['Где нужны переправы в ближайшие сутки?', 'Какие армии упрутся в реки?', 'Через какие реки предстоит переправа на главном направлении?']),
    N('build', 'Наводка', ['Сколько займёт наводка и чем её прикрыть?', 'Хватит ли понтонных парков?']),
    N('supply', 'Подвоз через реки', ['Каким армиям мешает отсутствие переправы для подвоза?']),
  ] },
  { id: 'reserves', title: 'Резервы', hint: 'резервы Ставки, второй эшелон', children: [
    N('stavka', 'Резервы Ставки', ['Когда и куда ввести резервы Ставки?', 'Ввести резерв сейчас или придержать?']),
    D('units', 'По резервам', 'reserve', 'Куда и когда ввести: {name}?'),
    N('echelon', 'Второй эшелон', ['Какие армии вывести во второй эшелон?', 'Кого сменить свежими войсками?']),
  ] },
  { id: 'rules', title: 'Правила арбитра', hint: 'бой, движение, подвоз, приказы, разведка, победа', children: [
    N('combat', 'Бой', ['Как считается исход боя?', 'Что даёт подготовленная оборона противника?', 'Как влияют местность и город?', 'Когда засчитывается прорыв?']),
    N('move', 'Движение', ['Как быстро движутся войска по дорогам и вне их?', 'Почему армия может не продвинуться?', 'Как территория противника влияет на темп?']),
    N('supply', 'Подвоз и окружение', ['Почему армия может оказаться отрезанной?', 'Как работает подвоз от баз?']),
    N('orders', 'Приказы', ['Сколько идёт приказ до войск и что это значит для планирования?', 'Что делают войска без нового приказа?']),
    N('intel', 'Разведка', ['Как далеко мы видим противника?']),
    N('end', 'Победа и поражение', ['Каковы условия победы и поражения?']),
  ] },
  { id: 'history', title: 'История', hint: 'ход событий, сравнение, решения командования', children: [
    N('course', 'Ход событий', ['Как развивались события в эти дни в истории?', 'Что в истории происходило в следующие сутки?']),
    N('compare', 'Сравнение с игрой', ['Чем наша игра расходится с историей?', 'Где мы опережаем историю, а где отстаём?']),
    N('command', 'Решения командования', ['Какие решения принимало советское командование в эти дни?', 'С какими трудностями оно столкнулось?', 'Как действовало немецкое командование в эти дни?']),
  ] },
];

/** Категории верхнего уровня (для подписи в промпте). */
export const ADVICE_CATEGORIES = ADVICE_TREE.map((c) => ({ id: c.id, title: c.title }));

export interface AdviceSuggestion { formation: string; task: StaffOrder['task']; area: string; toArea: string | null; why: string }
export const ADVICE_BASIS = ['доклады', 'разведка', 'правила', 'история', 'база знаний', 'общие знания'] as const;
export interface Advice { answer: string; basis: string[]; unknowns: string[]; suggestions: AdviceSuggestion[]; followUps: string[] }

const str = { type: 'string' };
export const ADVICE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['answer', 'basis', 'unknowns', 'suggestions', 'followUps'],
  properties: {
    answer: str,
    basis: { type: 'array', items: { type: 'string', enum: [...ADVICE_BASIS] } },
    unknowns: { type: 'array', items: str },
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

/**
 * Соединения противника, которых штаб сейчас не видит (нет в разведсводке): их названия
 * в ответе советника — утечка (из памяти модели об истории) или выдумка.
 */
export function hiddenEnemies(_ctx: SimContext, g: GameState, side: string, seen: string[]): { id: string; name: string; keys: string[] }[] {
  // штабы объединений противника (армии, группы армий) — общеизвестная структура, не данные разведки: не считаются скрытыми
  const vis = new Set(seen);
  return g.state.formations.filter((f) => f.side !== side && !vis.has(f.id)).map((f) => ({ id: f.id, name: f.name, keys: nameKeys(f.name) })).filter((x) => x.keys.length);
}

/**
 * Признаки названия для поиска в тексте: полное название без скобок; название в кавычках — только в
 * кавычках («Мюнхеберг» — дивизия, Мюнхеберг без кавычек — город); оригинал в скобках.
 */
function nameKeys(name: string): string[] {
  const low = (x: string) => x.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
  const keys = new Set<string>();
  const plain = low(name.replace(/\(.*?\)/g, ''));
  if (plain.length >= 8) keys.add(plain);
  for (const m of name.matchAll(/«([^»]{4,})»/g)) keys.add(`«${low(m[1])}»`);
  // оригинал в скобках — только собственное имя латиницей («Festung Stettin»), а не пояснение («гарнизон»)
  for (const m of name.matchAll(/\(([^()]{5,})\)/g)) if (/[a-z]/i.test(m[1])) keys.add(low(m[1]));
  return [...keys];
}

/** Название упомянуто в тексте по основным словам («12-й армии» ≈ «12-я армия»). */
function nameMentioned(text: string, name: string): boolean {
  const st = (x: string) => x.toLowerCase().replace(/ё/g, 'е').replace(/\(.*?\)/g, '').split(/[^a-zа-я0-9]+/).filter((w) => w.length > 2 || /\d/.test(w)).map((w) => (/^\d/.test(w) ? w.replace(/\D.*$/, '') : w.slice(0, 5)));
  const t = new Set(st(text)), n = st(name);
  return n.length > 0 && n.every((w) => t.has(w));
}

/** Какие скрытые соединения противника упомянуты в тексте (кавычки "…" приравниваются к «…»). */
export function leakedNames(text: string, hidden: { name: string; keys: string[] }[]): string[] {
  const t = text.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').replace(/["“„]([^"”]{4,}?)["”]/g, '«$1»');
  return hidden.filter((h) => h.keys.some((k) => t.includes(k))).map((h) => h.name);
}

export interface AdviceRequest {
  category: string;
  /** Путь по дереву тем словами: «Решение › Наступление». */
  topic?: string;
  question: string;
  /** Проект решения командующего (оценка, замысел, приказы, распоряжения) — словами. */
  draft: string;
  /** Цель операции словами. */
  goal: string;
  /** Предыдущие вопросы и ответы этой беседы (последние). */
  thread: { q: string; a: string }[];
  /** Справка из базы знаний (доктрина, техника, местность; в вопросах истории — и ход боёв). */
  reference?: string;
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
    reference: req.reference?.trim() ? `\nСправка из базы знаний (общие сведения, не обстановка; положение и силы противника из неё не выводить):\n${req.reference.trim()}\n` : '',
    category: req.topic || cat.title, question: req.question,
  }, 'advisor.user.md');
  const messages: ChatMessage[] = [{ role: 'system', content: system }];
  for (const t of req.thread.slice(-3)) messages.push({ role: 'user', content: t.q }, { role: 'assistant', content: JSON.stringify({ answer: t.a, basis: [], unknowns: [], suggestions: [], followUps: [] }) });
  messages.push({ role: 'user', content: user });
  // соединения, названные самим командующим, можно упоминать («сведений о нём нет»); положение и силы — всё равно нельзя (их нет в сведениях)
  const asked = [req.question, ...req.thread.map((t) => t.q)].join('\n');
  const hidden = hiddenEnemies(ctx, g, cfg.side, p.enemies.map((e) => e.id)).filter((h) => !leakedNames(asked, [h]).length && !nameMentioned(asked, h.name));
  return { messages, parts: p, category: cat.id, hidden };
}

export interface AdviceResult {
  ok: boolean;
  error?: string;
  answer: string;
  basis: string[];
  unknowns: string[];
  /** Предупреждение: ответ упоминает сведения, которых у штаба нет (после попытки переписать). */
  warning?: string;
  /** Ответ переписан по требованию проверки. */
  rewritten?: boolean;
  /** Предложенные приказы, сопоставленные с обстановкой (order — готовый приказ арбитру; null — не опознан). */
  suggestions: { given: AdviceSuggestion; order: Order | null; target: string | null; issue?: string }[];
  followUps: string[];
  issues: Issue[];
  timings?: ChatResult['timings'];
}

export async function advise(client: LlmClient, g: GameState, built: ReturnType<typeof buildAdvice>,
  opts: { thinking?: Thinking; signal?: AbortSignal; onAnswer?: (delta: string) => void } = {}): Promise<AdviceResult> {
  const empty = { answer: '', basis: [], unknowns: [], suggestions: [], followUps: [], issues: [] };
  const stream = new StringFieldStream('answer', (d) => opts.onAnswer?.(d));
  const ask = (messages: ChatMessage[], onDelta?: (k: 'reasoning' | 'content', t: string) => void) =>
    client.chat({ messages, schema: { name: 'staff_advice', schema: ADVICE_SCHEMA }, thinking: opts.thinking, signal: opts.signal, onDelta });
  let res: ChatResult;
  try {
    res = await ask(built.messages, (k, t) => { if (k === 'content') stream.push(t); });
  } catch (e) {
    return { ok: false, error: (e as Error).message, ...empty };
  }
  let a = res.json as Partial<Advice> | undefined;
  if (!a || typeof a.answer !== 'string') {
    // не по схеме — показать как есть, без предложений (но с той же проверкой на скрытые сведения)
    const text = res.content.trim() || res.reasoning.trim();
    const leak = built.category === 'history' ? [] : leakedNames(text, built.hidden);
    return { ok: !!text, error: text ? undefined : res.jsonError ?? 'пустой ответ', ...empty, answer: text, timings: res.timings,
      ...(leak.length ? { warning: `упомянуты соединения противника, которых нет в разведсводке: ${leak.join(', ')} — это не данные разведки` } : {}) };
  }
  // проверка: скрытые от штаба соединения противника в ответе (кроме вопросов истории) — одна просьба переписать
  const textOf = (x: Partial<Advice>) => [x.answer, ...(x.unknowns ?? []), ...(x.suggestions ?? []).map((y) => `${y.area} ${y.toArea ?? ''} ${y.why}`)].join('\n');
  let leak = built.category === 'history' ? [] : leakedNames(textOf(a), built.hidden);
  let rewritten = false;
  if (leak.length) {
    try {
      const fix = await ask([...built.messages, { role: 'assistant', content: JSON.stringify(a) }, { role: 'user', content:
        `В ответе есть сведения о соединениях противника, которых нет в разведсводке: ${leak.join(', ')}. Штаб о них ничего не знает — это память об истории или выдумка. `
        + 'Перепиши ответ: о противнике — только по разведсводке; о скрытом — «сведений нет» или предположение по признакам из обстановки, без названий, положения и сил. Остальное не меняй.' }]);
      const b = fix.json as Partial<Advice> | undefined;
      if (b && typeof b.answer === 'string') { a = b; rewritten = true; leak = leakedNames(textOf(b), built.hidden); }
    } catch { /* остаётся исходный ответ с предупреждением */ }
  }
  const sugg = Array.isArray(a.suggestions) ? a.suggestions : [];
  const sit = { messages: [], formations: built.parts.formations.filter((f) => built.parts.own.find((u) => u.id === f.id)!.status !== 'destroyed'), areas: built.parts.areas, enemies: built.parts.enemies, time: g.state.time };
  const conv = decisionToOrders({ orders: sugg.map((x) => ({ formation: x.formation, task: x.task, area: x.area, toArea: x.toArea, deadline: '', details: x.why })) }, sit, 'human');
  return {
    ok: true, answer: a.answer!, basis: Array.isArray(a.basis) ? a.basis : [], unknowns: Array.isArray(a.unknowns) ? a.unknowns : [],
    followUps: Array.isArray(a.followUps) ? a.followUps.slice(0, 4) : [], issues: conv.issues, timings: res.timings, rewritten,
    ...(leak.length ? { warning: `упомянуты соединения противника, которых нет в разведсводке: ${leak.join(', ')} — это не данные разведки` } : {}),
    suggestions: conv.applied.map((x, i) => ({ given: sugg[i], order: x.order, target: x.target, issue: x.issue })),
  };
}
