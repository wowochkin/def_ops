/**
 * Варианты решения на ход от советника: один–три полных варианта действий — оценка, замысел противника,
 * решение, риски, донесение, приказы войскам и распоряжения по тылу, переправам и резервам. Командующий
 * выбирает вариант и принимает его в проект целиком (затем правит) — или берёт отдельные приказы.
 *
 * Обстановка и правила — те же, что у советника (buildAdvice); меняется только формат ответа. Варианты
 * выдаются по мере генерации (каждый — как только закрыт его объект), названия сопоставляются со
 * списками обстановки так же, как приказы штаба модели.
 */
import type { GameState } from '@def-ops/sim';
import { LlmClient, type ChatMessage, type ChatResult } from '../llm/client';
import type { Thinking } from '../llm/config';
import { ArrayItemStream } from '../stream-json';
import { STAFF_ACTION_KINDS, TASKS, type StaffActionGiven } from '../decision';
import { leakedNames, type AdviceSuggestion, type buildAdvice } from './advisor';

export interface PlanVariantRaw {
  title: string;
  idea: string;
  assessment: string;
  enemyIntent: string;
  intent: string;
  risks: string;
  report: string;
  orders: AdviceSuggestion[];
  actions: StaffActionGiven[];
}

const str = { type: 'string' };
export const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['variants'],
  properties: {
    variants: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['title', 'idea', 'assessment', 'enemyIntent', 'intent', 'risks', 'report', 'orders', 'actions'],
        properties: {
          title: str, idea: str, assessment: str, enemyIntent: str, intent: str, risks: str, report: str,
          orders: { type: 'array', items: {
            type: 'object', additionalProperties: false, required: ['formation', 'task', 'area', 'toArea', 'why'],
            properties: { formation: str, task: { type: 'string', enum: [...TASKS] }, area: str, toArea: { type: ['string', 'null'] }, why: str },
          } },
          actions: { type: 'array', items: {
            type: 'object', additionalProperties: false, required: ['kind', 'subject', 'area', 'formations'],
            properties: { kind: { type: 'string', enum: [...STAFF_ACTION_KINDS] }, subject: { type: ['string', 'null'] }, area: { type: ['string', 'null'] }, formations: { type: 'array', items: str } },
          } },
        },
      },
    },
  },
} as const;

const FORMAT = (n: number) => `Сейчас командующий просит не ответ на вопрос, а готовые варианты решения на ход — ${n === 1 ? 'один вариант' : `${n} заметно разных варианта (например, решительный, осторожный, манёвренный — по обстановке)`}. Каждый вариант — полный: командующий может принять его целиком.

Ответ — строго один JSON-объект по заданной схеме: variants — массив вариантов; в каждом:
- title — название варианта, 2–5 слов («Удар на Цоссен», «Закрепиться и подтянуть тылы»);
- idea — суть варианта и чем он отличается от других, 1–2 фразы;
- assessment — оценка обстановки (3–6 фраз: главное за сутки, соотношение сил, положение с подвозом);
- enemyIntent — вероятный замысел противника по разведсводке (с пометкой «предположение», где это догадка);
- intent — решение: замысел своих действий на ход — где главный удар, кто что делает, чего добиться к концу хода;
- risks — риски этого варианта и чем их парировать;
- report — боевое донесение в Ставку на этот ход (3–5 фраз, от первого лица штаба);
- orders — приказы своим войскам, только тем, чья задача должна измениться: formation — точно как в списке своих сил; task — одно из: defend, hold, delay, withdraw, counterattack, attack, breakout, regroup, reserve, relieve; area — пункт из списка обстановки или соединение противника из разведсводки; toArea — куда (для отхода, перегруппировки, прорыва), иначе null; why — зачем, одной фразой;
- actions — распоряжения по тылу, переправам и резервам (может быть пустым): base — перенести базу снабжения (subject — название базы точно как в разделе тыла, area — пункт); priority — приоритет подвоза (formations — не более трети своих формирований); bridge — навести переправу (area — пункт у реки); demolish — подорвать мост (area — пункт у моста на своей территории); commit — ввести резерв (subject — формирование из резерва, area — район сосредоточения на своей территории); в неиспользуемых полях — null или пустой список.

Те же строгие правила: только сведения из обстановки, противник — только по разведсводке, названия — точно как в обстановке. Учитывайте правила арбитра (задержку доведения приказов, подвоз, переправы). Если командующий уже готовит проект решения — учтите его: один из вариантов может развивать проект.`;

