// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ProjectorWorkspace } from '../src/modern/kshvi/conduct/ProjectorWorkspace';
import { kshviClient, kshviProjection } from './kshvi-fixtures';

afterEach(cleanup);

it('проектор не наследует аудиторию и показывает только загруженную проекцию', async () => {
  const client = kshviClient({ loadAudienceProjection: async () => kshviProjection({ role: 'PROJECTOR', projectorTitle: 'Публичный итог этапа' }) });
  const { container } = render(<ProjectorWorkspace commands={client} />);
  expect(screen.getByText('Аудитория не выбрана')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Вывести на проектор' })).toHaveProperty('disabled', true);
  expect(container.textContent).not.toContain('Публичный итог этапа');
  fireEvent.change(screen.getByLabelText('Профиль аудитории'), { target: { value: 'PUBLIC_FINAL' } });
  fireEvent.click(screen.getByRole('button', { name: 'Вывести на проектор' }));
  await waitFor(() => expect(screen.getByText('Публичный итог этапа')).toBeTruthy());
  expect(screen.getByText(/Проверка видимости: Проверено сервером/)).toBeTruthy();
  expect(container.textContent).not.toContain('Скрытый замысел');
  fireEvent.change(screen.getByLabelText('Профиль аудитории'), { target: { value: 'TRAINEE' } });
  expect(screen.queryByText('Публичный итог этапа')).toBeNull();
  expect(screen.getByRole('button', { name: 'Вывести на проектор' })).toHaveProperty('disabled', false);
});

it('публичный browser entry использует HTTP-контракт и не импортирует серверный пакет или Node API', () => {
  const entry = resolve(process.cwd(), 'apps/editor/src/modern/kshvi/conduct/browser.ts');
  expect(existsSync(entry)).toBe(true);
  const source = readFileSync(entry, 'utf8');
  expect(source).toContain('TraineeWorkspace');
  expect(source).toContain('ProjectorWorkspace');
  expect(source).toContain('HttpConductClient');
  expect(source).not.toContain('@def-ops/kshvi');
  expect(source).not.toContain('node:');
  const preview = readFileSync(resolve(process.cwd(), 'apps/editor/src/modern/kshvi/conduct/preview.tsx'), 'utf8');
  expect(preview).toContain('HttpConductClient');
  expect(preview).not.toContain('defaultConductEvents');
  expect(preview).not.toContain('@def-ops/kshvi');
});
