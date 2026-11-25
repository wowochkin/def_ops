// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { CommandTreeStep } from '../src/modern/kshvi/preparation/CommandTreeStep';
import { ForcesStep } from '../src/modern/kshvi/preparation/ForcesStep';

it('показывает незакрытую роль активного стыка', () => {
  render(<CommandTreeStep nodes={[{ id: 'a', parentId: null, trained: true }, { id: 'b', parentId: 'a', trained: true }]} edges={[{ from: 'a', to: 'b', active: true, playRole: null }]} />);
  expect(screen.getByText('На активном стыке a → b нужна роль розыгрыша')).toBeTruthy();
});

it('показывает четыре рабочие вкладки единой редакции сил и МТО', () => {
  render(<ForcesStep />);
  for (const title of ['Силы', 'Оснащение', 'Построение', 'Снабжение']) expect(screen.getByRole('tab', { name: title })).toBeTruthy();
});
