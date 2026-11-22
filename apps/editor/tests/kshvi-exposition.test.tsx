// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAudiencePolicy } from '../../../packages/kshvi/src/exposition/audience-policy';
import {
  controlExposition,
  createExpositionProgram,
  startArchiveShow,
  startAutonomousShow,
  type ExpositionPresenterSession,
  type ExpositionSession,
} from '../../../packages/kshvi/src/exposition/browser-entry';
import { expositionProgram, officialArchive, testFullSimulation } from '../../../packages/kshvi/tests/fixtures/exposition';
import { createProjectorProfile, projectExpositionForAudience } from '../../../services/kshvi/src/exposition/exposition-projection';
import { BrowserExpositionApp } from '../src/modern/kshvi/exposition/browser-entry';
import { ExpositionEditor } from '../src/modern/kshvi/exposition/ExpositionEditor';
import { PresenterWorkspace } from '../src/modern/kshvi/exposition/PresenterWorkspace';
import type { ExpositionApi } from '../src/modern/kshvi/exposition/exposition-client';

vi.mock('../src/modern/kshvi/exposition/ExpositionMap', () => ({
  ExpositionMap: (props: { camera: { center: readonly number[]; zoom: number; heading: number } }) => <div
    data-testid="exposition-maplibre"
    data-center={props.camera.center.join(',')}
    data-zoom={props.camera.zoom}
    data-heading={props.camera.heading}
  />,
}));

afterEach(cleanup);

function presenter(session: ExpositionSession): ExpositionPresenterSession {
  const { sourceArchive: _sourceArchive, officialAssessments: _officialAssessments, ...view } = session;
  return view;
}

function setup() {
  const program = expositionProgram();
  const initial = startAutonomousShow({ calculate: testFullSimulation,
    sourceArchive: officialArchive(), program, seed: 42,
    sessionId: 'ui-show', branchId: 'ui-exposition-branch',
  });
  const session = controlExposition(initial, { type: 'SEEK', atMs: 1_000 });
  const policy = createAudiencePolicy({
    id: 'ui-audience-policy', allowedLayers: ['weather', 'terrain', 'logistics', 'modern-symbols'],
    showPlanFact: true, showExplanations: true, publicCaptionIds: ['caption-public'], publicExplanationIds: ['explanation-public'], publicDecisionIds: [],
  });
  const projector = createProjectorProfile({
    id: 'ui-projector', allowedLayers: ['weather', 'terrain', 'logistics', 'modern-symbols'],
  });
  const projection = projectExpositionForAudience({ session, policy, projector });
  return { program, session: presenter(session), projection, policy, projector };
}

