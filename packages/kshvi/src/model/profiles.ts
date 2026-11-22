import type { ActionTaxonomy } from './types';

export function validateExerciseAxes(value: { scale: string; mapZoom: number; trainedLevels: number; customProfileId?: string }): string[] {
  const issues: string[] = [];
  if (!['tactical', 'operational', 'strategic', 'custom'].includes(value.scale)) issues.push('Неизвестный масштаб задач');
  if (!Number.isFinite(value.mapZoom) || value.mapZoom < 0 || value.mapZoom > 24) issues.push('Масштаб карты вне допустимого диапазона');
  if (!Number.isSafeInteger(value.trainedLevels) || value.trainedLevels < 1) issues.push('Нужна хотя бы одна обучаемая ступень');
  if (value.scale === 'custom' && !value.customProfileId?.trim()) issues.push('Для пользовательского масштаба нужен профиль');
  return issues;
}

const categories = [
  ['combat', 'Виды боя'],
  ['special', 'Специальные задачи'],
  ['forceManeuver', 'Манёвр силами'],
  ['fireManeuver', 'Манёвр огнём'],
  ['resourceManeuver', 'Манёвр ресурсами'],
  ['support', 'Разведка, маскировка, инженерное, РХБ, связь, тыловое и иное обеспечение'],
  ['strategicDeployment', 'Стратегическое развёртывание'],
  ['deterrence', 'Сдерживание'],
  ['mobilization', 'Мобилизационные задачи'],
  ['information', 'Информационные задачи'],
  ['reserve', 'Резервы и перегруппирование'],
  ['interaction', 'Взаимодействие и ранжированные цели'],
  ['custom', 'Пользовательские типы'],
] as const;

export const DEFAULT_ACTION_TAXONOMY: ActionTaxonomy = Object.freeze({
  version: 1,
  categories: Object.freeze(categories.map(([id, title]) => Object.freeze({ id, title, allowedStageTransitions: Object.freeze([]) }))),
});
