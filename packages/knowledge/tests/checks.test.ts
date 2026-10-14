import { describe, it, expect } from 'vitest';
import { numbersIn, claimNumbers, matchEntry, runChecks, verdictOf, PLAUSIBLE, type Candidate, type CheckCtx, type Claim, type Entry, type Evidence } from '../src';

const cand = (claim: Claim, evidence: Evidence, over: Partial<Candidate> = {}): Candidate => ({
  id: 'c1', claim, names: {}, key: 'k', value: 'v', source: 'doc:d1', origin: 'text', evidence,
  checks: [], verdict: 'auto', state: 'pending', ...over,
});
const q = (quote: string): Evidence => ({ kind: 'quote', doc: 'd1', chunk: 0, quote });
const ctx = (over: Partial<CheckCtx> = {}): CheckCtx => ({
  formations: [], entries: [], strengthOf: () => null, existing: [], ...over,
});
const lvl = (c: Candidate, x: CheckCtx, check: string) => runChecks(c, x).find((r) => r.check === check);

describe('числа в тексте', () => {
  it('разряды через пробел, неразрывные пробелы и точку', () => {
    expect(numbersIn('убито 4 910 и 4 910, ранено 4.910')).toEqual([4910, 4910, 4910]);
    expect(numbersIn('3 200 и 12 500')).toEqual([3200, 12500]);
  });
  it('десятичная запятая — не разряды', () => {
    expect(numbersIn('4,9 тыс.')).not.toContain(4910);
    expect(numbersIn('4,9 тыс.')).toEqual([4.9]);
  });
  it('числа claim', () => {
    expect(claimNumbers({ kind: 'losses', subject: 's', from: '1945-04-16', to: '1945-04-17', killed: 5, total: 9 })).toEqual([5, 9]);
  });
});

