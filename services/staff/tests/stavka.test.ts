import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { loadContext } from '@def-ops/sim/data';
import { playTurn, replayGame, startGame, withBoundaries, activeBoundaries, type GameRecord } from '@def-ops/sim';
import { buildStavka, stavkaNeed, stavkaTurn } from '../src/live';
import { startMockServer } from '../src/live/mock';
import { LlmClient } from '../src/llm/client';
import { readFileSync } from 'node:fs';
import { doctrineFor, type Entry } from '@def-ops/knowledge';

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
    // у вермахта просроченных директив нет (повод может быть другой — соединение в полосе соседа)
    expect(stavkaNeed(ctx, s, 'de')?.pending ?? []).toEqual([]);
  });

  it('за вермахт линии между группами армий устанавливает ОКХ: по ходатайству — приказ, исполнимый арбитром', async () => {
    const ctx = loadContext('berlin-1945-tasks');
    let g = startGame(ctx, 1, '1945-04-19T05:00', 'de', 'su');
    g = playTurn(ctx, g, []);
    const need = stavkaNeed(ctx, g, 'de', 'Прошу установить линию с группой армий «Центр».')!;
    expect(need).not.toBeNull();
    const built = buildStavka(ctx, g, 'de', need);
    expect(built.messages[0].content).toMatch(/^Вы — ОКХ/);
    expect(built.messages[1].content).toContain('Группы армий и их войска:');
    expect(built.fronts.map((f) => f.id)).toEqual(expect.arrayContaining(['de_hgr_weichsel', 'de_hgr_mitte']));
    const r = await stavkaTurn(new LlmClient({ url, model: 'mock', thinking: 'off', timeoutMs: 20_000, maxTokens: 4000 }, fetch), ctx, g, 'de', need);
    expect(r.ok).toBe(true);
    // подставная модель берёт две первые группы армий и два первых пункта: линия либо исполнима, либо отклонена с причиной
    expect(r.actions.length + r.issues.length).toBe(1);
    for (const a of r.actions) {
      expect(a.kind).toBe('directive');
      const g2 = playTurn(ctx, g, [], [a]);
      expect((g2.state.boundaries ?? []).some((b) => b.side === 'de' && b.issuedBy === 'stavka' && /приказ ОКХ/.test(b.title))).toBe(true);
    }
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
  }, 60000);

  it('Ставка на доктрине своей стороны: блок правил перед пунктами, правило 6 о basis; без правил — блока нет', async () => {
    const ctx = loadContext('berlin-1945-tasks');
    let g = startGame(ctx, 1, '1945-04-19T05:00', 'su');
    g = playTurn(ctx, g, []);
    const need = stavkaNeed(ctx, g, 'su', 'Прошу установить линию с 1-м Украинским фронтом.')!;
    const entries = (JSON.parse(readFileSync(new URL('../../../packages/knowledge/data/seed.json', import.meta.url), 'utf8')) as { entries: Entry[] }).entries;
    const rules = doctrineFor(entries, {}, 'su', [], '', { levels: ['front', 'army'] }).rules.slice(0, 2);
    expect(rules).toHaveLength(2);
    const built = buildStavka(ctx, g, 'su', need, { rules });
    const u = built.messages[1].content;
    expect(u).toContain('Доктрина вашей стороны (уровень фронта и армии, из базы знаний):');
    expect(u).toContain('[R1] Доктрина (сов.,');
    expect(u).toContain('[R2] ');
    expect(u.indexOf('Доктрина вашей стороны')).toBeLessThan(u.indexOf('Пункты (в линиях'));
    expect(built.messages[0].content).toContain('6. basis — номера правил доктрины ([R1]…), на которые опирается решение; нет таких — пустой список.');
    expect(built.refs.map((r) => r.id)).toEqual(rules.map((r) => r.entry));
    // свой сервер: соединение к общему могло простоять дольше keep-alive сервера (под нагрузкой — «fetch failed»)
    const own = await startMockServer(0, '127.0.0.1', 0);
    const client = new LlmClient({ url: `http://127.0.0.1:${(own.address() as AddressInfo).port}/v1`, model: 'mock', thinking: 'off', timeoutMs: 20_000, maxTokens: 4000 }, fetch);
    try {
      const r = await stavkaTurn(client, ctx, g, 'su', need, { kb: { rules } });
      expect(r.error).toBeUndefined();
      expect(r.basis).toEqual(['R1']);
      expect(r.refs).toEqual(rules.map((x) => ({ id: x.entry, title: x.title })));

      const bare = buildStavka(ctx, g, 'su', need);
      expect(bare.messages[1].content).not.toContain('Доктрина вашей стороны');
      expect(bare.refs).toEqual([]);
      const r0 = await stavkaTurn(client, ctx, g, 'su', need);
      expect(r0.error).toBeUndefined();
      expect(r0.basis).toEqual([]);
    } finally { own.close(); }
  }, 60000);
});
