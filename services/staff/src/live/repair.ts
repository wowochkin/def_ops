/**
 * Исправление приказов по подсказке: если в решении (штаба модели или варианта советника) есть приказы, которые не
 * исполнить, — формирования нет среди своих сил, цель не опознана, у задачи нет цели, — модели один раз отправляется
 * список ошибок по приказам, точный список своих сил и пунктов поблизости с просьбой вернуть исправленные приказы
 * только для отброшенных. Исправленный приказ заменяет отброшенный, если сам исполним; иначе остаётся исходный с
 * прежним замечанием. Не больше одного такого запроса на решение.
 */
import { LlmClient, type ChatMessage } from '../llm/client';
import { TASK_RU, type Order as StaffOrder } from '../decision';
import type { AppliedOrder } from './apply';
import type { Situation } from './situation';

/** Отброшенный приказ: номер в решении (с 1) и почему не исполнен. */
export interface FailedOrder { n: number; formation: string; task: StaffOrder['task']; issue: string }

/** Итог исправления: сколько приказов было отброшено и сколько исправлено; error — запрос не удался или не разобран. */
export interface RepairInfo { failed: number; fixed: number; error?: string }

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

const LIMIT = { formations: 80, areas: 60, enemies: 30 };
const list = (xs: string[], max: number) => xs.slice(0, max).map((x) => `- ${x}`).join('\n') + (xs.length > max ? `\n- … и ещё ${xs.length - max}` : '');

/** Текст подсказки: ошибки по приказам, свои силы и пункты поблизости, формат ответа. */
export function repairHint(failed: FailedOrder[], sit: Pick<Situation, 'formations' | 'areas' | 'enemies'>, fields: string, what = 'решении'): string {
  return [
    `В ${what} есть приказы, которые нельзя исполнить:`,
    failed.map((f) => `- приказ ${f.n} («${f.formation}», ${TASK_RU[f.task] ?? f.task}): ${f.issue}`).join('\n'),
    '',
    'Свои силы — приказ можно отдать только им; в поле formation — название точно как здесь, одно формирование на приказ:',
    list(sit.formations.map((f) => f.name), LIMIT.formations),
    '',
    'Пункты поблизости — цель (area, toArea) называйте точно как здесь или соединение противника из разведсводки:',
    list(sit.areas.map((a) => a.title), LIMIT.areas),
    ...(sit.enemies.length ? ['', 'Соединения противника из разведсводки:', list(sit.enemies.map((e) => e.name), LIMIT.enemies)] : []),
    '',
    `Верните исправленные приказы только для этих ${failed.length === 1 ? 'приказа' : `${failed.length} приказов`} — один JSON-объект {"orders": [...]}: в каждом n — номер исправляемого приказа, остальные поля (${fields}) — как в решении. Задачу по существу не меняйте — исправьте исполнителя и цель. Если приказ некому отдать — не включайте его.`,
  ].join('\n');
}

/** Схема ответа на подсказку: массив приказов того же вида с номером исправляемого приказа. */
export function repairSchema(item: { required: readonly string[]; properties: Record<string, unknown> }) {
  return {
    type: 'object', additionalProperties: false, required: ['orders'],
    properties: { orders: { type: 'array', items: { ...item, required: ['n', ...item.required], properties: { n: { type: 'integer' }, ...item.properties } } } },
  };
}

/**
 * Один запрос на исправление. orders — приказы решения, failed — отброшенные из них; normalize — приказ из ответа
 * (null — не по форме), ok — исполним ли приказ сам по себе. Ошибка запроса (и отмена) — исходные приказы.
 */
export async function repairOrders<T extends object>(client: LlmClient, a: {
  messages: ChatMessage[]; answer: string; orders: T[]; failed: FailedOrder[]; hint: string;
  item: { required: readonly string[]; properties: Record<string, unknown> };
  normalize: (x: Record<string, unknown>) => T | null; ok: (o: T) => boolean;
  signal?: AbortSignal; onDelta?: (kind: 'reasoning' | 'content', text: string) => void;
}): Promise<{ orders: T[]; info: RepairInfo }> {
  const info: RepairInfo = { failed: a.failed.length, fixed: 0 };
  let json: unknown;
  try {
    const res = await client.chat({
      messages: [...a.messages, { role: 'assistant', content: a.answer }, { role: 'user', content: a.hint }],
      schema: { name: 'orders_fix', schema: repairSchema(a.item) }, thinking: 'off', signal: a.signal, onDelta: a.onDelta,
    });
    if (res.jsonError) { info.error = `ответ не разобран: ${res.jsonError}`; return { orders: a.orders, info }; }
    json = res.json;
  } catch (e) {
    info.error = a.signal?.aborted ? 'остановлено' : (e as Error).message;
    return { orders: a.orders, info };
  }
  const got = (json as { orders?: unknown } | undefined)?.orders;
  if (!Array.isArray(got) || !got.length) { info.error = 'модель не вернула исправленных приказов'; return { orders: a.orders, info }; }
  const out = [...a.orders];
  const used = new Set<number>();
  got.forEach((x, i) => {
    if (!x || typeof x !== 'object') return;
    const r = x as Record<string, unknown>;
    // номер — из ответа; нет или не из списка — по порядку
    const n = typeof r.n === 'number' && a.failed.some((f) => f.n === r.n) ? r.n : a.failed[i]?.n;
    if (!n || used.has(n)) return;
    const o = a.normalize(r);
    if (!o || !a.ok(o)) return;
    used.add(n);
    out[n - 1] = o;
  });
  info.fixed = used.size;
  return { orders: out, info };
}
