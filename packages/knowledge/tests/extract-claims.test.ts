import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { toCandidates, runChecks, EXTRACT_SCHEMA, OPERATION_EXTRACT_SCHEMA, extractMessages, claimRules, isNormative, isDoctrinal, scanMessages, verdictOf, type ExtractedClaim, type CheckCtx } from '../src';

const fx = <T>(n: string) => JSON.parse(readFileSync(new URL(`./fixtures/llm/${n}.json`, import.meta.url), 'utf8')) as T;
const doc = { id: 'd1', name: 'Выписка', reliability: 'B' as const, operation: 'berlin' };
const TEXT = 'Сводка. С 16 по 19.04 8 гв. А потеряла убитыми 1 200, ранеными 3 400 человек. Мост у Лебуса противник взорвал 18 апреля.';
const ctx = (over: Partial<CheckCtx> = {}): CheckCtx => ({ formations: [{ id: 'su_8gva', name: '8 гв. А', echelon: 'army', personnel: 60000 }], entries: [], strengthOf: () => null, existing: [], text: TEXT, ...over });

describe('claims из текста', () => {
  const ans = fx<{ claims: ExtractedClaim[] }>('extract-losses');
  const cs = toCandidates(ans.claims, doc, { chunk: 2 }, 'text');
  it('потери: subject пуст, имя — в names, доказательство — цитата', () => {
    const l = cs[0];
    expect(l.claim).toMatchObject({ kind: 'losses', subject: '', from: '1945-04-16', to: '1945-04-19', killed: 1200, wounded: 3400 });
    expect(l.names.subject).toBe('8 гв. А');
    expect(l.evidence).toMatchObject({ kind: 'quote', doc: 'd1', chunk: 2 });
    expect(l).toMatchObject({ origin: 'text', source: 'doc:d1', op: 'berlin', pages: 'часть 3', state: 'pending', checks: [] });
  });
  it('переправа без состояния пропускается', () => {
    expect(cs).toHaveLength(1);
  });
  it('проверки: цитата найдена, числа в цитате', () => {
    const r = runChecks(cs[0], ctx());
    expect(r.find((x) => x.check === 'quote')?.level).toBe('ok');
    expect(r.find((x) => x.check === 'numbers')?.level).toBe('ok');
  });
  it('схемы: claims есть, positions и boundaries убраны', () => {
    expect(Object.keys(EXTRACT_SCHEMA.properties)).toContain('claims');
    const p = Object.keys(OPERATION_EXTRACT_SCHEMA.properties);
    expect(p).toEqual(expect.arrayContaining(['items', 'claims', 'infrastructure']));
    expect(p).not.toContain('positions');
    expect(p).not.toContain('boundaries');
    expect(OPERATION_EXTRACT_SCHEMA.properties.infrastructure.items.properties.kind.enum).not.toContain('bridge');
  });
  it('промпт описывает claims', () => {
    expect(extractMessages('текст', 'Д')[0].content).toContain('losses');
  });
  it('переправа, позиция и подчинённость собираются', () => {
    const base = { subject: null, parent: null, place: null, between: null, points: null, inclusive: null, title: null, date: '1945-04-18', dateTo: null, personnel: null, tanks: null, guns: null, killed: null, wounded: null, missing: null, total: null, state: null, lat: null, lon: null, approxKm: null, quote: 'цитата' } as const;
    const out = toCandidates([
      { ...base, kind: 'crossing', subject: 'мост', state: 'destroyed' },
      { ...base, kind: 'position', subject: '8 гв. А', place: 'Зеелов', lat: 52.5, lon: 14.4, approxKm: 3 },
      { ...base, kind: 'parent', subject: '8 гв. А', parent: '1 БФ' },
      { ...base, kind: 'boundary', between: ['1 БФ', '1 УФ'], points: ['Люббен', 'Котбус'] },
    ], doc, { chunk: 0 }, 'text');
    expect(out.map((c) => c.claim.kind)).toEqual(['crossing', 'position', 'parent', 'boundary']);
    expect(out[1].claim).toMatchObject({ lngLat: [14.4, 52.5], uncertaintyKm: 3 });
    expect(out[2].names.parent).toBe('1 БФ');
    expect(out[3].names.between).toEqual(['1 БФ', '1 УФ']);
  });
});

