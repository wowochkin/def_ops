// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMessageAttempt, advanceMessage, deliverAttempt, type CommunicationMessage, type MessageRoute } from '../../../packages/kshvi/src/communications/browser';
import { checkReportDeadline, createReportReminder, recordPaperExchange, type ReportScheduleEntry } from '../../../packages/kshvi/src/communications/browser';
import { CommunicationPanel } from '../src/modern/kshvi/communications/CommunicationPanel';
import { ReportSchedulePanel } from '../src/modern/kshvi/communications/ReportSchedulePanel';
import { PaperExchangePanel } from '../src/modern/kshvi/communications/PaperExchangePanel';

afterEach(cleanup);

const at = '2030-01-01T06:00:00Z';
const route: MessageRoute = { channelId: 'main', nodeIds: ['node-1'], delayMs: 1000, selectedReserve: false, events: [] };

function message(id: string): CommunicationMessage {
  return { id, type: 'ORDER', senderRole: 'COMMANDER', fromInstanceId: 'hq', recipientIds: ['unit'], sizeBytes: 1000, priority: 1, domainKey: 'order-1', createdAt: at };
}

const schedule: ReportScheduleEntry = {
  id: 'report-1', type: 'CONTACT_REPORT', triggerEventId: 'contact-1', senderRole: 'UNIT_COMMANDER', recipientIds: ['hq'], channelId: 'main',
  deadlineAt: '2030-01-01T06:05:00Z', requiredFields: ['location'], escalation: { toRole: 'DUTY_OFFICER', afterMinutes: 0 }, reporterKind: 'TRAINEE',
};

describe('журнал связи', () => {
  it('показывает ёмкость, отказ, все попытки и дубликат без второго доменного эффекта', () => {
    const queued = createMessageAttempt(message('message-queued'), route, at);
    const inTransit = advanceMessage(createMessageAttempt(message('message-in-transit'), route, at), 'START', { at });
    const failed = advanceMessage(advanceMessage(createMessageAttempt(message('message-failed'), route, at), 'START', { at }), 'FAIL', { at, reason: 'Потеря' });
    const cancelled = advanceMessage(createMessageAttempt(message('message-cancelled'), route, at), 'CANCEL', { at, reason: 'Отмена' });
    const delivered = deliverAttempt(createMessageAttempt(message('message-delivered'), route, at));
    const duplicate = deliverAttempt({ ...delivered, messageId: 'message-duplicate', attempt: 2, appliedDomainKeys: delivered.appliedDomainKeys });
    render(<CommunicationPanel channels={[{
      id: 'main', version: 1, fromInstanceId: 'hq', toInstanceId: 'unit', nodeIds: ['node-1'], direction: 'SIMPLEX', allowedMessageTypes: ['ORDER'],
      capacity: 1, bytesPerSecond: 1000, baseDelayMs: 1000, priorityPolicy: { allowQueuedPreemption: true }, availability: 'DEGRADED', degradedCapacity: 0,
      encrypted: true, reserveChannelIds: ['reserve'], validFrom: '2030-01-01T00:00:00Z', validUntil: '2030-01-02T00:00:00Z',
    }]} attempts={[queued, inTransit, failed, cancelled, duplicate]} />);
    expect(screen.getByRole('heading', { name: 'Каналы и попытки связи' })).toBeTruthy();
    expect(screen.getByText('Канал main: DEGRADED; ёмкость 0/1')).toBeTruthy();
    expect(screen.getByText('Резерв: reserve')).toBeTruthy();
    for (const status of ['queued', 'inTransit', 'failed', 'cancelled', 'delivered']) expect(screen.getByText(status)).toBeTruthy();
    expect(screen.getByText('Дубликат доставки; доменный эффект не повторён')).toBeTruthy();
    expect(screen.getByText('Попытка 2; маршрут main')).toBeTruthy();
  });
});

describe('табель и бумажный резерв', () => {
  it('показывает пропущенный срок и напоминание без автодонесения', () => {
    const onRemind = vi.fn();
    const result = checkReportDeadline({ schedule, now: '2030-01-01T06:06:00Z', eventStatus: 'OCCURRED' });
    render(<ReportSchedulePanel schedule={schedule} result={result} reminder={createReportReminder(schedule, '2030-01-01T06:06:00Z')} onRemind={onRemind} />);
    expect(screen.getByRole('heading', { name: 'Табель срочных донесений' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Пропущен срок донесения');
    expect(screen.getByText('Донесение не отправлено')).toBeTruthy();
    expect(screen.getByText('Событие-основание: contact-1')).toBeTruthy();
    expect(screen.getByText('Напоминание не заполняет содержание и не создаёт донесение')).toBeTruthy();
    expect(screen.queryByLabelText('Содержание донесения')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Напомнить' }));
    expect(onRemind).toHaveBeenCalledWith('report-1');
  });

  it('различает событие, которого не было, и пропущенный срок', () => {
    const result = checkReportDeadline({ schedule, now: '2030-01-01T06:06:00Z', eventStatus: 'NOT_OCCURRED' });
    render(<ReportSchedulePanel schedule={schedule} result={result} />);
    expect(screen.getByText('Событие не произошло')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('показывает фактическое время бумажного получения и время ввода раздельно', () => {
    const paper = recordPaperExchange({
      documentId: 'order-1', revision: 1, sha256: 'a'.repeat(64), domainKey: 'order-1',
      issued: { at: '2030-01-01T06:01:00Z', actorId: 'hq' }, received: { at: '2030-01-01T06:20:00Z', actorId: 'unit' },
      evidence: { kind: 'PAPER_ORIGINAL', reference: 'Папка 1' }, enteredAt: '2030-01-01T07:00:00Z', enteredBy: 'operator',
      appliedDomainKeys: ['order-1'], electronicQueue: [],
    });
    render(<PaperExchangePanel exchange={paper} />);
    expect(screen.getByRole('heading', { name: 'Бумажный обмен' })).toBeTruthy();
    expect(screen.getByText('Фактически получено: 2030-01-01T06:20:00Z')).toBeTruthy();
    expect(screen.getAllByText('Введено в журнал: 2030-01-01T07:00:00Z').length).toBeGreaterThan(0);
    expect(screen.getByText('Основание: Папка 1')).toBeTruthy();
    expect(screen.getByText('Доменный эффект уже применён; повторный приказ не создан')).toBeTruthy();
  });
});
