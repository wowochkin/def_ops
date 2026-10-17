/**
 * Разделы приложения без значков: список нужен и оболочке (Shell.tsx добавляет значки),
 * и голосовому управлению (проверяется в node, поэтому без React).
 */
export type Section = 'editor' | 'replay' | 'modeling' | 'maps' | 'library' | 'knowledge' | 'staff';
export const SECTIONS: { id: Section; title: string; soon?: boolean }[] = [
  { id: 'editor', title: 'Редактор' },
  { id: 'replay', title: 'Переигровка' },
  { id: 'modeling', title: 'Моделирование' },
  { id: 'maps', title: 'Карты' },
  { id: 'library', title: 'Знаки' },
  { id: 'knowledge', title: 'Знания' },
  { id: 'staff', title: 'ИИ' },
];
