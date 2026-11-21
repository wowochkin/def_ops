import type {
  ReportDeadlineResult,
  ReportScheduleEntry,
  createReportReminder,
} from '../../../../../../packages/kshvi/src/communications/browser';

const statusLabels: Record<ReportDeadlineResult['status'], string> = {
  EVENT_NOT_OCCURRED: 'Событие не произошло',
  EVENT_DATA_UNKNOWN: 'Данные о событии неизвестны',
  REPORT_PENDING: 'Срок донесения не наступил',
  REPORT_NOT_SENT: 'Донесение не отправлено',
  REPORT_NOT_DELIVERED: 'Донесение не доставлено',
  REPORT_FIELDS_MISSING: 'Не заполнены обязательные поля донесения',
  REPORT_DELIVERED: 'Донесение доставлено',
};

export function ReportSchedulePanel(props: {
  schedule: ReportScheduleEntry;
  result: ReportDeadlineResult;
  reminder?: ReturnType<typeof createReportReminder>;
  onRemind?: (scheduleId: string) => void;
}) {
  const { schedule, result } = props;
  return <section aria-label="Табель донесений">
    <h2>Табель срочных донесений</h2>
    <p>Тип: {schedule.type}; отправитель: {schedule.senderRole}</p>
    <p>Событие-основание: {schedule.triggerEventId}</p>
    <p>Предельный срок: {schedule.deadlineAt}; канал: {schedule.channelId}</p>
    <p>Периодичность: {schedule.periodMinutes ? `${schedule.periodMinutes} мин` : 'по событию'}; участник: {schedule.reporterKind}</p>
    <strong>{statusLabels[result.status]}</strong>
    {result.missedDeadline && <div role="alert">
      Пропущен срок донесения. Это наблюдаемый факт разбора, а не признак отсутствия события.
      {result.escalation && <p>Эскалация: {result.escalation.toRole}</p>}
    </div>}
    {result.missingFields.length > 0 && <p>Не заполнены: {result.missingFields.join(', ')}</p>}
    {props.reminder && <section aria-label="Напоминание о донесении">
      <p>Напоминание не заполняет содержание и не создаёт донесение</p>
      <button type="button" onClick={() => props.onRemind?.(schedule.id)}>Напомнить</button>
    </section>}
  </section>;
}
