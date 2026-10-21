import { afterEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
const { checkLlm, directFail } = await import('../src/shared');

afterEach(() => { vi.unstubAllGlobals(); vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} }); });

describe('проверка связи с моделью: понятные причины', () => {
  it('полный адрес, окно не достучалось (Load failed) — что делать', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Load failed')));
    const r = await checkLlm('http://localhost:1235/v1');
    expect(r).toEqual({ state: 'fail', error: directFail('http://localhost:1235/v1') });
    expect((r as { error: string }).error).toContain('DEFOPS_LLM_URL=http://localhost:1235/v1');
    expect((r as { error: string }).error).toContain('/llm/v1');
  });
  it('/llm/v1 и 502 — LM Studio не запущен, где поменять порт', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve({ ok: false, status: 502 }));
    const r = await checkLlm('/llm/v1');
    expect((r as { error: string }).error).toMatch(/^сервер ответил 502: LM Studio не отвечает/);
    expect((r as { error: string }).error).toContain('DEFOPS_LLM_URL');
  });
  it('другие коды и относительный адрес без сети — как раньше', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve({ ok: false, status: 404 }));
    expect(await checkLlm('/llm/v1')).toEqual({ state: 'fail', error: 'сервер ответил 404' });
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Load failed')));
    expect(await checkLlm('/llm/v1')).toEqual({ state: 'fail', error: 'Load failed' });
  });
});
