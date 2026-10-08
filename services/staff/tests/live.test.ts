import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { loadContext } from '@def-ops/sim/data';
import { playTurn, startGame } from '@def-ops/sim';
import { buildSituation, decideTurn, decisionToOrders, type LiveConfig } from '../src/live';
import { mockDecision, startMockServer } from '../src/live/mock';
import { LlmClient } from '../src/llm/client';
import { configFromEnv } from '../src/llm/config';

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const tpl = { system: read('prompts/staff.system.md'), user: read('prompts/staff.live.md'), profile: read('profiles/wehrmacht-1945.md') };
const cfg = JSON.parse(read('live/berlin-1945-tasks.json')) as LiveConfig;

let server: Server;
let url = '';
beforeAll(async () => { server = await startMockServer(0, '127.0.0.1', 0); url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`; });
afterAll(() => server.close());

describe('штаб модели в игре', () => {
  const ctx = loadContext('berlin-1945-tasks');
  const g = startGame(ctx, 1, '1945-04-19T05:00');

  it('обстановка из расчёта: свои силы, противник в пределах разведки, пункты, сводка за сутки', () => {
    const sit = buildSituation(ctx, g, cfg, tpl);
    const u = sit.messages[1].content;
    expect(sit.messages[0].content).toContain('Германия (вермахт)');
    expect(u).toContain('утро 19 апреля 1945 года, 05:00');
    expect(u).toContain('9-я парашютная дивизия');
    expect(u).toMatch(/8-я гвардейская армия — .*; оценка: до/);
    expect(u).toMatch(/км к (С|СВ|В|ЮВ|Ю|ЮЗ|З|СЗ) от Берлина/);
    expect(u).not.toMatch(/\{[a-z_]+\}/);
    expect(sit.formations.every((f) => f.id.startsWith('de_'))).toBe(true);
    expect(sit.enemies.length).toBeGreaterThan(3);
  });

  it('решение → приказы: названия сопоставляются, неопознанное отбрасывается с замечанием', () => {
    const sit = buildSituation(ctx, g, cfg, tpl);
    const area = sit.areas[0].title;
    const r = decisionToOrders({
      orders: [
        { formation: '9-я парашютная дивизия (9. Fallschirmjäger-Division)', task: 'hold', area, toArea: null, deadline: '', details: 'держать' },
        { formation: 'Танковая дивизия Мюнхеберг', task: 'counterattack', area: sit.enemies[0].name, toArea: null, deadline: '', details: '' },
        { formation: '999-я дивизия', task: 'defend', area, toArea: null, deadline: '', details: '' },
        { formation: '18-я танко-гренадерская дивизия', task: 'withdraw', area, toArea: 'Нигде', deadline: '', details: '' },
      ],
    }, sit);
    expect(r.orders.map((o) => o.formation)).toEqual(['de_9fjd', 'de_muencheberg']);
    expect(r.orders[1].target).toEqual({ formation: sit.enemies[0].id });
    expect(r.issues.filter((i) => i.level === 'error').length).toBe(2);
  });

  it('ход модели через сервер (подставная модель): приказы исполняются арбитром после задержки', async () => {
    const sit = buildSituation(ctx, g, cfg, tpl);
    expect(mockDecision(sit.messages[1].content).orders.length).toBeGreaterThan(0);
    const client = new LlmClient({ ...configFromEnv({}), url, thinking: 'off' });
    const t = await decideTurn(client, sit);
    expect(t.ok).toBe(true);
    expect(t.orders.length).toBeGreaterThan(0);
    const next = playTurn(ctx, g, t.orders);
    const got = next.state.formations.filter((f) => f.order?.source === 'llm');
    expect(got.length).toBe(t.orders.length);
  }, 60000);
});

describe('советник штаба человека', () => {
  it('обстановка своей стороны, правила арбитра из чисел движка, предложения приказов сопоставляются', async () => {
    const { advise, buildAdvice, rulesBrief, ADVICE_TREE } = await import('../src/live');
    expect(ADVICE_TREE.length).toBe(8);
    expect(ADVICE_TREE.every((c) => (c.children ?? []).length >= 3)).toBe(true);
    const { loadHistory } = await import('@def-ops/sim/data');
    const ctx = loadContext('berlin-1945-tasks');
    const g = startGame(ctx, 1, '1945-04-19T05:00', 'su');
    const live = JSON.parse(read('live/berlin-1945-tasks.json'));
    const tplA = { system: read('prompts/advisor.system.md'), user: read('prompts/advisor.user.md'), profile: read('profiles/rkka-1945.md') };
    expect(rulesBrief(ctx, 'su')).toMatch(/армии — 6 ч/);
    const built = buildAdvice(ctx, g, loadHistory('berlin-1945-tasks'), live.advisor, tplA,
      { category: 'history', question: 'Как развивались события в эти дни в истории?', draft: 'Решение: удар на Берлин', goal: 'Знамя Победы над рейхстагом', thread: [{ q: 'Привет', a: 'Здравствуйте' }] }, live.description);
    const u = built.messages[built.messages.length - 1].content;
    expect(u).toContain('8-я гвардейская армия');
    expect(u).toContain('резерв Ставки');
    expect(u).toMatch(/в истории 19\.04; в игре/);
    expect(built.messages.length).toBe(4);
    const client = new LlmClient({ ...configFromEnv({}), url, thinking: 'off' });
    let streamed = '';
    const r = await advise(client, g, built, { onAnswer: (d) => { streamed += d; } });
    expect(r.ok).toBe(true);
    expect(streamed).toBe(r.answer);
    expect(r.followUps.length).toBeGreaterThan(0);
    expect(r.suggestions[0].order?.formation).toMatch(/^su_/);
  }, 60000);
});
