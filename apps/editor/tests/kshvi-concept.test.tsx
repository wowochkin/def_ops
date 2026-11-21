// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { ConceptStep } from '../src/modern/kshvi/preparation/ConceptStep';
import { KitStep } from '../src/modern/kshvi/preparation/KitStep';
import { StagesStep } from '../src/modern/kshvi/preparation/StagesStep';

it('сохраняет замысел как черновик, а не как готовый шаг', () => {
  render(<ConceptStep />);
  fireEvent.change(screen.getByLabelText('Тема учения'), { target: { value: 'Проверка взаимодействия' } });
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить черновик' }));
  expect(screen.getByText('Черновик сохранён; требуется проверка комплекта')).toBeTruthy();
  expect(screen.getByText('Общий замысел не публикуется всем обучаемым')).toBeTruthy();
});

it('показывает обязательные части и ошибку МТО', () => {
  render(<KitStep usesLogistics items={[]} omissions={[]} />);
  expect(screen.getByText('19 обязательных частей сценария')).toBeTruthy();
  expect(screen.getByText('План МТО обязателен при использовании логистики')).toBeTruthy();
});

it('показывает затронутые этапом документы и критерии', () => {
  render(<StagesStep />);
  fireEvent.click(screen.getByRole('button', { name: 'Показать влияние изменения' }));
  expect(screen.getByText('Документы: doc-1')).toBeTruthy();
  expect(screen.getByText('Критерии: criterion-1')).toBeTruthy();
});
