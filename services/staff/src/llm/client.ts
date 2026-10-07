/**
 * Клиент локального сервера модели по протоколу OpenAI (/v1/models,
 * /v1/chat/completions) с потоковым ответом.
 *
 * Особенности LM Studio + Qwen, учтённые здесь:
 *  - размышление включается chat_template_kwargs.enable_thinking и
 *    reasoning_effort; текст размышления приходит в reasoning_content;
 *  - при выключенном размышлении весь ответ иногда приходит в
 *    reasoning_content, а content пуст — тогда ответом считается он;
 *  - модель может обернуть размышление в <think>…</think> прямо в content.
 * Ответ ограничивается JSON-схемой (response_format json_schema, strict).
 */
import type { LlmConfig } from './config';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  /** JSON-схема ответа (имя — для журнала и сервера). */
  schema?: { name: string; schema: object };
  /** Переопределение настроек на один запрос. */
  thinking?: LlmConfig['thinking'];
  /** Куски ответа по мере генерации: kind — размышление или сам ответ. */
  onDelta?: (kind: 'reasoning' | 'content', text: string) => void;
  signal?: AbortSignal;
}

export interface ChatTimings {
  /** От отправки до первого токена (≈ обработка промпта), мс. */
  firstTokenMs: number;
  totalMs: number;
  promptTokens?: number;
  completionTokens?: number;
  /** Скорость генерации, токенов/с (по completionTokens или по числу кусков). */
  tokensPerSec?: number;
  /** Скорость обработки промпта, токенов/с. */
  promptTokensPerSec?: number;
  /** Спекулятивное декодирование: принято и отвергнуто черновых токенов (если сервер сообщает). */
  draftAccepted?: number;
  draftRejected?: number;
}

export interface ChatResult {
  model: string;
  content: string;
  reasoning: string;
  /** Разобранный JSON, если запрошена схема и ответ разобрался. */
  json?: unknown;
  /** Причина, по которой JSON не разобран. */
  jsonError?: string;
  /** JSON найден не в ответе, а в тексте размышления. */
  jsonFrom?: 'reasoning';
  finishReason?: string;
  timings: ChatTimings;
}

export class LlmUnavailable extends Error {}

const THINK = /<think>([\s\S]*?)<\/think>/g;

/** Убрать <think>…</think> из ответа; вернуть ответ и вынутое размышление. */
export function splitThink(text: string): { content: string; reasoning: string } {
  const parts: string[] = [];
  const content = text.replace(THINK, (_m, r: string) => { parts.push(r); return ''; });
  return { content: content.trim(), reasoning: parts.join('\n').trim() };
}

/**
 * Вынуть JSON-объект из ответа: допускает обёртку ```json и текст вокруг.
 * Если объектов несколько (например, черновик в размышлении), берётся последний
 * разбирающийся объект верхнего уровня.
 */
export function extractJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(t); } catch { /* ниже — по скобкам */ }
  const found: unknown[] = [];
  for (let i = 0; i < t.length; i++) {
    if (t[i] !== '{') continue;
    let depth = 0, inStr = false, esc = false;
    for (let j = i; j < t.length; j++) {
      const c = t[j];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) {
        try { found.push(JSON.parse(t.slice(i, j + 1))); i = j; } catch { /* не JSON — дальше */ }
        break;
      }
    }
  }
  if (found.length) return found[found.length - 1];
  throw new Error('в ответе нет JSON-объекта');
}

export class LlmClient {
  constructor(readonly config: LlmConfig, private readonly fetchImpl: typeof fetch = fetch) {}

  /** Модели, загруженные на сервере. Сервер недоступен — LlmUnavailable. */
  async models(): Promise<string[]> {
    let r: Response;
    try {
      r = await this.fetchImpl(`${this.config.url}/models`, { signal: AbortSignal.timeout(5000) });
    } catch (e) {
      throw new LlmUnavailable(`сервер модели не отвечает (${this.config.url}): ${(e as Error).message}`);
    }
    if (!r.ok) throw new LlmUnavailable(`сервер модели ответил ${r.status}`);
    const j = (await r.json()) as { data?: { id: string }[] };
    return (j.data ?? []).map((m) => m.id);
  }

  async resolveModel(): Promise<string> {
    if (this.config.model) return this.config.model;
    const list = await this.models();
    const m = list.find((x) => !/embed/i.test(x));
    if (!m) throw new LlmUnavailable('на сервере не загружена ни одна модель');
    return m;
  }

