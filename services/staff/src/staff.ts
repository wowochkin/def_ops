/**
 * Штаб на модели — ответ по частям. Что готово, сразу отдаётся дальше:
 *  1. quickDecision — замысел и приказы, без размышления; каждый приказ
 *     передаётся в onOrder, как только модель его дописала (движок
 *     принимает приказы в любой момент хода);
 *  2. fullDecision — развёрнутая оценка обстановки, замысел противника,
 *     доклады и риски, с размышлением; идёт параллельно с первым запросом
 *     (сервер обслуживает их пакетом), размышление и текст — потоком в onDelta.
 */
import { LlmClient, type ChatMessage, type ChatResult } from './llm/client';
import { ArrayItemStream, StringFieldStream } from './stream-json';
import { DECISION_SCHEMA, QUICK_SCHEMA, type Decision, type Order, type QuickDecision } from './decision';

export interface StaffRequest {
  /** Системный промпт и сводка обстановки (как в staff.system.md / staff.user.md). */
  messages: ChatMessage[];
  /** Каждый готовый приказ — сразу. */
  onOrder?: (order: Order, index: number) => void;
  /** Замысел — как только готов целиком. */
  onIntent?: (intent: string) => void;
  /** Замысел по мере генерации — слово за словом. */
  onIntentDelta?: (delta: string) => void;
  /** Первый символ ответа от модели (для замера задержки). */
  onFirstToken?: () => void;
  /** Поток размышления и текста полного доклада. */
  onDelta?: (kind: 'reasoning' | 'content', text: string) => void;
  signal?: AbortSignal;
}

const QUICK_NOTE = 'Сейчас нужен только замысел и приказы — коротко и по существу; подробную оценку обстановки вы дадите отдельно. '
  + 'Замысел — 2–3 предложения. По одному приказу на формирование; этапы действий — внутри details. details — не более 30 слов.';

export async function quickDecision(client: LlmClient, req: StaffRequest): Promise<{ decision: QuickDecision | null; result: ChatResult }> {
  const orders = new ArrayItemStream<Order>('orders', (o, i) => req.onOrder?.(o, i));
  let intentSent = false;
  let first = false;
  const intent = new StringFieldStream('intent', (d) => req.onIntentDelta?.(d), (t) => { intentSent = true; req.onIntent?.(t); });
  const messages = [...req.messages.slice(0, -1), { ...req.messages[req.messages.length - 1], content: `${req.messages[req.messages.length - 1].content}\n\n${QUICK_NOTE}` }];
  const result = await client.chat({
    messages, schema: { name: 'staff_quick_decision', schema: QUICK_SCHEMA }, thinking: 'off', signal: req.signal,
    onDelta: (_kind, text) => {
      if (!first) { first = true; req.onFirstToken?.(); }
      intent.push(text);
      orders.push(text);
    },
  });
  const d = result.json as QuickDecision | undefined;
  // приказы, не выданные потоком (например, ответ пришёл одним куском), — досылаются
  if (d?.orders) for (let i = orders.items.length; i < d.orders.length; i++) req.onOrder?.(d.orders[i], i);
  if (d?.intent && !intentSent) { req.onIntentDelta?.(d.intent); req.onIntent?.(d.intent); }
  return { decision: d && Array.isArray(d.orders) ? d : null, result };
}

export async function fullDecision(client: LlmClient, req: StaffRequest): Promise<{ decision: Decision | null; result: ChatResult }> {
  const result = await client.chat({ messages: req.messages, schema: { name: 'staff_decision', schema: DECISION_SCHEMA }, signal: req.signal, onDelta: req.onDelta });
  const d = result.json as Decision | undefined;
  return { decision: d && Array.isArray(d.orders) ? d : null, result };
}

/** Обе части одновременно: приказы — быстро и по одному, доклад — следом. */
export async function decideInParts(client: LlmClient, req: StaffRequest) {
  const [quick, full] = await Promise.all([quickDecision(client, req), fullDecision(client, { ...req, onOrder: undefined, onIntent: undefined })]);
  return { quick, full };
}
