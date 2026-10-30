// @vitest-environment happy-dom
// Связки React окна командования: смена пункта снимает выбор точек, возврат к ходу (новая линия игры) снимает варианты.
import { cleanup, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useLineReset, usePickOnPost } from '../src/command-hooks';

afterEach(cleanup);

describe('выбор точек при смене пункта управления', () => {
  const use = (p: { issuer: string | null; level: string }) => {
    const [pick, setPick] = useState<{ kind: string } | null>({ kind: 'petition' });
    usePickOnPost(p.issuer, p.level, setPick);
    return pick;
  };
  it('тот же пункт — выбор остаётся; другой пункт или уровень — снят', () => {
    const r = renderHook(use, { initialProps: { issuer: 'su_1bf', level: 'front' } });
    expect(r.result.current).toEqual({ kind: 'petition' });
    r.rerender({ issuer: 'su_1bf', level: 'front' });
    expect(r.result.current).toEqual({ kind: 'petition' });
    r.rerender({ issuer: 'su_1uf', level: 'front' });
    expect(r.result.current).toBeNull();
  });
  it('смена уровня — выбор снят', () => {
    const r = renderHook(use, { initialProps: { issuer: 'su_1bf', level: 'front' } });
    r.rerender({ issuer: 'su_1bf', level: 'army' });
    expect(r.result.current).toBeNull();
  });
});

describe('варианты советника при возврате к ходу', () => {
  it('новая линия игры — варианты сняты; открытие окна и перерисовка — нет', () => {
    const reset = vi.fn();
    const r = renderHook(({ epoch }) => useLineReset(epoch, reset), { initialProps: { epoch: 0 } });
    expect(reset).not.toHaveBeenCalled();
    r.rerender({ epoch: 0 });
    expect(reset).not.toHaveBeenCalled();
    r.rerender({ epoch: 1 });
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