describe('quote и numbers', () => {
  const losses: Claim = { kind: 'losses', subject: 'su_8gva', from: '1945-04-16', to: '1945-04-17', killed: 4910 };
  it('число в цитате — ok, verdict auto', () => {
    const c = cand(losses, q('потери убитыми 4 910'));
    expect(lvl(c, ctx({ text: 'Итого за сутки потери убитыми 4 910 человек.' }), 'numbers')?.level).toBe('ok');
  });
  it('«4,9 тыс.» — fail, итог drop', () => {
    const c = cand(losses, q('потери убитыми 4,9 тыс.'));
    const r = runChecks(c, ctx({ text: 'потери убитыми 4,9 тыс. человек' }));
    expect(r.find((x) => x.check === 'numbers')?.level).toBe('fail');
    expect(verdictOf(r)).toBe('drop');
  });
  it('цитата с иными пробелами и переносом — ok', () => {
    const c = cand(losses, q('потери  убитыми\n4 910'));
    expect(lvl(c, ctx({ text: 'всего потери убитыми 4 910 человек' }), 'quote')?.level).toBe('ok');
  });
  it('цитаты нет в тексте — fail', () => {
    const c = cand(losses, q('потери убитыми 4 910'));
    expect(lvl(c, ctx({ text: 'совсем другой текст про танки' }), 'quote')?.level).toBe('fail');
  });
  it('скан с «?» в числе — doubt; без «?» — ok; нет в расшифровке — fail', () => {
    const sc = (quote: string): Evidence => ({ kind: 'scan', doc: 'd1', page: 1, quote });
    const tr = 'ведомость: численность 1 2?0 человек';
    expect(lvl(cand(losses, sc('численность 1 2?0 человек'), { origin: 'scan' }), ctx({ transcript: tr }), 'quote')?.level).toBe('doubt');
    expect(lvl(cand(losses, sc('численность 1 250 человек'), { origin: 'scan' }), ctx({ transcript: 'численность 1 250 человек' }), 'quote')?.level).toBe('ok');
    expect(lvl(cand(losses, sc('численность 9 999 человек'), { origin: 'scan' }), ctx({ transcript: tr }), 'quote')?.level).toBe('fail');
  });
  it('скан с «?» в числе: numbers — doubt, итог review (не drop)', () => {
    const c = cand({ kind: 'strength', subject: 's', at: '1945-04-16', personnel: 1250 }, { kind: 'scan', doc: 'd1', page: 1, quote: 'численность 1 2?0 человек' }, { origin: 'scan' });
    const r = runChecks(c, ctx({ transcript: 'численность 1 2?0 человек' }));
    expect(r.find((x) => x.check === 'numbers')?.level).toBe('doubt');
    expect(verdictOf(r)).toBe('review');
  });
  it('агент со ссылкой без выписки: numbers — doubt', () => {
    const c = cand(losses, { kind: 'agent', ref: 'ЦАМО 233-2356' }, { origin: 'agent' });
    const r = runChecks(c, ctx());
    expect(r.find((x) => x.check === 'quote')?.level).toBe('ok');
    expect(r.find((x) => x.check === 'numbers')?.level).toBe('doubt');
  });
  it('таблица: строка есть — ok, нет — fail; числа берутся из ячеек', () => {
    const e: Evidence = { kind: 'row', doc: 'd1', row: 3, cells: { 'Убито': '4 910' } };
    const c = cand(losses, e, { origin: 'table' });
    expect(lvl(c, ctx({ rowExists: true }), 'quote')?.level).toBe('ok');
    expect(lvl(c, ctx({ rowExists: true }), 'numbers')?.level).toBe('ok');
    expect(lvl(c, ctx({ rowExists: false }), 'quote')?.level).toBe('fail');
  });
  it('таблица «дни в столбцах»: соседние ячейки не склеиваются в разряды', () => {
    const e: Evidence = { kind: 'row', doc: 'd1', row: 2, cells: { 'Соединение': '2-я гв. танковая армия', '16.04.1945': '310', '17.04.1945': '640', '18.04.1945': '1 120' } };
    const day = (total: number): Claim => ({ kind: 'losses', subject: 'su_2gta', from: '1945-04-16', to: '1945-04-16', total });
    expect(lvl(cand(day(310), e, { origin: 'table' }), ctx({ rowExists: true }), 'numbers')?.level).toBe('ok');
    expect(lvl(cand(day(640), e, { origin: 'table' }), ctx({ rowExists: true }), 'numbers')?.level).toBe('ok');
    expect(lvl(cand(day(1120), e, { origin: 'table' }), ctx({ rowExists: true }), 'numbers')?.level).toBe('ok');
  });
  it('дни в столбцах: число сверяется с ячейкой своего дня', () => {
    const cells = { 'Соединение': '2-я гв. танковая армия', '16.04.1945': '310', '17.04.1945': '640' };
    const ev = (cell: string): Evidence => ({ kind: 'row', doc: 'd1', row: 2, cells, cell, dayCells: ['16.04.1945', '17.04.1945'] });
    const day = (total: number): Claim => ({ kind: 'losses', subject: 'su_2gta', from: '1945-04-16', to: '1945-04-16', total });
    expect(lvl(cand(day(310), ev('16.04.1945'), { origin: 'table' }), ctx({ rowExists: true }), 'numbers')?.level).toBe('ok');
    // факт за 16.04 с числом ячейки 17.04 — ошибка
    expect(lvl(cand(day(640), ev('16.04.1945'), { origin: 'table' }), ctx({ rowExists: true }), 'numbers')?.level).toBe('fail');
  });
  it('ручная правка не проходит проверки 1–2', () => {
    const c = cand(losses, { kind: 'manual' }, { origin: 'manual' });
    const r = runChecks(c, ctx());
    expect(r.some((x) => x.check === 'quote' || x.check === 'numbers')).toBe(false);
  });
});

