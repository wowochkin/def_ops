// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { KnowledgeImportDialog } from '../src/modern/kshvi/preparation/KnowledgeImportDialog';
import { ModernKnowledgeView } from '../src/modern/ModernKnowledgeView';

afterEach(cleanup);

const source = { sourceRecordId: 'unit-1', sourceRevision: 4, sourceHash: 'a'.repeat(64), modelInputs: false, simulationValidated: false, characteristics: [{ field: 'speed', value: null }] } as const;

it('показывает происхождение и передаёт импорт серверному callback с явной инстанцией', async () => {
  const created = {
    ...source,
    id: 'server-copy-1', recordKind: 'REPRESENTATIVE' as const, sideId: 'red', parentNodeId: 'node-server', status: 'IMPORTED' as const,
    unknown: ['speed'], preview: { tree: [], equipment: [], sources: [] }, scenarioValues: [],
  };
  const onImport = vi.fn(async (_input: unknown) => created);
  const onCommit = vi.fn();
  render(<KnowledgeImportDialog source={source} sideId="red" parentNodeId="node-server" onImport={onImport} onCommit={onCommit} />);
  expect(screen.getByText('Источник: unit-1 · редакция 4')).toBeTruthy();
  expect(screen.getByText('Неизвестно: speed')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Создать сценарную копию' }));
  expect(onImport).toHaveBeenCalledWith({ source, sideId: 'red', parentNodeId: 'node-server', scenarioValues: [] });
  expect(await screen.findByText('Сценарная копия сохранена на сервере; исходный корпус не изменён')).toBeTruthy();
  expect(onCommit).toHaveBeenCalledWith(created);
});

it('не создаёт непersisted локальную копию без серверного подключения', () => {
  render(<KnowledgeImportDialog source={source} />);
  expect(screen.getByRole('button', { name: 'Создать сценарную копию' })).toHaveProperty('disabled', true);
  expect(screen.getByText('Серверный импорт не подключён')).toBeTruthy();
});

it('открывает импорт из современной базы знаний без локального коммита', async () => {
  render(<ModernKnowledgeView />);
  fireEvent.click(screen.getByRole('button', { name: /Германия/ }));
  fireEvent.click(screen.getByRole('tab', { name: 'Техника' }));
  const puma = screen.getByRole('heading', { name: 'Puma' });
  fireEvent.click(puma);
  fireEvent.click(within(puma.closest('article')!).getByRole('button', { name: 'Добавить в КШВИ' }));
  expect(await screen.findByText(/Сценарная копия источника Puma/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Создать сценарную копию' })).toHaveProperty('disabled', true);
  expect(screen.queryByText('Сценарная копия создана; исходный корпус не изменён')).toBeNull();
});
