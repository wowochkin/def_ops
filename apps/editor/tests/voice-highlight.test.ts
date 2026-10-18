// Подсветка исполненного голосом (спецификация, раздел 1): act голосом зовёт flash с целью действия, мышью — нет; рамка
// гаснет через FLASH_MS; полнота — у каждого голосового действия «Переигровки», окон голоса и вкладок разделов есть цель
// подсветки (highlight) или исключение с причиной.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, register, type Action } from '../src/voice/registry';
import { FLASH_MS, TRACK_MS, flash, flashMap, flashState, hl, note, noted, spotHidden, tracking } from '../src/voice/highlight';
import { commandActions, replayActions } from '../src/voice/actions/command';
import { staffActions } from '../src/voice/actions/staff';
import { turnActions } from '../src/voice/actions/turn';
import { screenActions } from '../src/voice/actions/screen';
import { tabActions } from '../src/voice/actions/tabs';

let offs: (() => void)[] = [];
const reg = (a: Action) => offs.push(register(a));
beforeEach(() => { offs = []; vi.useFakeTimers(); flash([], 0); });
afterEach(() => { offs.forEach((o) => o()); vi.useRealTimers(); });

const base = { section: 'global', title: 't', describe: 'd', available: () => true as const };

describe('act: голосом — подсветка, мышью — нет', () => {
  it('голосом: цели highlight — в рамке', async () => {
    reg({ ...base, id: 't.a', run: async () => 'ok', highlight: (p: { n: number }) => [hl(`x-${p.n}`), { at: [14, 52] }] });
    await act('t.a', { n: 2 }, { by: 'voice' });
    expect(flashState()?.targets).toEqual(['[data-hl="x-2"]']);
    expect(flashState()?.spots).toEqual([[14, 52]]);
  });
  it('мышью и без указания — без рамки', async () => {
    reg({ ...base, id: 't.b', run: async () => 'ok', highlight: () => hl('b') });
    await act('t.b', {}, { by: 'mouse' });
    expect(flashState()).toBeNull();
    await act('t.b');
    expect(flashState()).toBeNull();
  });
  it('недоступное — не исполняется и не подсвечивается', async () => {
    reg({ ...base, id: 't.c', available: () => 'нельзя', run: async () => 'ok', highlight: () => hl('c') });
    expect(await act('t.c', {}, { by: 'voice' })).toBe('нельзя');
    expect(flashState()).toBeNull();
  });
  it('highlight по тому, что исполнение отметило (note): не вышло — подсветки нет', async () => {
    let ok = true;
    reg({ ...base, id: 't.d', run: async () => { if (ok) note(hl('d')); return ok ? 'да' : 'не нашёл'; }, highlight: noted });
    ok = false;
    await act('t.d', {}, { by: 'voice' });
    expect(flashState()).toBeNull();
    ok = true;
    await act('t.d', {}, { by: 'voice' });
    expect(flashState()?.targets).toEqual(['[data-hl="d"]']);
  });
  it('отметка прошлого исполнения не переходит к следующему', async () => {
    reg({ ...base, id: 't.e', run: async () => { note(hl('e')); }, highlight: noted });
    reg({ ...base, id: 't.f', run: async () => 'нет', highlight: noted });
    await act('t.e', {}, { by: 'mouse' }); // мышью: отметка осталась бы — её нельзя показать следующему
    await act('t.f', {}, { by: 'voice' });
    expect(flashState()).toBeNull();
  });
  it('рамка гаснет через FLASH_MS (2,5 с); новая подсветка заменяет прежнюю', () => {
    expect(FLASH_MS).toBe(2500);
    flash([hl('a'), hl('b')]);
    expect(flashState()?.targets).toHaveLength(2);
    vi.advanceTimersByTime(1500);
    flash(hl('c'));
    expect(flashState()?.targets).toEqual(['[data-hl="c"]']);
    vi.advanceTimersByTime(FLASH_MS - 1);
    expect(flashState()).not.toBeNull();
    vi.advanceTimersByTime(2);
    expect(flashState()).toBeNull();
  });
  it('flashMap — метка на карте к текущей подсветке', () => {
    flash(hl('row'));
    flashMap([14.4, 52.5]);
    expect(flashState()).toMatchObject({ targets: ['[data-hl="row"]'], spots: [[14.4, 52.5]] });
  });
  it('сбой highlight не ломает исполнение', async () => {
    reg({ ...base, id: 't.g', run: async () => 'сделано', highlight: () => { throw new Error('x'); } });
    expect(await act('t.g', {}, { by: 'voice' })).toBe('сделано');
  });
});

