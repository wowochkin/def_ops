import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadContext, loadHistory } from '@def-ops/sim/data';
import { startGame } from '@def-ops/sim';
import { buildAdvice, buildSituation, decideTurn, planVariants, type LiveConfig, type Situation } from '../src/live';
import type { LlmClient } from '../src/llm/client';

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const tpl = { system: read('prompts/staff.system.md'), user: read('prompts/staff.live.md'), profile: read('profiles/wehrmacht-1945.md') };
const cfg = JSON.parse(read('live/berlin-1945-tasks.json')) as LiveConfig;

type Req = { messages: { role: string; content: string }[]; signal?: AbortSignal; schema?: { name: string } };
const isRepair = (r: Req) => r.messages[r.messages.length - 1].content.includes('исправленные приказы');
/** Подставная модель: первый ответ — решение, ответ на подсказку — fix (или ошибка/ожидание отмены). */
function fake(first: unknown, fix: (r: Req) => Promise<unknown> | unknown) {
  const calls: Req[] = [];
  const client = {
    config: { model: 'fake' },
    chat: async (r: Req) => {
      calls.push(r);
      const json = isRepair(r) ? await fix(r) : first;
      return { model: 'fake', content: JSON.stringify(json), reasoning: '', json, timings: { firstTokenMs: 0, totalMs: 1 } };
    },
  } as unknown as LlmClient;
  return { client, calls };
}

const ctx = loadContext('berlin-1945-tasks');
const g = startGame(ctx, 1, '1945-04-19T05:00');
const sit = buildSituation(ctx, g, cfg, tpl);
const good = { formation: sit.formations[0].name, task: 'hold' as const, area: sit.areas[0].title, toArea: null, deadline: '', details: 'держать' };
const BAD = 'Все наступающие армии продолжают наступление на Берлин';
const bad = { formation: BAD, task: 'attack' as const, area: sit.areas[1].title, toArea: null, deadline: '', details: '' };
const decision = (orders: unknown[]) => ({ assessment: 'a', enemyIntent: 'b', intent: 'c', orders, requests: [], risks: [] });