describe('subject', () => {
  const formations = [{ id: 'su_8gva', name: '8-я гв. армия' }, { id: 'su_5ua', name: '5-я ударная армия' }];
  const base: Claim = { kind: 'strength', subject: '', at: '1945-04-16', personnel: 1000 };
  it('«8-я гвардейская армия» → su_8gva', () => {
    const c = cand({ ...base }, q('x'), { names: { subject: '8-я гвардейская армия' } });
    expect(lvl(c, ctx({ formations }), 'subject')?.level).toBe('ok');
    expect((c.claim as { subject: string }).subject).toBe('su_8gva');
  });
  it('имя, подходящее к двум записям, — doubt с обоими названиями', () => {
    const mk = (id: string, title: string): Entry => ({ id, category: 'formations', title, summary: '', status: 'checked' });
    const entries = [mk('f1', 'Третья ударная армия 1-го формирования'), mk('f2', 'Третья ударная армия 2-го формирования')];
    const c = cand({ ...base }, q('x'), { names: { subject: 'Третья ударная армия' } });
    const r = lvl(c, ctx({ entries }), 'subject');
    expect(r?.level).toBe('doubt');
    expect(r?.why).toContain('1-го формирования');
    expect(r?.why).toContain('2-го формирования');
  });
  it('сокращения названий сопоставляются', () => {
    const fs = [
      { id: 'su_8gva', name: '8-я гвардейская армия' }, { id: 'su_1gta', name: '1-я гвардейская танковая армия' },
      { id: 'su_5ua', name: '5-я ударная армия' }, { id: 'su_47a', name: '47-я армия' },
      { id: 'su_79sk', name: '79-й стрелковый корпус' }, { id: 'su_9tk', name: '9-й танковый корпус' },
    ];
    const id = (name: string) => { const c = cand({ ...base }, q('x'), { names: { subject: name } }); runChecks(c, ctx({ formations: fs })); return (c.claim as { subject: string }).subject; };
    expect(id('8 гв. А')).toBe('su_8gva');
    expect(id('8 гв.А')).toBe('su_8gva');
    expect(id('1 гв. ТА')).toBe('su_1gta');
    expect(id('5 уд. А')).toBe('su_5ua');
    expect(id('5 УА')).toBe('su_5ua');
    expect(id('47 А')).toBe('su_47a');
    expect(id('79 ск')).toBe('su_79sk');
    expect(id('9 тк')).toBe('su_9tk');
  });
  it('не найдено — doubt', () => {
    const c = cand({ ...base }, q('x'), { names: { subject: 'Неизвестный корпус' } });
    expect(lvl(c, ctx({ formations }), 'subject')?.level).toBe('doubt');
  });
  const mk = (id: string, title: string, aliases?: string[]): Entry => ({ id, category: 'formations', title, summary: '', status: 'checked', ...(aliases ? { aliases } : {}) });
  it('совпадение только по роду войск (повторы основ не в счёт) — не сопоставлено', () => {
    const entries = [mk('f:rear_btl_schildau', 'Батальон «Шильдау» (резерв корпуса); КП артиллерии корпуса (Oberst Köhler) в Шильдау с 12.04')];
    const c = cand({ ...base }, q('x'), { names: { subject: 'Неизвестный корпус' } });
    const r = lvl(c, ctx({ entries }), 'subject');
    expect(r?.level).toBe('doubt');
    expect((c.claim as { subject: string }).subject).toBe('');
    expect(matchEntry(entries, 'formations', 'Неизвестный корпус', [])).toBeNull();
  });
  it('сопоставлено только по сходству основ — id ставится, но doubt', () => {
    const entries = [mk('f:x', 'Боевая группа Хартманн (Kampfgruppe)')];
    const c = cand({ ...base }, q('x'), { names: { subject: 'группа Хартманн' } });
    const r = lvl(c, ctx({ entries }), 'subject');
    expect((c.claim as { subject: string }).subject).toBe('f:x');
    expect(r?.level).toBe('doubt');
    expect(r?.why).toContain('по сходству');
  });
  it('точное название или синоним записи — ok', () => {
    const entries = [mk('f:x', 'Боевая группа Хартманн', ['KG Hartmann'])];
    for (const name of ['Боевая группа Хартманн', 'KG Hartmann']) {
      const c = cand({ ...base }, q('x'), { names: { subject: name } });
      expect(lvl(c, ctx({ entries }), 'subject')?.level).toBe('ok');
      expect((c.claim as { subject: string }).subject).toBe('f:x');
    }
  });
});

describe('date', () => {
  const op = { start: '1945-04-16T03:00', end: '1945-05-02T00:00' };
  const at = (d: string): Claim => ({ kind: 'strength', subject: 's', at: d, personnel: 100 });
  it('за 7 суток до начала — ok', () => {
    expect(lvl(cand(at('1945-04-09'), q('x')), ctx({ op }), 'date')?.level).toBe('ok');
  });
  it('раньше запаса — doubt; позже конца — doubt', () => {
    expect(lvl(cand(at('1945-04-01'), q('x')), ctx({ op }), 'date')?.level).toBe('doubt');
    expect(lvl(cand(at('1945-05-03'), q('x')), ctx({ op }), 'date')?.level).toBe('doubt');
    expect(lvl(cand(at('1945-05-02'), q('x')), ctx({ op }), 'date')?.level).toBe('ok');
  });
  it('граница: 1945-04-08 (8 суток до начала) — doubt', () => {
    expect(lvl(cand(at('1945-04-08'), q('x')), ctx({ op }), 'date')?.level).toBe('doubt');
  });
  it('не дата — fail', () => {
    expect(lvl(cand(at('1945-13-01'), q('x')), ctx({ op }), 'date')?.level).toBe('fail');
    expect(lvl(cand(at('апрель'), q('x')), ctx({ op }), 'date')?.level).toBe('fail');
  });
});

describe('place', () => {
  const pos: Claim = { kind: 'position', subject: 's', at: '1945-04-16', place: 'Зелов' };
  const theatre = { locate: (n: string) => n === 'Зелов' ? { at: [14.5, 52.5] as [number, number] } : null };
  it('найдено — ok, нет — doubt, координаты — ok', () => {
    expect(lvl(cand(pos, q('x')), ctx({ theatre }), 'place')?.level).toBe('ok');
    expect(lvl(cand({ ...pos, place: 'Нигде' }, q('x')), ctx({ theatre }), 'place')?.level).toBe('doubt');
    expect(lvl(cand({ ...pos, place: 'Нигде', lngLat: [1, 2] }, q('x')), ctx({ theatre }), 'place')?.level).toBe('ok');
  });
});

