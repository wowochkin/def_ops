import { describe, expect, it } from 'vitest';
import { cameraAt, createCameraRoute } from '../src/exposition/camera-route';
import { createExpositionProgram } from '../src/exposition/exposition-program';
import {
  continueFromCheckpoint,
  controlExposition,
  decisionAt,
  planFactAt,
  restartAutonomousShow,
  startArchiveShow,
  startAutonomousShow,
} from '../src/exposition/exposition-session';
import { expositionProgram, officialArchive } from './fixtures/exposition';

describe('экспозиционные источники и ветви', () => {
  it('не смешивает автономный показ с официальным учением', () => {
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
    expect(show.world.resources.fuel).toEqual({ onHand: 75, consumed: 30, supplied: 5, deficit: 0 });
    expect(show.calculation!.catalog).toEqual({ id: 'modern-events', version: 'catalog-1' });
    expect(show.calculation!.systemSides.map(side => side.agentId)).toEqual(['agent-blue', 'agent-red']);
    expect(show.calculation!.rules.profileVersion).toBe('full-simulation-1');
    expect(archive.manifestHash).toBe('a'.repeat(64));
    expect(JSON.stringify(archive)).toBe(before);
  });

  it('проигрывает архивный журнал без новых случайных исходов', () => {
    const archive = officialArchive();
    const before = JSON.stringify(archive);
    const show = startArchiveShow({
      sourceArchive: archive,
      program: expositionProgram(),
      sessionId: 'show-archive-1',
      branchId: 'exposition-archive-branch-1',
    });

    expect(show.source).toBe('ARCHIVE');
    expect(show.purpose).toBe('EXPOSITION');
    expect(show.journal).toEqual(archive.journal);
    expect(show.journal).not.toBe(archive.journal);
    expect(show.randomOutcomesCreated).toBe(0);
    expect(show.seed).toBeNull();
    expect(show.officialAssessmentCreated).toBe(false);
    expect(JSON.stringify(archive)).toBe(before);
    expect(() => continueFromCheckpoint(show, 'archive-cp')).toThrow('только для автономного');
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
    expect(() => continueFromCheckpoint(initial, 'cp-2')).toThrow('не разрешена');

    const replayed = restartAutonomousShow(continued, { mode: 'REPLAY_SAVED_LINE', sessionId: 'show-replayed' });
    expect(replayed.sessionId).not.toBe(continued.sessionId);
    expect(replayed.branchId).toBe(continued.branchId);
    expect(replayed.seed).toBe(continued.seed);
    expect(replayed.journal).toEqual(continued.journal);
    expect(replayed.world).toEqual(continued.world);
    expect(replayed.randomOutcomesCreated).toBe(0);

    const fresh = restartAutonomousShow(continued, {
      mode: 'NEW_BRANCH', seed: 43, sessionId: 'show-fresh', branchId: 'exposition-branch-fresh',
    });
    expect(fresh.branchId).toBe('exposition-branch-fresh');
    expect(fresh.seed).toBe(43);
    expect(fresh.origin.parentBranchId).toBe('exposition-branch-continued');
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

  it('не принимает программу без общей карты или с неупорядоченными главами', () => {
    const program = expositionProgram();
    expect(() => createExpositionProgram({ ...program, layers: [] })).toThrow('общей карты');
    expect(() => createExpositionProgram({
      ...program,
      chapters: [program.chapters[1], program.chapters[0]],
    })).toThrow('хронологическом');
  });

  it('запускает, приостанавливает, ускоряет и переводит показ к главе и моменту', () => {
    const initial = startArchiveShow({
      sourceArchive: officialArchive(), program: expositionProgram(),
      sessionId: 'show-archive-1', branchId: 'exposition-archive-branch-1',
    });
    const playing = controlExposition(initial, { type: 'PLAY' });
    expect(playing.playback.status).toBe('PLAYING');
    expect(initial.playback.status).toBe('PAUSED');
    expect(controlExposition(playing, { type: 'PAUSE' }).playback.status).toBe('PAUSED');
    expect(controlExposition(playing, { type: 'SET_TEMPO', tempo: 4 }).playback.tempo).toBe(4);
    expect(controlExposition(playing, { type: 'SEEK_CHAPTER', chapterId: 'chapter-2' }).playback).toMatchObject({
      atMs: 1_000, chapterId: 'chapter-2',
    });
    expect(controlExposition(playing, { type: 'SEEK', atMs: 1_500 }).playback.atMs).toBe(1_500);
    expect(planFactAt(playing, 1_000)).toEqual({ id: 'comparison-1', atMs: 1_000, plan: 'Удержать исходный рубеж', fact: 'Рубеж удержан' });
    expect(decisionAt(playing, 'decision-1')).toMatchObject({ summary: 'Удерживать рубеж', hiddenRationale: 'Закрытое обоснование решения' });
  });
});