describe('штаб противника: исправление приказов по подсказке', () => {
  it('неисполнимый приказ — один запрос с ошибками и списком своих сил; исправленный приказ заменяет отброшенный', async () => {
    const fixed = { n: 2, formation: sit.formations[1].name, task: 'attack', area: sit.areas[1].title, toArea: null, deadline: '', details: 'наступать' };
    const { client, calls } = fake(decision([good, bad]), () => ({ orders: [fixed] }));
    const phases: number[] = [];
    const t = await decideTurn(client, sit, { onRepair: (n) => phases.push(n) });
    expect(calls.length).toBe(2);
    expect(phases).toEqual([1]);
    const hint = calls[1].messages[calls[1].messages.length - 1].content;
    expect(hint).toContain(`«${BAD}» — нет среди своих сил`);
    for (const f of sit.formations.slice(0, 5)) expect(hint).toContain(f.name);
    expect(hint).toContain(sit.areas[0].title);
    expect(t.ok).toBe(true);
    expect(t.fix).toEqual({ failed: 1, fixed: 1 });
    expect(t.orders.map((o) => o.formation).sort()).toEqual([sit.formations[0].id, sit.formations[1].id].sort());
    expect(t.applied.every((a) => a.order)).toBe(true);
    expect(t.decision!.orders[1].formation).toBe(sit.formations[1].name);
    expect(t.issues.filter((i) => i.level === 'error')).toEqual([]);
  });

  it('исправление снова неисполнимо — остаются исходные приказы и замечания, второго запроса нет', async () => {
    const { client, calls } = fake(decision([good, bad]), () => ({ orders: [{ ...bad, n: 2, formation: 'Ещё одна выдуманная группа' }] }));
    const t = await decideTurn(client, sit);
    expect(calls.length).toBe(2);
    expect(t.fix).toMatchObject({ failed: 1, fixed: 0 });
    expect(t.fix!.notes?.[0]).toMatchObject({ n: 2, text: expect.stringContaining('снова не исполнимо') });
    expect(t.orders.map((o) => o.formation)).toEqual([sit.formations[0].id]);
    expect(t.issues.some((i) => i.text.includes(`«${BAD}» — нет среди своих сил`))).toBe(true);
    expect(t.decision!.orders[1].formation).toBe(BAD);
  });

  it('пустой или неразобранный ответ на подсказку — остаётся исполнимое', async () => {
    const { client, calls } = fake(decision([good, bad]), () => ({ nothing: true }));
    const t = await decideTurn(client, sit);
    expect(calls.length).toBe(2);
    expect(t.ok).toBe(true);
    expect(t.fix?.fixed).toBe(0);
    expect(t.fix?.error).toBeTruthy();
    expect(t.orders.length).toBe(1);
  });

  it('исправление на формирование, у которого уже есть приказ, отклоняется; в подсказке — у кого уже есть приказы', async () => {
    const { client, calls } = fake(decision([good, bad]), () => ({ orders: [{ ...bad, n: 2, formation: good.formation }] }));
    const t = await decideTurn(client, sit);
    expect(calls.length).toBe(2);
    const hint = calls[1].messages[calls[1].messages.length - 1].content;
    expect(hint).toContain(`уже есть приказы: ${good.formation}`);
    expect(t.fix).toMatchObject({ failed: 1, fixed: 0 });
    expect(t.fix!.notes).toEqual([{ n: 2, text: expect.stringContaining('уже есть приказ') }]);
    // исходный приказ не заменён, отброшенный остаётся с замечанием
    expect(t.orders).toHaveLength(1);
    expect(t.orders[0].task).toBe('hold');
    expect(t.applied[1].issue).toContain('уже есть приказ');
  });

  it('ответ с номером исполнимого приказа (n=1) не принимается — без подстановки по порядку', async () => {
    const other = { n: 1, formation: sit.formations[1].name, task: 'attack', area: sit.areas[1].title, toArea: null, deadline: '', details: '' };
    const { client } = fake(decision([good, bad]), () => ({ orders: [other] }));
    const t = await decideTurn(client, sit);
    expect(t.fix).toMatchObject({ failed: 1, fixed: 0 });
    expect(t.decision!.orders[0]).toEqual(good);
    expect(t.decision!.orders[1].formation).toBe(BAD);
  });

  it('исправление с другой задачей отклоняется («задача изменена»)', async () => {
    const { client } = fake(decision([good, bad]), () => ({ orders: [{ ...bad, n: 2, task: 'defend', formation: sit.formations[1].name }] }));
    const t = await decideTurn(client, sit);
    expect(t.fix).toMatchObject({ failed: 1, fixed: 0 });
    expect(t.fix!.notes?.[0].text).toContain('задача изменена');
  });

  it('все приказы исполнимы — запроса на исправление нет', async () => {
    const { client, calls } = fake(decision([good]), () => ({ orders: [] }));
    const t = await decideTurn(client, sit);
    expect(calls.length).toBe(1);
    expect(t.fix).toBeUndefined();
  });

  it('отмена во время исправления — без второго исправления, исходные приказы, без исключения', async () => {
    const ac = new AbortController();
    const { client, calls } = fake(decision([good, bad]), (r) => new Promise((_, rej) => {
      r.signal?.addEventListener('abort', () => rej(new Error('запрос прерван')));
      setTimeout(() => ac.abort(), 10);
    }));
    const t = await decideTurn(client, sit, { signal: ac.signal });
    expect(calls.length).toBe(2);
    expect(t.fix).toMatchObject({ failed: 1, fixed: 0, error: 'остановлено' });
    expect(t.orders.length).toBe(1);
  });

  it('уже отменённый запрос — исправление не запрашивается', async () => {
    const ac = new AbortController();
    const { client, calls } = fake(decision([good, bad]), () => ({ orders: [] }));
    const orig = client.chat.bind(client);
    (client as unknown as { chat: typeof orig }).chat = async (r) => { const x = await orig(r); ac.abort(); return x; };
    const t = await decideTurn(client, sit, { signal: ac.signal });
    expect(calls.length).toBe(1);
    expect(t.fix).toBeUndefined();
  });
});