describe('нормативы модели из текста: param и outcome', () => {
  const base = { subject: null, parent: null, place: null, between: null, points: null, inclusive: null, title: null, date: null, dateTo: null, personnel: null, tanks: null, guns: null, killed: null, wounded: null, missing: null, total: null, state: null, lat: null, lon: null, approxKm: null, quote: 'цитата' } as const;
  const opDoc = { ...doc, operation: 'berlin-1945-tasks' };
  it('param: путь, значение или диапазон, единица, сторона', () => {
    const out = toCandidates([
      { ...base, kind: 'param', param: 'advanceMax', range: [25, 45], unit: 'км/сут', side: null },
      { ...base, kind: 'param', param: 'foot.road', value: 30, unit: 'км/сут', side: 'su' },
      { ...base, kind: 'param', param: null, value: 3 },
      { ...base, kind: 'param', param: 'advanceMax' },
    ], opDoc, { chunk: 0 }, 'text');
    expect(out.map((c) => c.claim)).toEqual([
      { kind: 'param', param: 'advanceMax', range: [25, 45], unit: 'км/сут' },
      { kind: 'param', param: 'foot.road', value: 30, unit: 'км/сут', side: 'su' },
    ]);
    expect(out[0].key).toBe('numbers');
  });
  it('outcome: операция документа, соединение — в names, период и диапазон', () => {
    const out = toCandidates([
      { ...base, kind: 'outcome', measure: 'pace', subject: '5 уд. А', date: '1945-04-17', dateTo: '1945-04-18', range: [5, 14], unit: 'км/сут' },
    ], opDoc, { chunk: 0 }, 'text');
    expect(out[0].claim).toEqual({ kind: 'outcome', measure: 'pace', scenario: 'berlin-1945-tasks', subject: '', from: '1945-04-17', to: '1945-04-18', range: [5, 14], unit: 'км/сут' });
    expect(out[0].names.subject).toBe('5 уд. А');
  });
  it('схема и промпт знают нормативы; перечень параметров — в промпте', () => {
    expect(EXTRACT_SCHEMA.properties.claims.items.properties.kind.enum).toEqual(expect.arrayContaining(['param', 'outcome']));
    const p = extractMessages('темп по наставлению', 'Д', undefined, [{ path: 'advanceMax', title: 'Наибольший темп', unit: 'км/сут' }])[0].content;
    expect(p).toContain('param');
    expect(p).toContain('advanceMax — Наибольший темп');
  });
});

describe('промпт нормативов: правила и перечень параметров', () => {
  const P = [{ path: 'advanceMax', title: 'Наибольший темп', unit: 'км/сут' }, { path: 'agents.combat.penetrationKmDay', title: 'Темп в прорыве', unit: 'км/сут' }];
  it('правила чисел и «только факты» не запрещают нормативы: дробные — как в тексте, предписания устава — выписываются', () => {
    const r = claimRules(undefined, P);
    expect(r).toMatch(/param и outcome[^\n]*дробн/);
    expect(r).toMatch(/1,35/);
    expect(r).toMatch(/устав|наставлен/);
    expect(r).toMatch(/кроме param/);
  });
  it('перечень — только во фрагменте с признаками норматива; agents.* в перечень не входят', () => {
    const norm = extractMessages('По наставлению темп наступления 25–45 км/сут.', 'Д', undefined, P)[0].content;
    expect(norm).toContain('advanceMax — Наибольший темп');
    expect(norm).not.toContain('agents.combat.penetrationKmDay');
    const plain = extractMessages('8 гв. А заняла Зеелов 17 апреля.', 'Д', undefined, P)[0].content;
    expect(plain).not.toContain('advanceMax — Наибольший темп');
    expect(plain).toContain('param');
  });
  it('признаки норматива', () => {
    expect(isNormative('поправка обороны 1,5')).toBe(true);
    expect(isNormative('потери 12 % численности')).toBe(true);
    expect(isNormative('продвигались 30 км в сутки')).toBe(true);
    expect(isNormative('Боевой устав пехоты')).toBe(true);
    expect(isNormative('8 гв. А заняла Зеелов')).toBe(false);
  });
  it('скан: перечень — если название документа с признаками норматива', () => {
    const txt = (m: ReturnType<typeof scanMessages>) => String(m[0].content);
    expect(txt(scanMessages('data:', 'Полевой устав 1944', undefined, P))).toContain('advanceMax — Наибольший темп');
    expect(txt(scanMessages('data:', 'Журнал боевых действий', undefined, P))).not.toContain('advanceMax — Наибольший темп');
  });
});

