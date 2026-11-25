// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { emptyPreparationDraft } from '@def-ops/kshvi/preparation-draft';
import { ExerciseClient, type ExerciseCard } from '../src/modern/kshvi/kshvi-api';
import { KshviView } from '../src/modern/kshvi/KshviView';
import { WORKSPACE_EXERCISE_KEY } from '../src/modern/kshvi/workspace-session';

const now = '2030-01-01T10:00:00Z';
const card: ExerciseCard = {
  id: 'e1', title: 'Учение', revision: 2, state: 'DRAFT', validation: 'NOT_RUN', payloadAccess: 'FULL',
  purpose: 'planned', scale: 'operational', ownerId: 'leader', startsAt: now, endsAt: null, readiness: 0,
  createdAt: now, updatedAt: now, archivedAt: null, lastSessionId: null, sessions: [],
  revisions: [{
    id: 'r2', exerciseId: 'e1', revision: 2, payload: { intent: 'Закрытый замысел', preparation: JSON.parse(JSON.stringify(emptyPreparationDraft(now))) },
    sha256: 'a'.repeat(64), state: 'DRAFT', createdBy: 'leader', createdAt: now, supersedesId: null,
  }],
};

function clientFor(getCard: () => Promise<Response> = async () => Response.json(card)) {
  return new ExerciseClient({ fetch: async input => {
    const path = String(input);
    if (path.endsWith('/exercises')) return Response.json({ items: [card] });
    if (path.endsWith('/exercises/e1')) return getCard();
    if (path.endsWith('/environment/atlases')) return Response.json([]);
    if (path.endsWith('/symbols/catalog')) return Response.json({ set: { symbols: [] } });
    throw Error(`Неожиданный запрос ${path}`);
  } });
}

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
afterEach(cleanup);

it('отличает старый сервер без области доступа от настоящего ограничения роли', async () => {
  const legacy = JSON.parse(JSON.stringify(card));
  delete legacy.payloadAccess;
  render(<KshviView client={clientFor(async () => Response.json(legacy))} role="DIRECTOR"
    authorities={['exercise:read', 'exercise:revise', 'TRUTH_READ']} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Продолжить подготовку Учение' }));
  const nav = await screen.findByRole('navigation', { name: 'Этапы подготовки' });
  for (const name of ['Среда', 'Силы и МТО', 'События', 'Готовность', 'Запуск']) {
    fireEvent.click(within(nav).getByRole('button', { name }));
    expect(screen.getByText(/Интерфейс и сервер КШВИ разных версий/)).toBeTruthy();
    expect(screen.queryByText(/недоступен для этой роли/)).toBeNull();
  }
  expect(screen.queryByRole('button', { name: 'Сохранить черновик' })).toBeNull();
});

it('показывает пять этапов, отдельную нижнюю панель и проверку запуска без служебных кодов', async () => {
  render(<KshviView client={clientFor()} role="DIRECTOR" authorities={['exercise:read', 'exercise:revise']} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Продолжить подготовку Учение' }));

  const nav = await screen.findByRole('navigation', { name: 'Этапы подготовки' });
  expect(within(nav).getAllByRole('button').map(item => item.getAttribute('aria-label')))
    .toEqual(['Среда', 'Силы и МТО', 'События', 'Готовность', 'Запуск']);
  expect(screen.getByText(/Редакция 2 · Черновик · Руководитель учения/)).toBeTruthy();
  expect(screen.getByText(/Сохранена редакция 2/)).toBeTruthy();

  const back = screen.getByRole<HTMLButtonElement>('button', { name: 'Назад' });
  const next = screen.getByRole<HTMLButtonElement>('button', { name: 'Далее' });
  expect(back.disabled).toBe(true);
  const content = document.getElementById(next.getAttribute('aria-controls')!);
  expect(content?.classList.contains('preparation-step-content')).toBe(true);
  expect(back.parentElement).toBe(next.parentElement);
  expect(content?.nextElementSibling).toBe(next.parentElement);
  fireEvent.click(next);
  expect(within(nav).getByRole('button', { name: 'Силы и МТО' }).getAttribute('aria-current')).toBe('step');
  expect(back.disabled).toBe(false);
  fireEvent.click(back);
  expect(within(nav).getByRole('button', { name: 'Среда' }).getAttribute('aria-current')).toBe('step');

  fireEvent.click(within(nav).getByRole('button', { name: 'Запуск' }));
  expect(screen.getByText('Сценарий ещё не зафиксирован')).toBeTruthy();
  expect(screen.queryByText('Требуется SEALED')).toBeNull();
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Отправить на проверку' }).disabled).toBe(false);
});

it('не открывает закрытое содержимое из сохранённой ссылки или после смены роли', async () => {
  let receive!: (response: Response) => void;
  const nextCard = () => new Promise<Response>(resolve => { receive = resolve; });
  localStorage.setItem('def_ops.kshvi.section', 'preparation');
  sessionStorage.setItem(WORKSPACE_EXERCISE_KEY, JSON.stringify(card));
  const client = clientFor(nextCard);
  const view = render(<KshviView client={client} role="DIRECTOR" authorities={['exercise:read', 'exercise:revise']} />);
  expect(screen.queryByRole('navigation', { name: 'Этапы подготовки' })).toBeNull();
  expect(JSON.parse(sessionStorage.getItem(WORKSPACE_EXERCISE_KEY)!)).toEqual({ id: 'e1' });
  receive(Response.json(card));
  expect(await screen.findByRole('heading', { name: 'Карта и погода исходной обстановки' })).toBeTruthy();

  view.rerender(<KshviView client={client} role="TRAINEE" authorities={['exercise:read']} />);
  expect(screen.queryByRole('heading', { name: 'Карта и погода исходной обстановки' })).toBeNull();
  receive(Response.json({ ...card, payloadAccess: 'PROJECTED', revisions: [] }));
  expect(await screen.findByText('Полный черновик подготовки недоступен для этой роли.')).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'Карта и погода исходной обстановки' })).toBeNull();
  expect(JSON.parse(sessionStorage.getItem(WORKSPACE_EXERCISE_KEY)!)).toEqual({ id: 'e1' });
});

