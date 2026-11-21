export function kshviError(status: 401 | 403 | 409 | 422 | 503, code: string, correlationId: string) {
  const messages = {
    401: 'Требуется вход в систему',
    403: 'Действие недоступно',
    409: 'Данные изменились, обновите редакцию',
    422: 'Проверьте заполнение данных',
    503: 'Сервис временно недоступен, повторите команду с прежним ключом',
  } as const;
  return {
    status,
    body: { error: { code, message: messages[status], correlationId, fields: [], allowedActions: status === 503 ? ['RETRY_SAME_KEY'] : [] } },
  };
}
