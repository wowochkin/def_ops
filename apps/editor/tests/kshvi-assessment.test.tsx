// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MetricExplorer } from '../src/modern/kshvi/assessment/MetricExplorer';
import { AssessmentEditor } from '../src/modern/kshvi/assessment/AssessmentEditor';
import { DebriefWorkspace } from '../src/modern/kshvi/assessment/DebriefWorkspace';

afterEach(cleanup);

it('показывает формулу, версию, единицы, UNKNOWN и переход к доказательству', () => {
  const onEvidence = vi.fn();
  render(<MetricExplorer metric={{ id: 'delay', formula: 'avg(delivery-sent)', version: 2, unit: 's', period: 'этап 1', value: 'UNKNOWN', missingData: ['delivery.timestamp'], evidenceIds: ['event-1'] }} onEvidence={onEvidence} />);
  expect(screen.getByText('avg(delivery-sent)')).toBeTruthy();
  expect(screen.getByText(/Версия 2/)).toBeTruthy();
  expect(screen.getByText(/UNKNOWN/)).toBeTruthy();
  expect(screen.getByText(/Неизвестное не заменяется нулём/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Доказательство event-1' }));
  expect(onEvidence).toHaveBeenCalledWith('event-1');
});

it('не утверждает автоматический проект без решения человека', () => {
  const onApprove = vi.fn();
  render(<AssessmentEditor systemProposal="Проект: хорошо" onApprove={onApprove} />);
  expect(screen.getByText('Проект: хорошо')).toBeTruthy();
  expect(screen.getByText(/не является итоговой оценкой/i)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Итоговая оценка руководителя'), { target: { value: 'Зачёт с разбором' } });
  fireEvent.change(screen.getByLabelText('Комментарий руководителя'), { target: { value: 'Учесть обоснование' } });
  fireEvent.click(screen.getByRole('button', { name: 'Утвердить человеческую оценку' }));
  expect(onApprove).toHaveBeenCalledWith({ finalAssessment: 'Зачёт с разбором', comment: 'Учесть обоснование' });
});

it('показывает эталон как замысел и фиксирует аудиторию разбора', () => {
  render(<DebriefWorkspace scope="PRIVATE" revision={4} audience={['hq-1']} referenceIntent="Замысел руководства" />);
  expect(screen.getByText(/не единственно правильное решение/i)).toBeTruthy();
  expect(screen.getByText(/Частный разбор/)).toBeTruthy();
  expect(screen.getByText(/Редакция 4/)).toBeTruthy();
  expect(screen.getByText(/hq-1/)).toBeTruthy();
});