it('сохраняет локальную правку при конфликте до явного выбора серверной редакции', async () => {
  const snapshotId = 'b'.repeat(64);
  const previous = { ...card, revisions: [{ ...card.revisions[0]!, payload: { environmentSnapshotId: snapshotId } }] };
  const latest = {
    ...card, revision: 3,
    revisions: [...previous.revisions, {
      ...card.revisions[0]!, id: 'r3', revision: 3, payload: { intent: 'Замысел после правки' },
    }],
  };
  const sent: unknown[] = [];
  const client = new ExerciseClient({ fetch: async (input, init) => {
    const path = String(input);
    if (path.endsWith('/exercises')) return Response.json({ items: [previous] });
    if (path.endsWith('/exercises/e1')) return Response.json(sent.length ? latest : previous);
    if (path.endsWith('/environment/atlases')) return Response.json([]);
    if (path.endsWith('/symbols/catalog')) return Response.json({ set: { symbols: [] } });
    if (path.endsWith('/preparation')) {
      sent.push(JSON.parse(String(init?.body)));
      return Response.json({ error: { message: 'Данные изменились, обновите редакцию' } }, { status: 409 });
    }
    throw Error(`Неожиданный запрос ${path}`);
  } });
  render(<KshviView client={client} role="DIRECTOR" authorities={['exercise:read', 'exercise:revise']} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Продолжить подготовку Учение' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Добавить сохранённый снимок в черновик' }));
  expect(screen.getByText('Есть несохранённые изменения')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Среда' }).getAttribute('aria-description')).toBe('Не начат');
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить черновик' }));
  const accept = await screen.findByRole('button', { name: 'Принять серверную редакцию' });
  expect(screen.getByText(/Сравнить черновик с редакцией 3/)).toBeTruthy();
  expect(screen.getByText('Есть несохранённые изменения')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Сохранить черновик' })).toBeNull();
  expect(sent).toEqual([expect.objectContaining({ expectedRevision: 2, draft: expect.objectContaining({ environmentSnapshotId: snapshotId }) })]);
  fireEvent.click(accept);
  expect(screen.getByText('Сохранена редакция 3')).toBeTruthy();
  expect(screen.queryByText('Есть несохранённые изменения')).toBeNull();
});

