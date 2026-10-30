// «Переигровка без вмешательства» для сравнения: кэш по сценарию, seed и правкам базы; один прогон на ключ.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentTrace, OperationSummary } from '@def-ops/sim';
import { BASELINE_KEY, baselineKey, baselineSummary, rememberBaseline } from '../src/sim/baseline';

const store = new Map<string, string>();
const ls = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
const S = (seed: number) => ({ version: 1, scenario: 'berlin', seed, start: '1945-04-16T05:00', upTo: 10, over: true }) as unknown as OperationSummary;

function deps(edits: unknown = { a: 1 }) {
  const run = vi.fn(async (_sc: string, o: { seed: number }) => ({ seed: o.seed }) as unknown as AgentTrace);
  const summarize = vi.fn(async (t: AgentTrace) => S(t.seed));
  return { run, summarize, edits: async () => edits, history: async () => ({ divisions: [] }) };
}

afterEach(() => { store.clear(); vi.unstubAllGlobals(); });

describe('переигровка без вмешательства', () => {
  it('cached by scenario seed edits', async () => {
    vi.stubGlobal('localStorage', ls);
    expect(baselineKey('berlin-1945-tasks', 1, null).startsWith(`${BASELINE_KEY}:berlin-1945-tasks:1:`)).toBe(true);
    expect(baselineKey('b', 1, { x: 1 })).not.toBe(baselineKey('b', 1, { x: 2 }));
    const d = deps();
    expect((await baselineSummary('b', 1, d)).seed).toBe(1);
    expect(d.run).toHaveBeenCalledTimes(1);
    expect(d.run.mock.calls[0][1]).toMatchObject({ seed: 1, edits: { a: 1 }, command: 'intent' });
    await baselineSummary('b', 1, d);
    expect(d.run).toHaveBeenCalledTimes(1);
    // другие правки базы — новый прогон
    const d2 = deps({ a: 2 });
    await baselineSummary('b', 1, d2);
    expect(d2.run).toHaveBeenCalledTimes(1);
    // запомненная переигровка «История как замысел» — без прогона
    rememberBaseline('b', 7, { a: 1 }, S(7));
    const d3 = deps();
    expect((await baselineSummary('b', 7, d3)).seed).toBe(7);
    expect(d3.run).not.toHaveBeenCalled();
  });

  it('concurrent calls share one run', async () => {
    vi.stubGlobal('localStorage', ls);
    const d = deps({ c: 1 });
    const [a, b] = await Promise.all([baselineSummary('b', 3, d), baselineSummary('b', 3, d)]);
    expect(a.seed).toBe(3); expect(b.seed).toBe(3);
    expect(d.run).toHaveBeenCalledTimes(1);
  });

  it('storage throws', async () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('нет'); }, setItem: () => { throw new Error('нет'); } });
    const d = deps({ t: 1 });
    expect((await baselineSummary('b', 5, d)).seed).toBe(5);
    expect(() => rememberBaseline('b', 5, null, S(5))).not.toThrow();
  });
});
