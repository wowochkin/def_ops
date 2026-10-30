import { describe, expect, it } from 'vitest';
import type { LngLat } from '@def-ops/core';
import { blankDir, type DirDraft } from '../src/command-post';
import { draftNote, withNote } from '../src/post-notes';

const ZEL: LngLat = [14.47, 52.52];
const unit = (id: string, name: string, at: LngLat, x: object = {}) => ({ id, name, echelon: 'army', parent: 'su_1bf', status: 'active', at, ammo: 1, fuel: 1, tanks: 0, cutOff: false, ...x });
const view = (own: object = {}) => ({
  places: [{ id: 'p_zel', title: 'Зелов', at: ZEL }],
  own: [
    unit('su_8gva', '8-я гвардейская армия', [14.6, 52.5], own),
    unit('su_5ua', '5-я ударная армия', [14.6, 52.7]),
    unit('su_69a', '69-я армия', [14.6, 52.3]),
    unit('su_33a', '33-я армия', [14.6, 52.1]),
  ],
  intel: [
    { id: 'de_ci', name: 'CI армейский корпус', at: [14.42, 52.52], place: 'у Зелова' },
    { id: 'de_far', name: 'далёкая дивизия', at: [13.5, 52.5], place: 'у Берлина' },
  ],
  command: { hqs: {
    su_1bf: { name: '1-й Белорусский фронт', echelon: 'front', parent: null },
    su_8gva: { name: '8-я гвардейская армия', echelon: 'army', parent: 'su_1bf' },
    su_5ua: { name: '5-я ударная армия', echelon: 'army', parent: 'su_1bf' },
    su_69a: { name: '69-я армия', echelon: 'army', parent: 'su_1bf' },
    su_33a: { name: '33-я армия', echelon: 'army', parent: 'su_1bf' },
    su_4gsk: { name: '4-й гвардейский стрелковый корпус', echelon: 'corps', parent: 'su_8gva' },
  } },
}) as never;
const NAMES: Record<string, string> = { su_4gsk: '4-й гв. ск', su_5ua: '5-я ударная армия', su_69a: '69-я армия', su_33a: '33-я армия' };
const o = { issuer: 'su_1bf', name: (id: string) => NAMES[id] ?? id };
const d: DirDraft = { ...blankDir('su_8gva', 'front'), immediate: [ZEL], immediateTitle: 'Зелов', immediateBy: '1945-04-17T12:00', mainBlow: ['su_4gsk'] };

describe('указания по задаче и обстановке', () => {
  it('указания: задача, срок, главный удар, соседи, противник', () => {
    expect(draftNote(view(), d, o)).toBe('Задача — наступать: ближайшая — Зелов к 17.04 12:00. Главный удар — 4-й гв. ск. Справа — 5-я ударная армия, слева — 69-я армия. Перед фронтом — CI армейский корпус (у Зелова).');
  });
  it('указания: подвоз и эшелон', () => {
    const s = draftNote(view({ cutOff: true }), { ...d, echelon: 'second' }, o);
    expect(s).toContain('Подвоз не доходит — без пополнения.');
    expect(s).toContain('Второй эшелон — ввод по решению.');
    const t = draftNote(view({ ammo: 0.2, fuel: 0.1, tanks: 40 }), { ...d, echelon: 'first', reserve: ['su_4gsk'] }, o);
    expect(t).toContain('Боеприпасы на исходе. Горючее на исходе.');
    expect(t).toContain('Первый эшелон. Резерв: 4-й гв. ск.');
  });
  it('соседи — той же ступени; место противника — без исходного написания', () => {
    const w = view() as unknown as { own: object[]; intel: { place: string }[] };
    w.own.push({ id: 'su_cd', name: 'кавдивизия', echelon: 'division', parent: 'su_1bf', status: 'active', at: [14.58, 52.53], ammo: 1, fuel: 1, tanks: 0, cutOff: false });
    w.intel[0].place = 'у Зелов (Seelow)';
    const s = draftNote(w as never, d, o);
    expect(s).toContain('Справа — 5-я ударная армия, слева — 69-я армия.');
    expect(s).toContain('CI армейский корпус (у Зелов).');
  });
  it('без цели и соседей — только задача', () => {
    expect(draftNote(view(), { ...blankDir('su_8gva', 'front'), task: 'defend' }, o)).toBe('Задача — оборонять.');
  });
  it('правленые вручную указания не заменяются при смене задачи', () => {
    const mine = withNote({ ...d, task: 'defend', noteAuto: false, note: 'моё' }, view(), o);
    expect(mine.note).toBe('моё');
    const auto = withNote({ ...d, task: 'defend', noteAuto: true, note: 'старое' }, view(), o);
    expect(auto.note).toContain('оборонять');
    expect(blankDir('su_8gva', 'front').noteAuto).toBe(true);
  });
});
