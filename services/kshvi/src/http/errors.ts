export const KSHVI_ERROR_MESSAGES = {
  400: 'Некорректный запрос',
  401: 'Требуется вход в систему',
  403: 'Действие недоступно',
  404: 'Ресурс не найден',
  405: 'Метод не поддерживается',
  409: 'Данные изменились, обновите редакцию',
  422: 'Проверьте заполнение данных',
  500: 'Внутренняя ошибка сервиса',
  503: 'Сервис временно недоступен, повторите команду с прежним ключом',
} as const;
export type KshviErrorStatus = keyof typeof KSHVI_ERROR_MESSAGES;

export function kshviError(status: KshviErrorStatus, code: string, correlationId: string) {
  return {
    status,
    body: { error: { code, message: KSHVI_ERROR_MESSAGES[status], correlationId, fields: [], allowedActions: status === 503 ? ['RETRY_SAME_KEY'] : [] } },
  };
}
