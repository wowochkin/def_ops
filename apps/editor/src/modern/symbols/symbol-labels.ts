export const symbolStatusLabels = {
  IMPORTED: 'Импортирован', MAPPED: 'Вектор сопоставлен', VERIFIED: 'Проверен',
  APPROVED: 'Утверждён', DEPRECATED: 'Устарел',
} as const;

export const affiliationLabels = {
  FRIENDLY: 'Свои', HOSTILE: 'Противник', NEUTRAL: 'Нейтральные', UNKNOWN: 'Не определено',
} as const;

export const kindLabels = { POINT: 'Точка', LINE: 'Линия', AREA: 'Район' } as const;

export const forceTypeLabels: Readonly<Record<string, string>> = {
  COMMAND: 'Управление', GROUND_FORCES: 'Сухопутные силы', COMMON: 'Общие объекты',
  LOGISTICS: 'Материально-техническое обеспечение', ENGINEER: 'Инженерное обеспечение',
  TECHNICAL_SUPPORT: 'Техническое обеспечение',
};
