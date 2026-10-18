// Наложения при незагруженном стиле: один ожидающий обработчик 'idle', сколько бы раз ни меняли наложения.
import { describe, expect, it, vi } from 'vitest';
import { idleOnce } from '../src/engine/idle-once';

describe('idleOnce', () => {
  const fake = () => {
    const cbs: (() => void)[] = [];
    return { once: vi.fn((_ev: 'idle', cb: () => void) => { cbs.push(cb); }), fire: () => { const l = cbs.splice(0); l.forEach((c) => c()); }, count: () => cbs.length };
  };
  it('десять запросов подряд — один обработчик; на idle — одна синхронизация', () => {
    const m = fake(), run = vi.fn();
    const later = idleOnce(m, run);
    for (let i = 0; i < 10; i++) later();
    expect(m.once).toHaveBeenCalledTimes(1);
    m.fire();
    expect(run).toHaveBeenCalledTimes(1);
  });
  it('после срабатывания — снова можно ждать', () => {
    const m = fake(), run = vi.fn();
    const later = idleOnce(m, run);
    later(); m.fire(); later(); later(); m.fire();
    expect(m.once).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenCalledTimes(2);
  });
});