describe('доктрина из документов: вид doctrine', () => {
  const TXT = 'Наставление по ведению оборонительного боя (пересказ), п. 12: при вклинении противника в главную полосу корпус контратакует во фланг вклинившейся группировки силами не менее 0,33 своего резерва. П. 14: в ночь перед наступлением противника дивизия высылает мелкие группы для налётов на его исходные позиции. П. 15: вторая позиция оборудуется в глубине за главной полосой.';
  const ans = fx<{ claims: ExtractedClaim[] }>('extract-doctrine');
  const cs = toCandidates(ans.claims, { ...doc, name: 'Наставление по обороне' }, { chunk: 0 }, 'text');
  const dctx = ctx({ text: TXT, formations: [] });
  const level = (i: number, check: string) => runChecks(cs[i], dctx).find((r) => r.check === check);
  it('три кандидата doctrine с ключом principles; формальная часть первого', () => {
    expect(cs.map((c) => [c.claim.kind, c.key])).toEqual([['doctrine', 'principles'], ['doctrine', 'principles'], ['doctrine', 'principles']]);
    expect(cs[0].claim).toMatchObject({ side: 'de', level: 'corps', group: 'counterattack', rule: 'flank-counterattack-third', values: { force_share: 0.33 } });
    expect(cs[0].value).toBe('Доктрина (нем., корпус, контратаки и контрудары): Противник вклинился в главную полосу → Контратака корпусным резервом во фланг вклинившейся группировки; force_share 0,33');
  });
  it('правильный — цитата, числа, доктрина ok, итог auto; соединения не ищется', () => {
    const r = runChecks(cs[0], dctx);
    expect(['quote', 'numbers', 'doctrine'].map((k) => r.find((x) => x.check === k)?.level)).toEqual(['ok', 'ok', 'ok']);
    expect(r.find((x) => x.check === 'subject')).toBeUndefined();
    expect(verdictOf(r)).toBe('auto');
  });
  it('неизвестная группа — сомнение, итог review; пустой rule — из действия латиницей', () => {
    expect(level(1, 'doctrine')).toEqual({ check: 'doctrine', level: 'doubt', why: 'неизвестная группа: «night-raid»' });
    expect(verdictOf(runChecks(cs[1], dctx))).toBe('review');
    expect((cs[1].claim as { rule: string }).rule).toBe('doc-nochnoy-nalet-melkimi-gruppami');
    expect(cs[1].claim).not.toHaveProperty('values');
  });
  it('числа нет в цитате — отбой', () => {
    expect(level(2, 'numbers')?.level).toBe('fail');
    expect(verdictOf(runChecks(cs[2], dctx))).toBe('drop');
  });
  it('без стороны или со ступенью не из перечня — пропущен', () => {
    const x = ans.claims[0];
    expect(toCandidates([{ ...x, side: null }, { ...x, level: 'regiment' }, { ...x, level: null }], doc, { chunk: 0 }, 'text')).toEqual([]);
  });
  it('rule обрезается до 32 знаков; диапазон в values', () => {
    const x = ans.claims[0];
    const [c] = toCandidates([{ ...x, rule: null, action: 'Контратака корпусным резервом во фланг вклинившейся группировки', values: [{ name: 'km', value: null, range: [2, 4] }, { name: 'bad', value: null, range: [4, 2] }] }], doc, { chunk: 0 }, 'text');
    const rule = (c.claim as { rule: string }).rule;
    expect(rule.startsWith('doc-kontrataka-korpusnym')).toBe(true);
    expect(rule.length).toBeLessThanOrEqual(36);
    expect(rule).not.toMatch(/-$/);
    expect((c.claim as { values?: unknown }).values).toEqual({ km: [2, 4] });
  });
  it('промпт: строка doctrine — только с признаками устава', () => {
    expect(extractMessages('Наставление по обороне, п. 12: контратака во фланг.', 'Д')[0].content).toContain('doctrine — правило устава');
    expect(extractMessages('Журнал боевых действий 8 гв. А за 16.04', 'Д')[0].content).not.toContain('doctrine — правило устава');
    expect(extractMessages('8 гв. А заняла Зеелов', 'Боевой устав пехоты')[0].content).toContain('doctrine — правило устава');
    expect(claimRules(undefined, undefined, true)).toContain('doctrine — правило устава');
    expect(claimRules()).not.toContain('doctrine — правило устава');
    const txt = (m: ReturnType<typeof scanMessages>) => String(m[0].content);
    expect(txt(scanMessages('data:', 'Merkblatt für den Gegenstoß'))).toContain('doctrine — правило устава');
    expect(txt(scanMessages('data:', 'Журнал боевых действий'))).not.toContain('doctrine — правило устава');
  });
  it('признаки устава', () => {
    expect(isDoctrinal('Боевой устав пехоты, ст. 423')).toBe(true);
    expect(isDoctrinal('Указания по прорыву обороны')).toBe(true);
    expect(isDoctrinal('Richtlinie für die Abwehr')).toBe(true);
    expect(isDoctrinal('Сводка потерь за сутки')).toBe(false);
  });
  it('схема знает doctrine и его поля', () => {
    const p = EXTRACT_SCHEMA.properties.claims.items.properties;
    expect(p.kind.enum).toContain('doctrine');
    expect(Object.keys(p)).toEqual(expect.arrayContaining(['level', 'group', 'rule', 'condition', 'action', 'values']));
    expect(EXTRACT_SCHEMA.properties.claims.items.required).toEqual(expect.arrayContaining(['condition', 'action', 'values']));
  });
});
