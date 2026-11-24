import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  calculatePreparedScenario,
  controlExposition,
  mapAtExposition,
  startArchiveShow,
} from '../src/exposition/exposition-session';
import { expositionProgram, officialArchive } from './fixtures/exposition';

const exec = promisify(execFile);
const root = resolve('.');
const sessionUrl = pathToFileURL(resolve('packages/kshvi/src/exposition/exposition-session.ts')).href;
const fixtureUrl = pathToFileURL(resolve('packages/kshvi/tests/fixtures/exposition.ts')).href;

async function advanceWithTimeout(program: unknown): Promise<{ atMs: number; status: string }> {
  const source = `
    import { controlExposition, startArchiveShow } from ${JSON.stringify(sessionUrl)};
    import { officialArchive } from ${JSON.stringify(fixtureUrl)};
    const program = ${JSON.stringify(program)};
    let show = startArchiveShow({ sourceArchive: officialArchive(), program, sessionId: 'timeout-show', branchId: 'timeout-branch' });
    for (const elapsedMs of [1000, 1000, 1000, 500]) {
      show = controlExposition(show, { type: 'PLAY' });
      show = controlExposition(show, { type: 'ADVANCE', elapsedMs });
    }
    console.log(JSON.stringify({ atMs: show.playback.atMs, status: show.playback.status }));
  `;
  const { stdout } = await exec(process.execPath, ['--import', 'tsx', '--eval', source], {
    cwd: root, timeout: 1_500, killSignal: 'SIGKILL', maxBuffer: 1024 * 64,
  });
  return JSON.parse(stdout);
}

describe('AC-28 regressions: часы без блокировки Node.js', () => {
  it('проходит разрыв между главами и завершается за конечное время', async () => {
    const base = expositionProgram();
    const program = {
      ...base,
      chapters: [
        { ...base.chapters[0], endMs: 1_000, pauseAfterMs: 0 },
        { ...base.chapters[1], startMs: 2_000, endMs: 3_000 },
      ],
    };
    const result = await advanceWithTimeout(program);
    expect(result.atMs).toBe(3_000);
    expect(result.status).toBe('PAUSED');
  }, 5_000);

  it('продвигается к кадрам после окончания последней главы', async () => {
    const base = expositionProgram();
    const program = {
      ...base,
      chapters: [{ ...base.chapters[0], endMs: 1_000, pauseAfterMs: 0 }],
      frames: [...base.frames, { id: 'frame-after', atMs: 3_000, title: 'После главы', caption: 'Финал' }],
    };
    const result = await advanceWithTimeout(program);
    expect(result.atMs).toBe(3_000);
    expect(result.status).toBe('PAUSED');
  }, 5_000);
});

describe('AC-28 regressions: решения агентов и динамическая карта', () => {
  it('запрещает автономный расчёт с нейтральной подстановкой вместо решения агента', () => {
    expect(() => calculatePreparedScenario({
      scenario: officialArchive().demonstration, seed: 42, branchId: 'missing-agent-decision',
    })).toThrow('решение системного агента');
  });

  it('пересчитывает погоду, местность, силы и МТО из журнала на atMs', () => {
    const archive = officialArchive();
    const journal = [
      ...archive.journal,
      { eventId: 'weather-1', sequence: 2, atMs: 500, type: 'map.layer.updated.v1', payload: { layer: 'weather', value: { summary: 'Ливень' } } },
      { eventId: 'terrain-1', sequence: 3, atMs: 1_500, type: 'map.layer.updated.v1', payload: { layer: 'terrain', value: { summary: 'Размытая дорога' } } },
      { eventId: 'forces-1', sequence: 4, atMs: 1_500, type: 'map.layer.updated.v1', payload: { layer: 'forces', value: { geojson: { type: 'FeatureCollection', features: [] } } } },
      { eventId: 'logistics-1', sequence: 5, atMs: 2_000, type: 'map.layer.updated.v1', payload: { layer: 'logistics', value: { summary: 'Склад недоступен' } } },
    ];
    const source = { ...archive, journal };
    const before = JSON.stringify(source);
    expect(mapAtExposition(source.map, journal, 0).weather).toEqual({ summary: 'Пасмурно, видимость 8 км' });
    expect(mapAtExposition(source.map, journal, 500).weather).toEqual({ summary: 'Ливень' });
    expect(mapAtExposition(source.map, journal, 1_500).terrain).toEqual({ summary: 'Размытая дорога' });
    expect(mapAtExposition(source.map, journal, 1_500).forces).toEqual({ geojson: { type: 'FeatureCollection', features: [] } });
    expect(mapAtExposition(source.map, journal, 2_000).logistics).toEqual({ summary: 'Склад недоступен' });
    const show = startArchiveShow({ sourceArchive: source, program: expositionProgram(), sessionId: 'map-time', branchId: 'map-time-branch' });
    const moved = controlExposition(show, { type: 'SEEK', atMs: 1_500 });
    expect(moved.map.weather).toEqual({ summary: 'Ливень' });
    expect(moved.map.terrain).toEqual({ summary: 'Размытая дорога' });
    expect(controlExposition(moved, { type: 'SEEK', atMs: 0 }).map.weather).toEqual({ summary: 'Пасмурно, видимость 8 км' });
    expect(JSON.stringify(source)).toBe(before);
  });
});
