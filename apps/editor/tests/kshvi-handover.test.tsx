// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { HandoverScreen } from '../src/modern/kshvi/live/HandoverScreen';
import { clearPrivilegedState } from '../src/modern/kshvi/live/projection-cache';

afterEach(cleanup);

it('показывает нейтральный экран без прежней проекции и завершает сессию', () => {
  const onHandover = vi.fn();
  render(<HandoverScreen onHandover={onHandover} />);
  expect(screen.queryByText('Скрытый замысел')).toBeNull();
  expect(screen.getByText('Рабочее место передано')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Подтвердить передачу' }));
  expect(onHandover).toHaveBeenCalled();
});

it('очищает привилегированные кэши, черновики и проекторный профиль', async () => {
  const storage = new Map([
    ['kshvi.projection', 'secret'],
    ['kshvi.draft', 'draft'],
    ['kshvi.projector', 'truth'],
    ['def_ops.kshvi.section', 'preparation'],
    ['def_ops.kshvi.local-editor', 'secret draft'],
    ['def_ops.kshvi.projection.blue', 'participant cache'],
  ]);
  const caches = new Map([['query', 'secret']]);
  const deleted: string[] = [];
  await clearPrivilegedState({
    storage,
    caches,
    deleteDatabase: async name => { deleted.push(name); },
    removeProjector: () => { storage.delete('kshvi.projector'); },
  });
  expect([...storage.keys()]).toEqual([]);
  expect(caches.size).toBe(0);
  expect(deleted).toEqual(['kshvi-projections', 'kshvi-drafts']);
});