describe('рабочее место ведущего экспозиции', () => {
  it('отправляет команды на сервер и открывает checkpoints, повтор линии и новую ветвь', () => {
    const { session, projection } = setup();
    const onCommand = vi.fn();
    const onContinue = vi.fn();
    const onRestart = vi.fn();
    render(<PresenterWorkspace
      session={session}
      projection={projection}
      onCommand={onCommand}
      onContinueFromCheckpoint={onContinue}
      onRestart={onRestart}
    />);

    expect(screen.getAllByText('Экспозиция').length).toBeGreaterThan(0);
    expect(screen.getByText('Автономный расчёт')).toBeTruthy();
    expect(screen.getByText('Погода: Пасмурно, видимость 8 км')).toBeTruthy();
    expect(screen.getByText('Местность: Лес и рубеж высоты')).toBeTruthy();
    expect(screen.getByText('МТО: Склад и маршрут подвоза')).toBeTruthy();
    expect(screen.getByText('Батальон')).toBeTruthy();
    expect(screen.getByTestId('exposition-maplibre').getAttribute('data-center')).toBe('31,51');
    expect(screen.queryByRole('button', { name: /оцен/i })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Запустить показ' }));
    expect(onCommand).toHaveBeenLastCalledWith({ type: 'PLAY' });
    fireEvent.click(screen.getByRole('button', { name: 'Ускорить ×2' }));
    expect(onCommand).toHaveBeenLastCalledWith({ type: 'SET_TEMPO', tempo: 2 });
    fireEvent.click(screen.getByRole('button', { name: 'Развитие действий' }));
    expect(onCommand).toHaveBeenLastCalledWith({ type: 'SEEK_CHAPTER', chapterId: 'chapter-2' });
    fireEvent.click(screen.getByRole('button', { name: 'Открыть решение' }));
    expect(screen.getByText('Закрытое обоснование решения')).toBeTruthy();
    expect(screen.getByText('Замысел: Удержать исходный рубеж')).toBeTruthy();
    expect(screen.getByText('Факт: Рубеж удержан')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Продолжить от контрольной точки' }));
    expect(onContinue).toHaveBeenCalledWith('cp-1');
    fireEvent.click(screen.getByRole('button', { name: 'Повторить сохранённую линию' }));
    expect(onRestart).toHaveBeenLastCalledWith('REPLAY_SAVED_LINE');
    fireEvent.click(screen.getByRole('button', { name: 'Новая ветвь' }));
    expect(onRestart).toHaveBeenLastCalledWith('NEW_BRANCH');
  });

  it('предпросмотр показывает ровно аудиторную проекцию без скрытых полей ведущего', () => {
    const { session, projection } = setup();
    render(<PresenterWorkspace session={session} projection={projection} onCommand={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Открыть решение' }));
    expect(screen.getByText('Закрытое обоснование решения')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Предпросмотр аудитории' }));
    expect(screen.queryByText('Закрытое обоснование решения')).toBeNull();
    expect(screen.queryByText('Служебный замысел ведущего')).toBeNull();
    expect(screen.getByText('Проекторный профиль: ui-projector')).toBeTruthy();
    expect(screen.getByText('Пояснение для аудитории')).toBeTruthy();
  });
});

describe('подключённый browser entry', () => {
  it('запускает ARCHIVE/AUTONOMOUS через API и повторно валидирует слои редактора', async () => {
    const archive = presenter(startArchiveShow({
      sourceArchive: officialArchive(), program: expositionProgram(), sessionId: 'ui-archive', branchId: 'ui-archive-branch',
    }));
    const autonomous = presenter(startAutonomousShow({ calculate: testFullSimulation,
      sourceArchive: officialArchive(), program: expositionProgram(), seed: 42, sessionId: 'ui-auto', branchId: 'ui-auto-branch',
    }));
    const { policy, projector } = setup();
    const sessions = new Map([[archive.sessionId, archive], [autonomous.sessionId, autonomous]]);
    const fullSessions = new Map<string, ExpositionSession>([
      [archive.sessionId, startArchiveShow({ sourceArchive: officialArchive(), program: expositionProgram(), sessionId: archive.sessionId, branchId: archive.branchId })],
      [autonomous.sessionId, startAutonomousShow({ calculate: testFullSimulation, sourceArchive: officialArchive(), program: expositionProgram(), seed: 42, sessionId: autonomous.sessionId, branchId: autonomous.branchId })],
    ]);
    const client: ExpositionApi = {
      start: vi.fn(async input => input.source === 'ARCHIVE' ? archive : autonomous),
      presenter: vi.fn(async id => sessions.get(id)!),
      command: vi.fn(async (id, command) => {
        const next = presenter(controlExposition(fullSessions.get(id)!, command));
        sessions.set(id, next); fullSessions.set(id, next as ExpositionSession); return next;
      }),
      continueFromCheckpoint: vi.fn(),
      restart: vi.fn(),
      updateProgram: vi.fn(async (id, program) => {
        const next = { ...sessions.get(id)!, program: createExpositionProgram(program) };
        sessions.set(id, next);
        fullSessions.set(id, { ...fullSessions.get(id)!, program: next.program });
        return next;
      }),
      projector: vi.fn(async id => projectExpositionForAudience({ session: fullSessions.get(id)!, policy, projector })),
      presenterProjection: vi.fn(async id => projectExpositionForAudience({ session: fullSessions.get(id)!, policy, projector })),
      activeProjector: vi.fn(async () => projectExpositionForAudience({ session: fullSessions.get('ui-auto')!, policy, projector })),
      exportArchive: vi.fn(),
    };
    render(<BrowserExpositionApp client={client} />);
    await screen.findByText('Ветвь: ui-archive-branch');
    expect(client.start).toHaveBeenCalledWith(expect.objectContaining({ source: 'ARCHIVE' }));

    fireEvent.click(screen.getByRole('button', { name: 'Автономный расчёт' }));
    await screen.findByText('Ветвь: ui-auto-branch');
    expect(client.start).toHaveBeenCalledWith(expect.objectContaining({ source: 'AUTONOMOUS', seed: 42 }));
    fireEvent.click(screen.getByRole('button', { name: 'Редактор программы' }));
    fireEvent.click(await screen.findByLabelText('Погода'));
    await waitFor(() => expect(client.updateProgram).toHaveBeenCalled());
    expect(vi.mocked(client.updateProgram).mock.lastCall?.[1].layers).not.toContain('weather');
    await waitFor(() => expect(vi.mocked(client.presenterProjection).mock.lastCall?.[0]).toBe('ui-auto'));
  });
});

describe('редактор экспозиционной программы', () => {
  it('редактирует главы, камеру, слои, темп, паузы, подписи, пояснения и ветви', () => {
    const program = expositionProgram();
    const onChange = vi.fn();
    render(<ExpositionEditor program={program} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('Темп показа'), { target: { value: '2' } });
    expect(onChange.mock.lastCall?.[0].tempo).toBe(2);
    fireEvent.change(screen.getByLabelText('Пауза после показа, мс'), { target: { value: '750' } });
    expect(onChange.mock.lastCall?.[0].pauseMs).toBe(750);
    fireEvent.click(screen.getByLabelText('Погода'));
    expect(onChange.mock.lastCall?.[0].layers).not.toContain('weather');
    fireEvent.click(screen.getByRole('button', { name: 'Добавить главу' }));
    expect(onChange.mock.lastCall?.[0].chapters).toHaveLength(3);
    fireEvent.change(screen.getByLabelText('Масштаб камеры 1'), { target: { value: '7' } });
    expect(onChange.mock.lastCall?.[0].cameraRoute.keyframes[0].zoom).toBe(7);
    fireEvent.change(screen.getByLabelText('Подпись для аудитории'), { target: { value: 'Новая подпись' } });
    expect(onChange.mock.lastCall?.[0].captions[0].text).toBe('Новая подпись');
    fireEvent.change(screen.getByLabelText('Пояснение ведущего'), { target: { value: 'Новое пояснение' } });
    expect(onChange.mock.lastCall?.[0].explanations[0].text).toBe('Новое пояснение');
    fireEvent.click(screen.getByRole('button', { name: 'Добавить ветвь' }));
    expect(onChange.mock.lastCall?.[0].branches).toHaveLength(2);
  });
});
