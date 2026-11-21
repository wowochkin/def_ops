// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppWorkspace, AppModeSwitch } from '../src/AppMode';
import { ExerciseClient } from '../src/modern/kshvi/kshvi-api';
import { KshviView } from '../src/modern/kshvi/KshviView';
import { LibraryView, type LibraryExercise } from '../src/modern/kshvi/LibraryView';

const fullItem: LibraryExercise = {
  id: 'e1',
  title: 'Учение 1',
  revision: 3,
  state: 'IN_REVIEW',
  validation: 'WARNING',
  scale: 'operational',
  purpose: 'planned',
  ownerId: 'author-1',
  startsAt: '2026-12-01T06:00:00.000Z',
  endsAt: '2026-12-03T18:00:00.000Z',
  readiness: 35,
  lastSessionId: 'session-1',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('библиотека КШВИ', () => {
  it('показывает редакцию и результат последней проверки', () => {
    render(<LibraryView items={[{ id: 'e1', title: 'Учение 1', revision: 3, state: 'DRAFT', validation: 'WARNING' }]} />);
    expect(screen.getByText('Учение 1')).toBeTruthy();
    expect(screen.getByText('Редакция 3')).toBeTruthy();
    expect(screen.getByText('Есть предупреждения')).toBeTruthy();
  });

  it('показывает масштаб, назначение, состояние, ответственного, даты и готовность', () => {
    render(<LibraryView items={[fullItem]} />);
    expect(screen.getByText('Оперативный')).toBeTruthy();
    expect(screen.getByText('Плановое')).toBeTruthy();
    expect(screen.getByText('На проверке', { selector: '.kshvi-state' })).toBeTruthy();
    expect(screen.getByText('Ответственный: author-1')).toBeTruthy();
    expect(screen.getByText(/01\.12\.2026/)).toBeTruthy();
    expect(screen.getByText(/03\.12\.2026/)).toBeTruthy();
    expect(screen.getByText('Готовность 35%')).toBeTruthy();
  });

  it('передаёт поиск и фильтры в серверный клиент', () => {
    const onFiltersChange = vi.fn();
    render(<LibraryView items={[]} onFiltersChange={onFiltersChange} />);
    fireEvent.change(screen.getByLabelText('Поиск'), { target: { value: 'Рубеж' } });
    fireEvent.change(screen.getByLabelText('Состояние'), { target: { value: 'DRAFT' } });
    fireEvent.change(screen.getByLabelText('Масштаб'), { target: { value: 'operational' } });
    fireEvent.change(screen.getByLabelText('Назначение'), { target: { value: 'planned' } });
    fireEvent.click(screen.getByRole('button', { name: 'Найти' }));
    expect(onFiltersChange).toHaveBeenCalledWith({ query: 'Рубеж', state: 'DRAFT', scale: 'operational', purpose: 'planned' });
  });

  it('вызывает копирование, сравнение редакций, архивирование и переход к последнему сеансу', () => {
    const onCopy = vi.fn();
    const onCompare = vi.fn();
    const onArchive = vi.fn();
    const onOpenSession = vi.fn();
    render(<LibraryView items={[fullItem]} onCopy={onCopy} onCompare={onCompare} onArchive={onArchive} onOpenSession={onOpenSession} />);
    fireEvent.click(screen.getByRole('button', { name: 'Копировать Учение 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Сравнить редакции Учение 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Перейти к последнему сеансу Учение 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Архивировать Учение 1' }));
    expect(onCopy).toHaveBeenCalledWith(fullItem);
    expect(onCompare).toHaveBeenCalledWith(fullItem);
    expect(onOpenSession).toHaveBeenCalledWith(fullItem);
    expect(onArchive).toHaveBeenCalledWith(fullItem);
  });
});

describe('оболочка КШВИ и навигация', () => {
  it('показывает обязательные вкладки и Показ, скрывает администрирование по правам', async () => {
    const client = new ExerciseClient({ fetch: vi.fn(async () => json({ items: [] })) });
    const view = render(<KshviView client={client} authorities={['exercise:read']} />);
    expect(await screen.findByRole('heading', { name: 'КШВИ' })).toBeTruthy();
    for (const name of ['Библиотека', 'Подготовка', 'Проведение', 'Разбор', 'Архив']) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
    expect(screen.queryByRole('button', { name: 'Администрирование' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Показ' })).toBeTruthy();
    view.rerender(<KshviView client={client} authorities={['exercise:read', 'kshvi:admin']} />);
    expect(screen.getByRole('button', { name: 'Администрирование' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Показ' })).toBeTruthy();
  });

  it('хранит локальный одномашинный черновик отдельно от карты и не называет его сетевым сеансом', async () => {
    localStorage.setItem('def_ops.modern.weather.region', '{"bounds":[1,2,3,4]}');
    const client = new ExerciseClient({ fetch: vi.fn(async () => json({ items: [] })) });
    render(<KshviView client={client} authorities={['exercise:read']} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Подготовка' }));
    expect(screen.getByText('Локальный одномашинный редактор')).toBeTruthy();
    expect(screen.getByText(/не является сетевым сеансом/i)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Название локального черновика'), { target: { value: 'Автономный вариант' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить локальный черновик' }));
    expect(localStorage.getItem('def_ops.modern.weather.region')).toBe('{"bounds":[1,2,3,4]}');
    expect(localStorage.getItem('def_ops.kshvi.section')).toBe('preparation');
    expect(localStorage.getItem('def_ops.kshvi.local-editor')).toContain('Автономный вариант');
    expect(screen.getByRole('status').textContent).toContain('Сохранено только на этом компьютере');
  });

  it('добавляет раздел в modern, сохраняет выбор и не меняет соседнюю карту', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ items: [] })));
    localStorage.setItem('def_ops.app.mode', 'modern');
    localStorage.setItem('def_ops.modern.weather.region', '{"bounds":[1,2,3,4]}');
    render(<AppWorkspace historical={(active, onModeChange) => <div>
      <span>Историческая навигация</span><AppModeSwitch mode={active ? 'historical' : 'modern'} onChange={onModeChange} />
    </div>} />);
    fireEvent.click(await screen.findByRole('button', { name: 'КШВИ' }));
    expect(await screen.findByRole('heading', { name: 'КШВИ' })).toBeTruthy();
    expect(localStorage.getItem('def_ops.modern.section')).toBe('kshvi');
    expect(localStorage.getItem('def_ops.modern.weather.region')).toBe('{"bounds":[1,2,3,4]}');
    expect(screen.getByRole('button', { name: 'Переигровка' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Исторический режим' }));
    expect(await screen.findByText('Историческая навигация')).toBeTruthy();
  });
});

describe('клиентский API и подтверждение сервером', () => {
  it('формирует серверные запросы с CSRF и не применяет оптимистичный мир', async () => {
    const fetcher = vi.fn(async () => json({ items: [] }));
    const client = new ExerciseClient({ fetch: fetcher, csrfToken: () => 'csrf-1' });
    await client.list({ query: 'Рубеж', state: 'DRAFT', scale: 'operational', purpose: 'planned' });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/api/kshvi/exercises?');
    expect(url).toContain('query=%D0%A0%D1%83%D0%B1%D0%B5%D0%B6');
    expect(url).toContain('state=DRAFT');
    expect(url).toContain('scale=operational');
    expect(url).toContain('purpose=planned');
    expect(init.credentials).toBe('same-origin');
    expect(init.headers).toMatchObject({ 'X-CSRF-Token': 'csrf-1', 'X-Source-System': 'kshvi-editor' });

    fetcher.mockResolvedValueOnce(json({ id: 'session-1', authority: 'SERVER', confirmedRevision: 0 }, 201));
    const session = await client.createSession('e1', { revision: 2 });
    expect(session.authority).toBe('SERVER');
    const [, sessionInit] = fetcher.mock.calls[1] as unknown as [string, RequestInit];
    expect(JSON.parse(String(sessionInit.body))).toEqual({ revision: 2 });
    expect(sessionInit.method).toBe('POST');
  });

  it('не показывает созданное учение до ответа сервера и обновления библиотеки', async () => {
    let resolveCreate!: (response: Response) => void;
    const created = { ...fullItem, id: 'server-id', title: 'Серверное учение', revision: 1, state: 'DRAFT', validation: 'NOT_RUN' };
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return new Promise<Response>(resolve => { resolveCreate = resolve; });
      return json({ items: [] });
    });
    const client = new ExerciseClient({ fetch: fetcher });
    render(<KshviView client={client} authorities={['exercise:read', 'exercise:create']} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Создать учение' }));
    fireEvent.change(screen.getByLabelText('Название учения'), { target: { value: 'Серверное учение' } });
    fireEvent.change(screen.getByLabelText('Назначение учения'), { target: { value: 'planned' } });
    fireEvent.change(screen.getByLabelText('Масштаб учения'), { target: { value: 'operational' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить на сервере' }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('Серверное учение')).toBeNull();

    fetcher.mockImplementation(async () => json({ items: [created] }));
    resolveCreate(json(created, 201));
    expect(await screen.findByText('Серверное учение')).toBeTruthy();
    expect(screen.getByText('Изменения подтверждены сервером')).toBeTruthy();
  });

  it('показывает сравнение серверных редакций', async () => {
    const card = {
      ...fullItem,
      revisions: [
        { id: 'r1', revision: 1, sha256: 'a'.repeat(64), payload: { intent: 'Первый замысел' } },
        { id: 'r2', revision: 2, sha256: 'b'.repeat(64), payload: { intent: 'Второй замысел' } },
      ],
      sessions: [],
    };
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return json({}, 201);
      if (String(_url).endsWith('/exercises/e1')) return json(card);
      return json({ items: [fullItem] });
    });
    const client = new ExerciseClient({ fetch: fetcher });
    render(<KshviView client={client} authorities={['exercise:read']} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Сравнить редакции Учение 1' }));
    expect(await screen.findByRole('heading', { name: 'Сравнение редакций' })).toBeTruthy();
    expect(screen.getByText('Первый замысел')).toBeTruthy();
    expect(screen.getByText('Второй замысел')).toBeTruthy();
    expect(screen.getByText(/Редакция 1/)).toBeTruthy();
    expect(screen.getByText(/Редакция 2/)).toBeTruthy();
  });
});
