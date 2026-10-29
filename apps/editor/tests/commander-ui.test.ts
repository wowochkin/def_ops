// Smoke-проверки отрисовки вкладки «Командующий», слоя на карте и графика состязания: пустой и полный ход.
import { createElement } from 'react';
import { renderToString as render } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AgentCommander, AgentTrace } from '@def-ops/sim';
import { CommanderPanel } from '../src/CommanderPanel';
import { CommanderOverlay } from '../src/CommanderOverlay';
import { RivalryChart } from '../src/RivalryChart';
import type { MapEngine } from '../src/engine/types';

const parts = (o: Record<string, number> = {}) => ({ task: 0, rival: 0, preserve: 0, noEncircle: 0, destroy: 0, hold: 0, save: 0, ...o });
const opt = (kind: string, label: string, total: number, target: [number, number] | null = null, mind: boolean = false) => ({
  kind, label, rule: `ПУ-43: ${label}`, target, parts: parts({ task: 0.3, preserve: -0.1 }), penalty: 0.1, bonus: 0.1, total,
  mind: mind ? { hours: 24, advanceKm: 11, losses: 0.1, encircled: 0 } : null,
});
const tr = (v: number) => ({ value: v, range: [0.3, 1] as [number, number], source: 'мемуары', confidence: 'low' });
const snap = (tick: number, enemyEst: number) => ({
  tick, motives: parts({ task: 0.8, rival: 0.5 }), mood: { confidence: 0.5, stress: 0.4 }, intent: 'Продолжать',
  picture: { armies: [{ hq: 'su_8gva', advanceKm: 6, strength: 0.98, enemyEst, enemyTrue: 16, toObjectiveKm: 60, brokeThrough: false }],
    rival: { hq: 'su_1uf', toObjectiveKm: 110, asOf: tick - 6 }, openFlanks: ['su_8gva'], pockets: [{ center: [14, 52.5] as [number, number], enemyEst: 5, gapKm: 8 }], enemyReserves: [{ at: [14.4, 52.3] as [number, number], strength: 4 }], toObjectiveKm: 90 - tick },
});
const zhukov: AgentCommander = {
  hq: 'su_1bf', profile: 'zhukov', name: 'Жуков Г. К.', side: 'su', traits: { risk: tr(0.8), persistence: tr(0.8), ambition: tr(0.8), lossTolerance: tr(0.8), obedience: tr(0.6) },
  baseMotives: parts({ task: 0.8, rival: 0.4 }), rival: 'konev', objective: 'berlin',
  snapshots: [snap(0, 0), snap(6, 13), snap(12, 13)],
  decisions: [{ tick: 6, trigger: 'цикл', chosen: 0, why: 'Продолжать по плану: перевес', options: [opt('continue', 'Продолжать по плану', 0.9), opt('turnToRival', 'Повернуть ТА', 0.2, [13.4, 52.5], true)] }],
};
const trace = (commanders?: AgentCommander[]): AgentTrace => ({
  scenario: 's', name: 'S', start: '1945-04-16T05:00', hours: 12, seed: 1, fields: [],
  hqs: [{ id: 'su_1bf', name: '1-й Белорусский фронт', side: 'su', echelon: 'front', parent: null }, { id: 'su_8gva', name: '8 гв. А', side: 'su', echelon: 'army', parent: 'su_1bf' }],
  divisions: [{ id: 'a', name: 'a', side: 'su', hq: 'su_8gva', kind: 'rifle', mobility: 'foot', size: 'division', quality: 1 }],
  frames: Array.from({ length: 13 }, () => [[14.3, 52.5, 'наступление: атака']]), journal: [], ...(commanders ? { commanders } : {}),
});
const engine = { on: () => () => {}, project: (p: [number, number]) => [(p[0] - 12) * 300, (53 - p[1]) * 300], getContainer: () => ({ getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) }) } as unknown as MapEngine;
/** Разметка без служебных комментариев React между соседними текстами. */
const renderToString = (e: Parameters<typeof render>[0]) => render(e).replace(/<!-- -->/g, '');
const names = { su_1bf: '1-й Белорусский фронт', su_8gva: '8 гв. А', su_1uf: '1-й Украинский фронт' };

describe('отрисовка командующих', () => {
  it('вкладка: полный ход — все разделы; час до решений — без падения', () => {
    const t = trace([zhukov]);
    const html = renderToString(createElement(CommanderPanel, { trace: t, c: zhukov, tick: 12, onTick: () => {}, names }));
    for (const s of ['Жуков Г. К.', 'Характер', 'Мотивы', 'Картина обстановки', 'своих', '≈ 13 усл. ед.', 'на деле 16', 'Повернуть ТА', 'Почему', 'Разговор с командующим']) expect(html).toContain(s);
    const early = renderToString(createElement(CommanderPanel, { trace: t, c: zhukov, tick: 0, onTick: () => {}, names }));
    expect(early).toContain('противника нет');
    const empty = { ...zhukov, snapshots: [], decisions: [] };
    expect(renderToString(createElement(CommanderPanel, { trace: t, c: empty, tick: 3, onTick: () => {}, names }))).toContain('Разговор');
  });
  it('дробный час проигрывания: задержка сводки — целые часы, без дробей', () => {
    const html = renderToString(createElement(CommanderPanel, { trace: trace([zhukov]), c: zhukov, tick: 12.4, onTick: () => {}, names }));
    expect(html).toContain('задержка 6 ч)');
    expect(html).not.toMatch(/задержка \d+[.,]\d/);
    expect(html).toContain('<colgroup>'); // колонки картины закреплены
  });
  it('график: заголовок со свёрткой ▾, кнопка через действие map.chart', () => {
    const html = renderToString(createElement(RivalryChart, { trace: trace([zhukov]), tick: 6, current: 'su_1bf' }));
    expect(html).toMatch(/data-action="map\.chart"[^>]*>(<[^>]+>)*Состязание за/);
    expect(html).toContain('▾');
  });
  it('график: пусто — ничего; полный ход — оси, номера и список решений, цель из хода', () => {
    expect(renderToString(createElement(RivalryChart, { trace: trace(), tick: 0 }))).toBe('');
    const withMark = { ...zhukov, decisions: [{ ...zhukov.decisions[0], options: [opt('commitMobile', 'Ввести ТА', 0.9)] }] };
    const html = renderToString(createElement(RivalryChart, { trace: trace([withMark]), tick: 12, current: 'su_1bf' }));
    for (const s of ['Состязание за Берлин', 'км', '16.04', 'Ввести ТА', '<polyline']) expect(html).toContain(s);
  });
  it('слой: пустой — svg без стрелок; полный — замысел, вариант, соперник, группировки', () => {
    const t = trace([zhukov]);
    const none = renderToString(createElement(CommanderOverlay, { engine, trace: t, c: { ...zhukov, snapshots: [], decisions: [] }, tick: 0, names }));
    expect(none).toContain('cm-overlay');
    expect(none).not.toContain('class="intent"');
    const full = renderToString(createElement(CommanderOverlay, { engine, trace: t, c: zhukov, tick: 12, names }));
    for (const s of ['intent', 'mind', 'grp', 'Берлин', 'Продолжать по плану']) expect(full).toContain(s);
  });
});
