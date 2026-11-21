// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { BranchComparison } from '../src/modern/kshvi/replay/BranchComparison';
import { ResearchCardEditor } from '../src/modern/kshvi/replay/ResearchCardEditor';
import { RerunDialog } from '../src/modern/kshvi/replay/RerunDialog';

afterEach(cleanup);

it('показывает версии раньше последствий и предупреждает о ложной причинности', () => {
  render(<BranchComparison differences={[
    { kind: 'MODEL_VERSION', label: 'Модель: 1 → 2' }, { kind: 'ENVIRONMENT_VERSION', label: 'Среда: 1 → 2' },
    { kind: 'RESOURCES', label: 'Топливо: 20 → 10' },
  ]} causalAttribution="NOT_CAUSALLY_COMPARABLE" />);
  const items = screen.getAllByRole('listitem').map(item => item.textContent);
  expect(items[0]).toContain('Модель');
  expect(items[1]).toContain('Среда');
  expect(screen.getByText(/нельзя приписать/i)).toBeTruthy();
});

it('редактор исследования требует ограничения и не обещает причинность', () => {
  const onSave = vi.fn();
  render(<ResearchCardEditor onSave={onSave} />);
  expect(screen.getByText(/наблюдение не доказывает причинность/i)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Вопрос исследования'), { target: { value: 'Есть ли связь?' } });
  fireEvent.change(screen.getByLabelText('Ограничения'), { target: { value: 'Нет контрольной группы' } });
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить исследование' }));
  expect(onSave).toHaveBeenCalledWith({ question: 'Есть ли связь?', limitations: 'Нет контрольной группы', causalStatus: 'NOT_ESTABLISHED' });
});

it('повторное прохождение показывает новый сеанс и не создаёт рейтинг', () => {
  const onConfirm = vi.fn();
  render(<RerunDialog sourceSessionId="session-1" onConfirm={onConfirm} />);
  fireEvent.change(screen.getByLabelText('Новый идентификатор сеанса'), { target: { value: 'session-2' } });
  fireEvent.click(screen.getByRole('button', { name: 'Создать повторное прохождение' }));
  expect(onConfirm).toHaveBeenCalledWith('session-2');
  expect(screen.getByText(/рейтинг/i).textContent).toContain('не создаётся');
});
