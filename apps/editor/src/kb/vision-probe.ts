/**
 * Проба «видит ли выбранная модель изображения»: рисуем число «4817», просим его назвать.
 * Источник картинки — параметр (в браузере по умолчанию — OffscreenCanvas; в тестах подменяется).
 */
import { LlmClient } from '@def-ops/staff-service/llm';
import type { LlmSettings } from '../sim/game-protocol';
import { noVision } from './ingest';
import { scanLlm } from './kb';

export const PROBE_NUMBER = '4817';

/** Картинка с числом как data: URL (PNG). */
export async function drawProbeImage(): Promise<string> {
  const c = new OffscreenCanvas(240, 100);
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff'; g.fillRect(0, 0, 240, 100);
  g.fillStyle = '#000'; g.font = 'bold 64px sans-serif'; g.textBaseline = 'middle'; g.textAlign = 'center';
  g.fillText(PROBE_NUMBER, 120, 52);
  const blob = await c.convertToBlob({ type: 'image/png' });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:image/png;base64,${btoa(s)}`;
}

export async function probeVision(llm: LlmSettings, fetchImpl: typeof fetch = fetch.bind(globalThis),
  makeImage: () => Promise<string> = drawProbeImage): Promise<{ ok: boolean; why?: string }> {
  const l = scanLlm(llm);
  const client = new LlmClient({
    url: /^https?:/.test(l.url) ? l.url : new URL(l.url, location.origin).href.replace(/\/+$/, ''),
    model: l.model, thinking: 'off', timeoutMs: 120_000, maxTokens: 200,
  }, fetchImpl);
  try {
    const url = await makeImage();
    const r = await client.chat({ thinking: 'off', messages: [{ role: 'user', content: [
      { type: 'text', text: 'Какое число написано на картинке? Ответь одним числом.' },
      { type: 'image_url', image_url: { url } },
    ] }] });
    return r.content.replace(/\s/g, '').includes(PROBE_NUMBER) ? { ok: true } : { ok: false, why: `модель ответила не то число: «${r.content.trim().slice(0, 80)}»` };
  } catch (e) {
    const m = (e as Error).message;
    if (noVision(m)) return { ok: false, why: 'эта модель не видит изображений' };
    return { ok: false, why: m };
  }
}
