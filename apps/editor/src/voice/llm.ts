/**
 * Модель за правилами голоса: то, чего правила не поняли, разбирает языковая модель (LM Studio, OpenAI-совместимый
 * запрос с `tools` через настройки раздела «ИИ»). Инструменты — действия реестра, доступные сейчас; ответ — фраза для
 * озвучки и, может быть, вызов действия (исполняет и проверяет его разборщик, а не модель).
 *
 * Модель голоса — `voiceModel` (пусто — как в «ИИ»), размышление — `voiceThinking` (пусто — выключено:
 * `reasoning_effort: 'none'` — единственный способ, который выключает размышление Qwen3.6 в LM Studio).
 * Сбой (ошибка, пустой ответ, нет ответа 20 с) — ещё две попытки через 1 и 3 с; после третьей — ModelUnavailable.
 */
import type { LlmSettings, Thinking } from '../sim/game-protocol';
import type { Action } from './registry';
import { speakable } from './speech';
import { SECTIONS } from '../sections';

export interface OpenAITool {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}
export interface ModelReply { say: string; call?: { id: string; params: unknown } }
export type ChatMessage = { role: 'user' | 'assistant'; content: string };

/** Модель недоступна после всех попыток. */
export class ModelUnavailable extends Error {
  constructor(cause?: unknown) { super('Связи с моделью нет'); this.name = 'ModelUnavailable'; this.cause = cause; }
}

export const MODEL_TIMEOUT_MS = 20_000;
/** Паузы перед второй и третьей попыткой. */
export const RETRY_DELAYS_MS = [1000, 3000];
export const HISTORY_MAX = 12;

const toolName = (id: string) => id.replace(/\./g, '__');
const fromToolName = (name: string) => name.replace(/__/g, '.');

/** Действия реестра → инструменты модели: имя — id с «__» вместо точек, описание — describe, параметры — params. */
export function toTools(actions: Action[]): OpenAITool[] {
  return actions.map((a) => ({
    type: 'function',
    function: { name: toolName(a.id), description: a.describe, parameters: a.params ?? { type: 'object', properties: {} } },
  }));
}

/** Системный текст: роль, правила речи, что можно и чего сейчас нельзя. */
export function systemText(actions: Action[], section?: string): string {
  const ok = actions.filter((a) => a.available() === true);
  const off = actions.filter((a) => a.available() !== true);
  const examples = ok.flatMap((a) => a.say ?? []).slice(0, 3).map((e) => `«${e}»`).join(', ');
  const title = SECTIONS.find((s) => s.id === section)?.title;
  return [
    'Ты — начальник штаба в программе для переигровки операций Великой Отечественной войны. С тобой говорит голосом человек старшего возраста, эксперт-историк или военный.',
    'Правила речи: отвечай устно, одной-двумя короткими фразами, простыми словами, как на докладе. Без списков и разметки, без английских и технических слов, без сокращений. Все числа, даты и время — словами («в пять часов», «шестнадцатого апреля»).',
    'Чтобы что-то сделать, вызови инструмент из списка; в параметрах инструмента — обычная запись (цифры, идентификаторы). Скажи коротко, что делаешь.',
    `Не придумывай возможностей: умеешь только то, что в списке ниже. Если подходящего действия нет — ответь: «Этого система пока не предусматривает. Могу: …» и назови два-три примера${examples ? ` (${examples})` : ''}. Если действие есть, но сейчас недоступно — скажи почему.`,
    title ? `Сейчас открыт раздел «${title}».` : '',
    'Доступные действия:',
    ...ok.map((a) => `- ${toolName(a.id)} — ${a.title}. ${a.describe}${a.say?.length ? ` Примеры: ${a.say.map((e) => `«${e}»`).join(', ')}.` : ''}`),
    ...(off.length ? ['Сейчас недоступны (не вызывай, объясни причину):', ...off.map((a) => `- ${a.title}: ${a.available()}`)] : []),
  ].filter(Boolean).join('\n');
}

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((res, rej) => {
  if (signal?.aborted) return rej(signal.reason);
  const t = setTimeout(res, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); rej(signal.reason); }, { once: true });
});