describe('советник: исправление приказов варианта по подсказке', () => {
  const gs = startGame(ctx, 1, '1945-04-19T05:00', 'su');
  const live = JSON.parse(read('live/berlin-1945-tasks.json'));
  const tplA = { system: read('prompts/advisor.system.md'), user: read('prompts/advisor.user.md'), profile: read('profiles/rkka-1945.md') };
  const built = buildAdvice(ctx, gs, loadHistory('berlin-1945-tasks'), live.advisor, tplA,
    { category: 'plan', question: 'Варианты', draft: '', goal: 'Знамя Победы', thread: [] }, live.description);
  const vsit: Situation = { messages: [], time: gs.state.time, areas: built.parts.areas, allAreas: built.parts.allAreas, enemies: built.parts.enemies, formations: built.parts.formations };
  const own = vsit.formations;
  const o = (formation: string) => ({ formation, task: 'attack', area: vsit.areas[0].title, toArea: null, why: 'зачем' });
  const v = (title: string, orders: unknown[]) => ({ title, idea: 'i', assessment: 'a', enemyIntent: 'e', intent: 'x', risks: 'r', report: 'd', orders, actions: [] });

  it('варианты с неисполнимыми приказами — один общий запрос (варианты пронумерованы), исправленные показываются заново', async () => {
    const first = { variants: [v('Чистый', [o(own[0].name)]), v('С ошибкой', [o(own[0].name), o('Все наступающие армии фронта')]), v('Тоже с ошибкой', [o('Несуществующая армия')])] };
    const { client, calls } = fake(first, () => ({ orders: [
      { v: 2, n: 2, ...o(own[1].name) },
      { v: 2, n: 1, ...o(own[2].name) }, // исполнимый приказ — не трогается
      { v: 3, n: 1, ...o(own[0].name) }, // в варианте 3 у own[0] приказа нет — принимается
    ] }));
    const seen: [number, string, number][] = [];
    const repairs: number[][] = [];
    const r = await planVariants(client, gs, built, 3, { sit: vsit, onRepair: (idx) => repairs.push(idx), onVariant: (x, i) => seen.push([i, x.title, x.orders.length]) });
    expect(calls.length).toBe(2);
    expect(repairs).toEqual([[1, 2]]);
    const hint = calls[1].messages[calls[1].messages.length - 1].content;
    expect(hint).toContain('Вариант 2 «С ошибкой»');
    expect(hint).toContain('Вариант 3 «Тоже с ошибкой»');
    expect(hint).toContain('«Все наступающие армии фронта» — нет среди своих сил');
    expect(hint).toContain(`уже есть приказы: ${own[0].name}`);
    expect(JSON.stringify(calls[1].schema)).toContain('"v"');
    expect(r.variants[1].orders[1]).toEqual({ formation: own[1].name, task: 'attack', area: vsit.areas[0].title, toArea: null, why: 'зачем' });
    expect(r.variants[1].orders[0].formation).toBe(own[0].name);
    expect(r.variants[1].fix).toEqual({ failed: 1, fixed: 1 });
    expect(r.variants[2].fix).toEqual({ failed: 1, fixed: 1 });
    expect(r.variants[0].fix).toBeUndefined();
    expect(seen.filter(([i]) => i === 1).length).toBe(2);
    expect(seen.filter(([i]) => i === 0).length).toBe(1);
  });

  it('отмена во время исправления — варианты не пересылаются, остаются как были', async () => {
    const ac = new AbortController();
    const first = { variants: [v('С ошибкой', [o('Несуществующая армия')])] };
    const { client } = fake(first, (q) => new Promise((_, rej) => {
      q.signal?.addEventListener('abort', () => rej(new Error('запрос прерван')));
      setTimeout(() => ac.abort(), 10);
    }));
    const seen: number[] = [];
    const r = await planVariants(client, gs, built, 1, { sit: vsit, signal: ac.signal, onVariant: (_x, i) => seen.push(i) });
    expect(seen).toEqual([0]);
    expect(r.variants[0].fix).toBeUndefined();
    expect(r.variants[0].orders[0].formation).toBe('Несуществующая армия');
  });
});
