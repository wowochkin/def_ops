import { describe, expect, it } from 'vitest';
import { runChecks, type Claim } from '@def-ops/knowledge';
import { ASSUMPTION_WARNING, claimToForm, factOrigin, formToClaim, formWarnings, manualCandidate, parseDate } from '../src/kb/fact-form';

const ok = (kind: Claim['kind'], fields: Record<string, string>): Claim => {
  const r = formToClaim(kind, fields);
  if ('error' in r) throw new Error(r.error);
  return r.claim;
};
const err = (kind: Claim['kind'], fields: Record<string, string>): string => {
  const r = formToClaim(kind, fields);
  if (!('error' in r)) throw new Error(`ожидалась ошибка: ${JSON.stringify(r.claim)}`);
  return r.error;
};

describe('formToClaim: claim из полей формы по каждому виду', () => {
  it('численность и пополнение: числа с разрядами, пустые не попадают', () => {
    expect(ok('strength', { subject: 'su_99a', at: '1945-04-16', personnel: '52 000', tanks: '', guns: '640' }))
      .toEqual({ kind: 'strength', subject: 'su_99a', at: '1945-04-16', personnel: 52000, guns: 640 });
    expect(ok('reinforce', { subject: 'su_99a', at: '18.04.1945', personnel: '4.910' }))
      .toEqual({ kind: 'reinforce', subject: 'su_99a', at: '1945-04-18', personnel: 4910 });
  });
  it('подчинённость и ввод: дата с временем', () => {
    expect(ok('parent', { subject: 'su_99a', from: '1945-04-20T06:00', parent: 'su_9f' })).toEqual({ kind: 'parent', subject: 'su_99a', from: '1945-04-20T06:00', parent: 'su_9f' });
    expect(ok('enter', { subject: 'su_99a', at: '20.04.1945 6:00' })).toEqual({ kind: 'enter', subject: 'su_99a', at: '1945-04-20T06:00' });
  });
  it('положение: пункт или координаты (широта, долгота → lngLat)', () => {
    expect(ok('position', { subject: 'su_99a', at: '1945-04-17', place: 'Условные Холмы', uncertaintyKm: '12,5' }))
      .toEqual({ kind: 'position', subject: 'su_99a', at: '1945-04-17', place: 'Условные Холмы', uncertaintyKm: 12.5 });
    expect(ok('position', { subject: 'su_99a', at: '1945-04-17', lat: '52.450', lon: '14,6' }))
      .toEqual({ kind: 'position', subject: 'su_99a', at: '1945-04-17', lngLat: [14.6, 52.45] });
    expect(err('position', { subject: 'su_99a', at: '1945-04-17' })).toBe('нужен пункт или координаты');
    expect(err('position', { subject: 'su_99a', at: '1945-04-17', lat: '52.4' })).toMatch(/и широта, и долгота/);
  });
  it('линия: пара объединений, пункты через «—»', () => {
    expect(ok('boundary', { subject: 'su_99a', subject2: 'su_98a', from: '1945-04-16', points: 'Альфа — Бета; Гамма' }))
      .toEqual({ kind: 'boundary', between: ['su_99a', 'su_98a'], from: '1945-04-16', points: ['Альфа', 'Бета', 'Гамма'] });
    expect(err('boundary', { subject: 'su_99a', subject2: 'su_98a', from: '1945-04-16', points: 'Альфа' })).toMatch(/двух пунктов/);
  });
  it('переправа: состояние по-русски', () => {
    expect(ok('crossing', { subject: 'мост у Условного', from: '1945-04-16', state: 'разрушена' })).toEqual({ kind: 'crossing', subject: 'мост у Условного', from: '1945-04-16', state: 'destroyed' });
    expect(err('crossing', { subject: 'мост', from: '1945-04-16', state: 'частично' })).toMatch(/действует, разрушена, наведена/);
  });
  it('событие: id из даты и названия, если не задан', () => {
    expect(ok('event', { title: 'Начало штурма', at: '1945-04-16', place: 'Условный' })).toEqual({ kind: 'event', id: 'ev:1945-04-16:начало-штурма', at: '1945-04-16', title: 'Начало штурма', place: 'Условный' });
    expect(ok('event', { id: 'e1', title: 'Х', at: '1945-04-16' })).toMatchObject({ id: 'e1' });
  });
  it('потери: период и хотя бы одно число', () => {
    expect(ok('losses', { subject: 'su_99a', from: '1945-04-16', to: '1945-04-18', killed: '1 200', total: '' }))
      .toEqual({ kind: 'losses', subject: 'su_99a', from: '1945-04-16', to: '1945-04-18', killed: 1200 });
    expect(err('losses', { subject: 'su_99a', from: '1945-04-18', to: '1945-04-16', total: '5' })).toMatch(/раньше/);
    expect(err('losses', { subject: 'su_99a', from: '1945-04-16', to: '1945-04-18' })).toMatch(/хотя бы одно число/);
  });
  it('ошибки: обязательное пусто, не дата, не число, нет чисел', () => {
    expect(err('strength', { at: '1945-04-16', personnel: '1' })).toBe('не заполнено: соединение');
    expect(err('strength', { subject: 'x', at: '1945-13-01', personnel: '1' })).toMatch(/не дата/);
    expect(err('strength', { subject: 'x', at: '1945-04-16', personnel: 'много' })).toMatch(/не число/);
    expect(err('strength', { subject: 'x', at: '1945-04-16' })).toMatch(/хотя бы одно число/);
  });
  it('claimToForm → formToClaim — тот же claim', () => {
    const list: Claim[] = [
      { kind: 'strength', subject: 'su_99a', at: '1945-04-16', personnel: 52000, tanks: 310 },
      { kind: 'position', subject: 'su_99a', at: '1945-04-17T06:00', place: 'Холмы', lngLat: [14.6, 52.45], uncertaintyKm: 3 },
      { kind: 'boundary', between: ['a', 'b'], from: '1945-04-16', to: '1945-04-20', points: ['П1', 'П2'], inclusive: 'a' },
      { kind: 'event', id: 'e1', at: '1945-04-16', title: 'Х' },
      { kind: 'losses', subject: 'su_99a', from: '1945-04-16', to: '1945-04-18', total: 900 },
    ];
    for (const c of list) expect(ok(c.kind, claimToForm(c))).toEqual(c);
  });
  it('parseDate', () => {
    expect(parseDate('1.5.1945')).toBe('1945-05-01');
    expect(parseDate('')).toBe('');
    expect(parseDate('31.02.1945')).toBeNull();
  });
});

