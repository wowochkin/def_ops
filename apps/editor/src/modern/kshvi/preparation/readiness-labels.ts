const limitations: Record<string, string> = {
  SIGNAL_NOT_RECEIVED: 'Сигнал не получен', PERSONNEL_SHORTAGE: 'Недостаточно личного состава',
  EQUIPMENT_UNSERVICEABLE: 'Техника неисправна', SUPPLIES_NOT_REPLENISHED: 'Запасы не пополнены',
  AREA_NOT_OCCUPIED: 'Район не занят', COMMUNICATIONS_UNAVAILABLE: 'Связь недоступна',
  DEPENDENCY_NOT_COMPLETED: 'Зависимые мероприятия не завершены', RESOURCE_SHORTAGE: 'Недостаточно ресурса',
  RESOURCE_UNKNOWN: 'Остаток ресурса неизвестен', REPORT_NOT_RECEIVED: 'Доклад не поступил',
  CRITERION_NOT_MET: 'Критерий не выполнен', PRECONDITION_NOT_MET: 'Предусловие не выполнено',
  PRECONDITION_UNKNOWN: 'Предусловие неизвестно', ACTIVITY_NOT_DUE: 'Срок мероприятия не наступил',
  DEADLINE_MISSED: 'Нарушен назначенный срок', LEVEL_UNKNOWN: 'Уровень готовности неизвестен',
  ACTIVITY_FAILED: 'Мероприятие не выполнено', UNKNOWN_ACTIVITY: 'Неизвестное мероприятие',
};
const statuses: Record<string, string> = {
  NOT_STARTED: 'Не начато', IN_PROGRESS: 'Выполняется', READY: 'Готово', PARTIAL: 'Частичная готовность', FAILED: 'Не выполнено',
};
export function readinessLimitationLabel(code: string): string { return limitations[code] ?? code; }
export function readinessStatusLabel(status: string): string { return statuses[status] ?? status; }
