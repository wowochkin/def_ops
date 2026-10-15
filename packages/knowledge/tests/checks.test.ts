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
  it('дни в столбцах, несколько чисел за день: сверка с ячейками этого дня', () => {
    const cells = { 'Соединение': '2-я гв. танковая армия', '16.04#2': '310', '16.04#3': '640', '17.04#4': '120', '17.04#5': '450' };
    const ev = (cell: string[]): Evidence => ({ kind: 'row', doc: 'd1', row: 2, cells, cell, dayCells: ['16.04#2', '16.04#3', '17.04#4', '17.04#5'] });
    const day = (killed: number, wounded: number): Claim => ({ kind: 'losses', subject: 'su_2gta', from: '1945-04-16', to: '1945-04-16', killed, wounded });
    expect(lvl(cand(day(310, 640), ev(['16.04#2', '16.04#3']), { origin: 'table' }), ctx({ rowExists: true }), 'numbers')?.level).toBe('ok');
    expect(lvl(cand(day(310, 450), ev(['16.04#2', '16.04#3']), { origin: 'table' }), ctx({ rowExists: true }), 'numbers')?.level).toBe('fail');
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
  it('сопоставлено только по сходству основ — id сценария ставится, но doubt', () => {
    const entries = [mk('f:x', 'Боевая группа Хартманн (Kampfgruppe)', ['de_kg_hartmann'])];
    const c = cand({ ...base }, q('x'), { names: { subject: 'группа Хартманн' } });
    const r = lvl(c, ctx({ entries }), 'subject');
    expect((c.claim as { subject: string }).subject).toBe('de_kg_hartmann');
    expect(r?.level).toBe('doubt');
    expect(r?.why).toContain('по сходству');
  });
  it('точное название или синоним записи — ok, соединение — id сценария, а не id записи', () => {
    const entries = [mk('f:x', 'Боевая группа Хартманн', ['KG Hartmann', 'de_kg_hartmann'])];
    for (const name of ['Боевая группа Хартманн', 'KG Hartmann']) {
      const c = cand({ ...base }, q('x'), { names: { subject: name } });
      expect(lvl(c, ctx({ entries }), 'subject')?.level).toBe('ok');
      expect((c.claim as { subject: string }).subject).toBe('de_kg_hartmann');
    }
  });
  it('запись базы без соединения сценария — соединение пусто, сомнение', () => {
    const entries = [mk('f:x', 'Боевая группа Хартманн', ['KG Hartmann'])];
    const c = cand({ ...base }, q('x'), { names: { subject: 'KG Hartmann' } });
    const r = lvl(c, ctx({ entries }), 'subject');
    expect((c.claim as { subject: string }).subject).toBe('');
    expect(r?.level).toBe('doubt');
    expect(r?.why).toContain('без соединения сценария');
  });
  it('соединение по записи базы (f:su_1bf) — id сценария su_1bf; правдоподобие проверяется', () => {
    const entries = [mk('f:su_1bf', '1-й Белорусский фронт', ['1-й Белорусский', 'su_1bf'])];
    const formations = [{ id: 'su_1bf', name: '1 БФ', echelon: 'front' }];
    const c = cand({ kind: 'strength', subject: '', at: '1945-04-16', personnel: 5_000_000 }, q('x'), { names: { subject: '1-й Белорусский' } });
    const rs = runChecks(c, ctx({ entries, formations }));
    expect((c.claim as { subject: string }).subject).toBe('su_1bf');
    expect(rs.find((r) => r.check === 'plausible')?.level).toBe('doubt');
  });
  it('переправа: соединение не сопоставляется, subject — название переправы', () => {
    const cross: Claim = { kind: 'crossing', subject: '', from: '1945-04-20', state: 'destroyed' };
    const c = cand({ ...cross }, q('x'), { names: { subject: 'мост через Одер у Франкфурта' } });
    const r = lvl(c, ctx({ formations }), 'subject');
    expect(r?.level).toBe('ok');
    expect((c.claim as { subject: string }).subject).toBe('мост через Одер у Франкфурта');
    const none = cand({ ...cross }, q('x'));
    expect(lvl(none, ctx({ formations }), 'subject')).toMatchObject({ level: 'doubt', why: 'не названа переправа' });
  });
  it('переправа из документа без операции — на проверку, с операцией — по дате', () => {
    const cross = (): Candidate => cand({ kind: 'crossing', subject: '', from: '1945-04-20', state: 'destroyed' }, q('x'), { names: { subject: 'мост у Франкфурта' } });
    const no = cross();
    expect(lvl(no, ctx({ formations }), 'date')).toMatchObject({ level: 'doubt' });
    expect(verdictOf(runChecks(no, ctx({ formations })))).not.toBe('auto');
    const withOp = cross();
    expect(lvl(withOp, ctx({ formations, op: { start: '1945-04-16T03:00', end: '1945-05-02T23:59' } }), 'date')?.level).toBe('ok');
    // прочие виды без операции дату не оспаривают
    const pos = cand({ kind: 'position', subject: '', at: '1945-04-20', place: 'Зелов' }, q('x'), { names: { subject: '8 гв. А' } });
    expect(lvl(pos, ctx({ formations }), 'date')?.level).toBe('ok');
  });
  it('событие: проверки соединения нет', () => {
    const c = cand({ kind: 'event', id: 'e1', at: '1945-04-20', title: 'взят город' }, q('x'));
    expect(lvl(c, ctx({ formations }), 'subject')).toBeUndefined();
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

describe('нормативы модели: param и outcome', () => {
  const param = (p: string, v: { value?: number; range?: [number, number] }): Claim => ({ kind: 'param', param: p, ...v });
  const cand = (claim: Claim, quote: string, over: Partial<Candidate> = {}): Candidate => ({
    id: 'c1', claim, names: {}, key: 'numbers', value: 'v', source: 'doc:d1', origin: 'text', evidence: { kind: 'quote', doc: 'd1', chunk: 0, quote },
    checks: [], verdict: 'auto', state: 'pending', ...over,
  });
  const ctx = (over: Partial<CheckCtx> = {}): CheckCtx => ({ formations: [{ id: 'su_5ua', name: '5 уд. А', echelon: 'army' }], entries: [], strengthOf: () => null, existing: [], ...over });
  const known = new Set(['defense.prepared', 'advanceMax']);
  const lvl = (c: Candidate, x: CheckCtx, check: string) => runChecks(c, x).find((r) => r.check === check);

  it('неизвестный параметр — сомнение, не отбой', () => {
    const c = cand(param('defense.prepard', { value: 1.5 }), 'подготовленная оборона сильнее в 1,5 раза');
    const r = lvl(c, ctx({ knownParams: known, text: 'подготовленная оборона сильнее в 1,5 раза' }), 'param');
    expect(r?.level).toBe('doubt');
    expect(r?.why).toMatch(/неизвестный параметр/);
  });
  it('известный параметр, число в цитате — ok; соединение не требуется', () => {
    const c = cand(param('defense.prepared', { value: 1.5 }), 'сильнее в 1,5 раза');
    const r = runChecks(c, ctx({ knownParams: known, text: 'оборона сильнее в 1,5 раза' }));
    expect(r.find((x) => x.check === 'param')?.level).toBe('ok');
    expect(r.find((x) => x.check === 'numbers')?.level).toBe('ok');
    expect(r.find((x) => x.check === 'subject')).toBeUndefined();
  });
  it('числа диапазона ищутся в цитате', () => {
    const c = cand(param('advanceMax', { range: [25, 45] }), 'темп 25–40 км в сутки');
    expect(lvl(c, ctx({ knownParams: known, text: 'темп 25–40 км в сутки' }), 'numbers')?.level).toBe('fail');
  });
  it('диапазон не упорядочен — отбой', () => {
    const c = cand(param('advanceMax', { range: [45, 25] }), 'темп 45–25');
    expect(lvl(c, ctx({ knownParams: known, text: 'темп 45–25' }), 'param')?.level).toBe('fail');
  });
  it('outcome: соединение сопоставляется, даты проверяются, диапазон упорядочен', () => {
    const oc: Claim = { kind: 'outcome', measure: 'pace', scenario: 'op', subject: '', from: '1945-04-17', to: '1945-04-18', range: [5, 14], unit: 'км/сут' };
    const c = cand(oc, 'армия продвинулась на 5–14 км', { names: { subject: '5 уд. А' } });
    const r = runChecks(c, ctx({ text: 'армия продвинулась на 5–14 км' }));
    expect(r.find((x) => x.check === 'subject')?.level).toBe('ok');
    expect((c.claim as { subject: string }).subject).toBe('su_5ua');
    expect(r.find((x) => x.check === 'date')?.level).toBe('ok');
    const bad = cand({ ...oc, from: '1945-04-19', range: [14, 5] }, 'на 5–14 км', { names: { subject: '5 уд. А' } });
    const rb = runChecks(bad, ctx({ text: 'на 5–14 км' }));
    expect(rb.find((x) => x.check === 'date')?.level).toBe('fail');
    expect(rb.find((x) => x.check === 'param')?.level).toBe('fail');
  });
  it('outcome без операции — сомнение', () => {
    const oc: Claim = { kind: 'outcome', measure: 'pace', scenario: '', subject: 'su_5ua', from: '1945-04-17', to: '1945-04-18', range: [5, 14], unit: 'км/сут' };
    const c = cand(oc, 'на 5–14 км', { names: { subject: '5 уд. А' } });
    expect(lvl(c, ctx({ text: 'на 5–14 км' }), 'param')?.level).toBe('doubt');
  });
});

describe('доктрина: правило «условие → действие»', () => {
  const rule: Claim = { kind: 'doctrine', side: 'de', level: 'corps', group: 'counterattack', rule: 'r1', condition: 'Вклинение', action: 'Контратака во фланг' };
  const manual = (c: Claim) => cand(c, { kind: 'manual' }, { origin: 'manual' });
  it('ручной ввод: правило ok, соединения у доктрины нет', () => {
    const r = runChecks(manual(rule), ctx());
    expect(r.find((x) => x.check === 'doctrine')).toEqual({ check: 'doctrine', level: 'ok' });
    expect(r.find((x) => x.check === 'subject')).toBeUndefined();
    expect(verdictOf(r)).toBe('auto');
  });
  it('пустое действие — отбой', () => {
    expect(lvl(manual({ ...rule, action: ' ' }), ctx(), 'doctrine')).toEqual({ check: 'doctrine', level: 'fail', why: 'пустое условие или действие' });
  });
  it('пустое условие: из документа — отбой, ручной ввод — допустимо (условие необязательно)', () => {
    expect(lvl(cand({ ...rule, condition: '' }, q('цитата правила')), ctx({ text: 'цитата правила' }), 'doctrine')?.level).toBe('fail');
    expect(lvl(manual({ ...rule, condition: '' }), ctx(), 'doctrine')?.level).toBe('ok');
  });
  it('сторона пуста или не su/de — отбой; ступень не из перечня — отбой', () => {
    expect(lvl(manual({ ...rule, side: '' as 'su' }), ctx(), 'doctrine')).toEqual({ check: 'doctrine', level: 'fail', why: 'не указана сторона' });
    expect(lvl(manual({ ...rule, side: 'ru' as 'su' }), ctx(), 'doctrine')?.level).toBe('fail');
    expect(lvl(manual({ ...rule, level: 'regiment' as 'corps' }), ctx(), 'doctrine')).toEqual({ check: 'doctrine', level: 'fail', why: 'ступень не из перечня: «regiment»' });
  });
  it('пустая группа или не латиницей — отказ; имена свойств объекта не группы', () => {
    expect(lvl(manual({ ...rule, group: '' }), ctx(), 'doctrine')?.level).toBe('fail');
    expect(lvl(manual({ ...rule, group: 'Night raid' }), ctx(), 'doctrine')?.level).toBe('fail');
    expect(lvl(manual({ ...rule, group: 'constructor' }), ctx(), 'doctrine')?.level).toBe('doubt');
  });
  it('неизвестная группа — сомнение', () => {
    expect(lvl(manual({ ...rule, group: 'night-raid' }), ctx(), 'doctrine')).toEqual({ check: 'doctrine', level: 'doubt', why: 'неизвестная группа: «night-raid»' });
  });
  it('у прочих видов проверки доктрины нет', () => {
    expect(lvl(manual({ kind: 'enter', subject: 's', at: '1945-04-16' }), ctx(), 'doctrine')).toBeUndefined();
  });
});

describe('норматив: единица, знак и порядок величины против входа правил', () => {
  const pc = (p: string, v: { value?: number; range?: [number, number]; unit?: string; scale?: number; why?: string }): Claim => ({ kind: 'param', param: p, ...v });
  const cand = (claim: Claim, quote: string): Candidate => ({
    id: 'c1', claim, names: {}, key: 'numbers', value: 'v', source: 'doc:d1', origin: 'text', evidence: { kind: 'quote', doc: 'd1', chunk: 0, quote },
    checks: [], verdict: 'auto', state: 'pending',
  });
  const paramInfo = {
    'defense.prepared': { unit: '×', value: 1.35 },
    'advanceMax': { unit: 'км/сут', value: 30 },
    'defense.fortificationPerLevel': { unit: '+', value: 0.25 },
    'pocket.breakoutKeep': { unit: '%', value: 30 },
    'riverCrossHours': { unit: 'ч', value: 12 },
  };
  const known = new Set(Object.keys(paramInfo));
  const chk = (claim: Claim, quote: string) => runChecks(cand(claim, quote), { formations: [], entries: [], strengthOf: () => null, existing: [], knownParams: known, paramInfo, text: quote });
  const lv = (claim: Claim, quote: string) => chk(claim, quote).find((r) => r.check === 'param');

  it('«повышает устойчивость на 35 %» как 35 % на множитель × — сомнение (единица и порядок величины)', () => {
    const r = lv(pc('defense.prepared', { value: 35, unit: '%' }), 'подготовленная оборона повышает устойчивость на 35 %');
    expect(r?.level).toBe('doubt');
    expect(r?.why).toMatch(/единиц/);
    expect(r?.why).toMatch(/5 раз|порядок/);
  });
  it('единица синонимом входа — не сомнение: «км в сутки» = км/сут, «раз» = ×', () => {
    expect(lv(pc('advanceMax', { range: [25, 45], unit: 'км в сутки' }), 'темп 25–45 км в сутки')?.level).toBe('ok');
    expect(lv(pc('defense.prepared', { value: 1.5, unit: 'раз' }), 'сильнее в 1,5 раза')?.level).toBe('ok');
  });
  it('ноль и отрицательное у множителя — отбой; у доли и прибавки ноль допустим, отрицательное — нет', () => {
    expect(lv(pc('defense.prepared', { value: 0, unit: '×' }), 'поправка 0')?.level).toBe('fail');
    expect(lv(pc('advanceMax', { range: [0, 40], unit: 'км/сут' }), 'темп 0–40 км/сут')?.level).toBe('fail');
    expect(lv(pc('pocket.breakoutKeep', { range: [0, 10], unit: '%' }), 'выносят 0–10 %')?.level).toBe('ok');
    // ноль у прибавки не отбой (сомнение — от порядка величины: нынешнее 0,25)
    expect(lv(pc('defense.fortificationPerLevel', { value: 0, unit: '+' }), 'прибавка 0')?.level).not.toBe('fail');
    expect(lv(pc('defense.fortificationPerLevel', { range: [-1, 0.3], unit: '+' }), 'прибавка -1–0,3')?.level).toBe('fail');
  });
  it('коридор дальше чем в 5 раз от нынешнего значения — сомнение; с масштабом — по значению входа', () => {
    expect(lv(pc('advanceMax', { value: 300, unit: 'км/сут' }), 'темп 300 км/сут')?.level).toBe('doubt');
    expect(lv(pc('advanceMax', { value: 5, unit: 'км/сут' }), 'темп 5 км/сут')?.level).toBe('doubt');
    expect(lv(pc('advanceMax', { range: [7, 140], unit: 'км/сут' }), 'темп 7–140 км/сут')?.level).toBe('ok');
    // 2 ч на 1/3 входа → 6 ч при нынешних 12 — в пределах
    expect(lv(pc('riverCrossHours', { value: 2, unit: 'ч', scale: 3 }), 'за 2 ч')?.level).toBe('ok');
    expect(lv(pc('riverCrossHours', { value: 1, unit: 'ч' }), 'за 1 ч')?.level).toBe('doubt');
  });
  it('без сведений о входах (paramInfo) — прежнее поведение', () => {
    const r = runChecks(cand(pc('defense.prepared', { value: 35, unit: '%' }), 'на 35 %'), { formations: [], entries: [], strengthOf: () => null, existing: [], knownParams: known, text: 'на 35 %' });
    expect(r.find((x) => x.check === 'param')?.level).toBe('ok');
  });
  it('прирост в процентах, пересчитанный в множитель (+35 % → 1,35 ×), — число в цитате найдено', () => {
    const r = chk(pc('defense.prepared', { value: 1.35, unit: '×' }), 'подготовленная оборона повышает устойчивость на 35 %');
    expect(r.find((x) => x.check === 'numbers')?.level).toBe('ok');
    expect(r.find((x) => x.check === 'param')?.level).toBe('ok');
    // снижение на 30 % → 0,7 ×
    expect(chk(pc('defense.prepared', { value: 0.7, unit: '×' }), 'снижает на 30 %').find((x) => x.check === 'numbers')?.level).toBe('ok');
    // без единицы × пересчёт не принимается
    expect(chk(pc('defense.prepared', { value: 1.35 }), 'на 35 %').find((x) => x.check === 'numbers')?.level).toBe('fail');
  });
});
