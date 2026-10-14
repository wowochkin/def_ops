import { describe, it, expect, beforeEach } from 'vitest';
import { loadHistory, saveHistory, HISTORY_KEY, type Turn } from '../src/modeling/assistant-history';

const turn = (i: number): Turn => ({ q: `вопрос ${i}`, a: `ответ ${i}`, sources: [], extra: [] });
const mem = new Map<string, string>();
const fake = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };

describe('ассистент модели: разговор в браузере', () => {
  beforeEach(() => { mem.clear(); (globalThis as { localStorage?: unknown }).localStorage = fake; });
  it('хранятся последние 20 пар', () => {
    saveHistory(Array.from({ length: 25 }, (_, i) => turn(i)));
    const h = loadHistory();
    expect(h).toHaveLength(20);
    expect(h[0].q).toBe('вопрос 5');
    expect(h[19].q).toBe('вопрос 24');
  });
  it('мусор в ключе — пустой разговор', () => {
    mem.set(HISTORY_KEY, '{не json');
    expect(loadHistory()).toEqual([]);
    mem.set(HISTORY_KEY, JSON.stringify({ q: 1 }));
    expect(loadHistory()).toEqual([]);
    mem.set(HISTORY_KEY, JSON.stringify([{ q: 'ok', a: 'да', sources: [], extra: [] }, { x: 1 }]));
    expect(loadHistory().map((t) => t.q)).toEqual(['ok']);
  });
  it('хранилище недоступно — пустой разговор, сохранение не бросает', () => {
    (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    expect(loadHistory()).toEqual([]);
    expect(() => saveHistory([turn(1)])).not.toThrow();
  });
});
