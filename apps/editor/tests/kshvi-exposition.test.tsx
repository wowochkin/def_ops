// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAudiencePolicy } from '../../../packages/kshvi/src/exposition/audience-policy';
import { controlExposition, startAutonomousShow } from '../../../packages/kshvi/src/exposition/exposition-session';
import { expositionProgram, officialArchive } from '../../../packages/kshvi/tests/fixtures/exposition';
import { createProjectorProfile, projectExpositionForAudience } from '../../../services/kshvi/src/exposition/exposition-projection';
import { ExpositionEditor } from '../src/modern/kshvi/exposition/ExpositionEditor';
import { PresenterWorkspace } from '../src/modern/kshvi/exposition/PresenterWorkspace';

afterEach(cleanup);

function setup() {
  const program = expositionProgram();
  const initial = startAutonomousShow({
    sourceArchive: officialArchive(), program, seed: 42,
    sessionId: 'ui-show', branchId: 'ui-exposition-branch',
  });
  const session = controlExposition(initial, { type: 'SEEK', atMs: 1_000 });
  const policy = createAudiencePolicy({
    id: 'ui-audience-policy', allowedLayers: ['weather', 'terrain', 'logistics', 'modern-symbols'],
    showPlanFact: true, showExplanations: true, publicCaptionIds: ['caption-public'], publicDecisionIds: [],
  });
  const projector = createProjectorProfile({
    id: 'ui-projector', allowedLayers: ['weather', 'terrain', 'logistics', 'modern-symbols'],
  });
  const projection = projectExpositionForAudience({ session, policy, projector });
  return { program, session, projection };
}

describe('рабочее место ведущего экспозиции', () => {
  it('управляет показом, решением и продолжением без действий официальной оценки', () => {
    const { session, projection } = setup();
    const onSessionChange = vi.fn();
    const onContinue = vi.fn();
    render(<PresenterWorkspace
      session={session}
      projection={projection}
      onSessionChange={onSessionChange}
      onContinueFromCheckpoint={onContinue}
    />);

    expect(screen.getAllByText('Экспозиция').length).toBeGreaterThan(0);
    expect(screen.getByText('Автономный расчёт')).toBeTruthy();
    expect(screen.getByText('Погода: Пасмурно, видимость 8 км')).toBeTruthy();
    expect(screen.getByText('Местность: Лес и рубеж высоты')).toBeTruthy();
    expect(screen.getByText('МТО: Склад и маршрут подвоза')).toBeTruthy();
    expect(screen.getByText('Батальон')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /оцен/i })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Запустить показ' }));
    expect(onSessionChange.mock.lastCall?.[0].playback.status).toBe('PLAYING');
    fireEvent.click(screen.getByRole('button', { name: 'Ускорить ×2' }));
    expect(onSessionChange.mock.lastCall?.[0].playback.tempo).toBe(2);
    fireEvent.click(screen.getByRole('button', { name: 'Развитие действий' }));
    expect(onSessionChange.mock.lastCall?.[0].playback.chapterId).toBe('chapter-2');
    fireEvent.click(screen.getByRole('button', { name: 'Открыть решение' }));
    expect(screen.getByText('Закрытое обоснование решения')).toBeTruthy();
    expect(screen.getByText('Замысел: Удержать исходный рубеж')).toBeTruthy();
    expect(screen.getByText('Факт: Рубеж удержан')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Продолжить от контрольной точки' }));
    expect(onContinue).toHaveBeenCalledWith('cp-1');
  });

  it('предпросмотр показывает ровно аудиторную проекцию без скрытых полей ведущего', () => {
    const { session, projection } = setup();
    render(<PresenterWorkspace session={session} projection={projection} onSessionChange={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Открыть решение' }));
    expect(screen.getByText('Закрытое обоснование решения')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Предпросмотр аудитории' }));
    expect(screen.queryByText('Закрытое обоснование решения')).toBeNull();
    expect(screen.queryByText('Служебный замысел ведущего')).toBeNull();
    expect(screen.getByText('Проекторный профиль: ui-projector')).toBeTruthy();
    expect(screen.getByText('Пояснение для аудитории')).toBeTruthy();
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
