// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ArchiveWorkspace } from '../src/modern/kshvi/archive/ArchiveWorkspace';
import { ArchiveImportDialog } from '../src/modern/kshvi/archive/ArchiveImportDialog';
import { JobQueuePanel } from '../src/modern/kshvi/archive/JobQueuePanel';

afterEach(cleanup);

it('показывает автономность, манифест и явно маркирует неполный пакет', () => {
  const onExport = vi.fn();
  const { rerender } = render(<ArchiveWorkspace archiveId="a1" manifestSha256={'a'.repeat(64)} mode="AUTONOMOUS" missing={[]} onExport={onExport} />);
  expect(screen.getByText(/Автономное воспроизведение/)).toBeTruthy();
  expect(screen.getByText(new RegExp('a{20}'))).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Экспортировать архив' }));
  expect(onExport).toHaveBeenCalled();
  rerender(<ArchiveWorkspace archiveId="a1" manifestSha256={'a'.repeat(64)} mode="LIMITED_RESEARCH" missing={['environment.weather']} onExport={onExport} />);
  expect(screen.getByText(/Ограниченное исследование/)).toBeTruthy();
  expect(screen.getByText(/environment.weather/)).toBeTruthy();
  expect(screen.queryByText(/Автономное воспроизведение пройдено/)).toBeNull();
});

it('проверяет пакет до публикации и сообщает о повреждении', async () => {
  const onImport = vi.fn(async () => { throw new Error('Архив повреждён'); });
  render(<ArchiveImportDialog onImport={onImport} />);
  fireEvent.change(screen.getByLabelText('Содержимое архивного пакета'), { target: { value: '{"archive":1}' } });
  fireEvent.click(screen.getByRole('button', { name: 'Проверить и импортировать' }));
  await waitFor(() => expect(onImport).toHaveBeenCalledWith('{"archive":1}'));
  expect(screen.getByRole('alert').textContent).toContain('повреждён');
});

it('отображает состояния заданий, прогресс, отмену и безопасный повтор', () => {
  const onCancel = vi.fn();
  const onRetry = vi.fn();
  render(<JobQueuePanel jobs={[
    { id: 'j1', kind: 'EXPORT', status: 'running', progress: 45, attempts: 1 },
    { id: 'j2', kind: 'VERIFY', status: 'failed', progress: 70, attempts: 1 },
  ]} onCancel={onCancel} onRetry={onRetry} />);
  expect(screen.getByText(/Выполняется/)).toBeTruthy();
  expect(screen.getByText('45%')).toBeTruthy();
  expect(screen.getByText(/Ошибка/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Отменить j1' }));
  fireEvent.click(screen.getByRole('button', { name: 'Повторить j2' }));
  expect(onCancel).toHaveBeenCalledWith('j1');
  expect(onRetry).toHaveBeenCalledWith('j2');
});
