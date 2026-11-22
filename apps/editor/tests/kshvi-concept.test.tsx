// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ConceptStep } from '../src/modern/kshvi/preparation/ConceptStep';
import { KitStep } from '../src/modern/kshvi/preparation/KitStep';
import { StagesStep } from '../src/modern/kshvi/preparation/StagesStep';

it('сохраняет замысел через серверный callback, а не в локальном состоянии', async () => {
  const onSave = vi.fn(async (_title: string) => {});
  render(<ConceptStep onSave={onSave} />);
  fireEvent.change(screen.getByLabelText('Тема учения'), { target: { value: 'Проверка взаимодействия' } });
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить черновик' }));
  expect(onSave).toHaveBeenCalledWith('Проверка взаимодействия');
  expect(await screen.findByText('Серверная редакция сохранена; требуется проверка комплекта')).toBeTruthy();
  expect(screen.getByText('Общий замысел не публикуется всем обучаемым')).toBeTruthy();
});

it('показывает обязательные части, связь документа и ошибку МТО', () => {
  render(<KitStep
    usesLogistics
    items={[{ item: 'CONCEPT', present: true, documentId: 'doc-concept', revision: 3, sha256: 'a'.repeat(64) }]}
    omissions={[]}
  />);
  expect(screen.getByText('19 обязательных частей сценария')).toBeTruthy();
  expect(screen.getByText('План МТО обязателен при использовании логистики')).toBeTruthy();
  expect(screen.getByText('CONCEPT: doc-concept, редакция 3')).toBeTruthy();
});

it('использует связи этапа из серверной редакции, а не зашитые идентификаторы', () => {
  render(<StagesStep
    stageId="stage-server"
    affectedBy={['expectedActions']}
    links={{
      inputs: [], maps: [],
      documents: [{ id: 'doc-server-9', stageIds: ['stage-server'], affectedBy: ['expectedActions'] }],
      criteria: [{ id: 'criterion-server-4', stageIds: ['stage-server'], affectedBy: ['expectedActions'] }],
    }}
  />);
  fireEvent.click(screen.getByRole('button', { name: 'Показать влияние изменения' }));
  expect(screen.getByText('Документы: doc-server-9')).toBeTruthy();
  expect(screen.getByText('Критерии: criterion-server-4')).toBeTruthy();
});
