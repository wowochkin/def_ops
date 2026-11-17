import { expect, it } from 'vitest';
import { introGap, INTRO_CUES, INTRO_DURATION_MS, INTRO_FACTORS, introCueAt } from '../src/expo/intro-story';
import { LINES } from '../src/expo/lines';

it('полный беззвучный монтаж проходит каждую сцену, включая вторую половину рассказа', () => {
  let elapsed = 0;
  for (const [i, cue] of INTRO_CUES.entries()) {
    expect(introCueAt(elapsed).line).toBe(i + 1);
    expect(introCueAt(elapsed + cue.durationMs / 2).progress).toBeCloseTo(0.5);
    expect(introCueAt(elapsed + cue.durationMs - 1).line).toBe(i + 1);
    expect(LINES.say[cue.key]?.[0]).toBeTruthy();
    elapsed += cue.durationMs + introGap(i);
  }
  expect(elapsed).toBe(INTRO_DURATION_MS);
  expect(INTRO_DURATION_MS).toBe(210000);
  expect(INTRO_CUES.every(c => !/\.(?:\n|$)/.test(c.title))).toBe(true);
  expect(introCueAt(elapsed + 100000)).toMatchObject({ line: 13, progress: 1 });
  expect(introCueAt(-1000)).toMatchObject({ line: 1, progress: 0 });
});

it('монтаж охватывает все обещанные темы и не выдаёт перспективные возможности за готовые', () => {
  expect(new Set(INTRO_CUES.map((c) => c.scene)).size).toBe(13);
  expect(INTRO_CUES.map((c) => c.scene)).toEqual(['identity','demo','scale','berlin','archive','math','agents','factors','space','ai','variants','decision','final']);
  expect(INTRO_FACTORS).toContain('Реки и переправы');
  expect(INTRO_FACTORS).not.toContain('Погода');
  expect(LINES.say['intro-11'][0]).toContain('Направление развития');
});
