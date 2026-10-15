import { describe, expect, it } from 'vitest';
import { runChecks, type Claim } from '@def-ops/knowledge';
import { ASSUMPTION_WARNING, claimToForm, formToClaim, formWarnings, manualCandidate, PARAM_OPTIONS, parseDate } from '../src/kb/fact-form';

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
});

describe('нормативы модели в форме: param и outcome', () => {
  it('param: значение (дробное), диапазон, сторона, масштаб', () => {
    expect(ok('param', { param: 'defense.prepared', value: '1,35', unit: '×' })).toEqual({ kind: 'param', param: 'defense.prepared', value: 1.35, unit: '×' });
    expect(ok('param', { param: 'foot.road', rangeFrom: '25', rangeTo: '35', unit: 'км/сут', side: 'su' }))
      .toEqual({ kind: 'param', param: 'foot.road', range: [25, 35], unit: 'км/сут', side: 'su' });
    expect(ok('param', { param: 'riverCrossHours', rangeFrom: '2', rangeTo: '6', scale: '3' })).toEqual({ kind: 'param', param: 'riverCrossHours', range: [2, 6], scale: 3 });
  });
  it('param: допущение — без числа, с «почему»', () => {
    expect(ok('param', { param: 'pocket.capitulateHours', why: 'нет журналов' })).toEqual({ kind: 'param', param: 'pocket.capitulateHours', why: 'нет журналов' });
  });
  it('param: ошибки — нет числа и «почему», половина диапазона, «до» меньше «от», сторона', () => {
    expect(err('param', { param: 'advanceMax' })).toMatch(/значение, диапазон или «почему допущение»/);
    expect(err('param', { param: 'advanceMax', rangeFrom: '25' })).toMatch(/обе границы/);
    expect(err('param', { param: 'advanceMax', rangeFrom: '45', rangeTo: '25' })).toMatch(/меньше/);
    expect(err('param', { param: 'advanceMax', value: '30', side: 'fr' })).toMatch(/su или de/);
  });
  it('outcome: период, диапазон, единица; ширина полосы — без соединения', () => {
    expect(ok('outcome', { subject: 'su_5ua', measure: 'pace', scenario: 'berlin-1945-tasks', from: '1945-04-17', to: '1945-04-18', rangeFrom: '5', rangeTo: '14', unit: 'км/сут' }))
      .toEqual({ kind: 'outcome', subject: 'su_5ua', measure: 'pace', scenario: 'berlin-1945-tasks', from: '1945-04-17', to: '1945-04-18', range: [5, 14], unit: 'км/сут' });
    expect(ok('outcome', { measure: 'frontage', scenario: 's', from: '1945-04-16', to: '1945-04-16', rangeFrom: '3', rangeTo: '8', unit: 'км', side: 'de', echelon: 'division', near: 'Высоты' }))
      .toMatchObject({ kind: 'outcome', measure: 'frontage', range: [3, 8], side: 'de', echelon: 'division', near: 'Высоты' });
    expect(err('outcome', { measure: 'pace', scenario: 's', from: '1945-04-18', to: '1945-04-17', rangeFrom: '1', rangeTo: '2', unit: 'км' })).toMatch(/раньше/);
    expect(err('outcome', { measure: 'pace', scenario: 's', from: '1945-04-17', to: '1945-04-18', unit: 'км' })).toMatch(/не заполнено: от/);
  });
  it('claimToForm → formToClaim — тот же норматив', () => {
    const list: Claim[] = [
      { kind: 'param', param: 'riverCrossHours', range: [2, 6], unit: 'ч', scale: 3 },
      { kind: 'param', param: 'stockDays.fortress', range: [25, 35], unit: 'сут', side: 'de' },
      { kind: 'param', param: 'engineers.hours', unit: 'ч', why: 'нет сведений' },
      { kind: 'outcome', measure: 'loss', scenario: 's', subject: 'su_1bf', from: '1945-04-16T05:00', to: '1945-05-02T05:00', range: [12, 24], unit: '% численности' },
    ];
    for (const c of list) expect(ok(c.kind, claimToForm(c))).toEqual(c);
  });
  it('параметр выбирается из перечня входов правил', () => {
    expect(PARAM_OPTIONS.length).toBeGreaterThan(50);
    expect(PARAM_OPTIONS.find((o) => o.path === 'defense.prepared')?.title).toMatch(/оборона/i);
    expect(PARAM_OPTIONS.some((o) => o.path.startsWith('agents.'))).toBe(true);
  });
});

describe('formToClaim: правило доктрины', () => {
  const base = { side: 'de', level: 'corps', group: 'counterattack', rule: 'r1', condition: 'Вклинение', action: 'Контратака', values: 'force_share=0,33; km=2–4' };
  it('числа: «имя=число; имя=от–до», десятичная запятая', () => {
    expect(ok('doctrine', base)).toEqual({ kind: 'doctrine', side: 'de', level: 'corps', group: 'counterattack', rule: 'r1', condition: 'Вклинение', action: 'Контратака', values: { force_share: 0.33, km: [2, 4] } });
    expect(ok('doctrine', { ...base, values: '' })).not.toHaveProperty('values');
  });
  it('ошибки: пустое действие, «до» меньше «от», неизвестный уровень', () => {
    expect(err('doctrine', { ...base, action: '' })).toBe('действие: обязательное поле');
    expect(err('doctrine', { ...base, values: 'km=4–2' })).toBe('km: «до» меньше, чем «от»');
    expect(err('doctrine', { ...base, level: 'полк' })).toBe('уровень: front, army, corps или division');
    expect(err('doctrine', { ...base, values: 'km=много' })).toMatch(/^km: /);
  });
  it('claimToForm → formToClaim — тот же claim', () => {
    const c: Claim = { kind: 'doctrine', side: 'su', level: 'front', group: 'frontage', rule: 'r2', condition: 'Прорыв', action: 'Сосредоточить', values: { pct: [5, 12], share: 0.75, 'km.su_47a': 4.3 } };
    expect(ok('doctrine', claimToForm(c))).toEqual(c);
    const d: Claim = { kind: 'doctrine', side: 'de', level: 'division', group: 'layout', rule: 'r3', condition: 'Оборона', action: 'Две позиции' };
    expect(ok('doctrine', claimToForm(d))).toEqual(d);
  });
});
