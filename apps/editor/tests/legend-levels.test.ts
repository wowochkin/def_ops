import { describe, expect, it } from 'vitest';
import type { MapDocument } from '@def-ops/core';
import { analyze, contextFrom, runToDocument } from '@def-ops/sim';
import { loadHistory, loadProfile, loadRules, loadScenario, loadTheatre } from '../../../packages/sim/src/data';
import { legendGaps } from '../src/map-legend';
import { withLevel } from '../src/map-levels';
import type { LevelId } from '../src/map-level-scale';

const get = (kind: string, file: string) => {
  const id = file.replace(/\.json$/, '');
  if (kind === 'scenarios') return id.endsWith('.history') ? loadHistory(id.replace('.history', '')) : loadScenario(id);
  if (kind === 'theatres') return loadTheatre(id);
  if (kind === 'profiles') return loadProfile(id);
  return loadRules(id);
};

// агентная модель — scripts/legend-check.ts (нужно ядро target/release/agents-game)
describe('легенда сходится с картой на всех уровнях (Берлинская, нынешняя модель, каждые сутки)', async () => {
  const { ctx, history } = await contextFrom(get as never, 'berlin-1945-tasks');
  const doc = runToDocument(ctx, analyze(ctx, history, { seed: 1, runs: 1 }).run, history, { name: 'проверка' });
  const all: MapDocument = { ...doc, layers: doc.layers.map((l) => ({ ...l, visible: true })) };
  const times: string[] = [];
  for (let t = Date.parse(`${doc.timeline!.start}:00Z`); t <= Date.parse(`${doc.timeline!.end}:00Z`); t += 86_400_000) times.push(new Date(t).toISOString().slice(0, 16));
  for (const level of ['stavka', 'front', 'army', 'corps', 'division'] as LevelId[]) {
    it(level, () => {
      const shown = withLevel(all, level);
      for (const t of times) expect({ t, ...legendGaps(shown, all, level, t) }).toEqual({ t, uncovered: [], empty: [], missing: [] });
    });
  }
}, 120_000);