// ---------------------------------------------------------------- полнота

/** Действия без подсветки — с причиной (нечего показать: только речь, окно закрывается, файл, вся карта). */
const NO_HL: { ids: string[]; why: string }[] = [
  { ids: ['map.zoomIn', 'map.zoomOut', 'map.sector', 'map.layers.all'], why: 'меняется вся карта сразу — рамка вокруг всей карты ничего не выделяет' },
  { ids: ['command.exit', 'command.discard', 'replay.discardSaved', 'replay.takeCommand.cancel', 'replay.stop', 'voices.delete'],
    why: 'выход из игры, удаление записи или голоса, отмена окна, остановка расчёта — подсвечиваемое пропадает с экрана' },
  { ids: ['replay.continue', 'replay.start'], why: 'игра начинается или продолжается — экран раздела сменяется целиком, обстановка ещё готовится' },
  { ids: ['command.card.close', 'command.unit.close', 'command.order.close', 'command.review.close', 'command.toEditor'],
    why: 'закрыть карточку, доклад, редактор, окно разбора; карта в редакторе — то, что подсвечивать, закрывается или уходит в другой раздел' },
  { ids: ['answer.no', 'command.advisor.stop', 'command.review.stop', 'command.umpire.repeat', 'command.report.more', 'command.advisor.more', 'decision.missing'],
    why: 'отказ, остановка, повтор и продолжение сказанного — только речь штаба, на экране ничего не меняется' },
  { ids: ['command.review.save', 'command.journal.save', 'command.record.save'], why: 'файл сохраняется в «Загрузки» — на экране меняется только уведомление' },
  { ids: ['voices.preview', 'voices.rec.start', 'voices.rec.stop', 'voices.discard', 'voices.close', 'voice.calibrate.done', 'voice.calibrate.close'],
    why: 'окно «Голоса» и калибровка: прослушать, запись, закрыть — звук и смена шага окна, выделять нечего' },
];
const excused = new Set(NO_HL.flatMap((x) => x.ids));

