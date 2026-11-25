// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { emptyPreparationDraft } from '@def-ops/kshvi/preparation-draft';
import type { ExerciseCard, ExerciseState } from '../src/modern/kshvi/kshvi-api';
import { PreparationWorkspace } from '../src/modern/kshvi/preparation/PreparationWorkspace';

afterEach(cleanup);
const at = '2026-11-25T06:00:00Z';

function card(state: Exclude<ExerciseState, 'ARCHIVED'>): ExerciseCard {
  return {
    id: 'e1', title: 'Учение', payloadAccess: 'FULL', revision: 1, state, validation: 'NOT_RUN', readiness: 0,
    purpose: 'planned', scale: 'operational', ownerId: 'u1', startsAt: null, endsAt: null,
    createdAt: at, updatedAt: at, archivedAt: null, lastSessionId: null, sessions: [],
    revisions: [{ id: 'r1', exerciseId: 'e1', revision: 1, state, payload: {}, createdAt: at, createdBy: 'u1', supersedesId: null, sha256: 'a'.repeat(64) }],
  };
}

it('называет действия по серверному жизненному циклу', () => {
  const { rerender } = render(<PreparationWorkspace card={card('DRAFT')} draft={emptyPreparationDraft(at)} initialStep="launch" />);
  expect(screen.getByRole('button', { name: 'Отправить на проверку' })).toBeTruthy();
  rerender(<PreparationWorkspace card={card('IN_REVIEW')} draft={emptyPreparationDraft(at)} initialStep="launch" />);
  expect(screen.getByRole('button', { name: 'Утвердить редакцию' })).toBeTruthy();
  rerender(<PreparationWorkspace card={card('APPROVED')} draft={emptyPreparationDraft(at)} initialStep="launch" />);
  expect(screen.getByRole('button', { name: 'Зафиксировать сценарий' })).toBeTruthy();
  rerender(<PreparationWorkspace card={card('SEALED')} draft={emptyPreparationDraft(at)} initialStep="launch" onStartOfficial={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'Запустить учение' })).toBeTruthy();
});

it('не запускает сеанс после одной локальной проверки', () => {
  const onStart = vi.fn();
  const onValidate = vi.fn();
  render(<PreparationWorkspace card={card('DRAFT')} draft={emptyPreparationDraft(at)} initialStep="launch" onValidate={onValidate} onStartOfficial={onStart} />);
  fireEvent.click(screen.getByRole('button', { name: 'Проверить комплект локально' }));
  expect(onValidate).toHaveBeenCalledOnce();
  expect(onStart).not.toHaveBeenCalled();
  expect(screen.getByText('Сценарий ещё не зафиксирован')).toBeTruthy();
});

it('фиксирует утверждённую редакцию серверной командой, а запуск выполняет отдельно', () => {
  const onAction = vi.fn();
  const onStart = vi.fn();
  const { rerender } = render(<PreparationWorkspace card={card('APPROVED')} draft={emptyPreparationDraft(at)} initialStep="launch" onLaunchAction={onAction} onStartOfficial={onStart} />);
  fireEvent.click(screen.getByRole('button', { name: 'Зафиксировать сценарий' }));
  expect(onAction).toHaveBeenCalledWith('SEAL');
  expect(onStart).not.toHaveBeenCalled();
  rerender(<PreparationWorkspace card={card('SEALED')} draft={emptyPreparationDraft(at)} initialStep="launch" onLaunchAction={onAction} onStartOfficial={onStart} />);
  fireEvent.click(screen.getByRole('button', { name: 'Запустить учение' }));
  expect(onStart).toHaveBeenCalledOnce();
});
