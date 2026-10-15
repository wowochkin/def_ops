/**
 * Исправление приказов по подсказке: если в решении (штаба модели или вариантах советника) есть приказы, которые не
 * исполнить, — формирования нет среди своих сил, цель не опознана, у задачи нет цели, — модели один раз отправляется
 * список ошибок по приказам, точный список своих сил и пунктов поблизости, у кого уже есть приказы, с просьбой
 * вернуть исправленные приказы только для отброшенных. Исправленный приказ заменяет отброшенный, только если ответ
 * называет номер отброшенного приказа, задача та же, приказ исполним сам по себе и его формированию ещё не отдан
 * другой приказ; иначе остаётся исходный с прежним замечанием и пометкой, почему исправление отклонено. Не больше
 * одного такого запроса на решение (на все варианты советника — один общий).
 */
import { LlmClient, type ChatMessage } from '../llm/client';
import { findName, TASK_RU, type Order as StaffOrder } from '../decision';
import type { AppliedOrder } from './apply';
import type { Situation } from './situation';

/** Отброшенный приказ: номер в решении (с 1) и почему не исполнен. */
export interface FailedOrder { n: number; formation: string; task: StaffOrder['task']; issue: string }

/** Почему исправление приказа n отклонено. */
export interface RepairNote { n: number; text: string }

/** Итог исправления: сколько приказов было отброшено и сколько исправлено; error — запрос не удался или не разобран. */
export interface RepairInfo { failed: number; fixed: number; error?: string; notes?: RepairNote[] }

/** Решение (или вариант) для исправления: его приказы, отброшенные из них и формирования, у которых приказ уже есть. */
export interface RepairGroup<T> {
  orders: T[];
  failed: FailedOrder[];
  /** id формирования → название: у них уже есть исполнимый приказ. */
  taken: Map<string, string>;
  /** Название варианта (для подсказки по вариантам). */
  title?: string;
}

/** Отброшенные приказы решения (по сопоставлению с обстановкой). */
export function failedOrders(given: readonly object[], applied: AppliedOrder[]): FailedOrder[] {
  const out: FailedOrder[] = [];
  for (const a of applied) {
    if (a.order) continue;
    const n = given.indexOf(a.given) + 1;
    if (n > 0 && !out.some((f) => f.n === n)) out.push({ n, formation: a.given.formation ?? '', task: a.given.task, issue: a.issue ?? 'не исполнен' });
  }
  return out.sort((a, b) => a.n - b.n);
}

/** Своё формирование, названное в приказе (null — не опознано или приказ «всем»). */
export function ownFormation(name: string, sit: Pick<Situation, 'formations'>): { id: string; name: string } | null {
  const i = findName(name ?? '', sit.formations.map((f) => f.name));
  return i >= 0 ? sit.formations[i] : null;
}

/** Формирования, которым в решении уже отдан исполнимый приказ по имени. */
export function takenFormations(applied: AppliedOrder[], sit: Pick<Situation, 'formations'>): Map<string, string> {
  const out = new Map<string, string>();
  for (const a of applied) {
    if (!a.order) continue;
    const f = ownFormation(a.given.formation, sit);
    if (f) out.set(f.id, f.name);
  }
  return out;
}

const LIMIT = { formations: 80, areas: 60, enemies: 30 };
const list = (xs: string[], max: number) => xs.slice(0, max).map((x) => `- ${x}`).join('\n') + (xs.length > max ? `\n- … и ещё ${xs.length - max}` : '');
const failures = (g: Pick<RepairGroup<unknown>, 'failed' | 'taken'>, pad = '') => [
  ...g.failed.map((f) => `${pad}- приказ ${f.n} («${f.formation}», ${TASK_RU[f.task] ?? f.task}): ${f.issue}`),
  ...(g.taken.size ? [`${pad}уже есть приказы: ${[...g.taken.values()].join('; ')} — их не повторяйте`] : []),
];

/**
 * Текст подсказки: ошибки по приказам и у кого уже есть приказы, свои силы и пункты поблизости, формат ответа.
 * variants — по вариантам советника (каждый — со своим номером v).
 */
