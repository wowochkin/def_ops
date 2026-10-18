/**
 * Модель за правилами голоса: то, чего правила не поняли, разбирает языковая модель (LM Studio, OpenAI-совместимый
 * запрос с `tools` через настройки раздела «ИИ»). Инструменты — действия реестра, доступные сейчас; ответ — фраза для
 * озвучки и, может быть, вызов действия (исполняет и проверяет его разборщик, а не модель).
 *
 * Модель голоса — `voiceModel` (пусто — как в «ИИ»), размышление — `voiceThinking` (пусто — выключено:
 * `reasoning_effort: 'none'` — единственный способ, который выключает размышление Qwen3.6 в LM Studio).
 * Сбой, который может пройти сам (нет ответа 20 с — модель зависла или грузится; пустой ответ; 5xx самой модели, кроме
 * 502), — ещё две попытки через 1 и 3 с; после третьей — ModelUnavailable. Связи нет вовсе (отказ соединения, сеть,
 * 502 шлюза `llm_unavailable` — LM Studio не запущена) или запрос не подходит (4xx) — повтор не поможет:
 * ModelUnavailable сразу, без попыток и без заготовленной фразы о повторе.
 */
import type { LlmSettings, Thinking } from '../sim/game-protocol';
import { forModel, type Action } from './registry';
import { SECTIONS } from '../sections';

export interface OpenAITool {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}
/**
 * Ответ модели: say — текст как есть (к озвучке готовит разборщик), call — вызов действия;
 * broken — аргументы не разобрать (такой вызов не исполняется).
 */
export interface ModelReply { say: string; call?: { id: string; params: unknown; broken?: true } }
export type ChatMessage = { role: 'user' | 'assistant'; content: string };

/** Модель недоступна: после всех попыток или сразу, если связи нет вовсе. */
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
  return forModel(actions).map((a) => ({
    type: 'function',
    function: { name: toolName(a.id), description: a.describe, parameters: a.params ?? { type: 'object', properties: {} } },
  }));
}

/** Системный текст: роль, правила речи, что можно и чего сейчас нельзя. */
export function systemText(all: Action[], section?: string): string {
  const actions = forModel(all); // ярлыки — для разборщика (у модели есть действие с параметром), кнопки экрана — не для модели
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

/** Сбой, который повтором не исправить: связи нет (сеть, 502 шлюза) или запрос модели не подходит (4xx). */
class NoRetry extends Error {
  constructor(message: string, cause?: unknown) { super(message); this.name = 'NoRetry'; this.cause = cause; }
}

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((res, rej) => {
  if (signal?.aborted) return rej(signal.reason);
  const t = setTimeout(res, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); rej(signal.reason); }, { once: true });
});

/** Один запрос к модели; пустой ответ, нет ответа 20 с, 5xx (кроме 502) — ошибка, повторяется; прочее — NoRetry. */
async function once(body: object, url: string, f: typeof fetch, signal?: AbortSignal, ids: Map<string, string> = new Map(), contentOnly = false): Promise<ModelReply> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error('нет ответа 20 с')), MODEL_TIMEOUT_MS);
  const stop = () => ac.abort(signal?.reason);
  signal?.addEventListener('abort', stop, { once: true });
  try {
    let r: Response;
    try {
      r = await f(`${url.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ac.signal,
      });
    } catch (e) {
      if (ac.signal.aborted) throw e; // нет ответа 20 с (повтор) или отмена
      throw new NoRetry('нет связи с LM Studio', e); // отказ соединения, сеть
    }
    // 502 — шлюз не достучался до LM Studio (llm_unavailable); 4xx — запрос не подходит: повтор не поможет
    if (r.status === 502 || (r.status >= 400 && r.status < 500)) throw new NoRetry(`LM Studio: ${r.status}`);
    if (!r.ok) throw new Error(`LM Studio: ${r.status}`);
    type Msg = { content?: string | null; reasoning_content?: string | null; tool_calls?: { function?: { name?: string; arguments?: unknown } }[] };
    const j = (await r.json()) as { choices?: { message?: Msg }[] };
    const m = j.choices?.[0]?.message;
    const fn = m?.tool_calls?.[0]?.function;
    const clean = (x?: string | null) => (x ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    // размышление не выключилось и ответ ушёл в reasoning_content — берётся он
    // contentOnly (доклад вслух) — размышление модели не берётся никогда
    const say = clean(m?.content) || (fn?.name || contentOnly ? '' : clean(m?.reasoning_content));
    if (!say && !fn?.name) throw new Error('пустой ответ');
    if (!fn?.name) return { say };
    // имя инструмента → id по списку действий (id может содержать «__»); незнакомое — обратной заменой
    const id = ids.get(fn.name) ?? fromToolName(fn.name);
    const args = fn.arguments;
    if (args && typeof args === 'object') return { say, call: { id, params: args } };
    if (args === undefined || args === null || (typeof args === 'string' && !args.trim())) return { say, call: { id, params: {} } };
    try {
      return { say, call: { id, params: JSON.parse(String(args)) } };
    } catch {
      return { say, call: { id, params: undefined, broken: true } };
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', stop);
  }
}

/**
 * Спрашивает модель о реплике. Инструменты — доступные действия; недоступные — в системном тексте с причиной.
 * Сбой — до трёх попыток (onRetry(n) — перед попыткой n = 2, 3); после — ModelUnavailable. Связи нет вовсе — ModelUnavailable
 * сразу, без onRetry. Отмена (signal) — сразу.
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
  const ids = new Map(ctx.actions.map((a) => [toolName(a.id), a.id]));
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
      return await once(body, s.url, f, ctx.signal, ids);
    } catch (e) {
      if (ctx.signal?.aborted) throw e;
      if (e instanceof NoRetry) throw new ModelUnavailable(e);
      last = e;
    }
  }
  throw new ModelUnavailable(last);
}

/**
 * Короткий текст от модели без инструментов (доклад посредника): системный текст и запрос — как есть, размышление
 * выключено; пустой ответ — сбой (текст размышления вслух не берётся). По умолчанию одна попытка (delays — паузы
 * перед повторами); сбой — ModelUnavailable.
 */
export async function askText(system: string, text: string, ctx: {
  settings: LlmSettings; fetch?: typeof fetch; signal?: AbortSignal; delays?: number[]; maxTokens?: number;
}): Promise<string> {
  const s = ctx.settings;
  const model = s.voiceModel || s.model;
  const body = {
    ...(model ? { model } : {}),
    messages: [{ role: 'system', content: system }, { role: 'user', content: text }],
    temperature: 0.6, top_p: 0.8, max_tokens: ctx.maxTokens ?? 500, stream: false, reasoning_effort: 'none',
  };
  const delays = ctx.delays ?? [];
  let last: unknown;
  for (let n = 1; n <= delays.length + 1; n++) {
    if (ctx.signal?.aborted) throw ctx.signal.reason ?? new Error('отменено');
    if (n > 1) await sleep(delays[n - 2], ctx.signal);
    try {
      return (await once(body, s.url, ctx.fetch ?? fetch, ctx.signal, undefined, true)).say;
    } catch (e) {
      if (ctx.signal?.aborted) throw e;
      if (e instanceof NoRetry) throw new ModelUnavailable(e);
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