describe('manualCandidate и замечания формы', () => {
  const claim: Claim = { kind: 'strength', subject: 'su_99a', at: '1945-04-16', personnel: 52000 };
  it('без источника — факт без reliability, предупреждение «допущение»', () => {
    const c = manualCandidate(claim, { source: '  ', reliability: 'A', pages: 'с. 5', note: 'по памяти' }, { id: 'm1', value: 'v' });
    expect(c.reliability).toBeUndefined();
    expect(c.pages).toBeUndefined();
    expect(c).toMatchObject({ origin: 'manual', source: '', key: 'personnel', evidence: { kind: 'manual', note: 'по памяти' } });
    expect(formWarnings([], { source: '' })).toEqual([ASSUMPTION_WARNING]);
    expect(ASSUMPTION_WARNING).toMatch(/допущение/);
  });
  it('с источником — надёжность и страницы сохраняются, замечаний нет', () => {
    const c = manualCandidate(claim, { source: 'Условный журнал', reliability: 'B', pages: 'л. 12' }, { id: 'm1', value: 'v', op: 'op1' });
    expect(c).toMatchObject({ source: 'Условный журнал', reliability: 'B', pages: 'л. 12', op: 'op1' });
    expect(formWarnings([{ check: 'subject', level: 'ok' }], { source: 'Условный журнал' })).toEqual([]);
  });
  it('проверки 3–7 ручного ввода: сомнения — замечания формы (без проверки цитаты и чисел)', () => {
    const c = manualCandidate({ ...claim, personnel: 500000 }, { source: 'Условный журнал' }, { id: 'm1', value: 'v' });
    const checks = runChecks(c, {
      formations: [{ id: 'su_99a', name: '99-я армия', echelon: 'army' }], entries: [], strengthOf: () => null, existing: [], op: { start: '1945-04-16', end: '1945-05-08' },
    });
    expect(checks.map((r) => r.check)).not.toContain('quote');
    expect(checks.map((r) => r.check)).not.toContain('numbers');
    const w = formWarnings(checks, { source: 'Условный журнал' });
    expect(w.some((x) => /150000/.test(x))).toBe(true);
  });
  it('factOrigin: человек, авто, встроенный', () => {
    expect(factOrigin({ check: { by: 'human', at: '', results: [] } })).toBe('human');
    expect(factOrigin({ check: { by: 'auto', at: '', results: [] } })).toBe('auto');
    expect(factOrigin({})).toBe('seed');
  });
});