export function repairHint(groups: Pick<RepairGroup<unknown>, 'failed' | 'taken' | 'title'>[], sit: Pick<Situation, 'formations' | 'areas' | 'enemies'>, fields: string, variants = false): string {
  const total = groups.reduce((a, g) => a + g.failed.length, 0);
  return [
    variants ? 'В вариантах решения есть приказы, которые нельзя исполнить:' : 'В решении есть приказы, которые нельзя исполнить:',
    ...(variants
      ? groups.flatMap((g, i) => g.failed.length ? [`Вариант ${i + 1} «${g.title ?? ''}»:`, ...failures(g, '  ')] : [])
      : failures(groups[0])),
    '',
    'Свои силы — приказ можно отдать только им; в поле formation — название точно как здесь, одно формирование на приказ:',
    list(sit.formations.map((f) => f.name), LIMIT.formations),
    '',
    'Пункты поблизости — цель (area, toArea) называйте точно как здесь или соединение противника из разведсводки:',
    list(sit.areas.map((a) => a.title), LIMIT.areas),
    ...(sit.enemies.length ? ['', 'Соединения противника из разведсводки:', list(sit.enemies.map((e) => e.name), LIMIT.enemies)] : []),
    '',
    `Верните исправленные приказы только для этих ${total === 1 ? 'приказа' : `${total} приказов`} — один JSON-объект {"orders": [...]}: в каждом ${variants ? 'v — номер варианта, ' : ''}n — номер исправляемого приказа${variants ? ' в нём' : ''}, остальные поля (${fields}) — как в решении. Задачу (task) не меняйте — исправьте исполнителя и цель; формированиям, у которых уже есть приказ, новых не давайте. Если приказ некому отдать — не включайте его.`,
  ].join('\n');
}

/** Схема ответа на подсказку: массив приказов того же вида с номером исправляемого приказа (и варианта). */
export function repairSchema(item: { required: readonly string[]; properties: Record<string, unknown> }, variants = false) {
  const keys = variants ? ['v', 'n'] : ['n'];
  return {
    type: 'object', additionalProperties: false, required: ['orders'],
    properties: { orders: { type: 'array', items: { ...item, required: [...keys, ...item.required], properties: { ...Object.fromEntries(keys.map((k) => [k, { type: 'integer' }])), ...item.properties } } } },
  };
}

/**
 * Один запрос на исправление для одной или нескольких групп (решение; варианты советника — variants). normalize —
 * приказ из ответа по полям схемы (null — не по форме), task — его задача, formation — своё формирование (null — не опознано или приказ «всем»),
 * ok — исполним ли приказ сам по себе. Ошибка запроса (и отмена) — исходные приказы, error общий.
 */
export async function repairOrders<T extends object>(client: LlmClient, a: {
  messages: ChatMessage[]; answer: string; hint: string; groups: RepairGroup<T>[]; variants?: boolean;
  item: { required: readonly string[]; properties: Record<string, unknown> };
  normalize: (x: Record<string, unknown>) => T | null; task: (o: T) => string; formation: (o: T) => { id: string; name: string } | null; ok: (o: T) => boolean;
  signal?: AbortSignal; onDelta?: (kind: 'reasoning' | 'content', text: string) => void;
}): Promise<{ groups: { orders: T[]; info: RepairInfo }[]; error?: string }> {
  const out = a.groups.map((g) => ({ orders: [...g.orders], info: { failed: g.failed.length, fixed: 0 } as RepairInfo, taken: new Map(g.taken), used: new Set<number>() }));
  const done = (error?: string) => ({
    groups: out.map(({ orders, info }) => ({ orders, info: { ...info, ...(error ? { error } : {}) } })),
    ...(error ? { error } : {}),
  });
  let json: unknown;
  try {
    const res = await client.chat({
      messages: [...a.messages, { role: 'assistant', content: a.answer }, { role: 'user', content: a.hint }],
      schema: { name: 'orders_fix', schema: repairSchema(a.item, a.variants) }, thinking: 'off', signal: a.signal, onDelta: a.onDelta,
    });
    if (res.jsonError) return done(`ответ не разобран: ${res.jsonError}`);
    json = res.json;
  } catch (e) {
    return done(a.signal?.aborted ? 'остановлено' : (e as Error).message);
  }
  const got = (json as { orders?: unknown } | undefined)?.orders;
  if (!Array.isArray(got) || !got.length) return done('модель не вернула исправленных приказов');
  const note = (o: (typeof out)[number], n: number, text: string) => { (o.info.notes ??= []).push({ n, text }); };
  for (const x of got) {
    if (!x || typeof x !== 'object') continue;
    const r = x as Record<string, unknown>;
    const gi = a.variants ? (typeof r.v === 'number' ? r.v - 1 : -1) : 0;
    const g = a.groups[gi], o = out[gi];
    if (!g || !o) continue;
    // только номер отброшенного приказа; исполнимые приказы ответ не трогает
    const f = g.failed.find((y) => y.n === r.n);
    if (!f || o.used.has(f.n)) continue;
    const fixed = a.normalize(r);
    if (!fixed) continue;
    if (a.task(fixed) !== f.task) { note(o, f.n, `исправление отклонено: задача изменена (${TASK_RU[a.task(fixed) as StaffOrder['task']] ?? a.task(fixed)})`); continue; }
    if (!a.ok(fixed)) { note(o, f.n, 'исправление отклонено: снова не исполнимо'); continue; }
    const own = a.formation(fixed);
    if (own && o.taken.has(own.id)) { note(o, f.n, `исправление отклонено: у «${o.taken.get(own.id)}» уже есть приказ`); continue; }
    if (own) o.taken.set(own.id, own.name);
    o.used.add(f.n);
    o.orders[f.n - 1] = fixed;
    o.info.fixed++;
  }
  return done();
}