it.each([401, 403, 404])('убирает ранее открытую карточку после ответа %i при повторном открытии из библиотеки', async status => {
  let deny = false;
  const client = clientFor(async () => deny ? Response.json({ error: { message: 'Карточка недоступна' } }, { status }) : Response.json(card));
  render(<KshviView client={client} role="DIRECTOR" authorities={['exercise:read', 'exercise:revise']} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Продолжить подготовку Учение' }));
  expect(await screen.findByRole('heading', { name: 'Карта и погода исходной обстановки' })).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: 'Библиотека' }));
  deny = true;
  fireEvent.click(await screen.findByRole('button', { name: 'Продолжить подготовку Учение' }));
  await screen.findByText('Карточка недоступна');
  fireEvent.click(screen.getByRole('button', { name: 'Подготовка' }));

  expect(screen.getByRole('button', { name: 'Открыть библиотеку' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'Карта и погода исходной обстановки' })).toBeNull();
  expect(sessionStorage.getItem(WORKSPACE_EXERCISE_KEY)).toBeNull();
});

it.each([401, 403, 404])('закрывает мастер после отказа %i чтения карточки при фиксации среды', async status => {
  let reads = 0;
  let snapshots = 0;
  const atlas = { id: 'atlas', name: 'Атлас', bounds: [1, 2, 3, 4], kind: 'vector', minzoom: 4, maxzoom: 14 };
  const client = new ExerciseClient({ fetch: async input => {
    const path = String(input);
    if (path.endsWith('/exercises')) return Response.json({ items: [card] });
    if (path.endsWith('/exercises/e1')) {
      return ++reads === 1
        ? Response.json(card)
        : Response.json({ error: { message: 'Карточка недоступна' } }, { status });
    }
    if (path.endsWith('/environment/atlases')) return Response.json([atlas]);
    if (path.endsWith('/style')) return Response.json({ version: 8, sources: {}, layers: [] });
    if (path.endsWith('/symbols/catalog')) return Response.json({ set: { symbols: [] } });
    if (path.endsWith('/environment/snapshots')) snapshots++;
    throw Error(`Неожиданный запрос ${path}`);
  } });
  render(<KshviView client={client} role="DIRECTOR" authorities={['exercise:read', 'exercise:revise']} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Продолжить подготовку Учение' }));
  await screen.findByRole('option', { name: 'Атлас' });
  const prepare = screen.getByRole<HTMLButtonElement>('button', { name: 'Сформировать новый снимок среды' });
  await waitFor(() => expect(prepare.disabled).toBe(false));
  fireEvent.click(prepare);

  expect(await screen.findByRole('button', { name: 'Открыть библиотеку' })).toBeTruthy();
  expect(screen.getByRole('alert').textContent).toContain('Доступ к выбранному учению изменился');
  expect(screen.queryByRole('heading', { name: 'Карта и погода исходной обстановки' })).toBeNull();
  expect(sessionStorage.getItem(WORKSPACE_EXERCISE_KEY)).toBeNull();
  expect(snapshots).toBe(0);
});

it.each([
  { name: 'сохраняет FULL после предметного отказа impact', deniedCommand: 'environment-impact', code: 'environment_truth_required', retain: true },
  { name: 'сохраняет FULL после предметного отказа фиксации', deniedCommand: 'environment-revisions', code: 'environment_truth_required', retain: true },
  { name: 'убирает прежний FULL при отзыве доступа между чтением карточки и impact', deniedCommand: 'environment-impact', code: 'forbidden', retain: false },
])('$name', async ({ deniedCommand, code, retain }) => {
  const atlas = { id: 'atlas', name: 'Атлас', bounds: [1, 2, 3, 4], kind: 'vector', minzoom: 4, maxzoom: 14 };
  const snapshotId = 'b'.repeat(64);
  const candidateId = 'c'.repeat(64);
  const snapshot = { id: snapshotId, manifestSha256: snapshotId, region: { name: 'Сохранённая область', bounds: atlas.bounds },
    atlases: [{ id: atlas.id, meta: atlas }], weather: { mode: 'scenario', attribution: 'Сценарная погода' }, limitations: [],
    algorithmVersions: { snapshot: 1, weather: 1 } };
  const selected = { ...card, revisions: [{ ...card.revisions[0]!, payload: {
    intent: 'Закрытый замысел', preparation: { ...emptyPreparationDraft(now), environmentSnapshotId: snapshotId },
  } }] };
  const message = 'Для просмотра последствий и смены среды этой редакции нужен доступ к истинной обстановке';
  let reads = 0;
  const client = new ExerciseClient({ fetch: async input => {
    const path = String(input);
    if (path.endsWith('/exercises')) return Response.json({ items: [selected] });
    if (path.endsWith('/exercises/e1')) {
      reads++;
      return Response.json(selected);
    }
    if (path.endsWith(`/${snapshotId}`)) return Response.json(snapshot);
    if (path.endsWith('/environment/atlases')) return Response.json([atlas]);
    if (path.endsWith('/style')) return Response.json({ version: 8, sources: {}, layers: [] });
    if (path.endsWith(`/${deniedCommand}`)) return Response.json({ error: { code, message } }, { status: 403 });
    if (path.endsWith('/environment-impact')) return Response.json({ objects: [], confirmations: [], missingForceIds: [], missingInstanceIds: [] });
    if (path.endsWith('/environment/snapshots')) return Response.json({ ...snapshot, id: candidateId, manifestSha256: candidateId });
    throw Error(`Неожиданный запрос ${path}`);
  } });
  const authorities = ['exercise:read', 'exercise:revise', ...(retain ? [] : ['TRUTH_READ'])];
  render(<KshviView client={client} role={retain ? 'AUTHOR' : 'DIRECTOR'} authorities={authorities} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Продолжить подготовку Учение' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Сменить среду' }));
  const prepare = await screen.findByRole<HTMLButtonElement>('button', { name: 'Сформировать новый снимок среды' });
  await waitFor(() => expect(prepare.disabled).toBe(false));
  fireEvent.click(prepare);
  if (deniedCommand === 'environment-revisions') fireEvent.click(await screen.findByRole('button', { name: 'Зафиксировать среду' }));

  if (retain) {
    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Этапы подготовки' })).toBeTruthy();
    expect(screen.getByText(snapshotId)).toBeTruthy();
    expect(JSON.parse(sessionStorage.getItem(WORKSPACE_EXERCISE_KEY)!)).toEqual({ id: 'e1' });
  } else {
    expect(await screen.findByText('Доступ к выбранному учению изменился. Откройте его снова из библиотеки.')).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Этапы подготовки' })).toBeNull();
    expect(screen.queryByText(snapshotId)).toBeNull();
    expect(sessionStorage.getItem(WORKSPACE_EXERCISE_KEY)).toBeNull();
  }
  expect(reads).toBe(2);
});

