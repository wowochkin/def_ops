import { expect, it } from 'vitest';
import type { PreparationDraft } from '@def-ops/kshvi/preparation-draft';
import type { ExerciseCard, ExerciseSummary } from '../src/modern/kshvi/kshvi-api';
import { preparationStepStates } from '../src/modern/kshvi/preparation/PreparationStatus';
import { libraryPrimaryAction, stateLabel } from '../src/modern/kshvi/library-actions';

it('выбирает основное действие по серверной стадии учения и состоянию сеанса', () => {
  expect(libraryPrimaryAction({ state: 'DRAFT' } as ExerciseSummary)).toEqual({ id: 'PREPARE', label: 'Продолжить подготовку' });
  expect(libraryPrimaryAction({ state: 'IN_REVIEW' } as ExerciseSummary)).toEqual({ id: 'PREPARE', label: 'Продолжить подготовку' });
  expect(libraryPrimaryAction({ state: 'APPROVED' } as ExerciseSummary)).toEqual({ id: 'REVIEW', label: 'Проверить и зафиксировать' });
  expect(libraryPrimaryAction({ state: 'SEALED', lastSessionId: null } as ExerciseSummary)).toEqual({ id: 'START', label: 'Запустить учение' });
  expect(libraryPrimaryAction({ state: 'SEALED', lastSessionId: 's', lastSessionState: 'PAUSED' } as ExerciseSummary)).toEqual({ id: 'CONDUCT', label: 'Открыть проведение' });
  expect(libraryPrimaryAction({ state: 'SEALED', lastSessionId: 's', lastSessionState: 'COMPLETED' } as ExerciseSummary)).toEqual({ id: 'DEBRIEF', label: 'Открыть разбор' });
  expect(libraryPrimaryAction({ state: 'SEALED', lastSessionId: 's' } as ExerciseSummary)).toEqual({ id: 'CONDUCT', label: 'Открыть сеанс' });
  expect(libraryPrimaryAction({ state: 'ARCHIVED' } as ExerciseSummary)).toEqual({ id: 'ARCHIVE', label: 'Открыть архив' });
  expect(libraryPrimaryAction({ state: 'CANCELLED' } as ExerciseSummary)).toEqual({ id: 'REVIEW', label: 'Просмотреть редакцию' });
});

it('даёт русские названия стадии, проверки и сеанса', () => {
  expect(stateLabel('SEALED')).toBe('Зафиксировано');
  expect(stateLabel('NOT_RUN')).toBe('Проверка не запускалась');
  expect(stateLabel('COMPLETED')).toBe('Завершён');
});

it('показывает факт сохранения данных даже если сводная проверка не запускалась', () => {
  const saved = {
    environmentSnapshotId: 'snapshot', initialMapStatus: 'MAPPED',
    forces: [{ id: 'force' }], equipment: [], formation: {}, logistics: {}, autonomy: {},
    readinessStage: {}, readinessStates: [{}],
  } as unknown as PreparationDraft;
  const statuses = preparationStepStates({ state: 'DRAFT', validation: 'NOT_RUN' } as ExerciseCard, saved);
  expect(Object.values(statuses)).toEqual([
    'DATA_PRESENT', 'DATA_PRESENT', 'DATA_PRESENT', 'DATA_PRESENT', 'NEEDS_DATA',
  ]);
  expect(stateLabel('DATA_PRESENT')).toBe('Данные сохранены');
});
