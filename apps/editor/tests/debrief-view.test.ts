// Разбор хода в окне: выбор «с позиции …», карта события, строки события, вход и проверка связного текста модели.
import { describe, expect, it } from 'vitest';
import type { CommandTerms, DebriefHq, KeyEvent, TurnDebrief } from '@def-ops/sim';
import { debriefInput, debriefResetKey, debriefShown, DEBRIEF_SYSTEM, verdictLines, eventLines, eventMap, narrativeFits, perspectiveOptions, placeWords } from '../src/debrief-view';

const SU: CommandTerms = { top: 'Ставка', topGen: 'Ставки', topTo: 'в Ставку', group: 'фронт' } as CommandTerms;
const DE: CommandTerms = { top: 'ОКХ', topGen: 'ОКХ', topTo: 'в ОКХ', group: 'группа армий' } as CommandTerms;

const hq = (id: string, name: string, echelon: string, parent: string | null, o: Partial<DebriefHq> = {}): DebriefHq => ({
  id, name, echelon, side: 'su', parent, alive: 3, state: 'line', points: [[14.5, 52.5]], center: [14.5, 52.5], task: null, goal: null, histKm: null, ...o,
});
const ev = (o: Partial<KeyEvent>): KeyEvent => ({
  id: 'e1', kind: 'breakthrough', side: 'su', tick: 20, title: 'Прорыв: 8-я гвардейская армия', text: '8-я гвардейская армия: 3 дивизии продвинулись в среднем на 9 км за 12 часов.',
  at: [14.4, 52.5], from: [14.55, 52.5], to: [14.4, 52.5], place: '4,2 км к З от Зеелов (Seelow)', divisions: ['su_a'], hqs: ['su_8gva', 'su_1bf'],
  km: 9, lost: 1200, weight: 4.2, seen: true,
  causes: [{ kind: 'document', side: 'su', hq: 'su_8gva', name: '8-я гвардейская армия', tick: 14, text: 'Армии наступать на Зеелов' }],
  ...o,
});
const debrief = (events: KeyEvent[], o: Partial<TurnDebrief> = {}): TurnDebrief => ({
  from: 12, to: 24, time: '1945-04-17T05:00', side: 'su', events, quiet: { maxAdvanceKm: 0.4, lost: 310 },
  hqs: {
    su_1bf: hq('su_1bf', '1-й Белорусский фронт', 'front', 'su_stavka'),
    su_8gva: hq('su_8gva', '8-я гвардейская армия', 'army', 'su_1bf', { goal: { title: 'Берлин (Berlin)', kmBefore: 51, kmAfter: 42 }, histKm: 3.5 }),
    su_4gsk: hq('su_4gsk', '4-й гвардейский стрелковый корпус', 'corps', 'su_8gva'),
    su_1gta: hq('su_1gta', '1-я гвардейская танковая армия', 'army', 'su_1bf', { alive: 0, state: 'removed', points: [], center: null }),
  },
  ...o,
});