const SRC = join(__dirname, '../src');
/** Компонентные действия (useAction) в файлах «Переигровки», окон голоса и панели. */
const COMPONENT_FILES = ['ReplayView.tsx', 'Sectors.tsx', 'ReviewView.tsx', 'CommandView.tsx', 'voice/Voices.tsx', 'voice/Calibration.tsx', 'voice/VoicePanel.tsx'];
function balanced(s: string, i: number): number {
  let depth = 0;
  for (let k = i; k < s.length; k++) {
    const c = s[k];
    if (c === "'" || c === '"' || c === '`') { const q = c; for (k++; k < s.length && s[k] !== q; k++) if (s[k] === '\\') k++; continue; }
    if (c === '{' || c === '(' || c === '[') depth++;
    else if (c === '}' || c === ')' || c === ']') { depth--; if (depth === 0) return k; }
  }
  return s.length;
}
function componentActions(): { id: string; say: boolean; highlight: boolean; file: string }[] {
  const out: { id: string; say: boolean; highlight: boolean; file: string }[] = [];
  for (const f of COMPONENT_FILES) {
    const text = readFileSync(join(SRC, f), 'utf8');
    for (const m of text.matchAll(/useAction\(\{/g)) {
      const a = m.index! + m[0].length - 1;
      const body = text.slice(a, balanced(text, a) + 1);
      const id = /\bid: '([^']+)'/.exec(body)?.[1];
      if (!id) continue;
      out.push({ id, file: f, say: /\bsay: \[/.test(body), highlight: /\bhighlight[:(]/.test(body) });
    }
  }
  return out;
}

describe('полнота подсветки', () => {
  const g = (() => ({})) as never;
  const runtime: Action[] = [...commandActions(g), ...replayActions(g), ...staffActions(g), ...turnActions(g), ...screenActions(g), ...tabActions()];
  const comps = componentActions();

  it('компонентные действия найдены во всех файлах', () => {
    for (const f of COMPONENT_FILES) expect(comps.some((c) => c.file === f), f).toBe(true);
    expect(comps.map((c) => c.id)).toEqual(expect.arrayContaining(['map.level', 'map.layer', 'voices.assign', 'voice.calibrate.start', 'voice.panel.open']));
  });
  it('у каждого голосового действия есть цель подсветки (или исключение с причиной)', () => {
    const miss = [
      ...runtime.filter((a) => a.say && !a.highlight && !excused.has(a.id)).map((a) => a.id),
      ...comps.filter((c) => c.say && !c.highlight && !excused.has(c.id)).map((c) => `${c.file}: ${c.id}`),
    ];
    expect(miss, `без подсветки:\n${miss.join('\n')}`).toEqual([]);
  });
  it('исключения не устарели: действие есть, голосовое и без подсветки', () => {
    const all = new Map<string, { say: boolean; highlight: boolean }>([
      ...runtime.map((a) => [a.id, { say: !!a.say, highlight: !!a.highlight }] as const),
      ...comps.map((c) => [c.id, { say: c.say, highlight: c.highlight }] as const),
    ]);
    const stale = [...excused].filter((id) => { const x = all.get(id); return !x || !x.say || x.highlight; });
    expect(stale).toEqual([]);
    for (const x of NO_HL) expect(x.why.length).toBeGreaterThan(20);
  });
  it('цели — селекторы data-hl / data-action / data-tour', () => {
    for (const a of runtime.filter((x) => x.highlight && x.highlight !== noted)) {
      const t = a.highlight!({ tab: 'orders', sub: 'rear', n: 1, mode: 'open', on: true, part: 'umpire', level: 'op' } as never, undefined);
      for (const s of [t].flat()) if (typeof s === 'string') expect(s, a.id).toMatch(/^\[data-(?:hl|action|tour)="[^"]+"\]/);
    }
  });
});

describe('метка на карте: видно ли её', () => {
  const map = { left: 400, top: 60, width: 1000, height: 800 };
  const panel = { left: 600, top: 60, width: 440, height: 90 };
  it('в свободной части карты — видно', () => { expect(spotHidden({ x: 900, y: 500 }, map, [panel])).toBe(false); });
  it('под панелью голоса — не видно', () => { expect(spotHidden({ x: 800, y: 100 }, map, [panel])).toBe(true); });
  it('за краем карты (и у самого края) — не видно', () => {
    expect(spotHidden({ x: 300, y: 500 }, map, [])).toBe(true);
    expect(spotHidden({ x: 410, y: 500 }, map, [])).toBe(true);
  });
});

describe('слой подсветки: цели меряются недолго', () => {
  it('цикл по кадрам — не дольше TRACK_MS (≈3 с) после показа, а не весь шаг разбора (120 с)', () => {
    flash([hl('x')], 120_000);
    const st = flashState()!;
    expect(TRACK_MS).toBeGreaterThanOrEqual(2500);
    expect(TRACK_MS).toBeLessThanOrEqual(3500);
    expect(tracking(st.at, st.at + 1000)).toBe(true);
    expect(tracking(st.at, st.at + TRACK_MS + 1)).toBe(false);
    expect(tracking(st.at, st.at + 60_000)).toBe(false);
  });
});
