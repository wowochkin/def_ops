// @vitest-environment happy-dom
import { act } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAudiencePolicy } from '../../../packages/kshvi/src/exposition/audience-policy';
import { controlExposition, startArchiveShow, type ExpositionPresenterSession, type ExpositionSession } from '../../../packages/kshvi/src/exposition/exposition-session';
import { expositionProgram, officialArchive } from '../../../packages/kshvi/tests/fixtures/exposition';
import { createProjectorProfile, projectExpositionForAudience, type AudienceProjection } from '../../../services/kshvi/src/exposition/exposition-projection';
import { BrowserExpositionApp } from '../src/modern/kshvi/exposition/browser-entry';
import { ProjectorApp } from '../src/modern/kshvi/exposition/projector-entry';
import type { ExpositionApi } from '../src/modern/kshvi/exposition/exposition-client';

vi.mock('../src/modern/kshvi/exposition/ExpositionMap', () => ({ ExpositionMap: () => <div data-testid="exposition-maplibre" /> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { cleanup(); vi.useRealTimers(); });

function presenter(session: ExpositionSession): ExpositionPresenterSession {
  const { sourceArchive: _sourceArchive, officialAssessments: _officialAssessments, ...view } = session;
  return view;
}
function projection(session: ExpositionSession, generation = 1): AudienceProjection {
  const result = projectExpositionForAudience({
    session,
    policy: createAudiencePolicy({ id: 'race-policy', allowedLayers: ['weather'], showPlanFact: false, showExplanations: false, publicCaptionIds: [], publicDecisionIds: [] }),
    projector: createProjectorProfile({ id: 'exposition-projector', allowedLayers: ['weather'] }),
  });
  return { ...result, handoffGeneration: generation };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(next => { resolve = next; });
  return { promise, resolve };
}

describe('sequence защита ведущего и проектора', () => {
  it('не откатывает presenter медленным старым ответом', async () => {
    const archive = startArchiveShow({ sourceArchive: officialArchive(), program: expositionProgram(), sessionId: 'race-presenter', branchId: 'race-presenter-branch' });
    const initial = presenter(archive);
    const first = deferred<ExpositionPresenterSession>();
    const second = deferred<ExpositionPresenterSession>();
    const client: ExpositionApi = {
      start: vi.fn(async () => initial), presenter: vi.fn(async () => initial),
      command: vi.fn().mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise),
      continueFromCheckpoint: vi.fn(), restart: vi.fn(), updateProgram: vi.fn(), exportArchive: vi.fn(),
      projector: vi.fn(async () => projection(archive)), presenterProjection: vi.fn(async () => projection(archive)), activeProjector: vi.fn(async () => projection(archive)),
    };
    render(<BrowserExpositionApp client={client} />);
    await screen.findByText('Ветвь: race-presenter-branch');
    fireEvent.click(screen.getByRole('button', { name: 'Ускорить ×2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ускорить ×2' }));
    await act(async () => {
      second.resolve(presenter(controlExposition(controlExposition(archive, { type: 'SET_TEMPO', tempo: 2 }), { type: 'SET_TEMPO', tempo: 4 })));
      await second.promise;
    });
    await screen.findByText('Темп: 4×');
    await act(async () => {
      first.resolve(presenter(controlExposition(archive, { type: 'SET_TEMPO', tempo: 2 })));
      await first.promise;
    });
    expect(screen.getByText('Темп: 4×')).toBeTruthy();
    expect(screen.queryByText('Темп: 2×')).toBeNull();
  });

  it('использует active handoff и не принимает устаревшую проекцию', async () => {
    vi.useFakeTimers();
    const oldSession = startArchiveShow({ sourceArchive: officialArchive(), program: expositionProgram(), sessionId: 'old-active', branchId: 'old-branch' });
    const newSession = startArchiveShow({ sourceArchive: officialArchive(), program: { ...expositionProgram(), title: 'Новая активная ветвь' }, sessionId: 'new-active', branchId: 'new-branch' });
    const first = deferred<AudienceProjection>();
    const second = deferred<AudienceProjection>();
    const client = { activeProjector: vi.fn().mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise) };
    render(<ProjectorApp client={client} />);
    expect(client.activeProjector).toHaveBeenCalledTimes(1);
    await act(async () => { vi.advanceTimersByTime(200); });
    expect(client.activeProjector).toHaveBeenCalledTimes(2);
    await act(async () => { second.resolve(projection(newSession, 2)); await second.promise; });
    expect(screen.getAllByText('Новая активная ветвь').length).toBeGreaterThan(0);
    await act(async () => { first.resolve(projection(oldSession, 1)); await first.promise; });
    expect(screen.queryByText('Демонстрация «Рубеж»')).toBeNull();
    expect(screen.getAllByText('Новая активная ветвь').length).toBeGreaterThan(0);
  });
});
