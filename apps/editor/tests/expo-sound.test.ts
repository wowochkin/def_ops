import { describe, expect, it } from 'vitest';
import { cuesFor, levels } from '../src/expo/sound';
import { initialState, type DirectorState } from '../src/expo/director';

const st = (phase: DirectorState['phase'], patch: Partial<DirectorState> = {}) => ({ ...initialState(0), phase, ...patch }) as DirectorState;
const choose = (deadline: number, now: number) => st({ kind: 'turn', n: 1, step: 'choose', deadline, replacements: 0 } as DirectorState['phase'], { now });

describe('звук стенда', () => {
  it('звуки на смену фаз', () => {
    expect(cuesFor(st({ kind: 'attract' }), st({ kind: 'welcome' }))).toEqual(['touch']);
    expect(cuesFor(st({ kind: 'welcome' }), st({ kind: 'briefing' }))).toEqual(['choose']);
    expect(cuesFor(choose(10_000, 0), st({ kind: 'turn', n: 1, step: 'scroll', choice: 0 } as DirectorState['phase']))).toEqual(['choose']);
    expect(cuesFor(st({ kind: 'turn', n: 3, step: 'scroll', choice: 0 } as DirectorState['phase']), st({ kind: 'result' }))).toEqual(['reveal']);
    expect(cuesFor(null, st({ kind: 'attract' }))).toEqual([]);
  });

  it('последние 10 с таймера — щелчок раз в секунду; события хода — удар', () => {
    expect(cuesFor(choose(20_000, 0), choose(20_000, 5_000))).toEqual([]);
    expect(cuesFor(choose(20_000, 10_500), choose(20_000, 11_200))).toEqual(['tick']);
    expect(cuesFor(choose(20_000, 11_200), choose(20_000, 11_600))).toEqual([]);
    expect(cuesFor(st({ kind: 'result' }), st({ kind: 'result' }), 2)).toEqual(['event']);
  });

  it('на паузе тихо; громкость — из меню оператора', () => {
    expect(cuesFor(st({ kind: 'attract' }), st({ kind: 'welcome' }, { paused: true }))).toEqual([]);
    expect(levels({ voice: 0.8, ambient: 0.5, ambientOn: false }).ambient).toBe(0);
    expect(levels({ voice: 0.8, ambient: 0.5, ambientOn: true }).ambient).toBe(0.5);
    expect(levels({ voice: 0.8, ambient: 0, ambientOn: true }).cue).toBeCloseTo(0.1);
  });
});