describe('разбор хода в окне', () => {
  it('«Где»: румб полными словами, как в тексте события', () => {
    expect(placeWords('8 км к ЮВ от Зелов (Seelow)')).toBe('8 км к юго-востоку от Зелова');
    expect(placeWords('3 км к С от Зелов (Seelow)')).toBe('3 км к северу от Зелова');
    expect(placeWords('у Зелов (Seelow)')).toBe('у Зелова');
  });

  it('perspective options', () => {
    const o = perspectiveOptions(debrief([]), SU);
    expect(o[0]).toEqual({ id: null, label: 'Ставка', depth: 0, note: null });
    const at = (id: string) => o.find((x) => x.id === id)!;
    expect(at('su_1bf').depth).toBe(1);
    expect(at('su_8gva').depth).toBeGreaterThan(at('su_1bf').depth);
    expect(at('su_4gsk').depth).toBeGreaterThan(at('su_8gva').depth);
    // поддерево — сразу под своим штабом
    expect(o.findIndex((x) => x.id === 'su_4gsk')).toBe(o.findIndex((x) => x.id === 'su_8gva') + 1);
    expect(at('su_1gta').note).toBe('снят с операции');
    expect(perspectiveOptions(debrief([], { side: 'de', hqs: {} }), DE)[0].label).toBe('ОКХ');
    const gone = debrief([], { hqs: { a: hq('a', 'A', 'army', null, { alive: 0, state: 'destroyed' }) } });
    expect(perspectiveOptions(gone, SU)[1].note).toBe('разгромлен');
  });

  it('event map', () => {
    const m = eventMap(ev({}));
    expect(m.fit).toHaveLength(3);
    expect(m.level).toBe('division');
    expect(m.spot).toEqual([14.4, 52.5]);
    const c = eventMap(ev({ kind: 'capture', from: null, to: null }));
    expect(c.level).toBe('army');
    expect(c.fit).toEqual([[14.4, 52.5]]);
  });

  it('event lines', () => {
    const d = debrief([ev({})]);
    const l = eventLines(d.events[0], d, 'su_8gva');
    expect(l.what).toBe(d.events[0].text);
    expect(l.where).toBe('4,2 км к западу от Зеелова');
    // причина — с часом и штабом
    expect(l.why[0]).toBe('16.04 19:00, 8-я гвардейская армия: Армии наступать на Зеелов');
    expect(l.meaning).toContain('до Берлина 42 км, за ход ближе на 9 км');
    expect(l.meaning).toContain('потери 1 200 человек');
    // позиция Ставки — без цели армии
    expect(eventLines(d.events[0], d, null).meaning).not.toContain('Берлина');
    // окружение своих — угроза
    expect(eventLines(ev({ kind: 'encirclement', from: null, to: null }), d, null).meaning).toContain('угроза окружения');
    expect(eventLines(ev({ kind: 'capture' }), d, null).meaning).toContain('объект взят');
    // причины противника скрыты
    expect(eventLines(ev({ side: 'de', causes: [] }), d, null).why).toEqual(['решения противника известны только посреднику']);
  });

  it('debrief quiet', () => {
    const d = debrief([]);
    const input = debriefInput(d, null, {});
    expect(input).toContain('ключевых событий нет');
    expect(input).toContain('0,4 км');
    expect(input).toContain('310');
    expect(input).toContain('Позиция: Ставка');
  });

  it('debrief input with events and perspective', () => {
    const d = debrief([ev({})]);
    const input = debriefInput(d, 'su_8gva', { su_8gva: '8-я гвардейская армия' });
    expect(input).toContain('Позиция: 8-я гвардейская армия');
    expect(input).toContain('1. Прорыв: 8-я гвардейская армия');
    expect(input).toContain('до Берлина 42 км');
    expect(verdictLines(d, 'su_8gva')).toContain('до Берлина 42 км, за ход ближе на 9 км');
    expect(input).toContain('16.04 17:00 — 17.04 05:00');
    expect(DEBRIEF_SYSTEM).toMatch(/только по ним/);
  });

  it('narrative fits', () => {
    const input = debriefInput(debrief([ev({})]), 'su_8gva', {});
    expect(narrativeFits('Армия продвинулась на 9 км, до Берлина осталось 42 км, потери 1 200 человек.', input)).toBe(true);
    expect(narrativeFits('Армия продвинулась на 15 км.', input)).toBe(false);
    expect(narrativeFits('   ', input)).toBe(false);
    expect(narrativeFits('Армия наступала успешно.', input)).toBe(true);
  });

  it('same time new line resets', () => {
    // A до хода 3, возврат к 2, B до хода 3, переход на A — время то же, линия другая: разбор с чистого листа
    const t = '1945-04-17T05:00';
    const k1 = debriefResetKey(t, 1), k2 = debriefResetKey(t, 2);
    expect(k1).not.toBe(k2);
    const st = { key: k1, hq: 'su_8gva', open: 2, narr: { key: `${k1}|su_8gva`, s: { state: 'ready' as const, text: 'Армия наступала.' } } };
    expect(debriefShown(st, k1)).toEqual({ hq: 'su_8gva', open: 2, narrative: { state: 'ready', text: 'Армия наступала.' } });
    expect(debriefShown(st, k2)).toEqual({ hq: null, open: null, narrative: { state: 'off' } });
  });
});
