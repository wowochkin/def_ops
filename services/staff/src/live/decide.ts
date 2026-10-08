/**
 * Ход штаба модели в игре: обстановка → решение (оценка, замысел противника,
 * свой замысел, приказы, доклады наверх, риски) → приказы арбитру. Если модель
 * ответила не по схеме — одна просьба переписать решение в JSON без нового
 * размышления (как в проверке на контрольных обстановках).
 */
import type { Order } from '@def-ops/sim';
import { LlmClient, type ChatResult } from '../llm/client';
import type { Thinking } from '../llm/config';
import { DECISION_SCHEMA, type Decision, type Issue } from '../decision';
import { decisionToOrders, type AppliedOrder } from './apply';
import type { Situation } from './situation';

export interface AiTurn {
  time: string;
  model: string;
  ok: boolean;
  error?: string;
  decision?: Decision;
  applied: AppliedOrder[];
  orders: Order[];
  issues: Issue[];
  timings?: ChatResult['timings'];
  repaired?: boolean;
  /** Конец размышления — для разбора посредником. */
  reasoningTail?: string;
}

export async function decideTurn(client: LlmClient, sit: Situation, opts: { thinking?: Thinking; signal?: AbortSignal; onDelta?: (kind: 'reasoning' | 'content', text: string) => void } = {}): Promise<AiTurn> {
  const out: AiTurn = { time: sit.time, model: client.config.model, ok: false, applied: [], orders: [], issues: [] };
  let res: ChatResult;
  try {
    res = await client.chat({ messages: sit.messages, schema: { name: 'staff_decision', schema: DECISION_SCHEMA }, thinking: opts.thinking, signal: opts.signal, onDelta: opts.onDelta });
  } catch (e) {
    out.error = (e as Error).message;
    return out;
  }
  out.model = res.model;
  out.timings = res.timings;
  out.reasoningTail = res.reasoning.slice(-4000) || undefined;
  if (res.jsonError && (res.content.trim() || res.reasoning.trim())) {
    try {
      const fix = await client.chat({
        messages: [...sit.messages, { role: 'assistant', content: res.content.trim() || res.reasoning.slice(-12000) },
          { role: 'user', content: 'Ответ должен быть одним JSON-объектом по схеме, без текста вокруг. Перепиши своё решение в этот формат, ничего не меняя по существу.' }],
        schema: { name: 'staff_decision', schema: DECISION_SCHEMA }, thinking: 'off', signal: opts.signal,
      });
      if (!fix.jsonError) { res = { ...res, json: fix.json, jsonError: undefined }; out.repaired = true; }
    } catch { /* остаётся исходная ошибка */ }
  }
  if (res.jsonError) { out.error = `ответ не разобран: ${res.jsonError}`; return out; }
  const d = res.json as Decision;
  if (!d || !Array.isArray(d.orders)) { out.error = 'в ответе нет приказов'; return out; }
  out.decision = d;
  const r = decisionToOrders(d, sit);
  out.applied = r.applied;
  out.orders = r.orders;
  out.issues = r.issues;
  out.ok = true;
  return out;
}
