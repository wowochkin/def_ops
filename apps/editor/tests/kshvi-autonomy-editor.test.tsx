// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { attemptsPerOperationalHour, createAutonomyProfile } from '@def-ops/kshvi-events';
import { AutonomyEditor } from '../src/modern/kshvi/preparation/AutonomyEditor';

afterEach(cleanup);

it('меняет реальную интенсивность категории и вызывает сохранение серверного профиля', () => {
  const profile = createAutonomyProfile({ profileId: 'p1', level: 'CUSTOM', settings: {
    attemptsPerOperationalHour: 4, intervalMinutes: 15, maxEventsPerInterval: 4, maxEventsPerStage: 20,
    maxSeverityCost: 3, severityBudgetPerStage: 60, maxCascadeDepth: 2, maxCascadeEvents: 4, manualApprovalShare: 0,
  } });
  const legacy = { ...profile, categories: [{ category: 'logistics', intensity: 1, maxSeverity: 3 }] };
  const onPreview = vi.fn();
  const onSave = vi.fn();
  render(<AutonomyEditor profile={legacy} onPreview={onPreview} onSave={onSave} />);
  const slider = screen.getByLabelText('Интенсивность МТО');
  expect(slider.getAttribute('step')).toBe('0.25');
  fireEvent.change(slider, { target: { value: '0' } });
  const next = onPreview.mock.calls.at(-1)?.[0];
  expect(attemptsPerOperationalHour(next, { category: 'logistics', stageId: 'preparation', sideId: 'blue', areaId: 'area-1' })).toBe(0);
  expect(screen.getByText(/плановые и реактивные события сохраняются/i)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить профиль событий' }));
  expect(onSave).toHaveBeenCalledWith(next);
});


it('не подключает серверные Node API к браузерному редактору событий', () => {
  const source = readFileSync('apps/editor/src/modern/kshvi/preparation/AutonomyEditor.tsx', 'utf8');
  expect(source).not.toContain("from '@def-ops/kshvi-events'");
  expect(source).toContain('profile/autonomy-profile');
});
