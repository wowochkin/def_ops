// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { KnowledgeImportDialog } from '../src/modern/kshvi/preparation/KnowledgeImportDialog';
import { ModernKnowledgeView } from '../src/modern/ModernKnowledgeView';

afterEach(cleanup);

const source = { sourceRecordId: 'unit-1', sourceRevision: 4, sourceHash: 'a'.repeat(64), modelInputs: false, simulationValidated: false, characteristics: [{ field: 'speed', value: null }] } as const;

it('показывает происхождение и создаёт сценарную копию из конструктора', () => {
  const onCommit = vi.fn();
  render(<KnowledgeImportDialog source={source} onCommit={onCommit} />);
  expect(screen.getByText('Источник: unit-1 · редакция 4')).toBeTruthy();
  expect(screen.getByText('Неизвестно: speed')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Создать сценарную копию' }));
  expect(onCommit).toHaveBeenCalledWith(expect.objectContaining({ sourceRecordId: 'unit-1', sideId: 'blue', parentNodeId: 'node-1' }));
});

it('открывает импорт из современной базы знаний', async () => {
  render(<ModernKnowledgeView />);
  fireEvent.click(screen.getByRole('button', { name: /Германия/ }));
  fireEvent.click(screen.getByRole('tab', { name: 'Техника' }));
  const puma = screen.getByRole('heading', { name: 'Puma' });
  fireEvent.click(puma);
  fireEvent.click(within(puma.closest('article')!).getByRole('button', { name: 'Добавить в КШВИ' }));
  expect(await screen.findByText(/Сценарная копия источника Puma/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Создать сценарную копию' }));
  expect(screen.getByText('Сценарная копия создана; исходный корпус не изменён')).toBeTruthy();
});
