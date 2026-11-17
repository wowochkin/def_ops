/** Проверка выбранных моделей настоящими запросами; общая конфигурация хранится в shared.ts. */
import type { LlmSettings } from '../sim/game-protocol';
export const PORTABLE_SETUP_KEY = 'def_ops.portable.setup.v1';
export const OPEN_PORTABLE_SETUP = 'def_ops.portable.open';
export function openPortableSetup() { window.dispatchEvent(new Event(OPEN_PORTABLE_SETUP)); }
export interface SetupProbe { role: string; model: string; dims?: number }
export async function probeSetup(settings: LlmSettings, request: typeof fetch = fetch, report: (probe: SetupProbe) => void = () => {}): Promise<SetupProbe[]> {
  if (!settings.model.trim() || !settings.voiceModel?.trim() || !settings.embedModel?.trim() || settings.embedModel === 'off') throw new Error('Выберите основную, голосовую модель и модель embeddings явно.');
  const url = settings.url.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(url) && !url.startsWith('/')) throw new Error('Адрес API должен начинаться с / или http(s)://.');
  const post = async (path: string, body: unknown) => {
    const r = await request(`${url}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(120_000) });
    if (!r.ok) throw new Error(`Проверка ${path}: сервер ответил ${r.status}`);
    return r.json();
  };
  const out: SetupProbe[] = [];
  for (const [role, model] of [['Основная', settings.model], ['Голосовая', settings.voiceModel]]) {
    const result = await post('chat/completions', { model, messages: [{ role: 'user', content: 'Ответь одним словом: готово. /no_think' }], max_tokens: 64, temperature: 0, reasoning_effort: 'none', stream: false });
    if (typeof result?.choices?.[0]?.message?.content !== 'string' || !result.choices[0].message.content.trim()) throw new Error(`${role} модель «${model}» не вернула текст ответа.`);
    const probe = { role, model }; out.push(probe); report(probe);
  }
  const embedded = await post('embeddings', { model: settings.embedModel, input: ['Проверка смыслового поиска по исторической библиотеке.'] });
  const vector: unknown = embedded?.data?.[0]?.embedding;
  if (!Array.isArray(vector) || !vector.length || !vector.every(v => typeof v === 'number' && Number.isFinite(v)) || !vector.some(v => v !== 0)) throw new Error('Модель embeddings не вернула непустой числовой вектор.');
  const probe = { role: 'Embeddings', model: settings.embedModel, dims: vector.length }; out.push(probe); report(probe);
  return out;
}
