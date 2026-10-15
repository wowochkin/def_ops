/**
 * Расчёт сразу после запуска приложения: данные операции читаются после сборки из базы знаний (watchKb), иначе первый
 * расчёт идёт по сценарию без поправок базы, а следующий — с ними (Берлинская операция, seed 1, 5 прогонов: 70–75 % и 67–72 %).
 */
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import type { History } from '@def-ops/sim';
import { kbSettled, watchKb } from '../src/sim/kb-recompile';
import { getData, getEdits, rawData } from '../src/sim/userdata';

const OP = 'berlin-1945-tasks';

describe('расчёт после сборки из базы', () => {
  it('kbSettled — после первой сборки: история операции уже с положениями из базы', async () => {
    // окно редактора: события изменения данных и базы
    (globalThis as { window?: unknown }).window ??= new EventTarget();
    expect((await getEdits(OP)).kb).toBeUndefined();
    watchKb();
    await kbSettled();
    const e = await getEdits(OP);
    expect(e.kb?.compiled.positions.length).toBeGreaterThan(0);
    const raw = (await rawData('scenarios', `${OP}.history.json`)) as History;
    const h = (await getData('scenarios', `${OP}.history.json`)) as History;
    expect(h.positions.length).toBeGreaterThan(raw.positions.length);
    // сборка не запланирована и не идёт — сразу
    await kbSettled();
  }, 120000);
});
