export const preparationSteps = [
  { id: 'environment', label: 'Среда', description: 'Атлас, погода и исходная карта' },
  { id: 'forces', label: 'Силы и МТО', description: 'Оснащённость, построение и снабжение' },
  { id: 'events', label: 'События', description: 'Интенсивность и библиотека наращивания' },
  { id: 'readiness', label: 'Готовность', description: 'Репетиция, доклады и ограничения' },
  { id: 'launch', label: 'Запуск', description: 'Итог проверки и запуск официального сеанса' },
] as const;

export type PreparationStep = (typeof preparationSteps)[number]['id'];

export function stepIndex(step: PreparationStep): number {
  return preparationSteps.findIndex(item => item.id === step);
}
