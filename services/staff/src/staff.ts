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
import { ArrayItemStream } from './stream-json';
import { DECISION_SCHEMA, QUICK_SCHEMA, type Decision, type Order, type QuickDecision } from './decision';

export interface StaffRequest {
  /** Системный промпт и сводка обстановки (как в staff.system.md / staff.user.md). */
  messages: ChatMessage[];
  /** Каждый готовый приказ — сразу. */
  onOrder?: (order: Order, index: number) => void;
  /** Замысел — как только готов. */
  onIntent?: (intent: string) => void;
  /** Поток размышления и текста полного доклада. */
  onDelta?: (kind: 'reasoning' | 'content', text: string) => void;
  signal?: AbortSignal;
}

const QUICK_NOTE = 'Сейчас нужен только замысел и приказы — коротко и по существу; подробную оценку обстановки вы дадите отдельно.';

export async function quickDecision(client: LlmClient, req: StaffRequest): Promise<{ decision: QuickDecision | null; result: ChatResult }> {
  const orders = new ArrayItemStream<Order>('orders', (o, i) => req.onOrder?.(o, i));
  let intentSent = false;
  const messages = [...req.messages.slice(0, -1), { ...req.messages[req.messages.length - 1], content: `${req.messages[req.messages.length - 1].content}\n\n${QUICK_NOTE}` }];
  const result = await client.chat({
    messages, schema: { name: 'staff_quick_decision', schema: QUICK_SCHEMA }, thinking: 'off', signal: req.signal,
    onDelta: (_kind, text) => {
      orders.push(text);
      if (!intentSent && req.onIntent) {
        const m = /"intent"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec((orders as unknown as { buf: string }).buf);
        if (m) { intentSent = true; req.onIntent(JSON.parse(`"${m[1]}"`)); }
      }
    },
  });
  const d = result.json as QuickDecision | undefined;
  // приказы, не выданные потоком (например, ответ пришёл одним куском), — досылаются
  if (d?.orders) for (let i = orders.items.length; i < d.orders.length; i++) req.onOrder?.(d.orders[i], i);
  if (d?.intent && !intentSent) req.onIntent?.(d.intent);
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