describe('plausible', () => {
  const formations = [
    { id: 'su_d', name: 'д', echelon: 'division', personnel: 15000 },
    { id: 'su_c', name: 'к', echelon: 'corps' },
    { id: 'su_a', name: 'а', echelon: 'army' },
  ];
  it('пороги из допущений', () => {
    expect(PLAUSIBLE.strength.division).toBe(20000);
    expect(PLAUSIBLE.dailyLossShare).toBeCloseTo(1 / 3);
  });
  it('дивизия 25 000 — doubt; 12 000 — ok', () => {
    expect(lvl(cand({ kind: 'strength', subject: 'su_d', at: '1945-04-16', personnel: 25000 }, q('x')), ctx({ formations }), 'plausible')?.level).toBe('doubt');
    expect(lvl(cand({ kind: 'strength', subject: 'su_d', at: '1945-04-16', personnel: 12000 }, q('x')), ctx({ formations }), 'plausible')?.level).toBe('ok');
  });
  it('потери за сутки 6 000 при численности 15 000 — doubt', () => {
    const c = cand({ kind: 'losses', subject: 'su_d', from: '1945-04-16', to: '1945-04-16', total: 6000 }, q('x'));
    expect(lvl(c, ctx({ formations }), 'plausible')?.level).toBe('doubt');
    expect(lvl(cand({ kind: 'losses', subject: 'su_d', from: '1945-04-16', to: '1945-04-16', total: 3000 }, q('x')), ctx({ formations }), 'plausible')?.level).toBe('ok');
  });
  it('потери за период больше численности — doubt', () => {
    const c = cand({ kind: 'losses', subject: 'su_d', from: '1945-04-16', to: '1945-04-30', killed: 16000 }, q('x'));
    expect(lvl(c, ctx({ formations }), 'plausible')?.level).toBe('doubt');
  });
  it('пополнение больше половины — doubt', () => {
    expect(lvl(cand({ kind: 'reinforce', subject: 'su_d', at: '1945-04-16', personnel: 9000 }, q('x')), ctx({ formations }), 'plausible')?.level).toBe('doubt');
  });
  it('parent: дивизия в дивизии — doubt, армия над дивизией — ok', () => {
    expect(lvl(cand({ kind: 'parent', subject: 'su_d', from: '1945-04-16', parent: 'su_d' }, q('x')), ctx({ formations }), 'plausible')?.level).toBe('doubt');
    expect(lvl(cand({ kind: 'parent', subject: 'su_d', from: '1945-04-16', parent: 'su_a' }, q('x')), ctx({ formations }), 'plausible')?.level).toBe('ok');
  });
});

describe('duplicate', () => {
  const claim: Claim = { kind: 'strength', subject: 's', at: '1945-04-16', personnel: 100 };
  const existing = [{ key: 'k', value: 'v', source: 'doc:d1', claim: { personnel: 100, at: '1945-04-16', subject: 's', kind: 'strength' } as Claim }];
  it('тот же claim и источник — fail', () => {
    expect(lvl(cand(claim, q('x')), ctx({ existing }), 'duplicate')?.level).toBe('fail');
  });
  it('тот же claim, другой источник — ok', () => {
    expect(lvl(cand(claim, q('x'), { source: 'doc:d2' }), ctx({ existing }), 'duplicate')?.level).toBe('ok');
  });
  it('положение по названию места: у записанного факта координаты с театра — всё равно повтор', () => {
    const pos: Claim = { kind: 'position', subject: 's', at: '1945-04-17', place: 'Зелов' };
    const stored = [{ key: 'k', value: 'v', source: 'doc:d1', claim: { ...pos, lngLat: [14.37, 52.59] } as Claim }];
    expect(lvl(cand(pos, q('x')), ctx({ existing: stored }), 'duplicate')?.level).toBe('fail');
    // другое место — не повтор
    expect(lvl(cand({ ...pos, place: 'Дольгелин' }, q('x')), ctx({ existing: stored }), 'duplicate')?.level).toBe('ok');
  });
});

describe('verdictOf', () => {
  it('fail → drop, doubt → review, иначе auto', () => {
    expect(verdictOf([{ check: 'quote', level: 'ok' }, { check: 'date', level: 'doubt' }, { check: 'numbers', level: 'fail' }])).toBe('drop');
    expect(verdictOf([{ check: 'quote', level: 'ok' }, { check: 'date', level: 'doubt' }])).toBe('review');
    expect(verdictOf([{ check: 'quote', level: 'ok' }])).toBe('auto');
  });
});
