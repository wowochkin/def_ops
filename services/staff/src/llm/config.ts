/**
 * Настройки локальной модели. Сервер — LM Studio (или llama.cpp) с протоколом
 * OpenAI на этом же компьютере; облачных вызовов нет.
 */
export type Thinking = 'off' | 'low' | 'medium' | 'high';

export interface LlmConfig {
  /** Адрес API: http://localhost:1234/v1 (из Docker на Mac — http://host.docker.internal:1234/v1). */
  url: string;
  /** Идентификатор модели в LM Studio; пусто — первая загруженная. */
  model: string;
  /** Размышление модели перед ответом (Qwen). Глубина ответа важнее скорости — по умолчанию medium. */
  thinking: Thinking;
  /** Предел на один запрос, мс. */
  timeoutMs: number;
  /** Температура; нет — по рекомендации для режима (с размышлением 0.6, без — 0.7). */
  temperature?: number;
  /** Предел длины ответа (вместе с размышлением), токенов. */
  maxTokens: number;
}

const THINKING: Thinking[] = ['off', 'low', 'medium', 'high'];

export function configFromEnv(e: Record<string, string | undefined> = process.env): LlmConfig {
  const thinking = (e.DEFOPS_LLM_THINKING ?? 'medium') as Thinking;
  if (!THINKING.includes(thinking)) throw new Error(`DEFOPS_LLM_THINKING: одно из ${THINKING.join(', ')}`);
  return {
    url: (e.DEFOPS_LLM_URL ?? 'http://localhost:1234/v1').replace(/\/+$/, ''),
    model: e.DEFOPS_LLM_MODEL ?? '',
    thinking,
    timeoutMs: Number(e.DEFOPS_LLM_TIMEOUT_S ?? 600) * 1000,
    temperature: e.DEFOPS_LLM_TEMPERATURE ? Number(e.DEFOPS_LLM_TEMPERATURE) : undefined,
    maxTokens: Number(e.DEFOPS_LLM_MAX_TOKENS ?? 16000),
  };
}
