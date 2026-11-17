import { describe, expect, it, vi } from 'vitest';
import { probeSetup } from '../src/portable/setup-state';
import type { LlmSettings } from '../src/sim/game-protocol';
const settings: LlmSettings = { url: '/llm/v1/', model: 'main', voiceModel: 'voice', embedModel: 'embed', thinking: 'off' };
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
describe('проверка первого запуска', () => {
  it('проверяет обе выбранные роли и получает фактическую размерность embeddings', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(respond({ choices: [{ message: { content: 'готово' } }] })).mockResolvedValueOnce(respond({ choices: [{ message: { content: 'готово' } }] })).mockResolvedValueOnce(respond({ data: [{ embedding: [0.2, -0.1, 0.3] }] }));
    const result = await probeSetup(settings, fetcher);
    expect(fetcher.mock.calls.map(([url, opts]) => [url, JSON.parse(String(opts?.body)).model])).toEqual([['/llm/v1/chat/completions', 'main'], ['/llm/v1/chat/completions', 'voice'], ['/llm/v1/embeddings', 'embed']]);
    expect(result.at(-1)).toEqual({ role: 'Embeddings', model: 'embed', dims: 3 });
    expect(settings.embedDims).toBeUndefined();
  });
  it('не принимает автоматический выбор и не делает запросов без всех моделей', async () => {
    const fetcher = vi.fn<typeof fetch>();
    for (const patch of [{ model: '' }, { voiceModel: '' }, { embedModel: 'off' }]) await expect(probeSetup({ ...settings, ...patch }, fetcher)).rejects.toThrow('явно');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('не принимает список моделей вместо ответа чата и останавливается при ошибке', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(respond({ data: [{ id: 'main' }] }));
    await expect(probeSetup(settings, fetcher)).rejects.toThrow('не вернула текст');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([[], [0, 0], [null, 1], ['1', 2]].map(vector => ({ vector })))('отклоняет испорченные embeddings $vector', async ({ vector }) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(respond({ choices: [{ message: { content: 'да' } }] })).mockResolvedValueOnce(respond({ choices: [{ message: { content: 'да' } }] })).mockResolvedValueOnce(respond({ data: [{ embedding: vector }] }));
    await expect(probeSetup(settings, fetcher)).rejects.toThrow('числовой вектор');
  });
});