/** Один запрос к модели; пустой ответ — ошибка (повторяется). */
async function once(body: object, url: string, f: typeof fetch, signal?: AbortSignal): Promise<ModelReply> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error('нет ответа 20 с')), MODEL_TIMEOUT_MS);
  const stop = () => ac.abort(signal?.reason);
  signal?.addEventListener('abort', stop, { once: true });
  try {
    const r = await f(`${url.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ac.signal,
    });
    if (!r.ok) throw new Error(`LM Studio: ${r.status}`);
    const j = (await r.json()) as { choices?: { message?: { content?: string | null; tool_calls?: { function?: { name?: string; arguments?: string } }[] } }[] };
    const m = j.choices?.[0]?.message;
    const fn = m?.tool_calls?.[0]?.function;
    const say = speakable(m?.content ?? '');
    if (!say && !fn?.name) throw new Error('пустой ответ');
    if (!fn?.name) return { say };
    let params: unknown = {};
    try { params = fn.arguments ? JSON.parse(fn.arguments) : {}; } catch { params = {}; }
    return { say, call: { id: fromToolName(fn.name), params } };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', stop);
  }
}

/**
 * Спрашивает модель о реплике. Инструменты — доступные действия; недоступные — в системном тексте с причиной.
 * Сбой — до трёх попыток (onRetry(n) — перед попыткой n = 2, 3); после — ModelUnavailable. Отмена (signal) — сразу.
 */
export async function askModel(text: string, ctx: {
  actions: Action[]; settings: LlmSettings; history: ChatMessage[]; fetch?: typeof fetch; signal?: AbortSignal;
  onRetry?: (n: number) => void; section?: string; delays?: number[];
}): Promise<ModelReply> {
  const s = ctx.settings;
  const thinking: Thinking = s.voiceThinking ?? 'off';
  const model = s.voiceModel || s.model;
  const tools = toTools(ctx.actions.filter((a) => a.available() === true));
  const body = {
    ...(model ? { model } : {}),
    messages: [{ role: 'system', content: systemText(ctx.actions, ctx.section) }, ...ctx.history.slice(-HISTORY_MAX), { role: 'user', content: text }],
    ...(tools.length ? { tools, tool_choice: 'auto' } : {}),
    temperature: thinking === 'off' ? 0.7 : 0.6, top_p: thinking === 'off' ? 0.8 : 0.95, max_tokens: thinking === 'off' ? 400 : 2000,
    stream: false,
    reasoning_effort: thinking === 'off' ? 'none' : thinking,
  };
  const f = ctx.fetch ?? fetch;
  const delays = ctx.delays ?? RETRY_DELAYS_MS;
  let last: unknown;
  for (let n = 1; n <= delays.length + 1; n++) {
    if (ctx.signal?.aborted) throw ctx.signal.reason ?? new Error('отменено');
    if (n > 1) {
      ctx.onRetry?.(n);
      await sleep(delays[n - 2], ctx.signal);
    }
    try {
      return await once(body, s.url, f, ctx.signal);
    } catch (e) {
      if (ctx.signal?.aborted) throw e;
      last = e;
    }
  }
  throw new ModelUnavailable(last);
}

/** Крючок модели для разборщика: держит разговор (последние реплики) и берёт настройки в момент вызова. */
export function createVoiceModel(opts: { settings(): LlmSettings; fetch?: typeof fetch; delays?: number[] }) {
  const history: ChatMessage[] = [];
  return async (text: string, actions: Action[], c: { signal: AbortSignal; onRetry(n: number): void; section?: string }): Promise<ModelReply> => {
    const r = await askModel(text, { actions, settings: opts.settings(), history, fetch: opts.fetch, signal: c.signal, onRetry: c.onRetry, section: c.section, delays: opts.delays });
    history.push({ role: 'user', content: text }, { role: 'assistant', content: r.say });
    history.splice(0, Math.max(0, history.length - HISTORY_MAX));
    return r;
  };
}
