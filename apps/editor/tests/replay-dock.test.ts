import { describe, expect, it } from 'vitest';
import { CHART_KEY, PLAYER_SPEEDS, readOpen } from '../src/replay-dock';

describe('плеер и колонка у левого края', () => {
  it('скорости — 1, 3, 6, 12, 24, 48 ч/с', () => { expect([...PLAYER_SPEEDS]).toEqual([1, 3, 6, 12, 24, 48]); });
  it('раскрыт ли график: помнится, без хранилища — по умолчанию', () => {
    expect(readOpen(CHART_KEY, true, { getItem: () => 'closed' })).toBe(false);
    expect(readOpen(CHART_KEY, false, { getItem: () => 'open' })).toBe(true);
    expect(readOpen(CHART_KEY, true, null)).toBe(true);
    expect(readOpen(CHART_KEY, true, { getItem: () => { throw new Error('нет доступа'); } })).toBe(true);
  });
});
