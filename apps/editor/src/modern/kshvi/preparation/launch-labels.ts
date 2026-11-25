import type { ExerciseState } from '../kshvi-api';

export type LaunchCommand = 'SUBMIT' | 'APPROVE' | 'SEAL' | 'START';
export type LaunchAction = Readonly<{ command: LaunchCommand; label: string }>;

export function launchActionFor(state: ExerciseState): LaunchAction {
  if (state === 'APPROVED') return { command: 'SEAL', label: 'Зафиксировать сценарий' };
  if (state === 'SEALED') return { command: 'START', label: 'Запустить учение' };
  if (state === 'IN_REVIEW') return { command: 'APPROVE', label: 'Утвердить редакцию' };
  return { command: 'SUBMIT', label: 'Отправить на проверку' };
}
