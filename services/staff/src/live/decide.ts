/**
 * Ход штаба модели в игре: обстановка → решение (оценка, замысел противника,
 * свой замысел, приказы, доклады наверх, риски) → приказы арбитру. Если модель
 * ответила не по схеме — одна просьба переписать решение в JSON без нового
 * размышления (как в проверке на контрольных обстановках).
 */
import type { Order, StaffAction } from '@def-ops/sim';
import { LlmClient, textOf, type ChatResult } from '../llm/client';
import type { Thinking } from '../llm/config';
import { DECISION_SCHEMA, LIVE_DECISION_SCHEMA, withBasis, type Decision, type Issue } from '../decision';
import { parseRefs } from './kb-blocks';
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
  /** Распоряжения по тылу, переправам, резервам: как поняты и исполнимы ли (заполняет игра — нужны состояние и театр). */
  staff?: { given: unknown; action: StaffAction | null; text: string }[];
  staffActions?: StaffAction[];
  timings?: ChatResult['timings'];
  repaired?: boolean;
  /** Конец размышления — для разбора посредником. */
  reasoningTail?: string;
  /** Ссылки решения на базу знаний: номера R1… (только существующие), когда штабу дана справка или доктрина. */
  basis?: string[];
  /** Записи базы под номерами R1… — без текста (для записи игры и «по базе» у решения). */
  refs?: { id: string; title: string }[];
}

/** Схема ответа: с распоряжениями — когда штаб ведёт тыл; с basis — когда дана справка или доктрина. */
function schemaOf(sit: Situation) {
  const base = sit.staff ? LIVE_DECISION_SCHEMA : DECISION_SCHEMA;
  return sit.refs?.length ? withBasis(base) : base;
}

export async function decideTurn(client: LlmClient, sit: Situation, opts: { thinking?: Thinking; signal?: AbortSignal; onDelta?: (kind: 'reasoning' | 'content', text: string) => void;
  /** Повтор запроса (после зацикливания): почему — для показа. */
  onRetry?: (why: string) => void } = {}): Promise<AiTurn> {
  const out: AiTurn = { time: sit.time, model: client.config.model, ok: false, applied: [], orders: [], issues: [] };
  let res: ChatResult;
  try {
    const schema = { name: 'staff_decision', schema: schemaOf(sit) };
    res = await client.chat({ messages: sit.messages, schema, thinking: opts.thinking, signal: opts.signal, onDelta: opts.onDelta });
    // зацикливание на схеме (бесконечные пробелы после первых слов) — повтор без схемы на сервере: тот же
    // запрос с просьбой ответить одним JSON-объектом, разбор — по схеме у нас
    if (res.degenerate && !opts.signal?.aborted) {
      opts.onRetry?.(`генерация зациклилась (${res.degenerate}) — повтор без схемы на сервере`);
      const again = await client.chat({
        messages: [...sit.messages.slice(0, -1), { ...sit.messages[sit.messages.length - 1], content: textOf(sit.messages[sit.messages.length - 1].content) + '\n\nОтветь одним JSON-объектом с полями из описания формата, без текста до и после него.' }],
        schema, schemaLoose: true, thinking: opts.thinking, signal: opts.signal, onDelta: opts.onDelta,
      });
      res = { ...again, timings: again.timings };
      out.repaired = true;
    }
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
        schema: { name: 'staff_decision', schema: schemaOf(sit) }, thinking: 'off', signal: opts.signal,
      });
      if (!fix.jsonError) { res = { ...res, json: fix.json, jsonError: undefined }; out.repaired = true; }
    } catch { /* остаётся исходная ошибка */ }
  }
  if (res.jsonError) {
    // пустой или обрывочный ответ на длинный запрос — обычно запрос длиннее контекста, загруженного в LM Studio
    const tokens = Math.round(sit.messages.reduce((a, m) => a + textOf(m.content).length, 0) / 3.2);
    const empty = !res.content.trim() || res.content.trim().length < 40;
    out.error = `ответ не разобран: ${res.jsonError}${empty ? ` — модель вернула ${res.content.trim() ? 'обрывок' : 'пустой ответ'}; запрос ≈ ${Math.round(tokens / 100) / 10} тыс. токенов — проверьте длину контекста модели в LM Studio (Context Length: нужно не меньше ${Math.ceil((tokens + 4000) / 4096) * 4} тыс.) или выберите модель с большим контекстом` : `; начало ответа: «${res.content.trim().slice(0, 160)}»`}`;
    return out;
  }
  const d = res.json as Decision;
  if (!d || !Array.isArray(d.orders)) { out.error = 'в ответе нет приказов'; return out; }
  out.decision = d;
  if (sit.refs?.length) { out.basis = parseRefs(d.basis, sit.refs); out.refs = sit.refs.map(({ id, title }) => ({ id, title })); }
  const r = decisionToOrders(d, sit);
  out.applied = r.applied;
  out.orders = r.orders;
  out.issues = r.issues;
  out.ok = true;
  return out;
}
