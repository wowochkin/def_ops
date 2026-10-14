import { describe, expect, it } from 'vitest';
import { probeVision } from '../src/kb/vision-probe';
import { scanLlm, crossLlm } from '../src/kb/kb';
import type { LlmSettings } from '../src/sim/game-protocol';

const llm: LlmSettings = { url: 'http://srv/v1', model: 'base', thinking: 'off' };
const sse = (t: string) => new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: t }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
const img = async () => 'data:image/png;base64,AAAA';

describe('probeVision', () => {
  it('ответ с числом — ok, картинка уходит в запросе', async () => {
    let body: { messages: { content: { type: string }[] }[]; model: string } | undefined;
    const f = (async (_u: string, init?: RequestInit) => { body = JSON.parse(String(init?.body)); return sse('4817'); }) as unknown as typeof fetch;
    expect(await probeVision({ ...llm, scanModel: 'vis' }, f, img)).toEqual({ ok: true });
    expect(body!.model).toBe('vis');
    expect(body!.messages[0].content.map((p) => p.type)).toEqual(['text', 'image_url']);
  });
  it('400 про изображения — не видит', async () => {
    const f = (async () => new Response('image input not supported', { status: 400 })) as unknown as typeof fetch;
    const r = await probeVision(llm, f, img);
    expect(r.ok).toBe(false);
    expect(r.why).toMatch(/не видит изображений/);
  });
  it('роли: своя модель или общая', () => {
    expect(scanLlm({ ...llm, scanModel: 's' }).model).toBe('s');
    expect(crossLlm(llm).model).toBe('base');
    expect(crossLlm({ ...llm, crossThinking: 'high' }).thinking).toBe('high');
  });
});