/** Сообщения модели: системный промпт советника с форматом вариантов вместо формата ответа на вопрос. */
export function planMessages(built: ReturnType<typeof buildAdvice>, n: number): ChatMessage[] {
  const sys = built.messages[0].content;
  const cut = sys.indexOf('Ответ — строго один JSON-объект');
  const system = `${cut > 0 ? sys.slice(0, cut).trimEnd() : sys}\n\n${FORMAT(n)}`;
  return [{ role: 'system', content: system }, built.messages[built.messages.length - 1]];
}

const s = (x: unknown) => (typeof x === 'string' ? x.trim() : '');
/** Вариант из ответа модели — терпимо к неполному (пустые поля, не массивы). */
export function planVariant(x: unknown): PlanVariantRaw | null {
  if (!x || typeof x !== 'object') return null;
  const v = x as Record<string, unknown>;
  const orders = (Array.isArray(v.orders) ? v.orders : []).filter((o): o is AdviceSuggestion => !!o && typeof o === 'object' && typeof (o as AdviceSuggestion).formation === 'string' && (TASKS as readonly string[]).includes((o as AdviceSuggestion).task));
  const actions = (Array.isArray(v.actions) ? v.actions : []).filter((a): a is StaffActionGiven => !!a && typeof a === 'object' && (STAFF_ACTION_KINDS as readonly string[]).includes((a as StaffActionGiven).kind))
    .map((a) => ({ kind: a.kind, subject: a.subject ?? null, area: a.area ?? null, formations: Array.isArray(a.formations) ? a.formations : [] }));
  const r = { title: s(v.title), idea: s(v.idea), assessment: s(v.assessment), enemyIntent: s(v.enemyIntent), intent: s(v.intent), risks: s(v.risks), report: s(v.report), orders: orders.map((o) => ({ ...o, toArea: o.toArea ?? null, why: s(o.why), area: s(o.area) })), actions };
  return r.intent || r.orders.length ? { ...r, title: r.title || 'Вариант' } : null;
}

export interface PlanResult {
  ok: boolean;
  error?: string;
  variants: PlanVariantRaw[];
  /** Упомянуты скрытые от штаба соединения противника (по вариантам). */
  warning?: string;
  model?: string;
  timings?: ChatResult['timings'];
}

/**
 * Запросить варианты. onVariant — каждый вариант, как только модель его дописала (до конца ответа);
 * onProgress — сколько знаков ответа и размышления получено (для индикатора).
 */
export async function planVariants(client: LlmClient, _g: GameState, built: ReturnType<typeof buildAdvice>, n: number,
  opts: { thinking?: Thinking; signal?: AbortSignal; onVariant?: (v: PlanVariantRaw, i: number) => void; onProgress?: (p: { content: number; reasoning: number; tail: string }) => void } = {}): Promise<PlanResult> {
  const got: PlanVariantRaw[] = [];
  const stream = new ArrayItemStream<unknown>('variants', (item) => { const v = planVariant(item); if (v) { got.push(v); opts.onVariant?.(v, got.length - 1); } });
  let content = 0, reasoning = 0, tail = '';
  let res: ChatResult;
  try {
    res = await client.chat({
      messages: planMessages(built, n), schema: { name: 'staff_plan', schema: PLAN_SCHEMA }, thinking: opts.thinking, signal: opts.signal,
      onDelta: (k, t) => {
        if (k === 'content') { content += t.length; stream.push(t); } else { reasoning += t.length; tail = (tail + t).slice(-400); }
        opts.onProgress?.({ content, reasoning, tail });
      },
    });
  } catch (e) {
    return { ok: got.length > 0, error: (e as Error).message, variants: got };
  }
  const all = Array.isArray((res.json as { variants?: unknown[] } | undefined)?.variants)
    ? ((res.json as { variants: unknown[] }).variants.map(planVariant).filter(Boolean) as PlanVariantRaw[]) : got;
  // дописать варианты, которых не было в потоке (поток мог не распознать элемент)
  for (let i = got.length; i < all.length; i++) opts.onVariant?.(all[i], i);
  const text = all.map((v) => [v.assessment, v.enemyIntent, v.intent, v.risks, v.report, ...v.orders.map((o) => `${o.area} ${o.toArea ?? ''} ${o.why}`)].join('\n')).join('\n');
  const leak = leakedNames(text, built.hidden);
  return {
    ok: all.length > 0, error: all.length ? undefined : res.jsonError ?? 'модель не дала вариантов', variants: all, model: res.model, timings: res.timings,
    ...(leak.length ? { warning: `упомянуты соединения противника, которых нет в разведсводке: ${leak.join(', ')} — это не данные разведки` } : {}),
  };
}