  body(model: string, req: ChatRequest): Record<string, unknown> {
    const thinking = req.thinking ?? this.config.thinking;
    const body: Record<string, unknown> = {
      model,
      messages: req.messages,
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: this.config.maxTokens,
      temperature: this.config.temperature ?? (thinking === 'off' ? 0.7 : 0.6),
      top_p: thinking === 'off' ? 0.8 : 0.95,
      chat_template_kwargs: { enable_thinking: thinking !== 'off' },
    };
    if (thinking !== 'off') body.reasoning_effort = thinking;
    if (this.config.draftModel) body.draft_model = this.config.draftModel;
    if (req.schema) body.response_format = { type: 'json_schema', json_schema: { name: req.schema.name, strict: true, schema: req.schema.schema } };
    return body;
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    const model = await this.resolveModel();
    const t0 = performance.now();
    const signal = req.signal ? AbortSignal.any([req.signal, AbortSignal.timeout(this.config.timeoutMs)]) : AbortSignal.timeout(this.config.timeoutMs);
    let r: Response;
    try {
      r = await this.fetchImpl(`${this.config.url}/chat/completions`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(this.body(model, req)), signal,
      });
    } catch (e) {
      throw new LlmUnavailable(`сервер модели не отвечает: ${(e as Error).message}`);
    }
    if (!r.ok || !r.body) throw new Error(`сервер модели ответил ${r.status}: ${(await r.text()).slice(0, 500)}`);

    let content = '', reasoning = '', finishReason: string | undefined, firstTokenMs = 0, chunks = 0;
    let usage: { prompt_tokens?: number; completion_tokens?: number } | undefined;
    let draft: { accepted?: number; rejected?: number } | undefined;
    const thinkingOff = (req.thinking ?? this.config.thinking) === 'off';
    for await (const ev of sseEvents(r.body)) {
      if (ev === '[DONE]') break;
      let j: { choices?: { delta?: { content?: string; reasoning_content?: string; reasoning?: string }; finish_reason?: string }[]; usage?: typeof usage;
        stats?: { accepted_draft_tokens_count?: number; rejected_draft_tokens_count?: number } };
      try { j = JSON.parse(ev); } catch { continue; }
      if (j.usage) usage = j.usage;
      if (j.stats && (j.stats.accepted_draft_tokens_count != null || j.stats.rejected_draft_tokens_count != null)) {
        draft = { accepted: j.stats.accepted_draft_tokens_count, rejected: j.stats.rejected_draft_tokens_count };
      }
      const ch = j.choices?.[0];
      if (!ch) continue;
      if (ch.finish_reason) finishReason = ch.finish_reason;
      const d = ch.delta ?? {};
      const rs = d.reasoning_content ?? d.reasoning;
      if (rs) { if (!firstTokenMs) firstTokenMs = performance.now() - t0; reasoning += rs; chunks++; req.onDelta?.('reasoning', rs); }
      if (d.content) { if (!firstTokenMs) firstTokenMs = performance.now() - t0; content += d.content; chunks++; req.onDelta?.('content', d.content); }
    }
    const totalMs = performance.now() - t0;

    // <think> внутри content; пустой content при выключенном размышлении — ответ лежит в reasoning
    const split = splitThink(content);
    content = split.content;
    if (split.reasoning) reasoning = [reasoning, split.reasoning].filter(Boolean).join('\n');
    if (!content.trim() && thinkingOff && reasoning.trim()) { content = reasoning; reasoning = ''; }

    const genMs = Math.max(1, totalMs - firstTokenMs);
    const completion = usage?.completion_tokens ?? chunks;
    const timings: ChatTimings = {
      firstTokenMs: Math.round(firstTokenMs), totalMs: Math.round(totalMs),
      promptTokens: usage?.prompt_tokens, completionTokens: usage?.completion_tokens,
      tokensPerSec: +(completion / (genMs / 1000)).toFixed(1),
      promptTokensPerSec: usage?.prompt_tokens && firstTokenMs ? +(usage.prompt_tokens / (firstTokenMs / 1000)).toFixed(0) : undefined,
      draftAccepted: draft?.accepted, draftRejected: draft?.rejected,
    };
    const res: ChatResult = { model, content, reasoning, finishReason, timings };
    if (req.schema) {
      try { res.json = extractJson(content); } catch (e) {
        // сервер мог положить весь ответ в поле размышления: JSON — в его конце
        try { res.json = extractJson(reasoning); res.jsonFrom = 'reasoning'; } catch { res.jsonError = (e as Error).message; }
      }
      if (finishReason === 'length') res.jsonError = (res.jsonError ? res.jsonError + '; ' : '') + 'ответ оборван по пределу длины (DEFOPS_LLM_MAX_TOKENS)';
    }
    return res;
  }
}

/** События SSE (поле data) из потока ответа. */
export async function* sseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const dec = new TextDecoder();
  let buf = '';
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    buf += dec.decode(chunk, { stream: true });
    let i: number;
    while ((i = buf.search(/\r?\n\r?\n/)) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(buf[i] === '\r' ? i + 4 : i + 2);
      const data = block.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
      if (data) yield data;
    }
  }
  const rest = buf.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
  if (rest) yield rest;
}
