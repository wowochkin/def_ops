// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { AutonomyEditor } from '../src/modern/kshvi/preparation/AutonomyEditor';
import { CatalogBrowser } from '../src/modern/kshvi/preparation/CatalogBrowser';
import { RehearsalReport } from '../src/modern/kshvi/preparation/RehearsalReport';
import { AutonomyMonitor } from '../src/modern/kshvi/conduct/AutonomyMonitor';
import { AgentAssignmentPanel } from '../src/modern/kshvi/conduct/AgentAssignmentPanel';
import { AgentDecisionTraceView } from '../src/modern/kshvi/conduct/AgentDecisionTraceView';
import { InterventionDialog } from '../src/modern/kshvi/conduct/InterventionDialog';

afterEach(cleanup);

const mediumProfile = { version: 1, level: 'MEDIUM' as const, categories: [{ category: 'RECONNAISSANCE', intensity: 4, maxSeverity: 2 }] };

it('объясняет нулевую интенсивность и не отменяет плановые вводные', () => {
  render(<AutonomyEditor profile={mediumProfile} />);
  fireEvent.change(screen.getByLabelText('Интенсивность разведки'), { target: { value: '0' } });
  expect(screen.getByText('Вероятностные события разведки отключены; плановые и реактивные сохранены')).toBeTruthy();
});

it('показывает полный каталог и репетицию причин отклонений', () => {
  render(<><CatalogBrowser total={240} categories={12} operations={48} /><RehearsalReport attempts={[{ category: 'CONTROL', selected: null, reason: 'NO_ELIGIBLE_TEMPLATE' }]} /></>);
  expect(screen.getByText('240 событий · 12 категорий · 48 операций')).toBeTruthy();
  expect(screen.getByText('Нет допустимого шаблона; попытка сохранена')).toBeTruthy();
});

it('показывает пустую попытку планировщика, а не только успешные события', () => {
  render(<AutonomyMonitor attempts={[{ id: 'a1', category: 'ENVIRONMENT', selectedTemplateId: null, reason: 'UNKNOWN_REQUIRED_PRECONDITION' }]} />);
  expect(screen.getByText('Пустая попытка: обязательное значение неизвестно')).toBeTruthy();
});

it('перехватывает посредника без отката и объясняет выбор и альтернативы', () => {
  render(<><AgentAssignmentPanel mode="DELEGATED" currentTask="Подготовка распоряжения" authorities={['document.issue']} /><AgentDecisionTraceView selected="issue-order" alternatives={['wait', 'request-data']} unknown={['observation']} /><InterventionDialog currentAction="Выдача распоряжения" onConfirm={() => undefined} /></>);
  expect(screen.getByText('DELEGATED')).toBeTruthy();
  expect(screen.getByText('Выбрано: issue-order')).toBeTruthy();
  expect(screen.getByText('Альтернативы отклонены: wait, request-data')).toBeTruthy();
  expect(screen.getByText('Неизвестные данные: observation')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Перехватить управление' }));
  expect(screen.getByText('Мир не откатывается; дальнейшие действия подписывает человек')).toBeTruthy();
});
