import { describe, expect, it } from 'vitest';
import { checkReportDeadline, createReportReminder, type ReportScheduleEntry } from '../src/communications/report-schedule';
import { recordPaperExchange } from '../src/communications/paper-exchange';

const schedule: ReportScheduleEntry = {
  id: 'urgent-report-1', type: 'CONTACT_REPORT', triggerEventId: 'contact-1', senderRole: 'UNIT_COMMANDER',
  recipientIds: ['hq'], channelId: 'main', deadlineAt: '2030-01-01T06:05:00Z', periodMinutes: 30,
  requiredFields: ['location', 'strength'], escalation: { toRole: 'DUTY_OFFICER', afterMinutes: 0 }, reporterKind: 'TRAINEE',
};

describe('табель срочных донесений', () => {
  it('пропущенный срок не означает отсутствие события', () => {
    const missed = checkReportDeadline({ schedule, now: '2030-01-01T06:06:00Z', eventStatus: 'OCCURRED' });
    expect(missed).toMatchObject({ status: 'REPORT_NOT_SENT', missedDeadline: true });
    expect(missed.observableFacts[0]).toMatchObject({ type: 'REPORT_DEADLINE_MISSED', scheduleId: schedule.id });
    expect(missed.escalation).toEqual({ toRole: 'DUTY_OFFICER', reason: 'REPORT_NOT_SENT' });
    expect(checkReportDeadline({ schedule, now: '2030-01-01T06:06:00Z', eventStatus: 'NOT_OCCURRED' })).toMatchObject({
      status: 'EVENT_NOT_OCCURRED', missedDeadline: false, observableFacts: [], escalation: null,
    });
    expect(checkReportDeadline({ schedule, now: '2030-01-01T06:06:00Z', eventStatus: 'UNKNOWN' }).status).toBe('EVENT_DATA_UNKNOWN');
    expect(checkReportDeadline({
      schedule, now: '2030-01-01T06:06:00Z', eventStatus: 'OCCURRED', report: { sent: true, delivered: false, fields: {} },
    })).toMatchObject({ status: 'REPORT_NOT_DELIVERED', missedDeadline: true });
  });

  it('напоминание не заполняет и не создаёт донесение', () => {
    expect(createReportReminder(schedule, '2030-01-01T06:04:00Z')).toEqual({
      scheduleId: 'urgent-report-1', kind: 'REMINDER', at: '2030-01-01T06:04:00Z', autoFilled: false, createsReport: false,
    });
    expect(checkReportDeadline({ schedule, now: '2030-01-01T06:04:00Z', eventStatus: 'OCCURRED' })).toMatchObject({
      status: 'REPORT_PENDING', missedDeadline: false,
    });
  });

  it('проверяет обязательные поля без автоподстановки', () => {
    const missing = checkReportDeadline({
      schedule, now: '2030-01-01T06:04:00Z', eventStatus: 'OCCURRED',
      report: { sent: true, delivered: true, fields: { location: 'Рубеж 1', strength: null } },
    });
    expect(missing).toMatchObject({ status: 'REPORT_FIELDS_MISSING', missingFields: ['strength'], missedDeadline: false });
    expect(checkReportDeadline({
      schedule, now: '2030-01-01T06:04:00Z', eventStatus: 'OCCURRED',
      report: { sent: true, delivered: true, fields: { location: 'Рубеж 1', strength: '10' } },
    }).status).toBe('REPORT_DELIVERED');
  });
});

describe('бумажный резерв', () => {
  it('хранит фактическое время, источник и не создаёт скрытый второй приказ', () => {
    const input = {
      documentId: 'order-1', revision: 2, sha256: 'a'.repeat(64), domainKey: 'order-1-r2',
      issued: { at: '2030-01-01T06:01:00Z', actorId: 'hq-officer' },
      received: { at: '2030-01-01T06:20:00Z', actorId: 'unit-officer' },
      execution: { at: '2030-01-01T06:30:00Z', actorId: 'unit-commander' },
      evidence: { kind: 'PAPER_ORIGINAL' as const, reference: 'Папка 1, лист 2' },
      enteredAt: '2030-01-01T07:00:00Z', enteredBy: 'operator-1', appliedDomainKeys: [] as string[],
      electronicQueue: [{ messageId: 'electronic-1', domainKey: 'order-1-r2', status: 'queued' as const }],
    };
    const recorded = recordPaperExchange(input);
    expect(recorded.facts.map(fact => fact.type)).toEqual(['ISSUED', 'RECEIVED', 'EXECUTION_STARTED']);
    expect(recorded.facts[1]).toMatchObject({ actualAt: '2030-01-01T06:20:00Z', recordedAt: '2030-01-01T07:00:00Z' });
    expect(recorded).toMatchObject({
      source: { documentId: 'order-1', revision: 2 }, domainEffectApplied: true, duplicate: false,
      appliedDomainKeys: ['order-1-r2'], electronicResolution: 'CANCEL_DUPLICATE', cancelledMessageIds: ['electronic-1'],
    });
    const duplicate = recordPaperExchange({
      ...input, electronicQueue: [{ messageId: 'electronic-2', domainKey: 'order-1-r2', status: 'delivered' }],
      appliedDomainKeys: recorded.appliedDomainKeys,
    });
    expect(duplicate).toMatchObject({
      domainEffectApplied: false, duplicate: true, appliedDomainKeys: ['order-1-r2'], electronicResolution: 'RECONCILED_DUPLICATE', cancelledMessageIds: [],
    });
    expect(recorded.appliedDomainKeys).toEqual(['order-1-r2']);
  });

  it('требует фактические времена и доказательство бумажного обмена', () => {
    expect(() => recordPaperExchange({
      documentId: 'order-1', revision: 1, sha256: 'a'.repeat(64), domainKey: null,
      issued: { at: '', actorId: 'hq' }, received: { at: '2030-01-01T06:20:00Z', actorId: 'unit' },
      evidence: { kind: 'PAPER_ORIGINAL', reference: '' }, enteredAt: '2030-01-01T07:00:00Z', enteredBy: 'operator', appliedDomainKeys: [], electronicQueue: [],
    })).toThrow('время');
  });
});
