import type { ExerciseSession, ExerciseState, ExerciseSummary, ExerciseValidation } from './kshvi-api';

export const exerciseStates = ['DRAFT', 'IN_REVIEW', 'APPROVED', 'SEALED', 'CANCELLED', 'ARCHIVED'] as const;

export type PreparationStepState = 'NOT_STARTED' | 'NEEDS_DATA' | 'HAS_ERRORS' | 'READY_FOR_REVIEW' | 'CONFIRMED' | 'UNAVAILABLE';
const labels: Record<ExerciseState | ExerciseValidation | ExerciseSession['state'] | PreparationStepState, string> = {
  DRAFT: 'Черновик',
  IN_REVIEW: 'На проверке',
  APPROVED: 'Утверждено',
  SEALED: 'Зафиксировано',
  CANCELLED: 'Отменено',
  ARCHIVED: 'В архиве',
  NOT_RUN: 'Проверка не запускалась',
  OK: 'Ошибок не найдено',
  WARNING: 'Есть предупреждения',
  ERROR: 'Есть ошибки',
  ACTIVE: 'Идёт',
  PAUSED: 'Приостановлен',
  COMPLETED: 'Завершён',
  ABORTED: 'Прерван',
  NOT_STARTED: 'Не начат',
  HAS_ERRORS: 'Есть ошибки',
  NEEDS_DATA: 'Требуются данные',
  READY_FOR_REVIEW: 'Готов к проверке',
  CONFIRMED: 'Подтверждён',
  UNAVAILABLE: 'Данные недоступны',
};

export function stateLabel(state: keyof typeof labels): string {
  return labels[state];
}

export type LibraryPrimaryAction = Readonly<{
  id: 'PREPARE' | 'REVIEW' | 'START' | 'CONDUCT' | 'DEBRIEF' | 'ARCHIVE';
  label: string;
}>;

export function libraryPrimaryAction(item: Pick<ExerciseSummary, 'state'> & Partial<Pick<ExerciseSummary, 'lastSessionId' | 'lastSessionState'>>): LibraryPrimaryAction {
  if (item.state === 'ARCHIVED') return { id: 'ARCHIVE', label: 'Открыть архив' };
  if (item.state === 'CANCELLED') return { id: 'REVIEW', label: 'Просмотреть редакцию' };
  if (item.state === 'APPROVED') return { id: 'REVIEW', label: 'Проверить и зафиксировать' };
  if (item.state !== 'SEALED') return { id: 'PREPARE', label: 'Продолжить подготовку' };
  if (!item.lastSessionId) return { id: 'START', label: 'Запустить учение' };
  if (item.lastSessionState === 'COMPLETED') return { id: 'DEBRIEF', label: 'Открыть разбор' };
  if (item.lastSessionState === 'ACTIVE' || item.lastSessionState === 'PAUSED') {
    return { id: 'CONDUCT', label: 'Открыть проведение' };
  }
  return { id: 'CONDUCT', label: 'Открыть сеанс' };
}
