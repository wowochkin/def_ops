// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ParticipantRosterEditor } from '../src/modern/kshvi/preparation/ParticipantRosterEditor';

afterEach(cleanup);

it('выбирает настоящее назначение и отправляет только исходные ID', async () => {
  const candidate = { userId: 'user', roleAssignmentId: 'role', instanceId: 'instance', sideId: 'blue', role: 'TRAINEE', label: 'Участник · instance' };
  const bindParticipants = vi.fn(async () => ({ id: 'exercise', revision: 2 }));
  const onRevision = vi.fn();
  render(<ParticipantRosterEditor exerciseId="exercise" revision={1} client={{
    getParticipantRoster: async () => ({ revision: 1, items: [], candidates: [candidate] }), bindParticipants,
  } as never} disabled={false} onRevision={onRevision} onError={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Состав участников редакции' }));
  const checkbox = await screen.findByRole('checkbox', { name: /Участник/ });
  fireEvent.click(checkbox);
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить состав новой редакцией' }));
  await waitFor(() => expect(onRevision).toHaveBeenCalled());
  expect(bindParticipants.mock.calls[0]).toEqual(['exercise', { expectedRevision: 1, participants: [
    { userId: 'user', roleAssignmentId: 'role', instanceId: 'instance' },
  ] }]);
});
