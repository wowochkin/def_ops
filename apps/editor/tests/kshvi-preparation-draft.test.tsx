// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import type { PreparationDraft } from '@def-ops/kshvi/preparation-draft';
import { ExerciseClient, type ExerciseCard } from '../src/modern/kshvi/kshvi-api';
import { usePreparationDraft } from '../src/modern/kshvi/preparation/usePreparationDraft';

const at = '2030-01-01T06:00:00Z';
const later = '2030-01-01T07:00:00Z';
const draft: PreparationDraft = {
  schemaVersion: 1, environmentSnapshotId: null, initialMap: null, initialMapStatus: 'DRAFT',
  forces: [], equipment: [], formation: null, logistics: null, autonomy: null, readinessStage: null, readinessStates: [],
  updatedAt: at,
};
const initialCard: ExerciseCard = {
  id: 'exercise-1', title: 'Подготовка', purpose: 'planned', scale: 'operational', state: 'DRAFT',
  revision: 3, ownerId: 'author', startsAt: null, endsAt: null, readiness: 0, validation: 'NOT_RUN',
  createdAt: at, updatedAt: at, archivedAt: null, lastSessionId: null, sessions: [],
  revisions: [{
    id: 'revision-3', exerciseId: 'exercise-1', revision: 3, payload: { intent: 'Замысел' },
    state: 'DRAFT', sha256: 'a'.repeat(64), createdBy: 'author', createdAt: at, supersedesId: 'revision-2',
  }],
};

function server(beforeSave?: () => Promise<void>) {
  let card = initialCard;
  const client = new ExerciseClient({
    fetch: async (input, options) => {
      const path = String(input);
      if (path.endsWith('/exercises/exercise-1') && options?.method === 'GET') return Response.json(card);
      if (!path.endsWith('/exercises/exercise-1/preparation') || options?.method !== 'POST') throw new Error(`Неожиданный запрос ${path}`);
      await beforeSave?.();
      const revision = JSON.parse(String(options.body));
      if (revision.expectedRevision !== card.revision) {
        return Response.json({ error: { message: 'Данные изменились, обновите редакцию' } }, { status: 409 });
      }
      const previous = card.revisions.at(-1)!;
      const payload = { ...(previous.payload as object), preparation: { ...revision.draft, updatedAt: later } };
      card = {
        ...card, revision: card.revision + 1,
        revisions: [...card.revisions, {
          ...previous, id: `revision-${card.revision + 1}`, revision: card.revision + 1, supersedesId: previous.id, payload,
        }],
      };
      return Response.json(card, { status: 201 });
    },
  });
  return client;
}

afterEach(cleanup);

it('сохраняет черновик в новой серверной редакции вместе с прежним замыслом', async () => {
  const client = server();
  const saved = await client.savePreparation(initialCard.id, { expectedRevision: 3, draft });
  expect(saved.revision).toBe(4);
  expect(saved.revisions.at(-1)?.payload).toEqual({
    intent: 'Замысел', preparation: { ...draft, updatedAt: later },
  });
  expect(saved.revisions[0].payload).toEqual({ intent: 'Замысел' });
});

it('заменяет локальный черновик и номер редакции серверным ответом и восстанавливает их после открытия', async () => {
  const client = server();
  const first = renderHook(() => usePreparationDraft(client, initialCard));
  expect(first.result.current.draft).toEqual(draft);
  const edited = { ...draft, environmentSnapshotId: 'snapshot-1' };
  act(() => first.result.current.setDraft(edited));
  await act(async () => { await first.result.current.save(); });
  expect(first.result.current.revision).toBe(4);
  expect(first.result.current.draft).toEqual({ ...edited, updatedAt: later });
  first.unmount();

  const restored = await client.getCard(initialCard.id);
  const second = renderHook(() => usePreparationDraft(client, restored));
  expect(second.result.current.revision).toBe(4);
  expect(second.result.current.draft).toEqual({ ...edited, updatedAt: later });
});

it('отклоняет сохранение устаревшей редакции и сохраняет локальную правку для разрешения конфликта', async () => {
  const client = server();
  const opened = renderHook(({ card }) => usePreparationDraft(client, card), { initialProps: { card: initialCard } });
  const winningDraft = { ...draft, environmentSnapshotId: 'snapshot-first' };
  const localDraft = { ...draft, environmentSnapshotId: 'snapshot-other' };
  await client.savePreparation(initialCard.id, { expectedRevision: 3, draft: winningDraft });
  act(() => opened.result.current.setDraft(localDraft));
  await act(async () => {
    await expect(opened.result.current.save()).rejects.toMatchObject({ status: 409 });
  });
  const refreshed = await client.getCard(initialCard.id);
  opened.rerender({ card: refreshed });
  expect(opened.result.current.draft).toEqual(localDraft);
  expect(opened.result.current.revision).toBe(3);
  expect(opened.result.current.confirmed).toEqual({ revision: 4, draft: { ...winningDraft, updatedAt: later } });
  await act(async () => {
    await expect(opened.result.current.save()).rejects.toMatchObject({ status: 409 });
  });
  expect((await client.getCard(initialCard.id)).revisions.at(-1)?.payload).toMatchObject({
    preparation: { environmentSnapshotId: 'snapshot-first' },
  });
  act(() => opened.result.current.resolveConflict(localDraft));
  await act(async () => { await opened.result.current.save(); });
  expect(opened.result.current.revision).toBe(5);
  expect(opened.result.current.draft).toEqual({ ...localDraft, updatedAt: later });
});

it('сохраняет правку, внесённую после отправки черновика, поверх подтверждённой редакции', async () => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const client = server(() => pending);
  const opened = renderHook(() => usePreparationDraft(client, initialCard));
  const submitted = { ...draft, environmentSnapshotId: 'snapshot-first' };
  const latest = { ...draft, environmentSnapshotId: 'snapshot-other' };
  act(() => opened.result.current.setDraft(submitted));
  const saving = opened.result.current.save();
  act(() => opened.result.current.setDraft(latest));
  await act(async () => { release(); await saving; });
  expect(opened.result.current.draft).toEqual(latest);
  expect(opened.result.current.revision).toBe(4);
  expect(opened.result.current.confirmed).toEqual({ revision: 4, draft: { ...submitted, updatedAt: later } });
  await act(async () => { await opened.result.current.save(); });
  expect(opened.result.current.draft).toEqual({ ...latest, updatedAt: later });
});
