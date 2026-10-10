import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { loadContext } from '@def-ops/sim/data';
import { playTurn, replayGame, startGame, withBoundaries, activeBoundaries, type GameRecord } from '@def-ops/sim';
import { buildStavka, stavkaNeed, stavkaTurn } from '../src/live';
import { startMockServer } from '../src/live/mock';
import { LlmClient } from '../src/llm/client';

let server: Server;
let url = '';
beforeAll(async () => { server = await startMockServer(0, '127.0.0.1', 0); url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`; });
afterAll(() => server.close());

describe('директивы в игре и модель-Ставка', () => {
  it('после передачи командования: прошедшие директивы остаются, будущие ждут условия', () => {
    const ctx = loadContext('berlin-1945-tasks');
    const g = startGame(ctx, 1, '1945-04-19T05:00', 'su');
    expect(g.state.directives?.conditional).toBe(true);
    expect(Object.keys(g.state.directives!.activated)).toEqual([]);
    // без приказов войска 1 УФ к Ланквицу не выходят — к 24.04 линия 23.04 не вступила, действует линия 15.04
    let s = g;
    for (let i = 0; i < 5; i++) s = playTurn(ctx, s, []);
    const act = activeBoundaries(withBoundaries(ctx.scenario, s.state), s.state.time, 'su').map((b) => b.id).sort();
    expect(act).toEqual(['1bf-1uf-15apr', '2bf-1bf']);
    // повод для Ставки: исторический срок прошёл, условие не наступило
    const need = stavkaNeed(ctx, s, 'su');
    expect(need?.pending.map((b) => b.id)).toEqual(['1bf-1uf-23apr']);
    expect(stavkaNeed(ctx, s, 'de')).toBeNull();
  });

  it('Ставка (подставная модель) издаёт линию по образцу; запись игры повторяется точно', async () => {
    const ctx = loadContext('berlin-1945-tasks');
    let g = startGame(ctx, 1, '1945-04-19T05:00', 'su');
    for (let i = 0; i < 5; i++) g = playTurn(ctx, g, []);
    const need = stavkaNeed(ctx, g, 'su', 'Прошу установить линию с 1-м Украинским фронтом.')!;
    expect(need.reasons.some((r) => /Ходатайство/.test(r))).toBe(true);
    const built = buildStavka(ctx, g, 'su', need);
    expect(built.messages[1].content).toContain('Образец — исторические директивы');
    const r = await stavkaTurn(new LlmClient({ url, model: 'mock', thinking: 'off', timeoutMs: 20_000, maxTokens: 4000 }, fetch), ctx, g, 'su', need);
    expect(r.ok).toBe(true);
    expect(r.actions).toHaveLength(1);
    const a = r.actions[0];
    expect(a.kind).toBe('directive');
    const g2 = playTurn(ctx, g, [], r.actions);
    const bs = (g2.state.boundaries ?? []).filter((b) => b.issuedBy === 'stavka');
    expect(bs).toHaveLength(1);
    // запись игры: те же ходы, директива — распоряжение хода
    const ctx2 = loadContext('berlin-1945-tasks');
    const rec: GameRecord = { version: 1, scenario: 'berlin-1945-tasks', rules: ctx.rules.id, seed: 1, takeover: '1945-04-19T05:00', human: 'su', ai: 'de',
      turns: [...Array(5)].map((_, i) => ({ time: g.snapshots[g.snapshots.length - 6 + i].time, orders: [] })).concat([{ time: g.state.time, orders: [], actions: r.actions } as never]) };
    const again = replayGame(ctx2, rec);
    expect(again.state.time).toBe(g2.state.time);
    expect(again.state.boundaries).toEqual(g2.state.boundaries);
  });
});
