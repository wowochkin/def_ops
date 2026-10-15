/**
 * Расчёт, начатый до сборки из базы знаний, ждёт её (kbReady) и идёт по собранным данным; результат несёт отметку
 * сборки — отпечаток поправок, время и число; изменилась база — изменилась и отметка.
 */
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import type { Entry } from '@def-ops/knowledge';
import type { History } from '@def-ops/sim';
import * as store from '../src/kb/store';
import { kbBuilding, kbReady, watchKb } from '../src/sim/kb-recompile';
import { kbStamp, kbStampOf, kbStampShort, kbStampText, sameKbStamp, withKbStamp } from '../src/sim/kb-stamp';
import { getData, getEdits, rawData } from '../src/sim/userdata';

const OP = 'berlin-1945-tasks';
const empty = { formations: {}, changes: [], checkpoints: [], positions: [], boundaries: [], crossings: [], events: [] };

describe('отметка сборки из базы', () => {
  it('отпечаток — от поправок, не от времени сборки; строка — время и число поправок', () => {
    const c = { ...empty, formations: { su_61a: { personnel: 52000, tanks: 10 } }, changes: [{ at: '1945-04-18', formation: 'su_8ga', kind: 'reinforce', personnel: 5000 }] } as never;
    const a = kbStampOf({ compiled: c, at: '2026-01-01T10:00:00.000Z' })!;
    const b = kbStampOf({ compiled: c, at: '2026-01-02T10:00:00.000Z' })!;
    expect(a.id).toMatch(/^[0-9a-f]{8}$/);
    expect(a.id).toBe(b.id);
    expect(a.n).toBe(3);
    expect(sameKbStamp(a, b)).toBe(true);
    expect(kbStampOf({ compiled: { ...empty } as never, at: a.at })!.id).not.toBe(a.id);
    expect(kbStampOf(undefined)).toBeNull();
    expect(kbStampText(a)).toMatch(new RegExp(`^данные базы знаний: сборка ${a.id} от \\d\\d\\.\\d\\d \\d\\d:\\d\\d, 3 поправки$`));
    expect(kbStampText(null)).toMatch(/без сборки/);
    expect(kbStampShort(a)).toMatch(/^база знаний: сборка [0-9a-f]{4}, \d\d\.\d\d \d\d:\d\d · 3 поправки$/);
    expect(sameKbStamp(a, undefined)).toBeUndefined();
    expect(withKbStamp('# Отчёт\n\nтекст', a)).toBe(`# Отчёт\n\n_Данные базы знаний: сборка ${a.id} от ${kbStampText(a).split(' от ')[1]}._\n\nтекст`);
  });

  it('расчёт до сборки ждёт её и идёт по собранным данным; изменилась база — новая отметка', async () => {
    (globalThis as { window?: unknown }).window ??= new EventTarget();
    expect((await getEdits(OP)).kb).toBeUndefined();
    watchKb();
    // «Рассчитать» сразу после запуска: сборка запланирована, данных базы ещё нет
    expect(kbBuilding()).toBe(true);
    const calc = kbReady(OP).then(async (stamp) => ({ stamp, h: (await getData('scenarios', `${OP}.history.json`)) as History }));
    const { stamp, h } = await calc;
    expect(kbBuilding()).toBe(false);
    const raw = (await rawData('scenarios', `${OP}.history.json`)) as History;
    expect(h.positions.length).toBeGreaterThan(raw.positions.length);
    const e = await getEdits(OP);
    expect(stamp).toEqual(kbStampOf(e.kb));
    expect(stamp!.n).toBeGreaterThan(0);
    expect(stamp!.at).toBe(e.kb!.at);

    // правка базы: запись, давшая положение, без фактов — пересборка, другая отметка
    const src = e.kb!.provenance.find((p) => p.input.startsWith('position:') && p.fact)!.fact!.entry;
    const entry = (await store.entries()).find((x) => x.id === src)!;
    await store.put('entries', { ...entry, facts: [] } satisfies Entry);
    window.dispatchEvent(new Event('def_ops.kb-changed'));
    expect(kbBuilding()).toBe(true);
    const next = await kbReady(OP);
    expect(next!.id).not.toBe(stamp!.id);
    expect(next!.at > stamp!.at).toBe(true);
    expect(sameKbStamp(stamp, next)).toBe(false);
    expect(await kbStamp(OP)).toEqual(next);
  }, 180000);
});
