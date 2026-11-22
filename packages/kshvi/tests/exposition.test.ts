import { describe, expect, it } from 'vitest';
import { cameraAt, createCameraRoute } from '../src/exposition/camera-route';
import { createExpositionProgram } from '../src/exposition/exposition-program';
import {
  calculatePreparedScenario,
  continueFromCheckpoint,
  controlExposition,
  decisionAt,
  planFactAt,
  restartAutonomousShow,
  startArchiveShow,
  startAutonomousShow,
  type PresenterCommand,
} from '../src/exposition/exposition-session';
import { expositionProgram, officialArchive } from './fixtures/exposition';

describe('экспозиционные источники и ветви', () => {
  it('выполняет вероятностный расчёт без смешивания с официальным учением', () => {
    const archive = officialArchive();
    const before = JSON.stringify(archive);
    const show = startAutonomousShow({
      sourceArchive: archive,
      program: expositionProgram(),
      seed: 42,
      sessionId: 'show-auto-1',
      branchId: 'exposition-branch-1',
    });

    expect(show.purpose).toBe('EXPOSITION');
    expect(show.label).toBe('Экспозиция');
    expect(show.branchId).not.toBe(archive.branchId);
    expect(show.officialAssessmentCreated).toBe(false);
    expect(show.seed).toBe(42);
    expect(show.journal.map(event => event.eventId)).toEqual(['demo-event-1', 'demo-event-2']);
    expect(show.world.resources.fuel.onHand).toBe(100);
    expect(show.randomOutcomesCreated).toBeGreaterThan(0);
    expect(show.rng).toMatchObject({ version: 'exposition-rng-v1', seed: 42, branchId: 'exposition-branch-1' });
    expect(show.checkpoints.every(checkpoint => checkpoint.rng?.version === 'exposition-rng-v1')).toBe(true);
    expect(show.checkpoints.map(checkpoint => checkpoint.scenarioCursor)).toEqual([1, 2]);
    expect(show.calculation!.catalog).toEqual({ id: 'modern-events', version: 'catalog-1' });
    expect(show.calculation!.systemSides.map(side => side.agentId)).toEqual(['agent-blue', 'agent-red']);
    expect(show.calculation!.rules.profileVersion).toBe('full-simulation-1');
    expect(JSON.stringify(archive)).toBe(before);
    expect(archive.officialAssessments).toEqual([{ id: 'official-assessment-1', score: 4 }]);
  });

  it('изменяет расчёт от seed и branch, сохраняя повторяемость одинаковой линии', () => {
    const start = (seed: number, branchId: string) => startAutonomousShow({
      sourceArchive: officialArchive(), program: expositionProgram(), seed, branchId,
      sessionId: `show-${branchId}`,
    });
    const base = start(42, 'exposition-base');
    const same = start(42, 'exposition-base');
    const otherSeed = start(43, 'exposition-base');
    const otherBranch = start(42, 'exposition-other');

    expect(base.journal).toEqual(same.journal);
    expect(base.checkpoints).toEqual(same.checkpoints);
    expect(otherSeed.journal).not.toEqual(base.journal);
    expect(otherBranch.journal).not.toEqual(base.journal);
    expect(otherSeed.randomOutcomesCreated).toBe(base.randomOutcomesCreated);
  });

  it('восстанавливает версионный RNG и мир на checkpoint без повторения префикса', () => {
    const archive = officialArchive();
    const full = calculatePreparedScenario({
      scenario: archive.demonstration, seed: 42, branchId: 'exposition-rng-restore',
    });
    const checkpoint = full.checkpoints[0];
    const continued = calculatePreparedScenario({
      scenario: archive.demonstration, seed: 42, branchId: 'exposition-rng-restore', fromCheckpoint: checkpoint,
    });
    expect(continued.journal).toEqual(full.journal.slice(1));
    expect(continued.world).toEqual(full.world);
    expect(continued.rng).toEqual(full.rng);
    expect(continued.journal[0].sequence).toBe(2);
    expect(continued.randomOutcomesCreated).toBeGreaterThan(0);
  });

  it('архивный показ восстанавливает мир из журнала на текущий atMs и не создаёт случайных исходов', () => {
    const archive = officialArchive();
    const before = JSON.stringify(archive);
    const initial = startArchiveShow({
      sourceArchive: archive,
      program: expositionProgram(),
      sessionId: 'show-archive-1',
      branchId: 'exposition-archive-branch-1',
    });

    expect(initial.world.resources.fuel.onHand).toBe(100);
    const atEvent = controlExposition(initial, { type: 'SEEK', atMs: 1_000 });
    expect(atEvent.world.resources.fuel).toEqual({ onHand: 95, consumed: 5, supplied: 0, deficit: 0 });
    expect(controlExposition(atEvent, { type: 'SEEK', atMs: 0 }).world.resources.fuel.onHand).toBe(100);
    expect(controlExposition(atEvent, { type: 'SEEK', atMs: 2_500 }).world.resources.fuel.onHand).toBe(95);
    expect(initial.journal).toEqual(archive.journal);
    expect(initial.journal).not.toBe(archive.journal);
    expect(initial.randomOutcomesCreated).toBe(0);
    expect(initial.seed).toBeNull();
    expect(initial.officialAssessmentCreated).toBe(false);
    expect(JSON.stringify(archive)).toBe(before);
    expect(() => continueFromCheckpoint(initial, 'archive-cp')).toThrow('только для автономного');
  });

  it('продолжает разрешённую точку и повторяет сохранённую линию или явно создаёт новую', () => {
    const initial = startAutonomousShow({
      sourceArchive: officialArchive(), program: expositionProgram(), seed: 42,
      sessionId: 'show-auto-1', branchId: 'exposition-branch-1',
    });
    const continued = continueFromCheckpoint(initial, 'cp-1', {
      sessionId: 'show-auto-continued', branchId: 'exposition-branch-continued',
    });
    expect(continued.branchId).toBe('exposition-branch-continued');
    expect(continued.origin.parentBranchId).toBe('exposition-branch-1');
    expect(continued.origin.checkpointId).toBe('cp-1');
    expect(continued.journal.map(event => event.eventId)).toEqual(['demo-event-1', 'demo-event-2']);
    expect(continued.checkpoints.map(checkpoint => checkpoint.id)).toEqual(['cp-1', 'cp-2']);
    expect(continued.journal[1].payload).not.toEqual(initial.journal[1].payload);
    expect(continued.world.resources.fuel.onHand).toBe(continued.checkpoints[0].world.resources.fuel.onHand);
    expect(() => continueFromCheckpoint(initial, 'cp-2')).toThrow('не разрешена');

    const replayed = restartAutonomousShow(continued, { mode: 'REPLAY_SAVED_LINE', sessionId: 'show-replayed' });
    expect(replayed.sessionId).not.toBe(continued.sessionId);
    expect(replayed.branchId).toBe(continued.branchId);
    expect(replayed.seed).toBe(continued.seed);
    expect(replayed.journal).toEqual(continued.journal);
    expect(replayed.randomOutcomesCreated).toBe(0);
    expect(replayed.playback.atMs).toBe(0);
    expect(controlExposition(replayed, { type: 'SEEK', atMs: 3_000 }).world)
      .toEqual(controlExposition(continued, { type: 'SEEK', atMs: 3_000 }).world);

    const fresh = restartAutonomousShow(continued, {
      mode: 'NEW_BRANCH', seed: 43, sessionId: 'show-fresh', branchId: 'exposition-branch-fresh',
    });
    expect(fresh.branchId).toBe('exposition-branch-fresh');
    expect(fresh.seed).toBe(43);
    expect(fresh.origin.parentBranchId).toBe('exposition-branch-continued');
    expect(fresh.journal).not.toEqual(continued.journal);
  });
});

