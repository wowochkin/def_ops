import { describe, expect, it } from 'vitest';
import { loadContext, loadHistory } from '../src/data';
import { compareWithHistory, createState, onMap, runScenario, runToDocument, shortName, step, summarize } from '../src';

describe('сценарий «Берлин-1945»', () => {
  const ctx = loadContext('berlin-1945');

  it('собирается: формирования на театре, приказы на известные цели', () => {
    const s = createState(ctx, 1);
    expect(s.formations.length).toBeGreaterThan(35);
    for (const f of s.formations) expect(ctx.theatre.indexOf(f.position)).toBeGreaterThanOrEqual(0);
    expect(s.pending.every((o) => s.formations.some((f) => f.id === o.formation))).toBe(true);
  });

  it('введённые позже формирования до срока не на карте и приказы их ждут', () => {
    let s = createState(ctx, 1);
    const f28 = s.formations.find((f) => f.id === 'su_28a')!;
    expect(onMap(f28, s.time)).toBe(false);
    const before = f28.position;
    s = step(s, ctx);
    expect(s.formations.find((f) => f.id === 'su_28a')!.position).toEqual(before);
    expect(s.pending.some((o) => o.formation === 'su_28a')).toBe(true);
  });

  it('детерминирован и сравним с историей', () => {
    const a = runScenario(ctx, 7, 4), b = runScenario(ctx, 7, 4);
    expect(a.final.formations.map((f) => f.position)).toEqual(b.final.formations.map((f) => f.position));
    const devs = compareWithHistory(ctx, a, loadHistory('berlin-1945'));
    expect(devs.length).toBeGreaterThan(20);
    const sum = summarize(devs);
    expect(sum.within).toBeGreaterThan(0.5);
  });

  it('публикуется картой со шкалой времени и ключевыми кадрами', () => {
    const run = runScenario(ctx, 1, 3);
    const doc = runToDocument(ctx, run, loadHistory('berlin-1945'));
    expect(doc.timeline?.start).toBe(ctx.scenario.start);
    const units = doc.features.filter((f) => f.layerId === 'sim-own' || f.layerId === 'sim-enemy');
    expect(units.length).toBeGreaterThan(30);
    expect(units.every((f) => (f.keyframes?.length ?? 0) >= 1)).toBe(true);
    expect(doc.features.some((f) => f.layerId === 'hist-units')).toBe(true);
  });

  it('короткие подписи', () => {
    expect(shortName('8-я гвардейская армия')).toBe('8 гв. А');
    expect(shortName('1-я гвардейская танковая армия')).toBe('1 гв. ТА');
    expect(shortName('3-я ударная армия')).toBe('3 УА');
    expect(shortName('XI танковый корпус СС')).toBe('XI тк СС');
    expect(shortName('Корпусная группа «Свинемюнде»')).toBe('«Свинемюнде»');
  });
});
