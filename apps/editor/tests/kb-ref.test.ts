import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Entry } from '@def-ops/knowledge';
import { KB_FALLBACK_NOTE, KB_REF_TIMEOUT_MS, kbRefClient, seedAnswer, umpireRefs, windowAnswer, type KbRefAnswer, type KbRefRequest } from '../src/sim/kb-ref';

// база окна не открывается (хранилище недоступно) — справка роли должна быть ошибкой, а не пустым «успехом»
vi.mock('../src/kb/store', () => ({
  entries: () => Promise.reject(new Error('хранилище недоступно')),
  all: () => Promise.reject(new Error('хранилище недоступно')),
}));

const read = <T>(p: string) => JSON.parse(readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8')) as T;
const seed = read<{ entries: Entry[] } | Entry[]>('packages/knowledge/data/seed.json');
const entries = Array.isArray(seed) ? seed : seed.entries;

const req: KbRefRequest = { queries: ['контратака резервом'], scope: { role: 'umpire', operation: 'berlin-1945-tasks', moment: '1945-04-17T05:00' }, limit: 8, chars: 900 };
const fromWindow: KbRefAnswer = { refs: [{ id: 'u:x', title: 'Запись пользователя', text: 'текст' }], text: '[R1] Запись пользователя\nтекст' };
const fromSeed: KbRefAnswer = { refs: [{ id: 'org:seed', title: 'Сид', text: 'сид' }], text: '[R1] Сид\nсид' };

describe('справка из окна: ожидание, запасной путь по сиду', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const setup = () => {
    const posted: { kind: 'kbRef'; id: number; req: KbRefRequest }[] = [];
    const fallback = vi.fn(async () => fromSeed);
    const c = kbRefClient((m) => posted.push(m), fallback);
    return { posted, fallback, c };
  };

  it('ожидание — 8 с', () => { expect(KB_REF_TIMEOUT_MS).toBe(8000); });

  it('окно ответило за 1 с — ответ окна, без запасного пути', async () => {
    const { posted, fallback, c } = setup();
    const p = c.request(req);
    expect(posted).toHaveLength(1);
    expect(posted[0].req).toEqual(req);
    await vi.advanceTimersByTimeAsync(1000);
    c.receive({ id: posted[0].id, ok: true, answer: fromWindow });
    const r = await p;
    expect(r).toEqual(fromWindow);
    expect(r.fallback).toBeUndefined();
    expect(fallback).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10000);
    expect(fallback).not.toHaveBeenCalled();
  });

  it('окно не ответило — через 8000 мс запасной путь, fallback: true; запоздалый ответ игнорируется (Review Focus 4)', async () => {
    const { posted, fallback, c } = setup();
    let settled = 0;
    const p = c.request(req).then((r) => { settled++; return r; });
    await vi.advanceTimersByTimeAsync(7999);
    expect(fallback).not.toHaveBeenCalled();
    expect(settled).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(fallback).toHaveBeenCalledWith(req);
    const r = await p;
    expect(r).toEqual({ ...fromSeed, fallback: true });
    await vi.advanceTimersByTimeAsync(1000); // 9 с после запроса
    expect(() => c.receive({ id: posted[0].id, ok: true, answer: fromWindow })).not.toThrow();
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(1);
    expect(await p).toEqual({ ...fromSeed, fallback: true });
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it('receive с неизвестным id не бросает', () => {
    const { c } = setup();
    expect(() => c.receive({ id: 12345, ok: true, answer: fromWindow })).not.toThrow();
    expect(() => c.receive({ id: 12345, ok: false, error: 'x' })).not.toThrow();
  });

  it('ok: false — запасной путь сразу, без ожидания; таймер потом не зовёт его второй раз', async () => {
    const { posted, fallback, c } = setup();
    const p = c.request(req);
    c.receive({ id: posted[0].id, ok: false, error: 'база недоступна' });
    await vi.advanceTimersByTimeAsync(0);
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(await p).toEqual({ ...fromSeed, fallback: true });
    await vi.advanceTimersByTimeAsync(10000);
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it('у запросов разные id; ответ одному не разрешает другой', async () => {
    const { posted, c } = setup();
    const a = c.request(req), b = c.request(req);
    expect(posted[0].id).not.toBe(posted[1].id);
    c.receive({ id: posted[1].id, ok: true, answer: fromWindow });
    expect(await b).toEqual(fromWindow);
    await vi.advanceTimersByTimeAsync(KB_REF_TIMEOUT_MS);
    expect((await a).fallback).toBe(true);
  });

  it('штабу, Ставке и посреднику — только с моментом хода (без него будущее не отсекается)', () => {
    const { posted, fallback, c } = setup();
    for (const role of ['umpire', 'stavka', 'staff'] as const)
      expect(() => c.request({ queries: ['x'], scope: { role, operation: 'berlin-1945-tasks' } })).toThrow(/момент/);
    expect(posted).toHaveLength(0);
    expect(fallback).not.toHaveBeenCalled();
    expect(() => seedAnswer(entries, { queries: ['x'], scope: { role: 'stavka', side: 'su' } })).toThrow(/момент/);
  });

  it('посредник: запрос справки с моментом хода, операцией, 8 × 900', async () => {
    const { posted, c } = setup();
    let fb = 0;
    const f = umpireRefs(c, 'berlin-1945-tasks', () => fb++);
    const p = f(['бой в городе'], '1945-04-20T05:00');
    expect(posted[0].req).toEqual({ queries: ['бой в городе'], scope: { role: 'umpire', operation: 'berlin-1945-tasks', moment: '1945-04-20T05:00' }, limit: 8, chars: 900 });
    c.receive({ id: posted[0].id, ok: true, answer: fromWindow });
    expect(await p).toEqual(fromWindow.refs);
    expect(fb).toBe(0);
    const q = f(['бой в городе'], '1945-04-21T05:00');
    await vi.advanceTimersByTimeAsync(KB_REF_TIMEOUT_MS);
    expect(await q).toEqual(fromSeed.refs);
    expect(fb).toBe(1);
  });
});

describe('база окна недоступна — ошибка, поток считает по сиду с заметкой', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('kb.roleRef при ошибке загрузки базы — отказ, а не пустая справка', async () => {
    const kb = await import('../src/kb/kb');
    await expect(kb.roleRef(['контратака'], { role: 'umpire', operation: 'berlin-1945-tasks', moment: '1945-04-17T05:00' })).rejects.toThrow();
  });

  it('окно с ошибкой базы: ответ ok:false → запасной путь по сиду сразу, заметка в журнал', async () => {
    const failing = { roleRef: () => Promise.reject(new Error('база недоступна')), doctrine: () => Promise.reject(new Error('база недоступна')) };
    let c!: ReturnType<typeof kbRefClient>;
    c = kbRefClient((m) => {
      void windowAnswer(failing, m.req).then((answer) => c.receive({ id: m.id, ok: true, answer }), (e) => c.receive({ id: m.id, ok: false, error: String(e) }));
    }, async (r) => seedAnswer(entries, r));
    let notes = 0;
    const refs = await umpireRefs(c, 'berlin-1945-tasks', () => notes++)(['контратака резервом'], '1945-04-17T05:00');
    expect(refs.length).toBeGreaterThan(0);
    expect(notes).toBe(1);
  });

  it('окно: момент хода — и в доктрину, доктрина в запросе — справке штаба без записей доктрины', async () => {
    const calls: unknown[][] = [];
    const ok = { roleRef: async (...a: unknown[]) => { calls.push(['ref', ...a]); return { refs: [], text: '' }; }, doctrine: async (...a: unknown[]) => { calls.push(['doc', ...a]); return { rules: [], text: '' }; } };
    await windowAnswer(ok, { queries: ['q'], scope: { role: 'staff', side: 'de', moment: '1945-04-16T06:00' }, doctrine: { side: 'de', triggers: ['penetration'], query: 'q' } });
    expect(calls[0][2]).toMatchObject({ role: 'staff', doctrine: true, moment: '1945-04-16T06:00' });
    expect(calls[1]).toEqual(['doc', 'de', ['penetration'], 'q', undefined, '1945-04-16T06:00']);
  });
});

describe('справка по сиду (запасной путь)', () => {
  it('на 16.04 06:00 — без местности с историей после хода и без приказа № 00566; на 19.04 приказ есть', () => {
    const queries = ['отсечная позиция Штайн прорыв', 'переправы 49 А Огница Шведт', 'Шлосс-брюкке мост Шпрее'];
    for (const role of ['staff', 'umpire'] as const) {
      const a = seedAnswer(entries, { queries, scope: { role, side: 'su', operation: 'berlin-1945-tasks', moment: '1945-04-16T06:00' }, limit: 20, chars: 900 });
      for (const id of ['line:belt_stein', 'obj:br_oder_ognica', 'obj:br_spree_schloss']) expect(a.refs.map((r) => r.id), role).not.toContain(id);
    }
    const doc = (moment: string) => seedAnswer(entries, { queries: [], scope: { role: 'stavka', side: 'su', operation: 'berlin-1945-tasks', moment },
      doctrine: { side: 'su', triggers: ['pressure'], query: 'наступление развивается медленно пауза', levels: ['front'] } }).doctrine!.rules.map((r) => r.claim.rule);
    expect(doc('1945-04-16T06:00')).not.toContain('stop-pause-front-dir-00566');
    expect(doc('1945-04-19T06:00')).toContain('stop-pause-front-dir-00566');
  });

  it('штаб с доктриной в запросе — записей доктрины в справке нет (их правила — в блоке доктрины)', () => {
    const a = seedAnswer(entries, { queries: ['контратака резервом во фланг вклинения', 'отход на следующий рубеж'], scope: { role: 'staff', side: 'de', operation: 'berlin-1945-tasks', moment: '1945-04-19T05:00' }, limit: 10,
      doctrine: { side: 'de', triggers: ['penetration'], query: 'контратака' } });
    expect(a.refs.some((r) => /-doctrine-/.test(r.id))).toBe(false);
    const b = seedAnswer(entries, { queries: ['контратака резервом во фланг вклинения'], scope: { role: 'staff', side: 'de', operation: 'berlin-1945-tasks', moment: '1945-04-19T05:00' }, limit: 10 });
    expect(b.refs.some((r) => /-doctrine-/.test(r.id))).toBe(true);
  });

  it('штаб de: без хода боёв и хронологии; доктрина — стороны de', () => {
    const byId = new Map(entries.map((e) => [e.id, e]));
    const a = seedAnswer(entries, { queries: ['контратака резервом'], scope: { role: 'staff', side: 'de', moment: '1945-04-19T05:00' }, doctrine: { side: 'de', triggers: ['penetration'], query: 'контратака' } });
    expect(a.refs.length).toBeGreaterThan(0);
    expect(a.refs.length).toBeLessThanOrEqual(5);
    for (const r of a.refs) {
      expect(['battles', 'chronology']).not.toContain(byId.get(r.id)?.category);
      expect(r.text.length).toBeLessThanOrEqual(700);
    }
    expect(a.text.startsWith('[R1] ')).toBe(true);
    expect(a.doctrine?.rules.length).toBeGreaterThan(0);
    expect(a.doctrine!.rules.every((r) => r.claim.side === 'de')).toBe(true);
    expect(a.doctrine!.text.length).toBeLessThanOrEqual(4000);
  });

  it('без доктрины в запросе — поля doctrine нет; limit/chars из запроса', () => {
    const a = seedAnswer(entries, { queries: ['прорыв укреплённой полосы обороны артподготовка темп', 'бой в городе штурмовые группы'], scope: { role: 'umpire', moment: '1945-04-17T05:00' }, limit: 8, chars: 900 });
    expect(a.doctrine).toBeUndefined();
    expect(a.refs.length).toBeGreaterThan(5);
    expect(a.refs.length).toBeLessThanOrEqual(8);
    expect(a.refs.every((r) => r.text.length <= 900)).toBe(true);
  });
});

describe('заметка о запасном пути', () => {
  it('без срока: запасной путь — и по сроку, и по ошибке окна', () => {
    expect(KB_FALLBACK_NOTE).toBe('Справка из базы знаний без слоя пользователя: окно не дало справку — справка по встроенной базе');
    expect(KB_FALLBACK_NOTE).not.toMatch(/\d+ с\b/);
  });
});