describe('программа, камера и управление ведущего', () => {
  it('интерполирует маршрут камеры и ограничивает его границами показа', () => {
    const route = createCameraRoute([
      { id: 'a', atMs: 1_000, center: [10, 20], zoom: 5, heading: 0 },
      { id: 'b', atMs: 3_000, center: [30, 40], zoom: 9, heading: 90 },
    ]);
    expect(cameraAt(route, 2_000)).toEqual({ atMs: 2_000, center: [20, 30], zoom: 7, heading: 45 });
    expect(cameraAt(route, -1).center).toEqual([10, 20]);
    expect(cameraAt(route, 4_000).center).toEqual([30, 40]);
  });

  it('проверяет общую карту и разрешает изменять видимые слои, но не пустую проекцию', () => {
    const program = expositionProgram();
    expect(() => createExpositionProgram({ ...program, layers: [] })).toThrow('общей карты');
    expect(createExpositionProgram({ ...program, layers: ['terrain', 'modern-symbols'] }).layers).toEqual(['terrain', 'modern-symbols']);
    expect(() => createExpositionProgram({
      ...program,
      chapters: [program.chapters[1], program.chapters[0]],
    })).toThrow('хронологическом');
  });

  it('ведёт часы с темпом и паузами глав, перемоткой и синхронным миром', () => {
    const initial = startArchiveShow({
      sourceArchive: officialArchive(), program: expositionProgram(),
      sessionId: 'show-archive-1', branchId: 'exposition-archive-branch-1',
    });
    const playing = controlExposition(initial, { type: 'PLAY' });
    const at250 = controlExposition(playing, { type: 'ADVANCE', elapsedMs: 250 });
    expect(at250.playback.atMs).toBe(250);
    expect(controlExposition(at250, { type: 'PAUSE' }).playback.status).toBe('PAUSED');
    expect(controlExposition(controlExposition(at250, { type: 'PAUSE' }), { type: 'ADVANCE', elapsedMs: 500 }).playback.atMs).toBe(250);

    const accelerated = controlExposition(at250, { type: 'SET_TEMPO', tempo: 2 });
    const at750 = controlExposition(accelerated, { type: 'ADVANCE', elapsedMs: 250 });
    expect(at750.playback.atMs).toBe(750);
    const chapterPause = controlExposition(accelerated, { type: 'ADVANCE', elapsedMs: 375 });
    expect(chapterPause.playback).toMatchObject({ atMs: 1_000, pauseRemainingMs: 500, status: 'PLAYING' });
    const stillPaused = controlExposition(chapterPause, { type: 'ADVANCE', elapsedMs: 250 });
    expect(stillPaused.playback).toMatchObject({ atMs: 1_000, pauseRemainingMs: 250 });
    const resumed = controlExposition(stillPaused, { type: 'ADVANCE', elapsedMs: 250 });
    expect(resumed.playback).toMatchObject({ atMs: 1_000, pauseRemainingMs: 0, chapterId: 'chapter-2' });
    const at2000 = controlExposition(resumed, { type: 'ADVANCE', elapsedMs: 500 });
    expect(at2000.playback.atMs).toBe(2_000);
    expect(at2000.world.resources.fuel.onHand).toBe(95);
    expect(controlExposition(at2000, { type: 'SEEK_CHAPTER', chapterId: 'chapter-1' }).playback).toMatchObject({
      atMs: 0, chapterId: 'chapter-1',
    });
    expect(controlExposition(at2000, { type: 'SEEK', atMs: 0 }).world.resources.fuel.onHand).toBe(100);
    expect(planFactAt(at2000, 1_000)).toEqual({ id: 'comparison-1', atMs: 1_000, plan: 'Удержать исходный рубеж', fact: 'Рубеж удержан' });
    expect(decisionAt(at2000, 'decision-1')).toMatchObject({ summary: 'Удерживать рубеж', hiddenRationale: 'Закрытое обоснование решения' });
  });

  it('даёт бит-в-бит одинаковый архивный повтор по одинаковой последовательности часов', () => {
    const commands: readonly PresenterCommand[] = [
      { type: 'PLAY' }, { type: 'SET_TEMPO', tempo: 4 }, { type: 'ADVANCE', elapsedMs: 100 },
      { type: 'ADVANCE', elapsedMs: 250 }, { type: 'ADVANCE', elapsedMs: 500 },
      { type: 'SEEK', atMs: 1_500 }, { type: 'PAUSE' },
    ];
    const run = () => commands.reduce((show, command) => controlExposition(show, command), startArchiveShow({
      sourceArchive: officialArchive(), program: expositionProgram(),
      sessionId: 'archive-repeat', branchId: 'archive-repeat-branch',
    }));
    const first = run();
    const second = run();
    expect(second.playback).toEqual(first.playback);
    expect(second.world).toEqual(first.world);
    expect(second.journal).toEqual(first.journal);
  });
});