it('после временного сбоя обновляет архивную карточку с тем же номером и оставляет решение об уходе пользователю', async () => {
  const previous = { ...card, revisions: [{ ...card.revisions[0]!, payload: { environmentSnapshotId: 'b'.repeat(64) } }] };
  const archived = { ...previous, state: 'ARCHIVED', archivedAt: now };
  let cardRequests = 0;
  const client = new ExerciseClient({ fetch: async input => {
    const path = String(input);
    if (path.endsWith('/exercises')) return Response.json({ items: [previous] });
    if (path.endsWith('/exercises/e1')) {
      switch (++cardRequests) {
        case 1: return Response.json(previous);
        case 2: return Response.json({ error: { message: 'Сервис временно недоступен' } }, { status: 503 });
        default: return Response.json(archived);
      }
    }
    if (path.endsWith('/environment/atlases')) return Response.json([]);
    if (path.endsWith('/symbols/catalog')) return Response.json({ set: { symbols: [] } });
    if (path.endsWith('/preparation')) return Response.json({ error: { message: 'Архивное учение нельзя изменить' } }, { status: 409 });
    throw Error(`Неожиданный запрос ${path}`);
  } });
  render(<KshviView client={client} role="DIRECTOR" authorities={['exercise:read', 'exercise:revise']} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Продолжить подготовку Учение' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Добавить сохранённый снимок в черновик' }));
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить черновик' }));

  fireEvent.click(await screen.findByRole('button', { name: 'Обновить серверную редакцию' }));
  const accept = await screen.findByRole('button', { name: 'Принять серверную редакцию' });
  expect(screen.getByText(/Архивное учение нельзя изменить/)).toBeTruthy();
  expect(screen.getByText('Выбранный снимок остаётся в локальной правке.')).toBeTruthy();
  expect(screen.getByText(/Сравнить черновик с редакцией 2/)).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: 'Библиотека' }));
  expect(screen.queryByRole('heading', { name: 'Библиотека учений' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Остаться в подготовке' }));
  expect(screen.getByText('Есть несохранённые изменения')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Принять серверную редакцию' })).toBe(accept);
  fireEvent.click(accept);
  expect(screen.getByText('Сохранена редакция 2')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Сохранить черновик' })).toBeNull();
});

it('переходит в библиотеку только после явного отказа от несохранённой правки', async () => {
  const previous = { ...card, revisions: [{ ...card.revisions[0]!, payload: { environmentSnapshotId: 'b'.repeat(64) } }] };
  render(<KshviView client={clientFor(async () => Response.json(previous))} role="DIRECTOR" authorities={['exercise:read', 'exercise:revise']} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Продолжить подготовку Учение' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Добавить сохранённый снимок в черновик' }));
  fireEvent.click(screen.getByRole('button', { name: 'Библиотека' }));
  expect(screen.getByText('Есть несохранённые изменения')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Выйти без сохранения' }));
  expect(await screen.findByRole('heading', { name: 'Библиотека учений' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Подготовка' }));
  expect(screen.getByText('Сохранена редакция 2')).toBeTruthy();
  expect(screen.queryByText('Есть несохранённые изменения')).toBeNull();
});

it('отбрасывает задержанную полную карточку из библиотеки после отказа форме среды', async () => {
  let reads = 0;
  let receiveLibrary!: (response: Response) => void;
  let receiveEnvironment!: (response: Response) => void;
  const libraryResponse = new Promise<Response>(resolve => { receiveLibrary = resolve; });
  const environmentResponse = new Promise<Response>(resolve => { receiveEnvironment = resolve; });
  const atlas = { id: 'atlas', name: 'Атлас', bounds: [1, 2, 3, 4], kind: 'vector', minzoom: 4, maxzoom: 14 };
  const client = new ExerciseClient({ fetch: async input => {
    const path = String(input);
    if (path.endsWith('/exercises')) return Response.json({ items: [card] });
    if (path.endsWith('/exercises/e1')) {
      switch (++reads) {
        case 2: return libraryResponse;
        case 3: return environmentResponse;
        default: return Response.json(card);
      }
    }
    if (path.endsWith('/environment/atlases')) return Response.json([atlas]);
    if (path.endsWith('/style')) return Response.json({ version: 8, sources: {}, layers: [] });
    if (path.endsWith('/symbols/catalog')) return Response.json({ set: { symbols: [] } });
    throw Error(`Неожиданный запрос ${path}`);
  } });

  render(<KshviView client={client} role="DIRECTOR" authorities={['exercise:read', 'exercise:revise']} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Продолжить подготовку Учение' }));
  await screen.findByRole('option', { name: 'Атлас' });
  fireEvent.click(screen.getByRole('button', { name: 'Библиотека' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Продолжить подготовку Учение' }));
  await waitFor(() => expect(reads).toBe(2));
  fireEvent.click(screen.getByRole('button', { name: 'Подготовка' }));
  await screen.findByRole('option', { name: 'Атлас' });
  const prepare = screen.getByRole<HTMLButtonElement>('button', { name: 'Сформировать новый снимок среды' });
  await waitFor(() => expect(prepare.disabled).toBe(false));
  fireEvent.click(prepare);
  await waitFor(() => expect(reads).toBe(3));

  receiveEnvironment(Response.json({ error: { message: 'Карточка недоступна' } }, { status: 403 }));
  expect(await screen.findByRole('button', { name: 'Открыть библиотеку' })).toBeTruthy();
  await act(async () => { receiveLibrary(Response.json({ ...card, title: 'Устаревшая полная карточка' })); });

  expect(screen.queryByRole('heading', { name: 'Устаревшая полная карточка' })).toBeNull();
  expect(screen.queryByRole('navigation', { name: 'Этапы подготовки' })).toBeNull();
  expect(sessionStorage.getItem(WORKSPACE_EXERCISE_KEY)).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'Открыть библиотеку' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Продолжить подготовку Учение' }));
  expect(await screen.findByRole('heading', { name: 'Карта и погода исходной обстановки' })).toBeTruthy();
  expect(reads).toBe(4);
});

it('запускает зафиксированную редакцию только после явного разрешения конфликта сохранения', async () => {
  const previous = { ...card, revisions: [{ ...card.revisions[0]!, payload: { environmentSnapshotId: 'b'.repeat(64) } }] };
  const sealed: ExerciseCard = {
    ...previous, revision: 3, state: 'SEALED', validation: 'OK',
    revisions: [...previous.revisions, { ...previous.revisions[0]!, id: 'r3', revision: 3, state: 'SEALED' }],
  };
  let conflict = false;
  const started: unknown[] = [];
  const client = new ExerciseClient({ fetch: async (input, init) => {
    const path = String(input);
    if (path.endsWith('/exercises')) return Response.json({ items: [previous] });
    if (path.endsWith('/exercises/e1')) return Response.json(conflict ? sealed : previous);
    if (path.endsWith('/environment/atlases')) return Response.json([]);
    if (path.endsWith('/symbols/catalog')) return Response.json({ set: { symbols: [] } });
    if (path.endsWith('/preparation')) {
      conflict = true;
      return Response.json({ error: { message: 'Данные изменились, обновите редакцию' } }, { status: 409 });
    }
    if (path.endsWith('/sessions') && init?.method === 'POST') {
      started.push(JSON.parse(String(init.body)));
      return Response.json({
        id: 's1', exerciseId: 'e1', scenarioRevisionId: 'r3', revision: 3, state: 'ACTIVE', authority: 'SERVER',
        mode: 'NETWORK', confirmedRevision: 0, createdBy: 'leader', createdAt: now,
      }, { status: 201 });
    }
    throw Error(`Неожиданный запрос ${path}`);
  } });
  render(<KshviView client={client} role="DIRECTOR" authorities={['exercise:read', 'exercise:revise', 'exercise:conduct']} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Продолжить подготовку Учение' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Добавить сохранённый снимок в черновик' }));
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить черновик' }));
  await screen.findByRole('button', { name: 'Принять серверную редакцию' });
  fireEvent.click(screen.getByRole('button', { name: 'Запуск' }));
  expect(screen.getByText('Сценарий зафиксирован')).toBeTruthy();

  const start = screen.getByRole<HTMLButtonElement>('button', { name: 'Запустить учение' });
  expect(start.disabled).toBe(true);
  fireEvent.click(start);
  expect(started).toEqual([]);
  expect(screen.getByText('Есть несохранённые изменения')).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: 'Принять серверную редакцию' }));
  expect(start.disabled).toBe(false);
  fireEvent.click(start);
  expect(await screen.findByRole('heading', { name: 'Сеанс s1' })).toBeTruthy();
  expect(started).toEqual([{ revision: 3 }]);
});
