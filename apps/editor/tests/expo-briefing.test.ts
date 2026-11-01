import { expect, it } from 'vitest';
import { emptyDocument } from '@def-ops/core';
import { BRIEFING, briefFeatures } from '../src/expo/briefing';
import { BRIEF_POINTS, briefKey } from '../src/expo/director';
import { LINES, textErrors } from '../src/expo/lines';
import type { FrontId } from '../src/expo/settings';

it('доклад обоих фронтов: каждый пункт — фраза голоса, цифры с источником, кадр карты', () => {
  for (const front of ['su_1bf', 'su_1uf'] as FrontId[]) {
    const points = BRIEFING[front];
    expect(points).toHaveLength(BRIEF_POINTS);
    expect(points.map((p) => p.title)).toEqual(['Задача фронта', 'Свои силы', 'Противник', 'Местность', 'Соседи и разграничение', 'Соотношение сил']);
    points.forEach((p, i) => {
      const say = LINES.say[briefKey(front, i)];
      expect(say?.length, `${front} ${i + 1}`).toBeGreaterThan(0);
      for (const t of say) expect(textErrors(t)).toEqual([]);
      expect(p.facts.length).toBeGreaterThan(0);
      for (const f of p.facts) expect(f.source.length, f.value).toBeGreaterThan(3);
      const [w, s, e, n] = p.map.bbox;
      expect(e > w && n > s).toBe(true);
    });
  }
});

it('знаки пункта — знаки атласа: стрелки задачи, полосы обороны, разграничение, подписи', () => {
  const doc = emptyDocument();
  const kinds = (front: FrontId, i: number) => briefFeatures(doc, BRIEFING[front][i].map, 8).map((f) => `${f.kind}:${f.preset}`);
  expect(kinds('su_1bf', 0)).toContain('arrow:atlas.p1');
  expect(kinds('su_1bf', 2).filter((k) => k === 'line:atlas.defenseDouble')).toHaveLength(4);
  expect(kinds('su_1uf', 4)).toContain('line:rkka.boundaryFront');
});
