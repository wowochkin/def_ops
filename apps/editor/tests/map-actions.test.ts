import { describe, expect, it } from 'vitest';
import type { MapSource } from '@def-ops/core';
import { packageBlocked } from '../src/map-actions';

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
