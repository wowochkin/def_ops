import { describe, expect, it } from 'vitest';
import type { MapSource } from '@def-ops/core';
import { mapSummary, packageBlocked } from '../src/map-actions';

const base = { id: 'm', name: 'К', minzoom: 0, maxzoom: 16, bounds: [13, 52, 14, 53], stats: { tiles: 0, bytes: 0 } } as unknown as MapSource;

describe('«пакет ↓» в списке карт', () => {
  it('векторная карта ещё не загружена — пакета нет (причина в подсказке)', () => {
    expect(packageBlocked({ ...base, kind: 'vector', ohm: null })).toBe('Карта ещё не загружена');
  });
  it('загруженная векторная и растровые карты — пакет можно выгрузить', () => {
    expect(packageBlocked({ ...base, kind: 'vector', ohm: { bbox: [13, 52, 14, 53], cells: 16, features: 1, layers: {}, fetchedAt: '' } })).toBeNull();
    expect(packageBlocked({ ...base, kind: 'xyz' })).toBeNull();
    expect(packageBlocked({ ...base, kind: 'package' })).toBeNull();
  });
});

describe('строка карты в «Карты → Подложки»', () => {
  it('векторная: число объектов со склонением', () => {
    const ohm = { bbox: [13, 52, 14, 53], cells: 285, features: 94373, layers: {}, fetchedAt: '2026-10-15T08:09:43Z' };
    expect(mapSummary({ ...base, kind: 'vector', ohm, stats: { tiles: 324313, bytes: 137236480 } } as MapSource))
      .toMatch(/^94 373 объекта · 137\.2 МБ · данные на /);
    expect(mapSummary({ ...base, kind: 'vector', ohm: { ...ohm, features: 1 } } as MapSource)).toMatch(/^1 объект · /);
  });
  it('растровая: уровни и число тайлов со склонением', () => {
    expect(mapSummary({ ...base, kind: 'xyz', date: null, stats: { tiles: 2, bytes: 5000 } } as MapSource)).toBe('z0–16 · 2 тайла · 5 КБ');
    expect(mapSummary({ ...base, kind: 'xyz', date: '1945', stats: { tiles: 21, bytes: 2e6 } } as MapSource)).toBe('1945 · z0–16 · 21 тайл · 2.0 МБ');
  });
});
