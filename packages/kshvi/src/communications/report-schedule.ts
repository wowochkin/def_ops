export type ReportScheduleEntry = Readonly<{
  id: string;
  type: string;
  triggerEventId: string;
  senderRole: string;
  recipientIds: readonly string[];
  channelId: string;
  deadlineAt: string;
  periodMinutes?: number;
  requiredFields: readonly string[];
  escalation: Readonly<{ toRole: string; afterMinutes: number }>;
  reporterKind: 'TRAINEE' | 'INTERMEDIARY';
}>;

export type ReportInput = Readonly<{
  sent: boolean;
  delivered: boolean;
  fields: Readonly<Record<string, string | null>>;
}>;

export type ReportDeadlineStatus =
  | 'EVENT_NOT_OCCURRED'
  | 'EVENT_DATA_UNKNOWN'
  | 'REPORT_PENDING'
  | 'REPORT_NOT_SENT'
  | 'REPORT_NOT_DELIVERED'
  | 'REPORT_FIELDS_MISSING'
  | 'REPORT_DELIVERED';

export type ReportDeadlineResult = Readonly<{
  status: ReportDeadlineStatus;
  missedDeadline: boolean;
  missingFields: readonly string[];
  observableFacts: readonly Readonly<{ type: 'REPORT_DEADLINE_MISSED'; scheduleId: string; eventId: string; at: string }>[];
  escalation: Readonly<{ toRole: string; reason: 'REPORT_NOT_SENT' | 'REPORT_NOT_DELIVERED' }> | null;
}>;

function result(status: ReportDeadlineStatus, missedDeadline = false): ReportDeadlineResult {
  return { status, missedDeadline, missingFields: [], observableFacts: [], escalation: null };
}

export function checkReportDeadline(input: {
  schedule: ReportScheduleEntry;
  now: string;
  eventStatus: 'OCCURRED' | 'NOT_OCCURRED' | 'UNKNOWN';
  report?: ReportInput;
}): ReportDeadlineResult {
  const now = Date.parse(input.now);
  const deadline = Date.parse(input.schedule.deadlineAt);
  if (!Number.isFinite(now) || !Number.isFinite(deadline)) throw new Error('Некорректное время табеля донесений');
  if (input.eventStatus === 'NOT_OCCURRED') return result('EVENT_NOT_OCCURRED');
  if (input.eventStatus === 'UNKNOWN') return result('EVENT_DATA_UNKNOWN');
  if (input.report?.delivered) {
    const missingFields = input.schedule.requiredFields.filter(field => {
      const value = input.report?.fields[field];
      return value === undefined || value === null || !value.trim();
    });
    if (missingFields.length) return { ...result('REPORT_FIELDS_MISSING'), missingFields };
    return result('REPORT_DELIVERED');
  }
  if (now <= deadline) return result('REPORT_PENDING');
  const status = input.report?.sent ? 'REPORT_NOT_DELIVERED' : 'REPORT_NOT_SENT';
  const escalationAt = deadline + input.schedule.escalation.afterMinutes * 60_000;
  return {
    status,
    missedDeadline: true,
    missingFields: [],
    observableFacts: [{ type: 'REPORT_DEADLINE_MISSED', scheduleId: input.schedule.id, eventId: input.schedule.triggerEventId, at: input.now }],
    escalation: now >= escalationAt ? { toRole: input.schedule.escalation.toRole, reason: status } : null,
  };
}

/** Напоминание — отдельный UI/журнальный факт, не заготовка содержания донесения. */
export function createReportReminder(schedule: ReportScheduleEntry, at: string): Readonly<{
  scheduleId: string;
  kind: 'REMINDER';
  at: string;
  autoFilled: false;
  createsReport: false;
}> {
  if (!Number.isFinite(Date.parse(at))) throw new Error('Некорректное время напоминания о донесении');
  return { scheduleId: schedule.id, kind: 'REMINDER', at, autoFilled: false, createsReport: false };
}
